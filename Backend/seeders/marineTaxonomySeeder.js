/**
 * The marine category taxonomy: sub-categories and their sub-sub-categories under five of
 * the main categories. Adds only — nothing is renamed or removed, and products keep the
 * category they have. Safe to run again: a category already under the same parent (by its
 * English name) is kept, with its Arabic name corrected to the sheet's.
 *
 *   node ./seeders/marineTaxonomySeeder.js           # shows what would be added
 *   node ./seeders/marineTaxonomySeeder.js --apply   # adds it
 *
 * The main categories are found by their Arabic name, since their English names differ
 * from the sheet ("Marine" is "Boat Equipment" here, "Camping" is "Camping & Outdoor").
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Category } = require('../models/categories');

// [main category's Arabic name, [[sub EN, sub AR, [[leaf EN, leaf AR], ...]], ...]]
const TAXONOMY = [
    ['أدوات الصيد', [
        ['Choose your game', 'أقسام مخصصة', [
            ['King Fish Special', 'معدات صيد الكنعد'], ['Big Game', 'البيج جيم'],
        ]],
        ['Fishing Reels', 'ماكينات الصيد', [
            ['Spinning Reels', 'ماكينات مخصصه للكاست'], ['Overhead Reels', 'ماكينات مخصصه للجقنق'],
            ['Trolling Reels', 'ماكينات مخصصه للفاح'], ['Electric Reels', 'ماكينات الصيد الكهربائية'],
        ]],
        ['Fishing Rods', 'قصبات الصيد', [
            ['Casting Rods', 'قصبات مخصصه للكاستنق'], ['Trolling Rods', 'قصبات مخصصه للفاح'],
            ['Jigging Rods', 'قصبات مخصصه للجقنق'],
        ]],
        ['Combos', 'صنارات جاهزة', [
            ['Casting', 'كومبو الكاستنق'], ['Trolling', 'كومبو اللفاح'], ['Jigging', 'كومبو جيقنق'],
            ['Lures Set', 'كومبو لورات'], ['Jigs Set', 'كومبو جيقات'],
        ]],
        ['Fishing Lines', 'خيوط الصيد', [
            ['Braided Line', 'خيوط البريد'], ['Mono Line', 'خيوط المونو'],
            ['Flouro Leader', 'خيط الفلورو كربون'], ['Wire Line Leader', 'مسين الصيد "ليدر"'],
        ]],
        ['Fishing Lures', 'لورات الصيد', [
            ['Casting Lures', 'لورات الكاستنق'], ['Trolling', 'لورات اللفاح'], ['Jigs', 'لورات الجقنق'],
            ['Soft Bait', 'سوفت بيت'], ['Stick bait', 'ستيك بيت (Stick bait)'], ['Poppers', 'البوبرات - لورات البوبر'],
            ['Live Bait Rig', 'ريجات الطعم الحي'], ['Sabiki', 'خيوط الشب'], ['Saltwater Flies', 'فلاي'],
        ]],
        ['Terminal Tackle', 'مستلزمات الصيد', [
            ['Hooks', 'ميادير'], ['Snaps & Swivels', 'سنابات والدواري'], ['Sinkers & Diving Boards', 'بلود'],
            ['Solid & Split Rings', 'سبليت رنج'], ['Tackle Kits', 'مجموعات كاملة'],
            ['Pliers & Scissors', 'مقصات و بلايرز'], ['Assist Hooks & Threads', 'أسيست هوك'],
        ]],
        ['Fishing Accessories', 'أكسسوارات الصيد', [
            ['Storage Bags', 'حقائب صيد'], ['Tackle Boxes', 'صناديق التخزين'], ['Rod Holders', 'قاعدة قصبات'],
            ['Net & Gaffs', 'الشباك والمخالب'], ['Harnesses & Belts', 'أحزمة الصيد'],
            ['Headlamps & Lights', 'كشافات الصيد'], ['Knives & Line Cutters', 'سكاكين التقطيع'],
            ['Ice Coolers', 'ثلاجات'], ['Reel Knobs & Stands', 'مقابض ماكينات الصيد'],
            ['Reel Maintenance', 'صيانة الماكينات'], ['Weighing Scales', 'ميزان الكتروني للأسماك'],
            ['Accessories', 'اكسسوارات أخرى'],
        ]],
    ]],
    ['الرياضات المائيه', [
        ['Diving', 'الغوص', [
            ['Bags', 'الحقائب'], ['Masks', 'نظارات الغوص'], ['Fins', 'زعانف'],
            ['Wet Suits & Rashguards', 'بدلات الغوص'], ['Socks', 'جوارب'], ['Gloves', 'قفازات'],
            ['BCD Jackets', 'جاكيت BCD'], ['Regulators', 'منظم هواء'], ['Diving Sets', 'معدات كاملة'],
            ['Underwater Scooter', 'سكوتر مائي'], ['Underwater Lights', 'كشافات غوص'],
        ]],
        ['Snorkeling', 'سنوركلنج', [
            ['Snorkels', 'سنوركل'], ['Masks', 'نظارات غوص'], ['Fins', 'زعانف'],
        ]],
        ['Kayaking & Boating', 'كاياك', [
            ['Boats & SUP', 'قوارب'], ['Inflatable Boats', 'قوارب مطاطية'], ['Kayaks', 'قوارب كاياك'],
            ['Kayak Paddles', 'مجداف الكاياك'], ['Trolleys', 'ترولي للكاياك'],
            ['Car Roof Racks', 'رفوف سقف السيارة'], ['Anchors', 'مرساة'], ['Air Pumps', 'مضخات هواء'],
            ['Dry Bags', 'حقائب ضد الماء'], ['Rod Holders', 'حوامل القصبات'],
            ['Kayak Coolers', 'مبردات الكاياك'], ['Life Jackets', 'جاكت السلامة والانقاذ'],
            ['Trolling Motor', 'موتور الكاياك للفاح'],
        ]],
        ['Spear Fishing', 'معدات الغوص الحر', [
            ['Spearguns', 'سبير جن'], ['Wishbone', 'ويش بون'], ['Accessories', 'اكسسوارات'],
        ]],
        ['Beach & Pool Accessories', 'مستلزمات الألعاب المائية', [
            ['Inflatable Lounge', 'لوح عائم - عوامات'], ['Kids Arm Floats', 'أدوات السباحة للأطفال'],
            ['Donut Ride', 'عوامات قابلة للقطر'], ['Beach Towels', 'مناشف للشاطيء'],
            ['Swimming Pools for Kids', 'برك السباحة'],
        ]],
        ['Swimming', 'السباحة', [
            ['Swimming Goggles', 'نظارات السباحة'], ['Swim Caps', 'كاب مخصص للسباحة'],
            ['Briefs', 'ملابس السباحة الداخلية'], ['Swimsuits', 'بدلات سباحة'],
        ]],
    ]],
    ['معدات القوارب', [
        ['Boats & Accessories', 'أكسسوارات القوارب', [
            ['Boats', 'قوارب مطاطية ترفيهية'], ['Kayaks', 'كاياك'], ['Inflatable Boats', 'قوارب مطاطية للصيد'],
            ['Rod Holders', 'قواعد القصبات'], ['Mounts', 'قواعد تثبيت'], ['Steering Wheels', 'عجلات قيادة القوارب'],
            ['Fillet & Bait Tables', 'طاولات قوارب'], ['Shades & Blinds', 'ستائر ونوافذ القوارب'],
            ['Downriggers', 'داون ريجرز'], ['Flags', 'أعلام قوارب'],
            ['Trolling Motor', 'موتور الترولنج واللفاح'], ['Boat Seats & Cushions', 'مقاعد القارب والأغطية'],
        ]],
        ['Safety & Survival', 'السلامة والانقاذ', [
            ['Life Jackets & PFDs', 'سترات النجاة'], ['Boat Rescue System', 'مجموعة انقاذ القوارب'],
            ['Health Safety Kits', 'صندوق الاسعافات الأولية'], ['Watertight Case', 'حقائب مانعة لتسرب الماء'],
        ]],
        ['Electronics', 'إلكترونيات', [
            ['GPS', 'الملاحة GPS'], ['Subwoofers', 'صب ووفر'], ['Amplifiers', 'أمبليفير'],
            ['Tower Speakers', 'سماعات معلقة'], ['Batteries and Boxes', 'البطاريات و الصناديق'],
            ['Fans', 'مروحة بحرية للقارب'], ['Wireless Chargers', 'شاحن لاسلكي'],
            ['Battery Switches', 'مفاتيح توزيع كهرباء'],
        ]],
        ['Lighting', 'إضاءة القوارب', [
            ['Underwater Lights', 'إضاءة اسفل القارب'], ['Flood Lights', 'إضاءة سطح القارب'],
            ['Flush Mount Down Lights', 'إضاءة سبوت'], ['Courtesy & Accent Lights', 'إضاءة قمرة القيادة'],
            ['Incandescent Lights', 'اضاءة غرفة المحرك'],
        ]],
        ['Boat Cleaning', 'معدات تنظيف القارب', [
            ['Mechanisms & Engine Care', 'تنظيف المحرك'], ['Metal Care / Gelcoat Care', 'تنظيف الجل كوت والمعادن'],
            ['Cleaners', 'منظفات وملمع الطراد'], ['Paint & Protection', 'أدوات طلاء وحماية'],
        ]],
        ['Anchor & Docking', 'أدوات الرسو والتثبيت', [
            ['Anchors', 'المرساة'], ['Buoy', 'العوامات ومصدات الصدمات'],
            ['Boat Hooks & Moors', 'آلات ربط القارب'], ['Fenders & Accessories', 'المصدات و حماية'],
        ]],
        ['Cabin & Galley', 'الكابينة والمطبخ', [
            ['Cookware & Accessories', 'تجهيزات المطابخ البحرية'], ['Clocks & Meters', 'ساعات و أدوات قياس'],
        ]],
    ]],
    ['التخييم', [
        ['Chairs & Tables', 'مقعد للشاطيء و التخييم', [
            ['Foldable Chairs', 'مقاعد سهلة التخزين'], ['Chairs with Table', 'مقاعد بمنضدة مثبتة'], ['Tables', 'طاولات'],
        ]],
        ['Tents & Sleeping Gear', 'الخيام وحقائب النوم', [
            ['Tents', 'الخيام'], ['Sleeping Bags', 'حقائب نوم'], ['Sleeping Mats', 'مراتب رقيقة'],
            ['Air Beds & Seats', 'مرتبة هوائية للنوم'], ['Canopies & Umbrellas', 'شمسيات و مظلات'],
        ]],
        ['Coolers', 'برادات', [
            ['Cool Bags', 'برادات حقائب حافظة للبرودة'], ['Hard Coolers', 'صناديق ثلج حافظة للبرودة'],
            ['Ice Boxes', 'صناديق تبريد'], ['Water Coolers', 'مبردات مياه'],
        ]],
        ['Camping Lights', 'إضاءة للتخييم', [
            ['Lanterns', 'مصابيح محمولة LED'], ['LED Lights', 'كشافات LED'], ['Flash Lights', 'مصابيح اليد'],
        ]],
        ['Outdoor Cooking', 'مستلزمات الطبخ', [
            ['Stoves', 'موقد غاز'], ['Gas', 'أسطوانات غاز'], ['Bonfire', 'بون فاير'],
            ['Charcoal & Firewood', 'فحم'], ['Teapot & Utensil', 'أدوات الطبخ'], ['BBQ Grills', 'شوايات باربكيو'],
        ]],
        ['Camping Accessories', 'أكواب السفر وبرطمانات', [
            ['Water Bottles & Cans', 'زجاجات مياه'], ['Foldable Trolleys', 'ترولي قابل للطي'],
            ['Picnic Bags', 'حقائب للنزهة'], ['Storage Boxes', 'صناديق التخزين'],
            ['Camping Power', 'بطاريات التخييم'], ['Portable Toilets', 'مراحيض محمولة للتخييم'],
        ]],
        ['Hunting Accessories', 'ادوات الصيد (البري)', [
            ['Gloves', 'قفازات'], ['Hunting & Survival Knives', 'سكاكين فولاذية'],
            ['Tactical Flashlight', 'كشافات إضاءة الصيد'], ['Binoculars', 'مناظير الرؤية عن بعد'],
        ]],
    ]],
    ['الملابس', [
        ['Fishing Clothing', 'الملابس', [
            ['Shirts', 'القمصان'], ['Shorts', 'الشورتات'], ['Performance Hoodies', 'الهودي'],
            ['Jackets', 'جاكيتات'], ['Kids Shirts', 'ملابس أطفال'], ["Women's Leggings", 'ليجن نسائي'],
        ]],
        ['Footwear', 'الأحذية', [
            ['Water Shoes', 'الأحذية المائية'], ['Sandals', 'صنادل'],
        ]],
        ['Accessories', 'اكسسوارات', [
            ['Sunglasses', 'نظارات شمسية'], ['Caps & Hats', 'القبعات'], ['Gloves', 'قفازات الصيد'],
            ['Faceshield', 'أغطية الوجه'], ['Poncho Towels', 'منشفة للبحر'], ['Arm Sleeves', 'أكمام الذراع'],
            ['Multifunctional Headwears', 'أغطية رأس متعددة'],
        ]],
    ]],
];

const apply = process.argv.includes('--apply');

// Finds the category with this English name under `parentId` — bringing its Arabic name in
// line with the sheet — or creates it (with --apply).
async function ensure(name, name_ar, parentId, sort_order, stats) {
    const existing = await Category.findOne({ name, parent_id: parentId });
    if (existing) {
        if (existing.name_ar === name_ar) { stats.kept++; return existing; }
        stats.renamed++;
        if (apply) await Category.updateOne({ _id: existing._id }, { $set: { name_ar } });
        return existing;
    }
    stats.added++;
    if (!apply) return { _id: new mongoose.Types.ObjectId() };
    return Category.create({ name, name_ar, parent_id: parentId, sort_order, is_active: true });
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const stats = { added: 0, renamed: 0, kept: 0 };
    for (const [mainAr, subs] of TAXONOMY) {
        const main = await Category.findOne({ name_ar: mainAr, parent_id: null });
        if (!main) throw new Error(`Main category "${mainAr}" not found`);
        let leaves = 0;
        for (const [i, [subEn, subAr, leafList]] of subs.entries()) {
            const sub = await ensure(subEn, subAr, main._id, i, stats);
            for (const [j, [leafEn, leafAr]] of leafList.entries()) {
                await ensure(leafEn, leafAr, sub._id, j, stats);
                leaves++;
            }
        }
        console.log(`${main.name} (${mainAr}): ${subs.length} sub-categories, ${leaves} under them`);
    }
    console.log(`${apply ? 'Added' : 'Would add'} ${stats.added}, ${apply ? 'renamed' : 'would rename'} ${stats.renamed} (Arabic name), unchanged ${stats.kept}.`);
    await mongoose.disconnect();
})().catch((err) => { console.error(err.message); process.exit(1); });
