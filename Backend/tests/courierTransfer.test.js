const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function load(relative, mocks) {
  const filename = path.resolve(__dirname, relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  const execute = vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  execute((key) => Object.hasOwn(mocks, key) ? mocks[key] : realRequire(key), module, module.exports);
  return module.exports;
}

function fixture({ source = 'bosta', sent = true, status = 'ready_for_pickup', terminateError, sendError, sector = true } = {}) {
  const events = [];
  const sub = {
    _id: 'parcel', vendor_id: 'vendor', reference: 'ORDER-1', courier: source, status,
    tracking_number: sent ? 'OLD-123' : null,
    bosta_tracking_number: sent && source === 'bosta' ? 'OLD-123' : null,
    shipment_id: sent ? 'old-shipment' : null, smart_label_barcode: source === 'bosta' ? 'STICKER' : null,
    ready_at: new Date(), cod_amount: 120, shipping_share: 25, history: [],
  };
  const old = { _id: 'old-shipment', sub_order_id: sub._id, provider: source, tracking_number: 'OLD-123', bosta_delivery_id: source === 'bosta' ? 'BOSTA-ID' : null, smart_label_barcode: sub.smart_label_barcode };
  const shipments = sent ? [old] : [];
  shipments.pull = (id) => shipments.splice(shipments.findIndex((s) => s._id === id), 1);
  const order = {
    _id: 'order', __v: 0, shipments, sub_orders: [sub], total_price: 120,
    shipping: { destination: { city: 'Cairo' } },
    shipping_address: { full_address: 'Maadi, Cairo', phone: '01012345678' },
    async save() { events.push(`save:${sub.courier}:${sub.courier_transfer?.phase || 'none'}`); this.__v++; },
  };
  const core = {
    AT_VENDOR_STATUSES: ['pending_review', 'awaiting_tracking', 'awaiting_handover', 'ready_for_pickup', 'needs_admin'],
    liveShipmentFor: () => shipments.find((s) => s._id === sub.shipment_id),
    appendSubHistory: (s, action, title, details, metadata) => s.history.push({ action, metadata }),
    syncOrderStatus: () => {},
  };
  const service = load('../services/couriers/transfer.js', {
    '../subOrderService': core,
    './operation': { withOperation: (o, fn) => fn('operation-token') },
    '../bostaService': { terminateDelivery: async () => { events.push('delete'); if (terminateError) throw terminateError; } },
    '../bostaFulfillmentService': {
      dispatchBlockedReason: () => sub.status === 'pending_review' ? 'Items are not confirmed' : null,
      dispatchSubOrder: async (o, s, options) => {
        assert.equal(options.operationToken, 'operation-token');
        assert.equal(s.tracking_number, null);
        assert.equal(o.shipments.length, 0, 'old shipment must be absent before creating the replacement');
        events.push('send');
        if (sendError) { sub.dispatch_attempt = { provider: s.courier, at: new Date(), reference: 'attempt-1' }; throw sendError; }
        s.tracking_number = 'NEW-456';
        s.bosta_tracking_number = s.courier === 'bosta' ? 'NEW-456' : null;
        s.shipment_id = 'new-shipment';
        o.shipments.push({ _id: 'new-shipment', provider: s.courier, tracking_number: s.tracking_number });
      },
    },
    './arrive/client': { isConfigured: () => true },
    './arrive/sectors': {
      getSector: async () => sector ? { sector_id: 10, name: 'Maadi', gov_name: 'Cairo', serviceable: true } : null,
      suggestSector: async () => ({ confidence: 'none' }),
    },
    './arrive/tariff': { isUnservedGroup: () => false },
    '../smartLabelService': { forceRelease: async () => events.push('release-label'), releaseReservations: async () => {} },
    '../../models/notifications': { createNotification: async () => events.push('notify') },
  });
  const run = (extra = {}) => service.transfer({ order, sub, target: source === 'bosta' ? 'arrive' : 'bosta', sectorId: 10, actor: { label: 'Admin' }, ...extra });
  return { service, run, order, sub, old, events };
}

process.env.BOSTA_API_KEY = 'test-placeholder';

test('Bosta → Arrive removes first, changes all active tracking and preserves customer money', async () => {
  const f = fixture();
  const result = await f.run();
  assert.ok(f.events.indexOf('delete') < f.events.indexOf('send'));
  assert.ok(f.events.indexOf('save:bosta:removing') < f.events.indexOf('delete'));
  assert.ok(f.events.indexOf('save:arrive:none') < f.events.indexOf('send'));
  assert.equal(result.dispatched, true);
  assert.equal(f.sub.courier, 'arrive');
  assert.equal(f.sub.bosta_tracking_number, null);
  assert.equal(f.sub.smart_label_barcode, null);
  assert.equal(f.sub.ready_at, null);
  assert.equal(f.sub.status, 'awaiting_handover');
  assert.equal(f.sub.courier_sector_id, 10);
  assert.equal(f.order.shipments.length, 1);
  assert.equal(f.order.shipments[0].provider, 'arrive');
  assert.equal(f.sub.history[0].metadata.retired_shipment._id, 'old-shipment');
  assert.equal(f.sub.cod_amount, 120);
  assert.equal(f.sub.shipping_share, 25);
  assert.equal(f.order.total_price, 120);
});

test('source deletion failure never dispatches a replacement and preserves a resumable checkpoint', async () => {
  const f = fixture({ terminateError: new Error('Courier unavailable') });
  await assert.rejects(f.run(), /No replacement was sent/);
  assert.equal(f.sub.courier, 'bosta');
  assert.equal(f.sub.tracking_number, 'OLD-123');
  assert.equal(f.sub.courier_transfer.phase, 'removing');
  assert.equal(f.order.shipments[0], f.old);
  assert.ok(!f.events.includes('send'));
});

test('replacement timeout keeps the new courier and unresolved attempt, never revives the removed shipment', async () => {
  const f = fixture({ sendError: new Error('outcome unknown') });
  const result = await f.run();
  assert.equal(result.dispatched, false);
  assert.match(result.dispatch_error, /outcome unknown/);
  assert.equal(f.sub.courier, 'arrive');
  assert.equal(f.sub.tracking_number, null);
  assert.equal(f.sub.status, 'awaiting_tracking');
  assert.equal(f.order.shipments.length, 0);
  assert.ok(f.sub.dispatch_attempt.at);
  await assert.rejects(f.run({ target: 'bosta' }), /Resolve the previous send/);
});

test('Arrive → Bosta requires confirmation of the exact removed waybill', async () => {
  const f = fixture({ source: 'arrive' });
  await assert.rejects(f.run(), /Delete waybill OLD-123/);
  await assert.rejects(f.run({ removedTracking: 'different-waybill' }), /Delete waybill OLD-123/);
  assert.equal(f.events.length, 0);
  await f.run({ removedTracking: 'OLD-123' });
  assert.equal(f.sub.courier, 'bosta');
  assert.equal(f.sub.bosta_tracking_number, 'NEW-456');
  assert.equal(f.sub.courier_sector_id, null);
  assert.ok(!f.events.includes('delete'), 'must not invent an Arrive deletion API');
  assert.equal(f.sub.history[0].metadata.removed_manually, true);
});

test('invalid destination leaves the original courier untouched', async () => {
  const f = fixture({ sector: false });
  await assert.rejects(f.run(), /Choose the Arrive delivery area/);
  assert.equal(f.events.length, 0);
  assert.equal(f.sub.tracking_number, 'OLD-123');
});

test('an unsent parcel can switch before review without bypassing item confirmation', async () => {
  const f = fixture({ sent: false, status: 'pending_review' });
  const result = await f.run();
  assert.equal(f.sub.courier, 'arrive');
  assert.equal(f.sub.status, 'pending_review');
  assert.equal(result.dispatched, false);
  assert.ok(!f.events.includes('delete'));
  assert.ok(!f.events.includes('send'));
});

test('an unsent confirmed parcel switches and sends immediately', async () => {
  const f = fixture({ sent: false, status: 'awaiting_tracking' });
  const result = await f.run();
  assert.equal(result.dispatched, true);
  assert.ok(!f.events.includes('delete'));
});

test('same courier, pickup, handover, terminal and combined parcels are refused before side effects', async () => {
  const same = fixture();
  await assert.rejects(same.run({ target: 'bosta' }), /already uses/);
  assert.equal(same.events.length, 0);
  for (const change of [
    { pickup_booked_at: new Date() }, { handed_over_at: new Date() },
    { status: 'delivered' }, { status: 'cancelled' }, { status: 'in_transit' },
    { company_batch: { role: 'rider' } }, { company_batch: { role: 'lead' } },
  ]) {
    const f = fixture(); Object.assign(f.sub, change);
    await assert.rejects(f.run());
    assert.equal(f.events.length, 0);
  }
});

test('retry after a successful source delete accepts a 404 and creates only the replacement', async () => {
  const f = fixture({ terminateError: Object.assign(new Error('not found'), { statusCode: 404 }) });
  f.sub.courier_transfer = { phase: 'removing', to: 'arrive' };
  assert.equal((await f.run()).dispatched, true);
  assert.equal(f.events.filter((e) => e === 'send').length, 1);
});

test('a partial transfer cannot silently change its target', async () => {
  const f = fixture();
  f.sub.courier_transfer = { phase: 'removing', to: 'different' };
  await assert.rejects(f.run(), /Finish the pending/);
  assert.equal(f.events.length, 0);
});

test('a source cancellation webhook during transfer cannot cancel the customer parcel', () => {
  const { applyBostaStatusToOrder } = require('../services/bostaStatusMap');
  const order = { status: 'processing', sub_orders: [{ _id: 'parcel', status: 'awaiting_handover', courier_transfer: { phase: 'removing' } }] };
  const shipment = { sub_order_id: 'parcel', tracking_history: [] };
  const before = JSON.stringify({ order, shipment });
  assert.equal(applyBostaStatusToOrder(order, shipment, 'Cancelled').transferring, true);
  assert.equal(JSON.stringify({ order, shipment }), before);
});

test('retired Arrive events cannot add attention or change the replacement tracking', () => {
  const { applyArriveEvent } = require('../services/couriers/arrive/tracking');
  const order = { status: 'processing', sub_orders: [{ _id: 'parcel', status: 'awaiting_handover', history: [] }] };
  const shipment = { sub_order_id: 'parcel', superseded_at: new Date(), tracking_history: [] };
  const before = JSON.stringify({ order, shipment });
  const result = applyArriveEvent(order, shipment, { name_en: 'Cancelled' });
  assert.equal(result.applied, false);
  assert.ok(result.mapped, 'webhook callers always receive a mapped result');
  assert.equal(JSON.stringify({ order, shipment }), before);
});

test('the database lock excludes concurrent requests and is released on failure', async () => {
  let lock = null;
  let version = 3;
  const { withOperation } = load('../services/couriers/operation.js', {
    '../../models/orders': { Order: { updateOne: async (filter, update) => {
      if (filter.$or) {
        if (lock || filter.__v !== version) return { modifiedCount: 0 };
        lock = update.$set.courier_operation;
        version++;
        return { modifiedCount: 1 };
      }
      if (filter['courier_operation.token'] === lock?.token) lock = null;
      return { modifiedCount: 1 };
    } } },
  });
  let unblock;
  const pending = new Promise((resolve) => { unblock = resolve; });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const order = { _id: 'o', __v: 3 };
  const first = withOperation(order, async () => { entered(); await pending; throw new Error('API failed'); });
  await started;
  await assert.rejects(withOperation({ _id: 'o', __v: 3 }, async () => assert.fail('duplicate API call')), /Another courier operation/);
  unblock();
  await assert.rejects(first, /API failed/);
  assert.equal(lock, null);
  await assert.rejects(withOperation({ _id: 'o', __v: 2 }, async () => assert.fail('stale order')), /Another courier operation/);
  assert.equal(await withOperation(order, async () => 'retry'), 'retry');
});

function dispatchFixture(provider, { failCost = false } = {}) {
  const calls = [];
  let locked = false;
  const vendor = { store_name: 'Vendor', phone: '01012345678', locations: [{ address: 'Store street', shipping_city: 'Cairo' }] };
  const query = { select() { return this; }, lean: async () => vendor };
  const sub = { _id: 'parcel', vendor_id: 'vendor', courier: provider, courier_transfer_count: 2, courier_sector_id: 10, cod_amount: 120 };
  const shipments = [];
  shipments.push = function(row) { return Array.prototype.push.call(this, { _id: 'new-shipment', ...row }); };
  const order = { _id: 'order', shipments, sub_orders: [sub], shipping: { destination: { city: 'Cairo' } },
    shipping_address: { full_address: 'Maadi, Cairo', phone: '01012345678', recipient_name: 'Customer' },
    transaction: { payment_method: 'cash' },
    async save() { assert.ok(locked, 'waybill must be saved before unlocking dispatch'); calls.push('save'); },
  };
  const service = load('../services/bostaFulfillmentService.js', {
    '../models/orders': { Order: { updateOne: async () => ({ modifiedCount: 1 }) } },
    '../models/sellers': { Seller: { findById: () => query } },
    './couriers/operation': { withOperation: async (o, fn) => { locked = true; try { return await fn(); } finally { locked = false; } } },
    './subOrderService': {
      shippableItems: () => [{ _id: 'item', product_title: 'Part', quantity: 1 }],
      freezeAllocation: () => {}, appendSubHistory: () => {},
      liveShipmentFor: () => shipments[shipments.length - 1],
    },
    './bostaService': { createDelivery: async (payload) => { calls.push(payload); return { deliveryId: 'remote', trackingNumber: 'NEW' }; } },
    './courierCostService': { recordDispatchCost: async () => { if (failCost) throw new Error('Cost snapshot failed'); } },
    './bostaCostService': { snapshotCostForSubOrder: async () => {} },
    './couriers/arrive/adapter': { isConfigured: () => true, createShipment: async (payload) => { calls.push(payload); return { waybill: 'NEW', shipment_id: 'remote' }; } },
    './couriers/arrive/sectors': {
      getSector: async () => ({ sector_id: 10, name: 'Maadi', gov_name: 'Cairo' }),
      suggestSector: async () => ({ confidence: 'none' }),
    },
  });
  return { service, order, sub, calls };
}

for (const provider of ['bosta', 'arrive']) {
  test(`${provider}: dispatch saves tracking under the lock and uses a fresh reference after transfers`, async () => {
    const f = dispatchFixture(provider);
    await f.service.dispatchSubOrder(f.order, f.sub);
    assert.equal(f.sub.tracking_number, 'NEW');
    assert.equal(f.sub.shipment_id, 'new-shipment');
    const payload = f.calls.find((x) => typeof x === 'object');
    assert.equal(payload.businessReference || payload.orderReference, 'order-parcel-t2');
    assert.equal(f.calls.at(-1), 'save');
    await assert.rejects(f.service.dispatchSubOrder(f.order, f.sub), /already been sent/);
    assert.equal(f.calls.filter((x) => typeof x === 'object').length, 1);
  });

  test(`${provider}: bookkeeping failure after create keeps the live waybill and blocks duplicate sends`, async () => {
    const f = dispatchFixture(provider, { failCost: true });
    await assert.rejects(f.service.dispatchSubOrder(f.order, f.sub), /Cost snapshot failed/);
    assert.equal(f.sub.tracking_number, 'NEW');
    assert.equal(f.sub.shipment_id, 'new-shipment');
    assert.equal(f.calls.at(-1), 'save');
    await assert.rejects(f.service.dispatchSubOrder(f.order, f.sub), /already been sent/);
    assert.equal(f.calls.filter((x) => typeof x === 'object').length, 1);
  });
}
