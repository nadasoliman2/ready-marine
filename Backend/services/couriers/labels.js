/**
 * The printable waybill / label for a shipment, whichever courier carries it.
 *
 * Bosta hands back its own PDF. Arrive returns only a waybill and a QR string, so its label
 * is rendered by us. Callers stream whatever comes back with the content type given.
 *
 * @returns {{ contentType: string, body: Buffer|string, filename: string }}
 */
const { providerOfShipment } = require("./index");

async function labelForShipment(order, sub, shipment) {
  const provider = providerOfShipment(shipment);

  if (provider === "arrive") {
    const { renderLabelHtml } = require("./arrive/label");
    const { Seller } = require("../../models/sellers");
    const subOrderService = require("../subOrderService");
    const vendor = await Seller.findById(sub.vendor_id).select("store_name name phone").lean();
    const items = subOrderService.shippableItems(order, sub);
    const html = await renderLabelHtml({
      waybill: shipment.tracking_number,
      qrCode: shipment.provider_payload?.qr_code || null,
      sender: {
        name: vendor?.store_name || vendor?.name || "Ready Marine vendor",
        phone: vendor?.phone || "",
        address: [shipment.pickup_address?.address, shipment.pickup_address?.city].filter(Boolean).join(", "),
      },
      receiver: {
        name: order.shipping_address?.recipient_name || "",
        phone: order.shipping_address?.phone || "",
        address: order.shipping_address?.full_address || "",
        area: [shipment.provider_payload?.sector_name, order.shipping?.destination?.city].filter(Boolean).join(" / "),
      },
      cod: Number(shipment.cod_amount || 0),
      reference: sub.reference || String(sub._id),
      itemsSummary: items.map((i) => `${i.quantity || 1} × ${i.product_title || i.title || "item"}`).join(", "),
      itemCount: items.reduce((n, i) => n + Number(i.quantity || 1), 0),
      notes: `Order ${order.transaction?.reference || order._id}`,
    });
    return { contentType: "text/html; charset=utf-8", body: html, filename: `arrive-${shipment.tracking_number}.html` };
  }

  if (!shipment.bosta_delivery_id) throw new Error("This parcel has no Bosta delivery to print");
  const bostaService = require("../bostaService");
  const pdf = await bostaService.printAWB(shipment.bosta_delivery_id);
  return { contentType: "application/pdf", body: pdf, filename: `awb-${shipment.bosta_tracking_number || shipment.bosta_delivery_id}.pdf` };
}

module.exports = { labelForShipment };
