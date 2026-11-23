'use client';

import { useEffect, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import Link from '../../../components/LocaleLink';
import {
  ShoppingCart, Store, Landmark, Ticket, Users, FileText,
  Copy, RefreshCw, Loader2, AlertTriangle, Layers, TrendingUp,
  Package, Settings, ArrowRight, AlertCircle, PackageOpen,
  RotateCcw, Wallet, Bell, UserCheck, ShieldAlert, Star
} from 'lucide-react';
import { adminApi } from '../../../lib/api';

/** Top-level Action Pill for items needing immediate attention */
function ActionPill({ href, count, label, icon: Icon }) {
  if (count === undefined || count === null || count <= 0) return null;
  return (
    <Link
      href={href}
      className="bg-[#FFF8EE] hover:bg-[#FFF0DB] dark:bg-amber-950/20 dark:hover:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200/70 dark:border-amber-900/40 rounded-xl px-3.5 py-2 text-xs font-bold inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5 shadow-sm group"
    >
      {Icon && <Icon size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />}
      <span>{count} {label}</span>
      <ArrowRight size={12} className="rtl:rotate-180 text-amber-500 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 transition-transform" />
    </Link>
  );
}

/** Top-level Hero Stat Card (4 Column Cards) */
function HeroStatCard({ title, value, subtext, icon: Icon, tone = 'default', href = '#' }) {
  const isEmerald = tone === 'emerald';
  const isRose = tone === 'rose';

  return (
    <Link
      href={href}
      className="w-[260px] sm:w-auto shrink-0 snap-start bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200/80 dark:border-white/5 p-4 sm:p-5 shadow-sm hover:shadow-md transition-all flex items-center justify-between group"
    >
      <div className="min-w-0">
        <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 truncate">
          {title}
        </p>
        <p className="text-xl md:text-2xl font-black text-zinc-900 dark:text-white mt-1 tabular-nums group-hover:text-marine-cyan transition-colors truncate">
          {value}
        </p>
        {subtext && (
          <p className="text-[11px] text-zinc-400 mt-1 truncate">
            {subtext}
          </p>
        )}
      </div>

      <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center shrink-0 ${
        isEmerald
          ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
          : isRose
            ? 'bg-rose-50 text-rose-500 dark:bg-rose-950/40 dark:text-rose-400'
            : 'bg-zinc-100 text-zinc-700 dark:bg-white/5 dark:text-zinc-300'
      }`}>
        <Icon size={20} className="sm:w-[22px] sm:h-[22px]" />
      </div>
    </Link>
  );
}

/** Clickable stat number cell inside work section cards */
function MetricCell({ label, value, href }) {
  if (!label) return <div className="p-2" />;
  return (
    <Link
      href={href || '#'}
      className="flex flex-col items-center justify-center p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/[0.04] transition-all group cursor-pointer"
    >
      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mb-1 text-center leading-tight">
        {label}
      </span>
      <span className="text-lg md:text-xl font-bold text-zinc-900 dark:text-white group-hover:text-marine-cyan transition-colors tabular-nums">
        {value ?? 0}
      </span>
    </Link>
  );
}

/** 7 Grouped Work Cards */
function WorkSectionCard({ title, icon: Icon, badge, pill, children, className = '' }) {
  return (
    <div className={`bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200/80 dark:border-white/5 p-5 md:p-6 shadow-sm flex flex-col justify-between ${className}`}>
      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            {Icon && <Icon size={20} className="text-zinc-400 dark:text-zinc-500 shrink-0" />}
            <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">
              {title}
            </h2>
          </div>
          {badge && (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400">
              {badge}
            </span>
          )}
        </div>

        {pill && (
          <div className="bg-zinc-50 dark:bg-white/[0.03] text-zinc-500 dark:text-zinc-400 text-xs py-2 px-4 rounded-xl font-medium text-center mb-5 border border-zinc-100 dark:border-white/5">
            {pill}
          </div>
        )}

        <div className="grid grid-cols-3 gap-y-5 gap-x-2">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboardIndex() {
  const { language } = useApp();
  const isAr = language === 'ar';

  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const data = await adminApi.getOverview();
      setOverview(data?.sections || {});
    } catch (err) {
      console.error('Failed to load dashboard overview:', err);
      setError(err.message || (isAr ? 'تعذر تحميل الإحصائيات' : 'Failed to load statistics'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const sec = overview || {};
  const orders = sec.orders || {};
  const parcels = sec.parcels || {};
  const products = sec.products || {};
  const vendors = sec.vendors || {};
  const subscriptions = sec.subscriptions || {};
  const users = sec.users || {};
  const carCampaigns = sec.car_campaigns || {};
  const verifications = sec.verifications || {};
  const companies = sec.companies || {};
  const returns = sec.returns || {};
  const withdrawals = sec.withdrawals || {};
  const ads = sec.ads || {};
  const supplies = sec.supplies || {};
  const inquiries = sec.contact_inquiries || {};
  const tickets = sec.tickets || {};
  const coupons = sec.coupons || {};
  const loyalty = sec.loyalty || {};
  const reviews = sec.reviews || {};
  const categories = sec.categories || {};
  const carBrands = sec.car_brands || {};
  const productBrands = sec.product_brands || {};
  const services = sec.services || {};
  const articles = sec.articles || {};
  const pages = sec.pages || {};

  // Attention badge calculation
  const totalAttention = (parcels.attention || 0) + (orders.pending || 0) + (orders.missing || 0);

  // List of urgent items needing admin action
  const attentionItems = [
    { href: '/admin/dashboard/orders?status=pending', count: orders.pending, label: isAr ? 'طلبات جديدة معلقة' : 'pending orders', icon: ShoppingCart },
    { href: '/admin/dashboard/parcels?reason=declined_items', count: orders.missing, label: isAr ? 'طلبات ناقصة مفتوحة' : 'open incomplete orders', icon: PackageOpen },
    { href: '/admin/dashboard/parcels', count: parcels.attention, label: isAr ? 'شحنات مرفوضة راجعة للتاجر' : 'rejected parcels', icon: Package },
    { href: '/admin/dashboard/pending-products', count: products.pending, label: isAr ? 'منتجات بانتظار الموافقة' : 'pending products', icon: Bell },
    { href: '/admin/dashboard/verifications', count: verifications.pending, label: isAr ? 'توثيق حسابات بالانتظار' : 'pending verifications', icon: UserCheck },
    { href: '/admin/dashboard/returns', count: returns.open, label: isAr ? 'طلبات إرجاع مفتوحة' : 'open returns', icon: RotateCcw },
    { href: '/admin/dashboard/withdrawals', count: withdrawals.pending, label: isAr ? 'طلبات سحب معلقة' : 'pending withdrawals', icon: Wallet },
    { href: '/admin/dashboard/tickets?status=open', count: tickets.open, label: isAr ? 'تذاكر دعم مفتوحة' : 'open tickets', icon: Ticket },
    { href: '/admin/dashboard/reviews?status=pending', count: reviews.pending, label: isAr ? 'تقييمات بانتظار المراجعة' : 'pending reviews', icon: Star },
  ].filter(it => it.count > 0);

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3">
        <Loader2 size={32} className="animate-spin text-marine-cyan" />
        <p className="text-xs font-bold text-zinc-400">
          {isAr ? 'جاري تحميل لوحة التحكم...' : 'Loading dashboard...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Main Header Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {isAr ? 'لوحة تحكم الإدارة الشاملة' : 'Admin Control Center'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr
              ? 'تحليلات وإحصائيات فورية لكل أقسام الموقع مع إمكانية الوصول السريع'
              : 'Live analytics and overview across all system sections with direct access'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/admin/dashboard/landing"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            <Settings size={14} />
            <span>{isAr ? 'التحكم بالصفحة الرئيسية' : 'Landing Control'}</span>
          </Link>

          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50 border border-zinc-200/60 dark:border-white/5"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-marine-cyan' : ''} />
            <span>{isAr ? 'تحديث الإحصائيات' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 text-xs font-bold">
          {error}
        </div>
      )}

      {/* 2. Immediate Action Required Banner */}
      {attentionItems.length > 0 && (
        <div className="bg-[#FFF9F9] dark:bg-red-950/10 border border-red-200/80 dark:border-red-900/30 rounded-2xl p-4">
          <div className="flex items-center gap-1.5 text-xs font-bold text-red-600 dark:text-red-400 mb-3">
            <AlertCircle size={15} />
            <span>{isAr ? 'إجراءات تتطلب تدخلك فوراً' : 'Actions Requiring Immediate Attention'}</span>
          </div>
          <div className="flex items-center gap-2.5 overflow-x-auto scrollbar-hide pb-1">
            {attentionItems.map((item, idx) => (
              <ActionPill
                key={idx}
                href={item.href}
                count={item.count}
                label={item.label}
                icon={item.icon}
              />
            ))}
          </div>
        </div>
      )}

      {/* 3. Top 4 Hero Summary Stat Cards - Scrollable on mobile, grid on desktop */}
      <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3 overflow-x-auto scrollbar-hide snap-x -mx-3 px-3 sm:mx-0 sm:px-0 pb-1">
        {/* Card 1: مبيعات آخر 30 يوم */}
        <HeroStatCard
          title={isAr ? 'مبيعات آخر 30 يوم' : 'Sales (Last 30 Days)'}
          value={orders.revenue_30d !== undefined ? `${Number(orders.revenue_30d).toLocaleString()} ج.م` : '0 ج.م'}
          subtext={isAr ? `${orders.last_30d || 0} طلب مكتمل` : `${orders.last_30d || 0} completed orders`}
          icon={TrendingUp}
          tone="emerald"
          href="/admin/dashboard/finance"
        />

        {/* Card 2: طلبات اليوم */}
        <HeroStatCard
          title={isAr ? 'طلبات اليوم' : "Today's Orders"}
          value={orders.today ?? 0}
          subtext={isAr ? `${orders.pending || 0} قيد المتابعة` : `${orders.pending || 0} pending review`}
          icon={ShoppingCart}
          tone="rose"
          href="/admin/dashboard/orders"
        />

        {/* Card 3: المنتجات المنشورة */}
        <HeroStatCard
          title={isAr ? 'المنتجات المنشورة' : 'Published Products'}
          value={products.published ?? 0}
          subtext={isAr ? `${products.pending || 0} بانتظار الموافقة` : `${products.pending || 0} pending approval`}
          icon={Package}
          tone="default"
          href="/admin/dashboard/products?status=published"
        />

        {/* Card 4: التجار والاشتراكات */}
        <HeroStatCard
          title={isAr ? 'التجار والاشتراكات' : 'Vendors & Subscriptions'}
          value={vendors.total ?? 0}
          subtext={isAr ? `${subscriptions.active || 0} اشتراك سارٍ` : `${subscriptions.active || 0} active subscriptions`}
          icon={Store}
          tone="default"
          href="/admin/dashboard/vendors"
        />
      </div>

      {/* 4. Work Section Header */}
      <div className="flex items-center justify-between pt-4 pb-1">
        <h2 className="text-xl md:text-2xl font-bold text-zinc-900 dark:text-white">
          {isAr ? 'الأقسام بترتيب الشغل' : 'Sections by Workflow Priority'}
        </h2>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 hidden sm:block">
          {isAr ? 'اضغط على أي رقم للانتقال لصفحته' : 'Click any number to view its page'}
        </p>
      </div>

      {/* 5. Main 2-column Grid of 7 Work Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Card 1: الكتالوج ومراجعة المنتجات */}
        <WorkSectionCard
          title={isAr ? 'الكتالوج ومراجعة المنتجات' : 'Catalog & Product Review'}
          icon={Copy}
          pill={
            isAr
              ? `بانتظار الموافقة ${products.pending || 0} ← منشور ${Number(products.published || 0).toLocaleString()}`
              : `Pending Approval ${products.pending || 0} ← Published ${Number(products.published || 0).toLocaleString()}`
          }
        >
          <MetricCell
            label={isAr ? 'الفئات' : 'Categories'}
            value={categories.total}
            href="/admin/dashboard/categories"
          />
          <MetricCell
            label={isAr ? 'فئات نشطة' : 'Active Categories'}
            value={categories.active}
            href="/admin/dashboard/categories"
          />
          <MetricCell
            label={isAr ? 'ماركات المنتجات' : 'Brands'}
            value={productBrands.total ?? carBrands.total}
            href="/admin/dashboard/product-brands"
          />
          <MetricCell
            label={isAr ? 'بانتظار الموافقة' : 'Pending Approval'}
            value={products.pending}
            href="/admin/dashboard/pending-products"
          />
          <MetricCell
            label={isAr ? 'منتجات منشورة' : 'Published Products'}
            value={products.published}
            href="/admin/dashboard/products?status=published"
          />
          <MetricCell
            label={isAr ? 'مسودات' : 'Drafts'}
            value={products.draft}
            href="/admin/dashboard/products?status=draft"
          />
        </WorkSectionCard>

        {/* Card 2: التجار والاشتراكات */}
        <WorkSectionCard
          title={isAr ? 'التجار والاشتراكات' : 'Vendors & Subscriptions'}
          icon={Store}
          pill={
            isAr
              ? `تجار ${vendors.total || 0} ← اشتراك سارٍ ${subscriptions.active || 0}`
              : `Vendors ${vendors.total || 0} ← Active Subscriptions ${subscriptions.active || 0}`
          }
        >
          <MetricCell
            label={isAr ? 'إجمالي التجار' : 'Total Vendors'}
            value={vendors.total}
            href="/admin/dashboard/vendors"
          />
          <MetricCell
            label={isAr ? 'جديد هذا الأسبوع' : 'New This Week'}
            value={vendors.new_7d}
            href="/admin/dashboard/vendors"
          />
          <MetricCell
            label={isAr ? 'توثيق بالانتظار' : 'Pending Verification'}
            value={verifications.pending}
            href="/admin/dashboard/verifications"
          />
          <MetricCell
            label={isAr ? 'شركات نشطة' : 'Active Companies'}
            value={companies.active}
            href="/admin/dashboard/companies"
          />
          <MetricCell
            label={isAr ? 'شركات معلقة' : 'Suspended Companies'}
            value={companies.suspended}
            href="/admin/dashboard/companies"
          />
          <MetricCell
            label={isAr ? 'اشتراكات نشطة' : 'Active Subscriptions'}
            value={subscriptions.active}
            href="/admin/dashboard/subscriptions"
          />
          <MetricCell
            label={isAr ? 'اشتراكات منتهية' : 'Expired Subscriptions'}
            value={subscriptions.expired}
            href="/admin/dashboard/subscriptions"
          />
          <div />
          <div />
        </WorkSectionCard>

        {/* Card 3: المالية */}
        <WorkSectionCard
          title={isAr ? 'المالية' : 'Finance'}
          icon={Landmark}
          pill={
            isAr
              ? `طلبات سحب معلقة ${withdrawals.pending || 0} ← ادفع في 30 يوم ${Number(withdrawals.paid_30d || 0).toLocaleString()} ج.م`
              : `Pending Withdrawals ${withdrawals.pending || 0} ← 30d Payouts ${Number(withdrawals.paid_30d || 0).toLocaleString()} EGP`
          }
        >
          <MetricCell
            label={isAr ? 'مبيعات 30 يوم' : '30-Day Sales'}
            value={orders.revenue_30d !== undefined ? `${Number(orders.revenue_30d).toLocaleString()} ج.م` : '0 ج.م'}
            href="/admin/dashboard/finance"
          />
          <MetricCell
            label={isAr ? 'طلبات سحب معلقة' : 'Pending Withdrawals'}
            value={withdrawals.pending}
            href="/admin/dashboard/withdrawals"
          />
          <MetricCell
            label={isAr ? 'مدفوعات السحب (30 يوم)' : 'Withdrawals (30d)'}
            value={withdrawals.paid_30d !== undefined ? `${Number(withdrawals.paid_30d).toLocaleString()} ج.م` : '0 ج.م'}
            href="/admin/dashboard/withdrawals"
          />
        </WorkSectionCard>

        {/* Card 4: الطلبات والشحن */}
        <WorkSectionCard
          title={isAr ? 'الطلبات والشحن' : 'Orders & Shipping'}
          icon={ShoppingCart}
          badge={totalAttention > 0 ? (isAr ? `${totalAttention} محتاج تدخل` : `${totalAttention} Needs Attention`) : null}
          pill={
            isAr
              ? `طلبات معلقة ${orders.pending || 0} ← شحنات محتاجة تدخلك ${parcels.attention || 0}`
              : `Pending Orders ${orders.pending || 0} ← Attention Parcels ${parcels.attention || 0}`
          }
        >
          <MetricCell
            label={isAr ? 'طلبات اليوم' : "Today's Orders"}
            value={orders.today}
            href="/admin/dashboard/orders"
          />
          <MetricCell
            label={isAr ? 'آخر 30 يوم' : 'Last 30 Days'}
            value={orders.last_30d}
            href="/admin/dashboard/orders"
          />
          <MetricCell
            label={isAr ? 'طلبات معلقة' : 'Pending Orders'}
            value={orders.pending}
            href="/admin/dashboard/orders?status=pending"
          />
          <MetricCell
            label={isAr ? 'شحنات محتاجة تدخلك' : 'Parcels Needing You'}
            value={parcels.attention}
            href="/admin/dashboard/parcels"
          />
          <MetricCell
            label={isAr ? 'طلبات ناقصة مفتوحة' : 'Open Incomplete Orders'}
            value={orders.missing}
            href="/admin/dashboard/parcels?reason=declined_items"
          />
          <MetricCell
            label={isAr ? 'طلبات مستلزمات معلقة' : 'Pending Supplies'}
            value={supplies.pending}
            href="/admin/dashboard/supplies"
          />
          <div />
          <MetricCell
            label={isAr ? 'مرتجعات مفتوحة' : 'Open Returns'}
            value={returns.open}
            href="/admin/dashboard/returns"
          />
          <MetricCell
            label={isAr ? 'استرداد معلق' : 'Pending Refunds'}
            value={returns.refunds_pending}
            href="/admin/dashboard/refunds"
          />
        </WorkSectionCard>

        {/* Card 5: الدعم */}
        <WorkSectionCard
          title={isAr ? 'الدعم' : 'Support'}
          icon={Ticket}
        >
          <MetricCell
            label={isAr ? 'تذاكر مفتوحة' : 'Open Tickets'}
            value={tickets.open}
            href="/admin/dashboard/tickets?status=open"
          />
          <MetricCell
            label={isAr ? 'تذاكر قيد الانتظار' : 'Pending Tickets'}
            value={tickets.pending}
            href="/admin/dashboard/tickets?status=pending"
          />
          <MetricCell
            label={isAr ? 'رسائل جديدة' : 'New Inquiries'}
            value={inquiries.new}
            href="/admin/dashboard/contact-inquiries"
          />
          <MetricCell
            label={isAr ? 'إجمالي الرسائل' : 'Total Inquiries'}
            value={inquiries.total}
            href="/admin/dashboard/contact-inquiries"
          />
          <MetricCell
            label={isAr ? 'تقييمات بانتظار النشر' : 'Pending Reviews'}
            value={reviews.pending}
            href="/admin/dashboard/reviews?status=pending"
          />
          <MetricCell
            label={isAr ? 'تقييمات معتمدة' : 'Approved Reviews'}
            value={reviews.approved}
            href="/admin/dashboard/reviews?status=approved"
          />
        </WorkSectionCard>

        {/* Card 6: العملاء والتسويق */}
        <WorkSectionCard
          title={isAr ? 'العملاء والتسويق' : 'Customers & Marketing'}
          icon={Users}
        >
          <MetricCell
            label={isAr ? 'عملاء نشطون' : 'Active Users'}
            value={users.total}
            href="/admin/dashboard/users"
          />
          <MetricCell
            label={isAr ? 'مسجلين حديثاً (7 أيام)' : 'New Users (7d)'}
            value={users.new_7d}
            href="/admin/dashboard/users"
          />
          <MetricCell
            label={isAr ? 'إيميلات تذكير السلة (7 أيام)' : 'Cart Reminders (7d)'}
            value={users.reminders_7d}
            href="/admin/dashboard/cart-reminders"
          />
          <MetricCell
            label={isAr ? 'حملات بريدية' : 'Email Campaigns'}
            value={carCampaigns.total}
            href="/admin/dashboard/car-campaigns"
          />
          <MetricCell
            label={isAr ? 'حملات اتبعتت' : 'Sent Campaigns'}
            value={carCampaigns.sent}
            href="/admin/dashboard/car-campaigns"
          />
          <MetricCell
            label={isAr ? 'كوبونات فعالة' : 'Active Coupons'}
            value={coupons.active}
            href="/admin/dashboard/coupons"
          />
          <MetricCell
            label={isAr ? 'أعضاء الولاء' : 'Loyalty Members'}
            value={loyalty.members}
            href="/admin/dashboard/loyalty"
          />
          <MetricCell
            label={isAr ? 'طلبات إعلانات معلقة' : 'Pending Ad Requests'}
            value={ads.pending}
            href="/admin/dashboard/ad-requests"
          />
          <MetricCell
            label={isAr ? 'إعلانات جارية' : 'Running Ads'}
            value={ads.approved}
            href="/admin/dashboard/ad-requests"
          />
        </WorkSectionCard>

        {/* Card 7: المحتوى والموقع */}
        <WorkSectionCard
          title={isAr ? 'المحتوى والموقع' : 'Content & Website'}
          icon={FileText}
          className="lg:col-span-2"
        >
          <MetricCell
            label={isAr ? 'خدمات نشطة' : 'Active Services'}
            value={services.active}
            href="/admin/dashboard/services"
          />
          <MetricCell
            label={isAr ? 'إجمالي الخدمات' : 'Total Services'}
            value={services.total}
            href="/admin/dashboard/services"
          />
          <MetricCell
            label={isAr ? 'مقالات منشورة' : 'Published Articles'}
            value={articles.published}
            href="/admin/dashboard/articles"
          />
          <MetricCell
            label={isAr ? 'مسودات' : 'Drafts'}
            value={articles.draft}
            href="/admin/dashboard/articles"
          />
          <MetricCell
            label={isAr ? 'الصفحات' : 'Pages'}
            value={pages.total}
            href="/admin/dashboard/pages"
          />
          <div />
        </WorkSectionCard>
      </div>
    </div>
  );
}
