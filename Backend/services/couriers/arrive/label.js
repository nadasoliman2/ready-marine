/**
 * The printed Arrive label.
 *
 * Arrive has no waybill API; it hands back a `waybill` and a `qr_code` string and prints
 * labels only inside its own portal, which vendors cannot log into. So the label is rendered
 * here — 10×15 cm, Code128 barcode of the waybill, QR of Arrive's `qr_code`, sender branch,
 * receiver, COD and our reference — as a self-contained HTML page the browser prints.
 * If Arrive supplies its own template later, only this file changes.
 */
const QRCode = require("qrcode");

/* ---- Code128 (set B), inline so the label needs no external image service ---- */
const CODE128 = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212",
  "112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321",
  "112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212",
  "124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];
const START_B = 104;
const STOP = 106;

function code128Svg(text, { height = 60, module = 2 } = {}) {
  const chars = String(text || "").split("").map((c) => {
    const v = c.charCodeAt(0) - 32;
    return v >= 0 && v < 95 ? v : 0;
  });
  const values = [START_B, ...chars];
  let sum = START_B;
  chars.forEach((v, i) => { sum += v * (i + 1); });
  values.push(sum % 103, STOP);
  let x = 0;
  let rects = "";
  for (const v of values) {
    const pattern = CODE128[v];
    for (let i = 0; i < pattern.length; i += 1) {
      const w = Number(pattern[i]) * module;
      if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`;
      x += w;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${height}" viewBox="0 0 ${x} ${height}" shape-rendering="crispEdges">${rects}</svg>`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * @param {Object} p
 * @param {string} p.waybill
 * @param {string|null} p.qrCode        Arrive's qr_code string
 * @param {{name:string, phone:string, address:string}} p.sender
 * @param {{name:string, phone:string, address:string, area:string}} p.receiver
 * @param {number} p.cod
 * @param {string} p.reference          our parcel reference (REF-XXXX-1)
 * @param {string} p.itemsSummary
 * @param {number} p.itemCount
 * @param {string} [p.notes]
 * @returns {Promise<string>} HTML
 */
async function renderLabelHtml(p) {
  const qr = p.qrCode ? await QRCode.toString(p.qrCode, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : "";
  const barcode = code128Svg(p.waybill, { height: 70, module: 2 });
  const cod = Number(p.cod || 0);
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Arrive ${esc(p.waybill)}</title>
<style>
  @page { size: 100mm 150mm; margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, "Segoe UI", Tahoma, sans-serif; color: #000; background: #fff; }
  .label { width: 92mm; min-height: 142mm; padding: 3mm; border: 0.4mm solid #000; display: flex; flex-direction: column; gap: 2.5mm; }
  .head { display: flex; align-items: center; justify-content: space-between; border-bottom: 0.4mm solid #000; padding-bottom: 2mm; }
  .brand { font-size: 7mm; font-weight: 900; letter-spacing: 0.5px; }
  .brand small { display: block; font-size: 3mm; font-weight: 700; color: #333; }
  .svc { font-size: 3.2mm; font-weight: 800; border: 0.3mm solid #000; padding: 1mm 2mm; border-radius: 1.5mm; }
  .codes { display: flex; align-items: center; gap: 3mm; }
  .barcode { flex: 1; text-align: center; }
  .barcode svg { width: 100%; height: 16mm; }
  .wb { font-family: "Courier New", monospace; font-size: 5.5mm; font-weight: 900; letter-spacing: 1px; margin-top: 1mm; direction: ltr; }
  .qr svg { width: 22mm; height: 22mm; }
  .box { border: 0.3mm solid #000; border-radius: 1.5mm; padding: 2mm; }
  .box h4 { margin: 0 0 1mm; font-size: 3mm; text-transform: uppercase; letter-spacing: 0.5px; color: #444; }
  .box .n { font-size: 4.2mm; font-weight: 900; }
  .box .t { font-size: 3.4mm; line-height: 1.35; }
  .cod { display: flex; align-items: center; justify-content: space-between; border: 0.6mm solid #000; padding: 2mm 3mm; }
  .cod .lbl { font-size: 3.4mm; font-weight: 800; }
  .cod .amt { font-size: 8mm; font-weight: 900; direction: ltr; }
  .foot { margin-top: auto; font-size: 2.8mm; color: #333; display: flex; justify-content: space-between; gap: 2mm; }
  .items { font-size: 3mm; line-height: 1.3; max-height: 16mm; overflow: hidden; }
  @media screen { body { padding: 8mm; background: #eee; } .label { background: #fff; margin: 0 auto; } .print { display: block; margin: 0 auto 6mm; padding: 3mm 8mm; font-weight: 800; } }
  @media print { .print { display: none; } }
</style></head><body>
<button class="print" onclick="window.print()">Print / اطبع</button>
<div class="label">
  <div class="head">
    <div class="brand">ARRIVE<small>arrive-shipping.com · Ready Car</small></div>
    <div class="svc">${cod > 0 ? "تسليم وتحصيل · COD" : "تسليم · مدفوع مسبقاً"}</div>
  </div>
  <div class="codes">
    <div class="barcode">${barcode}<div class="wb">${esc(p.waybill)}</div></div>
    ${qr ? `<div class="qr">${qr}</div>` : ""}
  </div>
  <div class="box">
    <h4>المستلم · Receiver</h4>
    <div class="n">${esc(p.receiver?.name)} — <span dir="ltr">${esc(p.receiver?.phone)}</span></div>
    <div class="t">${esc(p.receiver?.area)}${p.receiver?.area ? " · " : ""}${esc(p.receiver?.address)}</div>
  </div>
  <div class="cod"><div class="lbl">المبلغ المطلوب تحصيله<br><span style="font-weight:600">Collect on delivery</span></div><div class="amt">${cod > 0 ? `${cod.toFixed(0)} EGP` : "0 EGP"}</div></div>
  <div class="box">
    <h4>الراسل · Sender (pickup branch)</h4>
    <div class="n">${esc(p.sender?.name)}${p.sender?.phone ? ` — <span dir="ltr">${esc(p.sender.phone)}</span>` : ""}</div>
    <div class="t">${esc(p.sender?.address)}</div>
  </div>
  <div class="box">
    <h4>المحتويات · Contents (${esc(p.itemCount ?? "")})</h4>
    <div class="items">${esc(p.itemsSummary)}</div>
  </div>
  <div class="foot"><span>Ref: <b dir="ltr">${esc(p.reference)}</b></span><span>${esc(p.notes || "")}</span><span dir="ltr">${new Date().toISOString().slice(0, 10)}</span></div>
</div>
</body></html>`;
}

module.exports = { renderLabelHtml, code128Svg };
