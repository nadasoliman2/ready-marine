'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from '../../../lib/navigation';
import Link from '../../../components/LocaleLink';
import { Package, ShoppingCart, Loader2, AlertTriangle, Check } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { bundlesApi } from '../../../lib/api';

export default function BundleDetailPage() {
  const { slug } = useParams();
  const router = useRouter();
  const { addBundleToCart, buyNowBundle, setIsCartOpen, language, siteSettings, user } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';

  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await bundlesApi.getBySlug(slug);
        setBundle(data.bundle);
      } catch (_) {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-marine-canvas"><Loader2 className="animate-spin text-violet-600" size={36} /></div>;
  }
  if (notFound || !bundle) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-marine-canvas gap-4">
        <Package size={48} className="text-marine-line" />
        <p className="text-marine-outline font-bold">{isAr ? 'الباقة غير موجودة.' : 'Bundle not found.'}</p>
        <Link href="/bundles" className="text-violet-600 font-bold hover:underline">{isAr ? 'كل الباقات' : 'All bundles'}</Link>
      </div>
    );
  }

  const title = isAr ? (bundle.title_ar || bundle.title_en) : (bundle.title_en || bundle.title_ar);
  const description = isAr ? (bundle.description_ar || bundle.description_en) : (bundle.description_en || bundle.description_ar);
  const primary = (bundle.images || []).find(i => i.is_primary);
  const image = primary?.url || bundle.images?.[0]?.url || '';
  const effective = bundle.pricing?.effective ?? 0;
  const combined = bundle.pricing?.combined ?? 0;
  const savings = bundle.pricing?.savings ?? 0;
  const isStaff = user?.role === 'vendor' || user?.role === 'admin';
  const purchasable = bundle.is_purchasable !== false && !isStaff;

  const handleAdd = () => { if (purchasable && addBundleToCart(bundle)) setIsCartOpen(true); };
  const handleBuyNow = () => { if (purchasable && buyNowBundle(bundle)) router.push('/checkout?buy_now=1'); };

  const memberName = (p) => isAr ? (p?.title_ar || p?.title_en) : (p?.title_en || p?.title_ar);
  const memberImg = (p) => (p?.images || []).find(i => i.is_primary)?.url || p?.images?.[0]?.url || '';

  return (
    <div className="min-h-screen bg-marine-canvas py-10 px-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-5xl mx-auto">
        <div className="grid md:grid-cols-2 gap-8 bg-white rounded-xl p-6 border border-marine-teal/15">
          {/* Image */}
          <div className="relative aspect-square rounded-lg bg-marine-canvas overflow-hidden">
            {image ? <img src={image} alt={title} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-marine-line"><Package size={64} /></div>}
            <span className="absolute top-3 start-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white">
              <Package size={13} /> {isAr ? 'باقة' : 'Bundle'}
            </span>
          </div>

          {/* Info */}
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold text-marine-ink">{title}</h1>

            <div className="mt-3 flex items-baseline gap-3">
              <span className="text-marine-primary font-bold text-3xl">{currency} {effective.toFixed(2)}</span>
              {combined > effective && <span className="text-marine-outline text-lg line-through">{currency} {combined.toFixed(2)}</span>}
            </div>
            {savings > 0 && (
              <p className="mt-1 text-emerald-600 font-bold text-sm">
                {isAr ? `توفّر ${currency} ${savings.toFixed(2)} عند شراء الباقة` : `You save ${currency} ${savings.toFixed(2)} buying the bundle`}
              </p>
            )}

            {description && <p className="mt-4 text-marine-muted whitespace-pre-line leading-relaxed">{description}</p>}

            {!purchasable && bundle.is_purchasable === false && (
              <div className="mt-4 flex items-center gap-2 text-amber-700 bg-amber-50 rounded-xl p-3 text-sm font-semibold">
                <AlertTriangle size={16} /> {isAr ? 'إحدى منتجات الباقة غير متاحة حالياً.' : 'One of the bundle items is currently unavailable.'}
              </div>
            )}

            <div className="mt-auto pt-6 flex gap-3">
              <button onClick={handleAdd} disabled={!purchasable}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
                <ShoppingCart size={18} /> {isAr ? 'أضف الباقة للسلة' : 'Add bundle to cart'}
              </button>
              <button onClick={handleBuyNow} disabled={!purchasable}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-marine-navy hover:bg-marine-teal disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
                {isAr ? 'اشترِ الآن' : 'Buy now'}
              </button>
            </div>
          </div>
        </div>

        {/* Members */}
        <div className="mt-8">
          <h2 className="text-xl font-bold text-marine-ink mb-4">{isAr ? 'مكوّنات الباقة' : "What's included"}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {(bundle.members || []).map((m, i) => {
              const p = m.product_id && typeof m.product_id === 'object' ? m.product_id : {};
              const pslug = isAr ? (p.slug_ar || p.slug_en) : (p.slug_en || p.slug_ar);
              const inner = (
                <div className="flex items-center gap-3 bg-white rounded-lg border border-marine-teal/15 p-3 hover:border-violet-200 transition-colors">
                  <div className="w-16 h-16 rounded-xl bg-marine-canvas overflow-hidden flex-shrink-0">
                    {memberImg(p) ? <img src={memberImg(p)} alt={memberName(p)} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-marine-line"><Package size={20} /></div>}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-marine-ink text-sm line-clamp-2">{memberName(p) || (isAr ? 'منتج' : 'Product')}</p>
                    <p className="text-xs text-marine-outline mt-0.5 flex items-center gap-1"><Check size={12} className="text-emerald-500" /> {isAr ? `الكمية: ${m.quantity}` : `Qty: ${m.quantity}`}</p>
                  </div>
                </div>
              );
              return pslug ? <Link key={i} href={`/product/${pslug}`}>{inner}</Link> : <div key={i}>{inner}</div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
