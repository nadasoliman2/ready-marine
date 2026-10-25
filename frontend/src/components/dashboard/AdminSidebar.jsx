'use client';

import { usePathname } from '../../lib/navigation';
import Link from '../LocaleLink';
import { LayoutDashboard, Package, PackageOpen, Store, X, Settings, LogOut, Bell, Wrench, ShoppingCart, Ticket, FolderTree, Car, CarFront, BadgePercent, Users, UserCheck, CreditCard, FileText, Truck, Mail, Newspaper, RotateCcw, Wallet, Megaphone, Boxes, Sparkles, MessageSquare, Library, AlertTriangle, ShieldCheck, Star, Landmark, Building2, FileBarChart, MailCheck, Wand2, ImageOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAdminAccess } from '../../context/AdminAccessContext';
import BrandMark from '../marine/BrandMark';

export default function AdminSidebar({ isOpen, setIsOpen }) {
  const pathname = usePathname();
  const { t, language, logout, siteSettings } = useApp();
  const { can, isSuper, loading: accessLoading } = useAdminAccess();
  const isAr = language === 'ar';

  const allMenuItems = [
    { name: t.dashboard || 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard', module: null },
    { name: t.users || 'Users', icon: Users, href: '/admin/dashboard/users', module: 'users' },
    // What customers keep in their accounts — carts and cars — so under the customers' permission.
    { name: isAr ? 'تقارير العملاء' : 'Customer Reports', icon: FileBarChart, href: '/admin/dashboard/reports', module: 'users' },
    // The abandoned-cart reminder emails the daily job sent: to whom, and what they looked like.
    { name: isAr ? 'إيميلات تذكير السلة' : 'Cart Reminder Emails', icon: MailCheck, href: '/admin/dashboard/cart-reminders', module: 'users' },
    { name: isAr ? 'حملات السيارات البريدية' : 'Car Email Campaigns', icon: Mail, href: '/admin/dashboard/car-campaigns', module: 'car_campaigns' },
    { name: t.vendors || 'Vendors', icon: Store, href: '/admin/dashboard/vendors', module: 'vendors' },
    // Customers of a different kind: a company buying for its staff on monthly credit.
    { name: isAr ? 'حسابات الشركات والجهات' : 'Corporate Accounts', icon: Building2, href: '/admin/dashboard/companies', module: 'companies' },
    { name: isAr ? 'تأكيد الحسابات' : 'Account Verification', icon: UserCheck, href: '/admin/dashboard/verifications', module: 'verifications' },
    { name: t.subscriptionPlans || 'Subscription Plans', icon: CreditCard, href: '/admin/dashboard/subscription-packages', module: 'subscription_packages' },
    { name: t.vendorSubscriptions || 'Vendor Subscriptions', icon: Package, href: '/admin/dashboard/subscriptions', module: 'subscriptions' },
    { name: t.pendingApproval || 'Pending Approval', icon: Bell, href: '/admin/dashboard/pending-products', module: 'products' },
    { name: t.allProducts || 'Products', icon: Package, href: '/admin/dashboard/products', module: 'products' },
    // Products whose title names cars their fitment does not have — next to Products, since
    // the fix is to the product's own fitment.
    { name: isAr ? 'مراجعة التوافق' : 'Fitment Check', icon: CarFront, href: '/admin/dashboard/fitment-check', module: 'products' },
    // Pictures that look wrong (blurry, small, off-centre, not on white), and cleaner
    // versions of them — beside the fitment check, also a fix to the product itself.
    { name: isAr ? 'مراجعة الصور' : 'Image Check', icon: ImageOff, href: '/admin/dashboard/image-check', module: 'products' },
    { name: isAr ? 'صور المنتجات' : 'Product Images', icon: Wand2, href: '/admin/dashboard/image-studio', module: 'products' },
    // Deliberately a top-level entity next to Products rather than a tab inside
    // it: "what the product is" being separate from "the vendor's offer on it"
    // is the whole point of the catalog.
    { name: isAr ? 'الكتالوج' : 'Catalog', icon: Library, href: '/admin/dashboard/catalog', module: 'catalog' },
    { name: t.bundles || 'Bundles', icon: Boxes, href: '/admin/dashboard/bundles', module: 'bundles' },
    { name: t.orders || 'Orders', icon: ShoppingCart, href: '/admin/dashboard/orders', module: 'orders' },
    // Directly under Orders: the queue of parcels that are stuck and need a decision. Kept
    // top-level because it is the first thing the order team opens each morning, and burying
    // it inside an order means finding it one order at a time.
    { name: isAr ? 'شحنات محتاجة تدخلك' : 'Parcels Needing You', icon: AlertTriangle, href: '/admin/dashboard/parcels', module: 'parcels' },
    { name: t.returns || 'Returns & Refunds', icon: RotateCcw, href: '/admin/dashboard/returns', module: 'returns' },
    // Sits directly above Withdrawals: the two are the push and pull halves of the same
    // money — the admin paying on a schedule, and vendors asking to be paid early.
    { name: isAr ? 'المالية' : 'Finance', icon: Landmark, href: '/admin/dashboard/finance', module: 'finance' },
    { name: t.withdrawals || 'Withdrawals', icon: Wallet, href: '/admin/dashboard/withdrawals', module: 'withdrawals' },
    { name: t.adRequests || 'Ad Requests', icon: Megaphone, href: '/admin/dashboard/ad-requests', module: 'ads' },
    { name: t.pickups || 'Pickups', icon: Truck, href: '/admin/dashboard/pickups', module: 'pickups' },
    { name: isAr ? 'مستلزمات الشحن' : 'Packaging Supplies', icon: PackageOpen, href: '/admin/dashboard/supplies', module: 'supplies' },
    { name: t.contactInquiries || 'Contact Inquiries', icon: Mail, href: '/admin/dashboard/contact-inquiries', module: 'contact_inquiries' },
    { name: t.supportTickets || 'Support Tickets', icon: Ticket, href: '/admin/dashboard/tickets', module: 'tickets' },
    { name: t.coupons || 'Coupons', icon: Ticket, href: '/admin/dashboard/coupons', module: 'coupons' },
    { name: isAr ? 'محافظ العملاء' : 'Customer Wallets', icon: Wallet, href: '/admin/dashboard/wallets', module: 'wallets' },
    { name: isAr ? 'برنامج الولاء' : 'Loyalty Program', icon: Sparkles, href: '/admin/dashboard/loyalty', module: 'loyalty' },
    { name: isAr ? 'التقييمات' : 'Reviews', icon: Star, href: '/admin/dashboard/reviews', module: 'reviews' },
    { name: t.categories || 'Categories', icon: FolderTree, href: '/admin/dashboard/categories', module: 'categories' },
    { name: t.carBrands || 'Car Brands', icon: Car, href: '/admin/dashboard/car-brands', module: 'car_brands' },
    { name: t.productBrands || 'Product Brands', icon: BadgePercent, href: '/admin/dashboard/product-brands', module: 'product_brands' },
    { name: t.services || 'Services', icon: Wrench, href: '/admin/dashboard/services', module: 'services' },
    { name: t.commissions || 'Commissions', icon: BadgePercent, href: '/admin/dashboard/commissions', module: 'settings' },
    { name: t.shipping || 'Shipping', icon: Truck, href: '/admin/dashboard/shipping', module: 'shipping' },
    { name: t.articles || 'Articles', icon: Newspaper, href: '/admin/dashboard/articles', module: 'articles' },
    { name: t.pages || 'Pages', icon: FileText, href: '/admin/dashboard/pages', module: 'pages' },
    { name: t.landingControl || 'Landing Control', icon: Settings, href: '/admin/dashboard/landing', module: 'settings' },
    // Super admin only. Not a grantable module — the server refuses /admin-users to every
    // sub-admin regardless of what this list says.
    { name: isAr ? 'حسابات الإدارة' : 'Admin Accounts', icon: ShieldCheck, href: '/admin/dashboard/admin-users', module: null, superOnly: true }
  ];

  // Only what this account may actually open. While permissions are still loading the list
  // is empty rather than complete — a sidebar that flashes every module before hiding most
  // of them tells a sub-admin exactly what exists and what they are missing.
  const menuItems = accessLoading
    ? []
    : allMenuItems.filter((item) => {
        if (item.superOnly) return isSuper;
        if (!item.module) return true;
        return can(item.module);
      });

  return (
    <aside className={`
      fixed lg:static inset-y-0 ${isAr ? 'right-0' : 'left-0'} z-50
      w-[280px] shrink-0 bg-white dark:bg-[#09090b] border-${isAr ? 'l' : 'r'} border-zinc-200 dark:border-white/10
      flex flex-col transform transition-transform duration-300 ease-in-out
      ${isOpen ? 'translate-x-0' : (isAr ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0')}
    `}>
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-zinc-200 dark:border-white/10 shrink-0">
        <Link href="/" className="flex items-center gap-3 min-h-[40px]">
          {/* The sidebar is light now, so the light-mode logo comes first. */}
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
      <div className="flex-1 overflow-y-auto py-6 px-4 custom-scrollbar">
        <div className="space-y-1 mb-8">
          <p className="px-3 text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">
            {t.mainMenu || 'Main Menu'}
          </p>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/admin/dashboard' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group
                  ${isActive 
                    ? 'bg-marine-cyan/10 text-marine-primary' 
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'}
                `}
              >
                <div className={`
                  p-1.5 rounded-lg transition-colors
                  ${isActive ? 'bg-marine-cyan text-white' : 'group-hover:bg-zinc-200 dark:group-hover:bg-white/10'}
                `}>
                  <Icon size={18} />
                </div>
                <span className="text-sm font-medium">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Footer Area */}
      <div className="p-4 border-t border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-black/20 shrink-0">
        <button 
          onClick={logout}
          className="flex items-center gap-3 w-full px-3 py-2.5 text-zinc-600 dark:text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors group"
        >
          <div className="p-1.5 rounded-lg group-hover:bg-red-400/20 transition-colors">
            <LogOut size={18} />
          </div>
          <span className="text-sm font-medium">{t.logout || 'Logout'}</span>
        </button>
      </div>
    </aside>
  );
}
