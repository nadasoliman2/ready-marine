export const mockCarBrands = [
  { id: '1', name: 'Toyota', image: 'https://images.pexels.com/photos/112460/pexels-photo-112460.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '1', name: 'Corolla', brand_id: '1' }, { id: '2', name: 'Camry', brand_id: '1' }, { id: '3', name: 'Land Cruiser', brand_id: '1' }, { id: '4', name: 'Hilux', brand_id: '1' }] },
  { id: '2', name: 'BMW', image: 'https://images.pexels.com/photos/170811/pexels-photo-170811.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '5', name: '3 Series', brand_id: '2' }, { id: '6', name: '5 Series', brand_id: '2' }, { id: '7', name: 'X5', brand_id: '2' }] },
  { id: '3', name: 'Mercedes', image: 'https://images.pexels.com/photos/120049/pexels-photo-120049.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '8', name: 'C-Class', brand_id: '3' }, { id: '9', name: 'E-Class', brand_id: '3' }, { id: '10', name: 'GLE', brand_id: '3' }] },
  { id: '4', name: 'Honda', image: 'https://images.pexels.com/photos/116675/pexels-photo-116675.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '11', name: 'Civic', brand_id: '4' }, { id: '12', name: 'Accord', brand_id: '4' }, { id: '13', name: 'CR-V', brand_id: '4' }] },
  { id: '5', name: 'Hyundai', image: 'https://images.pexels.com/photos/1335077/pexels-photo-1335077.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '14', name: 'Elantra', brand_id: '5' }, { id: '15', name: 'Tucson', brand_id: '5' }, { id: '16', name: 'Sonata', brand_id: '5' }] },
  { id: '6', name: 'Nissan', image: 'https://images.pexels.com/photos/210019/pexels-photo-210019.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '17', name: 'Altima', brand_id: '6' }, { id: '18', name: 'Pathfinder', brand_id: '6' }, { id: '19', name: 'Patrol', brand_id: '6' }] },
  { id: '7', name: 'Ford', image: 'https://images.pexels.com/photos/909907/pexels-photo-909907.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '20', name: 'F-150', brand_id: '7' }, { id: '21', name: 'Explorer', brand_id: '7' }, { id: '22', name: 'Mustang', brand_id: '7' }] },
  { id: '8', name: 'Kia', image: 'https://images.pexels.com/photos/1104768/pexels-photo-1104768.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '23', name: 'Sportage', brand_id: '8' }, { id: '24', name: 'Sorento', brand_id: '8' }, { id: '25', name: 'Cerato', brand_id: '8' }] },
  { id: '9', name: 'Audi', image: 'https://images.pexels.com/photos/1009871/pexels-photo-1009871.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '26', name: 'A4', brand_id: '9' }, { id: '27', name: 'A6', brand_id: '9' }, { id: '28', name: 'Q7', brand_id: '9' }] },
  { id: '10', name: 'Chevrolet', image: 'https://images.pexels.com/photos/1149831/pexels-photo-1149831.jpeg?auto=compress&cs=tinysrgb&w=400', models: [{ id: '29', name: 'Malibu', brand_id: '10' }, { id: '30', name: 'Tahoe', brand_id: '10' }, { id: '31', name: 'Silverado', brand_id: '10' }] },
];

export const mockCategories = [
  {
    id: 'c1', name: 'Engine Parts', name_ar: 'قطع المحرك',
    image: 'https://images.pexels.com/photos/1592384/pexels-photo-1592384.jpeg?auto=compress&cs=tinysrgb&w=400',
    subcategories: [
      {
        id: 'c1-1', name: 'Filters', name_ar: 'الفلاتر', parent_id: 'c1',
        subcategories: [
          { id: 'c1-1-1', name: 'Oil Filters', name_ar: 'فلاتر الزيت', parent_id: 'c1-1' },
          { id: 'c1-1-2', name: 'Air Filters', name_ar: 'فلاتر الهواء', parent_id: 'c1-1' },
          { id: 'c1-1-3', name: 'Fuel Filters', name_ar: 'فلاتر الوقود', parent_id: 'c1-1' },
        ]
      },
      { id: 'c1-2', name: 'Belts & Chains', name_ar: 'السيور والسلاسل', parent_id: 'c1' },
      { id: 'c1-3', name: 'Pistons & Rings', name_ar: 'المكابس والحلقات', parent_id: 'c1' },
      { id: 'c1-4', name: 'Gaskets', name_ar: 'الحشيات', parent_id: 'c1' },
    ]
  },
  {
    id: 'c2', name: 'Brakes', name_ar: 'الفرامل',
    image: 'https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=400',
    subcategories: [
      { id: 'c2-1', name: 'Brake Pads', name_ar: 'تيل الفرامل', parent_id: 'c2' },
      { id: 'c2-2', name: 'Brake Discs', name_ar: 'أقراص الفرامل', parent_id: 'c2' },
      { id: 'c2-3', name: 'Brake Calipers', name_ar: 'قاطمات الفرامل', parent_id: 'c2' },
    ]
  },
  {
    id: 'c3', name: 'Suspension', name_ar: 'نظام التعليق',
    image: 'https://images.pexels.com/photos/3806288/pexels-photo-3806288.jpeg?auto=compress&cs=tinysrgb&w=400',
    subcategories: [
      { id: 'c3-1', name: 'Shock Absorbers', name_ar: 'ماصات الصدمات', parent_id: 'c3' },
      { id: 'c3-2', name: 'Springs', name_ar: 'النوابض', parent_id: 'c3' },
      { id: 'c3-3', name: 'Control Arms', name_ar: 'أذرع التحكم', parent_id: 'c3' },
    ]
  },
  {
    id: 'c4', name: 'Electrical', name_ar: 'الكهرباء',
    image: 'https://images.pexels.com/photos/4116218/pexels-photo-4116218.jpeg?auto=compress&cs=tinysrgb&w=400',
    subcategories: [
      { id: 'c4-1', name: 'Batteries', name_ar: 'البطاريات', parent_id: 'c4' },
      { id: 'c4-2', name: 'Alternators', name_ar: 'الدينامو', parent_id: 'c4' },
      { id: 'c4-3', name: 'Starters', name_ar: 'موتور التشغيل', parent_id: 'c4' },
    ]
  },
  {
    id: 'c5', name: 'Body Parts', name_ar: 'قطع الهيكل',
    image: 'https://images.pexels.com/photos/3862365/pexels-photo-3862365.jpeg?auto=compress&cs=tinysrgb&w=400',
    subcategories: [
      { id: 'c5-1', name: 'Bumpers', name_ar: 'الدفعات', parent_id: 'c5' },
      { id: 'c5-2', name: 'Mirrors', name_ar: 'المرايا', parent_id: 'c5' },
      {
        id: 'c5-3', name: 'Lights', name_ar: 'الأضواء', parent_id: 'c5',
        subcategories: [
          { id: 'c5-3-1', name: 'Headlights', name_ar: 'المصابيح الأمامية', parent_id: 'c5-3' },
          { id: 'c5-3-2', name: 'Taillights', name_ar: 'المصابيح الخلفية', parent_id: 'c5-3' },
          { id: 'c5-3-3', name: 'Fog Lights', name_ar: 'مصابيح الضباب', parent_id: 'c5-3' },
        ]
      },
    ]
  },
  {
    id: 'c6', name: 'Cooling System', name_ar: 'نظام التبريد',
    image: 'https://images.pexels.com/photos/4489732/pexels-photo-4489732.jpeg?auto=compress&cs=tinysrgb&w=400',
    subcategories: [
      { id: 'c6-1', name: 'Radiators', name_ar: 'الرادياتيرات', parent_id: 'c6' },
      { id: 'c6-2', name: 'Thermostats', name_ar: 'الثيرموستات', parent_id: 'c6' },
      { id: 'c6-3', name: 'Water Pumps', name_ar: 'مضخات الماء', parent_id: 'c6' },
    ]
  },
];

export const mockProducts = [
  {
    id: 'p1', title_en: 'Premium Oil Filter - Universal', title_ar: 'فلتر زيت بريميوم - عالمي',
    slug_en: 'premium-oil-filter-universal', slug_ar: 'فلتر-زيت-بريميوم-عالمي',
    price: 24.99,
    image: 'https://images.pexels.com/photos/4489748/pexels-photo-4489748.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.8, reviews_count: 324, is_featured: true, is_special_offer: false, sold_count: 1850
  },
  {
    id: 'p2', title_en: 'Ceramic Brake Pads Set - Front', title_ar: 'طقم تيل فرامل سيراميك - أمامي',
    slug_en: 'ceramic-brake-pads-set-front', slug_ar: 'طقم-تيل-فرامل-سيراميك-أمامي',
    price: 89.99,
    image: 'https://images.pexels.com/photos/3807571/pexels-photo-3807571.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.7, reviews_count: 218, is_featured: true, is_special_offer: false, sold_count: 1620
  },
  {
    id: 'p3', title_en: 'Heavy Duty Shock Absorber', title_ar: 'ماص صدمات للاستخدام الشاق',
    slug_en: 'heavy-duty-shock-absorber', slug_ar: 'ماص-صدمات-للاستخدام-الشاق',
    price: 149.99,
    image: 'https://images.pexels.com/photos/3806288/pexels-photo-3806288.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.6, reviews_count: 189, is_featured: true, is_special_offer: false, sold_count: 1340
  },
  {
    id: 'p4', title_en: 'High Performance Air Filter', title_ar: 'فلتر هواء عالي الأداء',
    slug_en: 'high-performance-air-filter', slug_ar: 'فلتر-هواء-عالي-الأداء',
    price: 34.99,
    image: 'https://images.pexels.com/photos/4116218/pexels-photo-4116218.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.9, reviews_count: 412, is_featured: true, is_special_offer: false, sold_count: 2100
  },
  {
    id: 'p5', title_en: 'Timing Belt Kit Complete', title_ar: 'طقم سير التوقيت كامل',
    slug_en: 'timing-belt-kit-complete', slug_ar: 'طقم-سير-التوقيت-كامل',
    price: 119.99,
    image: 'https://images.pexels.com/photos/1592384/pexels-photo-1592384.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.5, reviews_count: 267, is_featured: true, is_special_offer: false, sold_count: 980
  },
  {
    id: 'p6', title_en: 'Car Battery 70Ah - AGM', title_ar: 'بطارية سيارة 70 أمبير - AGM',
    slug_en: 'car-battery-70ah-agm', slug_ar: 'بطارية-سيارة-70-أمبير-agm',
    price: 189.99,
    image: 'https://images.pexels.com/photos/3862365/pexels-photo-3862365.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.7, reviews_count: 156, is_featured: true, is_special_offer: false, sold_count: 870
  },
  {
    id: 'p7', title_en: 'Vented Brake Disc - 300mm', title_ar: 'قرص فرامل مهوى - 300 مم',
    slug_en: 'vented-brake-disc-300mm', slug_ar: 'قرص-فرامل-مهوى-300-مم',
    price: 75.99,
    image: 'https://images.pexels.com/photos/4489732/pexels-photo-4489732.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.4, reviews_count: 203, is_featured: true, is_special_offer: false, sold_count: 760
  },
  {
    id: 'p8', title_en: 'LED Headlight Bulb H7 Pair', title_ar: 'مصباح هيدلايت LED H7 زوج',
    slug_en: 'led-headlight-bulb-h7-pair', slug_ar: 'مصباح-هيدلايت-led-h7-زوج',
    price: 59.99,
    image: 'https://images.pexels.com/photos/1149831/pexels-photo-1149831.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.6, reviews_count: 445, is_featured: true, is_special_offer: false, sold_count: 2340
  },
  {
    id: 'sp1', title_en: 'Fuel Filter Kit - 2pcs', title_ar: 'طقم فلاتر وقود - 2 قطعة',
    slug_en: 'fuel-filter-kit-2pcs', slug_ar: 'طقم-فلاتر-وقود-2-قطعة',
    price: 28.99, original_price: 49.99,
    image: 'https://images.pexels.com/photos/4489748/pexels-photo-4489748.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.3, reviews_count: 178, is_featured: false, is_special_offer: true, sold_count: 640
  },
  {
    id: 'sp2', title_en: 'Front Bumper Cover - Universal', title_ar: 'غطاء الصدام الأمامي - عالمي',
    slug_en: 'front-bumper-cover-universal', slug_ar: 'غطاء-الصدام-الأمامي-عالمي',
    price: 129.99, original_price: 199.99,
    image: 'https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.2, reviews_count: 89, is_featured: false, is_special_offer: true, sold_count: 320
  },
  {
    id: 'sp3', title_en: 'Coil Spring Set - Rear', title_ar: 'طقم نوابض خلفية',
    slug_en: 'coil-spring-set-rear', slug_ar: 'طقم-نوابض-خلفية',
    price: 84.99, original_price: 139.99,
    image: 'https://images.pexels.com/photos/3806288/pexels-photo-3806288.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.5, reviews_count: 134, is_featured: false, is_special_offer: true, sold_count: 450
  },
  {
    id: 'sp4', title_en: 'Engine Gasket Set - Complete', title_ar: 'طقم حشيات المحرك - كامل',
    slug_en: 'engine-gasket-set-complete', slug_ar: 'طقم-حشيات-المحرك-كامل',
    price: 69.99, original_price: 119.99,
    image: 'https://images.pexels.com/photos/1592384/pexels-photo-1592384.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.6, reviews_count: 211, is_featured: false, is_special_offer: true, sold_count: 590
  },
  {
    id: 'sp5', title_en: 'Radiator - Aluminum Core', title_ar: 'رادياتير - قلب ألمنيوم',
    slug_en: 'radiator-aluminum-core', slug_ar: 'رادياتير-قلب-ألمنيوم',
    price: 159.99, original_price: 249.99,
    image: 'https://images.pexels.com/photos/4116218/pexels-photo-4116218.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.4, reviews_count: 97, is_featured: false, is_special_offer: true, sold_count: 280
  },
  {
    id: 'sp6', title_en: 'Door Mirror Electric Fold - Pair', title_ar: 'مرايا باب كهربائية قابلة للطي - زوج',
    slug_en: 'door-mirror-electric-fold-pair', slug_ar: 'مرايا-باب-كهربائية-قابلة-للطي-زوج',
    price: 109.99, original_price: 169.99,
    image: 'https://images.pexels.com/photos/1149831/pexels-photo-1149831.jpeg?auto=compress&cs=tinysrgb&w=500',
    rating: 4.3, reviews_count: 156, is_featured: false, is_special_offer: true, sold_count: 390
  },
];

export const YEARS = Array.from({ length: 30 }, (_, i) => (2025 - i).toString());
