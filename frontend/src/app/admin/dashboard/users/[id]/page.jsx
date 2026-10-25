'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '../../../../../lib/navigation';
import { AlertTriangle, ArrowLeft, ArrowRight, Calendar, Car, CarFront, ExternalLink, Loader2, Mail, MapPin, Package, Phone, ShoppingCart, Trash2, User } from 'lucide-react';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import HardDeleteModal from '../../../../../components/dashboard/HardDeleteModal';

export default function AdminUserProfilePage({ params }) {
  const router = useRouter();
  const { language } = useApp();
  const isAr = language === 'ar';

  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const data = await adminApi.getUserById(params.id);
        setUser(data.user);
        setOrders(data.orders || []);
      } catch (err) {
        setError(err.message || 'Failed to load user profile');
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [params.id]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="h-full flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-4">
          <User size={32} />
        </div>
        <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">{isAr ? 'خطأ' : 'Error'}</h2>
        <p className="text-zinc-500 mb-6">{error || 'User not found'}</p>
        <button
          onClick={() => router.back()}
          className="px-6 py-2 bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 rounded-xl font-bold hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
        >
          {isAr ? 'العودة' : 'Go Back'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="p-2.5 bg-white dark:bg-[#14171A] text-zinc-500 hover:text-zinc-900 dark:hover:text-white rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm transition-colors"
        >
          {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
        </button>
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {isAr ? 'الملف الشخصي للمستخدم' : 'User Profile'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'عرض تفاصيل المستخدم وسجل طلباته' : 'View user details and order history'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: User Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Main Info */}
          <div className="bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/5 shadow-sm p-6">
            <div className="flex flex-col items-center text-center pb-6 border-b border-zinc-100 dark:border-white/5">
              <div className="w-24 h-24 bg-red-50 dark:bg-marine-cyan/10 text-marine-primary rounded-full flex items-center justify-center text-4xl font-black mb-4 shadow-inner">
                {(user.name || 'U').charAt(0).toUpperCase()}
              </div>
              <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{user.name}</h2>
              <p className="text-sm text-zinc-500 mt-1">ID: <span className="font-mono text-xs">{user._id}</span></p>
            </div>

            <div className="pt-6 space-y-4">
              <InfoRow icon={Mail} label={isAr ? 'البريد الإلكتروني' : 'Email'} value={user.email} />
              <InfoRow icon={Phone} label={isAr ? 'رقم الهاتف' : 'Phone'} value={user.phone} dir="ltr" />
              <InfoRow icon={Calendar} label={isAr ? 'تاريخ التسجيل' : 'Registered'} value={formatDate(user.created_at)} />
            </div>
          </div>

          {/* Saved Addresses */}
          <div className="bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
              <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <MapPin size={18} className="text-marine-primary" />
                {isAr ? 'العناوين المحفوظة' : 'Saved Addresses'}
              </h3>
            </div>
            <div className="p-6">
              {user.addresses?.length > 0 ? (
                <div className="space-y-4">
                  {user.addresses.map((address, index) => (
                    <div key={index} className="p-4 rounded-xl border border-zinc-100 dark:border-white/5 bg-zinc-50/50 dark:bg-white/[0.01]">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-bold text-sm text-zinc-900 dark:text-white">{address.recipient_name}</span>
                        {address.is_default && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded bg-marine-cyan/10 text-marine-primary uppercase tracking-wider">
                            {isAr ? 'افتراضي' : 'Default'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mb-1" dir="ltr">{address.phone}</p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{address.full_address}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500 text-center py-4">{isAr ? 'لا توجد عناوين محفوظة' : 'No saved addresses'}</p>
              )}
            </div>
          </div>

          {/* Saved Cars */}
          <div className="bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
              <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <CarFront size={18} className="text-marine-primary" />
                {isAr ? 'المركبات المحفوظة' : 'Saved Vehicles'}
              </h3>
            </div>
            <div className="p-6">
              {user.cars?.length > 0 ? (
                <div className="space-y-3">
                  {user.cars.map((car, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 rounded-xl border border-zinc-100 dark:border-white/5 bg-zinc-50/50 dark:bg-white/[0.01]">
                      <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center">
                        <Car size={18} className="text-zinc-500" />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-zinc-900 dark:text-white">{car.car_brand_name} {car.car_model_name}</p>
                        <p className="text-xs text-zinc-500">{car.year}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500 text-center py-4">{isAr ? 'لا توجد مركبات محفوظة' : 'No saved vehicles'}</p>
              )}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-white dark:bg-[#14171A] rounded-2xl border border-red-200 dark:border-red-500/20 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-red-100 dark:border-red-500/10 bg-red-50/60 dark:bg-red-500/5">
              <h3 className="font-bold text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertTriangle size={18} />
                {isAr ? 'منطقة الخطر' : 'Danger Zone'}
              </h3>
            </div>
            <div className="p-6">
              <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
                {isAr
                  ? 'حذف هذا المستخدم نهائياً سيزيل الحساب وجميع بياناته المرتبطة (الطلبات، المدفوعات، الإرجاع...) بشكل لا يمكن التراجع عنه.'
                  : 'Permanently deleting this user removes the account and all related data (orders, payments, returns…). This cannot be undone.'}
              </p>
              <button
                onClick={() => setShowDelete(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 transition-colors"
              >
                <Trash2 size={16} />
                {isAr ? 'حذف المستخدم نهائياً' : 'Permanently Delete User'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Orders */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden h-full">
            <div className="px-6 py-5 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                <ShoppingCart size={20} className="text-marine-primary" />
                {isAr ? 'سجل الطلبات' : 'Order History'}
                <span className="bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 text-xs py-0.5 px-2 rounded-full ms-2">
                  {orders.length}
                </span>
              </h3>
            </div>

            <div className="p-0">
              {orders.length > 0 ? (
                <div className="divide-y divide-zinc-100 dark:divide-white/5">
                  {orders.map((order) => {
                    const statusConfig = getOrderStatusConfig(order.status);
                    return (
                      <div key={order._id} className="p-6 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                          <div>
                            <p className="text-xs text-zinc-500 mb-1">{formatDate(order.created_at, true)}</p>
                            <p className="font-mono text-sm text-zinc-900 dark:text-zinc-300">#{order._id.slice(-8).toUpperCase()}</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusConfig.className}`}>
                              {isAr ? statusConfig.labelAr : statusConfig.labelEn}
                            </span>
                            <p className="font-black text-zinc-900 dark:text-white">
                              {order.total_price.toFixed(2)} {isAr ? 'ر.س' : 'SAR'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2 custom-scrollbar">
                          {order.items?.map((item, idx) => (
                            <div key={idx} className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-[#0E1012] border border-zinc-100 dark:border-white/5">
                              <Package size={14} className="text-zinc-400" />
                              <span className="text-xs text-zinc-600 dark:text-zinc-300">{item.quantity}x</span>
                              <span className="text-xs text-zinc-900 dark:text-white max-w-[120px] truncate">{item.product_title}</span>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={() => router.push(`/admin/dashboard/orders/${order._id}`)}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs font-bold transition-colors"
                        >
                          <ExternalLink size={14} />
                          {isAr ? 'عرض تفاصيل الطلب' : 'View Order Details'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-16 flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 bg-zinc-50 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
                    <ShoppingCart size={32} className="text-zinc-300 dark:text-zinc-600" />
                  </div>
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">
                    {isAr ? 'لا توجد طلبات' : 'No Orders Yet'}
                  </h3>
                  <p className="text-sm text-zinc-500 max-w-sm">
                    {isAr ? 'هذا المستخدم لم يقم بإجراء أي طلبات حتى الآن.' : 'This user has not placed any orders yet.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <HardDeleteModal
        open={showDelete}
        entityType="user"
        account={user}
        onClose={() => setShowDelete(false)}
        onDeleted={() => {
          router.push(`/admin/dashboard/users?deleted=${encodeURIComponent(user?.name || user?.email || '')}`);
        }}
      />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, dir }) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 bg-zinc-50 dark:bg-white/5 rounded-lg text-zinc-400 shrink-0 mt-0.5">
        <Icon size={16} />
      </div>
      <div>
        <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">{label}</p>
        <p className="text-sm font-bold text-zinc-900 dark:text-white mt-0.5" dir={dir}>{value || '-'}</p>
      </div>
    </div>
  );
}

function formatDate(value, withTime = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function getOrderStatusConfig(status) {
  const configs = {
    pending: { labelEn: 'Pending', labelAr: 'قيد المراجعة', className: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500' },
    processing: { labelEn: 'Processing', labelAr: 'قيد التجهيز', className: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-500' },
    confirmed: { labelEn: 'Confirmed', labelAr: 'مؤكد', className: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-500' },
    ready: { labelEn: 'Ready', labelAr: 'جاهز للشحن', className: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-500' },
    in_transit: { labelEn: 'In Transit', labelAr: 'في الطريق', className: 'bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-500' },
    completed: { labelEn: 'Completed', labelAr: 'مكتمل', className: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-500' },
    cancelled: { labelEn: 'Cancelled', labelAr: 'ملغي', className: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-500' },
  };
  return configs[status] || { labelEn: status, labelAr: status, className: 'bg-zinc-50 text-zinc-600 dark:bg-white/10 dark:text-zinc-400' };
}
