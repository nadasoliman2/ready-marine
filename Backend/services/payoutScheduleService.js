/**
 * Payout Schedule Service
 * -----------------------
 * Answers one question, in two directions:
 *
 *   "When is the next payout?"          -> nextPayoutOnOrAfter(schedule, date)
 *   "Which payout will pay THIS order?" -> payoutDateForEarning(schedule, earning)
 *
 * The schedule is a weekday plus a cadence in weeks ("every Monday", "every other
 * Monday"), phased by an anchor date. The anchor exists because a fortnightly cycle has
 * no calendar-derived answer — some months contain three Mondays of the cycle and some
 * two — so the admin picks a date the cycle passes through and every payout after it is
 * anchor + k x interval_weeks.
 *
 * Kept apart from `vendorEarningsService`, which owns when money BECOMES payable (the
 * 14-day hold). That is a property of the parcel and is frozen at delivery; this is a
 * property of the calendar and can be changed at any time without re-dating a single
 * earning.
 */

const { SiteSettings } = require("../models/site_settings");
const { Seller } = require("../models/sellers");
const { RETURN_WINDOW_DAYS } = require("./returnService");

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SCHEDULE = {
    enabled: true,
    // Daily by default: a parcel is due for transfer the day its settlement period ends.
    frequency: "daily",
    weekday: 1, // Monday — used only when frequency is "weekly"
    interval_weeks: 1,
    anchor_date: null,
    hold_days: RETURN_WINDOW_DAYS,
};

/** Midnight local time on the given date. Payouts are a day, never an instant. */
const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
};

const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
};

/* ------------------------------------------------------------------ */
/*  Resolving the schedule that applies to a vendor                   */
/* ------------------------------------------------------------------ */

/**
 * The schedule in force for a vendor: their override where they set one, the global
 * calendar everywhere else.
 *
 * Resolved FIELD BY FIELD rather than as a whole object, so a vendor who overrode only
 * their payout weekday still follows the company-wide hold period when it changes.
 *
 * @param {object|null} globalSchedule  site_settings.payout_schedule
 * @param {object|null} vendorSchedule  seller.payout_schedule
 */
const resolveSchedule = (globalSchedule, vendorSchedule) => {
    const base = {
        enabled: globalSchedule?.enabled ?? DEFAULT_SCHEDULE.enabled,
        frequency: globalSchedule?.frequency ?? DEFAULT_SCHEDULE.frequency,
        weekday: globalSchedule?.weekday ?? DEFAULT_SCHEDULE.weekday,
        interval_weeks: globalSchedule?.interval_weeks ?? DEFAULT_SCHEDULE.interval_weeks,
        anchor_date: globalSchedule?.anchor_date ?? DEFAULT_SCHEDULE.anchor_date,
        hold_days: globalSchedule?.hold_days ?? DEFAULT_SCHEDULE.hold_days,
        source: "global",
    };

    if (!vendorSchedule?.enabled) return base;

    return {
        enabled: true,
        frequency: vendorSchedule.frequency ?? base.frequency,
        weekday: vendorSchedule.weekday ?? base.weekday,
        interval_weeks: vendorSchedule.interval_weeks ?? base.interval_weeks,
        anchor_date: vendorSchedule.anchor_date ?? base.anchor_date,
        hold_days: vendorSchedule.hold_days ?? base.hold_days,
        source: "vendor",
    };
};

/** The global calendar, with defaults filled in. */
const getGlobalSchedule = async () => {
    const settings = await SiteSettings.findOne().select("payout_schedule").lean();
    return resolveSchedule(settings?.payout_schedule, null);
};

/**
 * The settlement period, in days, that a parcel delivered today would be given: the
 * schedule's hold_days, never shorter than the customer return window. Money must not be
 * payable while the goods it paid for can still come back.
 */
const effectiveHoldDays = (schedule) => {
    const configured = Number(schedule?.hold_days);
    const days = Number.isFinite(configured) ? Math.round(configured) : RETURN_WINDOW_DAYS;
    return Math.max(RETURN_WINDOW_DAYS, Math.min(90, days));
};

/** The schedule in force for one vendor. */
const getScheduleForVendor = async (vendorId) => {
    const [settings, vendor] = await Promise.all([
        SiteSettings.findOne().select("payout_schedule").lean(),
        Seller.findById(vendorId).select("payout_schedule").lean(),
    ]);
    return resolveSchedule(settings?.payout_schedule, vendor?.payout_schedule);
};

/* ------------------------------------------------------------------ */
/*  The calendar                                                      */
/* ------------------------------------------------------------------ */

/**
 * The first payout date of the cycle: the first `weekday` on or after the anchor.
 *
 * With no anchor set the cycle is phased from the Unix epoch, which was a Thursday. That
 * is arbitrary but it is STABLE — the alternative, phasing from "now", would shift every
 * future payout date each time the page was loaded.
 */
const cycleOrigin = (schedule) => {
    const anchor = schedule.anchor_date ? startOfDay(schedule.anchor_date) : startOfDay(new Date(0));
    const shift = (7 + schedule.weekday - anchor.getDay()) % 7;
    return addDays(anchor, shift);
};

/**
 * The first scheduled payout falling on or after `date`.
 *
 * Returns null when the schedule is switched off — payouts then happen only when an admin
 * chooses to run one, and no screen should promise a date that nothing will honour.
 */
const nextPayoutOnOrAfter = (schedule, date = new Date()) => {
    if (!schedule?.enabled) return null;
    if (schedule.frequency !== "weekly") return startOfDay(date);

    const interval = Math.max(1, Number(schedule.interval_weeks) || 1);
    const origin = cycleOrigin(schedule);
    const target = startOfDay(date);

    if (target <= origin) return origin;

    // Whole cycles between the origin and the target, rounded UP so a date landing
    // mid-cycle moves to the next payout rather than back to the last one.
    const cycleDays = interval * 7;
    const elapsed = Math.round((target - origin) / DAY_MS);
    const cycles = Math.ceil(elapsed / cycleDays);
    return addDays(origin, cycles * cycleDays);
};

/**
 * The payout that will carry a given earning.
 *
 * Dated from the earning's OWN `clearable_at` rather than from today, so the date shown
 * beside an order never moves while it waits. An earning whose window closed weeks ago and
 * was never paid still reports the payout it should have gone out on — which is the point:
 * a date drifting forward every day would hide exactly the backlog this screen exists to
 * surface. `is_overdue` on the row is what says it slipped.
 */
const payoutDateForEarning = (schedule, earning) => {
    if (!earning) return null;
    const readyAt = earning.clearable_at || earning.delivered_at;
    if (!readyAt) return null;
    return nextPayoutOnOrAfter(schedule, readyAt);
};

/**
 * The next `count` payout dates from `from` onward. Drives the "upcoming payouts" strip.
 */
const upcomingPayouts = (schedule, { from = new Date(), count = 6 } = {}) => {
    if (!schedule?.enabled) return [];
    if (schedule.frequency !== "weekly") {
        const today = startOfDay(from);
        return Array.from({ length: count }, (_, i) => addDays(today, i));
    }
    const interval = Math.max(1, Number(schedule.interval_weeks) || 1);
    const first = nextPayoutOnOrAfter(schedule, from);
    if (!first) return [];

    const dates = [];
    for (let i = 0; i < count; i += 1) {
        dates.push(addDays(first, i * interval * 7));
    }
    return dates;
};

/** Whole days until `date`, negative once it is in the past. */
const daysUntil = (date, from = new Date()) => {
    if (!date) return null;
    return Math.round((startOfDay(date) - startOfDay(from)) / DAY_MS);
};

const WEEKDAY_LABELS = [
    { en: "Sunday", ar: "الأحد" },
    { en: "Monday", ar: "الإثنين" },
    { en: "Tuesday", ar: "الثلاثاء" },
    { en: "Wednesday", ar: "الأربعاء" },
    { en: "Thursday", ar: "الخميس" },
    { en: "Friday", ar: "الجمعة" },
    { en: "Saturday", ar: "السبت" },
];

/** "Every other Monday" / "كل إثنين" — the schedule as a sentence, for the screens. */
const describeSchedule = (schedule) => {
    if (!schedule?.enabled) {
        return { en: "Manual payouts (no schedule)", ar: "دفع يدوي (بدون جدول)" };
    }
    if (schedule.frequency !== "weekly") {
        return { en: "Every day, once the settlement period ends", ar: "يوميًا بعد انتهاء فترة التسوية" };
    }
    const day = WEEKDAY_LABELS[schedule.weekday] || WEEKDAY_LABELS[1];
    const n = Math.max(1, Number(schedule.interval_weeks) || 1);
    if (n === 1) return { en: `Every ${day.en}`, ar: `كل ${day.ar}` };
    if (n === 2) return { en: `Every other ${day.en}`, ar: `كل ${day.ar} بعد أسبوع` };
    return { en: `Every ${n} weeks on ${day.en}`, ar: `كل ${n} أسابيع يوم ${day.ar}` };
};

module.exports = {
    DEFAULT_SCHEDULE,
    WEEKDAY_LABELS,
    resolveSchedule,
    getGlobalSchedule,
    getScheduleForVendor,
    effectiveHoldDays,
    nextPayoutOnOrAfter,
    payoutDateForEarning,
    upcomingPayouts,
    describeSchedule,
    daysUntil,
    startOfDay,
};
