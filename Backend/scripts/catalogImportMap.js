/* ------------------ Scraped-catalog → ready-car mapping ------------------
 *
 * Two scraped sources feed the central catalog:
 *   1. agopartspro.com  — 153 Arabic-named cooling hoses, one page per car model.
 *   2. boschautoparts.com — 37,668 parts with English names, specs and US fitment.
 *
 * Neither source publishes a ready-car category, so every part is placed here by
 * hand. The mapping key is Bosch's PRODUCT LINE (e.g. "QuietCast Premium Disc
 * Brake Pads"), not its category: the category field collapses 4,162 parts into
 * "Home" and another 346 into "Products", while the line name is specific for
 * every single row. Bosch's own category is only the fallback.
 *
 * `ar` is the Arabic label used to build title_ar / subtitle_ar. The sources give
 * no Arabic text at all for Bosch, and the vendor-facing catalog search is Arabic
 * first, so an entry without one is effectively invisible to the people who use it.
 */

/* Category ids, resolved once against the live `categories` collection.
   Several names are NOT unique (there are two "Injectors", two "Fuel Filter",
   two "Shock absorbers"), which is why these are ids and not name lookups. */
const CAT = {
    BRAKE_PADS:   '6a05bf082edec79ade4e7a06', // بطانات الفرامل
    BRAKE_DISCS:  '6a05bf082edec79ade4e7a05', // أقراص الفرامل
    DRUM_BRAKE:   '6a05bf082edec79ade4e7a07', // فرامل الأسطوانة
    BRAKES:       '6a05bf082edec79ade4e7a04', // الفرامل (parent, used when no leaf fits)
    BRAKE_FLUID:  '6a05bf082edec79ade4e79e4', // سائل الفرامل
    CHARGING:     '6a05bf082edec79ade4e7a21', // الشحن (alternators, chargers)
    STARTER:      '6a05bf082edec79ade4e7a22', // باديء الحركة
    BATTERY:      '6a05bf082edec79ade4e7a20', // البطارية
    SENSORS:      '6a05bf082edec79ade4e7a23', // حساسات السيارة
    OTHER_ELEC:   '6a05bf082edec79ade4e7a25', // مكونات كهربائية أخرى
    FUEL_PUMP:    '6a05bf082edec79ade4e7a17', // مضخة الوقود
    FUEL_INJ:     '6a05bf082edec79ade4e7a15', // البخاخات (نظام الوقود)
    FUEL_SYSTEM:  '6a05bf082edec79ade4e7a14', // نظام الوقود
    FUEL_FILTER:  '6a05bf082edec79ade4e7a3e', // فلتر الوقود (فلاتر)
    CABIN_FILTER: '6a05bf082edec79ade4e7a3d', // فلتر المقصورة
    OIL_FILTER:   '6a05bf082edec79ade4e7a3f', // فلتر زيت
    AIR_FILTER:   '6a05bf082edec79ade4e7a40', // فلتر هواء
    SPARK_PLUGS:  '6a05bf082edec79ade4e7a30', // شمعات الإشعال
    WIPERS:       '6a05bf082edec79ade4e7a4e', // شفرات مساحات الزجاج
    STEERING:     '6a05bf082edec79ade4e7a11', // نظام التوجيه
    WATER_PUMP:   '6a05bf082edec79ade4e7a34', // مضخة الماء
    COOLING:      '6a05bf082edec79ade4e7a31', // مكونات نظام التبريد
    RADIATOR:     '6a05bf082edec79ade4e7a33', // المبرد
    HOSES:        '6a05bf082edec79ade4e7a32', // الخراطيم
    EXHAUST:      '6a05bf082edec79ade4e7a0a', // قطع العادم
    ENGINE_MAIN:  '6a05bf082edec79ade4e7a27', // مكونات المحرك الرئيسية
    GASKETS:      '6a05bf082edec79ade4e7a28', // الحشوات
    CONTROL_ARMS: '6a05bf082edec79ade4e7a57', // المقصات
    SUSP_LINKS:   '6a05bf082edec79ade4e7a5a', // وصلات التعليق
};

/* Bosch product line → { cat, ar }. Exact, case-insensitive match on the line
   name. Anything not listed falls through to LINE_PATTERNS, then CATEGORY_MAP. */
const LINE_MAP = {
    // --- Brakes ---
    'euroline brake pads':                                  { cat: CAT.BRAKE_PADS, ar: 'بطانات فرامل Euroline' },
    'quietcast premium disc brake pads':                    { cat: CAT.BRAKE_PADS, ar: 'بطانات فرامل QuietCast Premium' },
    'blue disc brake pads':                                 { cat: CAT.BRAKE_PADS, ar: 'بطانات فرامل Blue' },
    'police pursuit brake pads':                            { cat: CAT.BRAKE_PADS, ar: 'بطانات فرامل Police Pursuit' },
    'pastillas para frenos de disco quietcast™ premium':    { cat: CAT.BRAKE_PADS, ar: 'بطانات فرامل QuietCast Premium' },
    'pastillas para frenos de disco azules':                { cat: CAT.BRAKE_PADS, ar: 'بطانات فرامل Blue' },
    'quietcast premium disc brake rotors':                  { cat: CAT.BRAKE_DISCS, ar: 'أقراص فرامل QuietCast Premium' },
    'rotores para frenos de disco quietcast™ premium':      { cat: CAT.BRAKE_DISCS, ar: 'أقراص فرامل QuietCast Premium' },
    'blue brake shoes':                                     { cat: CAT.DRUM_BRAKE, ar: 'تيل فرامل طنبورة Blue' },
    'zapata de freno azul':                                 { cat: CAT.DRUM_BRAKE, ar: 'تيل فرامل طنبورة Blue' },
    'brake boosters':                                       { cat: CAT.BRAKES, ar: 'خادم فرامل (بوستر)' },
    'hydro-boost® power brake assembly':                    { cat: CAT.BRAKES, ar: 'مجموعة خادم فرامل هيدروليكي' },
    'esi6 brake fluid':                                     { cat: CAT.BRAKE_FLUID, ar: 'زيت فرامل ESI6' },
    'liquido de frenos':                                    { cat: CAT.BRAKE_FLUID, ar: 'زيت فرامل' },
    'brakes':                                               { cat: CAT.BRAKES, ar: 'فرامل' },
    'frenos':                                               { cat: CAT.BRAKES, ar: 'فرامل' },

    // --- Charging / starting ---
    '100% new alternators':                                 { cat: CAT.CHARGING, ar: 'دينامو شحن جديد' },
    'remanufactured alternators':                           { cat: CAT.CHARGING, ar: 'دينامو شحن مجدد' },
    'alternadores 100% nuevos':                             { cat: CAT.CHARGING, ar: 'دينامو شحن جديد' },
    'alternadores reconstruidos':                           { cat: CAT.CHARGING, ar: 'دينامو شحن مجدد' },
    'universal alternators':                                { cat: CAT.CHARGING, ar: 'دينامو شحن' },
    'long haul school bus alternators':                     { cat: CAT.CHARGING, ar: 'دينامو شحن للحافلات' },
    'c-line battery chargers':                              { cat: CAT.CHARGING, ar: 'شاحن بطاريات C-Line' },
    '100% new starters':                                    { cat: CAT.STARTER, ar: 'مارش جديد' },
    '100% new starter':                                     { cat: CAT.STARTER, ar: 'مارش جديد' },
    'remanufactured starters':                              { cat: CAT.STARTER, ar: 'مارش مجدد' },
    'motor de arranque 100 % nuevo':                        { cat: CAT.STARTER, ar: 'مارش جديد' },
    'motores de arranque reconstruidos':                    { cat: CAT.STARTER, ar: 'مارش مجدد' },
    'long haul starters':                                   { cat: CAT.STARTER, ar: 'مارش للشاحنات' },

    // --- Batteries ---
    's3 batteries':                                         { cat: CAT.BATTERY, ar: 'بطارية S3' },
    's4 batteries':                                         { cat: CAT.BATTERY, ar: 'بطارية S4' },
    's5 batteries':                                         { cat: CAT.BATTERY, ar: 'بطارية S5' },
    's6 batteries':                                         { cat: CAT.BATTERY, ar: 'بطارية S6' },
    's6 agm high performance batteries':                    { cat: CAT.BATTERY, ar: 'بطارية S6 AGM عالية الأداء' },
    's6 high performance agm™ batteries':                   { cat: CAT.BATTERY, ar: 'بطارية S6 AGM عالية الأداء' },
    't4 quality performance batteries':                     { cat: CAT.BATTERY, ar: 'بطارية T4' },
    't5 dual purpose performance batteries':                { cat: CAT.BATTERY, ar: 'بطارية T5' },
    't6 high performance agm batteries':                    { cat: CAT.BATTERY, ar: 'بطارية T6 AGM' },
    'lithium powersport batteries':                         { cat: CAT.BATTERY, ar: 'بطارية ليثيوم PowerSport' },
    'lithium leisure batteries':                            { cat: CAT.BATTERY, ar: 'بطارية ليثيوم Leisure' },
    'batteries and chargers':                               { cat: CAT.BATTERY, ar: 'بطاريات وشواحن' },
    'pilas':                                                { cat: CAT.BATTERY, ar: 'بطاريات' },

    // --- Sensors ---
    'premium oxygen sensors':                               { cat: CAT.SENSORS, ar: 'حساس أكسجين Premium' },
    'premium wideband a/f oxygen sensors':                  { cat: CAT.SENSORS, ar: 'حساس أكسجين واسع النطاق' },
    'universal oxygen sensors':                             { cat: CAT.SENSORS, ar: 'حساس أكسجين يونيفرسال' },
    'universal oxygen (o2) sensors':                        { cat: CAT.SENSORS, ar: 'حساس أكسجين يونيفرسال' },
    'sensores de oxígeno':                                  { cat: CAT.SENSORS, ar: 'حساس أكسجين' },
    'wheel speed sensors':                                  { cat: CAT.SENSORS, ar: 'حساس سرعة العجل (ABS)' },
    'crankshaft position sensors':                          { cat: CAT.SENSORS, ar: 'حساس عمود المرفق (الكرنك)' },
    'camshaft position sensors':                            { cat: CAT.SENSORS, ar: 'حساس عمود الكامات' },
    'knock sensors':                                        { cat: CAT.SENSORS, ar: 'حساس الطرق (الخبط)' },
    'mass airflow (maf) sensors':                           { cat: CAT.SENSORS, ar: 'حساس هواء (MAF)' },
    'mass air flow sensors':                                { cat: CAT.SENSORS, ar: 'حساس هواء (MAF)' },
    'manifold absolute pressure sensors':                   { cat: CAT.SENSORS, ar: 'حساس ضغط السحب (MAP)' },
    'high pressure sensors':                                { cat: CAT.SENSORS, ar: 'حساس ضغط عالي' },
    'low pressure sensors':                                 { cat: CAT.SENSORS, ar: 'حساس ضغط منخفض' },
    'liquid temperature sensors':                           { cat: CAT.SENSORS, ar: 'حساس حرارة السوائل' },
    'air temperature sensors':                              { cat: CAT.SENSORS, ar: 'حساس حرارة الهواء' },
    'throttle position sensors':                            { cat: CAT.SENSORS, ar: 'حساس وضع البوابة (TPS)' },
    'exhaust gas temperature sensors':                      { cat: CAT.SENSORS, ar: 'حساس حرارة العادم' },
    'particulate matter sensors':                           { cat: CAT.SENSORS, ar: 'حساس الجسيمات الدقيقة' },
    'nox sensors':                                          { cat: CAT.SENSORS, ar: 'حساس NOx' },
    'sensores de gestión del motor':                        { cat: CAT.SENSORS, ar: 'حساسات إدارة المحرك' },
    'engine management sensors':                            { cat: CAT.SENSORS, ar: 'حساسات إدارة المحرك' },
    'engine management':                                    { cat: CAT.SENSORS, ar: 'حساسات إدارة المحرك' },
    'tpms':                                                 { cat: CAT.SENSORS, ar: 'حساس ضغط الإطارات' },
    'tire pressure monitoring system sensors':              { cat: CAT.SENSORS, ar: 'حساس ضغط الإطارات' },
    'park pilot':                                           { cat: CAT.SENSORS, ar: 'حساس ركنة' },
    'adas':                                                 { cat: CAT.SENSORS, ar: 'أنظمة مساعدة السائق' },
    'tire and chassis':                                     { cat: CAT.SENSORS, ar: 'حساسات الإطارات والهيكل' },

    // --- Other electrical ---
    'ignition coils':                                       { cat: CAT.OTHER_ELEC, ar: 'كويل إشعال' },
    'piezas de encendido':                                  { cat: CAT.OTHER_ELEC, ar: 'قطع الإشعال' },
    'ignition parts':                                       { cat: CAT.OTHER_ELEC, ar: 'قطع الإشعال' },
    'distributor caps and rotors':                          { cat: CAT.OTHER_ELEC, ar: 'غطاء ودوّار الموزع' },
    'electronic stability program':                         { cat: CAT.OTHER_ELEC, ar: 'وحدة الثبات الإلكتروني (ESP)' },
    'rear view camera':                                     { cat: CAT.OTHER_ELEC, ar: 'كاميرا خلفية' },
    'mini relays':                                          { cat: CAT.OTHER_ELEC, ar: 'ريلاي ميني' },
    'micro relays':                                         { cat: CAT.OTHER_ELEC, ar: 'ريلاي مايكرو' },

    // --- Fuel ---
    'fuel pumps':                                           { cat: CAT.FUEL_PUMP, ar: 'طرمبة بنزين' },
    'fuel pump assemblies':                                 { cat: CAT.FUEL_PUMP, ar: 'مجموعة طرمبة بنزين' },
    'high pressure pump (hpp)':                             { cat: CAT.FUEL_PUMP, ar: 'طرمبة ضغط عالي' },
    'genuine oe high pressure pumps':                       { cat: CAT.FUEL_PUMP, ar: 'طرمبة ضغط عالي أصلية' },
    'remanufactured high pressure pumps':                   { cat: CAT.FUEL_PUMP, ar: 'طرمبة ضغط عالي مجددة' },
    'fuel system modules':                                  { cat: CAT.FUEL_PUMP, ar: 'مجموعة طرمبة بنزين' },
    'módulos del sistema de combustible':                   { cat: CAT.FUEL_PUMP, ar: 'مجموعة طرمبة بنزين' },
    'genuine oe injectors':                                 { cat: CAT.FUEL_INJ, ar: 'بخاخ أصلي' },
    'remanufactured common rail injectors':                 { cat: CAT.FUEL_INJ, ar: 'بخاخ كومون ريل مجدد' },
    'fuel injectors':                                       { cat: CAT.FUEL_INJ, ar: 'بخاخات' },
    'inyección de combustible':                             { cat: CAT.FUEL_INJ, ar: 'بخاخات' },
    'pfi':                                                  { cat: CAT.FUEL_INJ, ar: 'بخاخ حقن مرحلي (PFI)' },
    'gdi':                                                  { cat: CAT.FUEL_INJ, ar: 'بخاخ حقن مباشر (GDI)' },
    'glow plugs':                                           { cat: CAT.SPARK_PLUGS, ar: 'بوجيه سخّان (ديزل)' },
    'throttle bodies':                                      { cat: CAT.FUEL_SYSTEM, ar: 'بشلمانة (جسم خانق)' },
    'idle air control valves':                              { cat: CAT.FUEL_SYSTEM, ar: 'حساس/صمام هواء التعطيل' },
    'canister purge valves':                                { cat: CAT.FUEL_SYSTEM, ar: 'صمام تنفيس الكانستر' },
    'canister purge valve':                                 { cat: CAT.FUEL_SYSTEM, ar: 'صمام تنفيس الكانستر' },
    'leak detection pump':                                  { cat: CAT.FUEL_SYSTEM, ar: 'مضخة كشف التسريب' },
    'air management':                                       { cat: CAT.FUEL_SYSTEM, ar: 'إدارة الهواء' },
    'gestión del aire':                                     { cat: CAT.FUEL_SYSTEM, ar: 'إدارة الهواء' },
    'emission parts':                                       { cat: CAT.FUEL_SYSTEM, ar: 'قطع نظام الانبعاثات' },
    'fuel system':                                          { cat: CAT.FUEL_SYSTEM, ar: 'نظام الوقود' },

    // --- Filters ---
    'fuel filters':                                         { cat: CAT.FUEL_FILTER, ar: 'فلتر بنزين' },
    'cabin air filters':                                    { cat: CAT.CABIN_FILTER, ar: 'فلتر مكيف (مقصورة)' },
    'workshop cabin filters':                               { cat: CAT.CABIN_FILTER, ar: 'فلتر مكيف Workshop' },
    'hepa cabin filters':                                   { cat: CAT.CABIN_FILTER, ar: 'فلتر مكيف HEPA' },
    'hepa cabin filter':                                    { cat: CAT.CABIN_FILTER, ar: 'فلتر مكيف HEPA' },
    'premium oil filters':                                  { cat: CAT.OIL_FILTER, ar: 'فلتر زيت Premium' },
    'workshop oil filters':                                 { cat: CAT.OIL_FILTER, ar: 'فلتر زيت Workshop' },
    'oil filters':                                          { cat: CAT.OIL_FILTER, ar: 'فلتر زيت' },
    'filtros de aceite':                                    { cat: CAT.OIL_FILTER, ar: 'فلتر زيت' },
    'workshop air filters':                                 { cat: CAT.AIR_FILTER, ar: 'فلتر هواء Workshop' },
    'air filters':                                          { cat: CAT.AIR_FILTER, ar: 'فلتر هواء' },

    // --- Spark plugs ---
    'nickel with copper spark plugs':                       { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات نيكل/نحاس' },
    'double iridium spark plugs':                           { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات إيريديوم مزدوج' },
    'double iridium pin-to-pin spark plugs':                { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات إيريديوم Pin-to-Pin' },
    'iridium spark plugs':                                  { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات إيريديوم' },
    'double platinum spark plugs':                          { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات بلاتينيوم مزدوج' },
    'platinum spark plugs':                                 { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات بلاتينيوم' },
    'platinum +4 spark plugs':                              { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات بلاتينيوم +4' },
    'silver spark plugs':                                   { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات فضة' },
    'evo spark plugs':                                      { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات EVO' },
    'spark plugs':                                          { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات' },
    'bujías':                                               { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات' },

    // --- Wipers (every Bosch blade line, they are all wiper blades) ---
    'icon wiper blades':                                    { cat: CAT.WIPERS, ar: 'مساحات ICON' },
    'focus wiper blades':                                   { cat: CAT.WIPERS, ar: 'مساحات Focus' },
    'excel+ wiper blades':                                  { cat: CAT.WIPERS, ar: 'مساحات Excel+' },
    'primeactive™ wiper blades':                            { cat: CAT.WIPERS, ar: 'مساحات PrimeACTIVE' },
    'primeactive':                                          { cat: CAT.WIPERS, ar: 'مساحات PrimeActive' },
    'purevision™ wiper blades':                             { cat: CAT.WIPERS, ar: 'مساحات PureVision' },
    'purevision':                                           { cat: CAT.WIPERS, ar: 'مساحات PureVision' },
    'clear advantage™ wiper blades':                        { cat: CAT.WIPERS, ar: 'مساحات Clear Advantage' },
    'clear advantage':                                      { cat: CAT.WIPERS, ar: 'مساحات Clear Advantage' },
    'xpressfit pro™ wiper blades':                          { cat: CAT.WIPERS, ar: 'مساحات XpressFIT Pro' },
    'xpressfit pro':                                        { cat: CAT.WIPERS, ar: 'مساحات XpressFIT Pro' },
    'microedge':                                            { cat: CAT.WIPERS, ar: 'مساحات MicroEdge' },
    'directconnect':                                        { cat: CAT.WIPERS, ar: 'مساحات DirectConnect' },
    'envision':                                             { cat: CAT.WIPERS, ar: 'مساحات Envision' },
    'evolution':                                            { cat: CAT.WIPERS, ar: 'مساحات Evolution' },
    'insight':                                              { cat: CAT.WIPERS, ar: 'مساحات Insight' },
    'winter':                                               { cat: CAT.WIPERS, ar: 'مساحات شتوية' },
    'snowdriver':                                           { cat: CAT.WIPERS, ar: 'مساحات SnowDriver' },
    'spectrum beam':                                        { cat: CAT.WIPERS, ar: 'مساحات Spectrum Beam' },
    'spectrum rear':                                        { cat: CAT.WIPERS, ar: 'مساحات Spectrum خلفية' },
    'spectrum conventional':                                { cat: CAT.WIPERS, ar: 'مساحات Spectrum تقليدية' },
    'spectrum hybrid':                                      { cat: CAT.WIPERS, ar: 'مساحات Spectrum هجينة' },
    'oe specialty twin':                                    { cat: CAT.WIPERS, ar: 'مساحات OE Specialty Twin' },
    'oe specialty rear':                                    { cat: CAT.WIPERS, ar: 'مساحات OE Specialty خلفية' },
    'oe specialty aerotwin':                                { cat: CAT.WIPERS, ar: 'مساحات OE Specialty AeroTwin' },
    'limpiaparabrisas oe speciality twin':                  { cat: CAT.WIPERS, ar: 'مساحات OE Specialty Twin' },
    'limpiaparabrisas':                                     { cat: CAT.WIPERS, ar: 'مساحات زجاج' },
    'wiper blades':                                         { cat: CAT.WIPERS, ar: 'مساحات زجاج' },
    'bevel gearbox':                                        { cat: CAT.WIPERS, ar: 'صندوق تروس مساحات' },

    // --- Steering / thermal / exhaust ---
    'steering pumps':                                       { cat: CAT.STEERING, ar: 'طرمبة باور' },
    'steering gears':                                       { cat: CAT.STEERING, ar: 'صندوق دركسيون' },
    'steering systems':                                     { cat: CAT.STEERING, ar: 'نظام التوجيه' },
    'sistema de dirección':                                 { cat: CAT.STEERING, ar: 'نظام التوجيه' },
    'water pumps':                                          { cat: CAT.WATER_PUMP, ar: 'طرمبة مياه' },
    'cooling fans':                                         { cat: CAT.COOLING, ar: 'مروحة تبريد' },
    'a/c compressor':                                       { cat: CAT.COOLING, ar: 'كمبروسر تكييف' },
    'heating-pot kit':                                      { cat: CAT.COOLING, ar: 'طقم تسخين' },
    'thermal systems':                                      { cat: CAT.COOLING, ar: 'أنظمة حرارية' },
    'sistemas térmicos':                                    { cat: CAT.COOLING, ar: 'أنظمة حرارية' },
    'exhaust gas treatment':                                { cat: CAT.EXHAUST, ar: 'معالجة غاز العادم' },
    'supply module':                                        { cat: CAT.EXHAUST, ar: 'وحدة تغذية AdBlue' },
    'dosing module':                                        { cat: CAT.EXHAUST, ar: 'وحدة حقن AdBlue' },

    // --- Singular / one-off line names seen on a handful of rows ---
    'idle air control valve':                               { cat: CAT.FUEL_SYSTEM, ar: 'صمام هواء التعطيل' },
    'nozzles':                                              { cat: CAT.FUEL_INJ, ar: 'بخاخات (نوزل)' },
    'esi brake fluid':                                      { cat: CAT.BRAKE_FLUID, ar: 'زيت فرامل ESI' },
    'steering gear':                                        { cat: CAT.STEERING, ar: 'صندوق دركسيون' },
    'hd steering gears':                                    { cat: CAT.STEERING, ar: 'صندوق دركسيون شاق' },
    'steering shaft':                                       { cat: CAT.STEERING, ar: 'عمود دركسيون' },
    'power cylinder':                                       { cat: CAT.STEERING, ar: 'اسطوانة باور' },
    'power relays':                                         { cat: CAT.OTHER_ELEC, ar: 'ريلاي قدرة' },
};

/* Regex fallbacks for line names not in LINE_MAP, tried in order. */
const LINE_PATTERNS = [
    [/oxygen|o2\b/i,                    { cat: CAT.SENSORS,     ar: 'حساس أكسجين' }],
    [/sensor|sensores/i,                { cat: CAT.SENSORS,     ar: 'حساس' }],
    [/brake pad|pastillas/i,            { cat: CAT.BRAKE_PADS,  ar: 'بطانات فرامل' }],
    [/brake rotor|rotores/i,            { cat: CAT.BRAKE_DISCS, ar: 'أقراص فرامل' }],
    [/brake shoe|zapata/i,              { cat: CAT.DRUM_BRAKE,  ar: 'تيل فرامل طنبورة' }],
    [/wiper|limpiaparabrisas/i,         { cat: CAT.WIPERS,      ar: 'مساحات زجاج' }],
    [/spark plug|bujía/i,               { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات' }],
    [/alternator|alternadores/i,        { cat: CAT.CHARGING,    ar: 'دينامو شحن' }],
    [/starter|arranque|arrancadores/i,  { cat: CAT.STARTER,     ar: 'مارش' }],
    [/batter|pilas/i,                   { cat: CAT.BATTERY,     ar: 'بطارية' }],
    [/injector|inyec/i,                 { cat: CAT.FUEL_INJ,    ar: 'بخاخات' }],
    [/fuel pump|pump/i,                 { cat: CAT.FUEL_PUMP,   ar: 'طرمبة وقود' }],
    [/filter|filtros/i,                 { cat: CAT.AIR_FILTER,  ar: 'فلتر' }],
];

/* Bosch's own category, the last resort before the import refuses the row. */
const CATEGORY_MAP = {
    'brakes': { cat: CAT.BRAKES, ar: 'فرامل' },
    'frenos': { cat: CAT.BRAKES, ar: 'فرامل' },
    'alternators': { cat: CAT.CHARGING, ar: 'دينامو شحن' },
    'alternadores': { cat: CAT.CHARGING, ar: 'دينامو شحن' },
    'starters': { cat: CAT.STARTER, ar: 'مارش' },
    'arrancadores': { cat: CAT.STARTER, ar: 'مارش' },
    'starters and alternators': { cat: CAT.CHARGING, ar: 'مارش ودينامو' },
    'oxygen sensors': { cat: CAT.SENSORS, ar: 'حساس أكسجين' },
    'engine management sensors': { cat: CAT.SENSORS, ar: 'حساسات إدارة المحرك' },
    'engine management': { cat: CAT.SENSORS, ar: 'حساسات إدارة المحرك' },
    'fuel system modules': { cat: CAT.FUEL_PUMP, ar: 'مجموعة طرمبة بنزين' },
    'fuel system': { cat: CAT.FUEL_SYSTEM, ar: 'نظام الوقود' },
    'fuel injectors': { cat: CAT.FUEL_INJ, ar: 'بخاخات' },
    'fuel filters': { cat: CAT.FUEL_FILTER, ar: 'فلتر بنزين' },
    'oil filters': { cat: CAT.OIL_FILTER, ar: 'فلتر زيت' },
    'air filters': { cat: CAT.AIR_FILTER, ar: 'فلتر هواء' },
    'workshop cabin filters': { cat: CAT.CABIN_FILTER, ar: 'فلتر مكيف' },
    'hepa cabin filters': { cat: CAT.CABIN_FILTER, ar: 'فلتر مكيف HEPA' },
    'spark plugs': { cat: CAT.SPARK_PLUGS, ar: 'بوجيهات' },
    'wiper blades': { cat: CAT.WIPERS, ar: 'مساحات زجاج' },
    'steering systems': { cat: CAT.STEERING, ar: 'نظام التوجيه' },
    'thermal systems': { cat: CAT.COOLING, ar: 'أنظمة حرارية' },
    'exhaust gas treatment': { cat: CAT.EXHAUST, ar: 'معالجة غاز العادم' },
    'emission parts': { cat: CAT.FUEL_SYSTEM, ar: 'قطع نظام الانبعاثات' },
    'ignition parts': { cat: CAT.OTHER_ELEC, ar: 'قطع الإشعال' },
    'tire and chassis': { cat: CAT.SENSORS, ar: 'حساسات الإطارات والهيكل' },
    'adas': { cat: CAT.SENSORS, ar: 'أنظمة مساعدة السائق' },
    'air management': { cat: CAT.FUEL_SYSTEM, ar: 'إدارة الهواء' },
    'batteries and chargers': { cat: CAT.BATTERY, ar: 'بطاريات وشواحن' },
};

/* ---- agopartspro ----
 * Category comes from the Arabic noun the product name starts with; the source
 * is a cooling-hose maker, so hoses and elbows are the overwhelming majority. */
const AGO_NAME_RULES = [
    [/^خرطوم/,            { cat: CAT.HOSES,        ar: 'خرطوم', en: 'Hose' }],
    [/^كوعة/,             { cat: CAT.HOSES,        ar: 'كوعة',  en: 'Elbow Hose' }],
    [/^جلبة/,             { cat: CAT.CONTROL_ARMS, ar: 'جلبة',  en: 'Bushing' }],
    [/^(مسمار|طقم اتزان)/, { cat: CAT.SUSP_LINKS,   ar: 'مسمار اتزان', en: 'Stabilizer Link' }],
    [/^قاعد[ةه]\s*ردياتير/, { cat: CAT.RADIATOR,    ar: 'قاعدة ردياتير', en: 'Radiator Mount' }],
    [/^قاعد[ةه]/,          { cat: CAT.ENGINE_MAIN,  ar: 'قاعدة موتور',  en: 'Engine Mount' }],
    [/جوان/,              { cat: CAT.GASKETS,      ar: 'جوان',  en: 'Gasket' }],
];
const AGO_DEFAULT = { cat: CAT.HOSES, ar: 'خرطوم', en: 'Hose' };

/* agopartspro model page → ready-car car brand + model.
 * `models: []` means the page names a car the catalog has the brand for but not
 * the specific model (or the Arabic name is a trim nickname we will not guess at)
 * — the entry is then tied to the brand only rather than to an invented model. */
const AGO_MODEL_MAP = {
    'شيري انفي':            [['Chery', 'Envy']],
    'اسبرانزا 516':          [['Speranza', 'A516']],
    'اسبرانزا 113':          [['Speranza', 'A113']],
    'اسبرانزا 620':          [['Speranza', 'A620']],
    'شيري اريزو':            [['Chery', 'Arrizo 5']],
    'شيري تيجو':             [['Chery', 'Tiggo 3']],
    'نيو تيجو':              [['Chery', 'Tiggo 3']],
    'شيري ام جراند':          [['Chery', null]],
    'كيا سيفيا':             [['Kia', 'Sephia']],
    'كيا برايد':             [['Kia', 'Pride']],
    'كيا بيكانتو':           [['Kia', 'Picanto']],
    'كيا سيراتو + النترا':    [['Kia', 'Cerato'], ['Hyundai', 'Elantra']],
    'هيونداي فيرنا':          [['Hyundai', 'Verna']],
    'هيونداي اكسيل':          [['Hyundai', 'Excel']],
    'هيونداي ماتركس':         [['Hyundai', 'Matrix']],
    'هيونداي+ RB':           [['Hyundai', 'RB']],
    'هيونداي XD':            [['Hyundai', 'Accent']],
    'هيونداي MD':            [['Hyundai', 'Elantra']],
    'شيفروليه لانوس':         [['Chevrolet', 'Lanos']],
    'شيفروليه افيو':          [['Chevrolet', 'Aveo']],
    'شيفروليه اوبترا':        [['Chevrolet', 'Optra']],
    'دايو نوبيرا':            [['Daewoo', 'Nubira']],
    'لانسر بومة':            [['Mitsubishi', 'Lancer']],
    'لانسر قرش':             [['Mitsubishi', 'Lancer']],
    'لانسر كرستالة':          [['Mitsubishi', 'Lancer']],
    'نيسان N17+N16':         [['Nissan', 'Sunny']],
    'سوزوكي ماروتي +فان':     [['Suzuki', 'Maruti 800']],
    'BYD 1500':             [['BYD', null]],
    'BYD 1600':             [['BYD', null]],
    'فيات / ريجاتا':          [['Fiat', null]],
    'تشكيل مقاسات خرطوم':     [],
};

/* Bosch's US make names → ready-car car brand names, where they differ. */
const MAKE_ALIASES = {
    'infiniti': 'Infiniti',
    'citroen': 'Citroën',
    'seat': 'SEAT',
    'mercedes benz': 'Mercedes-Benz',
    'land rover': 'Land Rover',
    'alfa romeo': 'Alfa Romeo',
    'rolls royce': 'Rolls-Royce',
    'mini': 'Mini',
    'chirey': 'Chery',
};

module.exports = {
    CAT, LINE_MAP, LINE_PATTERNS, CATEGORY_MAP,
    AGO_NAME_RULES, AGO_DEFAULT, AGO_MODEL_MAP, MAKE_ALIASES,
};
