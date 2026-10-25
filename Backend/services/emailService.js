const https = require("https");
const { SiteSettings } = require("../models/site_settings");

const escapeHtml = (value) => String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// A rejection carries `statusCode` when the provider answered; one without it (network
// error, timeout) leaves open whether the provider received the request.
const postJson = ({ hostname, path, headers, body, timeoutMs = 0 }) => {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request(
            {
                hostname,
                path,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload),
                    ...headers,
                },
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    let parsed = {};
                    if (data) {
                        try {
                            parsed = JSON.parse(data);
                        } catch (error) {
                            parsed = { message: data };
                        }
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                        return;
                    }

                    const message = parsed?.message || parsed?.error || "Email provider request failed";
                    const error = new Error(message);
                    error.statusCode = res.statusCode;
                    reject(error);
                });
            }
        );

        req.on("error", reject);
        if (timeoutMs > 0) {
            req.setTimeout(timeoutMs, () => req.destroy(new Error(`Email provider did not answer within ${timeoutMs}ms`)));
        }
        req.write(payload);
        req.end();
    });
};

const getBackendOrigin = (verificationUrl) => {
    const configuredUrl = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || process.env.API_PUBLIC_URL;
    if (configuredUrl) return configuredUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");

    try {
        return new URL(verificationUrl).origin;
    } catch (error) {
        return "http://localhost:4000";
    }
};

const resolvePublicUrl = (url, verificationUrl) => {
    if (!url) return "";
    if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) return url;

    const origin = getBackendOrigin(verificationUrl);
    return `${origin}${url.startsWith("/") ? url : `/${url}`}`;
};

const getEmailCopy = (language, role, verificationUrl) => {
    const isAr = language === "ar";
    const accountLabel = isAr
        ? (role === "vendor" ? "البائع" : "العميل")
        : (role === "vendor" ? "vendor" : "customer");

    return isAr
        ? {
            dir: "rtl",
            lang: "ar",
            align: "right",
            subject: "تأكيد بريدك الإلكتروني في ReadyCar",
            fallbackName: "مرحباً",
            eyebrow: "تأكيد البريد الإلكتروني",
            title: "أكمل إنشاء حسابك",
            greeting: "مرحباً",
            body: `يرجى تأكيد بريدك الإلكتروني لإكمال إنشاء حساب ${accountLabel} في ReadyCar.`,
            button: "تأكيد البريد الإلكتروني",
            expiry: "سينتهي هذا الرابط قريباً. إذا لم تطلب إنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة.",
            fallback: "إذا لم يعمل الزر، افتح هذا الرابط في المتصفح:",
            text: (plainName) => `مرحباً${plainName ? ` ${plainName}` : ""}، أكد حساب ${accountLabel} في ReadyCar: ${verificationUrl}`,
        }
        : {
            dir: "ltr",
            lang: "en",
            align: "left",
            subject: "Verify your ReadyCar email",
            fallbackName: "there",
            eyebrow: "Email verification",
            title: "Finish creating your account",
            greeting: "Hello",
            body: `Please verify your email to finish creating your ReadyCar ${accountLabel} account.`,
            button: "Verify email",
            expiry: "This link will expire soon. If you did not request this, you can ignore this email.",
            fallback: "If the button does not work, open this link in your browser:",
            text: (plainName) => `Hello${plainName ? ` ${plainName}` : ""}, verify your ReadyCar ${accountLabel} account: ${verificationUrl}`,
        };
};

const getPasswordResetCopy = (language, role, resetUrl) => {
    const isAr = language === "ar";
    const accountLabel = isAr
        ? (role === "vendor" ? "البائع" : "العميل")
        : (role === "vendor" ? "vendor" : "customer");

    return isAr
        ? {
            dir: "rtl",
            lang: "ar",
            align: "right",
            subject: "إعادة تعيين كلمة مرور ReadyCar",
            fallbackName: "مرحباً",
            eyebrow: "أمان الحساب",
            title: "إعادة تعيين كلمة المرور",
            greeting: "مرحباً",
            body: `تلقينا طلباً لإعادة تعيين كلمة مرور حساب ${accountLabel} في ReadyCar. اضغط الزر أدناه لاختيار كلمة مرور جديدة.`,
            button: "اختيار كلمة مرور جديدة",
            expiry: "سينتهي هذا الرابط قريباً ويمكن استخدامه مرة واحدة فقط. إذا لم تطلب إعادة التعيين، تجاهل هذه الرسالة وسيظل حسابك آمناً.",
            fallback: "إذا لم يعمل الزر، افتح هذا الرابط في المتصفح:",
            text: (plainName) => `مرحباً${plainName ? ` ${plainName}` : ""}، أعد تعيين كلمة مرور حساب ${accountLabel} في ReadyCar: ${resetUrl}`,
        }
        : {
            dir: "ltr",
            lang: "en",
            align: "left",
            subject: "Reset your ReadyCar password",
            fallbackName: "there",
            eyebrow: "Account security",
            title: "Reset your password",
            greeting: "Hello",
            body: `We received a request to reset the password for your ReadyCar ${accountLabel} account. Use the button below to choose a new password.`,
            button: "Choose a new password",
            expiry: "This link expires soon and can only be used once. If you did not request a reset, ignore this email and your account will remain secure.",
            fallback: "If the button does not work, open this link in your browser:",
            text: (plainName) => `Hello${plainName ? ` ${plainName}` : ""}, reset your ReadyCar ${accountLabel} password: ${resetUrl}`,
        };
};

const getSiteLogoUrl = async (verificationUrl) => {
    try {
        const settings = await SiteSettings.findOne().lean();
        return resolvePublicUrl(settings?.logo_url, verificationUrl);
    } catch (error) {
        console.error("Failed to load site logo for verification email:", error.message);
        return "";
    }
};

const sendBrandedActionEmail = async ({ to, name, actionUrl, copy }) => {
    if (!process.env.RESEND_TOKEN) {
        throw new Error("RESEND_TOKEN is not configured");
    }

    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || "ReadyCar <onboarding@resend.dev>";
    const safeName = escapeHtml(name || copy.fallbackName);
    const safeActionUrl = escapeHtml(actionUrl);
    const logoUrl = await getSiteLogoUrl(actionUrl);
    const logoHtml = logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" alt="ReadyCar" width="150" style="display:block;width:150px;max-width:150px;height:auto;margin:0 auto 18px;" />`
        : `<div style="font-size:24px;font-weight:900;color:#111827;letter-spacing:.02em;margin-bottom:18px;text-align:center;">Ready<span style="color:#DC2626;">Car</span></div>`;

    return await postJson({
        hostname: "api.resend.com",
        path: "/emails",
        headers: {
            Authorization: `Bearer ${process.env.RESEND_TOKEN}`,
        },
        body: {
            from,
            to: [to],
            subject: copy.subject,
            html: `
                <div lang="${copy.lang}" dir="${copy.dir}" style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,'Helvetica Neue',sans-serif;color:#111827;">
                    <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
                        <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.08);">
                            <div style="height:6px;background:#DC2626;"></div>
                            <div style="padding:34px 28px 30px;text-align:${copy.align};">
                                ${logoHtml}
                                <p style="margin:0 0 10px;color:#DC2626;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;">${copy.eyebrow}</p>
                                <h1 style="margin:0 0 14px;color:#09090b;font-size:28px;line-height:1.2;font-weight:900;">${copy.title}</h1>
                                <p style="margin:0 0 12px;color:#3f3f46;font-size:16px;line-height:1.7;">${copy.greeting} ${safeName},</p>
                                <p style="margin:0 0 24px;color:#3f3f46;font-size:16px;line-height:1.7;">${copy.body}</p>
                                <div style="text-align:center;margin:30px 0;">
                                    <a href="${safeActionUrl}" style="display:inline-block;background:#DC2626;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:800;font-size:15px;">
                                        ${copy.button}
                                    </a>
                                </div>
                                <p style="margin:0 0 16px;color:#71717a;font-size:13px;line-height:1.7;">${copy.expiry}</p>
                                <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.7;">
                                    ${copy.fallback}<br />
                                    <a href="${safeActionUrl}" style="color:#DC2626;word-break:break-all;">${safeActionUrl}</a>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            text: copy.text(name),
        },
    });
};

const sendVerificationEmail = async ({ to, name, role, verificationUrl, language = "en" }) => {
    return await sendBrandedActionEmail({
        to,
        name,
        actionUrl: verificationUrl,
        copy: getEmailCopy(language, role, verificationUrl),
    });
};

const sendPasswordResetEmail = async ({ to, name, role, resetUrl, language = "en" }) => {
    return await sendBrandedActionEmail({
        to,
        name,
        actionUrl: resetUrl,
        copy: getPasswordResetCopy(language, role, resetUrl),
    });
};

const sendReturnStatusEmail = async ({ to, name, returnNumber, status, details, language = "en" }) => {
    const isAr = language === "ar";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const actionUrl = `${frontendUrl}/account/returns`;

    const statusLabels = {
        approved: isAr ? "تمت الموافقة على طلب الإرجاع" : "Return Request Approved",
        rejected: isAr ? "تم رفض طلب الإرجاع" : "Return Request Rejected",
        return_shipping: isAr ? "تم إنشاء شحنة الإرجاع" : "Return Shipment Created",
        refund_processing: isAr ? "جاري معالجة الاسترداد" : "Refund Processing",
        completed: isAr ? "تم إتمام الاسترداد" : "Refund Completed",
    };

    const statusLabel = statusLabels[status] || status;

    const copy = isAr ? {
        dir: "rtl", lang: "ar", align: "right",
        subject: `ReadyCar — ${statusLabel} (${returnNumber})`,
        fallbackName: "العميل",
        eyebrow: "تحديث طلب الإرجاع",
        title: statusLabel,
        greeting: "مرحباً",
        body: details || `تم تحديث حالة طلب الإرجاع ${returnNumber} إلى: ${statusLabel}.`,
        button: "عرض طلبات الإرجاع",
        expiry: "يمكنك متابعة حالة طلب الإرجاع من حسابك.",
        fallback: "افتح هذا الرابط في المتصفح:",
        text: (n) => `مرحباً${n ? ` ${n}` : ""}, تم تحديث طلب الإرجاع ${returnNumber}: ${statusLabel}. ${actionUrl}`,
    } : {
        dir: "ltr", lang: "en", align: "left",
        subject: `ReadyCar — ${statusLabel} (${returnNumber})`,
        fallbackName: "there",
        eyebrow: "Return Update",
        title: statusLabel,
        greeting: "Hello",
        body: details || `Your return request ${returnNumber} has been updated to: ${statusLabel}.`,
        button: "View Returns",
        expiry: "You can track your return status from your account.",
        fallback: "If the button does not work, open this link in your browser:",
        text: (n) => `Hello${n ? ` ${n}` : ""}, your return ${returnNumber} has been updated: ${statusLabel}. ${actionUrl}`,
    };

    return await sendBrandedActionEmail({ to, name, actionUrl, copy });
};

const sendRefundCompletedEmail = async ({ to, name, refundNumber, amount, method, language = "en" }) => {
    const isAr = language === "ar";
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const actionUrl = `${frontendUrl}/account/returns`;

    const methodLabel = isAr
        ? (method === "original_payment" ? "طريقة الدفع الأصلية" : "تحويل بنكي")
        : (method === "original_payment" ? "original payment method" : "bank transfer");

    const copy = isAr ? {
        dir: "rtl", lang: "ar", align: "right",
        subject: `ReadyCar — تم استرداد ${amount} ج.م (${refundNumber})`,
        fallbackName: "العميل",
        eyebrow: "تم الاسترداد",
        title: `تم استرداد ${amount} ج.م`,
        greeting: "مرحباً",
        body: `تم استرداد مبلغ ${amount} ج.م عبر ${methodLabel}. رقم الاسترداد: ${refundNumber}.`,
        button: "عرض التفاصيل",
        expiry: "قد يستغرق وصول المبلغ بضعة أيام عمل حسب طريقة الدفع.",
        fallback: "افتح هذا الرابط في المتصفح:",
        text: (n) => `مرحباً${n ? ` ${n}` : ""}, تم استرداد ${amount} ج.م عبر ${methodLabel}. ${actionUrl}`,
    } : {
        dir: "ltr", lang: "en", align: "left",
        subject: `ReadyCar — ${amount} EGP Refunded (${refundNumber})`,
        fallbackName: "there",
        eyebrow: "Refund Completed",
        title: `${amount} EGP Refunded`,
        greeting: "Hello",
        body: `A refund of ${amount} EGP has been issued via ${methodLabel}. Refund reference: ${refundNumber}.`,
        button: "View Details",
        expiry: "The refund may take a few business days to appear depending on your payment method.",
        fallback: "If the button does not work, open this link in your browser:",
        text: (n) => `Hello${n ? ` ${n}` : ""}, ${amount} EGP has been refunded via ${methodLabel}. ${actionUrl}`,
    };

    return await sendBrandedActionEmail({ to, name, actionUrl, copy });
};

/**
 * Family invitation — sent to the invited email address.
 * Deliberately states what is (and is not) shared so acceptance is informed.
 */
const sendFamilyInvitationEmail = async ({ to, organizerName, relationshipLabel, invitationUrl, expiresAt, language = "en" }) => {
    const isAr = language === "ar";
    const expiryDate = expiresAt
        ? new Date(expiresAt).toLocaleDateString(isAr ? "ar-u-ca-gregory" : "en-US", { year: "numeric", month: "long", day: "numeric" })
        : "";

    const copy = isAr ? {
        dir: "rtl", lang: "ar", align: "right",
        subject: `${organizerName} يدعوك للانضمام إلى عائلته على ReadyCar`,
        fallbackName: "مرحباً",
        eyebrow: "دعوة العائلة",
        title: `${organizerName} يدعوك للانضمام إلى عائلته`,
        greeting: "مرحباً",
        body: `دعاك ${organizerName} للانضمام إلى عائلته على ReadyCar بصفتك ${relationshipLabel}. بعد القبول يمكنك تجهيز طلبات الشراء وإرسالها إلى ${organizerName} للموافقة عليها. سيرى ${organizerName} كل طلب ويختار طريقة الدفع بنفسه. ستتمكن من استخدام العناوين التي شاركها معك فقط، ولن تتم مشاركة أي معلومات دفع.`,
        button: "مراجعة الدعوة",
        expiry: expiryDate ? `تنتهي صلاحية هذه الدعوة في ${expiryDate}. إذا لم تكن تتوقع هذه الرسالة يمكنك تجاهلها.` : "إذا لم تكن تتوقع هذه الرسالة يمكنك تجاهلها.",
        fallback: "إذا لم يعمل الزر، افتح هذا الرابط في المتصفح:",
        text: () => `دعاك ${organizerName} للانضمام إلى عائلته على ReadyCar: ${invitationUrl}`,
    } : {
        dir: "ltr", lang: "en", align: "left",
        subject: `${organizerName} invited you to join their ReadyCar family`,
        fallbackName: "there",
        eyebrow: "Family invitation",
        title: `${organizerName} invited you to join their family`,
        greeting: "Hello",
        body: `${organizerName} invited you to join their ReadyCar family as their ${relationshipLabel}. Once you accept, you can prepare purchases and send them to ${organizerName} for approval. ${organizerName} reviews every request and chooses how to pay. You will only be able to use the delivery addresses they share with you, and no payment information is ever shared.`,
        button: "Review invitation",
        expiry: expiryDate ? `This invitation expires on ${expiryDate}. If you were not expecting it, you can ignore this email.` : "If you were not expecting this email, you can ignore it.",
        fallback: "If the button does not work, open this link in your browser:",
        text: () => `${organizerName} invited you to join their ReadyCar family: ${invitationUrl}`,
    };

    return await sendBrandedActionEmail({ to, name: "", actionUrl: invitationUrl, copy });
};

/**
 * Company invitation — an employee (orders against a monthly limit) or a manager
 * (runs the company portal). The employee copy says plainly what the company
 * will and will not see, because accepting is the moment they agree to it.
 */
const sendCompanyInvitationEmail = async ({ to, companyName, orgType = "company", role = "employee", invitationUrl, expiresAt, language = "en" }) => {
    const isAr = language === "ar";
    // A school or a property invites the same way; only the words change.
    const { ar: t, en: e } = require("./shared/orgTerms").orgTerms(orgType);
    const added = t.fem ? "ضافتك" : "ضافك";
    const its = t.fem ? "حسابها" : "حسابه";
    const company = escapeHtml(companyName || (isAr ? t.your : `Your ${e.one}`));
    const expiryDate = expiresAt
        ? new Date(expiresAt).toLocaleDateString(isAr ? "ar-u-ca-gregory" : "en-US", { year: "numeric", month: "long", day: "numeric" })
        : "";
    const manager = role === "manager";

    const copy = isAr ? {
        dir: "rtl", lang: "ar", align: "right",
        subject: manager ? `دعوة لإدارة حساب ${companyName} على ReadyCar` : `${companyName} ${added} لحساب ${t.the} على ReadyCar`,
        fallbackName: "مرحباً",
        eyebrow: manager ? "دعوة مدير حساب" : `دعوة ${t.member}`,
        title: manager ? `إدارة حساب ${company} على ReadyCar` : `${company} ${added} لحساب ${t.the}`,
        greeting: "مرحباً",
        body: manager
            ? `تمت دعوتك كمدير لحساب ${company} على ReadyCar. من لوحة ${t.the} هتقدر تضيف ${t.members} وتحدد ليميت كل واحد وتتابع المشتريات والفواتير.`
            : `${company} ${added} لحساب ${t.the} على ReadyCar. بعد ما تنضم هتقدر تطلب قطع غيار لعربيتك على حساب ${t.the} في حدود الليميت الشهري بتاعك. ${t.the} ${t.fem ? "هتشوف" : "هيشوف"} الأوردرات اللي بتطلبها على ${its} بس — مشترياتك الشخصية مش ${t.fem ? "هتظهرلها" : "هتظهرله"}.`,
        button: "مراجعة الدعوة",
        expiry: expiryDate ? `الدعوة دي صالحة لحد ${expiryDate}. لو مكنتش مستني الرسالة دي تقدر تتجاهلها.` : "لو مكنتش مستني الرسالة دي تقدر تتجاهلها.",
        fallback: "لو الزرار مش شغال، افتح الرابط ده في المتصفح:",
        text: () => `${companyName} ${added} لحساب ${t.the} على ReadyCar: ${invitationUrl}`,
    } : {
        dir: "ltr", lang: "en", align: "left",
        subject: manager ? `You're invited to manage ${companyName} on ReadyCar` : `${companyName} added you to its ReadyCar ${e.one} account`,
        fallbackName: "there",
        eyebrow: manager ? "Account manager invitation" : `${e.Member} invitation`,
        title: manager ? `Manage ${company} on ReadyCar` : `${company} added you to its ${e.one} account`,
        greeting: "Hello",
        body: manager
            ? `You've been invited to manage ${company}'s ReadyCar account. From the ${e.one} portal you can add ${e.members}, set each one's limit, and follow purchases and invoices.`
            : `${company} added you to its ReadyCar ${e.one} account. Once you join, you can order car parts for your own car on the ${e.one}'s account, within your monthly limit. The ${e.one} will see only the orders you place on its account — your personal purchases stay private.`,
        button: "Review invitation",
        expiry: expiryDate ? `This invitation expires on ${expiryDate}. If you were not expecting it, you can ignore this email.` : "If you were not expecting this email, you can ignore it.",
        fallback: "If the button does not work, open this link in your browser:",
        text: () => `${companyName} invited you to its ReadyCar ${e.one} account: ${invitationUrl}`,
    };

    return await sendBrandedActionEmail({ to, name: "", actionUrl: invitationUrl, copy });
};

/**
 * A friend invitation, by email.
 *
 * Three situations, one template, because what the person has to DO differs:
 *   'account'  they already shop here — sign in, the request is in the Friends tab.
 *   'claim'    an unclaimed guest account exists for them — open the link and confirm
 *              with the WhatsApp code sent to their phone.
 *   'signup'   nobody has this address yet — create an account with it and the request
 *              will be waiting.
 * Names are user input and are escaped before they reach the HTML.
 */
const sendFriendInvitationEmail = async ({ to, inviterName, actionUrl, mode = "account", expiresAt, language = "en" }) => {
    const isAr = language === "ar";
    const name = escapeHtml(inviterName || (isAr ? "صديقك" : "A friend"));
    const expiryDate = expiresAt
        ? new Date(expiresAt).toLocaleDateString(isAr ? "ar-u-ca-gregory" : "en-US", { year: "numeric", month: "long", day: "numeric" })
        : "";

    const how = isAr
        ? {
            account: "سجّل دخولك وهتلاقي الطلب مستنيك في تاب الأصدقاء في حسابك.",
            claim: "افتح الدعوة وأكّد بالكود اللي هيوصلك على واتساب على رقمك.",
            signup: `اعمل حساب على ReadyCar بالإيميل ده (${escapeHtml(to)}) وهتلاقي الطلب مستنيك في تاب الأصدقاء.`,
        }
        : {
            account: "Sign in and you will find the request waiting in the Friends tab of your account.",
            claim: "Open the invitation and confirm with the code we send to your phone on WhatsApp.",
            signup: `Create a ReadyCar account with this email address (${escapeHtml(to)}) and the request will be waiting in your Friends tab.`,
        };

    const copy = isAr ? {
        dir: "rtl", lang: "ar", align: "right",
        subject: `${inviterName || "صديقك"} عايز يضيفك كصديق على ReadyCar`,
        fallbackName: "",
        eyebrow: "دعوة صداقة",
        title: `${name} عايز يضيفك كصديق`,
        greeting: "أهلاً",
        body: `${name} عايز يضيفك كصديق على ReadyCar عشان تقدروا تشتروا قطع غيار لبعض وتبعتوها على عناوين بعض. ${how[mode] || how.account}`,
        button: mode === "signup" ? "إنشاء حساب" : mode === "claim" ? "مراجعة الدعوة" : "فتح طلبات الصداقة",
        expiry: expiryDate ? `الدعوة صالحة لحد ${expiryDate}. لو مش متوقع الرسالة دي تقدر تتجاهلها.` : "لو مش متوقع الرسالة دي تقدر تتجاهلها.",
        fallback: "لو الزرار مش شغال، افتح اللينك ده في المتصفح:",
        text: () => `${inviterName || "صديقك"} عايز يضيفك كصديق على ReadyCar: ${actionUrl}`,
    } : {
        dir: "ltr", lang: "en", align: "left",
        subject: `${inviterName || "A friend"} wants to connect with you on ReadyCar`,
        fallbackName: "there",
        eyebrow: "Friend invitation",
        title: `${name} wants to connect with you`,
        greeting: "Hello",
        body: `${name} wants to connect with you on ReadyCar so you can buy parts for each other and send them to each other's addresses. ${how[mode] || how.account}`,
        button: mode === "signup" ? "Create your account" : mode === "claim" ? "Review invitation" : "Open friend requests",
        expiry: expiryDate ? `This invitation is valid until ${expiryDate}. If you were not expecting it, you can ignore this email.` : "If you were not expecting this email, you can ignore it.",
        fallback: "If the button does not work, open this link in your browser:",
        text: () => `${inviterName || "A friend"} wants to connect with you on ReadyCar: ${actionUrl}`,
    };

    return await sendBrandedActionEmail({ to, name: "", actionUrl, copy });
};

/** Organizer alert: a family member submitted a purchase request. */
const sendFamilyRequestReceivedEmail = async ({ to, organizerName, requesterName, itemCount, estimatedTotal, currency, requestUrl, language = "en" }) => {
    const isAr = language === "ar";
    const amount = `${currency} ${Number(estimatedTotal || 0).toFixed(2)}`;

    const copy = isAr ? {
        dir: "rtl", lang: "ar", align: "right",
        subject: `طلب شراء جديد من ${requesterName}`,
        fallbackName: "مرحباً",
        eyebrow: "طلب يحتاج إلى مراجعتك",
        title: `${requesterName} أرسل لك طلب شراء`,
        greeting: "مرحباً",
        body: `أرسل ${requesterName} طلب شراء يحتوي على ${itemCount} منتج بإجمالي تقديري ${amount}. لم يتم خصم أي مبلغ حتى الآن — راجع الطلب واختر الموافقة والمتابعة للدفع أو رفض الطلب.`,
        button: "مراجعة الطلب",
        expiry: "سيتم إعادة حساب الأسعار والتوفر والشحن قبل الدفع.",
        fallback: "إذا لم يعمل الزر، افتح هذا الرابط في المتصفح:",
        text: () => `${requesterName} أرسل لك طلب شراء بإجمالي تقديري ${amount}: ${requestUrl}`,
    } : {
        dir: "ltr", lang: "en", align: "left",
        subject: `New order request from ${requesterName}`,
        fallbackName: "there",
        eyebrow: "Request needing your attention",
        title: `${requesterName} sent you an order request`,
        greeting: "Hello",
        body: `${requesterName} sent an order request with ${itemCount} item${itemCount === 1 ? "" : "s"} and an estimated total of ${amount}. Nothing has been charged — review the request and either approve and continue to payment, or decline it.`,
        button: "Review request",
        expiry: "Prices, availability, and shipping are recalculated before payment.",
        fallback: "If the button does not work, open this link in your browser:",
        text: () => `${requesterName} sent you an order request estimated at ${amount}: ${requestUrl}`,
    };

    return await sendBrandedActionEmail({ to, name: organizerName, actionUrl: requestUrl, copy });
};

/** Member alert: the organizer declined their request. */
const sendFamilyRequestDeclinedEmail = async ({ to, memberName, organizerName, reasonLabel, note, requestUrl, language = "en" }) => {
    const isAr = language === "ar";
    const reasonLine = reasonLabel ? (isAr ? ` السبب: ${reasonLabel}.` : ` Reason: ${reasonLabel}.`) : "";
    const noteLine = note ? (isAr ? ` ملاحظة من ${organizerName}: "${note}"` : ` Note from ${organizerName}: "${note}"`) : "";

    const copy = isAr ? {
        dir: "rtl", lang: "ar", align: "right",
        subject: `${organizerName} رفض طلب الشراء الخاص بك`,
        fallbackName: "مرحباً",
        eyebrow: "تحديث طلب الشراء",
        title: "تم رفض طلبك",
        greeting: "مرحباً",
        body: `راجع ${organizerName} طلب الشراء الخاص بك ولم يوافق عليه هذه المرة.${reasonLine}${noteLine} يمكنك تعديل اختيارك وإرسال طلب جديد في أي وقت.`,
        button: "عرض الطلب",
        expiry: "لم يتم خصم أي مبلغ ولم يتم إنشاء أي طلب.",
        fallback: "إذا لم يعمل الزر، افتح هذا الرابط في المتصفح:",
        text: () => `${organizerName} رفض طلب الشراء الخاص بك.${reasonLine} ${requestUrl}`,
    } : {
        dir: "ltr", lang: "en", align: "left",
        subject: `${organizerName} declined your order request`,
        fallbackName: "there",
        eyebrow: "Order request update",
        title: "Your request was declined",
        greeting: "Hello",
        body: `${organizerName} reviewed your order request and did not approve it this time.${reasonLine}${noteLine} You can adjust your selection and send a new request whenever you like.`,
        button: "View request",
        expiry: "Nothing was charged and no order was created.",
        fallback: "If the button does not work, open this link in your browser:",
        text: () => `${organizerName} declined your order request.${reasonLine} ${requestUrl}`,
    };

    return await sendBrandedActionEmail({ to, name: memberName, actionUrl: requestUrl, copy });
};

/** Organizer reminder: an approved request is still waiting for payment. */
const sendFamilyPaymentNeededEmail = async ({ to, organizerName, requesterName, estimatedTotal, currency, requestUrl, language = "en" }) => {
    const isAr = language === "ar";
    const amount = `${currency} ${Number(estimatedTotal || 0).toFixed(2)}`;

    const copy = isAr ? {
        dir: "rtl", lang: "ar", align: "right",
        subject: `تمت الموافقة — بانتظار الدفع (طلب ${requesterName})`,
        fallbackName: "مرحباً",
        eyebrow: "بانتظار الدفع",
        title: "طلبك بانتظار إتمام الدفع",
        greeting: "مرحباً",
        body: `وافقت على طلب الشراء المرسل من ${requesterName} بإجمالي تقديري ${amount}، ولكن لم يتم إتمام الدفع بعد. لن يتم إنشاء الطلب الفعلي حتى تختار الدفع عند الاستلام أو تكمل الدفع الإلكتروني.`,
        button: "متابعة الدفع",
        expiry: "قد تتغير الأسعار والتوفر إذا تأخر الدفع.",
        fallback: "إذا لم يعمل الزر، افتح هذا الرابط في المتصفح:",
        text: () => `طلب ${requesterName} بانتظار الدفع (${amount}): ${requestUrl}`,
    } : {
        dir: "ltr", lang: "en", align: "left",
        subject: `Approved — payment needed (${requesterName}'s request)`,
        fallbackName: "there",
        eyebrow: "Payment needed",
        title: "Your approved request is waiting for payment",
        greeting: "Hello",
        body: `You approved ${requesterName}'s order request, estimated at ${amount}, but payment has not been completed. No real order is created until you choose cash on delivery or finish the online payment.`,
        button: "Continue to payment",
        expiry: "Prices and availability may change while payment is outstanding.",
        fallback: "If the button does not work, open this link in your browser:",
        text: () => `${requesterName}'s request is waiting for payment (${amount}): ${requestUrl}`,
    };

    return await sendBrandedActionEmail({ to, name: organizerName, actionUrl: requestUrl, copy });
};

/**
 * One-time verification code.
 *
 * Rendered as a standalone code block rather than an action button: there is no
 * link to click, and an OTP email that looks like a link email trains customers
 * to click links in messages that ask for codes.
 */
const sendOtpEmail = async ({ to, name, code, expiryMinutes = 10, language = "en" }) => {
    if (!process.env.RESEND_TOKEN) {
        throw new Error("RESEND_TOKEN is not configured");
    }

    const isAr = language === "ar";
    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || "ReadyCar <onboarding@resend.dev>";
    const logoUrl = await getSiteLogoUrl("");
    const safeName = escapeHtml(name || (isAr ? "مرحباً" : "there"));
    const safeCode = escapeHtml(code);

    const copy = isAr
        ? {
            dir: "rtl", lang: "ar", align: "right",
            subject: `رمز التحقق: ${code}`,
            eyebrow: "رمز التحقق",
            title: "أدخل هذا الرمز للمتابعة",
            greeting: "مرحباً",
            body: "استخدم الرمز التالي لتأكيد بريدك الإلكتروني:",
            expiry: `ينتهي هذا الرمز خلال ${expiryMinutes} دقائق ويُستخدم مرة واحدة فقط.`,
            warning: "لن يطلب منك فريق ReadyCar هذا الرمز أبداً. إذا لم تطلبه، تجاهل هذه الرسالة.",
        }
        : {
            dir: "ltr", lang: "en", align: "left",
            subject: `Your verification code: ${code}`,
            eyebrow: "Verification code",
            title: "Enter this code to continue",
            greeting: "Hello",
            body: "Use the following code to confirm your email address:",
            expiry: `This code expires in ${expiryMinutes} minutes and can be used only once.`,
            warning: "ReadyCar staff will never ask you for this code. If you did not request it, ignore this email.",
        };

    const logoHtml = logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" alt="ReadyCar" width="150" style="display:block;width:150px;max-width:150px;height:auto;margin:0 auto 18px;" />`
        : `<div style="font-size:24px;font-weight:900;color:#111827;letter-spacing:.02em;margin-bottom:18px;text-align:center;">Ready<span style="color:#DC2626;">Car</span></div>`;

    return await postJson({
        hostname: "api.resend.com",
        path: "/emails",
        headers: { Authorization: `Bearer ${process.env.RESEND_TOKEN}` },
        body: {
            from,
            to: [to],
            subject: copy.subject,
            html: `
                <div lang="${copy.lang}" dir="${copy.dir}" style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,'Helvetica Neue',sans-serif;color:#111827;">
                    <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
                        <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.08);">
                            <div style="height:6px;background:#DC2626;"></div>
                            <div style="padding:34px 28px 30px;text-align:${copy.align};">
                                ${logoHtml}
                                <p style="margin:0 0 10px;color:#DC2626;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;">${copy.eyebrow}</p>
                                <h1 style="margin:0 0 14px;color:#09090b;font-size:26px;line-height:1.2;font-weight:900;">${copy.title}</h1>
                                <p style="margin:0 0 12px;color:#3f3f46;font-size:16px;line-height:1.7;">${copy.greeting} ${safeName},</p>
                                <p style="margin:0 0 22px;color:#3f3f46;font-size:16px;line-height:1.7;">${copy.body}</p>
                                <div style="text-align:center;margin:26px 0;">
                                    <div style="display:inline-block;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:14px;padding:18px 28px;font-size:34px;font-weight:900;letter-spacing:.32em;color:#09090b;font-family:'Courier New',monospace;">
                                        ${safeCode}
                                    </div>
                                </div>
                                <p style="margin:0 0 14px;color:#71717a;font-size:13px;line-height:1.7;">${copy.expiry}</p>
                                <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.7;">${copy.warning}</p>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            text: isAr
                ? `رمز التحقق الخاص بك: ${code} — ينتهي خلال ${expiryMinutes} دقائق.`
                : `Your ReadyCar verification code is ${code}. It expires in ${expiryMinutes} minutes.`,
        },
    });
};

/**
 * Reminder of a cart the customer left: the lines still in it and a way back to checkout.
 *
 * `items` are already filtered to what can still be bought (abandonedCartService); each is
 * { title, variantLabel, imageUrl, link, quantity, price }. A marketing message, so it carries
 * the unsubscribe link both in the body and as the mail app's own button.
 *
 * Built apart from the sending so the admin can see the email exactly as it went out
 * (routes/adminReports.js). `idempotencyKey` (sendAbandonedCartEmail) goes to Resend, which
 * answers a repeated key (within 24 hours) with the first send instead of sending again — so
 * a retry after a timeout cannot double the email.
 */
const buildAbandonedCartEmail = async ({ name, items, moreCount = 0, cartUrl, unsubscribeUrl, currency = "EGP", language = "en" }) => {
    const isAr = language === "ar";
    const copy = isAr ? {
        dir: "rtl", lang: "ar", align: "right",
        subject: "لسه في عربيتك منتجات مستنياك",
        fallbackName: "عميلنا العزيز",
        eyebrow: "عربة التسوق",
        title: "نسيت حاجة في العربة؟",
        greeting: "مرحباً",
        body: "المنتجات دي لسه في عربة التسوق بتاعتك. كمّل الطلب وقت ما تحب — الأسعار والتوفر بيتأكدوا تاني وقت الدفع.",
        quantity: "الكمية",
        more: (n) => `و${n} منتج تاني في العربة`,
        button: "كمّل الطلب",
        fallback: "لو الزرار مش شغال، افتح الرابط ده في المتصفح:",
        unsubscribe: "إلغاء الاشتراك من الرسائل التسويقية",
    } : {
        dir: "ltr", lang: "en", align: "left",
        subject: "You left something in your cart",
        fallbackName: "there",
        eyebrow: "Your cart",
        title: "Still thinking it over?",
        greeting: "Hello",
        body: "These items are still waiting in your cart. Pick up where you left off — prices and availability are confirmed again at checkout.",
        quantity: "Qty",
        more: (n) => `and ${n} more item${n === 1 ? "" : "s"} in your cart`,
        button: "Continue to checkout",
        fallback: "If the button does not work, open this link in your browser:",
        unsubscribe: "Unsubscribe from marketing emails",
    };

    const money = (value) => `${currency} ${Number(value || 0).toFixed(2)}`;
    const safeName = escapeHtml(name || copy.fallbackName);
    const safeCartUrl = escapeHtml(cartUrl);
    // Light and dark mode exactly as the car campaign does it (carEmailCampaignService): the
    // email stays light, the mail app darkens it if its reader is in dark mode, and the logo
    // reads in both — the black-CAR logo on a white plate, the white-CAR one in Outlook's dark.
    const { getEmailLogos, buildEmailLogoHtml, EMAIL_DARK_MODE_STYLE } = require("./carEmailCampaignService");
    let logos = { logoUrl: "", logoDarkUrl: "" };
    try { logos = getEmailLogos(await SiteSettings.findOne().lean()); }
    catch (error) { console.error("Failed to load the site logos for the cart reminder:", error.message); }
    const logoHtml = buildEmailLogoHtml(logos);

    // Each line its own card, spaced like the car campaign's product cards.
    const rows = items.map((item) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:14px;background:#ffffff;margin:0 0 12px;">
            <tr>
                <td width="94" style="padding:14px;vertical-align:middle;">
                    <a href="${escapeHtml(item.link)}"><img src="${escapeHtml(item.imageUrl)}" alt="" width="80" height="80" style="display:block;width:80px;height:80px;object-fit:cover;border-radius:10px;background:#f4f4f5;" /></a>
                </td>
                <td style="padding:14px 14px 14px 4px;vertical-align:middle;text-align:${copy.align};">
                    <a href="${escapeHtml(item.link)}" style="color:#09090b;text-decoration:none;font-weight:700;font-size:15px;line-height:1.5;">${escapeHtml(item.title)}</a>
                    ${item.variantLabel ? `<div style="color:#71717a;font-size:13px;line-height:1.6;margin-top:2px;">${escapeHtml(item.variantLabel)}</div>` : ""}
                    <div style="color:#71717a;font-size:13px;line-height:1.6;margin-top:2px;">${copy.quantity}: ${Number(item.quantity) || 1}</div>
                    <div style="color:#DC2626;font-size:16px;font-weight:800;line-height:1.5;margin-top:6px;white-space:nowrap;">${escapeHtml(money(item.price))}</div>
                </td>
            </tr>
        </table>`).join("");

    const textLines = items.map((item) => `- ${item.title}${item.variantLabel ? ` (${item.variantLabel})` : ""} × ${Number(item.quantity) || 1} — ${money(item.price)}`);
    if (moreCount > 0) textLines.push(copy.more(moreCount));

    return {
        subject: copy.subject,
        headers: unsubscribeUrl ? {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        } : null,
        html: `<!DOCTYPE html>
<html lang="${copy.lang}" dir="${copy.dir}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- Designed light: asks the mail apps that honour it (Apple Mail) not to invert it. -->
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(copy.subject)}</title>
    <style>
        :root { color-scheme: light; supported-color-schemes: light; }
        @media only screen and (max-width: 520px) {
            .rc-outer { padding: 0 !important; }
            .rc-pad { padding: 24px 14px 22px !important; }
            .rc-h1 { font-size: 23px !important; }
            .rc-cta { display: block !important; padding: 14px 16px !important; }
        }
    </style>
    ${EMAIL_DARK_MODE_STYLE}
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;direction:${copy.dir};text-align:${copy.align};">
    <div class="rc-outer" style="max-width:640px;margin:0 auto;padding:24px 10px;">
        <div style="background-color:#ffffff;border:1px solid #e4e4e7;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.06);">
            <div style="height:6px;background:linear-gradient(90deg, #DC2626 0%, #ef4444 100%);"></div>
            <div style="padding:22px 16px 14px;text-align:center;border-bottom:1px solid #f4f4f5;">
                ${logoHtml}
            </div>
            <div class="rc-pad" style="padding:28px 22px 26px;text-align:${copy.align};background:#ffffff;">
                <p style="margin:0 0 10px;color:#DC2626;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;">${copy.eyebrow}</p>
                <h1 class="rc-h1" style="margin:0 0 14px;color:#09090b;font-size:28px;line-height:1.25;font-weight:900;">${copy.title}</h1>
                <p style="margin:0 0 12px;color:#3f3f46;font-size:16px;line-height:1.7;">${copy.greeting} ${safeName},</p>
                <p style="margin:0 0 18px;color:#3f3f46;font-size:16px;line-height:1.7;">${copy.body}</p>
                <div style="margin:24px 0 0;">${rows}</div>
                ${moreCount > 0 ? `<p style="margin:4px 0 0;color:#71717a;font-size:13px;">${escapeHtml(copy.more(moreCount))}</p>` : ""}
                <div style="text-align:center;margin:28px 0 30px;">
                    <a href="${safeCartUrl}" class="rc-cta" style="display:inline-block;background-color:#DC2626;color:#ffffff;text-decoration:none;padding:15px 36px;border-radius:14px;font-weight:900;font-size:16px;box-shadow:0 8px 20px rgba(220,38,38,0.3);">
                        ${copy.button}
                    </a>
                </div>
                <p style="margin:0;color:#a1a1aa;font-size:12px;line-height:1.7;">
                    ${copy.fallback}<br />
                    <a href="${safeCartUrl}" style="color:#DC2626;word-break:break-all;">${safeCartUrl}</a>
                </p>
            </div>
            ${unsubscribeUrl ? `<div style="padding:16px;text-align:center;background:#fafafa;border-top:1px solid #f4f4f5;font-size:12px;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#a1a1aa;text-decoration:underline;">${copy.unsubscribe}</a></div>` : ""}
        </div>
    </div>
</body>
</html>`,
        text: [
            `${copy.greeting} ${name || copy.fallbackName},`,
            copy.body,
            ...textLines,
            `${copy.button}: ${cartUrl}`,
            unsubscribeUrl ? `${copy.unsubscribe}: ${unsubscribeUrl}` : "",
        ].filter(Boolean).join("\n"),
    };
};

/** Send the reminder above through Resend. Same arguments, plus `to` and `idempotencyKey`. */
const sendAbandonedCartEmail = async ({ to, idempotencyKey, ...content }) => {
    if (!process.env.RESEND_TOKEN) {
        // `notSent`: nothing left this process, so a retry cannot duplicate anything.
        throw Object.assign(new Error("RESEND_TOKEN is not configured"), { notSent: true });
    }
    const email = await buildAbandonedCartEmail(content);
    return await postJson({
        hostname: "api.resend.com",
        path: "/emails",
        timeoutMs: 15000,
        headers: {
            Authorization: `Bearer ${process.env.RESEND_TOKEN}`,
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: {
            from: process.env.RESEND_FROM || process.env.EMAIL_FROM || "ReadyCar <onboarding@resend.dev>",
            to: [to],
            subject: email.subject,
            ...(email.headers ? { headers: email.headers } : {}),
            html: email.html,
            text: email.text,
        },
    });
};

module.exports = {
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendReturnStatusEmail,
    sendRefundCompletedEmail,
    sendFamilyInvitationEmail,
    sendCompanyInvitationEmail,
    sendFriendInvitationEmail,
    sendFamilyRequestReceivedEmail,
    sendFamilyRequestDeclinedEmail,
    sendFamilyPaymentNeededEmail,
    sendOtpEmail,
    sendAbandonedCartEmail,
    buildAbandonedCartEmail,
};
