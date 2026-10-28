'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '../LocaleLink';
import {
    UserPlus, Users, MapPin, Loader2, AlertCircle, Check, X, Trash2, ShieldOff,
    Gift, Package, Truck, Mail, Clock, ArrowRight, ShieldCheck,
} from 'lucide-react';
import Overlay from '../Overlay';
import { friendsApi } from '../../lib/api';
import { resolveAssetUrl } from '../../lib/assets';
import { friendCopy, friendErrorCopy } from '../../lib/friendLocalization';
import { getOrderStatusLabel, getOrderStatusColor, getShipmentStatusLabel } from '../../lib/orderStatus';

const formatDate = (value, isAr) => value
    ? new Date(value).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

/**
 * Profile → Friends.
 *
 * Section order follows the spec: incoming requests first (they are the only
 * time-sensitive item), then friends, then the caller's own pending
 * invitations, then the invite form, then read-only "Orders for me".
 */
export default function FriendsTab({ isAr, currency, onUnreadChange }) {
    const copy = useMemo(() => friendCopy(isAr), [isAr]);

    const [overview, setOverview] = useState(null);
    const [ordersForMe, setOrdersForMe] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });

    const [showInvite, setShowInvite] = useState(false);
    const [inviteForm, setInviteForm] = useState({ identifier: '', shared_address_ids: [] });
    // Accepting requires picking addresses to share back, so it opens a dialog.
    const [acceptingRequest, setAcceptingRequest] = useState(null);
    const [acceptAddressIds, setAcceptAddressIds] = useState([]);
    const [editingFriend, setEditingFriend] = useState(null);
    const [editingAddressIds, setEditingAddressIds] = useState([]);

    const load = async () => {
        try {
            const [overviewData, ordersData] = await Promise.all([
                friendsApi.getOverview(),
                friendsApi.getOrdersForMe().catch(() => ({ orders: [] })),
            ]);
            setOverview(overviewData);
            setOrdersForMe(ordersData.orders || []);
            onUnreadChange?.((overviewData.incoming_requests || []).length);
        } catch (err) {
            setMessage({ type: 'error', text: friendErrorCopy(err.code, isAr) || err.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Run a mutation, surfacing a code-mapped message and refreshing. */
    const run = async (action, successText, context = {}) => {
        setBusy(true);
        setMessage({ type: '', text: '' });
        try {
            const result = await action();
            if (successText) setMessage({ type: 'success', text: successText });
            await load();
            return result ?? true;
        } catch (err) {
            setMessage({ type: 'error', text: friendErrorCopy(err.code, isAr, context) || err.message });
            return null;
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 size={32} className="animate-spin text-marine-primary" />
            </div>
        );
    }

    const myAddresses = overview?.my_addresses || [];
    const hasOwnAddress = !!overview?.has_own_address;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <h3 className="text-2xl font-black text-zinc-900 flex items-center gap-3">
                    <Users className="text-marine-primary" /> {copy.friends}
                </h3>
                <button
                    onClick={() => { setShowInvite(true); setInviteForm({ identifier: '', shared_address_ids: [] }); }}
                    disabled={!hasOwnAddress}
                    className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg"
                >
                    <UserPlus size={18} /> {copy.inviteFriend}
                </button>
            </div>

            {message.text && (
                <div className={`p-4 rounded-xl text-sm font-bold flex items-start gap-3 ${
                    message.type === 'success'
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-600'
                        : 'bg-red-500/10 border border-red-500/20 text-red-600'
                }`}>
                    <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                    <span>{message.text}</span>
                </div>
            )}

            {/* Both sides need a saved address before any of this works. */}
            {!hasOwnAddress && (
                <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
                    <p className="text-amber-800 text-sm font-bold">{copy.needAddressFirst}</p>
                    <Link href="/profile?tab=addresses" className="inline-flex items-center gap-1.5 text-marine-primary hover:underline text-sm font-bold mt-3">
                        {isAr ? 'إضافة عنوان' : 'Add an address'} <ArrowRight size={14} className="rtl:rotate-180" />
                    </Link>
                </div>
            )}

            {/* 1. Incoming requests — time-sensitive, so first. */}
            <section className="space-y-4">
                <h4 className="text-lg font-black text-zinc-900 flex items-center gap-2">
                    <Mail size={18} className="text-marine-primary" />
                    {copy.incomingRequests}
                    {overview.incoming_requests.length > 0 && (
                        <span className="bg-marine-cyan text-white text-[11px] font-black rounded-full px-2 py-0.5">
                            {overview.incoming_requests.length}
                        </span>
                    )}
                </h4>

                {overview.incoming_requests.length === 0 ? (
                    <p className="text-zinc-500 text-sm bg-zinc-50/70 border border-zinc-200/80 rounded-2xl p-6">
                        {copy.noIncoming}
                    </p>
                ) : (
                    <div className="space-y-3">
                        {overview.incoming_requests.map((request) => (
                            <div key={request._id} className="flex items-center gap-4 bg-zinc-50/70 border border-zinc-200/80 rounded-2xl p-4 flex-wrap hover:bg-zinc-50 transition-colors">
                                <Avatar user={request.sender} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-zinc-900 font-bold text-sm truncate">{request.sender?.name}</p>
                                    <p className="text-zinc-500 text-xs mt-0.5 flex items-center gap-1.5">
                                        <Clock size={11} /> {isAr ? 'تنتهي في' : 'Expires'} {formatDate(request.expires_at, isAr)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 ms-auto">
                                    <button
                                        disabled={busy || !hasOwnAddress}
                                        onClick={() => {
                                            setAcceptingRequest(request);
                                            const preferred = myAddresses.find((a) => a.is_default) || myAddresses[0];
                                            setAcceptAddressIds(preferred ? [String(preferred._id)] : []);
                                        }}
                                        className="flex items-center gap-1.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                    >
                                        <Check size={14} /> {copy.accept}
                                    </button>
                                    <button
                                        disabled={busy}
                                        onClick={() => run(() => friendsApi.declineInvitation(request._id))}
                                        className="flex items-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                                    >
                                        <X size={14} /> {copy.decline}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* 2. Friends */}
            <section className="space-y-4">
                <h4 className="text-lg font-black text-zinc-900 flex items-center gap-2">
                    <Users size={18} className="text-marine-primary" /> {copy.myFriends}
                </h4>

                {overview.friends.length === 0 ? (
                    <div className="bg-zinc-50/70 rounded-2xl p-8 text-center border border-dashed border-zinc-200">
                        <Users size={40} className="text-zinc-400 mx-auto mb-3" />
                        <p className="text-zinc-600 text-sm font-bold max-w-md mx-auto leading-relaxed">{copy.emptyFriends}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {overview.friends.map((entry) => (
                            <div key={entry.friendship_id} className="bg-zinc-50/70 border border-zinc-200/80 rounded-2xl p-5 hover:bg-zinc-50 transition-colors">
                                <div className="flex items-center gap-3 mb-4">
                                    <Avatar user={entry.friend} />
                                    <div className="min-w-0">
                                        <p className="text-zinc-900 font-bold truncate">{entry.friend?.name}</p>
                                        <p className="text-zinc-500 text-[11px]">
                                            {isAr ? 'منذ' : 'Since'} {formatDate(entry.since, isAr)}
                                        </p>
                                    </div>
                                </div>

                                {/* Both directions, stated plainly — sharing is not symmetric. */}
                                <div className="space-y-1.5 mb-4 text-xs">
                                    <p className="text-zinc-600 flex items-center gap-1.5">
                                        <MapPin size={12} className={entry.can_buy_for_them ? 'text-emerald-600' : 'text-zinc-400'} />
                                        {entry.friend?.name} {copy.sharedWithYou}: {copy.addressCount(entry.addresses_shared_with_me.length)}
                                    </p>
                                    <p className="text-zinc-600 flex items-center gap-1.5">
                                        <MapPin size={12} className={entry.my_shared_address_ids.length > 0 ? 'text-emerald-600' : 'text-zinc-400'} />
                                        {copy.youShare}: {copy.addressCount(entry.my_shared_address_ids.length)}
                                    </p>
                                    {entry.addresses_shared_with_me.length > 0 && (
                                        // Label + city only in the list; full detail lives in checkout.
                                        <p className="text-zinc-500 text-[11px] ps-[18px]">
                                            {entry.addresses_shared_with_me
                                                .map((a) => [a.label, a.shipping_city].filter(Boolean).join(' · '))
                                                .filter(Boolean)
                                                .join(' • ')}
                                        </p>
                                    )}
                                </div>

                                {entry.can_buy_for_them ? (
                                    <Link
                                        href={`/checkout?for=${entry.friend?._id}`}
                                        className="flex items-center justify-center gap-2 w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white py-2.5 rounded-xl text-sm font-bold transition-all mb-3 shadow-sm"
                                    >
                                        <Gift size={15} /> {copy.buyForThisFriend}
                                    </Link>
                                ) : (
                                    <p className="text-amber-800 text-[11px] bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 mb-3">
                                        {entry.friend?.name} {copy.cannotBuyForThem}
                                    </p>
                                )}

                                <div className="flex items-center gap-4 flex-wrap">
                                    <button
                                        onClick={() => {
                                            setEditingFriend(entry);
                                            setEditingAddressIds(entry.my_shared_address_ids.map(String));
                                        }}
                                        className="flex items-center gap-1.5 text-marine-primary hover:text-marine-cyan text-xs font-bold transition-colors"
                                    >
                                        <MapPin size={13} /> {copy.manageMySharedAddresses}
                                    </button>
                                    <button
                                        disabled={busy}
                                        onClick={() => {
                                            if (!confirm(isAr
                                                ? 'ستتوقف مشاركة العناوين في الاتجاهين. هل أنت متأكد؟'
                                                : 'Address sharing will stop in both directions. Continue?')) return;
                                            run(() => friendsApi.removeFriend(entry.friend._id));
                                        }}
                                        className="flex items-center gap-1.5 text-red-500 hover:text-red-400 text-xs font-bold transition-colors disabled:opacity-50"
                                    >
                                        <Trash2 size={13} /> {copy.removeFriend}
                                    </button>
                                    <button
                                        disabled={busy}
                                        onClick={() => {
                                            if (!confirm(isAr
                                                ? 'لن يتمكن هذا الشخص من إرسال طلب صداقة إليك مرة أخرى. هل أنت متأكد؟'
                                                : 'This person will not be able to send you a friend request again. Continue?')) return;
                                            run(() => friendsApi.blockFriend(entry.friend._id));
                                        }}
                                        className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-700 text-xs font-bold transition-colors disabled:opacity-50"
                                    >
                                        <ShieldOff size={13} /> {copy.block}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* 3. Outgoing invitations */}
            {overview.outgoing_invitations.length > 0 && (
                <section className="space-y-4">
                    <h4 className="text-lg font-black text-zinc-900 flex items-center gap-2">
                        <Clock size={18} className="text-marine-primary" /> {copy.pendingInvitations}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {overview.outgoing_invitations.map((invitation) => (
                            <div key={invitation._id} className="bg-zinc-50/70 border border-zinc-200/80 rounded-2xl p-5">
                                {/* Masked — we never store or echo the full identifier back. */}
                                <p className="text-zinc-900 font-bold text-sm break-all">{invitation.identifier_masked}</p>
                                <p className="text-zinc-500 text-[11px] mt-2">
                                    {isAr ? 'تنتهي في' : 'Expires'} {formatDate(invitation.expires_at, isAr)}
                                </p>
                                <button
                                    disabled={busy}
                                    onClick={() => run(() => friendsApi.cancelInvitation(invitation._id))}
                                    className="flex items-center gap-1.5 text-red-500 hover:text-red-400 text-xs font-bold mt-4 disabled:opacity-50"
                                >
                                    <Trash2 size={13} /> {copy.cancel}
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* 4. Orders bought for me — read-only. */}
            <section className="space-y-4">
                <h4 className="text-lg font-black text-zinc-900 flex items-center gap-2">
                    <Gift size={18} className="text-marine-primary" /> {copy.ordersForMe}
                </h4>

                {ordersForMe.length === 0 ? (
                    <p className="text-zinc-500 text-sm bg-zinc-50/70 border border-zinc-200/80 rounded-2xl p-6">
                        {copy.noOrdersForMe}
                    </p>
                ) : (
                    <div className="space-y-4">
                        {ordersForMe.map((order) => (
                            <div key={order._id} className="bg-zinc-50/70 border border-zinc-200/80 rounded-2xl overflow-hidden">
                                <div className="p-5 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200/80 bg-zinc-100/60">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Avatar user={order.paid_by} size="sm" />
                                        <div className="min-w-0">
                                            <p className="text-zinc-900 font-bold text-sm truncate">
                                                {copy.paidBy(order.paid_by?.name || '')}
                                            </p>
                                            <p className="text-zinc-500 text-[11px]">
                                                #{order.reference} · {formatDate(order.created_at, isAr)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 ms-auto">
                                        {/* A plain label — never a payment reference or amount. */}
                                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                                            {copy.paidOnline}
                                        </span>
                                        <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.1em] ${getOrderStatusColor(order.status)}`}>
                                            {getOrderStatusLabel(order.status, isAr)}
                                        </span>
                                    </div>
                                </div>

                                <div className="p-5 space-y-3">
                                    {order.items.map((item, index) => (
                                        <div key={index} className="flex items-center gap-3">
                                            <div className="w-12 h-12 bg-zinc-100 rounded-lg overflow-hidden flex-shrink-0 border border-zinc-200">
                                                {item.product_image && <img src={item.product_image} alt={item.product_title} className="w-full h-full object-cover" />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-zinc-900 text-sm font-bold truncate">{item.product_title}</p>
                                                <p className="text-zinc-500 text-xs">
                                                    {item.variant_label ? `${item.variant_label} · ` : ''}× {item.quantity}
                                                </p>
                                            </div>
                                            {/* No prices: the recipient is not the paying customer. */}
                                        </div>
                                    ))}

                                    <p className="text-zinc-600 text-xs flex items-center gap-1.5 pt-2">
                                        <MapPin size={12} className="text-marine-primary" />
                                        {copy.deliveringTo}: {order.delivery_summary.recipient_name}
                                        {order.delivery_summary.city ? ` · ${order.delivery_summary.city}` : ''}
                                    </p>

                                    {order.shipments?.length > 0 && (
                                        <div className="pt-3 border-t border-zinc-200/60 space-y-2">
                                            {order.shipments.map((shipment, index) => (
                                                <div key={index} className="flex items-center justify-between gap-3 bg-white border border-zinc-200 rounded-xl p-2.5">
                                                    <p className="text-xs font-mono text-zinc-900 flex items-center gap-2">
                                                        <Truck size={12} className="text-marine-primary" />
                                                        {shipment.tracking_number || shipment.bosta_tracking_number || '—'}
                                                    </p>
                                                    <p className="text-[11px] text-zinc-500">
                                                        {getShipmentStatusLabel(shipment.bosta_status, isAr)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <p className="text-zinc-400 text-[11px] italic pt-1">{copy.trackOnly}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* ---------------- Invite dialog ---------------- */}
            {showInvite && (
                <Dialog onClose={() => setShowInvite(false)}>
                    <h4 className="text-xl font-black text-zinc-900 mb-6 flex items-center gap-2">
                        <UserPlus size={20} className="text-marine-primary" /> {copy.inviteFriend}
                    </h4>

                    <form
                        onSubmit={async (e) => {
                            e.preventDefault();
                            // The confirmation comes from the SERVER, not from
                            // here. It used to be hardcoded to the conditional
                            // wording, which meant an invitation that had really
                            // been sent still read as though nothing had happened.
                            const result = await run(
                                () => friendsApi.invite({ ...inviteForm, language: isAr ? 'ar' : 'en' })
                            );
                            if (result) {
                                setMessage({
                                    type: 'success',
                                    text: result.code === 'INVITE_SENT'
                                        ? copy.inviteSentToNumber
                                        : copy.genericInviteSent,
                                });
                                setShowInvite(false);
                            }
                        }}
                        className="space-y-5"
                    >
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-widest">{copy.emailOrPhone}</label>
                            <input
                                type="text" required value={inviteForm.identifier}
                                onChange={(e) => setInviteForm({ ...inviteForm, identifier: e.target.value })}
                                placeholder={isAr ? 'name@example.com أو 01xxxxxxxxx' : 'name@example.com or 01xxxxxxxxx'}
                                className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan focus:bg-white"
                            />
                            <p className="text-zinc-500 text-[11px]">{copy.inviteNoAccountHint}</p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-700 uppercase tracking-widest">{copy.addressesToShare}</label>
                            <p className="text-zinc-500 text-[11px]">{copy.invitePickAddresses}</p>
                            <AddressPicker
                                addresses={myAddresses}
                                selectedIds={inviteForm.shared_address_ids}
                                onChange={(ids) => setInviteForm({ ...inviteForm, shared_address_ids: ids })}
                                isAr={isAr}
                            />
                        </div>

                        <PrivacyNote copy={copy} />

                        <div className="flex gap-4 pt-2">
                            <button
                                type="submit" disabled={busy || inviteForm.shared_address_ids.length === 0}
                                className="flex-1 bg-marine-cyan text-white py-3 rounded-xl font-bold hover:bg-marine-cyan-dark transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {busy && <Loader2 size={16} className="animate-spin" />}
                                {copy.send}
                            </button>
                            <button
                                type="button" onClick={() => setShowInvite(false)}
                                className="flex-1 bg-zinc-100 text-zinc-700 py-3 rounded-xl font-bold hover:bg-zinc-200 transition-all"
                            >
                                {copy.cancel}
                            </button>
                        </div>
                    </form>
                </Dialog>
            )}

            {/* ---------------- Accept dialog ---------------- */}
            {acceptingRequest && (
                <Dialog onClose={() => setAcceptingRequest(null)}>
                    <h4 className="text-xl font-black text-zinc-900 mb-2">{copy.accept}</h4>
                    <p className="text-zinc-500 text-sm mb-6">{acceptingRequest.sender?.name}</p>

                    <p className="text-zinc-600 text-xs mb-3">{copy.acceptPickAddresses}</p>
                    <AddressPicker
                        addresses={myAddresses}
                        selectedIds={acceptAddressIds}
                        onChange={setAcceptAddressIds}
                        isAr={isAr}
                    />

                    <div className="mt-5">
                        <PrivacyNote copy={copy} />
                    </div>

                    <div className="flex gap-4 pt-6">
                        <button
                            disabled={busy || acceptAddressIds.length === 0}
                            onClick={async () => {
                                const result = await run(
                                    () => friendsApi.acceptInvitation(acceptingRequest._id, acceptAddressIds),
                                    isAr ? 'أصبحتما صديقين الآن.' : 'You are now friends.'
                                );
                                if (result) setAcceptingRequest(null);
                            }}
                            className="flex-1 bg-marine-cyan text-white py-3 rounded-xl font-bold hover:bg-marine-cyan-dark transition-all disabled:opacity-50"
                        >
                            {copy.accept}
                        </button>
                        <button
                            onClick={() => setAcceptingRequest(null)}
                            className="flex-1 bg-zinc-100 text-zinc-700 py-3 rounded-xl font-bold hover:bg-zinc-200 transition-all"
                        >
                            {copy.cancel}
                        </button>
                    </div>
                </Dialog>
            )}

            {/* ---------------- Shared-address editor ---------------- */}
            {editingFriend && (
                <Dialog onClose={() => setEditingFriend(null)}>
                    <h4 className="text-xl font-black text-zinc-900 mb-2">{copy.manageMySharedAddresses}</h4>
                    <p className="text-zinc-500 text-sm mb-1">{editingFriend.friend?.name}</p>
                    <p className="text-zinc-500 text-[11px] mb-5">{copy.sharingIsDirectional}</p>

                    <AddressPicker
                        addresses={myAddresses}
                        selectedIds={editingAddressIds}
                        onChange={setEditingAddressIds}
                        isAr={isAr}
                    />

                    {editingAddressIds.length === 0 && (
                        <p className="text-amber-800 text-xs mt-4 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                            {isAr
                                ? 'بدون عناوين مشتركة، تظل الصداقة قائمة لكن لن يتمكن صديقك من الشراء لك.'
                                : 'With no shared addresses the friendship stays active, but your friend cannot buy for you.'}
                        </p>
                    )}

                    <div className="flex gap-4 pt-6">
                        <button
                            disabled={busy}
                            onClick={async () => {
                                const result = await run(
                                    () => friendsApi.updateMySharedAddresses(editingFriend.friend._id, editingAddressIds)
                                );
                                if (result) setEditingFriend(null);
                            }}
                            className="flex-1 bg-marine-cyan text-white py-3 rounded-xl font-bold hover:bg-marine-cyan-dark transition-all disabled:opacity-50"
                        >
                            {copy.save}
                        </button>
                        <button
                            onClick={() => setEditingFriend(null)}
                            className="flex-1 bg-zinc-100 text-zinc-700 py-3 rounded-xl font-bold hover:bg-zinc-200 transition-all"
                        >
                            {copy.cancel}
                        </button>
                    </div>
                </Dialog>
            )}
        </div>
    );
}

function Dialog({ children, onClose }) {
    return (
        <Overlay className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white border border-zinc-200 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
                {children}
            </div>
        </Overlay>
    );
}

function Avatar({ user, size = 'md' }) {
    const dimension = size === 'sm' ? 'w-9 h-9 text-xs' : 'w-11 h-11 text-sm';
    return (
        <div className={`${dimension} rounded-full bg-marine-cyan flex items-center justify-center text-white font-black overflow-hidden flex-shrink-0`}>
            {user?.profile_image
                ? <img src={resolveAssetUrl(user.profile_image)} alt={user?.name || ''} className="w-full h-full object-cover" />
                : (user?.name?.[0]?.toUpperCase() || '?')}
        </div>
    );
}

function PrivacyNote({ copy }) {
    return (
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-2">
            <p className="text-zinc-900 text-xs font-black uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck size={14} className="text-emerald-600" />
                {copy.sharedAddresses}
            </p>
            <ul className="text-zinc-600 text-xs space-y-1.5 list-disc list-inside">
                <li>{copy.theyCanOnlySelect}</li>
                <li>{copy.theyCannotEdit}</li>
                <li>{copy.noPaymentShared}</li>
            </ul>
        </div>
    );
}

/** Multi-select over the caller's OWN saved addresses. */
function AddressPicker({ addresses, selectedIds, onChange, isAr }) {
    if (addresses.length === 0) {
        return (
            <p className="text-zinc-500 text-sm bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                {isAr
                    ? 'لا توجد عناوين محفوظة. أضف عنواناً من تبويب العناوين أولاً.'
                    : 'No saved addresses. Add one from the Addresses tab first.'}
            </p>
        );
    }

    const toggle = (id) => {
        const key = String(id);
        onChange(selectedIds.includes(key)
            ? selectedIds.filter((value) => value !== key)
            : [...selectedIds, key]);
    };

    return (
        <div className="space-y-2">
            {addresses.map((address) => {
                const checked = selectedIds.includes(String(address._id));
                return (
                    <label
                        key={address._id}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                            checked ? 'border-marine-cyan bg-marine-cyan/10' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'
                        }`}
                    >
                        <input
                            type="checkbox" checked={checked} onChange={() => toggle(address._id)}
                            className="mt-1 w-4 h-4 rounded border-zinc-300 bg-white accent-marine-cyan"
                        />
                        <div className="min-w-0">
                            <p className="text-zinc-900 text-sm font-bold truncate">
                                {[address.label, address.recipient_name].filter(Boolean).join(' · ')}
                            </p>
                            <p className="text-zinc-500 text-xs truncate">{address.full_address}</p>
                        </div>
                    </label>
                );
            })}
        </div>
    );
}
