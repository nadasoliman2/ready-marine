/* ------------------ Bosch product copy → Arabic ------------------
 *
 * Bosch ships one short description per product LINE, not per part: 37,668
 * products carry only 134 distinct paragraphs between them. The import pasted
 * the English straight into description_ar, so an Arabic entry opened with two
 * Arabic sentences and then fell into a page of English. Each of the 134 is
 * translated here once and reused.
 *
 * Keyed by a hash of the whitespace-normalised English so the mapping survives
 * re-scrapes and re-orderings; the English itself sits above each entry as a
 * comment. Look a translation up with `lookup(text)`, which normalises first —
 * the source hard-wraps the same paragraph at different widths.
 *
 * A few US-market claims are localised rather than translated literally:
 * "the most popular European vehicles on the road in North America" is a claim
 * about a market this catalogue does not serve, and "*Currently only available
 * in the US" is a footnote about a distribution limit that does not apply to a
 * part sold here. Fahrenheit is converted to Celsius.
 */

const crypto = require('crypto');

const norm = (s) => (s || '').toString().split(/\s+/).join(' ').trim();
const hash = (s) => crypto.createHash('sha1').update(norm(s)).digest('hex').slice(0, 12);

const TEXT = {
    // [3387 products] This line provides the best performance for the most popular European vehicles on the road in North America, such as BMW, Mercedes Benz, Audi, VW, Volvo, Saab, etc.
    "8343f84c0f04": "أداء مثالي لأشهر السيارات الأوروبية مثل BMW ومرسيدس-بنز وأودي وفولكس فاجن وفولفو وساب.",

    // [2873 products] Bosch has been a major supplier of new alternators to Original Equipment vehicle manufacturers since 1913. Securing OE certification requires strict adherence to stringent precision and performance criteria. These same exacting criteria are also applied in the manufacturing of all Bosch aftermarket …
    "89430693e2da": "بوش مورّد رئيسي لدينامو الشحن لمصنّعي السيارات كقطعة أصلية منذ عام 1913. والحصول على اعتماد القطعة الأصلية يتطلّب التزاماً صارماً بمعايير دقة وأداء مشدّدة، وتُطبَّق المعايير نفسها في تصنيع جميع دينامو بوش لسوق قطع الغيار. دينامو بوش Premium مصنوع بجودة عالية ومُختبَر بالكامل في المصنع لضمان سنوات من الأداء الموثوق حتى في أقسى ظروف التشغيل.",

    // [2390 products] Developed for the generalist who works on all makes and models all day long, this premium line raises aftermarket brake pad technology to a whole new level.
    "0e0ea56eae73": "مطوّرة لفني الصيانة الذي يتعامل مع كل الماركات والموديلات يومياً، هذه الفئة الممتازة ترفع تقنية بطانات الفرامل في سوق قطع الغيار إلى مستوى جديد كلياً.",

    // [2237 products] Bosch Blue Disc Brake Pads were created for the everyday driver, and offers the same testing and engineering process as our premium braking line. Bosch Blue offers revolutionary engineering and advanced friction formulations for quiet and clean performance.
    "3440580521a3": "بطانات فرامل بوش Blue مصمّمة لقائد السيارة اليومي، وتخضع لنفس منظومة الاختبار والهندسة المطبّقة على فئة الفرامل الممتازة من بوش.",

    // [2131 products] Bosch has been a major car starter manufacturer for over a hundred years. All Bosch engine starters require strict adherence to stringent precision and performance criteria ensuring years of reliable performance, even under the most extreme operating conditions.
    "2f0340a67217": "بوش مُصنّع رئيسي لمارش السيارات منذ أكثر من مائة عام. كل مارش من بوش يخضع لالتزام صارم بمعايير دقة وأداء مشدّدة.",

    // [2072 products] Bosch Remanufactured Alternators have more new parts and are performance tested to ensure longer, more reliable operation with maximum performance.
    "b667158aff54": "دينامو الشحن المُجدَّد من بوش يحتوي على عدد أكبر من القطع الجديدة ويخضع لاختبار أداء يضمن تشغيلاً أطول وأكثر موثوقية بأقصى كفاءة.",

    // [1459 products] Bosch Professional Preferred Remanufactured Starter Motors are built for extreme heat, cold and high demand. Every engine starter component is 100% factory tested prior to and during remanufacturing to assure it meets or exceeds original equipment specifications.
    "6976aa180b4e": "مواتير المارش المُجدَّدة من فئة Bosch Professional Preferred مصنوعة لتحمّل الحرارة والبرودة الشديدة والتشغيل الشاق. كل مكوّن في المارش مُختبَر بالكامل في المصنع.",

    // [1284 products] Bosch is the world’s leading supplier and original equipment manufacturer of Oxygen Sensors. Bosch invented the automotive oxygen sensor and leads the way in sensor technology and innovation. From overall sensor design to the critical ceramic element, Bosch is known worldwide for quality and perform…
    "884a63787baa": "بوش هي المورّد العالمي الأول ومُصنّع القطعة الأصلية لحساسات الأكسجين. بوش هي من اخترع حساس الأكسجين في السيارات وتتصدّر هذا المجال حتى اليوم.",

    // [1205 products] Constantly evolving technologies and state-of-the-art manufacturing over the past 35 years allow Bosch to supply fuel pumps with tight tolerances and compact design, making way for the latest advancement — turbine pump technology. This revolutionary technology replaces older pump designs, providing …
    "a0673f606277": "التطوّر المستمر في التقنيات وأحدث أساليب التصنيع على مدى 35 عاماً يمكّنان بوش من إنتاج طرمبات بنزين بسماحات دقيقة وأداء ثابت.",

    // [1202 products] Bosch supplied the industry’s first fuel injection system with a high pressure electric fuel pump in 1967. Since then, Bosch has stood at the forefront of fuel system technology, providing fuel pumps to virtually all vehicle manufacturers. Compared to conventional fuel pumps, Bosch Pumps deliver 30%…
    "a00f120da9cc": "قدّمت بوش أول منظومة حقن وقود في الصناعة مزوّدة بطرمبة بنزين كهربائية عالية الضغط عام 1967، ومنذ ذلك الحين ظلّت بوش في طليعة هذا المجال.",

    // [1127 products] Innovative, high quality materials provide consistent, safe and long lasting performance.
    "c89faffa360e": "خامات مبتكرة وعالية الجودة توفّر أداءً ثابتاً وآمناً وطويل العمر.",

    // [1065 products] Bosch Workshop Cabin Air Filters are specifically engineered for the professional installer dedicated to helping customers breathe cleaner air. Bosch Workshop Cabin Filters offer an 99%* efficiency rate at 3 microns or greater in capturing dirt, dust and other environmental contaminants from enterin…
    "52ad1c728693": "فلاتر مقصورة بوش Workshop مصمّمة خصيصاً لفني الصيانة المحترف الحريص على أن يتنفّس عملاؤه هواءً أنظف.",

    // [908 products] Engineered to match OE design and provide consistent, superior braking performance.
    "47c69a76d4fb": "مصمّمة لتطابق تصميم القطعة الأصلية وتوفّر أداء فرملة ثابتاً ومتفوّقاً.",

    // [836 products] Bosch is the leading OE supplier of diesel fuel systems for diesel passenger cars, SUVs, van and pickup trucks. End of line testing using the exact OE test specifications. Guaranteed to provide OE performance and meet all emission specifications. Continuous improvement, manufactured with the latest …
    "76f054fd7d5e": "بوش هي المورّد الأول للقطع الأصلية في منظومات وقود الديزل لسيارات الركاب والسيارات الرياضية والفانات والبيك أب. ويتم اختبار كل قطعة في نهاية خط الإنتاج بنفس مواصفات اختبار القطعة الأصلية تماماً.",

    // [829 products] Bosch power steering pumps designed for an optimum performance and direct replacement of the original equipment. Bosch range offers both electric and mechanical pumps.
    "8845281720b0": "طرمبات الباور من بوش مصمّمة لأداء مثالي ولتكون بديلاً مباشراً للقطعة الأصلية. وتشمل التشكيلة أنواعاً كهربائية وهيدروليكية.",

    // [742 products] Bosch Switching-Type Oxygen (O2) sensors provide precise air-fuel-ratio measurements to the ECU, ensuring stable combustion control and helping reduce emissions across a wide range of operating conditions. Evolving from the original thimble sensor Bosch pioneered in 1976, Bosch later developed plana…
    "516ff64cd63e": "حساسات الأكسجين من نوع Switching من بوش توفّر قياساً دقيقاً لنسبة الهواء إلى الوقود وترسله لوحدة التحكم، بما يضمن ثبات التحكم في الاحتراق ويساعد على خفض الانبعاثات.",

    // [712 products] Not only did Bosch invent the Electronic Stabilization Program (ESP) – the technology that improves a vehicle’s stability by detecting / reducing loss of traction – but it also was the first company to fit Anti-locking Braking Systems (ABS) into mass production. The ABS applies brake fluid that enga…
    "7f752ebd13b3": "بوش ليست فقط من اخترع برنامج الثبات الإلكتروني (ESP) — التقنية التي تحسّن ثبات السيارة عبر رصد فقدان التحكّم والحدّ منه.",

    // [646 products] Bosch power steering gears designed for an identical replacement of the original equipment. Range consisting from classic rack and pinion to the state of the art electric and active steering systems.
    "61ff20fd93b8": "صناديق الدركسيون من بوش مصمّمة لتكون بديلاً مطابقاً للقطعة الأصلية، وتمتد التشكيلة من نظام الجريدة والترس التقليدي إلى أحدث التقنيات.",

    // [580 products] All Bosch ignition coils are built to achieve or exceed OE specifications and are known industry-wide for their reliability and performance. Bosch ignition coils convert low voltage into high ignition system voltage, creating an electric spark sent to the spark plugs which ignites the fuel.
    "eaa446b5f162": "كل كويلات الإشعال من بوش مصنوعة لتحقّق مواصفات القطعة الأصلية أو تتفوّق عليها، وهي معروفة في الصناعة كلها بموثوقيتها وأدائها.",

    // [526 products] Bosch continues its innovation and expands its wiper blade portfolio by providing wiper blades with unique, special adapters that are hard to find in the market for your vehicle. Bosch AeroTwin Set features a complete replacement set for your vehicle.
    "c89eec4a3cf5": "تواصل بوش ابتكارها وتوسّع تشكيلة المساحات بتوفير شفرات بوصلات خاصة وفريدة يصعب إيجادها في السوق.",

    // [517 products] Bosch Workshop Air Filters are designed specifically for the Professional installer market offering high vehicle coverage to ensure installers will always have the right air filter.
    "665328cde7c4": "فلاتر هواء بوش Workshop مصمّمة خصيصاً لسوق الفني المحترف وتغطي عدداً كبيراً من السيارات لضمان توفّر القطعة دائماً.",

    // [509 products] Bosch Wideband A/F Oxygen (O2) sensors provide continuous, high-precision measurements of the air-fuel ratio across the full lambda range, giving the ECU far more detailed information than traditional switching sensors. This enables exceptionally accurate air-fuel mixture control — supporting improv…
    "6564fb36a357": "حساسات الأكسجين واسعة النطاق (Wideband A/F) من بوش توفّر قياساً مستمراً وعالي الدقة لنسبة الهواء إلى الوقود عبر مدى لامبدا الكامل.",

    // [491 products] Bosch Port Fuel Injectors (PFI) have a robust design and are capable of using Ethanol fuel (E100). All Bosch fuel injectors released to the aftermarket are OE fit, form and function, and are produced to OE specifications. The Bosch fuel injector has a return rate of 1 part per million (PPM), making …
    "b41abb52c133": "بخاخات بوش من نوع الحقن المرحلي (PFI) بتصميم متين وقادرة على العمل بوقود الإيثانول (E100). وكل بخاخات بوش في سوق قطع الغيار مطابقة للقطعة الأصلية شكلاً ومقاساً ووظيفة ومصنوعة بمواصفاتها. معدّل الإرجاع في بخاخات بوش جزء واحد في المليون، وهو ما يجعلها المعيار المرجعي في الصناعة.",

    // [491 products] Bosch’s Remanufactured Diesel Injectors are produced at the same Bosch facility as the new diesel injectors. All wearable parts and critical components are replaced with genuine Bosch parts, and the latest original equipment production technology is used. Bosch remanufactured injectors include all O…
    "26dfc09f313e": "بخاخات الديزل المُجدَّدة من بوش تُنتَج في نفس مصنع بوش الذي يُنتج البخاخات الجديدة. وتُستبدل كل القطع القابلة للتآكل والمكوّنات الحرجة بقطع بوش الأصلية باستخدام أحدث تقنيات إنتاج القطعة الأصلية. كما تتضمّن البخاخات المُجدَّدة كل تحديثات المصنّع، وقد تتفوّق بذلك على البخاخات الأصلية التي تحلّ محلها.",

    // [406 products] Bosch is an original equipment global leader in mass air flow technology. Bosch Mass Air Flow (MAF) sensors ensure low levels of harmful emissions with greater fuel efficiency and improved engine performance.
    "0f5cfc4746ac": "بوش رائدة عالمياً في تقنية قياس تدفّق الهواء كقطعة أصلية. وحساسات الهواء (MAF) من بوش تضمن مستويات منخفضة من الانبعاثات الضارة مع كفاءة أعلى في استهلاك الوقود وأداء أفضل للمحرك.",

    // [390 products] Bosch Remanufactured High Pressure Pumps are cost-effective and meet the same high standards and safeguards as brand new High Pressure Pumps. Bosch is the leading OE supplier of diesel fuel systems for diesel passenger cars, SUVs, van and pickup trucks. End of line testing using the exact OE test sp…
    "41c08684a214": "طرمبات الضغط العالي المُجدَّدة من بوش اقتصادية وتلتزم بنفس المعايير والضمانات الصارمة المطبّقة على الطرمبات الجديدة. وبوش هي المورّد الأول للقطع الأصلية في منظومات وقود الديزل، ويتم الاختبار في نهاية خط الإنتاج بمواصفات اختبار القطعة الأصلية نفسها، مع تحسين مستمر وتحديث دائم للمكوّنات والمواصفات.",

    // [338 products] All Bosch High Pressure Sensors provide very reliable and accurate measurements and have extremely fast response times to ensure your vehicle runs as intended.
    "bfe3751da48b": "كل حساسات الضغط العالي من بوش توفّر قياسات موثوقة ودقيقة للغاية وزمن استجابة سريعاً جداً لضمان عمل سيارتك كما ينبغي.",

    // [324 products] Bosch Crankshaft Position Sensors provide accurate detection of the engine speed: the engine speed is the main control variable for the ignition timing.
    "2e7f75bde4c8": "حساسات عمود المرفق (الكرنك) من بوش توفّر رصداً دقيقاً لسرعة المحرك، وسرعة المحرك هي المتغيّر الأساسي للتحكم في توقيت الإشعال.",

    // [302 products] Bosch copper core spark plugs feature a heavy-duty nickel center electrode for longer lasting service life compared to standard copper plugs.
    "9a11065f5c54": "بوجيهات بوش ذات القلب النحاسي مزوّدة بقطب مركزي من النيكل شديد التحمّل لعمر تشغيلي أطول مقارنة ببوجيهات النحاس العادية.",

    // [280 products] Bosch DuraSpeed sheathed-element glow plugs heat up more quickly and retain their glow longer, ensuring that modern diesels are instantly ready to go – even at temperatures as low as –28 °C. A controlled post-glow phase ensures low emissions and a quiet engine, whilst intelligent energy management r…
    "8b057771b429": "بوجيهات السخّان من بوش بتقنية DuraSpeed تسخن أسرع وتحتفظ بتوهّجها لفترة أطول، بما يضمن جاهزية محركات الديزل الحديثة فوراً حتى عند درجة حرارة −28 °م. ومرحلة التوهّج اللاحق المتحكَّم فيها تضمن انبعاثات منخفضة ومحركاً هادئاً، بينما تخفّف الإدارة الذكية للطاقة الحمل عن المنظومة الكهربائية والبطارية.",

    // [264 products] The Bosch S5 Battery is the powerhouse for recent car models with high electronic demand that provides optimum starting power and long service life, flushed tops for minimized risk of acid leakage, dependable power in accordance with OEM requirements, free roadside assistance and a 3 year free repla…
    "5ff3238c968e": "بطارية بوش S5 هي الخيار الأقوى للموديلات الحديثة ذات الاستهلاك الإلكتروني العالي، وتوفّر قدرة بدء مثالية وعمراً تشغيلياً طويلاً، بأسطح مغلقة تقلّل خطر تسرّب الحمض، وقدرة موثوقة مطابقة لمتطلبات المصنّع. وتستخدم تقنية الشبكة كاملة الإطار وفواصل جيبية عالية الحماية ووصلات داخلية متينة لإطالة العمر ورفع الموثوقية.",

    // [253 products] Bosch Manifold Absolute Pressure (MAP) Sensors provide accurate air pressure measurement to very fine tolerances for efficient engine performance.
    "85c3eff777f9": "حساسات ضغط السحب (MAP) من بوش توفّر قياساً دقيقاً لضغط الهواء بسماحات بالغة الدقة من أجل أداء فعّال للمحرك.",

    // [252 products] Bosch Exhaust Gas Temperature (EGT) sensors provide accurate, real-time monitoring of exhaust temperatures to protect key engine and aftertreatment components. By ensuring the optimal temperature range, they help prevent damage to turbos, catalytic converters, DPF's, and SCR systems while enabling e…
    "8106d5a141d1": "حساسات حرارة العادم (EGT) من بوش توفّر مراقبة دقيقة وفورية لدرجات حرارة العادم لحماية مكوّنات المحرك ومعالجة العادم الأساسية. وبضمان المدى الحراري الأمثل تساعد على منع تلف التوربو والحفّاز وفلتر جسيمات الديزل ومنظومة SCR، مع تمكين عملية التجديد الفعّالة وخفض الانبعاثات.",

    // [252 products] Premium engine performance requires a premium oil filter. Bosch Premium Oil Filters protect your engine by keeping harmful particles and dirt out, preventing premature wear and engine failure. Premium oil filters not only fit the same way as original OE filters, they utilize an exclusive blend of na…
    "282c47105311": "الأداء الممتاز للمحرك يحتاج فلتر زيت ممتاز. فلاتر زيت بوش Premium تحمي محركك بمنع الجسيمات الضارة والأتربة من الدخول، وتقي من التآكل المبكّر وتلف المحرك. وهي لا تُركَّب بنفس طريقة الفلاتر الأصلية فحسب، بل تستخدم أيضاً خليطاً حصرياً من الخامات الطبيعية والصناعية في وسط الترشيح لترشيح فائق وحماية أكبر للمحرك.",

    // [240 products] Bosch Fuel Filters help to protect the most expensive parts of the engine by filtering out foreign particles that can damage a fuel injector. A damaged fuel filter can result in erratic performance, poor gas mileage and in some cases, complete engine shutdown. Even the smallest particles can cause c…
    "79f321521625": "فلاتر بنزين بوش تساعد على حماية أغلى أجزاء المحرك بترشيح الجسيمات الغريبة التي قد تتلف البخاخات. والفلتر التالف قد يؤدي إلى أداء غير منتظم واستهلاك وقود مرتفع، وفي بعض الحالات توقّف المحرك تماماً. حتى أصغر الجسيمات قد تسبّب تآكلاً كبيراً، وحماية منظومة الوقود والمحرك منها تطيل عمر السيارة.",

    // [239 products] The Bosch S4 Battery ensures a powerful start for all types of vehicles and offers long service life, flushed tops for minimized risk of acid leakage, dependable power in accordance with OEM requirements, free roadside assistance and a 2 year free replacement warranty. It uses full frame grid techno…
    "26c5e81ee220": "بطارية بوش S4 تضمن بدءاً قوياً لكل أنواع السيارات وتوفّر عمراً تشغيلياً طويلاً، بأسطح مغلقة تقلّل خطر تسرّب الحمض، وقدرة موثوقة مطابقة لمتطلبات المصنّع. وتستخدم تقنية الشبكة كاملة الإطار وفواصل جيبية عالية الحماية ووصلات داخلية متينة لإطالة العمر ورفع الموثوقية.",

    // [231 products] Bosch Rear delivers the same look and feel as your vehicles rear blade.
    "a757d181323c": "مساحة بوش الخلفية توفّر نفس شكل وأداء الشفرة الخلفية الأصلية في سيارتك.",

    // [215 products] Bosch Camshaft Position Sensors determine engine position based on the location of the camshaft: engine position is used for determining injection and ignition sequence.
    "d999144c4992": "حساسات عمود الكامات من بوش تحدّد وضع المحرك اعتماداً على موضع عمود الكامات، ووضع المحرك هو ما يُستخدم لتحديد تتابع الحقن والإشعال.",

    // [198 products] Bosch Particulate Matter (PM) sensors continuously monitor the function of the Diesel Particulate Filter (DPF) via direct measurement of soot concentration to help reduce particulate emissions by up to 99%. An evolution from older ΔP sensor’s indirect estimate of soot, Bosch pioneered resistive-meas…
    "7edf5e36c875": "حساسات الجسيمات الدقيقة (PM) من بوش تراقب باستمرار عمل فلتر جسيمات الديزل (DPF) عبر القياس المباشر لتركيز السناج، بما يساعد على خفض انبعاثات الجسيمات حتى 99%. وهي تطوّر عن التقدير غير المباشر في حساسات الضغط التفاضلي القديمة، وقد كانت بوش الرائدة في حساسات الجسيمات القائمة على قياس المقاومة لتوفير بيانات فورية دقيقة لوحدة التحكم.",

    // [168 products] Wideband/Air-Fuel sensors perform the same function as a regular O2 sensor, but they precisely measure the amount oxygen in the exhaust rather than just switching between rich (too much fuel, not enough oxygen) and lean (too much oxygen, not enough fuel). Our Wideband sensors use a more sophisticate…
    "e7fc44c1d734": "حساسات الأكسجين واسعة النطاق تؤدي نفس وظيفة حساس الأكسجين العادي، لكنها تقيس كمية الأكسجين في العادم بدقة بدلاً من مجرد التبديل بين الخليط الغني (وقود زائد وأكسجين ناقص) والخليط الفقير (أكسجين زائد ووقود ناقص). وتستخدم حساساتنا واسعة النطاق عنصر استشعار أكثر تطوّراً يعطي وحدة التحكم إشارة متناسبة مع كمية الأكسجين في العادم.",

    // [166 products] The Bosch S3 Battery is the economical solution for many older cars that provides optimum starting power and long service life, flushed tops for minimized risk of acid leakage, dependable power in accordance with OEM requirements and a 1 year free replacement warranty. It uses full frame grid techno…
    "b5d4d068fb78": "بطارية بوش S3 هي الحل الاقتصادي لكثير من السيارات الأقدم، وتوفّر قدرة بدء مثالية وعمراً تشغيلياً طويلاً، بأسطح مغلقة تقلّل خطر تسرّب الحمض، وقدرة موثوقة مطابقة لمتطلبات المصنّع. وتستخدم تقنية الشبكة كاملة الإطار وفواصل جيبية عالية الحماية ووصلات داخلية متينة.",

    // [125 products] Bosch Workshop Oil Filters designed for the professional installer.
    "0b11833a7a11": "فلاتر زيت بوش Workshop مصمّمة لفني الصيانة المحترف.",

    // [124 products] Bosch Gasoline Direct Injection (GDI) provides the basis for a cleaner and more economical engine generation. At the same time, it contributes to the current engine downsizing trend.
    "19f785191475": "الحقن المباشر للبنزين (GDI) من بوش يوفّر الأساس لجيل من المحركات أنظف وأكثر اقتصاداً، ويساهم في الوقت نفسه في الاتجاه الحالي لتصغير سعة المحركات.",

    // [121 products] Bosch Twin provides a direct replacement for your original equipment.
    "1d815d277a9f": "مساحات بوش Twin بديل مباشر للقطعة الأصلية في سيارتك.",

    // [115 products] This water pump is 100% new and designed to meet exact original equipment specifications. All water pumps are also 100% tested to ensure proper functionality. The torque testing is performed to verify the proper impeller- shaft mating. Torque testing can detect loose impeller- shaft press fits. Wate…
    "0e932132a005": "طرمبة المياه هذه جديدة بالكامل ومصمّمة لتطابق مواصفات القطعة الأصلية تماماً. وكل الطرمبات تُختبَر بنسبة 100% للتأكد من سلامة عملها، ويُجرى اختبار العزم للتحقق من إحكام تركيب المروحة على العمود وكشف أي ارتخاء، كما تُختبَر الطرمبات بالتفريغ للتأكد من إحكام الجسم وحلقات المنع والوصلات ضد التسريب.",

    // [112 products] Bosch Double Iridium Spark Plugs are engineered to deliver both high performance and long life, representing advanced original equipment (OE) spark plug technology. The ultra-fine wire design and laser welded tapered ground electrode deliver optimum performance, while the iridium center electrode an…
    "fb3d56885db5": "بوجيهات بوش Double Iridium مصمّمة لتجمع بين الأداء العالي والعمر الطويل، وتمثّل تقنية بوجيهات القطعة الأصلية المتقدّمة. التصميم فائق الدقة والقطب الأرضي المخروطي الملحوم بالليزر يقدّمان أداءً مثالياً، بينما يساعد الإيريديوم في القطب المركزي والقطب الأرضي على إطالة العمر.",

    // [109 products] Bosch Throttle Bodies are manufactured on original equipment (OE) production lines with best-in-class quality.
    "2674beb2927a": "بشلمانات بوش (أجسام الخانق) مصنوعة على خطوط إنتاج القطعة الأصلية بجودة هي الأفضل في فئتها.",

    // [105 products] Bosch Cabin Air Filters are designed and tested to meet High Efficiency Particulate Air (HEPA) standards based on test standard ISO 29463-3, and provides filtration efficiency of 99.97% at 0.3 microns*. This efficiency provides ultimate protection in trapping allergens, dust and other particulates t…
    "11160df68773": "فلاتر مقصورة بوش مصمّمة ومُختبَرة لتحقّق معايير HEPA وفق معيار الاختبار ISO 29463-3، وتوفّر كفاءة ترشيح 99.97% عند 0.3 ميكرون. وهذه الكفاءة توفّر أقصى حماية باحتجاز مسبّبات الحساسية والأتربة والجسيمات الأخرى التي قد تدخل سيارتك، وتمنحك أنقى هواء ممكن لك ولعائلتك.",

    // [104 products] The Bosch S6 High Performance AGM Battery uses cutting edge technology that provides constant optimum power even for short trips and stop-and-go traffic, up to 2x longer lifetime, flushed tops for minimized risk of acid leakage, dependable power in accordance with OEM requirements, excellent charge …
    "37f703b32da0": "بطارية بوش S6 High Performance AGM تستخدم تقنية متقدّمة توفّر قدرة مثالية ثابتة حتى في الرحلات القصيرة وزحام التوقف والحركة، وعمراً أطول بمقدار الضعف، بأسطح مغلقة تقلّل خطر تسرّب الحمض، وقدرة موثوقة مطابقة لمتطلبات المصنّع، مع قابلية ممتازة للشحن ومقاومة أفضل للاهتزاز.",

    // [99 products] Bosch Knock Sensors are highly accurate and sensitive to detect engine knock, ensuring efficient performance and long life of your vehicle.
    "c6f6faf92cae": "حساسات الطرق (الخبط) من بوش شديدة الدقة والحساسية في رصد طرق المحرك، بما يضمن أداءً فعّالاً وعمراً أطول لسيارتك.",

    // [99 products] The award-winning design of Bosch ICON distributes more uniform pressure along the entire length of the blade for ultimate all-season performance that lasts up to 40% longer than other premium wiper blades. Precision-tensioned dual steel springs create tension memory, applying uniform pressure along…
    "66796cf20c6d": "التصميم الحائز على جوائز في مساحات بوش ICON يوزّع ضغطاً أكثر انتظاماً على طول الشفرة بالكامل، لأداء مثالي في كل الفصول يدوم أطول بنسبة تصل إلى 40% مقارنة بالمساحات الممتازة الأخرى. والنابضان الفولاذيان المشدودان بدقة يخلقان ذاكرة شدّ توزّع ضغطاً منتظماً على طول الشفرة، ما يمنح رؤية واضحة وعمراً تشغيلياً أطول.",

    // [97 products] The high pressure pump is responsible for compressing the fuel supplied by the electric fuel pump to the pressure required for high pressure injection up to 20 MPa (200 bar).
    "aedb3253456a": "طرمبة الضغط العالي مسؤولة عن ضغط الوقود القادم من طرمبة البنزين الكهربائية إلى الضغط اللازم للحقن عالي الضغط، حتى 20 ميجا باسكال (200 بار).",

    // [84 products] Bosch Double Platinum Spark Plugs are engineered for up to 3X longer service life.*
    "516c0e48170a": "بوجيهات بوش Double Platinum مصمّمة لعمر تشغيلي أطول بما يصل إلى ثلاثة أضعاف.",

    // [83 products] Bosch Engine Cooling Fans provide sufficient flow at idle so your vehicle doesn’t overheat while sitting in traffic. They operate with minimal noise, preventing the heterodyning effect common with lower quality and less expensive competitor cooling fans – and the blades are balanced, ensuring safe a…
    "4fac77658793": "مراوح تبريد المحرك من بوش توفّر تدفّقاً كافياً أثناء التعطيل حتى لا ترتفع حرارة سيارتك في الزحام، وتعمل بأقل قدر من الضوضاء وتتجنّب رنين التداخل الشائع في المراوح الأقل جودة وسعراً. والريش متزنة لضمان أداء آمن ومتين، كما تتضمّن هذه المراوح وظائف حماية مدمجة في المحرك الكهربائي مثل الإيقاف التلقائي عند وجود أي إعاقة، والمصهر الحراري، والحماية من عكس القطبية.",

    // [71 products] Bosch Nitrogen Oxide (NOx) sensors precisely measure the concentration of nitrogen oxides in the exhaust stream to ensure efficient SCR catalyst performance. By delivering real-time data to the ECU, NOx sensors enable accurate dosing of DEF, improved fuel efficiency, and compliance with strict emiss…
    "dd11680a966c": "حساسات أكاسيد النيتروجين (NOx) من بوش تقيس بدقة تركيز أكاسيد النيتروجين في مجرى العادم لضمان كفاءة عمل حفّاز SCR. وبتوفير بيانات فورية لوحدة التحكم تمكّن هذه الحساسات من ضبط جرعة سائل معالجة العادم بدقة، وتحسين كفاءة الوقود، والالتزام بمعايير الانبعاثات الصارمة. وهي مبنية بعناصر استشعار كهروكيميائية متقدّمة وأجسام متينة.",

    // [69 products] Bosch Platinum Spark Plugs are engineered for up to 2X longer service life.*
    "91f8d2d8502c": "بوجيهات بوش Platinum مصمّمة لعمر تشغيلي أطول بما يصل إلى الضعف.",

    // [68 products] Bosch Nitrogen Oxide Sensors (NOx) precisely measure the NOx concentration in the exhaust gas of diesel vehicles to support efficient after treatment. They help create cleaner emissions with continuous NOx monitoring while the engine is running.
    "c8b65898753f": "حساسات أكاسيد النيتروجين (NOx) من بوش تقيس بدقة تركيز أكاسيد النيتروجين في عادم سيارات الديزل لدعم كفاءة معالجة العادم، وتساعد على انبعاثات أنظف عبر مراقبة مستمرة أثناء عمل المحرك.",

    // [65 products] Bosch Ultrasonic Reversing Sensors detect when there is an object behind a vehicle. They are a genuine replacement for the Original Equipment Manufacturer part and easy to install.
    "27930412ac86": "حساسات الركنة بالموجات فوق الصوتية من بوش ترصد وجود أي جسم خلف السيارة. وهي بديل أصلي لقطعة المصنّع وسهلة التركيب.",

    // [63 products] Vapors are produced in the fuel tank due to external heat radiation or surplus fuel gaining heat before returning to the fuel tank. These vapors are captured and then purged by way of an activated charcoal filter. A purge valve is located between the intake manifold and charcoal canister, and is act…
    "9d06bdadd1e8": "تتكوّن أبخرة داخل تنك البنزين نتيجة الحرارة الخارجية أو بسبب الوقود الزائد الذي يكتسب حرارة قبل عودته إلى التنك. تُحتجَز هذه الأبخرة ثم تُصرَّف عبر فلتر الفحم النشط. ويقع صمام التنفيس بين مجمّع السحب وعلبة الفحم، ويُشغَّل للسماح بسحب هواء نقي عبر العلبة لتصريف أبخرة الوقود المحتجزة.",

    // [63 products] Bosch Low Pressure Sensors are compact, durable, and vibration-resistant with outstanding measuring accuracy to ensure your vehicles fluids are at their optimal pressures.
    "4255f5ea2471": "حساسات الضغط المنخفض من بوش صغيرة الحجم ومتينة ومقاومة للاهتزاز بدقة قياس فائقة، لضمان بقاء سوائل سيارتك عند ضغوطها المثلى.",

    // [57 products] Bosch Iridium Spark Plugs are engineered to deliver both high performance and long life, representing advanced OE spark plug technology. The ultra-fine wire iridium center electrode pin delivers best performance. Unlock the performance in your engine with Bosch Iridium Spark Plugs.
    "e2b98237b5fb": "بوجيهات بوش Iridium مصمّمة لتقديم أداء عالٍ وعمر طويل معاً، وتمثّل تقنية بوجيهات القطعة الأصلية المتقدّمة. ودبوس القطب المركزي المصنوع من الإيريديوم فائق الدقة يقدّم أفضل أداء ممكن.",

    // [52 products] ESI6 is the next generation brake fluid designed for today's modern braking systems. Designed by the industry's leader in braking technology for vehicles using DOT 3, DOT 4, and DOT 5.1 brake fluid.
    "f56cda2a02c2": "ESI6 هو الجيل التالي من زيوت الفرامل، مصمّم لمنظومات الفرامل الحديثة. صُمّم على يد الشركة الرائدة في تقنيات الفرملة للسيارات التي تستخدم زيت فرامل DOT 3 و DOT 4 و DOT 5.1.",

    // [48 products] OE expertise and innovation applied to new brake booster products for the aftermarket.
    "bb2a50869d39": "خبرة وابتكار القطعة الأصلية مطبّقة على خوادم الفرامل الجديدة لسوق قطع الغيار.",

    // [48 products] The patented design of Bosch Evolution beam blades feature dual precision-tensioned steel springs that distributes uniform pressure along the entire length of the blade for exceptional winter weather visibility.
    "79f668ab3561": "التصميم المسجّل لشفرات بوش Evolution من نوع Beam يعتمد على نابضين فولاذيين مشدودين بدقة يوزّعان ضغطاً منتظماً على طول الشفرة بالكامل، لرؤية استثنائية في أجواء الشتاء.",

    // [45 products] Bosch High Pressure Pumps come standard on the majority of diesel vehicles, providing superior performance and durability. Bosch is the world's leading OE supplier of diesel fuel systems for passenger cars and trucks. Bosch innovations in common rail fuel injection led the modern diesel revolution. …
    "60ddd2c0159e": "طرمبات الضغط العالي من بوش هي القطعة القياسية في غالبية سيارات الديزل، وتوفّر أداءً ومتانة فائقين. وبوش هي المورّد العالمي الأول للقطع الأصلية في منظومات وقود الديزل لسيارات الركاب والشاحنات، وابتكاراتها في حقن الكومون ريل قادت ثورة الديزل الحديثة. وتُنتَج قطع بوش لسوق الغيار بنفس المواصفات الدقيقة لمنتجات القطعة الأصلية.",

    // [41 products] The Bosch electronic stability program (ESP) supports the driver in nearly all critical driving situations. It complements the functions of the anti-lock braking system (ABS) and the traction control system but can do considerably more. It detects vehicle skidding movements, and actively counteracts…
    "a1311e98e9bb": "برنامج الثبات الإلكتروني (ESP) من بوش يساند السائق في كل المواقف الحرجة تقريباً. وهو يكمّل وظائف نظام منع انغلاق الفرامل (ABS) ونظام التحكم في الجر، لكنه يقدّم ما هو أكثر بكثير: فهو يرصد انزلاق السيارة ويتصدّى له فعلياً، بما يحسّن أمان القيادة بدرجة كبيرة.",

    // [40 products] Bosch Liquid Temperature Sensors accurately monitor the vital fluids in your vehicle ensuring long and healthy life. The sensor provides information to the Engine Control Unit to keep your engine running strong, safe, and efficient.
    "e24ae073228d": "حساسات حرارة السوائل من بوش تراقب بدقة السوائل الحيوية في سيارتك لضمان عمر طويل وسليم، وتزوّد وحدة التحكم في المحرك بالمعلومات التي تبقيه قوياً وآمناً وفعّالاً.",

    // [40 products] The premier solution for the winter season is the Bosch ICON beam wiper blade. By design, beam blades are not affected by snow and ice buildup. The bracketless design and tension springs help keep the blade flexible and provide superior wiping performance in all climate conditions.
    "bd0d6ec6dc06": "الحل الأمثل لموسم الشتاء هو شفرة بوش ICON من نوع Beam. فبحكم التصميم لا تتأثر شفرات Beam بتراكم الثلج والجليد، والتصميم الخالي من الأذرع مع نوابض الشدّ يحافظان على مرونة الشفرة وأداء مسح متفوّق في كل الأجواء.",

    // [40 products] Bosch Spectrum DirectFit™ Beam matches the same blade technology and connection fitment to deliver factory performance. The patented beam design with aerodynamic spoiler provides long-lasting wiping performance in all weather. *Currently only available in the US
    "bf2026462eae": "مساحات بوش Spectrum DirectFit™ Beam تعتمد نفس تقنية الشفرة ونفس الوصلة لتقديم أداء المصنع. والتصميم المسجّل من نوع Beam مع الجناح الانسيابي يوفّر أداء مسح يدوم طويلاً في كل الأجواء.",

    // [38 products] Bosch Workshop Cabin Air Filters are specifically engineered for the professional installer dedicated to helping customers breathe cleaner air. Bosch Workshop Cabin Filters offer an 80%* efficiency rate at 3 microns or greater in capturing dirt, dust and other environmental contaminants from enterin…
    "45e49b3cb29b": "فلاتر مقصورة بوش Workshop مصمّمة خصيصاً لفني الصيانة المحترف الحريص على أن يتنفّس عملاؤه هواءً أنظف، وتوفّر كفاءة 80% عند 3 ميكرون فأكثر في منع الأتربة والغبار والملوّثات البيئية من الدخول إلى فتحات التكييف والتدفئة في السيارة.",

    // [35 products] Bosch Idle Air Control Valves are made with precision engineering and are robustly designed to withstand long engine life.
    "9f144b260507": "صمامات التحكم في هواء التعطيل من بوش مصنوعة بهندسة دقيقة وتصميم متين يتحمّل عمر المحرك الطويل.",

    // [31 products] The ultra-light Bosch Lithium PowerSport Battery is a real powerhouse — delivering full performance and increased dynamics to a variety of powersport applications. Thanks to its innovative lithium technology, it features 60% less weight and up to 10X the deep-cycle resistance of comparable lead-acid…
    "c7479e3ed39a": "بطارية بوش Lithium PowerSport فائقة الخفة قوة حقيقية، تقدّم أداءً كاملاً وديناميكية أعلى لمجموعة متنوّعة من المركبات الرياضية. وبفضل تقنية الليثيوم المبتكرة فهي أخف بنسبة 60% وتتحمّل التفريغ العميق حتى عشرة أضعاف بطاريات الرصاص الحمضية المماثلة، وهي مفيدة بشكل خاص لمن لديهم استهلاك عالٍ للطاقة وفي الظروف القاسية.",

    // [29 products] Robust construction with a specially blended natural rubber wiping edge for reliable windshield wiper performance.
    "be364f79ee72": "بنية متينة مع حافة مسح من مطاط طبيعي بتركيبة خاصة لأداء موثوق في مسح الزجاج الأمامي.",

    // [25 products] Elevate your driving experience with Bosch PrimeACTIVE™ wiper blades, featuring dual precision-tensioned steel springs and powerful all-weather cleaning action for ultimate performance.
    "e90e50dcb4d0": "ارتقِ بتجربة قيادتك مع مساحات بوش PrimeACTIVE™ المزوّدة بنابضين فولاذيين مشدودين بدقة وقوة تنظيف فعّالة في كل الأجواء لأداء مثالي.",

    // [25 products] The T5 dual-purpose battery, with Full Frame technology, provides maximum performance and cycle stability, especially for vehicles with a high energy demand and frequent discharge cycles.
    "5c4cc64b7fe7": "بطارية T5 مزدوجة الغرض بتقنية الإطار الكامل توفّر أقصى أداء وثباتاً في دورات التفريغ، خصوصاً للمركبات ذات الاستهلاك العالي للطاقة ودورات التفريغ المتكرّرة.",

    // [25 products] Bosch C40-Li and C80-Li Battery Chargers are engineered to keep your vehicle’s battery in optimal condition – providing reliable starting power and longer battery life. These user-friendly chargers offer advanced technology and versatile modes to suit various battery types and charging needs – inclu…
    "9f2ec7224022": "شواحن البطاريات بوش C40-Li و C80-Li مصمّمة للحفاظ على بطارية سيارتك في حالة مثالية، بما يوفّر قدرة بدء موثوقة وعمراً أطول للبطارية. وهذه الشواحن سهلة الاستخدام وتقدّم تقنية متقدّمة وأوضاعاً متعدّدة تناسب مختلف أنواع البطاريات، بما فيها بطاريات الليثيوم 12 فولت وبطاريات الرصاص 6 و12 فولت.",

    // [25 products] Bosch PureVision™ wiper blade program, a beam technology that delivers high wiping quality for all-weather performance.
    "96437884c2a2": "برنامج مساحات بوش PureVision™ بتقنية Beam يقدّم جودة مسح عالية وأداءً في كل الأجواء.",

    // [25 products] When cold weather gets extreme, Bosch Winter beam wiper blades can stand up to even the harshest conditions.
    "62015b157152": "عندما يشتدّ البرد، تصمد مساحات بوش Winter من نوع Beam أمام أقسى الظروف.",

    // [25 products] The new Bosch Snow Driver™ windshield wipers are tested to perform at -20°F providing advanced winter dependability. Cut through the harsh winter elements with reliable operation during all conditions.
    "a6c0e188d2ca": "مساحات بوش Snow Driver™ الجديدة مُختبَرة للعمل عند −29 °م لتوفّر اعتمادية شتوية متقدّمة وتشغيلاً موثوقاً في كل الظروف.",

    // [24 products] Driving in the rain can be stressful, especially at night. The Bosch ENVISION™ windshield wiper blade sharpens night visibility and offers extreme weather safety.
    "54667c4b2d1b": "القيادة تحت المطر مرهقة، خصوصاً ليلاً. مساحة بوش ENVISION™ تحسّن وضوح الرؤية الليلية وتوفّر أماناً في الأجواء القاسية.",

    // [24 products] Ultra premium wiper blade for enhanced night clarity and increased visibility. Optimal wiping performance for extreme weather safety. Engineered to deliver dependable performance when darkness and night conditions turn challenging. NightView™ technology ensures uniform pressure across the entire wip…
    "54ffa49b3ba0": "شفرة مساحة فائقة الجودة لوضوح أعلى ليلاً ورؤية أفضل، وأداء مسح مثالي وأماناً في الأجواء القاسية. مصمّمة لتقديم أداء يُعتمد عليه حين تصبح ظروف الظلام والليل صعبة، وتقنية NightView™ تضمن ضغطاً منتظماً على حافة المسح بالكامل بما يقلّل التشويش خصوصاً ليلاً أو مع الوهج الشديد.",

    // [23 products] Today’s turbocharged gasoline direct injection engines place high demands on spark plugs. To meet these needs, the new Bosch EVO spark plug is engineered to ensure reliable ignition throughout its long service life – even under extreme conditions in modern engines.Thanks to its improved insulator de…
    "35b6f369e3cf": "محركات البنزين الحديثة بالحقن المباشر والشاحن التوربيني تفرض متطلبات عالية على البوجيهات. ولتلبية ذلك صُمّم بوجيه بوش EVO الجديد لضمان إشعال موثوق طوال عمره التشغيلي الطويل، حتى في الظروف القاسية داخل المحركات الحديثة. وبفضل تحسين تصميم العازل وقوة العزل الكهربائي العالية (أكثر من 45 كيلو فولت) يتحمّل بوجيه EVO الجديد ظروفاً أشدّ.",

    // [23 products] Bosch Spectrum DirectFit™ Conventional matches the same blade technology and connection fitment to deliver factory performance. The precision cut rubber wiping edge delivers a quiet, consistent performance. *Currently only available in the US
    "827bf1bba7fd": "مساحات بوش Spectrum DirectFit™ التقليدية تعتمد نفس تقنية الشفرة ونفس الوصلة لتقديم أداء المصنع، وحافة المطاط المقصوصة بدقة تمنح أداءً هادئاً وثابتاً.",

    // [23 products] Bosch Spectrum DirectFit™ Rear matches the same blade technology and connection to deliver factory performance. The factory design, fit and function provides smooth and quiet operation in all weather. *Currently only available in the US
    "d1644b85a7ff": "مساحات بوش Spectrum DirectFit™ الخلفية تعتمد نفس تقنية الشفرة ونفس الوصلة لتقديم أداء المصنع، وتصميم المصنع ومقاسه ووظيفته توفّر تشغيلاً سلساً وهادئاً في كل الأجواء.",

    // [20 products] Particulate Matter (PM) Sensors monitor the function of the Diesel Particulate Filter (DPF) to detect excessive PM emissions.
    "074d3b9c5b7e": "حساسات الجسيمات الدقيقة (PM) تراقب عمل فلتر جسيمات الديزل (DPF) لرصد أي انبعاثات جسيمات زائدة.",

    // [20 products] Bosch SmartLink™ Universal Oxygen (O2) sensors combine OE-specification base sensors with a flexible, patented Posi-Lock® connector system designed for fast, reliable installation across a wide range of vehicles. Each sensor uses the same high-quality zirconia ceramic element and heater design found…
    "5a3f1f563dd6": "حساسات الأكسجين العمومية بوش SmartLink™ تجمع بين حساس أساسي بمواصفات القطعة الأصلية ومنظومة وصلات Posi-Lock® المسجّلة والمرنة، المصمّمة لتركيب سريع وموثوق على مدى واسع من السيارات. ويستخدم كل حساس نفس عنصر سيراميك الزركونيا عالي الجودة وتصميم السخّان الموجودين في تطبيقات بوش الأصلية، بما يضمن تغذية راجعة دقيقة لنسبة الهواء إلى الوقود.",

    // [19 products] The T6 battery with AGM technology is designed to meet especially high performance demands. It provides dependable energy for extremely demanding starting conditions, while ensuring the reliable supply of a large number of applications - even under extremely tough and straining conditions.
    "22aafdd95183": "بطارية T6 بتقنية AGM مصمّمة لتلبية متطلبات أداء عالية بشكل خاص. وهي توفّر طاقة يُعتمد عليها في ظروف البدء الشديدة الصعوبة، مع ضمان تغذية موثوقة لعدد كبير من الأحمال حتى في أقسى الظروف وأكثرها إجهاداً.",

    // [16 products] The T4 battery, with Full Frame technology, supplies all running applications in heavy duty vehicle operations that require a normal level of energy – even with the engine shut off or in instances of frequent discharge.
    "f7e7c9789367": "بطارية T4 بتقنية الإطار الكامل تغذّي كل الأحمال العاملة في تشغيل المركبات الثقيلة التي تتطلّب مستوى طاقة عادياً، حتى مع إيقاف المحرك أو في حالات التفريغ المتكرّر.",

    // [16 products] Air Temperature Sensors measure the temperature of the incoming air to the engine. This information is provided to the Engine Control Module (ECU) to determine the correct amount of fuel needed for optimum performance and economy.
    "91001620713a": "حساسات حرارة الهواء تقيس درجة حرارة الهواء الداخل إلى المحرك، وتُرسَل هذه المعلومة إلى وحدة التحكم لتحديد كمية الوقود الصحيحة اللازمة لأفضل أداء واقتصاد.",

    // [16 products] Bosch Double Iridium Pin-To-Pin Spark Plugs represent advanced OE spark plug technology and are manufactured to be original equipment (OE) equivalent in fit, form and function. The ultra-fine wire design firing pin and ground electrode pin provide higher performance.
    "996a87162b2b": "بوجيهات بوش Double Iridium Pin-To-Pin تمثّل تقنية بوجيهات القطعة الأصلية المتقدّمة، ومصنوعة لتكون مكافئة للقطعة الأصلية شكلاً ومقاساً ووظيفة. وتصميم دبوس الإشعال ودبوس القطب الأرضي فائقي الدقة يوفّران أداءً أعلى.",

    // [16 products] Bosch Police Pursuit high-performance brake pads are manufactured to meet the demanding needs of law enforcement, ensuring safety, reliability, and superior operation.
    "eda663584dda": "بطانات فرامل بوش Police Pursuit عالية الأداء مصنوعة لتلبية الاحتياجات الشاقة لأعمال إنفاذ القانون، بما يضمن الأمان والموثوقية والتشغيل المتفوّق.",

    // [15 products] The high-pressure pump is responsible for compressing the fuel supplied by the electric fuel pump to the pressure required for high-pressure injection up to 20 MPa (200 bar).
    "3dc642db4748": "طرمبة الضغط العالي مسؤولة عن ضغط الوقود القادم من طرمبة البنزين الكهربائية إلى الضغط اللازم للحقن عالي الضغط، حتى 20 ميجا باسكال (200 بار).",

    // [15 products] The ultra-light Bosch Lithium-ion (Li-ion) PowerSport Battery is a real powerhouse — delivering full performance and increased dynamics to a variety of powersport applications. Thanks to its innovative lithium-ion technology, it features 60% less weight and up to 10X the deep-cycle resistance of com…
    "df2442cfed78": "بطارية بوش Lithium-ion PowerSport فائقة الخفة قوة حقيقية، تقدّم أداءً كاملاً وديناميكية أعلى لمجموعة متنوّعة من المركبات الرياضية. وبفضل تقنية أيونات الليثيوم المبتكرة فهي أخف بنسبة 60% وتتحمّل التفريغ العميق حتى عشرة أضعاف بطاريات الرصاص الحمضية المماثلة.",

    // [15 products] Designed for dependable windshield wiping performance with quick and easy installation.
    "6e97ef39eb85": "مصمّمة لأداء موثوق في مسح الزجاج الأمامي مع تركيب سريع وسهل.",

    // [14 products] Advanced rubber technology in a conventional windshield wiper blade design for quiet operation, a cleaner wipe and longer life.
    "8d258cced467": "تقنية مطاط متقدّمة في تصميم شفرة مساحة تقليدية، لتشغيل هادئ ومسح أنظف وعمر أطول.",

    // [13 products] Patented beam design for all-weather performance
    "187ed4300b2f": "تصميم Beam مسجّل لأداء في كل الأجواء.",

    // [13 products] Bosch XpressFIT PRO™ beam wiper blades are expertly engineered for professionals who demand quick and hassle-free installation. Experience the power of HydroDefense™ technology, featuring a premium rubber wiping edge that ensures long-lasting durability in all weather conditions.
    "5237ccd67584": "مساحات بوش XpressFIT PRO™ من نوع Beam مصمّمة بخبرة للمحترفين الذين يريدون تركيباً سريعاً بلا تعقيد. جرّب قوة تقنية HydroDefense™ بحافة مطاط ممتازة تضمن متانة تدوم طويلاً في كل الأجواء.",

    // [13 products] This innovative hybrid blade has a streamlined design that utilizes patented single beam technology to help provide a replacement for your vehicles original equipment, hybrid windshield wiper blade.
    "c6e19da347e9": "هذه الشفرة الهجينة المبتكرة بتصميم انسيابي يستخدم تقنية Beam المفردة المسجّلة، لتكون بديلاً لشفرة المساحة الهجينة الأصلية في سيارتك.",

    // [13 products] Bosch Spectrum DirectFit™ Hybrid matches the same blade technology and connection fitment to deliver factory performance. The streamlined hybrid design and graphite coated natural rubber enhances wiping performance in all driving conditions. *Currently only available in the US
    "527f9c1092ac": "مساحات بوش Spectrum DirectFit™ الهجينة تعتمد نفس تقنية الشفرة ونفس الوصلة لتقديم أداء المصنع، والتصميم الهجين الانسيابي مع المطاط الطبيعي المطلي بالجرافيت يحسّن أداء المسح في كل ظروف القيادة.",

    // [12 products] Bosch Platinum+4 Spark Plugs deliver smoother acceleration, top fuel economy and ultimate engine performance. Bosch Platinum+4 Spark Plugs reach self-cleaning temperatures faster for quicker starts, smoother acceleration and increased fuel efficiency.
    "2ad673eddd1d": "بوجيهات بوش Platinum+4 تمنح تسارعاً أنعم واقتصاداً أعلى في الوقود وأداءً مثالياً للمحرك. وهي تصل إلى درجة حرارة التنظيف الذاتي أسرع، ما يعني بدءاً أسرع وتسارعاً أنعم وكفاءة وقود أعلى.",

    // [12 products] Bosch Premium Lithium Dual Purpose and Deep Cycle Batteries for marine and RV applications are designed using Lithium Iron Phosphate (also known as LiFePO4) – a rechargeable battery technology offering a safer, longer-lasting, lightweight alternative to conventional lead-acid batteries. Whether you’…
    "207297269c58": "بطاريات بوش Premium Lithium مزدوجة الغرض وذات التفريغ العميق للاستخدامات البحرية والكرفانات مصمّمة بتقنية فوسفات حديد الليثيوم (LiFePO4)، وهي تقنية بطاريات قابلة لإعادة الشحن توفّر بديلاً أكثر أماناً وأطول عمراً وأخف وزناً من بطاريات الرصاص التقليدية.",

    // [10 products] Bosch Leak detection pumps ensure the evaporative emission system (EVAP) is functioning correctly. Leak detection pumps provide pressure so the system can be checked for leaks while other EVAP system valves are closed. A faulty leak detection pump will cause a check engine warning and is an emission…
    "9d5115ebadc9": "طرمبات كشف التسريب من بوش تضمن سلامة عمل منظومة انبعاثات التبخّر (EVAP). وهي توفّر الضغط اللازم لفحص المنظومة بحثاً عن أي تسريب أثناء غلق باقي صمامات المنظومة. وعطل هذه الطرمبة يسبّب إضاءة لمبة تحذير المحرك، وهي قطعة مرتبطة بالانبعاثات.",

    // [9 products] The new Bosch Universal Sensors for Tire Pressure Monitoring Systems (TPMS) measure the air pressure of the vehicle's tires in real time and transmit it directly to the control unit by radio. Universal, compact and easily programmable, Bosch QUICK FIT sensors offer a vehicle coverage of over 90% wit…
    "7477616df6ea": "حساسات بوش العمومية الجديدة لمنظومات مراقبة ضغط الإطارات (TPMS) تقيس ضغط هواء الإطارات لحظياً وترسله لاسلكياً مباشرة إلى وحدة التحكم. وحساسات بوش QUICK FIT عمومية وصغيرة وسهلة البرمجة، وتغطي أكثر من 90% من السيارات برقمَي قطعة فقط.",

    // [8 products] Bosch Electric Rear View Cameras are Original Equipment Manufacturer (OEM) quality. The Rear View Camera (RVC) system provides a visual enhancement for the driver. The rear-view system is designed to be a driver aid and is not an obstacle detection or safety system. The RVC system enables the vehicl…
    "55aad943e70f": "الكاميرات الخلفية الكهربائية من بوش بجودة القطعة الأصلية. ومنظومة الكاميرا الخلفية توفّر تحسيناً بصرياً للسائق، وهي مصمّمة كأداة مساعدة للقيادة وليست نظام كشف عوائق أو نظام أمان. وهي تتيح للسائق مجال رؤية أوسع وتقلّل أثر النقاط العمياء.",

    // [8 products] Supplies the optimal amount of urea fluid (Diesel Exhaust Fluid or DEF) to dosing module.
    "92fe1d3df099": "يغذّي وحدة الحقن بالكمية المثلى من سائل معالجة عادم الديزل (اليوريا).",

    // [7 products] Bosch Low Pressure Sensors are compact, durable, and vibration-resistant with outstanding measuring accuracy to ensure your vehicles fluids at their optimal pressures.
    "17bfcbf71c75": "حساسات الضغط المنخفض من بوش صغيرة الحجم ومتينة ومقاومة للاهتزاز بدقة قياس فائقة، لضمان بقاء سوائل سيارتك عند ضغوطها المثلى.",

    // [6 products] Bosch Exhaust Gas Temperature Sensors (EGTS) measure the temperature in the exhaust system and communicate it to the vehicle's ECU. They also help protect high-quality components — such as turbos, catalytic converters and diesel particulate filters in the hot exhaust tract — and create cleaner emiss…
    "252be2dd1cba": "حساسات حرارة العادم (EGTS) من بوش تقيس درجة الحرارة في منظومة العادم وتبلّغها لوحدة التحكم في السيارة. وهي تساعد أيضاً على حماية المكوّنات عالية القيمة — مثل التوربو والحفّاز وفلتر جسيمات الديزل في مسار العادم الساخن — وتسهم في انبعاثات أنظف.",

    // [4 products] Premium Universal Oxygen Sensors with OE SmartLink are quick and easy to install. Each sensor has two-feet length of sensor wire to allow maximum replacement of worn harnesses.
    "1484521d1dfb": "حساسات الأكسجين العمومية الممتازة بوصلة OE SmartLink سريعة وسهلة التركيب. ولكل حساس سلك بطول قدمين يتيح استبدال أكبر قدر من الضفائر التالفة.",

    // [4 products] Bosch Throttle Position Sensors, using OE or better technology, are designed to record vast measurement data with incredible accuracy.
    "90c15d6123c0": "حساسات وضع البوابة (TPS) من بوش، بتقنية تضاهي القطعة الأصلية أو تتفوّق عليها، مصمّمة لتسجيل كمّ هائل من بيانات القياس بدقة فائقة.",

    // [4 products] Bosch Throttle Bodies are manufactured on OE production lines with best-in-class quality.
    "f1aa780ffaf1": "بشلمانات بوش (أجسام الخانق) مصنوعة على خطوط إنتاج القطعة الأصلية بجودة هي الأفضل في فئتها.",

    // [2 products] Bosch Silver Spark Plugs are engineered for older European performance cars, as well as some motorcycle applications. These types of vehicle engines operate at particularly high combustion chamber temperatures, increasing the wear on the electrodes. Bosch uses silver alloys in the center electrode t…
    "4de0479d5a14": "بوجيهات بوش Silver مصمّمة للسيارات الأوروبية الرياضية الأقدم وكذلك لبعض تطبيقات الدرّاجات النارية. فمحركات هذه المركبات تعمل عند درجات حرارة عالية بشكل خاص داخل غرفة الاحتراق، ما يزيد تآكل الأقطاب. وتستخدم بوش سبائك الفضة في طرف القطب المركزي لمقاومة التآكل ورفع كفاءة البوجيه.",

    // [1 products] Ensures proper fluid temperature and thaws DEF when below 12°F
    "89c49c546061": "يضمن درجة الحرارة المناسبة للسائل ويذيب سائل معالجة العادم عند انخفاض الحرارة دون −11 °م.",

    // [1 products] Bosch 100% New Universal Alternators, available in both 90- and 120-amp versions provide great performance and an upgrade in amperage for many popular heavy duty truck, agricultural and industrial applications.
    "c065b29e4acc": "دينامو الشحن العمومي الجديد بالكامل من بوش، المتوفّر بقدرة 90 و120 أمبير، يقدّم أداءً ممتازاً وزيادة في الأمبير لكثير من تطبيقات الشاحنات الثقيلة والمعدات الزراعية والصناعية.",

    // [1 products] Bosch School Bus Alternators are revolutionizing the School Bus industry with high efficiency alternator technology that has delivered maximum charging power through millions of tough stop-and-go miles worldwide.
    "1af9ec3902ca": "دينامو بوش لحافلات المدارس يُحدث نقلة في هذا القطاع بتقنية دينامو عالية الكفاءة قدّمت أقصى قدرة شحن عبر ملايين الأميال الشاقة من التوقف والحركة حول العالم.",

    // [1 products] Bosch’s new A/C compressors benefit from its OE manufacturing experience, along with the commitment to providing exceptional quality replacement parts through a vigorous release process and stringent quality tests. Which includes endurance, performance, vibration, leak, salt spray, and noise tests. …
    "8585075e5e59": "كمبروسرات التكييف الجديدة من بوش تستفيد من خبرتها في تصنيع القطعة الأصلية، إلى جانب التزامها بتقديم قطع غيار استثنائية الجودة عبر عملية إطلاق صارمة واختبارات جودة مشدّدة تشمل اختبارات التحمّل والأداء والاهتزاز والتسريب ورذاذ الملح والضوضاء.",

    // [1 products] A compact design with nominal 12- or 24-volts. Bosch mini relays are used in a wide range of vehicles. They reliably perform switching operations and allow rated switching currents of up to 75 A. Thanks to their design, they are an ideal solution for safe and quick service tasks.
    "5876a5bfd29c": "تصميم مدمج بجهد اسمي 12 أو 24 فولت. تُستخدم ريلاي بوش الميني في مدى واسع من المركبات، وتؤدي عمليات التبديل بموثوقية وتتحمّل تيار تبديل اسمياً حتى 75 أمبير. وبفضل تصميمها فهي حل مثالي لأعمال الصيانة السريعة والآمنة.",

    // [1 products] Bosch Distributor Caps and Rotors are made from top quality materials throughout to ensure high performance and long product life.
    "ee0f8e0405b8": "أغطية ودوّارات الموزع من بوش مصنوعة من خامات عالية الجودة بالكامل لضمان أداء عالٍ وعمر طويل للمنتج.",

    // [1 products] Bosch Long Haul® Starters carry a 3yr/350K miles warranty. The Bosch SR9920LH, SR9921LH, SR9922LH are typically more powerful, lighter or smaller than competitive 3yr/350K warranty products
    "9ccd49d7d16a": "مواتير المارش بوش Long Haul® بضمان 3 سنوات / 350 ألف ميل. والموديلات SR9920LH و SR9921LH و SR9922LH عادةً أقوى أو أخف أو أصغر من المنتجات المنافسة بنفس الضمان.",

    // [1 products] Bosch bevel gearboxes designed to transmit steering input in applications where direct connection to the steering column is not possible.
    "d4ae22d7a666": "صناديق التروس المخروطية من بوش مصمّمة لنقل حركة التوجيه في التطبيقات التي يتعذّر فيها الاتصال المباشر بعمود الدركسيون.",

    // [1 products] A compact design with nominal 12- or 24-volts. Bosch micro relays are used in a wide range of vehicles. They perform switching operations and allow rated switching currents of up to 25 A. Thanks to their design, they are an ideal solution for quick and easy service tasks.
    "37c7c8de302d": "تصميم مدمج بجهد اسمي 12 أو 24 فولت. تُستخدم ريلاي بوش المايكرو في مدى واسع من المركبات، وتؤدي عمليات التبديل وتتحمّل تيار تبديل اسمياً حتى 25 أمبير. وبفضل تصميمها فهي حل مثالي لأعمال الصيانة السريعة والسهلة.",

    // [1 products] Introduces urea fluid into exhaust system to reduce nitrogen oxides (NOx) emission levels
    "336238605f5d": "يحقن سائل اليوريا في منظومة العادم لخفض مستويات انبعاثات أكاسيد النيتروجين (NOx).",

    // [1 products] Comprehensive range of steering pumps for heavy commercial and bus applications offering high performance due to robust and reliable built. The range consists of vane, energy saving vane, tandem and radial piston pumps for a variety of applications.
    "d17b0242bc1a": "تشكيلة شاملة من طرمبات الباور للتطبيقات التجارية الثقيلة والحافلات، بأداء عالٍ نتيجة بنية متينة وموثوقة. وتضمّ التشكيلة طرمبات ريشية، وريشية موفّرة للطاقة، ومزدوجة، وذات مكابس شعاعية لتطبيقات متنوّعة.",

    // [1 products] Just four (4) SKUs of Bosch Refrigeration Alternators provide coverage for the most popular units in operation today. Bosch OE voltage regulator technology makes Bosch the choice for refrigeration units.
    "f78d60c51a92": "أربعة أرقام قطع فقط من دينامو بوش لوحدات التبريد تغطي أشهر الوحدات العاملة اليوم. وتقنية منظّم الجهد الأصلية من بوش تجعلها الخيار الأول لوحدات التبريد.",

    // [1 products] Bosch has developed a series of superior Long Haul alternators exclusively for the American heavy duty market. These alternators have been specially engineered, employing cutting edge technology and processes, to deliver superior performance and reliability over the long run.
    "0bb17ff46de0": "طوّرت بوش سلسلة متفوّقة من دينامو Long Haul حصرياً لسوق المركبات الثقيلة الأمريكي. وقد صُمّمت هذه الأنواع خصيصاً باستخدام أحدث التقنيات والعمليات لتقديم أداء وموثوقية متفوّقين على المدى الطويل.",

    // [1 products] Bosch Nozzles are designed to withstand the heavy demands of today’s diesel engines. On average, a diesel nozzle fires 1,000 times per minute, so precision and durability are important features. Each Bosch Nozzle is engineered for exacting precision and durability, to deliver a long, reliable servic…
    "2afafb03f55f": "نوزلات بوش مصمّمة لتحمّل المتطلبات الشاقة لمحركات الديزل الحديثة. فنوزل الديزل يطلق في المتوسط ألف مرة في الدقيقة، ولذلك تمثّل الدقة والمتانة خاصيتين أساسيتين. وكل نوزل من بوش مصمّم بدقة ومتانة بالغتين ليقدّم عمراً تشغيلياً طويلاً وموثوقاً وأداءً متفوّقاً وثابتاً لمحرك الديزل.",

    // [1 products] Bosch power steering gears designed for an identical replacement of the original equipment. Range consisting from basic Servocom®, both single and dual circuit, to the latest Servocomtronic® commonly used in domestic and imported trucks and buses.
    "11e5cf5c9a75": "صناديق الدركسيون من بوش مصمّمة لتكون بديلاً مطابقاً للقطعة الأصلية. وتمتد التشكيلة من نظام Servocom® الأساسي بدائرة مفردة أو مزدوجة، إلى أحدث نظام Servocomtronic® الشائع في الشاحنات والحافلات المحلية والمستوردة.",

    // [1 products] Bosch steering shafts play a crucial link between the steering wheel and steering gear. Precision manufacturing ensuring a secure connection even in toughest driving conditions.
    "f2e99c747626": "أعمدة الدركسيون من بوش تمثّل حلقة وصل حاسمة بين عجلة القيادة وصندوق الدركسيون. والتصنيع الدقيق يضمن اتصالاً محكماً حتى في أقسى ظروف القيادة.",

    // [1 products] Power cylinders offer assistance in a variety of applications where additional steering torque is required also where there is a need for rear axle steering.
    "93f0c54b7f28": "اسطوانات الباور توفّر مساندة في التطبيقات التي تحتاج عزم توجيه إضافياً، وكذلك حيث يلزم توجيه المحور الخلفي.",

    // [1 products] Bosch Severe Duty just got better with optimal all-around braking performance. Our new brake pads use Advanced Aerospace Alloy Transfer Layer Technology in our friction formulas that have the best-in-class performance, quiet operation and long life. Severe Duty pads utilize OE-style multilayer shims…
    "61aebd66d577": "فئة Severe Duty من بوش صارت أفضل بأداء فرملة مثالي في كل الاتجاهات. وبطانات الفرامل الجديدة تستخدم تقنية طبقة النقل بالسبائك الفضائية المتقدّمة في تركيبات الاحتكاك، بأداء هو الأفضل في فئته وتشغيل هادئ وعمر طويل. كما تستخدم بطانات Severe Duty فلنكات متعدّدة الطبقات بنمط القطعة الأصلية وشقوقاً وحوافاً مشطوفة بنمط أصلي لضبط التركيب.",

    // [1 products] QuietCast™ Medium Duty Premium Disc Brake Pads are designed to give medium duty vehicles increased pad life, quiet stops, low dust, and great pedal feel. They are manufactured using OE friction formulas or friction formula upgrades
    "cef16750e579": "بطانات الفرامل QuietCast™ Medium Duty Premium مصمّمة لتمنح المركبات متوسطة الحمولة عمراً أطول للبطانة، وتوقّفاً هادئاً، وأتربة أقل، وإحساساً ممتازاً بالدوّاسة. وهي مصنوعة بتركيبات احتكاك أصلية أو بترقيات لها.",

    // [1 products] Bosch power relays are used for switching operations in engines, starters and other large products. They work with rated switching currents of up to 350 A (and up to 3500 A in the case of battery cut-off relays).
    "d5138bd343db": "ريلاي القدرة من بوش تُستخدم في عمليات التبديل في المحركات ومواتير المارش وغيرها من المنتجات الكبيرة، وتعمل بتيار تبديل اسمي حتى 350 أمبير (وحتى 3500 أمبير في حالة ريلاي فصل البطارية).",

    // [1 products] Bosch Long Haul Commercial Starters are engineered with many new technical features specifically designed to outlast and outperform the original equipment starters on some of the toughest service equipment in use today.
    "84bf91975afe": "مواتير المارش التجارية بوش Long Haul مصمّمة بعدد كبير من المزايا التقنية الجديدة الموضوعة خصيصاً لتتفوّق في العمر والأداء على مواتير المارش الأصلية في بعض أقسى المعدات المستخدمة اليوم.",

    // [1 products] Medium and heavy duty trucks manufactured starting on January 1, 2010 are required to meet the EPA Emission Standards. The majority of truck manufacturers chose to use selective catalytic reduction (SCR) technology to meet the standards. As part of SCR technology, Bosch provides the Denonxtronic 2.2…
    "100d363a26ee": "الشاحنات المتوسطة والثقيلة المصنوعة اعتباراً من أول يناير 2010 مُلزَمة بتحقيق معايير انبعاثات وكالة حماية البيئة الأمريكية، وقد اختار معظم المصنّعين تقنية الاختزال الحفّاز الانتقائي (SCR) لتحقيقها. وكجزء من هذه التقنية توفّر بوش منظومة الحقن Denoxtronic 2.2 التي تحقن اليوريا في العادم لتتفاعل مع حفّاز SCR وتخفض مستوى انبعاثات أكاسيد النيتروجين.",

    // [1 products] Bosch is revolutionizing the commercial vehicle industry with high output technology. The Bosch AL9964SB represents the next generation of commercial vehicle charging technology, delivering more power and greater output at engine idle than competitive alternators. With 275 amps max output and an ama…
    "b7108970c729": "تُحدث بوش نقلة في قطاع المركبات التجارية بتقنية الخرج العالي. والموديل AL9964SB يمثّل الجيل التالي من تقنية الشحن في المركبات التجارية، بقدرة ومخرجات أعلى عند تعطيل المحرك مقارنة بالدينامو المنافس. وبخرج أقصى 275 أمبير ومعدّل شحن مذهل 210 أمبير عند التعطيل، فهو يساعد على إطالة عمر البطارية بتقليل تفريغها العميق.",

};

/** Arabic for a Bosch short description, or null when it is not in the table. */
function lookup(text) {
    if (!norm(text)) return null;
    return TEXT[hash(text)] || null;
}

module.exports = { TEXT, lookup, hash, norm };
