const https = require('https');
const crypto = require('crypto');
const { User } = require('../models/users');
const { Product } = require('../models/products');
const { CarEmailCampaign } = require('../models/carEmailCampaigns');
const { SiteSettings } = require('../models/site_settings');
const { carClauses } = require('./carFitService');

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
const getBackendUrl = () => (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    'http://localhost:4000'
).replace(/\/+$/, '');

const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const postJson = ({ hostname, path, headers, body }) => {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request(
            {
                hostname,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    ...headers,
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    let parsed = {};
                    if (data) {
                        try { parsed = JSON.parse(data); }
                        catch (e) { parsed = { message: data }; }
                    }
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                        return;
                    }
                    reject(new Error(parsed?.message || parsed?.error || `Request failed with code ${res.statusCode}`));
                });
            }
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
};

const resolveAbsoluteUrl = (url) => {
    if (!url) return '';
    if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
    const base = getBackendUrl();
    return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
};

/**
 * The two logos the admin uploads on the landing page: "light mode" (black CAR) for the email's
 * white card, "dark mode" (white CAR, `logo_url`) for a mail app that darkens it.
 */
const getEmailLogos = (settings) => ({
    logoUrl: resolveAbsoluteUrl(settings?.logo_light_url),
    logoDarkUrl: resolveAbsoluteUrl(settings?.logo_url),
});

/**
 * The email's logo, readable in light and in dark mode — shared by every Ready Car marketing
 * email (this campaign, the abandoned-cart reminder in emailService).
 *
 * The light-mode logo (black CAR) on a white plate. Gmail's apps darken the email but not its
 * images, and give no sign of it, so the plate is a gradient, which they leave white: the black
 * CAR stays on white there. Outlook marks the email it darkens (data-ogsc / data-ogsb): there
 * the dark-mode logo (white CAR) takes its place and the plate goes — see EMAIL_DARK_MODE_STYLE.
 */
const buildEmailLogoHtml = ({ logoUrl, logoDarkUrl }) => {
    const logoImg = (src, cls) => `<img class="${cls}" src="${escapeHtml(src)}" alt="Ready Marine" width="200" style="display:block;width:200px;max-width:100%;height:auto;border:0;margin:0 auto;" />`;
    return logoUrl
        ? `<div style="margin:0 0 10px;">
                    <div class="rc-logo-plate" style="display:inline-block;padding:8px 12px;border-radius:12px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);">
                        ${logoImg(logoUrl, 'rc-logo-light')}
                        ${logoDarkUrl ? `<!--[if !mso]><!--><div class="rc-logo-dark" style="display:none;max-height:0;overflow:hidden;">${logoImg(logoDarkUrl, '')}</div><!--<![endif]-->` : ''}
                    </div>
                </div>`
        // No logo uploaded: the brand in text, READY red and CAR dark — a mail app that darkens
        // the email turns the text white itself.
        : `<div style="font-size:26px;font-weight:900;color:#111827;letter-spacing:0.02em;text-align:center;margin-bottom:10px;"><span style="color:#DC2626;">Ready</span>Car</div>`;
};

/** Outlook's dark mode: swap to the white-CAR logo. Its own block: Gmail drops a whole block it cannot read. */
const EMAIL_DARK_MODE_STYLE = `<!-- Its own block: Gmail drops a whole block it cannot read, and the phone sizes above stay. -->
    <style>
        [data-ogsc] .rc-logo-light, [data-ogsb] .rc-logo-light { display: none !important; }
        [data-ogsc] .rc-logo-dark, [data-ogsb] .rc-logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }
        [data-ogsb] .rc-logo-plate, .rc-logo-plate[data-ogsb] { background-image: none !important; }
    </style>`;

/** Generate a secure unsubscribe token based on user email and ID */
const generateUnsubscribeToken = (userId, email) => {
    const secret = process.env.JWT_SECRET || 'readymarine-secret-salt';
    return crypto.createHmac('sha256', secret).update(`${userId}:${email}`).digest('hex');
};

const verifyUnsubscribeToken = (userId, email, token) => {
    const expected = generateUnsubscribeToken(userId, email);
    return expected === token;
};

/**
 * Find users whose garage matches the car filter and have a valid email.
 */
const getTargetAudience = async ({ brand_id, brand_name, model_id, model_name, year } = {}) => {
    const query = {
        email: { $exists: true, $ne: null, $ne: '' },
        account_status: 'active',
        marketing_emails_unsubscribed: { $ne: true },
        'cars.0': { $exists: true },
    };

    const users = await User.find(query)
        .select('name email preferred_language cars created_at')
        .lean();

    const matchedUsers = [];
    const seenEmails = new Set();

    for (const u of users) {
        if (!u.email || seenEmails.has(u.email.toLowerCase())) continue;

        // Check if any car in the user's garage matches the filter
        const matchingCar = (u.cars || []).find((car) => {
            if (brand_id && String(car.car_brand_id) !== String(brand_id)) {
                if (brand_name && car.car_brand_name !== brand_name) return false;
                if (!brand_name) return false;
            } else if (brand_name && car.car_brand_name !== brand_name) {
                return false;
            }

            if (model_id && String(car.car_model_id) !== String(model_id)) {
                if (model_name && car.car_model_name !== model_name) return false;
                if (!model_name) return false;
            } else if (model_name && car.car_model_name !== model_name) {
                return false;
            }

            if (year && Number(car.year) !== Number(year)) {
                return false;
            }

            return true;
        });

        if (matchingCar) {
            seenEmails.add(u.email.toLowerCase());
            matchedUsers.push({
                user_id: u._id,
                name: u.name || 'عميل Ready Marine',
                email: u.email,
                preferred_language: u.preferred_language || 'ar',
                car: {
                    brand_id: matchingCar.car_brand_id,
                    brand_name: matchingCar.car_brand_name,
                    model_id: matchingCar.car_model_id,
                    model_name: matchingCar.car_model_name,
                    year: matchingCar.year,
                },
            });
        }
    }

    return {
        count: matchedUsers.length,
        users: matchedUsers,
    };
};

/**
 * Fetch recommended products compatible with this car filter (or universal ones)
 */
const getRecommendedProducts = async ({ brand_id, model_id, year, limit = 6 } = {}) => {
    const clauses = carClauses({ car_brand_id: brand_id, car_model_id: model_id, car_year: year });
    const filter = { status: 'published', stock_status: { $ne: 'outofstock' } };
    if (clauses.length > 0) filter.$or = [...clauses, { is_universal: true }];
    return Product.find(filter).sort({ sold_count: -1, created_at: -1 }).limit(limit).lean();
};

/**
 * The products the admin picked for the email, in the order picked — those and nothing else.
 * Nothing is added to fill the grid: a product removed from the campaign must not come back
 * in the email. One no longer published is left out.
 */
const MAX_EMAIL_PRODUCTS = 8;
const getPickedProducts = async (productIds = []) => {
    const ids = (Array.isArray(productIds) ? productIds : []).map(String).slice(0, MAX_EMAIL_PRODUCTS);
    if (!ids.length) return [];
    const docs = await Product.find({ _id: { $in: ids }, status: 'published' }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
};

/**
 * Format Product for Email display
 */
const formatProductForEmail = (product, lang = 'ar') => {
    const isAr = lang === 'ar';
    const title = (isAr ? product.title_ar : product.title_en) || product.title_ar || product.title_en || 'منتج Ready Marine';
    const slug = (isAr ? product.slug_ar : product.slug_en) || product.slug_ar || product.slug_en || String(product._id);
    const primaryImg = (product.images || []).find((img) => img.is_primary) || (product.images || [])[0];
    const imageUrl = primaryImg ? resolveAbsoluteUrl(primaryImg.url) : 'https://placehold.co/400x400/f4f4f5/991b1b?text=Ready Marine';
    const effectivePrice = product.discount_price ?? product.price ?? 0;
    const hasDiscount = Boolean(product.discount_price && product.discount_price < product.price);
    const link = `${getFrontendUrl()}/${isAr ? 'ar' : 'en'}/product/${encodeURIComponent(slug)}`;

    return {
        title,
        imageUrl,
        price: effectivePrice,
        originalPrice: product.price,
        hasDiscount,
        link,
    };
};

/**
 * The English of the campaign page's four starting tags. Campaigns saved before the page gave
 * them an English name hold the Arabic alone, and an English email showed it.
 */
const DEFAULT_TAG_EN = {
    'فلاتر وزيوت': 'Filters & Oils',
    'تيل وطنابير الفرامل': 'Brakes',
    'مستلزمات وعناية': 'Car Care',
    'بطاريات وإضاءة': 'Batteries & Lights',
};
const tagLabel = (tag, isAr) => (isAr
    ? (tag.label || tag.label_en)
    : (tag.label_en || DEFAULT_TAG_EN[String(tag.label || '').trim()] || tag.label));

/** 'en' or 'ar': the language a preview or a test is asked in. */
const emailLang = (lang) => (lang === 'en' ? 'en' : 'ar');

/**
 * Build responsive HTML email inspired by Alibaba's personalized recommendation emails
 */
const buildPersonalizedEmailHtml = ({
    recipientName = 'عميلنا العزيز',
    car = {},
    subject = '',
    messageBody = '',
    categoryTags = [],
    products = [],
    customCtaText = '',
    customCtaLink = '',
    unsubscribeUrl = '',
    logoUrl = '',
    logoDarkUrl = '',
    lang = 'ar',
}) => {
    const isAr = lang === 'ar';
    const dir = isAr ? 'rtl' : 'ltr';
    const align = isAr ? 'right' : 'left';

    const carName = [car.brand_name, car.model_name, car.year].filter(Boolean).join(' ') || (isAr ? 'سيارتك' : 'your car');

    // Default categories if none provided
    const tags = (categoryTags && categoryTags.length > 0)
        ? categoryTags
        : [
            { label: isAr ? 'فلاتر وزيوت' : 'Filters & Oils', link: `${getFrontendUrl()}/${isAr ? 'ar' : 'en'}/products?category=oils` },
            { label: isAr ? 'تيل وطنابير الفرامل' : 'Brakes', link: `${getFrontendUrl()}/${isAr ? 'ar' : 'en'}/products?category=brakes` },
            { label: isAr ? 'مستلزمات وعناية' : 'Car Care', link: `${getFrontendUrl()}/${isAr ? 'ar' : 'en'}/products?category=care` },
            { label: isAr ? 'بطاريات وإضاءة' : 'Batteries & Lights', link: `${getFrontendUrl()}/${isAr ? 'ar' : 'en'}/products?category=batteries` },
        ];

    // Build tags HTML (pills style like Alibaba)
    // A tag picked from the categories opens that category, in the reader's language.
    const tagLink = (tag) => (tag.category_id
        ? `${getFrontendUrl()}/${isAr ? 'ar' : 'en'}/products?category_id=${encodeURIComponent(String(tag.category_id))}`
        : (tag.link || `${getFrontendUrl()}/${isAr ? 'ar' : 'en'}/products`));
    const tagsHtml = tags.map((tag) => `
        <a href="${escapeHtml(tagLink(tag))}" target="_blank" style="display:inline-block;padding:6px 12px;margin:3px 2px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:20px;color:#18181b;font-size:13px;font-weight:700;text-decoration:none;">
            ${escapeHtml(tagLabel(tag, isAr))}
        </a>
    `).join('');

    // Formatted products
    const formattedProducts = products.map((p) => formatProductForEmail(p, lang));

    // Build 2-column products grid for email clients
    let productRowsHtml = '';
    for (let i = 0; i < formattedProducts.length; i += 2) {
        const p1 = formattedProducts[i];
        const p2 = formattedProducts[i + 1];

        // Two cards a row on every screen, as the big shops' emails do. On a phone the card
        // tightens (the `rc-*` classes in <head>): smaller padding and type, and the button
        // stays on one line. The picture sits in a box of fixed height, scaled to fit inside
        // it — Gmail ignores object-fit, so a fixed height on the <img> itself stretched it.
        // The button is the brand red: Gmail's dark mode turned the black one light grey.
        const renderCard = (p) => {
            if (!p) return '<td class="rc-cell" width="50%" style="padding:6px;"></td>';
            return `
                <td class="rc-cell" width="50%" valign="top" style="padding:6px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #ececef;border-radius:14px;">
                        <tr>
                            <td class="rc-img" height="160" align="center" valign="middle" style="height:160px;padding:10px;text-align:center;background:#ffffff;border-radius:14px 14px 0 0;">
                                <a href="${escapeHtml(p.link)}" target="_blank" style="text-decoration:none;">
                                    <img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.title)}" width="200" style="display:inline-block;width:auto;height:auto;max-width:100%;max-height:140px;border:0;" />
                                </a>
                            </td>
                        </tr>
                        <tr>
                            <td class="rc-body" style="padding:12px 14px 14px;text-align:${align};">
                                <a href="${escapeHtml(p.link)}" target="_blank" class="rc-title" style="display:block;text-decoration:none;color:#09090b;font-size:14px;font-weight:700;line-height:20px;height:40px;overflow:hidden;margin-bottom:8px;">
                                    ${escapeHtml(p.title)}
                                </a>
                                <div style="margin-bottom:10px;white-space:nowrap;">
                                    <span class="rc-price" style="font-size:17px;font-weight:900;color:#DC2626;">${Number(p.price).toLocaleString('en-US')} ج.م</span>
                                    ${p.hasDiscount ? `<span style="font-size:12px;color:#a1a1aa;text-decoration:line-through;margin:0 6px;">${Number(p.originalPrice).toLocaleString('en-US')}</span>` : ''}
                                </div>
                                <a href="${escapeHtml(p.link)}" target="_blank" class="rc-btn" style="display:block;text-align:center;background:#DC2626;color:#ffffff;font-size:13px;font-weight:800;line-height:18px;padding:9px 6px;border-radius:10px;text-decoration:none;white-space:nowrap;">
                                    ${isAr ? 'عرض القطعة' : 'View'}
                                </a>
                            </td>
                        </tr>
                    </table>
                </td>
            `;
        };

        productRowsHtml += `
            <tr>
                ${renderCard(p1)}
                ${renderCard(p2)}
            </tr>
        `;
    }

    const defaultCtaLink = `${getFrontendUrl()}/${isAr ? 'ar' : 'en'}/products`;
    const finalCtaLink = customCtaLink || defaultCtaLink;
    const finalCtaText = customCtaText || (isAr ? `تصفح جميع القطع المتوافقة مع ${carName}` : `Browse all parts for ${carName}`);

    const logoHtml = buildEmailLogoHtml({ logoUrl, logoDarkUrl });

    return `
<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- Designed light: asks the mail apps that honour it (Apple Mail) not to invert it. -->
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(subject)}</title>
    <style>
        :root { color-scheme: light; supported-color-schemes: light; }
        /* A phone: Gmail, Apple Mail and Outlook's apps read these; the rest keep the inline
           sizes, which are the computer's. */
        @media only screen and (max-width: 520px) {
            .rc-outer { padding: 0 !important; }
            .rc-pad { padding: 16px 8px !important; }
            .rc-cell { padding: 4px !important; }
            .rc-img { height: 120px !important; padding: 8px !important; }
            .rc-img img { max-height: 104px !important; }
            .rc-body { padding: 10px 10px 12px !important; }
            .rc-title { font-size: 13px !important; line-height: 18px !important; height: 36px !important; }
            .rc-price { font-size: 15px !important; }
            .rc-btn { font-size: 12px !important; padding: 8px 4px !important; }
            .rc-cta { display: block !important; padding: 14px 16px !important; font-size: 14px !important; }
            .rc-h1 { font-size: 19px !important; }
        }
    </style>
${EMAIL_DARK_MODE_STYLE}
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;direction:${dir};text-align:${align};">
    <div class="rc-outer" style="max-width:640px;margin:0 auto;padding:12px 4px;">
        <!-- Card Container -->
        <div style="background-color:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.06);border:1px solid #e4e4e7;">
            
            <!-- Red Top Brand Bar -->
            <div style="height:6px;background:linear-gradient(90deg, #DC2626 0%, #ef4444 100%);"></div>

            <!-- Header / Logo -->
            <div style="padding:20px 16px 14px;text-align:center;border-bottom:1px solid #f4f4f5;">
                ${logoHtml}
                <div style="display:inline-block;padding:4px 12px;background:#fef2f2;border:1px solid #fee2e2;border-radius:20px;color:#DC2626;font-size:12px;font-weight:800;letter-spacing:.04em;">
                    ${isAr ? 'عروض وتوصيات مخصصة لسيارتك' : 'Tailored For Your Car'}
                </div>
            </div>

            <!-- Hero Section -->
            <div class="rc-pad" style="padding:20px 14px;background:#ffffff;">
                <h1 class="rc-h1" style="margin:0 0 12px;font-size:22px;line-height:1.35;font-weight:900;color:#09090b;">
                    ${isAr ? `مختارة بعناية لسيارتك: ${carName}` : `Handpicked for your ${carName}`}
                </h1>
                
                <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#3f3f46;">
                    ${isAr ? `أهلاً ${escapeHtml(recipientName)}،` : `Hello ${escapeHtml(recipientName)},`}
                </p>

                ${messageBody ? `
                <div style="margin:0 0 24px;font-size:15px;line-height:1.75;color:#3f3f46;background:#fafafa;border:1px solid #f0f0f2;padding:16px;border-radius:14px;">
                    ${escapeHtml(messageBody).replace(/\n/g, '<br />')}
                </div>
                ` : ''}

                <!-- Quick Tags / Pills (Like Alibaba) -->
                <div style="margin:16px 0 20px;text-align:center;padding:10px 6px;background:#f8fafc;border-radius:16px;border:1px dashed #e2e8f0;">
                    <div style="font-size:12px;font-weight:800;color:#71717a;text-transform:uppercase;margin-bottom:8px;">
                        ${isAr ? 'أقسام سريعة لسيارتك' : 'Quick categories for your car'}
                    </div>
                    <div>
                        ${tagsHtml}
                    </div>
                </div>

                ${formattedProducts.length ? `
                <!-- Products Section Header -->
                <div style="margin-bottom:16px;">
                    <h2 style="margin:0 0 4px;font-size:18px;font-weight:900;color:#09090b;">
                        ${isAr ? 'فقط لأجلك' : 'Just For You'}
                    </h2>
                    <p style="margin:0;font-size:13px;color:#71717a;">
                        ${isAr ? 'أهم القطع والإكسسوارات المتوافقة مع سيارتك بأفضل الأسعار' : 'Top compatible parts & accessories at the best prices'}
                    </p>
                </div>

                <!-- Product Grid Table -->
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;table-layout:fixed;">
                    ${productRowsHtml}
                </table>
                ` : ''}

                <!-- Main CTA Button -->
                <div style="text-align:center;margin:20px 0 8px;">
                    <a href="${escapeHtml(finalCtaLink)}" target="_blank" class="rc-cta" style="display:inline-block;background-color:#DC2626;color:#ffffff;font-size:15px;font-weight:900;padding:15px 36px;border-radius:14px;text-decoration:none;box-shadow:0 8px 20px rgba(220,38,38,0.3);">
                        ${escapeHtml(finalCtaText)}
                    </a>
                </div>
            </div>

            <!-- Footer -->
            <div style="padding:16px 14px;background:#fafafa;border-top:1px solid #f4f4f5;text-align:center;font-size:12px;line-height:1.8;color:#71717a;">
                <p style="margin:0 0 6px;">
                    ${isAr ? `تصلك هذه الرسالة لأنك قمت بتسجيل سيارة (${carName}) في حسابك لدى Ready Marine.` : `You are receiving this email because you registered (${carName}) in your Ready Marine account.`}
                </p>
                <p style="margin:0;">
                    ${unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" target="_blank" style="color:#a1a1aa;text-decoration:underline;">${isAr ? 'إلغاء الاشتراك من الرسائل التسويقية' : 'Unsubscribe from marketing emails'}</a>` : ''}
                </p>
            </div>

        </div>
    </div>
</body>
</html>
    `;
};

/**
 * Send a single test email to the admin
 */
const sendTestEmail = async ({
    to,
    brand_id,
    brand_name,
    model_id,
    model_name,
    year,
    subject,
    message_body,
    category_tags = [],
    product_ids = [],
    custom_cta_text = '',
    custom_cta_link = '',
    lang,
}) => {
    // In the language the admin previews: a customer reads the one their account is set to.
    const language = emailLang(lang);
    const isAr = language === 'ar';
    if (!process.env.RESEND_TOKEN) {
        throw new Error('RESEND_TOKEN is not configured in server environment');
    }

    if (!to) throw new Error('Recipient email is required for test email');

    const products = await getPickedProducts(product_ids);
    if (!products.length) throw new Error('اختار منتج واحد على الأقل للإيميل');

    const { logoUrl, logoDarkUrl } = getEmailLogos(await SiteSettings.findOne().lean());

    // Only what was picked: the make alone reads "Hyundai", never a made-up model or year.
    const car = { brand_name: brand_name || '', model_name: model_name || '', year: year || null };

    const html = buildPersonalizedEmailHtml({
        recipientName: isAr ? 'تجربة المسؤول' : 'Admin Preview',
        car,
        subject: subject || (isAr ? 'عروض خاصة لسيارتك' : 'Special offers for your car'),
        messageBody: message_body || (isAr ? 'نص تجريبي للرسالة المخصصة لمالك السيارة.' : 'A sample of the message to the car\'s owner.'),
        categoryTags: category_tags,
        products,
        customCtaText: custom_cta_text,
        customCtaLink: custom_cta_link,
        unsubscribeUrl: `${getFrontendUrl()}/unsubscribe-preview`,
        logoUrl,
        logoDarkUrl,
        lang: language,
    });

    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'Ready Marine <onboarding@resend.dev>';

    return await postJson({
        hostname: 'api.resend.com',
        path: '/emails',
        headers: { Authorization: `Bearer ${process.env.RESEND_TOKEN}` },
        body: {
            from,
            to: [to],
            subject: isAr ? `[معاينة تجريبية] ${subject || 'عروض سيارتك'}` : `[Test preview] ${subject || 'Offers for your car'}`,
            html,
        },
    });
};

/**
 * Send one email through Resend. Over the rate limit (429) it waits and tries again, twice,
 * rather than counting the customer as failed.
 */
const sendWithRetry = async (body, attempt = 0) => {
    try {
        return await postJson({
            hostname: 'api.resend.com',
            path: '/emails',
            headers: { Authorization: `Bearer ${process.env.RESEND_TOKEN}` },
            body,
        });
    } catch (err) {
        if (attempt < 2 && /rate limit|too many requests|429/i.test(err.message)) {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            return sendWithRetry(body, attempt + 1);
        }
        throw err;
    }
};

/**
 * Execute the campaign: chunked sending with rate limiting to avoid provider throttling.
 */
const executeCampaign = async (campaignId) => {
    const campaign = await CarEmailCampaign.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    campaign.status = 'sending';
    await campaign.save();

    // Run asynchronously in background
    setImmediate(async () => {
        try {
            const { users } = await getTargetAudience(campaign.target_filter);
            const products = await getPickedProducts(campaign.product_ids);

            const { logoUrl, logoDarkUrl } = getEmailLogos(await SiteSettings.findOne().lean());
            const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'Ready Marine <onboarding@resend.dev>';

            let sentCount = 0;
            let failedCount = 0;
            const errorLogs = [];

            // The car the email names is the one the admin picked, as far as they picked it:
            // a campaign for "Hyundai" says Hyundai to every Hyundai owner, not each one's
            // own model and year.
            const tf = campaign.target_filter || {};
            const campaignCar = {
                brand_name: tf.brand_name || '',
                model_name: tf.model_id || tf.model_name ? (tf.model_name || '') : '',
                year: tf.year || null,
            };

            campaign.stats.targeted_count = users.length;
            await campaign.save();

            for (const target of users) {
                try {
                    const token = generateUnsubscribeToken(target.user_id, target.email);
                    const unsubscribeUrl = `${getBackendUrl()}/api/admin/car-campaigns/unsubscribe?uid=${target.user_id}&email=${encodeURIComponent(target.email)}&token=${token}`;

                    const html = buildPersonalizedEmailHtml({
                        recipientName: target.name,
                        car: { brand_name: campaignCar.brand_name || target.car.brand_name, model_name: campaignCar.model_name, year: campaignCar.year },
                        subject: campaign.subject,
                        messageBody: campaign.message_body,
                        categoryTags: campaign.category_tags,
                        products,
                        customCtaText: campaign.custom_cta_text,
                        customCtaLink: campaign.custom_cta_link,
                        unsubscribeUrl,
                        logoUrl,
                        logoDarkUrl,
                        lang: target.preferred_language || 'ar',
                    });

                    await sendWithRetry({
                        from,
                        to: [target.email],
                        subject: campaign.subject.replace(/\{car_model\}/g, [campaignCar.brand_name, campaignCar.model_name].filter(Boolean).join(' ')).replace(/\{customer_name\}/g, target.name),
                        html,
                        // The mail apps' own "Unsubscribe" button, beside the sender. Gmail and
                        // Yahoo require it of bulk senders, and a campaign without it is more
                        // likely to land in spam.
                        headers: {
                            'List-Unsubscribe': `<${unsubscribeUrl}>`,
                            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                        },
                    });

                    sentCount++;
                    // Resend allows 2 requests a second by default; one every 600ms stays under it.
                    await new Promise((r) => setTimeout(r, 600));
                } catch (sendErr) {
                    failedCount++;
                    errorLogs.push({
                        email: target.email,
                        error: sendErr.message,
                        timestamp: new Date(),
                    });
                }
            }

            campaign.status = failedCount > 0 && sentCount === 0 ? 'failed' : 'sent';
            campaign.stats.sent_count = sentCount;
            campaign.stats.failed_count = failedCount;
            campaign.error_log = errorLogs.slice(0, 50); // Store up to 50 errors
            campaign.sent_at = new Date();
            await campaign.save();
        } catch (fatalErr) {
            console.error('[CarCampaign] Fatal error executing campaign:', fatalErr);
            campaign.status = 'failed';
            await campaign.save();
        }
    });

    return { started: true, campaign_id: campaign._id };
};

module.exports = {
    getTargetAudience,
    getRecommendedProducts,
    getPickedProducts,
    MAX_EMAIL_PRODUCTS,
    formatProductForEmail,
    buildPersonalizedEmailHtml,
    getEmailLogos,
    buildEmailLogoHtml,
    EMAIL_DARK_MODE_STYLE,
    sendTestEmail,
    emailLang,
    executeCampaign,
    generateUnsubscribeToken,
    verifyUnsubscribeToken,
};
