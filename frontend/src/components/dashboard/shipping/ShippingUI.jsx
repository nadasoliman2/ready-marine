'use client';

import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import Overlay from '../../Overlay';

/* ============================ tiny styled primitives ============================ */

export const inputCls =
    'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-marine-cyan';

export function Field({ label, required = false, hint, children, className = '' }) {
    return (
        <label className={`block ${className}`}>
            <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                {label} {required ? '*' : ''}
            </span>
            {children}
            {hint && <span className="block text-[11px] text-zinc-400 mt-1">{hint}</span>}
        </label>
    );
}

export function Toggle({ checked, onChange, label }) {
    return (
        <label className="flex items-center gap-2 cursor-pointer group select-none">
            <div
                onClick={() => onChange(!checked)}
                className={`w-10 h-5 rounded-full transition-all duration-300 relative ${checked ? 'bg-marine-cyan' : 'bg-zinc-300 dark:bg-white/10'}`}
            >
                <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all duration-300 ${checked ? 'left-6' : 'left-1'}`} />
            </div>
            {label && <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300 group-hover:text-marine-primary transition-colors">{label}</span>}
        </label>
    );
}

export function StatCard({ icon: Icon, label, value, tone = 'default' }) {
    const toneMap = {
        default: 'bg-marine-cyan/10 text-marine-primary',
        green: 'bg-emerald-500/10 text-emerald-500',
        gray: 'bg-zinc-500/10 text-zinc-500',
        blue: 'bg-sky-500/10 text-sky-500',
    };
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-[#14171A] p-5 shadow-sm">
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${toneMap[tone] || toneMap.default}`}>
                    {Icon && <Icon size={18} />}
                </div>
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{label}</p>
                    <p className="text-2xl font-black text-zinc-900 dark:text-white">{value}</p>
                </div>
            </div>
        </div>
    );
}

export function PrimaryButton({ children, loading, ...props }) {
    return (
        <button
            {...props}
            disabled={loading || props.disabled}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold"
        >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {children}
        </button>
    );
}

export function Modal({ title, onClose, children, wide = false }) {
    return (
        <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
            <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} my-8 bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden`}>
                <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5 sticky top-0 bg-white dark:bg-[#14171A] z-10">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">{title}</h2>
                    <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
                        <X size={20} />
                    </button>
                </div>
                {children}
            </div>
        </Overlay>
    );
}

export function ModalFooter({ onClose, saving, isAr, submitLabel }) {
    return (
        <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold">
                {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <PrimaryButton type="submit" loading={saving}>
                {!saving && <Save size={16} />}
                {submitLabel || (isAr ? 'حفظ' : 'Save')}
            </PrimaryButton>
        </div>
    );
}

/** A repeatable list of rows. `renderRow(row, idx, update)` returns inputs; `blank` is the new-row factory. */
export function RowsEditor({ rows, onChange, renderRow, blank, addLabel, isAr }) {
    const update = (idx, patch) => {
        const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
        onChange(next);
    };
    const remove = (idx) => onChange(rows.filter((_, i) => i !== idx));
    const add = () => onChange([...rows, blank()]);
    return (
        <div className="space-y-2">
            {rows.map((row, idx) => (
                <div key={idx} className="flex items-start gap-2 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl p-2">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">{renderRow(row, idx, (patch) => update(idx, patch))}</div>
                    <button type="button" onClick={() => remove(idx)} className="p-2 text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-500/10 shrink-0">
                        <Trash2 size={15} />
                    </button>
                </div>
            ))}
            <button type="button" onClick={add} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10">
                <Plus size={13} /> {addLabel || (isAr ? 'إضافة صف' : 'Add row')}
            </button>
        </div>
    );
}

/* ============================ rule / policy builders ============================ */

export const CONDITION_FIELD_LABELS = {
    cart_total: { en: 'Cart total (pre-discount)', ar: 'إجمالي السلة (قبل الخصم)' },
    cart_total_after_discount: { en: 'Cart total (after discount)', ar: 'إجمالي السلة (بعد الخصم)' },
    total_weight: { en: 'Total weight (kg)', ar: 'إجمالي الوزن (كجم)' },
    item_count: { en: 'Number of items', ar: 'عدد العناصر' },
    vendor_count: { en: 'Number of vendors', ar: 'عدد البائعين' },
    has_class: { en: 'Cart contains shipping class', ar: 'السلة تحتوي على فئة شحن' },
    has_category: { en: 'Cart contains category', ar: 'السلة تحتوي على تصنيف' },
    has_vendor: { en: 'Cart contains vendor', ar: 'السلة تحتوي على بائع' },
    country: { en: 'Destination country', ar: 'دولة الوجهة' },
    city: { en: 'Destination city', ar: 'مدينة الوجهة' },
};

export const OPERATOR_LABELS = {
    eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤',
    in: { en: 'in', ar: 'ضمن' }, not_in: { en: 'not in', ar: 'ليس ضمن' }, contains: { en: 'contains', ar: 'يحتوي' },
};

const NUMERIC_FIELDS = ['cart_total', 'cart_total_after_discount', 'total_weight', 'item_count', 'vendor_count'];
const MEMBERSHIP_FIELDS = ['has_class', 'has_category', 'has_vendor'];

function operatorsForField(field) {
    if (NUMERIC_FIELDS.includes(field)) return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
    if (MEMBERSHIP_FIELDS.includes(field)) return ['eq', 'ne'];
    return ['eq', 'ne', 'in', 'not_in', 'contains'];
}

function lbl(map, key, isAr) {
    const v = map[key];
    if (!v) return key;
    if (typeof v === 'string') return v;
    return isAr ? v.ar : v.en;
}

export const RULE_ACTION_LABELS = {
    add_fixed: { en: 'Add fixed amount', ar: 'إضافة مبلغ ثابت' },
    add_percent: { en: 'Add % of running cost', ar: 'إضافة نسبة من التكلفة' },
    set_cost: { en: 'Set cost to', ar: 'تعيين التكلفة إلى' },
    free_shipping: { en: 'Free shipping (stop)', ar: 'شحن مجاني (إيقاف)' },
    set_min_fee: { en: 'Set minimum fee', ar: 'تعيين الحد الأدنى' },
    set_max_fee: { en: 'Set maximum fee', ar: 'تعيين الحد الأقصى' },
};

export const POLICY_ACTION_LABELS = {
    free_shipping: { en: 'Free shipping', ar: 'شحن مجاني' },
    percent_discount: { en: 'Discount by %', ar: 'خصم بنسبة' },
    fixed_discount: { en: 'Discount fixed amount', ar: 'خصم مبلغ ثابت' },
    surcharge_fixed: { en: 'Surcharge fixed amount', ar: 'رسوم إضافية ثابتة' },
    surcharge_percent: { en: 'Surcharge by %', ar: 'رسوم إضافية بنسبة' },
    surcharge_percent_above: { en: 'Surcharge % of basket above', ar: 'رسوم إضافية بنسبة من قيمة السلة فوق' },
    set_min_fee: { en: 'Set minimum fee', ar: 'تعيين الحد الأدنى' },
    set_max_fee: { en: 'Set maximum fee', ar: 'تعيين الحد الأقصى' },
    override_cost: { en: 'Override cost to', ar: 'استبدال التكلفة بـ' },
};

const NO_VALUE_ACTIONS = ['free_shipping'];
// Actions that take a second number: the basket amount the percentage starts counting from.
const THRESHOLD_ACTIONS = ['surcharge_percent_above'];

/** Membership-field value input: a select populated from `lookups` ({classes, categories, vendors}). */
function MembershipValueInput({ field, value, onChange, lookups, isAr }) {
    const list = field === 'has_class' ? (lookups.classes || []) : field === 'has_category' ? (lookups.categories || []) : (lookups.vendors || []);
    return (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)} className={inputCls}>
            <option value="">{isAr ? '— اختر —' : '— select —'}</option>
            {list.map((o) => (
                <option key={o._id || o.id} value={o._id || o.id}>{o.label || o.name || o.store_name || o._id}</option>
            ))}
        </select>
    );
}

export function ConditionRows({ conditions, onChange, lookups = {}, isAr }) {
    return (
        <RowsEditor
            rows={conditions}
            onChange={onChange}
            blank={() => ({ field: 'cart_total', operator: 'gte', value: '' })}
            addLabel={isAr ? 'إضافة شرط' : 'Add condition'}
            isAr={isAr}
            renderRow={(row, idx, update) => {
                const ops = operatorsForField(row.field);
                return (
                    <>
                        <select
                            value={row.field}
                            onChange={(e) => {
                                const nf = e.target.value;
                                const nops = operatorsForField(nf);
                                update({ field: nf, operator: nops.includes(row.operator) ? row.operator : nops[0], value: '' });
                            }}
                            className={inputCls + ' sm:col-span-2 lg:col-span-2'}
                        >
                            {Object.keys(CONDITION_FIELD_LABELS).map((f) => (
                                <option key={f} value={f}>{lbl(CONDITION_FIELD_LABELS, f, isAr)}</option>
                            ))}
                        </select>
                        <select value={row.operator} onChange={(e) => update({ operator: e.target.value })} className={inputCls}>
                            {ops.map((op) => (
                                <option key={op} value={op}>{lbl(OPERATOR_LABELS, op, isAr)}</option>
                            ))}
                        </select>
                        {MEMBERSHIP_FIELDS.includes(row.field) ? (
                            <MembershipValueInput field={row.field} value={row.value} onChange={(v) => update({ value: v })} lookups={lookups} isAr={isAr} />
                        ) : NUMERIC_FIELDS.includes(row.field) ? (
                            <input type="number" step="any" value={row.value ?? ''} onChange={(e) => update({ value: e.target.value === '' ? '' : Number(e.target.value) })} className={inputCls} placeholder={isAr ? 'قيمة' : 'value'} />
                        ) : (
                            <input
                                value={Array.isArray(row.value) ? row.value.join(', ') : (row.value ?? '')}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    update({ value: (row.operator === 'in' || row.operator === 'not_in') ? v.split(',').map((x) => x.trim()).filter(Boolean) : v });
                                }}
                                className={inputCls}
                                placeholder={(row.operator === 'in' || row.operator === 'not_in') ? (isAr ? 'قيم مفصولة بفواصل' : 'comma-separated') : (isAr ? 'قيمة' : 'value')}
                            />
                        )}
                    </>
                );
            }}
        />
    );
}

export function ActionRows({ actions, onChange, kind = 'rule', isAr }) {
    const labels = kind === 'policy' ? POLICY_ACTION_LABELS : RULE_ACTION_LABELS;
    return (
        <RowsEditor
            rows={actions}
            onChange={onChange}
            blank={() => ({ type: kind === 'policy' ? 'free_shipping' : 'add_fixed', value: 0 })}
            addLabel={isAr ? 'إضافة إجراء' : 'Add action'}
            isAr={isAr}
            renderRow={(row, idx, update) => (
                <>
                    <select value={row.type} onChange={(e) => update({ type: e.target.value })} className={inputCls + ' sm:col-span-2 lg:col-span-2'}>
                        {Object.keys(labels).map((t) => (
                            <option key={t} value={t}>{lbl(labels, t, isAr)}</option>
                        ))}
                    </select>
                    {!NO_VALUE_ACTIONS.includes(row.type) && (
                        <input type="number" step="any" value={row.value ?? 0} onChange={(e) => update({ value: Number(e.target.value) || 0 })} className={inputCls} placeholder={THRESHOLD_ACTIONS.includes(row.type) ? (isAr ? 'النسبة %' : 'percent %') : undefined} />
                    )}
                    {THRESHOLD_ACTIONS.includes(row.type) && (
                        <input type="number" step="any" value={row.threshold ?? 0} onChange={(e) => update({ threshold: Number(e.target.value) || 0 })} className={inputCls} placeholder={isAr ? 'يبدأ فوق' : 'above amount'} />
                    )}
                </>
            )}
        />
    );
}

/** Full rule-engine builder: a list of rules, each with conditions + actions. */
export function RuleBuilder({ rules, onChange, lookups, isAr }) {
    const updateRule = (idx, patch) => onChange(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    const removeRule = (idx) => onChange(rules.filter((_, i) => i !== idx));
    const addRule = () => onChange([...rules, { name: isAr ? 'قاعدة' : 'Rule', priority: rules.length, stop_processing: false, condition_logic: 'all', conditions: [], actions: [] }]);
    return (
        <div className="space-y-3">
            {rules.map((rule, idx) => (
                <div key={idx} className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0E1012] p-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <input value={rule.name || ''} onChange={(e) => updateRule(idx, { name: e.target.value })} placeholder={isAr ? 'اسم القاعدة' : 'Rule name'} className={inputCls + ' flex-1 min-w-[160px]'} />
                        <div className="flex items-center gap-1">
                            <span className="text-[11px] text-zinc-400 font-bold uppercase">{isAr ? 'الأولوية' : 'Priority'}</span>
                            <input type="number" value={rule.priority ?? 0} onChange={(e) => updateRule(idx, { priority: Number(e.target.value) || 0 })} className={inputCls + ' w-20'} />
                        </div>
                        <select value={rule.condition_logic || 'all'} onChange={(e) => updateRule(idx, { condition_logic: e.target.value })} className={inputCls + ' w-auto'}>
                            <option value="all">{isAr ? 'مطابقة الكل' : 'Match ALL'}</option>
                            <option value="any">{isAr ? 'مطابقة أي' : 'Match ANY'}</option>
                        </select>
                        <Toggle checked={!!rule.stop_processing} onChange={(v) => updateRule(idx, { stop_processing: v })} label={isAr ? 'إيقاف بعد التطابق' : 'Stop after match'} />
                        <button type="button" onClick={() => removeRule(idx)} className="p-2 text-zinc-400 hover:text-red-500 rounded-lg hover:bg-red-500/10 ms-auto"><Trash2 size={15} /></button>
                    </div>
                    <div>
                        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">{isAr ? 'الشروط' : 'Conditions'}</p>
                        <ConditionRows conditions={rule.conditions || []} onChange={(c) => updateRule(idx, { conditions: c })} lookups={lookups} isAr={isAr} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">{isAr ? 'الإجراءات' : 'Actions'}</p>
                        <ActionRows actions={rule.actions || []} onChange={(a) => updateRule(idx, { actions: a })} kind="rule" isAr={isAr} />
                    </div>
                </div>
            ))}
            <button type="button" onClick={addRule} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-marine-cyan/10 text-marine-primary hover:bg-marine-cyan/20">
                <Plus size={13} /> {isAr ? 'إضافة قاعدة' : 'Add rule'}
            </button>
        </div>
    );
}
