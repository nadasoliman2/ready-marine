'use client';

/**
 * Admin accounts — create staff logins and choose what each may open.
 *
 * Super admin only. The server enforces that (`SUPER_ADMIN_ONLY_PREFIXES` in
 * services/adminAccessService.js refuses `/admin-users` to every sub-admin), so the guard
 * below is about not showing a broken page, not about keeping anyone out.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Loader2, Plus, Trash2, ShieldCheck, ShieldOff, Eye, Pencil,
    X, KeyRound, Check, AlertTriangle,
} from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import { useAdminAccess } from '../../../../context/AdminAccessContext';
import Overlay from '../../../../components/Overlay';

const inputCls =
    'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-marine-cyan';

/** view → manage → none → view. One click cycles a module through its three states. */
const NEXT_ACCESS = { none: 'view', view: 'manage', manage: 'none' };

const ACCESS_META = {
    none: {
        label_en: 'No access', label_ar: 'ممنوع',
        cls: 'bg-zinc-100 dark:bg-white/5 text-zinc-400 border-zinc-200 dark:border-white/10',
    },
    view: {
        label_en: 'View only', label_ar: 'قراءة فقط',
        cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
    },
    manage: {
        label_en: 'Full access', label_ar: 'تحكم كامل',
        cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    },
};

export default function AdminUsersPage() {
    const { language } = useApp();
    const { isSuper, loading: accessLoading } = useAdminAccess();
    const isAr = language === 'ar';

    const [accounts, setAccounts] = useState([]);
    const [modules, setModules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState('');
    const [editing, setEditing] = useState(null); // null | {} for new | account for edit

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [list, mods] = await Promise.all([adminApi.getAdminUsers(), adminApi.getAdminModules()]);
            setAccounts(list.accounts || []);
            setModules(mods.modules || []);
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to load admin accounts');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (isSuper) load(); else setLoading(false); }, [isSuper, load]);

    if (accessLoading) {
        return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-marine-primary" size={28} /></div>;
    }

    if (!isSuper) {
        return (
            <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-6 flex items-start gap-3">
                <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
                <div>
                    <p className="text-sm font-black text-red-500">
                        {isAr ? 'الصفحة دي للحساب الرئيسي بس' : 'This page is for the main admin account only'}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                        {isAr
                            ? 'إدارة حسابات الإدارة مش صلاحية بتتوزّع — الحساب الرئيسي بس هو اللي بيعملها.'
                            : 'Managing admin accounts is not a permission that can be granted — only the main account can do it.'}
                    </p>
                </div>
            </div>
        );
    }

    const run = async (key, fn, msg) => {
        setBusy(key); setError(''); setNotice('');
        try {
            await fn();
            await load();
            if (msg) setNotice(msg);
            return true;
        } catch (err) {
            setError(err.message || 'Something went wrong');
            return false;
        } finally {
            setBusy('');
        }
    };

    const toggleActive = (account) =>
        run(
            `active:${account._id}`,
            () => adminApi.updateAdminUser(account._id, { is_active: !account.is_active }),
            account.is_active
                ? (isAr ? 'تم إيقاف الحساب — خرج من الداشبورد فوراً.' : 'Account disabled — signed out immediately.')
                : (isAr ? 'تم تفعيل الحساب.' : 'Account enabled.')
        );

    const remove = (account) => {
        const ok = window.confirm(
            isAr
                ? `تحذف حساب "${account.username}" نهائياً؟ لو عايز توقفه مؤقتاً استخدم زرار الإيقاف بدل الحذف.`
                : `Delete "${account.username}" permanently? Use disable instead if you may need it back.`
        );
        if (!ok) return;
        run(`del:${account._id}`, () => adminApi.deleteAdminUser(account._id),
            isAr ? 'تم حذف الحساب.' : 'Account deleted.');
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-zinc-900 dark:text-white">
                        {isAr ? 'حسابات الإدارة' : 'Admin accounts'}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
                        {isAr
                            ? 'اعمل حسابات للفريق وحدّد كل واحد يفتح إيه. الحساب الرئيسي بتاعك مش بيظهر هنا وميتحذفش — هو خط الرجوع لو حصل أي حاجة.'
                            : 'Create staff logins and choose what each one may open. Your main account is not listed here and cannot be deleted — it is the way back in if anything goes wrong.'}
                    </p>
                </div>
                <button
                    onClick={() => setEditing({})}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-black hover:bg-[#B91C1C] transition"
                >
                    <Plus size={16} />
                    {isAr ? 'حساب جديد' : 'New account'}
                </button>
            </div>

            {error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm font-bold text-red-500">{error}</div>
            )}
            {notice && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm font-bold text-emerald-600">{notice}</div>
            )}

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-marine-primary" size={28} /></div>
            ) : accounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-white/10 py-16 text-center">
                    <ShieldCheck className="mx-auto text-zinc-300 dark:text-zinc-600" size={36} />
                    <p className="mt-3 text-sm font-bold text-zinc-500">
                        {isAr ? 'مفيش حسابات إدارة غير حسابك' : 'No admin accounts besides yours'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {accounts.map((account) => (
                        <AccountCard
                            key={account._id}
                            account={account}
                            modules={modules}
                            isAr={isAr}
                            busy={busy}
                            onEdit={() => setEditing(account)}
                            onToggle={() => toggleActive(account)}
                            onDelete={() => remove(account)}
                        />
                    ))}
                </div>
            )}

            {editing && (
                <AccountDialog
                    account={editing}
                    modules={modules}
                    isAr={isAr}
                    onClose={() => setEditing(null)}
                    onSaved={async (msg) => { setEditing(null); await load(); setNotice(msg); }}
                    onError={setError}
                />
            )}
        </div>
    );
}

function AccountCard({ account, modules, isAr, busy, onEdit, onToggle, onDelete }) {
    const granted = account.permissions || [];
    const nameOf = (key) => {
        const m = modules.find((x) => x.key === key);
        return m ? (isAr ? m.name_ar : m.name_en) : key;
    };

    return (
        <div className={`rounded-2xl border p-5 ${
            account.is_active
                ? 'border-zinc-200 dark:border-white/5 bg-white dark:bg-[#14171A]'
                : 'border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] opacity-70'
        }`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-black text-zinc-900 dark:text-white truncate">{account.username}</p>
                        {!account.is_active && (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-zinc-500/10 text-zinc-500">
                                {isAr ? 'موقوف' : 'Disabled'}
                            </span>
                        )}
                    </div>
                    {account.name && <p className="text-xs text-zinc-500 mt-0.5">{account.name}</p>}
                    <p className="text-[10px] text-zinc-400 mt-1">
                        {account.last_login_at
                            ? `${isAr ? 'آخر دخول: ' : 'Last login: '}${new Date(account.last_login_at).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}`
                            : (isAr ? 'مدخلش لسه' : 'Never signed in')}
                    </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button onClick={onEdit} title={isAr ? 'تعديل' : 'Edit'}
                        className="p-2 rounded-lg text-zinc-400 hover:text-marine-primary hover:bg-marine-cyan/10 transition">
                        <Pencil size={15} />
                    </button>
                    <button onClick={onToggle} disabled={!!busy} title={account.is_active ? (isAr ? 'إيقاف' : 'Disable') : (isAr ? 'تفعيل' : 'Enable')}
                        className="p-2 rounded-lg text-zinc-400 hover:text-amber-500 hover:bg-amber-500/10 transition disabled:opacity-40">
                        {busy === `active:${account._id}` ? <Loader2 size={15} className="animate-spin" />
                            : account.is_active ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                    </button>
                    <button onClick={onDelete} disabled={!!busy} title={isAr ? 'حذف' : 'Delete'}
                        className="p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition disabled:opacity-40">
                        {busy === `del:${account._id}` ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>
                </div>
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-white/5">
                {granted.length === 0 ? (
                    <p className="text-[11px] text-amber-600 font-bold">
                        {isAr ? 'مفيش صلاحيات — الحساب ده مش هيقدر يفتح أي حاجة.' : 'No permissions — this account cannot open anything.'}
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {granted.map((p) => (
                            <span key={p.module}
                                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border ${ACCESS_META[p.access]?.cls || ''}`}>
                                {p.access === 'manage' ? <Check size={10} /> : <Eye size={10} />}
                                {nameOf(p.module)}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function AccountDialog({ account, modules, isAr, onClose, onSaved, onError }) {
    const isNew = !account._id;
    const [username, setUsername] = useState(account.username || '');
    const [name, setName] = useState(account.name || '');
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);

    // module key → 'none' | 'view' | 'manage'
    const [perms, setPerms] = useState(() => {
        const map = {};
        for (const m of modules) map[m.key] = 'none';
        for (const p of account.permissions || []) map[p.module] = p.access;
        return map;
    });

    const cycle = (key) => setPerms((prev) => ({ ...prev, [key]: NEXT_ACCESS[prev[key] || 'none'] }));
    const setAll = (level) => setPerms(Object.fromEntries(modules.map((m) => [m.key, level])));

    const grantedCount = useMemo(
        () => Object.values(perms).filter((v) => v !== 'none').length,
        [perms]
    );

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const permissions = Object.entries(perms)
                .filter(([, access]) => access !== 'none')
                .map(([module, access]) => ({ module, access }));

            if (isNew) {
                await adminApi.createAdminUser({ username, name, password, permissions });
                await onSaved(isAr ? 'تم إنشاء الحساب.' : 'Account created.');
            } else {
                const payload = { name, permissions };
                if (password) payload.password = password;
                await adminApi.updateAdminUser(account._id, payload);
                await onSaved(isAr ? 'تم حفظ التعديلات.' : 'Changes saved.');
            }
        } catch (err) {
            onError(err.message || 'Could not save the account');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 sm:p-8">
            <form onSubmit={submit}
                className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-white/5">
                    <h2 className="text-base font-black text-zinc-900 dark:text-white">
                        {isNew ? (isAr ? 'حساب إدارة جديد' : 'New admin account')
                               : (isAr ? `تعديل ${account.username}` : `Edit ${account.username}`)}
                    </h2>
                    <button type="button" onClick={onClose}
                        className="p-2 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <label className="block">
                            <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                {isAr ? 'اسم المستخدم' : 'Username'} *
                            </span>
                            <input
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                disabled={!isNew}
                                required
                                minLength={3}
                                className={`${inputCls} disabled:opacity-50`}
                                placeholder="ahmed"
                            />
                            {!isNew && (
                                <span className="block text-[10px] text-zinc-400 mt-1">
                                    {isAr ? 'اسم المستخدم مش بيتغير' : 'The username cannot be changed'}
                                </span>
                            )}
                        </label>
                        <label className="block">
                            <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                                {isAr ? 'الاسم' : 'Name'}
                            </span>
                            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                        </label>
                    </div>

                    <label className="block">
                        <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                            <KeyRound size={12} className="inline me-1" />
                            {isNew ? (isAr ? 'كلمة السر' : 'Password') : (isAr ? 'كلمة سر جديدة' : 'New password')}
                            {isNew ? ' *' : ''}
                        </span>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required={isNew}
                            minLength={8}
                            className={inputCls}
                            placeholder={isNew ? (isAr ? '٨ حروف على الأقل' : 'At least 8 characters')
                                               : (isAr ? 'سيبها فاضية لو مش عايز تغيّرها' : 'Leave empty to keep the current one')}
                        />
                        {!isNew && (
                            <span className="block text-[10px] text-zinc-400 mt-1">
                                {isAr
                                    ? 'تغيير كلمة السر بيخرّج الحساب من كل الأجهزة فوراً.'
                                    : 'Changing the password signs this account out everywhere immediately.'}
                            </span>
                        )}
                    </label>

                    <div>
                        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                            <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                                {isAr ? `الصلاحيات (${grantedCount} من ${modules.length})` : `Permissions (${grantedCount} of ${modules.length})`}
                            </span>
                            <div className="flex gap-1">
                                <button type="button" onClick={() => setAll('none')}
                                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition">
                                    {isAr ? 'امسح الكل' : 'Clear all'}
                                </button>
                                <button type="button" onClick={() => setAll('view')}
                                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-sky-500/10 text-sky-600 hover:bg-sky-500/20 transition">
                                    {isAr ? 'قراءة للكل' : 'View all'}
                                </button>
                            </div>
                        </div>

                        <p className="text-[11px] text-zinc-400 mb-3">
                            {isAr
                                ? 'دوس على القسم عشان تلف بين: ممنوع ← قراءة فقط ← تحكم كامل.'
                                : 'Click a section to cycle: no access → view only → full access.'}
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[40vh] overflow-y-auto pe-1">
                            {modules.map((m) => {
                                const level = perms[m.key] || 'none';
                                const meta = ACCESS_META[level];
                                return (
                                    <button
                                        type="button"
                                        key={m.key}
                                        onClick={() => cycle(m.key)}
                                        className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-start transition ${meta.cls}`}
                                    >
                                        <span className="text-xs font-bold truncate">{isAr ? m.name_ar : m.name_en}</span>
                                        <span className="text-[10px] font-black shrink-0 whitespace-nowrap">
                                            {isAr ? meta.label_ar : meta.label_en}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-100 dark:border-white/5">
                    <button type="button" onClick={onClose}
                        className="px-4 py-2.5 rounded-xl text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition">
                        {isAr ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button type="submit" disabled={saving}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-black hover:bg-[#B91C1C] transition disabled:opacity-40">
                        {saving && <Loader2 size={15} className="animate-spin" />}
                        {isNew ? (isAr ? 'إنشاء الحساب' : 'Create account') : (isAr ? 'حفظ' : 'Save')}
                    </button>
                </div>
            </form>
        </Overlay>
    );
}
