'use client';

import {
  User,
  Lock,
  MapPin,
  Wallet,
  Sparkles,
  Users,
  UserPlus,
  Building2,
  Package,
  History,
  RotateCcw,
  ShieldCheck,
  FileText,
  Truck,
  ChevronLeft,
  ChevronRight,
  Shield,
} from 'lucide-react';
import Link from '../LocaleLink';
import { resolveAssetUrl } from '../../lib/assets';
import ProfileHeaderBar from './ProfileHeaderBar';

function SettingsRow({ href, icon: Icon, iconBg, iconColor, title, subtitle, badge, isAr }) {
  const Chevron = isAr ? ChevronLeft : ChevronRight;
  return (
    <Link
      href={href}
      className="flex items-center justify-between p-4 hover:bg-zinc-50 active:bg-zinc-100/80 transition-colors group"
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <span className={`w-10 h-10 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform`}>
          <Icon size={19} />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-sm text-zinc-900 group-hover:text-marine-primary transition-colors truncate">
            {title}
          </p>
          {subtitle && (
            <p className="text-xs text-zinc-500 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ms-3">
        {badge && (
          <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-marine-mist text-marine-primary border border-marine-cyan/20">
            {badge}
          </span>
        )}
        <Chevron size={17} className="text-zinc-400 group-hover:text-marine-primary transition-colors" />
      </div>
    </Link>
  );
}

function SettingsSection({ title, description, children }) {
  return (
    <div className="space-y-2">
      <div className="px-1">
        <h2 className="text-xs sm:text-sm font-bold text-zinc-900 uppercase tracking-wider">
          {title}
        </h2>
        {description && (
          <p className="text-[11px] sm:text-xs text-zinc-500 mt-0.5">{description}</p>
        )}
      </div>
      <div className="bg-white border border-zinc-200/90 rounded-2xl overflow-hidden shadow-sm divide-y divide-zinc-100">
        {children}
      </div>
    </div>
  );
}

export default function CustomerSettingsView({
  profile,
  user,
  companyMembership,
  familyPendingCount = 0,
  friendRequestCount = 0,
  currency = 'EGP',
  isAr = true,
}) {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header Bar with Back Button to Main Menu */}
      <ProfileHeaderBar
        title={isAr ? 'الإعدادات والخصوصية' : 'Settings & Privacy'}
        subtitle={isAr ? 'إدارة حسابك وتفضيلاتك في ريدي مارين' : 'Manage your account and preferences'}
        backHref="/profile?view=menu"
        isAr={isAr}
      />

      {/* Account Center Style Card */}
      <div className="bg-gradient-to-br from-marine-mist/70 via-white to-zinc-50 border border-marine-cyan/20 rounded-3xl p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-marine-primary font-black text-xs uppercase tracking-wider">
          <Shield size={14} />
          <span>{isAr ? 'مركز الحسابات' : 'Account Center'}</span>
        </div>

        <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed">
          {isAr
            ? 'تحكّم في تفاصيل حسابك والأمان وكلمات المرور وعناوين الشحن في مكان واحد متكامل.'
            : 'Manage your connected profile details, security, passwords, and addresses in one unified place.'}
        </p>

        <Link
          href="/profile?view=setting-personal-info"
          className="flex items-center justify-between p-3.5 bg-white rounded-2xl border border-zinc-200/80 shadow-xs hover:border-marine-cyan/40 hover:shadow-sm transition-all group"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-marine-primary to-marine-cyan flex items-center justify-center text-white text-base font-bold shadow-xs overflow-hidden shrink-0">
              {profile?.profile_image ? (
                <img
                  src={resolveAssetUrl(profile.profile_image)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                profile?.name?.[0]?.toUpperCase() || 'U'
              )}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm text-zinc-900 group-hover:text-marine-primary transition-colors truncate">
                {profile?.name || user?.name}
              </p>
              <p className="text-xs text-zinc-500 truncate">{profile?.email || user?.email}</p>
            </div>
          </div>
          <ChevronRight size={17} className={`text-zinc-400 group-hover:text-marine-primary transition-colors shrink-0 ${isAr ? 'rotate-180' : ''}`} />
        </Link>
      </div>

      {/* Group 1: Account & Personal Info */}
      <SettingsSection
        title={isAr ? 'الحساب والبيانات الشخصية' : 'Account & Personal Details'}
        description={isAr ? 'بيانات الاتصال، كلمة السر، وعناوين التوصيل' : 'Contact info, password, and addresses'}
      >
        <SettingsRow
          href="/profile?view=setting-personal-info"
          icon={User}
          iconBg="bg-sky-50"
          iconColor="text-sky-600"
          title={isAr ? 'المعلومات الشخصية' : 'Personal Information'}
          subtitle={isAr ? 'تعديل الاسم والبريد ورقم الهاتف ولغة الإشعارات' : 'Edit name, email, phone, and notifications'}
          isAr={isAr}
        />
        <SettingsRow
          href="/profile?view=setting-security"
          icon={Lock}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-600"
          title={isAr ? 'كلمة السر والأمان' : 'Password & Security'}
          subtitle={isAr ? 'تغيير كلمة المرور وحماية حسابك' : 'Update your password and secure your account'}
          isAr={isAr}
        />
        <SettingsRow
          href="/profile?view=setting-addresses"
          icon={MapPin}
          iconBg="bg-rose-50"
          iconColor="text-rose-600"
          title={isAr ? 'عناوين التوصيل' : 'Saved Addresses'}
          subtitle={isAr ? 'إضافة وتعديل عناوين الشحن والعنوان الافتراضي' : 'Manage delivery addresses and defaults'}
          badge={profile?.addresses?.length ? `${profile.addresses.length}` : null}
          isAr={isAr}
        />
      </SettingsSection>

      {/* Group 2: Payments & Balance */}
      <SettingsSection
        title={isAr ? 'المدفوعات والمكافآت' : 'Payments & Balances'}
        description={isAr ? 'المحفظة، الرصيد المتاح، ونقاط الولاء' : 'Wallet balance and loyalty rewards'}
      >
        <SettingsRow
          href="/profile?view=wallet&from=settings"
          icon={Wallet}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
          title={isAr ? 'محفظة ريدي مارين' : 'Marine Wallet'}
          subtitle={isAr ? 'رصيدك الحالي، عمليات الشحن، وسجل المعاملات' : 'Available balance, top-ups, and ledger'}
          badge={`${currency} ${Number(profile?.wallet_balance || 0).toFixed(0)}`}
          isAr={isAr}
        />
        <SettingsRow
          href="/profile?view=points&from=settings"
          icon={Sparkles}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          title={isAr ? 'نقاط الولاء' : 'Loyalty Points'}
          subtitle={isAr ? 'سجل النقاط المكتسبة واستبدالها في مشترياتك' : 'Earned points and discount redemption'}
          badge={profile?.loyalty_points ? `${profile.loyalty_points} pt` : null}
          isAr={isAr}
        />
      </SettingsSection>

      {/* Group 3: Social & Connections */}
      <SettingsSection
        title={isAr ? 'المشاركة والروابط' : 'Sharing & Connections'}
        description={isAr ? 'حساب العائلة، شبكة الأصدقاء، وحسابات الشركات' : 'Family sharing, friends network, and company accounts'}
      >
        <SettingsRow
          href="/profile?view=family&from=settings"
          icon={Users}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          title={isAr ? 'حساب العائلة' : 'Family Account'}
          subtitle={isAr ? 'إدارة أفراد العائلة والطلبات المشتركة' : 'Manage family members and approval requests'}
          badge={familyPendingCount > 0 ? `${familyPendingCount}` : null}
          isAr={isAr}
        />
        <SettingsRow
          href="/profile?view=friends&from=settings"
          icon={UserPlus}
          iconBg="bg-teal-50"
          iconColor="text-teal-600"
          title={isAr ? 'شبكة الأصدقاء' : 'Friends Network'}
          subtitle={isAr ? 'دعوة الأصدقاء والطلبات الجماعية' : 'Invite friends and manage orders'}
          badge={friendRequestCount > 0 ? `${friendRequestCount}` : null}
          isAr={isAr}
        />
        {companyMembership && (
          <SettingsRow
            href="/profile?view=company&from=settings"
            icon={Building2}
            iconBg="bg-violet-50"
            iconColor="text-violet-600"
            title={isAr ? 'حساب الشركة' : 'Corporate Account'}
            subtitle={isAr ? 'بوابة الشركة والطلبات المجمعة' : 'Company portal and batch shipments'}
            isAr={isAr}
          />
        )}
      </SettingsSection>

      {/* Group 4: Orders & Services */}
      <SettingsSection
        title={isAr ? 'الطلبات والخدمات' : 'Orders & Services'}
        description={isAr ? 'تتبع الشحنات وسجل المشتريات والمرتجعات' : 'Track parcels, view order history, and returns'}
      >
        <SettingsRow
          href="/profile?view=orders&from=settings"
          icon={Package}
          iconBg="bg-sky-50"
          iconColor="text-sky-600"
          title={isAr ? 'الطلبات الجارية' : 'Active Orders'}
          subtitle={isAr ? 'تتبع رحلة الطرود والشحنات الحالية' : 'Live tracking for parcel shipments'}
          isAr={isAr}
        />
        <SettingsRow
          href="/profile?view=orders-history&from=settings"
          icon={History}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-600"
          title={isAr ? 'سجل الطلبات' : 'Order History'}
          subtitle={isAr ? 'عرض فواتير وجميع الطلبات السابقة' : 'Past orders, receipts, and invoices'}
          isAr={isAr}
        />
        <SettingsRow
          href="/profile/returns"
          icon={RotateCcw}
          iconBg="bg-orange-50"
          iconColor="text-orange-600"
          title={isAr ? 'طلبات الإرجاع' : 'Return Requests'}
          subtitle={isAr ? 'متابعة طلبات استرجاع المنتجات والمبالغ' : 'Check status of return requests'}
          isAr={isAr}
        />
      </SettingsSection>

      {/* Group 5: Preferences & Policies */}
      <SettingsSection
        title={isAr ? 'التفضيلات والسياسات' : 'Preferences & Policies'}
        description={isAr ? 'تخصيص الترشيحات وسياسات المنصة' : 'Personalization hubs and legal policies'}
      >
        <SettingsRow
          href="/profile?view=recommendations&from=settings"
          icon={Sparkles}
          iconBg="bg-purple-50"
          iconColor="text-purple-600"
          title={isAr ? 'ترشيحات ريدي مارين' : 'Personalized Recommendations'}
          subtitle={isAr ? 'تخصيص اهتماماتك البحرية لتلقي أفضل العروض' : 'Tailor marine interests for smart recommendations'}
          isAr={isAr}
        />
        <SettingsRow
          href="/privacy"
          icon={ShieldCheck}
          iconBg="bg-zinc-100"
          iconColor="text-zinc-600"
          title={isAr ? 'سياسة الخصوصية' : 'Privacy Policy'}
          subtitle={isAr ? 'كيف نحمي ونستخدم بياناتك' : 'How we safeguard and use your data'}
          isAr={isAr}
        />
        <SettingsRow
          href="/terms"
          icon={FileText}
          iconBg="bg-zinc-100"
          iconColor="text-zinc-600"
          title={isAr ? 'الشروط والأحكام' : 'Terms & Conditions'}
          subtitle={isAr ? 'قواعد وشروط استخدام منصة ريدي مارين' : 'Platform terms and customer agreements'}
          isAr={isAr}
        />
        <SettingsRow
          href="/shipping"
          icon={Truck}
          iconBg="bg-zinc-100"
          iconColor="text-zinc-600"
          title={isAr ? 'سياسة الشحن والتوصيل' : 'Shipping Policy'}
          subtitle={isAr ? 'مواعيد ورسوم الشحن لكافة المحافظات' : 'Shipping rates and delivery timelines'}
          isAr={isAr}
        />
      </SettingsSection>
    </div>
  );
}
