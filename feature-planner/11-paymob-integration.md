# تكامل Paymob + سويتش بين البوابتين

> **الحالة:** ✅ **اتنفّذ** (2026-09-13). التوثيق التشغيلي في
> `Backend/docs/PAYMOB_INTEGRATION.md` — هو المرجع، والملف ده بقى سجل القرارات.
>
> **فرقين عن الخطة دي، الاتنين لصالح كود أقل:**
> 1. صفحة الرجوع مش في الفرونت إند. بقت **راوت في الباك إند**
>    (`GET /api/payments/paymob/return`) بيحوّل المتصفح للصفحة الصح على طول —
>    فالشاشات الحالية (checkout / المحفظة / الاشتراك / التوريد) **متغيّرتش ولا سطر**.
> 2. مفاتيح Paymob في `Backend/.env` مش في `.env` بتاع الجذر — لأن ده المكان اللي
>    مفاتيح فواتيرك وبوسطة قاعدة فيه فعلاً (بيوصل للكونتينر عن طريق `env_file`).
>    اللي في `docker-compose.yml` هو النص غير السري بس (المود والروابط والعملة).
>
> **التاريخ:** 2026-09-13
> **المصدر التقني:** `developers.paymob.com` (اتسحبت الصفحات بصيغة markdown عن طريق
> `llms.txt` — الصفحات العادية مش بتطلع محتوى تقني للـ fetchers).

---

## ١. القرارات المتفق عليها

| القرار | الاختيار |
|---|---|
| نطاق السويتش | **سويتش واحد عام** يطبّق على المسارات الأربعة كلها |
| شكل الدفع | **Unified Checkout** — تحويل لصفحة Paymob والرجوع (زي فواتيرك بالظبط) |
| وسائل الدفع | كارت + محفظة موبايل + أكشاك + تقسيط (valU/BNPL) |
| مكان المفاتيح | `Backend/.env` زي فواتيرك وبوسطة |
| الأكشاك | **لشحن المحفظة بس** — مش على الأوردر مباشرة |
| الاسترجاع | يفضل بالإيد دلوقتي (مش هنستخدم refund API) |
| الإطلاق | test mode الأول من غير ما العملاء يحسوا |

---

## ٢. اللي محتاج تجيبهولي من داشبورد Paymob

كله من **Accept Dashboard → Settings**. وخد بالك إن فيه **توجل test/live فوق على الشمال**
والقيم بتتغيّر حسبه.

### ٢.١ المفاتيح (Settings → Developers → API Keys)

| المفتاح | الشكل | بنستخدمه في إيه |
|---|---|---|
| **Secret Key — test** | `sk_test_...` | إنشاء الـ intention في وضع التجربة |
| **Secret Key — live** | `sk_live_...` | إنشاء الـ intention في وضع التشغيل |
| **Public Key — test** | `pk_test_...` | رابط صفحة الدفع في وضع التجربة |
| **Public Key — live** | `pk_live_...` | رابط صفحة الدفع في وضع التشغيل |
| **API Key** | نص طويل جداً | واحد للاتنين. بنستخدمه عشان نسأل Paymob "الفلوس وصلت فعلاً؟" |
| **HMAC Secret** | نص | نتأكد بيه إن الـ webhook جاي من Paymob مش من حد بيتريّق علينا |

> الـ **HMAC Secret** مش على نفس صفحة الـ API Keys — موجود في صفحة بيانات الحساب
> (Profile / Account Info). لو ملقتهوش قولي وأنا أدوّر معاك بالـ DevTools.

### ٢.٢ الـ Integration IDs (Settings → Payment Integrations)

كل وسيلة دفع ليها **رقم لوحدها**، ولكل واحدة **رقمين**: واحد test وواحد live.
يعني محتاج **٨ أرقام**:

| الوسيلة | test | live |
|---|---|---|
| كارت (Visa/Mastercard) | ☐ | ☐ |
| محفظة موبايل | ☐ | ☐ |
| كشك (أمان/مصاري) | ☐ | ☐ |
| valU / BNPL | ☐ | ☐ |

> لو أي وسيلة منهم **مش ظاهرة** في الجدول، يبقى الحساب لسه متفعّلش عليها — لازم تكلم
> Paymob (`support@paymob.com` أو الـ account manager) يفعّلوها.

### ٢.٣ حاجتين تتأكد منهم

1. **حساب Paymob مفعّل live؟** ولا لسه under review؟
2. **جدول العمولات** — كام % وكام جنيه ثابت على كل وسيلة؟ محتاجه عشان أقارن
   بفواتيرك (اللي عندنا دلوقتي **٢٪ + ٢ جنيه + ١٤٪ ضريبة** على الكارت).

---

## ٣. اللي محتاج **تظبطه** في داشبورد Paymob

دي أهم نقطة في الخطة كلها، وهي السبب في إن التصميم هيختلف عن فواتيرك.

### المشكلة

Paymob بيسمح تبعت رابط الـ webhook **جوه الطلب نفسه** (`notification_url`) —
**بس مع الكارت بس**. المحفظة والكشك والتقسيط **مش بيدعموها**؛ دول بياخدوا الرابط
المحفوظ على الـ Integration ID في الداشبورد، ودي **قيمة واحدة ثابتة لكل الحركات**.

يعني مينفعش يكون لكل مسار webhook خاص بيه زي ما عندنا دلوقتي:

```
❌ /api/orders/fawaterak/webhook_json
❌ /api/users/wallet/fawaterak/webhook_json
❌ /api/vendors/subscription/fawaterak/webhook_json
❌ /api/vendors/supplies/fawaterak/webhook_json
```

### الحل

**باب واحد لكل حاجات Paymob**، وجوه الباب بنوزّع حسب المرجع اللي بعتناه مع الطلب:

```
✅ POST /api/payments/paymob/webhook     ← لكل المسارات الأربعة
✅ GET  /api/payments/paymob/return      ← باب رجوع واحد، بيحوّل لصفحة كل مسار
```

### الخطوات في الداشبورد

على **كل واحد** من الـ ٨ أرقام (Settings → Payment Integrations → اضغط على الرقم):

| الحقل | test | live |
|---|---|---|
| **Webhook URL** | `https://<domain>/api/payments/paymob/webhook` | نفسه |
| **Redirect URL** | `https://<domain>/api/payments/paymob/return` | نفسه |

> الاتنين نفس الرابط، لأن كل عملية بتحمل معاها `provider_mode` في الداتابيز عندنا،
> فالسيرفر عارف لوحده إن دي حركة تجريبية ولا حقيقية.
>
> اضغط **Save Changes** بعد كل واحد.

---

## ٤. الفرق بين البوابتين — تقنيًا

| | فواتيرك (الحالي) | Paymob (الجديد) |
|---|---|---|
| الأساس | فاتورة (`createInvoiceLink`) | **Intention** (نية دفع) |
| الرابط | `POST /api/v2/createInvoiceLink` | `POST https://accept.paymob.com/v1/intention/` |
| التوثيق | `Authorization: Bearer <api_key>` | `Authorization: Token sk_live_...` |
| المبلغ | جنيه عشري: `"150.50"` | **قروش صحيحة**: `15050` |
| صفحة الدفع | `data.url` في الرد | نبنيها إحنا: `https://eg.checkout.paymob.com/?publicKey=pk_...&clientSecret=...` |
| الرد | `invoiceId`, `invoiceKey`, `url` | `intention_order_id`, `id` (`pi_...`), `client_secret` |
| ربطها بالأوردر عندنا | `payLoad: { orderPaymentId }` | `special_reference` (بيرجع في الـ callback باسم `merchant_order_id`) |
| توقيع الـ webhook | `HMAC-SHA256` على ٣ حقول | **`HMAC-SHA512` على ٢٠ حقل بترتيب ثابت** |
| التأكد من الدفع | `GET /api/v2/getInvoiceData/{id}` | `POST /api/ecommerce/orders/transaction_inquiry` (محتاجة auth token الأول) |
| العمولة | `commission` في الفاتورة | `accept_fees` / `merchant_commission` (⚠️ محتاج تأكيد على حركة حقيقية) |
| وضع تجربة | **مفيش** (الـ URLs الاتنين production) | **فيه فعلاً** — كروت تجريبية |

### كروت التجربة عند Paymob

```
Mastercard  5123456789012346   |  01/39  |  CVV 123  |  Test Account
Mastercard  5123450000000008   |  01/39  |  CVV 123  |  Test Account
Visa        4111111111111111   |  01/39  |  CVV 123  |  Test Account
محفظة       01010101010        |  MPin 123456  |  OTP 123456
```

---

## ٥. التصميم

### ٥.١ طبقة موحّدة فوق البوابتين

دلوقتي ٤ سيرفسات بتنادي `fawaterakService` على طول. الخطة إن يبقى في نص:

```
orderPaymentService ─┐
walletTopupService  ─┤
subscriptionPayment ─┼──▶  paymentGateway.js  ──┬──▶ fawaterakService.js  (زي ما هو)
supplyService       ─┘     (بيقرأ السويتش)      └──▶ paymobService.js     (جديد)
```

`paymentGateway.js` بيعرض ٣ دوال بس، والـ ٤ سيرفسات مش لازم تعرف مين اللي شغال:

| الدالة | بتعمل إيه |
|---|---|
| `createHostedPayment({ amount, currency, customer, reference, returnUrl, webhookUrl })` | ترجّع `{ provider, payment_url, provider_reference, raw }` |
| `readPayment({ provider, ... })` | ترجّع `{ paid, paid_at, method, fee, raw }` |
| `verifyWebhook({ provider, req })` | ترجّع `{ ok, normalized }` |

**قاعدة حاكمة:** الدالتين التانيتين بياخدوا الـ `provider` **من سجل الدفعة نفسها**،
مش من السويتش الحالي. عشان لو بدّلت السويتش وفيه عميل في نص عملية على فواتيرك،
عمليته تكمّل على فواتيرك عادي. ده السجل عنده أصلاً في الحقل `provider`.

### ٥.٢ السويتش في الداشبورد

في `site_settings`:

```js
payments: {
    provider: { type: String, enum: ['fawaterak', 'paymob'], default: 'fawaterak' },
    // حسابات معيّنة بتروح Paymob دايماً مهما كان السويتش فوق —
    // ده اللي بيخلينا نجرّب على السيرفر الحقيقي من غير ما عميل واحد يحس.
    // بيتشال بعد ما نخلّص التجربة.
    paymob_pilot_user_ids: { type: [ObjectId], default: [] },
}
```

مكانه في الواجهة: صفحة `/admin/dashboard/wallets` — فيها أصلاً توجلات الدفع
(`online_payment_enabled`, `cod_enabled`)، فالسويتش يقعد معاهم في سكشن اسمه
"بوابة الدفع" بدل ما نعمل صفحة جديدة.

### ٥.٣ المرجع اللي بيربط الدفعة بالمسار

بما إن الـ webhook بقى باب واحد، لازم `special_reference` يقول للسيرفر هو جاي لمين:

```
order:68b3f1...:1     ← دفعة أوردر عميل
wallet:68b3f2...:1    ← شحن محفظة
sub:68b3f3...:1       ← اشتراك تاجر
supply:68b3f4...:2    ← أوردر توريد (المحاولة التانية)
```

الرقم الأخير = رقم المحاولة. **إجباري**، لأن Paymob بيرفض نفس الـ
`special_reference` مرتين — و`supplyService` عنده دالة `reopenPayment` بتفتح
الدفعة تاني على نفس السجل.

---

## ٦. الملفات اللي هتتغيّر

### جديدة
| الملف | الدور |
|---|---|
| `Backend/services/paymobService.js` | الطبقة اللي بتكلم Paymob (intention / inquiry / HMAC) |
| `Backend/services/paymentGateway.js` | الراوتر بين البوابتين + قراءة السويتش |
| `Backend/routes/paymobWebhook.js` | الباب الموحّد `/api/payments/paymob/webhook` |
| `Backend/services/paymentFlows.js` | سجل المسارات الأربعة: حمّل / سوّي / رجّع فين |
| `Backend/docs/PAYMOB_INTEGRATION.md` | التوثيق (زي `BOSTA_INTEGRATION.md`) |

### هتتعدّل
| الملف | التعديل |
|---|---|
| `Backend/services/orderPaymentService.js` | تنادي `paymentGateway` بدل `fawaterak` |
| `Backend/services/walletTopupService.js` | نفس الحاجة |
| `Backend/services/subscriptionPaymentService.js` | نفس الحاجة |
| `Backend/services/supplyService.js` | نفس الحاجة |
| `Backend/services/shared/gatewayFee.js` | تقرأ عمولة Paymob كمان |
| `Backend/models/site_settings.js` | بلوك `payments` |
| `Backend/services/walletService.js` | قراءة/تعديل إعدادات البوابة |
| `frontend/src/app/admin/dashboard/wallets/page.jsx` | سكشن السويتش |
| `.env` + `docker-compose.yml` | متغيرات Paymob |

### مش هتتغيّر (مهم)
`orders.js`, `placeOrder`, `loyaltyService`, منطق حجز النقاط، `financeService` —
كلهم بيشتغلوا على سجل الدفعة مش على البوابة.

---

## ٧. التفاصيل التقنية

### ٧.١ إنشاء الدفعة

```
POST https://accept.paymob.com/v1/intention/
Authorization: Token sk_live_xxxxx
Content-Type: application/json

{
  "amount": 15050,                      // قروش — Math.round(total * 100)
  "currency": "EGP",
  "payment_methods": [1234, 5678],      // الـ Integration IDs حسب المسار
  "items": [
    { "name": "ReadyCar order", "amount": 15050, "quantity": 1 }
  ],
  "billing_data": {
    "first_name": "أحمد",               // إجباري
    "last_name": "محمد",                // إجباري
    "email": "a@b.com",                 // إجباري
    "phone_number": "+2010xxxxxxxx",    // إجباري فعليًا (Paymob بيرفض من غيره)
    "city": "القاهرة",
    "country": "EG",
    "street": "..."
  },
  "special_reference": "order:68b3f1a...:1",
  "expiration": 21600,                  // ثانية — مساوية لـ PAYMENT_HOLD_TTL_HOURS
  "notification_url": "https://<domain>/api/payments/paymob/webhook",
  "redirection_url": "https://<domain>/api/payments/paymob/return",
  "extras": { "flow": "order", "record_id": "68b3f1a..." }
}
```

**الرد (201):**
```json
{
  "id": "pi_live_bd49bb7f...",
  "client_secret": "egy_csk_live_94042f...",
  "intention_order_id": 265715202,
  "status": "intended"
}
```

**رابط الدفع:**
```
https://eg.checkout.paymob.com/?publicKey=pk_live_xxx&clientSecret=egy_csk_live_xxx
```

**الـ Integration IDs حسب المسار:**

| المسار | الوسائل المسموحة |
|---|---|
| أوردر عميل | كارت + محفظة + valU |
| شحن محفظة | كارت + محفظة + **كشك** |
| اشتراك تاجر | كارت + محفظة |
| أوردر توريد | كارت + محفظة |

> الكشك في شحن المحفظة بس — زي ما اتفقنا. العميل ياخد كود، يدفع كاش في أي وقت،
> الفلوس تدخل محفظته، ويدفع الأوردر من المحفظة فورًا. كده مفيش باسكت معلّقة ولا
> سعر بيتغيّر تحت رجل العميل.
>
> ⚠️ الكشك **مالوش استرجاع فلوس** عند Paymob — فلوس دخلت المحفظة تفضل رصيد.

### ٧.٢ التحقق من الـ webhook (HMAC)

Paymob بيحسب `HMAC-SHA512` على **قيم** الحقول دي **ملزوقة ورا بعض من غير أي فاصل**،
**بالترتيب ده بالظبط** (مش ترتيب أبجدي — ترتيب ثابت):

```
amount_cents, created_at, currency, error_occured, has_parent_transaction,
obj.id, integration_id, is_3d_secure, is_auth, is_capture, is_refunded,
is_standalone_payment, is_voided, order.id, owner, pending,
source_data.pan, source_data.sub_type, source_data.type, success
```

**فرق مهم بين نوعين الـ callback:**

| | الـ webhook (POST، JSON) | الرجوع للموقع (GET، query params) |
|---|---|---|
| الحقل السادس | `obj.id` | `id` |
| الحقل الرابع عشر | `order.id` | `order_id` |

مثال على السلسلة الناتجة:
```
1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue
```

وبعدين `crypto.createHmac('sha512', HMAC_SECRET)` ومقارنة بـ `timingSafeEqual`
زي ما `fawaterakService.verifyPaidWebhookHash` بيعمل بالظبط.

### ٧.٣ التأكد من الدفع (بديل `getInvoiceData`)

على خطوتين — Paymob مش بيدي token في نفس الطلب:

```
1)  POST https://accept.paymob.com/api/auth/tokens
    { "api_key": "<API Key>" }
    → { "token": "..." }        (بنكاشه، عمره ساعة)

2)  POST https://accept.paymob.com/api/ecommerce/orders/transaction_inquiry
    { "auth_token": "<token>", "merchant_order_id": "order:68b3f1a...:1" }
    → آخر حركة على الأوردر ده
```

**الحقول المهمة في الرد:**
| الحقل | يعني |
|---|---|
| `success` | نجحت ولا لأ |
| `pending` | لسه معلّقة (كشك مش مدفوع) |
| `amount_cents` | المدفوع بالقروش |
| `order.merchant_order_id` | مرجعنا |
| `id` | رقم الحركة (هنحتاجه لو عملنا استرجاع API بعدين) |
| `accept_fees` / `merchant_commission` | عمولة Paymob |
| `source_data.type` / `sub_type` | كارت / محفظة / إلخ |

### ٧.٤ العمولة والتقارير المالية

`gatewayFee.js` دلوقتي بيدوّر على `commission` و `onecommision.amount` بتوع فواتيرك.
هيتوسّع يقرأ كمان من حمولة Paymob:

```js
// Paymob — بالقروش، فلازم قسمة على 100
raw.accept_fees_cents_int / 100
raw.accept_fees
raw.merchant_commission
```

> ⚠️ **محتاج تأكيد على حركة حقيقية.** في العينة الرسمية كلهم `0` لأنها حركة تجريبية.
> أول حركة live هنقرأ الرد كله ونتأكد أنهي حقل بيحمل العمولة فعلاً — بالظبط زي ما
> اتعمل مع فواتيرك (الكومنت في `gatewayFee.js` بيقول "Verified on live payments:
> 100 EGP → 4.56").
>
> `gatewayFeeFromPayloads` بترجّع `null` مش `0` لما متلاقيش رقم — فالتقارير هتقول
> "N دفعات متعرفش تكلفتها" بدل ما تعتبرها مجانية. السلوك ده يفضل زي ما هو.

### ٧.٥ باب الرجوع الموحّد

الفرونت إند دلوقتي بيرجّع العميل لـ `/checkout?payment=success&paymentId=...`
أو `/family/requests/<id>?...`. مع Paymob الرابط واحد، فراوت
`GET /api/payments/paymob/return` في الباك إند:

1. يتحقق من الـ HMAC (ويسجّل لو فشل)
2. يقرا `merchant_order_id`، وإن مكانش موجود يرجع لرقم أوردر Paymob
3. يفكّه (`order:68b3f1a...:1` → مسار + رقم سجل)
4. يعمل 302 للصفحة الصح بنفس الـ params القديمة — فالشاشات الحالية متتغيّرش خالص

الراوت ده **مبيسوّيش أي حاجة** — التسوية بتحصل من الـ webhook، والصفحة اللي
العميل بيوصلها بتأكد الدفع من الـ endpoint بتاعها اللي بيسأل Paymob بنفسه.

---

## ٨. الحالات الحرجة

| الحالة | التصرّف |
|---|---|
| بدّلنا السويتش وفيه عميل في نص دفعة | العملية تكمّل على بوابتها الأصلية (`payment.provider`) |
| الـ webhook والرجوع وصلوا الاتنين | زي دلوقتي — أول واحد يخلّص، التاني يلاقي `order_id` موجود ويرجع |
| HMAC غلط | `401` وبس. **متعملش أوردر**. نسجّل المحاولة |
| `merchant_order_id` مش معروف | `200` عشان Paymob ميفضلش يعيد، + log |
| الحركة `pending` (كشك) | **متكرّدش المحفظة**. نستنى الـ webhook النهائي |
| المبلغ اتغيّر قبل التأكيد | زي دلوقتي — `amount_mismatch` + رجوع النقاط المحجوزة |
| Paymob رفض `special_reference` مكرر | نزوّد رقم المحاولة ونعيد |
| عميل تجريبي (pilot) والسويتش على فواتيرك | يروح Paymob **test** — الفلوس مش حقيقية |
| المفاتيح ناقصة في `.env` | نفشل بوضوح في البدء، **مش** نرجع لفواتيرك بالسكات |

---

## ٩. متغيرات `.env`

```bash
# البوابة الافتراضية لو مفيش إعداد في الداتابيز
PAYMENT_PROVIDER=fawaterak

PAYMOB_MODE=test                     # test | live
PAYMOB_BASE_URL=https://accept.paymob.com
PAYMOB_CHECKOUT_URL=https://eg.checkout.paymob.com

PAYMOB_SECRET_KEY_TEST=sk_test_xxx
PAYMOB_SECRET_KEY_LIVE=sk_live_xxx
PAYMOB_PUBLIC_KEY_TEST=pk_test_xxx
PAYMOB_PUBLIC_KEY_LIVE=pk_live_xxx
PAYMOB_API_KEY=xxx                   # واحد للاتنين
PAYMOB_HMAC_SECRET=xxx

PAYMOB_INTEGRATION_CARD_TEST=
PAYMOB_INTEGRATION_CARD_LIVE=
PAYMOB_INTEGRATION_WALLET_TEST=
PAYMOB_INTEGRATION_WALLET_LIVE=
PAYMOB_INTEGRATION_KIOSK_TEST=
PAYMOB_INTEGRATION_KIOSK_LIVE=
PAYMOB_INTEGRATION_BNPL_TEST=
PAYMOB_INTEGRATION_BNPL_LIVE=
```

> الملف في **جذر المشروع** مش `Backend/.env` — زي بيانات Mongo.
> وأي تعديل محتاج `docker compose up -d --build backend frontend`.

---

## ١٠. مراحل التنفيذ

| # | المرحلة | المخرج |
|---|---|---|
| ١ | `paymobService.js` + اختبارات HMAC على العينة الرسمية | التوقيع بيتحقق صح |
| ٢ | `paymentGateway.js` + `payments` في `site_settings` | السويتش موجود، ولسه على فواتيرك |
| ٣ | الباب الموحّد + صفحة الرجوع | Paymob يقدر يكلمنا |
| ٤ | تحويل `orderPaymentService` للطبقة الموحّدة | أوردر يتدفع بكارت تجريبي |
| ٥ | تحويل الـ ٣ مسارات الباقية | محفظة + اشتراك + توريد |
| ٦ | سكشن السويتش في الأدمن + قائمة الـ pilot | التبديل من الواجهة |
| ٧ | العمولة في `gatewayFee.js` | التقارير المالية مظبوطة |
| ٨ | الكشك في شحن المحفظة (حالة `pending`) | كود كشك يشحن المحفظة |
| ٩ | حركة live واحدة صغيرة + تأكيد حقل العمولة | جاهزين للتبديل |

---

## ١١. حاجات لسه مش متأكد منها

1. **حقل العمولة** — `accept_fees` ولا `merchant_commission` ولا `accept_fees_cents_int`؟
   العينة الرسمية كلها أصفار. **يتحسم بأول حركة live.**
2. **valU/BNPL** — بيدعم `redirection_url` جوه الطلب ولا لازم من الداشبورد بس؟
   الدوكيومنتيشن بيقول "كارت ومحفظة بس". **يتحسم بالتجربة.**
3. **الكشك** — الـ callback بييجي مرتين (واحد عند إصدار الكود وواحد عند الدفع)
   ولا مرة واحدة؟ ولو مرتين، الأول `pending: true`؟ **يتحسم بالتجربة.**
4. **مدة صلاحية كود الكشك** — `expiration` بتاعنا ٦ ساعات؛ ده قصير على كشك.
   محتاجين قيمة منفصلة للكشك (يومين مثلاً).
5. **جدول عمولات Paymob** — مش منشور، لازم ييجي من الـ account manager.

---

## ملحق: مراجع الدوكيومنتيشن

الصفحات دي مبتفتحش عادي للـ fetchers — لازم تضيف `.md` في آخر الرابط:

| الموضوع | الرابط |
|---|---|
| فهرس كل الصفحات | `developers.paymob.com/paymob-docs/llms.txt` |
| إنشاء Intention | `.../paymob-docs/intention-apis/create-intention.md` |
| Unified Checkout | `.../paymob-docs/checkout-experiences/unified-checkout-redirection.md` |
| حساب الـ HMAC | `.../paymob-docs/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback.md` |
| أنواع الـ callbacks | `.../paymob-docs/webhook-callbacks-and-hmac/transaction-callbacks.md` |
| الاستعلام عن حركة | `.../paymob-docs/transaction-inquiry-apis/transaction-inquiry/by-order-id-or-reference.md` |
| جلب الـ credentials | `.../paymob-docs/need-help/setup-guides/getting-integration-credentials.md` |
| كروت التجربة | `.../paymob-docs/need-help/setup-guides/test-credentials.md` |
| الاسترجاع (لبعدين) | `.../paymob-docs/manage-payment-apis/refund.md` |
