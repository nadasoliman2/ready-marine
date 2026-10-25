/**
 * The vendor dashboard's "Export as PDF".
 *
 * The document is built as a standalone HTML page and printed from a hidden
 * iframe, rather than drawn with a PDF library or rasterised from the screen.
 * Three reasons, and the first is the one that decides it:
 *
 *  · Arabic. A PDF library has to be handed a font, then told how to shape and
 *    order the glyphs; get either wrong and the report reads as disconnected
 *    letters in the wrong direction. The browser already does both correctly,
 *    for both languages this dashboard speaks.
 *  · The output stays real text — selectable, searchable, and sharp at any
 *    zoom — which a canvas screenshot of the dashboard would not be.
 *  · Nothing is added to the bundle.
 *
 * An iframe rather than a popup window because a popup is a blockable window
 * and this one has no reason to be visible; and because printing the page in
 * place would mean fighting the dashboard's own full-height, overflow-hidden
 * layout for control of the page box.
 *
 * The reader still confirms through the browser's print dialog, choosing
 * "Save as PDF" — that dialog is also where they pick the file's destination,
 * so there is nothing to ask them here.
 */

const BRAND = '#00A6CE';

/** Anything interpolated into the document is text, never markup. */
const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const T = {
  title: { ar: 'تقرير أداء المتجر', en: 'Store Performance Report' },
  period: { ar: 'الفترة', en: 'Period' },
  generated: { ar: 'تاريخ الإصدار', en: 'Generated' },
  allTime: { ar: 'منذ البداية', en: 'All time' },
  vsPrev: { ar: 'مقارنة بالفترة السابقة', en: 'vs previous period' },
  noCompare: { ar: 'لا توجد فترة سابقة للمقارنة', en: 'no comparable period' },

  summary: { ar: 'ملخص الفترة', en: 'Period summary' },
  sales: { ar: 'مبيعات اتسلمت', en: 'Delivered sales' },
  orders: { ar: 'طلبات اتسلمت', en: 'Delivered orders' },
  aov: { ar: 'متوسط قيمة الطلب', en: 'Average order value' },
  units: { ar: 'القطع المباعة', en: 'Units sold' },
  commission: { ar: 'عمولة المنصة', en: 'Platform commission' },
  couponShare: { ar: 'نصيبك من كوبونات الخصم', en: 'Your share of coupons' },
  net: { ar: 'صافي المبيعات المستلمة', en: 'Net delivered sales' },
  customers: { ar: 'عملاء مختلفون', en: 'Unique customers' },
  repeat: { ar: 'عملاء متكررون', en: 'Repeat customers' },

  trend: { ar: 'اتجاه المبيعات (حسب تاريخ التسليم)', en: 'Sales trend (by delivery date)' },
  noTrend: { ar: 'لا توجد مبيعات في هذه الفترة.', en: 'No sales in this period.' },

  topProducts: { ar: 'الأكثر مبيعاً', en: 'Top products' },
  product: { ar: 'المنتج', en: 'Product' },
  revenue: { ar: 'الإيراد', en: 'Revenue' },
  noProducts: { ar: 'مفيش منتجات اتسلمت في الفترة دي.', en: 'Nothing delivered in this period.' },

  wallet: { ar: 'المحفظة', en: 'Wallet' },
  available: { ar: 'رصيد متاح للسحب', en: 'Available to withdraw' },
  held: { ar: 'قيد الانتظار', en: 'Pending' },
  reserved: { ar: 'محجوز لطلب سحب', en: 'Reserved for withdrawal' },
  withdrawn: { ar: 'إجمالي المسحوب', en: 'Total withdrawn' },

  inFlight: { ar: 'في الطريق (دلوقتي)', en: 'On its way (as of now)' },
  atVendor: { ar: 'لسه عندك', en: 'Still with you' },
  inTransit: { ar: 'خرجت ولسه ما وصلتش', en: 'Shipped, not delivered' },
  parcelsOrders: { ar: 'طرد / أوردر', en: 'Parcels / orders' },
  merchandise: { ar: 'قيمة البضاعة', en: 'Merchandise value' },
  collectable: { ar: 'التحصيل من العميل بالشحن', en: 'Collectable incl. shipping' },

  fulfilment: { ar: 'حالة الشحنات', en: 'Parcel status' },
  cancelledOrders: { ar: 'طلبات ملغية', en: 'Cancelled orders' },
  returnedOrders: { ar: 'طلبات مرتجعة', en: 'Returned orders' },

  returns: { ar: 'المرتجعات', en: 'Returns' },
  returnsTotal: { ar: 'إجمالي الطلبات', en: 'Total requests' },
  awaitingVendor: { ar: 'بانتظار مراجعتك', en: 'Awaiting your review' },
  inProgress: { ar: 'قيد التنفيذ', en: 'In progress' },
  completedReturns: { ar: 'مكتملة', en: 'Completed' },
  rejectedReturns: { ar: 'مرفوضة', en: 'Rejected' },
  returnRate: { ar: 'نسبة المرتجعات', en: 'Return rate' },

  catalogue: { ar: 'الكتالوج', en: 'Catalogue' },
  published: { ar: 'منشور', en: 'Published' },
  pendingReview: { ar: 'قيد المراجعة', en: 'Pending review' },
  draft: { ar: 'مسودة', en: 'Draft' },
  outOfStock: { ar: 'نفد المخزون', en: 'Out of stock' },
  lowStock: { ar: 'مخزون منخفض', en: 'Low stock' },

  reviews: { ar: 'تقييمات المتجر', en: 'Store reviews' },
  rating: { ar: 'التقييم', en: 'Rating' },
  reviewCount: { ar: 'عدد التقييمات', en: 'Reviews' },
  noReviews: { ar: 'لا توجد تقييمات معتمدة بعد.', en: 'No approved reviews yet.' },
  stars: { ar: 'نجوم', en: 'stars' },

  lifetime: { ar: 'منذ بداية المتجر', en: 'Since you opened' },
  lifetimeSales: { ar: 'إجمالي المبيعات المستلمة', en: 'Total delivered sales' },
  lifetimeOrders: { ar: 'إجمالي الطلبات المستلمة', en: 'Total delivered orders' },

  note: {
    ar: 'كل الأرقام تخص متجرك وحده. المبيعات والطلبات محسوبة من الطرود اللي اتسلمت للعميل بس، بتاريخ التسليم وبعد خصم أي مرتجع. اللي لسه في الطريق موجود في قسم لوحده ومش محسوب فيها.',
    en: "Every figure is your store's own share. Sales and orders count only parcels delivered to the customer, by delivery date and after refunds. Parcels still on their way are shown separately and not counted.",
  },
};

const RANGE_LABELS = {
  '7d': { ar: 'آخر 7 أيام', en: 'Last 7 days' },
  '30d': { ar: 'آخر 30 يوم', en: 'Last 30 days' },
  '90d': { ar: 'آخر 90 يوم', en: 'Last 90 days' },
  '12m': { ar: 'آخر 12 شهر', en: 'Last 12 months' },
  all: { ar: 'منذ البداية', en: 'All time' },
};

const PARCEL_LABELS = {
  pending_review: { ar: 'بانتظار مراجعتك', en: 'Pending your review' },
  awaiting_tracking: { ar: 'بانتظار رقم التتبع', en: 'Awaiting tracking' },
  awaiting_handover: { ar: 'جاري التغليف', en: 'Being sealed' },
  ready_for_pickup: { ar: 'في انتظار المندوب', en: 'Waiting for courier' },
  handed_to_courier: { ar: 'اتسلمت للمندوب', en: 'Given to courier' },
  pickup_scheduled: { ar: 'تم جدولة الاستلام', en: 'Pickup scheduled' },
  picked_up: { ar: 'تم الاستلام', en: 'Picked up' },
  in_transit: { ar: 'في الطريق', en: 'In transit' },
  out_for_delivery: { ar: 'خارج للتوصيل', en: 'Out for delivery' },
  delivered: { ar: 'تم التوصيل', en: 'Delivered' },
  returned: { ar: 'مرتجع', en: 'Returned' },
  exception: { ar: 'مشكلة', en: 'Exception' },
  needs_admin: { ar: 'يحتاج الإدارة', en: 'Needs admin' },
  cancelled: { ar: 'ملغي', en: 'Cancelled' },
};

/* ------------------------------------------------------------------ */
/*  Document                                                           */
/* ------------------------------------------------------------------ */

export function buildVendorReportHtml(stats, { language = 'en', currency = 'EGP', storeName = '' } = {}) {
  const isAr = language === 'ar';
  const lang = isAr ? 'ar' : 'en';
  const t = (key) => T[key][lang];
  // Arabic month names, Latin numerals. The `-u-nu-latn` matters: without it
  // dates print in Arabic-Indic digits beside figures that print in Latin
  // ones, and a financial document must not use two numeral systems at once.
  const locale = isAr ? 'ar-EG-u-nu-latn' : 'en-GB';

  // Latin digits in both languages. The report is a financial document people
  // retype into spreadsheets and bank forms, and mixed numeral systems are
  // where that goes wrong. `locale` above holds Arabic dates to the same rule.
  const num = (value, digits = 0) =>
    Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const money = (value) => `${num(value, 2)} ${currency}`;
  const pct = (value) => `${num(value, 1)}%`;

  const date = (value) =>
    value ? new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const dateTime = (value) =>
    value ? new Date(value).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const rangeKey = stats?.range?.key || '30d';
  const rangeLabel = (RANGE_LABELS[rangeKey] || RANGE_LABELS['30d'])[lang];
  const periodLine = stats?.range?.from
    ? `${rangeLabel} · ${date(stats.range.from)} — ${date(stats.range.to)}`
    : `${rangeLabel} — ${date(stats?.range?.to)}`;

  /** The growth line under a headline figure, or the honest absence of one. */
  const delta = (value) => {
    if (value === null || value === undefined) {
      return `<span class="delta flat">${esc(t('noCompare'))}</span>`;
    }
    const up = value >= 0;
    return `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${esc(pct(Math.abs(value)))} <span class="muted">${esc(t('vsPrev'))}</span></span>`;
  };

  const kpi = (label, value, sub = '') => `
    <div class="kpi">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${esc(value)}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;

  const row = (label, value) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;

  /* ---- Trend ---- */
  const series = stats?.series || [];
  const peak = Math.max(0, ...series.map((point) => Number(point.sales) || 0));
  const granularity = stats?.range?.granularity || 'day';

  const bucketLabel = (key) => {
    if (granularity === 'month') {
      return new Date(`${key}-01T00:00:00`).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
    }
    return new Date(`${key}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  };

  // An SVG bar chart rather than styled divs: print engines drop background
  // colours far more readily than they drop vector shapes, and a trend that
  // silently prints as an empty strip is worse than no chart at all.
  const chartWidth = 720;
  const chartHeight = 190;
  const gutter = 26;
  const slot = series.length ? (chartWidth - gutter) / series.length : 0;
  const barWidth = Math.max(3, Math.min(30, slot * 0.6));
  // A crowded axis is unreadable, so labels thin out rather than overlap.
  const labelEvery = Math.ceil(series.length / 14);

  const chart = !series.length || peak <= 0
    ? `<p class="empty">${esc(t('noTrend'))}</p>`
    : `<svg class="chart" viewBox="0 0 ${chartWidth} ${chartHeight + 34}" role="img" aria-label="${esc(t('trend'))}">
        <line x1="${gutter}" y1="${chartHeight}" x2="${chartWidth}" y2="${chartHeight}" stroke="#d4d4d8" stroke-width="1"/>
        ${series.map((point, index) => {
          const value = Number(point.sales) || 0;
          const height = value > 0 ? Math.max(2, (value / peak) * (chartHeight - 12)) : 0;
          const x = gutter + index * slot + (slot - barWidth) / 2;
          const label = index % labelEvery === 0
            ? `<text x="${x + barWidth / 2}" y="${chartHeight + 15}" text-anchor="middle" class="tick">${esc(bucketLabel(point.date))}</text>`
            : '';
          return `${height ? `<rect x="${x}" y="${chartHeight - height}" width="${barWidth}" height="${height}" fill="${BRAND}" rx="2"/>` : ''}${label}`;
        }).join('')}
        <text x="${gutter - 6}" y="12" text-anchor="end" class="tick">${esc(num(peak))}</text>
        <text x="${gutter - 6}" y="${chartHeight}" text-anchor="end" class="tick">0</text>
      </svg>`;

  /* ---- Top products ---- */
  const topProducts = stats?.top_products || [];
  const topProductsBlock = topProducts.length
    ? `<table class="grid">
        <thead><tr><th>#</th><th>${esc(t('product'))}</th><th class="n">${esc(t('units'))}</th><th class="n">${esc(t('revenue'))}</th></tr></thead>
        <tbody>${topProducts.map((product, index) => `
          <tr>
            <td class="rank">${index + 1}</td>
            <td>${esc(product.title || '—')}</td>
            <td class="n">${esc(num(product.units))}</td>
            <td class="n">${esc(money(product.revenue))}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : `<p class="empty">${esc(t('noProducts'))}</p>`;

  /* ---- Parcels ---- */
  const parcels = stats?.parcels || [];
  const parcelBlock = parcels.length
    ? `<table class="rows">${parcels.map((parcel) =>
        row((PARCEL_LABELS[parcel.status] || { ar: parcel.status, en: parcel.status })[lang], num(parcel.count))
      ).join('')}</table>`
    : '';

  /* ---- In flight: right now, not the period ---- */
  const inFlightBlock = ['at_vendor', 'in_transit'].map((key) => {
    const stage = stats?.in_flight?.[key] || {};
    return `<table class="rows">
        <tr><th colspan="2" class="sub">${esc(t(key === 'at_vendor' ? 'atVendor' : 'inTransit'))}</th></tr>
        ${row(t('parcelsOrders'), `${num(stage.parcels)} / ${num(stage.orders)}`)}
        ${row(t('merchandise'), money(stage.merchandise))}
        ${row(t('collectable'), money(stage.collectable))}
      </table>`;
  }).join('');

  /* ---- Reviews ---- */
  const distribution = stats?.reviews?.distribution || [];
  const reviewsBlock = stats?.reviews?.count
    ? `<table class="rows">
        ${row(t('rating'), `${num(stats.reviews.rating, 1)} / 5`)}
        ${row(t('reviewCount'), num(stats.reviews.count))}
       </table>
       <table class="rows bars">${distribution.map((bucket) => `
        <tr>
          <th>${bucket.star} ${esc(t('stars'))}</th>
          <td class="barcell"><span class="bar" style="width:${Math.max(0, Math.min(100, bucket.pct))}%"></span></td>
          <td class="n narrow">${esc(num(bucket.count))}</td>
        </tr>`).join('')}
       </table>`
    : `<p class="empty">${esc(t('noReviews'))}</p>`;

  return `<!doctype html>
<html lang="${lang}" dir="${isAr ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${esc(storeName || t('title'))} — ${esc(t('title'))}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }

  /* Bar fills and tinted headers are information here, not decoration, so the
     report must not print as a page of empty outlines. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }

  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${isAr
      ? "'Segoe UI', Tahoma, 'Noto Naskh Arabic', 'Geeza Pro', Arial, sans-serif"
      : "'Segoe UI', Helvetica, Arial, sans-serif"};
    color: #18181b;
    font-size: 10.5pt;
    line-height: 1.45;
  }

  .head { display: flex; justify-content: space-between; align-items: flex-start;
          gap: 16px; border-bottom: 2.5pt solid ${BRAND}; padding-bottom: 10px; margin-bottom: 18px; }
  .head h1 { margin: 0; font-size: 19pt; letter-spacing: -0.4pt; }
  .head .store { margin: 3px 0 0; font-size: 11.5pt; font-weight: 700; color: ${BRAND}; }
  .head .meta { text-align: ${isAr ? 'left' : 'right'}; font-size: 8.5pt; color: #52525b; line-height: 1.7; white-space: nowrap; }
  .head .meta b { display: block; color: #18181b; font-size: 9pt; }

  h2 { font-size: 11.5pt; margin: 0 0 9px; padding-bottom: 5px; border-bottom: 1pt solid #e4e4e7; }

  /* A section must not be split across a page break with its heading orphaned
     on the previous one. */
  section { margin-bottom: 17px; break-inside: avoid; page-break-inside: avoid; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpi { border: 1pt solid #e4e4e7; border-radius: 5px; padding: 9px 11px; background: #fafafa; }
  .kpi-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.4pt; color: #71717a; font-weight: 700; }
  .kpi-value { font-size: 14pt; font-weight: 800; margin-top: 3px; letter-spacing: -0.3pt; }
  .kpi-sub { font-size: 7.5pt; margin-top: 2px; }

  .delta { font-weight: 700; }
  .delta.up { color: #15803d; }
  .delta.down { color: #b91c1c; }
  .delta.flat { color: #a1a1aa; font-weight: 600; }
  .muted { color: #71717a; font-weight: 500; }

  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 17px; }

  table { width: 100%; border-collapse: collapse; }
  .rows th, .rows td { padding: 4px 0; font-size: 9.5pt; border-bottom: 0.5pt solid #f4f4f5; }
  .rows th { text-align: ${isAr ? 'right' : 'left'}; font-weight: 500; color: #52525b; }
  .rows td { text-align: ${isAr ? 'left' : 'right'}; font-weight: 700; }
  .rows th.sub { padding-top: 8px; font-weight: 700; color: #18181b; }

  .grid th, .grid td { padding: 5px 7px; font-size: 9.5pt; border-bottom: 0.5pt solid #e4e4e7;
                       text-align: ${isAr ? 'right' : 'left'}; }
  .grid thead th { background: #f4f4f5; font-size: 8pt; text-transform: uppercase;
                   letter-spacing: 0.3pt; color: #52525b; border-bottom: 1pt solid #d4d4d8; }
  .grid .n { text-align: ${isAr ? 'left' : 'right'}; font-variant-numeric: tabular-nums; }
  .grid .rank { color: #a1a1aa; width: 18px; font-weight: 700; }

  .bars { margin-top: 6px; }
  .bars th { width: 62px; white-space: nowrap; }
  .bars .barcell { width: auto; padding: 4px 8px; }
  .bars .narrow { width: 34px; }
  .bar { display: block; height: 7px; border-radius: 3px; background: ${BRAND}; min-width: 1px; }

  .chart { width: 100%; height: auto; }
  .tick { font-size: 7pt; fill: #71717a; }

  .empty { font-size: 9.5pt; color: #a1a1aa; margin: 6px 0; font-style: italic; }

  .note { margin-top: 20px; padding-top: 8px; border-top: 0.5pt solid #e4e4e7;
          font-size: 8pt; color: #71717a; }
</style>
</head>
<body>

  <div class="head">
    <div>
      <h1>${esc(t('title'))}</h1>
      ${storeName ? `<p class="store">${esc(storeName)}</p>` : ''}
    </div>
    <div class="meta">
      <b>${esc(t('period'))}</b>${esc(periodLine)}
      <b style="margin-top:5px">${esc(t('generated'))}</b>${esc(dateTime(new Date()))}
    </div>
  </div>

  <section>
    <h2>${esc(t('summary'))}</h2>
    <div class="kpis">
      ${kpi(t('sales'), money(stats?.sales?.period), delta(stats?.sales?.growth_pct))}
      ${kpi(t('orders'), num(stats?.orders?.period), delta(stats?.orders?.growth_pct))}
      ${kpi(t('aov'), money(stats?.sales?.avg_order_value))}
      ${kpi(t('units'), num(stats?.orders?.units_sold))}
    </div>
    <div class="cols" style="margin-top:12px">
      <table class="rows">
        ${row(t('net'), money(stats?.sales?.net))}
        ${row(t('commission'), money(stats?.sales?.commission))}
        ${Number(stats?.sales?.coupon_share) > 0 ? row(t('couponShare'), money(stats?.sales?.coupon_share)) : ''}
        ${row(t('customers'), num(stats?.customers?.unique))}
        ${row(t('repeat'), `${num(stats?.customers?.repeat)} (${pct(stats?.customers?.repeat_pct)})`)}
      </table>
      <table class="rows">
        ${row(t('cancelledOrders'), num(stats?.orders?.cancelled))}
        ${row(t('returnedOrders'), num(stats?.orders?.returned))}
        ${row(t('lifetimeSales'), money(stats?.sales?.lifetime))}
        ${row(t('lifetimeOrders'), num(stats?.orders?.lifetime))}
      </table>
    </div>
  </section>

  <section>
    <h2>${esc(t('trend'))}</h2>
    ${chart}
  </section>

  <section>
    <h2>${esc(t('topProducts'))}</h2>
    ${topProductsBlock}
  </section>

  <div class="cols">
    <section>
      <h2>${esc(t('wallet'))}</h2>
      <table class="rows">
        ${row(t('available'), money(stats?.earnings?.available))}
        ${row(t('held'), money(stats?.earnings?.pending))}
        ${row(t('reserved'), money(stats?.earnings?.reserved))}
        ${row(t('withdrawn'), money(stats?.earnings?.withdrawn))}
      </table>
    </section>

    <section>
      <h2>${esc(t('returns'))}</h2>
      <table class="rows">
        ${row(t('returnsTotal'), num(stats?.returns?.total))}
        ${row(t('awaitingVendor'), num(stats?.returns?.awaiting_vendor))}
        ${row(t('inProgress'), num(stats?.returns?.in_progress))}
        ${row(t('completedReturns'), num(stats?.returns?.completed))}
        ${row(t('rejectedReturns'), num(stats?.returns?.rejected))}
        ${row(t('returnRate'), pct(stats?.returns?.rate_pct))}
      </table>
    </section>

    <section>
      <h2>${esc(t('catalogue'))}</h2>
      <table class="rows">
        ${row(t('published'), num(stats?.products?.published))}
        ${row(t('pendingReview'), num(stats?.products?.pending))}
        ${row(t('draft'), num(stats?.products?.draft))}
        ${row(t('outOfStock'), num(stats?.products?.out_of_stock))}
        ${row(t('lowStock'), num(stats?.products?.low_stock))}
      </table>
    </section>

    <section>
      <h2>${esc(t('reviews'))}</h2>
      ${reviewsBlock}
    </section>

    ${parcelBlock ? `<section><h2>${esc(t('fulfilment'))}</h2>${parcelBlock}</section>` : ''}

    <section>
      <h2>${esc(t('inFlight'))}</h2>
      ${inFlightBlock}
    </section>
  </div>

  <p class="note">${esc(t('note'))}</p>

</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Printing                                                           */
/* ------------------------------------------------------------------ */

/**
 * Print an HTML document from an offscreen iframe.
 *
 * The iframe is torn down on the print dialog's `afterprint`, with a timeout
 * behind it: Safari has never fired `afterprint` reliably, and an iframe left
 * in the DOM would go on printing itself alongside every later page print.
 */
function printDocument(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };

  frame.onload = () => {
    const view = frame.contentWindow;
    if (!view) return remove();

    view.addEventListener('afterprint', remove, { once: true });
    // Long enough that a reader deciding at the dialog is not interrupted; the
    // frame is invisible and inert until then.
    setTimeout(remove, 60000);

    view.focus();
    view.print();
  };

  // srcdoc rather than document.write: the frame is same-origin either way,
  // but this needs no open/close dance and cannot race the load event.
  frame.srcdoc = html;
}

/**
 * Build this vendor's report and hand it to the browser's print dialog, where
 * the reader chooses "Save as PDF".
 */
export function exportVendorReportPdf(stats, options) {
  printDocument(buildVendorReportHtml(stats, options));
}
