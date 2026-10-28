'use client';

import { usePathname } from '../../lib/navigation';
import Link from '../LocaleLink';
import {
  LayoutDashboard, Package, PackageOpen, Store, X, Settings, LogOut,
  Bell, Wrench, ShoppingCart, Ticket, FolderTree, Car, CarFront,
  BadgePercent, Users, UserCheck, CreditCard, FileText, Truck, Mail,
  Newspaper, RotateCcw, Wallet, Megaphone, Boxes, Sparkles,
  Library, AlertTriangle, ShieldCheck, Star, Landmark, Building2,
  FileBarChart, MailCheck, Wand2, ImageOff, ExternalLink
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAdminAccess } from '../../context/AdminAccessContext';
import BrandMark from '../marine/BrandMark';

export default function AdminSidebar({ isOpen, setIsOpen }) {
  const pathname = usePathname();
  const { t, language, logout, siteSettings } = useApp();
  const { can, isSuper, loading: accessLoading } = useAdminAccess();
  const isAr = language === 'ar';

  const menuSections = [
    {
      title: null,
      items: [
        { name: isAr ? 'لوحة التحكم' : 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard', module: null },
      ],
    },
    {
      title: isAr ? 'التجار والاشتراكات' : 'Vendors & Subscriptions',
      items: [
        { name: isAr ? 'التجار' : 'Vendors', icon: Store, href: '/admin/dashboard/vendors', module: 'vendors' },
        { name: isAr ? 'تأكيد الحسابات' : 'Account Verification', icon: UserCheck, href: '/admin/dashboard/verifications', module: 'verifications' },
        { name: isAr ? 'حسابات الشركات والجهات' : 'Corporate Accounts', icon: Building2, href: '/admin/dashboard/companies', module: 'companies' },
        { name: isAr ? 'خطط الاشتراك' : 'Subscription Plans', icon: CreditCard, href: '/admin/dashboard/subscription-packages', module: 'subscription_packages' },
        { name: isAr ? 'اشتراكات التجار' : 'Vendor Subscriptions', icon: Package, href: '/admin/dashboard/subscriptions', module: 'subscriptions' },
      ],
    },
    {
      title: isAr ? 'إعداد الكتالوج' : 'Catalog Setup',
      items: [
        { name: isAr ? 'الفئات' : 'Categories', icon: FolderTree, href: '/admin/dashboard/categories', module: 'categories' },
        { name: isAr ? 'الماركات' : 'Product Brands', icon: BadgePercent, href: '/admin/dashboard/product-brands', module: 'product_brands' },
        { name: isAr ? 'تسوق حسب الماركة' : 'Brands / Models', icon: Car, href: '/admin/dashboard/car-brands', module: 'car_brands' },
        { name: isAr ? 'الكتالوج' : 'Catalog', icon: Library, href: '/admin/dashboard/catalog', module: 'catalog' },
      ],
    },
    {
      title: isAr ? 'مراجعة المنتجات' : 'Product Review',
      items: [
        { name: isAr ? 'بانتظار الموافقة' : 'Pending Approval', icon: Bell, href: '/admin/dashboard/pending-products', module: 'products' },
        { name: isAr ? 'مراجعة التوافق' : 'Fitment Check', icon: CarFront, href: '/admin/dashboard/fitment-check', module: 'products' },
        { name: isAr ? 'مراجعة الصور' : 'Image Check', icon: ImageOff, href: '/admin/dashboard/image-check', module: 'products' },
        { name: isAr ? 'صور المنتجات' : 'Product Images', icon: Wand2, href: '/admin/dashboard/image-studio', module: 'products' },
        { name: isAr ? 'جميع المنتجات' : 'All Products', icon: Package, href: '/admin/dashboard/products', module: 'products' },
        { name: isAr ? 'باقات المنتجات' : 'Product Bundles', icon: Boxes, href: '/admin/dashboard/bundles', module: 'bundles' },
      ],
    },
    {
      title: isAr ? 'الطلبات والشحن' : 'Orders & Shipping',
      items: [
        { name: isAr ? 'الطلبات' : 'Orders', icon: ShoppingCart, href: '/admin/dashboard/orders', module: 'orders' },
        { name: isAr ? 'شحنات محتاجة تدخلك' : 'Parcels Needing You', icon: AlertTriangle, href: '/admin/dashboard/parcels', module: 'parcels' },
        { name: isAr ? 'المرتجعات والمستردات' : 'Returns & Refunds', icon: RotateCcw, href: '/admin/dashboard/returns', module: 'returns' },
        { name: isAr ? 'الشحنات / الاستلام' : 'Pickups', icon: Truck, href: '/admin/dashboard/pickups', module: 'pickups' },
        { name: isAr ? 'مستلزمات الشحن' : 'Packaging Supplies', icon: PackageOpen, href: '/admin/dashboard/supplies', module: 'supplies' },
        { name: isAr ? 'إعدادات الشحن' : 'Shipping', icon: Truck, href: '/admin/dashboard/shipping', module: 'shipping' },
      ],
    },
    {
      title: isAr ? 'المالية' : 'Finance',
      items: [
        { name: isAr ? 'المالية' : 'Finance', icon: Landmark, href: '/admin/dashboard/finance', module: 'finance' },
        { name: isAr ? 'محفظة بوسطة' : 'Bosta Wallet', icon: Wallet, href: '/admin/dashboard/finance/bosta-wallet', module: 'finance' },
        { name: isAr ? 'العمولات' : 'Commissions', icon: BadgePercent, href: '/admin/dashboard/commissions', module: 'settings' },
        { name: isAr ? 'طلبات السحب' : 'Withdrawals', icon: Wallet, href: '/admin/dashboard/withdrawals', module: 'withdrawals' },
        { name: isAr ? 'محافظ العملاء' : 'Customer Wallets', icon: CreditCard, href: '/admin/dashboard/wallets', module: 'wallets' },
      ],
    },
    {
      title: isAr ? 'العملاء والتسويق' : 'Customers & Marketing',
      items: [
        { name: isAr ? 'المستخدمون' : 'Users', icon: Users, href: '/admin/dashboard/users', module: 'users' },
        { name: isAr ? 'تقارير العملاء' : 'Customer Reports', icon: FileBarChart, href: '/admin/dashboard/reports', module: 'users' },
        { name: isAr ? 'إيميلات تذكير السلة' : 'Cart Reminder Emails', icon: MailCheck, href: '/admin/dashboard/cart-reminders', module: 'users' },
        { name: isAr ? 'حملات السيارات البريدية' : 'Car Email Campaigns', icon: Mail, href: '/admin/dashboard/car-campaigns', module: 'car_campaigns' },
        { name: isAr ? 'الكوبونات' : 'Coupons', icon: Ticket, href: '/admin/dashboard/coupons', module: 'coupons' },
        { name: isAr ? 'برنامج الولاء' : 'Loyalty Program', icon: Sparkles, href: '/admin/dashboard/loyalty', module: 'loyalty' },
        { name: isAr ? 'طلبات الإعلانات' : 'Ad Requests', icon: Megaphone, href: '/admin/dashboard/ad-requests', module: 'ads' },
      ],
    },
    {
      title: isAr ? 'الدعم' : 'Support',
      items: [
        { name: isAr ? 'تذاكر الدعم' : 'Support Tickets', icon: Ticket, href: '/admin/dashboard/tickets', module: 'tickets' },
        { name: isAr ? 'استفسارات التواصل' : 'Contact Inquiries', icon: Mail, href: '/admin/dashboard/contact-inquiries', module: 'contact_inquiries' },
        { name: isAr ? 'التقييمات' : 'Reviews', icon: Star, href: '/admin/dashboard/reviews', module: 'reviews' },
      ],
    },
    {
      title: isAr ? 'المحتوى والموقع' : 'Content & Website',
      items: [
        { name: isAr ? 'الخدمات' : 'Services', icon: Wrench, href: '/admin/dashboard/services', module: 'services' },
        { name: isAr ? 'المقالات' : 'Articles', icon: Newspaper, href: '/admin/dashboard/articles', module: 'articles' },
        { name: isAr ? 'الصفحات' : 'Pages', icon: FileText, href: '/admin/dashboard/pages', module: 'pages' },
        { name: isAr ? 'التحكم بالصفحة' : 'Landing Control', icon: Settings, href: '/admin/dashboard/landing', module: 'settings' },
      ],
    },
    {
      title: isAr ? 'الإدارة' : 'Administration',
      items: [
        { name: isAr ? 'حسابات الإدارة' : 'Admin Accounts', icon: ShieldCheck, href: '/admin/dashboard/admin-users', module: null, superOnly: true },
      ],
    },
  ];

  // Filter sections by access permissions
  const filteredSections = accessLoading
    ? []
    : menuSections
        .map((sec) => ({
          ...sec,
          items: sec.items.filter((item) => {
            if (item.superOnly) return isSuper;
            if (!item.module) return true;
            return can(item.module);
          }),
        }))
        .filter((sec) => sec.items.length > 0);

  return (
    <aside className={`
      fixed lg:static inset-y-0 ${isAr ? 'right-0' : 'left-0'} z-50
      w-[280px] shrink-0 bg-white dark:bg-[#09090b] border-${isAr ? 'l' : 'r'} border-zinc-200 dark:border-white/10
      flex flex-col transform transition-transform duration-300 ease-in-out
      ${isOpen ? 'translate-x-0' : (isAr ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0')}
    `}>
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-zinc-200 dark:border-white/10 shrink-0">
        <Link
          href="/admin/dashboard"
          onClick={() => setIsOpen(false)}
          title={isAr ? 'لوحة التحكم' : 'Dashboard'}
          className="flex items-center gap-3 min-h-[40px] hover:opacity-85 transition-opacity"
        >
          {siteSettings === null ? null : (siteSettings.logo_light_url || siteSettings.logo_url) ? (
            <img src={siteSettings.logo_light_url || siteSettings.logo_url} alt="Logo" className="h-8 w-auto object-contain max-w-[200px]" />
          ) : (
            <BrandMark compact className="h-8 w-auto object-contain max-w-[200px]" />
          )}
        </Link>
        <button 
          onClick={() => setIsOpen(false)}
          className="lg:hidden ms-auto text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation Menu */}
      <div className="flex-1 overflow-y-auto py-5 px-3.5 custom-scrollbar">
        {filteredSections.map((sec, secIdx) => (
          <div key={sec.title || `sec-${secIdx}`} className="space-y-1 mb-5 last:mb-2">
            {sec.title && (
              <p className="px-3 text-[11px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
                {sec.title}
              </p>
            )}
            {sec.items.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href !== '/admin/dashboard' && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`
                    flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 group
                    ${isActive 
                      ? 'bg-marine-cyan/10 text-marine-primary font-bold shadow-xs' 
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white font-medium'}
                  `}
                >
                  <div className={`
                    p-1.5 rounded-lg transition-colors
                    ${isActive ? 'bg-marine-cyan text-white shadow-xs' : 'group-hover:bg-zinc-200 dark:group-hover:bg-white/10 text-zinc-500'}
                  `}>
                    <Icon size={16} />
                  </div>
                  <span className="text-sm">{item.name}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer Area */}
      <div className="p-3.5 border-t border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-black/20 shrink-0 space-y-1">
        <Link 
          href="/"
          onClick={() => setIsOpen(false)}
          className="flex items-center gap-3 w-full px-3 py-2 text-zinc-600 dark:text-zinc-400 hover:text-marine-primary hover:bg-marine-cyan/10 rounded-xl transition-colors group"
        >
          <div className="p-1.5 rounded-lg group-hover:bg-marine-cyan/20 transition-colors">
            <ExternalLink size={16} />
          </div>
          <span className="text-sm font-medium">{isAr ? 'الرجوع للمتجر' : 'Back to Store'}</span>
        </Link>
        <button 
          onClick={logout}
          className="flex items-center gap-3 w-full px-3 py-2 text-zinc-600 dark:text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors group"
        >
          <div className="p-1.5 rounded-lg group-hover:bg-red-400/20 transition-colors">
            <LogOut size={16} />
          </div>
          <span className="text-sm font-medium">{t.logout || 'Logout'}</span>
        </button>
      </div>
    </aside>
  );
}
