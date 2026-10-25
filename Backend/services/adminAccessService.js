/**
 * Role-based access for the admin dashboard.
 *
 * ── The shape of it ──────────────────────────────────────────────────────────────────
 * There is ONE super admin: the `ADMIN_USERNAME` / `ADMIN_PASSWORD` pair in the server's
 * environment. It is deliberately NOT a database row. Nothing that happens inside the
 * dashboard — no sub-admin, no bug in this file, no bad migration — can delete it, lock it
 * out, or edit its permissions, so there is always exactly one way back in.
 *
 * Everyone else is an `AdminUser` row with a list of modules they may touch. They can never
 * reach account management: that is not a grantable module, it is a super-admin-only branch
 * (see `SUPER_ADMIN_ONLY_PREFIXES`). Without that rule a sub-admin could grant themselves
 * everything, and the whole feature would be decoration.
 *
 * ── Why the gate lives here and not on 190 routes ────────────────────────────────────
 * The dashboard is ~190 routes across 8 route files. Tagging each one with the module it
 * belongs to would work exactly until somebody adds route 191 and forgets — and a forgotten
 * tag is an open door, silently. So instead:
 *
 *   1. Every admin route already goes through `protect('admin')`. Verified: the only two
 *      that do not are `/login` and `/logout`, which must be public. That makes `protect`
 *      the single choke point, and the gate is called from inside it.
 *
 *   2. The gate resolves the REQUEST PATH to a module through the table below.
 *
 *   3. A path that matches no rule is DENIED, not allowed. Adding a new admin route without
 *      adding it here breaks it loudly for sub-admins instead of quietly exposing it. That
 *      is the trade this file exists to make: fail closed, every time.
 *
 * ── view vs manage ──────────────────────────────────────────────────────────────────
 * GET and HEAD need `view`. Everything else — POST, PUT, PATCH, DELETE — needs `manage`.
 * A uniform rule beats a per-route list for the same reason as above: nobody has to
 * remember anything, and the failure direction is "too strict", never "too loose".
 */

const { AdminUser, ADMIN_ACCESS_LEVELS } = require("../models/adminUsers");

/* ------------------------------------------------------------------ *
 * The modules
 * ------------------------------------------------------------------ */

/**
 * Every module a sub-admin can be granted, with the dashboard pages it covers.
 *
 * `paths` are matched against the request path with `/api/admin` stripped, on SEGMENT
 * boundaries — so `/products` never swallows `/product-brands`.
 */
const MODULES = [
    { key: "users", name_en: "Customers", name_ar: "العملاء", paths: ["/users"] },
    {
        key: "car_campaigns",
        name_en: "Car Email Campaigns",
        name_ar: "حملات السيارات البريدية",
        paths: ["/car-campaigns"],
    },
    { key: "vendors", name_en: "Vendors", name_ar: "التجار", paths: ["/vendors"] },
    { key: "verifications", name_en: "Account verification", name_ar: "تأكيد الحسابات", paths: ["/verifications"] },
    {
        key: "subscriptions",
        name_en: "Vendor subscriptions",
        name_ar: "اشتراكات التجار",
        paths: ["/subscriptions", "/subscription-payments"],
    },
    {
        key: "subscription_packages",
        name_en: "Subscription plans",
        name_ar: "باقات الاشتراك",
        paths: ["/subscription-packages"],
    },
    { key: "products", name_en: "Products", name_ar: "المنتجات", paths: ["/products"] },
    { key: "catalog", name_en: "Catalog", name_ar: "الكتالوج", paths: ["/catalog"] },
    { key: "bundles", name_en: "Bundles", name_ar: "الباقات", paths: ["/bundles"] },
    { key: "orders", name_en: "Orders", name_ar: "الطلبات", paths: ["/orders"] },
    {
        key: "companies",
        name_en: "Corporate accounts",
        name_ar: "حسابات الشركات",
        // Credit we extend: a company's monthly cap and payment terms are set here.
        paths: ["/companies"],
    },
    { key: "parcels", name_en: "Parcels needing attention", name_ar: "شحنات محتاجة تدخل", paths: ["/sub-orders"] },
    {
        key: "returns",
        name_en: "Returns & refunds",
        name_ar: "المرتجعات والاستردادات",
        paths: ["/returns", "/refunds"],
    },
    {
        key: "finance",
        name_en: "Finance (payouts, commissions, profit, ad spend)",
        name_ar: "المالية (الدفعات والعمولات والأرباح ومصاريف الإعلانات)",
        // The whole ledger behind one key. It reads every vendor's balance and can pay
        // them out, so there is no half of it that is safe to hand out on its own.
        paths: ["/finance"],
    },
    { key: "withdrawals", name_en: "Withdrawals", name_ar: "طلبات السحب", paths: ["/withdrawals"] },
    { key: "ads", name_en: "Ad requests", name_ar: "طلبات الإعلانات", paths: ["/ads"] },
    { key: "pickups", name_en: "Pickups", name_ar: "استلامات بوسطة", paths: ["/bosta"] },
    { key: "supplies", name_en: "Packaging supplies", name_ar: "مستلزمات الشحن", paths: ["/supplies"] },
    {
        key: "contact_inquiries",
        name_en: "Contact inquiries",
        name_ar: "رسائل التواصل",
        paths: ["/contact-inquiries"],
    },
    { key: "tickets", name_en: "Support tickets", name_ar: "تذاكر الدعم", paths: ["/tickets"] },
    { key: "coupons", name_en: "Coupons", name_ar: "الكوبونات", paths: ["/coupons"] },
    { key: "wallets", name_en: "Customer wallets", name_ar: "محافظ العملاء", paths: ["/wallet"] },
    { key: "loyalty", name_en: "Loyalty program", name_ar: "برنامج الولاء", paths: ["/loyalty"] },
    { key: "reviews", name_en: "Reviews", name_ar: "التقييمات", paths: ["/reviews"] },
    { key: "categories", name_en: "Categories", name_ar: "الأقسام", paths: ["/categories"] },
    { key: "car_brands", name_en: "Car brands", name_ar: "ماركات العربيات", paths: ["/car-brands"] },
    { key: "product_brands", name_en: "Product brands", name_ar: "ماركات المنتجات", paths: ["/product-brands"] },
    { key: "services", name_en: "Services", name_ar: "الخدمات", paths: ["/services"] },
    { key: "shipping", name_en: "Shipping", name_ar: "الشحن", paths: ["/shipping"] },
    { key: "articles", name_en: "Articles", name_ar: "المقالات", paths: ["/articles"] },
    { key: "pages", name_en: "Pages", name_ar: "الصفحات", paths: ["/pages"] },
    {
        key: "settings",
        name_en: "Site settings (commissions, landing page, branding)",
        name_ar: "إعدادات الموقع (العمولات وصفحة الهبوط والهوية)",
        // HONEST GROUPING, NOT A SHORTCUT. Commissions, Landing Control and the site
        // settings page are three sidebar entries that all write through the single
        // `PUT /settings` endpoint. Splitting them would take field-level rules inside that
        // route, so until that route is split they are one permission — and this label says
        // so, rather than offering three switches that secretly move together.
        paths: ["/settings", "/upload"],
    },
];

const MODULE_KEYS = MODULES.map((m) => m.key);
const MODULE_BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

/**
 * Paths every authenticated admin may reach regardless of permissions: who am I, and let me
 * out. Without these a sub-admin could not load the dashboard shell at all.
 */
const ALWAYS_ALLOWED_PREFIXES = ["/me", "/logout", "/login"];

/**
 * Managing admin accounts. NOT a module — it can never be granted, only held by the super
 * admin. This is the rule that stops a sub-admin promoting themselves.
 */
const SUPER_ADMIN_ONLY_PREFIXES = ["/admin-users"];

/* ------------------------------------------------------------------ *
 * Path resolution
 * ------------------------------------------------------------------ */

/** Segment-boundary prefix match: `/products` matches `/products/x`, never `/product-brands`. */
const matchesPrefix = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * The path a rule is matched against: everything after `/api/admin`, without a query string
 * and without a trailing slash. `/api/admin/shipping/zones` → `/shipping/zones`.
 */
function normalizePath(fullPath) {
    let path = String(fullPath || "").split("?")[0];
    if (path.startsWith("/api/admin")) path = path.slice("/api/admin".length);
    if (!path.startsWith("/")) path = `/${path}`;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return path;
}

// Longest prefix first, so `/upload/branding` is decided before a shorter rule could claim it.
const PATH_RULES = MODULES.flatMap((m) => m.paths.map((p) => ({ prefix: p, module: m.key })))
    .sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Which module a request belongs to.
 * @returns {{ kind: 'module', module: string } | { kind: 'always' } | { kind: 'super_only' } | { kind: 'unmapped' }}
 */
function resolveModule(fullPath) {
    const path = normalizePath(fullPath);

    if (SUPER_ADMIN_ONLY_PREFIXES.some((p) => matchesPrefix(path, p))) return { kind: "super_only" };
    if (ALWAYS_ALLOWED_PREFIXES.some((p) => matchesPrefix(path, p))) return { kind: "always" };

    const rule = PATH_RULES.find((r) => matchesPrefix(path, r.prefix));
    if (rule) return { kind: "module", module: rule.module };

    // The dashboard root (`/api/admin` itself) and anything else unrecognised.
    return { kind: "unmapped" };
}

/** `view` for a read, `manage` for anything that changes something. */
const levelForMethod = (method) =>
    ["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase()) ? "view" : "manage";

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

/**
 * May this admin make this request?
 *
 * @param {object} admin   `{ is_super, permissions: [{ module, access }] }`
 * @param {string} method  HTTP method
 * @param {string} path    `req.originalUrl` or an already-normalised path
 * @returns {{ allowed: boolean, code?: string, message?: string, module?: string }}
 */
function checkAccess(admin, method, path) {
    if (!admin) return { allowed: false, code: "NO_ADMIN", message: "Not authorized" };

    const target = resolveModule(path);

    // The super admin passes everything, including routes nobody has mapped yet. It is the
    // account that has to be able to fix a mapping mistake, so it cannot be stopped by one.
    if (admin.is_super) return { allowed: true, module: target.module };

    if (target.kind === "always") return { allowed: true };

    if (target.kind === "super_only") {
        return {
            allowed: false,
            code: "SUPER_ADMIN_ONLY",
            message: "Only the main admin account can manage admin accounts.",
        };
    }

    if (target.kind === "unmapped") {
        // Fail closed. A route with no rule is a route nobody has decided about, and guessing
        // "allow" once is how a permission system quietly stops meaning anything.
        return {
            allowed: false,
            code: "MODULE_NOT_MAPPED",
            message:
                "This section is not mapped to a permission yet, so it is closed to sub-admin accounts. " +
                "Add it to MODULES in services/adminAccessService.js.",
        };
    }

    const needed = levelForMethod(method);
    const granted = (admin.permissions || []).find((p) => p.module === target.module);

    if (!granted) {
        return {
            allowed: false,
            code: "MODULE_FORBIDDEN",
            module: target.module,
            message: "You do not have access to this section.",
        };
    }

    if (needed === "manage" && granted.access !== "manage") {
        return {
            allowed: false,
            code: "READ_ONLY",
            module: target.module,
            message: "You have view-only access to this section.",
        };
    }

    return { allowed: true, module: target.module };
}

/* ------------------------------------------------------------------ *
 * Permission input
 * ------------------------------------------------------------------ */

/**
 * Clean a permissions payload from the admin UI into something storable.
 *
 * Unknown module keys and unknown access levels are DROPPED rather than rejected or stored:
 * a typo must not become a permission, and it must not create a row that later grants
 * something nobody chose.
 */
function sanitizePermissions(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of input) {
        const moduleKey = String(entry?.module || "").trim();
        const access = String(entry?.access || "").trim();
        if (!MODULE_BY_KEY.has(moduleKey)) continue;
        if (!ADMIN_ACCESS_LEVELS.includes(access)) continue;
        if (seen.has(moduleKey)) continue;
        seen.add(moduleKey);
        out.push({ module: moduleKey, access });
    }
    return out;
}

/** The module catalogue the admin UI renders its checkboxes from. */
const listModules = () =>
    MODULES.map(({ key, name_en, name_ar }) => ({ key, name_en, name_ar }));

/**
 * Load a sub-admin for a request, or null when the account is gone or switched off.
 * Read fresh on every request on purpose: revoking a permission or deactivating an account
 * has to bite immediately, not whenever a 7-day token happens to expire.
 */
async function loadActiveAdmin(adminId) {
    if (!adminId) return null;
    const doc = await AdminUser.findById(adminId).select("-password").lean();
    if (!doc || doc.is_active === false) return null;
    return doc;
}

module.exports = {
    MODULES,
    MODULE_KEYS,
    ALWAYS_ALLOWED_PREFIXES,
    SUPER_ADMIN_ONLY_PREFIXES,
    normalizePath,
    resolveModule,
    levelForMethod,
    checkAccess,
    sanitizePermissions,
    listModules,
    loadActiveAdmin,
};
