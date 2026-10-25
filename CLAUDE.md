# Ready Marine

## Git — فرع واحد بس

**اشتغل على `main` مباشرة. متعملش فروع جديدة خالص.**

ده قرار صاحب المشروع: `main` هو الفرع الوحيد، وهو اللي بيعكس اللي شغال على السيرفر.
متعملش `git checkout -b`، ومتفتحش PRs، إلا لو طُلب منك بالنص.

الريموت: `https://github.com/nadasoliman2/ready-marine.git`. ده مشروع منفصل عن ReadyCar —
متربطوش بريبو ready-car ومتنقلش منه commits.

## النشر على السيرفر

التعديلات مش بتوصل للسيرفر غير بإعادة بناء الـ containers:

```bash
docker compose up -d --build backend frontend
```

الخدمات: `readymarine_backend` (منفذ 4001)، `readymarine_frontend` (منفذ 3001)،
`readymarine_redis`. مفيش Mongo محلي: قاعدة البيانات MongoDB Atlas (`ready-marine`)،
ورابطها `MONGO_URI` في `Backend/.env`.

الكتالوج البحري (ماركات المحركات والمراكب، والماركات، والمنتجات) بيتعمل بـ
`node ./seeders/marineCatalogSeeder.js --reset` — وده بيمسح المنتجات الموجودة.

## الفرونت — متعرّفش كومبوننت جوه كومبوننت

متكتبش `const Row = () => ...` جوه كومبوننت تاني وتستخدمه كـ `<Row />`. React بيشوفه
نوع جديد مع كل render، فبيمسح الـ inputs اللي جواه ويبنيها من الأول — والكيبورد على
الموبايل بيتقفل بعد كل حرف. عرّف الكومبوننت على مستوى الملف وابعتله props، أو خليه
دالة عادية (`renderRow(...)`) وناديها.

`npm run build` بيشغّل `lint:nested-components` الأول وبيفشل لو الغلطة دي موجودة.

## الفرونت — اللغة في أول كل رابط

كل صفحة رابطها بيبدأ بلغتها: `/ar/products`، `/en/product/<slug>`. الـ routes نفسها
مفيهاش لغة — `src/middleware.js` بيخدم `/ar/x` من الـ route بتاع `/x`.

- استورد `Link` من `components/LocaleLink`، مش من `next/link`.
- استورد `useRouter` و`usePathname` من `lib/navigation`، مش من `next/navigation`.
  الـ `usePathname` بتاعه بيرجّع المسار من غير اللغة (`/products`)، فمقارنات زي
  `pathname === '/'` بتفضل شغالة. اللي من `next/navigation` بيرجّع `/ar/products` وبيكسرها.
- لو بتبني مسار من `window.location.pathname`، شيل اللغة الأول بـ `stripLocale` من `lib/locale`.

## التواصل

اشرح بالعربي البسيط.
