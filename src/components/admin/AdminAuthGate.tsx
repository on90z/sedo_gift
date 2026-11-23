import React, { useEffect, useState } from 'react';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../../lib/firebase.ts';
import type { Language } from '../../shared/types.ts';

interface AdminAuthGateProps {
  lang: Language;
  showReturnToStore?: boolean;
  onAuthenticated: (
    token: string,
    username: string,
    adminRole?: 'owner' | 'manager',
    expiresAt?: string
  ) => void;
  onBackToStore: () => void;
}

function isStrongClientPassword(pw: string): boolean {
  return (
    pw.length >= 10 &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /\d/.test(pw) &&
    /[^A-Za-z0-9\s]/.test(pw)
  );
}

export const AdminAuthGate: React.FC<AdminAuthGateProps> = ({
  lang,
  showReturnToStore = true,
  onAuthenticated,
  onBackToStore,
}) => {
  const [statusLoading, setStatusLoading] = useState(true);
  const [requiresSetup, setRequiresSetup] = useState(false);
  const [mode, setMode] = useState<'login' | 'mfa' | 'reset'>('login');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // MFA challenge state
  const [challengeToken, setChallengeToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  // Reset password state
  const [resetMethod, setResetMethod] = useState<'google' | 'recovery'>('google');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  useEffect(() => {
    fetch('/api/admin/status')
      .then((r) => r.json())
      .then((data) => {
        setRequiresSetup(Boolean(data.requiresSetup));
      })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    if (requiresSetup) {
      if (!isStrongClientPassword(password)) {
        setErrorMsg(
          lang === 'ar'
            ? 'كلمة المرور يجب أن تكون 10 أحرف على الأقل وتحتوي على حرف كبير وصغير ورقم ورمز خاص.'
            : 'Password must be 10+ characters with uppercase, lowercase, digit, and special symbol.'
        );
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg(
          lang === 'ar' ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.'
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const endpoint = requiresSetup ? '/api/admin/setup' : '/api/admin/login';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Authentication failed');

      if (data.requiresMfa && data.challengeToken) {
        setChallengeToken(data.challengeToken);
        setPassword('');
        setMode('mfa');
        return;
      }

      onAuthenticated(data.token, data.username, data.adminRole || 'owner', data.expiresAt);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const resp = await fetch('/api/admin/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, code: mfaCode.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'MFA verification failed');
      onAuthenticated(data.token, data.username, data.adminRole || 'owner', data.expiresAt);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'MFA verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleOwnerLogin = async () => {
    setErrorMsg('');
    setInfoMsg('');
    setSubmitting(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const idToken = await cred.user.getIdToken();
      const resp = await fetch('/api/admin/google-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Google owner authentication failed');
      onAuthenticated(data.token, data.username, data.adminRole || 'owner', data.expiresAt);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    if (!isStrongClientPassword(newPassword)) {
      setErrorMsg(
        lang === 'ar'
          ? 'كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل وتحتوي على حرف كبير وصغير ورقم ورمز خاص.'
          : 'New password must be 10+ chars with uppercase, lowercase, number, and symbol.'
      );
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg(lang === 'ar' ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      let idToken: string | undefined;
      if (resetMethod === 'google') {
        const cred = await signInWithPopup(auth, googleProvider);
        idToken = await cred.user.getIdToken();
      }
      const resp = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPassword,
          idToken,
          username: resetMethod === 'recovery' ? username.trim() : undefined,
          recoveryCode: resetMethod === 'recovery' ? recoveryCode.trim() : undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Password reset failed');

      setNewPassword('');
      setConfirmNewPassword('');
      setRecoveryCode('');
      setMode('login');
      setInfoMsg(
        lang === 'ar'
          ? 'تمت إعادة تعيين كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.'
          : 'Password reset successfully. Sign in with your new password.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (statusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#5E1D2F]">
        <div className="text-sm text-white/75">
          {lang === 'ar' ? 'جاري التحقق من بوابة الإدارة الخاصة...' : 'Checking private admin portal...'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#5E1D2F] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-[#6E2438] border border-[#944A5E] p-8 space-y-6 text-white">
        <div className="space-y-2 border-b border-[#944A5E] pb-4">
          <div className="flex items-center gap-2 text-white/85">
            {mode === 'mfa' ? (
              <ShieldCheck className="w-5 h-5" />
            ) : mode === 'reset' ? (
              <KeyRound className="w-5 h-5" />
            ) : requiresSetup ? (
              <ShieldCheck className="w-5 h-5" />
            ) : (
              <Lock className="w-5 h-5" />
            )}
            <span className="text-xs font-semibold uppercase tracking-wider">SEDO Private Admin</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-white">
            {mode === 'mfa'
              ? lang === 'ar'
                ? 'التحقق الثنائي (MFA)'
                : 'Two-Factor Verification'
              : mode === 'reset'
                ? lang === 'ar'
                  ? 'إعادة تعيين كلمة مرور المالك'
                  : 'Secure Owner Password Reset'
                : requiresSetup
                  ? lang === 'ar'
                    ? 'الإعداد الأولي لحساب المالك'
                    : 'Initial Store Owner Setup'
                  : lang === 'ar'
                    ? 'دخول لوحة الإدارة الخاصة'
                    : 'Private Admin Sign In'}
          </h1>
          <p className="text-xs text-white/80 leading-relaxed">
            {mode === 'mfa'
              ? lang === 'ar'
                ? 'أدخل الرمز المكون من 6 أرقام من تطبيق المصادقة أو أحد رموز الاسترداد.'
                : 'Enter the 6-digit code from your authenticator app or a one-time recovery code.'
              : mode === 'reset'
                ? lang === 'ar'
                  ? 'تتطلب إعادة التعيين إثبات ملكية عبر حساب Google المصرح به أو رمز استرداد 2FA.'
                  : 'Resetting requires verified Google Owner authentication or an unused MFA recovery code.'
                : requiresSetup
                  ? lang === 'ar'
                    ? 'أنشئ اسم المستخدم وكلمة مرور قوية (10+ أحرف تشمل حروف كبيرة وصغيرة وأرقام ورموز).'
                    : 'Create the owner username and a strong password (10+ chars with upper, lower, digit & symbol).'
                  : lang === 'ar'
                    ? 'بوابة خاصة ومحمية لإدارة طلبات وأسعار وولاء متجر سيدو.'
                    : 'Protected private portal for SEDO store administration.'}
          </p>
        </div>

        {infoMsg && (
          <div className="border border-white/60 bg-[#0E0A0C] px-4 py-3 text-xs text-white">
            {infoMsg}
          </div>
        )}

        {errorMsg && (
          <div className="border border-[#944A5E] bg-[#0E0A0C] px-4 py-3 text-xs text-white">
            {errorMsg}
          </div>
        )}

        {mode === 'mfa' ? (
          <form onSubmit={handleVerifyMfa} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="adm-mfa" className="block text-xs font-medium text-white">
                {lang === 'ar' ? 'رمز المصادقة (6 أرقام) أو رمز الاسترداد' : '6-digit Code or Recovery Code'}
              </label>
              <input
                id="adm-mfa"
                required
                dir="ltr"
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="123456 or A1B2-C3D4"
                className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 text-sm tracking-wider tabular-nums-en focus:outline-none focus:border-white"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-[#0E0A0C] border border-[#944A5E] text-white text-sm font-medium hover:bg-[#1E1418] disabled:opacity-60 transition-colors"
            >
              {submitting ? '...' : lang === 'ar' ? 'تحقق ودخول' : 'Verify & Sign In'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setChallengeToken('');
                setMfaCode('');
              }}
              className="w-full py-2 text-xs text-white/75 hover:text-white"
            >
              {lang === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to Sign In'}
            </button>
          </form>
        ) : mode === 'reset' ? (
          <form onSubmit={handlePasswordReset} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setResetMethod('google')}
                className={`py-2 border font-medium ${
                  resetMethod === 'google'
                    ? 'bg-[#0E0A0C] border-white text-white'
                    : 'bg-[#461221] border-[#944A5E] text-white/75'
                }`}
              >
                {lang === 'ar' ? 'عبر Google المالك' : 'Google Owner'}
              </button>
              <button
                type="button"
                onClick={() => setResetMethod('recovery')}
                className={`py-2 border font-medium ${
                  resetMethod === 'recovery'
                    ? 'bg-[#0E0A0C] border-white text-white'
                    : 'bg-[#461221] border-[#944A5E] text-white/75'
                }`}
              >
                {lang === 'ar' ? 'رمز استرداد 2FA' : 'MFA Recovery Code'}
              </button>
            </div>

            {resetMethod === 'recovery' && (
              <div className="space-y-3">
                <input
                  required
                  dir="ltr"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Owner Username"
                  className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white"
                />
                <input
                  required
                  dir="ltr"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="Recovery Code (e.g. A1B2-C3D4)"
                  className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white"
                />
              </div>
            )}

            <input
              required
              type="password"
              dir="ltr"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={lang === 'ar' ? 'كلمة مرور جديدة قوية (10+ أحرف)' : 'New Strong Password (10+ chars)'}
              className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white"
            />
            <input
              required
              type="password"
              dir="ltr"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder={lang === 'ar' ? 'تأكيد كلمة المرور الجديدة' : 'Confirm New Password'}
              className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white"
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-[#0E0A0C] border border-[#944A5E] text-white text-sm font-medium hover:bg-[#1E1418] disabled:opacity-60"
            >
              {submitting
                ? '...'
                : resetMethod === 'google'
                  ? lang === 'ar'
                    ? 'تأكيد Google وتعيين كلمة المرور'
                    : 'Verify Google & Reset Password'
                  : lang === 'ar'
                    ? 'إعادة تعيين كلمة المرور'
                    : 'Reset Password'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg('');
              }}
              className="w-full py-2 text-xs text-white/75 hover:text-white"
            >
              {lang === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="adm-user" className="block text-xs font-medium text-white">
                {lang === 'ar' ? 'اسم المستخدم' : 'Username'}
              </label>
              <input
                id="adm-user"
                required
                type="text"
                dir="ltr"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="sedo_owner"
                className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 text-sm focus:outline-none focus:border-white"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="adm-pass" className="block text-xs font-medium text-white">
                {lang === 'ar' ? 'كلمة المرور' : 'Password'}
              </label>
              <input
                id="adm-pass"
                required
                type="password"
                dir="ltr"
                autoComplete={requiresSetup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 text-sm focus:outline-none focus:border-white"
              />
            </div>

            {requiresSetup && (
              <div className="space-y-1.5">
                <label htmlFor="adm-confirm" className="block text-xs font-medium text-white">
                  {lang === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm Password'}
                </label>
                <input
                  id="adm-confirm"
                  required
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="w-full px-3.5 py-2.5 border border-[#944A5E] bg-[#461221] text-white placeholder:text-white/45 text-sm focus:outline-none focus:border-white"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-[#0E0A0C] border border-[#944A5E] text-white text-sm font-medium hover:bg-[#1E1418] disabled:opacity-60 transition-colors"
            >
              {submitting
                ? '...'
                : requiresSetup
                  ? lang === 'ar'
                    ? 'إنشاء حساب المالك والدخول'
                    : 'Create Owner Account & Enter'
                  : lang === 'ar'
                    ? 'تسجيل الدخول'
                    : 'Sign In'}
            </button>
          </form>
        )}

        {mode === 'login' && (
          <div className="pt-4 border-t border-[#944A5E] space-y-2">
            <button
              type="button"
              disabled={submitting}
              onClick={handleGoogleOwnerLogin}
              className="w-full py-2.5 border border-[#944A5E] bg-[#461221] text-xs font-medium text-white hover:border-white transition-colors"
            >
              {lang === 'ar' ? 'دخول المالك عبر Google' : 'Owner Sign In with Google'}
            </button>
            {!requiresSetup && (
              <button
                type="button"
                onClick={() => {
                  setMode('reset');
                  setErrorMsg('');
                }}
                className="w-full py-1.5 text-xs text-white/80 hover:text-white underline"
              >
                {lang === 'ar' ? 'نسيت كلمة المرور؟ إعادة تعيين آمنة' : 'Forgot password? Secure Owner Reset'}
              </button>
            )}
            {showReturnToStore && (
              <button
                type="button"
                onClick={onBackToStore}
                className="w-full py-2 text-xs text-white/75 hover:text-white transition-colors"
              >
                {lang === 'ar' ? 'العودة إلى متجر SEDO' : 'Return to Storefront'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
