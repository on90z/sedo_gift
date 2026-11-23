import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import {
  addAuditLog,
  ALL_ADMIN_PERMISSIONS,
  createBackupSnapshot,
  DEFAULT_MANAGER_PERMISSIONS,
  getDb,
  hashPassword,
  listBackupSnapshots,
  persistDb,
  verifyPassword,
  type AdminRole,
} from './store.ts';
import {
  buildOtpAuthUri,
  checkLoginLockout,
  clearLoginFailures,
  decryptSecretAtRest,
  encryptSecretAtRest,
  generateBase32Secret,
  generateRecoveryCodes,
  hasValidImageMagicBytes,
  isSafeHttpOrLocalAssetUrl,
  recordLoginFailure,
  validateStrongPassword,
  verifyTotpCode,
} from './security.ts';
import {
  formatIqd,
  isBirthdayMatch,
  isValidIraqiPhone,
  normalizeIraqiPhone,
  validateAndPriceCartItems,
} from '../src/shared/pricing.ts';
import type {
  AdminNotification,
  AdminPermission,
  OptionItem,
  OrderRecord,
  OrderStatus,
  Product,
} from '../src/shared/types.ts';

interface TokenPayload {
  role: 'admin' | 'customer' | 'admin_mfa_challenge';
  adminRole?: AdminRole;
  sub: string;
  username?: string;
  phone?: string;
  tv?: number;
  jti: string;
  exp: number;
}

interface AuthedRequest extends Request {
  auth?: TokenPayload;
}

const VALID_PERMISSIONS: ReadonlySet<AdminPermission> = new Set(ALL_ADMIN_PERMISSIONS);

function getAllowedCorsOrigins(): Set<string> {
  const allowed = new Set<string>();
  const addOrigin = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    try {
      allowed.add(new URL(trimmed).origin.toLowerCase());
    } catch {
      // ignore invalid URL entry
    }
  };
  if (process.env.APP_URL) addOrigin(process.env.APP_URL);
  if (process.env.CORS_ALLOWED_ORIGINS) {
    for (const entry of process.env.CORS_ALLOWED_ORIGINS.split(',')) {
      addOrigin(entry);
    }
  }
  return allowed;
}

function getRequestHost(req: Request): string {
  const forwarded = req.get('x-forwarded-host');
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.get('host') || '';
  return raw.split(',')[0].trim().toLowerCase();
}

export function createSedoApp() {
  const app = express();
  const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const PUBLIC_UPLOADS_DIR = process.env.SEDO_UPLOADS_DIR
    ? path.resolve(process.env.SEDO_UPLOADS_DIR)
    : path.resolve(process.cwd(), 'public', 'uploads');
  fs.mkdirSync(PUBLIC_UPLOADS_DIR, { recursive: true });

  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  const revokedJtis = new Set<string>();
  const consumedMfaChallenges = new Set<string>();
  const sseClients = new Set<Response>();

  function rateLimit(keyPrefix: string, maxRequests: number, windowMs: number) {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${keyPrefix}:${ip}`;
      const now = Date.now();
      const bucket = rateBuckets.get(key);
      if (!bucket || now > bucket.resetAt) {
        rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }
      if (bucket.count >= maxRequests) {
        return res
          .status(429)
          .json({ error: 'Too many requests. Please wait a moment and try again.' });
      }
      bucket.count += 1;
      return next();
    };
  }

  function signToken(
    payload: Omit<TokenPayload, 'exp' | 'jti'>,
    ttlSeconds = 60 * 60 * 2
  ): string {
    const full: TokenPayload = {
      ...payload,
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const body = Buffer.from(JSON.stringify(full)).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function verifyToken(token: string): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(body)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
      if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
      if (parsed.jti && revokedJtis.has(parsed.jti)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    return header.slice(7).trim();
  }

  function isTokenVersionValid(payload: TokenPayload): boolean {
    const db = getDb();
    if (payload.sub === 'admin_owner') {
      const currentTv = db.adminCredential?.tokenVersion ?? 1;
      return (payload.tv ?? 1) === currentTv;
    }
    if (payload.sub.startsWith('admuser_')) {
      const user = (db.adminUsers || []).find((u) => u.id === payload.sub);
      if (!user) return false;
      return (payload.tv ?? 1) === user.tokenVersion;
    }
    return true;
  }

  function getEffectiveAdminPermissions(payload: TokenPayload): AdminPermission[] {
    if ((payload.adminRole ?? 'owner') === 'owner') {
      return [...ALL_ADMIN_PERMISSIONS];
    }
    const db = getDb();
    const user = (db.adminUsers || []).find((u) => u.id === payload.sub);
    if (!user) return [];
    const perms = Array.isArray(user.permissions)
      ? user.permissions.filter((p): p is AdminPermission => VALID_PERMISSIONS.has(p))
      : DEFAULT_MANAGER_PERMISSIONS;
    return perms;
  }

  function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
    const token = extractBearer(req);
    if (!token) return res.status(401).json({ error: 'Admin authentication required' });
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin' || !isTokenVersionValid(payload)) {
      return res.status(403).json({ error: 'Forbidden: valid admin session required' });
    }
    req.auth = payload;
    return next();
  }

  function requireOwner(req: AuthedRequest, res: Response, next: NextFunction) {
    requireAdmin(req, res, () => {
      if ((req.auth?.adminRole ?? 'owner') !== 'owner') {
        return res.status(403).json({ error: 'Forbidden: store owner permission required' });
      }
      return next();
    });
  }

  function requirePermission(permission: AdminPermission) {
    return (req: AuthedRequest, res: Response, next: NextFunction) => {
      requireAdmin(req, res, () => {
        const perms = getEffectiveAdminPermissions(req.auth!);
        if (!perms.includes(permission)) {
          return res.status(403).json({
            error: `Forbidden: missing '${permission}' permission`,
          });
        }
        return next();
      });
    };
  }

  function requireCustomer(req: AuthedRequest, res: Response, next: NextFunction) {
    const token = extractBearer(req);
    if (!token) return res.status(401).json({ error: 'Customer verification required' });
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'customer') {
      return res.status(403).json({ error: 'Forbidden: valid customer session required' });
    }
    req.auth = payload;
    return next();
  }

  function broadcastAdminEvent(event: string, data: unknown) {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(line);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  async function sendTelegramNotification(text: string): Promise<boolean> {
    const db = getDb();
    const token = process.env.TELEGRAM_BOT_TOKEN || db.telegramBotToken;
    const chatId = process.env.TELEGRAM_CHAT_ID || db.telegramChatId;
    if (!token || !chatId || !db.settings.telegramNotifyOnOrder) return false;
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
          }),
        }
      );
      return resp.ok;
    } catch (err) {
      console.error('Telegram notification dispatch failed:', err);
      return false;
    }
  }

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, PUBLIC_UPLOADS_DIR),
      filename: (_req, file, cb) => {
        const extMap: Record<string, string> = {
          'image/jpeg': '.jpg',
          'image/png': '.png',
          'image/webp': '.webp',
        };
        const ext = extMap[file.mimetype] || '.jpg';
        cb(null, `sedo_${crypto.randomUUID().slice(0, 12)}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only JPG, PNG, and WebP images are allowed'));
      }
    },
  });

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Production HTTP Security Headers & Anti-Caching on Sensitive APIs
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(self), camera=(), microphone=(), payment=(), usb=()'
    );
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    const host = getRequestHost(req);
    if (req.path.startsWith('/admin') || host.startsWith('admin.')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    if (req.path.startsWith('/api/admin') || req.path.startsWith('/api/customers')) {
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  });

  // Explicit CORS Allowlist & Same-Origin CSRF Enforcement for /api/*
  app.use('/api', (req, res, next) => {
    const originHeader = req.headers.origin;
    const allowedOrigins = getAllowedCorsOrigins();

    let originAllowed = false;
    if (originHeader) {
      try {
        const parsedOrigin = new URL(originHeader);
        const originHost = parsedOrigin.host.toLowerCase();
        const normalizedOrigin = parsedOrigin.origin.toLowerCase();
        const requestHost = getRequestHost(req);
        if (originHost === requestHost || allowedOrigins.has(normalizedOrigin)) {
          originAllowed = true;
          res.setHeader('Access-Control-Allow-Origin', originHeader);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        }
      } catch {
        return res.status(403).json({ error: 'Invalid request origin' });
      }
    }

    if (req.method === 'OPTIONS') {
      if (originHeader && !originAllowed) {
        return res.status(403).json({ error: 'Origin not allowed by CORS policy' });
      }
      return res.status(204).end();
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && originHeader && !originAllowed) {
      return res.status(403).json({ error: 'Cross-origin request blocked by CSRF policy' });
    }
    return next();
  });

  // Serve uploaded images safely with nosniff + CORS for allowed static frontends (e.g. Netlify)
  app.use(
    '/uploads',
    (req, res, next) => {
      const originHeader = req.headers.origin;
      if (originHeader) {
        try {
          const parsedOrigin = new URL(originHeader);
          const allowedOrigins = getAllowedCorsOrigins();
          if (
            parsedOrigin.host.toLowerCase() === getRequestHost(req) ||
            allowedOrigins.has(parsedOrigin.origin.toLowerCase())
          ) {
            res.setHeader('Access-Control-Allow-Origin', originHeader);
            res.setHeader('Vary', 'Origin');
          }
        } catch {
          // ignore malformed origin header on static asset GET
        }
      }
      next();
    },
    express.static(PUBLIC_UPLOADS_DIR, { dotfiles: 'deny', maxAge: '7d' })
  );

  // Public runtime config (never exposes admin routes or server secrets)
  app.get('/api/public-config', (_req, res) => {
    res.json({
      googleMapsApiKey:
        process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
      appUrl: process.env.APP_URL || '',
    });
  });

  // Dynamic SEO robots.txt & sitemap.xml
  app.get('/robots.txt', (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(
      /\/$/,
      ''
    );
    const routes = ['/', '/#bouquets', '/#builder', '/#gifts', '/#loyalty', '/#contact'];
    const now = new Date().toISOString().split('T')[0];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes
      .map(
        (r) =>
          `  <url>\n    <loc>${baseUrl}${r}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>daily</changefreq>\n  </url>`
      )
      .join('\n')}\n</urlset>`;
    res.type('application/xml').send(xml);
  });

  // Public catalog & settings (strictly strips all admin credentials & secrets)
  app.get('/api/catalog', (_req, res) => {
    const db = getDb();
    const {
      telegramBotToken: _t,
      telegramChatId: _c,
      adminCredential: _a,
      adminUsers: _au,
      ...safe
    } = db;
    void _t;
    void _c;
    void _a;
    void _au;
    const activeBirthdayPromoCodes = db.birthdayCampaigns
      .filter((c) => c.isActive && c.promoCode)
      .map((c) => ({
        code: c.promoCode.toUpperCase(),
        discountPercent: c.discountPercent,
        titleAr: c.titleAr,
        titleEn: c.titleEn,
      }));
    res.json({
      products: safe.products,
      options: safe.options,
      settings: {
        ...safe.settings,
        telegramConfigured: Boolean(
          (process.env.TELEGRAM_BOT_TOKEN || db.telegramBotToken) &&
            (process.env.TELEGRAM_CHAT_ID || db.telegramChatId)
        ),
      },
      activeBirthdayPromoCodes,
    });
  });

  // Server-side price preview validation endpoint
  app.post('/api/calculate-order', (req, res) => {
    try {
      const schema = z.object({
        items: z.array(z.any()).min(1).max(30),
        promoCode: z.string().max(40).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid calculation payload' });
      }
      const db = getDb();
      let discountPercent = 0;
      const code = parsed.data.promoCode?.trim().toUpperCase();
      if (code) {
        const campaign = db.birthdayCampaigns.find(
          (c) => c.isActive && c.promoCode.toUpperCase() === code
        );
        if (campaign) discountPercent = campaign.discountPercent;
      }
      const result = validateAndPriceCartItems(
        parsed.data.items,
        db.products,
        db.options,
        db.settings.roseUnitPriceIqd,
        db.settings.maxCustomRoses,
        discountPercent
      );
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Calculation failed' });
    }
  });

  // Order submission with strict server-side pricing, aggregate inventory deduction, and identity protection
  app.post('/api/orders', rateLimit('orders', 25, 10 * 60 * 1000), async (req, res) => {
    try {
      const orderInputSchema = z.object({
        clientRequestId: z.string().max(80).optional(),
        userId: z.string().max(128).nullable().optional(),
        customerName: z.string().trim().min(2).max(120),
        customerPhone: z.string().trim().min(8).max(32),
        customerBirthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        marketingConsent: z.boolean(),
        locationConsent: z.boolean().default(false),
        deliveryType: z.enum(['pickup', 'delivery']),
        deliveryAddress: z.string().max(300).optional(),
        paymentMethod: z.string().min(2).max(64),
        notes: z.string().max(500).optional(),
        promoCode: z.string().max(40).optional(),
        items: z.array(z.any()).min(1).max(30),
      });

      const parsed = orderInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'يرجى التحقق من صحة البيانات المدخلة (الاسم، رقم الهاتف، تاريخ الميلاد).',
          details: parsed.error.flatten(),
        });
      }

      const data = parsed.data;
      if (!isValidIraqiPhone(data.customerPhone)) {
        return res.status(400).json({
          error: 'يرجى إدخال رقم هاتف عراقي صحيح يبدأ بـ 07 (مثال: 07701234567).',
        });
      }

      if (data.deliveryType === 'delivery' && (!data.deliveryAddress || data.deliveryAddress.trim().length < 4)) {
        return res.status(400).json({
          error: 'يرجى إدخال عنوان التوصيل التفصيلي داخل كربلاء.',
        });
      }

      const db = getDb();

      // Prevent duplicate submissions
      if (data.clientRequestId) {
        const existingOrder = db.orders.find((o) => o.clientRequestId === data.clientRequestId);
        if (existingOrder) {
          return res.status(200).json({ order: existingOrder, duplicate: true });
        }
      }

      // Verify selected payment method is actually integrated & active
      const activeMethod = db.settings.paymentMethods.find(
        (m) => m.id === data.paymentMethod && m.isActive && m.isIntegrated
      );
      if (!activeMethod) {
        return res.status(400).json({ error: 'Selected payment method is not currently active.' });
      }

      // Verify optional promo code
      let discountPercent = 0;
      let promoCodeApplied: string | null = null;
      const code = data.promoCode?.trim().toUpperCase();
      if (code) {
        const campaign = db.birthdayCampaigns.find(
          (c) => c.isActive && c.promoCode.toUpperCase() === code
        );
        if (!campaign) {
          return res.status(400).json({ error: 'Invalid or expired promo code' });
        }
        discountPercent = campaign.discountPercent;
        promoCodeApplied = campaign.promoCode.toUpperCase();
      }

      // Server-authoritative recalculation & aggregate stock verification
      const priced = validateAndPriceCartItems(
        data.items,
        db.products,
        db.options,
        db.settings.roseUnitPriceIqd,
        db.settings.maxCustomRoses,
        discountPercent
      );

      // Deduct stock atomically for BOTH ready-made products and custom bouquet flower varieties
      for (const item of data.items) {
        const qty = Math.max(1, Math.floor(Number(item.quantity || 1)));
        if (item.type === 'ready_made' && item.productId) {
          const prod = db.products.find((p) => p.id === item.productId);
          if (prod) {
            prod.stock = Math.max(0, prod.stock - qty);
            if (prod.stock === 0) prod.isAvailable = false;
          }
        } else if (item.type === 'custom_bouquet' && item.customSelection?.flowerTypeId) {
          const flowerOpt = db.options.find(
            (o) => o.id === item.customSelection.flowerTypeId && o.group === 'flower_type'
          );
          if (flowerOpt) {
            const rosesNeeded = Math.max(1, Math.floor(Number(item.customSelection.roseQuantity || 1)));
            flowerOpt.stock = Math.max(0, flowerOpt.stock - rosesNeeded * qty);
            if (flowerOpt.stock === 0) flowerOpt.isAvailable = false;
          }
        }
      }

      const normalizedPhone = normalizeIraqiPhone(data.customerPhone);
      const nowIso = new Date().toISOString();

      // Check optional authenticated customer bearer token if sent
      const callerBearer = extractBearer(req);
      const callerPayload = callerBearer ? verifyToken(callerBearer) : null;
      const isCallerSameCustomer = Boolean(
        callerPayload && callerPayload.role === 'customer' && callerPayload.phone === normalizedPhone
      );

      let customer = db.customers.find((c) => c.phone === normalizedPhone);
      let identityMatchesCustomer = false;

      if (!customer) {
        customer = {
          id: `cust_${crypto.randomUUID().slice(0, 10)}`,
          userId: data.userId || null,
          fullName: data.customerName,
          phone: normalizedPhone,
          birthDate: data.customerBirthDate,
          marketingConsent: data.marketingConsent,
          locationConsent: data.locationConsent,
          totalOrders: 0,
          totalSpentIqd: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        db.customers.push(customer);
        identityMatchesCustomer = true;
      } else {
        // CRITICAL SECURITY GUARD: Never allow an unauthenticated order to overwrite existing customer's birthDate
        identityMatchesCustomer =
          isCallerSameCustomer || customer.birthDate === data.customerBirthDate;
        if (identityMatchesCustomer) {
          customer.fullName = data.customerName;
          customer.marketingConsent = data.marketingConsent;
          if (data.userId && !customer.userId) customer.userId = data.userId;
        }
        customer.updatedAt = nowIso;
      }

      customer.totalOrders += 1;
      customer.totalSpentIqd += priced.totalIqd;

      // Ensure customer has a Digital Loyalty Card (stamps start at 0, NEVER auto-awarded)
      let card = db.loyaltyCards.find((lc) => lc.customerId === customer!.id);
      if (!card) {
        card = {
          id: `card_${customer.id.replace('cust_', '')}`,
          customerId: customer.id,
          userId: customer.userId || null,
          customerName: customer.fullName,
          customerPhone: customer.phone,
          stampsCount: 0,
          rewardStatus: 'in_progress',
          completedCardsCount: 0,
          rewardExpiresAt: null,
          updatedAt: nowIso,
        };
        db.loyaltyCards.push(card);
      } else if (identityMatchesCustomer) {
        card.customerName = customer.fullName;
        if (customer.userId && !card.userId) card.userId = customer.userId;
      }

      const dateTag = nowIso.slice(0, 10).replace(/-/g, '');
      const seq = String(db.orders.length + 1).padStart(4, '0');
      const orderNumber = `SEDO-${dateTag}-${seq}`;

      const order: OrderRecord = {
        id: `ord_${crypto.randomUUID().slice(0, 12)}`,
        orderNumber,
        clientRequestId: data.clientRequestId,
        userId: identityMatchesCustomer ? data.userId || null : null,
        customerId: customer.id,
        customerName: data.customerName,
        customerPhone: customer.phone,
        customerBirthDate: data.customerBirthDate,
        status: 'New',
        items: priced.items,
        subtotalIqd: priced.subtotalIqd,
        discountIqd: priced.discountIqd,
        promoCodeApplied,
        totalIqd: priced.totalIqd,
        paymentMethod: activeMethod.id,
        deliveryType: data.deliveryType,
        deliveryAddress: data.deliveryAddress?.trim() || '',
        notes: data.notes?.trim() || '',
        stampAwarded: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      db.orders.unshift(order);

      // Immediate Admin Notification
      const firstCustom = priced.items.find((i) => i.type === 'custom_bouquet');
      const summaryLineAr = priced.items
        .map((i) => `${i.titleAr} × ${i.quantity}`)
        .join(' + ');
      const summaryLineEn = priced.items
        .map((i) => `${i.titleEn} × ${i.quantity}`)
        .join(' + ');

      const notification: AdminNotification = {
        id: `notif_${crypto.randomUUID().slice(0, 10)}`,
        type: 'new_order',
        titleAr: `طلب جديد #${orderNumber}`,
        titleEn: `New Order #${orderNumber}`,
        messageAr: `${order.customerName} (${order.customerPhone}) · ${summaryLineAr} · الإجمالي: ${formatIqd(order.totalIqd, 'en')}`,
        messageEn: `${order.customerName} (${order.customerPhone}) · ${summaryLineEn} · Total: ${formatIqd(order.totalIqd, 'en')}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        isRead: false,
        createdAt: nowIso,
      };
      db.notifications.unshift(notification);
      if (db.notifications.length > 200) db.notifications.length = 200;

      persistDb();
      broadcastAdminEvent('new_order', { order, notification });

      const tgLines = [
        `🌹 <b>SEDO New Order #${orderNumber}</b>`,
        `Customer: ${order.customerName}`,
        `Phone: ${order.customerPhone}`,
        `Items: ${summaryLineEn}`,
        firstCustom?.details.flowerTypeNameEn
          ? `Flower: ${firstCustom.details.flowerTypeNameEn} (${firstCustom.details.roseQuantity} roses)`
          : '',
        firstCustom?.details.colorNamesEn?.length
          ? `Colors: ${firstCustom.details.colorNamesEn.join(', ')}`
          : '',
        firstCustom?.details.wrappingNameEn
          ? `Wrapping: ${firstCustom.details.wrappingNameEn}`
          : '',
        firstCustom?.details.giftNamesEn?.length
          ? `Gifts: ${firstCustom.details.giftNamesEn.join(', ')}`
          : '',
        `Total: ${formatIqd(order.totalIqd, 'en')}`,
        `Date: ${nowIso}`,
      ].filter(Boolean);
      void sendTelegramNotification(tgLines.join('\n'));

      const customerToken = identityMatchesCustomer
        ? signToken({
            role: 'customer',
            sub: customer.id,
            phone: customer.phone,
          })
        : null;

      return res.status(201).json({
        order,
        loyaltyCard: identityMatchesCustomer ? card : null,
        customerToken,
        identityVerificationRequired: !identityMatchesCustomer,
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Order failed' });
    }
  });

  // Customer private verification (Phone + Date of Birth) to protect loyalty & order history
  app.post('/api/customers/verify', rateLimit('cust_verify', 15, 10 * 60 * 1000), (req, res) => {
    const schema = z.object({
      phone: z.string().min(8).max(32),
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'يرجى إدخال رقم الهاتف وتاريخ الميلاد بشكل صحيح.' });
    }
    const normalized = normalizeIraqiPhone(parsed.data.phone);
    const db = getDb();
    const customer = db.customers.find(
      (c) => c.phone === normalized && c.birthDate === parsed.data.birthDate
    );
    if (!customer) {
      return res.status(404).json({
        error: 'لم يتم العثور على سجل مطابق. تأكد من رقم الهاتف وتاريخ الميلاد المستخدم عند الطلب.',
      });
    }

    const token = signToken({
      role: 'customer',
      sub: customer.id,
      phone: customer.phone,
    });
    const card = db.loyaltyCards.find((lc) => lc.customerId === customer.id) || null;
    const orders = db.orders.filter((o) => o.customerId === customer.id);
    const transactions = db.loyaltyTransactions.filter((t) => t.customerId === customer.id);

    return res.json({
      customerToken: token,
      customer,
      loyaltyCard: card,
      orders,
      transactions,
    });
  });

  app.get('/api/customers/me', requireCustomer, (req: AuthedRequest, res) => {
    const db = getDb();
    const customer = db.customers.find((c) => c.id === req.auth!.sub);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const card = db.loyaltyCards.find((lc) => lc.customerId === customer.id) || null;
    const orders = db.orders.filter((o) => o.customerId === customer.id);
    const transactions = db.loyaltyTransactions.filter((t) => t.customerId === customer.id);
    return res.json({ customer, loyaltyCard: card, orders, transactions });
  });

  app.patch('/api/customers/me/consent', requireCustomer, (req: AuthedRequest, res) => {
    const schema = z.object({
      marketingConsent: z.boolean().optional(),
      locationConsent: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid consent payload' });

    const db = getDb();
    const customer = db.customers.find((c) => c.id === req.auth!.sub);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (typeof parsed.data.marketingConsent === 'boolean') {
      customer.marketingConsent = parsed.data.marketingConsent;
    }
    if (typeof parsed.data.locationConsent === 'boolean') {
      customer.locationConsent = parsed.data.locationConsent;
    }
    customer.updatedAt = new Date().toISOString();
    persistDb();
    return res.json({ customer });
  });

  // ============================================
  // ADMIN AUTHENTICATION, MFA, RBAC & SECURITY
  // ============================================
  async function verifyOwnerFirebaseIdToken(idToken: string): Promise<{
    localId: string;
    email: string;
  } | null> {
    try {
      const fbConfig = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8')
      ) as { apiKey: string };
      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fbConfig.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        users?: Array<{ localId: string; email?: string; emailVerified?: boolean }>;
      };
      const user = data.users?.[0];
      if (!user || !user.emailVerified || user.email !== 'moimlali00@gmail.com') {
        return null;
      }
      return { localId: user.localId, email: user.email };
    } catch {
      return null;
    }
  }

  app.get('/api/admin/status', (_req, res) => {
    const db = getDb();
    const envPasscodeSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim());
    const hasClaimed = Boolean(db.adminCredential);
    res.json({
      initialized: envPasscodeSet || hasClaimed,
      requiresSetup: !envPasscodeSet && !hasClaimed,
      envOverrideActive: envPasscodeSet,
      mfaEnabled: Boolean(db.adminCredential?.mfaEnabled),
    });
  });

  app.post('/api/admin/setup', rateLimit('admin_setup', 10, 15 * 60 * 1000), (req, res) => {
    const db = getDb();
    const envPasscodeSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim());
    if (envPasscodeSet || db.adminCredential) {
      return res.status(403).json({ error: 'Administrator account is already initialized.' });
    }
    const schema = z.object({
      username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.\-@]+$/),
      password: z.string().min(10).max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error:
          'Username must be 3+ characters and password must meet complexity rules (10+ chars).',
      });
    }
    const pwCheck = validateStrongPassword(parsed.data.password);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.reason });
    }

    const nowIso = new Date().toISOString();
    db.adminCredential = {
      username: parsed.data.username,
      passwordHash: hashPassword(parsed.data.password),
      role: 'owner',
      mfaEnabled: false,
      tokenVersion: 1,
      passwordUpdatedAt: nowIso,
      createdAt: nowIso,
    };
    addAuditLog(parsed.data.username, 'admin_setup', 'Initial store owner account created.');
    persistDb();

    const ttl = 60 * 60 * 2;
    const token = signToken(
      {
        role: 'admin',
        adminRole: 'owner',
        sub: 'admin_owner',
        username: parsed.data.username,
        tv: 1,
      },
      ttl
    );
    return res.status(201).json({
      token,
      username: parsed.data.username,
      adminRole: 'owner',
      permissions: ALL_ADMIN_PERMISSIONS,
      mfaEnabled: false,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    });
  });

  app.post('/api/admin/login', rateLimit('admin_login', 12, 15 * 60 * 1000), (req, res) => {
    const schema = z.object({
      username: z.string().trim().min(1).max(60),
      password: z.string().min(1).max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const lockKey = `login:${ip}:${parsed.data.username.toLowerCase()}`;
    const lockStatus = checkLoginLockout(lockKey);
    if (lockStatus.locked) {
      return res.status(429).json({
        error: `Too many failed login attempts. Try again in ${Math.ceil(lockStatus.retryAfterSeconds / 60)} minute(s).`,
        retryAfterSeconds: lockStatus.retryAfterSeconds,
      });
    }

    const db = getDb();
    const envPasscode = process.env.ADMIN_PASSCODE?.trim();

    if (envPasscode) {
      const a = Buffer.from(parsed.data.password);
      const b = Buffer.from(envPasscode);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        clearLoginFailures(lockKey);
        const ttl = 60 * 60 * 2;
        const token = signToken(
          {
            role: 'admin',
            adminRole: 'owner',
            sub: 'admin_env',
            username: parsed.data.username,
            tv: 1,
          },
          ttl
        );
        addAuditLog(parsed.data.username, 'admin_login', 'Admin signed in via environment passcode.');
        persistDb();
        return res.json({
          token,
          username: parsed.data.username,
          adminRole: 'owner',
          permissions: ALL_ADMIN_PERMISSIONS,
          mfaEnabled: false,
          expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        });
      }
      const fail = recordLoginFailure(lockKey);
      if (fail.nowLocked) {
        addAuditLog(
          parsed.data.username,
          'admin_login_locked',
          `Brute-force lockout triggered from ${ip}`
        );
        persistDb();
      }
      return res.status(fail.nowLocked ? 429 : 401).json({
        error: fail.nowLocked
          ? 'Too many failed attempts. Account temporarily locked for 15 minutes.'
          : 'Invalid credentials.',
      });
    }

    if (
      db.adminCredential &&
      parsed.data.username.toLowerCase() === db.adminCredential.username.toLowerCase()
    ) {
      const passMatch = verifyPassword(parsed.data.password, db.adminCredential.passwordHash);
      if (!passMatch) {
        const fail = recordLoginFailure(lockKey);
        if (fail.nowLocked) {
          addAuditLog(
            db.adminCredential.username,
            'admin_login_locked',
            `Brute-force lockout triggered from ${ip}`
          );
          persistDb();
        }
        return res.status(fail.nowLocked ? 429 : 401).json({
          error: fail.nowLocked
            ? 'Too many failed attempts. Login locked for 15 minutes.'
            : 'Invalid username or password.',
        });
      }

      clearLoginFailures(lockKey);
      const tv = db.adminCredential.tokenVersion ?? 1;

      if (db.adminCredential.mfaEnabled && db.adminCredential.mfaSecret) {
        const challengeToken = signToken(
          {
            role: 'admin_mfa_challenge',
            adminRole: 'owner',
            sub: 'admin_owner',
            username: db.adminCredential.username,
            tv,
          },
          300
        );
        return res.json({
          requiresMfa: true,
          challengeToken,
          username: db.adminCredential.username,
        });
      }

      const ttl = 60 * 60 * 2;
      const token = signToken(
        {
          role: 'admin',
          adminRole: db.adminCredential.role || 'owner',
          sub: 'admin_owner',
          username: db.adminCredential.username,
          tv,
        },
        ttl
      );
      addAuditLog(db.adminCredential.username, 'admin_login', 'Admin owner signed in.');
      persistDb();
      return res.json({
        token,
        username: db.adminCredential.username,
        adminRole: db.adminCredential.role || 'owner',
        permissions: ALL_ADMIN_PERMISSIONS,
        mfaEnabled: false,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      });
    }

    const managerUser = (db.adminUsers || []).find(
      (u) => u.username.toLowerCase() === parsed.data.username.toLowerCase()
    );
    if (managerUser && verifyPassword(parsed.data.password, managerUser.passwordHash)) {
      clearLoginFailures(lockKey);
      const ttl = 60 * 60 * 2;
      const perms =
        Array.isArray(managerUser.permissions) && managerUser.permissions.length > 0
          ? managerUser.permissions
          : DEFAULT_MANAGER_PERMISSIONS;
      const token = signToken(
        {
          role: 'admin',
          adminRole: managerUser.role,
          sub: managerUser.id,
          username: managerUser.username,
          tv: managerUser.tokenVersion,
        },
        ttl
      );
      addAuditLog(managerUser.username, 'admin_login', 'Store manager signed in.');
      persistDb();
      return res.json({
        token,
        username: managerUser.username,
        adminRole: managerUser.role,
        permissions: perms,
        mfaEnabled: false,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      });
    }

    if (!db.adminCredential && (db.adminUsers || []).length === 0) {
      return res.status(400).json({ error: 'Admin account not initialized yet.' });
    }

    const fail = recordLoginFailure(lockKey);
    if (fail.nowLocked) {
      addAuditLog(
        parsed.data.username,
        'admin_login_locked',
        `Brute-force lockout triggered from ${ip}`
      );
      persistDb();
    }
    return res.status(fail.nowLocked ? 429 : 401).json({
      error: fail.nowLocked
        ? 'Too many failed attempts. Login locked for 15 minutes.'
        : 'Invalid username or password.',
    });
  });

  // Step 2 MFA Verification (TOTP or One-Time Recovery Code)
  app.post('/api/admin/mfa/verify', rateLimit('admin_mfa', 10, 15 * 60 * 1000), (req, res) => {
    const schema = z.object({
      challengeToken: z.string().min(20).max(1000),
      code: z.string().trim().min(6).max(24),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Challenge token and code required.' });
    }

    const payload = verifyToken(parsed.data.challengeToken);
    if (!payload || payload.role !== 'admin_mfa_challenge' || consumedMfaChallenges.has(payload.jti)) {
      return res.status(401).json({ error: 'MFA challenge expired or already used.' });
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const lockKey = `mfa:${ip}:${payload.sub}`;
    const lockStatus = checkLoginLockout(lockKey);
    if (lockStatus.locked) {
      return res.status(429).json({
        error: `Too many failed MFA attempts. Try again in ${Math.ceil(lockStatus.retryAfterSeconds / 60)} minute(s).`,
      });
    }

    const db = getDb();
    if (!db.adminCredential || !db.adminCredential.mfaEnabled || !db.adminCredential.mfaSecret) {
      return res.status(400).json({ error: 'MFA is not active on this account.' });
    }

    const secret = decryptSecretAtRest(db.adminCredential.mfaSecret);
    let verified = secret ? verifyTotpCode(secret, parsed.data.code, 1) : false;
    let usedRecovery = false;

    if (!verified && Array.isArray(db.adminCredential.recoveryCodeHashes)) {
      const normalizedRecovery = parsed.data.code.toUpperCase().replace(/\s+/g, '');
      const idx = db.adminCredential.recoveryCodeHashes.findIndex((h) =>
        verifyPassword(normalizedRecovery, h)
      );
      if (idx >= 0) {
        verified = true;
        usedRecovery = true;
        db.adminCredential.recoveryCodeHashes.splice(idx, 1);
      }
    }

    if (!verified) {
      const fail = recordLoginFailure(lockKey);
      if (fail.nowLocked) {
        addAuditLog(
          db.adminCredential.username,
          'admin_mfa_locked',
          `MFA lockout triggered from ${ip}`
        );
        persistDb();
      }
      return res.status(fail.nowLocked ? 429 : 401).json({
        error: fail.nowLocked
          ? 'Too many invalid verification codes. Locked for 15 minutes.'
          : 'Invalid authentication or recovery code.',
      });
    }

    clearLoginFailures(lockKey);
    consumedMfaChallenges.add(payload.jti);
    const tv = db.adminCredential.tokenVersion ?? 1;
    const ttl = 60 * 60 * 2;
    const token = signToken(
      {
        role: 'admin',
        adminRole: db.adminCredential.role || 'owner',
        sub: 'admin_owner',
        username: db.adminCredential.username,
        tv,
      },
      ttl
    );
    addAuditLog(
      db.adminCredential.username,
      'admin_login_mfa',
      usedRecovery ? 'Admin signed in using MFA recovery code.' : 'Admin signed in with 2FA.'
    );
    persistDb();
    return res.json({
      token,
      username: db.adminCredential.username,
      adminRole: db.adminCredential.role || 'owner',
      permissions: ALL_ADMIN_PERMISSIONS,
      mfaEnabled: true,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    });
  });

  // Google Owner Firebase ID token sign-in bridge
  app.post('/api/admin/google-session', rateLimit('admin_google', 15, 15 * 60 * 1000), async (req, res) => {
    const idToken = req.body?.idToken;
    if (typeof idToken !== 'string' || idToken.length < 20) {
      return res.status(400).json({ error: 'Invalid ID token' });
    }
    const user = await verifyOwnerFirebaseIdToken(idToken);
    if (!user) {
      return res.status(403).json({ error: 'Google account is not authorized as store owner.' });
    }
    const db = getDb();
    const ttl = 60 * 60 * 2;
    const token = signToken(
      {
        role: 'admin',
        adminRole: 'owner',
        sub: user.localId,
        username: user.email,
      },
      ttl
    );
    addAuditLog(user.email, 'admin_google_login', 'Owner signed in via verified Google Auth.');
    persistDb();
    return res.json({
      token,
      username: user.email,
      adminRole: 'owner',
      permissions: ALL_ADMIN_PERMISSIONS,
      mfaEnabled: Boolean(db.adminCredential?.mfaEnabled),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    });
  });

  // Secure Owner Password Reset
  app.post('/api/admin/reset-password', rateLimit('admin_pw_reset', 5, 15 * 60 * 1000), async (req, res) => {
    const schema = z.object({
      newPassword: z.string().min(10).max(128),
      idToken: z.string().optional(),
      username: z.string().trim().optional(),
      recoveryCode: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Valid verification proof and strong new password required.' });
    }
    const pwCheck = validateStrongPassword(parsed.data.newPassword);
    if (!pwCheck.valid) return res.status(400).json({ error: pwCheck.reason });

    const db = getDb();
    if (!db.adminCredential) {
      return res.status(400).json({ error: 'No local owner account initialized to reset.' });
    }

    let authorizedBy = '';
    if (parsed.data.idToken) {
      const owner = await verifyOwnerFirebaseIdToken(parsed.data.idToken);
      if (owner) authorizedBy = `Google Owner (${owner.email})`;
    }

    if (
      !authorizedBy &&
      parsed.data.username &&
      parsed.data.recoveryCode &&
      parsed.data.username.toLowerCase() === db.adminCredential.username.toLowerCase() &&
      Array.isArray(db.adminCredential.recoveryCodeHashes)
    ) {
      const code = parsed.data.recoveryCode.toUpperCase().replace(/\s+/g, '');
      const idx = db.adminCredential.recoveryCodeHashes.findIndex((h) => verifyPassword(code, h));
      if (idx >= 0) {
        db.adminCredential.recoveryCodeHashes.splice(idx, 1);
        authorizedBy = `MFA Recovery Code (${db.adminCredential.username})`;
      }
    }

    if (!authorizedBy) {
      return res.status(403).json({
        error: 'Password reset requires verified Google Owner login or a valid MFA recovery code.',
      });
    }

    db.adminCredential.passwordHash = hashPassword(parsed.data.newPassword);
    db.adminCredential.tokenVersion = (db.adminCredential.tokenVersion ?? 1) + 1;
    db.adminCredential.passwordUpdatedAt = new Date().toISOString();
    addAuditLog(
      db.adminCredential.username,
      'admin_password_reset',
      `Password reset via ${authorizedBy}; all previous sessions revoked.`
    );
    persistDb();
    return res.json({ ok: true });
  });

  app.post('/api/admin/logout', requireAdmin, (req: AuthedRequest, res) => {
    if (req.auth?.jti) revokedJtis.add(req.auth.jti);
    addAuditLog(req.auth?.username || 'admin', 'admin_logout', 'Administrator signed out.');
    persistDb();
    return res.json({ ok: true });
  });

  app.get('/api/admin/security', requireAdmin, (req: AuthedRequest, res) => {
    const db = getDb();
    const isOwner = (req.auth?.adminRole ?? 'owner') === 'owner';
    return res.json({
      username: req.auth?.username || '',
      adminRole: req.auth?.adminRole || 'owner',
      permissions: getEffectiveAdminPermissions(req.auth!),
      mfaEnabled: Boolean(db.adminCredential?.mfaEnabled),
      recoveryCodesRemaining: db.adminCredential?.recoveryCodeHashes?.length ?? 0,
      passwordUpdatedAt:
        db.adminCredential?.passwordUpdatedAt || db.adminCredential?.createdAt || null,
      ownerUsername: db.adminCredential?.username || null,
      teamUsers: isOwner
        ? (db.adminUsers || []).map((u) => ({
            id: u.id,
            username: u.username,
            role: u.role,
            permissions: u.permissions || DEFAULT_MANAGER_PERMISSIONS,
            createdBy: u.createdBy,
            createdAt: u.createdAt,
          }))
        : [],
    });
  });

  app.post('/api/admin/security/change-password', requireAdmin, (req: AuthedRequest, res) => {
    const schema = z.object({
      currentPassword: z.string().min(1).max(128),
      newPassword: z.string().min(10).max(128),
      totpCode: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Current and new passwords required.' });
    }

    const pwCheck = validateStrongPassword(parsed.data.newPassword);
    if (!pwCheck.valid) return res.status(400).json({ error: pwCheck.reason });

    const db = getDb();
    if (req.auth?.sub === 'admin_owner' && db.adminCredential) {
      if (!verifyPassword(parsed.data.currentPassword, db.adminCredential.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      if (db.adminCredential.mfaEnabled && db.adminCredential.mfaSecret) {
        const secret = decryptSecretAtRest(db.adminCredential.mfaSecret);
        if (!parsed.data.totpCode || !verifyTotpCode(secret, parsed.data.totpCode, 1)) {
          return res
            .status(401)
            .json({ error: 'Valid 6-digit MFA code required to change password.' });
        }
      }
      db.adminCredential.passwordHash = hashPassword(parsed.data.newPassword);
      db.adminCredential.tokenVersion = (db.adminCredential.tokenVersion ?? 1) + 1;
      db.adminCredential.passwordUpdatedAt = new Date().toISOString();
      if (req.auth.jti) revokedJtis.add(req.auth.jti);
      addAuditLog(
        db.adminCredential.username,
        'password_changed',
        'Owner password updated and prior sessions revoked.'
      );
      persistDb();
      const ttl = 60 * 60 * 2;
      const newToken = signToken(
        {
          role: 'admin',
          adminRole: 'owner',
          sub: 'admin_owner',
          username: db.adminCredential.username,
          tv: db.adminCredential.tokenVersion,
        },
        ttl
      );
      return res.json({
        ok: true,
        token: newToken,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      });
    }

    if (req.auth?.sub?.startsWith('admuser_')) {
      const user = (db.adminUsers || []).find((u) => u.id === req.auth?.sub);
      if (!user) return res.status(404).json({ error: 'Account not found.' });
      if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      user.passwordHash = hashPassword(parsed.data.newPassword);
      user.tokenVersion += 1;
      if (req.auth.jti) revokedJtis.add(req.auth.jti);
      addAuditLog(user.username, 'password_changed', 'Manager password updated.');
      persistDb();
      const ttl = 60 * 60 * 2;
      const newToken = signToken(
        {
          role: 'admin',
          adminRole: user.role,
          sub: user.id,
          username: user.username,
          tv: user.tokenVersion,
        },
        ttl
      );
      return res.json({
        ok: true,
        token: newToken,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      });
    }

    return res.status(400).json({
      error:
        'Password changes apply to local accounts (Google-signed sessions manage password via Google Account).',
    });
  });

  app.post('/api/admin/security/mfa/begin', requireOwner, (_req: AuthedRequest, res) => {
    const db = getDb();
    if (!db.adminCredential) {
      return res
        .status(400)
        .json({ error: 'Create local owner username & password before enabling TOTP MFA.' });
    }
    const secret = generateBase32Secret(20);
    db.adminCredential.pendingMfaSecret = encryptSecretAtRest(secret);
    persistDb();
    const otpauthUri = buildOtpAuthUri({
      issuer: 'SEDO Admin',
      accountName: db.adminCredential.username,
      secretBase32: secret,
    });
    return res.json({ secret, otpauthUri });
  });

  app.post('/api/admin/security/mfa/confirm', requireOwner, (req: AuthedRequest, res) => {
    const schema = z.object({ code: z.string().trim().min(6).max(12) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '6-digit verification code required.' });

    const db = getDb();
    if (!db.adminCredential?.pendingMfaSecret) {
      return res.status(400).json({ error: 'MFA setup not started.' });
    }
    const secret = decryptSecretAtRest(db.adminCredential.pendingMfaSecret);
    if (!verifyTotpCode(secret, parsed.data.code, 1)) {
      return res
        .status(400)
        .json({ error: 'Invalid 6-digit code. Check device clock and try again.' });
    }

    const recoveryCodes = generateRecoveryCodes(6);
    db.adminCredential.mfaSecret = encryptSecretAtRest(secret);
    delete db.adminCredential.pendingMfaSecret;
    db.adminCredential.mfaEnabled = true;
    db.adminCredential.recoveryCodeHashes = recoveryCodes.map((c) => hashPassword(c));
    addAuditLog(
      req.auth?.username || 'owner',
      'mfa_enabled',
      'TOTP Multi-Factor Authentication enabled on owner account.'
    );
    persistDb();
    return res.json({ mfaEnabled: true, recoveryCodes });
  });

  app.post('/api/admin/security/mfa/disable', requireOwner, (req: AuthedRequest, res) => {
    const schema = z.object({
      password: z.string().min(1).max(128),
      code: z.string().trim().min(6).max(24),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Password and MFA code required.' });

    const db = getDb();
    if (!db.adminCredential?.mfaEnabled || !db.adminCredential.mfaSecret) {
      return res.status(400).json({ error: 'MFA is not currently enabled.' });
    }
    if (!verifyPassword(parsed.data.password, db.adminCredential.passwordHash)) {
      return res.status(401).json({ error: 'Invalid password.' });
    }
    const secret = decryptSecretAtRest(db.adminCredential.mfaSecret);
    if (!verifyTotpCode(secret, parsed.data.code, 1)) {
      return res.status(401).json({ error: 'Invalid 6-digit MFA code.' });
    }
    db.adminCredential.mfaEnabled = false;
    delete db.adminCredential.mfaSecret;
    delete db.adminCredential.pendingMfaSecret;
    db.adminCredential.recoveryCodeHashes = [];
    addAuditLog(req.auth?.username || 'owner', 'mfa_disabled', 'TOTP MFA disabled by owner.');
    persistDb();
    return res.json({ mfaEnabled: false });
  });

  app.post('/api/admin/security/revoke-all', requireOwner, (req: AuthedRequest, res) => {
    const db = getDb();
    if (db.adminCredential) {
      db.adminCredential.tokenVersion = (db.adminCredential.tokenVersion ?? 1) + 1;
    }
    for (const u of db.adminUsers || []) {
      u.tokenVersion += 1;
    }
    if (req.auth?.jti) revokedJtis.add(req.auth.jti);
    addAuditLog(
      req.auth?.username || 'owner',
      'sessions_revoked_all',
      'All active admin sessions were invalidated.'
    );
    persistDb();
    return res.json({ ok: true });
  });

  app.post('/api/admin/security/team', requireOwner, (req: AuthedRequest, res) => {
    const schema = z.object({
      username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.\-@]+$/),
      password: z.string().min(10).max(128),
      permissions: z
        .array(z.enum(['orders', 'products', 'loyalty', 'customers', 'notifications']))
        .min(1)
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid username (3+ chars) and strong password required.' });
    }
    const pwCheck = validateStrongPassword(parsed.data.password);
    if (!pwCheck.valid) return res.status(400).json({ error: pwCheck.reason });

    const db = getDb();
    db.adminUsers = db.adminUsers || [];
    const lower = parsed.data.username.toLowerCase();
    if (
      db.adminCredential?.username.toLowerCase() === lower ||
      db.adminUsers.some((u) => u.username.toLowerCase() === lower)
    ) {
      return res.status(409).json({ error: 'Username already exists.' });
    }

    const grantedPerms = parsed.data.permissions
      ? Array.from(new Set(parsed.data.permissions))
      : [...DEFAULT_MANAGER_PERMISSIONS];

    const user = {
      id: `admuser_${crypto.randomUUID().slice(0, 10)}`,
      username: parsed.data.username,
      passwordHash: hashPassword(parsed.data.password),
      role: 'manager' as const,
      permissions: grantedPerms,
      tokenVersion: 1,
      createdBy: req.auth?.username || 'owner',
      createdAt: new Date().toISOString(),
    };
    db.adminUsers.push(user);
    addAuditLog(
      req.auth?.username || 'owner',
      'team_user_created',
      `Added manager account ${user.username} (${grantedPerms.join(', ')})`,
      user.id
    );
    persistDb();
    return res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: user.permissions,
        createdBy: user.createdBy,
        createdAt: user.createdAt,
      },
    });
  });

  app.patch('/api/admin/security/team/:userId', requireOwner, (req: AuthedRequest, res) => {
    const schema = z.object({
      permissions: z
        .array(z.enum(['orders', 'products', 'loyalty', 'customers', 'notifications']))
        .min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'At least one permission must be selected.' });
    }
    const db = getDb();
    const user = (db.adminUsers || []).find((u) => u.id === req.params.userId);
    if (!user) return res.status(404).json({ error: 'Team user not found.' });
    user.permissions = Array.from(new Set(parsed.data.permissions));
    addAuditLog(
      req.auth?.username || 'owner',
      'team_user_permissions_updated',
      `Updated permissions for ${user.username}: ${user.permissions.join(', ')}`,
      user.id
    );
    persistDb();
    return res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: user.permissions,
        createdBy: user.createdBy,
        createdAt: user.createdAt,
      },
    });
  });

  app.delete('/api/admin/security/team/:userId', requireOwner, (req: AuthedRequest, res) => {
    const db = getDb();
    db.adminUsers = db.adminUsers || [];
    const idx = db.adminUsers.findIndex((u) => u.id === req.params.userId);
    if (idx < 0) return res.status(404).json({ error: 'Team user not found.' });
    const removed = db.adminUsers.splice(idx, 1)[0];
    addAuditLog(
      req.auth?.username || 'owner',
      'team_user_deleted',
      `Removed manager ${removed.username}`,
      removed.id
    );
    persistDb();
    return res.json({ ok: true });
  });

  // ============================================
  // ADMIN DASHBOARD ROUTES (Permission & Role Scoped)
  // ============================================
  app.get('/api/admin/events', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : extractBearer(req);
    if (!token) return res.status(401).end();
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin' || !isTokenVersionValid(payload)) {
      return res.status(403).end();
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  app.get('/api/admin/dashboard', requireAdmin, (req: AuthedRequest, res) => {
    const db = getDb();
    const isOwner = (req.auth?.adminRole ?? 'owner') === 'owner';
    const permissions = getEffectiveAdminPermissions(req.auth!);
    const permSet = new Set(permissions);

    const todayStr = new Date().toISOString().slice(0, 10);
    const monthStr = new Date().toISOString().slice(0, 7);

    const validOrders = db.orders.filter((o) => o.status !== 'Cancelled');
    const todayOrders = db.orders.filter((o) => o.createdAt.startsWith(todayStr));
    const monthOrders = validOrders.filter((o) => o.createdAt.startsWith(monthStr));

    const kpis = {
      totalOrders: permSet.has('orders') ? db.orders.length : 0,
      todayOrders: permSet.has('orders') ? todayOrders.length : 0,
      totalSalesIqd: permSet.has('orders') ? validOrders.reduce((s, o) => s + o.totalIqd, 0) : 0,
      monthlySalesIqd: permSet.has('orders') ? monthOrders.reduce((s, o) => s + o.totalIqd, 0) : 0,
      totalCustomers: permSet.has('customers') ? db.customers.length : 0,
      activeLoyaltyCards: permSet.has('loyalty') ? db.loyaltyCards.length : 0,
      completedRewards: permSet.has('loyalty')
        ? db.loyaltyCards.reduce((s, c) => s + c.completedCardsCount, 0)
        : 0,
      pendingOrders: permSet.has('orders')
        ? db.orders.filter((o) => ['New', 'Confirmed', 'Preparing'].includes(o.status)).length
        : 0,
    };

    const birthdayMatches = permSet.has('customers')
      ? db.customers.filter((c) => isBirthdayMatch(c.birthDate))
      : [];

    res.json({
      adminRole: req.auth?.adminRole || 'owner',
      permissions,
      kpis,
      orders: permSet.has('orders') || permSet.has('loyalty') ? db.orders : [],
      products: permSet.has('products') ? db.products : [],
      options: permSet.has('products') ? db.options : [],
      customers: permSet.has('customers') ? db.customers : [],
      loyaltyCards: permSet.has('loyalty') ? db.loyaltyCards : [],
      loyaltyTransactions: permSet.has('loyalty') ? db.loyaltyTransactions : [],
      notifications: permSet.has('notifications') ? db.notifications : [],
      birthdayCampaigns: permSet.has('customers') ? db.birthdayCampaigns : [],
      birthdayMatches,
      auditLogs: isOwner ? db.auditLogs : [],
      settings: {
        ...db.settings,
        telegramConfigured: Boolean(
          (process.env.TELEGRAM_BOT_TOKEN || db.telegramBotToken) &&
            (process.env.TELEGRAM_CHAT_ID || db.telegramChatId)
        ),
      },
    });
  });

  // Update order status
  app.patch(
    '/api/admin/orders/:orderId/status',
    requirePermission('orders'),
    (req: AuthedRequest, res) => {
      const schema = z.object({
        status: z.enum(['New', 'Confirmed', 'Preparing', 'Ready', 'Completed', 'Cancelled']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid status' });

      const db = getDb();
      const order = db.orders.find((o) => o.id === req.params.orderId);
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const prev = order.status;
      order.status = parsed.data.status as OrderStatus;
      order.updatedAt = new Date().toISOString();
      addAuditLog(
        req.auth?.username || 'admin',
        'order_status_updated',
        `Order ${order.orderNumber} changed from ${prev} to ${order.status}`,
        order.id
      );
      persistDb();
      return res.json({ order });
    }
  );

  // Loyalty: Award Stamp (Completed purchase + admin approval required, duplicate protected)
  app.post(
    '/api/admin/loyalty/award-stamp',
    requirePermission('loyalty'),
    (req: AuthedRequest, res) => {
      const schema = z.object({
        orderId: z.string().min(1).max(128),
        note: z.string().max(300).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Order ID required' });

      const db = getDb();
      const order = db.orders.find((o) => o.id === parsed.data.orderId);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (order.status !== 'Completed') {
        return res.status(400).json({
          error:
            order.status === 'Cancelled'
              ? 'Cannot award stamp for a cancelled order.'
              : 'Order must be marked Completed before awarding a loyalty stamp.',
        });
      }
      if (order.stampAwarded) {
        return res
          .status(409)
          .json({ error: 'Duplicate stamp prevented: order already stamped.' });
      }
      if (order.totalIqd < db.settings.loyaltyReward.minOrderIqd) {
        return res.status(400).json({
          error: `Order total (${order.totalIqd} IQD) is below minimum qualifying amount (${db.settings.loyaltyReward.minOrderIqd} IQD).`,
        });
      }

      const card = db.loyaltyCards.find((c) => c.customerId === order.customerId);
      if (!card) return res.status(404).json({ error: 'Loyalty card not found' });
      if (card.stampsCount >= 10) {
        return res.status(400).json({ error: 'Card already has 10 stamps. Redeem reward first.' });
      }

      const nowIso = new Date().toISOString();
      card.stampsCount += 1;
      card.updatedAt = nowIso;
      if (card.stampsCount === 10) {
        card.rewardStatus = 'unlocked';
        const exp = new Date();
        exp.setDate(exp.getDate() + (db.settings.loyaltyReward.expirationDays || 60));
        card.rewardExpiresAt = exp.toISOString();
      }

      order.stampAwarded = true;
      order.updatedAt = nowIso;

      const tx = {
        id: `ltx_${crypto.randomUUID().slice(0, 10)}`,
        cardId: card.id,
        customerId: card.customerId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        action: 'stamp_added' as const,
        delta: 1,
        performedBy: req.auth?.username || 'admin',
        note: parsed.data.note || `Approved stamp for order #${order.orderNumber}`,
        createdAt: nowIso,
      };
      db.loyaltyTransactions.unshift(tx);
      addAuditLog(
        req.auth?.username || 'admin',
        'loyalty_stamp_awarded',
        `Awarded +1 stamp to ${card.customerName} for order ${order.orderNumber} (${card.stampsCount}/10)`,
        card.id
      );
      persistDb();
      return res.json({ card, order, transaction: tx });
    }
  );

  // Loyalty: Reverse incorrect stamp with audit record
  app.post(
    '/api/admin/loyalty/reverse-stamp',
    requirePermission('loyalty'),
    (req: AuthedRequest, res) => {
      const schema = z.object({
        cardId: z.string().min(1).max(128),
        orderId: z.string().max(128).optional(),
        note: z.string().min(3).max(300),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Card ID and reason note are required.' });
      }

      const db = getDb();
      const card = db.loyaltyCards.find((c) => c.id === parsed.data.cardId);
      if (!card) return res.status(404).json({ error: 'Loyalty card not found' });
      if (card.stampsCount <= 0) {
        return res.status(400).json({ error: 'Card already has 0 stamps.' });
      }

      const nowIso = new Date().toISOString();
      card.stampsCount -= 1;
      if (card.stampsCount < 10 && card.rewardStatus === 'unlocked') {
        card.rewardStatus = 'in_progress';
        card.rewardExpiresAt = null;
      }
      card.updatedAt = nowIso;

      if (parsed.data.orderId) {
        const ord = db.orders.find((o) => o.id === parsed.data.orderId);
        if (ord) ord.stampAwarded = false;
      }

      const tx = {
        id: `ltx_${crypto.randomUUID().slice(0, 10)}`,
        cardId: card.id,
        customerId: card.customerId,
        orderId: parsed.data.orderId,
        action: 'stamp_reversed' as const,
        delta: -1,
        performedBy: req.auth?.username || 'admin',
        note: parsed.data.note,
        createdAt: nowIso,
      };
      db.loyaltyTransactions.unshift(tx);
      addAuditLog(
        req.auth?.username || 'admin',
        'loyalty_stamp_reversed',
        `Reversed -1 stamp for ${card.customerName}: ${parsed.data.note}`,
        card.id
      );
      persistDb();
      return res.json({ card, transaction: tx });
    }
  );

  // Loyalty: Redeem 10-stamp reward
  app.post(
    '/api/admin/loyalty/redeem-reward',
    requirePermission('loyalty'),
    (req: AuthedRequest, res) => {
      const schema = z.object({
        cardId: z.string().min(1).max(128),
        note: z.string().max(300).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Card ID required' });

      const db = getDb();
      const card = db.loyaltyCards.find((c) => c.id === parsed.data.cardId);
      if (!card) return res.status(404).json({ error: 'Loyalty card not found' });
      if (card.stampsCount < 10) {
        return res.status(400).json({ error: '10 completed stamps required to redeem reward.' });
      }
      if (card.rewardExpiresAt && Date.parse(card.rewardExpiresAt) < Date.now()) {
        return res.status(400).json({ error: 'Reward validity period has expired.' });
      }

      const nowIso = new Date().toISOString();
      card.stampsCount = 0;
      card.completedCardsCount += 1;
      card.rewardStatus = 'in_progress';
      card.rewardExpiresAt = null;
      card.updatedAt = nowIso;

      const tx = {
        id: `ltx_${crypto.randomUUID().slice(0, 10)}`,
        cardId: card.id,
        customerId: card.customerId,
        action: 'reward_redeemed' as const,
        delta: -10,
        performedBy: req.auth?.username || 'admin',
        note: parsed.data.note || `Redeemed reward: ${db.settings.loyaltyReward.titleEn}`,
        createdAt: nowIso,
      };
      db.loyaltyTransactions.unshift(tx);
      addAuditLog(
        req.auth?.username || 'admin',
        'loyalty_reward_redeemed',
        `Redeemed 10-stamp reward for ${card.customerName}`,
        card.id
      );
      persistDb();
      return res.json({ card, transaction: tx });
    }
  );

  // Products CRUD
  app.post('/api/admin/products', requirePermission('products'), (req: AuthedRequest, res) => {
    const schema = z.object({
      id: z.string().max(128).optional(),
      kind: z.enum(['bouquet', 'gift']),
      category: z.string().min(1).max(64),
      categoryAr: z.string().min(1).max(64),
      nameAr: z.string().min(1).max(140),
      nameEn: z.string().min(1).max(140),
      descriptionAr: z.string().max(800).default(''),
      descriptionEn: z.string().max(800).default(''),
      priceIqd: z.number().min(0),
      promoPriceIqd: z.number().min(0).nullable().optional(),
      roseCount: z.number().min(0).optional(),
      stock: z.number().min(0),
      isAvailable: z.boolean(),
      isFeatured: z.boolean().default(false),
      isBestSeller: z.boolean().default(false),
      imageUrl: z.string().min(1).max(500),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid product payload' });
    if (!isSafeHttpOrLocalAssetUrl(parsed.data.imageUrl, false)) {
      return res.status(400).json({ error: 'Invalid product image URL protocol' });
    }

    const db = getDb();
    const nowIso = new Date().toISOString();
    const product: Product = {
      ...parsed.data,
      id: parsed.data.id || `prod_${crypto.randomUUID().slice(0, 10)}`,
      updatedAt: nowIso,
    };

    const idx = db.products.findIndex((p) => p.id === product.id);
    if (idx >= 0) {
      db.products[idx] = product;
    } else {
      db.products.unshift(product);
    }
    addAuditLog(
      req.auth?.username || 'admin',
      'product_saved',
      `Saved product ${product.nameEn}`,
      product.id
    );
    persistDb();
    return res.json({ product });
  });

  app.delete(
    '/api/admin/products/:productId',
    requirePermission('products'),
    (req: AuthedRequest, res) => {
      const db = getDb();
      const idx = db.products.findIndex((p) => p.id === req.params.productId);
      if (idx < 0) return res.status(404).json({ error: 'Product not found' });
      const removed = db.products.splice(idx, 1)[0];
      addAuditLog(
        req.auth?.username || 'admin',
        'product_deleted',
        `Deleted ${removed.nameEn}`,
        removed.id
      );
      persistDb();
      return res.json({ ok: true });
    }
  );

  // Custom Bouquet Options CRUD
  app.post('/api/admin/options', requirePermission('products'), (req: AuthedRequest, res) => {
    const schema = z.object({
      id: z.string().max(128).optional(),
      group: z.enum(['flower_type', 'flower_color', 'wrapping', 'arrangement', 'gift']),
      nameAr: z.string().min(1).max(120),
      nameEn: z.string().min(1).max(120),
      priceIqd: z.number().min(0),
      colorHex: z.string().max(16).optional(),
      stock: z.number().min(0).default(100),
      isAvailable: z.boolean().default(true),
      imageUrl: z.string().min(1).max(500),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid option payload' });
    if (!isSafeHttpOrLocalAssetUrl(parsed.data.imageUrl, false)) {
      return res.status(400).json({ error: 'Invalid option image URL protocol' });
    }

    const db = getDb();
    const option: OptionItem = {
      ...parsed.data,
      id: parsed.data.id || `opt_${crypto.randomUUID().slice(0, 10)}`,
    };
    const idx = db.options.findIndex((o) => o.id === option.id);
    if (idx >= 0) {
      db.options[idx] = option;
    } else {
      db.options.push(option);
    }
    addAuditLog(
      req.auth?.username || 'admin',
      'option_saved',
      `Saved ${option.group}: ${option.nameEn}`,
      option.id
    );
    persistDb();
    return res.json({ option });
  });

  app.delete(
    '/api/admin/options/:optionId',
    requirePermission('products'),
    (req: AuthedRequest, res) => {
      const db = getDb();
      const idx = db.options.findIndex((o) => o.id === req.params.optionId);
      if (idx < 0) return res.status(404).json({ error: 'Option not found' });
      const removed = db.options.splice(idx, 1)[0];
      addAuditLog(
        req.auth?.username || 'admin',
        'option_deleted',
        `Deleted ${removed.nameEn}`,
        removed.id
      );
      persistDb();
      return res.json({ ok: true });
    }
  );

  // Store & Pricing & Maps & Loyalty Settings (Owner only)
  app.put('/api/admin/settings', requireOwner, (req: AuthedRequest, res) => {
    const db = getDb();
    const incoming = req.body;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload' });
    }
    const urlFields: Array<[string, boolean]> = [
      ['logoUrl', true],
      ['heroBannerUrl', false],
      ['storePhotoUrl', false],
      ['instagramUrl', true],
      ['googleMapsUrl', true],
      ['googleBusinessProfileUrl', true],
    ];
    for (const [field, allowEmpty] of urlFields) {
      if (
        typeof incoming[field] === 'string' &&
        !isSafeHttpOrLocalAssetUrl(incoming[field], allowEmpty)
      ) {
        return res.status(400).json({ error: `Invalid URL protocol for ${field}` });
      }
    }
    if (Array.isArray(incoming.categories)) {
      for (const c of incoming.categories) {
        if (c && typeof c.imageUrl === 'string' && !isSafeHttpOrLocalAssetUrl(c.imageUrl, false)) {
          return res.status(400).json({ error: 'Invalid category image URL protocol' });
        }
      }
    }
    if (typeof incoming.roseUnitPriceIqd === 'number' && incoming.roseUnitPriceIqd >= 0) {
      db.settings.roseUnitPriceIqd = Math.round(incoming.roseUnitPriceIqd);
    }
    if (
      typeof incoming.proximityRadiusMeters === 'number' &&
      Number.isFinite(incoming.proximityRadiusMeters)
    ) {
      db.settings.proximityRadiusMeters = Math.max(50, Math.round(incoming.proximityRadiusMeters));
    }
    if (
      typeof incoming.proximityCooldownHours === 'number' &&
      Number.isFinite(incoming.proximityCooldownHours)
    ) {
      db.settings.proximityCooldownHours = Math.max(
        1,
        Math.round(incoming.proximityCooldownHours)
      );
    }
    if (typeof incoming.maxCustomRoses === 'number' && Number.isFinite(incoming.maxCustomRoses)) {
      db.settings.maxCustomRoses = Math.max(1, Math.min(500, Math.round(incoming.maxCustomRoses)));
    }
    const allowedKeys: Array<keyof typeof db.settings> = [
      'storeNameAr',
      'storeNameEn',
      'taglineAr',
      'taglineEn',
      'logoUrl',
      'heroBannerUrl',
      'heroHeadlineAr',
      'heroHeadlineEn',
      'heroSubtitleAr',
      'heroSubtitleEn',
      'heroPrimaryCtaAr',
      'heroPrimaryCtaEn',
      'heroSecondaryCtaAr',
      'heroSecondaryCtaEn',
      'categoriesSectionTitleAr',
      'categoriesSectionTitleEn',
      'featuredSectionTitleAr',
      'featuredSectionTitleEn',
      'loyaltyPromoBadgeAr',
      'loyaltyPromoBadgeEn',
      'loyaltyPromoTitleAr',
      'loyaltyPromoTitleEn',
      'loyaltyPromoDescAr',
      'loyaltyPromoDescEn',
      'aboutTitleAr',
      'aboutTitleEn',
      'aboutTextAr',
      'aboutTextEn',
      'footerTextAr',
      'footerTextEn',
      'builderTitleAr',
      'builderTitleEn',
      'builderSubtitleAr',
      'builderSubtitleEn',
      'offerBannerEnabled',
      'offerBannerTextAr',
      'offerBannerTextEn',
      'categories',
      'storePhotoUrl',
      'addressAr',
      'addressEn',
      'phone',
      'secondaryPhone',
      'instagramHandle',
      'instagramUrl',
      'workingHoursAr',
      'workingHoursEn',
      'latitude',
      'longitude',
      'googleMapsUrl',
      'googleBusinessProfileUrl',
      'locationVerified',
      'proximityEnabled',
      'proximityMessageAr',
      'proximityMessageEn',
      'loyaltyReward',
      'paymentMethods',
      'telegramNotifyOnOrder',
      'defaultLanguage',
    ];
    for (const key of allowedKeys) {
      if (incoming[key] !== undefined) {
        (db.settings as unknown as Record<string, unknown>)[key] = incoming[key];
      }
    }
    if (typeof incoming.telegramBotToken === 'string') {
      db.telegramBotToken = incoming.telegramBotToken.trim();
    }
    if (typeof incoming.telegramChatId === 'string') {
      db.telegramChatId = incoming.telegramChatId.trim();
    }
    db.settings.updatedAt = new Date().toISOString();
    addAuditLog(
      req.auth?.username || 'admin',
      'settings_updated',
      'Updated store, pricing, maps, or loyalty settings.'
    );
    persistDb();
    return res.json({ settings: db.settings });
  });

  // Backups: list & create/download safe backup snapshot (Owner only, strips secrets)
  app.get('/api/admin/backups', requireOwner, (_req, res) => {
    return res.json({ backups: listBackupSnapshots() });
  });

  app.post('/api/admin/backups', requireOwner, (req: AuthedRequest, res) => {
    const db = getDb();
    const snap = createBackupSnapshot('admin_manual');
    addAuditLog(
      req.auth?.username || 'admin',
      'backup_created',
      snap ? `Created backup ${snap.filename}` : 'Backup requested'
    );
    persistDb();
    const {
      telegramBotToken: _t,
      telegramChatId: _c,
      adminCredential: _a,
      adminUsers: _au,
      ...safeExport
    } = db;
    void _t;
    void _c;
    void _a;
    void _au;
    return res.json({
      backup: snap,
      backups: listBackupSnapshots(),
      exportData: {
        exportedAt: new Date().toISOString(),
        ...safeExport,
      },
    });
  });

  // Birthday Campaigns
  app.post(
    '/api/admin/birthdays/campaigns',
    requirePermission('customers'),
    (req: AuthedRequest, res) => {
      const schema = z.object({
        id: z.string().optional(),
        titleAr: z.string().min(2).max(160),
        titleEn: z.string().min(2).max(160),
        messageAr: z.string().min(5).max(500),
        messageEn: z.string().min(5).max(500),
        promoCode: z.string().trim().min(3).max(40),
        discountPercent: z.number().min(0).max(50),
        isActive: z.boolean(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid campaign payload' });
      const db = getDb();
      const id = parsed.data.id || `bday_${crypto.randomUUID().slice(0, 8)}`;
      const existing = db.birthdayCampaigns.find((c) => c.id === id);
      if (existing) {
        Object.assign(existing, {
          ...parsed.data,
          promoCode: parsed.data.promoCode.toUpperCase(),
        });
      } else {
        db.birthdayCampaigns.unshift({
          id,
          ...parsed.data,
          promoCode: parsed.data.promoCode.toUpperCase(),
          sentCount: 0,
          createdAt: new Date().toISOString(),
        });
      }
      addAuditLog(
        req.auth?.username || 'admin',
        'birthday_campaign_saved',
        `Saved campaign ${parsed.data.promoCode}`
      );
      persistDb();
      return res.json({ campaigns: db.birthdayCampaigns });
    }
  );

  app.delete(
    '/api/admin/birthdays/campaigns/:campaignId',
    requirePermission('customers'),
    (req: AuthedRequest, res) => {
      const db = getDb();
      const idx = db.birthdayCampaigns.findIndex((c) => c.id === req.params.campaignId);
      if (idx < 0) return res.status(404).json({ error: 'Campaign not found' });
      const removed = db.birthdayCampaigns.splice(idx, 1)[0];
      addAuditLog(
        req.auth?.username || 'admin',
        'birthday_campaign_deleted',
        `Deleted campaign ${removed.promoCode}`,
        removed.id
      );
      persistDb();
      return res.json({ campaigns: db.birthdayCampaigns });
    }
  );

  app.post(
    '/api/admin/birthdays/dispatch',
    requirePermission('customers'),
    async (req: AuthedRequest, res) => {
      const db = getDb();
      const customerId = req.body?.customerId;
      const campaignId = req.body?.campaignId;
      const customer = db.customers.find((c) => c.id === customerId);
      const campaign = db.birthdayCampaigns.find((c) => c.id === campaignId);
      if (!customer || !campaign) {
        return res.status(404).json({ error: 'Customer or campaign not found' });
      }
      if (!customer.marketingConsent) {
        return res
          .status(400)
          .json({ error: 'Customer has not consented to promotional notifications.' });
      }

      campaign.sentCount += 1;
      const notif: AdminNotification = {
        id: `notif_${crypto.randomUUID().slice(0, 10)}`,
        type: 'birthday',
        titleAr: `تهنئة عيد ميلاد لـ ${customer.fullName}`,
        titleEn: `Birthday Greeting Prepared for ${customer.fullName}`,
        messageAr: `${campaign.messageAr} (كود: ${campaign.promoCode})`,
        messageEn: `${campaign.messageEn} (Code: ${campaign.promoCode})`,
        isRead: false,
        createdAt: new Date().toISOString(),
      };
      db.notifications.unshift(notif);
      addAuditLog(
        req.auth?.username || 'admin',
        'birthday_dispatched',
        `Prepared birthday greeting for ${customer.fullName} (${customer.phone})`
      );
      persistDb();

      await sendTelegramNotification(
        `🎂 <b>SEDO Birthday Reminder</b>\nCustomer: ${customer.fullName} (${customer.phone})\nCode: ${campaign.promoCode} (${campaign.discountPercent}% off)\nMessage:\n${campaign.messageAr}`
      );

      return res.json({ notification: notif, campaign });
    }
  );

  // Mark notification read
  app.patch(
    '/api/admin/notifications/:notifId/read',
    requirePermission('notifications'),
    (req, res) => {
      const db = getDb();
      const notif = db.notifications.find((n) => n.id === req.params.notifId);
      if (notif) {
        notif.isRead = true;
        persistDb();
      }
      return res.json({ ok: true });
    }
  );

  // Image Upload & Deletion (Path traversal + magic-byte signature guarded)
  app.post(
    '/api/admin/upload',
    requirePermission('products'),
    upload.single('image'),
    (req: AuthedRequest, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
      }
      if (!hasValidImageMagicBytes(req.file.path, req.file.mimetype)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore unlink error
        }
        addAuditLog(
          req.auth?.username || 'admin',
          'upload_rejected',
          `Rejected spoofed upload ${req.file.originalname}`
        );
        persistDb();
        return res.status(400).json({
          error: 'Uploaded file does not match a valid JPG, PNG, or WebP image signature.',
        });
      }
      const url = `/uploads/${req.file.filename}`;
      addAuditLog(req.auth?.username || 'admin', 'image_uploaded', `Uploaded ${url}`);
      persistDb();
      return res.status(201).json({ url, filename: req.file.filename });
    }
  );

  app.delete('/api/admin/upload/:filename', requireOwner, (req: AuthedRequest, res) => {
    const filename = req.params.filename;
    if (!/^[a-zA-Z0-9_.\-]+$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const resolved = path.resolve(PUBLIC_UPLOADS_DIR, filename);
    if (!resolved.startsWith(PUBLIC_UPLOADS_DIR + path.sep)) {
      return res.status(403).json({ error: 'Forbidden path' });
    }
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
    addAuditLog(req.auth?.username || 'admin', 'image_deleted', `Deleted ${filename}`);
    persistDb();
    return res.json({ ok: true });
  });

  // Safe JSON error handler for Multer / JSON Syntax errors (never leak stack traces)
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) {
      return next(err);
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        error:
          err.code === 'LIMIT_FILE_SIZE'
            ? 'Image file exceeds the 5MB maximum limit.'
            : err.message,
      });
    }
    if (err instanceof SyntaxError && 'status' in err) {
      return res.status(400).json({ error: 'Invalid JSON request body.' });
    }
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  });

  return { app, sseClients };
}
