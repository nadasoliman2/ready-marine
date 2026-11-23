/**
 * Where a vendor's money can be sent through Paymob Payouts, and how each destination is
 * validated. Mirrors the "Instant Cashin" section of the Payouts docs
 * (https://payouts.paymobsolutions.com/docs/instant_cashin_api/) — and offers nothing Paymob
 * cannot send to: every method saved here is one a payout can be disbursed to as it stands.
 *
 * THE VENDOR PICKS A `type`, which is how the form is laid out, and each type carries
 * exactly the fields Paymob requires for it:
 *
 *   account  a bank account, by account number  -> full_name + bank_code + account number
 *   iban     a bank account, by IBAN            -> full_name + bank_code + IBAN
 *   card     a bank card                        -> card number + full_name + bank_code
 *   wallet   a mobile wallet                    -> msisdn + whose wallet it is
 *
 * EACH TYPE IS SENT ON AN `issuer`, the word Paymob routes by: a wallet on its provider
 * (vodafone | etisalat | orange | bank_wallet), a card on `bank_card`, and a bank account
 * on whichever of the two bank channels the vendor chose.
 *
 * Bank codes are case-sensitive at Paymob and the two bank channels use DIFFERENT lists —
 * `bank_card` (~2 working days; account number, IBAN or card) and `instant_bank` (minutes
 * to hours, 112 EGP minimum; IBAN only — Paymob turns an account number away there with
 * "bank_card_number must be a valid IBAN format for instant_bank transactions").
 */

const WALLET_ISSUERS = ["vodafone", "etisalat", "orange", "bank_wallet"];
const BANK_ISSUERS = ["bank_card", "instant_bank"];
const ISSUERS = [...WALLET_ISSUERS, ...BANK_ISSUERS];

const TYPES = ["account", "iban", "card", "wallet"];

const ISSUER_LABELS = {
  vodafone: { en: "Vodafone Cash", ar: "فودافون كاش" },
  etisalat: { en: "e& Cash (Etisalat)", ar: "اتصالات كاش" },
  orange: { en: "Orange Cash", ar: "أورنج كاش" },
  bank_wallet: { en: "Bank wallet (Meeza / WE Pay …)", ar: "محفظة بنكية" },
  bank_card: { en: "Standard transfer (~2 working days)", ar: "تحويل عادي (خلال يومي عمل)" },
  instant_bank: { en: "Fast transfer (minutes to hours)", ar: "تحويل سريع (دقايق لساعات)" },
};

// What the vendor chose, in the form's words. A wallet is named by whose wallet it is.
const TYPE_LABELS = {
  account: { en: "Bank account", ar: "حساب بنكي" },
  iban: { en: "Bank account (IBAN)", ar: "حساب بنكي (IBAN)" },
  card: { en: "Bank card", ar: "كارت بنكي" },
};

// For issuer bank_card.
const BANK_CARD_CODES = {
  AUB: "Ahli United Bank", MIDB: "MIDBANK", BDC: "Banque Du Caire", HSBC: "HSBC Bank Egypt S.A.E",
  CAE: "Credit Agricole Egypt S.A.E", EGB: "Egyptian Gulf Bank", UB: "The United Bank",
  QNB: "Qatar National Bank Alahli", ARAB: "Arab Bank PLC", ENBD: "Emirates National Bank of Dubai",
  ABK: "Al Ahli Bank of Kuwait – Egypt", NBK: "National Bank of Kuwait – Egypt",
  ABC: "Arab Banking Corporation - Egypt S.A.E", FAB: "First Abu Dhabi Bank",
  ADIB: "Abu Dhabi Islamic Bank – Egypt", CIB: "Commercial International Bank - Egypt S.A.E",
  HDB: "Housing And Development Bank", MISR: "Banque Misr", AAIB: "Arab African International Bank",
  EALB: "Egyptian Arab Land Bank", EDBE: "Export Development Bank of Egypt",
  FAIB: "Faisal Islamic Bank of Egypt", BLOM: "Blom Bank", ADCB: "Abu Dhabi Commercial Bank – Egypt",
  BOA: "Alex Bank Egypt", SAIB: "Societe Arabe Internationale De Banque", NBE: "National Bank of Egypt",
  ABRK: "Al Baraka Bank Egypt B.S.C.", POST: "Egypt Post", NSB: "Nasser Social Bank",
  IDB: "Industrial Development Bank", SCB: "Suez Canal Bank", MASH: "Mashreq Bank",
  AIB: "Arab Investment Bank", GASC: "General Authority For Supply Commodities",
  ARIB: "Arab International Bank", PDAC: "Agricultural Bank of Egypt", NBG: "National Bank of Greece",
  CBE: "Central Bank Of Egypt", BBE: "ATTIJARIWAFA BANK Egypt",
};

// For issuer instant_bank.
const INSTANT_BANK_CODES = {
  AAIB: "Arab African International Bank", ABE: "ABE Bank", ABK: "Al Ahli Bank of Kuwait – Egypt",
  ADCB: "Abu Dhabi Commercial Bank – Egypt", AIB: "Arab Investment Bank", AIBANK: "aiBANK",
  AUB: "Ahli United Bank", BDC: "Banque Du Caire", CAE: "Credit Agricole Egypt S.A.E",
  CBE: "Central Bank Of Egypt", CIB: "Commercial International Bank - Egypt S.A.E", CITIBANK: "Citibank",
  EALB: "Egyptian Arab Land Bank", EBE: "Export Development Bank of Egypt",
  ENBD: "Emirates National Bank of Dubai", FAB: "First Abu Dhabi Bank", FAIB: "Faisal Islamic Bank of Egypt",
  HDB: "Housing And Development Bank", HSBC: "HSBC Bank Egypt S.A.E",
  IDBD: "Industrial Development & Workers Bank of Egypt", MCDR: "Misr Credit & Development",
  MIDBANK: "MIDBANK", NBE: "National Bank of Egypt", NBG: "National Bank of Greece",
  NBK: "National Bank of Kuwait – Egypt", NSB: "Nasser Social Bank", QNB: "Qatar National Bank Alahli",
  SAIB: "Societe Arabe Internationale De Banque", UB: "The United Bank", ABRK: "Al Baraka Bank Egypt B.S.C",
  ARAB: "Arab Bank PLC", BBE: "Attijariwafa Bank", ABC: "Arab Banking Corporation - Egypt S.A.E",
  MISR: "Banque Misr", EGB: "Egyptian Gulf Bank (EG-Bank)", POST: "Egypt Post", MASH: "Mashreq Bank",
  NIB: "National Investment Bank", SCB: "Suez Canal Bank", BOA: "Alex Bank Egypt",
  ADIB: "Abu Dhabi Islamic Bank – Egypt",
};

// Paymob's floor for `instant_bank` transfers.
const MIN_AMOUNT = { instant_bank: 112 };

const bankCodesFor = (issuer) =>
  issuer === "bank_card" ? BANK_CARD_CODES : issuer === "instant_bank" ? INSTANT_BANK_CODES : {};

const invalid = (message) => Object.assign(new Error(message), { code: "INVALID_INPUT" });

/** Arabic-Indic and Persian digits typed on phones → ASCII. */
const asciiDigits = (s) =>
  String(s ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** "+20 10 2345 6789" / "201023456789" / "01023456789" → "01023456789" (Paymob adds the +2). */
const normaliseMsisdn = (raw) => {
  let d = asciiDigits(raw).replace(/\D/g, "");
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("1")) d = `0${d}`;
  return d;
};

/** "EG38 0019 …" / "38 0019 …" (typed after the form's EG prefix) → "EG380019…". */
const normaliseIban = (raw) => {
  const s = asciiDigits(raw).toUpperCase().replace(/[\s-]/g, "");
  return /^\d{27}$/.test(s) ? `EG${s}` : s;
};

/**
 * Which of the form's choices a method is. A method saved before `type` existed says it
 * through its issuer and the shape of its number.
 */
const typeOf = (m) => {
  if (TYPES.includes(m?.type)) return m.type;
  const issuer = String(m?.issuer || "").trim().toLowerCase();
  if (WALLET_ISSUERS.includes(issuer)) return "wallet";
  if (!BANK_ISSUERS.includes(issuer)) return null;
  const number = normaliseIban(m.bank_card_number);
  if (/^EG/.test(number)) return "iban";
  return issuer === "bank_card" && /^\d{16}$/.test(number) ? "card" : "account";
};

/**
 * Validate and normalise what a vendor typed. Returns the clean object to store, or throws
 * INVALID_INPUT with a sentence the vendor can act on.
 */
const normaliseMethod = (input = {}) => {
  const type = typeOf(input);
  if (!type) throw invalid("Choose how you want to receive your money.");
  const named = String(input.issuer || "").trim().toLowerCase();

  if (type === "wallet") {
    if (!WALLET_ISSUERS.includes(named)) throw invalid("Choose which wallet this number is on.");
    const msisdn = normaliseMsisdn(input.msisdn);
    if (!/^01[0125]\d{8}$/.test(msisdn)) {
      throw invalid("Enter the wallet's 11-digit Egyptian mobile number, e.g. 01012345678.");
    }
    return { type, issuer: named, msisdn, bank_card_number: null, bank_code: null, full_name: input.full_name ? String(input.full_name).trim().slice(0, 120) : null };
  }

  const full_name = String(input.full_name || "").trim().replace(/\s+/g, " ");
  if (full_name.length < 5 || full_name.split(" ").length < 2) {
    throw invalid(type === "card"
      ? "Enter the card holder's full name exactly as it is on the card."
      : "Enter the beneficiary's full name exactly as the bank has it.");
  }
  // A card only travels on `bank_card`; a bank account on whichever channel was chosen.
  const issuer = type !== "card" && named === "instant_bank" ? "instant_bank" : "bank_card";
  const bank_code = String(input.bank_code || "").trim();
  if (!bankCodesFor(issuer)[bank_code]) throw invalid("Choose the bank from the list.");

  const number = normaliseIban(input.bank_card_number);
  if (type === "iban" && !/^EG\d{27}$/.test(number)) {
    throw invalid("Enter the IBAN: EG followed by 27 digits.");
  }
  if (type === "card" && !/^\d{16,19}$/.test(number)) {
    throw invalid("Enter the card number: the 16 digits on the front of the card.");
  }
  if (type === "account" && issuer === "instant_bank") {
    throw invalid("A fast transfer needs the account's IBAN. Enter the IBAN instead, or choose the standard transfer to use the account number.");
  }
  if (type === "account" && !/^\d{6,29}$/.test(number)) {
    throw invalid("Enter the account number (digits only).");
  }
  return { type, issuer, msisdn: null, bank_card_number: number, bank_code, full_name: full_name.slice(0, 120) };
};

const isComplete = (m) => {
  try { normaliseMethod(m || {}); return true; } catch (_) { return false; }
};

/** Why a saved method cannot be paid to, in the vendor's terms, or null when it can. */
const problemWith = (m) => {
  try { normaliseMethod(m || {}); return null; } catch (err) { return err.message; }
};

/** "Vodafone Cash · 010•••••789" — for lists and invoices; never the whole number. */
const mask = (value, keep = 3) => {
  const s = String(value || "");
  if (s.length <= keep * 2) return s;
  return `${s.slice(0, keep)}${"•".repeat(Math.max(3, s.length - keep * 2))}${s.slice(-keep)}`;
};

const describe = (m, { masked = true } = {}) => {
  if (!m?.issuer) return null;
  const type = typeOf(m);
  const via = ISSUER_LABELS[m.issuer] || { en: m.issuer, ar: m.issuer };
  // "Vodafone Cash", "Bank card", "Bank account — Fast transfer (…)".
  const kind = TYPE_LABELS[type];
  const label = !kind ? via
    : m.issuer === "instant_bank" ? { en: `${kind.en} — ${via.en}`, ar: `${kind.ar} — ${via.ar}` }
    : kind;
  const bankName = m.bank_code ? bankCodesFor(m.issuer)[m.bank_code] || m.bank_code : null;
  const account = WALLET_ISSUERS.includes(m.issuer) ? m.msisdn : m.bank_card_number;
  return {
    type,
    issuer: m.issuer,
    label,
    bank_code: m.bank_code || null,
    bank_name: bankName,
    full_name: m.full_name || null,
    account: masked ? mask(account) : account,
  };
};

/** The body Paymob's /disburse/ expects for this destination. */
const disbursePayload = (m, amount) => {
  const base = { issuer: m.issuer, amount: Number(Number(amount).toFixed(2)) };
  if (WALLET_ISSUERS.includes(m.issuer)) return { ...base, msisdn: m.msisdn };
  const bank = { ...base, bank_card_number: m.bank_card_number, bank_code: m.bank_code, full_name: m.full_name };
  if (m.issuer === "bank_card") bank.bank_transaction_type = "cash_transfer";
  return bank;
};

module.exports = {
  ISSUERS,
  WALLET_ISSUERS,
  BANK_ISSUERS,
  ISSUER_LABELS,
  BANK_CARD_CODES,
  INSTANT_BANK_CODES,
  MIN_AMOUNT,
  bankCodesFor,
  normaliseMethod,
  normaliseMsisdn,
  typeOf,
  isComplete,
  problemWith,
  describe,
  mask,
  disbursePayload,
};
