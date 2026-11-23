/**
 * Text as the matchers read it.
 *
 * Vendors write the same word many ways: أوبترا / اوبترا, سيارة / سياره, ٢٠٠٨ / 2008,
 * "سبورتاج2021" with no space, "ix35شمال" glued to the next word. Everything the matchers
 * compare goes through `fold` first, so those differences never reach a comparison.
 *
 * Two forms are kept on purpose. `fold` keeps the separators that carry meaning — the dash
 * in "2008-2015", the slash in "94 / 99", the dot in "1.6" — so years, ranges and engine
 * sizes can be read off it. `words` is the folded text cut into plain words, for everything
 * else.
 */

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const CHAR_MAP = {
    'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ی': 'ي', 'ئ': 'ي', 'ؤ': 'و', 'ة': 'ه', 'ک': 'ك',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};
const FOLDABLE = /[أإآٱىیئؤةک٠-٩۰-۹]/g;

const isArabic = (ch) => ch >= '؀' && ch <= 'ۿ';

/**
 * Lower case, Arabic letter variants folded, diacritics and the tatweel dropped, Arabic
 * digits made digits. Arabic glued to Latin or digits is pulled apart ("سبورتاج2021" →
 * "سبورتاج 2021", "bydفلتر" → "byd فلتر"); Latin glued to digits is not ("n16", "ix35").
 * Punctuation other than - / . + is a space.
 */
const fold = (value) => {
    const text = String(value ?? '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(DIACRITICS, '')
        .replace(FOLDABLE, (c) => CHAR_MAP[c])
        .replace(/[،؛؟]/g, ' ') // Arabic comma, semicolon, question mark
        .replace(/[^\p{L}\p{N}\-/.+\s]+/gu, ' ');
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const prev = text[i - 1];
        if (prev && /[\p{L}\p{N}]/u.test(ch) && /[\p{L}\p{N}]/u.test(prev) && isArabic(ch) !== isArabic(prev)) out += ' ';
        out += ch;
    }
    return out.replace(/\s+/g, ' ').trim();
};

/** The folded text as plain words: separators gone, except a decimal point between digits. */
const words = (value) => fold(value)
    .replace(/(\d)\.(\d)/g, '$1\u0001$2')
    .replace(/[-/.+]/g, ' ')
    .replace(/\u0001/g, '.')
    .split(' ')
    .filter(Boolean);

/** "الفرامل" and "فرامل" are one word to a reader. Short words keep their ال ("الو"). */
const stripArticle = (word) => {
    for (const prefix of ['وال', 'بال', 'لل', 'ال']) {
        if (word.startsWith(prefix) && word.length - prefix.length >= 3) return word.slice(prefix.length);
    }
    return word;
};

/** Codes compared with no separators: "F 5969" is "f5969", "28113-26000" is "2811326000". */
const compactCode = (value) => fold(value).replace(/[^\p{L}\p{N}]+/gu, '');

/** Edit distance between a and b, or max + 1 as soon as it is known to be larger. */
const editDistance = (a, b, max = 2) => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j += 1) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > max) return max + 1;
        prev = cur;
    }
    return prev[b.length];
};

module.exports = { fold, words, stripArticle, compactCode, editDistance, isArabic };
