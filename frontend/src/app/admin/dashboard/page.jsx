'use client';

import { useEffect, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import Link from '../../../components/LocaleLink';
import {
  ShoppingCart, Package, Bell, Store, CreditCard, Users, Ship,
  AlertTriangle, RotateCcw, Wallet, Landmark, Truck, PackageOpen,
  Mail, Ticket, BadgePercent, Sparkles, Star, FolderTree, Wrench,
  Newspaper, FileText, Settings, ArrowRight, RefreshCw, Loader2,
  CheckCircle2, Clock, ShieldAlert, ArrowUpRight, TrendingUp,
  Building2, UserCheck, MessageSquare
} from 'lucide-react';
import { adminApi } from '../../../lib/api';

const CARD = 'bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/5 p-5 shadow-sm hover:shadow-md transition-all duration-200 group';

/** Top-level Action Pill for things that need immediate attention */
function ActionPill({ href, count, label, icon: Icon, tone = 'red' }) {
  if (!count || count <= 0) return null;
  const isRed = tone === 'red';

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all transform hover:-translate-y-0.5 ${
        isRed
          ? 'bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950/40 dark:hover:bg-red-900/50 dark:text-red-400 border border-red-200 dark:border-red-900/40'
          : 'bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 dark:text-amber-400 border border-amber-200 dark:border-amber-900/40'
      }`}
    >
      <Icon size={14} className="shrink-0" />
      <span>{count} {label}</span>
      <ArrowRight size={12} className="rtl:rotate-180 opacity-60 group-hover:opacity-100" />
    </Link>
  );
}

/** Top-level Section Analytics Card */
function SectionAnalyticsCard({
  href,
  title,
  icon: Icon,
  badge,
  badgeTone = 'red',
  stats = [],
  tone = 'default',
  isAr
}) {
  return (
    <Link href={href} className={CARD}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 group-hover:bg-marine-cyan group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-sm">
            <Icon size={18} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-zinc-900 dark:text-white group-hover:text-marine-primary transition-colors flex items-center gap-1.5">
              <span>{title}</span>
              <ArrowUpRight size={14} className="opacity-0 group-hover:opacity-100 text-marine-cyan transition-all" />
            </h3>
          </div>
        </div>

        {badge !== undefined && badge !== null && (
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-black uppercase ${
            badgeTone === 'red'
              ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'
              : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
          }`}>
            {badge}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100 dark:border-white/5">
        {stats.map((st, i) => (
          <div key={i} className="min-w-0">
            <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate">{st.label}</p>
            <p className="text-base font-black text-zinc-900 dark:text-white mt-0.5 tabular-nums">
              {st.value ?? '—'}
            </p>
          </div>
        ))}
      </div>
    </Link>
  );
}

/** Top-level Hero Stat Card */
function HeroStat({ icon: Icon, label, value, sublabel, tone = 'default' }) {
  const isRed = tone === 'red';
  const isGreen = tone === 'green';

  return (
    <div className="bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/5 p-5 shadow-sm flex flex-col items-start sm:flex-row sm:items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
        isRed
          ? 'bg-marine-mist dark:bg-marine-cyan/10 text-marine-cyan'
          : isGreen
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
            : 'bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200'
      }`}>
        <Icon size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 truncate">{label}</p>
        <p className="text-2xl font-black text-zinc-900 dark:text-white mt-0.5 tabular-nums truncate">{value}</p>
        {sublabel && <p className="text-[11px] text-zinc-400 mt-0.5 truncate">{sublabel}</p>}
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
  const pickups = sec.pickups || {};
  const supplies = sec.supplies || {};
  const inquiries = sec.contact_inquiries || {};
  const tickets = sec.tickets || {};
  const coupons = sec.coupons || {};
  const wallets = sec.wallets || {};
  const loyalty = sec.loyalty || {};
  const reviews = sec.reviews || {};
  const categories = sec.categories || {};
  const carBrands = sec.car_brands || {};
  const productBrands = sec.product_brands || {};
  const services = sec.services || {};
  const articles = sec.articles || {};

  // Total items needing attention
  const attentionItems = [
    { href: '/admin/dashboard/pending-products', count: products.pending, label: isAr ? 'منتجات بانتظار الموافقة' : 'pending products', icon: Bell, tone: 'red' },
    { href: '/admin/dashboard/orders', count: orders.pending, label: isAr ? 'طلبات جديدة معلقة' : 'pending orders', icon: ShoppingCart, tone: 'amber' },
    { href: '/admin/dashboard/parcels', count: parcels.attention, label: isAr ? 'شحنات محتاجة تدخلك' : 'parcels need attention', icon: AlertTriangle, tone: 'red' },
    { href: '/admin/dashboard/verifications', count: verifications.pending, label: isAr ? 'توثيق حسابات بالانتظار' : 'pending verifications', icon: UserCheck, tone: 'amber' },
    { href: '/admin/dashboard/returns', count: returns.open, label: isAr ? 'طلبات إرجاع مفتوحة' : 'open returns', icon: RotateCcw, tone: 'red' },
    { href: '/admin/dashboard/tickets', count: tickets.open, label: isAr ? 'تذاكر دعم مفتوحة' : 'open tickets', icon: Ticket, tone: 'amber' },
    { href: '/admin/dashboard/withdrawals', count: withdrawals.pending, label: isAr ? 'طلبات سحب معلقة' : 'pending withdrawals', icon: Wallet, tone: 'amber' },
    { href: '/admin/dashboard/contact-inquiries', count: inquiries.new, label: isAr ? 'رسائل تواصل جديدة' : 'new inquiries', icon: Mail, tone: 'amber' },
    { href: '/admin/dashboard/reviews', count: reviews.pending, label: isAr ? 'تقييمات للمراجعة' : 'pending reviews', icon: Star, tone: 'amber' },
  ].filter(it => it.count > 0);

  return (
    <div className="space-y-6">
      {/* Top Header */}
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
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span>{isAr ? 'تحديث الإحصائيات' : 'Refresh'}</span>
          </button>

          <Link
            href="/admin/dashboard/landing"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            <Settings size={14} />
            <span>{isAr ? 'التحكم بالصفحة الرئيسية' : 'Landing Control'}</span>
          </Link>
        </div>
      </div>

      {/* Immediate Attention Strip (If any items pending) */}
      {attentionItems.length > 0 && (
        <div className="bg-red-50/50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-bold text-xs uppercase tracking-wider mb-2.5">
            <ShieldAlert size={16} />
            <span>{isAr ? 'إجراءات تتطلب تدخلك فوراً' : 'Action Required'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {attentionItems.map((item, idx) => (
              <ActionPill
                key={idx}
                href={item.href}
                count={item.count}
                label={item.label}
                icon={item.icon}
                tone={item.tone}
              />
            ))}
          </div>
        </div>
      )}

      {/* Top 4 Hero Numbers */}
      <div data-stat-grid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroStat
          icon={TrendingUp}
          label={isAr ? 'مبيعات آخر 30 يوم' : 'Sales (Last 30 Days)'}
          value={orders.revenue_30d !== undefined ? `${Number(orders.revenue_30d).toLocaleString()} ج.م` : '—'}
          sublabel={isAr ? `${orders.last_30d || 0} طلب مكتمل` : `${orders.last_30d || 0} orders`}
          tone="green"
        />
        <HeroStat
          icon={ShoppingCart}
          label={isAr ? 'طلبات اليوم' : "Today's Orders"}
          value={orders.today !== undefined ? orders.today : '—'}
          sublabel={isAr ? `${orders.pending || 0} قيد المتابعة` : `${orders.pending || 0} pending`}
          tone="red"
        />
        <HeroStat
          icon={Package}
          label={isAr ? 'المنتجات المنشورة' : 'Published Products'}
          value={products.published !== undefined ? products.published : '—'}
          sublabel={isAr ? `${products.pending || 0} بانتظار الموافقة` : `${products.pending || 0} pending review`}
        />
        <HeroStat
          icon={Store}
          label={isAr ? 'التجار والاشتراكات' : 'Active Vendors'}
          value={vendors.total !== undefined ? vendors.total : '—'}
          sublabel={isAr ? `${subscriptions.active || 0} اشتراك سارٍ` : `${subscriptions.active || 0} active subs`}
        />
      </div>

      {/* Section Analytics Grid - All Sidebar Modules */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-zinc-900 dark:text-white">
            {isAr ? 'تحليلات أقسام لوحة التحكم' : 'Module Analytics & Jump Links'}
          </h2>
          <span className="text-xs text-zinc-400">
            {isAr ? 'اضغط على أي قسم للانتقال إليه مباشرة' : 'Click any card to open its section'}
          </span>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <Loader2 size={32} className="animate-spin text-marine-cyan" />
            <p className="text-xs font-bold">{isAr ? 'جارِ جمع بيانات الأقسام...' : 'Gathering module statistics...'}</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-500 font-bold text-sm bg-red-50 dark:bg-red-950/20 rounded-2xl">
            {error}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            
            {/* 1. Orders */}
            <SectionAnalyticsCard
              href="/admin/dashboard/orders"
              title={isAr ? 'الطلبات' : 'Orders'}
              icon={ShoppingCart}
              badge={orders.pending > 0 ? (isAr ? `${orders.pending} معلق` : `${orders.pending} pending`) : null}
              stats={[
                { label: isAr ? 'طلبات اليوم' : 'Today', value: orders.today },
                { label: isAr ? 'آخر 30 يوم' : '30 Days', value: orders.last_30d },
              ]}
              isAr={isAr}
            />

            {/* 2. Parcels Needing You */}
            <SectionAnalyticsCard
              href="/admin/dashboard/parcels"
              title={isAr ? 'شحنات محتاجة تدخلك' : 'Parcels Needing You'}
              icon={AlertTriangle}
              badge={parcels.attention > 0 ? `${parcels.attention}` : null}
              badgeTone="red"
              stats={[
                { label: isAr ? 'شحنات معلقة' : 'Attention', value: parcels.attention || 0 },
                { label: isAr ? 'الحالة' : 'Status', value: parcels.attention > 0 ? (isAr ? 'تتطلب قرار' : 'Action needed') : (isAr ? 'مستقرة' : 'All good') },
              ]}
              isAr={isAr}
            />

            {/* 3. Products */}
            <SectionAnalyticsCard
              href="/admin/dashboard/products"
              title={isAr ? 'المنتجات' : 'Products'}
              icon={Package}
              stats={[
                { label: isAr ? 'منشورة' : 'Published', value: products.published },
                { label: isAr ? 'مسودات' : 'Drafts', value: products.draft },
              ]}
              isAr={isAr}
            />

            {/* 4. Pending Approval */}
            <SectionAnalyticsCard
              href="/admin/dashboard/pending-products"
              title={isAr ? 'بانتظار الموافقة' : 'Pending Approval'}
              icon={Bell}
              badge={products.pending > 0 ? `${products.pending}` : null}
              badgeTone={products.pending > 0 ? 'red' : 'green'}
              stats={[
                { label: isAr ? 'منتجات معلقة' : 'Pending', value: products.pending || 0 },
                { label: isAr ? 'الأولوية' : 'Priority', value: products.pending > 0 ? (isAr ? 'مطلوب مراجعة' : 'Review needed') : (isAr ? 'لا يوجد' : 'None') },
              ]}
              isAr={isAr}
            />

            {/* 5. Vendors */}
            <SectionAnalyticsCard
              href="/admin/dashboard/vendors"
              title={isAr ? 'التجار' : 'Vendors'}
              icon={Store}
              stats={[
                { label: isAr ? 'إجمالي التجار' : 'Total', value: vendors.total },
                { label: isAr ? 'جدد هذا الأسبوع' : 'New (7d)', value: vendors.new_7d || 0 },
              ]}
              isAr={isAr}
            />

            {/* 6. Vendor Subscriptions */}
            <SectionAnalyticsCard
              href="/admin/dashboard/subscriptions"
              title={isAr ? 'اشتراكات التجار' : 'Subscriptions'}
              icon={CreditCard}
              badge={subscriptions.expired > 0 ? (isAr ? `${subscriptions.expired} منتهي` : `${subscriptions.expired} Exp`) : null}
              badgeTone="red"
              stats={[
                { label: isAr ? 'اشتراكات نشطة' : 'Active', value: subscriptions.active || 0 },
                { label: isAr ? 'منتهية' : 'Expired', value: subscriptions.expired || 0 },
              ]}
              isAr={isAr}
            />

            {/* 7. Customers */}
            <SectionAnalyticsCard
              href="/admin/dashboard/users"
              title={isAr ? 'العملاء' : 'Customers'}
              icon={Users}
              stats={[
                { label: isAr ? 'عملاء نشطون' : 'Active Users', value: users.total || 0 },
                { label: isAr ? 'مسجلين حديثاً (7d)' : 'New (7d)', value: users.new_7d || 0 },
              ]}
              isAr={isAr}
            />

            {/* 8. Customer Reports */}
            <SectionAnalyticsCard
              href="/admin/dashboard/reports"
              title={isAr ? 'تقارير العملاء' : 'Customer Reports'}
              icon={Ship}
              stats={[
                { label: isAr ? 'سلال متروكة' : 'Carts', value: isAr ? 'متاحة' : 'Available' },
                { label: isAr ? 'مراكب العملاء' : 'Boats', value: isAr ? 'متاحة' : 'Available' },
              ]}
              isAr={isAr}
            />

            {/* 9. Car Email Campaigns */}
            <SectionAnalyticsCard
              href="/admin/dashboard/car-campaigns"
              title={isAr ? 'الحملات البريدية' : 'Email Campaigns'}
              icon={Mail}
              stats={[
                { label: isAr ? 'إجمالي الحملات' : 'Campaigns', value: carCampaigns.total || 0 },
                { label: isAr ? 'تم إرسالها' : 'Sent', value: carCampaigns.sent || 0 },
              ]}
              isAr={isAr}
            />

            {/* 10. Corporate Accounts */}
            <SectionAnalyticsCard
              href="/admin/dashboard/companies"
              title={isAr ? 'حسابات الشركات' : 'Corporate Accounts'}
              icon={Building2}
              stats={[
                { label: isAr ? 'شركات نشطة' : 'Active', value: companies.active || 0 },
                { label: isAr ? 'معلقة' : 'Suspended', value: companies.suspended || 0 },
              ]}
              isAr={isAr}
            />

            {/* 11. Returns & Refunds */}
            <SectionAnalyticsCard
              href="/admin/dashboard/returns"
              title={isAr ? 'المرتجعات والاستردادات' : 'Returns & Refunds'}
              icon={RotateCcw}
              badge={returns.open > 0 ? `${returns.open}` : null}
              badgeTone="red"
              stats={[
                { label: isAr ? 'مرتجعات مفتوحة' : 'Open Returns', value: returns.open || 0 },
                { label: isAr ? 'استرداد معلق' : 'Refunds Pending', value: returns.refunds_pending || 0 },
              ]}
              isAr={isAr}
            />

            {/* 12. Finance */}
            <SectionAnalyticsCard
              href="/admin/dashboard/finance"
              title={isAr ? 'المالية والأرباح' : 'Finance'}
              icon={Landmark}
              stats={[
                { label: isAr ? 'مبيعات 30 يوم' : 'Sales 30d', value: orders.revenue_30d !== undefined ? `${Number(orders.revenue_30d).toLocaleString()} ج.م` : '—' },
                { label: isAr ? 'مدفوعات السحب' : 'Payouts 30d', value: withdrawals.paid_30d !== undefined ? `${Number(withdrawals.paid_30d).toLocaleString()} ج.م` : '—' },
              ]}
              isAr={isAr}
            />

            {/* 13. Withdrawals */}
            <SectionAnalyticsCard
              href="/admin/dashboard/withdrawals"
              title={isAr ? 'طلبات السحب' : 'Withdrawals'}
              icon={Wallet}
              badge={withdrawals.pending > 0 ? `${withdrawals.pending}` : null}
              badgeTone="amber"
              stats={[
                { label: isAr ? 'طلبات معلقة' : 'Pending', value: withdrawals.pending || 0 },
                { label: isAr ? 'تم سحبه (30d)' : 'Paid (30d)', value: withdrawals.paid_30d !== undefined ? `${Number(withdrawals.paid_30d).toLocaleString()} ج.م` : '—' },
              ]}
              isAr={isAr}
            />

            {/* 14. Support Tickets */}
            <SectionAnalyticsCard
              href="/admin/dashboard/tickets"
              title={isAr ? 'تذاكر الدعم' : 'Support Tickets'}
              icon={Ticket}
              badge={tickets.open > 0 ? `${tickets.open}` : null}
              badgeTone="red"
              stats={[
                { label: isAr ? 'تذاكر مفتوحة' : 'Open', value: tickets.open || 0 },
                { label: isAr ? 'قيد الانتظار' : 'Pending', value: tickets.pending || 0 },
              ]}
              isAr={isAr}
            />

            {/* 15. Contact Inquiries */}
            <SectionAnalyticsCard
              href="/admin/dashboard/contact-inquiries"
              title={isAr ? 'رسائل التواصل' : 'Contact Inquiries'}
              icon={Mail}
              badge={inquiries.new > 0 ? `${inquiries.new}` : null}
              badgeTone="amber"
              stats={[
                { label: isAr ? 'رسائل جديدة' : 'New', value: inquiries.new || 0 },
                { label: isAr ? 'الإجمالي' : 'Total', value: inquiries.total || 0 },
              ]}
              isAr={isAr}
            />

            {/* 16. Reviews */}
            <SectionAnalyticsCard
              href="/admin/dashboard/reviews"
              title={isAr ? 'التقييمات والمراجعات' : 'Reviews'}
              icon={Star}
              badge={reviews.pending > 0 ? `${reviews.pending}` : null}
              badgeTone="amber"
              stats={[
                { label: isAr ? 'بانتظار النشر' : 'Pending', value: reviews.pending || 0 },
                { label: isAr ? 'معتمدة' : 'Approved', value: reviews.approved || 0 },
              ]}
              isAr={isAr}
            />

            {/* 17. Coupons */}
            <SectionAnalyticsCard
              href="/admin/dashboard/coupons"
              title={isAr ? 'الكوبونات' : 'Coupons'}
              icon={BadgePercent}
              stats={[
                { label: isAr ? 'كوبونات فعالة' : 'Active', value: coupons.active || 0 },
                { label: isAr ? 'الحالة' : 'Status', value: isAr ? 'سارية' : 'Running' },
              ]}
              isAr={isAr}
            />

            {/* 18. Loyalty Program */}
            <SectionAnalyticsCard
              href="/admin/dashboard/loyalty"
              title={isAr ? 'برنامج الولاء' : 'Loyalty Program'}
              icon={Sparkles}
              stats={[
                { label: isAr ? 'الأعضاء' : 'Members', value: loyalty.members || 0 },
                { label: isAr ? 'النقاط' : 'Points', value: isAr ? 'نشط' : 'Active' },
              ]}
              isAr={isAr}
            />

            {/* 19. Car Brands */}
            <SectionAnalyticsCard
              href="/admin/dashboard/car-brands"
              title={isAr ? 'الماركات البحرية' : 'Marine Brands'}
              icon={Ship}
              stats={[
                { label: isAr ? 'إجمالي الماركات' : 'Total Brands', value: carBrands.total || 0 },
                { label: isAr ? 'الموديلات' : 'Models', value: isAr ? 'متزامنة' : 'Synced' },
              ]}
              isAr={isAr}
            />

            {/* 20. Categories */}
            <SectionAnalyticsCard
              href="/admin/dashboard/categories"
              title={isAr ? 'الأقسام والتصنيفات' : 'Categories'}
              icon={FolderTree}
              stats={[
                { label: isAr ? 'إجمالي الأقسام' : 'Total', value: categories.total || 0 },
                { label: isAr ? 'أقسام نشطة' : 'Active', value: categories.active || 0 },
              ]}
              isAr={isAr}
            />

            {/* 21. Packaging Supplies */}
            <SectionAnalyticsCard
              href="/admin/dashboard/supplies"
              title={isAr ? 'مستلزمات الشحن والتغليف' : 'Packaging Supplies'}
              icon={PackageOpen}
              badge={supplies.pending > 0 ? `${supplies.pending}` : null}
              stats={[
                { label: isAr ? 'طلبات معلقة' : 'Pending', value: supplies.pending || 0 },
                { label: isAr ? 'المخزون' : 'Catalog', value: isAr ? 'جاهز' : 'Ready' },
              ]}
              isAr={isAr}
            />

            {/* 22. Ad Requests */}
            <SectionAnalyticsCard
              href="/admin/dashboard/ad-requests"
              title={isAr ? 'طلبات الإعلانات' : 'Ad Requests'}
              icon={TrendingUp}
              badge={ads.pending > 0 ? `${ads.pending}` : null}
              stats={[
                { label: isAr ? 'طلبات معلقة' : 'Pending', value: ads.pending || 0 },
                { label: isAr ? 'إعلانات جارية' : 'Approved', value: ads.approved || 0 },
              ]}
              isAr={isAr}
            />

            {/* 23. Services */}
            <SectionAnalyticsCard
              href="/admin/dashboard/services"
              title={isAr ? 'الخدمات والصيانة' : 'Services'}
              icon={Wrench}
              stats={[
                { label: isAr ? 'خدمات نشطة' : 'Active', value: services.active || 0 },
                { label: isAr ? 'الإجمالي' : 'Total', value: services.total || 0 },
              ]}
              isAr={isAr}
            />

            {/* 24. Articles & Blog */}
            <SectionAnalyticsCard
              href="/admin/dashboard/articles"
              title={isAr ? 'المقالات والأخبار' : 'Articles'}
              icon={Newspaper}
              stats={[
                { label: isAr ? 'مقالات منشورة' : 'Published', value: articles.published || 0 },
                { label: isAr ? 'مسودات' : 'Drafts', value: articles.draft || 0 },
              ]}
              isAr={isAr}
            />

          </div>
        )}
      </div>
    </div>
  );
}
