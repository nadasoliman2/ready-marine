"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from '../../lib/navigation';
import { useApp } from "../../context/AppContext";
import { trackAdAction } from "../../lib/adTracking";
import { couponsApi, orderApi, userApi, shippingApi, familyApi, friendsApi, friendCheckoutApi, loyaltyApi, walletApi, guestApi } from "../../lib/api";
import { ArrowLeft, MapPin, CheckCircle2, ChevronRight, CreditCard, Loader2, Ticket, X, Truck, Users, Send, Lock, Info, Gift, Sparkles, Wallet, Plus, AlertCircle, LogIn, Building2, ShieldCheck, Anchor, BadgeCheck } from "lucide-react";
import Link from '../../components/LocaleLink';
import ShippingZoneSelect from "../../components/ShippingZoneSelect";
import DeliverySplitSummary from "../../components/checkout/DeliverySplitSummary";
import KnownNumberPrompt from "../../components/checkout/KnownNumberPrompt";
import GuestOrderConfirmation from "../../components/checkout/GuestOrderConfirmation";
import CompanyCheckoutPanel, { CompanyOfficePicker, companyReasonText } from "../../components/checkout/CompanyCheckoutPanel";
import { companyErrorCopy } from "../../lib/companyLocalization";
import { refreshMyCompany } from "../../components/company/useMyCompany";
import { readRememberedCompanyCar } from "../../components/company/useGarageCars";
import { guestErrorCopy } from "../../lib/guestCheckoutLocalization";
import { familyCopy, getRelationshipLabel } from "../../lib/familyLocalization";
import { friendCopy, friendErrorCopy } from "../../lib/friendLocalization";
import { loyaltyCopy, loyaltyBlockedCopy } from "../../lib/loyaltyLocalization";
import { walletCopy } from "../../lib/walletLocalization";
import { resolveAssetUrl } from "../../lib/assets";
import { orgTerms } from '../../lib/orgTerms';
import { useActiveOrgType } from '../../components/company/OrgTermsContext';

const META_CURRENCY = 'EGP';
const getCartItemKey = (item) => String(item?.key || item?.product?._id || '');
const getMetaContentId = (item) => String(item?.product?._id || item?.product?.id || item?.product_id || '');

const buildMetaCommerceData = (items, value, currency) => ({
  value: Number(value || 0),
  currency: String(currency || 'QAR').toUpperCase(),
  content_type: 'product',
  content_ids: items.map(getMetaContentId).filter(Boolean),
  contents: items.map((item) => ({
    id: getMetaContentId(item),
    quantity: Number(item.quantity || 1),
    item_price: Number(item.product?.price || 0),
  })).filter((item) => item.id),
  num_items: items.reduce((total, item) => total + Number(item.quantity || 1), 0),
});

const clearCheckoutSelectionStorage = () => {
  sessionStorage.removeItem('checkout_mode');
  sessionStorage.removeItem('checkout_item');
  sessionStorage.removeItem('checkout_cart_item_keys');
  localStorage.removeItem('checkout_mode');
  localStorage.removeItem('checkout_item');
  localStorage.removeItem('checkout_cart_item_keys');
};

export default function CheckoutPage() {
  const router = useRouter();
  const { user, login, cartItems, language, isMounted, t, clearCart, removeCartItems, siteSettings, markOrdered } = useApp();
  const [buyNowItem, setBuyNowItem] = useState(null);
  const [buyNowLoaded, setBuyNowLoaded] = useState(false);
  const [checkoutMode, setCheckoutMode] = useState(null);
  const [selectedCartKeys, setSelectedCartKeys] = useState([]);

  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);

  // ---- Family checkout mode ----
  // `familyContext` is null unless the signed-in customer is an active family
  // MEMBER; the organizer option only appears when the backend says so.
  const [familyContext, setFamilyContext] = useState(null);
  // 'myself' | 'organizer' (family) | 'friend'
  const [recipient, setRecipient] = useState('myself');
  const [memberNote, setMemberNote] = useState('');
  const [requestSent, setRequestSent] = useState(null);

  // ---- Friend checkout mode ----
  // Friends who have shared at least one usable address with this customer.
  const [friends, setFriends] = useState([]);
  const [selectedFriendId, setSelectedFriendId] = useState(null);
  const [friendAddresses, setFriendAddresses] = useState([]);
  const [friendAddressesLoading, setFriendAddressesLoading] = useState(false);

  // New address form state
  const [showNewAddressForm, setShowNewAddressForm] = useState(false);
  const [newAddress, setNewAddress] = useState({
    recipient_name: "",
    phone: "",
    full_address: "",
    shipping_country: "",
    shipping_city: "",
  });

  // ---- Guest checkout ----
  // The account is created from this same address form, silently, the moment it
  // holds a name and a valid number — which is also the moment checkout starts
  // needing an authenticated session for the shipping quote and the price
  // preview. Nothing about it is presented to the customer as signing up.
  const [guestBootstrapping, setGuestBootstrapping] = useState(false);
  const [guestSessionError, setGuestSessionError] = useState('');
  // Set when the typed number turns out to belong to a real account. This is an
  // OFFER — the customer can wave it away and carry on filling in the form.
  const [knownNumber, setKnownNumber] = useState(null);
  const [knownNumberDismissed, setKnownNumberDismissed] = useState(false);
  // The number the server has actually REFUSED a guest session for.
  //
  // Distinct from `knownNumber` because the two mean different things and one
  // of them is not optional. A lookup hit is a suggestion; this is the server
  // saying the number belongs to someone with an account, and no amount of
  // dismissing changes that — a session for it would be an account takeover.
  // Holding the number itself rather than a boolean is what stops the bootstrap
  // effect from retrying the same rejected number forever, while still letting
  // a corrected number try again immediately.
  const [signInRequiredFor, setSignInRequiredFor] = useState('');
  // The order that was just placed by a guest, kept so the success screen can
  // show the confirmation panel and the points it earned.
  const [guestPlacedOrder, setGuestPlacedOrder] = useState(null);
  // A consolidated company order: the confirmation stays up to say where it waits.
  const [batchPlacedOrder, setBatchPlacedOrder] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');

  // Shipping state
  const [shippingEnabled, setShippingEnabled] = useState(true);
  const [zoneTree, setZoneTree] = useState([]);
  const [singleCountry, setSingleCountry] = useState(null);
  // Destination for THIS order. Derived from the active address; the inline picker
  // (shown only when a saved address lacks a zone) writes here too.
  const [destCountry, setDestCountry] = useState('');
  const [destCity, setDestCity] = useState('');
  const [shippingQuote, setShippingQuote] = useState(null);
  // How this basket will physically arrive, and what each courier will collect. Comes from
  // the same preview that prices the order, so what the customer reads before paying is
  // exactly what is later frozen and sent to Bosta as each parcel's COD.
  const [deliverySplit, setDeliverySplit] = useState(null);
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingError, setShippingError] = useState('');

  // ---- Loyalty points ----
  // `wallet` is the customer's balance and the program rules; `loyaltyPreview`
  // is the server's authoritative answer for THIS basket. The two are separate
  // because the balance alone cannot tell you how much of it this order allows.
  const [wallet, setWallet] = useState(null);
  const [useLoyalty, setUseLoyalty] = useState(false);
  const [requestedPoints, setRequestedPoints] = useState(0);
  const [loyaltyPreview, setLoyaltyPreview] = useState(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);

  // ---- Store-credit wallet ----
  // Deliberately NOT called `wallet`: that name is already taken above by the
  // loyalty balance. `walletInfo` is the server's answer for THIS basket —
  // balance, shortfall, and whether the order can be paid at all — recomputed
  // by the same preview call that prices the order, so the two can never drift.
  const [walletInfo, setWalletInfo] = useState(null);
  // Which prepaid methods the server is offering right now. The wallet no
  // longer replaces the gateway — the store decides whether both are on — so
  // this comes from the same preview rather than being inferred here.
  const [paymentMethods, setPaymentMethods] = useState(null);
  // Whether cash at the door is on offer for THIS customer. The server decides; the reason
  // is deliberately never sent, so there is nothing here to render an explanation from.
  // Null until the preview lands, and treated as "yes" so a slow request never looks like
  // the store removed cash on delivery.
  const [codAllowed, setCodAllowed] = useState(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);
  const [showTopupInput, setShowTopupInput] = useState(false);
  const [topupNotice, setTopupNotice] = useState(null);
  // Bumped after a successful top-up to force the price/wallet preview to
  // refetch — the basket has not changed, but the balance behind it has.
  const [checkoutRefreshKey, setCheckoutRefreshKey] = useState(0);

  // ---- Company account (feature 14) ----
  // `companyInfo` is the server's answer for THIS basket: whether the customer
  // may order on their company's account, and how the total would split between
  // the company and them. Like the wallet, never derived in the browser.
  const [companyInfo, setCompanyInfo] = useState(null);
  const [companySel, setCompanySel] = useState({ company_id: null, beneficiary: null, car_id: '', delivery_mode: null, ship_now_vendor_ids: [] });
  const [selectedOfficeId, setSelectedOfficeId] = useState(null);

  const isAr = language === "ar";
  // A school or a property pays the same way as a company; only the words differ.
  const companyTerms = orgTerms(companyInfo?.company?.org_type, isAr);
  useActiveOrgType(companyInfo?.company?.org_type);
  const direction = isAr ? "rtl" : "ltr";
  const isStaffAccount = user?.role === "vendor" || user?.role === "admin";
  // Signed in, but on an account created during this checkout whose number is
  // still unproven. Such a session is deliberately allowed to buy and nothing
  // else — the server enforces the same rule independently.
  const isGuestSession = !!user && (user.is_guest === true || (user.account_status === 'guest' && !user.phone_verified_at));
  // No session at all: the form is being filled in before an account exists.
  const isAnonymous = !user;
  const currency = siteSettings?.currency || 'QAR';
  const isBuyNow = checkoutMode === 'buy_now';
  const isSelectedCart = checkoutMode === 'cart_selected';
  const checkoutItems = useMemo(() => {
    if (isBuyNow) return buyNowItem ? [buyNowItem] : [];
    if (!isSelectedCart) return cartItems;
    const keySet = new Set(selectedCartKeys.map(String));
    return cartItems.filter(item => keySet.has(getCartItemKey(item)));
  }, [isBuyNow, isSelectedCart, buyNowItem, cartItems, selectedCartKeys]);
  const checkoutItemsSignature = useMemo(
    () => checkoutItems.map(item => `${getCartItemKey(item)}:${item.quantity}`).join('|'),
    [checkoutItems]
  );
  const checkoutTotal = checkoutItems.reduce((sum, item) => sum + Number(item.product.price || 0) * Number(item.quantity || 0), 0);

  // Convert cart lines into the shape the backend expects: bundle lines become
  // { bundle_id, quantity } (server re-prices + expands them); product lines
  // pass through unchanged. Used for the order POST, coupon, and shipping quote.
  const toOrderPayloadItems = (items) => items.map(item =>
    (item.is_bundle || item.bundle_id)
      ? { bundle_id: item.bundle_id || item.product?._id, quantity: item.quantity }
      : item
  );

  const fam = useMemo(() => familyCopy(isAr), [isAr]);
  const frnd = useMemo(() => friendCopy(isAr), [isAr]);
  const loy = useMemo(() => loyaltyCopy(isAr), [isAr]);
  const organizerName = familyContext?.organizer?.name || '';
  const isFamilyMode = recipient === 'organizer' && !!familyContext?.organizer;
  const familyAddresses = familyContext?.addresses || [];

  const selectedFriend = friends.find((f) => String(f._id) === String(selectedFriendId)) || null;
  const isFriendMode = recipient === 'friend' && !!selectedFriend;
  const friendName = selectedFriend?.name || '';
  // Buying for someone else — either a family organizer or a friend. In both
  // cases the address belongs to the recipient and is strictly read-only here.
  const isGiftMode = isFamilyMode || isFriendMode;

  // A company order may go to one of the company's offices instead of a personal address.
  const companyMode = paymentMethod === 'company_account' && !isGiftMode;
  // Consolidate to office or instant (phase 3). Consolidating is the default wherever the
  // company allows it — it is the cheaper one — and it always goes to an office.
  const companyDeliveryMode = companySel.delivery_mode
    || (companyInfo?.modes?.consolidate ? 'consolidate' : (companyInfo?.modes ? 'instant' : null));
  const consolidating = companyMode && companyDeliveryMode === 'consolidate';
  const companyOffices = companyInfo?.offices || [];
  const selectedOffice = companyMode ? (companyOffices.find((o) => String(o._id) === String(selectedOfficeId)) || null) : null;
  const deliveringToOffice = !!selectedOffice;

  const usingNewAddress = !isGiftMode && !deliveringToOffice && !consolidating && (showNewAddressForm || addresses.length === 0);
  const addressPool = isFriendMode ? friendAddresses : (isFamilyMode ? familyAddresses : addresses);
  const selectedSavedAddress = !usingNewAddress ? addressPool.find((a) => a._id === selectedAddressId) : null;

  useEffect(() => {
    if (!isMounted || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const storedMode = sessionStorage.getItem('checkout_mode') || localStorage.getItem('checkout_mode');
    const nextMode = params.get('buy_now') === '1' || storedMode === 'buy_now'
      ? 'buy_now'
      : storedMode === 'cart_selected'
        ? 'cart_selected'
        : 'cart';
    setCheckoutMode(nextMode);

    if (nextMode === 'cart_selected') {
      try {
        const rawKeys = sessionStorage.getItem('checkout_cart_item_keys') || localStorage.getItem('checkout_cart_item_keys');
        const parsedKeys = rawKeys ? JSON.parse(rawKeys) : [];
        setSelectedCartKeys(Array.isArray(parsedKeys) ? parsedKeys.map(String) : []);
      } catch (err) {
        setSelectedCartKeys([]);
      }
    } else {
      setSelectedCartKeys([]);
    }

    if (nextMode !== 'buy_now') {
      setBuyNowItem(null);
      setBuyNowLoaded(true);
      return;
    }
    try {
      const raw = sessionStorage.getItem('checkout_item') || localStorage.getItem('checkout_item');
      setBuyNowItem(raw ? JSON.parse(raw) : null);
    } catch (err) {
      setBuyNowItem(null);
    } finally {
      setBuyNowLoaded(true);
    }
  }, [isMounted]);

  useEffect(() => {
    if (!isMounted) return;
    if (!checkoutMode) return;
    if (isBuyNow && !buyNowLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const isPaymentReturn = !!params.get('payment');
    // There is deliberately no signed-out branch here any more. Checkout used to
    // redirect to /login, which meant every customer without an account met a
    // wall before they could see a delivery price — the single largest drop-off
    // in the funnel. A visitor now goes straight to the form; the account is
    // created from what they type into it.
    if (user?.role === 'vendor') {
      router.push("/dashboard");
    } else if (user?.role === 'admin') {
      router.push("/admin/dashboard");
    } else if (isBuyNow && buyNowLoaded && !buyNowItem && !success && !isPaymentReturn) {
      setError(isAr ? 'تعذر تحميل المنتج المحدد للشراء الآن. يرجى المحاولة مرة أخرى.' : 'Could not load the selected Buy Now item. Please try again.');
    } else if (checkoutItems.length === 0 && !success && !isPaymentReturn) {
      router.push("/");
    } else {
      setError(null);
      // Zones are public — a visitor has to be able to pick a city and see a
      // shipping cost before anything asks who they are.
      fetchZones();
      // The rest need a session. A guest one is refused by the server for all
      // of them (an unconfirmed guest discloses nothing), so they are simply
      // not asked for until there is a real account behind the request.
      if (user && !isGuestSession) {
        fetchAddresses();
        fetchFamilyContext();
        fetchFriends();
        fetchWallet();
      } else if (isGuestSession) {
        // A guest has no saved addresses to choose between, so the form is the
        // only thing to show — and showing it immediately avoids a flash of an
        // empty address list.
        setAddresses([]);
        setShowNewAddressForm(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, user, isGuestSession, checkoutItems.length, router, success, buyNowItem, buyNowLoaded, isBuyNow]);

  const completeCartAfterOrder = () => {
    // The draft existed to survive an abandoned checkout. This one was not
    // abandoned, so keeping it would mean the next visitor to this browser
    // opens checkout pre-filled with the last customer's address.
    try { localStorage.removeItem('readycar_guest_address_draft'); } catch (err) { /* nothing to clean up */ }
    // The chat assistant closes the basket it holds for these products, so it
    // does not offer them again (components/chat).
    markOrdered();
    if (isBuyNow) {
      clearCheckoutSelectionStorage();
      return;
    }
    if (isSelectedCart) {
      removeCartItems(selectedCartKeys);
      clearCheckoutSelectionStorage();
      return;
    }
    clearCart();
  };

  const trackPurchase = (order) => {
    const orderId = String(order?._id || order?.id || '');
    const storageKey = orderId ? `readycar_meta_purchase_${orderId}` : '';
    const eventData = buildMetaCommerceData(checkoutItems, order?.total_price ?? finalTotal, META_CURRENCY);
    const sendPurchase = () => {
      if (typeof window.fbq !== 'function') return;
      try {
        if (storageKey && localStorage.getItem(storageKey)) return;
        if (orderId) {
          window.fbq('track', 'Purchase', eventData, { eventID: `purchase_${orderId}` });
        } else {
          window.fbq('track', 'Purchase', eventData);
        }
        if (storageKey) localStorage.setItem(storageKey, '1');
      } catch (err) {
        // Analytics must never interrupt a completed order.
        console.warn('Meta Purchase tracking failed', err);
      }
    };

    if (typeof window.fbq === 'function') {
      sendPurchase();
    } else {
      window.addEventListener('readycar:meta-pixel-ready', sendPurchase, { once: true });
    }
  };

  useEffect(() => {
    if (!isMounted || !user || user.role === 'vendor' || user.role === 'admin') return;
    if (!checkoutMode) return;
    if (isBuyNow && !buyNowLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    const paymentId = params.get('paymentId');
    const invoiceId = params.get('invoice_id');

    // A friend payment confirms through the friend-checkout endpoint, which
    // resolves idempotently to the single order the payment produced.
    if (params.get('context') === 'friend' && paymentStatus === 'success' && paymentId) {
      setLoading(true);
      setError(null);
      friendCheckoutApi.confirmPayment({ paymentId, invoice_id: invoiceId })
        .then((res) => {
          if (res.status === 'paid') {
            setSuccess(true);
            completeCartAfterOrder();
            setTimeout(() => { router.push('/profile?tab=orders'); }, 2500);
          } else {
            setError(isAr ? 'الدفع لم يتم تأكيده بعد.' : 'Payment is not confirmed yet.');
          }
        })
        .catch((err) => setError(friendErrorCopy(err.code, isAr) || err.message))
        .finally(() => setLoading(false));
      return;
    }

    if (paymentStatus === 'success' && paymentId) {
      setLoading(true);
      setError(null);
      orderApi.confirmPayment({ paymentId, invoice_id: invoiceId })
        .then((res) => {
          if (res.status === 'paid') {
            trackPurchase(res.order);
            setSuccess(true);
            completeCartAfterOrder();
            // A company order paid its difference by card: the limit moved.
            if (res.order?.company) refreshMyCompany();
            // A guest returning from the gateway gets the same held screen as a
            // cash one. The card already proved they can pay; the code is what
            // hands them the account, and it is still worth offering here.
            if (isGuestSession) {
              setGuestPlacedOrder(res.order || null);
              return;
            }
            setTimeout(() => { router.push("/profile?tab=orders"); }, 2500);
          } else {
            setError(isAr ? 'الدفع لم يتم تأكيده بعد.' : 'Payment is not confirmed yet.');
          }
        })
        .catch((err) => {
          setError(err.message || (isAr ? 'تعذر تأكيد الدفع.' : 'Could not confirm payment.'));
        })
        .finally(() => setLoading(false));
    } else if (paymentStatus === 'pending') {
      setError(isAr ? 'عملية الدفع قيد الانتظار.' : 'Payment is pending.');
    } else if (paymentStatus === 'failed') {
      setError(isAr ? 'فشلت عملية الدفع أو تم إلغاؤها.' : 'Payment failed or was cancelled.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, user, checkoutMode, buyNowLoaded, isBuyNow, isSelectedCart, selectedCartKeys]);

  /* ------------------------------------------------------------------ */
  /* Guest checkout                                                      */
  /* ------------------------------------------------------------------ */

  const EG_PHONE = /^(01\d{9}|\+201\d{9}|00201\d{9}|201\d{9})$/;
  const guestFormReady = usingNewAddress
    && !!newAddress.recipient_name.trim()
    && EG_PHONE.test(newAddress.phone.trim());
  // The number in the field right now is the one a guest session was refused
  // for. Compared rather than remembered as a boolean so that editing the field
  // clears the block on its own, with no extra bookkeeping to get wrong.
  const blockingSignIn = isAnonymous
    && !!signInRequiredFor
    && signInRequiredFor === newAddress.phone.trim();

  /**
   * Remember the address form on THIS DEVICE, for a visitor the server will not
   * remember for them.
   *
   * A guest's saved addresses are deliberately withheld until they confirm their
   * number, which is right — but it means a customer who abandons a checkout and
   * comes back would retype everything, and retyping an address is where a
   * second attempt gets abandoned too. The draft never leaves the browser, holds
   * only what the customer typed themselves, and is dropped the moment the order
   * it belongs to is placed.
   */
  const GUEST_DRAFT_KEY = 'readycar_guest_address_draft';

  useEffect(() => {
    if (!isMounted || !isAnonymous) return;
    // Only ever restore into an untouched form — never over something the
    // customer is in the middle of typing.
    if (newAddress.recipient_name || newAddress.phone || newAddress.full_address) return;
    try {
      const raw = localStorage.getItem(GUEST_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      setNewAddress((a) => ({
        ...a,
        recipient_name: draft.recipient_name || '',
        phone: draft.phone || '',
        full_address: draft.full_address || '',
        shipping_country: draft.shipping_country || a.shipping_country || '',
        shipping_city: draft.shipping_city || a.shipping_city || '',
      }));
    } catch (err) {
      // A corrupt draft is not worth a broken checkout — start clean.
      localStorage.removeItem(GUEST_DRAFT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted]);

  useEffect(() => {
    if (!isMounted || (!isAnonymous && !isGuestSession) || !usingNewAddress) return;
    if (!newAddress.recipient_name && !newAddress.phone && !newAddress.full_address) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(GUEST_DRAFT_KEY, JSON.stringify(newAddress));
      } catch (err) {
        // Private browsing, or a full quota. The checkout does not depend on
        // this succeeding — it is a convenience, and it fails silently.
      }
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMounted, isAnonymous, isGuestSession, usingNewAddress, newAddress]);

  /**
   * Create (or resume) the account this checkout belongs to.
   *
   * Called from two places on purpose. The effect below runs it as soon as the
   * form holds a name and a valid number, because everything that prices the
   * order — the shipping quote, the preview, the wallet — is authenticated and
   * would otherwise fail while the customer watched. The place-order handler
   * runs it again as a guard, so a session that never got created (a lookup
   * that raced, a request that failed) cannot lose the order at the last step.
   *
   * Resolves to true when there is a usable session afterwards.
   */
  const guestSessionInFlight = useRef(null);
  const ensureGuestSession = async () => {
    if (user) return true;
    // Collapse concurrent callers onto one request. Without this the effect and
    // the submit handler can both fire and race to create the same account.
    if (guestSessionInFlight.current) return guestSessionInFlight.current;

    const name = newAddress.recipient_name.trim();
    const phone = newAddress.phone.trim();
    if (!name || !EG_PHONE.test(phone)) return false;

    const attempt = (async () => {
      setGuestBootstrapping(true);
      setGuestSessionError('');
      try {
        const res = await guestApi.startSession({ name, phone, language });
        // Persisted like a normal session: the confirmation code arrives on
        // WhatsApp and answering it often means leaving and returning to the tab.
        login(res.user, { rememberMe: true });
        return true;
      } catch (err) {
        // The number belongs to a real account. That is not an error to show —
        // it is the cue to offer a sign-in code, which the prompt below does.
        if (err.code === 'ACCOUNT_EXISTS') {
          setSignInRequiredFor(phone);
          setKnownNumber({ phone, canUsePassword: true });
          setKnownNumberDismissed(false);
          return false;
        }
        setGuestSessionError(guestErrorCopy(err.code, isAr) || err.message);
        return false;
      } finally {
        setGuestBootstrapping(false);
        guestSessionInFlight.current = null;
      }
    })();

    guestSessionInFlight.current = attempt;
    return attempt;
  };

  /**
   * Open the session as soon as the form can support one.
   *
   * Debounced because it is keyed off a field the customer is still typing in:
   * firing on every keystroke of an eleven-digit number would mean ten wasted
   * requests and, worse, ten chances to create an account from a half-typed one.
   */
  useEffect(() => {
    if (!isAnonymous || !guestFormReady || knownNumber) return;
    // Already refused for this exact number. Retrying would fail identically and
    // re-raise the prompt the customer just dismissed, which reads as the screen
    // arguing with them. A corrected number no longer matches, so it tries again.
    if (signInRequiredFor && signInRequiredFor === newAddress.phone.trim()) return;
    const timer = setTimeout(() => { ensureGuestSession(); }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnonymous, guestFormReady, newAddress.recipient_name, newAddress.phone, knownNumber, signInRequiredFor]);

  /**
   * Ask whether the typed number already has an account, as the customer leaves
   * the field.
   *
   * The answer is a bare boolean — the endpoint never returns a name or a masked
   * contact — so a positive result is only ever turned into an OFFER to sign in,
   * never into a claim about who this number belongs to.
   */
  const handlePhoneBlur = async () => {
    const phone = newAddress.phone.trim();
    if (!isAnonymous || !EG_PHONE.test(phone) || knownNumberDismissed) return;
    try {
      const res = await guestApi.lookupPhone(phone);
      if (res?.exists) {
        setKnownNumber({ phone, canUsePassword: !!res.can_use_password });
      } else {
        setKnownNumber(null);
      }
    } catch (err) {
      // A failed lookup means the checkout carries on as though the number were
      // new. That is the safe default: it offers nothing and blocks nothing.
      setKnownNumber(null);
    }
  };

  /**
   * A returning customer finished the code. They now hold a real session, so
   * everything that was withheld from a guest — saved addresses, points, the
   * wallet — is fetched, and the offer disappears.
   */
  const handleKnownNumberSignedIn = (signedInUser) => {
    login(signedInUser, { rememberMe: true });
    setKnownNumber(null);
    setKnownNumberDismissed(true);
    setShowNewAddressForm(false);
  };

  const fetchZones = async () => {
    try {
      const data = await shippingApi.getZones();
      setShippingEnabled(data?.config?.enabled !== false);
      setZoneTree(data?.tree || []);
      setSingleCountry(data?.config?.single_country || null);
    } catch (err) {
      setShippingEnabled(false);
      setZoneTree([]);
      setSingleCountry(null);
    }
  };

  // Resolves to an organizer + shared addresses only for an active family
  // member. Any failure simply leaves the normal checkout untouched.
  const fetchFamilyContext = async () => {
    try {
      const data = await familyApi.getSharedAddresses();
      setFamilyContext(data?.organizer ? data : null);
    } catch (err) {
      setFamilyContext(null);
    }
  };

  /**
   * Friends this customer can buy for. `?for=<friendId>` (from the Friends tab)
   * preselects one; the backend still re-authorizes every step regardless.
   */
  const fetchFriends = async () => {
    try {
      const data = await friendsApi.getPurchasable();
      const purchasable = (data?.friends || []).filter((f) => f.can_buy_for_them);
      setFriends(purchasable);

      const requested = new URLSearchParams(window.location.search).get('for');
      if (requested && purchasable.some((f) => String(f._id) === requested)) {
        setSelectedFriendId(requested);
        setRecipient('friend');
      }
    } catch (err) {
      setFriends([]);
    }
  };

  // The customer's balance and the program rules. A failure here simply hides
  // the points control — loyalty is never allowed to block a checkout.
  const fetchWallet = async () => {
    try {
      const data = await loyaltyApi.getWallet();
      setWallet(data?.enabled ? data : null);
    } catch (err) {
      setWallet(null);
    }
  };

  const fetchAddresses = async () => {
    try {
      let list = (user?.addresses && user.addresses.length > 0) ? user.addresses : null;
      if (!list) {
        const profile = await userApi.getProfile();
        list = profile?.addresses || [];
      }
      if (list.length > 0) {
        setAddresses(list);
        const defaultAddr = list.find(a => a.is_default) || list[0];
        setSelectedAddressId(defaultAddr._id);
        setShowNewAddressForm(false);
      } else {
        setAddresses([]);
        setShowNewAddressForm(true);
      }
    } catch (err) {
      console.error("Failed to fetch addresses", err);
      setShowNewAddressForm(true);
    }
  };

  // Fetch the selected friend's shared addresses. Deliberately a fresh request
  // per selection: sharing can be revoked at any moment and this view must not
  // show a stale permission.
  useEffect(() => {
    if (recipient !== 'friend' || !selectedFriendId) {
      setFriendAddresses([]);
      return;
    }
    let cancelled = false;
    setFriendAddressesLoading(true);
    friendsApi.getSharedWithMe(selectedFriendId)
      .then((data) => { if (!cancelled) setFriendAddresses(data?.addresses || []); })
      .catch((err) => {
        if (cancelled) return;
        setFriendAddresses([]);
        setError(friendErrorCopy(err.code, isAr, { name: friendName }) || err.message);
      })
      .finally(() => { if (!cancelled) setFriendAddressesLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient, selectedFriendId]);

  // Switching recipient swaps the whole address pool, so re-seed the selection
  // from the new pool instead of leaving a stale id behind.
  useEffect(() => {
    const pool = addressPool;
    if (pool.length === 0) {
      setSelectedAddressId(null);
      return;
    }
    if (!pool.some((a) => a._id === selectedAddressId)) {
      setSelectedAddressId((pool.find((a) => a.is_default) || pool[0])._id);
    }
    if (isGiftMode) {
      // Buying for someone else never offers a new-address form.
      setShowNewAddressForm(false);
      setCouponError('');
    }
    if (isFriendMode) {
      // A gift is prepaid: cash at the door would mean the RECIPIENT paying
      // for their own present. The payer still chooses between the wallet and
      // the gateway — this only makes sure a stale "cash" is never submitted.
      setPaymentMethod((current) => (current === 'cash'
        ? (walletEnabled ? 'wallet' : 'credit_card')
        : current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient, selectedFriendId, familyAddresses.length, addresses.length, friendAddresses.length]);

  // Derive the order destination from the active address (+ single-country default).
  useEffect(() => {
    const src = deliveringToOffice ? selectedOffice : (usingNewAddress ? newAddress : selectedSavedAddress);
    const c = (src?.shipping_country || singleCountry || '');
    const cy = (src?.shipping_city || '');
    setDestCountry(c);
    setDestCity(cy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingNewAddress, selectedAddressId, recipient, newAddress.shipping_country, newAddress.shipping_city, addresses.length, familyAddresses.length, singleCountry, selectedOfficeId, paymentMethod]);

  // A manager who picked a company car under "Fits my car" while shopping finds that car
  // (and its company) already chosen here. Once per visit; they can change it.
  const rememberedCarApplied = useRef(false);
  useEffect(() => {
    if (rememberedCarApplied.current || !companyInfo?.companies) return;
    const remembered = readRememberedCompanyCar();
    const target = remembered && companyInfo.companies.find((c) => String(c._id) === String(remembered.company_id) && c.is_manager);
    if (!target) {
      rememberedCarApplied.current = true;
      return;
    }
    if (String(companyInfo.company?._id) !== String(target._id)) {
      if (String(companySel.company_id) !== String(target._id)) {
        setSelectedOfficeId(null);
        setCompanySel({ company_id: target._id, beneficiary: null, car_id: '', delivery_mode: null, ship_now_vendor_ids: [] });
      }
      return; // wait for that company's figures
    }
    rememberedCarApplied.current = true;
    if ((companyInfo.cars || []).some((c) => String(c._id) === String(remembered.car_id))) {
      setCompanySel((current) => ({ ...current, company_id: target._id, beneficiary: 'car', car_id: remembered.car_id }));
    }
  }, [companyInfo, companySel.company_id]);

  // Consolidating always delivers to an office: start on the person's own office. Right
  // after switching company the preview still describes the previous one, so wait for
  // the chosen company's offices, and drop an office that is not one of them.
  const companyInfoCurrent = !!companyInfo?.company
    && (!companySel.company_id || String(companyInfo.company._id) === String(companySel.company_id));
  useEffect(() => {
    if (!companyInfoCurrent) return;
    if (selectedOfficeId && !companyOffices.some((o) => String(o._id) === String(selectedOfficeId))) {
      setSelectedOfficeId(null);
      return;
    }
    if (!consolidating || selectedOfficeId) return;
    const fallback = companyInfo?.default_office_id || companyOffices[0]?._id;
    if (fallback) {
      setSelectedOfficeId(fallback);
      setShowNewAddressForm(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consolidating, selectedOfficeId, companyInfoCurrent, companyInfo?.default_office_id, companyOffices.map((o) => o._id).join(',')]);

  const countryEntry = useMemo(() => zoneTree.find((z) => z.country === destCountry) || null, [zoneTree, destCountry]);
  // Ready when we have a country and either the country accepts "anywhere" or a city is chosen.
  const destinationReady = !!destCountry && (!!countryEntry?.has_whole_country_option || !!destCity);
  // Whether the active address already carries a zone (so we don't show a picker at checkout).
  const addressHasZone = deliveringToOffice
    ? !!selectedOffice?.shipping_country
    : (usingNewAddress ? !!newAddress.shipping_country : !!selectedSavedAddress?.shipping_country);

  const couponDiscount = Number(appliedCoupon?.pricing?.discount_amount || 0);
  const itemsAfterCoupon = Math.max(0, checkoutTotal - couponDiscount);

  // Points are shown ONLY from the server's answer. Deriving a discount in the
  // browser would drift from the cap, the balance, and the minimum the moment
  // any of them changed — and the customer would see a number they never get.
  const loyaltyDiscount = Number(loyaltyPreview?.discount || 0);
  const appliedPoints = Number(loyaltyPreview?.redeemed_points || 0);
  const maxLoyaltyPoints = Number(loyaltyPreview?.max_points ?? wallet?.balances?.available_points ?? 0);
  const itemsAfterDiscount = Math.max(0, itemsAfterCoupon - loyaltyDiscount);
  const selectedMethod = (shippingQuote?.available_methods || []).find((m) => String(m.id) === String(selectedMethodId)) || null;
  const shippingCost = !shippingEnabled ? 0 : (selectedMethod ? Number(selectedMethod.total_cost || 0) : 0);
  const finalTotal = itemsAfterDiscount + Math.max(0, shippingCost);

  // Family mode sends a REQUEST, not an order — the organizer pays, so the
  // member's own points are irrelevant there and the control stays hidden.
  const loyaltyAvailable = !!wallet?.enabled
    && !!wallet?.rules?.redemption_enabled
    && !isFamilyMode
    && checkoutItems.length > 0;
  const blockedNoZone = shippingEnabled && shippingQuote?.blocked === true;
  const needsMethodSelection = shippingEnabled && !blockedNoZone;

  // ---- Wallet payment ----
  // Every figure comes from the server's preview. The shortfall in particular
  // is never derived here by subtracting two rounded totals: a customer sent to
  // top up "0.00" because of a rounding artefact has no way to finish.
  const wal = useMemo(() => walletCopy(isAr), [isAr]);
  const walletEnabled = !!walletInfo?.enabled;
  const walletFrozen = walletInfo?.status === 'frozen';
  const walletBalance = Number(walletInfo?.available || 0);
  const walletShortfall = Number(walletInfo?.shortfall || 0);
  const walletSufficient = !!walletInfo?.sufficient;
  const payingFromWallet = paymentMethod === 'wallet' && walletEnabled;
  // Until the preview lands, assume the gateway is on: it is the only prepaid
  // route when there is no wallet, and hiding it on a slow request would look
  // like the store had removed it.
  const onlineAllowed = paymentMethods ? paymentMethods.includes('credit_card') : true;
  const cashAllowed = codAllowed !== false;
  // The one thing that blocks the button: chosen the wallet, not enough in it.
  const walletBlocks = payingFromWallet && (!walletSufficient || walletFrozen);

  // Company account: ready when the server says it can be used for this basket, a
  // car is chosen for a company-car order, and a consolidated order has its office. The
  // company pays the whole order or none of it, so there is no difference to pay here.
  const companyBeneficiary = companySel.beneficiary || (companyInfo?.roles?.employee ? 'employee' : 'car');
  const companyReady = !!companyInfo?.available
    && (companyBeneficiary !== 'car' || !!companySel.car_id)
    && (companyDeliveryMode !== 'consolidate' || !!selectedOfficeId);

  const canPlaceOrder = !loading
    && (!needsMethodSelection || (destinationReady && !!selectedMethodId))
    // Buying for someone else additionally needs one of THEIR shared addresses.
    && (!isGiftMode || !!selectedSavedAddress)
    && !walletBlocks
    && (!companyMode || companyReady);

  /**
   * Preselect a method once the server has answered what it offers.
   *
   * The rule is "the wallet when it covers this order, otherwise the gateway":
   * it spends money the customer already has with us first, without ever
   * opening on a choice they cannot complete.
   *
   * Runs once per arrival of the server's answer, and only ever moves the
   * selection OFF a method that is no longer on offer — a deliberate choice of
   * cash on delivery, or of the gateway despite a full wallet, is never
   * silently overridden.
   */
  const settledDefault = useRef(false);
  useEffect(() => {
    if (!walletInfo) return;

    const offered = new Set([
      ...(paymentMethods || []),
      ...(isFriendMode || !cashAllowed ? [] : ['cash']),
      // Offered whenever the customer is in a company, even when it cannot cover
      // this basket right now: the option then shows why, rather than vanishing.
      ...(companyInfo?.eligible && !isGiftMode ? ['company_account'] : []),
    ]);

    // Whatever is selected has stopped being offered — fall back.
    if (!offered.has(paymentMethod)) {
      setPaymentMethod(walletEnabled ? 'wallet' : (onlineAllowed || !cashAllowed ? 'credit_card' : 'cash'));
      return;
    }

    if (settledDefault.current) return;
    settledDefault.current = true;

    // Someone ordering with a company limit came for that: start there. A manager
    // with no limit of their own is here for a company car — start there too; the
    // panel asks which car.
    if (companyInfo?.eligible && !isGiftMode && (companyInfo?.available || companyInfo?.reason === 'CAR_REQUIRED')) {
      setPaymentMethod('company_account');
      return;
    }
    if (walletEnabled && paymentMethod === 'cash') return; // their own choice
    if (walletEnabled) {
      setPaymentMethod(walletSufficient && !walletFrozen ? 'wallet' : (onlineAllowed ? 'credit_card' : 'wallet'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletInfo?.enabled, walletInfo?.sufficient, paymentMethods, companyInfo?.eligible, companyInfo?.available]);

  /**
   * Handle the return trip from a top-up started at checkout.
   *
   * The gateway's redirect is fully under the customer's control, so a
   * `?topup=success` in the URL proves nothing on its own — the server is asked
   * to confirm it against the provider. The params are then stripped so a
   * refresh cannot replay a stale banner, and the preview is refetched so the
   * new balance is reflected before the customer can press Place order.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('topup');
    if (!status) return;

    const topupId = params.get('topupId');
    let cancelled = false;

    (async () => {
      try {
        if (status === 'success' && topupId) {
          const result = await walletApi.confirmTopup({ topupId });
          if (cancelled) return;
          setTopupNotice(result.status === 'paid'
            ? { tone: 'success', text: wal.topUpSuccess(Number(result.amount || 0).toFixed(2), result.balances?.currency || currency) }
            : { tone: 'pending', text: wal.topUpPending });
          if (result.status === 'paid') {
            setPaymentMethod('wallet');
            // Re-price so the shortfall panel reflects the new balance.
            setWalletInfo((prev) => (prev ? { ...prev, available: Number(result.balances?.available || prev.available) } : prev));
            setCheckoutRefreshKey((key) => key + 1);
          }
        } else if (status === 'pending') {
          setTopupNotice({ tone: 'pending', text: wal.topUpPending });
        } else if (status === 'failed') {
          setTopupNotice({ tone: 'error', text: wal.topUpFailed });
        }
      } catch (err) {
        if (!cancelled) setTopupNotice({ tone: 'error', text: err.message || wal.topUpFailed });
      } finally {
        if (cancelled) return;
        const url = new URL(window.location.href);
        ['topup', 'topupId'].forEach((key) => url.searchParams.delete(key));
        window.history.replaceState({}, '', `${url.pathname}${url.search}`);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Send the customer to the gateway to add credit, then straight back here.
   *
   * `return_path` carries the basket context home: the customer returns to this
   * same checkout with their selection intact, rather than to the wallet page
   * having to start over. `amount` defaults to the exact shortfall, which is
   * the whole point — one tap, no arithmetic, no guessing.
   */
  const startTopup = async (value) => {
    const requested = Number(value);
    if (!Number.isFinite(requested) || requested <= 0) {
      setTopupNotice({ tone: 'error', text: wal.amountRequired });
      return;
    }
    setTopupLoading(true);
    setTopupNotice(null);
    try {
      const result = await walletApi.createTopup({
        amount: requested,
        origin: 'checkout',
        return_path: '/checkout',
      });
      if (result?.paymentUrl) {
        window.location.href = result.paymentUrl;
        return;
      }
      setTopupNotice({ tone: 'error', text: wal.topUpFailed });
    } catch (err) {
      setTopupNotice({ tone: 'error', text: err.message || wal.topUpFailed });
    } finally {
      setTopupLoading(false);
    }
  };

  // Track a populated checkout once its real payable total is available. This
  // includes product discounts, coupon discounts, quantities, and shipping.
  useEffect(() => {
    if (!isMounted || !user || checkoutItems.length === 0 || !canPlaceOrder) return;

    const eventKey = checkoutItemsSignature;
    const sendInitiateCheckout = () => {
      if (typeof window.fbq !== 'function') return;
      if (window.__readyCarLastInitiateCheckout === eventKey) return;

      try {
        window.fbq('track', 'InitiateCheckout', buildMetaCommerceData(checkoutItems, finalTotal, META_CURRENCY));
        window.__readyCarLastInitiateCheckout = eventKey;
      } catch (err) {
        console.warn('Meta InitiateCheckout tracking failed', err);
      }
    };

    window.addEventListener('readycar:meta-pixel-ready', sendInitiateCheckout);
    sendInitiateCheckout();
    return () => window.removeEventListener('readycar:meta-pixel-ready', sendInitiateCheckout);
  }, [isMounted, user, checkoutItems, checkoutItemsSignature, finalTotal, canPlaceOrder]);

  // Fetch a shipping quote whenever the destination is ready.
  useEffect(() => {
    // The quote endpoint is authenticated. A visitor who picks a city before
    // finishing the name and phone fields simply has no session yet — leave the
    // panel empty rather than showing them an authentication error for
    // something they have not done wrong. The `user` dependency below is what
    // brings them back here the moment the guest session opens.
    if (!user || !shippingEnabled || !destinationReady || checkoutItems.length === 0) {
      setShippingQuote(null);
      setSelectedMethodId('');
      return;
    }
    let cancelled = false;
    (async () => {
      setShippingLoading(true);
      setShippingError('');
      try {
        const quote = await shippingApi.getQuote({ items: toOrderPayloadItems(checkoutItems), destination: { country: destCountry, city: destCity || null } });
        if (cancelled) return;
        setShippingQuote(quote);
        const methods = quote?.available_methods || [];
        if (methods.length) {
          const cheapest = methods.reduce((min, m) => (Number(m.total_cost) < Number(min.total_cost) ? m : min), methods[0]);
          setSelectedMethodId(String(cheapest.id));
        } else {
          setSelectedMethodId('');
        }
      } catch (err) {
        if (!cancelled) { setShippingQuote(null); setSelectedMethodId(''); setShippingError(err.message || 'Could not load shipping options'); }
      } finally {
        if (!cancelled) setShippingLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?._id, shippingEnabled, destinationReady, destCountry, destCity, checkoutItemsSignature]);

  /**
   * Re-price the basket on the server whenever anything that affects loyalty
   * changes. The result is authoritative: the number of points actually
   * applied can be lower than what was asked for (cap, balance, minimum), and
   * this is the only place that difference becomes visible before payment.
   */
  useEffect(() => {
    // Runs even when loyalty is switched off: the same response carries the
    // wallet position, and checkout cannot price a wallet order without it.
    if (!loyaltyAvailable && isFamilyMode) { setLoyaltyPreview(null); return; }
    if (!user || checkoutItems.length === 0) return;

    let cancelled = false;
    const requested = useLoyalty ? Math.max(0, Math.floor(Number(requestedPoints) || 0)) : 0;

    (async () => {
      setLoyaltyLoading(true);
      try {
        const res = await orderApi.preview({
          items: toOrderPayloadItems(checkoutItems),
          coupon_code: appliedCoupon?.coupon?.code || undefined,
          redeem_points: requested,
          // Shipping MUST be included. Loyalty never needed it — points only
          // ever applied to merchandise — but the wallet is asked to cover the
          // whole payable total. Priced without shipping, the server would call
          // a balance sufficient and then refuse the order at placement.
          ...(needsMethodSelection && destinationReady && selectedMethodId
            ? {
              shipping_destination: { country: destCountry, city: destCity || null },
              shipping_method_id: selectedMethodId,
            }
            : {}),
          // The company option is priced for whoever the order is for.
          company: {
            company_id: companySel.company_id || undefined,
            beneficiary: companySel.beneficiary || undefined,
            car_id: companySel.car_id || undefined,
            office_id: selectedOfficeId || undefined,
            delivery_mode: companyDeliveryMode || undefined,
            ship_now_vendor_ids: companySel.ship_now_vendor_ids?.length ? companySel.ship_now_vendor_ids : undefined,
          },
        });
        if (!cancelled) {
          setLoyaltyPreview(res?.loyalty || null);
          setWalletInfo(res?.wallet || null);
          setDeliverySplit(res?.delivery || null);
          if (Array.isArray(res?.payment_methods)) setPaymentMethods(res.payment_methods);
          if (res?.cod && typeof res.cod.allowed === 'boolean') setCodAllowed(res.cod.allowed);
          setCompanyInfo(res?.company || null);
        }
      } catch (err) {
        // Never block checkout on a preview failure — fall back to no points.
        if (!cancelled) { setLoyaltyPreview(null); setDeliverySplit(null); }
      } finally {
        if (!cancelled) setLoyaltyLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?._id, loyaltyAvailable, useLoyalty, requestedPoints, checkoutItemsSignature, appliedCoupon?.coupon?.code, checkoutRefreshKey, needsMethodSelection, destinationReady, selectedMethodId, destCountry, destCity, companySel.company_id, companySel.beneficiary, companySel.car_id, selectedOfficeId, companyDeliveryMode, (companySel.ship_now_vendor_ids || []).join(',')]);

  // Turning the control on defaults to the maximum this order allows — the
  // common intent, and it saves the customer guessing at the cap.
  const toggleUseLoyalty = () => {
    const next = !useLoyalty;
    setUseLoyalty(next);
    if (next && requestedPoints === 0) {
      setRequestedPoints(maxLoyaltyPoints || Number(wallet?.balances?.available_points || 0));
    }
  };

  const applyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) { setCouponError(isAr ? 'أدخل كود الكوبون.' : 'Please enter a coupon code.'); return; }
    setCouponLoading(true); setCouponError('');
    try {
      const response = await couponsApi.validate({ code, items: toOrderPayloadItems(checkoutItems) });
      setAppliedCoupon(response);
      setCouponCode(response?.coupon?.code || code.toUpperCase());
    } catch (err) {
      setAppliedCoupon(null);
      setCouponError(err.message || 'Failed to apply coupon');
    } finally { setCouponLoading(false); }
  };
  const removeCoupon = () => { setAppliedCoupon(null); setCouponCode(''); setCouponError(''); };

  /**
   * Family mode: create a durable order REQUEST, not an order. No payment is
   * collected and no Order/OrderPayment exists at this point — the organizer
   * approves and pays separately. Every amount is recomputed server-side.
   */
  const handleSendForApproval = async () => {
    if (loading) return;
    setError(null);

    if (!selectedSavedAddress) {
      setError(isAr ? 'يرجى اختيار أحد العناوين المشتركة.' : 'Please select one of the shared addresses.');
      return;
    }
    if (needsMethodSelection) {
      if (blockedNoZone) { setError(isAr ? 'لا نقوم بالشحن إلى هذه الوجهة بعد.' : 'We do not ship to the selected location yet.'); return; }
      if (!selectedMethodId) { setError(isAr ? 'يرجى اختيار طريقة الشحن.' : 'Please select a shipping method.'); return; }
    }

    setLoading(true);
    try {
      const result = await familyApi.submitRequest({
        items: toOrderPayloadItems(checkoutItems),
        organizer_address_id: selectedSavedAddress._id,
        shipping_destination: needsMethodSelection ? { country: destCountry, city: destCity || null } : null,
        shipping_method_id: needsMethodSelection ? selectedMethodId : null,
        coupon_code: appliedCoupon?.coupon?.code || undefined,
        member_note: memberNote.slice(0, 200),
        checkout_source: isBuyNow ? 'buy_now' : (isSelectedCart ? 'cart_selected' : 'cart'),
      });
      setRequestSent(result.request);
      // Only clear the cart AFTER the request is durably stored.
      completeCartAfterOrder();
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر إرسال الطلب.' : 'Could not send the request.'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Friend mode: hand off to the hosted payment page. No order exists until the
   * provider confirms payment, and the backend rebuilds the address, prices,
   * and authorization from scratch — nothing here is sent as authority.
   */
  const handlePayForFriend = async () => {
    if (loading) return;
    setError(null);

    if (!selectedSavedAddress) {
      setError(isAr ? 'يرجى اختيار أحد العناوين المشتركة.' : 'Please select one of the shared addresses.');
      return;
    }
    if (needsMethodSelection) {
      if (blockedNoZone) { setError(isAr ? 'لا نقوم بالشحن إلى هذه الوجهة بعد.' : 'We do not ship to the selected location yet.'); return; }
      if (!selectedMethodId) { setError(isAr ? 'يرجى اختيار طريقة الشحن.' : 'Please select a shipping method.'); return; }
    }

    setLoading(true);
    try {
      const result = await friendCheckoutApi.createPayment({
        friend_id: selectedFriendId,
        recipient_address_id: selectedSavedAddress._id,
        items: toOrderPayloadItems(checkoutItems),
        shipping_method_id: needsMethodSelection ? selectedMethodId : null,
        coupon_code: appliedCoupon?.coupon?.code || undefined,
        // The payer's choice. Re-checked server-side, which also refuses cash.
        payment_method: paymentMethod === 'wallet' ? 'wallet' : 'credit_card',
        // The PAYER's points fund a friend order — the recipient's balance is
        // never touched. Re-clamped server-side like every other request.
        redeem_points: useLoyalty ? appliedPoints : 0,
      });
      // Paying from the wallet settles server-side, so the order already
      // exists and there is nothing to redirect to — confirm it here exactly
      // as a normal wallet checkout would.
      if (result?.requiresPayment === false) {
        trackPurchase(result?.order);
        setSuccess(true);
        completeCartAfterOrder();
        setTimeout(() => { router.push("/profile?tab=orders"); }, 3000);
        return;
      }

      // Cart is cleared only after the payment is confirmed on return, so an
      // abandoned payment leaves the customer's cart intact.
      window.location.href = result.paymentUrl;
    } catch (err) {
      // A shortfall on a gift order is the same fixable gap as on any other —
      // surface it in the top-up panel instead of as a dead-end error.
      if (err.code === 'INSUFFICIENT_BALANCE' || err.code === 'WALLET_FROZEN') {
        setWalletInfo((prev) => ({
          ...(prev || {}),
          enabled: true,
          sufficient: false,
          status: err.code === 'WALLET_FROZEN' ? 'frozen' : prev?.status,
        }));
        setError(null);
      } else if (err.code === 'ONLINE_PAYMENT_DISABLED') {
        setPaymentMethods((prev) => (prev || []).filter((method) => method !== 'credit_card'));
        if (walletEnabled) setPaymentMethod('wallet');
        setError(wal.onlinePaymentDisabled);
      } else {
        setError(friendErrorCopy(err.code, isAr, { name: friendName }) || err.message);
      }
      setLoading(false);
    }
  };

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (isFamilyMode) return handleSendForApproval();
    if (isFriendMode) return handlePayForFriend();
    if (loading) return;
    setError(null);

    if (needsMethodSelection) {
      if (!destinationReady) { setError(isAr ? 'يرجى تحديد منطقة التوصيل.' : 'Please set your delivery zone.'); return; }
      if (blockedNoZone) { setError(isAr ? 'لا نقوم بالشحن إلى هذه الوجهة بعد.' : 'We do not ship to the selected location yet.'); return; }
      if (!selectedMethodId) { setError(isAr ? 'يرجى اختيار طريقة الشحن.' : 'Please select a shipping method.'); return; }
    }

    const phoneRegex = /^(01\d{9}|\+201\d{9})$/;
    if (usingNewAddress && newAddress.phone && !phoneRegex.test(newAddress.phone)) {
      setError(isAr ? 'رقم الهاتف غير صحيح. يجب أن يبدأ بـ 01xxxxxxxxx أو +201xxxxxxxxx' : 'Invalid phone number. Use 01xxxxxxxxx or +201xxxxxxxxx');
      return;
    }

    setLoading(true);

    // Last line of defence for the session. The effect above normally opened it
    // while the customer was still filling in the address, but a request that
    // failed or a number corrected at the last second would leave this the only
    // chance — and losing a completed order to a missing session is exactly the
    // failure this whole feature exists to avoid.
    if (!user) {
      const ready = await ensureGuestSession();
      if (!ready) {
        setLoading(false);
        if (knownNumber) {
          // The number has an account. Re-raise the prompt (they may have
          // dismissed it earlier) rather than showing an error beside a button
          // that cannot work — the code is right there and takes one tap.
          setKnownNumberDismissed(false);
          setError(isAr
            ? 'الرقم ده مسجّل عندنا — أكّد الكود اللي فوق عشان نكمل الطلب.'
            : 'This number has an account — confirm the code above to finish your order.');
        } else {
          setError(guestSessionError || (isAr
            ? 'اكتب اسمك ورقم موبايلك عشان نكمل الطلب.'
            : 'Please add your name and mobile number to complete the order.'));
        }
        return;
      }
    }

    try {
      let shipping_address = null;
      if (deliveringToOffice) {
        // The server rebuilds this from the office itself; sent so the payload is complete.
        shipping_address = {
          recipient_name: selectedOffice.recipient_name,
          phone: selectedOffice.phone,
          full_address: selectedOffice.full_address,
        };
      } else if (usingNewAddress) {
        if (!newAddress.recipient_name || !newAddress.phone || !newAddress.full_address) {
          throw new Error(isAr ? 'يرجى تعبئة جميع حقول العنوان' : 'Please fill in all address fields');
        }
        shipping_address = {
          recipient_name: newAddress.recipient_name,
          phone: newAddress.phone,
          full_address: newAddress.full_address,
        };
      } else {
        if (!selectedSavedAddress) throw new Error(isAr ? 'يرجى اختيار عنوان صالح' : 'Please select a valid address');
        shipping_address = {
          recipient_name: selectedSavedAddress.recipient_name,
          phone: selectedSavedAddress.phone,
          full_address: selectedSavedAddress.full_address,
          _id: selectedSavedAddress._id,
        };
      }

      const orderData = {
        shipping_address,
        items: toOrderPayloadItems(checkoutItems),
        checkout_source: isBuyNow ? 'buy_now' : (isSelectedCart ? 'cart_selected' : 'cart'),
        total_price: finalTotal,
        payment_method: paymentMethod,
        coupon_code: appliedCoupon?.coupon?.code || undefined,
        // A request, not an instruction: the server re-clamps this against the
        // live balance and the configured cap before charging anything.
        redeem_points: useLoyalty ? appliedPoints : 0,
      };
      if (needsMethodSelection) {
        orderData.shipping_destination = { country: destCountry, city: destCity || null };
        orderData.shipping_method_id = selectedMethodId;
      }
      if (companyMode) {
        orderData.company = {
          beneficiary: companyBeneficiary,
          car_id: companyBeneficiary === 'car' ? companySel.car_id : undefined,
          office_id: selectedOfficeId || undefined,
          company_id: companyInfo?.company?._id || companySel.company_id || undefined,
          delivery_mode: companyDeliveryMode || undefined,
          ship_now_vendor_ids: companyDeliveryMode === 'consolidate' && companySel.ship_now_vendor_ids?.length
            ? companySel.ship_now_vendor_ids
            : undefined,
        };
      }

      const result = await orderApi.createOrder(orderData);
      if (result?.requiresPayment && result.paymentUrl) {
        window.location.href = result.paymentUrl;
        return;
      }
      trackPurchase(result?.order);
      // The header's "X left" and the My company tab move with the order.
      if (companyMode) refreshMyCompany();
      for (const item of checkoutItems) {
        const pid = item?.product?._id || item?.product_id;
        if (pid) trackAdAction('order_placed', [pid, `/product/${item?.product?.slug_en || item?.product?.slug_ar || ''}`], { target: String(result?.order?._id || '') });
      }
      setSuccess(true);
      completeCartAfterOrder();
      if (isGuestSession) {
        // Hold the screen. A guest still has a code to answer, and bouncing
        // them to an order history they are not yet allowed to read would both
        // fail and throw away the one moment they will confirm their number.
        setGuestPlacedOrder(result?.order || null);
        return;
      }
      if (result?.order?.company?.delivery_mode === 'consolidate') {
        setBatchPlacedOrder(result.order);
        return;
      }
      setTimeout(() => { router.push("/profile?tab=orders"); }, 3000);
    } catch (err) {
      // The balance can move between pricing and placing — another tab, a
      // second device. Fold the server's authoritative numbers back into the
      // panel so the customer sees the same one-tap top-up rather than a bare
      // error they cannot act on.
      if (err.code === 'INSUFFICIENT_BALANCE' && err.wallet) {
        setWalletInfo((prev) => ({
          ...(prev || {}),
          enabled: true,
          available: Number(err.wallet.available ?? prev?.available ?? 0),
          shortfall: Number(err.wallet.shortfall ?? 0),
          sufficient: false,
          currency: err.wallet.currency || prev?.currency || currency,
        }));
        setError(null);
      } else if (err.code === 'WALLET_FROZEN') {
        setWalletInfo((prev) => ({ ...(prev || {}), enabled: true, status: 'frozen' }));
        setError(null);
      } else if (err.code === 'ONLINE_PAYMENT_DISABLED') {
        // The store withdrew the gateway while this tab sat open. Say so, take
        // it off the list, and leave the basket and every other choice intact —
        // the customer picks again rather than losing the order.
        setPaymentMethods((prev) => (prev || []).filter((method) => method !== 'credit_card'));
        setPaymentMethod(walletEnabled ? 'wallet' : (cashAllowed ? 'cash' : 'credit_card'));
        setError(wal.onlinePaymentDisabled);
      } else if (companyMode && companyErrorCopy(err.code, isAr)) {
        // The limit, the cap or the price moved under the customer. Say what
        // happened and re-ask the server, so the panel shows the new split.
        setError(companyErrorCopy(err.code, isAr));
        setCheckoutRefreshKey((k) => k + 1);
      } else {
        setError(err.message || "Failed to place order");
      }
    } finally { setLoading(false); }
  };

  // `user` is deliberately NOT required: the whole point is that this screen
  // renders for a visitor who has no account yet.
  if (!isMounted || !checkoutMode) return null;

  // Family request sent — deliberately distinct from an order confirmation so
  // the member never mistakes a request for a placed order.
  if (requestSent) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-4" dir={direction}>
        <div className="bg-white p-8 rounded-xl shadow-xl flex flex-col items-center text-center max-w-md w-full border border-marine-teal/15">
          <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-6"><Send size={36} /></div>
          <h2 className="text-2xl font-bold text-marine-ink mb-2">
            {isAr ? `تم إرسال طلبك إلى ${organizerName}.` : `Your request was sent to ${organizerName}.`}
          </h2>
          <p className="text-marine-outline mb-8 text-sm">
            {isAr
              ? 'سيقوم بمراجعة الطلب واختيار طريقة الدفع. لم يتم خصم أي مبلغ ولم يتم إنشاء أي طلب بعد.'
              : 'They will review it and choose how to pay. Nothing was charged and no order exists yet.'}
          </p>
          <div className="w-full space-y-3">
            <Link href={`/family/requests/${requestSent._id}`} className="block w-full bg-marine-navy text-white font-medium py-3 rounded-xl hover:bg-marine-teal transition-colors">
              {fam.viewRequest}
            </Link>
            <Link href="/products" className="block w-full bg-marine-mist text-marine-muted font-medium py-3 rounded-xl hover:bg-marine-frost transition-colors">
              {fam.continueShopping}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    // The order exists. Everything below is an OFFER — the code, the password,
    // the account — and every one of them is refusable without consequence.
    // Nothing here can undo what has already been placed.
    const guestPhone = guestPlacedOrder?.shipping_address?.phone
      || newAddress.phone
      || user?.phone
      || '';
    const pointsEarned = Number(
      guestPlacedOrder?.loyalty?.earn_points_pending ?? loyaltyPreview?.estimated_earn_points ?? 0
    );

    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-4" dir={direction}>
        <div className="bg-white p-8 rounded-xl shadow-xl flex flex-col items-center text-center max-w-md w-full border border-marine-teal/15">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6"><CheckCircle2 size={40} /></div>
          <h2 className="text-3xl font-bold text-marine-ink mb-2">{t.orderSuccessMessage}</h2>

          {isGuestSession ? (
            <>
              <p className="text-marine-outline mb-6 text-sm">
                {isAr
                  ? 'استلمنا طلبك وهنبدأ نجهزه.'
                  : 'We have your order and will start preparing it.'}
              </p>

              <GuestOrderConfirmation
                isAr={isAr}
                language={language}
                phone={guestPhone}
                pointsEarned={pointsEarned}
                // Confirming promotes the account, so the local session has to
                // move with it — otherwise the screen would keep treating a
                // claimed account as an unconfirmed guest until a full reload.
                onConfirmed={() => login({ ...user, account_status: 'active', is_guest: false, phone_verified_at: new Date().toISOString() }, { rememberMe: true })}
              />

              <Link href="/products" className="mt-6 text-sm text-marine-outline hover:text-marine-ink transition-colors">
                {isAr ? 'أكمل التسوق' : 'Continue shopping'}
              </Link>
            </>
          ) : batchPlacedOrder ? (
            <BatchOrderConfirmation order={batchPlacedOrder} isAr={isAr} currency={currency} ordersLabel={t.orders || (isAr ? 'طلباتي' : 'View Orders')} />
          ) : (
            <>
              <p className="text-marine-outline mb-8">We will start processing it right away.</p>
              <Link href="/profile?tab=orders" className="w-full bg-marine-navy text-white font-medium py-3 rounded-xl hover:bg-marine-teal transition-colors">{t.orders || "View Orders"}</Link>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-marine-canvas py-10" dir={direction}>
      <div className="container max-w-6xl mx-auto px-4">
        <div className="flex items-center gap-2 text-marine-outline text-xs mb-4">
          <Link href="/products" className="hover:text-marine-ink transition-colors flex items-center gap-1">
            {isAr ? <ChevronRight size={14} /> : <ArrowLeft size={14} />}{isAr ? 'المتجر' : 'Store'}
          </Link>
          <span className="text-marine-line">/</span>
          <span className="text-marine-ink">{t.checkout}</span>
        </div>

        {/* The order pipeline: what this page is and the three steps it walks through. */}
        <div className="bg-white border border-marine-teal/15 rounded-lg p-5 sm:p-6 mb-8">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
            <div>
              <p className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-marine-primary">{isAr ? 'مسار الطلب' : 'Marine Order Pipeline'}</p>
              <h1 className="font-display text-2xl sm:text-[32px] sm:leading-10 font-semibold tracking-tight text-marine-ink">
                {isAr ? 'السلة ومراجعة توافق المركب' : 'Procurement Cart & Vessel Fit Review'}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="flex items-center gap-1.5 bg-marine-mist border border-marine-cyan/20 text-marine-primary font-display text-[10px] font-bold uppercase tracking-[0.06em] px-2.5 py-1.5 rounded-sm"><ShieldCheck size={12} />{isAr ? 'توافق مضمون' : 'Fitment Guaranteed'}</span>
              <span className="flex items-center gap-1.5 bg-marine-mist border border-marine-cyan/20 text-marine-primary font-display text-[10px] font-bold uppercase tracking-[0.06em] px-2.5 py-1.5 rounded-sm"><Anchor size={12} />{isAr ? 'شحن بحري سريع' : 'Maritime Fast-Track'}</span>
            </div>
          </div>
          <ol className="grid sm:grid-cols-3 gap-3">
            {[
              { n: 1, en: 'Cart Review', ar: 'مراجعة السلة', sub_en: `${checkoutItems.length} verified line items`, sub_ar: `${checkoutItems.length} قطعة متراجعة` },
              { n: 2, en: 'Berth & Delivery', ar: 'المرسى والتوصيل', sub_en: 'Direct slip or port courier', sub_ar: 'للمرسى أو مندوب الميناء' },
              { n: 3, en: 'Egyptian Settlement', ar: 'الدفع', sub_en: 'Paymob, Fawaterak, ValU', sub_ar: 'Paymob وفواتيرك وValU' },
            ].map((step) => (
              <li key={step.n} className={`flex items-center gap-3 rounded px-3 py-2.5 border ${step.n === 1 ? 'bg-marine-mist border-marine-cyan/30' : 'bg-marine-canvas border-marine-teal/10'}`}>
                <span className={`w-7 h-7 rounded-full flex items-center justify-center font-display text-xs font-bold flex-shrink-0 ${step.n === 1 ? 'bg-marine-primary text-white' : 'bg-white text-marine-muted border border-marine-teal/15'}`}>{step.n}</span>
                <div className="min-w-0">
                  <div className="font-display text-[11px] font-bold uppercase tracking-[0.06em] text-marine-ink">{step.n}. {isAr ? step.ar : step.en}</div>
                  <div className="text-[11px] text-marine-outline truncate">{isAr ? step.sub_ar : step.sub_en}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left Column */}
          <div className="flex-1 space-y-8">

            {/* Recipient selector — shown when this customer can order for
                someone else: a family organizer, a friend, or both. */}
            {(familyContext?.organizer || friends.length > 0) && (
              <div className="bg-white p-6 rounded-lg border border-marine-teal/15">
                <h2 className="font-display text-xl font-semibold text-marine-ink mb-4 flex items-center gap-2">
                  <Users className="text-marine-primary" size={22} />{fam.whoIsThisFor}
                </h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <RecipientOption
                    selected={recipient === 'myself'}
                    onSelect={() => setRecipient('myself')}
                    title={fam.myself}
                    desc={isAr ? 'اطلب وادفع بنفسك كالمعتاد.' : 'Order and pay yourself, as usual.'}
                  />

                  {familyContext?.organizer && (
                    <RecipientOption
                      selected={recipient === 'organizer'}
                      onSelect={() => setRecipient('organizer')}
                      title={`${organizerName} — ${fam.organizer}`}
                      // Phrased from the member's side ("you are their son") so
                      // it is never ambiguous who the relationship describes.
                      desc={isAr
                        ? `أنت ${getRelationshipLabel(familyContext.relationship, isAr)} لديه · يراجع طلبك ويختار طريقة الدفع`
                        : `You are their ${getRelationshipLabel(familyContext.relationship, isAr).toLowerCase()} · they review your request and choose how to pay`}
                    />
                  )}

                  {friends.map((friend) => (
                    <RecipientOption
                      key={friend._id}
                      selected={recipient === 'friend' && String(selectedFriendId) === String(friend._id)}
                      onSelect={() => { setRecipient('friend'); setSelectedFriendId(String(friend._id)); }}
                      avatar={friend.profile_image}
                      title={friend.name}
                      desc={isAr
                        ? 'صديق · يُشحن إلى عنوانه وتدفع أنت أونلاين'
                        : 'Friend · ships to them, you pay online'}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Already a customer? Deliberately a quiet line and not a card:
                it is an alternative for the minority who want it, not a step.
                Anyone who ignores it completes the same order. */}
            {isAnonymous && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-marine-teal/15 bg-white px-4 py-3">
                <p className="text-sm text-marine-outline">
                  {isAr ? 'عندك حساب عندنا؟' : 'Already have an account?'}
                </p>
                <Link
                  href={`/login?redirect=${encodeURIComponent(isBuyNow ? '/checkout?buy_now=1' : '/checkout')}`}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-marine-ink hover:text-marine-primary transition-colors"
                >
                  <LogIn size={15} />
                  {isAr ? 'سجّل دخول' : 'Sign in'}
                </Link>
              </div>
            )}

            {/* Address Selection */}
            <div className="bg-white p-6 rounded-lg border border-marine-teal/15">
              <h2 className="font-display text-xl font-semibold text-marine-ink mb-6 flex items-center gap-2">
                <MapPin className="text-marine-primary" size={22} />
                {isGiftMode ? fam.sharedAddresses : t.shippingAddress}
              </h2>

              {/* ---- Friend mode: the friend's shared addresses, read-only ---- */}
              {isFriendMode && (
                friendAddressesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-marine-outline">
                    <Loader2 size={16} className="animate-spin" />
                    {isAr ? 'جارٍ تحميل العناوين...' : 'Loading addresses...'}
                  </div>
                ) : friendAddresses.length === 0 ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-sm font-semibold text-amber-800">{frnd.askToShare(friendName)}</p>
                  </div>
                ) : (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {friendAddresses.map((address) => (
                        <AddressCard
                          key={address._id}
                          address={address}
                          selected={selectedAddressId === address._id}
                          onSelect={() => setSelectedAddressId(address._id)}
                          isAr={isAr}
                        />
                      ))}
                    </div>
                    <p className="text-marine-outline text-xs mt-4 flex items-center gap-1.5">
                      <Lock size={12} />
                      {isAr
                        ? `هذه عناوين ${friendName} — للعرض فقط ولا يمكنك تعديلها.`
                        : `These are ${friendName}'s addresses — view only, you cannot edit them.`}
                    </p>
                  </>
                )
              )}

              {/* ---- Family mode: read-only shared addresses only ---- */}
              {isFamilyMode && (
                familyAddresses.length === 0 ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-sm font-semibold text-amber-800">
                      {isAr
                        ? `${organizerName} لم يشارك أي عنوان توصيل معك بعد.`
                        : `${organizerName} has not shared a delivery address with you yet.`}
                    </p>
                    <p className="text-xs text-amber-700 mt-2">
                      {isAr
                        ? `اطلب من ${organizerName} مشاركة عنوان معك من تبويب العائلة في حسابه، ثم عد إلى هنا.`
                        : `Ask ${organizerName} to share an address with you from their Family tab, then come back here.`}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {familyAddresses.map((address) => (
                        <AddressCard
                          key={address._id}
                          address={address}
                          selected={selectedAddressId === address._id}
                          onSelect={() => setSelectedAddressId(address._id)}
                          isAr={isAr}
                        />
                      ))}
                    </div>
                    {/* No "add new address" — a member never edits the organizer's addresses. */}
                    <p className="text-marine-outline text-xs mt-4 flex items-center gap-1.5">
                      <Lock size={12} />
                      {isAr
                        ? 'هذه العناوين للعرض فقط ويديرها مسؤول العائلة.'
                        : 'These addresses are view-only and managed by your organizer.'}
                    </p>
                  </>
                )
              )}

              {companyMode && !isStaffAccount && (
                <CompanyOfficePicker
                  offices={companyOffices}
                  selectedId={selectedOfficeId}
                  onSelect={(id) => { setSelectedOfficeId(id); setShowNewAddressForm(false); }}
                  companyName={companyInfo?.company?.name}
                  orgType={companyInfo?.company?.org_type}
                  isAr={isAr}
                  officeOnly={consolidating}
                />
              )}

              {!isGiftMode && !isStaffAccount && !consolidating && addresses.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-4 mb-6">
                  {addresses.map((address) => (
                    <div key={address._id} onClick={() => { setSelectedAddressId(address._id); setShowNewAddressForm(false); setSelectedOfficeId(null); }}
                      className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${selectedAddressId === address._id && !showNewAddressForm && !deliveringToOffice ? "border-marine-cyan bg-red-50/30" : "border-marine-teal/15 hover:border-marine-teal/25"}`}>
                      {selectedAddressId === address._id && !showNewAddressForm && !deliveringToOffice && (<div className="absolute top-3 end-3 text-marine-primary"><CheckCircle2 size={20} className="fill-marine-cyan text-white" /></div>)}
                      <p className="font-bold text-marine-ink mb-1">{address.recipient_name}</p>
                      <p className="text-marine-muted text-sm mb-1">{address.phone}</p>
                      <p className="text-marine-outline text-xs leading-relaxed line-clamp-2">{address.full_address}</p>
                      {(address.shipping_country || address.shipping_city) && (
                        <p className="text-marine-outline text-[11px] mt-1 flex items-center gap-1"><Truck size={11} /> {[address.shipping_city, address.shipping_country].filter(Boolean).join(', ')}</p>
                      )}
                    </div>
                  ))}
                  <div onClick={() => { setShowNewAddressForm(true); setSelectedOfficeId(null); }}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 min-h-[120px] ${showNewAddressForm ? "border-marine-cyan bg-red-50/30 text-marine-primary" : "border-marine-teal/15 hover:border-marine-teal/25 text-marine-outline"}`}>
                    <span className="text-2xl mb-1">+</span><span className="font-medium text-sm">{t.addNewAddress}</span>
                  </div>
                </div>
              )}

              {/* New Address Form */}
              {usingNewAddress && (
                <div className="bg-marine-canvas p-5 rounded-xl border border-marine-teal/15 space-y-4">
                  <h3 className="font-semibold text-marine-ink">{t.newAddress}</h3>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-marine-outline uppercase">{t.recipientName}</label>
                      <input type="text" value={newAddress.recipient_name} onChange={(e) => setNewAddress({...newAddress, recipient_name: e.target.value})} className="w-full px-4 py-3 rounded-lg border border-marine-teal/15 focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all" placeholder="John Doe" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-marine-outline uppercase">{t.phoneNumber}</label>
                      <input
                        type="tel"
                        value={newAddress.phone}
                        onChange={(e) => {
                          setNewAddress({ ...newAddress, phone: e.target.value });
                          // Editing the number retracts everything said about the
                          // previous one — the offer, the dismissal, and the
                          // refusal — so a corrected typo gets a clean attempt
                          // rather than inheriting the last number's verdict.
                          if (knownNumber) setKnownNumber(null);
                          if (knownNumberDismissed) setKnownNumberDismissed(false);
                          if (signInRequiredFor) setSignInRequiredFor('');
                        }}
                        onBlur={handlePhoneBlur}
                        autoComplete="tel"
                        className="w-full px-4 py-3 rounded-lg border border-marine-teal/15 focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all"
                        placeholder="01xxxxxxxxx"
                      />
                    </div>
                  </div>

                  {/* Sits directly under the field it is about, never as a modal:
                      a dialog appearing mid-form reads as the login wall arriving
                      late, which is precisely what this checkout removed. */}
                  {isAnonymous && knownNumber && (!knownNumberDismissed || blockingSignIn) && (
                    <KnownNumberPrompt
                      phone={knownNumber.phone}
                      canUsePassword={knownNumber.canUsePassword}
                      isAr={isAr}
                      language={language}
                      // Once the server has refused a guest session for this
                      // number there is no "continue anyway" to offer: the only
                      // ways forward are the code or a different number, and
                      // pretending otherwise would strand the customer on a
                      // button that silently does nothing.
                      blocking={blockingSignIn}
                      onSignedIn={handleKnownNumberSignedIn}
                      onDismiss={() => { setKnownNumber(null); setKnownNumberDismissed(true); }}
                      onUseAnotherNumber={() => {
                        setNewAddress((a) => ({ ...a, phone: '' }));
                        setKnownNumber(null);
                        setKnownNumberDismissed(false);
                        setSignInRequiredFor('');
                      }}
                    />
                  )}

                  {guestSessionError && (
                    <p className="text-sm text-red-600">{guestSessionError}</p>
                  )}
                  {/* Zone (country / city) — collected with the address, not separately */}
                  <ShippingZoneSelect
                    country={newAddress.shipping_country || ''}
                    city={newAddress.shipping_city || ''}
                    onChange={({ country, city }) => setNewAddress((a) => ({ ...a, shipping_country: country, shipping_city: city }))}
                  />
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-marine-outline uppercase">{t.fullAddress}</label>
                    <textarea rows={3} value={newAddress.full_address} onChange={(e) => setNewAddress({...newAddress, full_address: e.target.value})} className="w-full px-4 py-3 rounded-lg border border-marine-teal/15 focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all resize-none" placeholder="Street name, Building number, City, Region..." />
                  </div>
                </div>
              )}
            </div>

            {/* Shipping method */}
            {shippingEnabled && (
              <div className="bg-white p-6 rounded-lg border border-marine-teal/15">
                <h2 className="font-display text-xl font-semibold text-marine-ink mb-4 flex items-center gap-2"><Truck className="text-marine-primary" size={22} />{isAr ? 'الشحن' : 'Shipping'}</h2>

                {/* If the chosen (saved) address has no zone, let them set it here as a fallback. */}
                {!usingNewAddress && !addressHasZone && zoneTree.length > 0 && (
                  <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                    <p className="text-sm text-amber-700">{isAr ? 'هذا العنوان لا يحتوي على منطقة توصيل. اخترها للمتابعة (يمكنك حفظها على العنوان من صفحة الملف الشخصي).' : "This address has no delivery zone. Pick one to continue (you can save it on the address from your profile)."}</p>
                    <ShippingZoneSelect country={destCountry} city={destCity} onChange={({ country, city }) => { setDestCountry(country); setDestCity(city); }} />
                  </div>
                )}

                {/* The quote is authenticated, so a visitor who picked a city
                    before finishing the name and phone sees an empty panel and
                    no reason for it. Say what is missing — otherwise the
                    delivery price looks broken rather than pending. */}
                {isAnonymous && destinationReady && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-marine-teal/15 bg-marine-canvas px-4 py-3 text-sm text-marine-muted">
                    {guestBootstrapping
                      ? <Loader2 size={15} className="animate-spin shrink-0" />
                      : <Info size={15} className="shrink-0 text-marine-outline" />}
                    <span>
                      {isAr
                        ? 'اكتب اسمك ورقم موبايلك فوق عشان نحسبلك تكلفة الشحن.'
                        : 'Add your name and mobile number above to see delivery options and cost.'}
                    </span>
                  </div>
                )}

                {destinationReady && (
                  <p className="text-sm text-marine-outline mb-3">
                    {isAr ? 'التوصيل إلى: ' : 'Delivering to: '}
                    <span className="font-semibold text-marine-ink">{[destCity, destCountry].filter(Boolean).join(', ')}</span>
                  </p>
                )}

                {shippingLoading && (<div className="flex items-center gap-2 text-sm text-marine-outline"><Loader2 size={16} className="animate-spin" /> {isAr ? 'جارٍ حساب خيارات الشحن...' : 'Calculating shipping options...'}</div>)}
                {shippingError && <p className="text-sm text-red-600">{shippingError}</p>}
                {blockedNoZone && <p className="text-sm text-red-600 font-medium">{isAr ? 'عذراً، لا نقوم بالشحن إلى هذه الوجهة بعد.' : "Sorry, we don't ship to this destination yet."}</p>}
                {!destinationReady && !shippingLoading && !blockedNoZone && (usingNewAddress || addressHasZone) && (
                  <p className="text-sm text-marine-outline">{isAr ? 'أكمل بيانات منطقة التوصيل في العنوان أعلاه.' : 'Complete the delivery zone in the address above.'}</p>
                )}

                {!shippingLoading && destinationReady && shippingQuote && !blockedNoZone && (
                  <div className="space-y-3 mt-3">
                    {(shippingQuote.available_methods || []).length === 0 && (<p className="text-sm text-marine-outline">{isAr ? 'لا توجد طرق شحن متاحة لهذه الوجهة.' : 'No shipping methods available for this destination.'}</p>)}
                    {(shippingQuote.available_methods || []).map((m) => (
                      <label key={m.id} className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${String(selectedMethodId) === String(m.id) ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 hover:border-marine-teal/25'}`}>
                        <input type="radio" name="shipping_method" checked={String(selectedMethodId) === String(m.id)} onChange={() => setSelectedMethodId(String(m.id))} className="accent-marine-cyan" />
                        <div className="flex-1">
                          <p className="font-bold text-marine-ink">{isAr ? (m.name_ar || m.name) : m.name}</p>
                          {(m.eta_min != null || m.eta_max != null) && (<p className="text-xs text-marine-outline">{isAr ? 'التوصيل خلال ' : 'Delivery in '}{m.eta_min ?? ''}{m.eta_min != null && m.eta_max != null ? '–' : ''}{m.eta_max ?? ''} {isAr ? 'يوم' : 'days'}</p>)}
                          {(m.warnings || []).length > 0 && <p className="text-[11px] text-amber-600 mt-0.5">⚠ {m.warnings.join(' ')}</p>}
                        </div>
                        <div className="font-bold text-marine-primary">{Number(m.total_cost) === 0 ? (isAr ? 'مجاني' : 'Free') : `${currency} ${Number(m.total_cost).toFixed(2)}`}</div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Approval section — replaces Payment Method in family mode.
                The member never sees or chooses a payment method. */}
            {isFriendMode ? (
              /* A gift is prepaid — cash at the door would mean the recipient
                 paying for their own present, and the API rejects it. The payer
                 still chooses between their wallet and the gateway. */
              <div className="bg-white p-6 rounded-lg border border-marine-teal/15">
                <h2 className="font-display text-xl font-semibold text-marine-ink mb-4 flex items-center gap-2">
                  <CreditCard className="text-marine-primary" size={22} />{t.paymentMethod}
                </h2>

                <div className="space-y-3">
                  {[
                    ...(walletEnabled ? [{
                      value: 'wallet',
                      title: wal.payWithWallet,
                      desc: wal.payWithWalletDesc(walletBalance.toFixed(2), currency),
                      icon: Wallet,
                    }] : []),
                    ...(onlineAllowed ? [{
                      value: 'credit_card',
                      title: wal.payOnline,
                      desc: wal.payOnlineDesc,
                      icon: CreditCard,
                    }] : []),
                  ].map((method) => (
                    <button
                      key={method.value}
                      type="button"
                      onClick={() => setPaymentMethod(method.value)}
                      className={`w-full p-4 rounded-xl border-2 flex items-center gap-4 text-left transition-colors ${
                        paymentMethod === method.value ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 bg-white hover:border-marine-teal/25'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full flex-shrink-0 ${paymentMethod === method.value ? 'border-[5px] border-marine-cyan' : 'border-2 border-marine-teal/25'}`} />
                      <div>
                        <p className="font-bold text-marine-ink">{method.title}</p>
                        <p className="text-marine-outline text-sm">{method.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>

                {/* The payer's own wallet against this gift — the recipient's
                    balance is never consulted. */}
                {payingFromWallet && !walletSufficient && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-sm font-bold text-red-900">
                      {wal.shortfall(walletShortfall.toFixed(2), currency)}
                    </p>
                    <div className="mt-3 space-y-2">
                      <button
                        type="button"
                        disabled={topupLoading}
                        onClick={() => startTopup(walletShortfall)}
                        className="w-full py-3 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {topupLoading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                        {wal.topUpShortfall(walletShortfall.toFixed(2), currency)}
                      </button>
                      {onlineAllowed && (
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('credit_card')}
                          className="w-full text-sm font-bold text-marine-muted hover:text-marine-ink transition-colors underline underline-offset-4 decoration-zinc-300"
                        >
                          {wal.payOnlineInstead}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {payingFromWallet && walletFrozen && (
                  <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                    <Lock size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-amber-900">{wal.frozen}</p>
                      <p className="text-sm text-amber-800 mt-0.5 leading-relaxed">{wal.frozenHint}</p>
                    </div>
                  </div>
                )}

                <p className="text-marine-outline text-xs mt-3 flex items-start gap-2">
                  <Info size={14} className="flex-shrink-0 mt-0.5" />
                  {frnd.friendOnlineOnlyNotice}
                </p>
              </div>
            ) : isFamilyMode ? (
              <div className="bg-white p-6 rounded-lg border border-marine-teal/15">
                <h2 className="font-display text-xl font-semibold text-marine-ink mb-4 flex items-center gap-2">
                  <Send className="text-marine-primary" size={22} />
                  {isAr ? 'الموافقة' : 'Approval'}
                </h2>

                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3 mb-5">
                  <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-800 leading-relaxed">
                    {isAr
                      ? `سيتم إرسال هذا الطلب إلى ${organizerName} للموافقة عليه. هو من يختار طريقة الدفع، ولن يتم إنشاء أي طلب حتى ذلك الحين.`
                      : `This will be sent to ${organizerName} for approval. They choose the payment method, and no order exists until then.`}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-marine-outline uppercase">{fam.optionalNote}</label>
                  <textarea
                    rows={3} maxLength={200} value={memberNote}
                    onChange={(e) => setMemberNote(e.target.value)}
                    placeholder={isAr ? 'أضف ملاحظة قصيرة لمسؤول العائلة...' : 'Add a short note for your organizer...'}
                    className="w-full px-4 py-3 rounded-lg border border-marine-teal/15 focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all resize-none"
                  />
                  <p className="text-marine-outline text-[11px] text-end">{memberNote.length}/200</p>
                </div>
              </div>
            ) : (
            <div className="bg-white p-6 rounded-lg border border-marine-teal/15">
              <h2 className="font-display text-xl font-semibold text-marine-ink mb-6 flex items-center gap-2"><CreditCard className="text-marine-primary" size={22} />{t.paymentMethod}</h2>
              <div className="space-y-3">
                {[
                  // The company account, when this customer has one (feature 14).
                  ...(companyInfo?.eligible && !isGiftMode ? [{
                    value: 'company_account',
                    title: isAr ? `على حساب ${companyInfo.company?.name || companyTerms.the}` : `On ${companyInfo.company?.name || companyTerms.one} account`,
                    desc: companyInfo.available
                      ? (companyBeneficiary === 'car'
                        ? (isAr ? `طلب لعربية من عربيات ${companyTerms.the} — على حساب ${companyTerms.the}.` : `An order for ${companyTerms.aOne} car — billed to the ${companyTerms.one}.`)
                        : (isAr ? `${companyTerms.the} ${companyTerms.v('بتدفع', 'بيدفع')} في حدود الليميت بتاعك، شامل الشحن.` : `The ${companyTerms.one} pays within your limit, shipping included.`))
                      : companyReasonText(companyInfo.reason, companyInfo, isAr),
                  }] : []),
                  // The wallet ADDS a way to pay rather than replacing one:
                  // the customer's own credit first, then the gateway, then
                  // cash. The store decides whether the gateway is on offer —
                  // this list only renders what the server said.
                  ...(walletEnabled ? [{
                    value: 'wallet',
                    title: wal.payWithWallet,
                    desc: wal.payWithWalletDesc(walletBalance.toFixed(2), currency),
                    icon: Wallet,
                  }] : []),
                  ...(onlineAllowed ? [{
                    value: 'credit_card',
                    title: wal.payOnline,
                    desc: wal.payOnlineDesc,
                    icon: CreditCard,
                  }] : []),
                  // Cash is hidden outright for a customer the server has closed it to.
                  // Shown greyed out with a reason it would be an accusation on a checkout
                  // screen, and an invitation to argue with a number nobody can see.
                  ...(cashAllowed ? [{
                    value: 'cash',
                    title: t.cashOnDelivery,
                    desc: isAr ? 'ادفع نقداً عند الاستلام.' : 'Pay with cash upon delivery.',
                  }] : []),
                ].map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => setPaymentMethod(method.value)}
                    className={`w-full p-4 rounded-xl border-2 flex items-center gap-4 text-left transition-colors ${
                      paymentMethod === method.value ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 bg-white hover:border-marine-teal/25'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full ${paymentMethod === method.value ? 'border-[5px] border-marine-cyan' : 'border-2 border-marine-teal/25'}`}></div>
                    <div>
                      <p className="font-bold text-marine-ink">{method.title}</p>
                      <p className="text-marine-outline text-sm">{method.desc}</p>
                    </div>
                  </button>
                ))}
              </div>

              {companyMode && (
                <CompanyCheckoutPanel
                  info={companyInfo}
                  selection={{ ...companySel, beneficiary: companyBeneficiary }}
                  onChange={(patch) => {
                    // Another company: its cars, offices and modes are different, so every
                    // earlier choice about them starts over.
                    if (patch.company_id && String(patch.company_id) !== String(companyInfo?.company?._id)) {
                      setSelectedOfficeId(null);
                      setCompanySel({ company_id: patch.company_id, beneficiary: null, car_id: '', delivery_mode: null, ship_now_vendor_ids: [] });
                      return;
                    }
                    setCompanySel((current) => ({
                      ...current,
                      ...patch,
                      ...(patch.beneficiary && patch.beneficiary !== current.beneficiary && patch.beneficiary === 'employee' ? { car_id: '' } : {}),
                    }));
                  }}
                  isAr={isAr}
                  currency={currency}
                />
              )}

              {/* One honest line for the whole group. The destination of a
                  refund is decided per case by the store, so this promises a
                  review rather than a route it cannot guarantee. */}
              <p className="text-marine-outline text-xs mt-3 flex items-start gap-2">
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                {wal.refundNote}
              </p>

              {/* ---- Wallet status for the selected method ----
                  Shown inline under the options rather than as an error at the
                  bottom of the form: a shortfall is not a mistake the customer
                  made, it is a step they have not taken yet, and it belongs
                  next to the choice that created it. */}
              {payingFromWallet && (
                <div className="mt-4">
                  {walletFrozen ? (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                      <Lock size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-bold text-amber-900">{wal.frozen}</p>
                        <p className="text-sm text-amber-800 mt-0.5 leading-relaxed">{wal.frozenHint}</p>
                      </div>
                    </div>
                  ) : walletSufficient ? (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
                      <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-bold text-emerald-900">{wal.walletCovers}</p>
                        <p className="text-sm text-emerald-800 mt-0.5">
                          {wal.balanceAfter(Math.max(0, walletBalance - finalTotal).toFixed(2), currency)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                      <div className="flex items-start gap-3">
                        <AlertCircle size={16} className="text-marine-primary flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-bold text-red-900">
                            {wal.shortfall(walletShortfall.toFixed(2), currency)}
                          </p>
                          <p className="text-sm text-red-800/80 mt-0.5">
                            {wal.payWithWalletDesc(walletBalance.toFixed(2), currency)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        {/* Option 1 — the exact amount needed. One tap. */}
                        <button
                          type="button"
                          disabled={topupLoading}
                          onClick={() => startTopup(walletShortfall)}
                          className="w-full py-3 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {topupLoading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                          {wal.topUpShortfall(walletShortfall.toFixed(2), currency)}
                        </button>

                        {/* Option 2 — any amount the customer prefers, so they
                            can carry a balance forward instead of topping up
                            to the exact penny on every order. */}
                        {!showTopupInput ? (
                          <button
                            type="button"
                            onClick={() => { setShowTopupInput(true); setTopupAmount(String(Math.ceil(walletShortfall))); }}
                            className="w-full py-2.5 rounded-xl bg-white border border-red-200 text-marine-primary font-bold text-sm hover:bg-red-50 transition-colors"
                          >
                            {wal.topUpOther}
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min="1"
                              step="0.01"
                              inputMode="decimal"
                              value={topupAmount}
                              onChange={(e) => setTopupAmount(e.target.value)}
                              placeholder={wal.topUpAmount}
                              className="flex-1 px-4 py-2.5 rounded-xl border border-marine-teal/15 outline-none focus:border-marine-cyan transition-colors"
                            />
                            <button
                              type="button"
                              disabled={topupLoading || !topupAmount}
                              onClick={() => startTopup(topupAmount)}
                              className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-marine-teal text-white font-bold text-sm transition-colors disabled:opacity-50"
                            >
                              {wal.topUpAction}
                            </button>
                          </div>
                        )}

                        <p className="text-red-800/60 text-xs text-center leading-relaxed pt-1">
                          {wal.afterTopUpNote}
                        </p>

                        {/* Option 3 — the way out that is not topping up. A
                            shortfall is a dead end otherwise, and the nearest
                            exit belongs in the panel that created it. Kept the
                            quietest of the three so topping up stays the main
                            road and the wallet does not wither. */}
                        {onlineAllowed && (
                          <button
                            type="button"
                            onClick={() => setPaymentMethod('credit_card')}
                            className="w-full pt-1 text-sm font-bold text-marine-muted hover:text-marine-ink transition-colors underline underline-offset-4 decoration-zinc-300"
                          >
                            {wal.payOnlineInstead}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {topupNotice && (
                <div className={`mt-4 p-4 rounded-xl border text-sm font-medium ${
                  topupNotice.tone === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : topupNotice.tone === 'pending' ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {topupNotice.text}
                </div>
              )}
            </div>
            )}

            {error && (<div className="p-4 bg-red-50 text-red-600 rounded-xl border border-marine-cyan/25 text-sm font-medium">{error}</div>)}

          </div>

          {/* Right Column: Order Summary */}
          <div className="lg:w-[400px] flex-shrink-0">
            <div className="bg-white p-6 rounded-lg border border-marine-teal/15 sticky top-24">
              <h2 className="font-display text-xl font-semibold text-marine-ink mb-6">{t.orderSummary}</h2>
              <div className="space-y-4 max-h-[400px] overflow-y-auto mb-6 pr-2">
                {checkoutItems.map(item => (
                  <div key={getCartItemKey(item)} className="flex gap-4 items-start pb-4 border-b border-marine-teal/15 last:border-0 last:pb-0">
                    <div className="w-16 h-16 bg-marine-canvas rounded-lg overflow-hidden flex-shrink-0 border border-marine-teal/15 relative">
                      {item.product.image ? (<img src={item.product.image} alt={isAr ? (item.product.title_ar || item.product.title_en) : item.product.title_en} className="object-cover w-full h-full" />) : (<div className="w-full h-full bg-marine-mist"></div>)}
                      <span className="absolute -top-2 -end-2 w-5 h-5 bg-marine-teal text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10">{item.quantity}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-marine-ink line-clamp-2 leading-snug">{isAr ? (item.product.title_ar || item.product.title_en) : item.product.title_en}</p>
                      <p className="font-display text-marine-navy font-bold text-sm mt-1">{(item.product.price || 0).toLocaleString()} <span className="text-[11px] font-medium text-marine-muted">{currency}</span></p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-3 mb-6">
                <div className="rounded-xl border border-marine-teal/15 bg-marine-canvas p-3 space-y-2">
                  <p className="text-xs font-bold text-marine-outline uppercase tracking-wider">{isAr ? 'كوبون الخصم' : 'Coupon'}</p>
                  <div className="flex gap-2">
                    <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder={isAr ? 'أدخل الكود' : 'Enter code'} className="flex-1 px-3 py-2 rounded-lg border border-marine-teal/15 bg-white text-sm focus:outline-none focus:border-marine-cyan" />
                    {appliedCoupon ? (
                      <button type="button" onClick={removeCoupon} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-600 hover:bg-red-500/20"><X size={12} /> {isAr ? 'إزالة' : 'Remove'}</button>
                    ) : (
                      <button type="button" onClick={applyCoupon} disabled={couponLoading || !couponCode.trim()} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark disabled:opacity-50">{couponLoading ? <Loader2 size={12} className="animate-spin" /> : <Ticket size={12} />}{isAr ? 'تطبيق' : 'Apply'}</button>
                    )}
                  </div>
                  {appliedCoupon && (<p className="text-xs font-semibold text-emerald-600">{isAr ? 'تم تطبيق الكوبون:' : 'Applied coupon:'} {appliedCoupon?.coupon?.code}</p>)}
                  {appliedCoupon && isFamilyMode && (
                    <p className="text-[11px] text-marine-outline leading-relaxed">
                      {isAr
                        ? 'يُرسَل الكوبون مع الطلب لكنه غير مضمون — يُعاد التحقق من صلاحيته لمسؤول العائلة قبل الدفع.'
                        : 'The coupon is sent with the request but is not guaranteed — it is re-checked against your organizer before payment.'}
                    </p>
                  )}
                  {couponError && <p className="text-xs font-semibold text-red-600">{couponError}</p>}
                </div>

                {/* ---- Loyalty points ---- */}
                {loyaltyAvailable && (
                  <LoyaltyPanel
                    copy={loy}
                    isAr={isAr}
                    currency={currency}
                    wallet={wallet}
                    preview={loyaltyPreview}
                    loading={loyaltyLoading}
                    enabled={useLoyalty}
                    onToggle={toggleUseLoyalty}
                    requestedPoints={requestedPoints}
                    onRequestPoints={setRequestedPoints}
                    maxPoints={maxLoyaltyPoints}
                  />
                )}

                <div className="border-t border-marine-teal/15 pt-4 space-y-3">
                  <div className="flex justify-between text-marine-outline text-sm"><span>{t.subtotal}</span><span>{currency} {checkoutTotal.toFixed(2)}</span></div>
                  <div className="flex justify-between text-marine-outline text-sm"><span>{isAr ? 'الخصم' : 'Discount'}</span><span className="text-emerald-600 font-medium">- {currency} {couponDiscount.toFixed(2)}</span></div>
                  {appliedPoints > 0 && (
                    <div className="flex justify-between text-marine-outline text-sm">
                      <span className="flex items-center gap-1.5"><Sparkles size={13} className="text-marine-primary" />{loy.pointsApplied(appliedPoints)}</span>
                      <span className="text-emerald-600 font-medium">- {currency} {loyaltyDiscount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-marine-outline text-sm">
                    <span>{isAr ? 'الشحن' : 'Shipping'}</span>
                    <span className={!shippingEnabled || shippingCost === 0 ? 'text-green-600 font-medium' : 'font-medium'}>
                      {!shippingEnabled ? (isAr ? 'مجاني' : 'Free')
                        : !destinationReady ? (isAr ? 'حدد منطقة التوصيل' : 'Set delivery zone')
                        : blockedNoZone ? (isAr ? 'غير متاح' : 'Unavailable')
                        : !selectedMethod ? '—'
                        : shippingCost === 0 ? (isAr ? 'مجاني' : 'Free')
                        : `${currency} ${shippingCost.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="flex justify-between text-marine-ink font-bold text-lg pt-3 border-t border-marine-teal/15">
                    {/* "Estimated total" in family mode — the organizer's
                        checkout revalidates everything before payment. */}
                    <span>{isFamilyMode ? fam.estimatedTotal : t.totalPrice}</span>
                    <span>{currency} {finalTotal.toFixed(2)}</span>
                  </div>
                  {isFamilyMode && (
                    <p className="text-xs text-marine-outline leading-relaxed pt-1">{fam.noPaymentNow}</p>
                  )}
                  {companyMode && companyInfo?.available && (
                    <div className="rounded-xl bg-marine-canvas border border-marine-teal/15 p-3 space-y-1.5 text-sm">
                      <div className="flex justify-between text-marine-muted">
                        <span className="flex items-center gap-1.5"><Building2 size={13} className="text-marine-primary" />{isAr ? `على حساب ${companyTerms.the}` : `On the ${companyTerms.one} account`}</span>
                        <span className="font-bold">{currency} {Number(companyInfo.company_amount || 0).toFixed(2)}</span>
                      </div>
                      {/* The hold, stated beside the button: full shipping now, the saving later. */}
                      {consolidating && Number(companyInfo?.consolidation?.parcels?.length || 0) > 0 && (
                        <p className="text-[11px] text-marine-outline leading-relaxed pt-1 border-t border-marine-teal/15">
                          {isAr
                            ? 'الشحن محسوب كامل دلوقتي. لما الدفعة تتقفل، اللي اتوفر بيرجع لليميت بتاعك.'
                            : 'Shipping is counted in full now. When the batch closes, what was saved goes back on your limit.'}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Disclosed here, before payment — the whole point is that nothing about
                      the split is first discovered when a courier is at the door. */}
                  <DeliverySplitSummary
                    delivery={deliverySplit}
                    isCOD={paymentMethod === 'cash'}
                    currency={currency}
                    isAr={isAr}
                  />
                  {/* Earning estimate. Always phrased as an estimate: the
                      backend settles the real number at delivery, and a
                      returned item changes it afterwards. */}
                  {loyaltyAvailable && wallet?.rules?.earning_enabled && Number(loyaltyPreview?.estimated_earn_points || 0) > 0 && (
                    <p className="text-xs text-marine-outline leading-relaxed pt-1 flex items-start gap-1.5">
                      <Sparkles size={12} className="text-marine-primary flex-shrink-0 mt-0.5" />
                      <span>{loy.earnEstimate(Number(loyaltyPreview.estimated_earn_points))} <span className="text-marine-outline">{loy.estimateNote}</span></span>
                    </p>
                  )}
                </div>
              </div>

              <button
                id="complete-checkout-button"
                data-meta-event={isFamilyMode ? undefined : "Purchase"}
                onClick={handlePlaceOrder}
                disabled={!canPlaceOrder}
                className="flex w-full items-center justify-center gap-2 bg-marine-primary hover:bg-marine-teal text-white font-display text-base font-semibold py-4 rounded transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              >
                <Lock size={16} />
                {loading
                  ? "..."
                  : isFamilyMode
                    ? (isAr ? `إرسال إلى ${organizerName} للموافقة` : `Send to ${organizerName} for approval`)
                    : isFriendMode
                      ? frnd.payOnlineFor(friendName)
                      : companyMode
                        ? (isAr ? `اطلب على حساب ${companyTerms.the}` : `Order on the ${companyTerms.one} account`)
                        : t.placeOrder}
              </button>

              {isFriendMode && (
                <p className="text-marine-outline text-[11px] text-center mt-3 flex items-center justify-center gap-1.5">
                  <Gift size={12} className="text-marine-primary" />
                  {frnd.orderedFor(friendName)} · {frnd.paidByYou}
                </p>
              )}

              <p className="flex items-center justify-center gap-1.5 text-[11px] text-marine-outline mt-3">
                <ShieldCheck size={12} className="text-marine-success" />{isAr ? 'دفع مشفّر 256-bit عبر بوابات مصرية' : '256-bit TLS encrypted Egyptian gateway session'}
              </p>
              <div className="mt-5 pt-5 border-t border-marine-teal/10">
                <p className="font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-muted mb-3">{isAr ? 'بوابات الدفع المصرية المعتمدة' : 'Authorized Egyptian Gateways'}</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Paymob', 'Visa • Master • Meeza'],
                    ['Fawaterak', 'Aman • Masary • POS'],
                    ['valU', isAr ? 'تقسيط حتى 60 شهر' : 'Up to 60 months plan'],
                    ['Bosta COD', isAr ? 'كاش / كارت عند الاستلام' : 'Cash / card on delivery'],
                  ].map(([name, sub]) => (
                    <div key={name} className="border border-marine-teal/15 rounded px-3 py-2">
                      <div className="text-xs font-semibold text-marine-ink">{name}</div>
                      <div className="text-[10px] text-marine-outline">{sub}</div>
                    </div>
                  ))}
                </div>
                <ul className="mt-4 space-y-2 text-[11px] text-marine-muted">
                  <li className="flex gap-2"><BadgeCheck size={13} className="text-marine-primary flex-shrink-0 mt-px" />{isAr ? 'ضمان توافق 30 يوم: استرجاع بدون مشاكل لو القطعة مش مناسبة لمحركك أو رقم الهيكل.' : '30-Day Fitment Guarantee: zero-friction free returns if parts do not pair with your registered engine block or HIN.'}</li>
                  <li className="flex gap-2"><BadgeCheck size={13} className="text-marine-primary flex-shrink-0 mt-px" />{isAr ? 'قطع أصلية 100% بمستندات المستورد للفحص البحري.' : '100% Genuine Certified Parts: direct importer documentation included for marine inspection.'}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The "Use my points" control.
 *
 * Every number rendered here comes from the server's preview, never from local
 * arithmetic — the cap, the balance, and the minimum all live server-side and
 * showing a locally-derived discount would mean showing one the customer does
 * not get. When the applied points differ from what was asked for, the panel
 * says so rather than silently substituting a smaller number.
 */
function LoyaltyPanel({
  copy, isAr, currency, wallet, preview, loading,
  enabled, onToggle, requestedPoints, onRequestPoints, maxPoints,
}) {
  const available = Number(wallet?.balances?.available_points || 0);
  const pending = Number(wallet?.balances?.pending_points || 0);
  const applied = Number(preview?.redeemed_points || 0);
  const discount = Number(preview?.discount || 0);
  const maxDiscount = Number(preview?.max_discount || 0);
  const blocked = loyaltyBlockedCopy(preview?.blocked_reason, isAr, {
    min: wallet?.rules?.min_redeem_points,
  });
  // Asked for more than this order allows — say it, don't just hand back less.
  const clamped = enabled && applied > 0 && Number(requestedPoints) > applied;

  if (available === 0) {
    return (
      <div className="rounded-xl border border-marine-teal/15 bg-marine-canvas p-3 space-y-1">
        <p className="text-xs font-bold text-marine-outline uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles size={12} className="text-marine-primary" />{copy.myPoints}
        </p>
        <p className="text-xs text-marine-outline">
          {pending > 0
            ? `${pending} ${copy.points} · ${copy.pending}`
            : copy.noPointsYet}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-marine-teal/15 bg-marine-canvas p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-marine-outline uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles size={12} className="text-marine-primary" />{copy.myPoints}
        </p>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={enabled}
          className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
            enabled ? 'bg-marine-cyan text-white hover:bg-marine-cyan-dark' : 'bg-white border border-marine-teal/15 text-marine-muted hover:border-marine-teal/25'
          }`}
        >
          {copy.useMyPoints}
        </button>
      </div>

      <p className="text-xs text-marine-outline">{copy.youHave(available)}</p>

      {enabled && (
        <>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min={0}
              max={maxPoints || available}
              value={requestedPoints}
              onChange={(e) => onRequestPoints(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-marine-teal/15 bg-white text-sm focus:outline-none focus:border-marine-cyan"
            />
            <button
              type="button"
              onClick={() => onRequestPoints(maxPoints)}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-marine-teal/15 text-marine-muted hover:border-marine-cyan hover:text-marine-primary whitespace-nowrap"
            >
              {copy.useMaximum}
            </button>
          </div>

          {loading ? (
            <p className="text-xs text-marine-outline flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" />{isAr ? 'جارٍ الحساب...' : 'Calculating...'}
            </p>
          ) : blocked ? (
            <p className="text-xs font-semibold text-amber-600">{blocked}</p>
          ) : applied > 0 ? (
            <>
              <p className="text-xs font-semibold text-emerald-600">
                {copy.pointsApplied(applied)} · - {currency} {discount.toFixed(2)}
              </p>
              {clamped && (
                <p className="text-[11px] text-amber-600 leading-relaxed">
                  {copy.maxUsable(maxPoints, maxDiscount.toFixed(2), currency)}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-marine-outline">{copy.maxUsable(maxPoints, maxDiscount.toFixed(2), currency)}</p>
          )}

          <p className="text-[11px] text-marine-outline leading-relaxed">{copy.notOnShipping}</p>
        </>
      )}
    </div>
  );
}

/**
 * One option in "Who is this order for?". Used for Myself, a family organizer,
 * and each purchasable friend, so the three read as one consistent choice set.
 */
function RecipientOption({ selected, onSelect, title, desc, avatar }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`p-4 rounded-xl border-2 text-start transition-colors ${
        selected ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 bg-white hover:border-marine-teal/25'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 rounded-full flex-shrink-0 ${selected ? 'border-[5px] border-marine-cyan' : 'border-2 border-marine-teal/25'}`} />
        {avatar && (
          <img src={resolveAssetUrl(avatar)} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className="font-bold text-marine-ink text-sm truncate">{title}</p>
          <p className="text-marine-outline text-xs">{desc}</p>
        </div>
      </div>
    </button>
  );
}

/**
 * A selectable delivery address belonging to SOMEONE ELSE (a family organizer
 * or a friend). Deliberately has no edit or delete affordance — a viewer never
 * modifies another customer's address book.
 */
function AddressCard({ address, selected, onSelect, isAr }) {
  return (
    <div
      onClick={onSelect}
      className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
        selected ? 'border-marine-cyan bg-red-50/30' : 'border-marine-teal/15 hover:border-marine-teal/25'
      }`}
    >
      {selected && (
        <div className="absolute top-3 end-3 text-marine-primary">
          <CheckCircle2 size={20} className="fill-marine-cyan text-white" />
        </div>
      )}
      {address.label && (
        <span className="inline-block bg-marine-mist text-marine-muted text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mb-2">
          {address.label}
        </span>
      )}
      <p className="font-bold text-marine-ink mb-1">{address.recipient_name}</p>
      <p className="text-marine-muted text-sm mb-1">{address.phone}</p>
      <p className="text-marine-outline text-xs leading-relaxed line-clamp-2">{address.full_address}</p>
      {(address.shipping_country || address.shipping_city) && (
        <p className="text-marine-outline text-[11px] mt-1 flex items-center gap-1">
          <Truck size={11} /> {[address.shipping_city, address.shipping_country].filter(Boolean).join(', ')}
        </p>
      )}
    </div>
  );
}

/**
 * The confirmation of a consolidated company order: the mode, where each parcel is (waiting
 * in its batch, or already on its way because this order completed the batch), and what
 * was held. Stays on screen — the person needs to know it is waiting on purpose.
 */
function BatchOrderConfirmation({ order, isAr, currency, ordersLabel }) {
  const subs = order.sub_orders || [];
  const waiting = subs.filter((s) => s.status === 'held_in_batch').length;
  const released = subs.filter((s) => s.company_batch?.joined_at && s.status !== 'held_in_batch');
  const saved = released.reduce((sum, s) => sum + Number(s.company_batch?.savings || 0), 0);
  const held = Number(order.company?.company_amount || 0) + Number(order.company?.personal_amount || 0);
  return (
    <div className="w-full text-start space-y-3 mt-2">
      <div className="rounded-xl bg-marine-canvas border border-marine-teal/15 p-4 text-sm space-y-1.5">
        <p className="font-bold text-marine-ink">{isAr ? `تجميع على ${order.company?.office_name || orgTerms(order.company?.org_type, true).theBranch}` : `Consolidated to ${order.company?.office_name || orgTerms(order.company?.org_type, false).theBranch}`}</p>
        {waiting > 0 && (
          <p className="text-marine-muted">{isAr
            ? `${waiting === 1 ? 'طردك مستني' : `${waiting} طرود مستنية`} زمايلك في الدفعة، وهيتحرك لما العدد يكمل أو في آخر ميعاد بالكتير.`
            : `${waiting} parcel(s) waiting for colleagues in the batch — they ship when it fills, or at its deadline at the latest.`}</p>
        )}
        {released.length > 0 && (
          <p className="text-emerald-700 font-semibold">{isAr
            ? `أوردرك كمّل الدفعة واتبعت للمورد${saved > 0 ? ` — وفّرت ${currency} ${saved.toFixed(2)} في الشحن` : ''}.`
            : `Your order completed the batch and went to the store${saved > 0 ? ` — you saved ${currency} ${saved.toFixed(2)} on shipping` : ''}.`}</p>
        )}
        <p className="text-marine-outline text-xs">{isAr
          ? `المحجوز: ${currency} ${held.toFixed(2)} (شامل شحن كامل). اللي هيتوفر بيرجعلك أول ما الدفعة تتقفل.`
          : `Held: ${currency} ${held.toFixed(2)} (full shipping included). Whatever is saved comes back when the batch closes.`}</p>
      </div>
      <Link href="/profile?tab=company" className="block w-full text-center bg-marine-cyan text-white font-medium py-3 rounded-xl hover:bg-marine-cyan-dark transition-colors">{isAr ? 'تابع الدفعة' : 'Follow the batch'}</Link>
      <Link href="/profile?tab=orders" className="block w-full text-center bg-marine-navy text-white font-medium py-3 rounded-xl hover:bg-marine-teal transition-colors">{ordersLabel}</Link>
    </div>
  );
}
