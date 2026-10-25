'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Trash2, ShoppingBag, Minus, Plus } from 'lucide-react';
import { useRouter } from '../lib/navigation';
import { useApp } from '../context/AppContext';
import { thumbUrl } from '../lib/assets';
import Overlay from './Overlay';

const getItemKey = (item) => String(item.key || item.product?._id || '');

export default function CartDrawer() {
  const router = useRouter();
  const { isCartOpen, setIsCartOpen, cartItems, removeFromCart, updateCartQuantity, language, isMounted, t, user, siteSettings } = useApp();
  const [selectedKeys, setSelectedKeys] = useState([]);
  const hasInitializedSelection = useRef(false);

  useEffect(() => {
    if (!isMounted) return;
    const currentKeys = cartItems.map(getItemKey).filter(Boolean);
    setSelectedKeys(prev => {
      if (currentKeys.length === 0) {
        hasInitializedSelection.current = false;
        return [];
      }
      if (!hasInitializedSelection.current) {
        hasInitializedSelection.current = true;
        return currentKeys;
      }
      const prevSet = new Set(prev.map(String));
      return currentKeys.filter(key => prevSet.has(key));
    });
  }, [cartItems, isMounted]);

  // Don't render anything until client has mounted — prevents flash on page load/navigation
  if (!isMounted) return null;

  const isAr = language === 'ar';
  const closedTranslate = isAr ? 'translateX(-100%)' : 'translateX(100%)';
  const isStaffAccount = user?.role === 'vendor' || user?.role === 'admin';
  const selectedKeySet = new Set(selectedKeys);
  const selectedItems = cartItems.filter(item => selectedKeySet.has(getItemKey(item)));
  const selectedTotal = selectedItems.reduce((sum, item) => sum + Number(item.product.price || 0) * Number(item.quantity || 0), 0);
  const allSelected = cartItems.length > 0 && selectedItems.length === cartItems.length;

  const toggleItem = (itemKey) => {
    setSelectedKeys(prev => (
      prev.includes(itemKey)
        ? prev.filter(key => key !== itemKey)
        : [...prev, itemKey]
    ));
  };

  const startCheckout = () => {
    const keys = selectedItems.map(getItemKey).filter(Boolean);
    if (keys.length === 0) return;
    const encodedKeys = JSON.stringify(keys);
    sessionStorage.setItem('checkout_mode', 'cart_selected');
    sessionStorage.setItem('checkout_cart_item_keys', encodedKeys);
    sessionStorage.removeItem('checkout_item');
    localStorage.setItem('checkout_mode', 'cart_selected');
    localStorage.setItem('checkout_cart_item_keys', encodedKeys);
    localStorage.removeItem('checkout_item');
    setIsCartOpen(false);
    router.push('/checkout');
  };

  return (
    <>
      {isCartOpen && (
        <Overlay
          className="fixed inset-0 bg-black/60 z-[100]"
          onClick={() => setIsCartOpen(false)}
        />
      )}
      {/* One step above the backdrop: each Overlay is its own layer on the page, and the
          backdrop, mounted later, would otherwise sit on top of the drawer. */}
      <Overlay
        className="fixed top-0 end-0 h-full w-full max-w-sm bg-white z-[101] shadow-2xl flex flex-col transform transition-transform duration-300"
        style={{ transform: isCartOpen ? 'translateX(0)' : closedTranslate }}
      >
        <div className="flex items-center justify-between px-5 py-4 bg-marine-navy text-white">
          <div className="flex items-center gap-2">
            <ShoppingBag size={20} className="text-marine-primary" />
            <h2 className="font-semibold text-lg">{t.cart} ({cartItems.length})</h2>
          </div>
          <button onClick={() => setIsCartOpen(false)} className="hover:text-marine-primary transition-colors">
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isStaffAccount ? (
            <div className="flex flex-col items-center justify-center h-full text-marine-outline gap-3 text-center">
              <ShoppingBag size={48} className="opacity-30" />
              <p className="font-bold text-marine-ink">
                {isAr ? 'حسابات الإدارة والبائعين لا يمكنها شراء المنتجات' : 'Admin and vendor accounts cannot purchase products'}
              </p>
              <p className="text-sm">
                {isAr ? 'يرجى تسجيل الدخول كعميل لإضافة منتجات إلى السلة.' : 'Please log in as a customer to add items to your cart.'}
              </p>
            </div>
          ) : cartItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-marine-outline gap-3">
              <ShoppingBag size={48} className="opacity-30" />
              <p>{t.cartEmpty}</p>
            </div>
          ) : (
            cartItems.map(item => (
              <div key={item.key || item.product._id} className="flex gap-3 bg-marine-canvas rounded-xl p-3">
                <label className="pt-5">
                  <input
                    type="checkbox"
                    checked={selectedKeySet.has(getItemKey(item))}
                    onChange={() => toggleItem(getItemKey(item))}
                    className="w-4 h-4 rounded border-marine-teal/25 text-marine-primary focus:ring-marine-cyan"
                    aria-label={isAr ? 'اختيار المنتج للدفع' : 'Select item for checkout'}
                  />
                </label>
                <div className="w-16 h-16 bg-marine-mist rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {item.product.image ? (
                    <img
                      src={thumbUrl(item.product.image, 160)}
                      loading="lazy"
                      decoding="async"
                      alt={isAr ? (item.product.title_ar || item.product.title_en) : item.product.title_en}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ShoppingBag size={24} className="text-marine-line" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-marine-ink line-clamp-2">
                    {isAr ? (item.product.title_ar || item.product.title_en) : item.product.title_en}
                  </p>
                  {item.variant?.label && (
                    <p className="text-xs text-marine-primary font-semibold mt-0.5 bg-red-50 inline-block px-2 py-0.5 rounded-md">
                      {item.variant.label}
                    </p>
                  )}
                  {item.is_bundle && (
                    <p className="text-xs text-violet-700 font-semibold mt-0.5 bg-violet-50 inline-block px-2 py-0.5 rounded-md">
                      {isAr ? 'باقة' : 'Bundle'}{item.members?.length ? ` · ${item.members.length}` : ''}
                    </p>
                  )}
                  <p className="text-marine-primary font-bold mt-1">
                    {siteSettings?.currency || 'QAR'} {(item.product.price || 0).toFixed(2)}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => updateCartQuantity(item.key || item.product._id, Number(item.quantity || 1) - 1)}
                      className="w-7 h-7 rounded-lg border border-marine-teal/15 bg-white text-marine-muted hover:text-marine-primary hover:border-marine-cyan/40 flex items-center justify-center transition-colors"
                      aria-label={isAr ? 'تقليل الكمية' : 'Decrease quantity'}
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateCartQuantity(item.key || item.product._id, e.target.value)}
                      className="w-12 h-7 rounded-lg border border-marine-teal/15 bg-white text-center text-xs font-bold text-marine-ink outline-none focus:border-marine-cyan"
                      aria-label={isAr ? 'الكمية' : 'Quantity'}
                    />
                    <button
                      type="button"
                      onClick={() => updateCartQuantity(item.key || item.product._id, Number(item.quantity || 1) + 1)}
                      className="w-7 h-7 rounded-lg border border-marine-teal/15 bg-white text-marine-muted hover:text-marine-primary hover:border-marine-cyan/40 flex items-center justify-center transition-colors"
                      aria-label={isAr ? 'زيادة الكمية' : 'Increase quantity'}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => removeFromCart(item.key || item.product._id)}
                  className="text-red-400 hover:text-red-600 transition-colors self-start mt-1"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        {!isStaffAccount && cartItems.length > 0 && (
          <div className="p-4 border-t border-marine-teal/15 space-y-3">
            <label className="flex items-center justify-between gap-3 text-sm font-bold text-marine-muted">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSelectedKeys(e.target.checked ? cartItems.map(getItemKey).filter(Boolean) : [])}
                  className="w-4 h-4 rounded border-marine-teal/25 text-marine-primary focus:ring-marine-cyan"
                />
                {isAr ? 'اختيار الكل' : 'Select all'}
              </span>
              <span className="text-xs text-marine-outline">
                {selectedItems.length}/{cartItems.length}
              </span>
            </label>
            <div className="flex justify-between text-sm text-marine-muted">
              <span>{t.subtotal}</span>
              <span className="font-bold text-marine-ink">{siteSettings?.currency || 'QAR'} {selectedTotal.toFixed(2)}</span>
            </div>
            <button 
              onClick={startCheckout}
              disabled={selectedItems.length === 0}
              className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.checkout}
            </button>
            <button
              onClick={() => setIsCartOpen(false)}
              className="w-full border border-marine-teal/15 text-marine-muted font-medium py-2.5 rounded-xl hover:bg-marine-canvas transition-colors text-sm"
            >
              {t.continueShopping}
            </button>
          </div>
        )}
      </Overlay>
    </>
  );
}
