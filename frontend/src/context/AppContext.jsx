'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { translations } from '../lib/translations';
import { userApi, authApi, UNAUTHORIZED_EVENT, SESSION_ENDED_EVENT, refreshAccess, msSinceRefresh } from '../lib/api';
import { isDashboardPath } from '../lib/dashboardRoute';
import { localeOfPath, switchLocale, stripLocale, localizePath, DEFAULT_LOCALE } from '../lib/locale';
import { forgetProductLists } from '../lib/productListPreload';
import { getSocket, disconnectSocket } from '../lib/socket';
import { apiOrigin } from '../lib/assets';

const AppContext = createContext(undefined);

const BRANDING_FIELDS = ['logo_url', 'logo_light_url', 'favicon_url'];

// /uploads is served `immutable` for 30 days, so a branding file replaced under its old name
// never reaches a browser that already has it. Bump this after replacing one in place; the
// backend ignores the query string. (New uploads get new names and need no bump.)
const BRANDING_CACHE_VERSION = 3;

/**
 * The backend saves a branding upload as an absolute URL built from BACKEND_PUBLIC_URL at
 * upload time — so a logo uploaded while that pointed at another port or host stays broken
 * forever. Anything under /uploads/ is re-pointed at the API this build actually talks to.
 */
function withReachableBranding(settings) {
  if (!settings) return settings;
  const fixed = { ...settings };
  for (const key of BRANDING_FIELDS) {
    const url = fixed[key];
    const at = typeof url === 'string' ? url.indexOf('/uploads/') : -1;
    if (at !== -1) fixed[key] = `${apiOrigin}${url.slice(at).split('?')[0]}?v=${BRANDING_CACHE_VERSION}`;
  }
  return fixed;
}

export function AppProvider({ children, initialLanguage = 'en', initialTheme = 'light' }) {
  // Use server-provided initialLanguage so first render matches server HTML — no flicker
  const [language, setLanguageState] = useState(initialLanguage);

  const [siteSettings, setRawSiteSettings] = useState(null);
  const setSiteSettings = useCallback((settings) => setRawSiteSettings(withReachableBranding(settings)), []);
  const [categories, setCategories] = useState([]);

  const [cartItems, setCartItems] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cart');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  const [user, setUser] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('user') || sessionStorage.getItem('user');
      return saved ? JSON.parse(saved) : null;
    }
    return null;
  });

  // The shop's lists depend on who is signed in (what fits their garage comes first): a new
  // account means the lists fetched so far are someone else's order.
  const listAudience = user?.role === 'user' ? String(user._id || user.id || '') : '';
  const listAudienceRef = useRef(listAudience);
  useEffect(() => {
    if (listAudienceRef.current === listAudience) return;
    listAudienceRef.current = listAudience;
    forgetProductLists();
  }, [listAudience]);

  const [authPersistence, setAuthPersistence] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('user') ? 'local' : 'session';
    }
    return 'session';
  });

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [cartHydratedUserId, setCartHydratedUserId] = useState(null);

  const getCartItemKey = useCallback((item) => {
    if (item?.key) return item.key;
    if (item?.is_bundle || item?.bundle_id) {
      return `bundle_${item.bundle_id || item.bundle?._id}`;
    }
    const productId = item?.product?._id || item?.product?.id || item?.product_id;
    const variantId = item?.variant?._id || item?.variant_id;
    return variantId ? `${productId}__${variantId}` : productId;
  }, []);

  const getUserId = useCallback((userData) => userData?._id || userData?.id, []);

  useEffect(() => {
    // A dashboard opened in a NEW TAB (the packing labels, a parcel opened with
    // ctrl+click) has no saved user when the login was not "remembered": that copy lives
    // in sessionStorage, which a new tab does not inherit. The auth cookie is shared,
    // though — so ask the server who is signed in before any layout sends them to login.
    const path = window.location.pathname;
    const restore = !user && isDashboardPath(path) && !path.startsWith('/admin');
    if (restore) {
      authApi.me()
        .then((res) => {
          if (res?.role === 'vendor' && res.vendor) setUser({ ...res.vendor, role: 'vendor' });
          else if (res?.user) setUser({ ...res.user, role: 'user' });
        })
        .catch(() => {})
        .finally(() => setIsMounted(true));
    } else {
      setIsMounted(true);
    }
    // On mount, sync language from cookie/localStorage in case it differs from SSR
    // (e.g., first visit before cookie is set, or cookie cleared)
    try {
      const cookieLang = document.cookie.match(/(?:^|;\s*)language=([^;]*)/)?.[1];
      const storedLang = cookieLang || localStorage.getItem('language') || 'en';
      if (storedLang !== initialLanguage) {
        setLanguageState(storedLang);
        document.documentElement.dir = storedLang === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = storedLang;
      }
    } catch (e) {}

    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

    // Fetch site settings
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${apiBase}/settings`);
        const data = await res.json();
        if (data.success && data.settings) {
          setSiteSettings(data.settings);
        }
      } catch (e) {
        console.error('Failed to fetch site settings', e);
      }
    };

    // Fetch categories once at app root to avoid duplicate requests in children
    const fetchCategories = async () => {
      try {
        const res = await fetch(`${apiBase}/products/categories`);
        const data = await res.json();
        if (Array.isArray(data)) setCategories(data);
      } catch (e) {
        console.error('Failed to fetch categories', e);
      }
    };

    fetchSettings();
    fetchCategories();
  }, [initialLanguage]);

  // Light / dark, chosen by the visitor and remembered — the device setting is not
  // consulted. Only the dashboards apply it (AppChrome sets the `dark` class per route);
  // this holds the choice and saves it.
  const [theme, setThemeState] = useState(initialTheme === 'dark' ? 'dark' : 'light');
  const setTheme = (next) => {
    const value = next === 'dark' ? 'dark' : 'light';
    setThemeState(value);
    try {
      document.cookie = `theme=${value};path=/;max-age=31536000;SameSite=Lax`;
      localStorage.setItem('theme', value);
    } catch (e) {}
  };
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  // Setter that also writes a cookie (so next SSR render uses the right language)
  const applyLanguage = (lang) => {
    setLanguageState(lang);
    try {
      document.cookie = `language=${lang};path=/;max-age=31536000;SameSite=Lax`;
      localStorage.setItem('language', lang);
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.lang = lang;
    } catch (e) {}
  };

  // The language switch: also swaps the language in the URL (/en/products → /ar/products),
  // in place — the page is already showing, only the address changes.
  const setLanguage = (lang) => {
    applyLanguage(lang);
    try {
      const { pathname, search, hash } = window.location;
      const target = switchLocale(pathname, lang);
      if (target !== pathname) window.history.replaceState(null, '', `${target}${search}${hash}`);
    } catch (e) {}
  };

  // The URL decides the language: a link to /ar/... opened from an English page switches
  // to Arabic. Only the URL changing re-runs this — the switch above changes the language
  // and the URL together, and this must not see the language before the URL has followed.
  const routePath = usePathname();
  useEffect(() => {
    const urlLanguage = localeOfPath(window.location.pathname);
    if (urlLanguage && urlLanguage !== language) applyLanguage(urlLanguage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePath]);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('cart', JSON.stringify(cartItems));
    }
  }, [cartItems, isMounted]);

  useEffect(() => {
    if (isMounted) {
      if (user) {
        const targetStorage = authPersistence === 'local' ? localStorage : sessionStorage;
        const otherStorage = authPersistence === 'local' ? sessionStorage : localStorage;
        targetStorage.setItem('user', JSON.stringify(user));
        otherStorage.removeItem('user');
      } else {
        localStorage.removeItem('user');
        sessionStorage.removeItem('user');
      }
    }
  }, [user, authPersistence, isMounted]);

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  };

  const login = (userData, options = {}) => {
    if (Object.prototype.hasOwnProperty.call(options, 'rememberMe')) {
      setAuthPersistence(options.rememberMe ? 'local' : 'session');
    }
    // Drop the guest cart: the account cart replaces it (see fetchAccountCart).
    setCartItems([]);
    localStorage.removeItem('cart');
    setUser(userData);
    // After setting user, the useEffect will fetch the account cart
  };

  const logout = () => {
    const logoutEndpoint = user?.role === 'admin'
      ? `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/admin/logout`
      : `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/auth/logout`;

    setUser(null);
    setCartItems([]); // Clear cart on logout
    localStorage.removeItem('cart');
    sessionStorage.removeItem('checkout_mode');
    sessionStorage.removeItem('checkout_item');
    sessionStorage.removeItem('checkout_cart_item_keys');
    localStorage.removeItem('checkout_mode');
    localStorage.removeItem('checkout_item');
    localStorage.removeItem('checkout_cart_item_keys');
    sessionStorage.removeItem('user');
    localStorage.removeItem('user');
    // The guest-checkout address draft is device-local and belongs to whoever
    // was just signed in. On a shared browser, leaving it behind would pre-fill
    // the next person's checkout with the last person's address.
    localStorage.removeItem('readymarine_guest_address_draft');
    fetch(logoutEndpoint, { method: 'POST', credentials: 'include' });
  };

  // The server's session can end while this browser still holds the account (the cookie
  // expired, or the phone cleared it): every request then answers 401, and the profile was
  // stuck on "Not authorized" with no way to sign out. On a 401, ask the server who is signed
  // in; when no one is, sign out here too. One 401 alone proves nothing — a wrong password
  // answers 401 as well. The admin's session is the dashboard's own.
  const checkingSession = useRef(false);
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  useEffect(() => {
    if (user?.role !== 'user' && user?.role !== 'vendor') return undefined;
    const onUnauthorized = () => {
      if (checkingSession.current) return;
      checkingSession.current = true;
      authApi.me()
        .catch((err) => { if (err?.status === 401) logoutRef.current(); })
        .finally(() => { checkingSession.current = false; });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [user?.role]);

  // The server said the session is over for good: sign out and open the login page, coming
  // back here after. No error is shown — the request that hit it never settles (lib/api).
  const sessionEnding = useRef(false);
  useEffect(() => {
    const onSessionEnded = () => {
      if (sessionEnding.current) return;
      sessionEnding.current = true;
      const role = user?.role;
      logoutRef.current();
      const here = stripLocale(window.location.pathname);
      const back = `${here}${window.location.search}`;
      const locale = localeOfPath(window.location.pathname) || DEFAULT_LOCALE;
      if (role === 'admin') {
        const adminBack = here.startsWith('/admin/') && !here.startsWith('/admin/login') ? `?redirect=${encodeURIComponent(back)}` : '';
        window.location.replace(localizePath(`/admin/login${adminBack}`, locale));
        return;
      }
      const query = role === 'vendor'
        ? `?role=vendor${isDashboardPath(here) ? `&redirect=${encodeURIComponent(back)}` : ''}`
        : (here.startsWith('/login') ? '' : `?redirect=${encodeURIComponent(back)}`);
      window.location.replace(localizePath(`/login${query}`, locale));
    };
    window.addEventListener(SESSION_ENDED_EVENT, onSessionEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onSessionEnded);
  }, [user?.role]);

  // While the site is open, refresh the session before its access token (15 minutes) runs out,
  // and on coming back to the tab: the refresh token rotates, and the session's end moves out,
  // so a customer on the site is never signed out under them. A request that still finds the
  // token expired refreshes on its own (lib/api); a dead session ends through SESSION_ENDED_EVENT.
  useEffect(() => {
    if (user?.role !== 'user' && user?.role !== 'vendor') return undefined;
    const REFRESH_EVERY = 10 * 60 * 1000;
    const touch = () => {
      if (document.visibilityState !== 'visible' || msSinceRefresh() < REFRESH_EVERY) return;
      // No refresh cookie yet (signed in before sessions): /auth/me moves the old token onto a
      // session, and a session that is really over ends from there.
      refreshAccess().then((ok) => { if (!ok) authApi.me().catch(() => {}); });
    };
    touch();
    const timer = setInterval(touch, 60 * 1000);
    document.addEventListener('visibilitychange', touch);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', touch);
    };
  }, [user?.role]);

  // A signed-in customer keeps one socket open on every page: the server counts them as
  // online while it is, and holds back the abandoned-cart reminder email. Ticket pages
  // reuse the same connection.
  const customerId = user?.role === 'user' ? getUserId(user) : null;
  useEffect(() => {
    if (!customerId) return undefined;
    getSocket();
    return () => disconnectSocket();
  }, [customerId]);

  const clearCart = () => {
    setCartItems([]);
    localStorage.removeItem('cart');
    sessionStorage.removeItem('checkout_mode');
    sessionStorage.removeItem('checkout_item');
    sessionStorage.removeItem('checkout_cart_item_keys');
    localStorage.removeItem('checkout_mode');
    localStorage.removeItem('checkout_item');
    localStorage.removeItem('checkout_cart_item_keys');
    // Also clearing backend cart
    if (user) {
      userApi.syncCart([]).catch(console.error);
    }
  };

  const removeCartItems = (itemKeys = []) => {
    const keySet = new Set((Array.isArray(itemKeys) ? itemKeys : []).map(String));
    if (keySet.size === 0) return;
    setCartItems(prev => prev.filter(item => !keySet.has(String(item.key || item.product?._id))));
  };

  const buildCartItem = (product, variant = null, quantity = 1) => {
    const resolvedPrice =
      (variant?.discount_price ?? variant?.price) ??
      (product.discount_price ?? product.price);

    const variantLabel = variant
      ? (variant.selected_options || []).map(o => o.option_value).join(' / ')
      : null;

    const cartProduct = {
      _id: product._id || product.id,
      title_en: product.title_en || product.title,
      title_ar: product.title_ar || product.title,
      price: resolvedPrice,
      image: product.image || product.images?.[0]?.url || '',
      slug_en: product.slug_en,
      slug_ar: product.slug_ar,
      status: product.status,
      vendor_id: product.vendor_id,
    };

    const cartVariant = variant
      ? { _id: variant._id, label: variantLabel, price: resolvedPrice }
      : null;

    const itemKey = variant ? `${cartProduct._id}__${variant._id}` : cartProduct._id;
    return { key: itemKey, product: cartProduct, variant: cartVariant, quantity };
  };

  // Standardized Cart Actions
  // variant = { _id, selected_options, price, discount_price } | null
  // options.openDrawer = false keeps the cart drawer shut — the chat assistant's
  // product cards animate the item into the cart instead of opening it.
  const addToCart = (product, variant = null, quantity = 1, { openDrawer = true } = {}) => {
    const isStaffAccount = user?.role === 'vendor' || user?.role === 'admin';
    const isDraft = product?.status === 'draft';
    const isVendorSuspended = product?.vendor_id?.status === 'suspended';

    if (isStaffAccount || isDraft || isVendorSuspended) {
      const message = isStaffAccount
        ? (language === 'ar'
            ? 'حسابات الإدارة والبائعين لا يمكنها شراء المنتجات.'
            : 'Admin and vendor accounts cannot purchase products.')
        : (language === 'ar'
            ? 'هذا المنتج غير متاح للشراء حالياً.'
            : 'This product is not available for purchase right now.');
      if (typeof window !== 'undefined') window.alert(message);
      return false;
    }

    const addedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
    const newItem = buildCartItem(product, variant, addedQuantity);
    const itemKey = newItem.key;

    setCartItems(prev => {
      const existing = prev.find(item => item.key === itemKey);
      if (existing) {
        return prev.map(item =>
          item.key === itemKey ? { ...item, quantity: item.quantity + addedQuantity } : item
        );
      }
      return [...prev, newItem];
    });
    if (openDrawer) setIsCartOpen(true);

    return true;
  };

  const buyNow = (product, variant = null) => {
    const isStaffAccount = user?.role === 'vendor' || user?.role === 'admin';
    const isDraft = product?.status === 'draft';
    const isVendorSuspended = product?.vendor_id?.status === 'suspended';

    if (isStaffAccount || isDraft || isVendorSuspended) {
      const message = isStaffAccount
        ? (language === 'ar'
            ? 'حسابات الإدارة والبائعين لا يمكنها شراء المنتجات.'
            : 'Admin and vendor accounts cannot purchase products.')
        : (language === 'ar'
            ? 'هذا المنتج غير متاح للشراء حالياً.'
            : 'This product is not available for purchase right now.');
      if (typeof window !== 'undefined') window.alert(message);
      return false;
    }

    if (typeof window !== 'undefined') {
      const checkoutItem = JSON.stringify(buildCartItem(product, variant));
      try {
        sessionStorage.setItem('checkout_mode', 'buy_now');
        sessionStorage.setItem('checkout_item', checkoutItem);
        localStorage.setItem('checkout_mode', 'buy_now');
        localStorage.setItem('checkout_item', checkoutItem);
      } catch (error) {
        try {
          localStorage.setItem('checkout_mode', 'buy_now');
          localStorage.setItem('checkout_item', checkoutItem);
        } catch (_) {
          return false;
        }
      }
    }
    return true;
  };

  // A bundle is one synthetic cart line: product.price = the effective bundle
  // price so cartTotal (Σ price*qty) sums it as a single line. Server re-prices
  // authoritatively at checkout.
  const buildBundleCartItem = (bundle, quantity = 1) => {
    const effective = bundle.pricing?.effective ?? bundle.price ?? 0;
    const primary = (bundle.images || []).find(i => i.is_primary);
    const image = bundle.image || primary?.url || bundle.images?.[0]?.url || '';
    const members = (bundle.members || []).map(m => {
      const p = m.product_id && typeof m.product_id === 'object' ? m.product_id : (m.product || {});
      const mImg = (p.images || []).find(i => i.is_primary)?.url || p.images?.[0]?.url || m.image || '';
      return {
        product_id: p._id || m.product_id,
        title_en: p.title_en,
        title_ar: p.title_ar,
        image: mImg,
        quantity: m.quantity,
      };
    });
    return {
      key: `bundle_${bundle._id}`,
      is_bundle: true,
      bundle_id: bundle._id,
      product: {
        _id: bundle._id,
        title_en: bundle.title_en,
        title_ar: bundle.title_ar,
        price: effective,
        image,
        slug_en: bundle.slug_en,
        slug_ar: bundle.slug_ar,
        status: 'published',
      },
      members,
      variant: null,
      quantity,
    };
  };

  const bundlePurchaseBlocked = (bundle) => {
    const isStaffAccount = user?.role === 'vendor' || user?.role === 'admin';
    if (isStaffAccount) {
      if (typeof window !== 'undefined') window.alert(language === 'ar'
        ? 'حسابات الإدارة والبائعين لا يمكنها شراء المنتجات.'
        : 'Admin and vendor accounts cannot purchase products.');
      return true;
    }
    if (bundle?.is_purchasable === false) {
      if (typeof window !== 'undefined') window.alert(language === 'ar'
        ? 'هذه الباقة غير متاحة للشراء حالياً.'
        : 'This bundle is not available for purchase right now.');
      return true;
    }
    return false;
  };

  const addBundleToCart = (bundle, quantity = 1) => {
    if (bundlePurchaseBlocked(bundle)) return false;
    const addedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
    const newItem = buildBundleCartItem(bundle, addedQuantity);
    setCartItems(prev => {
      const existing = prev.find(item => item.key === newItem.key);
      if (existing) {
        return prev.map(item => item.key === newItem.key
          ? { ...item, quantity: item.quantity + addedQuantity } : item);
      }
      return [...prev, newItem];
    });
    setIsCartOpen(true);
    return true;
  };

  const buyNowBundle = (bundle, quantity = 1) => {
    if (bundlePurchaseBlocked(bundle)) return false;
    if (typeof window !== 'undefined') {
      const checkoutItem = JSON.stringify(buildBundleCartItem(bundle, Math.max(1, Math.floor(Number(quantity) || 1))));
      try {
        sessionStorage.setItem('checkout_mode', 'buy_now');
        sessionStorage.setItem('checkout_item', checkoutItem);
        localStorage.setItem('checkout_mode', 'buy_now');
        localStorage.setItem('checkout_item', checkoutItem);
      } catch (_) {
        try {
          localStorage.setItem('checkout_mode', 'buy_now');
          localStorage.setItem('checkout_item', checkoutItem);
        } catch (__) { return false; }
      }
    }
    return true;
  };

  const removeFromCart = (itemKey) => {
    setCartItems(prev => prev.filter(item => item.key !== itemKey));
  };

  const updateCartQuantity = (itemKey, qty) => {
    const nextQty = Math.max(0, Math.floor(Number(qty) || 0));
    setCartItems(prev =>
      prev.map(item => item.key === itemKey ? { ...item, quantity: nextQty } : item)
        .filter(item => item.quantity > 0)
    );
  };

  // Backend Sync Logic
  // 1. Load the account cart on mount or user change.
  // The account cart on the server is the only source of truth for a signed-in
  // user. Whatever sat in this browser while signed out is dropped, never merged:
  // merging re-added the guest items on every sign-in and doubled quantities.
  useEffect(() => {
    const fetchAccountCart = async () => {
      const userId = getUserId(user);
      if (isMounted && userId && user?.role === 'user') {
        try {
          const backendItems = await userApi.getCart();
          // Ensure backend items have a key; reshape bundle lines into the
          // synthetic single-line form the cart math/UI expect.
          const normalised = backendItems.map(item => {
            if (item?.is_bundle && item?.bundle) {
              const b = item.bundle;
              return {
                key: `bundle_${b._id}`,
                is_bundle: true,
                bundle_id: b._id,
                product: {
                  _id: b._id,
                  title_en: b.title_en,
                  title_ar: b.title_ar,
                  price: b.price,
                  image: b.image,
                  slug_en: b.slug_en,
                  slug_ar: b.slug_ar,
                  status: 'published',
                },
                members: [],
                variant: null,
                quantity: item.quantity,
              };
            }
            return { ...item, key: getCartItemKey(item) };
          });
          setCartItems(normalised);
          setCartHydratedUserId(userId);
        } catch (error) {
          // Keep the local copy but do NOT mark the cart hydrated, so the
          // authoritative sync below cannot overwrite the account cart with it.
          console.error('Failed to fetch cart:', error);
        }
      }
    };
    fetchAccountCart();
  }, [user, isMounted, getUserId, getCartItemKey]);

  // 2. Authoritative Sync to Backend
  useEffect(() => {
    const userId = getUserId(user);
    if (isMounted && userId && user?.role === 'user' && cartHydratedUserId === userId) {
      const sync = async () => {
        try {
          await userApi.syncCart(cartItems);
        } catch (error) {
          console.error('Cart sync failed:', error);
        }
      };
      const timer = setTimeout(sync, 800);
      return () => clearTimeout(timer);
    }
  }, [cartItems, user, cartHydratedUserId, isMounted, getUserId]);

  /*
   * The chat assistant's basket, mirrored into this cart (components/chat). Each
   * change is `{ ref: { product, variant }, delta }` — only what one of the
   * assistant's turns added or took out, never the whole basket, so what the
   * customer put in the cart themselves is left alone. Quietly: no drawer, no alert.
   */
  const applyCartChanges = useCallback((changes = []) => {
    if (!Array.isArray(changes) || changes.length === 0) return;
    setCartItems(prev => {
      let next = prev;
      for (const { ref, delta } of changes) {
        if (!ref?.product?._id || !delta) continue;
        const built = buildCartItem(ref.product, ref.variant || null, Math.max(1, Math.abs(delta)));
        const existing = next.find(item => item.key === built.key);
        if (delta > 0) {
          next = existing
            ? next.map(item => (item.key === built.key ? { ...item, quantity: item.quantity + delta } : item))
            : [...next, { ...built, quantity: delta }];
        } else if (existing) {
          const quantity = existing.quantity + delta;
          next = quantity > 0
            ? next.map(item => (item.key === built.key ? { ...item, quantity } : item))
            : next.filter(item => item.key !== built.key);
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bumped whenever an order is placed on the website, so the chat assistant can
  // close the basket it holds for the same products.
  const [orderedSeq, setOrderedSeq] = useState(0);
  const markOrdered = useCallback(() => setOrderedSeq(n => n + 1), []);

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cartItems.reduce((sum, item) => sum + (item.product.price || 0) * item.quantity, 0);

  // 't' always uses the current language — no isMounted gate needed since
  // initialLanguage from the server already matches what the client renders.
  const t = translations[language] || translations['en'];

  return (
    <AppContext.Provider value={{
      language,
      setLanguage,
      toggleLanguage,
      theme,
      setTheme,
      toggleTheme,
      cartItems,
      cartCount,
      cartTotal,
      addToCart,
      buyNow,
      addBundleToCart,
      buyNowBundle,
      removeFromCart,
      removeCartItems,
      updateCartQuantity,
      applyCartChanges,
      orderedSeq,
      markOrdered,
      isCartOpen,
      setIsCartOpen,
      user,
      login,
      logout,
      clearCart,
      isMounted,
      siteSettings,
      setSiteSettings,
      categories,
      t
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

/** The current language, or `undefined` outside AppProvider (where useApp would throw). */
export function useAppLanguage() {
  return useContext(AppContext)?.language;
}
