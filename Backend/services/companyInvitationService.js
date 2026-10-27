const companyWallet = require('./companyWalletService');
/**
 * Company invitations — employees and managers joining a company account.
 *
 * Built the same way as Family invitations (familyService) because the problem
 * is the same one: reach a person by email or mobile number, whether or not
 * they already shop here, and let them join only after proving they own that
 * email or number. Opening the link is never acceptance.
 *
 *   email invitation    accepted by signing in with that address (or registering it);
 *   WhatsApp invitation accepted with a code sent to that number, which also
 *                       claims the placeholder account created for a number
 *                       with no account yet.
 */
const { orgTerms } = require('./shared/orgTerms');
const crypto = require('crypto');

const { User } = require('../models/users');
const { Company, CompanyMembership, CompanyInvitation } = require('../models/companies');
const { recordAuditLog } = require('../models/auditLog');
const { sendCompanyInvitationEmail } = require('./emailService');
const {
    buildInviteLandingUrl,
    getFrontendUrl,
    parseInviteIdentifier,
    maskInviteIdentifier,
    resolveInviteTarget,
    sendWhatsappInvite,
} = require('./shared/guestInvites');
const { guestDisclosureBlocked } = require('./guestCheckoutService');
const { notifyCustomer } = require('./customerNotificationService');
const { normalizeEmailForAuth, formatPhone, hashPassword, generateToken } = require('./authService');
const { phoneLookupVariants } = require('./shared/phone');
const {
    companyError,
    sameId,
    isObjectId,
    cleanText,
    effectiveLimit,
    findGroup,
    findOffice,
    assertGroupId,
    assertOfficeId,
    defaultOfficeId,
    requireManager,
    managerActor,
    notifyManagers,
    expireStaleInvitations,
    loadCompanyById,
} = require('./companyService');

/** Longer than Family's seven: people at work miss emails for a week at a time. */
const INVITATION_TTL_DAYS = 14;
const TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

/** A brake, not a business rule: companies are admin-created and trusted. */
const MAX_PENDING_INVITATIONS = 2000;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const newToken = () => crypto.randomBytes(32).toString('hex');

const buildInvitationUrl = (token) => `${getFrontendUrl()}/company/invitation/${encodeURIComponent(token)}`;

const whatsappContextLine = (role, language, orgType = 'company') => {
    const { ar: t, en: e } = orgTerms(orgType);
    if (role === 'manager') {
        return language === 'ar'
            ? `${t.fem ? 'بتدعوك' : 'بيدعوك'} تدير حساب ${t.the} على ريدي مارين`
            : `invites you to manage its ${e.one} account on Ready Marine`;
    }
    return language === 'ar'
        ? `${t.fem ? 'ضافتك' : 'ضافك'} لحساب ${t.the} على ريدي مارين — اطلب قطع غيار عربيتك على حساب ${t.the}`
        : `added you to its Ready Marine ${e.one} account — order parts for your car on the ${e.one}`;
};

const invitationShape = (invitation) => ({
    _id: invitation._id,
    role: invitation.role,
    name: invitation.name || '',
    email: invitation.email || null,
    phone: invitation.phone || null,
    channel: invitation.channel,
    status: invitation.status,
    group_id: invitation.group_id || null,
    office_id: invitation.office_id || null,
    expires_at: invitation.expires_at,
    last_sent_at: invitation.last_sent_at,
});

const languageFor = (user, fallback) =>
    (user?.preferred_language === 'ar' ? 'ar' : (user?.preferred_language === 'en' ? 'en' : fallback));

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

/** Send on the invitation's own channel. Throws if it could not be sent. */
const deliverOnOwnChannel = async ({ invitation, token, company, language }) => {
    if (invitation.channel === 'whatsapp') {
        const sent = await sendWhatsappInvite({
            phone: invitation.phone,
            inviterName: company.name,
            contextLine: whatsappContextLine(invitation.role, language, company.org_type),
            url: buildInviteLandingUrl(token),
            campaignLabel: `Company invitation — ${company.name}`,
        });
        if (sent?.skipped) {
            throw companyError(
                'INVITE_DELIVERY_UNAVAILABLE',
                'WhatsApp invitations are not available right now. Please try again later.',
                503
            );
        }
        if (sent?.campaignId) invitation.delivery_reference = String(sent.campaignId);
        return;
    }

    await sendCompanyInvitationEmail({
        to: invitation.email,
        companyName: company.name,
        orgType: company.org_type,
        role: invitation.role,
        invitationUrl: buildInvitationUrl(token),
        expiresAt: invitation.expires_at,
        language,
    });
};

/**
 * Also reach the invitee on the channel the invitation did NOT go out on, when
 * their account has it. Best effort: they were already reached once.
 */
const deliverExtras = async ({ invitation, token, company, fallbackLanguage }) => {
    const sent = [];
    const target = invitation.invited_user_id
        ? await User.findById(invitation.invited_user_id).select('email phone preferred_language account_status phone_verified_at')
        : (invitation.email ? await User.findOne({ email: invitation.email }).select('email phone preferred_language') : null);
    if (!target) return sent;
    const lang = languageFor(target, fallbackLanguage);

    if (invitation.channel === 'whatsapp' && target.email) {
        try {
            await sendCompanyInvitationEmail({
                to: target.email,
                companyName: company.name,
                orgType: company.org_type,
                role: invitation.role,
                invitationUrl: buildInvitationUrl(token),
                expiresAt: invitation.expires_at,
                language: lang,
            });
            sent.push('email');
        } catch (err) {
            console.error(`[Company] Email copy of invitation ${invitation._id} failed: ${err.message}`);
        }
    }

    if (invitation.channel === 'email' && target.phone) {
        try {
            const res = await sendWhatsappInvite({
                phone: target.phone,
                inviterName: company.name,
                contextLine: whatsappContextLine(invitation.role, lang, company.org_type),
                url: buildInviteLandingUrl(token),
                campaignLabel: `Company invitation — ${company.name}`,
            });
            if (!res?.skipped) sent.push('whatsapp');
        } catch (err) {
            console.error(`[Company] WhatsApp copy of invitation ${invitation._id} failed: ${err.message}`);
        }
    }
    return sent;
};

/* ------------------------------------------------------------------ */
/* Creating                                                            */
/* ------------------------------------------------------------------ */

/**
 * Find an account for an identifier WITHOUT creating one. Used to decide, before
 * anything is written, whether this person is already somewhere.
 */
const findExistingAccount = async (parsed) => {
    if (parsed.type === 'email') return User.findOne({ email: parsed.normalized }).select('_id name email phone');
    return User.findOne({ phone: { $in: phoneLookupVariants(parsed.normalized) } }).select('_id name email phone');
};

/**
 * What would happen if this person were invited now — shared by a real invite
 * and by the Excel preview, so the two can never disagree.
 *
 * @returns {Promise<{status: string, account: object|null, membership: object|null}>}
 *   status: 'invite' | 'already_member' | 'already_manager' | 'make_employee'
 *           | 'make_manager' | 'pending_invite'
 *
 * Belonging to ANOTHER company is no obstacle: a person may be in several companies.
 */
const classifyInvitee = async (company, parsed, role) => {
    const account = await findExistingAccount(parsed);
    if (account) {
        const membership = await CompanyMembership.findOne({ user_id: account._id, company_id: company._id, status: 'active' });
        if (membership) {
            if (role === 'employee') {
                return { status: membership.is_employee ? 'already_member' : 'make_employee', account, membership };
            }
            return { status: membership.is_manager ? 'already_manager' : 'make_manager', account, membership };
        }
    }

    const pendingFilter = parsed.type === 'email'
        ? { company_id: company._id, email: parsed.normalized, status: 'pending', expires_at: { $gt: new Date() } }
        : { company_id: company._id, phone: parsed.normalized, status: 'pending', expires_at: { $gt: new Date() } };
    if (await CompanyInvitation.exists(pendingFilter)) return { status: 'pending_invite', account, membership: null };

    return { status: 'invite', account, membership: null };
};

/**
 * Invite one person as an employee or a manager of `company`.
 *
 * Someone who is already in THIS company in the other role is not sent an
 * invitation: they already agreed to belong to it, so the role is added
 * directly and they are told.
 *
 * @returns {{ invitation } | { direct: 'employee'|'manager' }}
 */
const createInvitationUnlocked = async ({
    company,
    role,
    name = '',
    identifier,
    group_id = null,
    office_id = null,
    invitedBy,
    language = 'en',
}) => {
    if (!['employee', 'manager'].includes(role)) throw companyError('INVALID_ROLE', 'Unknown role', 400);
    if (company.status === 'ended') throw companyError('COMPANY_ENDED', 'This company account has ended', 409);

    const parsed = parseInviteIdentifier(identifier);
    if (!parsed.type) throw companyError('INVALID_IDENTIFIER', 'Enter a valid email address or mobile number', 400);

    const groupId = role === 'employee' ? assertGroupId(company, group_id) : null;
    const officeId = role === 'employee' ? (assertOfficeId(company, office_id) || defaultOfficeId(company)) : null;

    await expireStaleInvitations(company._id);
    const verdict = await classifyInvitee(company, parsed, role);

    if (verdict.status === 'already_member') {
        throw companyError('ALREADY_MEMBER', 'This person is already an employee of this company', 409);
    }
    if (verdict.status === 'already_manager') {
        throw companyError('ALREADY_MANAGER', 'This person already manages this company', 409);
    }
    if (verdict.status === 'pending_invite') {
        throw companyError('INVITATION_EXISTS', 'An invitation is already waiting for this person. Resend it instead.', 409);
    }

    if (verdict.status === 'make_employee' || verdict.status === 'make_manager') {
        const membership = verdict.membership;
        if (verdict.status === 'make_employee') {
            membership.is_employee = true;
            membership.group_id = groupId;
            membership.office_id = officeId;
        } else {
            membership.is_manager = true;
        }
        await companyWallet.assertAllocationsFit(company, { replacements: [membership] });
        await membership.save();

        await notifyCustomer(
            membership.user_id,
            'company_role_changed',
            verdict.status === 'make_employee' ? {
                title_en: `You now have a limit at ${company.name}`,
                title_ar: `بقى ليك ليميت في ${company.name}`,
                message_en: 'You can now order on the company account within your monthly limit.',
                message_ar: `دلوقتي تقدر تطلب على حساب ${orgTerms(company.org_type).ar.the} في حدود الليميت الشهري بتاعك.`,
            } : {
                title_en: `You now manage ${company.name}`,
                title_ar: `بقيت مدير حساب ${company.name}`,
                message_en: 'You can open the company portal from your account menu.',
                message_ar: `تقدر تفتح لوحة ${orgTerms(company.org_type).ar.the} من قايمة حسابك.`,
            },
            { link: verdict.status === 'make_employee' ? '/profile?tab=company' : '/company' }
        );

        await recordAuditLog({
            action: verdict.status === 'make_employee' ? 'company_manager_made_employee' : 'company_employee_made_manager',
            actor: { role: invitedBy.kind === 'admin' ? 'admin' : 'company_manager', label: invitedBy.label },
            target_type: 'company_membership',
            target_id: membership._id,
            target_snapshot: { company_id: company._id },
        });
        return { direct: verdict.status === 'make_employee' ? 'employee' : 'manager' };
    }

    if (role === 'employee') await companyWallet.assertAllocationsFit(company, { additional: [{ group_id: groupId }] });
    const pendingCount = await CompanyInvitation.countDocuments({ company_id: company._id, status: 'pending' });
    if (pendingCount >= MAX_PENDING_INVITATIONS) {
        throw companyError('PENDING_INVITE_LIMIT', 'Too many invitations are waiting for an answer', 429);
    }

    // Only now, with every refusal behind us, may a placeholder account be
    // created for a number that has none.
    const { user: invitedUser, created } = await resolveInviteTarget(parsed, {
        inviterName: company.name,
        language,
        allowCreate: parsed.type === 'phone',
    });

    const overWhatsapp = parsed.type === 'phone';
    const token = newToken();
    const invitation = await CompanyInvitation.create({
        company_id: company._id,
        role,
        name: cleanText(name, 80),
        email: parsed.type === 'email' ? parsed.normalized : null,
        phone: overWhatsapp ? parsed.normalized : null,
        channel: overWhatsapp ? 'whatsapp' : 'email',
        invited_user_id: invitedUser?._id || null,
        created_invited_account: created,
        group_id: groupId,
        office_id: officeId,
        token_hash: hashToken(token),
        status: 'pending',
        expires_at: new Date(Date.now() + TTL_MS),
        invited_by: { kind: invitedBy.kind, user_id: invitedBy.user_id || null, label: invitedBy.label || '' },
        last_sent_at: new Date(),
    });

    const deliveryLanguage = languageFor(invitedUser, language);
    try {
        await deliverOnOwnChannel({ invitation, token, company, language: deliveryLanguage });
        if (invitation.isModified()) await invitation.save();
    } catch (err) {
        // It never left, so do not keep a row that invites a "resend".
        await CompanyInvitation.deleteOne({ _id: invitation._id });
        if (err.code === 'INVITE_DELIVERY_UNAVAILABLE') throw err;
        throw companyError(
            overWhatsapp ? 'INVITE_DELIVERY_FAILED' : 'EMAIL_DELIVERY_FAILED',
            `Could not send the invitation: ${err.message}`,
            502
        );
    }

    const extraChannels = await deliverExtras({ invitation, token, company, fallbackLanguage: deliveryLanguage });

    await recordAuditLog({
        action: 'company_invitation_sent',
        actor: { role: invitedBy.kind === 'admin' ? 'admin' : 'company_manager', label: invitedBy.label },
        target_type: 'company_invitation',
        target_id: invitation._id,
        target_snapshot: {
            company_id: company._id,
            role,
            identifier_masked: maskInviteIdentifier(parsed),
            channel: invitation.channel,
            extra_channels: extraChannels,
            created_invited_account: created,
        },
    });

    return { invitation: invitationShape(invitation) };
};

/* ------------------------------------------------------------------ */
/* Manager actions on invitations                                      */
/* ------------------------------------------------------------------ */

const inviterFor = async (userId) => {
    const actor = await managerActor(userId);
    return { kind: 'manager', user_id: userId, label: actor.label };
};

const inviteEmployee = async (userId, input = {}, { language = 'en' } = {}) => {
    const { company } = await requireManager(userId);
    return createInvitation({
        company,
        role: 'employee',
        name: input.name,
        identifier: input.identifier,
        group_id: input.group_id,
        office_id: input.office_id,
        invitedBy: await inviterFor(userId),
        language,
    });
};

const inviteManager = async (userId, input = {}, { language = 'en' } = {}) => {
    const { company } = await requireManager(userId);
    return createInvitation({
        company,
        role: 'manager',
        name: input.name,
        identifier: input.identifier,
        invitedBy: await inviterFor(userId),
        language,
    });
};

const adminInviteManager = async (companyId, input = {}, actor, { language = 'en' } = {}) => {
    const company = await loadCompanyById(companyId);
    return createInvitation({
        company,
        role: 'manager',
        name: input.name,
        identifier: input.identifier,
        invitedBy: { kind: 'admin', label: actor?.label || 'Ready Marine' },
        language,
    });
};

/**
 * Send many employee invitations — the rows a manager confirmed on the Excel
 * preview. Every row goes back through `createInvitation`, so nothing the
 * preview said is trusted: a row that became invalid since is reported, not sent.
 */
const MAX_IMPORT_ROWS = 500;
const IMPORT_CONCURRENCY = 5;

const importEmployees = async (userId, rows = [], { language = 'en' } = {}) => {
    const { company } = await requireManager(userId);
    if (!Array.isArray(rows) || !rows.length) throw companyError('NOTHING_TO_IMPORT', 'No rows to send', 400);
    if (rows.length > MAX_IMPORT_ROWS) {
        throw companyError('TOO_MANY_ROWS', `Send at most ${MAX_IMPORT_ROWS} invitations at a time`, 400);
    }

    const invitedBy = await inviterFor(userId);
    const results = new Array(rows.length);
    let cursor = 0;

    const worker = async () => {
        while (cursor < rows.length) {
            const index = cursor++;
            const row = rows[index] || {};
            try {
                const result = await createInvitation({
                    company,
                    role: 'employee',
                    name: row.name,
                    identifier: row.identifier,
                    group_id: row.group_id || null,
                    office_id: row.office_id || null,
                    invitedBy,
                    language,
                });
                results[index] = { ok: true, direct: result.direct || null };
            } catch (err) {
                results[index] = {
                    ok: false,
                    row_number: row.row_number ?? index + 1,
                    identifier: String(row.identifier || ''),
                    code: err.code || 'INVITE_FAILED',
                    message: err.message,
                };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(companyWallet.isWallet(company) ? 1 : IMPORT_CONCURRENCY, rows.length) }, worker));

    return {
        sent: results.filter((r) => r.ok && !r.direct).length,
        made_employee: results.filter((r) => r.ok && r.direct === 'employee').length,
        failed: results.filter((r) => !r.ok),
    };
};

const loadCompanyInvitation = async (company, invitationId) => {
    if (!isObjectId(invitationId)) throw companyError('INVITATION_NOT_FOUND', 'Invitation not found', 404);
    const invitation = await CompanyInvitation.findOne({ _id: invitationId, company_id: company._id });
    if (!invitation) throw companyError('INVITATION_NOT_FOUND', 'Invitation not found', 404);
    return invitation;
};

/**
 * Re-issue a fresh token and send again. Works on an expired invitation too —
 * that is the point of the button next to it — and gives it 14 new days.
 */
const resendInvitationDocUnlocked = async (company, invitation, { language = 'en' } = {}) => {
    if (!['pending', 'expired'].includes(invitation.status)) {
        throw companyError('INVITATION_NOT_RESENDABLE', 'This invitation can no longer be resent', 409);
    }
    if (invitation.role === 'employee') await companyWallet.assertAllocationsFit(company, { additional: [invitation.toObject()], excludeInvitationId: invitation._id });
    const token = newToken();
    invitation.token_hash = hashToken(token);
    invitation.status = 'pending';
    invitation.expires_at = new Date(Date.now() + TTL_MS);
    invitation.last_sent_at = new Date();

    const invitedUser = invitation.invited_user_id
        ? await User.findById(invitation.invited_user_id).select('preferred_language').lean()
        : null;
    const deliveryLanguage = languageFor(invitedUser, language);

    await deliverOnOwnChannel({ invitation, token, company, language: deliveryLanguage });
    await invitation.save();
    // The new token voided every earlier copy, so the other channel gets it too.
    await deliverExtras({ invitation, token, company, fallbackLanguage: deliveryLanguage });
    return invitationShape(invitation);
};

const resendInvitation = async (userId, invitationId, options) => {
    const { company } = await requireManager(userId);
    const invitation = await loadCompanyInvitation(company, invitationId);
    return { invitation: await resendInvitationDoc(company, invitation, options) };
};

const adminResendInvitation = async (companyId, invitationId, options) => {
    const company = await loadCompanyById(companyId);
    const invitation = await loadCompanyInvitation(company, invitationId);
    return { invitation: await resendInvitationDoc(company, invitation, options) };
};

/** "Resend to everyone expired" — one button on the employees table. */
const resendExpiredInvitations = async (userId, options) => {
    const { company } = await requireManager(userId);
    await expireStaleInvitations(company._id);
    const expired = await CompanyInvitation.find({ company_id: company._id, role: 'employee', status: 'expired' });

    let resent = 0;
    const failed = [];
    for (const invitation of expired) {
        try {
            await resendInvitationDoc(company, invitation, options);
            resent += 1;
        } catch (err) {
            failed.push({ _id: invitation._id, code: err.code || 'RESEND_FAILED', message: err.message });
        }
    }
    return { resent, failed };
};

const revokeInvitationDoc = async (invitation) => {
    if (!['pending', 'expired'].includes(invitation.status)) {
        throw companyError('INVITATION_NOT_PENDING', 'This invitation is no longer waiting for an answer', 409);
    }
    invitation.status = 'revoked';
    // Burn the token so an already-open landing page cannot still accept it.
    invitation.token_hash = hashToken(newToken());
    await invitation.save();
    return { invitation: invitationShape(invitation) };
};

const revokeInvitation = async (userId, invitationId) => {
    const { company } = await requireManager(userId);
    return revokeInvitationDoc(await loadCompanyInvitation(company, invitationId));
};

const adminRevokeInvitation = async (companyId, invitationId) => {
    const company = await loadCompanyById(companyId);
    return revokeInvitationDoc(await loadCompanyInvitation(company, invitationId));
};

/* ------------------------------------------------------------------ */
/* The invitee's side                                                  */
/* ------------------------------------------------------------------ */

/** A pending invitation by its raw token, or a precise reason why not. */
const findLiveInvitationByToken = async (token) => {
    if (!token) throw companyError('INVITATION_NOT_FOUND', 'Invitation link is invalid', 404);

    const invitation = await CompanyInvitation.findOne({ token_hash: hashToken(token) });
    if (!invitation) throw companyError('INVITATION_NOT_FOUND', 'Invitation link is invalid or has already been used', 404);

    if (invitation.status === 'revoked') {
        throw companyError('INVITATION_REVOKED', 'This invitation was cancelled by the company', 410);
    }
    if (invitation.status === 'accepted') {
        throw companyError('INVITATION_ALREADY_ACCEPTED', 'This invitation has already been accepted', 409);
    }
    if (invitation.status === 'declined') {
        throw companyError('INVITATION_DECLINED', 'This invitation was already declined', 409);
    }
    if (invitation.status === 'expired' || invitation.expires_at <= new Date()) {
        if (invitation.status === 'pending') {
            invitation.status = 'expired';
            await invitation.save();
        }
        throw companyError('INVITATION_EXPIRED', 'This invitation has expired. Ask the company to send a new one.', 410);
    }
    return invitation;
};

/**
 * What the landing page shows: the company, the role, and — for an employee —
 * the limit and office they will get. Nothing else about the company.
 */
const getInvitationPreview = async (token, currentUser = null) => {
    const invitation = await findLiveInvitationByToken(token);
    const company = await Company.findById(invitation.company_id);
    if (!company || company.status === 'ended') throw companyError('COMPANY_UNAVAILABLE', 'This company account is no longer available', 410);

    const overWhatsapp = invitation.channel === 'whatsapp';
    const invitedUser = invitation.invited_user_id
        ? await User.findById(invitation.invited_user_id).select('account_status phone_verified_at')
        : null;

    const invitedAccountExists = overWhatsapp
        ? !!invitedUser && !guestDisclosureBlocked(invitedUser)
        : !!(await User.exists({ email: invitation.email }));

    const signedInMatches = currentUser
        ? (overWhatsapp
            ? sameId(invitation.invited_user_id, currentUser._id)
            : normalizeEmailForAuth(currentUser.email) === invitation.email)
        : null;

    // Being in another company no longer blocks joining this one; kept false for old screens.
    const signedInOtherCompany = false;

    let employeeTerms = null;
    if (invitation.role === 'employee') {
        const { limit } = effectiveLimit(company, { is_employee: true, group_id: invitation.group_id, limit_override: null });
        const office = findOffice(company, invitation.office_id) || findOffice(company, defaultOfficeId(company));
        employeeTerms = { limit, office_name: office?.name || null };
    }

    return {
        invitation: {
            role: invitation.role,
            email: overWhatsapp ? null : invitation.email,
            phone_masked: overWhatsapp ? maskInviteIdentifier({ type: 'phone', normalized: invitation.phone }) : null,
            channel: invitation.channel,
            expires_at: invitation.expires_at,
        },
        company: { name: company.name, org_type: company.org_type || 'company' },
        employee_terms: employeeTerms,
        invited_account_exists: invitedAccountExists,
        signed_in_matches: signedInMatches,
        signed_in_other_company: signedInOtherCompany,
        needs_account_setup: overWhatsapp && !!invitedUser && guestDisclosureBlocked(invitedUser),
    };
};

/** Shared tail of every acceptance path. */
const attachMembershipFromInvitationUnlocked = async (invitation, user) => {
    const company = await Company.findById(invitation.company_id);
    if (!company || company.status === 'ended') throw companyError('COMPANY_UNAVAILABLE', 'This company account is no longer available', 410);

    // Their membership of THIS company, if any; other companies they belong to are untouched.
    const active = await CompanyMembership.findOne({ user_id: user._id, company_id: company._id, status: 'active' });

    // The group or office may have been removed since the invitation was sent.
    const groupId = findGroup(company, invitation.group_id)?._id || null;
    const office = findOffice(company, invitation.office_id);
    const officeId = office && office.active !== false ? office._id : defaultOfficeId(company);

    if (invitation.role === 'employee') await companyWallet.assertAllocationsFit(company, {
        replacements: [{ ...(active?.toObject() || {}), _id: active?._id || 'new', user_id: user._id, status: 'active', is_employee: true, group_id: groupId }],
        excludeInvitationId: invitation._id,
    });
    let membership = active;
    if (membership) {
        if (invitation.role === 'employee') {
            membership.is_employee = true;
            membership.group_id = groupId;
            membership.office_id = officeId;
        } else {
            membership.is_manager = true;
        }
        await membership.save();
    } else {
        try {
            membership = await CompanyMembership.create({
                company_id: company._id,
                user_id: user._id,
                is_manager: invitation.role === 'manager',
                is_employee: invitation.role === 'employee',
                group_id: invitation.role === 'employee' ? groupId : null,
                office_id: invitation.role === 'employee' ? officeId : null,
                status: 'active',
            });
        } catch (err) {
            if (err.code === 11000) {
                throw companyError('ALREADY_IN_COMPANY', 'This account already belongs to a company account', 409);
            }
            throw err;
        }
    }

    invitation.status = 'accepted';
    invitation.accepted_by_user_id = user._id;
    invitation.token_hash = hashToken(newToken());
    await invitation.save();

    const displayName = user.name || invitation.name || '';
    await notifyManagers(
        company._id,
        'company_invitation_accepted',
        invitation.role === 'manager' ? {
            title_en: `${displayName} joined as a manager`,
            title_ar: `${displayName} انضم كمدير للحساب`,
            message_en: `${displayName} can now manage ${company.name} with you.`,
            message_ar: `${displayName} يقدر دلوقتي يدير حساب ${company.name} معاك.`,
        } : {
            title_en: `${displayName} joined the company account`,
            title_ar: `${displayName} انضم لحساب ${orgTerms(company.org_type).ar.the}`,
            message_en: 'They can now order on the company account within their limit.',
            message_ar: `يقدر دلوقتي يطلب على حساب ${orgTerms(company.org_type).ar.the} في حدود الليميت بتاعه.`,
        },
        { link: invitation.role === 'manager' ? '/company/settings' : '/company/employees' },
        { except: user._id }
    );

    await recordAuditLog({
        action: 'company_invitation_accepted',
        actor: { role: 'user', label: displayName },
        target_type: 'company_membership',
        target_id: membership._id,
        target_snapshot: { company_id: company._id, role: invitation.role },
    });

    return { membership, role: invitation.role };
};

const acceptanceResult = ({ role }) => ({
    joined: true,
    role,
    // Where the landing page sends them next.
    redirect: role === 'manager' ? '/company' : '/profile?tab=company',
});

const acceptInvitationAsUser = async (token, user) => {
    const invitation = await findLiveInvitationByToken(token);

    if (invitation.channel === 'whatsapp') {
        if (!sameId(invitation.invited_user_id, user._id)) {
            throw companyError('ACCOUNT_MISMATCH', 'This invitation was sent to another mobile number', 403);
        }
    } else if (normalizeEmailForAuth(user.email) !== invitation.email) {
        throw companyError('EMAIL_MISMATCH', 'This invitation was sent to another email address', 403);
    }

    return acceptanceResult(await attachMembershipFromInvitation(invitation, user));
};

/**
 * Accept an EMAIL invitation by creating a new account for that address. The
 * invitation proves the mailbox, so no second verification email is sent.
 */
const acceptInvitationWithNewAccount = async (token, { name, phone, password, language = 'en' }) => {
    const invitation = await findLiveInvitationByToken(token);
    if (invitation.channel !== 'email') {
        throw companyError('WRONG_CHANNEL', 'Confirm this invitation with the code we send to your WhatsApp.', 409);
    }

    if (!name || !String(name).trim()) throw companyError('NAME_REQUIRED', 'Please enter your full name', 400);
    if (!password || String(password).length < 8) {
        throw companyError('WEAK_PASSWORD', 'Password must be at least 8 characters', 400);
    }
    const formattedPhone = formatPhone(String(phone || ''));
    if (!formattedPhone) throw companyError('PHONE_REQUIRED', 'Please enter your phone number', 400);

    if (await User.exists({ email: invitation.email })) {
        throw companyError('EMAIL_IN_USE', 'An account already exists for this email. Please sign in instead.', 409);
    }
    if (await User.exists({ phone: formattedPhone })) {
        throw companyError('PHONE_IN_USE', 'This phone number is already used by another account', 409);
    }

    const user = await User.create({
        name: String(name).trim(),
        email: invitation.email,
        phone: formattedPhone,
        password: await hashPassword(password),
        preferred_language: language === 'ar' ? 'ar' : 'en',
    });

    let joined;
    try {
        joined = await attachMembershipFromInvitation(invitation, user);
    } catch (err) {
        // Never leave a half-created account behind if the join fails.
        await User.deleteOne({ _id: user._id });
        throw err;
    }

    await require('./friendService').convertPendingEmailInvites(user);

    return {
        ...acceptanceResult(joined),
        token: generateToken({ id: user._id, role: 'user' }, process.env.JWT_SECRET_USER),
        user: { id: user._id, name: user.name, email: user.email, profile_image: null, role: 'user', cars: [] },
    };
};

const loadWhatsappInvitation = async (token) => {
    const invitation = await findLiveInvitationByToken(token);
    if (invitation.channel !== 'whatsapp') {
        throw companyError('WRONG_CHANNEL', 'This invitation is confirmed by the link we emailed you.', 409);
    }
    const invited = invitation.invited_user_id ? await User.findById(invitation.invited_user_id) : null;
    if (!invited) throw companyError('INVITATION_NOT_FOUND', 'This invitation link is not valid', 404);
    return { invitation, invited };
};

const sendInviteCode = async (token, { language = 'en' } = {}) => {
    const { invited } = await loadWhatsappInvitation(token);
    const { sendInviteClaimCode } = require('./guestCheckoutService');
    return sendInviteClaimCode({ user: invited, language });
};

/** Prove the number with a code, claim the account if it is new, join. */
const acceptInvitationWithCode = async (token, { code, name, rememberMe = true } = {}) => {
    const { invitation, invited } = await loadWhatsappInvitation(token);
    const needsSetup = guestDisclosureBlocked(invited);
    if (needsSetup && !String(name || '').trim()) {
        throw companyError('NAME_REQUIRED', 'Please enter your full name', 400);
    }

    const { claimInvitedAccount } = require('./guestCheckoutService');
    const session = await claimInvitedAccount({ user: invited, code, name: needsSetup ? name : '', rememberMe });
    const claimed = await User.findById(invited._id);

    // If joining fails (they already belong to another company) the account
    // stays claimed: they proved the number, so it is legitimately theirs.
    const joined = await attachMembershipFromInvitation(invitation, claimed);

    return { ...acceptanceResult(joined), token: session.token, user: session.user };
};

const declineInvitation = async (token) => {
    const invitation = await findLiveInvitationByToken(token);
    invitation.status = 'declined';
    invitation.token_hash = hashToken(newToken());
    await invitation.save();

    const label = invitation.name || invitation.email || maskInviteIdentifier({ type: 'phone', normalized: invitation.phone || '' });
    const company = await Company.findById(invitation.company_id).select('org_type').lean();
    await notifyManagers(
        invitation.company_id,
        'company_invitation_declined',
        {
            title_en: 'An invitation was declined',
            title_ar: 'دعوة اترفضت',
            message_en: `${label} declined the invitation to the company account.`,
            message_ar: `${label} رفض الدعوة لحساب ${orgTerms(company.org_type).ar.the}.`,
        },
        { link: invitation.role === 'manager' ? '/company/settings' : '/company/employees' }
    );
    return { declined: true };
};

const createInvitation = (input) => companyWallet.withBudgetLock(input.company._id, async () =>
    createInvitationUnlocked({ ...input, company: await Company.findById(input.company._id) }));
const resendInvitationDoc = (company, invitation, options) => companyWallet.withBudgetLock(company._id, async () =>
    resendInvitationDocUnlocked(await Company.findById(company._id), invitation, options));
const attachMembershipFromInvitation = (invitation, user) => companyWallet.withBudgetLock(invitation.company_id, () =>
    attachMembershipFromInvitationUnlocked(invitation, user));

module.exports = {
    INVITATION_TTL_DAYS,
    MAX_IMPORT_ROWS,
    hashToken,
    classifyInvitee,
    createInvitation,
    inviteEmployee,
    inviteManager,
    adminInviteManager,
    importEmployees,
    resendInvitation,
    adminResendInvitation,
    resendExpiredInvitations,
    revokeInvitation,
    adminRevokeInvitation,
    getInvitationPreview,
    acceptInvitationAsUser,
    acceptInvitationWithNewAccount,
    sendInviteCode,
    acceptInvitationWithCode,
    declineInvitation,
};
