/**
 * The courier switch.
 *
 * Ready Car ships with more than one courier now. Two rules keep that from turning every
 * fulfilment path into a pile of `if (provider === ...)`:
 *
 *   1. The DEFAULT courier is a shipping setting; the admin may override it PER PARCEL
 *      before dispatch (`sub_orders[].courier`). `courierFor(sub)` is the only place that
 *      resolution happens.
 *   2. Once a shipment exists, its `provider` field is the truth for that parcel. Webhooks,
 *      sweeps, labels, costs and cancellations read it off the row and never off settings —
 *      flipping the switch never touches parcels already in flight (same discipline as
 *      `services/paymentGateway.js`).
 *
 * `capabilities` says what each courier's API can do. Screens use it to hide a button the
 * courier cannot honour (Arrive has no cancel, pickup or waybill API) rather than offering
 * an action that will fail.
 */
const PROVIDERS = ["bosta", "arrive"];
const DEFAULT_PROVIDER = "bosta";

const CAPABILITIES = {
  bosta: {
    label_en: "Bosta", label_ar: "بوسطة",
    cancelApi: true, pickupApi: true, labelApi: true, priceApi: true,
    perParcelSender: true, smartLabel: true, needsSector: false,
    // Cancellation stays open until a pickup is booked (the existing Bosta rule).
    cancelClosesAtDispatch: false,
  },
  arrive: {
    label_en: "Arrive", label_ar: "أرايف",
    cancelApi: false, pickupApi: false, labelApi: false, priceApi: false,
    perParcelSender: false, smartLabel: false, needsSector: true,
    // Arrive charges the full delivery fee for a cancellation once it has the parcel, so
    // the customer's and vendor's cancel window closes the moment a shipment exists.
    cancelClosesAtDispatch: true,
  },
};

const isProvider = (p) => PROVIDERS.includes(p);
const capabilities = (provider) => CAPABILITIES[isProvider(provider) ? provider : DEFAULT_PROVIDER];
const labelOf = (provider, isAr = false) => {
  const c = capabilities(provider);
  return isAr ? c.label_ar : c.label_en;
};

/* ---- Default courier (cached briefly — read on every dispatch) ---- */
let cache = { value: DEFAULT_PROVIDER, at: 0 };
const CACHE_MS = 15 * 1000;

async function getDefaultCourier() {
  if (Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const { ShippingSettings } = require("../../models/shipping_settings");
    const s = await ShippingSettings.findOne().select("courier_provider").lean();
    cache = { value: isProvider(s?.courier_provider) ? s.courier_provider : DEFAULT_PROVIDER, at: Date.now() };
  } catch (_) {
    cache = { value: DEFAULT_PROVIDER, at: Date.now() };
  }
  return cache.value;
}
const invalidateDefaultCourier = () => { cache.at = 0; };

/** The courier a NOT-YET-DISPATCHED parcel will go to: its own override, else the default. */
async function courierFor(sub) {
  if (sub && isProvider(sub.courier)) return sub.courier;
  return getDefaultCourier();
}

/** The courier a parcel is riding, once dispatched; falls back to the resolution above. */
async function courierOf(sub, shipment = null) {
  if (shipment && isProvider(shipment.provider)) return shipment.provider;
  return courierFor(sub);
}

/** Courier of an existing shipment row. Rows predating the switch are Bosta. */
const providerOfShipment = (shipment) => (isProvider(shipment?.provider) ? shipment.provider : DEFAULT_PROVIDER);

/**
 * The parcel's tracking number regardless of courier.
 * Bosta parcels keep `bosta_tracking_number` (many screens and the Bosta pickup booking key
 * on it); every parcel also carries the generic `tracking_number` since the switch.
 */
const trackingNumberOf = (sub) => sub?.tracking_number || sub?.bosta_tracking_number || null;

/** Public tracking page for a shipment, when the courier has one. */
function trackingUrlFor(provider, trackingNumber) {
  if (!trackingNumber) return null;
  if (provider === "arrive") return `https://arrive-shipping.com/track.php?waybill=${encodeURIComponent(trackingNumber)}`;
  if (provider === "bosta") return `https://bosta.co/tracking-shipments?shipment-number=${encodeURIComponent(trackingNumber)}`;
  return null;
}

/** Whether the Smart Label flow applies to this parcel: the setting AND a courier that honours it. */
function smartLabelApplies(provider, settingEnabled) {
  return !!settingEnabled && capabilities(provider).smartLabel;
}

module.exports = {
  PROVIDERS,
  DEFAULT_PROVIDER,
  CAPABILITIES,
  isProvider,
  capabilities,
  labelOf,
  getDefaultCourier,
  invalidateDefaultCourier,
  courierFor,
  courierOf,
  providerOfShipment,
  trackingNumberOf,
  trackingUrlFor,
  smartLabelApplies,
};
