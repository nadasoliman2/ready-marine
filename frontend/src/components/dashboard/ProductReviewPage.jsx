'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Boxes, Car, Edit2, Image as ImageIcon, Loader2, Package, Store, Tag } from 'lucide-react';
import Link from '../LocaleLink';
import { adminApi, vendorApi } from '../../lib/api';
import { useRouter, useSearchParams } from '../../lib/navigation';
import { useApp } from '../../context/AppContext';
import EditProductPage from '../../app/dashboard/products/[id]/edit/page';
import ProductViewMenu from './ProductViewMenu';
import ProductCatalogLinkPanel from './catalog/ProductCatalogLinkPanel';
import FitmentCheckPanel from './FitmentCheckPanel';
import { partTypeLabel } from '../../lib/partType';

export default function ProductReviewPage({ productId, mode = 'vendor' }) {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const isAdmin = mode === 'admin';
  const productsPath = isAdmin ? '/admin/dashboard/products' : '/dashboard/products';
  const getProduct = isAdmin ? adminApi.getProduct : vendorApi.getProduct;
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?edit=1` opens straight on the edit form (the pending list's "Edit" quick action);
  // `from=pending` sends a "Save and approve" back to that list.
  const [editing, setEditing] = useState(() => searchParams.get('edit') === '1');
  const fromPending = searchParams.get('from') === 'pending';

  const loadProduct = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getProduct(productId);
      setProduct(data.product || data);
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر تحميل المنتج.' : 'Could not load the product.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (productId) loadProduct();
  }, [productId]);

  if (editing) {
    return (
      <EditProductPage
        params={{ id: productId }}
        mode={mode}
        reviewMode
        onCancel={() => setEditing(false)}
        onSaved={async () => {
          setEditing(false);
          await loadProduct();
        }}
        // An admin reviewing a product that waits for approval can approve it with the save.
        onApprove={isAdmin && product?.status === 'pending' ? async () => {
          await adminApi.approveProduct(productId);
          if (fromPending) {
            router.push('/admin/dashboard/pending-products');
            return;
          }
          setEditing(false);
          await loadProduct();
        } : undefined}
      />
    );
  }

  if (loading) return <div className="flex h-[50vh] items-center justify-center"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;

  if (error || !product) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-500/20 dark:bg-red-500/10">
        <p className="font-bold text-red-600 dark:text-red-400">{error || (isAr ? 'المنتج غير موجود.' : 'Product not found.')}</p>
        <Link href={productsPath} className="mt-4 inline-block text-sm font-bold text-marine-primary">{isAr ? 'العودة إلى المنتجات' : 'Return to products'}</Link>
      </div>
    );
  }

  const title = isAr ? (product.title_ar || product.title_en) : (product.title_en || product.title_ar);
  const subtitle = isAr ? (product.subtitle_ar || product.subtitle_en) : (product.subtitle_en || product.subtitle_ar);
  const description = isAr ? (product.description_ar || product.description_en) : (product.description_en || product.description_ar);
  const category = isAr
    ? (product.category_id?.name_ar || product.category_id?.name_en || product.category_id?.name)
    : (product.category_id?.name_en || product.category_id?.name_ar || product.category_id?.name);
  const currency = siteSettings?.currency || 'QAR';

  return (
    <div className="mx-auto max-w-6xl pb-12 animate-in fade-in duration-300">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href={productsPath} className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 transition-colors hover:text-zinc-900 dark:border-white/10 dark:bg-[#14171A] dark:hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={product.status} isAr={isAr} />
              <span className="text-xs font-bold text-zinc-400">SKU: {product.sku || '—'}</span>
            </div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white">{title || (isAr ? 'منتج بدون عنوان' : 'Untitled product')}</h1>
            <p className="mt-1 text-sm text-zinc-500">{subtitle || (isAr ? 'مراجعة كل تفاصيل المنتج قبل النشر.' : 'Review every product detail before publishing.')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ProductViewMenu product={product} reviewHref={`${productsPath}/${product._id}`} language={language} compact />
          <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-xl bg-marine-cyan px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-marine-cyan-dark">
            <Edit2 size={16} />
            {isAr ? 'تعديل المنتج' : 'Edit product'}
          </button>
        </div>
      </div>

      {product.status !== 'published' && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          {isAr ? 'هذه معاينة داخلية. صفحة المتجر لن تكون متاحة للعملاء حتى يتم نشر المنتج.' : 'This is an internal review. The storefront page stays unavailable to customers until the product is published.'}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-white/5 dark:bg-[#14171A]">
          <div className="aspect-[4/3] bg-zinc-100 dark:bg-[#0E1012]">
            {getImageUrl(product.images?.[0]) ? (
              <img src={getImageUrl(product.images[0])} alt={title || ''} className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-300 dark:text-zinc-600"><ImageIcon size={56} /></div>
            )}
          </div>
          {product.images?.length > 1 && (
            <div className="grid grid-cols-5 gap-2 border-t border-zinc-100 p-3 dark:border-white/5">
              {product.images.slice(1, 6).map((image, index) => (
                <div key={image?._id || getImageUrl(image) || index} className="aspect-square overflow-hidden rounded-lg bg-zinc-100 dark:bg-[#0E1012]">
                  <img src={getImageUrl(image)} alt="" className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[#14171A]">
            <h2 className="mb-5 text-lg font-black text-zinc-900 dark:text-white">{isAr ? 'ملخص المنتج' : 'Product summary'}</h2>
            <div className="grid grid-cols-2 gap-4">
              <Detail icon={Tag} label={isAr ? 'السعر' : 'Price'} value={`${currency} ${Number(product.price || 0).toLocaleString(isAr ? 'ar-EG' : 'en-US')}`} />
              <Detail icon={Boxes} label={isAr ? 'المخزون' : 'Inventory'} value={product.stock_management ? `${product.quantity ?? 0}` : (isAr ? 'غير متتبع' : 'Not tracked')} />
              <Detail icon={Package} label={isAr ? 'الفئة' : 'Category'} value={category || '—'} />
              <Detail icon={Tag} label={isAr ? 'العلامة' : 'Brand'} value={product.product_brand_id?.name || '—'} />
              {isAdmin && <Detail icon={Store} label={isAr ? 'البائع' : 'Vendor'} value={product.vendor_id?.store_name || '—'} />}
              <Detail icon={Car} label={isAr ? 'التوافق' : 'Compatibility'} value={product.is_universal ? (isAr ? 'قطعة عامة' : 'Universal') : `${product.compatible_cars?.length || 0} ${isAr ? 'مركبات' : 'vehicles'}`} />
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[#14171A]">
            <h2 className="mb-3 text-lg font-black text-zinc-900 dark:text-white">{isAr ? 'الوصف' : 'Description'}</h2>
            <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-600 dark:text-zinc-300">{description || '—'}</p>
          </section>
        </div>
      </div>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[#14171A]">
        <h2 className="mb-5 text-lg font-black text-zinc-900 dark:text-white">{isAr ? 'بيانات المراجعة' : 'Review data'}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PlainDetail label={isAr ? 'رقم القطعة' : 'Part number'} value={product.part_number} />
          <PlainDetail label="GTIN" value={product.gtin} />
          <PlainDetail label={isAr ? 'نوع القطعة' : 'Part type'} value={partTypeLabel(product.part_type, isAr) || (isAr ? 'لم يحدد' : 'Not set')} />
          <PlainDetail label={isAr ? 'عدد التنويعات' : 'Variants'} value={product.variants?.length || 0} />
          <PlainDetail label={isAr ? 'الوزن' : 'Weight'} value={product.weight ? `${product.weight} ${isAr ? 'كجم' : 'kg'}` : '—'} />
        </div>
      </section>

      {/* Admin only: the cars the title names and the fitment does not. */}
      {isAdmin && (
        <FitmentCheckPanel productId={product._id} language={language} onChanged={loadProduct} />
      )}

      {/* Admin only — the vendor is never shown the link, and never given a
          button that would break analytics. */}
      {isAdmin && (
        <ProductCatalogLinkPanel product={product} language={language} onChanged={loadProduct} />
      )}
    </div>
  );
}

function StatusBadge({ status, isAr }) {
  const styles = status === 'published'
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
    : status === 'pending'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
      : status === 'rejected'
        ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
  const labels = {
    published: isAr ? 'منشور' : 'Published',
    pending: isAr ? 'قيد المراجعة' : 'Pending review',
    rejected: isAr ? 'مرفوض' : 'Rejected',
    draft: isAr ? 'مسودة' : 'Draft',
  };
  return <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${styles}`}>{labels[status] || status}</span>;
}

function Detail({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl bg-zinc-50 p-3 dark:bg-white/[0.03]">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-zinc-400"><Icon size={12} />{label}</div>
      <p className="text-sm font-bold text-zinc-900 dark:text-white">{value}</p>
    </div>
  );
}

function PlainDetail({ label, value }) {
  return <div><p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">{label}</p><p className="mt-1 text-sm font-bold text-zinc-900 dark:text-white">{value || '—'}</p></div>;
}

function getImageUrl(image) {
  return typeof image === 'string' ? image : image?.url;
}
