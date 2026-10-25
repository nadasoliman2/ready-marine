const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { User, createUser, findUserByIdentifier, findUserByFields, findUserByPhoneVariants } = require('../models/users');
const { phoneLookupVariants } = require('./shared/phone');
const { Seller, createSeller, findSellerByIdentifier, findSellerByFields } = require('../models/sellers');
const {
    createEmailVerification,
    deleteExistingPendingVerification,
    findEmailVerificationByTokenHash,
    findEmailVerificationById,
    deleteEmailVerificationById,
} = require('../models/emailVerification');
const {
    createPasswordResetToken,
    deletePendingPasswordResetTokens,
    findRecentPasswordResetToken,
    findPasswordResetTokenByHash,
    markPasswordResetTokenUsed,
} = require('../models/passwordResetToken');
const { sendVerificationEmail, sendPasswordResetEmail } = require('./emailService');
const { assignFreeTrialAfterSignup } = require('./vendorSubscriptionService');

/**
 * Standardize phone number formatting.
 */
const formatPhone = (phone) => {
    return phone.replace(/\D/g, '');
};

// The one canonical spelling of an address (dots/+aliases collapsed where the provider
// ignores them). Lives in shared/emailIdentity.js so the User and Seller schemas can apply
// it to every write and every lookup; kept under this name for its many callers.
const normalizeEmailForAuth = (email) => require('./shared/emailIdentity').canonicalEmail(String(email || ''));

/**
 * Hash a password.
 */
const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
};

/**
 * Compare a password with a hash.
 */
const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

/**
 * Generate a JWT token.
 */
const generateToken = (payload, secret, expiresIn = '1d') => {
    return jwt.sign(payload, secret, { expiresIn });
};

const getLoginDuration = (rememberMe) => rememberMe ? '30d' : '1d';

const hashVerificationToken = (token) => {
    return crypto.createHash('sha256').update(token).digest('hex');
};

const getVerificationTtlMinutes = () => {
    const value = Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES);
    return Number.isFinite(value) && value > 0 ? value : 24 * 60;
};

const getPasswordResetTtlMinutes = () => {
    const value = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES);
    return Number.isFinite(value) && value > 0 ? value : 60;
};

const getPasswordResetCooldownSeconds = () => {
    const value = Number(process.env.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS);
    return Number.isFinite(value) && value > 0 ? value : 60;
};

const normalizeLanguage = (language) => language === 'ar' ? 'ar' : 'en';

const getBackendUrl = (requestBaseUrl) => {
    const configuredUrl = process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || process.env.API_PUBLIC_URL;
    return (configuredUrl || requestBaseUrl || 'http://localhost:4000').replace(/\/api\/?$/, '').replace(/\/$/, '');
};

const buildVerificationUrl = (token, requestBaseUrl) => {
    return `${getBackendUrl(requestBaseUrl)}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
};

const getFrontendUrl = () => {
    return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
};

const buildPasswordResetUrl = (token, role) => {
    const params = new URLSearchParams({ token, role });
    return `${getFrontendUrl()}/reset-password?${params.toString()}`;
};

const normalizeChannel = (channel) => (channel === 'whatsapp' ? 'whatsapp' : 'email');

/**
 * How a registration is proved, resolved from the role and the requested
 * channel.
 *
 * Three deliveries, not two. A customer choosing email gets the original
 * confirmation LINK; a store choosing email gets a CODE. The difference is
 * deliberate: a store owner is filling in a long form and a code keeps them on
 * it, while the link flow is what existing customers already know.
 *
 * Whatever is chosen, it decides which contact detail ends up proven — and
 * therefore which one the account is asked to confirm after its first login.
 */
const resolveVerificationDelivery = (role, channel) =>
    (normalizeChannel(channel) === 'whatsapp'
        ? 'whatsapp'
        : (role === 'vendor' ? 'email_otp' : 'email_link'));

/**
 * Create the pending-registration record and deliver its proof-of-ownership
 * challenge.
 *
 * No account exists yet either way — the pending payload only becomes a real
 * `User` or `Seller` once the challenge is answered.
 */
const createVerificationRequest = async ({
    role, email, phone, store_username = null, name, payload,
    requestBaseUrl, language = 'en', channel = 'email',
}) => {
    const delivery = resolveVerificationDelivery(role, channel);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashVerificationToken(token);
    const expiresAt = new Date(Date.now() + getVerificationTtlMinutes() * 60 * 1000);

    await deleteExistingPendingVerification({ role, email, phone, store_username });

    const verification = await createEmailVerification({
        role,
        email,
        phone,
        store_username,
        payload,
        token_hash: tokenHash,
        expires_at: expiresAt,
        channel: delivery,
    });

    if (delivery === 'whatsapp' || delivery === 'email_otp') {
        const { issueOtp } = require('./otpService');
        const overWhatsapp = delivery === 'whatsapp';
        let issued;
        try {
            issued = await issueOtp({
                channel: overWhatsapp ? 'whatsapp' : 'email',
                purpose: 'register',
                destination: overWhatsapp ? phone : email,
                verificationId: verification._id,
                language: normalizeLanguage(language),
                name,
            });
        } catch (error) {
            // Nothing was delivered — drop the pending record so the registrant
            // can retry cleanly (and switch channel) instead of hitting the
            // "already pending" path.
            await deleteEmailVerificationById(verification._id);
            throw error;
        }

        return {
            email,
            role,
            // The client only cares whether it must show a code screen and
            // where the code went, so the wire keeps the simple channel name.
            channel: overWhatsapp ? 'whatsapp' : 'email_otp',
            // The client needs this to address the OTP screen back to us.
            verification_id: verification._id,
            masked_destination: issued.masked_destination,
            expires_at: issued.expires_at,
            resend_available_at: issued.resend_available_at,
        };
    }

    try {
        await sendVerificationEmail({
            to: email,
            name,
            role,
            verificationUrl: buildVerificationUrl(token, requestBaseUrl),
            language: normalizeLanguage(language),
        });
    } catch (error) {
        await deleteEmailVerificationById(verification._id);
        throw new Error(`Could not send verification email: ${error.message}`);
    }

    return {
        email,
        role,
        channel: 'email',
        expires_at: expiresAt,
    };
};

/**
 * Refuse a registration that would collide with an existing account — unless
 * the only thing in the way is the registrant's OWN unclaimed guest account.
 *
 * Guest checkout means a customer can already "exist" without ever having
 * registered. Treating that as a taken phone number would strand them: the
 * account they cannot sign in to would permanently block the account they are
 * trying to create. So an unclaimed guest is reported back to the caller
 * instead of thrown, and the registration proceeds to CLAIM it.
 *
 * A guest that has already proved its phone is not unclaimed — it is a real
 * account whose owner simply never set a password, and it is protected exactly
 * like one.
 *
 * @returns {Promise<object|null>} The guest account this registration will claim.
 */
const assertUserIsUnique = async ({ email, phone }) => {
    if (email && await findUserByFields({ email })) {
        throw new Error('Email already in use');
    }

    const existingByPhone = await findUserByPhoneVariants(phone);
    if (!existingByPhone) return null;

    const isUnclaimedGuest = existingByPhone.account_status === 'guest'
        && !existingByPhone.phone_verified_at;

    if (!isUnclaimedGuest) {
        throw new Error('Phone already in use');
    }

    return existingByPhone;
};

const assertVendorIsUnique = async ({ email, phone, store_username }) => {
    if (await findSellerByFields({ store_username })) {
        throw new Error('Store username already in use');
    }

    if (await findSellerByFields({ email })) {
        throw new Error('Email already in use');
    }

    if (await findSellerByFields({ phone })) {
        throw new Error('Phone already in use');
    }
};

/**
 * Business Logic: Register a new user
 */
const registerUser = async (userData, options = {}) => {
    const { name, email, phone, password } = userData;
    const normalizedEmail = normalizeEmailForAuth(email);
    const formattedPhone = formatPhone(phone);

    await assertUserIsUnique({ email: normalizedEmail, phone: formattedPhone });

    const hashedPassword = await hashPassword(password);

    return await createVerificationRequest({
        role: 'user',
        email: normalizedEmail,
        phone: formattedPhone,
        name,
        requestBaseUrl: options.requestBaseUrl,
        language: normalizeLanguage(options.language || userData.language),
        // The customer picks how to prove ownership: an emailed link, or a
        // WhatsApp code to the number they just entered.
        channel: options.channel || userData.verification_channel,
        payload: {
            name,
            email: normalizedEmail,
            phone: formattedPhone,
            password: hashedPassword
        }
    });
};

/**
 * Business Logic: Authenticate a user
 */
const authenticateUser = async (identifier, password, options = {}) => {
    const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
    const normalizedEmailIdentifier = normalizeEmailForAuth(identifier);
    const formattedPhone = formatPhone(identifier);

    // Try finding by email or formatted phone using model wrapper. The variant
    // lookup is last and covers the same number stored in a different shape —
    // an account registered as "+201012345678" signing in as "01012345678".
    const user = await findUserByIdentifier(normalizedEmailIdentifier)
        || await findUserByIdentifier(normalizedIdentifier)
        || await findUserByIdentifier(formattedPhone)
        || await findUserByPhoneVariants(identifier);

    // A passwordless account (a guest, or one created through Google before a
    // password was set) must never authenticate here. Without this guard the
    // comparison runs against a null hash, and "no password" would be one
    // bcrypt quirk away from meaning "any password".
    if (user && !user.password) {
        throw new Error('Invalid credentials');
    }

    if (user && (await comparePassword(password, user.password))) {
        const token = generateToken({ id: user._id, role: 'user' }, process.env.JWT_SECRET_USER, getLoginDuration(options.rememberMe));
        return {
            token,
            user: { id: user._id, name: user.name, email: user.email, profile_image: user.profile_image || null, role: 'user', cars: user.cars || [] }
        };
    }
    
    throw new Error('Invalid credentials');
};

/**
 * Business Logic: Register a new vendor
 */
const registerVendor = async (vendorData, options = {}) => {
    const { name, store_name, store_username, email, phone, locations, address, shipping_country, shipping_city, password } = vendorData;
    const normalizedEmail = normalizeEmailForAuth(email);
    const formattedPhone = formatPhone(phone);
    const normalizedStoreUsername = store_username.toLowerCase();

    await assertVendorIsUnique({
        email: normalizedEmail,
        phone: formattedPhone,
        store_username: normalizedStoreUsername,
    });

    const hashedPassword = await hashPassword(password);

    // If a legacy address is provided (e.g. from registration form), convert it to a default location
    const vendorLocations = locations || [];
    if (address && vendorLocations.length === 0) {
        vendorLocations.push({
            address,
            shipping_country: shipping_country || null,
            shipping_city: shipping_city || null,
            is_default: true,
        });
    }

    // registerVendorValidation only checks the scalar `address`/`shipping_city`, but a
    // posted `locations` array takes precedence over them — so without this a request with
    // valid scalars and a junk array walked straight past validation into the database.
    const { assertVendorLocationsAreShippable } = require('./vendorService');
    await assertVendorLocationsAreShippable(vendorLocations);

    return await createVerificationRequest({
        role: 'vendor',
        email: normalizedEmail,
        phone: formattedPhone,
        store_username: normalizedStoreUsername,
        name,
        requestBaseUrl: options.requestBaseUrl,
        language: normalizeLanguage(options.language || vendorData.language),
        // A store proves ownership with a 6-digit code, over WhatsApp or over
        // email. Either way it is a code — the owner stays on the long form
        // they just filled in rather than being sent to an inbox.
        channel: options.channel || vendorData.verification_channel,
        payload: {
            name,
            store_name,
            store_username: normalizedStoreUsername,
            email: normalizedEmail,
            phone: formattedPhone,
            locations: vendorLocations,
            password: hashedPassword
        }
    });
};

/**
 * Create a store and give it everything a new store must have.
 *
 * Shared by both ways a vendor can come into existence — the emailed
 * verification link and a Google signup — so neither can quietly skip the
 * Bosta pickup link or the free trial.
 *
 * @param {object} payload Seller fields, already validated and hashed.
 * @returns {Promise<{vendor: object, freeTrialSubscription: object|null}>}
 */
const provisionVendor = async (payload) => {
    await assertVendorIsUnique({
        email: payload.email,
        phone: payload.phone,
        store_username: payload.store_username,
    });

    const vendor = await createSeller(payload);

    // Register the store's address as a Bosta pickup location straight away — an
    // unlinked vendor can never have a courier sent to them. A Bosta outage must not
    // block a signup that is otherwise valid, so a failure here is logged and left to
    // the reconciliation sweep (vendorService.sweepUnlinkedVendorLocations) to retry.
    try {
        const { linkVendorLocationsToBosta } = require('./vendorService');
        const { skipped } = await linkVendorLocationsToBosta(vendor);
        for (const s of skipped) {
            console.warn(`[Bosta] New vendor ${vendor.store_name}: "${s.address}" not linked — ${s.reason}`);
        }
    } catch (err) {
        console.error(`[Bosta] Could not link locations for new vendor ${vendor.store_name}: ${err.message}`);
    }

    const freeTrialSubscription = await assignFreeTrialAfterSignup(vendor._id);
    return { vendor, freeTrialSubscription };
};

const vendorSessionPayload = (vendor, freeTrialSubscription = null) => ({
    id: vendor._id,
    store_name: vendor.store_name,
    store_username: vendor.store_username,
    email: vendor.email,
    status: vendor.status || 'active',
    subscription_status: freeTrialSubscription
        ? 'trial_active'
        : (vendor.subscription_status || 'not_subscribed'),
    role: 'vendor',
});

/**
 * Turn an unclaimed guest account into a full one, in place.
 *
 * Everything the guest accumulated (orders, addresses, loyalty, cart) hangs off
 * this `_id`, so the row is updated rather than replaced. Only the fields a
 * registration actually establishes are written: the name is refreshed because
 * the registration form is a more deliberate answer than a shipping label, and
 * the phone is deliberately NOT touched — it is the identity that matched.
 */
const claimGuestAccount = async (guest, payload, verifiedVia, now) => {
    guest.name = payload.name || guest.name;
    if (payload.email) guest.email = payload.email;
    if (payload.password) guest.password = payload.password;
    guest.account_status = 'active';
    if (verifiedVia === 'email') guest.email_verified_at = now;
    if (verifiedVia === 'whatsapp') guest.phone_verified_at = now;
    await guest.save();
    return guest;
};

/**
 * @param {object}  options
 * @param {boolean} options.issueToken
 * @param {'email'|'whatsapp'} options.verifiedVia Which contact detail the
 *        customer just proved. Only that one is stamped as verified; the other
 *        stays null so the account is prompted to confirm it after login.
 */
const createAccountFromVerification = async (verification, { issueToken = true, verifiedVia = 'email' } = {}) => {
    if (!verification) {
        throw new Error('Verification link is invalid or expired');
    }

    if (verification.role === 'user') {
        const claimableGuest = await assertUserIsUnique({
            email: verification.email,
            phone: verification.phone,
        });

        const now = new Date();
        // A guest account already owns this customer's orders, addresses, and
        // points. Registering must therefore UPGRADE it rather than create a
        // second account — otherwise the first thing a newly registered
        // customer sees is an empty order history, and the orders they placed
        // as a guest are stranded on a row nobody can sign in to.
        const user = claimableGuest
            ? await claimGuestAccount(claimableGuest, verification.payload, verifiedVia, now)
            : await createUser({
                ...verification.payload,
                account_status: 'active',
                email_verified_at: verifiedVia === 'email' ? now : null,
                phone_verified_at: verifiedVia === 'whatsapp' ? now : null,
            });
        await deleteEmailVerificationById(verification._id);
        // Friend requests that were emailed to this address before it had an account.
        // Lazy require: friendService reaches back into this module.
        await require('./friendService').convertPendingEmailInvites(user);
        const token = issueToken ? generateToken({ id: user._id, role: 'user' }, process.env.JWT_SECRET_USER) : null;

        const result = {
            role: 'user',
            user: { id: user._id, name: user.name, email: user.email, profile_image: user.profile_image || null, role: 'user', cars: [] }
        };
        if (token) result.token = token;
        return result;
    }

    if (verification.role === 'vendor') {
        const now = new Date();
        const { vendor, freeTrialSubscription } = await provisionVendor({
            ...verification.payload,
            // Only the detail the code actually reached is stamped; the other
            // stays null so the dashboard asks for it after the first login.
            email_verified_at: verifiedVia === 'email' ? now : null,
            phone_verified_at: verifiedVia === 'whatsapp' ? now : null,
        });

        await deleteEmailVerificationById(verification._id);
        const token = issueToken ? generateToken({ id: vendor._id, role: 'vendor' }, process.env.JWT_SECRET_VENDOR) : null;

        const result = {
            role: 'vendor',
            vendor: vendorSessionPayload(vendor, freeTrialSubscription),
            subscription: freeTrialSubscription || null
        };
        if (token) result.token = token;
        return result;
    }

    throw new Error('Unsupported verification role');
};

/**
 * Load a pending registration by its id, or explain precisely why it is gone.
 * A pending record self-destructs on TTL, so "expired" and "never existed" are
 * indistinguishable here — both tell the customer to register again.
 */
const loadPendingVerification = async (verificationId) => {
    if (!verificationId || !mongoose.Types.ObjectId.isValid(verificationId)) {
        const err = new Error('This registration is no longer pending. Please register again.');
        err.code = 'VERIFICATION_NOT_FOUND';
        err.status = 404;
        throw err;
    }

    const verification = await findEmailVerificationById(verificationId);
    if (!verification || verification.expires_at <= new Date()) {
        const err = new Error('This registration expired. Please register again.');
        err.code = 'VERIFICATION_EXPIRED';
        err.status = 410;
        throw err;
    }
    return verification;
};

/**
 * Business Logic: complete a registration with a WhatsApp OTP.
 *
 * Proves control of the PHONE, so the new account is created with
 * `phone_verified_at` set and `email_verified_at` still null — the post-login
 * prompt then asks for the email.
 */
const verifyRegistrationOtp = async ({ verificationId, code }) => {
    const verification = await loadPendingVerification(verificationId);
    const { verifyOtp } = require('./otpService');

    // The code itself says where it was sent, and that — not the caller and not
    // the pending record — is what decides which contact detail is now proven.
    const { channel } = await verifyOtp({
        purpose: 'register',
        verificationId: verification._id,
        code,
    });

    return await createAccountFromVerification(verification, {
        issueToken: true,
        verifiedVia: channel === 'whatsapp' ? 'whatsapp' : 'email',
    });
};

/**
 * Business Logic: re-send the registration code.
 *
 * A resend must reach the same place by the same route as the original, so the
 * channel comes off the pending record rather than being assumed.
 */
const resendRegistrationOtp = async ({ verificationId, language = 'en' }) => {
    const verification = await loadPendingVerification(verificationId);
    const { issueOtp } = require('./otpService');

    if (verification.channel === 'email_link') {
        const err = new Error('This registration is confirmed by the link we emailed you.');
        err.code = 'VERIFICATION_NOT_OTP';
        err.status = 409;
        throw err;
    }

    const overWhatsapp = verification.channel === 'whatsapp';
    const issued = await issueOtp({
        channel: overWhatsapp ? 'whatsapp' : 'email',
        purpose: 'register',
        destination: overWhatsapp ? verification.phone : verification.email,
        verificationId: verification._id,
        language: normalizeLanguage(language),
        name: verification.payload?.name,
    });

    return {
        channel: overWhatsapp ? 'whatsapp' : 'email_otp',
        verification_id: verification._id,
        masked_destination: issued.masked_destination,
        expires_at: issued.expires_at,
        resend_available_at: issued.resend_available_at,
    };
};

/**
 * Business Logic: Verify email and create the real account.
 */
const verifyEmailRegistration = async (token) => {
    if (!token) {
        throw new Error('Verification token is required');
    }

    const tokenHash = hashVerificationToken(token);
    const verification = await findEmailVerificationByTokenHash(tokenHash);

    return createAccountFromVerification(verification, { issueToken: true });
};

/**
 * Business Logic: Admin manually confirms a pending registration.
 */
const verifyEmailRegistrationById = async (verificationId) => {
    if (!verificationId) {
        throw new Error('Verification ID is required');
    }

    const verification = await findEmailVerificationById(verificationId);
    return createAccountFromVerification(verification, { issueToken: false });
};

/**
 * Business Logic: Authenticate a vendor
 */
const authenticateVendor = async (identifier, password, options = {}) => {
    const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
    const normalizedEmailIdentifier = normalizeEmailForAuth(identifier);
    const formattedPhone = formatPhone(identifier);

    const vendor = await findSellerByIdentifier(normalizedEmailIdentifier) || await findSellerByIdentifier(normalizedIdentifier) || await findSellerByIdentifier(formattedPhone);

    if (vendor && (await comparePassword(password, vendor.password))) {
        const token = generateToken({ id: vendor._id, role: 'vendor' }, process.env.JWT_SECRET_VENDOR, getLoginDuration(options.rememberMe));
        return {
            token,
            vendor: { id: vendor._id, store_name: vendor.store_name, email: vendor.email, status: vendor.status || 'active', role: 'vendor' }
        };
    }

    throw new Error('Invalid credentials');
};

/* ------------------------------------------------------------------ */
/* Google Sign-In                                                      */
/* ------------------------------------------------------------------ */

/**
 * Secret for the short-lived "finish your Google signup" token.
 *
 * Derived from the user JWT secret rather than reusing it directly, so a
 * signup token can never be presented as a session cookie (and vice versa)
 * even though both are JWTs.
 */
const getGoogleSignupSecret = () => {
    const base = process.env.JWT_SECRET_USER || '';
    return crypto.createHmac('sha256', base).update('google-signup').digest('hex');
};

const GOOGLE_SIGNUP_TOKEN_TTL = '30m';

const issueGoogleSignupToken = (profile, role) => generateToken(
    {
        purpose: 'google_signup',
        // Which kind of account this handoff may create. Carried in the signed
        // token, never read from the request body, so a customer handoff can
        // never be spent on a vendor signup.
        role,
        sub: profile.sub,
        email: profile.email,
        name: profile.name,
        picture: profile.picture || null,
    },
    getGoogleSignupSecret(),
    GOOGLE_SIGNUP_TOKEN_TTL
);

const readGoogleSignupToken = (token) => {
    if (!token) {
        const err = new Error('This Google signup expired. Please sign in with Google again.');
        err.code = 'GOOGLE_SIGNUP_EXPIRED';
        err.status = 410;
        throw err;
    }

    try {
        const payload = jwt.verify(token, getGoogleSignupSecret());
        if (payload.purpose !== 'google_signup') throw new Error('wrong purpose');
        return payload;
    } catch (_) {
        const err = new Error('This Google signup expired. Please sign in with Google again.');
        err.code = 'GOOGLE_SIGNUP_EXPIRED';
        err.status = 410;
        throw err;
    }
};

const signupError = (code, message, status = 400) => {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    return err;
};

const userSessionPayload = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    profile_image: user.profile_image || null,
    role: 'user',
    cars: user.cars || [],
});

/**
 * Link a Google account to a record that already exists under the same email,
 * and take anything from the Google profile the account is still missing.
 *
 * The email match is only trusted because `verifyGoogleIdToken` refuses tokens
 * whose email Google has not itself verified.
 */
const linkGoogleProfile = async (account, profile) => {
    let changed = false;

    if (!account.google_id) {
        account.google_id = profile.sub;
        changed = true;
    }

    // Customers have an avatar and a verified-email stamp; stores have
    // neither, so both are copied across only where the schema has a home for
    // them — otherwise every sign-in would write a no-op change.
    const hasPath = (path) => Boolean(account?.schema?.paths?.[path]);

    if (hasPath('profile_image') && !account.profile_image && profile.picture) {
        account.profile_image = profile.picture;
        changed = true;
    }

    // Signing in with Google proves the email as surely as clicking the link
    // we would have mailed to it.
    if (hasPath('email_verified_at') && !account.email_verified_at) {
        account.email_verified_at = new Date();
        changed = true;
    }

    if (changed) await account.save();
    return account;
};

/**
 * Business Logic: sign in with a Google ID token.
 *
 * Returns either a session (`status: 'authenticated'`) or, for a customer with
 * no account yet, a `signup_required` handoff: Google gives us a name and an
 * email but never a phone number, and every account here needs one, so the
 * account is not created until the caller comes back with it via
 * `completeGoogleSignup`.
 *
 * A vendor handoff asks for more (the store's name, username, address and
 * zone) but works the same way.
 */
const authenticateWithGoogle = async ({ credential, role = 'user', rememberMe = false }) => {
    const { verifyGoogleIdToken } = require('./googleAuthService');
    const profile = await verifyGoogleIdToken(credential);
    const email = normalizeEmailForAuth(profile.email);

    if (role === 'vendor') {
        const vendor = await findSellerByFields({ google_id: profile.sub })
            || await findSellerByFields({ email });

        if (!vendor) {
            return {
                status: 'signup_required',
                role: 'vendor',
                signup_token: issueGoogleSignupToken({ ...profile, email }, 'vendor'),
                profile: { name: profile.name, email, picture: profile.picture || null },
            };
        }

        if (vendor.status === 'suspended') {
            const err = new Error('This vendor account is suspended.');
            err.code = 'ACCOUNT_SUSPENDED';
            err.status = 403;
            throw err;
        }

        await linkGoogleProfile(vendor, profile);
        return {
            status: 'authenticated',
            role: 'vendor',
            token: generateToken({ id: vendor._id, role: 'vendor' }, process.env.JWT_SECRET_VENDOR, getLoginDuration(rememberMe)),
            vendor: vendorSessionPayload(vendor),
        };
    }

    const user = await findUserByFields({ google_id: profile.sub })
        || await findUserByFields({ email });

    if (user) {
        await linkGoogleProfile(user, profile);
        return {
            status: 'authenticated',
            role: 'user',
            token: generateToken({ id: user._id, role: 'user' }, process.env.JWT_SECRET_USER, getLoginDuration(rememberMe)),
            user: userSessionPayload(user),
        };
    }

    return {
        status: 'signup_required',
        role: 'user',
        signup_token: issueGoogleSignupToken({ ...profile, email }, 'user'),
        profile: { name: profile.name, email, picture: profile.picture || null },
    };
};

/**
 * The phone and (optional) password every Google signup has to supply,
 * validated the same way for customers and vendors.
 */
const readSharedGoogleSignupFields = ({ phone, password }) => {
    const formattedPhone = formatPhone(String(phone || ''));
    const chosenPassword = String(password || '');

    if (formattedPhone.length < 10) {
        throw signupError('INVALID_PHONE', 'Enter a valid phone number');
    }

    // A password is optional here — Google is already a way in. If one is
    // offered it must clear the same bar as the registration form.
    if (chosenPassword && chosenPassword.length < 6) {
        throw signupError('WEAK_PASSWORD', 'Password must be at least 6 characters');
    }

    return { formattedPhone, chosenPassword };
};

/**
 * Without a chosen password the account still needs the field populated: a
 * random one nobody holds keeps Google the only way in, and "forgot password"
 * remains available to add a real one later.
 */
const hashSignupPassword = (chosenPassword) => hashPassword(
    chosenPassword || crypto.randomBytes(32).toString('hex')
);

/** Finish a customer Google signup. */
const completeGoogleUserSignup = async (pending, { phone, password, language }) => {
    const email = normalizeEmailForAuth(pending.email);
    const { formattedPhone, chosenPassword } = readSharedGoogleSignupFields({ phone, password });

    // The Google account may have been used to sign up in another tab while
    // this token was outstanding — hand back that session instead of failing.
    const existing = await findUserByFields({ google_id: pending.sub })
        || await findUserByFields({ email });
    if (existing) {
        return {
            status: 'authenticated',
            role: 'user',
            token: generateToken({ id: existing._id, role: 'user' }, process.env.JWT_SECRET_USER),
            user: userSessionPayload(existing),
        };
    }

    if (await findUserByFields({ phone: formattedPhone })) {
        throw signupError('PHONE_IN_USE', 'Phone already in use', 409);
    }

    const user = await createUser({
        name: pending.name || email.split('@')[0],
        email,
        phone: formattedPhone,
        password: await hashSignupPassword(chosenPassword),
        profile_image: pending.picture || null,
        google_id: pending.sub,
        preferred_language: normalizeLanguage(language),
        email_verified_at: new Date(),
        phone_verified_at: null,
    });
    await require('./friendService').convertPendingEmailInvites(user);

    return {
        status: 'authenticated',
        role: 'user',
        token: generateToken({ id: user._id, role: 'user' }, process.env.JWT_SECRET_USER),
        user: userSessionPayload(user),
    };
};

/**
 * Finish a vendor Google signup — the store details Google cannot supply.
 *
 * Mirrors `registerVendor` (same uniqueness rules, same shippable-address
 * check, same free trial and Bosta link via `provisionVendor`); the only
 * difference is that the email arrives already proven, so no verification
 * email is sent and the store exists the moment this returns.
 */
const completeGoogleVendorSignup = async (pending, data) => {
    const email = normalizeEmailForAuth(pending.email);
    const { formattedPhone, chosenPassword } = readSharedGoogleSignupFields(data);

    const storeName = String(data.store_name || '').trim();
    const storeUsername = String(data.store_username || '').trim().toLowerCase();
    const address = String(data.address || '').trim();

    if (!storeName) throw signupError('STORE_NAME_REQUIRED', 'Store name is required');
    if (!storeUsername) throw signupError('STORE_USERNAME_REQUIRED', 'Store username is required');
    if (!address) throw signupError('ADDRESS_REQUIRED', 'Store address is required');

    // Same "another tab got there first" guard as the customer path.
    const existing = await findSellerByFields({ google_id: pending.sub })
        || await findSellerByFields({ email });
    if (existing) {
        return {
            status: 'authenticated',
            role: 'vendor',
            token: generateToken({ id: existing._id, role: 'vendor' }, process.env.JWT_SECRET_VENDOR),
            vendor: vendorSessionPayload(existing),
        };
    }

    const locations = [{
        address,
        shipping_country: data.shipping_country || null,
        shipping_city: data.shipping_city || null,
        is_default: true,
    }];

    const { assertVendorLocationsAreShippable } = require('./vendorService');
    await assertVendorLocationsAreShippable(locations);

    const { vendor, freeTrialSubscription } = await provisionVendor({
        name: pending.name || email.split('@')[0],
        store_name: storeName,
        store_username: storeUsername,
        email,
        phone: formattedPhone,
        locations,
        password: await hashSignupPassword(chosenPassword),
        google_id: pending.sub,
        // Google vouched for the address, so it needs no second proof. The
        // phone was typed in on the form and stays unproven.
        email_verified_at: new Date(),
        phone_verified_at: null,
    });

    return {
        status: 'authenticated',
        role: 'vendor',
        token: generateToken({ id: vendor._id, role: 'vendor' }, process.env.JWT_SECRET_VENDOR),
        vendor: vendorSessionPayload(vendor, freeTrialSubscription),
        subscription: freeTrialSubscription || null,
    };
};

/**
 * Business Logic: finish a Google signup with the details Google cannot give
 * us. What is required depends on the account the handoff was issued for —
 * and that comes from the signed token, never from the request body.
 *
 * A customer account is created with the email already verified (Google
 * vouched for it) and the phone unverified, which is exactly the state the
 * post-login prompt is built for — it asks for a WhatsApp code on the number
 * given here.
 */
const completeGoogleSignup = async ({ signupToken, language = 'en', ...data }) => {
    const pending = readGoogleSignupToken(signupToken);

    return pending.role === 'vendor'
        ? await completeGoogleVendorSignup(pending, { ...data, language })
        : await completeGoogleUserSignup(pending, { ...data, language });
};

const getResetAccount = async (role, email) => {
    if (role === 'user') {
        return await findUserByFields({ email });
    }

    if (role === 'vendor') {
        return await findSellerByFields({ email });
    }

    return null;
};

const requestPasswordReset = async ({ role, email, language = 'en' }) => {
    const normalizedRole = role === 'vendor' ? 'vendor' : 'user';
    const normalizedEmail = normalizeEmailForAuth(email);
    const genericResult = {
        message: 'If an account exists for this email, a password reset link has been sent.',
    };

    if (!normalizedEmail) {
        throw new Error('Email is required');
    }

    const account = await getResetAccount(normalizedRole, normalizedEmail);
    if (!account) {
        return genericResult;
    }

    const cooldownSince = new Date(Date.now() - getPasswordResetCooldownSeconds() * 1000);
    const recentToken = await findRecentPasswordResetToken({
        role: normalizedRole,
        account_id: account._id,
        since: cooldownSince,
    });

    if (recentToken) {
        return genericResult;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashVerificationToken(token);
    const expiresAt = new Date(Date.now() + getPasswordResetTtlMinutes() * 60 * 1000);

    await deletePendingPasswordResetTokens({ role: normalizedRole, account_id: account._id });
    const resetToken = await createPasswordResetToken({
        role: normalizedRole,
        account_id: account._id,
        email: account.email,
        token_hash: tokenHash,
        expires_at: expiresAt,
    });

    try {
        await sendPasswordResetEmail({
            to: account.email,
            name: account.name || account.store_name,
            role: normalizedRole,
            resetUrl: buildPasswordResetUrl(token, normalizedRole),
            language: normalizeLanguage(language),
        });
    } catch (error) {
        await markPasswordResetTokenUsed(resetToken._id);
        console.error('Could not send password reset email:', error.message);
    }

    return genericResult;
};

/* ------------------------------------------------------------------ */
/* Password reset by WhatsApp code                                     */
/* ------------------------------------------------------------------ */

/**
 * The account a reset-by-phone is for. Customers are looked up across every spelling of
 * the number; stores by the same variants. An unclaimed guest (no password, never signed
 * in) is not a reset target — it has no password to reset and claims through its own flow.
 */
const getResetAccountByPhone = async (role, phone) => {
    const { isValidEgyptMobile } = require('./shared/phone');
    if (!isValidEgyptMobile(phone)) return null;
    if (role === 'vendor') {
        return await Seller.findOne({ phone: { $in: phoneLookupVariants(phone) } });
    }
    const user = await findUserByPhoneVariants(phone);
    if (!user) return null;
    const { guestDisclosureBlocked } = require('./guestCheckoutService');
    return guestDisclosureBlocked(user) ? null : user;
};

/**
 * Send a password-reset code to the account's WhatsApp.
 *
 * Answers the same way whether or not the number has an account: a truthful "no such
 * account" would make this public page a phone-number lookup. A cooldown or send limit
 * is let through as itself — only someone who just requested a code can hit one.
 */
const requestPasswordResetOtp = async ({ role, phone, language = 'en' }) => {
    const normalizedRole = role === 'vendor' ? 'vendor' : 'user';
    const { canonicalPhone, isValidEgyptMobile } = require('./shared/phone');
    // A malformed number is the typist's mistake, not an account lookup: say so.
    const canonical = isValidEgyptMobile(phone || '') ? canonicalPhone(phone) : '';
    if (!canonical) {
        const err = new Error('Enter a valid mobile number');
        err.status = 400;
        err.code = 'INVALID_PHONE';
        throw err;
    }
    const masked = `${'*'.repeat(Math.max(0, canonical.length - 4))}${canonical.slice(-4)}`;
    const generic = { sent: true, masked_destination: masked };

    const account = await getResetAccountByPhone(normalizedRole, canonical);
    if (!account) return generic;

    const { issueOtp } = require('./otpService');
    try {
        const issued = await issueOtp({
            channel: 'whatsapp',
            purpose: 'password_reset',
            destination: account.phone,
            userId: account._id,
            accountRole: normalizedRole,
            language: normalizeLanguage(language),
            name: account.name || account.store_name,
        });
        return {
            sent: true,
            masked_destination: issued.masked_destination,
            expires_at: issued.expires_at,
            resend_available_at: issued.resend_available_at,
        };
    } catch (err) {
        if (err.code === 'OTP_RESEND_COOLDOWN' || err.code === 'OTP_RESEND_LIMIT') throw err;
        console.error(`[Auth] Password reset code not sent: ${err.message}`);
        return generic;
    }
};

/**
 * Set a new password with the WhatsApp code.
 *
 * The number is resolved again rather than trusted from the send step, and an unknown
 * number fails exactly like a wrong code. Success also proves the phone, retires every
 * outstanding emailed reset link, and signs out old sessions (password_changed_at).
 */
const resetPasswordWithOtp = async ({ role, phone, code, password }) => {
    const normalizedRole = role === 'vendor' ? 'vendor' : 'user';
    const badCode = () => Object.assign(new Error('Incorrect or expired code'), { status: 400, code: 'OTP_INCORRECT' });

    if (!password || String(password).length < 8) {
        throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400, code: 'WEAK_PASSWORD' });
    }

    const account = await getResetAccountByPhone(normalizedRole, phone);
    if (!account) throw badCode();

    const { verifyOtp } = require('./otpService');
    await verifyOtp({ purpose: 'password_reset', code, userId: account._id, accountRole: normalizedRole });

    account.password = await hashPassword(password);
    account.password_changed_at = new Date();
    if (!account.phone_verified_at) account.phone_verified_at = new Date();
    await account.save();

    await deletePendingPasswordResetTokens({ role: normalizedRole, account_id: account._id });

    return { role: normalizedRole, message: 'Password has been reset successfully.' };
};

const resetPasswordWithToken = async ({ token, password }) => {
    if (!token) {
        throw new Error('Reset token is required');
    }

    if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }

    const tokenHash = hashVerificationToken(token);
    const resetToken = await findPasswordResetTokenByHash(tokenHash);

    if (!resetToken) {
        throw new Error('Password reset link is invalid or expired');
    }

    const account = resetToken.role === 'vendor'
        ? await Seller.findById(resetToken.account_id)
        : await User.findById(resetToken.account_id);

    if (!account || account.email !== resetToken.email) {
        await markPasswordResetTokenUsed(resetToken._id);
        throw new Error('Password reset link is invalid or expired');
    }

    account.password = await hashPassword(password);
    account.password_changed_at = new Date();
    await account.save();

    await markPasswordResetTokenUsed(resetToken._id);
    await deletePendingPasswordResetTokens({ role: resetToken.role, account_id: resetToken.account_id });

    return {
        role: resetToken.role,
        message: 'Password has been reset successfully.',
    };
};

module.exports = {
    requestPasswordResetOtp,
    resetPasswordWithOtp,
    formatPhone,
    normalizeEmailForAuth,
    hashPassword,
    comparePassword,
    generateToken,
    registerUser,
    authenticateUser,
    registerVendor,
    authenticateVendor,
    verifyEmailRegistration,
    verifyEmailRegistrationById,
    verifyRegistrationOtp,
    resendRegistrationOtp,
    requestPasswordReset,
    resetPasswordWithToken,
    authenticateWithGoogle,
    completeGoogleSignup
};
