import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  KeyRound,
  Lock,
  LogOut,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { apiUrl, sanitizeHttpOrigin } from '../../lib/api.ts';
import type { AdminPermission, Language } from '../../shared/types.ts';

const PERMISSION_LABELS: Array<{
  id: AdminPermission;
  labelAr: string;
  labelEn: string;
}> = [
  { id: 'orders', labelAr: 'الطلبات', labelEn: 'Orders' },
  { id: 'products', labelAr: 'المنتجات والأسعار', labelEn: 'Products' },
  { id: 'loyalty', labelAr: 'الولاء والأختام', labelEn: 'Loyalty' },
  { id: 'customers', labelAr: 'العملاء والميلاد', labelEn: 'Customers' },
  { id: 'notifications', labelAr: 'الإشعارات والقرب', labelEn: 'Notifications' },
];

interface TeamUserView {
  id: string;
  username: string;
  role: 'manager';
  permissions?: AdminPermission[];
  createdBy: string;
  createdAt: string;
}

interface SecurityStatePayload {
  username: string;
  adminRole: 'owner' | 'manager';
  mfaEnabled: boolean;
  recoveryCodesRemaining: number;
  passwordUpdatedAt: string | null;
  ownerUsername: string | null;
  teamUsers: TeamUserView[];
}

interface AdminSecurityPanelProps {
  lang: Language;
  adminToken: string;
  onTokenRotated: (newToken: string, expiresAt?: string) => void;
  onSignedOutAll: () => void;
}

export const AdminSecurityPanel: React.FC<AdminSecurityPanelProps> = ({
  lang,
  adminToken,
  onTokenRotated,
  onSignedOutAll,
}) => {
  const [sec, setSec] = useState<SecurityStatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string>('');

  // MFA Setup State
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaQrUrl, setMfaQrUrl] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disablePw, setDisablePw] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisableMfa, setShowDisableMfa] = useState(false);

  // Change Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [pwTotpCode, setPwTotpCode] = useState('');

  // RBAC Team State
  const [teamUsername, setTeamUsername] = useState('');
  const [teamPassword, setTeamPassword] = useState('');
  const [teamPermissions, setTeamPermissions] = useState<AdminPermission[]>([
    'orders',
    'products',
    'loyalty',
  ]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const isAdminSubdomain =
    typeof window !== 'undefined' && window.location.hostname.toLowerCase().startsWith('admin.');
  const envPublicSiteUrl = sanitizeHttpOrigin(import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined);
  const publicCustomerUrl = envPublicSiteUrl
    ? `${envPublicSiteUrl}/`
    : isAdminSubdomain
      ? `${window.location.protocol}//${window.location.hostname.replace(/^admin\./i, '')}${window.location.port ? `:${window.location.port}` : ''}/`
      : `${origin}/`;
  const privateAdminUrl = isAdminSubdomain ? `${origin}/` : `${origin}/admin`;

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(apiUrl('/api/admin/security'), {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (resp.ok) {
        setSec(await resp.json());
      }
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  const handleCopy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(label);
      setTimeout(() => setCopiedUrl(''), 2000);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handleBeginMfa = async () => {
    setErrorMsg('');
    setFeedback('');
    setRecoveryCodes([]);
    const resp = await fetch(apiUrl('/api/admin/security/mfa/begin'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Could not start MFA setup');
      return;
    }
    setMfaSecret(data.secret);
    const qr = await QRCode.toDataURL(data.otpauthUri, { width: 220, margin: 2 });
    setMfaQrUrl(qr);
  };

  const handleConfirmMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setFeedback('');
    const resp = await fetch(apiUrl('/api/admin/security/mfa/confirm'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ code: mfaCode.trim() }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Verification failed');
      return;
    }
    setMfaSecret('');
    setMfaQrUrl('');
    setMfaCode('');
    setRecoveryCodes(data.recoveryCodes || []);
    setFeedback(
      lang === 'ar'
        ? 'تم تفعيل المصادقة الثنائية (2FA) بنجاح! احفظ رموز الاسترداد أدناه في مكان آمن.'
        : 'Two-Factor Authentication (2FA) enabled! Save your recovery codes below securely.'
    );
    await loadSecurity();
  };

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setFeedback('');
    const resp = await fetch(apiUrl('/api/admin/security/mfa/disable'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ password: disablePw, code: disableCode.trim() }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Could not disable MFA');
      return;
    }
    setShowDisableMfa(false);
    setDisablePw('');
    setDisableCode('');
    setFeedback(lang === 'ar' ? 'تم إيقاف المصادقة الثنائية.' : 'MFA disabled.');
    await loadSecurity();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setFeedback('');
    if (newPassword !== confirmNewPassword) {
      setErrorMsg(lang === 'ar' ? 'كلمتا المرور غير متطابقتين.' : 'New passwords do not match.');
      return;
    }
    const resp = await fetch(apiUrl('/api/admin/security/change-password'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        currentPassword,
        newPassword,
        totpCode: pwTotpCode.trim() || undefined,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Password change failed');
      return;
    }
    if (data.token) {
      onTokenRotated(data.token, data.expiresAt);
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPwTotpCode('');
    setFeedback(
      lang === 'ar'
        ? 'تم تحديث كلمة المرور وتجديد جلسة الأمان وإلغاء الجلسات القديمة.'
        : 'Password updated, security token rotated, and previous sessions invalidated.'
    );
    await loadSecurity();
  };

  const handleRevokeAll = async () => {
    setErrorMsg('');
    const resp = await fetch(apiUrl('/api/admin/security/revoke-all'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (resp.ok) {
      onSignedOutAll();
    }
  };

  const handleToggleNewPerm = (perm: AdminPermission) => {
    setTeamPermissions((prev) =>
      prev.includes(perm)
        ? prev.length > 1
          ? prev.filter((p) => p !== perm)
          : prev
        : [...prev, perm]
    );
  };

  const handleAddManager = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setFeedback('');
    const resp = await fetch(apiUrl('/api/admin/security/team'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: teamUsername.trim(),
        password: teamPassword,
        permissions: teamPermissions,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Could not create manager account');
      return;
    }
    setTeamUsername('');
    setTeamPassword('');
    setTeamPermissions(['orders', 'products', 'loyalty']);
    setFeedback(
      lang === 'ar' ? 'تم إنشاء حساب مدير تشغيل بصلاحيات محدودة.' : 'Manager account created.'
    );
    await loadSecurity();
  };

  const handleToggleExistingManagerPerm = async (user: TeamUserView, perm: AdminPermission) => {
    const current = user.permissions && user.permissions.length > 0 ? user.permissions : ['orders', 'products', 'loyalty', 'customers', 'notifications'] as AdminPermission[];
    const next = current.includes(perm)
      ? current.filter((p) => p !== perm)
      : [...current, perm];
    if (next.length === 0) {
      setErrorMsg(
        lang === 'ar' ? 'يجب الإبقاء على صلاحية واحدة على الأقل.' : 'At least one permission must remain enabled.'
      );
      return;
    }
    setErrorMsg('');
    setFeedback('');
    const resp = await fetch(apiUrl(`/api/admin/security/team/${user.id}`), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ permissions: next }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setErrorMsg(data.error || 'Could not update manager permissions');
      return;
    }
    setFeedback(lang === 'ar' ? 'تم تحديث صلاحيات المدير بنجاح.' : 'Manager permissions updated.');
    await loadSecurity();
  };

  const handleDeleteManager = async (userId: string) => {
    setErrorMsg('');
    const resp = await fetch(apiUrl(`/api/admin/security/team/${userId}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (resp.ok) {
      await loadSecurity();
    }
  };

  if (loading && !sec) {
    return (
      <div className="py-8 text-xs text-white/75">
        {lang === 'ar' ? 'جاري تحميل إعدادات الأمان...' : 'Loading security controls...'}
      </div>
    );
  }

  const isOwner = (sec?.adminRole ?? 'owner') === 'owner';

  return (
    <div className="space-y-8 text-white">
      {feedback && (
        <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div className="border border-white/70 bg-[#0E0A0C] px-4 py-3 text-xs text-white">
          {errorMsg}
        </div>
      )}

      {/* 1. Separate Public vs Private URLs */}
      <div className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#944A5E] pb-3">
          <ShieldCheck className="w-5 h-5 text-white" />
          <h3 className="text-base font-semibold">
            {lang === 'ar'
              ? 'روابط الوصول المنفصلة (متجر العملاء vs الإدارة الخاصة)'
              : 'Separated Access Links (Public Storefront vs Private Admin)'}
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="border border-[#944A5E] bg-[#461221] p-4 space-y-2">
            <div className="font-bold text-white">
              {lang === 'ar' ? 'رابط المتجر العام للعملاء (للنشر والتسويق)' : 'Public Customer Website URL'}
            </div>
            <p className="text-white/75">
              {lang === 'ar'
                ? 'لا يحتوي على أي أزرار أو روابط للوحة الإدارة. مناسب للنشر على إنستغرام ورمز QR.'
                : 'Contains zero admin links or management controls. Safe to publish on Instagram and QR codes.'}
            </p>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="flex-1 px-2.5 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white truncate tabular-nums-en"
              >
                {publicCustomerUrl}
              </code>
              <button
                type="button"
                onClick={() => handleCopy('public', publicCustomerUrl)}
                className="inline-flex items-center gap-1 px-3 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white hover:border-white shrink-0"
              >
                {copiedUrl === 'public' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUrl === 'public' ? (lang === 'ar' ? 'تم' : 'Copied') : lang === 'ar' ? 'نسخ' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div className="border border-[#944A5E] bg-[#461221] p-4 space-y-2">
            <div className="font-bold text-white">
              {lang === 'ar' ? 'رابط لوحة الإدارة الخاصة (للمالك فقط)' : 'Private Admin Dashboard URL'}
            </div>
            <p className="text-white/75">
              {lang === 'ar'
                ? 'محمي بتسجيل الدخول والمصادقة الثنائية وانتهاء الجلسة التلقائي وفحص الصلاحيات.'
                : 'Protected by server authentication, 2FA, session expiry, brute-force lockout, and role checks.'}
            </p>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="flex-1 px-2.5 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white truncate tabular-nums-en"
              >
                {privateAdminUrl}
              </code>
              <button
                type="button"
                onClick={() => handleCopy('admin', privateAdminUrl)}
                className="inline-flex items-center gap-1 px-3 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white hover:border-white shrink-0"
              >
                {copiedUrl === 'admin' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedUrl === 'admin' ? (lang === 'ar' ? 'تم' : 'Copied') : lang === 'ar' ? 'نسخ' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Multi-Factor Authentication (2FA / TOTP) */}
      {isOwner && (
        <div className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#944A5E] pb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-white" />
              <h3 className="text-base font-semibold">
                {lang === 'ar' ? 'المصادقة الثنائية (MFA / Google Authenticator)' : 'Multi-Factor Authentication (TOTP 2FA)'}
              </h3>
            </div>
            <span
              className={`px-3 py-1 text-xs font-semibold border ${
                sec?.mfaEnabled ? 'bg-[#0E0A0C] border-white text-white' : 'bg-[#461221] border-[#944A5E] text-white/80'
              }`}
            >
              {sec?.mfaEnabled
                ? lang === 'ar'
                  ? `مفعّلة (${sec.recoveryCodesRemaining} رموز استرداد متبقية)`
                  : `Enabled (${sec.recoveryCodesRemaining} recovery codes left)`
                : lang === 'ar'
                  ? 'غير مفعّلة'
                  : 'Not Enabled'}
            </span>
          </div>

          {!sec?.mfaEnabled && !mfaQrUrl && (
            <div className="space-y-3 text-xs">
              <p className="text-white/80">
                {lang === 'ar'
                  ? 'اربط تطبيق المصادقة (Google Authenticator أو 1Password أو Apple Passwords) لحماية الدخول برمز مؤقت من 6 أرقام.'
                  : 'Bind an Authenticator App (Google Authenticator, Apple Passwords, 1Password) to require a 6-digit TOTP code on every login.'}
              </p>
              <button
                type="button"
                onClick={handleBeginMfa}
                className="px-5 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:border-white transition-colors"
              >
                {lang === 'ar' ? 'إعداد وتفعيل المصادقة الثنائية' : 'Set Up 2FA Authenticator'}
              </button>
            </div>
          )}

          {mfaQrUrl && (
            <form onSubmit={handleConfirmMfa} className="border border-[#944A5E] bg-[#461221] p-4 space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
                <div className="md:col-span-4 flex justify-center">
                  <div className="p-2 bg-white border border-[#944A5E]">
                    <img src={mfaQrUrl} alt="MFA QR Code" className="w-40 h-40" />
                  </div>
                </div>
                <div className="md:col-span-8 space-y-3">
                  <div className="font-semibold text-white">
                    {lang === 'ar'
                      ? '1. امسح رمز QR بتطبيق المصادقة أو أدخل المفتاح يدوياً:'
                      : '1. Scan QR code in your Authenticator app or enter secret key:'}
                  </div>
                  <code dir="ltr" className="block px-3 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white break-all">
                    {mfaSecret}
                  </code>
                  <div className="font-semibold text-white">
                    {lang === 'ar' ? '2. أدخل الرمز المكون من 6 أرقام للتأكيد:' : '2. Enter the 6-digit verification code:'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      required
                      dir="ltr"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      className="w-40 px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white text-sm tracking-widest tabular-nums-en"
                    />
                    <button
                      type="submit"
                      className="px-5 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:border-white"
                    >
                      {lang === 'ar' ? 'تأكيد وتفعيل 2FA' : 'Verify & Enable 2FA'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMfaQrUrl('');
                        setMfaSecret('');
                      }}
                      className="px-4 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    >
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}

          {recoveryCodes.length > 0 && (
            <div className="border border-white bg-[#0E0A0C] p-4 space-y-3 text-xs">
              <div className="flex items-center gap-2 font-bold text-white">
                <ShieldAlert className="w-4 h-4" />
                <span>
                  {lang === 'ar'
                    ? 'رموز الاسترداد لمرة واحدة — احفظها الآن ولن تظهر مرة أخرى:'
                    : 'One-Time Recovery Codes — Save these now; they will not be shown again:'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" dir="ltr">
                {recoveryCodes.map((c) => (
                  <code key={c} className="px-3 py-2 bg-[#461221] border border-[#944A5E] text-center font-bold">
                    {c}
                  </code>
                ))}
              </div>
              <button
                type="button"
                onClick={() => handleCopy('recovery', recoveryCodes.join('\n'))}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-[#944A5E] bg-[#461221] text-white hover:border-white"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedUrl === 'recovery' ? (lang === 'ar' ? 'تم النسخ' : 'Copied') : lang === 'ar' ? 'نسخ الرموز' : 'Copy All Codes'}</span>
              </button>
            </div>
          )}

          {sec?.mfaEnabled && (
            <div className="space-y-3 text-xs">
              {!showDisableMfa ? (
                <button
                  type="button"
                  onClick={() => setShowDisableMfa(true)}
                  className="px-4 py-2 border border-[#944A5E] bg-[#461221] text-white hover:border-white"
                >
                  {lang === 'ar' ? 'تعطيل المصادقة الثنائية' : 'Disable 2FA'}
                </button>
              ) : (
                <form onSubmit={handleDisableMfa} className="border border-[#944A5E] bg-[#461221] p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    required
                    type="password"
                    dir="ltr"
                    value={disablePw}
                    onChange={(e) => setDisablePw(e.target.value)}
                    placeholder={lang === 'ar' ? 'كلمة المرور الحالية' : 'Current Password'}
                    className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                  />
                  <input
                    required
                    dir="ltr"
                    maxLength={6}
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                    placeholder={lang === 'ar' ? 'رمز التوثيق (6 أرقام)' : '6-digit MFA code'}
                    className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white tabular-nums-en"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium"
                    >
                      {lang === 'ar' ? 'تأكيد التعطيل' : 'Confirm Disable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDisableMfa(false)}
                      className="px-3 py-2 border border-[#944A5E] bg-[#5E1D2F] text-white"
                    >
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. Password Rotation & Session Revocation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleChangePassword} className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-4 text-xs">
          <div className="flex items-center gap-2 border-b border-[#944A5E] pb-3">
            <KeyRound className="w-4 h-4 text-white" />
            <h3 className="text-base font-semibold">
              {lang === 'ar' ? 'تغيير كلمة المرور القوية' : 'Change Strong Password'}
            </h3>
          </div>
          <p className="text-white/75">
            {lang === 'ar'
              ? 'الحد الأدنى 10 أحرف، تتضمن حرفاً كبيراً وصغيراً ورقماً ورمزاً خاصاً.'
              : 'Minimum 10 characters with uppercase, lowercase, number, and symbol.'}
          </p>
          <div className="space-y-2.5">
            <input
              required
              type="password"
              dir="ltr"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={lang === 'ar' ? 'كلمة المرور الحالية' : 'Current Password'}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            />
            <input
              required
              type="password"
              dir="ltr"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={lang === 'ar' ? 'كلمة المرور الجديدة القوية' : 'New Strong Password'}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            />
            <input
              required
              type="password"
              dir="ltr"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder={lang === 'ar' ? 'تأكيد كلمة المرور الجديدة' : 'Confirm New Password'}
              className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
            />
            {sec?.mfaEnabled && isOwner && (
              <input
                required
                dir="ltr"
                maxLength={6}
                value={pwTotpCode}
                onChange={(e) => setPwTotpCode(e.target.value)}
                placeholder={lang === 'ar' ? 'رمز المصادقة الثنائية (6 أرقام)' : '6-digit MFA Code'}
                className="w-full px-3 py-2 border border-[#944A5E] bg-[#461221] text-white tabular-nums-en"
              />
            )}
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:border-white"
          >
            {lang === 'ar' ? 'تحديث كلمة المرور' : 'Update Password'}
          </button>
        </form>

        <div className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-4 text-xs">
          <div className="flex items-center gap-2 border-b border-[#944A5E] pb-3">
            <Lock className="w-4 h-4 text-white" />
            <h3 className="text-base font-semibold">
              {lang === 'ar' ? 'الجلسات النشطة والتحكم بالوصول' : 'Active Sessions & Role Access'}
            </h3>
          </div>
          <div className="space-y-2 text-white/85">
            <div>
              <strong>{lang === 'ar' ? 'الحساب الحالي:' : 'Signed-in Account:'}</strong>{' '}
              <span dir="ltr">{sec?.username}</span> ({sec?.adminRole?.toUpperCase()})
            </div>
            <div>
              <strong>{lang === 'ar' ? 'انتهاء الجلسة التلقائي:' : 'Automatic Session Expiry:'}</strong>{' '}
              {lang === 'ar' ? 'ساعتان كحد أقصى أو 30 دقيقة خمول' : '2h token lifetime / 30m idle timeout'}
            </div>
            {sec?.passwordUpdatedAt && (
              <div>
                <strong>{lang === 'ar' ? 'آخر تحديث لكلمة المرور:' : 'Password Last Updated:'}</strong>{' '}
                <span dir="ltr" className="tabular-nums-en">
                  {new Date(sec.passwordUpdatedAt).toLocaleString('en-US')}
                </span>
              </div>
            )}
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={handleRevokeAll}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:border-white"
            >
              <LogOut className="w-4 h-4" />
              <span>
                {lang === 'ar'
                  ? 'إنهاء جميع الجلسات المفتوحة على كافة الأجهزة'
                  : 'Revoke All Active Sessions Everywhere'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 4. Role-Based Access Control (RBAC) — Owner can add/remove Managers */}
      {isOwner && (
        <div className="border border-[#944A5E] bg-[#6E2438] p-6 space-y-4 text-xs">
          <div className="flex items-center gap-2 border-b border-[#944A5E] pb-3">
            <UserPlus className="w-4 h-4 text-white" />
            <h3 className="text-base font-semibold">
              {lang === 'ar'
                ? 'صلاحيات الفريق (RBAC) — حسابات مديري التشغيل'
                : 'Role-Based Access Control (Store Manager Accounts)'}
            </h3>
          </div>
          <p className="text-white/75">
            {lang === 'ar'
              ? 'يمكن للمالك (Owner) فقط تعديل الأمان والنسخ الاحتياطي وإعدادات الموقع، بينما يدير حساب المدير (Manager) الطلبات والمنتجات والولاء.'
              : 'Only the Owner role can manage security, MFA, backups, and global site settings; Manager accounts operate orders, products, and loyalty.'}
          </p>

          <form onSubmit={handleAddManager} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                required
                dir="ltr"
                value={teamUsername}
                onChange={(e) => setTeamUsername(e.target.value)}
                placeholder={lang === 'ar' ? 'اسم المستخدم للمدير' : 'Manager Username'}
                className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
              />
              <input
                required
                type="password"
                dir="ltr"
                value={teamPassword}
                onChange={(e) => setTeamPassword(e.target.value)}
                placeholder={lang === 'ar' ? 'كلمة مرور قوية (10+ أحرف)' : 'Strong Password (10+ chars)'}
                className="px-3 py-2 border border-[#944A5E] bg-[#461221] text-white"
              />
              <button
                type="submit"
                className="px-5 py-2 bg-[#0E0A0C] border border-[#944A5E] text-white font-medium hover:border-white"
              >
                {lang === 'ar' ? 'إضافة حساب مدير' : 'Create Manager Account'}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <span className="text-white/80 font-medium">
                {lang === 'ar' ? 'الصلاحيات الممنوحة:' : 'Granted Permissions:'}
              </span>
              {PERMISSION_LABELS.map((perm) => (
                <label key={perm.id} className="inline-flex items-center gap-1.5 cursor-pointer text-white">
                  <input
                    type="checkbox"
                    checked={teamPermissions.includes(perm.id)}
                    onChange={() => handleToggleNewPerm(perm.id)}
                    className="accent-[#0E0A0C]"
                  />
                  <span>{lang === 'ar' ? perm.labelAr : perm.labelEn}</span>
                </label>
              ))}
            </div>
          </form>

          {sec?.teamUsers && sec.teamUsers.length > 0 && (
            <div className="border border-[#944A5E] divide-y divide-[#944A5E] bg-[#461221]">
              {sec.teamUsers.map((u) => {
                const userPerms =
                  u.permissions && u.permissions.length > 0
                    ? u.permissions
                    : (['orders', 'products', 'loyalty', 'customers', 'notifications'] as AdminPermission[]);
                return (
                  <div key={u.id} className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="font-bold text-white" dir="ltr">
                          {u.username}
                        </span>{' '}
                        <span className="text-white/70">· Role: MANAGER</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteManager(u.id)}
                        aria-label={`Remove ${u.username}`}
                        className="p-1.5 border border-[#944A5E] bg-[#5E1D2F] text-white hover:border-white"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[11px]">
                      {PERMISSION_LABELS.map((perm) => (
                        <label key={perm.id} className="inline-flex items-center gap-1.5 cursor-pointer text-white/90">
                          <input
                            type="checkbox"
                            checked={userPerms.includes(perm.id)}
                            onChange={() => void handleToggleExistingManagerPerm(u, perm.id)}
                            className="accent-[#0E0A0C]"
                          />
                          <span>{lang === 'ar' ? perm.labelAr : perm.labelEn}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
