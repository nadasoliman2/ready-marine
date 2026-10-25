'use client';

import { useState } from 'react';
import { vendorApi } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Plus, Edit, Trash2, Search, CheckCircle2, Loader2, Image as ImageIcon } from 'lucide-react';
import { cardPricing } from '../lib/productPricing';
import { useLinkedBrandCategory } from '../lib/brandCategoryLink';
import SearchableSelect from './SearchableSelect';
import { brandOptions } from '../lib/pickerOptions';

/** The price customers are charged, with the regular price struck through beside it. */
function PriceBadge({ product, currency }) {
  const { price, original, hasDiscount } = cardPricing(product);
  return (
    <>
      <span>{currency} {price.toFixed(2)}</span>
      {hasDiscount && <span className="text-white/50 line-through">{currency} {original.toFixed(2)}</span>}
    </>
  );
}

export default function VendorProducts({ vendorProducts, setVendorProducts, carMetadata, language, t, isAr }) {
  const { siteSettings } = useApp();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const initialFormState = {
    title_en: '', title_ar: '', subtitle_en: '', subtitle_ar: '',
    description_en: '', description_ar: '',
    sku: '', part_number: '', gtin: '', price: '', discount_type: '', discount_value: '',
    category_id: '', product_brand_id: '',
    is_universal: true, stock_management: true, quantity: 100, images: [{ url: '', is_primary: true }]
  };
  
  const [form, setForm] = useState(initialFormState);
  const [editingId, setEditingId] = useState(null);
  // Brand and category narrow each other; changing one clears the other if it no longer fits.
  const linked = useLinkedBrandCategory({
    brands: carMetadata?.productBrands || [],
    categories: carMetadata?.categories || [],
    brandId: form.product_brand_id,
    categoryId: form.category_id,
    setBrandId: (id) => setForm(prev => ({ ...prev, product_brand_id: id })),
    setCategoryId: (id) => setForm(prev => ({ ...prev, category_id: id })),
  });

  const filteredProducts = vendorProducts.filter(p => {
    if (search && !p.title_en?.toLowerCase().includes(search.toLowerCase()) && !p.title_ar?.includes(search)) return false;
    if (categoryFilter && p.category_id?._id !== categoryFilter) return false;
    return true;
  });

  const handleOpenForm = (product = null) => {
    setMessage({ type: '', text: '' });
    if (product) {
       setForm({
          ...product,
          price: product.price || '',
          discount_type: product.discount_type || '',
          discount_value: product.discount_value ?? '',
          category_id: typeof product.category_id === 'object' ? product.category_id._id : product.category_id,
          product_brand_id: typeof product.product_brand_id === 'object' ? product.product_brand_id._id : product.product_brand_id,
          images: product.images && product.images.length > 0 ? product.images : [{ url: '', is_primary: true }]
       });
       setEditingId(product._id);
    } else {
       setForm(initialFormState);
       setEditingId(null);
    }
    setIsEditing(true);
  };

  const handleCloseForm = () => {
    setIsEditing(false);
    setForm(initialFormState);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
       const submitData = { ...form };
       // Cleanup specific fields
       submitData.images = submitData.images.filter(i => i.url.trim() !== '');
       
       if (editingId) {
          const res = await vendorApi.updateProduct(editingId, submitData);
          setVendorProducts(prev => prev.map(p => p._id === editingId ? res.product : p));
          setMessage({ type: 'success', text: t.saveProduct + ' ✓' });
       } else {
          const res = await vendorApi.addProduct(submitData);
          setVendorProducts([res.product, ...vendorProducts]);
          setMessage({ type: 'success', text: t.saveProduct + ' ✓' });
       }
       setTimeout(() => handleCloseForm(), 1500);
    } catch (err) {
       setMessage({ type: 'error', text: err.message || 'Error occurred' });
    } finally {
       setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm(t.deleteProductConfirm)) return;
    try {
       await vendorApi.deleteProduct(id);
       setVendorProducts(prev => prev.filter(p => p._id !== id));
    } catch (error) {
       console.error(error);
    }
  };

  if (isEditing) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-3xl p-6 shadow-2xl animate-in fade-in duration-300">
        <div className="flex items-center justify-between mb-8">
           <h3 className="text-2xl font-black text-white">{editingId ? t.editProduct : t.addProduct}</h3>
           <button onClick={handleCloseForm} className="text-zinc-400 hover:text-white px-4 py-2 font-bold transition-colors">
              X
           </button>
        </div>

        {message.text && (
            <div className={`mb-6 p-4 rounded-xl text-sm font-bold flex items-center gap-3 ${
               message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'
            }`}>
               <CheckCircle2 size={18} />
               <span>{message.text}</span>
            </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                 <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{t.productTitle} (EN)</label>
                 <input type="text" required value={form.title_en} onChange={e => setForm({...form, title_en: e.target.value})} className="w-full bg-[#09090b] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan" />
              </div>
              <div className="space-y-2">
                 <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{t.productTitle} (AR)</label>
                 <input type="text" value={form.title_ar} onChange={e => setForm({...form, title_ar: e.target.value})} className="w-full bg-[#09090b] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan" />
              </div>
              <div className="space-y-2">
                 <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{t.sku}</label>
                 <input type="text" value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} placeholder="Auto-generated if blank" className="w-full bg-[#09090b] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan" />
              </div>
              <div className="space-y-2 flex gap-4">
                 <div className="flex-1 space-y-2">
                    <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{t.price}</label>
                    <input type="number" required min="0" step="0.01" value={form.price} onChange={e => setForm({...form, price: e.target.value})} className="w-full bg-[#09090b] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan" />
                 </div>
                 <div className="flex-1 space-y-2">
                    <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">{t.stock}</label>
                    <input type="number" min="0" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} className="w-full bg-[#09090b] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan" />
                 </div>
              </div>

              <div className="space-y-2">
                 <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Category</label>
                 <select required value={form.category_id} onChange={e => setForm({...form, category_id: e.target.value})} className="w-full bg-[#09090b] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan">
                    <option value="">Select Category</option>
                    {linked.categories?.map(c => (
                       <option key={c._id} value={c._id}>{isAr && c.name_ar ? c.name_ar : c.name_en || c.name}</option>
                    ))}
                 </select>
              </div>

              <div className="space-y-2">
                 <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Brand</label>
                 <SearchableSelect value={form.product_brand_id} onChange={(v) => setForm({ ...form, product_brand_id: v })}
                    options={brandOptions(linked.brands)} placeholder={isAr ? 'اختار الماركة' : 'Select Brand'} isAr={isAr}
                    buttonClassName="w-full bg-[#09090b] border border-white/10 text-white rounded-xl ps-4 pe-9 py-3 focus:outline-none focus:border-marine-cyan" />
              </div>

              <div className="col-span-1 md:col-span-2 space-y-2">
                 <label className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Image URL</label>
                 <div className="flex items-center gap-4">
                    <input type="url" value={form.images[0]?.url || ''} onChange={e => setForm({...form, images: [{ url: e.target.value, is_primary: true }]})} placeholder="https://..." className="flex-1 bg-[#09090b] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan" />
                    {form.images[0]?.url && <img src={form.images[0].url} alt="Preview" className="w-12 h-12 object-cover rounded-lg border border-white/20" />}
                 </div>
              </div>
           </div>

           <div className="pt-6 border-t border-white/10 flex justify-end gap-4">
              <button disabled={loading} type="submit" className="bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3 px-8 rounded-xl transition-all shadow-lg flex items-center gap-2 disabled:opacity-50">
                 {loading && <Loader2 size={16} className="animate-spin" />}
                 {t.saveProduct}
              </button>
           </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
         <h3 className="text-2xl font-black text-white">{t.myProducts} ({vendorProducts.length})</h3>
         <button onClick={() => handleOpenForm(null)} className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg">
            <Plus size={18} /> {t.addProduct}
         </button>
      </div>

      <div className="flex gap-4">
         <div className="flex-1 relative">
            <input 
               type="text" 
               placeholder={t.searchProducts}
               value={search}
               onChange={e => setSearch(e.target.value)}
               className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 pl-11 focus:outline-none focus:border-marine-cyan" 
            />
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
         </div>
      </div>

      {filteredProducts.length === 0 ? (
         <div className="bg-white/5 rounded-3xl p-12 text-center border border-dashed border-white/10 mt-6">
            <ImageIcon size={48} className="text-zinc-600 mx-auto mb-4 opacity-50" />
            <p className="text-zinc-400 font-bold">{t.noProductsFound}</p>
         </div>
      ) : (
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {filteredProducts.map(product => (
               <div key={product._id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:bg-white/10 transition-all shadow-xl flex flex-col group">
                  <div className="aspect-square bg-[#111315] relative">
                     {product.images && product.images[0] ? (
                        <img src={product.images[0].url} alt={product.title_en} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                     ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/20"><ImageIcon size={40}/></div>
                     )}
                     <div className="absolute top-3 end-3 bg-black/60 backdrop-blur-sm text-xs font-bold text-white px-3 py-1 rounded-full flex items-center gap-1">
                        <PriceBadge product={product} currency={siteSettings?.currency || 'QAR'} />
                     </div>
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                     <h4 className="text-white font-bold text-sm mb-1 line-clamp-2 leading-snug">{isAr ? (product.title_ar || product.title_en) : product.title_en}</h4>
                     <p className="text-zinc-500 text-xs mb-4">SKU: {product.sku}</p>
                     
                     <div className="mt-auto flex items-center justify-between pt-4 border-t border-white/10">
                        <span className="text-emerald-400 text-xs font-bold bg-emerald-400/10 px-2 py-1 rounded-md">{t.stock}: {product.quantity || 0}</span>
                        <div className="flex items-center gap-3">
                           <button onClick={() => handleOpenForm(product)} className="text-blue-400 hover:text-blue-300 transition-colors">
                              <Edit size={16} />
                           </button>
                           <button onClick={() => handleDelete(product._id)} className="text-red-500 hover:text-red-400 transition-colors">
                              <Trash2 size={16} />
                           </button>
                        </div>
                     </div>
                  </div>
               </div>
            ))}
         </div>
      )}
    </div>
  );
}
