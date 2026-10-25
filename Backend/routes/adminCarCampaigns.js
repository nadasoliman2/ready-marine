const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { CarEmailCampaign } = require('../models/carEmailCampaigns');
const { User } = require('../models/users');
const {
    getTargetAudience,
    getRecommendedProducts,
    getPickedProducts,
    sendTestEmail,
    executeCampaign,
    verifyUnsubscribeToken,
    buildPersonalizedEmailHtml,
    getEmailLogos,
    emailLang,
} = require('../services/carEmailCampaignService');
const { SiteSettings } = require('../models/site_settings');

const router = express.Router();

/**
 * @route   GET /api/admin/car-campaigns/unsubscribe
 * @desc    Public unsubscribe link for marketing emails
 */
router.get('/unsubscribe', async (req, res) => {
    try {
        const { uid, email, token } = req.query;
        if (!uid || !email || !token) {
            return res.status(400).send('Invalid unsubscribe link.');
        }

        const valid = verifyUnsubscribeToken(uid, email, token);
        if (!valid) {
            return res.status(403).send('Invalid or expired unsubscribe token.');
        }

        await User.findByIdAndUpdate(uid, { marketing_emails_unsubscribed: true });

        res.send(`
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="utf-8">
                <title>تم إلغاء الاشتراك - ReadyCar</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .card { background: #ffffff; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); max-width: 480px; text-align: center; }
                    .icon { width: 64px; height: 64px; background: #fee2e2; color: #dc2626; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 28px; }
                    h1 { color: #09090b; font-size: 22px; margin-bottom: 12px; }
                    p { color: #71717a; font-size: 15px; line-height: 1.6; }
                    a { display: inline-block; margin-top: 24px; padding: 12px 28px; background: #dc2626; color: #fff; text-decoration: none; border-radius: 12px; font-weight: bold; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✓</div>
                    <h1>تم إلغاء الاشتراك بنجاح</h1>
                    <p>لن تتلقى بعد الآن رسائل البريد الإلكتروني التسويقية المخصصة لسيارتك من ReadyCar على <strong>${email}</strong>.</p>
                    <p style="font-size: 13px; margin-top: 10px;">ستظل تتلقى فقط إشعارات الطلبات الهامة وتأكيد الحسابات.</p>
                    <a href="/">العودة إلى ReadyCar</a>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('An error occurred during unsubscription.');
    }
});

/**
 * @route   POST /api/admin/car-campaigns/unsubscribe
 * @desc    One-click unsubscribe (RFC 8058): the "Unsubscribe" button Gmail and Apple Mail
 *          show beside the sender posts here, from the List-Unsubscribe header of each email.
 */
router.post('/unsubscribe', async (req, res) => {
    const { uid, email, token } = req.query;
    if (!uid || !email || !token || !verifyUnsubscribeToken(uid, email, token)) {
        return res.status(403).json({ success: false });
    }
    try {
        await User.findByIdAndUpdate(uid, { marketing_emails_unsubscribed: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

/**
 * @route   GET /api/admin/car-campaigns/audience
 * @desc    Count and sample audience for selected car filter
 */
router.get('/audience', protect('admin'), async (req, res) => {
    try {
        const { brand_id, brand_name, model_id, model_name, year } = req.query;
        const result = await getTargetAudience({
            brand_id,
            brand_name,
            model_id,
            model_name,
            year,
        });

        res.json({
            success: true,
            count: result.count,
            // Everyone, so the admin sees exactly who the campaign will reach.
            users: result.users,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route   GET /api/admin/car-campaigns/recommendations
 * @desc    Fetch compatible products for car filter
 */
router.get('/recommendations', protect('admin'), async (req, res) => {
    try {
        const { brand_id, model_id, year, limit = 6 } = req.query;
        const products = await getRecommendedProducts({
            brand_id,
            model_id,
            year,
            limit: Number(limit) || 6,
        });

        res.json({
            success: true,
            products,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route   POST /api/admin/car-campaigns/preview-html
 * @desc    Generate email HTML for preview in the admin dashboard
 */
router.post('/preview-html', protect('admin'), async (req, res) => {
    try {
        const {
            recipient_name,
            brand_name,
            model_name,
            year,
            subject,
            message_body,
            category_tags,
            product_ids,
            custom_cta_text,
            custom_cta_link,
            lang,
        } = req.body || {};
        const language = emailLang(lang);

        const products = await getPickedProducts(product_ids);

        const { logoUrl, logoDarkUrl } = getEmailLogos(await SiteSettings.findOne().lean());

        // Only what was picked: the make alone reads "Hyundai", never a made-up model or year.
        const car = { brand_name: brand_name || '', model_name: model_name || '', year: year || null };

        const html = buildPersonalizedEmailHtml({
            recipientName: recipient_name || (language === 'ar' ? 'أحمد محمد' : 'Ahmed Mohamed'),
            car,
            subject: subject || 'عروض خاصة لسيارتك',
            messageBody: message_body,
            categoryTags: category_tags,
            products,
            customCtaText: custom_cta_text,
            customCtaLink: custom_cta_link,
            unsubscribeUrl: '#',
            logoUrl,
            logoDarkUrl,
            lang: language,
        });

        res.json({ success: true, html });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route   POST /api/admin/car-campaigns/test
 * @desc    Send test preview email to admin
 */
router.post('/test', protect('admin'), async (req, res) => {
    try {
        const {
            to,
            brand_id,
            brand_name,
            model_id,
            model_name,
            year,
            subject,
            message_body,
            category_tags,
            product_ids,
            custom_cta_text,
            custom_cta_link,
            lang,
        } = req.body || {};

        if (!to) {
            return res.status(400).json({ success: false, message: 'Recipient email is required' });
        }

        const result = await sendTestEmail({
            to,
            brand_id,
            brand_name,
            model_id,
            model_name,
            year,
            subject,
            message_body,
            category_tags,
            product_ids,
            custom_cta_text,
            custom_cta_link,
            lang,
        });

        res.json({ success: true, message: 'Test email sent successfully', result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route   POST /api/admin/car-campaigns
 * @desc    Create and dispatch marketing email campaign
 */
router.post('/', protect('admin'), async (req, res) => {
    try {
        const {
            title,
            subject,
            target_filter = {},
            message_body = '',
            category_tags = [],
            product_ids = [],
            custom_cta_text = '',
            custom_cta_link = '',
        } = req.body || {};

        if (!title || !subject) {
            return res.status(400).json({
                success: false,
                message: 'Campaign title and subject are required',
            });
        }

        // The email shows only the products picked for it, so a campaign needs at least one.
        const picked = await getPickedProducts(product_ids);
        if (!picked.length) {
            return res.status(400).json({ success: false, message: 'اختار منتج واحد على الأقل للإيميل' });
        }

        const audience = await getTargetAudience(target_filter);
        if (audience.count === 0) {
            return res.status(400).json({
                success: false,
                message: 'No active users found matching this car filter with valid emails.',
            });
        }

        const campaign = new CarEmailCampaign({
            title,
            subject,
            target_filter,
            message_body,
            category_tags,
            product_ids: picked.map((p) => p._id),
            custom_cta_text,
            custom_cta_link,
            created_by: req.user?.username || req.user?.name || 'admin',
            stats: {
                targeted_count: audience.count,
                sent_count: 0,
                failed_count: 0,
                skipped_count: 0,
            },
        });

        await campaign.save();

        // Start asynchronous dispatch
        executeCampaign(campaign._id);

        res.json({
            success: true,
            message: 'Campaign created and queued for delivery',
            campaign_id: campaign._id,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route   GET /api/admin/car-campaigns
 * @desc    Get previous campaigns list
 */
router.get('/', protect('admin'), async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [campaigns, total] = await Promise.all([
            CarEmailCampaign.find()
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate('product_ids', 'title_ar title_en price discount_price images')
                .lean(),
            CarEmailCampaign.countDocuments(),
        ]);

        res.json({
            success: true,
            campaigns,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route   GET /api/admin/car-campaigns/:id
 * @desc    Get single campaign details
 */
router.get('/:id', protect('admin'), async (req, res) => {
    try {
        const campaign = await CarEmailCampaign.findById(req.params.id)
            .populate('product_ids', 'title_ar title_en price discount_price images')
            .lean();

        if (!campaign) {
            return res.status(404).json({ success: false, message: 'Campaign not found' });
        }

        res.json({ success: true, campaign });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
