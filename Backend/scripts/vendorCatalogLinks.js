/* ------------------ X-Turbo Auto Parts → catalog links ------------------
 *
 * 79 of this vendor's products name their manufacturer in the title ("… - AGO",
 * "… - BOSCH"). Every one was matched to a catalog entry BY READING IT, not by
 * trusting the part number: this vendor's numbers are inconsistent (leading
 * zeros dropped, catalogue codes concatenated), and AGO reuses its short codes
 * across unrelated parts. The number is used only to corroborate a match the
 * names already support.
 *
 * Matching relied on knowing that فرنا = فيرنا (Verna), بومه = the Lancer
 * generation, شارك = قرش (the other Lancer), HD = Elantra HD, تبخير = بخار,
 * منفول = مانفول — pairs no string comparison would connect.
 *
 * Four AGO codes carry TWO catalog entries because AGO published the same part
 * on two model pages under different names. The vendor sells ONE product for
 * both cars, which is independent evidence they are one part, so those pairs are
 * merged here and the survivor is renamed to name both cars.
 */

/* --- AGO entries that are one physical part, proven by the vendor's own SKU --- */
const MERGE = [
    { keep: '6a84f8ac572abc6c77dc91fc', merge: '6a84f8ac572abc6c77dc9248',
      title_ar: 'خرطوم فايز اسبرانزا + لانسر بومة (حرف L)',
      title_en: 'Speranza / Mitsubishi Lancer (Owl) Overflow Hose (L-Shaped)',
      why: 'vendor code 109 "خرطوم فايز بومه - اسبرانزا" is one SKU for both cars' },
    { keep: '6a84f8ac572abc6c77dc91ba', merge: '6a84f8ac572abc6c77dc924a',
      title_ar: 'خرطوم BYD + لانسر بومة صاعد تبريد',
      title_en: 'BYD / Mitsubishi Lancer (Owl) Upper Coolant Hose',
      why: 'vendor code 133 "خرطوم صاعد بومه - بي واي دي"' },
    { keep: '6a84f8ac572abc6c77dc91bc', merge: '6a84f8ac572abc6c77dc923e',
      title_ar: 'خرطوم BYD + لانسر بومة راجع تبريد',
      title_en: 'BYD / Mitsubishi Lancer (Owl) Lower Coolant Return Hose',
      why: 'vendor code 134 "خرطوم راجع بومه - بي واي دي"' },
    { keep: '6a84f8ac572abc6c77dc91be', merge: '6a84f8ac572abc6c77dc9240',
      title_ar: 'كوعة ردياتير BYD + لانسر بومة علوى',
      title_en: 'BYD / Mitsubishi Lancer (Owl) Upper Radiator Elbow Hose',
      why: 'vendor code 151 "كوعة علوي بومه - بي واي دي"' },
];

/* --- product _id → catalog entry _id --- */
const LINK = {
    // AGO
    '6a68e3672fac56eff9cb9d84': '6a84f8ac572abc6c77dc91ac', // 100 خرطوم بخار حرف تي → تبخير لانوس (حرف T)
    '6a68e3672fac56eff9cb9d86': '6a84f8ac572abc6c77dc91ae', // 101 وصلة زيت لانوس → وصلة تبخير لانوس (حرف L)
    '6a68e3672fac56eff9cb9d9a': '6a84f8ac572abc6c77dc91e2', // 102 وصلة زيت نوبيرا → وصلة تبخير نوبيرا (حرف L)
    '6a68e3672fac56eff9cb9d9c': '6a84f8ac572abc6c77dc91e4', // 103 وصلة زيت يو نوبيرا → وصلة تبخير نوبيرا (حرف ا)
    '6a68e3672fac56eff9cb9b01': '6a84f8ac572abc6c77dc91de', // 104 باور فيرنا صغير
    '6a68e3672fac56eff9cb9b03': '6a84f8ac572abc6c77dc91e0', // 105 باور فيرنا وسط
    '6a68e3672fac56eff9cb9b05': '6a84f8ac572abc6c77dc91ca', // 106 باور فيرنا كبير
    '6a68e3672fac56eff9cb9d88': '6a84f8ac572abc6c77dc91b0', // 107 قربة مياه لانوس (عكاز)
    '6a68e3672fac56eff9cb9d8a': '6a84f8ac572abc6c77dc9190', // 108 زيت مانفول دايو → تبخير منفول (سماعة)
    '6a68e3682fac56eff9cb9dc6': '6a84f8ac572abc6c77dc91fc', // 109 فايز بومه/اسبرانزا → merged survivor
    '6a68e3672fac56eff9cb9d9e': '6a84f8ac572abc6c77dc9238', // 110 اوبترا راجع
    '6a68e3672fac56eff9cb9da0': '6a84f8ac572abc6c77dc922a', // 111 اوبترا صاعد
    '6a68e3672fac56eff9cb9d8c': '6a84f8ac572abc6c77dc9192', // 112 قربة ردياتير لانوس
    '6a68e3672fac56eff9cb9d8e': '6a84f8ac572abc6c77dc9194', // 113 حوض لانوس
    '6a68e3682fac56eff9cb9dee': '6a84f8ac572abc6c77dc922c', // 120 فوق التقسيمة اوبترا
    '6a68e3672fac56eff9cb9d90': '6a84f8ac572abc6c77dc9196', // 121 شجرة مياه لانوس
    '6a68e3672fac56eff9cb9b09': '6a84f8ac572abc6c77dc91cc', // 130 صاعد فيرنا → سخن الصاعد
    '6a68e3672fac56eff9cb9d92': '6a84f8ac572abc6c77dc9198', // 132 من القربة للمنفول لانوس
    '6a68e3682fac56eff9cb9dc8': '6a84f8ac572abc6c77dc91ba', // 133 صاعد بومه/BYD → merged survivor
    '6a68e3682fac56eff9cb9dca': '6a84f8ac572abc6c77dc91bc', // 134 راجع بومه/BYD → merged survivor
    '6a68e3672fac56eff9cb9d94': '6a84f8ac572abc6c77dc919a', // 145 باور لانوس → وصلة ضغط عمومي
    '6a68e3672fac56eff9cb9afd': '6a84f8ac572abc6c77dc924e', // 146 كوعة جنب فيرنا
    '6a68e3682fac56eff9cb9de8': '6a84f8ac572abc6c77dc91d0', // 147 كوعة علوي فيرنا
    '6a68e3672fac56eff9cb9aff': '6a84f8ac572abc6c77dc91d2', // 148 كوعة سفلي فيرنا
    '6a68e3672fac56eff9cb9d80': '6a84f8ac572abc6c77dc919c', // 149 كوعة علوي لانوس
    '6a68e3682fac56eff9cb9dea': '6a84f8ac572abc6c77dc919e', // 150 كوعة سفلي لانوس
    '6a68e3682fac56eff9cb9dc2': '6a84f8ac572abc6c77dc91be', // 151 كوعة علوي بومه/BYD → merged survivor
    '6a68e3682fac56eff9cb9dc4': '6a84f8ac572abc6c77dc9242', // 152 كوعة سفلي بومه
    '6a68e3672fac56eff9cb9d82': '6a84f8ac572abc6c77dc91a0', // 154 كوعة جنب لانوس
    '6a68e3682fac56eff9cb9dfc': '6a84f8ac572abc6c77dc9286', // 155 كوعة علوي سيراتو/HD
    '6a68e3682fac56eff9cb9db6': '6a84f8ac572abc6c77dc9280', // 156 كوعة سفلي سيراتو/HD
    '6a68e3682fac56eff9cb9dec': '6a84f8ac572abc6c77dc91ec', // 158 كوعة علوي نوبيرا
    '6a68e3672fac56eff9cb9d98': '6a84f8ac572abc6c77dc91ee', // 159 كوعة سفلي نوبيرا
    '6a68e3672fac56eff9cb9da6': '6a84f8ac572abc6c77dc9266', // 160 كوعة افيو علوي اتوماتيك
    '6a68e3682fac56eff9cb9df4': '6a84f8ac572abc6c77dc9202', // 165 كوعة علوي اكسنت
    '6a68e3682fac56eff9cb9df0': '6a84f8ac572abc6c77dc9230', // 166 كوعة علوي اوبترا
    '6a68e3682fac56eff9cb9dfe': '6a84f8ac572abc6c77dc9272', // 172 كوعة علوي N16
    '6a68e3682fac56eff9cb9dd4': '6a84f8ac572abc6c77dc9274', // 173 كوعة سفلي N16
    '6a68e3682fac56eff9cb9de0': '6a84f8ac572abc6c77dc9276', // 182 كوعة علوي N17
    '6a68e3682fac56eff9cb9de2': '6a84f8ac572abc6c77dc9278', // 183 كوعة سفلي N17
    '6a68e3682fac56eff9cb9dde': '6a84f8ac572abc6c77dc927a', // 184 كوعة جنب N17
    '6a68e3682fac56eff9cb9de6': '6a84f8ac572abc6c77dc9244', // 192 مسمار ميزان بومه → لانسر
    '6a68e3672fac56eff9cb9daa': '6a84f8ac572abc6c77dc9232', // 201 اوبترا قربة → ردياتير
    '6a68e3682fac56eff9cb9df2': '6a84f8ac572abc6c77dc9234', // 202 اوبترا قربة → بوابة
    '6a68e3672fac56eff9cb9d96': '6a84f8ac572abc6c77dc91aa', // 203 زيت باور سفلي لانوس
    '6a68e3672fac56eff9cb9b0b': '6a84f8ac572abc6c77dc91d4', // 205 زيت فيرنا → بور مكنة الزيت
    '6a68e3672fac56eff9cb9b0d': '6a84f8ac572abc6c77dc91d6', // 206 بلف هواء فيرنا كبير
    '6a68e3672fac56eff9cb9b0f': '6a84f8ac572abc6c77dc91d8', // 207 بلف هواء فيرنا صغير
    '6a68e3672fac56eff9cb9da8': '6a84f8ac572abc6c77dc925c', // 209 تبريد افيو
    '6a68e3682fac56eff9cb9db8': '6a84f8ac572abc6c77dc9282', // 210 سخن سيراتو
    '6a68e3682fac56eff9cb9dba': '6a84f8ac572abc6c77dc9284', // 211 تبريد سيراتو
    '6a68e3672fac56eff9cb9dac': '6a84f8ac572abc6c77dc9236', // 228 قربة مياه اوبترا
    '6a68e3672fac56eff9cb9da4': '6a84f8ac572abc6c77dc91f0', // 229 خلفي وش سلندر نوبيرا
    '6a68e3682fac56eff9cb9dd0': '6a84f8ac572abc6c77dc920c', // 301 كوعة علوي شارك 97 → لانسر قرش
    '6a68e3682fac56eff9cb9dd2': '6a84f8ac572abc6c77dc920a', // 302 كوعة سفلي شارك 97 → لانسر قرش
    '6a68e3682fac56eff9cb9dae': '6a84f8ac572abc6c77dc9204', // 355 كوعة علوي اكسنت RB
    '6a68e3682fac56eff9cb9db0': '6a84f8ac572abc6c77dc9206', // 356 كوعة سفلي RB
    '6a68e3682fac56eff9cb9df6': '6a84f8ac572abc6c77dc921a', // 401 كوعة علوي 2 MD
};

/* Bosch links are resolved by part number at run time — the vendor drops leading
   zeros ("580454140" for 0580454140) and adds a space ("F5969" for "F 5969"),
   so the lookup normalises before comparing and the result is verified by name. */
const BOSCH_BY_PART = {
    'F5969': 'F 5969',            // فلتر بنزين لانوس/اوبترا/افيو  → Bosch Fuel Filters F 5969
    'F5921': 'F5921',             // فلتر بنزين BYD                → Bosch Fuel Filters F5921
    '580454140': '0580454140',    // قلب طلمبة بنزين               → Bosch Fuel Pumps (leading zero)
    'VR8SC+ \\ 79075': '79075',   // طقم بوجيهات N17               → Nickel with Copper Spark Plugs
};

/* Deliberately NOT linked. The vendor's number 242235666770 matches no Bosch
   part, and the title ("كل السيارات اليابانى والكورى، ١ شمعة، سن ١٦، INDIA")
   describes a generic plug, not a SKU. There are 232 Nickel-with-Copper plug
   entries; picking one would be a guess dressed up as data. */
const UNRESOLVED = ['242235666770'];

/* --- Vendor products with NO counterpart in the catalog ---
 *
 * These 16 AGO parts are real — the vendor stocks them — but AGO never published
 * them on the site the catalog was built from, so there is nothing to link to.
 *
 * They stay UNLINKED. Creating a catalog entry out of a vendor's own title is
 * the opposite direction: the catalog is the template library that products
 * attach to, not a place to deposit whatever a vendor happens to sell. An entry
 * for these has to come from AGO, or from an admin deciding to author one.
 *
 * The translated titles are kept only so whoever authors those entries later has
 * the reading already done. Nothing consumes them.
 */
const HOSES = '6a05bf082edec79ade4e7a32';
const NO_CATALOG_MATCH = [
    { pn: '144', product: '6a68e3672fac56eff9cb9da2', cat: HOSES, cars: [['Daewoo', 'Nubira']],
      ar: 'خرطوم باور راجع دايو نوبيرا', en: 'Daewoo Nubira Power Steering Return Hose' },
    { pn: '223', product: '6a68e3682fac56eff9cb9dbc', cat: HOSES, cars: [['Kia', 'Cerato']],
      ar: 'خرطوم هواء كيا سيراتو', en: 'Kia Cerato Air Hose' },
    { pn: '230', product: '6a68e3682fac56eff9cb9dda', cat: HOSES, cars: [['Nissan', 'Sunny']],
      ar: 'خرطوم زيت باور نيسان N16 كبير', en: 'Nissan N16 Power Steering Oil Hose — Large' },
    { pn: '231', product: '6a68e3682fac56eff9cb9ddc', cat: HOSES, cars: [['Nissan', 'Sunny']],
      ar: 'خرطوم زيت باور نيسان N16 صغير', en: 'Nissan N16 Power Steering Oil Hose — Small' },
    { pn: '241', product: '6a68e3682fac56eff9cb9dd6', cat: HOSES, cars: [['Nissan', 'Sunny']],
      ar: 'خرطوم نيسان N16 صاعد تبريد', en: 'Nissan N16 Upper Coolant Hose' },
    { pn: '244', product: '6a68e3682fac56eff9cb9dd8', cat: HOSES, cars: [['Nissan', 'Sunny']],
      ar: 'خرطوم نيسان N16 راجع تبريد', en: 'Nissan N16 Lower Coolant Return Hose' },
    { pn: '252', product: '6a68e3682fac56eff9cb9dbe', cat: HOSES, cars: [['Hyundai', 'Elantra']],
      ar: 'خرطوم باور هيونداي النترا HD كبير', en: 'Hyundai Elantra HD Power Steering Hose — Large' },
    { pn: '253', product: '6a68e3682fac56eff9cb9dc0', cat: HOSES, cars: [['Hyundai', 'Elantra']],
      ar: 'خرطوم باور هيونداي النترا HD صغير', en: 'Hyundai Elantra HD Power Steering Hose — Small' },
    { pn: '257', product: '6a68e3682fac56eff9cb9de4', cat: HOSES, cars: [['Kia', 'Carens']],
      ar: 'كوعة ردياتير كيا كارينز سفلى', en: 'Kia Carens Lower Radiator Elbow Hose' },
    { pn: '258', product: '6a68e3682fac56eff9cb9db4', cat: HOSES, cars: [['Hyundai', 'Tucson']],
      ar: 'كوعة ردياتير هيونداي توسان 2022 سفلى', en: 'Hyundai Tucson 2022 Lower Radiator Elbow Hose' },
    { pn: '259', product: '6a68e3682fac56eff9cb9df8', cat: HOSES,
      cars: [['Hyundai', 'Tucson'], ['Kia', 'Sportage'], ['Kia', 'Carens']],
      ar: 'كوعة ردياتير هيونداي توسان 2022 + كيا سبورتاج 2017 + كارينز 2014 علوى (1)',
      en: 'Hyundai Tucson 2022 / Kia Sportage 2017 / Kia Carens 2014 Upper Radiator Elbow Hose (1)' },
    { pn: '260', product: '6a68e3682fac56eff9cb9dfa', cat: HOSES, cars: [['Hyundai', 'Tucson']],
      ar: 'كوعة ردياتير هيونداي توسان علوى (2)', en: 'Hyundai Tucson Upper Radiator Elbow Hose (2)' },
    { pn: '262', product: '6a68e3682fac56eff9cb9dcc', cat: HOSES, cars: [['Mitsubishi', 'Lancer']],
      ar: 'خرطوم تبريد لانسر بومة', en: 'Mitsubishi Lancer (Owl) Cooling Hose' },
    { pn: '263', product: '6a68e3682fac56eff9cb9dce', cat: HOSES, cars: [['Mitsubishi', 'Lancer']],
      ar: 'خرطوم تبريد راجع لانسر بومة', en: 'Mitsubishi Lancer (Owl) Cooling Return Hose' },
    // ix35 is the Tucson's export name; carbrands lists the model as Tucson.
    { pn: '268', product: '6a68e3682fac56eff9cb9db2', cat: HOSES, cars: [['Hyundai', 'Tucson']],
      ar: 'كوعة ردياتير هيونداي ix35 سفلى', en: 'Hyundai ix35 Lower Radiator Elbow Hose' },
    { pn: '304', product: '6a68e3672fac56eff9cb9b07', cat: HOSES,
      cars: [['Hyundai', 'Verna'], ['Hyundai', 'Accent']],
      ar: 'كوعة ردياتير هيونداي فيرنا 1600 + اكسنت سفلى',
      en: 'Hyundai Verna 1600 / Accent Lower Radiator Elbow Hose' },
];

module.exports = { MERGE, LINK, BOSCH_BY_PART, UNRESOLVED, NO_CATALOG_MATCH };
