'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '../LocaleLink';
import {
    Users, UserPlus, MapPin, Mail, Trash2, Send, Loader2, ShieldCheck,
    LogOut, Inbox, ChevronRight, AlertCircle, Home,
} from 'lucide-react';
import { familyApi } from '../../lib/api';
import { resolveAssetUrl } from '../../lib/assets';
import {
    RELATIONSHIPS,
    getRelationshipLabel,
    familyCopy,
} from '../../lib/familyLocalization';
import RequestStatusBadge from './RequestStatusBadge';
import Overlay from '../Overlay';

const formatDate = (value, isAr) => value
    ? new Date(value).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

/** Compact one-line description of an address for pickers and cards. */
const addressSummary = (address) => [
    address.label || address.recipient_name,
    [address.shipping_city, address.shipping_country].filter(Boolean).join(', '),
].filter(Boolean).join(' · ');

/**
 * Profile → Family.
 *
 * Renders the organizer view (approval queue first, then administration) or the
 * member view (organizer card, own requests, shared addresses), depending on
 * what the backend says the caller actually is. The client never decides the
 * role itself.
 */
export default function FamilyTab({ isAr, currency, onUnreadChange }) {
    const copy = useMemo(() => familyCopy(isAr), [isAr]);

    const [overview, setOverview] = useState(null);
    const [requests, setRequests] = useState({ incoming: [], outgoing: [] });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });

    const [showInvite, setShowInvite] = useState(false);
    // `identifier` rather than `email`: an invitation may now go to a mobile
    // number instead, which is the only one of the two that can reach someone
    // who has never had an account here.
    const [inviteForm, setInviteForm] = useState({ identifier: '', relationship: 'son', shared_address_ids: [] });
    const [editingMember, setEditingMember] = useState(null);
    const [editingAddressIds, setEditingAddressIds] = useState([]);

    const load = async () => {
        try {
            const [overviewData, requestData] = await Promise.all([
                familyApi.getOverview(),
                familyApi.getRequests().catch(() => ({ incoming: [], outgoing: [] })),
            ]);
            setOverview(overviewData);
            setRequests(requestData);
            onUnreadChange?.(
                (requestData.incoming || []).filter((r) => r.status === 'pending_approval').length
            );
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const run = async (action, successText) => {
        setBusy(true);
        setMessage({ type: '', text: '' });
        try {
            await action();
            if (successText) setMessage({ type: 'success', text: successText });
            await load();
            return true;
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
            return false;
        } finally {
            setBusy(false);
        }
    };

    const submitInvite = async (e) => {
        e.preventDefault();
        const ok = await run(
            () => familyApi.invite({ ...inviteForm, language: isAr ? 'ar' : 'en' }),
            copy.invitationSent
        );
        if (ok) {
            setShowInvite(false);
            setInviteForm({ identifier: '', relationship: 'son', shared_address_ids: [] });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 size={32} className="animate-spin text-marine-primary" />
            </div>
        );
    }

    const isOrganizer = overview?.role === 'organizer';
    const isMember = overview?.role === 'member';
    const pendingIncoming = (requests.incoming || []).filter((r) => r.status === 'pending_approval');
    const otherIncoming = (requests.incoming || []).filter((r) => r.status !== 'pending_approval');

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <h3 className="text-2xl font-black text-white flex items-center gap-3">
                    <Users className="text-marine-primary" /> {copy.family}
                </h3>
                {isOrganizer && (
                    <button
                        onClick={() => setShowInvite(true)}
                        className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg"
                    >
                        <UserPlus size={18} /> {copy.inviteMember}
                    </button>
                )}
            </div>

            {message.text && (
                <div className={`p-4 rounded-xl text-sm font-bold flex items-start gap-3 ${
                    message.type === 'success'
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}>
                    <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                    <span>{message.text}</span>
                </div>
            )}

            {/* ---------------- No family yet ---------------- */}
            {!overview?.role && (
                <div className="bg-white/5 rounded-3xl p-12 text-center border border-dashed border-white/10">
                    <Users size={48} className="text-zinc-600 mx-auto mb-4" />
                    <p className="text-zinc-300 font-bold max-w-md mx-auto leading-relaxed">{copy.emptyStateBody}</p>
                    <button
                        onClick={() => setShowInvite(true)}
                        className="mt-6 inline-flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-5 py-3 rounded-xl text-sm font-bold transition-all shadow-lg"
                    >
                        <UserPlus size={18} /> {copy.inviteMember}
                    </button>
                </div>
            )}

            {/* ================= ORGANIZER VIEW ================= */}
            {isOrganizer && (
                <>
                    {/* 1. Approval queue — time-sensitive, so it comes first. */}
                    <section className="space-y-4">
                        <h4 className="text-lg font-black text-white flex items-center gap-2">
                            <Inbox size={18} className="text-marine-primary" />
                            {copy.requestsNeedingAttention}
                            {pendingIncoming.length > 0 && (
                                <span className="bg-marine-cyan text-white text-[11px] font-black rounded-full px-2 py-0.5">
                                    {pendingIncoming.length}
                                </span>
                            )}
                        </h4>

                        {pendingIncoming.length === 0 ? (
                            <p className="text-zinc-500 text-sm bg-white/5 border border-white/10 rounded-2xl p-6">
                                {copy.noPendingRequests}
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {pendingIncoming.map((request) => (
                                    <RequestRow key={request._id} request={request} isAr={isAr} currency={currency} copy={copy} />
                                ))}
                            </div>
                        )}

                        {otherIncoming.length > 0 && (
                            <details className="group">
                                <summary className="cursor-pointer text-zinc-400 hover:text-white text-sm font-bold py-2">
                                    {isAr ? `الطلبات السابقة (${otherIncoming.length})` : `Past requests (${otherIncoming.length})`}
                                </summary>
                                <div className="space-y-3 mt-3">
                                    {otherIncoming.map((request) => (
                                        <RequestRow key={request._id} request={request} isAr={isAr} currency={currency} copy={copy} />
                                    ))}
                                </div>
                            </details>
                        )}
                    </section>

                    {/* 2. Members */}
                    <section className="space-y-4">
                        <h4 className="text-lg font-black text-white flex items-center gap-2">
                            <Users size={18} className="text-marine-primary" /> {copy.familyMembers}
                        </h4>

                        {overview.members.length === 0 ? (
                            <p className="text-zinc-500 text-sm bg-white/5 border border-white/10 rounded-2xl p-6">
                                {copy.emptyStateBody}
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {overview.members.map((member) => (
                                    <div key={member._id} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                        <div className="flex items-center gap-3 mb-3">
                                            <Avatar user={member.user} />
                                            <div className="min-w-0">
                                                <p className="text-white font-bold truncate">{member.user?.name}</p>
                                                <p className="text-zinc-500 text-xs truncate">{member.user?.email}</p>
                                            </div>
                                            <span className="ms-auto bg-white/10 text-zinc-300 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md flex-shrink-0">
                                                {getRelationshipLabel(member.relationship, isAr)}
                                            </span>
                                        </div>

                                        <p className="text-zinc-400 text-xs flex items-center gap-1.5 mb-4">
                                            <MapPin size={12} />
                                            {isAr
                                                ? `${member.shared_address_ids.length} عنوان مشترك`
                                                : `${member.shared_address_ids.length} shared address${member.shared_address_ids.length === 1 ? '' : 'es'}`}
                                        </p>

                                        <div className="flex items-center gap-4">
                                            <button
                                                onClick={() => { setEditingMember(member); setEditingAddressIds(member.shared_address_ids); }}
                                                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-bold transition-colors"
                                            >
                                                <MapPin size={13} /> {copy.manageSharedAddresses}
                                            </button>
                                            <button
                                                disabled={busy}
                                                onClick={() => {
                                                    if (!confirm(isAr
                                                        ? 'ستتم إزالة هذا الفرد وإلغاء طلباته غير المدفوعة. هل أنت متأكد؟'
                                                        : 'This member will be removed and any unpaid requests cancelled. Continue?')) return;
                                                    run(() => familyApi.removeMember(member._id));
                                                }}
                                                className="flex items-center gap-1.5 text-red-500 hover:text-red-400 text-xs font-bold transition-colors disabled:opacity-50"
                                            >
                                                <Trash2 size={13} /> {copy.removeMember}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* 3. Pending invitations */}
                    {overview.invitations.length > 0 && (
                        <section className="space-y-4">
                            <h4 className="text-lg font-black text-white flex items-center gap-2">
                                <Mail size={18} className="text-marine-primary" /> {copy.pendingInvitations}
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {overview.invitations.map((invitation) => (
                                    <div key={invitation._id} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                        <p className="text-white font-bold text-sm break-all">{invitation.email}</p>
                                        <p className="text-zinc-400 text-xs mt-1">
                                            {getRelationshipLabel(invitation.relationship, isAr)}
                                        </p>
                                        <div className="text-zinc-500 text-[11px] mt-3 space-y-0.5">
                                            <p>{copy.sentOn}: {formatDate(invitation.last_sent_at || invitation.created_at, isAr)}</p>
                                            <p>{copy.expiresOn}: {formatDate(invitation.expires_at, isAr)}</p>
                                        </div>
                                        <div className="flex items-center gap-4 mt-4">
                                            <button
                                                disabled={busy}
                                                onClick={() => run(
                                                    () => familyApi.resendInvitation(invitation._id, isAr ? 'ar' : 'en'),
                                                    copy.invitationSent
                                                )}
                                                className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-bold disabled:opacity-50"
                                            >
                                                <Send size={13} /> {copy.resend}
                                            </button>
                                            <button
                                                disabled={busy}
                                                onClick={() => run(() => familyApi.revokeInvitation(invitation._id))}
                                                className="flex items-center gap-1.5 text-red-500 hover:text-red-400 text-xs font-bold disabled:opacity-50"
                                            >
                                                <Trash2 size={13} /> {copy.cancelInvitation}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* 4. Shared-address permissions summary */}
                    <section className="space-y-4">
                        <h4 className="text-lg font-black text-white flex items-center gap-2">
                            <ShieldCheck size={18} className="text-marine-primary" /> {copy.sharedAddresses}
                        </h4>
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
                            {overview.addresses.length === 0 ? (
                                <p className="text-zinc-500 text-sm">
                                    {isAr
                                        ? 'أضف عنواناً من تبويب العناوين قبل مشاركته مع أفراد عائلتك.'
                                        : 'Add an address from the Addresses tab before you can share it with your family.'}
                                    {' '}
                                    <Link href="/profile?tab=addresses" className="text-marine-primary hover:underline font-bold">
                                        {isAr ? 'إدارة العناوين' : 'Manage addresses'}
                                    </Link>
                                </p>
                            ) : overview.addresses.map((address) => {
                                const sharedWith = overview.members.filter(
                                    (m) => m.shared_address_ids.includes(String(address._id))
                                );
                                return (
                                    <div key={address._id} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                                        <Home size={15} className="text-zinc-500 mt-1 flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-white text-sm font-bold truncate">{addressSummary(address)}</p>
                                            <p className="text-zinc-500 text-xs truncate">{address.full_address}</p>
                                        </div>
                                        <p className="text-[11px] text-zinc-400 flex-shrink-0">
                                            {sharedWith.length === 0
                                                ? (isAr ? 'غير مشترك' : 'Not shared')
                                                : sharedWith.map((m) => m.user?.name).join(', ')}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </>
            )}

            {/* ================= MEMBER VIEW ================= */}
            {isMember && (
                <>
                    <section className="bg-white/5 border border-white/10 rounded-2xl p-6">
                        <div className="flex items-center gap-4">
                            <Avatar user={overview.organizer} size="lg" />
                            <div className="min-w-0">
                                <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">{copy.organizer}</p>
                                <p className="text-white font-bold text-lg truncate">{overview.organizer?.name}</p>
                                <p className="text-zinc-400 text-xs mt-0.5">
                                    {getRelationshipLabel(overview.membership?.relationship, isAr)}
                                    {' · '}
                                    {isAr
                                        ? `${overview.shared_addresses.length} عنوان متاح لك`
                                        : `${overview.shared_addresses.length} address${overview.shared_addresses.length === 1 ? '' : 'es'} available to you`}
                                </p>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-4">
                        <h4 className="text-lg font-black text-white flex items-center gap-2">
                            <Inbox size={18} className="text-marine-primary" /> {copy.myFamilyRequests}
                        </h4>
                        {(requests.outgoing || []).length === 0 ? (
                            <div className="bg-white/5 rounded-2xl p-8 text-center border border-dashed border-white/10">
                                <p className="text-zinc-400 text-sm font-bold">
                                    {isAr
                                        ? 'لم ترسل أي طلبات بعد. اختر منتجاتك ثم اختر مسؤول العائلة عند الدفع.'
                                        : 'You have not sent any requests yet. Pick your products, then choose your organizer at checkout.'}
                                </p>
                                <Link href="/products" className="text-marine-primary mt-2 inline-block hover:underline font-bold text-sm">
                                    {copy.continueShopping}
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {requests.outgoing.map((request) => (
                                    <RequestRow key={request._id} request={request} isAr={isAr} currency={currency} copy={copy} />
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="space-y-4">
                        <h4 className="text-lg font-black text-white flex items-center gap-2">
                            <MapPin size={18} className="text-marine-primary" /> {copy.sharedAddresses}
                        </h4>
                        {overview.shared_addresses.length === 0 ? (
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5">
                                <p className="text-amber-300 text-sm font-bold">{copy.noSharedAddressesMember}</p>
                                <p className="text-amber-200/70 text-xs mt-2">
                                    {isAr
                                        ? `اطلب من ${overview.organizer?.name} مشاركة عنوان توصيل معك من تبويب العائلة في حسابه.`
                                        : `Ask ${overview.organizer?.name} to share a delivery address with you from their Family tab.`}
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {overview.shared_addresses.map((address) => (
                                    <div key={address._id} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                                        {address.label && (
                                            <span className="inline-block bg-white/10 text-zinc-300 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md mb-2">
                                                {address.label}
                                            </span>
                                        )}
                                        <p className="text-white font-bold text-sm">{address.recipient_name}</p>
                                        <p className="text-zinc-400 text-xs mt-1">{address.phone}</p>
                                        <p className="text-zinc-500 text-xs mt-1">{address.full_address}</p>
                                        {(address.shipping_city || address.shipping_country) && (
                                            <p className="text-zinc-500 text-[11px] mt-2">
                                                {[address.shipping_city, address.shipping_country].filter(Boolean).join(', ')}
                                            </p>
                                        )}
                                        {/* Read-only by design — no edit or delete affordance. */}
                                        <p className="text-zinc-600 text-[10px] mt-3 italic">
                                            {isAr ? 'للعرض فقط — يديره مسؤول العائلة' : 'View only — managed by your organizer'}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="pt-4 border-t border-white/5">
                        <button
                            disabled={busy}
                            onClick={() => {
                                if (!confirm(isAr
                                    ? 'ستفقد الوصول إلى العناوين المشتركة وسيتم إلغاء طلباتك غير المدفوعة. هل أنت متأكد؟'
                                    : 'You will lose access to the shared addresses and any unpaid requests will be cancelled. Continue?')) return;
                                run(() => familyApi.leaveFamily());
                            }}
                            className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm font-bold disabled:opacity-50"
                        >
                            <LogOut size={16} /> {copy.leaveFamily}
                        </button>
                    </section>
                </>
            )}

            {/* ---------------- Invite modal ---------------- */}
            {showInvite && (
                <Overlay className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
                    <div className="relative bg-[#09090b] border border-white/10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <h4 className="text-xl font-black text-white mb-6 flex items-center gap-2">
                            <UserPlus size={20} className="text-marine-primary" /> {copy.inviteMember}
                        </h4>

                        <form onSubmit={submitInvite} className="space-y-5">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{copy.emailOrPhone}</label>
                                <input
                                    type="text" required value={inviteForm.identifier}
                                    onChange={(e) => setInviteForm({ ...inviteForm, identifier: e.target.value })}
                                    className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                                    placeholder="01xxxxxxxxx"
                                />
                                {/* Says plainly that the person does not need an
                                    account. Without this the organizer has no way
                                    to know the number is worth trying, and would
                                    keep asking relatives for an email they may
                                    not have. */}
                                <p className="text-zinc-500 text-[11px]">{copy.inviteNoAccountHint}</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{copy.relationshipQuestion}</label>
                                <select
                                    value={inviteForm.relationship}
                                    onChange={(e) => setInviteForm({ ...inviteForm, relationship: e.target.value })}
                                    className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                                >
                                    {RELATIONSHIPS.map((value) => (
                                        <option key={value} value={value} className="text-zinc-900">
                                            {getRelationshipLabel(value, isAr)}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-zinc-600 text-[11px]">
                                    {isAr
                                        ? 'الصلة وصفية فقط ولا تمنح أي صلاحيات إضافية.'
                                        : 'Relationship is descriptive only — it does not change any permissions.'}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{copy.addressesToShare}</label>
                                <AddressPicker
                                    addresses={overview?.addresses || []}
                                    selectedIds={inviteForm.shared_address_ids}
                                    onChange={(ids) => setInviteForm({ ...inviteForm, shared_address_ids: ids })}
                                    isAr={isAr}
                                />
                            </div>

                            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                                <p className="text-white text-xs font-black uppercase tracking-widest">{copy.privacyTitle}</p>
                                <ul className="text-zinc-400 text-xs space-y-1.5 list-disc list-inside">
                                    <li>{copy.privacyCanView}</li>
                                    <li>{copy.privacyCannotEdit}</li>
                                    <li>{copy.privacyNoPayment}</li>
                                </ul>
                            </div>

                            <div className="flex gap-4 pt-2">
                                <button
                                    type="submit" disabled={busy}
                                    className="flex-1 bg-marine-cyan text-white py-3 rounded-xl font-bold hover:bg-marine-cyan-dark transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {busy && <Loader2 size={16} className="animate-spin" />}
                                    {copy.sendInvitation}
                                </button>
                                <button
                                    type="button" onClick={() => setShowInvite(false)}
                                    className="flex-1 bg-white/5 text-zinc-400 py-3 rounded-xl font-bold hover:bg-white/10 transition-all"
                                >
                                    {copy.cancel}
                                </button>
                            </div>
                        </form>
                    </div>
                </Overlay>
            )}

            {/* ---------------- Shared-address editor ---------------- */}
            {editingMember && (
                <Overlay className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setEditingMember(null)} />
                    <div className="relative bg-[#09090b] border border-white/10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <h4 className="text-xl font-black text-white mb-2">{copy.manageSharedAddresses}</h4>
                        <p className="text-zinc-400 text-sm mb-6">{editingMember.user?.name}</p>

                        <AddressPicker
                            addresses={overview?.addresses || []}
                            selectedIds={editingAddressIds}
                            onChange={setEditingAddressIds}
                            isAr={isAr}
                        />

                        <div className="flex gap-4 pt-6">
                            <button
                                disabled={busy}
                                onClick={async () => {
                                    const ok = await run(
                                        () => familyApi.updateMemberAddresses(editingMember._id, editingAddressIds)
                                    );
                                    if (ok) setEditingMember(null);
                                }}
                                className="flex-1 bg-marine-cyan text-white py-3 rounded-xl font-bold hover:bg-marine-cyan-dark transition-all disabled:opacity-50"
                            >
                                {copy.save}
                            </button>
                            <button
                                onClick={() => setEditingMember(null)}
                                className="flex-1 bg-white/5 text-zinc-400 py-3 rounded-xl font-bold hover:bg-white/10 transition-all"
                            >
                                {copy.cancel}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}

function Avatar({ user, size = 'md' }) {
    const dimension = size === 'lg' ? 'w-14 h-14 text-xl' : 'w-10 h-10 text-sm';
    return (
        <div className={`${dimension} rounded-full bg-marine-cyan flex items-center justify-center text-white font-black overflow-hidden flex-shrink-0`}>
            {user?.profile_image
                ? <img src={resolveAssetUrl(user.profile_image)} alt={user?.name || ''} className="w-full h-full object-cover" />
                : (user?.name?.[0]?.toUpperCase() || '?')}
        </div>
    );
}

/** Multi-select over the organizer's own addresses. */
function AddressPicker({ addresses, selectedIds, onChange, isAr }) {
    if (addresses.length === 0) {
        return (
            <p className="text-zinc-500 text-sm bg-white/5 border border-white/10 rounded-xl p-4">
                {isAr
                    ? 'لا توجد عناوين محفوظة بعد. أضف عنواناً من تبويب العناوين أولاً.'
                    : 'No saved addresses yet. Add one from the Addresses tab first.'}
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
                            checked ? 'border-marine-cyan bg-marine-cyan/10' : 'border-white/10 bg-white/5 hover:border-white/20'
                        }`}
                    >
                        <input
                            type="checkbox" checked={checked} onChange={() => toggle(address._id)}
                            className="mt-1 w-4 h-4 rounded border-white/20 bg-white/5 accent-marine-cyan"
                        />
                        <div className="min-w-0">
                            <p className="text-white text-sm font-bold truncate">{addressSummary(address)}</p>
                            <p className="text-zinc-500 text-xs truncate">{address.full_address}</p>
                        </div>
                    </label>
                );
            })}
        </div>
    );
}

/** One request line, used in both the organizer queue and the member history. */
function RequestRow({ request, isAr, currency, copy }) {
    const counterparty = request.viewer_role === 'organizer' ? request.requester : request.organizer;

    return (
        <Link
            href={`/family/requests/${request._id}`}
            className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/[0.08] hover:border-marine-cyan/30 transition-all"
        >
            <Avatar user={counterparty} />
            <div className="min-w-0 flex-1">
                <p className="text-white font-bold text-sm truncate">
                    {request.viewer_role === 'organizer'
                        ? `${copy.requestedBy} ${counterparty?.name || ''}`
                        : `${copy.orderRequest} · ${counterparty?.name || ''}`}
                </p>
                <p className="text-zinc-500 text-xs mt-0.5">
                    {request.items.length} {isAr ? 'منتج' : `item${request.items.length === 1 ? '' : 's'}`}
                    {' · '}
                    {formatDate(request.created_at, isAr)}
                </p>
            </div>
            <div className="text-end flex-shrink-0 space-y-1.5">
                <p className="text-marine-primary font-black text-sm">
                    {currency} {Number(request.estimated_total || 0).toFixed(2)}
                </p>
                <RequestStatusBadge status={request.status} isAr={isAr} />
            </div>
            <ChevronRight size={16} className="text-zinc-600 flex-shrink-0 rtl:rotate-180" />
        </Link>
    );
}
