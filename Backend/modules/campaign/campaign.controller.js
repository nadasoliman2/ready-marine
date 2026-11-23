const { CarEmailCampaign } = require('../../models/carEmailCampaigns');
const { User } = require('../../models/users');
const { SiteSettings } = require('../../models/site_settings');
const campaignService = require('./campaign.service');
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
} = campaignService;

/**
 * Public unsubscribe link for marketing emails
 * GET /unsubscribe
 */
const unsubscribe = async (req, res) => {
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
                <title>تم إلغاء الاشتراك - Ready Marine</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .card { background: #ffffff; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); max-width: 480px; text-align: center; }
                    .icon { width: 64px; height: 64px; background: #EBF5FE; color: #006781; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 28px; }
                    h1 { color: #09090b; font-size: 22px; margin-bottom: 12px; }
                    p { color: #71717a; font-size: 15px; line-height: 1.6; }
                    a { display: inline-block; margin-top: 24px; padding: 12px 28px; background: #00A6CE; color: #fff; text-decoration: none; border-radius: 12px; font-weight: bold; box-shadow: 0 4px 14px rgba(0, 166, 206, 0.35); }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✓</div>
                    <h1>تم إلغاء اشتراكك بنجاح</h1>
                    <p>لن تتلقى رسائل تسويقية بعد الآن على هذا البريد الإلكتروني. لا يزال بإمكانك استلام الإشعارات المهمة المتعلقة بطلباتك وحسابك.</p>
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}">العودة إلى المتجر</a>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Unsubscribe error:', err);
        res.status(500).send('حدث خطأ أثناء معالجة الطلب.');
    }
};

/**
 * Fetch logos currently configured in site settings for marketing emails
 * GET /logos
 */
const getLogos = async (req, res) => {
    try {
        const logos = await getEmailLogos();
        res.json({ success: true, ...logos });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Preview / estimate audience count based on filter
 * GET /estimate
 */
const estimateAudience = async (req, res) => {
    try {
        const { brand_id, model_id, year } = req.query;
        const audience = await getTargetAudience({
            brand_id,
            model_id,
            year: year ? parseInt(year, 10) : undefined,
        });

        res.json({
            success: true,
            total: audience.length,
            totalUsers: audience.length,
            sample: audience.slice(0, 10).map((u) => ({
                user_id: u.user_id,
                email: u.email,
                name: u.name,
                car: u.car,
            })),
        });
    } catch (err) {
        console.error('Estimate error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Fetch auto-recommended products matching a specific brand/model/year
 * GET /recommended-products
 */
const getRecommendations = async (req, res) => {
    try {
        const { brand_id, model_id, year, limit } = req.query;
        const products = await getRecommendedProducts({
            brand_id,
            model_id,
            year: year ? parseInt(year, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : 6,
        });

        res.json({ success: true, count: products.length, products });
    } catch (err) {
        console.error('Recommend products error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Generate preview HTML for the live email preview in admin dashboard
 * POST /preview-html
 */
const previewHtml = async (req, res) => {
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
        } = req.body;

        const pickedProducts = Array.isArray(product_ids) && product_ids.length > 0
            ? await getPickedProducts(product_ids)
            : [];

        const logos = await getEmailLogos();

        const car = {
            brand_name: brand_name || '',
            model_name: model_name || '',
            year: year || null,
        };

        const html = buildPersonalizedEmailHtml({
            recipientName: recipient_name || (lang === 'en' ? 'Valued Customer' : 'عميلنا العزيز'),
            car,
            subject: subject || (lang === 'en' ? 'Special marine offers for your boat ⛵' : 'عروض وتوصيات لمركبك ⛵'),
            messageBody: message_body || '',
            categoryTags: category_tags || [],
            products: pickedProducts,
            customCtaText: custom_cta_text,
            customCtaLink: custom_cta_link,
            unsubscribeUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/unsubscribe-preview`,
            logoUrl: logos.logoUrl,
            logoDarkUrl: logos.logoDarkUrl,
            lang: lang || 'ar',
        });

        res.json({ success: true, html });
    } catch (err) {
        console.error('Preview HTML error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Send a single test email of the draft to the admin's email
 * POST /test
 */
const sendTest = async (req, res) => {
    try {
        const {
            to,
            subject,
            title,
            message_body,
            category_tags,
            product_ids,
            custom_cta_text,
            custom_cta_link,
            lang,
        } = req.body;

        if (!to) {
            return res.status(400).json({ success: false, message: 'Test recipient email is required.' });
        }

        const sampleProducts = Array.isArray(product_ids) && product_ids.length > 0
            ? await getPickedProducts(product_ids)
            : [];

        const result = await sendTestEmail({
            to,
            subject: subject || 'تجربة حملة بريدية - Ready Marine',
            title: title || 'حملة تجريبية',
            message_body: message_body || '',
            category_tags: category_tags || [],
            products: sampleProducts,
            custom_cta_text,
            custom_cta_link,
            lang: lang || 'ar',
        });

        res.json({ success: true, message: 'تم إرسال بريد التجربة بنجاح!', result });
    } catch (err) {
        console.error('Send test email error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * List campaigns with pagination and filter
 * GET /
 */
const listCampaigns = async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;
        const query = {};
        if (status) query.status = status;

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const [total, campaigns] = await Promise.all([
            CarEmailCampaign.countDocuments(query),
            CarEmailCampaign.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit, 10))
                .populate('sent_by', 'name username email')
                .populate('product_ids', 'name price images status is_active in_stock stock')
                .lean(),
        ]);

        res.json({
            success: true,
            total,
            page: parseInt(page, 10),
            pages: Math.ceil(total / parseInt(limit, 10)),
            campaigns,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Create a new campaign (draft)
 * POST /
 */
const createCampaign = async (req, res) => {
    try {
        const {
            title,
            subject,
            target_filter,
            message_body,
            category_tags,
            product_ids,
            custom_cta_text,
            custom_cta_link,
        } = req.body;

        if (!title || !subject) {
            return res.status(400).json({ success: false, message: 'العنوان وموضوع الرسالة مطلوبان.' });
        }

        const audience = await getTargetAudience(target_filter || {});

        const campaign = new CarEmailCampaign({
            title,
            subject,
            target_filter: target_filter || {},
            message_body: message_body || '',
            category_tags: category_tags || [],
            product_ids: product_ids || [],
            custom_cta_text: custom_cta_text || '',
            custom_cta_link: custom_cta_link || '',
            status: 'draft',
            total_targeted: audience.length,
            sent_by: req.user?._id,
        });

        await campaign.save();
        res.status(201).json({ success: true, campaign });
    } catch (err) {
        console.error('Create campaign error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Get single campaign by ID
 * GET /:id
 */
const getCampaignById = async (req, res) => {
    try {
        const campaign = await CarEmailCampaign.findById(req.params.id)
            .populate('sent_by', 'name username email')
            .populate('product_ids', 'name price images status is_active in_stock stock')
            .lean();

        if (!campaign) {
            return res.status(404).json({ success: false, message: 'الحملة غير موجودة.' });
        }

        res.json({ success: true, campaign });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Update campaign (only allowed for drafts)
 * PUT /:id
 */
const updateCampaign = async (req, res) => {
    try {
        const campaign = await CarEmailCampaign.findById(req.params.id);
        if (!campaign) {
            return res.status(404).json({ success: false, message: 'الحملة غير موجودة.' });
        }
        if (campaign.status === 'sending' || campaign.status === 'sent') {
            return res.status(400).json({ success: false, message: 'لا يمكن تعديل حملة تم إرسالها أو جاري إرسالها.' });
        }

        const {
            title,
            subject,
            target_filter,
            message_body,
            category_tags,
            product_ids,
            custom_cta_text,
            custom_cta_link,
        } = req.body;

        if (title !== undefined) campaign.title = title;
        if (subject !== undefined) campaign.subject = subject;
        if (target_filter !== undefined) {
            campaign.target_filter = target_filter;
            const audience = await getTargetAudience(target_filter);
            campaign.total_targeted = audience.length;
        }
        if (message_body !== undefined) campaign.message_body = message_body;
        if (category_tags !== undefined) campaign.category_tags = category_tags;
        if (product_ids !== undefined) campaign.product_ids = product_ids;
        if (custom_cta_text !== undefined) campaign.custom_cta_text = custom_cta_text;
        if (custom_cta_link !== undefined) campaign.custom_cta_link = custom_cta_link;

        await campaign.save();
        res.json({ success: true, campaign });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Execute sending a campaign
 * POST /:id/send
 */
const sendCampaign = async (req, res) => {
    try {
        const campaign = await CarEmailCampaign.findById(req.params.id);
        if (!campaign) {
            return res.status(404).json({ success: false, message: 'الحملة غير موجودة.' });
        }
        if (campaign.status === 'sending') {
            return res.status(400).json({ success: false, message: 'الحملة جاري إرسالها بالفعل.' });
        }
        if (campaign.status === 'sent') {
            return res.status(400).json({ success: false, message: 'تم إرسال هذه الحملة بالفعل سابقاً.' });
        }

        // Run execution in background so client receives fast response
        executeCampaign(campaign._id, req.user?._id).catch((err) => {
            console.error(`Background campaign execution error [${campaign._id}]:`, err);
        });

        res.json({
            success: true,
            message: 'تم بدء إرسال الحملة في الخلفية بنجاح!',
            campaignId: campaign._id,
        });
    } catch (err) {
        console.error('Execute campaign error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Delete a campaign
 * DELETE /:id
 */
const deleteCampaign = async (req, res) => {
    try {
        const campaign = await CarEmailCampaign.findById(req.params.id);
        if (!campaign) {
            return res.status(404).json({ success: false, message: 'الحملة غير موجودة.' });
        }
        if (campaign.status === 'sending') {
            return res.status(400).json({ success: false, message: 'لا يمكن حذف حملة جاري إرسالها.' });
        }

        await CarEmailCampaign.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'تم حذف الحملة بنجاح.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    unsubscribe,
    getLogos,
    estimateAudience,
    getRecommendations,
    previewHtml,
    sendTest,
    listCampaigns,
    createCampaign,
    getCampaignById,
    updateCampaign,
    sendCampaign,
    deleteCampaign,
};
