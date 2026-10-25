/**
 * The search box's suggestions: fetching them, remembering them, and marking the typed
 * words inside them. The server does the matching (`GET /api/products/suggest`, see
 * Backend/services/searchSuggestService.js); this keeps the box fast on the client side.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

// ── Fetching ─────────────────────────────────────────────────────────────────────────────

// Answers already seen, by query: typing back over a word, or retyping it, shows its
// suggestions at once instead of asking again.
const cache = new Map();
const CACHE_LIMIT = 100;

const cacheKey = (query) => query.trim().replace(/\s+/g, ' ').toLowerCase();

/** The cached suggestions for this query, if it was asked before. */
export const peekSuggestions = (query) => cache.get(cacheKey(query)) || null;

export const fetchSuggestions = async (query, signal) => {
  const key = cacheKey(query);
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(`${API_URL}/products/suggest?q=${encodeURIComponent(key)}`, { signal });
  if (!res.ok) throw new Error(`Suggestions failed (${res.status})`);
  const data = await res.json();
  cache.set(key, data);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return data;
};

// ── Recent searches (this browser only) ──────────────────────────────────────────────────

const RECENT_KEY = 'recent_searches';
const RECENT_LIMIT = 6;

export const getRecentSearches = () => {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((q) => typeof q === 'string' && q.trim()).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
};

const saveRecent = (list) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT))); } catch { /* private mode */ }
};

export const addRecentSearch = (query) => {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return;
  saveRecent([q, ...getRecentSearches().filter((item) => item.toLowerCase() !== q.toLowerCase())]);
};

export const removeRecentSearch = (query) => {
  saveRecent(getRecentSearches().filter((item) => item !== query));
};

// ── Highlighting ─────────────────────────────────────────────────────────────────────────

// The same folding as the server's, so "الفرامل" lights up "فرامل" in a title and
// "شنطه" lights up "شنطة": أ/إ/آ → ا, ة → ه, ى/ئ → ي, ؤ → و, no diacritics, Arabic digits.
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const CHAR_MAP = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و', 'ة': 'ه',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const foldChar = (c) => {
  const folded = c.toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱىئؤة٠-٩]/g, (ch) => CHAR_MAP[ch]);
  if (!folded) return '';
  return /[\p{L}\p{N}]/u.test(folded) ? folded : ' ';
};

/** The folded text, and for each of its characters the index it came from. */
const foldWithMap = (text) => {
  let folded = '';
  const origin = [];
  for (let i = 0; i < text.length; i += 1) {
    const piece = foldChar(text[i]);
    for (const ch of piece) { folded += ch; origin.push(i); }
  }
  return { folded, origin };
};

const queryWords = (query) => foldWithMap(query).folded
  .split(' ')
  .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
  .filter((w) => w.length >= 2);

const stripArticle = (w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w);

/** The words of `text` a typed word may start: each word, and each without its "ال". */
const startableWords = (folded) => folded.split(' ').filter(Boolean).flatMap((w) => {
  const bare = stripArticle(w);
  return bare === w ? [w] : [w, bare];
});

/**
 * How well `label` matches what was typed, for filtering a short list (a dropdown's options).
 * Every typed word has to START a word of the label — "to" finds Toyota, not Proton; "ra"
 * finds Ramy, not every email with "ra" inside it. Folded like the search box, so "تويوتا"
 * matches "تويوتا", "الفرامل" matches "فرامل" and the other way round.
 *
 * 3 when the label starts with the typed text, 2 when the first typed word starts the
 * label's first word, 1 when every typed word starts some word, 0 when not. A typed number
 * (a phone, a SKU's digits) may sit anywhere in the label's digits, and scores 1.
 */
export const matchScore = (label, query) => {
  const text = foldWithMap(String(label || '')).folded.trim();
  const typed = foldWithMap(String(query || '')).folded.trim();
  if (!typed) return 1;
  if (!text) return 0;
  const words = typed.split(' ').filter(Boolean).map(stripArticle);
  const labelWords = startableWords(text);
  if (words.every((w) => labelWords.some((lw) => lw.startsWith(w)))) {
    if (text.startsWith(typed) || stripArticle(text).startsWith(typed)) return 3;
    const first = text.split(' ')[0];
    return first.startsWith(words[0]) || stripArticle(first).startsWith(words[0]) ? 2 : 1;
  }
  const digits = typed.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length === typed.replace(/ /g, '').length) {
    return text.replace(/\D/g, '').includes(digits) ? 1 : 0;
  }
  return 0;
};

/**
 * The items that answer to what was typed, best first — the one rule every dropdown's
 * search box uses. `textsOf(item)` lists what an item answers to, most telling first (a
 * vendor: store name, username, email, phone): a hit on the name outranks one on the email.
 * Ties keep the list's own order. Nothing typed: every item, as given.
 */
export const searchOptions = (items, query, textsOf) => {
  if (!String(query || '').trim()) return items;
  return items
    .map((item, index) => {
      let best = 0;
      textsOf(item).forEach((text, i) => {
        const score = matchScore(text, query);
        if (score) best = Math.max(best, score * 10 - i);
      });
      return { item, index, best };
    })
    .filter((row) => row.best > 0)
    .sort((a, b) => b.best - a.best || a.index - b.index)
    .map((row) => row.item);
};

/**
 * `text` cut into pieces, each `{ text, hit }`, where `hit` marks the typed words found in
 * it. Words matched only through a typo are not marked.
 *
 * `wordStart`: mark only where a word begins — what a dropdown's search matched (see
 * matchScore) — and from the first letter typed.
 */
export const highlightSegments = (text, query, { wordStart = false } = {}) => {
  const value = String(text || '');
  const words = wordStart
    ? foldWithMap(String(query || '')).folded.split(' ').filter(Boolean).map(stripArticle)
    : queryWords(query);
  if (!value || !words.length) return [{ text: value, hit: false }];

  const { folded, origin } = foldWithMap(value);
  const marked = new Array(value.length).fill(false);
  const startsWord = (at) => {
    if (at === 0 || folded[at - 1] === ' ') return true;
    // "فر" in "الفرامل": the word starts after its article.
    return at >= 2 && folded.slice(at - 2, at) === 'ال' && (at === 2 || folded[at - 3] === ' ');
  };
  for (const word of words) {
    let from = folded.indexOf(word);
    while (from !== -1) {
      if (!wordStart || startsWord(from)) {
        for (let k = from; k < from + word.length; k += 1) marked[origin[k]] = true;
      }
      from = folded.indexOf(word, from + word.length);
    }
  }

  const segments = [];
  for (let i = 0; i < value.length; i += 1) {
    const last = segments[segments.length - 1];
    if (last && last.hit === marked[i]) last.text += value[i];
    else segments.push({ text: value[i], hit: marked[i] });
  }
  return segments;
};
