'use client';

import { Suspense, useState, useEffect } from 'react';
import { 
  User, 
  MapPin, 
  Package, 
  Lock, 
  LogOut, 
  Settings, 
  Plus, 
  Trash2, 
  Edit, 
  CheckCircle2, 
  Clock, 
  Truck,
  Loader2,
  Car,
  RotateCcw,
  Eye,
  EyeOff,
  Camera,
  Sparkles,
  Users,
  UserPlus,
  Wallet,
  History,
  LifeBuoy,
  Building2
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Link from '../../components/LocaleLink';
import { userApi, vendorApi, familyApi, friendsApi, myCompanyApi } from '../../lib/api';
import { errorText as companyErrorText } from '../../lib/companyLocalization';
import { useRouter, useSearchParams } from '../../lib/navigation';
import { useBrandModels } from '../../lib/carBrandModels';
import VendorProducts from '../../components/VendorProducts';
import ProductCard from '../../components/ProductCard';
import OrderShippingPanel from '../../components/dashboard/OrderShippingPanel';
import ShippingZoneSelect from '../../components/ShippingZoneSelect';
import FamilyTab from '../../components/family/FamilyTab';
import FriendsTab from '../../components/friends/FriendsTab';
import PointsTab from '../../components/loyalty/PointsTab';
import WalletTab from '../../components/wallet/WalletTab';
import CompanyTab from '../../components/company/CompanyTab';
import useMyCompany from '../../components/company/useMyCompany';
import { familyCopy } from '../../lib/familyLocalization';
import { friendCopy } from '../../lib/friendLocalization';
import { loyaltyCopy } from '../../lib/loyaltyLocalization';
import { walletCopy } from '../../lib/walletLocalization';
import { resolveAssetUrl } from '../../lib/assets';
import { stripLocale } from '../../lib/locale';
import { getOrderStatusLabel, getOrderStatusColor, getShipmentStatusLabel, getShipmentStatusColor, getParcelCounterLabel, isReturnStatus, isActiveOrderStatus, CUSTOMER_JOURNEY_META } from '../../lib/orderStatus';
import ParcelCard from '../../components/orders/ParcelCard';
import ParcelJourney from '../../components/orders/ParcelJourney';
import { orgTerms } from '../../lib/orgTerms';
import Overlay from '../../components/Overlay';
import SearchableSelect from '../../components/SearchableSelect';
import { makeOptions, modelOptions, yearOptions } from '../../lib/pickerOptions';

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfilePageFallback />}>
      <ProfilePageContent />
    </Suspense>
  );
}

function ProfilePageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#111315]">
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
  // Which parcel is mid-cancellation, so only that card's button goes busy.
  const [cancellingParcelId, setCancellingParcelId] = useState('');
  const [reviewingParcelId, setReviewingParcelId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showPass, setShowPass] = useState({ old: false, next: false, confirm: false });

  // Form states
  const [infoForm, setInfoForm] = useState({ name: '', email: '', phone: '' });
  const [passForm, setPassForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [addressForm, setAddressForm] = useState({ label: '', recipient_name: '', phone: '', full_address: '', shipping_country: '', shipping_city: '', is_default: false });
  const [editingAddressId, setEditingAddressId] = useState(null);

  // Garage states
  const [carMetadata, setCarMetadata] = useState({ carBrands: [] });
  const [carForm, setCarForm] = useState({ car_brand_id: '', car_model_id: '', year: '' });
  // The makes arrive without their models; the picked make's are fetched on their own.
  const garageModels = useBrandModels(
    (carMetadata.carBrands || []).find(b => String(b._id) === String(carForm.car_brand_id))
  );

  // Vendor states
  const [vendorProducts, setVendorProducts] = useState([]);

  // Ready Marine recommendations (loaded on demand when the tab is opened)
  const [recommendations, setRecommendations] = useState([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recLoaded, setRecLoaded] = useState(false);

  // Count of family requests waiting on this organizer — badges the Family tab.
  const [familyPendingCount, setFamilyPendingCount] = useState(0);
  const { membership: companyMembership } = useMyCompany();
  // Incoming friend requests — badges the Friends tab.
  const [friendRequestCount, setFriendRequestCount] = useState(0);

  useEffect(() => {
    if (!isMounted) return;
    
    if (!user) {
      // Come back to the tab the link pointed at (a friend request, an order) after signing in.
      const here = typeof window !== 'undefined' ? `${stripLocale(window.location.pathname)}${window.location.search}` : '/profile';
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
             fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`)
           ]);
           const metadata = await metadataRes.json();
           setCarMetadata(metadata);
           setProfile(profileData);
           setVendorProducts(productsData);
           setInfoForm({
             name: profileData.store_name || profileData.name || '',
             email: profileData.email || '',
             phone: profileData.phone || ''
           });
        } else {
           const [profileData, ordersData, metadataRes] = await Promise.all([
             userApi.getProfile(),
             userApi.getOrders(),
             fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`)
           ]);
           const metadata = await metadataRes.json();
           setCarMetadata(metadata);
           setProfile(profileData);
           setOrders(ordersData);
           setInfoForm({
             name: profileData.name || '',
             email: profileData.email || '',
             phone: profileData.phone || '',
             preferred_language: profileData.preferred_language || 'en'
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

  /**
   * Cancel one parcel of an order.
   *
   * Only offered while no courier has been booked for it — past that point a driver is
   * committed to collecting it, and the card hides the button and says why instead. The
   * refund is that parcel's own share; the rest of the order carries on.
   */
  const cancelParcel = async (order, parcel) => {
    const label = parcel.vendor_name || (isAr ? 'الشحنة' : 'this parcel');
    // A parcel can be cancelled right up to the moment the courier collects it — including
    // after a courier visit has been booked, which is then trimmed or cancelled for it.
    const courierBooked = parcel.status === 'pickup_scheduled';
    const ok = window.confirm(
      isAr
        ? `إلغاء شحنة ${label}؟ باقي الطلب هيكمل عادي، ولو كنت دافع مقدمًا قيمة الشحنة دي هترجع لمحفظتك.${courierBooked ? ' فيه مندوب محجوز لاستلامها — هيتلغى استلامها.' : ''}`
        : `Cancel the parcel from ${label}? The rest of your order continues, and if you paid up front this parcel's value returns to your wallet.${courierBooked ? ' A courier visit is booked for it — that collection will be cancelled.' : ''}`
    );
    if (!ok) return;

    setCancellingParcelId(String(parcel._id));
    try {
      const res = await userApi.cancelParcel(order._id, parcel._id);
      // Re-read rather than patch in place: cancelling can drop a coupon and re-price the
      // order, and guessing at the new totals in the browser would show the wrong numbers.
      const fresh = await userApi.getOrders();
      setOrders(fresh);
      setMessage({ type: 'success', text: res.message || (isAr ? 'تم إلغاء الشحنة.' : 'Parcel cancelled.') });
    } catch (err) {
      setMessage({ type: 'error', text: err.message || (isAr ? 'تعذر إلغاء الشحنة.' : 'Could not cancel the parcel.') });
    } finally {
      setCancellingParcelId('');
    }
  };

  // A company order waiting in its batch, sent on alone at full shipping (feature 14).
  const shipParcelNow = async (order, parcel) => {
    const ok = window.confirm(isAr
      ? 'تبعته دلوقتي لوحده؟ هيخرج من الدفعة ويتحرك فوراً بالشحن الكامل اللي اتحجز، ومش هيرجعلك توفير.'
      : 'Send it now on its own? It leaves the batch and ships right away at the full shipping already held — no saving comes back.');
    if (!ok) return;
    setCancellingParcelId(String(parcel._id));
    try {
      await myCompanyApi.shipNow(order._id, parcel._id);
      setOrders(await userApi.getOrders());
      setMessage({ type: 'success', text: isAr ? 'اتبعت للمورد — هيتجهز على طول.' : 'Sent to the store — it is being prepared now.' });
    } catch (err) {
      setMessage({ type: 'error', text: companyErrorText(err, isAr) });
    } finally {
      setCancellingParcelId('');
    }
  };

  // Rate one delivered parcel on the same page the WhatsApp message opens.
  const reviewParcel = async (order, parcel) => {
    setReviewingParcelId(String(parcel._id));
    try {
      const res = await userApi.getParcelReviewLink(order._id, parcel._id);
      if (res.submitted) {
        setMessage({ type: 'success', text: isAr ? 'إنت قيّمت الطرد ده قبل كده. شكرًا!' : 'You have already rated this parcel. Thank you!' });
        setOrders(await userApi.getOrders());
        return;
      }
      router.push(res.path || res.url);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || (isAr ? 'تعذر فتح صفحة التقييم.' : 'Could not open the review page.') });
    } finally {
      setReviewingParcelId('');
    }
  };

  // Badge the Family tab with requests awaiting this organizer's decision, so
  // a time-sensitive approval is visible from any tab.
  useEffect(() => {
    if (!isMounted || !user || user.role === 'vendor' || user.role === 'admin') return;
    familyApi.getRequests('pending_approval')
      .then(res => setFamilyPendingCount((res.incoming || []).length))
      .catch(() => setFamilyPendingCount(0));
    friendsApi.getOverview()
      .then(res => setFriendRequestCount((res.incoming_requests || []).length))
      .catch(() => setFriendRequestCount(0));
  }, [isMounted, user]);

  // Load Ready Marine recommendations the first time the tab is opened.
  useEffect(() => {
    if (!isMounted || !user || user.role === 'vendor') return;
    if (searchParams.get('tab') !== 'recommendations' || recLoaded || recLoading) return;
    setRecLoading(true);
    userApi.getRecommendations()
      .then(res => setRecommendations(res.products || []))
      .catch(() => setRecommendations([]))
      .finally(() => { setRecLoading(false); setRecLoaded(true); });
  }, [searchParams, user, isMounted, recLoaded, recLoading]);

  const handleInfoSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await userApi.updateProfile(infoForm);
      setProfile(res.profile);
      login({ ...user, name: res.profile.name, email: res.profile.email });
      setMessage({ type: 'success', text: isAr ? 'تم تحديث البيانات بنجاح' : 'Profile updated successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
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
      setAddressForm({ label: '', recipient_name: '', phone: '', full_address: '', shipping_country: '', shipping_city: '', is_default: false });
      setEditingAddressId(null);
      setMessage({ type: 'success', text: isAr ? 'تم حفظ العنوان بنجاح' : 'Address saved successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteAddressById = async (id) => {
    if (!confirm(isAr ? 'هل أنت متأكد؟' : 'Are you sure?')) return;
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
      const brand = carMetadata.carBrands.find(b => b._id === carForm.car_brand_id);
      const model = garageModels.find(m => m._id === carForm.car_model_id);
      
      const carData = {
        car_brand_id: brand._id,
        car_brand_name: brand.name,
        car_model_id: model._id,
        car_model_name: model.name,
        year: carForm.year
      };

      const res = await userApi.addCar(carData);
      setProfile({ ...profile, cars: res.cars });
      login({ ...user, cars: res.cars });
      setCarForm({ car_brand_id: '', car_model_id: '', year: '' });
      setMessage({ type: 'success', text: isAr ? 'تم حفظ السيارة بنجاح' : 'Car added successfully' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteCarById = async (id) => {
    if (!confirm(isAr ? 'هل أنت متأكد من حذف هذه السيارة؟' : 'Are you sure you want to delete this car?')) return;
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
      <div className="min-h-screen flex items-center justify-center bg-[#111315]">
        <div className="text-center">
          <Loader2 size={40} className="text-marine-primary animate-spin mx-auto mb-4" />
          <p className="text-zinc-400 animate-pulse">{isAr ? 'جاري التحميل...' : 'Loading...'}</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#111315] px-4">
        <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-3xl p-8 text-center backdrop-blur-xl">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Settings className="text-red-400" size={32} />
          </div>
          <h3 className="text-white font-bold text-xl mb-2">{isAr ? 'عذراً، حدث خطأ' : 'Something went wrong'}</h3>
          <p className="text-zinc-400 mb-8">{error || (isAr ? 'تعذر تحميل بيانات الملف الشخصي. يرجى التأكد من تشغيل الخادم.' : 'Could not load profile data. Please ensure the backend server is running.')}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-marine-cyan text-white font-bold py-3 rounded-xl hover:bg-marine-cyan-dark transition-all"
          >
            {isAr ? 'إعادة المحاولة' : 'Try Again'}
          </button>
          {/* The way out when the account cannot load: this page holds the only sign-out. */}
          <button
            onClick={logout}
            className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-red-400 hover:bg-red-500/10 transition-all"
          >
            <LogOut size={18} />
            {t.logout}
          </button>
        </div>
      </div>
    );
  }

  const tabs = user?.role === 'vendor' ? [
    { id: 'info', label: t.storeInfo || 'Store Info', icon: Settings },
    { id: 'products', label: t.myProducts || 'My Products', icon: Package },
    { id: 'security', label: isAr ? 'الأمان' : 'Security', icon: Lock },
  ] : [
    { id: 'info', label: t.personalInfo, icon: User },
    { id: 'addresses', label: t.addresses, icon: MapPin },
    { id: 'garage', label: isAr ? 'جراجي' : 'My Garage', icon: Car },
    { id: 'recommendations', label: isAr ? 'ترشيحات ريدي مارين' : 'Ready Marine Recommendations', icon: Sparkles },
    { id: 'orders', label: isAr ? 'الطلبات الجارية' : 'Active Orders', icon: Package },
    { id: 'orders-history', label: isAr ? 'سجل الطلبات' : 'Order History', icon: History },
    { id: 'wallet', label: walletCopy(isAr).myWallet, icon: Wallet },
    // Only for someone in a company — the tab has nothing to say to anyone else.
    ...(companyMembership ? [{ id: 'company', label: orgTerms(companyMembership.company?.org_type, isAr).mine, icon: Building2 }] : []),
    { id: 'points', label: loyaltyCopy(isAr).myPoints, icon: Sparkles },
    { id: 'family', label: familyCopy(isAr).family, icon: Users, badge: familyPendingCount },
    { id: 'friends', label: friendCopy(isAr).friends, icon: UserPlus, badge: friendRequestCount },
    { id: 'security', label: isAr ? 'الأمان' : 'Security', icon: Lock },
  ];
  const requestedTab = searchParams.get('tab') || 'info';
  const activeTab = tabs.some(tab => tab.id === requestedTab) ? requestedTab : 'info';

  return (
    <div className="min-h-screen bg-[#111315] py-12 px-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row gap-8">
          
          {/* Sidebar */}
          <div className="w-full md:w-72 flex-shrink-0">
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sticky top-24">
              <div className="flex flex-col items-center text-center mb-8">
                <div className="relative mb-4">
                  <div className="w-20 h-20 rounded-full bg-marine-cyan flex items-center justify-center text-white text-3xl font-black shadow-lg shadow-red-950/20 overflow-hidden">
                    {profile?.profile_image ? (
                      <img src={resolveAssetUrl(profile.profile_image)} alt={profile?.name || 'Profile'} className="w-full h-full object-cover" />
                    ) : (
                      profile?.store_name?.[0]?.toUpperCase() || profile?.name?.[0]?.toUpperCase() || 'U'
                    )}
                  </div>
                  {user?.role !== 'vendor' && (
                    <label className="absolute -bottom-1 -end-1 w-8 h-8 rounded-full bg-white text-marine-primary border border-white/20 shadow-lg flex items-center justify-center cursor-pointer hover:bg-zinc-100 transition-colors">
                      {uploadingPhoto ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                      <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={handleProfilePhotoChange} className="hidden" disabled={uploadingPhoto} />
                    </label>
                  )}
                </div>
                <h2 className="text-white font-bold text-xl">{profile?.store_name || profile?.name}</h2>
                {user?.role === 'vendor' && <span className="bg-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md mt-1 mb-1">Vendor</span>}
                <p className="text-zinc-500 text-sm mt-1">{profile?.email}</p>
              </div>

              <div className="space-y-1">
                {tabs.map(tab => (
                  <Link
                    key={tab.id}
                    href={`/profile?tab=${tab.id}`}
                    onClick={() => setMessage({ type: '', text: '' })}
                    className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl font-bold transition-all ${
                      activeTab === tab.id 
                        ? 'bg-marine-cyan text-white shadow-lg' 
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <tab.icon size={18} />
                    <span>{tab.label}</span>
                    {tab.badge > 0 && (
                      <span className={`ms-auto text-[11px] font-black rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center ${
                        activeTab === tab.id ? 'bg-white text-marine-primary' : 'bg-marine-cyan text-white'
                      }`}>
                        {tab.badge}
                      </span>
                    )}
                  </Link>
                ))}
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-4 px-4 py-3 rounded-xl font-bold text-red-400 hover:bg-red-500/10 transition-all mt-4"
                >
                  <LogOut size={18} />
                  <span>{t.logout}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1">
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 min-h-[500px] shadow-2xl">
              
              {message.text && (
                <div className={`mb-8 p-4 rounded-xl text-sm font-bold flex items-center gap-3 animate-in fade-in slide-in-from-top-4 ${
                  message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}>
                   <CheckCircle2 size={18} />
                   <span>{message.text}</span>
                </div>
              )}

              {activeTab === 'info' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                  <h3 className="text-2xl font-black text-white flex items-center gap-3">
                    {user?.role === 'vendor' ? <Settings className="text-marine-primary" /> : <User className="text-marine-primary" />}
                    {user?.role === 'vendor' ? (t.storeInfo || 'Store Info') : t.personalInfo}
                  </h3>
                  <form onSubmit={handleInfoSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                       <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{user?.role === 'vendor' ? 'Store Name' : t.fullName}</label>
                      <input 
                        type="text" 
                        required
                        value={infoForm.name}
                        onChange={e => setInfoForm({ ...infoForm, name: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{t.emailAddress}</label>
                      <input 
                        type="email" 
                        required
                        value={infoForm.email}
                        onChange={e => setInfoForm({ ...infoForm, email: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{t.phoneNumber}</label>
                      <input 
                        type="tel" 
                        required
                        value={infoForm.phone}
                        onChange={e => setInfoForm({ ...infoForm, phone: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan transition-all"
                      />
                    </div>
                    {user?.role !== 'vendor' && (
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">
                          {isAr ? 'لغة الإشعارات' : 'Notification language'}
                        </label>
                        <select
                          value={infoForm.preferred_language || 'en'}
                          onChange={e => setInfoForm({ ...infoForm, preferred_language: e.target.value })}
                          className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan transition-all"
                        >
                          <option value="en" className="text-zinc-900">English</option>
                          <option value="ar" className="text-zinc-900">العربية</option>
                        </select>
                        <p className="text-zinc-600 text-[11px]">
                          {isAr
                            ? 'تُرسل رسائل البريد والإشعارات بهذه اللغة، بغض النظر عن لغة تصفح المُرسِل.'
                            : 'Emails and notifications use this language, regardless of the sender’s browsing language.'}
                        </p>
                      </div>
                    )}
                    <div className="md:col-span-2 pt-4">
                      <button
                        disabled={submitting}
                        className="bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg hover:-translate-y-0.5 flex items-center gap-2"
                      >
                        {submitting && <Loader2 size={16} className="animate-spin" />}
                        {isAr ? 'حفظ التغييرات' : 'Save Changes'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {activeTab === 'products' && user?.role === 'vendor' && (
                 <VendorProducts 
                   vendorProducts={vendorProducts}
                   setVendorProducts={setVendorProducts}
                   carMetadata={carMetadata}
                   language={language}
                   t={t}
                   isAr={isAr}
                 />
              )}

              {activeTab === 'security' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                  <h3 className="text-2xl font-black text-white flex items-center gap-3">
                    <Lock className="text-marine-primary" /> {isAr ? 'تغيير كلمة المرور' : 'Change Password'}
                  </h3>
                  <form onSubmit={handlePasswordSubmit} className="max-w-md space-y-6">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{isAr ? 'كلمة المرور القديمة' : 'Old Password'}</label>
                      <PasswordField
                        value={passForm.oldPassword}
                        visible={showPass.old}
                        onToggle={() => setShowPass(prev => ({ ...prev, old: !prev.old }))}
                        onChange={value => setPassForm({ ...passForm, oldPassword: value })}
                        isAr={isAr}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{isAr ? 'كلمة المرور الجديدة' : 'New Password'}</label>
                      <PasswordField
                        value={passForm.newPassword}
                        visible={showPass.next}
                        onToggle={() => setShowPass(prev => ({ ...prev, next: !prev.next }))}
                        onChange={value => setPassForm({ ...passForm, newPassword: value })}
                        isAr={isAr}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{isAr ? 'تأكيد كلمة المرور' : 'Confirm Password'}</label>
                      <PasswordField
                        value={passForm.confirmPassword}
                        visible={showPass.confirm}
                        onToggle={() => setShowPass(prev => ({ ...prev, confirm: !prev.confirm }))}
                        onChange={value => setPassForm({ ...passForm, confirmPassword: value })}
                        isAr={isAr}
                      />
                    </div>
                    <button 
                      disabled={submitting}
                      className="bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg hover:-translate-y-0.5"
                    >
                      {submitting ? <Loader2 size={16} className="animate-spin inline mr-2" /> : null}
                      {isAr ? 'تحديث كلمة المرور' : 'Update Password'}
                    </button>
                  </form>
                </div>
              )}

              {activeTab === 'addresses' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-black text-white flex items-center gap-3">
                      <MapPin className="text-marine-primary" /> {t.addresses}
                    </h3>
                    <button 
                      onClick={() => { setShowAddressModal(true); setEditingAddressId(null); setAddressForm({ label: '', recipient_name: '', phone: '', full_address: '', shipping_country: '', shipping_city: '', is_default: false }); }}
                      className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg"
                    >
                      <Plus size={18} /> {isAr ? 'إضافة عنوان' : 'Add Address'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {profile?.addresses?.map(addr => (
                      <div key={addr._id} className="bg-white/5 border border-white/10 rounded-2xl p-6 relative group/addr transition-all hover:bg-white/10 hover:border-marine-cyan/30 shadow-xl">
                        {addr.is_default && (
                          <span className="absolute top-4 end-4 bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md">Default</span>
                        )}
                        {addr.label && (
                          <span className="inline-block bg-white/10 text-zinc-300 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md mb-2">
                            {addr.label}
                          </span>
                        )}
                        <h4 className="text-white font-bold text-lg mb-2">{addr.recipient_name}</h4>
                        <p className="text-zinc-400 text-sm mb-1">{addr.phone}</p>
                        <p className="text-zinc-500 text-sm italic">{addr.full_address}</p>
                        
                        <div className="flex items-center gap-4 mt-6">
                          <button 
                            onClick={() => { setEditingAddressId(addr._id); setAddressForm(addr); setShowAddressModal(true); }}
                            className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-xs font-bold transition-colors"
                          >
                            <Edit size={14} /> {isAr ? 'تعديل' : 'Edit'}
                          </button>
                          <button 
                            onClick={() => deleteAddressById(addr._id)}
                            className="flex items-center gap-2 text-red-500 hover:text-red-400 text-xs font-bold transition-colors"
                          >
                            <Trash2 size={14} /> {isAr ? 'حذف' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {showAddressModal && (
                    <Overlay className="fixed inset-0 z-50 flex items-center justify-center p-4">
                      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowAddressModal(false)} />
                      <div className="relative bg-[#09090b] border border-white/10 w-full max-w-lg rounded-3xl p-8 shadow-2xl overflow-hidden">
                        <h4 className="text-xl font-black text-white mb-6 flex items-center gap-2">
                          {editingAddressId ? (isAr ? 'تعديل العنوان' : 'Edit Address') : (isAr ? 'عنوان جديد' : 'New Address')}
                        </h4>
                        <form onSubmit={handleAddressSubmit} className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                              {isAr ? 'اسم مختصر (اختياري)' : 'Label (optional)'}
                            </label>
                            <input
                              type="text" maxLength={40} value={addressForm.label || ''}
                              onChange={e => setAddressForm({...addressForm, label: e.target.value})}
                              placeholder={isAr ? 'المنزل، العمل، منزل الوالدين' : 'Home, Work, Parents’ Home'}
                              className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                            />
                            <p className="text-zinc-600 text-[11px]">
                              {isAr
                                ? 'يساعد أفراد عائلتك على التعرّف على العنوان بسرعة عند الطلب.'
                                : 'Helps your family members recognise this address when they order.'}
                            </p>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{t.fullName}</label>
                            <input 
                              type="text" required value={addressForm.recipient_name}
                              onChange={e => setAddressForm({...addressForm, recipient_name: e.target.value})}
                              className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{t.phoneNumber}</label>
                            <input 
                              type="tel" required value={addressForm.phone}
                              onChange={e => setAddressForm({...addressForm, phone: e.target.value})}
                              className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                            />
                          </div>
                          <ShippingZoneSelect
                            dark
                            country={addressForm.shipping_country || ''}
                            city={addressForm.shipping_city || ''}
                            onChange={({ country, city }) => setAddressForm(f => ({ ...f, shipping_country: country, shipping_city: city }))}
                          />
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{isAr ? 'العنوان الكامل' : 'Full Address'}</label>
                            <textarea
                              required rows="3" value={addressForm.full_address}
                              onChange={e => setAddressForm({...addressForm, full_address: e.target.value})}
                              className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                            />
                          </div>
                          <label className="flex items-center gap-3 text-white text-sm cursor-pointer py-2 group">
                            <input 
                              type="checkbox" checked={addressForm.is_default}
                              onChange={e => setAddressForm({...addressForm, is_default: e.target.checked})}
                              className="w-4 h-4 rounded border-white/20 bg-white/5 text-marine-primary"
                            />
                            <span>{isAr ? 'ضبط كعنوان افتراضي' : 'Set as default address'}</span>
                          </label>
                          <div className="pt-4 flex gap-4">
                            <button type="submit" disabled={submitting} className="flex-1 bg-marine-cyan text-white py-3 rounded-xl font-bold hover:bg-marine-cyan-dark transition-all">
                              {isAr ? 'حفظ' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setShowAddressModal(false)} className="flex-1 bg-white/5 text-zinc-400 py-3 rounded-xl font-bold hover:bg-white/10 transition-all">
                              {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                          </div>
                        </form>
                      </div>
                    </Overlay>
                  )}
                </div>
              )}

              {activeTab === 'recommendations' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                  <div>
                    <h3 className="text-2xl font-black text-white flex items-center gap-3">
                      <Sparkles className="text-marine-primary" /> {isAr ? 'ترشيحات ريدي مارين' : 'Ready Marine Recommendations'}
                    </h3>
                    <p className="text-zinc-400 text-sm mt-2">
                      {isAr
                        ? 'قطع غيار مخصوصة لعربياتك، ومعاها منتجات تنفع مع أي عربية، الأكثر مبيعًا الأول. مش هنرشحلك حاجة اشتريتها في آخر شهر.'
                        : 'Parts made for your cars, with products that fit any car, best sellers first. Nothing you bought in the last month.'}
                    </p>
                  </div>

                  {recLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={32} className="animate-spin text-marine-primary" />
                    </div>
                  ) : (profile?.cars?.length ?? 0) === 0 ? (
                    <div className="bg-white/5 rounded-3xl p-12 text-center border border-dashed border-white/10">
                      <Car size={48} className="text-zinc-600 mx-auto mb-4" />
                      <p className="text-zinc-400 font-bold">
                        {isAr ? 'أضف سيارة إلى جراجك لعرض الترشيحات المناسبة لها.' : 'Add a car to your garage to get recommendations tailored to it.'}
                      </p>
                      <Link href="/profile?tab=garage" className="text-marine-primary mt-2 inline-block hover:underline font-bold">
                        {isAr ? 'الذهاب إلى جراجي' : 'Go to My Garage'}
                      </Link>
                    </div>
                  ) : recommendations.length === 0 ? (
                    <div className="bg-white/5 rounded-3xl p-12 text-center border border-dashed border-white/10">
                      <Sparkles size={48} className="text-zinc-600 mx-auto mb-4" />
                      <p className="text-zinc-400 font-bold">
                        {isAr ? 'لا توجد ترشيحات متاحة لسياراتك حاليًا.' : 'No recommendations available for your cars right now.'}
                      </p>
                      <Link href="/products" className="text-marine-primary mt-2 inline-block hover:underline font-bold">
                        {isAr ? 'تصفّح كل المنتجات' : 'Browse all products'}
                      </Link>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-6">
                      {recommendations.map(product => (
                        <ProductCard key={product._id} product={product} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'garage' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                  <h3 className="text-2xl font-black text-white flex items-center gap-3">
                    <Car className="text-marine-primary" /> {isAr ? 'جراجي' : 'My Garage'}
                  </h3>
                  
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
                    <h4 className="text-lg font-bold text-white mb-4">{isAr ? 'إضافة سيارة جديدة' : 'Add a New Vehicle'}</h4>
                    <form onSubmit={handleAddCar} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-2">
                       {/* Searchable, the makes with their logos, as everywhere a car is picked. */}
                       <SearchableSelect
                         value={carForm.car_brand_id}
                         onChange={(v) => setCarForm({ ...carForm, car_brand_id: v, car_model_id: '', year: '' })}
                         options={makeOptions(carMetadata?.carBrands)}
                         placeholder={isAr ? 'اختر الماركة' : 'Select Brand'}
                         isAr={isAr}
                         buttonClassName="w-full bg-white/5 border border-white/10 text-white rounded-xl ps-4 pe-9 py-3 focus:outline-none focus:border-marine-cyan"
                       />
                       <SearchableSelect
                         value={carForm.car_model_id}
                         onChange={(v) => setCarForm({ ...carForm, car_model_id: v, year: '' })}
                         options={modelOptions(garageModels)}
                         placeholder={isAr ? 'اختر الموديل' : 'Select Model'}
                         disabled={!carForm.car_brand_id}
                         isAr={isAr}
                         buttonClassName="w-full bg-white/5 border border-white/10 text-white rounded-xl ps-4 pe-9 py-3 focus:outline-none focus:border-marine-cyan"
                       />
                       <SearchableSelect
                         value={carForm.year}
                         onChange={(v) => setCarForm({ ...carForm, year: v })}
                         options={yearOptions(garageModels.find(m => m._id === carForm.car_model_id)?.years)}
                         placeholder={isAr ? 'سنة الصنع' : 'Select Year'}
                         disabled={!carForm.car_model_id}
                         isAr={isAr}
                         buttonClassName="w-full bg-white/5 border border-white/10 text-white rounded-xl ps-4 pe-9 py-3 focus:outline-none focus:border-marine-cyan"
                       />
                       <div className="sm:col-span-3 pt-2">
                         <button disabled={submitting || !carForm.year} type="submit" className="bg-marine-cyan text-white font-bold py-3 px-6 rounded-xl hover:bg-marine-cyan-dark transition-all disabled:opacity-50">
                            {isAr ? 'حفظ السيارة' : 'Save Vehicle'}
                         </button>
                       </div>
                    </form>
                  </div>

                  <div className="space-y-4">
                    {profile?.cars?.map(car => (
                      <div key={car._id} className="flex flex-wrap items-center justify-between gap-4 bg-white/5 border border-white/10 p-5 rounded-2xl hover:border-marine-cyan/30 transition-all shadow-xl">
                         <div>
                            <div className="flex items-center gap-2 mb-1">
                               <Car size={16} className="text-marine-primary" />
                               <h4 className="text-white font-bold text-lg">{car.car_brand_name} {car.car_model_name}</h4>
                            </div>
                            <p className="text-zinc-400 text-sm font-medium">{car.year}</p>
                         </div>
                         <button onClick={() => deleteCarById(car._id)} className="flex items-center gap-2 text-red-500 hover:text-red-400 text-xs font-bold transition-colors bg-red-500/10 px-3 py-2 rounded-lg">
                            <Trash2 size={14} /> {isAr ? 'حذف' : 'Remove'}
                         </button>
                      </div>
                    ))}
                    {profile?.cars?.length === 0 && (
                      <p className="text-zinc-500 text-center py-6">{isAr ? 'جراجك فارغ.' : 'Your garage is empty.'}</p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'wallet' && (
                <WalletTab isAr={isAr} />
              )}

              {activeTab === 'company' && (
                <CompanyTab isAr={isAr} />
              )}

              {activeTab === 'points' && (
                <PointsTab isAr={isAr} />
              )}

              {activeTab === 'family' && (
                <FamilyTab
                  isAr={isAr}
                  currency={siteSettings?.currency || 'QAR'}
                  onUnreadChange={setFamilyPendingCount}
                />
              )}

              {activeTab === 'friends' && (
                <FriendsTab
                  isAr={isAr}
                  currency={siteSettings?.currency || 'QAR'}
                  onUnreadChange={setFriendRequestCount}
                />
              )}

              {(activeTab === 'orders' || activeTab === 'orders-history') && (() => {
                /* One list of orders, two tabs over it: what the customer is still waiting
                   on, and everything that has already come to rest. The split is a filter
                   on the same data — both tabs render the identical card. */
                const isHistory = activeTab === 'orders-history';
                const shown = (orders || []).filter(o => isHistory ? !isActiveOrderStatus(o.status) : isActiveOrderStatus(o.status));
                return (
                <div className="space-y-8 animate-in fade-in duration-500">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <h3 className="text-2xl font-black text-white flex items-center gap-3">
                      {isHistory ? <History className="text-marine-primary" /> : <Package className="text-marine-primary" />}
                      {isHistory ? (isAr ? 'سجل الطلبات' : 'Order History') : (isAr ? 'الطلبات الجارية' : 'Active Orders')}
                    </h3>
                    <Link href="/profile/returns"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white/5 border border-white/10 text-zinc-300 hover:bg-marine-cyan/10 hover:border-marine-cyan/30 hover:text-marine-primary transition-all">
                      <RotateCcw size={14} />
                      {isAr ? 'طلبات الإرجاع' : 'My Returns'}
                    </Link>
                  </div>

                  {shown.length === 0 ? (
                    <div className="bg-white/5 rounded-3xl p-12 text-center border border-dashed border-white/10">
                      {isHistory ? <History size={48} className="text-zinc-600 mx-auto mb-4" /> : <Package size={48} className="text-zinc-600 mx-auto mb-4" />}
                      <p className="text-zinc-400 font-bold">
                        {isHistory
                          ? (isAr ? 'لا توجد طلبات منتهية بعد' : 'No past orders yet')
                          : (isAr ? 'لا توجد طلبات جارية حالياً' : 'No orders in progress right now')}
                      </p>
                      {isHistory ? (
                        <Link href="/profile?tab=orders" className="text-marine-primary mt-2 inline-block hover:underline font-bold">
                          {isAr ? 'عرض الطلبات الجارية' : 'View active orders'}
                        </Link>
                      ) : (
                        <Link href="/products" className="text-marine-primary mt-2 inline-block hover:underline font-bold">
                          {isAr ? 'ابدأ التسوق الآن' : 'Start shopping now'}
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {shown.map(order => (
                        <OrderCard
                          key={order._id}
                          order={order}
                          isAr={isAr}
                          language={language}
                          currency={siteSettings?.currency || 'QAR'}
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
                  )}
                </div>
                );
              })()}

            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

/**
 * One order as the customer sees it: the header line, then a card per parcel. Shared by the
 * Active Orders and Order History tabs so the two never drift apart.
 */
function OrderCard({ order, isAr, language, currency, cancellingParcelId, onCancelParcel, onShipParcelNow, onRequestReturn, onContactSupport, onReviewParcel, reviewingParcelId }) {
  return (
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden shadow-xl hover:bg-white/[0.07] transition-all">
        <div className="p-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-white/5">
          <div className="space-y-1">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{isAr ? 'رقم الطلب' : 'Order ID'}</p>
            <p className="text-white font-bold text-sm">#{order._id.slice(-8).toUpperCase()}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{isAr ? 'التاريخ' : 'Date'}</p>
            <p className="text-white font-bold text-sm">{new Date(order.created_at).toLocaleDateString(language === 'ar' ? 'ar-u-ca-gregory' : 'en-US')}</p>
          </div>
          <div className="space-y-1 min-w-[120px]">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{isAr ? 'الإجمالي' : 'Total'}</p>
            <p className="text-marine-primary font-black text-sm">{currency} {order.total_price.toFixed(2)}</p>
          </div>
          <div className="space-y-1">
             <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.1em] flex items-center gap-2 ${getOrderStatusColor(order.status)}`}>
               {isReturnStatus(order.status) ? <RotateCcw size={12} /> :
                order.status === 'completed' ? <CheckCircle2 size={12} /> :
                ['pickup_scheduled','picked_up','in_transit','out_for_delivery'].includes(order.status) ? <Truck size={12} /> : <Clock size={12} />}
               {getOrderStatusLabel(order.status, isAr)}
             </span>
             {/* One word cannot describe three parcels in three different
                 places, so the badge never travels without its counter. */}
             {getParcelCounterLabel(order.parcel_summary, isAr) && (
               <p className="text-[10px] text-zinc-400 text-center font-bold">
                 {getParcelCounterLabel(order.parcel_summary, isAr)}
               </p>
             )}
          </div>
          <Link
            href={`/support/tickets/new?order=${order._id}`}
            title={isAr ? 'إبلاغ الدعم الفني عن مشكلة في الطلب ده' : 'Report a problem with this order to support'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 hover:bg-marine-cyan text-zinc-200 hover:text-white transition-colors"
          >
            <LifeBuoy size={13} /> {isAr ? 'بلّغ عن مشكلة' : 'Report a problem'}
          </Link>
        </div>
        <div className="p-6">
           {/* Where the ORDER is, in seven words, sitting at whichever parcel is furthest
               behind — because the order is not finished until the last box arrives.
               Owner labels are off here: on a basket from three stores "the store" would
               name three different shops, and the parcel cards below say which is which. */}
           {order.journey?.steps?.length > 0 && (
             <div className="mb-5 pb-5 border-b border-white/5">
               <div className="flex items-baseline justify-between gap-3 mb-4">
                 <h3 className="text-xs font-black text-white uppercase tracking-widest">
                   {isAr ? 'رحلة طلبك' : 'Your order journey'}
                 </h3>
                 {order.parcel_summary?.total > 1 && (
                   <span className="text-[10px] font-bold text-zinc-500">
                     {isAr
                       ? `المرحلة بتتحدد بأبطأ شحنة من ${order.parcel_summary.total}`
                       : `Tracks the slowest of ${order.parcel_summary.total} parcels`}
                   </span>
                 )}
               </div>
               <ParcelJourney
                 journey={order.journey}
                 isAr={isAr}
                 labels={CUSTOMER_JOURNEY_META}
                 showOwner={false}
               />
             </div>
           )}

           {/* A card per parcel, each naming the store it comes from. The
               store name is what makes an order arriving in three pieces on
               three days legible — without it the same experience just reads
               as the site behaving strangely. */}
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
                   /* One parcel means the order journey above already told the whole
                      story — a second, identical ladder underneath is noise. */
                   showJourney={order.parcels.length > 1}
                 />
               ))}
             </div>
           ) : (
             /* Orders placed before parcels existed, and never migrated. */
             <div className="flex flex-col gap-4">
               {order.items.map((item, i) => (
                 <div key={i} className="flex items-center gap-4">
                   <div className="w-16 h-16 bg-white/10 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                      <img src={item.product_image} alt={item.product_title} className="w-full h-full object-cover" />
                   </div>
                   <div className="flex-1 min-w-0">
                      <h5 className="text-white font-bold text-base truncate">{item.product_title}</h5>
                      <p className="text-zinc-400 text-sm mt-0.5">{item.variant_label} x {item.quantity}</p>
                      {item.product_slug && (
                        <Link
                          href={`/product/${item.product_slug}`}
                          className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white/10 hover:bg-marine-cyan text-zinc-200 hover:text-white transition-colors"
                        >
                          {isAr ? 'عرض المنتج' : 'View product'}
                        </Link>
                      )}
                   </div>
                   <div className="text-end text-white font-bold text-base">
                     {currency} {item.unit_price.toFixed(2)}
                   </div>
                 </div>
               ))}
             </div>
           )}
           {order.shipping && (
             <div className="mt-4">
               <OrderShippingPanel order={order} isAr={isAr} currency={currency} dark />
             </div>
           )}
           {/* Order-level return stays only for legacy orders — with parcels
               the button lives on the delivered card it applies to. */}
           {order.status === 'completed' && (order.parcels || []).length === 0 && (
             <div className="mt-4 pt-4 border-t border-white/5">
               <Link
                 href={`/profile/returns/request/${order._id}`}
                 className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-white/5 border border-white/10 text-zinc-300 hover:bg-marine-cyan/10 hover:border-marine-cyan/30 hover:text-marine-primary transition-all"
               >
                 <RotateCcw size={14} />
                 {isAr ? 'طلب إرجاع' : 'Request Return'}
               </Link>
             </div>
           )}
        </div>
      </div>
  );
}

function PasswordField({ value, onChange, visible, onToggle, isAr }) {
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        required
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 pe-11 focus:outline-none focus:border-marine-cyan transition-all"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute end-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white focus:outline-none focus:text-marine-primary transition-colors"
        aria-label={visible ? (isAr ? 'إخفاء كلمة المرور' : 'Hide password') : (isAr ? 'إظهار كلمة المرور' : 'Show password')}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
