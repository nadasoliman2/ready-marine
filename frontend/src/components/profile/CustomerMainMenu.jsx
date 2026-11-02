'use client';

import { useState } from 'react';
import {
  Settings as SettingsIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Package,
  History,
  Sparkles,
  Wallet,
  Users,
  UserPlus,
  MapPin,
  RotateCcw,
  Building2,
  ShieldCheck,
  FileText,
  Truck,
  LifeBuoy,
  Mail,
  LogOut,
  User,
  Heart,
  CreditCard,
  Award,
  ArrowLeft,
  ArrowRight,
  Clock,
  CheckCircle2,
  PhoneCall,
  ExternalLink,
  Camera,
  Loader2,
} from 'lucide-react';
import Link from '../LocaleLink';
import { resolveAssetUrl } from '../../lib/assets';
import { getOrderStatusLabel, getOrderStatusColor } from '../../lib/orderStatus';
import { orgTerms } from '../../lib/orgTerms';
import { walletCopy } from '../../lib/walletLocalization';
import { loyaltyCopy } from '../../lib/loyaltyLocalization';
import { familyCopy } from '../../lib/familyLocalization';
import { friendCopy } from '../../lib/friendLocalization';

// Helper: Calculate loyalty tier, remaining points and progress percentage
function getLoyaltyTierInfo(points = 0, isAr = true) {
  const pts = Number(points) || 0;

  if (pts >= 3000) {
    return {
      tierName: isAr ? 'المستوى البلاتيني' : 'Platinum Tier',
      tierBadge: isAr ? 'بلاتيني' : 'Platinum',
      nextTierName: null,
      targetPoints: 3000,
      remainingPoints: 0,
      progressPercent: 100,
      isMaxTier: true,
      badgeColor: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40',
    };
  }
  if (pts >= 1500) {
    const remaining = 3000 - pts;
    const progress = Math.min(100, Math.round(((pts - 1500) / 1500) * 100));
    return {
      tierName: isAr ? 'المستوى الذهبي' : 'Gold Tier',
      tierBadge: isAr ? 'ذهبي' : 'Gold',
      nextTierName: isAr ? 'المستوى البلاتيني' : 'Platinum Tier',
      targetPoints: 3000,
      remainingPoints: remaining,
      progressPercent: progress,
      isMaxTier: false,
      badgeColor: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
    };
  }
  if (pts >= 500) {
    const remaining = 1500 - pts;
    const progress = Math.min(100, Math.round(((pts - 500) / 1000) * 100));
    return {
      tierName: isAr ? 'المستوى الفضي' : 'Silver Tier',
      tierBadge: isAr ? 'فضي' : 'Silver',
      nextTierName: isAr ? 'المستوى الذهبي' : 'Gold Tier',
      targetPoints: 1500,
      remainingPoints: remaining,
      progressPercent: progress,
      isMaxTier: false,
      badgeColor: 'bg-slate-300/20 text-slate-100 border-slate-300/40',
    };
  }
  // Bronze tier (< 500)
  const remaining = 500 - pts;
  const progress = Math.min(100, Math.round((pts / 500) * 100));
  return {
    tierName: isAr ? 'المستوى البرونزي' : 'Bronze Tier',
    tierBadge: isAr ? 'برونزي' : 'Bronze',
    nextTierName: isAr ? 'المستوى الفضي' : 'Silver Tier',
    targetPoints: 500,
    remainingPoints: remaining,
    progressPercent: progress,
    isMaxTier: false,
    badgeColor: 'bg-amber-600/20 text-amber-100 border-amber-500/40',
  };
}

// Helper: Format date in Arabic or English
function formatOrderDate(dateString, isAr) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  if (isAr) {
    const monthsAr = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];
    return `${d.getDate()} ${monthsAr[d.getMonth()]} ${d.getFullYear()}`;
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Helper: Settings Menu Row Component
function SettingsMenuItem({ href, icon: Icon, iconBg, title, subtitle, badge, isAr, onClick }) {
  const Chevron = isAr ? ChevronLeft : ChevronRight;
  const content = (
    <div className="flex items-center justify-between p-3.5 sm:p-4 hover:bg-zinc-50 active:bg-zinc-100/80 transition-colors group">
      <div className="flex items-center gap-3.5 min-w-0">
        <span className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform`}>
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-xs sm:text-sm text-zinc-900 group-hover:text-marine-primary transition-colors truncate">
            {title}
          </p>
          {subtitle && (
            <p className="text-[11px] text-zinc-500 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ms-2">
        {badge && (
          <span className="text-[10px] sm:text-xs font-black px-2 py-0.5 rounded-full bg-marine-mist text-marine-primary border border-marine-cyan/20">
            {badge}
          </span>
        )}
        <Chevron size={16} className="text-zinc-400 group-hover:text-marine-primary transition-colors" />
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">{content}</Link>
  ) : (
    <button type="button" onClick={onClick} className="w-full text-start">{content}</button>
  );
}

// Helper: Extra service card for desktop grid
function ServiceCard({ href, icon: Icon, iconBg, iconColor, title, subtitle, badge, isAr }) {
  return (
    <Link
      href={href}
      className="bg-white border border-zinc-200/90 rounded-2xl p-4 shadow-xs hover:shadow-md hover:border-marine-cyan/40 hover:-translate-y-0.5 active:scale-[0.98] transition-all flex items-center justify-between gap-3 group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-10 h-10 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
          <Icon size={19} />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-xs sm:text-sm text-zinc-900 group-hover:text-marine-primary transition-colors truncate">
            {title}
          </p>
          {subtitle && (
            <p className="text-[11px] text-zinc-500 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {badge && (
        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-marine-mist text-marine-primary border border-marine-cyan/20 shrink-0">
          {badge}
        </span>
      )}
    </Link>
  );
}

export default function CustomerMainMenu({
  profile,
  user,
  orders = [],
  familyPendingCount = 0,
  friendRequestCount = 0,
  companyMembership,
  currency = 'EGP',
  isAr = true,
  t,
  onLogout,
  uploadingPhoto = false,
  onProfilePhotoChange,
}) {
  const Chevron = isAr ? ChevronLeft : ChevronRight;
  const BackArrow = isAr ? ArrowRight : ArrowLeft;

  const points = profile?.loyalty_points || 0;
  const tierInfo = getLoyaltyTierInfo(points, isAr);

  // Active orders filter
  const activeOrders = (orders || []).filter(
    (o) => !['delivered', 'cancelled', 'completed', 'refunded', 'returned'].includes(o.status)
  );
  const activeOrdersCount = activeOrders.length;
  const addressesCount = profile?.addresses?.length || 0;

  // Latest order for highlight card
  const sortedOrders = [...(orders || [])].sort(
    (a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0)
  );
  const latestOrder = sortedOrders[0] || null;
  const latestOrderProductImage =
    latestOrder?.items?.[0]?.product?.images?.[0] ||
    latestOrder?.items?.[0]?.image ||
    null;
  const latestOrderNumber =
    latestOrder?.order_number ||
    (latestOrder?._id ? `RM-#${latestOrder._id.slice(-4).toUpperCase()}` : '');

  // -------------------------------------------------------------
  // HERO GAMIFIED MEMBER CARD
  // -------------------------------------------------------------
  const renderGamifiedHeroCard = (isDesktop = false) => (
    <div className="relative rounded-3xl p-5 sm:p-6 bg-gradient-to-br from-[#0E2A38] via-[#0A384C] to-[#006781] text-white shadow-pod overflow-hidden border border-white/10 group">
      {/* Ambient background glows */}
      <div className="absolute -top-12 -end-12 w-48 h-48 rounded-full bg-marine-cyan/25 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -start-12 w-48 h-48 rounded-full bg-marine-primary/35 blur-3xl pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_70%)] pointer-events-none" />

      {/* Hero Content */}
      <div className="relative z-10 space-y-4 sm:space-y-5">
        {/* Profile Info Row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            {/* Avatar with Glow Ring & Optional Photo Change */}
            <div className="relative shrink-0">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-marine-primary to-marine-cyan flex items-center justify-center text-white ring-2 ring-white/70 shadow-md overflow-hidden transition-transform group-hover:scale-105">
                {profile?.profile_image ? (
                  <img
                    src={resolveAssetUrl(profile.profile_image)}
                    alt={profile?.name || 'Profile'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xl sm:text-2xl font-black text-white">
                    {profile?.name?.[0]?.toUpperCase() || user?.name?.[0]?.toUpperCase() || 'U'}
                  </span>
                )}
              </div>

              {onProfilePhotoChange ? (
                <label
                  className="absolute -bottom-1 -end-1 w-6 h-6 rounded-full bg-marine-cyan text-white ring-2 ring-[#0E2A38] shadow flex items-center justify-center cursor-pointer hover:bg-white hover:text-marine-navy transition-colors z-20"
                  title={isAr ? 'تغيير الصورة الشخصية' : 'Change profile picture'}
                >
                  {uploadingPhoto ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Camera size={12} />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={onProfilePhotoChange}
                    className="hidden"
                    disabled={uploadingPhoto}
                  />
                </label>
              ) : (
                <span
                  className="absolute -bottom-0.5 -end-0.5 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-[#0E2A38]"
                  title="Active"
                />
              )}
            </div>

            {/* Name & Email */}
            <Link
              href="/profile?view=setting-personal-info"
              className="min-w-0 block group/name"
              title={isAr ? 'تعديل البيانات الشخصية' : 'Edit personal info'}
            >
              <h2 className="text-base sm:text-lg font-black text-white truncate group-hover/name:text-marine-cyan transition-colors">
                {profile?.name || user?.name || (isAr ? 'حسابي' : 'My Account')}
              </h2>
              <p className="text-xs text-white/70 truncate mt-0.5 font-medium group-hover/name:text-white/90">
                {profile?.email || user?.email}
              </p>
            </Link>
          </div>

          {/* Gamified Tier Badge */}
          <Link
            href="/profile?view=points"
            className={`px-3 py-1 rounded-full text-[11px] font-black border backdrop-blur-md flex items-center gap-1.5 shrink-0 transition-transform hover:scale-105 ${tierInfo.badgeColor}`}
          >
            <Award size={13} />
            <span>{tierInfo.tierName}</span>
          </Link>
        </div>

        {/* Gamified Progress Section */}
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-white/90 flex items-center gap-1.5">
              <Sparkles size={13} className="text-amber-300" />
              <span>{tierInfo.tierName}</span>
            </span>
            <span className="text-white/75 text-[11px] font-semibold">
              {tierInfo.isMaxTier
                ? (isAr ? 'أعلى مستوى عضوية' : 'VIP Max Tier')
                : `${tierInfo.progressPercent}%`}
            </span>
          </div>

          {/* Glowing Animated Bar */}
          <div className="w-full h-2 rounded-full bg-white/20 overflow-hidden p-0.5 backdrop-blur-xs">
            <div
              className="h-full rounded-full bg-gradient-to-r from-marine-cyan to-white transition-all duration-700 shadow-xs"
              style={{ width: `${Math.max(6, tierInfo.progressPercent)}%` }}
            />
          </div>

          {/* Gamified Text & CTA */}
          <div className="flex items-center justify-between text-[11px] text-white/80">
            <span className="truncate">
              {tierInfo.isMaxTier
                ? (isAr ? 'تهانينا! لقد وصلت لأعلى مستوى تميز في ريدي مارين' : 'Top VIP member rank achieved')
                : (isAr
                    ? `باقي ${tierInfo.remainingPoints} نقطة للترقية للمستوى التالي`
                    : `${tierInfo.remainingPoints} pts left for next tier upgrade`)}
            </span>
            <Link
              href="/profile?view=points"
              className="text-marine-cyan hover:text-white font-bold transition-colors inline-flex items-center gap-0.5 shrink-0 ms-2"
            >
              <span>{isAr ? 'التفاصيل' : 'Details'}</span>
              <Chevron size={12} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // QUICK ACTIONS ROW (3 Interactive Buttons)
  // -------------------------------------------------------------
  const renderQuickActions = () => (
    <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
      {/* 1. طلباتي (My Orders) */}
      <Link
        href="/profile?view=orders"
        className="bg-white border border-zinc-200/90 rounded-2xl p-3 sm:p-4 text-center shadow-xs hover:shadow-md hover:border-marine-cyan/50 hover:-translate-y-0.5 active:scale-[0.98] transition-all flex flex-col items-center justify-center relative group"
      >
        {activeOrdersCount > 0 && (
          <span className="absolute top-2 end-2 min-w-5 h-5 px-1.5 rounded-full bg-marine-primary text-white text-[10px] font-black flex items-center justify-center shadow-xs">
            {activeOrdersCount}
          </span>
        )}
        <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-sky-50 text-marine-primary flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
          <Package size={20} />
        </span>
        <span className="font-bold text-xs sm:text-sm text-zinc-900 group-hover:text-marine-primary transition-colors">
          {isAr ? 'طلباتي' : 'My Orders'}
        </span>
      </Link>

      {/* 2. الترشيحات (Personalized Recommendations) */}
      <Link
        href="/profile?view=recommendations"
        className="bg-white border border-zinc-200/90 rounded-2xl p-3 sm:p-4 text-center shadow-xs hover:shadow-md hover:border-marine-cyan/50 hover:-translate-y-0.5 active:scale-[0.98] transition-all flex flex-col items-center justify-center group"
      >
        <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-marine-mist text-marine-primary flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
          <Sparkles size={20} />
        </span>
        <span className="font-bold text-xs sm:text-sm text-zinc-900 group-hover:text-marine-primary transition-colors">
          {isAr ? 'الترشيحات' : 'Recommendations'}
        </span>
      </Link>

      {/* 3. كوبوناتي أو شركتي */}
      {companyMembership ? (
        <Link
          href="/profile?view=company"
          className="bg-white border border-zinc-200/90 rounded-2xl p-3 sm:p-4 text-center shadow-xs hover:shadow-md hover:border-violet-300 hover:-translate-y-0.5 active:scale-[0.98] transition-all flex flex-col items-center justify-center group"
        >
          <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
            <Building2 size={20} />
          </span>
          <span className="font-bold text-xs sm:text-sm text-zinc-900 group-hover:text-violet-600 transition-colors truncate max-w-full px-1">
            {orgTerms(companyMembership.company?.org_type, isAr).mine || (isAr ? 'شركتي' : 'Company')}
          </span>
        </Link>
      ) : (
        <Link
          href="/profile?view=points"
          className="bg-white border border-zinc-200/90 rounded-2xl p-3 sm:p-4 text-center shadow-xs hover:shadow-md hover:border-amber-300 hover:-translate-y-0.5 active:scale-[0.98] transition-all flex flex-col items-center justify-center group"
        >
          <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
            <Sparkles size={20} />
          </span>
          <span className="font-bold text-xs sm:text-sm text-zinc-900 group-hover:text-amber-600 transition-colors">
            {isAr ? 'كوبوناتي' : 'Coupons'}
          </span>
        </Link>
      )}
    </div>
  );

  // -------------------------------------------------------------
  // FINANCIAL HUB (2 Distinct Cards: Wallet + Loyalty Points)
  // -------------------------------------------------------------
  const renderFinancialHub = () => (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      {/* 1. Wallet Card (Navy Premium Style) */}
      <div className="bg-gradient-to-br from-[#0E2A38] via-[#0D2531] to-[#0A1F29] border border-white/10 rounded-2xl p-4 sm:p-5 text-white shadow-pod relative overflow-hidden flex flex-col justify-between group">
        <div className="absolute -top-8 -end-8 w-24 h-24 bg-marine-cyan/20 rounded-full blur-2xl pointer-events-none" />

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-slate-300">
              {isAr ? 'المحفظة' : 'Wallet'}
            </span>
            <span className="w-7 h-7 rounded-lg bg-white/10 text-marine-cyan flex items-center justify-center shrink-0">
              <Wallet size={15} />
            </span>
          </div>

          <div className="text-lg sm:text-2xl font-black text-white tracking-tight my-1 font-display">
            {currency} {Number(profile?.wallet_balance || 0).toLocaleString()}
          </div>
        </div>

        <div className="pt-2">
          <Link
            href="/profile?view=wallet"
            className="inline-flex items-center gap-1 text-xs font-bold text-marine-cyan hover:text-white transition-colors group/btn"
          >
            <span>{isAr ? 'شحن الرصيد +' : '+ Top Up'}</span>
            <Chevron size={14} className="transition-transform group-hover/btn:-translate-x-0.5 rtl:rotate-0 ltr:rotate-180" />
          </Link>
        </div>
      </div>

      {/* 2. Loyalty Points Card (Soft Mist Sky Style) */}
      <div className="bg-[#F0F7FB] border border-[#D5E6F5] rounded-2xl p-4 sm:p-5 text-zinc-900 shadow-xs relative overflow-hidden flex flex-col justify-between hover:border-marine-cyan/40 transition-all group">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-zinc-600">
              {isAr ? 'نقاط ولائي' : 'Loyalty Points'}
            </span>
            <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
              <Sparkles size={15} />
            </span>
          </div>

          <div className="text-lg sm:text-2xl font-black text-zinc-900 tracking-tight my-1 font-display">
            {Number(profile?.loyalty_points || 0).toLocaleString()} {isAr ? 'نقطة' : 'pts'}
          </div>
        </div>

        <div className="pt-2">
          <Link
            href="/profile?view=points"
            className="inline-flex items-center gap-1 text-xs font-bold text-marine-primary hover:text-marine-cyan transition-colors group/btn"
          >
            <span>{isAr ? 'استبدال النقاط +' : '+ Redeem'}</span>
            <Chevron size={14} className="transition-transform group-hover/btn:-translate-x-0.5 rtl:rotate-0 ltr:rotate-180" />
          </Link>
        </div>
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // RECENT ORDERS HIGHLIGHT CARD ("طلباتي الأخيرة")
  // -------------------------------------------------------------
  const renderRecentOrdersHighlight = () => (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between px-1">
        <h3 className="font-bold text-sm sm:text-base text-zinc-900 flex items-center gap-2">
          <Package size={17} className="text-marine-primary" />
          <span>{isAr ? 'طلباتي الأخيرة' : 'Recent Orders'}</span>
        </h3>
        <Link
          href="/profile?view=orders-history"
          className="text-xs font-bold text-marine-primary hover:text-marine-cyan transition-colors"
        >
          {isAr ? 'عرض الكل' : 'View All'}
        </Link>
      </div>

      {latestOrder ? (
        <Link
          href="/profile?view=orders"
          className="block bg-white border border-zinc-200/90 rounded-2xl p-3.5 sm:p-4 shadow-sm hover:shadow-md hover:border-marine-cyan/40 active:scale-[0.99] transition-all group"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-zinc-100 border border-zinc-200/70 overflow-hidden flex items-center justify-center shrink-0">
                {latestOrderProductImage ? (
                  <img
                    src={resolveAssetUrl(latestOrderProductImage)}
                    alt="Order Item"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                ) : (
                  <Package size={22} className="text-marine-primary/70" />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-xs sm:text-sm text-zinc-900 group-hover:text-marine-primary transition-colors">
                    {isAr ? 'طلب' : 'Order'} #{latestOrderNumber}
                  </span>
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${getOrderStatusColor(latestOrder.status)}`}
                  >
                    {getOrderStatusLabel(latestOrder.status, isAr)}
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-zinc-500 mt-1 truncate">
                  {isAr
                    ? `تم الطلب في ${formatOrderDate(latestOrder.created_at || latestOrder.createdAt, isAr)}`
                    : `Placed on ${formatOrderDate(latestOrder.created_at || latestOrder.createdAt, false)}`}
                </p>
              </div>
            </div>

            <span className="p-2 rounded-full bg-zinc-50 text-zinc-400 group-hover:bg-marine-mist group-hover:text-marine-primary transition-colors shrink-0">
              <Chevron size={16} />
            </span>
          </div>
        </Link>
      ) : (
        <div className="bg-white border border-dashed border-zinc-200 rounded-2xl p-6 text-center">
          <Package size={28} className="text-zinc-300 mx-auto mb-2" />
          <p className="text-xs font-bold text-zinc-700">
            {isAr ? 'لا توجد طلبات سابقة حتى الآن' : 'No previous orders yet'}
          </p>
          <Link
            href="/products"
            className="inline-block mt-2 text-xs font-bold text-marine-cyan hover:underline"
          >
            {isAr ? 'تصفح المتجر الآن' : 'Browse products'}
          </Link>
        </div>
      )}
    </div>
  );

  // -------------------------------------------------------------
  // ACCOUNT SETTINGS LIST ("إعدادات الحساب")
  // -------------------------------------------------------------
  const renderAccountSettingsList = () => (
    <div className="space-y-2.5">
      <div className="px-1">
        <h3 className="font-bold text-sm sm:text-base text-zinc-900">
          {isAr ? 'إعدادات الحساب' : 'Account Settings'}
        </h3>
      </div>

      <div className="bg-white border border-zinc-200/90 rounded-2xl overflow-hidden shadow-sm divide-y divide-zinc-100">
        {/* 1. المعلومات الشخصية */}
        <SettingsMenuItem
          href="/profile?view=setting-personal-info"
          icon={User}
          iconBg="bg-blue-50 text-blue-600"
          title={isAr ? 'المعلومات الشخصية' : 'Personal Information'}
          subtitle={profile?.email || (isAr ? 'الاسم، الهاتف، والبريد' : 'Name, phone & email')}
          isAr={isAr}
        />

        {/* 2. عناوين التوصيل */}
        <SettingsMenuItem
          href="/profile?view=setting-addresses"
          icon={MapPin}
          iconBg="bg-rose-50 text-rose-600"
          title={isAr ? 'عناوين التوصيل' : 'Delivery Addresses'}
          subtitle={
            addressesCount > 0
              ? isAr
                ? `${addressesCount} عنوان مسجل`
                : `${addressesCount} saved`
              : isAr
              ? 'إدارة عناوين الاستلام'
              : 'Manage addresses'
          }
          badge={addressesCount > 0 ? `${addressesCount}` : null}
          isAr={isAr}
        />

        {/* 3. طرق الدفع والمحفظة */}
        <SettingsMenuItem
          href="/profile?view=wallet"
          icon={CreditCard}
          iconBg="bg-emerald-50 text-emerald-600"
          title={isAr ? 'طرق الدفع والمحفظة' : 'Payment Methods & Wallet'}
          subtitle={isAr ? 'إدارة رصيد المحفظة وعمليات الشحن' : 'Wallet balance & transactions'}
          isAr={isAr}
        />

        {/* 4. ترشيحات ريدي مارين */}
        <SettingsMenuItem
          href="/profile?view=recommendations"
          icon={Sparkles}
          iconBg="bg-marine-mist text-marine-primary"
          title={isAr ? 'ترشيحات ريدي مارين' : 'Personalized Recommendations'}
          subtitle={isAr ? 'منتجات مقترحة لك بناءً على اهتماماتك البحرية' : 'Curated products for your marine setup'}
          isAr={isAr}
        />

        {/* 5. الأمان وتغيير كلمة المرور */}
        <SettingsMenuItem
          href="/profile?view=setting-security"
          icon={ShieldCheck}
          iconBg="bg-indigo-50 text-indigo-600"
          title={isAr ? 'الأمان وكلمة المرور' : 'Security & Password'}
          subtitle={isAr ? 'تأمين الحساب وكلمات المرور' : 'Manage password & security'}
          isAr={isAr}
        />

        {/* 6. الدعم والمساعدة */}
        <SettingsMenuItem
          href="/support"
          icon={LifeBuoy}
          iconBg="bg-amber-50 text-amber-600"
          title={isAr ? 'الدعم والمساعدة' : 'Help & Support'}
          subtitle={isAr ? 'مركز المساعدة وفتح تذاكر الدعم' : 'Help center & support tickets'}
          isAr={isAr}
        />

        {/* 7. شركتي البحرية (إذا كانت متوفرة) */}
        {companyMembership && (
          <SettingsMenuItem
            href="/profile?view=company"
            icon={Building2}
            iconBg="bg-violet-50 text-violet-600"
            title={orgTerms(companyMembership.company?.org_type, isAr).mine || (isAr ? 'شركتي' : 'My Company')}
            subtitle={companyMembership.company?.name || (isAr ? 'إدارة المؤسسة والأعضاء' : 'Manage organization')}
            isAr={isAr}
          />
        )}
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // LOGOUT BUTTON
  // -------------------------------------------------------------
  const renderLogoutButton = () => (
    <div>
      <button
        type="button"
        onClick={onLogout}
        className="w-full bg-rose-50/70 hover:bg-rose-100 active:bg-rose-200 text-rose-600 border border-rose-200/80 font-bold py-3.5 px-4 rounded-2xl transition-all flex items-center justify-center gap-2 text-xs sm:text-sm shadow-xs group"
      >
        <LogOut size={17} className="text-rose-500 rtl:rotate-180 transition-transform group-hover:scale-110" />
        <span>{isAr ? 'تسجيل الخروج' : 'Log Out'}</span>
      </button>
    </div>
  );

  // -------------------------------------------------------------
  // DESKTOP EXTRA SERVICES GRID
  // -------------------------------------------------------------
  const renderDesktopExtraServices = () => (
    <div className="space-y-3 pt-2">
      <div className="px-1">
        <h3 className="font-bold text-sm text-zinc-900">
          {isAr ? 'خدمات ريدي مارين السريعة' : 'Marine Services'}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ServiceCard
          href="/profile?view=orders-history"
          icon={History}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-600"
          title={isAr ? 'سجل الطلبات' : 'Order History'}
          subtitle={isAr ? 'جميع الفواتير السابقة' : 'All past orders'}
          isAr={isAr}
        />
        <ServiceCard
          href="/profile/returns"
          icon={RotateCcw}
          iconBg="bg-orange-50"
          iconColor="text-orange-600"
          title={isAr ? 'طلبات الإرجاع' : 'Returns'}
          subtitle={isAr ? 'متابعة المرتجعات' : 'Track return requests'}
          isAr={isAr}
        />
        <ServiceCard
          href="/profile?view=family"
          icon={Users}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          title={familyCopy(isAr).family}
          subtitle={isAr ? 'مشاركة المحفظة والمشتريات' : 'Family sharing'}
          badge={familyPendingCount > 0 ? familyPendingCount : null}
          isAr={isAr}
        />
        <ServiceCard
          href="/profile?view=friends"
          icon={UserPlus}
          iconBg="bg-teal-50"
          iconColor="text-teal-600"
          title={friendCopy(isAr).friends}
          subtitle={isAr ? 'طلبات الصداقة والمكافآت' : 'Friends & referral'}
          badge={friendRequestCount > 0 ? friendRequestCount : null}
          isAr={isAr}
        />
      </div>
    </div>
  );

  // -------------------------------------------------------------
  // DESKTOP QUICK SUPPORT CARD
  // -------------------------------------------------------------
  const renderDesktopSupportCard = () => (
    <div className="bg-white border border-zinc-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-marine-mist text-marine-primary flex items-center justify-center shrink-0">
          <LifeBuoy size={17} />
        </span>
        <div>
          <h4 className="font-bold text-xs sm:text-sm text-zinc-900">
            {isAr ? 'هل تحتاج إلى مساعدة؟' : 'Need Support?'}
          </h4>
          <p className="text-[11px] text-zinc-500">
            {isAr ? 'فريق خدمة العملاء جاهز لخدمتك' : 'Customer care is here to help'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1 text-xs font-bold">
        <Link
          href="/support"
          className="p-2.5 rounded-xl bg-zinc-50 hover:bg-marine-mist text-zinc-800 hover:text-marine-primary transition-colors flex items-center justify-center gap-1.5"
        >
          <Mail size={14} />
          <span>{isAr ? 'فتح تذكرة' : 'Open Ticket'}</span>
        </Link>
        <Link
          href="/contact"
          className="p-2.5 rounded-xl bg-zinc-50 hover:bg-marine-mist text-zinc-800 hover:text-marine-primary transition-colors flex items-center justify-center gap-1.5"
        >
          <PhoneCall size={14} />
          <span>{isAr ? 'اتصل بنا' : 'Contact Us'}</span>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="animate-in fade-in duration-300">
      {/* ============================================================== */}
      {/* MOBILE LAYOUT (< lg): Matches UX Pilot Mockup Pixel-for-Pixel */}
      {/* ============================================================== */}
      <div className="lg:hidden max-w-md mx-auto space-y-4 sm:space-y-5">
        {/* Mobile Header Bar */}
        

        {/* 1. Hero Gamified Card */}
        {renderGamifiedHeroCard(false)}

        {/* 2. Quick Actions Row */}
        {renderQuickActions()}

        {/* 3. Financial Hub */}
        {renderFinancialHub()}

        {/* 4. Recent Orders Highlight */}
        {renderRecentOrdersHighlight()}

        {/* 5. Account Settings List */}
        {renderAccountSettingsList()}

        {/* 6. Logout Button */}
        {renderLogoutButton()}
      </div>

      {/* ============================================================== */}
      {/* DESKTOP LAYOUT (>= lg): Multi-Column Luxury Dashboard Grid    */}
      {/* ============================================================== */}
      <div className="hidden lg:block space-y-6">
        {/* Desktop Top Header Bar */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-200/80">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight">
                {isAr ? 'لوحة تحكم حسابي' : 'Account Dashboard'}
              </h1>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-marine-mist text-marine-primary border border-marine-cyan/20">
                Ready Marine VIP
              </span>
            </div>
            <p className="text-xs sm:text-sm text-zinc-500 mt-1">
              {isAr
                ? 'إدارة مشترياتك البحرية، رصيد المحفظة، ونقاط الولاء في واجهة ذكية واحدة'
                : 'Manage marine purchases, wallet balance, and loyalty rewards in one unified dashboard'}
            </p>
          </div>
        </div>

        {/* Desktop Responsive Grid (Main Left + Sidebar Right) */}
        <div className="grid grid-cols-12 gap-8 items-start">
          {/* Main Column (8 Cols) */}
          <div className="col-span-12 xl:col-span-8 lg:col-span-7 space-y-6">
            {/* 1. Gamified Hero Card */}
            {renderGamifiedHeroCard(true)}

            {/* 2. Quick Actions */}
            {renderQuickActions()}

            {/* 3. Financial Hub */}
            {renderFinancialHub()}

            {/* 4. Recent Orders Highlight Card */}
            {renderRecentOrdersHighlight()}

            {/* 5. Extra Marine Services */}
            {renderDesktopExtraServices()}
          </div>

          {/* Sidebar Column (4-5 Cols) */}
          <div className="col-span-12 xl:col-span-4 lg:col-span-5 space-y-6">
            {/* Account Settings List */}
            {renderAccountSettingsList()}

            {/* Quick Customer Care Support */}
            {renderDesktopSupportCard()}

            {/* Logout Button */}
            {renderLogoutButton()}
          </div>
        </div>
      </div>
    </div>
  );
}
