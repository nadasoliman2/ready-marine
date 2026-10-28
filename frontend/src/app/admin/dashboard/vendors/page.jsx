'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, Eye, EyeOff, Hash, Image as ImageIcon, Loader2, Mail, MapPin, Package, Pencil, Phone, Plus, Search, ShieldOff, Store, User, X, CreditCard, Trash2 } from 'lucide-react';
import { adminApi, adminSubscriptionApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import ShippingZoneSelect from '../../../../components/ShippingZoneSelect';
import HardDeleteModal from '../../../../components/dashboard/HardDeleteModal';
import usePageSize from '../../../../lib/usePageSize';
import Overlay from '../../../../components/Overlay';


const emptyVendor = {
  name: '',
  store_name: '',
  store_username: '',
  email: '',
  phone: '',
  password: '',
  store_image: '',
  locations: []
};

const flattenCategories = (cats, level = 0, result = []) => {
  cats.forEach(cat => {
    result.push({ ...cat, level });
    if (cat.subcategories && cat.subcategories.length > 0) {
      flattenCategories(cat.subcategories, level + 1, result);
    }
  });
  return result;
};

export default function AdminVendorsPage() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusId, setStatusId] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterProducts, setFilterProducts] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyVendor);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.vendors', 10);
  const [expandedVendorId, setExpandedVendorId] = useState('');
  const [vendorSubscriptionData, setVendorSubscriptionData] = useState({});
  const [subscriptionLoadingIds, setSubscriptionLoadingIds] = useState({});
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendingVendor, setSuspendingVendor] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deletingVendor, setDeletingVendor] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [storeImagePreview, setStoreImagePreview] = useState('');
  const [storeImageFile, setStoreImageFile] = useState(null);
  // Edit vendor state
  const [showEdit, setShowEdit] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    store_name: '',
    new_password: '',
    locations: [],
    commission_settings: { is_custom: false, type: 'fixed', fixed_rate: 0, category_rates: [] },
    auto_publish_products: false,
    public_show_on_vendors_page: true,
    public_vendors_page_order: 0,
    public_show_on_home: false,
    public_home_order: 0,
  });
  const [editStoreImagePreview, setEditStoreImagePreview] = useState('');
  const [editStoreImageFile, setEditStoreImageFile] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  // Grant subscription state
  const [grantVendor, setGrantVendor] = useState(null);
  const [grantPackages, setGrantPackages] = useState([]);
  const [grantForm, setGrantForm] = useState({ package_id: '', months: 1 });
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantError, setGrantError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminApi.getVendors();
        setVendors(data.vendors || []);
      } catch (err) {
        setError(err.message || 'Failed to load vendors');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const loadCategories = async () => {
    if (categories.length > 0 || categoriesLoading) return;
    setCategoriesLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/categories`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setCategories(flattenCategories(data));
      } else if (data.success && data.categories) {
        setCategories(flattenCategories(data.categories));
      }
    } catch (err) {
    } finally {
      setCategoriesLoading(false);
    }
  };

  const loadVendorSubscription = async (vendorId) => {
    if (Object.prototype.hasOwnProperty.call(vendorSubscriptionData, vendorId) || subscriptionLoadingIds[vendorId]) return;
    setSubscriptionLoadingIds(prev => ({ ...prev, [vendorId]: true }));
    try {
      const subscription = await adminSubscriptionApi.getVendorSubscription(vendorId);
      setVendorSubscriptionData(prev => ({ ...prev, [vendorId]: subscription }));
    } catch {
      setVendorSubscriptionData(prev => ({ ...prev, [vendorId]: null }));
    } finally {
      setSubscriptionLoadingIds(prev => {
        const next = { ...prev };
        delete next[vendorId];
        return next;
      });
    }
  };

  const toggleExpandedVendor = (vendorId) => {
    const next = expandedVendorId === vendorId ? '' : vendorId;
    setExpandedVendorId(next);
    if (next) loadVendorSubscription(next);
  };

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');

    return vendors.filter(vendor => {
      const matchesSearch = !q || [
        vendor.store_name,
        vendor.store_username,
        vendor.email,
        vendor.phone,
      ].some(value => String(value || '').toLowerCase().includes(q)) ||
        (digits && String(vendor.phone || '').replace(/\D/g, '').includes(digits));

      const matchesStatus = !filterStatus
        || (filterStatus === 'active' ? vendor.status !== 'suspended' : vendor.status === filterStatus);

      const matchesProducts = !filterProducts
        || (filterProducts === 'has_products' ? (vendor.products_count || 0) > 0 : (vendor.products_count || 0) === 0);

      return matchesSearch && matchesStatus && matchesProducts;
    });
  }, [vendors, search, filterStatus, filterProducts]);

  const activeCount = vendors.filter(v => v.status !== 'suspended').length;
  const suspendedCount = vendors.filter(v => v.status === 'suspended').length;
  const withProductsCount = vendors.filter(v => (v.products_count || 0) > 0).length;
  const withoutProductsCount = vendors.filter(v => (v.products_count || 0) === 0).length;

  useEffect(() => {
    setPage(1);
    setExpandedVendorId('');
  }, [search, filterStatus, filterProducts]);

  const paginatedVendors = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredVendors.slice(start, start + pageSize);
  }, [filteredVendors, page, pageSize]);

  const handleAddVendor = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    if (!form.locations || form.locations.length === 0) {
      setError(isAr ? 'يجب إضافة موقع واحد على الأقل للمورد' : 'At least one store location is required.');
      setSaving(false);
      return;
    }

    try {
      // Create vendor without store_image in body (upload separately)
      const { store_image: _si, ...vendorPayload } = form;
      const data = await adminApi.addVendor(vendorPayload);
      let newVendor = data.vendor;

      // Upload store image separately if selected
      if (storeImageFile && newVendor?._id) {
        try {
          const uploadResult = await adminApi.uploadVendorStoreImage(newVendor._id, storeImageFile);
          newVendor = uploadResult.vendor || newVendor;
        } catch {}
      }

      setVendors(prev => [newVendor, ...prev]);
      setForm(emptyVendor);
      setStoreImagePreview('');
      setStoreImageFile(null);
      setShowAdd(false);
    } catch (err) {
      setError(err.message || 'Failed to add vendor');
    } finally {
      setSaving(false);
    }
  };

  const handleStoreImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStoreImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setStoreImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const openEditVendor = (vendor) => {
    loadCategories();
    setEditingVendor(vendor);
    setEditForm({
      name: vendor.name || '',
      store_name: vendor.store_name || '',
      new_password: '',
      locations: vendor.locations || [],
      commission_settings: vendor.commission_settings || { is_custom: false, type: 'fixed', fixed_rate: 0, category_rates: [] },
      auto_publish_products: vendor.auto_publish_products || false,
      public_show_on_vendors_page: vendor.public_show_on_vendors_page !== false,
      public_vendors_page_order: Number(vendor.public_vendors_page_order || 0),
      public_show_on_home: Boolean(vendor.public_show_on_home),
      public_home_order: Number(vendor.public_home_order || 0),
    });
    setEditStoreImagePreview(vendor.store_image ? (vendor.store_image.startsWith('http') ? vendor.store_image : `${process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:4000'}${vendor.store_image}`) : '');
    setEditStoreImageFile(null);
    setShowEdit(true);
  };

  const handleEditStoreImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setEditStoreImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setEditStoreImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleEditVendor = async (e) => {
    e.preventDefault();
    if (!editingVendor) return;
    setEditSaving(true);
    setError('');
    if (!editForm.locations || editForm.locations.length === 0) {
      setError(isAr ? 'يجب إضافة موقع واحد على الأقل للمورد' : 'At least one store location is required.');
      setEditSaving(false);
      return;
    }
    if (editForm.new_password && editForm.new_password.length < 8) {
      setError(isAr ? 'يجب أن تكون كلمة المرور الجديدة 8 أحرف على الأقل.' : 'New password must be at least 8 characters.');
      setEditSaving(false);
      return;
    }

    try {
      let updatedVendor;
      // Update text fields
      const { new_password, ...vendorFields } = editForm;
      const payload = new_password ? { ...vendorFields, new_password } : vendorFields;
      const textResult = await adminApi.updateVendor(editingVendor._id, payload);
      updatedVendor = textResult.vendor;

      // Upload store image if changed
      if (editStoreImageFile) {
        const uploadResult = await adminApi.uploadVendorStoreImage(editingVendor._id, editStoreImageFile);
        updatedVendor = uploadResult.vendor || updatedVendor;
      }

      setVendors(prev => prev.map(v => v._id === editingVendor._id ? updatedVendor : v));
      setShowEdit(false);
      setEditingVendor(null);
    } catch (err) {
      setError(err.message || 'Failed to update vendor');
    } finally {
      setEditSaving(false);
    }
  };

  const addLocation = (isEdit = false) => {
    const setter = isEdit ? setEditForm : setForm;
    setter(prev => ({
      ...prev,
      locations: [...(prev.locations || []), { address: '', is_default: prev.locations?.length === 0 }]
    }));
  };

  const removeLocation = (index, isEdit = false) => {
    const setter = isEdit ? setEditForm : setForm;
    setter(prev => {
      const newLocs = prev.locations.filter((_, i) => i !== index);
      if (prev.locations[index]?.is_default && newLocs.length > 0) {
        newLocs[0].is_default = true;
      }
      return { ...prev, locations: newLocs };
    });
  };

  const updateLocation = (index, field, value, isEdit = false) => {
    const setter = isEdit ? setEditForm : setForm;
    setter(prev => ({
      ...prev,
      locations: prev.locations.map((loc, i) => i === index ? { ...loc, [field]: value } : loc)
    }));
  };

  const setDefaultLocation = (index, isEdit = false) => {
    const setter = isEdit ? setEditForm : setForm;
    setter(prev => ({
      ...prev,
      locations: prev.locations.map((loc, i) => ({ ...loc, is_default: i === index }))
    }));
  };

  const toggleVendorStatus = async (vendor) => {
    const nextStatus = vendor.status === 'suspended' ? 'active' : 'suspended';

    if (nextStatus === 'suspended') {
      setSuspendingVendor(vendor);
      setSuspendReason('');
      setShowSuspendModal(true);
      return;
    }

    setStatusId(vendor._id);
    setError('');
    try {
      const data = await adminSubscriptionApi.updateVendorStatus(vendor._id, 'active', null);
      setVendors(prev => prev.map(item => item._id === vendor._id ? data.vendor : item));
    } catch (err) {
      setError(err.message || 'Failed to update vendor status');
    } finally {
      setStatusId(null);
    }
  };

  const openGrantModal = async (vendor) => {
    setGrantVendor(vendor);
    setGrantError('');
    setGrantForm({ package_id: '', months: 1 });
    try {
      const data = await adminSubscriptionApi.getPackages();
      const active = (Array.isArray(data) ? data : data.packages || []).filter(p => p.status === 'active');
      setGrantPackages(active);
      if (active.length > 0) setGrantForm(f => ({ ...f, package_id: active[0]._id }));
    } catch {
      setGrantPackages([]);
    }
  };

  const handleGrant = async () => {
    if (!grantForm.package_id) { setGrantError('Please select a package.'); return; }
    const months = Number(grantForm.months);
    if (!months || months < 1 || months > 24) { setGrantError('Enter a number of months between 1 and 24.'); return; }
    setGrantSaving(true);
    setGrantError('');
    try {
      await adminSubscriptionApi.grantVendorSubscription(grantVendor._id, { package_id: grantForm.package_id, months });
      // Refresh subscription badge for this vendor
      const updated = await adminSubscriptionApi.getVendorSubscription(grantVendor._id);
      setVendorSubscriptionData(prev => ({ ...prev, [grantVendor._id]: updated }));
      // Reflect active status in vendor list
      setVendors(prev => prev.map(v => v._id === grantVendor._id ? { ...v, subscription_status: 'active' } : v));
      setGrantVendor(null);
    } catch (err) {
      setGrantError(err.message || 'Failed to grant subscription.');
    } finally {
      setGrantSaving(false);
    }
  };

  const confirmSuspend = async () => {
    if (!suspendReason.trim()) return;
    setStatusId(suspendingVendor._id);
    setError('');
    try {
      const data = await adminSubscriptionApi.updateVendorStatus(suspendingVendor._id, 'suspended', suspendReason.trim());
      setVendors(prev => prev.map(item => item._id === suspendingVendor._id ? data.vendor : item));
      setShowSuspendModal(false);
      setSuspendingVendor(null);
      setSuspendReason('');
    } catch (err) {
      setError(err.message || 'Failed to suspend vendor');
    } finally {
      setStatusId(null);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

    return (
      <>
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
                {isAr ? 'إدارة التجار' : 'Vendors'}
              </h1>
              <p className="text-sm text-zinc-500 mt-1">
                {isAr ? 'عرض التجار، إضافة تاجر جديد، وتعليق الحسابات.' : 'View vendors, add new vendors, and suspend accounts.'}
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold shadow-lg shadow-red-500/20 transition-all"
            >
              <Plus size={18} />
              {isAr ? 'إضافة تاجر' : 'Add Vendor'}
            </button>
          </div>

          {successMsg && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-xl text-sm font-bold">
              {successMsg}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Store} label={isAr ? 'كل التجار' : 'Total Vendors'} value={vendors.length} />
            <StatCard icon={CheckCircle2} label={isAr ? 'نشط' : 'Active'} value={activeCount} tone="green" />
            <StatCard icon={Package} label={isAr ? 'لديهم منتجات' : 'With Products'} value={withProductsCount} tone="blue" />
            <StatCard icon={ShieldOff} label={isAr ? 'بدون منتجات' : 'Without Products'} value={withoutProductsCount} tone="amber" />
          </div>

          <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={isAr ? 'ابحث باسم المتجر، اسم المستخدم، البريد، أو الهاتف' : 'Search store name, username, email, or phone'}
                  className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
                />
              </div>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="w-full md:w-48 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-marine-cyan"
              >
                <option value="">{isAr ? 'كل حالات التجار' : 'All Vendor Statuses'}</option>
                <option value="active">{isAr ? 'نشط' : 'Active'}</option>
                <option value="suspended">{isAr ? 'معلق' : 'Suspended'}</option>
              </select>
              <select
                value={filterProducts}
                onChange={e => setFilterProducts(e.target.value)}
                className="w-full md:w-56 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-marine-cyan"
              >
                <option value="">{isAr ? 'حسب المنتجات (الكل)' : 'Products (All)'}</option>
                <option value="has_products">{isAr ? 'تجار لديهم منتجات' : 'With Products'}</option>
                <option value="no_products">{isAr ? 'تجار بدون منتجات' : 'Without Products'}</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
                  <tr className={isAr ? 'text-right' : 'text-left'}>
                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'المتجر' : 'Store'}</th>
                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'التواصل' : 'Contact'}</th>
                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'المنتجات' : 'Products'}</th>
                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px] hidden lg:table-cell">{isAr ? 'تاريخ الإنشاء' : 'Created'}</th>
                    <th className={`px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px] ${isAr ? 'text-left' : 'text-right'}`}>{isAr ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  {paginatedVendors.map(vendor => {
                    const suspended = vendor.status === 'suspended';
                    const toggling = statusId === vendor._id;
                    const expanded = expandedVendorId === vendor._id;

                    return (
                      <Fragment key={vendor._id}>
                        <tr className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-black ${suspended ? 'bg-red-50 text-red-500 dark:bg-red-500/10' : 'bg-marine-mist text-marine-primary dark:bg-marine-cyan/10'}`}>
                                {(vendor.store_name || 'V').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-black text-zinc-900 dark:text-white">{vendor.store_name}</p>
                                <p className="text-xs text-zinc-500">@{vendor.store_username}</p>
                                <p className="text-[11px] text-zinc-400 mt-0.5">{vendor.name}</p>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {vendor.public_show_on_vendors_page !== false && (
                                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                                      {isAr ? 'صفحة التجار' : 'Directory'}
                                    </span>
                                  )}
                                  {vendor.public_show_on_home && (
                                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
                                      {isAr ? 'الرئيسية' : 'Home'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="space-y-1">
                              <p className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300"><Mail size={14} className="text-zinc-400" /> {vendor.email}</p>
                              <p className="flex items-center gap-2 text-zinc-500"><Phone size={14} className="text-zinc-400" /> <span dir="ltr">{vendor.phone}</span></p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                              (vendor.products_count || 0) > 0
                                ? 'bg-marine-cyan/10 text-marine-primary dark:text-marine-cyan border border-marine-cyan/20'
                                : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                            }`}>
                              <Package size={13} />
                              <span>{vendor.products_count || 0} {isAr ? 'منتج' : 'products'}</span>
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${suspended ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'}`}>
                              {suspended ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                              {suspended ? (isAr ? 'معلق' : 'Suspended') : (isAr ? 'نشط' : 'Active')}
                            </span>
                          </td>
                          <td className="px-6 py-4 hidden lg:table-cell">
                            <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{formatDate(vendor.created_at)}</p>
                          </td>
                          <td className={`px-6 py-4 ${isAr ? 'text-left' : 'text-right'}`}>
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={() => toggleExpandedVendor(vendor._id)}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
                              >
                                <Eye size={14} />
                                {expanded ? (isAr ? 'إخفاء' : 'Hide') : (isAr ? 'عرض' : 'View')}
                              </button>
                              <button
                                onClick={() => openEditVendor(vendor)}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10"
                              >
                                <Pencil size={14} />
                                {isAr ? 'تعديل' : 'Edit'}
                              </button>
                              <button
                                onClick={() => openGrantModal(vendor)}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-colors bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400"
                              >
                                <CreditCard size={14} />
                                {isAr ? 'منح اشتراك' : 'Grant Sub'}
                              </button>
                              <button
                                onClick={() => toggleVendorStatus(vendor)}
                                disabled={toggling}
                                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-colors disabled:opacity-50 ${suspended ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400'}`}
                              >
                                {toggling ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
                                {suspended ? (isAr ? 'تفعيل' : 'Reactivate') : (isAr ? 'تعليق' : 'Suspend')}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-zinc-50/80 dark:bg-white/[0.02]">
                            <td colSpan={6} className="px-6 py-5">
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                <DetailItem icon={Hash} label="Vendor ID" value={vendor._id} />
                                <DetailItem icon={User} label={isAr ? 'اسم المسؤول' : 'Owner Name'} value={vendor.name} />
                                <DetailItem icon={Store} label={isAr ? 'اسم المتجر' : 'Store Name'} value={vendor.store_name} />
                                <DetailItem icon={Store} label={isAr ? 'اسم المستخدم' : 'Store Username'} value={`@${vendor.store_username}`} />
                                <DetailItem icon={Mail} label={isAr ? 'البريد الإلكتروني' : 'Email Address'} value={vendor.email} />
                                <DetailItem icon={Phone} label={isAr ? 'رقم الهاتف' : 'Phone Number'} value={vendor.phone} dir="ltr" />
                                <div className="xl:col-span-4 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] p-3">
                                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5">
                                    <MapPin size={13} />
                                    {isAr ? 'الفروع / المواقع' : 'Branches / Locations'}
                                  </div>
                                  <div className="space-y-2">
                                    {vendor.locations?.length > 0 ? (
                                      vendor.locations.map((loc, idx) => (
                                        <div key={idx} className="text-sm flex items-center gap-2">
                                          <div className={`w-2 h-2 rounded-full ${loc.is_default ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
                                          <span className={loc.is_default ? 'font-black text-zinc-900 dark:text-white' : 'text-zinc-500'}>
                                            {loc.address} {loc.is_default && (isAr ? '(الافتراضي)' : '(Default)')}
                                          </span>
                                        </div>
                                      ))
                                    ) : (
                                      <p className="text-sm text-zinc-400 italic">{isAr ? 'لا توجد فروع مضافة' : 'No locations added'}</p>
                                    )}
                                  </div>
                                </div>
                                <DetailItem icon={CheckCircle2} label={isAr ? 'الحالة' : 'Status'} value={vendor.status || 'active'} />
                                {vendor.suspension_reason && (
                                    <DetailItem icon={AlertTriangle} label={isAr ? 'سبب التعليق' : 'Suspension Reason'} value={vendor.suspension_reason} />
                                )}
                                {vendor.suspension_date && (
                                    <DetailItem icon={Calendar} label={isAr ? 'تاريخ التعليق' : 'Suspended At'} value={formatDate(vendor.suspension_date, true)} />
                                )}
                                {(() => {
                                    const sub = vendorSubscriptionData[vendor._id];
                                    if (subscriptionLoadingIds[vendor._id]) {
                                      return (
                                        <div className="xl:col-span-4 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] p-3">
                                          <div className="flex items-center gap-2 text-sm font-bold text-zinc-500">
                                            <Loader2 size={14} className="animate-spin text-marine-primary" />
                                            {isAr ? 'جاري تحميل بيانات الاشتراك...' : 'Loading subscription details...'}
                                          </div>
                                        </div>
                                      );
                                    }
                                    if (!sub) return null;
                                    return (
                                        <>
                                            <DetailItem icon={CreditCard} label={isAr ? 'الباقة' : 'Plan'} value={sub.package?.name || '-'} />
                                            <DetailItem icon={Hash} label={isAr ? 'المنتجات' : 'Products'} value={`${sub.publishedCount || 0} / ${sub.maxProducts || 0}`} />
                                            {sub.subscription?.expires_at && (
                                                <DetailItem icon={Calendar} label={isAr ? 'ينتهي' : 'Expires'} value={formatDate(sub.subscription.expires_at)} />
                                            )}
                                        </>
                                    );
                                })()}
                                <DetailItem icon={Calendar} label={isAr ? 'تاريخ الإنشاء' : 'Created At'} value={formatDate(vendor.created_at, true)} />
                              </div>

                              {/* Danger Zone — permanent delete (requires suspension first) */}
                              <div className="mt-4 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/60 dark:bg-red-500/5 p-4">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-red-500 mb-2">
                                  <AlertTriangle size={13} />
                                  {isAr ? 'منطقة الخطر' : 'Danger Zone'}
                                </div>
                                {suspended ? (
                                  <>
                                    <p className="text-sm text-zinc-500 mb-3 leading-relaxed">
                                      {isAr
                                        ? 'حذف هذا التاجر نهائياً سيزيل الحساب وجميع منتجاته وإعلاناته وأرباحه واشتراكاته بشكل لا يمكن التراجع عنه.'
                                        : 'Permanently deleting this vendor removes the account and all its products, ads, earnings and subscriptions. This cannot be undone.'}
                                    </p>
                                    <button
                                      onClick={() => { setDeletingVendor(vendor); setShowDelete(true); }}
                                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black bg-red-600 hover:bg-red-700 text-white transition-colors"
                                    >
                                      <Trash2 size={14} />
                                      {isAr ? 'حذف التاجر نهائياً' : 'Permanently Delete Vendor'}
                                    </button>
                                  </>
                                ) : (
                                  <p className="text-sm text-zinc-500 leading-relaxed">
                                    {isAr
                                      ? 'يجب تعليق التاجر أولاً قبل أن يتمكن من الحذف النهائي.'
                                      : 'Suspend this vendor first before it can be permanently deleted.'}
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <PaginationControls
              page={page}
              pageSize={pageSize}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              total={filteredVendors.length}
              onPageChange={setPage}
              labels={{
                showing: isAr ? 'عرض' : 'Showing',
                of: isAr ? 'من' : 'of',
                previous: isAr ? 'الصفحة السابقة' : 'Previous page',
                next: isAr ? 'الصفحة التالية' : 'Next page',
              }}
            />

            {filteredVendors.length === 0 && (
              <div className="py-16 text-center">
                <Store size={44} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
                <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'لا يوجد تجار مطابقون' : 'No vendors match your search'}</p>
              </div>
            )}
          </div>

          {/* Edit Vendor Modal */}
          {showEdit && editingVendor && (
            <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-xl max-h-[90vh] bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5 shrink-0">
                  <div>
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">{isAr ? 'تعديل بيانات التاجر' : 'Edit Vendor'}</h2>
                    <p className="text-xs text-zinc-500 mt-1">@{editingVendor.store_username}</p>
                  </div>
                  <button onClick={() => setShowEdit(false)} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleEditVendor} className="p-5 space-y-4 overflow-y-auto min-h-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <VendorInput icon={User} label={isAr ? 'اسم المسؤول' : 'Owner Name'} value={editForm.name} onChange={v => setEditForm(p => ({ ...p, name: v }))} />
                    <VendorInput icon={Store} label={isAr ? 'اسم المتجر' : 'Store Name'} value={editForm.store_name} onChange={v => setEditForm(p => ({ ...p, store_name: v }))} />
                    <div className="md:col-span-2">
                      <VendorInput
                        label={isAr ? 'كلمة مرور جديدة' : 'New Password'}
                        type="password"
                        value={editForm.new_password}
                        onChange={v => setEditForm(p => ({ ...p, new_password: v }))}
                        placeholder={isAr ? 'اتركها فارغة للإبقاء على كلمة المرور الحالية' : 'Leave blank to keep current password'}
                        required={false}
                      />
                    </div>
                    
                    {/* Multi-Location Management (Edit) */}
                    <div className="md:col-span-2 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'عناوين الفروع' : 'Branch Locations'}</label>
                        <button type="button" onClick={() => addLocation(true)} className="text-xs font-bold text-marine-primary hover:text-red-600 flex items-center gap-1">
                          <Plus size={14} /> {isAr ? 'إضافة فرع' : 'Add Branch'}
                        </button>
                      </div>
                      <div className="space-y-3">
                        {editForm.locations?.map((loc, idx) => (
                          <div key={idx} className="space-y-2 bg-zinc-50 dark:bg-white/[0.02] p-3 rounded-xl border border-zinc-100 dark:border-white/5">
                            <div className="flex gap-2">
                              <input
                                type="text" required placeholder={isAr ? 'العنوان' : 'Address'}
                                value={loc.address}
                                onChange={e => updateLocation(idx, 'address', e.target.value, true)}
                                className="flex-1 bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-marine-cyan"
                              />
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input type="radio" checked={loc.is_default} onChange={() => setDefaultLocation(idx, true)} className="w-4 h-4 accent-marine-cyan" />
                                <span className="text-[10px] font-bold text-zinc-400">{isAr ? 'افتراضي' : 'Default'}</span>
                              </label>
                              <button type="button" onClick={() => removeLocation(idx, true)} className="p-2 text-zinc-400 hover:text-red-500"><Trash2 size={16} /></button>
                            </div>
                            <ShippingZoneSelect dark country={loc.shipping_country || ''} city={loc.shipping_city || ''} onChange={({ country, city }) => { updateLocation(idx, 'shipping_country', country, true); updateLocation(idx, 'shipping_city', city, true); }} />
                            {/* Bosta Sync Status */}
                            <div className="flex items-center gap-2 mt-1">
                              {loc.bosta_location_id ? (
                                <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-lg whitespace-nowrap flex items-center gap-1">
                                  <CheckCircle2 size={10} />
                                  {isAr ? 'متزامن مع بوسطة' : 'Synced to Bosta'}
                                </span>
                              ) : loc.shipping_city ? (
                                <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-lg whitespace-nowrap flex items-center gap-1">
                                  <AlertTriangle size={10} />
                                  {isAr ? 'سيتم المزامنة عند الحفظ' : 'Will sync to Bosta on save'}
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 dark:bg-white/5 px-2 py-1 rounded-lg whitespace-nowrap">
                                  {isAr ? 'اختر مدينة للمزامنة' : 'Select a city to sync'}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Store Image Upload */}
                  <div>
                    <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{isAr ? 'صورة المتجر' : 'Store Image'}</span>
                    <div className="flex items-center gap-4">
                      {editStoreImagePreview ? (
                        <img src={editStoreImagePreview} alt="Store" className="w-16 h-16 rounded-xl object-cover border border-zinc-200 dark:border-white/10" />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center text-zinc-400">
                          <Store size={24} />
                        </div>
                      )}
                      <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 rounded-xl text-sm font-bold cursor-pointer hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
                        <ImageIcon size={16} />
                        {isAr ? 'تغيير الصورة' : 'Change Image'}
                        <input type="file" accept="image/*" onChange={handleEditStoreImageChange} className="hidden" />
                      </label>
                    </div>
                  </div>

                  {/* Publishing Permissions */}
                  <div className="border-t border-zinc-100 dark:border-white/5 pt-4">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-3">{isAr ? 'صلاحيات النشر' : 'Publishing Permissions'}</h3>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.auto_publish_products || false}
                        onChange={(e) => setEditForm(p => ({ ...p, auto_publish_products: e.target.checked }))}
                        className="w-4 h-4 accent-marine-cyan"
                      />
                      <span className="text-sm font-medium">{isAr ? 'السماح بنشر المنتجات مباشرة دون مراجعة' : 'Allow publishing products directly without review'}</span>
                    </label>
                  </div>

                  {/* Public Storefront Placement */}
                  <div className="border-t border-zinc-100 dark:border-white/5 pt-4">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-3">{isAr ? 'ظهور التاجر للمستخدمين' : 'Public Vendor Placement'}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 bg-zinc-50 dark:bg-white/[0.02] space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editForm.public_show_on_vendors_page !== false}
                            onChange={(e) => setEditForm(p => ({ ...p, public_show_on_vendors_page: e.target.checked }))}
                            className="w-4 h-4 accent-marine-cyan"
                          />
                          <span className="text-sm font-medium">{isAr ? 'إظهاره في صفحة التجار' : 'Show on vendors page'}</span>
                        </label>
                        <label className="block">
                          <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">{isAr ? 'ترتيب صفحة التجار' : 'Directory Order'}</span>
                          <input
                            type="number"
                            value={editForm.public_vendors_page_order}
                            onChange={(e) => setEditForm(p => ({ ...p, public_vendors_page_order: Number(e.target.value) }))}
                            className="w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan"
                          />
                        </label>
                      </div>
                      <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 bg-zinc-50 dark:bg-white/[0.02] space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editForm.public_show_on_home || false}
                            onChange={(e) => setEditForm(p => ({ ...p, public_show_on_home: e.target.checked }))}
                            className="w-4 h-4 accent-marine-cyan"
                          />
                          <span className="text-sm font-medium">{isAr ? 'إظهاره في سلايدر الرئيسية' : 'Show in homepage slider'}</span>
                        </label>
                        <label className="block">
                          <span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">{isAr ? 'ترتيب سلايدر الرئيسية' : 'Homepage Order'}</span>
                          <input
                            type="number"
                            value={editForm.public_home_order}
                            onChange={(e) => setEditForm(p => ({ ...p, public_home_order: Number(e.target.value) }))}
                            className="w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Commission Overrides */}
                  <div className="border-t border-zinc-100 dark:border-white/5 pt-4">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-3">{isAr ? 'إعدادات العمولة الخاصة' : 'Custom Commission Settings'}</h3>
                    <label className="flex items-center gap-3 cursor-pointer mb-4">
                      <input
                        type="checkbox"
                        checked={editForm.commission_settings.is_custom}
                        onChange={(e) => setEditForm(p => ({ ...p, commission_settings: { ...p.commission_settings, is_custom: e.target.checked } }))}
                        className="w-4 h-4 accent-marine-cyan"
                      />
                      <span className="text-sm font-medium">{isAr ? 'استخدام إعدادات عمولة خاصة لهذا التاجر' : 'Use custom commission settings for this vendor'}</span>
                    </label>

                    {editForm.commission_settings.is_custom && (
                      <div className="space-y-4 p-4 bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10">
                        <div className="flex flex-col sm:flex-row gap-4 mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="vendor_comm_type"
                              value="fixed"
                              checked={editForm.commission_settings.type === 'fixed'}
                              onChange={() => setEditForm(p => ({ ...p, commission_settings: { ...p.commission_settings, type: 'fixed' } }))}
                              className="w-4 h-4 accent-marine-cyan"
                            />
                            <span className="text-xs font-medium">{isAr ? 'نسبة ثابتة' : 'Fixed Rate'}</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="vendor_comm_type"
                              value="category"
                              checked={editForm.commission_settings.type === 'category'}
                              onChange={() => setEditForm(p => ({ ...p, commission_settings: { ...p.commission_settings, type: 'category' } }))}
                              className="w-4 h-4 accent-marine-cyan"
                            />
                            <span className="text-xs font-medium">{isAr ? 'متغيرة حسب التصنيف' : 'Variable by Category'}</span>
                          </label>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                            {editForm.commission_settings.type === 'fixed' ? (isAr ? 'نسبة العمولة (%)' : 'Commission Rate (%)') : (isAr ? 'النسبة الافتراضية (%)' : 'Default Rate (%)')}
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={editForm.commission_settings.fixed_rate}
                            onChange={(e) => setEditForm(p => ({ ...p, commission_settings: { ...p.commission_settings, fixed_rate: Number(e.target.value) } }))}
                            className="w-full max-w-[200px] bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2 focus:border-marine-cyan focus:ring-1 focus:ring-marine-cyan outline-none text-sm"
                          />
                        </div>

                        {editForm.commission_settings.type === 'category' && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'عمولات التصنيفات' : 'Category Rates'}</span>
                              <button
                                type="button"
                                onClick={() => setEditForm(p => ({ ...p, commission_settings: { ...p.commission_settings, category_rates: [...p.commission_settings.category_rates, { category_id: '', rate: 0 }] } }))}
                                className="text-xs font-bold text-marine-primary hover:text-red-600 inline-flex items-center gap-1"
                              >
                                <Plus size={12} /> {isAr ? 'إضافة' : 'Add'}
                              </button>
                            </div>
                            <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pe-2">
                              {editForm.commission_settings.category_rates.map((item, index) => (
                                <div key={index} className="flex gap-2">
                                  <select
                                    value={item.category_id}
                                    onChange={(e) => {
                                      const newRates = [...editForm.commission_settings.category_rates];
                                      newRates[index].category_id = e.target.value;
                                      setEditForm(p => ({ ...p, commission_settings: { ...p.commission_settings, category_rates: newRates } }));
                                    }}
                                    className="flex-1 bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-2 py-2 focus:border-marine-cyan focus:ring-1 focus:ring-marine-cyan outline-none text-xs"
                                  >
                                    <option value="" disabled>{isAr ? '-- اختر --' : '-- Select --'}</option>
                                    {categoriesLoading && (
                                      <option value="" disabled>{isAr ? 'جاري تحميل التصنيفات...' : 'Loading categories...'}</option>
                                    )}
                                    {categories.map(c => (
                                      <option key={c._id} value={c._id}>
                                        {'\u00A0\u00A0'.repeat(c.level || 0)}{isAr ? c.name_ar || c.name : c.name}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    min="0" max="100" step="0.01"
                                    value={item.rate}
                                    onChange={(e) => {
                                      const newRates = [...editForm.commission_settings.category_rates];
                                      newRates[index].rate = Number(e.target.value);
                                      setEditForm(p => ({ ...p, commission_settings: { ...p.commission_settings, category_rates: newRates } }));
                                    }}
                                    className="w-20 bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-2 py-2 focus:border-marine-cyan focus:ring-1 focus:ring-marine-cyan outline-none text-xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newRates = editForm.commission_settings.category_rates.filter((_, i) => i !== index);
                                      setEditForm(p => ({ ...p, commission_settings: { ...p.commission_settings, category_rates: newRates } }));
                                    }}
                                    className="w-8 h-[34px] flex items-center justify-center rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-red-500 hover:border-red-500/30"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowEdit(false)} className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold">
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button type="submit" disabled={editSaving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold">
                      {editSaving ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
                      {isAr ? 'حفظ التعديلات' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </Overlay>
          )}

          {showAdd && (
            <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-3xl bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5">
                  <div>
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">{isAr ? 'إضافة تاجر جديد' : 'Add New Vendor'}</h2>
                    <p className="text-xs text-zinc-500 mt-1">{isAr ? 'سيتم إنشاء حساب تاجر نشط.' : 'This creates an active vendor account.'}</p>
                  </div>
                  <button onClick={() => setShowAdd(false)} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleAddVendor} className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <VendorInput icon={User} label={isAr ? 'اسم المسؤول' : 'Owner Name'} value={form.name} onChange={value => setForm({ ...form, name: value })} />
                  <VendorInput icon={Store} label={isAr ? 'اسم المتجر' : 'Store Name'} value={form.store_name} onChange={value => setForm({ ...form, store_name: value })} />
                  <VendorInput label={isAr ? 'اسم المستخدم' : 'Store Username'} value={form.store_username} onChange={value => setForm({ ...form, store_username: value })} placeholder="fastparts" />
                  <VendorInput icon={Mail} label={isAr ? 'البريد الإلكتروني' : 'Email Address'} type="email" value={form.email} onChange={value => setForm({ ...form, email: value })} />
                  <VendorInput icon={Phone} label={isAr ? 'رقم الهاتف' : 'Phone Number'} type="tel" value={form.phone} onChange={value => setForm({ ...form, phone: value })} />
                  <VendorInput label={isAr ? 'كلمة المرور' : 'Password'} type="password" value={form.password} onChange={value => setForm({ ...form, password: value })} />
                  
                  {/* Multi-Location Management (Add) */}
                  <div className="md:col-span-2 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'عناوين الفروع' : 'Branch Locations'}</label>
                      <button type="button" onClick={() => addLocation(false)} className="text-xs font-bold text-marine-primary hover:text-red-600 flex items-center gap-1">
                        <Plus size={14} /> {isAr ? 'إضافة فرع' : 'Add Branch'}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {form.locations?.map((loc, idx) => (
                        <div key={idx} className="space-y-2 bg-zinc-50 dark:bg-white/[0.02] p-3 rounded-xl border border-zinc-100 dark:border-white/5">
                          <div className="flex gap-2">
                            <input
                              type="text" required placeholder={isAr ? 'العنوان' : 'Address'}
                              value={loc.address}
                              onChange={e => updateLocation(idx, 'address', e.target.value, false)}
                              className="flex-1 bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-marine-cyan"
                            />
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" checked={loc.is_default} onChange={() => setDefaultLocation(idx, false)} className="w-4 h-4 accent-marine-cyan" />
                              <span className="text-[10px] font-bold text-zinc-400">{isAr ? 'افتراضي' : 'Default'}</span>
                            </label>
                            <button type="button" onClick={() => removeLocation(idx, false)} className="p-2 text-zinc-400 hover:text-red-500"><Trash2 size={16} /></button>
                          </div>
                          <ShippingZoneSelect dark country={loc.shipping_country || ''} city={loc.shipping_city || ''} onChange={({ country, city }) => { updateLocation(idx, 'shipping_country', country, false); updateLocation(idx, 'shipping_city', city, false); }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block">
                      <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{isAr ? 'صورة المتجر' : 'Store Image'}</span>
                      <div className="flex items-center gap-4">
                        <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 rounded-xl text-sm font-bold cursor-pointer hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
                          <ImageIcon size={16} />
                          {isAr ? 'اختر صورة' : 'Choose Image'}
                          <input type="file" accept="image/*" onChange={handleStoreImageChange} className="hidden" />
                        </label>
                        {storeImagePreview && (
                          <img src={storeImagePreview} alt="Store preview" className="w-16 h-16 rounded-xl object-cover border border-zinc-200 dark:border-white/10" />
                        )}
                      </div>
                    </label>
                  </div>

                  <div className="md:col-span-2 flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowAdd(false)} className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold">
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold">
                      {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      {isAr ? 'إضافة التاجر' : 'Add Vendor'}
                    </button>
                  </div>
                </form>
              </div>
            </Overlay>
          )}
        </div>

        {/* Suspend Modal */}
        <SuspendModal
          vendor={suspendingVendor}
          isOpen={showSuspendModal}
          onClose={() => { setShowSuspendModal(false); setSuspendingVendor(null); setSuspendReason(''); }}
          onConfirm={confirmSuspend}
          reason={suspendReason}
          setReason={setSuspendReason}
          saving={statusId !== null}
        />

        {/* Hard Delete Modal */}
        <HardDeleteModal
          key={`${showDelete ? 'open' : 'closed'}-${deletingVendor?._id || 'none'}`}
          open={showDelete}
          entityType="vendor"
          account={deletingVendor}
          onClose={() => { setShowDelete(false); setDeletingVendor(null); }}
          onDeleted={() => {
            const name = deletingVendor?.store_name || deletingVendor?.name || deletingVendor?.email || '';
            setVendors(prev => prev.filter(v => v._id !== deletingVendor?._id));
            setExpandedVendorId('');
            setShowDelete(false);
            setDeletingVendor(null);
            setSuccessMsg(isAr ? `تم حذف التاجر نهائياً: ${name}` : `Vendor permanently deleted: ${name}`);
            setTimeout(() => setSuccessMsg(''), 6000);
          }}
        />

        {/* Grant Subscription Modal */}
        {grantVendor && (
          <Overlay className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#14171A] rounded-2xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-black text-zinc-900 dark:text-white">
                  {isAr ? 'منح اشتراك مجاني' : 'Grant Free Subscription'}
                </h2>
                <button onClick={() => setGrantVendor(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white">
                  <X size={18} />
                </button>
              </div>

              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">
                {isAr ? 'التاجر: ' : 'Vendor: '}
                <span className="font-bold text-zinc-900 dark:text-white">{grantVendor.store_name || grantVendor.store_username}</span>
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                    {isAr ? 'الباقة' : 'Package'}
                  </label>
                  {grantPackages.length === 0 ? (
                    <p className="text-sm text-zinc-400">{isAr ? 'لا توجد باقات نشطة' : 'No active packages found'}</p>
                  ) : (
                    <select
                      value={grantForm.package_id}
                      onChange={e => setGrantForm(f => ({ ...f, package_id: e.target.value }))}
                      className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-marine-cyan dark:text-white"
                    >
                      {grantPackages.map(pkg => (
                        <option key={pkg._id} value={pkg._id}>
                          {pkg.name} — {pkg.max_products} {isAr ? 'منتج' : 'products'}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                    {isAr ? 'عدد الأشهر (1-24)' : 'Months (1–24)'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={grantForm.months}
                    onChange={e => setGrantForm(f => ({ ...f, months: e.target.value }))}
                    className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-marine-cyan dark:text-white"
                  />
                </div>

                {grantError && (
                  <p className="text-xs text-red-500 font-semibold">{grantError}</p>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setGrantVendor(null)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5"
                  >
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleGrant}
                    disabled={grantSaving || grantPackages.length === 0}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2"
                  >
                    {grantSaving ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                    {isAr ? 'منح الاشتراك' : 'Grant'}
                  </button>
                </div>
              </div>
            </div>
          </Overlay>
        )}
      </>
    );
}

function DetailItem({ icon: Icon, label, value, dir, wide = false }) {
  return (
    <div className={`rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] p-3 ${wide ? 'xl:col-span-2' : ''}`}>
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5">
        <Icon size={13} />
        {label}
      </div>
      <p className="text-sm font-bold text-zinc-900 dark:text-white break-words" dir={dir}>{value || '-'}</p>
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

function StatCard({ icon: Icon, label, value, tone = 'cyan' }) {
  const color = tone === 'green'
    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
    : tone === 'red'
      ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'
      : tone === 'blue'
        ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
        : tone === 'amber'
          ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
          : 'bg-marine-mist text-marine-primary dark:bg-marine-cyan/10';

  return (
    <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 p-5 shadow-sm">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${color}`}>
        <Icon size={20} />
      </div>
      <p className="text-sm font-bold text-zinc-500">{label}</p>
      <p className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{value}</p>
    </div>
  );
}

function VendorInput({ icon: Icon, label, value, onChange, type = 'text', placeholder = '', required = true }) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';

  return (
    <label className="block">
      <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{label}</span>
      <div className="relative">
        {Icon && <Icon size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />}
        <input
          required={required}
          type={isPassword && visible ? 'text' : type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ${Icon ? 'ps-10' : 'ps-4'} ${isPassword ? 'pe-10' : 'pe-4'} py-3 text-sm focus:outline-none focus:border-marine-cyan`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setVisible(current => !current);
            }}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white focus:outline-none focus:text-marine-primary transition-colors"
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </label>
  );
}

// Suspend Modal - requires reason input
function SuspendModal({ vendor, isOpen, onClose, onConfirm, reason, setReason, saving }) {
  const { language } = useApp();
  const isAr = language === 'ar';

  if (!isOpen) return null;

  return (
    <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5">
          <div>
            <h2 className="text-lg font-black text-zinc-900 dark:text-white">
              {isAr ? 'تعليق التاجر' : 'Suspend Vendor'}
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              {isAr ? `تعليق ${vendor?.store_name}` : `Suspending ${vendor?.store_name}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
              {isAr ? 'سبب التعليق *' : 'Suspension Reason *'}
            </label>
            <textarea
              required
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder={isAr ? 'أدخل سبب التعليق...' : 'Enter the reason for suspension...'}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold">
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button onClick={onConfirm} disabled={saving || !reason.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-bold">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <ShieldOff size={16} />}
              {isAr ? 'تعليق التاجر' : 'Suspend Vendor'}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
