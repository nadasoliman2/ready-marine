'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Mail,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';
import ProfileHeaderBar from './ProfileHeaderBar';
import OtpInput from '../verification/OtpInput';
import { useRouter } from '../../lib/navigation';

export default function VerifyEmailChangeView({
  profile,
  user,
  onConfirmEmailCode,
  onResendEmailCode,
  onCancelPendingEmail,
  isAr = true,
}) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [success, setSuccess] = useState(false);

  // 120-second countdown for resending
  const [timeLeft, setTimeLeft] = useState(120);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  const pendingEmail = profile?.pending_email || '';

  // If there is no pending email (e.g. already verified or cancelled), redirect back to profile
  useEffect(() => {
    if (!profile?.pending_email && !success) {
      const t = setTimeout(() => {
        router.push('/profile');
      }, 300);
      return () => clearTimeout(t);
    }
  }, [profile?.pending_email, success, router]);

  const handleVerify = async (submittedCode) => {
    const finalCode = String(submittedCode ?? code).trim();
    if (finalCode.length !== 6) return;

    setVerifying(true);
    setErrorMsg('');
    const ok = await onConfirmEmailCode?.(finalCode);
    setVerifying(false);

    if (ok) {
      setSuccess(true);
      setTimeout(() => {
        router.push('/profile');
      }, 1500);
    } else {
      setErrorMsg(isAr ? 'رمز التحقق غير صحيح أو انتهت صلاحيته' : 'Invalid or expired verification code');
    }
  };

  const handleResend = async () => {
    if (timeLeft > 0 || resending) return;
    setResending(true);
    setErrorMsg('');
    const ok = await onResendEmailCode?.();
    setResending(false);
    if (ok) {
      setTimeLeft(120);
      setCode('');
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    setErrorMsg('');
    await onCancelPendingEmail?.();
    setCancelling(false);
    router.push('/profile?view=setting-personal-info');
  };

  const formatTimer = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Bar */}
      <ProfileHeaderBar
        title={isAr ? 'تأكيد البريد الإلكتروني' : 'Verify Email Address'}
        subtitle={isAr ? 'تأكيد ملكية بريدك الجديد' : 'Confirm ownership of your new email'}
        backHref="/profile?view=setting-personal-info"
        isAr={isAr}
      />

      {/* Main Dedicated Verification Card */}
      <div className="max-w-lg mx-auto bg-white border border-zinc-200/90 rounded-3xl p-6 sm:p-9 shadow-pod text-center space-y-6 relative overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="absolute -top-16 inset-x-0 h-32 bg-gradient-to-b from-marine-mist/80 to-transparent pointer-events-none" />

        {success ? (
          /* Success Screen */
          <div className="py-8 space-y-4 animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 size={44} />
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-zinc-900">
              {isAr ? 'تم تأكيد البريد بنجاح!' : 'Email Verified Successfully!'}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-500">
              {isAr
                ? 'تم تحديث واعتماد بريدك الإلكتروني الجديد. جاري تحويلك إلى لوحة التحكم...'
                : 'Your email has been confirmed. Redirecting you to your account...'}
            </p>
          </div>
        ) : (
          /* Verification Form */
          <>
            {/* Header Icon & Intro */}
            <div className="space-y-3 relative z-10">
              <div className="w-20 h-20 rounded-3xl bg-marine-mist border border-marine-cyan/20 text-marine-primary flex items-center justify-center mx-auto shadow-xs">
                <Mail size={38} className="animate-pulse" />
              </div>

              <h2 className="text-xl sm:text-2xl font-black text-zinc-900 tracking-tight">
                {isAr ? 'تحقق من صندوق الوارد' : 'Check Your Inbox'}
              </h2>

              <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed max-w-sm mx-auto">
                {isAr
                  ? 'أرسلنا رمز تحقق مكوناً من 6 أرقام إلى بريدك الإلكتروني الجديد:'
                  : 'We sent a 6-digit confirmation code to your new email address:'}
              </p>

              {/* Destination Pill */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-zinc-100 text-zinc-900 border border-zinc-200 font-mono font-bold text-xs sm:text-sm dir-ltr shadow-2xs">
                <Mail size={15} className="text-marine-primary shrink-0" />
                <span className="truncate max-w-[260px]">{pendingEmail}</span>
              </div>

              <p className="text-[11px] text-zinc-400">
                {isAr
                  ? '(إذا لم تجد الرسالة، يرجى فحص مجلد الرسائل غير المرغوبة Spam)'
                  : '(If you do not see it, please check your Spam or Junk folder)'}
              </p>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-bold flex items-center justify-center gap-2 animate-in fade-in">
                <AlertCircle size={15} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* 6-Digit OTP Boxes */}
            <div className="py-2">
              <OtpInput
                variant="light"
                value={code}
                onChange={(val) => {
                  setCode(val);
                  if (errorMsg) setErrorMsg('');
                }}
                onComplete={(completedCode) => handleVerify(completedCode)}
                disabled={verifying}
                autoFocus
              />
            </div>

            {/* Resend Timer & Action */}
            <div className="text-xs text-zinc-500 flex items-center justify-center gap-1.5">
              {timeLeft > 0 ? (
                <span className="font-medium text-zinc-500">
                  {isAr ? 'يمكنك إعادة إرسال الرمز خلال' : 'Resend available in'}{' '}
                  <span className="font-mono font-bold text-marine-primary">
                    {formatTimer(timeLeft)}
                  </span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="text-marine-primary hover:text-marine-cyan font-bold transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {resending && <Loader2 size={13} className="animate-spin" />}
                  <span>{isAr ? 'لم يصلك الرمز؟ إعادة الإرسال الآن' : 'Did not receive code? Resend now'}</span>
                </button>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={() => handleVerify()}
                disabled={verifying || code.trim().length !== 6}
                className="w-full bg-marine-primary hover:bg-marine-navy disabled:opacity-50 text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-pod flex items-center justify-center gap-2 text-sm"
              >
                {verifying ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={18} />}
                <span>{isAr ? 'تأكيد واعتماد البريد' : 'Confirm New Email'}</span>
              </button>

              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full text-zinc-500 hover:text-rose-600 font-bold py-2.5 text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                {cancelling ? <Loader2 size={13} className="animate-spin" /> : <X size={14} />}
                <span>{isAr ? 'إلغاء التغيير والرجوع للبيانات' : 'Cancel change and return'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
