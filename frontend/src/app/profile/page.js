'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import {
  RotateCcw,
  CheckCircle2,
  Clock,
  Truck,
  Loader2,
  Settings,
  LogOut,
  Sparkles,
  RefreshCw,
  LifeBuoy
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Link from '../../components/LocaleLink';
import { userApi, vendorApi, familyApi, friendsApi, myCompanyApi, verificationApi } from '../../lib/api';
import { errorText as companyErrorText } from '../../lib/companyLocalization';
import { useRouter, useSearchParams } from '../../lib/navigation';
import { useBrandModels } from '../../lib/carBrandModels';
import VendorProducts from '../../components/VendorProducts';
import ProductCard from '../../components/ProductCard';
import OrderShippingPanel from '../../components/dashboard/OrderShippingPanel';
import FamilyTab from '../../components/family/FamilyTab';
import FriendsTab from '../../components/friends/FriendsTab';
import PointsTab from '../../components/loyalty/PointsTab';
import WalletTab from '../../components/wallet/WalletTab';
import CompanyTab from '../../components/company/CompanyTab';
import useMyCompany from '../../components/company/useMyCompany';
import { walletCopy } from '../../lib/walletLocalization';
import { loyaltyCopy } from '../../lib/loyaltyLocalization';
import { familyCopy } from '../../lib/familyLocalization';
import { friendCopy } from '../../lib/friendLocalization';
import { orgTerms } from '../../lib/orgTerms';
import { stripLocale } from '../../lib/locale';
import {
  getOrderStatusLabel,
  getOrderStatusColor,
  getParcelCounterLabel,
  isReturnStatus,
  isActiveOrderStatus,
  CUSTOMER_JOURNEY_META
} from '../../lib/orderStatus';
import ParcelCard from '../../components/orders/ParcelCard';
import ParcelJourney from '../../components/orders/ParcelJourney';
import AudiencePicker from '../../components/dashboard/AudiencePicker';

import CustomerMainMenu from '../../components/profile/CustomerMainMenu';
import CustomerProfileView from '../../components/profile/CustomerProfileView';
import CustomerSettingsView from '../../components/profile/CustomerSettingsView';
import SettingsDetailPersonalInfo from '../../components/profile/SettingsDetailPersonalInfo';
import SettingsDetailSecurity from '../../components/profile/SettingsDetailSecurity';
import SettingsDetailAddresses from '../../components/profile/SettingsDetailAddresses';
import VerifyEmailChangeView from '../../components/profile/VerifyEmailChangeView';
import ProfileHeaderBar from '../../components/profile/ProfileHeaderBar';

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfilePageFallback />}>
      <ProfilePageContent />
    </Suspense>
  );
}

function ProfilePageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-marine-canvas">
      <Loader2 size={40} className="text-marine-primary animate-spin" />
    </div>
  );
}

function ProfilePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, login, logout, language, isMounted, t, siteSettings } = useApp();
  const isAr = language === 'ar';

  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [cancellingParcelId, setCancellingParcelId] = useState('');
  const [reviewingParcelId, setReviewingParcelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showPass, setShowPass] = useState({ old: false, next: false, confirm: false });

  // Form states
  const [infoForm, setInfoForm] = useState({ name: '', email: '', phone: '', preferred_language: 'en' });
  const [passForm, setPassForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [addressForm, setAddressForm] = useState({
    label: '',
    recipient_name: '',
    phone: '',
    full_address: '',
    shipping_country: '',
    shipping_city: '',
    is_default: false,
  });
  const [editingAddressId, setEditingAddressId] = useState(null);

  // Garage states
  const [carMetadata, setCarMetadata] = useState({ carBrands: [] });
  const [carForm, setCarForm] = useState({ car_brand_id: '', car_model_id: '', year: '' });
  const garageModels = useBrandModels(
    (carMetadata.carBrands || []).find((b) => String(b._id) === String(carForm.car_brand_id))
  );

  // Vendor states
  const [vendorProducts, setVendorProducts] = useState([]);

  // Ready Marine recommendations
  const [recommendations, setRecommendations] = useState([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recLoaded, setRecLoaded] = useState(false);
  const [interests, setInterests] = useState(null);

  // Counters
  const [familyPendingCount, setFamilyPendingCount] = useState(0);
  const { membership: companyMembership } = useMyCompany();
  const [friendRequestCount, setFriendRequestCount] = useState(0);

  useEffect(() => {
    if (!isMounted) return;

    if (!user) {
      const here = typeof window !== 'undefined'
        ? `${stripLocale(window.location.pathname)}${window.location.search}`
        : '/profile';
      router.push(`/login?redirect=${encodeURIComponent(here)}`);
      return;
    }

    if (user.role === 'admin') {
      router.push('/admin/dashboard/landing');
      return;
    }

    if (user.role === 'vendor') {
      router.push('/dashboard');
      return;
    }

    const fetchData = async () => {
      try {
        if (user.role === 'vendor') {
          const [profileData, productsData, metadataRes] = await Promise.all([
            vendorApi.getProfile(),
            vendorApi.getProducts(),
            fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`),
          ]);
          const metadata = await metadataRes.json();
          setCarMetadata(metadata);
          setProfile(profileData);
          setVendorProducts(productsData);
          setInfoForm({
            name: profileData.store_name || profileData.name || '',
            email: profileData.email || '',
            phone: profileData.phone || '',
          });
        } else {
          const [profileData, ordersData, metadataRes] = await Promise.all([
            userApi.getProfile(),
            userApi.getOrders(),
            fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`),
          ]);
          const metadata = await metadataRes.json();
          setCarMetadata(metadata);
          setProfile(profileData);
          setOrders(ordersData);
          setInfoForm({
            name: profileData.name || '',
            email: profileData.email || '',
            phone: profileData.phone || '',
            preferred_language: profileData.preferred_language || 'en',
          });
        }
      } catch (err) {
        console.error('Profile fetch error:', err);
        setError(err.message || 'Failed to load profile data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user, router, isMounted]);

  // Parcel actions
  const cancelParcel = async (order, parcel) => {
    const label = parcel.vendor_name || (isAr ? 'الشحنة' : 'this parcel');
    const courierBooked = parcel.status === 'pickup_scheduled';
    const ok = window.confirm(
      isAr
        ? `إلغاء شحنة ${label}؟ باقي الطلب هيكمل عادي، ولو كنت دافع مقدمًا قيمة الشحنة دي هترجع لمحفظتك.${
            courierBooked ? ' فيه مندوب محجوز لاستلامها — هيتلغى استلامها.' : ''
          }`
        : `Cancel the parcel from ${label}? The rest of your order continues, and if you paid up front this parcel's value returns to your wallet.${
            courierBooked ? ' A courier visit is booked for it — that collection will be cancelled.' : ''
          }`
    );
    if (!ok) return;

    setCancellingParcelId(String(parcel._id));
    try {
      const res = await userApi.cancelParcel(order._id, parcel._id);
      const fresh = await userApi.getOrders();
      setOrders(fresh);
      setMessage({ type: 'success', text: res.message || (isAr ? 'تم إلغاء الشحنة.' : 'Parcel cancelled.') });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.message || (isAr ? 'تعذر إلغاء الشحنة.' : 'Could not cancel the parcel.'),
      });
    } finally {
      setCancellingParcelId('');
    }
  };

  const shipParcelNow = async (order, parcel) => {
    const ok = window.confirm(
      isAr
        ? 'تبعته دلوقتي لوحده؟ هيخرج من الدفعة ويتحرك فوراً بالشحن الكامل اللي اتحجز، ومش هيرجعلك توفير.'
        : 'Send it now on its own? It leaves the batch and ships right away at the full shipping already held — no saving comes back.'
    );
    if (!ok) return;
    setCancellingParcelId(String(parcel._id));
    try {
      await myCompanyApi.shipNow(order._id, parcel._id);
      setOrders(await userApi.getOrders());
      setMessage({
        type: 'success',
        text: isAr ? 'اتبعت للمورد — هيتجهز على طول.' : 'Sent to the store — it is being prepared now.',
      });
    } catch (err) {
      setMessage({ type: 'error', text: companyErrorText(err, isAr) });
    } finally {
      setCancellingParcelId('');
    }
  };

  const reviewParcel = async (order, parcel) => {
    setReviewingParcelId(String(parcel._id));
    try {
      const res = await userApi.getParcelReviewLink(order._id, parcel._id);
      if (res.submitted) {
        setMessage({
          type: 'success',
          text: isAr ? 'إنت قيّمت الطرد ده قبل كده. شكرًا!' : 'You have already rated this parcel. Thank you!',
        });
        setOrders(await userApi.getOrders());
        return;
      }
      router.push(res.path || res.url);
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.message || (isAr ? 'تعذر فتح صفحة التقييم.' : 'Could not open the review page.'),
      });
    } finally {
      setReviewingParcelId('');
    }
  };

  useEffect(() => {
    if (!isMounted || !user || user.role === 'vendor' || user.role === 'admin') return;
    familyApi
      .getRequests('pending_approval')
      .then((res) => setFamilyPendingCount((res.incoming || []).length))
      .catch(() => setFamilyPendingCount(0));
    friendsApi
      .getOverview()
      .then((res) => setFriendRequestCount((res.incoming_requests || []).length))
      .catch(() => setFriendRequestCount(0));
  }, [isMounted, user]);

  const loadRecommendations = useCallback(async () => {
    setRecLoading(true);
    try {
      const res = await userApi.getRecommendations();
      setRecommendations(res.products || []);
    } catch {
      setRecommendations([]);
    } finally {
      setRecLoading(false);
      setRecLoaded(true);
    }
  }, []);

  const requestedView = searchParams.get('view');
  const requestedTab = searchParams.get('tab');
  const fromScreen = searchParams.get('from');

  // Load recommendations if view or tab is recommendations
  useEffect(() => {
    if (!isMounted || !user || user.role === 'vendor') return;
    if ((requestedView === 'recommendations' || requestedTab === 'recommendations') && !recLoaded && !recLoading) {
      loadRecommendations();
    }
  }, [requestedView, requestedTab, user, isMounted, recLoaded, recLoading, loadRecommendations]);

  useEffect(() => {
    if (profile && interests === null) setInterests(profile.interests || []);
  }, [profile, interests]);

  const changeInterests = async (next) => {
    const before = interests;
    setInterests(next);
    setRecLoading(true);
    try {
      const res = await userApi.updateInterests(next);
      setInterests(res.interests || []);
      const recRes = await userApi.getRecommendations();
      setRecommendations(recRes.products || []);
    } catch {
      setInterests(before);
    } finally {
      setRecLoading(false);
      setRecLoaded(true);
    }
  };

  const handleInfoSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await userApi.updateProfile(infoForm);
      setProfile(res.profile);
      if (res.profile?.pending_email) {
        login({ ...user, name: res.profile.name });
        // Redirect to the dedicated email confirmation screen
        router.push('/profile?view=verify-email-change');
      } else {
        login({ ...user, name: res.profile.name, email: res.profile.email });
        setMessage({ type: 'success', text: isAr ? 'تم تحديث البيانات بنجاح' : 'Profile updated successfully' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmEmailCode = async (code) => {
    try {
      const res = await verificationApi.confirm({ target: 'email', code });
      setProfile((prev) => ({
        ...prev,
        email: res.email,
        pending_email: null,
        email_verified_at: new Date(),
      }));
      setInfoForm((prev) => ({
        ...prev,
        email: res.email,
      }));
      login({ ...user, email: res.email });
      setMessage({
        type: 'success',
        text: isAr ? 'تم تأكيد واعتماد بريدك الإلكتروني بنجاح!' : 'Email verified and updated successfully!',
      });
      return true;
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      return false;
    }
  };

  const handleResendEmailCode = async () => {
    try {
      await verificationApi.send({ target: 'email', language });
      setMessage({
        type: 'success',
        text: isAr ? 'تمت إعادة إرسال رمز التحقق بنجاح.' : 'Verification code resent successfully.',
      });
      return true;
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      return false;
    }
  };

  const handleCancelPendingEmail = async () => {
    try {
      await verificationApi.cancelPending('email');
      setProfile((prev) => ({
        ...prev,
        pending_email: null,
      }));
      setInfoForm((prev) => ({
        ...prev,
        email: profile?.email || user?.email || '',
      }));
      setMessage({
        type: 'success',
        text: isAr ? 'تم إلغاء تغيير البريد الإلكتروني.' : 'Email change cancelled.',
      });
      return true;
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      return false;
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (passForm.newPassword !== passForm.confirmPassword) {
      setMessage({ type: 'error', text: isAr ? 'كلمات المرور غير متطابقة' : 'Passwords do not match' });
      return;
    }
    setSubmitting(true);
    try {
      await userApi.changePassword({ oldPassword: passForm.oldPassword, newPassword: passForm.newPassword });
      setPassForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setMessage({ type: 'success', text: isAr ? 'تم تغيير كلمة المرور بنجاح' : 'Password changed successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleProfilePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await userApi.uploadProfilePhoto(file);
      setProfile(res.profile);
      login({ ...user, profile_image: res.profile.profile_image });
      setMessage({ type: 'success', text: isAr ? 'تم تحديث صورة الحساب' : 'Profile photo updated' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message || (isAr ? 'تعذر رفع الصورة' : 'Could not upload photo') });
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleAddressSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let updatedAddresses;
      if (editingAddressId) {
        const res = await userApi.updateAddress(editingAddressId, addressForm);
        updatedAddresses = res.addresses;
      } else {
        const res = await userApi.addAddress(addressForm);
        updatedAddresses = res.addresses;
      }
      setProfile({ ...profile, addresses: updatedAddresses });
      setShowAddressModal(false);
      setAddressForm({
        label: '',
        recipient_name: '',
        phone: '',
        full_address: '',
        shipping_country: '',
        shipping_city: '',
        is_default: false,
      });
      setEditingAddressId(null);
      setMessage({ type: 'success', text: isAr ? 'تم حفظ العنوان بنجاح' : 'Address saved successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteAddressById = async (id) => {
    if (!confirm(isAr ? 'هل أنت متأكد من حذف هذا العنوان؟' : 'Are you sure you want to delete this address?')) return;
    try {
      const res = await userApi.deleteAddress(id);
      setProfile({ ...profile, addresses: res.addresses });
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddCar = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const brand = carMetadata.carBrands.find((b) => b._id === carForm.car_brand_id);
      const model = garageModels.find((m) => m._id === carForm.car_model_id);

      const carData = {
        car_brand_id: brand._id,
        car_brand_name: brand.name,
        car_model_id: model._id,
        car_model_name: model.name,
        year: carForm.year,
      };

      const res = await userApi.addCar(carData);
      setProfile({ ...profile, cars: res.cars });
      login({ ...user, cars: res.cars });
      setCarForm({ car_brand_id: '', car_model_id: '', year: '' });
      setMessage({ type: 'success', text: isAr ? 'تم حفظ المركب بنجاح' : 'Vessel added successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteCarById = async (id) => {
    if (!confirm(isAr ? 'هل أنت متأكد من حذف هذا المركب؟' : 'Are you sure you want to delete this vessel?')) return;
    try {
      const res = await userApi.deleteCar(id);
      setProfile({ ...profile, cars: res.cars });
      login({ ...user, cars: res.cars });
    } catch (err) {
      console.error(err);
    }
  };

  if (!isMounted || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-marine-canvas">
        <div className="text-center">
          <Loader2 size={40} className="text-marine-primary animate-spin mx-auto mb-4" />
          <p className="text-zinc-500 font-bold animate-pulse">{isAr ? 'جاري التحميل...' : 'Loading...'}</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-marine-canvas px-4">
        <div className="max-w-md w-full bg-white border border-zinc-200/80 rounded-3xl p-8 text-center shadow-lg">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Settings className="text-red-500" size={32} />
          </div>
          <h3 className="text-zinc-900 font-bold text-xl mb-2">{isAr ? 'عذراً، حدث خطأ' : 'Something went wrong'}</h3>
          <p className="text-zinc-500 mb-8">
            {error ||
              (isAr
                ? 'تعذر تحميل بيانات الملف الشخصي. يرجى التأكد من تشغيل الخادم.'
                : 'Could not load profile data. Please ensure the backend server is running.')}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-marine-cyan text-white font-bold py-3 rounded-xl hover:bg-marine-cyan-dark transition-all shadow-md"
          >
            {isAr ? 'إعادة المحاولة' : 'Try Again'}
          </button>
          <button
            onClick={logout}
            className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-red-500 hover:bg-red-50 transition-all"
          >
            <LogOut size={18} />
            {t.logout}
          </button>
        </div>
      </div>
    );
  }

  // Determine active view:
  // Step-by-step Facebook Navigation:
  // 1. Main Menu ('menu') -> Default entry
  // 2. Customer Profile ('profile') -> Reached from top card of Menu
  // 3. Settings ('settings') -> Reached from Settings & Privacy in Menu
  // 4. Specific Settings ('setting-personal-info', 'setting-security', 'setting-addresses', 'setting-boats')
  // 5. Feature screens ('orders', 'orders-history', 'wallet', 'points', 'family', 'friends', 'company', 'recommendations')
  let activeView = 'menu';

  if (requestedView) {
    activeView = requestedView;
  } else if (requestedTab) {
    const TAB_MAP = {
      profile: 'profile',
      info: 'setting-personal-info',
      security: 'setting-security',
      addresses: 'setting-addresses',
      garage: 'settings',
      orders: 'orders',
      'orders-history': 'orders-history',
      wallet: 'wallet',
      points: 'points',
      family: 'family',
      friends: 'friends',
      company: 'company',
      recommendations: 'recommendations',
      settings: 'settings',
      menu: 'menu',
    };
    activeView = TAB_MAP[requestedTab] || 'menu';
  }

  const currency = siteSettings?.currency || 'EGP';
  const backToPath = '/profile';

  return (
    <div className="min-h-screen bg-marine-canvas py-6 sm:py-10 px-4 sm:px-6" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-2xl md:max-w-5xl lg:max-w-6xl mx-auto w-full">
        {/* Render View Based on Navigation Step */}

        {/* 1. CUSTOMER PROFILE & DASHBOARD (Unified All-in-One Dashboard) */}
        {(activeView === 'menu' || activeView === 'profile' || activeView === 'settings') && (
          <CustomerMainMenu
            profile={profile}
            user={user}
            orders={orders}
            familyPendingCount={familyPendingCount}
            friendRequestCount={friendRequestCount}
            companyMembership={companyMembership}
            currency={currency}
            isAr={isAr}
            t={t}
            onLogout={logout}
            uploadingPhoto={uploadingPhoto}
            onProfilePhotoChange={handleProfilePhotoChange}
          />
        )}

        {/* 4. SPECIFIC SETTING: PERSONAL INFORMATION */}
        {activeView === 'setting-personal-info' && (
          <SettingsDetailPersonalInfo
            profile={profile}
            user={user}
            infoForm={infoForm}
            setInfoForm={setInfoForm}
            onSubmit={handleInfoSubmit}
            submitting={submitting}
            message={message}
            uploadingPhoto={uploadingPhoto}
            onProfilePhotoChange={handleProfilePhotoChange}
            onConfirmEmailCode={handleConfirmEmailCode}
            onResendEmailCode={handleResendEmailCode}
            onCancelPendingEmail={handleCancelPendingEmail}
            isAr={isAr}
            t={t}
          />
        )}

        {/* 4. DEDICATED SCREEN: VERIFY NEW EMAIL */}
        {activeView === 'verify-email-change' && (
          <VerifyEmailChangeView
            profile={profile}
            user={user}
            onConfirmEmailCode={handleConfirmEmailCode}
            onResendEmailCode={handleResendEmailCode}
            onCancelPendingEmail={handleCancelPendingEmail}
            isAr={isAr}
          />
        )}

        {/* 4. SPECIFIC SETTING: PASSWORD & SECURITY */}
        {activeView === 'setting-security' && (
          <SettingsDetailSecurity
            passForm={passForm}
            setPassForm={setPassForm}
            showPass={showPass}
            setShowPass={setShowPass}
            onSubmit={handlePasswordSubmit}
            submitting={submitting}
            message={message}
            isAr={isAr}
          />
        )}

        {/* 4. SPECIFIC SETTING: SAVED ADDRESSES */}
        {activeView === 'setting-addresses' && (
          <SettingsDetailAddresses
            profile={profile}
            showAddressModal={showAddressModal}
            setShowAddressModal={setShowAddressModal}
            addressForm={addressForm}
            setAddressForm={setAddressForm}
            editingAddressId={editingAddressId}
            setEditingAddressId={setEditingAddressId}
            onSubmit={handleAddressSubmit}
            onDelete={deleteAddressById}
            submitting={submitting}
            isAr={isAr}
            t={t}
          />
        )}

        {/* 5. ACTIVE ORDERS SCREEN */}
        {activeView === 'orders' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <ProfileHeaderBar
              title={isAr ? 'الطلبات الجارية' : 'Active Orders'}
              subtitle={isAr ? 'متابعة شحناتك الحالية وخط سير الطرود' : 'Live parcel delivery status'}
              backHref={backToPath}
              isAr={isAr}
              rightAction={
                <Link
                  href="/profile/returns"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 hover:bg-marine-mist text-zinc-700 hover:text-marine-primary transition-colors"
                >
                  <RotateCcw size={14} />
                  <span>{isAr ? 'طلبات الإرجاع' : 'My Returns'}</span>
                </Link>
              }
            />

            {(() => {
              const activeList = (orders || []).filter((o) => isActiveOrderStatus(o.status));
              if (activeList.length === 0) {
                return (
                  <div className="bg-white border border-dashed border-zinc-200 rounded-3xl p-12 text-center">
                    <Clock size={44} className="text-zinc-400 mx-auto mb-3" />
                    <p className="text-zinc-800 font-bold text-base">
                      {isAr ? 'لا توجد طلبات جارية حالياً' : 'No active orders in progress'}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1 mb-4">
                      {isAr ? 'تصفح منتجاتنا وابدأ رحلتك البحرية الآن' : 'Explore products and start shopping today'}
                    </p>
                    <Link
                      href="/products"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-marine-cyan text-white text-xs font-bold hover:bg-marine-cyan-dark transition-colors shadow-xs"
                    >
                      {isAr ? 'ابدأ التسوق الآن' : 'Start Shopping'}
                    </Link>
                  </div>
                );
              }
              return (
                <div className="space-y-4">
                  {activeList.map((order) => (
                    <OrderCard
                      key={order._id}
                      order={order}
                      isAr={isAr}
                      language={language}
                      currency={currency}
                      cancellingParcelId={cancellingParcelId}
                      onCancelParcel={cancelParcel}
                      onShipParcelNow={shipParcelNow}
                      onRequestReturn={() => router.push(`/profile/returns/request/${order._id}`)}
                      onContactSupport={() => router.push(`/support/tickets/new?order=${order._id}`)}
                      onReviewParcel={(parcel) => reviewParcel(order, parcel)}
                      reviewingParcelId={reviewingParcelId}
                    />
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* 5. ORDER HISTORY SCREEN */}
        {activeView === 'orders-history' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <ProfileHeaderBar
              title={isAr ? 'سجل الطلبات' : 'Order History'}
              subtitle={isAr ? 'عرض فواتير وجميع الطلبات المكتملة والملغاة' : 'All past orders, deliveries, and receipts'}
              backHref={backToPath}
              isAr={isAr}
              rightAction={
                <Link
                  href="/profile/returns"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 hover:bg-marine-mist text-zinc-700 hover:text-marine-primary transition-colors"
                >
                  <RotateCcw size={14} />
                  <span>{isAr ? 'طلبات الإرجاع' : 'My Returns'}</span>
                </Link>
              }
            />

            {(() => {
              const historyList = (orders || []).filter((o) => !isActiveOrderStatus(o.status));
              if (historyList.length === 0) {
                return (
                  <div className="bg-white border border-dashed border-zinc-200 rounded-3xl p-12 text-center">
                    <Clock size={44} className="text-zinc-400 mx-auto mb-3" />
                    <p className="text-zinc-800 font-bold text-base">
                      {isAr ? 'لا توجد طلبات سابقة بعد' : 'No past orders found'}
                    </p>
                    <Link
                      href="/profile?view=orders"
                      className="text-marine-primary mt-2 inline-block hover:underline font-bold text-xs"
                    >
                      {isAr ? 'عرض الطلبات الجارية' : 'View active orders'}
                    </Link>
                  </div>
                );
              }
              return (
                <div className="space-y-4">
                  {historyList.map((order) => (
                    <OrderCard
                      key={order._id}
                      order={order}
                      isAr={isAr}
                      language={language}
                      currency={currency}
                      cancellingParcelId={cancellingParcelId}
                      onCancelParcel={cancelParcel}
                      onShipParcelNow={shipParcelNow}
                      onRequestReturn={() => router.push(`/profile/returns/request/${order._id}`)}
                      onContactSupport={() => router.push(`/support/tickets/new?order=${order._id}`)}
                      onReviewParcel={(parcel) => reviewParcel(order, parcel)}
                      reviewingParcelId={reviewingParcelId}
                    />
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* 5. WALLET SCREEN */}
        {activeView === 'wallet' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <ProfileHeaderBar
              title={walletCopy(isAr).myWallet}
              subtitle={isAr ? 'الرصيد المتاح، عمليات الشحن، وسجل المعاملات' : 'Available balance and top-up transactions'}
              backHref={backToPath}
              isAr={isAr}
            />
            <WalletTab isAr={isAr} />
          </div>
        )}

        {/* 5. LOYALTY POINTS SCREEN */}
        {activeView === 'points' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <ProfileHeaderBar
              title={loyaltyCopy(isAr).myPoints}
              subtitle={isAr ? 'سجل النقاط المكتسبة والمكافآت' : 'Loyalty points and reward history'}
              backHref={backToPath}
              isAr={isAr}
            />
            <PointsTab isAr={isAr} />
          </div>
        )}

        {/* 5. FAMILY ACCOUNT SCREEN */}
        {activeView === 'family' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <ProfileHeaderBar
              title={familyCopy(isAr).family}
              subtitle={isAr ? 'إدارة أفراد العائلة وميزانيات الطلب المشتركة' : 'Manage family members and order allowances'}
              backHref={backToPath}
              isAr={isAr}
            />
            <div className="bg-white border border-zinc-200/90 rounded-3xl p-5 sm:p-7 shadow-sm">
              <FamilyTab
                isAr={isAr}
                currency={currency}
                onUnreadChange={setFamilyPendingCount}
              />
            </div>
          </div>
        )}

        {/* 5. FRIENDS NETWORK SCREEN */}
        {activeView === 'friends' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <ProfileHeaderBar
              title={friendCopy(isAr).friends}
              subtitle={isAr ? 'شبكة الأصدقاء ومشاركة الطلبات' : 'Friends circle and group orders'}
              backHref={backToPath}
              isAr={isAr}
            />
            <div className="bg-white border border-zinc-200/90 rounded-3xl p-5 sm:p-7 shadow-sm">
              <FriendsTab
                isAr={isAr}
                currency={currency}
                onUnreadChange={setFriendRequestCount}
              />
            </div>
          </div>
        )}

        {/* 5. CORPORATE ACCOUNT SCREEN */}
        {activeView === 'company' && companyMembership && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <ProfileHeaderBar
              title={orgTerms(companyMembership.company?.org_type, isAr).mine}
              subtitle={isAr ? 'بوابة حساب الشركة والدفعات المشتركة' : 'Corporate account and pooled shipments'}
              backHref={backToPath}
              isAr={isAr}
            />
            <div className="bg-white border border-zinc-200/90 rounded-3xl p-5 sm:p-7 shadow-sm">
              <CompanyTab isAr={isAr} />
            </div>
          </div>
        )}

        {/* 5. READY MARINE RECOMMENDATIONS SCREEN */}
        {activeView === 'recommendations' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <ProfileHeaderBar
              title={isAr ? 'ترشيحات ريدي مارين' : 'Ready Marine Recommendations'}
              subtitle={isAr ? 'منتجات مختارة خصيصاً لك مبنية على اهتماماتك البحرية' : 'Personalized based on your marine interests'}
              backHref={backToPath}
              isAr={isAr}
              rightAction={
                <button
                  type="button"
                  onClick={loadRecommendations}
                  disabled={recLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-marine-primary bg-marine-mist hover:bg-marine-mist/80 border border-marine-cyan/20 transition-all disabled:opacity-50"
                >
                  <RefreshCw size={14} className={recLoading ? 'animate-spin' : ''} />
                  <span>{isAr ? 'تحديث' : 'Refresh'}</span>
                </button>
              }
            />

            {/* Hubs Selector */}
            <div className="bg-white border border-zinc-200/90 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-marine-cyan animate-pulse" />
                  <h3 className="text-sm font-black text-zinc-900">
                    {isAr ? 'إيه اللي بيهمك في البحر؟' : 'What are you into?'}
                  </h3>
                </div>
                <span className="text-xs text-zinc-500 font-medium">
                  {isAr ? 'اضغط على اهتماماتك لتخصيص المنتجات فورياً' : 'Pick your interests to tailor recommendations'}
                </span>
              </div>
              <AudiencePicker value={interests || []} onChange={changeInterests} isAr={isAr} />
            </div>

            {/* Recommendations Grid */}
            {recLoading ? (
              <div className="bg-white border border-zinc-200/90 rounded-3xl p-12 text-center space-y-3">
                <Loader2 size={36} className="animate-spin text-marine-primary mx-auto" />
                <p className="text-xs font-bold text-zinc-500">{isAr ? 'جاري تجهيز ترشيحاتك...' : 'Loading recommendations...'}</p>
              </div>
            ) : recommendations.length === 0 ? (
              <div className="bg-white border border-dashed border-zinc-200 rounded-3xl p-12 text-center space-y-3">
                <Sparkles size={40} className="text-zinc-400 mx-auto" />
                <p className="text-zinc-700 font-bold text-base">
                  {isAr ? 'لا توجد ترشيحات متاحة حالياً.' : 'No recommendations available right now.'}
                </p>
                <p className="text-zinc-500 text-xs max-w-sm mx-auto">
                  {isAr ? 'جرّب اختيار اهتمامات إضافية من القائمة أعلاه أو تصفح المنتجات' : 'Try selecting more interests above or browse our products'}
                </p>
                <Link
                  href="/products"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-marine-cyan text-white text-xs font-bold hover:bg-marine-cyan-dark transition-colors shadow-xs"
                >
                  {isAr ? 'تصفّح كل المنتجات' : 'Browse all products'}
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider px-1">
                  {isAr ? `عرض ${recommendations.length} منتجات مرشحة لك` : `Showing ${recommendations.length} recommended products`}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {recommendations.map((product) => (
                    <ProductCard key={product._id} product={product} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vendor Products (fallback if vendor) */}
        {activeView === 'products' && user?.role === 'vendor' && (
          <VendorProducts
            vendorProducts={vendorProducts}
            setVendorProducts={setVendorProducts}
            carMetadata={carMetadata}
            language={language}
            t={t}
            isAr={isAr}
          />
        )}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  isAr,
  language,
  currency,
  cancellingParcelId,
  onCancelParcel,
  onShipParcelNow,
  onRequestReturn,
  onContactSupport,
  onReviewParcel,
  reviewingParcelId,
}) {
  return (
    <div className="bg-white border border-zinc-200/90 rounded-2xl overflow-hidden shadow-xs hover:shadow-md transition-all">
      <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/70">
        <div className="space-y-0.5">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{isAr ? 'رقم الطلب' : 'Order ID'}</p>
          <p className="text-zinc-900 font-bold text-xs sm:text-sm">#{order._id.slice(-8).toUpperCase()}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{isAr ? 'التاريخ' : 'Date'}</p>
          <p className="text-zinc-900 font-bold text-xs sm:text-sm">
            {new Date(order.created_at).toLocaleDateString(language === 'ar' ? 'ar-u-ca-gregory' : 'en-US')}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{isAr ? 'الإجمالي' : 'Total'}</p>
          <p className="text-marine-primary font-black text-xs sm:text-sm">
            {currency} {Number(order.total_price || 0).toFixed(2)}
          </p>
        </div>
        <div className="space-y-0.5">
          <span
            className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 ${getOrderStatusColor(
              order.status
            )}`}
          >
            {isReturnStatus(order.status) ? (
              <RotateCcw size={11} />
            ) : order.status === 'completed' ? (
              <CheckCircle2 size={11} />
            ) : ['pickup_scheduled', 'picked_up', 'in_transit', 'out_for_delivery'].includes(order.status) ? (
              <Truck size={11} />
            ) : (
              <Clock size={11} />
            )}
            {getOrderStatusLabel(order.status, isAr)}
          </span>
          {getParcelCounterLabel(order.parcel_summary, isAr) && (
            <p className="text-[10px] text-zinc-500 text-center font-bold">
              {getParcelCounterLabel(order.parcel_summary, isAr)}
            </p>
          )}
        </div>
        <Link
          href={`/support/tickets/new?order=${order._id}`}
          title={isAr ? 'إبلاغ الدعم الفني عن مشكلة في الطلب' : 'Report an issue to support'}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 hover:bg-marine-cyan text-zinc-700 hover:text-white transition-colors"
        >
          <LifeBuoy size={13} />
          <span>{isAr ? 'مشكلة؟' : 'Support'}</span>
        </Link>
      </div>

      <div className="p-4 sm:p-5">
        {order.journey?.steps?.length > 0 && (
          <div className="mb-4 pb-4 border-b border-zinc-100">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h4 className="text-xs font-black text-zinc-900 uppercase tracking-widest">
                {isAr ? 'رحلة طلبك' : 'Your order journey'}
              </h4>
              {order.parcel_summary?.total > 1 && (
                <span className="text-[10px] font-bold text-zinc-500">
                  {isAr
                    ? `المرحلة بأبطأ شحنة من ${order.parcel_summary.total}`
                    : `Slowest of ${order.parcel_summary.total} parcels`}
                </span>
              )}
            </div>
            <ParcelJourney journey={order.journey} isAr={isAr} labels={CUSTOMER_JOURNEY_META} showOwner={false} />
          </div>
        )}

        {(order.parcels || []).length > 0 ? (
          <div className="space-y-3">
            {order.parcels.map((parcel, pi) => (
              <ParcelCard
                key={parcel._id || pi}
                parcel={parcel}
                index={pi}
                total={order.parcels.length}
                currency={currency}
                isAr={isAr}
                busy={cancellingParcelId === String(parcel._id)}
                onCancel={(p) => onCancelParcel(order, p)}
                onShipNow={onShipParcelNow ? (p) => onShipParcelNow(order, p) : null}
                onRequestReturn={onRequestReturn}
                onContactSupport={onContactSupport}
                onReview={onReviewParcel}
                reviewing={reviewingParcelId === String(parcel._id)}
                showJourney={order.parcels.length > 1}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-14 h-14 bg-zinc-50 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-200">
                  <img src={item.product_image} alt={item.product_title} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <h5 className="text-zinc-900 font-bold text-sm truncate">{item.product_title}</h5>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    {item.variant_label} x {item.quantity}
                  </p>
                  {item.product_slug && (
                    <Link
                      href={`/product/${item.product_slug}`}
                      className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-zinc-100 hover:bg-marine-cyan text-zinc-700 hover:text-white transition-colors"
                    >
                      {isAr ? 'عرض المنتج' : 'View product'}
                    </Link>
                  )}
                </div>
                <div className="text-end text-zinc-900 font-bold text-sm">
                  {currency} {Number(item.unit_price || 0).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}

        {order.shipping && (
          <div className="mt-3">
            <OrderShippingPanel order={order} isAr={isAr} currency={currency} dark={false} />
          </div>
        )}
      </div>
    </div>
  );
}
