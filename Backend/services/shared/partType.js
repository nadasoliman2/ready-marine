/**
 * What kind of part a product is. Required on every product saved through a form or a
 * bulk upload, vendor's or admin's.
 *
 *   original     the car maker's own part, in its packaging (Genuine)
 *   oem          made by the maker's supplier to the same specification, in the supplier's box
 *   aftermarket  a third-party part made to fit
 *
 * Stored as one of the three keys. Whatever a person types or picks — a dropdown value, an
 * Arabic word, a sheet cell — goes through `normalizePartType` first.
 */
const PART_TYPES = ['original', 'oem', 'aftermarket'];

const ALIASES = {
    original: 'original', genuine: 'original', 'أصلي': 'original', 'اصلي': 'original',
    'أصلية': 'original', 'اصلية': 'original', 'اورجينال': 'original', 'أورجينال': 'original',
    oem: 'oem', 'o.e.m': 'oem', 'o.e.m.': 'oem',
    aftermarket: 'aftermarket', 'after market': 'aftermarket', 'after-market': 'aftermarket',
    'تجاري': 'aftermarket', 'تجارية': 'aftermarket', 'بديل': 'aftermarket', 'بديلة': 'aftermarket',
};

/** The stored key for whatever was entered, or null when it is empty or not a part type. */
const normalizePartType = (value) => ALIASES[String(value ?? '').trim().toLowerCase()] || null;

const PART_TYPE_REQUIRED = 'Choose the part type: Original, OEM or Aftermarket.';

module.exports = { PART_TYPES, normalizePartType, PART_TYPE_REQUIRED };
