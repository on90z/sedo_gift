# Security Summary

**Reviewed Files**: 11  
**Issues Resolved**: 6  

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Public-Admin Separation | `src/App.tsx` | 614 | The public storefront footer exposed a clickable Admin Console button visible to all customers, and `/admin` rendered inside storefront header/footer chrome. | Medium | Fixed | Removed the admin button from the public customer footer, removed `'admin'` from storefront hash navigation, and isolated `/admin` and `admin.*` subdomain rendering from public storefront UI. |
| Missing MFA & Brute-Force Lockout | `server.ts` | 795 | Admin login relied solely on username/password or environment passcode with IP rate-limiting, without per-account consecutive lockout or Multi-Factor Authentication. | High | Fixed | Added per-account + IP 5-failure 15-minute lockout (`checkLoginLockout` / `recordLoginFailure`), strong 10+ character password enforcement, TOTP 2FA with one-time hashed recovery codes, and 2-hour token expiry + 30-minute UI idle timeout + `jti`/`tokenVersion` server revocation. |
| Missing Role-Based Access Control (RBAC) | `server.ts` | 160 | All authenticated admin sessions held identical privileges without distinguishing store owner vs. operational staff. | Medium | Fixed | Added `requireOwner` RBAC enforcement on sensitive routes (`PUT /api/admin/settings`, `GET/POST /api/admin/backups`, `DELETE /api/admin/upload/:filename`, and team/MFA management) while limiting `manager` accounts to daily order, product, and loyalty operations. |
| Unverified Image File Signatures & URL Protocols | `server.ts` | 1990 | Product/setting image URLs lacked strict protocol filtering and uploaded files checked only HTTP MIME headers rather than actual file magic bytes. | Medium | Fixed | Added `hasValidImageMagicBytes` validation on uploaded JPG/PNG/WebP files (deleting invalid files immediately) and `isSafeHttpOrLocalAssetUrl` enforcement rejecting `javascript:`/`data:` URLs and directory traversal. |
| Cross-Origin Mutation & Sensitive Header Hardening | `server.ts` | 246 | Express omitted strict HTTP security headers, anti-caching on sensitive customer/admin endpoints, `noindex` headers for `/admin`, and origin verification on mutations. | Medium | Fixed | Disabled `x-powered-by`, added `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (HTTPS), `Cache-Control: no-store, private` on `/api/admin/*` and `/api/customers/*`, `X-Robots-Tag: noindex, nofollow, noarchive` on `/admin`/`admin.*`, and same-origin verification on mutating `/api/*` requests. |
| Automated Off-Credential Database Backups | `server/store.ts` | 101 | Backups were only created manually on demand. | Medium | Fixed | Added `runAutomatedDailyBackup` (runs on server boot and every 12 hours, keeping the latest 14 daily snapshots) with `0700`/`0600` filesystem permissions and strict stripping of credentials/tokens from export payloads. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Secrets & Credentials | `server.ts`, `.env.example` | `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, `ADMIN_PASSCODE`, and Telegram tokens are loaded from server `process.env`; public `/api/catalog` strips `adminCredential`, `adminUsers`, `telegramBotToken`, and `telegramChatId`. |
| Server-Side Pricing & Orders | `server.ts`, `src/shared/pricing.ts` | Order totals, rose counts, discounts, and active payment methods are recalculated and verified server-side regardless of client payloads. |
| Loyalty & Customer Privacy | `server.ts`, `firestore.rules` | Loyalty stamps require admin verification (`POST /api/admin/loyalty/award-stamp`) with duplicate prevention; customer history lookup requires phone + birth date verification; Firestore rules restrict catalog mutations to authenticated owner (`moimlali00@gmail.com`). |
| QR Code Storefront Safety | `src/components/QrCodeCard.tsx` | Always targets the public customer storefront and strips any `admin.` subdomain prefix. |
| Transitive Dependency Check | `package.json` | Audited dependencies (`bun audit`): 0 direct runtime vulnerabilities in application packages; 2 transitive advisories appear inside `firebase -> @firebase/firestore-compat -> @firebase/firestore -> @grpc/grpc-js@1.9.16` (legacy gRPC client path unused by the browser WebChannel SDK and server REST hydration). |

---

## PoC Verification

### Unauthenticated Access & Cross-Origin Request Blocked on Private Admin APIs

#### Summary
| Field | Value |
|---|---|
| Issue Type | Private Admin Access Control & Cross-Origin Mutation Guard |
| Impact | High |
| Affected File | `server.ts:149-167`, `server.ts:270-285` |
| Test Scenario | Send an unauthenticated `PUT /api/admin/settings` request and a spoofed `Origin: https://evil.example` `POST /api/orders` request. |

#### How It Was Fixed
Mutating `/api/*` endpoints verify the `Origin` header matches the active host (`APP_URL` or request host), and all `/api/admin/*` routes enforce Bearer HMAC verification, active `jti`/`tokenVersion` checks, and `owner`/`manager` RBAC role assertions.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `PUT /api/admin/settings` arrives without Bearer header | Reaches `requireOwner` -> `requireAdmin` at `server.ts:149` |
| 2 | `extractBearer(req)` returns `null` | Returns HTTP `401` `{ error: 'Admin authentication required' }` |
| 3 | `POST /api/orders` arrives with `Origin: https://evil.example` | Enters CSRF origin middleware at `server.ts:270` |
| 4 | `originHost !== requestHost` (`evil.example` mismatch) | Returns HTTP `403` `{ error: 'Cross-origin request blocked by CSRF policy' }` |

#### Conclusion
**Fix Verified** - Unauthenticated callers and cross-origin browser requests are blocked before reaching admin handlers or mutating storefront data.

---

### Brute-Force Lockout & Spoofed Image Upload Signature Rejection

#### Summary
| Field | Value |
|---|---|
| Issue Type | Credential Stuffing & Spoofed File Upload Bypass |
| Impact | High |
| Affected File | `server/security.ts:163-251`, `server.ts:795-873`, `server.ts:1990-2012` |
| Test Scenario | Submit 5 consecutive wrong passwords to `POST /api/admin/login`, and upload an HTML script payload masquerading as `image/jpeg`. |

#### How It Was Fixed
Consecutive authentication failures are tracked per IP + username via `recordLoginFailure`, locking out further login or MFA attempts for 15 minutes on the 5th failure. Uploaded images pass `hasValidImageMagicBytes` inspection after disk write, deleting any file lacking genuine JPEG, PNG, or WebP signatures.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | 5 wrong password attempts arrive at `POST /api/admin/login` | `verifyPassword` returns `false`, calling `recordLoginFailure(lockKey)` |
| 2 | Failure counter reaches `MAX_CONSECUTIVE_FAILURES` (5) | `lockedUntil` set +15 min; server returns `429` and logs `admin_login_locked` |
| 3 | Spoofed `image/jpeg` payload uploaded to `POST /api/admin/upload` | Reaches `hasValidImageMagicBytes(req.file.path, req.file.mimetype)` at `server.ts:1994` |
| 4 | Leading bytes fail `FF D8 FF` JPEG magic signature check | File unlinked via `fs.unlinkSync`, audit logged, returns HTTP `400` |

#### Conclusion
**Fix Verified** - Brute-force password/MFA guessing triggers automatic 15-minute lockouts and spoofed uploads are rejected and deleted from disk.
