import { forgetProductLists } from './productListPreload';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/**
 * Fired on every 401. The browser can still hold the account after the server's session is
 * gone (the cookie expired, or the phone cleared it); AppContext listens, asks the server
 * who is signed in, and signs out here too when no one is.
 */
export const UNAUTHORIZED_EVENT = 'readycar:unauthorized';

function formatApiMessage(value, fallback = 'Something went wrong') {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map(item => formatApiMessage(item, '')).filter(Boolean).join(', ') || fallback;
    }
    if (typeof value === 'object') {
        return Object.entries(value)
            .map(([key, item]) => {
                const formatted = formatApiMessage(item, '');
                return formatted ? `${key}: ${formatted}` : key;
            })
            .filter(Boolean)
            .join(', ') || fallback;
    }
    return String(value);
}

/**
 * The company-portal company this browser is working on (feature 14): a manager of several
 * companies picks one, and every /company/* request says which. The server only uses it to
 * choose among the caller's own companies.
 */
export const COMPANY_SCOPE_KEY = 'readycar_company_portal_id';
const companyScopeHeaders = (endpoint) => {
    if (typeof window === 'undefined' || !String(endpoint).startsWith('/company/')) return {};
    try {
        const id = window.localStorage.getItem(COMPANY_SCOPE_KEY);
        return id ? { 'X-Company-Id': id } : {};
    } catch (_) {
        return {};
    }
};

/**
 * The address of a file the server sends as an attachment, for `downloadFile`. A link
 * cannot carry the company header, so a portal file names the company in its query.
 */
const fileUrl = (endpoint) => {
    const company = companyScopeHeaders(endpoint)['X-Company-Id'];
    if (!company) return `${BASE_URL}${endpoint}`;
    return `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}company_id=${encodeURIComponent(company)}`;
};

/**
 * Save a file by opening its address: the server answers with Content-Disposition:
 * attachment and the browser downloads it natively. Fetching it into a blob and clicking
 * a temporary link silently did nothing in iPhone browsers — the file arrived and was
 * never saved. Call it straight from the click, before any `await`.
 */
export const downloadFile = (url) => {
    window.location.assign(url);
};

/**
 * The words for an error page nginx answers with in the API's place — its HTML is no message
 * to show: too many requests from this address at once (429), or the server down or
 * restarting (502–504).
 */
const proxyErrorMessage = (status) => {
    const ar = typeof document !== 'undefined' && document.documentElement.lang === 'ar';
    if (status === 429) return ar ? 'طلبات كتير في وقت قصير. استنى ثواني وجرّب تاني.' : 'Too many requests at once. Wait a few seconds and try again.';
    if (status >= 502 && status <= 504) return ar ? 'السيرفر مش متاح دلوقتي. جرّب تاني بعد شوية.' : 'The server is not reachable right now. Try again shortly.';
    return null;
};

/**
 * Custom fetch wrapper to handle authentication and base URL.
 */
async function apiRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const { timeoutMs = 30000, ...requestOptions } = options;
    const controller = typeof AbortController !== 'undefined' && !requestOptions.signal
        ? new AbortController()
        : null;
    const signal = requestOptions.signal || controller?.signal;
    let timeoutId;
    let didTimeout = false;
    
    const defaultOptions = {
        ...requestOptions,
        headers: {
            'Content-Type': 'application/json',
            ...companyScopeHeaders(endpoint),
            ...(requestOptions.headers || {}),
        },
    };

    // Ensure credentials (cookies) are sent
    defaultOptions.credentials = 'include';
    if (signal) {
        defaultOptions.signal = signal;
    }
    if (controller) {
        timeoutId = setTimeout(() => {
            didTimeout = true;
            controller.abort();
        }, timeoutMs);
    }

    try {
        const response = await fetch(url, defaultOptions);
        const text = await response.text();
        let data = {};
        let isJson = true;
        try {
            data = text ? JSON.parse(text) : {};
        } catch (error) {
            isJson = false;
            data = { message: text };
        }
        
        if (!response.ok) {
            const err = new Error((!isJson && proxyErrorMessage(response.status)) || formatApiMessage(data.message || data.error));
            err.status = response.status;
            if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
            if (data.code) err.code = data.code;
            if (data.maxProducts !== undefined) err.maxProducts = data.maxProducts;
            if (data.currentCount !== undefined) err.currentCount = data.currentCount;
            if (data.excessCount !== undefined) err.excessCount = data.excessCount;
            if (data.maxProducts !== undefined) err.maxProducts = data.maxProducts;
            if (data.allProducts !== undefined) err.allProducts = data.allProducts;
            // A wallet shortfall is actionable, not just readable: checkout
            // turns it into a one-tap top-up for the exact missing amount, so
            // it has to survive the trip through the Error.
            if (data.wallet !== undefined) err.wallet = data.wallet;
            // How many guesses a one-time code has left. The OTP screens count
            // it down in front of the customer, so it has to survive the trip
            // through the Error rather than being re-derived from a message.
            if (data.attempts_remaining !== undefined) err.attemptsRemaining = data.attempts_remaining;
            throw err;
        }
        
        return data;
    } catch (error) {
        if (error.name === 'AbortError') {
            if (didTimeout) {
                throw new Error('Request timed out. Please try again.');
            }
            throw error;
        }
        console.error('API Request Error:', error.message);
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

/**
 * Fetch an endpoint that answers with a file rather than JSON.
 * Errors still come back as JSON, so those are parsed out for the message.
 */
async function apiRequestBlob(endpoint) {
    const response = await fetch(`${BASE_URL}${endpoint}`, { credentials: 'include', headers: companyScopeHeaders(endpoint) });
    if (!response.ok) {
        let message = 'Something went wrong';
        try {
            const data = await response.json();
            message = formatApiMessage(data.message || data.error);
        } catch (_) { /* non-JSON error body */ }
        throw new Error(message);
    }
    return response.blob();
}

export const authApi = {
    me: () => apiRequest('/auth/me'),
    registerUser: (userData) => apiRequest('/auth/register-user', {
        method: 'POST',
        body: JSON.stringify(userData),
    }),
    loginUser: (credentials) => apiRequest('/auth/login-user', {
        method: 'POST',
        body: JSON.stringify(credentials),
    }),
    registerVendor: (vendorData) => apiRequest('/auth/register-vendor', {
        method: 'POST',
        body: JSON.stringify(vendorData),
    }),
    loginVendor: (credentials) => apiRequest('/auth/login-vendor', {
        method: 'POST',
        body: JSON.stringify(credentials),
    }),
    forgotPassword: (data) => apiRequest('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    resetPassword: (data) => apiRequest('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    // Reset by WhatsApp code instead of the emailed link: send the code, then set the
    // new password with it.
    forgotPasswordOtp: (data) => apiRequest('/auth/forgot-password/otp', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    resetPasswordOtp: (data) => apiRequest('/auth/reset-password/otp', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    logout: () => apiRequest('/auth/logout', {
        method: 'POST',
    }),

    // ---- Google Sign-In ----
    // `credential` is the ID token from Google Identity Services. A customer
    // with no account yet comes back as { status: 'signup_required' } plus a
    // signup_token — Google never gives us a phone number, so the account is
    // only created once completeGoogleSignup supplies one.
    googleSignIn: ({ credential, role, remember_me }) => apiRequest('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, role, remember_me }),
    }),
    // `password` is optional — Google is already a way into the account. A
    // vendor handoff additionally carries the store fields; which ones the
    // server requires comes from the signed signup_token, not from here.
    completeGoogleSignup: (details) => apiRequest('/auth/google/complete', {
        method: 'POST',
        body: JSON.stringify(details),
    }),

    // ---- WhatsApp OTP registration ----
    // `verification_channel` is 'email' (link) or 'whatsapp' (6-digit code).
    verifyRegistrationOtp: ({ verification_id, code }) => apiRequest('/auth/verify-registration-otp', {
        method: 'POST',
        body: JSON.stringify({ verification_id, code }),
    }),
    resendRegistrationOtp: ({ verification_id, language }) => apiRequest('/auth/resend-registration-otp', {
        method: 'POST',
        body: JSON.stringify({ verification_id, language }),
    }),
};

/**
 * Guest checkout — the account is created from the shipping form, silently.
 *
 * Nothing here is a "sign up" from the customer's point of view: `lookupPhone`
 * runs as they leave the phone field, `startSession` runs once the form has a
 * name and a number, and the code only ever appears AFTER an order exists —
 * framed as confirming that order, never as activating an account.
 */
export const guestApi = {
    // Bare { exists, can_use_password } — never a name or a masked contact.
    lookupPhone: (phone) => apiRequest('/auth/guest/lookup', {
        method: 'POST',
        body: JSON.stringify({ phone }),
    }),
    // Throws { code: 'ACCOUNT_EXISTS' } when the number is a real account. That
    // is not an error to show — it is the cue to offer a sign-in code instead.
    startSession: ({ name, phone, language }) => apiRequest('/auth/guest/session', {
        method: 'POST',
        body: JSON.stringify({ name, phone, language }),
    }),
    sendConfirmation: ({ language } = {}) => apiRequest('/auth/guest/confirm/send', {
        method: 'POST',
        body: JSON.stringify({ language }),
    }),
    confirm: ({ code }) => apiRequest('/auth/guest/confirm', {
        method: 'POST',
        body: JSON.stringify({ code }),
    }),
    // Optional, and only ever offered once the number is confirmed.
    setPassword: ({ password }) => apiRequest('/auth/guest/password', {
        method: 'POST',
        body: JSON.stringify({ password }),
    }),
};

/**
 * Signing in with a WhatsApp code instead of a password.
 *
 * `send` always reports success — it is reachable from an open checkout page,
 * so a truthful "no such account" would make it a phone-number oracle.
 */
export const otpLoginApi = {
    send: ({ phone, language }) => apiRequest('/auth/otp-login/send', {
        method: 'POST',
        body: JSON.stringify({ phone, language }),
    }),
    verify: ({ phone, code, remember_me }) => apiRequest('/auth/otp-login/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, code, remember_me }),
    }),
};

// Confirming a signed-in customer's email and phone.
export const verificationApi = {
    getStatus: () => apiRequest('/users/verification/status'),
    // `value` optionally corrects the contact detail before the code is sent.
    send: ({ target, value, language }) => apiRequest('/users/verification/send', {
        method: 'POST',
        body: JSON.stringify({ target, value, language }),
    }),
    confirm: ({ target, code }) => apiRequest('/users/verification/confirm', {
        method: 'POST',
        body: JSON.stringify({ target, code }),
    }),
    cancelPending: (target) => apiRequest('/users/verification/cancel', {
        method: 'POST',
        body: JSON.stringify({ target }),
    }),
};

export const userApi = {
    getProfile: () => apiRequest('/users/profile'),
    updateProfile: (data) => apiRequest('/users/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    uploadProfilePhoto: async (file) => {
        const formData = new FormData();
        formData.append('profile_image', file);
        const response = await fetch(`${BASE_URL}/users/profile-photo`, {
            method: 'PUT',
            credentials: 'include',
            body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Upload failed');
        return data;
    },
    changePassword: (data) => apiRequest('/users/change-password', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    getOrders: () => apiRequest('/users/orders'),
    // One card per parcel, each naming the store it comes from and — on a cash order —
    // exactly what its courier will collect.
    getOrderTracking: (orderId) => apiRequest(`/users/orders/${orderId}/tracking`),
    // A link to the review form for one delivered parcel, or `{ submitted: true }`.
    getParcelReviewLink: (orderId, subOrderId) =>
        apiRequest(`/users/orders/${orderId}/parcels/${subOrderId}/review-link`, { method: 'POST' }),
    // Open only while no courier has been booked for that parcel.
    cancelParcel: (orderId, subOrderId, reason) =>
        apiRequest(`/users/orders/${orderId}/sub-orders/${subOrderId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
        }),
    getOrderTracking: (orderId) => apiRequest(`/users/orders/${orderId}/tracking`),
    addAddress: (data) => apiRequest('/users/addresses', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateAddress: (id, data) => apiRequest(`/users/addresses/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteAddress: (id) => apiRequest(`/users/addresses/${id}`, {
        method: 'DELETE',
    }),
    // The garage orders the shop's lists (what fits comes first): a change makes them stale.
    addCar: (data) => apiRequest('/users/cars', {
        method: 'POST',
        body: JSON.stringify(data),
    }).then((res) => { forgetProductLists(); return res; }),
    deleteCar: (id) => apiRequest(`/users/cars/${id}`, {
        method: 'DELETE',
    }).then((res) => { forgetProductLists(); return res; }),
    getRecommendations: (limit) => apiRequest(`/users/recommendations${limit ? `?limit=${limit}` : ''}`),
    getCart: () => apiRequest('/users/cart'),
    syncCart: (items) => apiRequest('/users/cart', {
        method: 'POST',
        body: JSON.stringify({ items }),
    }),
};

// Family — organizer/member management and order requests.
export const familyApi = {
    // ---- Family + membership ----
    getOverview: () => apiRequest('/users/family'),
    getSharedAddresses: () => apiRequest('/users/family/shared-addresses'),
    invite: (data) => apiRequest('/users/family/invitations', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    resendInvitation: (id, language) => apiRequest(`/users/family/invitations/${id}/resend`, {
        method: 'POST',
        body: JSON.stringify({ language }),
    }),
    revokeInvitation: (id) => apiRequest(`/users/family/invitations/${id}`, {
        method: 'DELETE',
    }),
    updateMemberAddresses: (memberId, sharedAddressIds) => apiRequest(`/users/family/members/${memberId}/addresses`, {
        method: 'PUT',
        body: JSON.stringify({ shared_address_ids: sharedAddressIds }),
    }),
    removeMember: (memberId) => apiRequest(`/users/family/members/${memberId}`, {
        method: 'DELETE',
    }),
    leaveFamily: () => apiRequest('/users/family/leave', { method: 'POST' }),

    // ---- Order requests ----
    submitRequest: (data) => apiRequest('/users/family/order-requests', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    getRequests: (status) => apiRequest(`/users/family/order-requests${status ? `?status=${status}` : ''}`),
    getRequest: (id) => apiRequest(`/users/family/order-requests/${id}`),
    withdrawRequest: (id) => apiRequest(`/users/family/order-requests/${id}/withdraw`, { method: 'POST' }),
    declineRequest: (id, data) => apiRequest(`/users/family/order-requests/${id}/decline`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    approveRequest: (id, data) => apiRequest(`/users/family/order-requests/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
    }),
    getCheckoutPreview: (id, { addressId, shippingMethodId } = {}) => {
        const query = new URLSearchParams();
        if (addressId) query.set('address_id', addressId);
        if (shippingMethodId) query.set('shipping_method_id', shippingMethodId);
        const qs = query.toString();
        return apiRequest(`/users/family/order-requests/${id}/checkout-preview${qs ? `?${qs}` : ''}`);
    },
    // `data.payment_method` ('wallet' | 'credit_card') is the organizer's choice
    // at approval time; the server re-checks it against what is on offer.
    placeCod: (id, data) => apiRequest(`/users/family/order-requests/${id}/place-cod`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
    }),
    createPayment: (id, data) => apiRequest(`/users/family/order-requests/${id}/create-payment`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
    }),
    confirmPayment: (id, { paymentId, invoice_id }) => apiRequest(`/users/family/order-requests/${id}/confirm-payment`, {
        method: 'POST',
        body: JSON.stringify({ paymentId, invoice_id }),
    }),
    reportPaymentFailed: (id, reason) => apiRequest(`/users/family/order-requests/${id}/payment-failed`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
    }),
};

// Family invitations — token-addressed, usable while signed out.
export const familyInvitationApi = {
    preview: (token) => apiRequest(`/family-invitations/${encodeURIComponent(token)}`),
    accept: (token) => apiRequest(`/family-invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
    }),
    acceptWithRegistration: (token, data) => apiRequest(`/family-invitations/${encodeURIComponent(token)}/accept-with-registration`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    // ---- WhatsApp invitations ----
    // For someone invited by mobile number who has no account. The link proves
    // only that a message was forwarded; the code proves they hold the number.
    sendCode: (token, language) => apiRequest(`/family-invitations/${encodeURIComponent(token)}/send-code`, {
        method: 'POST',
        body: JSON.stringify({ language }),
    }),
    // Joins with a name and six digits — no password, and no address, because a
    // member orders against the organizer's shared addresses.
    acceptWithCode: (token, data) => apiRequest(`/family-invitations/${encodeURIComponent(token)}/accept-with-code`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    decline: (token) => apiRequest(`/family-invitations/${encodeURIComponent(token)}/decline`, {
        method: 'POST',
    }),
};

/**
 * Friend invitations — token-addressed, usable while signed out.
 *
 * The counterpart to `familyInvitationApi`, for someone invited to be a friend
 * by a mobile number that had no account. Unlike a family member, a friend does
 * need an address of their own: the friendship is symmetric, and a friend with
 * nothing shared back cannot be bought for.
 */
export const friendInvitationApi = {
    preview: (token) => apiRequest(`/friend-invitations/${encodeURIComponent(token)}`),
    sendCode: (token, language) => apiRequest(`/friend-invitations/${encodeURIComponent(token)}/send-code`, {
        method: 'POST',
        body: JSON.stringify({ language }),
    }),
    accept: (token, data) => apiRequest(`/friend-invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    decline: (token) => apiRequest(`/friend-invitations/${encodeURIComponent(token)}/decline`, {
        method: 'POST',
    }),
};

// Friends — symmetric peer relationships and buying for a friend.
export const friendsApi = {
    // ---- Friends + invitations ----
    getOverview: () => apiRequest('/users/friends'),
    getPurchasable: () => apiRequest('/users/friends/purchasable'),
    getOrdersForMe: () => apiRequest('/users/friends/orders-for-me'),
    invite: (data) => apiRequest('/users/friends/invitations', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    acceptInvitation: (id, sharedAddressIds) => apiRequest(`/users/friends/invitations/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ shared_address_ids: sharedAddressIds }),
    }),
    declineInvitation: (id) => apiRequest(`/users/friends/invitations/${id}/decline`, {
        method: 'POST',
    }),
    cancelInvitation: (id) => apiRequest(`/users/friends/invitations/${id}`, {
        method: 'DELETE',
    }),
    removeFriend: (friendId) => apiRequest(`/users/friends/${friendId}`, { method: 'DELETE' }),
    blockFriend: (friendId) => apiRequest(`/users/friends/${friendId}/block`, { method: 'POST' }),

    // ---- Directional address sharing ----
    getSharedWithMe: (friendId) => apiRequest(`/users/friends/${friendId}/shared-addresses`),
    getMySharedAddresses: (friendId) => apiRequest(`/users/friends/${friendId}/my-shared-addresses`),
    updateMySharedAddresses: (friendId, sharedAddressIds) => apiRequest(`/users/friends/${friendId}/my-shared-addresses`, {
        method: 'PUT',
        body: JSON.stringify({ shared_address_ids: sharedAddressIds }),
    }),
};

// Buying for a friend — online payment only; there is no COD endpoint.
export const friendCheckoutApi = {
    preview: (data) => apiRequest('/orders/friend-checkout/preview', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    createPayment: (data) => apiRequest('/orders/friend-checkout/create-payment', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    confirmPayment: ({ paymentId, invoice_id }) => apiRequest('/orders/friend-checkout/confirm-payment', {
        method: 'POST',
        body: JSON.stringify({ paymentId, invoice_id }),
    }),
};

// Customer in-app notifications (storefront bell) — distinct from vendor ones.
export const customerNotificationsApi = {
    getAll: ({ page, limit, language } = {}) => {
        const query = new URLSearchParams();
        if (page) query.set('page', page);
        if (limit) query.set('limit', limit);
        if (language) query.set('language', language);
        const qs = query.toString();
        return apiRequest(`/users/notifications${qs ? `?${qs}` : ''}`);
    },
    getCount: () => apiRequest('/users/notifications/count'),
    markAsRead: (id) => apiRequest(`/users/notifications/${id}/read`, { method: 'PUT' }),
    markAllAsRead: () => apiRequest('/users/notifications/read-all', { method: 'PUT' }),
};

export const orderApi = {
    createOrder: (orderData) => apiRequest('/orders', {
        method: 'POST',
        body: JSON.stringify(orderData),
    }),
    // Authoritative totals for the checkout summary. Whatever this returns is
    // for DISPLAY only — placement re-prices everything server-side.
    preview: (data) => apiRequest('/orders/preview', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    confirmPayment: ({ paymentId, invoice_id }) => apiRequest('/orders/confirm-payment', {
        method: 'POST',
        body: JSON.stringify({ paymentId, invoice_id }),
    }),
};

// Customer loyalty wallet. There is no endpoint here that takes a user id —
// the backend always resolves the account from the session.
export const loyaltyApi = {
    getWallet: () => apiRequest('/users/loyalty'),
    getTransactions: ({ page, limit, type } = {}) => {
        const query = new URLSearchParams();
        if (page) query.set('page', page);
        if (limit) query.set('limit', limit);
        if (type) query.set('type', type);
        const qs = query.toString();
        return apiRequest(`/users/loyalty/transactions${qs ? `?${qs}` : ''}`);
    },
};

// Customer store-credit wallet. Like `loyaltyApi`, no endpoint here takes a
// user id — the backend always resolves the account from the session, so there
// is no shape of request that reads or spends somebody else's balance.
export const walletApi = {
    get: () => apiRequest('/users/wallet'),
    getTransactions: ({ page, limit, type } = {}) => {
        const query = new URLSearchParams();
        if (page) query.set('page', page);
        if (limit) query.set('limit', limit);
        if (type) query.set('type', type);
        const qs = query.toString();
        return apiRequest(`/users/wallet/transactions${qs ? `?${qs}` : ''}`);
    },
    getTopups: ({ page, limit } = {}) => {
        const query = new URLSearchParams();
        if (page) query.set('page', page);
        if (limit) query.set('limit', limit);
        const qs = query.toString();
        return apiRequest(`/users/wallet/topups${qs ? `?${qs}` : ''}`);
    },
    /**
     * Start a top-up. `origin` and `return_path` are what bring the customer
     * back to where they were — a top-up begun from checkout returns to
     * checkout with the basket still there, not to the wallet page.
     */
    createTopup: ({ amount, origin, return_path }) => apiRequest('/users/wallet/topups', {
        method: 'POST',
        body: JSON.stringify({ amount, origin, return_path }),
    }),
    confirmTopup: ({ topupId, invoice_id }) => apiRequest('/users/wallet/topups/confirm', {
        method: 'POST',
        body: JSON.stringify({ topupId, invoice_id }),
    }),
};

export const adminWalletApi = {
    getSettings: () => apiRequest('/admin/wallet/settings'),
    updateSettings: (data) => apiRequest('/admin/wallet/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    getStats: () => apiRequest('/admin/wallet/stats'),
    getAccounts: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/wallet/accounts${qs ? `?${qs}` : ''}`);
    },
    getAccount: (userId, params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/wallet/accounts/${userId}${qs ? `?${qs}` : ''}`);
    },
    adjust: (userId, { amount, reason, direction }) => apiRequest(`/admin/wallet/accounts/${userId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ amount, reason, direction }),
    }),
    setStatus: (userId, { status, reason }) => apiRequest(`/admin/wallet/accounts/${userId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, reason }),
    }),
    getExceptions: () => apiRequest('/admin/wallet/exceptions'),
    // Re-verifies the invoice with the provider before crediting, so pressing
    // this on a row that was never actually paid is safe.
    retryException: (topupId) => apiRequest(`/admin/wallet/exceptions/${topupId}/retry`, {
        method: 'POST',
    }),
    getAudit: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/wallet/audit${qs ? `?${qs}` : ''}`);
    },
};

/**
 * Which gateway takes the money — Fawaterak or Paymob.
 *
 * `getSettings` returns the switch plus each provider's readiness, because the
 * switch cannot be moved to a provider whose keys are missing from the server's
 * `.env` and the screen has to be able to say why.
 */
export const adminPaymentsApi = {
    getSettings: () => apiRequest('/admin/payments/settings'),
    updateSettings: (data) => apiRequest('/admin/payments/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
};

export const adminLoyaltyApi = {
    getSettings: () => apiRequest('/admin/loyalty/settings'),
    updateSettings: (data) => apiRequest('/admin/loyalty/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    getStats: () => apiRequest('/admin/loyalty/stats'),
    getAccounts: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/loyalty/accounts${qs ? `?${qs}` : ''}`);
    },
    getAccount: (userId, params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/loyalty/accounts/${userId}${qs ? `?${qs}` : ''}`);
    },
    adjust: (userId, { points, reason, direction }) => apiRequest(`/admin/loyalty/accounts/${userId}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ points, reason, direction }),
    }),
    getAudit: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/loyalty/audit${qs ? `?${qs}` : ''}`);
    },
};

// Product reviews. The invite endpoints are public — the WhatsApp link opens
// straight into the form, with the single-use token as the credential.
export const reviewsApi = {
    getInvite: (token) => apiRequest(`/reviews/invite/${encodeURIComponent(token)}`),
    submit: (token, reviews) => apiRequest(`/reviews/invite/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify({ reviews }),
    }),
    getForProduct: (productId, { page, limit } = {}) => {
        const query = new URLSearchParams();
        if (page) query.set('page', page);
        if (limit) query.set('limit', limit);
        const qs = query.toString();
        return apiRequest(`/reviews/product/${productId}${qs ? `?${qs}` : ''}`);
    },
    getForVendor: (vendorId, { page, limit } = {}) => {
        const query = new URLSearchParams();
        if (page) query.set('page', page);
        if (limit) query.set('limit', limit);
        const qs = query.toString();
        return apiRequest(`/reviews/vendor/${vendorId}${qs ? `?${qs}` : ''}`);
    },
    // Sent as multipart, so it bypasses `apiRequest` — setting a JSON content-type here
    // would stop the browser writing the multipart boundary and the upload would fail.
    uploadImages: async (token, files) => {
        const form = new FormData();
        for (const file of files) form.append('images', file);
        const res = await fetch(`${BASE_URL}/reviews/invite/${encodeURIComponent(token)}/images`, {
            method: 'POST',
            body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const error = new Error(data.message || 'Upload failed');
            error.code = data.code;
            throw error;
        }
        return data.images || [];
    },
};

export const adminReviewsApi = {
    list: ({ status, target, page, limit } = {}) => {
        const query = new URLSearchParams();
        if (status) query.set('status', status);
        if (target) query.set('target', target);
        if (page) query.set('page', page);
        if (limit) query.set('limit', limit);
        const qs = query.toString();
        return apiRequest(`/admin/reviews${qs ? `?${qs}` : ''}`);
    },
    moderate: (id, { status, reason }) => apiRequest(`/admin/reviews/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status, reason }),
    }),
};

export const couponsApi = {
    validate: ({ code, items }) => apiRequest('/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({ code, items }),
    }),
};

export const contactApi = {
    submitInquiry: (data) => apiRequest('/contact', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
};

export const shippingApi = {
    // Zone picker tree + shipping config flags (public).
    getZones: () => apiRequest('/shipping/zones'),
    // Active shipping classes (public — used by the product forms).
    getClasses: () => apiRequest('/shipping/classes'),
    // Available shipping methods + costs for a cart and destination.
    getQuote: ({ items, destination }) => apiRequest('/shipping/quote', {
        method: 'POST',
        body: JSON.stringify({ items, destination }),
    }),
};

export const vendorApi = {
    getProfile: () => apiRequest('/vendors/profile'),
    updateProfile: (data) => apiRequest('/vendors/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    // The dashboard summary — sales, orders, returns, reviews, products,
    // earnings and the trend series — over `range`: 7d | 30d | 90d | 12m | all.
    getStats: (range) => apiRequest(`/vendors/stats${range ? `?range=${encodeURIComponent(range)}` : ''}`),
    getProducts: () => apiRequest('/vendors/products'),
    getProduct: (id) => apiRequest(`/vendors/products/${id}`),
    addProduct: (productData) => apiRequest('/vendors/products', {
        method: 'POST',
        body: JSON.stringify(productData),
    }),
    updateProduct: (id, productData) => apiRequest(`/vendors/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(productData),
    }),
    deleteProduct: (id) => apiRequest(`/vendors/products/${id}`, {
        method: 'DELETE',
    }),
    // ---- Bundles ----
    getBundles: () => apiRequest('/vendors/bundles'),
    getBundle: (id) => apiRequest(`/vendors/bundles/${id}`),
    getBundleEligibleProducts: () => apiRequest('/vendors/bundles/eligible-products'),
    addBundle: (data) => apiRequest('/vendors/bundles', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateBundle: (id, data) => apiRequest(`/vendors/bundles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteBundle: (id) => apiRequest(`/vendors/bundles/${id}`, {
        method: 'DELETE',
    }),
    getOrderCounts: () => apiRequest('/vendors/orders/counts'),
    getPickups: (params = {}) => {
        const query = new URLSearchParams();
        if (params.date) query.set('date', params.date);
        const qs = query.toString();
        return apiRequest(`/vendors/pickups${qs ? `?${qs}` : ''}`);
    },
    getOrders: (isRevised = false) => apiRequest(`/vendors/orders?revised=${isRevised}`),

    // ---- Parcels (sub-orders): the vendor's three-stage flow ----
    // Every action below saves on press. There is no submit step, so nothing a vendor has
    // already decided can be lost by navigating away.
    getSubOrders: (tab) => apiRequest(`/vendors/sub-orders${tab ? `?tab=${tab}` : ''}`),
    // A combined company order: every person's order in it, for packing and labels.
    getCompanyBatch: (batchId) => apiRequest(`/vendors/company-batches/${batchId}`),
    getSubOrder: (orderId, subOrderId) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}`),
    // Stage 1 — availability, item by item. Declining requires a reason: the website team
    // uses that exact text when they phone the customer.
    reviewSubOrderItem: (orderId, subOrderId, itemId, available, reason = '') =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/items/${itemId}`, {
            method: 'PUT',
            body: JSON.stringify({ available, reason }),
        }),
    // `confirm` makes the accept-everything press also leave stage 1, so the vendor who has
    // the whole parcel in stock never has to press twice.
    approveAllSubOrderItems: (orderId, subOrderId, confirm = false) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/approve-all`, {
            method: 'POST',
            body: JSON.stringify({ confirm }),
        }),
    // The whole parcel refused with one reason, which parks it with the website team.
    declineAllSubOrderItems: (orderId, subOrderId, reason) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/decline-all`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
        }),
    confirmSubOrderItems: (orderId, subOrderId) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/confirm-items`, { method: 'POST' }),
    // Stage 2 — scan a Smart Label, or acknowledge the waybill Bosta already minted.
    assignSubOrderTracking: (orderId, subOrderId, trackingNumber = null) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/tracking`, {
            method: 'POST',
            body: JSON.stringify({ tracking_number: trackingNumber }),
        }),
    // Stage 2, the other route: no sticker, so Bosta mints the number and the waybill is
    // printed. Sits beside scanning rather than replacing it.
    createSubOrderShipment: (orderId, subOrderId) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/shipment`, { method: 'POST' }),
    getSubOrderAWB: (orderId, subOrderId) =>
        apiRequestBlob(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/awb`),
    // Stage 3 — photograph the sealed parcel, then hand it over.
    addSubOrderPhotos: (orderId, subOrderId, urls) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/photos`, {
            method: 'POST',
            body: JSON.stringify({ urls }),
        }),
    removeSubOrderPhoto: (orderId, subOrderId, photoId) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/photos/${photoId}`, {
            method: 'DELETE',
        }),
    markSubOrderReady: (orderId, subOrderId) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/ready`, { method: 'POST' }),
    // Stage 4 — the vendor confirms a Bosta courier actually took the parcel. Until this or
    // Bosta's own webhook says so, nothing may claim the parcel left the store.
    confirmSubOrderHandover: (orderId, subOrderId) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/handover`, { method: 'POST' }),
    // A request, never an action — and only while no courier is booked.
    requestSubOrderCancel: (orderId, subOrderId, reason) =>
        apiRequest(`/vendors/orders/${orderId}/sub-orders/${subOrderId}/cancel-request`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
        }),
    updateOrderStatus: (orderId, itemsData, fulfillment_location) => apiRequest(`/vendors/orders/${orderId}`, {
        method: 'PUT',
        body: JSON.stringify({ items: itemsData, fulfillment_location }),
    }),
    // ---- Smart Label (scan a pre-printed Bosta label onto this vendor's parcel) ----
    scanSmartLabel: (orderId, trackingNumber) => apiRequest(`/vendors/orders/${orderId}/smart-label`, {
        method: 'POST',
        body: JSON.stringify({ tracking_number: trackingNumber }),
    }),
    unlinkSmartLabel: (orderId) => apiRequest(`/vendors/orders/${orderId}/smart-label`, {
        method: 'DELETE',
    }),
    getPublicStore: (username, queryParams = {}) => {
        const params = new URLSearchParams();
        Object.entries(queryParams).forEach(([key, value]) => {
            if (value) params.set(key, value);
        });
        // Encoded here: usernames may carry spaces, "#" or Arabic (see lib/storeLink.js).
        return apiRequest(`/vendors/public/${encodeURIComponent(String(username || ''))}?${params.toString()}`);
    },
    getPublicVendors: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/vendors/public${qs ? `?${qs}` : ''}`);
    },
    bulkUploadProducts: async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const url = `${BASE_URL}/vendors/products/bulk-upload`;
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            body: formData,
            // Do NOT set Content-Type; browser sets it with the correct multipart boundary
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Bulk upload failed');
        return data;
    },
    // For downloadFile.
    bulkTemplateUrl: (lang = 'en') => `${BASE_URL}/vendors/products/bulk-template?lang=${lang === 'ar' ? 'ar' : 'en'}`,
    // The sales report: { from, to, status } — rows per parcel and totals; and as Excel.
    getSalesReport: (params = {}) => apiRequest(`/vendors/reports/sales?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
    salesReportUrl: (params = {}) => `${BASE_URL}/vendors/reports/sales/export?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`,
    bulkCreateProducts: (products) => apiRequest('/vendors/products/bulk-json', {
        method: 'POST',
        body: JSON.stringify({ products }),
    }),
    // Parse an .xlsx and get a proposed catalog entry per row — nothing is saved.
    // The confirmed rows are then posted through bulkCreateProducts.
    previewBulkUpload: async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${BASE_URL}/vendors/products/bulk-upload/preview`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Could not read the file');
        return data;
    },
    // Save the rows the vendor confirmed on the review screen.
    saveReviewedBulkUpload: (products) => apiRequest('/vendors/products/bulk-upload/save', {
        method: 'POST',
        body: JSON.stringify({ products }),
        // A few hundred rows each hitting slug generation and validation is well
        // past the default 30s.
        timeoutMs: 180000,
    }),
    getSettings: () => apiRequest('/settings'),
    getCategories: () => apiRequest('/products/categories'),

    /* ---- Packaging and labels the vendor buys from the store ---- */
    getSuppliesCatalogue: () => apiRequest('/vendors/supplies/catalogue'),
    getSupplyOrders: ({ page, limit } = {}) => {
        const query = new URLSearchParams();
        if (page) query.set('page', page);
        if (limit) query.set('limit', limit);
        const qs = query.toString();
        return apiRequest(`/vendors/supplies/orders${qs ? `?${qs}` : ''}`);
    },
    placeSupplyOrder: (payload) => apiRequest('/vendors/supplies/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
    }),
    paySupplyOrder: (id) => apiRequest(`/vendors/supplies/orders/${id}/pay`, { method: 'POST' }),
    // Back from the payment page: the server re-reads the payment from the provider.
    confirmSupplyPayment: (id) => apiRequest(`/vendors/supplies/orders/${id}/confirm-payment`, { method: 'POST' }),
    cancelSupplyOrder: (id, reason) => apiRequest(`/vendors/supplies/orders/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
    }),
};

/**
 * Master catalog, as the vendor sees it: search, and read one entry. There is
 * deliberately nothing here that creates or edits an entry — a vendor's "add a
 * new product" goes through the ordinary product endpoints, and the suggestion
 * it produces is created server-side.
 */
export const catalogApi = {
    search: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/vendors/catalog/search${qs ? `?${qs}` : ''}`);
    },
    getEntry: (id) => apiRequest(`/vendors/catalog/${id}`),
    // The categories and brands the catalog actually holds — so no choice in the
    // filter dropdowns can come back empty.
    // Pass the current selection and each list narrows to fit the other one.
    filters: (params = {}) => {
        const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
        return apiRequest(`/vendors/catalog/filters${qs ? `?${qs}` : ''}`);
    },
};

export const pagesApi = {
    getPageBySlug: (slug) => apiRequest(`/pages/${slug}`),
};

export const servicesApi = {
    getServices: (queryParams = {}) => {
        const params = new URLSearchParams();
        Object.entries(queryParams).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') params.set(key, value);
        });
        const query = params.toString();
        return apiRequest(`/services${query ? `?${query}` : ''}`);
    },
    getFeaturedServices: (limit = 6) => apiRequest(`/services/featured?limit=${limit}`),
    getBannerAdServices: (limit = 6) => apiRequest(`/services/banner-ads?limit=${limit}`),
    getServiceBySlug: (slug) => apiRequest(`/services/slug/${slug}`),
};

export const adminApi = {
    // The dashboard's front page: a few numbers per section (services/adminOverviewService.js).
    getOverview: () => apiRequest('/admin/overview'),
    // Customer reports (Backend services/customerReportsService.js): products in carts, and
    // customers' cars by make — each also as an Excel file.
    getCartReport: (params = {}) => apiRequest(`/admin/users/reports/carts?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
    cartReportUrl: (params = {}) => `${BASE_URL}/admin/users/reports/carts/export?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`,
    getCarsReport: (params = {}) => apiRequest(`/admin/users/reports/cars?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
    carsReportUrl: (params = {}) => `${BASE_URL}/admin/users/reports/cars/export?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`,
    getCartReminderReport: (params = {}) => apiRequest(`/admin/users/reports/cart-reminders?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
    cartReminderReportUrl: (params = {}) => `${BASE_URL}/admin/users/reports/cart-reminders/export?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`,
    getCartReminderPreview: (id) => apiRequest(`/admin/users/reports/cart-reminders/${id}/preview`),
    getCartReminderSettings: () => apiRequest('/admin/users/reports/cart-reminders/settings'),
    updateCartReminderSettings: (data) => apiRequest('/admin/users/reports/cart-reminders/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    /* ---- Targeted Car Email Campaigns ---- */
    getCarCampaignAudience: (params = {}) => apiRequest(`/admin/car-campaigns/audience?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
    getCarCampaignRecommendations: (params = {}) => apiRequest(`/admin/car-campaigns/recommendations?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
    previewCarCampaignHtml: (data) => apiRequest('/admin/car-campaigns/preview-html', { method: 'POST', body: JSON.stringify(data) }),
    sendCarCampaignTest: (data) => apiRequest('/admin/car-campaigns/test', { method: 'POST', body: JSON.stringify(data) }),
    createCarCampaign: (data) => apiRequest('/admin/car-campaigns', { method: 'POST', body: JSON.stringify(data) }),
    getCarCampaigns: (params = {}) => apiRequest(`/admin/car-campaigns?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
    getCarCampaignById: (id) => apiRequest(`/admin/car-campaigns/${id}`),
    getUsers: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/users${qs ? `?${qs}` : ''}`);
    },
    getUserById: (id) => apiRequest(`/admin/users/${id}`),
    getUserDeleteImpact: (id, options = {}) => apiRequest(`/admin/users/${id}/delete-impact`, options),
    hardDeleteUser: (id, confirm) => apiRequest(`/admin/users/${id}/hard`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm }),
        timeoutMs: 45000,
    }),
    /* ---- Packaging and labels: the catalogue and the vendor orders against it ---- */
    getSuppliesCatalogue: () => apiRequest('/admin/supplies/catalogue'),
    addSupplyProduct: (data) => apiRequest('/admin/supplies/catalogue', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateSupplyProduct: (id, data) => apiRequest(`/admin/supplies/catalogue/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteSupplyProduct: (id) => apiRequest(`/admin/supplies/catalogue/${id}`, { method: 'DELETE' }),
    getSupplyOrders: ({ status, payment_status, vendor_id, page, limit } = {}) => {
        const query = new URLSearchParams();
        if (status) query.set('status', status);
        if (payment_status) query.set('payment_status', payment_status);
        if (vendor_id) query.set('vendor_id', vendor_id);
        if (page) query.set('page', page);
        if (limit) query.set('limit', limit);
        const qs = query.toString();
        return apiRequest(`/admin/supplies/orders${qs ? `?${qs}` : ''}`);
    },
    updateSupplyOrder: (id, data) => apiRequest(`/admin/supplies/orders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    // "The vendor says they paid" — ask the provider and settle if it is true.
    recheckSupplyPayment: (id) => apiRequest(`/admin/supplies/orders/${id}/recheck-payment`, { method: 'POST' }),

    getVendors: () => apiRequest('/admin/vendors'),
    getVendorDeleteImpact: (id, options = {}) => apiRequest(`/admin/vendors/${id}/delete-impact`, options),
    hardDeleteVendor: (id, confirm) => apiRequest(`/admin/vendors/${id}/hard`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm }),
        timeoutMs: 45000,
    }),
    getPendingVerifications: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/verifications${qs ? `?${qs}` : ''}`);
    },
    verifyPendingAccount: (id) => apiRequest(`/admin/verifications/${id}/verify`, {
        method: 'POST',
    }),
    getServices: () => apiRequest('/admin/services'),
    getServiceById: (id) => apiRequest(`/admin/services/${id}`),
    addService: (serviceData) => apiRequest('/admin/services', {
        method: 'POST',
        body: JSON.stringify(serviceData),
    }),
    updateService: (id, serviceData) => apiRequest(`/admin/services/${id}`, {
        method: 'PUT',
        body: JSON.stringify(serviceData),
    }),
    deleteService: (id) => apiRequest(`/admin/services/${id}`, {
        method: 'DELETE',
    }),
    addVendor: (vendorData) => apiRequest('/admin/vendors', {
        method: 'POST',
        body: JSON.stringify(vendorData),
    }),
    updateVendor: (id, vendorData) => apiRequest(`/admin/vendors/${id}`, {
        method: 'PUT',
        body: JSON.stringify(vendorData),
    }),
    uploadVendorStoreImage: async (id, file) => {
        const formData = new FormData();
        formData.append('store_image', file);
        const response = await fetch(`${BASE_URL}/admin/vendors/${id}/store-image`, {
            method: 'PUT',
            body: formData,
            credentials: 'include',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Upload failed');
        return data;
    },
    updateVendorStatus: (id, status) => apiRequest(`/admin/vendors/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
    }),
    // Accepts either the old plain status string (a few screens still want the
    // FULL matching set — the coupon product picker, the pending-review queue) or
    // a params object for the paginated, filtered admin product list.
    getProducts: (statusOrParams) => {
        if (!statusOrParams || typeof statusOrParams === 'string') {
            return apiRequest(statusOrParams ? `/admin/products?status=${statusOrParams}` : '/admin/products');
        }
        const query = new URLSearchParams();
        Object.entries(statusOrParams).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/products${qs ? `?${qs}` : ''}`);
    },
    // Permanent. Orders keep their frozen copies of the product; carts and bundles lose it.
    deleteProductAdmin: (id) => apiRequest(`/admin/products/${id}`, { method: 'DELETE' }),
    getPages: () => apiRequest('/admin/pages'),
    updatePage: (id, data) => apiRequest(`/admin/pages/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    }),
    getProduct: (id) => apiRequest(`/admin/products/${id}`),
    getFilterMetadata: (parts = null, { detail = 'slim' } = {}) => {
        const qs = new URLSearchParams();
        if (parts?.length) qs.set('parts', parts.join(','));
        // Slim leaves out every car make's models and years (1.9MB); only the product
        // forms ask for those.
        if (detail === 'full') qs.set('detail', 'full');
        const query = qs.toString();
        return apiRequest(`/products/filters${query ? `?${query}` : ''}`);
    },
    updateProduct: (id, productData) => apiRequest(`/admin/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(productData),
    }),
    approveProduct: (id) => apiRequest(`/admin/products/${id}/approve`, {
        method: 'PUT',
    }),
    rejectProduct: (id) => apiRequest(`/admin/products/${id}/reject`, {
        method: 'PUT',
    }),
    // ---- Review of waiting products (the "Pending approval" screen) ----
    // Every waiting product, slim, with the problems found on it (`issues`).
    getReviewQueue: () => apiRequest('/admin/products/review-queue'),
    // Publish many at once; each vendor gets one notice.
    approveProducts: (ids) => apiRequest('/admin/products/review/approve', { method: 'POST', body: JSON.stringify({ ids }) }),
    // One correction on many: { ids, set: { category_id?, part_type?, fitment? }, publish? }.
    bulkFixProducts: (payload) => apiRequest('/admin/products/review/bulk', { method: 'POST', body: JSON.stringify(payload) }),
    // ---- Bundle moderation ----
    getBundles: (status) => apiRequest(status ? `/admin/bundles?status=${status}` : '/admin/bundles'),
    approveBundle: (id) => apiRequest(`/admin/bundles/${id}/approve`, { method: 'PUT' }),
    rejectBundle: (id) => apiRequest(`/admin/bundles/${id}/reject`, { method: 'PUT' }),
    getSettings: () => apiRequest('/settings'),
    updateSettings: (data) => apiRequest('/admin/settings', { method: 'PUT', body: JSON.stringify(data) }),
    addProduct: (productData) => apiRequest('/admin/products', {
        method: 'POST',
        body: JSON.stringify(productData),
    }),
    bulkUploadProducts: async (vendorId, file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('vendor_id', vendorId);
        const url = `${BASE_URL}/admin/products/bulk-upload`;
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Bulk upload failed');
        return data;
    },
    // For downloadFile.
    bulkTemplateUrl: (lang = 'en') => `${BASE_URL}/admin/products/bulk-template?lang=${lang === 'ar' ? 'ar' : 'en'}`,
    bulkCreateProducts: (vendorId, products) => apiRequest('/admin/products/bulk-json', {
        method: 'POST',
        body: JSON.stringify({ vendor_id: vendorId, products }),
    }),
    getOrders: (params = {}) => {
        const params2 = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') params2.set(key, value);
        });
        const qs = params2.toString();
        return apiRequest(`/admin/orders${qs ? `?${qs}` : ''}`);
    },
    getOrderById: (id) => apiRequest(`/admin/orders/${id}`),
    // outcome: 'confirmed' | 'no_answer' | 'refused'
    recordCustomerConfirmation: (id, outcome, note = '') => apiRequest(`/admin/orders/${id}/customer-confirmation`, {
        method: 'POST',
        body: JSON.stringify({ outcome, note }),
    }),
    getVendorsForFilter: () => apiRequest('/admin/orders/vendors'),
    updateOrderStatus: (id, status) => apiRequest(`/admin/orders/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
    }),
    updateOrderItems: (id, items, fulfillment_locations) => apiRequest(`/admin/orders/${id}/items`, {
        method: 'PUT',
        body: JSON.stringify({ items, fulfillment_locations }),
    }),
    replaceOrderItem: (id, itemId, data) => apiRequest(`/admin/orders/${id}/items/${itemId}/replace`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteOrderItem: (id, itemId) => apiRequest(`/admin/orders/${id}/items/${itemId}`, {
        method: 'DELETE',
    }),
    lockOrderForFulfillment: (id) => apiRequest(`/admin/orders/${id}/lock`, {
        method: 'POST',
    }),
    deleteOrder: (id, { cancelAtCourier = false } = {}) => apiRequest(`/admin/orders/${id}${cancelAtCourier ? '?courier=1' : ''}`, {
        method: 'DELETE',
    }),
    getVendorLocations: (id) => apiRequest(`/admin/orders/${id}/vendor-locations`),
    updateFulfillmentLocations: (id, locations) => apiRequest(`/admin/orders/${id}/fulfillment-locations`, {
        method: 'PUT',
        body: JSON.stringify({ locations }),
    }),
    refreshTracking: (id) => apiRequest(`/admin/orders/${id}/refresh-tracking`, {
        method: 'POST',
    }),
    // Answers with the AWB PDF itself, not a link.
    getShipmentAWB: (orderId, shipmentId) => apiRequestBlob(`/admin/orders/${orderId}/shipments/${shipmentId}/awb`),

    // ---- Parcels (sub-orders) ----
    // Every parcel waiting on the website team, across all orders — the single queue an admin
    // works from: declines, overdue vendors, exceptions and cancellation requests.
    getSubOrdersNeedingAttention: () => apiRequest('/admin/sub-orders/attention'),
    // Rescue path for a vendor who cannot act.
    dispatchSubOrder: (orderId, subOrderId) =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/dispatch`, { method: 'POST' }),
    // Hand a parked parcel back once the declined items are dealt with.
    releaseSubOrder: (orderId, subOrderId, note = '') =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/release`, {
            method: 'POST',
            body: JSON.stringify({ note }),
        }),
    // Refunds this parcel's own frozen share and terminates its Bosta delivery. Siblings
    // are untouched.
    cancelSubOrder: (orderId, subOrderId, reason) =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
        }),
    // ---- Couriers ----
    getCouriers: () => apiRequest('/admin/couriers'),
    transferSubOrderCourier: (orderId, subOrderId, data) =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/transfer-courier`, {
            method: 'POST', body: JSON.stringify(data),
        }),
    syncArriveSectors: () => apiRequest('/admin/couriers/arrive/sectors/sync', { method: 'POST' }),
    searchArriveSectors: (q) => apiRequest(`/admin/couriers/arrive/sectors?q=${encodeURIComponent(q || '')}`),
    // Per-parcel courier (null = default) and, for Arrive, the delivery area.
    setSubOrderCourier: (orderId, subOrderId, courier, sectorId) =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/courier`, {
            method: 'PUT',
            body: JSON.stringify({ courier, ...(sectorId !== undefined ? { sector_id: sectorId } : {}) }),
        }),
    // The admin cancelled the waybill in the courier portal by hand.
    courierCancelDone: (orderId, subOrderId) =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/courier-cancel-done`, { method: 'POST' }),
    // A send whose outcome was unknown: attach the waybill found in the portal, or clear it.
    resolveDispatch: (orderId, subOrderId, trackingNumber = '') =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/resolve-dispatch`, {
            method: 'POST',
            body: JSON.stringify({ tracking_number: trackingNumber }),
        }),
    // Reverses a cancellation: charges the refund back, takes the points back, restores a
    // dropped coupon, retires the dead Bosta delivery and puts the parcel back with the vendor.
    reactivateSubOrder: (orderId, subOrderId, reason) =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/reactivate`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
        }),
    // Every cancelled parcel on the order, through the same path.
    reactivateOrder: (orderId, reason) =>
        apiRequest(`/admin/orders/${orderId}/reactivate`, {
            method: 'POST',
            body: JSON.stringify({ reason }),
        }),
    // The waybill is on the box: move a parcel that already has a shipment past the label
    // stage (the vendor's "It is attached — continue", from the admin side). A sticker
    // number is optional and links to the existing shipment.
    confirmSubOrderWaybill: (orderId, subOrderId, trackingNumber = null) =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/tracking`, {
            method: 'POST',
            body: JSON.stringify({ tracking_number: trackingNumber }),
        }),
    // Stage ③ on the vendor's behalf: sealed and waiting for a courier. This is what puts
    // the parcel on the Pickups screen as bookable.
    markSubOrderReady: (orderId, subOrderId) =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/ready`, { method: 'POST' }),
    // Narrow by design: delivered / returned / cancelled only, always with a reason.
    setSubOrderStatus: (orderId, subOrderId, status, reason) =>
        apiRequest(`/admin/orders/${orderId}/sub-orders/${subOrderId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status, reason }),
        }),

    // ---- Smart Label (admin rescue: scan or release on a vendor's behalf) ----
    scanSmartLabel: (orderId, vendorId, trackingNumber) => apiRequest(`/admin/orders/${orderId}/smart-labels`, {
        method: 'POST',
        body: JSON.stringify({ vendor_id: vendorId, tracking_number: trackingNumber }),
    }),
    unlinkSmartLabel: (orderId, vendorId) => apiRequest(`/admin/orders/${orderId}/smart-labels/${vendorId}`, {
        method: 'DELETE',
    }),

    // Bosta pickup management
    getBostaLocations: () => apiRequest('/admin/bosta/locations'),
    getPickups: (params = {}) => {
        const query = new URLSearchParams();
        if (params.date) query.set('date', params.date);
        if (params.vendor_id) query.set('vendor_id', params.vendor_id);
        if (params.status) query.set('status', params.status);
        if (params.page) query.set('page', params.page);
        if (params.limit) query.set('limit', params.limit);
        const qs = query.toString();
        return apiRequest(`/admin/bosta/pickups${qs ? `?${qs}` : ''}`);
    },
    schedulePickup: (data) => apiRequest('/admin/bosta/pickups', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    cancelPickup: (pickupId) => apiRequest(`/admin/bosta/pickups/${pickupId}`, {
        method: 'DELETE',
    }),
    refreshPickup: (pickupId) => apiRequest(`/admin/bosta/pickups/${pickupId}/refresh`, {
        method: 'POST',
    }),
    reschedulePickup: (pickupId, data) => apiRequest(`/admin/bosta/pickups/${pickupId}/reschedule`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    getPickupSummary: (date) => apiRequest(`/admin/bosta/pickup-summary${date ? `?date=${date}` : ''}`),

    getCoupons: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/coupons${qs ? `?${qs}` : ''}`);
    },
    getCouponById: (id) => apiRequest(`/admin/coupons/${id}`),
    addCoupon: (couponData) => apiRequest('/admin/coupons', {
        method: 'POST',
        body: JSON.stringify(couponData),
    }),
    updateCoupon: (id, couponData) => apiRequest(`/admin/coupons/${id}`, {
        method: 'PUT',
        body: JSON.stringify(couponData),
    }),
    deleteCoupon: (id) => apiRequest(`/admin/coupons/${id}`, {
        method: 'DELETE',
    }),

    getCategoriesAdmin: () => apiRequest('/admin/categories'),
    addCategoryAdmin: (data) => apiRequest('/admin/categories', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateCategoryAdmin: (id, data) => apiRequest(`/admin/categories/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteCategoryAdmin: (id) => apiRequest(`/admin/categories/${id}`, {
        method: 'DELETE',
    }),

    // Product types: shopper-facing groupings of categories (managed with the categories).
    getProductTypesAdmin: () => apiRequest('/admin/categories/types'),
    addProductTypeAdmin: (data) => apiRequest('/admin/categories/types', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateProductTypeAdmin: (id, data) => apiRequest(`/admin/categories/types/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteProductTypeAdmin: (id) => apiRequest(`/admin/categories/types/${id}`, {
        method: 'DELETE',
    }),

    getCarBrandsAdmin: () => apiRequest('/admin/car-brands'),
    addCarBrandAdmin: (data) => apiRequest('/admin/car-brands', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateCarBrandAdmin: (id, data) => apiRequest(`/admin/car-brands/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteCarBrandAdmin: (id) => apiRequest(`/admin/car-brands/${id}`, {
        method: 'DELETE',
    }),

    getProductBrandsAdmin: () => apiRequest('/admin/product-brands'),
    addProductBrandAdmin: (data) => apiRequest('/admin/product-brands', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateProductBrandAdmin: (id, data) => apiRequest(`/admin/product-brands/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteProductBrandAdmin: (id) => apiRequest(`/admin/product-brands/${id}`, {
        method: 'DELETE',
    }),

    // --- Tickets ---
    getTickets: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/tickets${qs ? `?${qs}` : ''}`);
    },
    getTicketById: (id) => apiRequest(`/admin/tickets/${id}`),
    startVendorConversation: (data) => apiRequest('/admin/tickets', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateTicket: (id, data) => apiRequest(`/admin/tickets/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    replyToTicket: (id, content) => apiRequest(`/admin/tickets/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
    }),

    // --- Contact Inquiries ---
    getContactInquiries: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/contact-inquiries${qs ? `?${qs}` : ''}`);
    },
    getContactInquiryById: (id) => apiRequest(`/admin/contact-inquiries/${id}`),
    updateContactInquiry: (id, data) => apiRequest(`/admin/contact-inquiries/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),

    // --- Shipping: Zones ---
    getShippingZones: () => apiRequest('/admin/shipping/zones'),
    getShippingZone: (id) => apiRequest(`/admin/shipping/zones/${id}`),
    addShippingZone: (data) => apiRequest('/admin/shipping/zones', { method: 'POST', body: JSON.stringify(data) }),
    updateShippingZone: (id, data) => apiRequest(`/admin/shipping/zones/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteShippingZone: (id) => apiRequest(`/admin/shipping/zones/${id}`, { method: 'DELETE' }),

    // --- Shipping: Classes ---
    getShippingClasses: () => apiRequest('/admin/shipping/classes'),
    getShippingClass: (id) => apiRequest(`/admin/shipping/classes/${id}`),
    addShippingClass: (data) => apiRequest('/admin/shipping/classes', { method: 'POST', body: JSON.stringify(data) }),
    updateShippingClass: (id, data) => apiRequest(`/admin/shipping/classes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteShippingClass: (id) => apiRequest(`/admin/shipping/classes/${id}`, { method: 'DELETE' }),

    // --- Shipping: Methods ---
    getShippingMethods: (zoneId) => apiRequest(`/admin/shipping/methods${zoneId ? `?zone_id=${zoneId}` : ''}`),
    getShippingMethod: (id) => apiRequest(`/admin/shipping/methods/${id}`),
    addShippingMethod: (data) => apiRequest('/admin/shipping/methods', { method: 'POST', body: JSON.stringify(data) }),
    updateShippingMethod: (id, data) => apiRequest(`/admin/shipping/methods/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteShippingMethod: (id) => apiRequest(`/admin/shipping/methods/${id}`, { method: 'DELETE' }),

    // --- Shipping: Policies ---
    getShippingPolicies: () => apiRequest('/admin/shipping/policies'),
    getShippingPolicy: (id) => apiRequest(`/admin/shipping/policies/${id}`),
    addShippingPolicy: (data) => apiRequest('/admin/shipping/policies', { method: 'POST', body: JSON.stringify(data) }),
    updateShippingPolicy: (id, data) => apiRequest(`/admin/shipping/policies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteShippingPolicy: (id) => apiRequest(`/admin/shipping/policies/${id}`, { method: 'DELETE' }),

    // --- Shipping: Settings & test ---
    // --- Cash on delivery: who is allowed to pay at the door ---
    // `refresh` re-reads the customer's ranking from Bosta instead of the cached one.
    getOrderCodProfile: (orderId, refresh = false) =>
        apiRequest(`/admin/orders/${orderId}/cod-profile${refresh ? '?refresh=true' : ''}`),
    setUserCodOverride: (userId, data) => apiRequest(`/admin/users/${userId}/cod-override`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    getCodPolicy: () => apiRequest('/admin/wallet/cod-policy'),
    updateCodPolicy: (data) => apiRequest('/admin/wallet/cod-policy', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),

    getShippingSettings: () => apiRequest('/admin/shipping/settings'),
    updateShippingSettings: (data) => apiRequest('/admin/shipping/settings', { method: 'PUT', body: JSON.stringify(data) }),
    testShippingCalculation: (payload) => apiRequest('/admin/shipping/test', { method: 'POST', body: JSON.stringify(payload) }),

    // --- Admin accounts (super admin only; the server refuses these to sub-admins) ---
    getAdminUsers: () => apiRequest('/admin/admin-users'),
    getAdminModules: () => apiRequest('/admin/admin-users/modules'),
    createAdminUser: (data) => apiRequest('/admin/admin-users', { method: 'POST', body: JSON.stringify(data) }),
    updateAdminUser: (id, data) => apiRequest(`/admin/admin-users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteAdminUser: (id) => apiRequest(`/admin/admin-users/${id}`, { method: 'DELETE' }),

    // --- Shipping: subsidy report (collected from customers vs billed by Bosta) ---
    getShippingSubsidy: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v) query.set(k, v); });
        const qs = query.toString();
        return apiRequest(`/admin/shipping/subsidy${qs ? `?${qs}` : ''}`);
    },

    // --- Articles ---
    getArticles: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/articles${qs ? `?${qs}` : ''}`);
    },
    getArticleById: (id) => apiRequest(`/admin/articles/${id}`),
    addArticle: (data) => apiRequest('/admin/articles', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateArticle: (id, data) => apiRequest(`/admin/articles/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteArticle: (id) => apiRequest(`/admin/articles/${id}`, {
        method: 'DELETE',
    }),
};

// Ticket API for vendors and users
export const ticketApi = {
    createTicket: (data) => apiRequest('/tickets', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    getTickets: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/tickets${qs ? `?${qs}` : ''}`);
    },
    getTicketById: (id) => apiRequest(`/tickets/${id}`),
    replyToTicket: (id, content) => apiRequest(`/tickets/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
    }),
};

// Vendor Subscription API
export const subscriptionApi = {
    checkFreeTrial: () => apiRequest('/vendors/subscription/free-trial'),
    getStatus: () => apiRequest('/vendors/subscription/status'),
    getPackages: () => apiRequest('/vendors/subscription/packages'),
    purchase: (packageId, billing_period) => apiRequest('/vendors/subscription/purchase', {
        method: 'POST',
        body: JSON.stringify({ packageId, billing_period }),
    }),
    renew: (billing_period) => apiRequest('/vendors/subscription/renew', {
        method: 'POST',
        body: JSON.stringify({ billing_period }),
    }),
    resubscribe: (packageId, billing_period, selectedProductIds) => apiRequest('/vendors/subscription/resubscribe', {
        method: 'POST',
        body: JSON.stringify({ packageId, billing_period, selectedProductIds }),
    }),
    changePlan: (packageId, billing_period, selectedProductIds) => apiRequest('/vendors/subscription/change-plan', {
        method: 'POST',
        body: JSON.stringify({ packageId, billing_period, selectedProductIds }),
    }),
    confirmPayment: ({ paymentId, invoice_id }) => apiRequest('/vendors/subscription/confirm-payment', {
        method: 'POST',
        body: JSON.stringify({ paymentId, invoice_id }),
    }),
};

// Vendor Notifications API
export const notificationsApi = {
    getAll: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/vendors/notifications${qs ? `?${qs}` : ''}`);
    },
    getCount: () => apiRequest('/vendors/notifications/count'),
    markAsRead: (id) => apiRequest(`/vendors/notifications/${id}/read`, {
        method: 'PUT',
    }),
    markAllAsRead: () => apiRequest('/vendors/notifications/read-all', {
        method: 'PUT',
    }),
    deleteNotification: (id) => apiRequest(`/vendors/notifications/${id}`, {
        method: 'DELETE',
    }),
};

// Admin Subscription API
export const adminSubscriptionApi = {
    // Whole-collection statistics. The page used to add up whatever rows the
    // paginated list returned, which made every card a per-page figure.
    getStats: () => apiRequest('/admin/subscriptions/stats'),
    getPackages: () => apiRequest('/admin/subscription-packages'),
    getPackageById: (id) => apiRequest(`/admin/subscription-packages/${id}`),
    createPackage: (data) => apiRequest('/admin/subscription-packages', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updatePackage: (id, data) => apiRequest(`/admin/subscription-packages/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deletePackage: (id) => apiRequest(`/admin/subscription-packages/${id}`, {
        method: 'DELETE',
    }),
    togglePackageStatus: (id) => apiRequest(`/admin/subscription-packages/${id}/status`, {
        method: 'PUT',
    }),
    getAllSubscriptions: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/subscriptions${qs ? `?${qs}` : ''}`);
    },
    getSubscriptionPayments: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/subscription-payments${qs ? `?${qs}` : ''}`);
    },
    getVendorSubscription: (vendorId) => apiRequest(`/admin/vendors/${vendorId}/subscription`),
    cancelVendorSubscription: (vendorId) => apiRequest(`/admin/vendors/${vendorId}/subscription/cancel`, {
        method: 'PUT',
    }),
    grantVendorSubscription: (vendorId, data) => apiRequest(`/admin/vendors/${vendorId}/subscription/grant`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    suspendVendor: (vendorId, reason) => apiRequest(`/admin/vendors/${vendorId}/suspend`, {
        method: 'PUT',
        body: JSON.stringify({ reason }),
    }),
    updateVendorStatus: (id, status, reason) => apiRequest(`/admin/vendors/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status, reason }),
    }),
    getNotSubscribedVendors: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/vendors/not-subscribed${qs ? `?${qs}` : ''}`);
    },
};

// ======================== RETURNS API (Customer) ========================
export const returnsApi = {
    create: (data) => apiRequest('/returns', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    getAll: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/returns${qs ? `?${qs}` : ''}`);
    },
    getById: (id) => apiRequest(`/returns/${id}`),
    cancel: (id) => apiRequest(`/returns/${id}/cancel`, { method: 'POST' }),
    getTracking: (id) => apiRequest(`/returns/${id}/tracking`),
};

// ======================== VENDOR RETURNS API ========================
export const vendorReturnsApi = {
    getAll: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/vendors/returns${qs ? `?${qs}` : ''}`);
    },
    getCounts: () => apiRequest('/vendors/returns/counts'),
    getById: (id) => apiRequest(`/vendors/returns/${id}`),
    review: (id, data) => apiRequest(`/vendors/returns/${id}/review`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    confirmReceipt: (id) => apiRequest(`/vendors/returns/${id}/confirm-receipt`, {
        method: 'POST',
    }),
};

// ======================== ADMIN RETURNS & REFUNDS API ========================
export const adminReturnsApi = {
    getAll: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/returns${qs ? `?${qs}` : ''}`);
    },
    getCounts: () => apiRequest('/admin/returns/counts'),
    getAnalytics: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/returns/analytics${qs ? `?${qs}` : ''}`);
    },
    getById: (id) => apiRequest(`/admin/returns/${id}`),
    review: (id, data) => apiRequest(`/admin/returns/${id}/review`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    ship: (id) => apiRequest(`/admin/returns/${id}/ship`, { method: 'POST' }),
    confirmReceipt: (id) => apiRequest(`/admin/returns/${id}/confirm-receipt`, { method: 'POST' }),
    refreshTracking: (id) => apiRequest(`/admin/returns/${id}/refresh-tracking`, { method: 'POST' }),
    createRefund: (id, data) => apiRequest(`/admin/returns/${id}/refund`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    // Refunds
    getRefunds: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/refunds${qs ? `?${qs}` : ''}`);
    },
    getRefundById: (id) => apiRequest(`/admin/refunds/${id}`),
    processRefund: (id) => apiRequest(`/admin/refunds/${id}/process`, { method: 'POST' }),
    completeRefund: (id, data) => apiRequest(`/admin/refunds/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    failRefund: (id, data) => apiRequest(`/admin/refunds/${id}/fail`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
};

// ======================== VENDOR WALLET & WITHDRAWALS API ========================
export const vendorWalletApi = {
    getWallet: () => apiRequest('/vendors/wallet'),
    getEarnings: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/vendors/wallet/earnings${qs ? `?${qs}` : ''}`);
    },
    getWithdrawals: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/vendors/wallet/withdrawals${qs ? `?${qs}` : ''}`);
    },
    createWithdrawal: (data) => apiRequest('/vendors/wallet/withdrawals', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    cancelWithdrawal: (id) => apiRequest(`/vendors/wallet/withdrawals/${id}/cancel`, { method: 'POST' }),
    // Where Paymob sends the vendor's money. Saving needs the account password.
    getPayoutMethod: () => apiRequest('/vendors/wallet/payout-method'),
    setPayoutMethod: (data) => apiRequest('/vendors/wallet/payout-method', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    // One payout as an invoice.
    getPayout: (id) => apiRequest(`/vendors/wallet/payouts/${id}`),
};

// ======================== ADMIN WITHDRAWALS API ========================
export const adminWithdrawalsApi = {
    getAll: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/withdrawals${qs ? `?${qs}` : ''}`);
    },
    getById: (id) => apiRequest(`/admin/withdrawals/${id}`),
    approve: (id) => apiRequest(`/admin/withdrawals/${id}/approve`, { method: 'POST' }),
    reject: (id, data) => apiRequest(`/admin/withdrawals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    markPaid: (id, data) => apiRequest(`/admin/withdrawals/${id}/paid`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
};

// ======================== VENDOR AD BANNER API ========================
export const vendorAdApi = {
    getAds: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/vendors/ads${qs ? `?${qs}` : ''}`);
    },
    createAd: (data) => apiRequest('/vendors/ads', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    cancelAd: (id) => apiRequest(`/vendors/ads/${id}/cancel`, { method: 'POST' }),
    getAdAnalytics: (id, params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value); });
        const qs = query.toString();
        return apiRequest(`/vendors/ads/${id}/analytics${qs ? `?${qs}` : ''}`);
    },
};

// ======================== ADMIN AD BANNER API ========================
export const adminAdApi = {
    getAll: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/ads${qs ? `?${qs}` : ''}`);
    },
    getById: (id) => apiRequest(`/admin/ads/${id}`),
    approve: (id, data) => apiRequest(`/admin/ads/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    reject: (id, data) => apiRequest(`/admin/ads/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    takedown: (id) => apiRequest(`/admin/ads/${id}/takedown`, { method: 'POST' }),
    getAnalytics: (id, params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value); });
        const qs = query.toString();
        return apiRequest(`/admin/ads/${id}/analytics${qs ? `?${qs}` : ''}`);
    },
};

// ======================== PUBLIC ADS API ========================
export const adsApi = {
    getBanners: (limit = 20) => apiRequest(`/ads/banners?limit=${limit}`),
    getHomepageBanners: (limit = 25) => apiRequest(`/ads/homepage-banners?limit=${limit}`),
    getPromotedProducts: (limit = 8) => apiRequest(`/ads/promoted-products?limit=${limit}`),
};

// ======================== PUBLIC BUNDLES API ========================
export const bundlesApi = {
    getLanding: (limit = 8) => apiRequest(`/bundles/landing?limit=${limit}`),
    getBySlug: (slug) => apiRequest(`/bundles/slug/${slug}`),
    getById: (id) => apiRequest(`/bundles/${id}`),
};

// ======================== PUBLIC ARTICLES API ========================
export const articlesApi = {
    getArticles: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/articles${qs ? `?${qs}` : ''}`);
    },
    getArticleBySlug: (slug) => apiRequest(`/articles/slug/${slug}`),
};

// ======================== ADMIN MASTER CATALOG API ========================
export const adminCatalogApi = {
    getCounts: () => apiRequest('/admin/catalog/counts'),
    list: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/catalog${qs ? `?${qs}` : ''}`);
    },
    filters: (status = '', params = {}) => {
        const qs = new URLSearchParams(Object.entries({ status, ...params }).filter(([, v]) => v)).toString();
        return apiRequest(`/admin/catalog/filters${qs ? `?${qs}` : ''}`);
    },
    // Separate from `filters`: that describes catalog ENTRIES, this describes the vendor
    // PRODUCTS on the unlinked worklist, which are by definition what the catalog misses.
    unlinkedFilters: (status = 'all', params = {}) => {
        const qs = new URLSearchParams(Object.entries({ status, ...params }).filter(([, v]) => v)).toString();
        return apiRequest(`/admin/catalog/unlinked-products/filters?${qs}`);
    },
    get: (id) => apiRequest(`/admin/catalog/${id}`),
    getSimilar: (id) => apiRequest(`/admin/catalog/${id}/similar`),
    // A page of suggestions at once: { similar: { id: [...] } }. At most 100 ids.
    getSimilarMany: (ids) => apiRequest('/admin/catalog/similar', {
        method: 'POST',
        body: JSON.stringify({ ids }),
    }),
    create: (data) => apiRequest('/admin/catalog', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    update: (id, data) => apiRequest(`/admin/catalog/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    approve: (id, edits = null) => apiRequest(`/admin/catalog/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ edits }),
    }),
    merge: (id, targetId) => apiRequest(`/admin/catalog/${id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ target_id: targetId }),
    }),
    archive: (id) => apiRequest(`/admin/catalog/${id}/archive`, { method: 'POST' }),
    reject: (id) => apiRequest(`/admin/catalog/${id}/reject`, { method: 'POST' }),
    restore: (id) => apiRequest(`/admin/catalog/${id}/restore`, { method: 'POST' }),
    remove: (id) => apiRequest(`/admin/catalog/${id}`, { method: 'DELETE' }),

    // --- Unlinked vendor products (the fourth tab's worklist) ---
    listUnlinked: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') query.set(key, value);
        });
        const qs = query.toString();
        return apiRequest(`/admin/catalog/unlinked-products${qs ? `?${qs}` : ''}`);
    },
    getProductDraft: (productId) => apiRequest(`/admin/catalog/unlinked-products/${productId}/draft`),
    publishProductAsEntry: (productId, data) => apiRequest(`/admin/catalog/unlinked-products/${productId}/publish`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    dismissUnlinkedProduct: (productId) => apiRequest(`/admin/catalog/unlinked-products/${productId}/dismiss`, { method: 'POST' }),
    linkUnlinkedProduct: (productId, entryId) => apiRequest(`/admin/catalog/unlinked-products/${productId}/link`, {
        method: 'POST',
        body: JSON.stringify({ catalog_entry_id: entryId }),
    }),
    // Point a product at a different entry — pass null to unlink it entirely.
    relinkProduct: (productId, catalogEntryId) => apiRequest(`/admin/catalog/products/${productId}/link`, {
        method: 'PUT',
        body: JSON.stringify({ catalog_entry_id: catalogEntryId }),
    }),
    // Copy the linked entry's images / brand onto the product. Both require a link.
    // Linked products missing images (gap='images') or a brand (gap='brand').
    listLinkedGaps: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') query.set(k, v); });
        return apiRequest(`/admin/catalog/linked-gaps?${query.toString()}`);
    },
    importProductImagesFromEntry: (productId) => apiRequest(`/admin/catalog/products/${productId}/import-images`, { method: 'POST' }),
    importProductBrandFromEntry: (productId) => apiRequest(`/admin/catalog/products/${productId}/import-brand`, { method: 'POST' }),

    // --- Link suggestions (the catalog matcher) ---
    // The entries each product most likely is: { matches: { productId: [entry + level, similarity, reasons] } }.
    matchProducts: (ids, limit = 3) => apiRequest('/admin/catalog/match/products', {
        method: 'POST',
        body: JSON.stringify({ ids, limit }),
    }),
    matchProduct: (productId) => apiRequest(`/admin/catalog/match/products/${productId}`),
    // Linked products that do not read like their entry.
    linkReview: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') query.set(k, v); });
        return apiRequest(`/admin/catalog/link-review?${query.toString()}`);
    },
    keepLink: (productId) => apiRequest(`/admin/catalog/link-review/${productId}/keep`, { method: 'POST' }),
};

/* ------------------------------------------------------------------ */
/*  Admin fitment check                                               */
/* ------------------------------------------------------------------ */

// Products whose title or description names cars their fitment does not.
export const adminImageStudioApi = {
    summary: (status = 'all') => apiRequest(`/admin/products/image-studio/summary?status=${encodeURIComponent(status)}`),
    list: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') query.set(k, v); });
        return apiRequest(`/admin/products/image-studio?${query.toString()}`);
    },
    product: (productId) => apiRequest(`/admin/products/image-studio/${productId}`),
    suggest: (productId, force = false) => apiRequest(`/admin/products/image-studio/${productId}/suggest`, {
        method: 'POST',
        body: JSON.stringify({ force }),
    }),
    queueMany: (productIds) => apiRequest('/admin/products/image-studio/queue', {
        method: 'POST',
        body: JSON.stringify({ product_ids: productIds }),
    }),
    // option_url: which of the suggested pictures; keep_original: the old one stays at the end.
    // make_main: put it first (default: when the main picture is not a clean one yet).
    apply: (suggestionId, { option_url, keep_original = true, make_main } = {}) => apiRequest(`/admin/products/image-studio/suggestions/${suggestionId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ option_url, keep_original, make_main }),
    }),
    applyAll: (productId) => apiRequest(`/admin/products/image-studio/${productId}/apply-all`, { method: 'POST' }),
    dismiss: (suggestionId) => apiRequest(`/admin/products/image-studio/suggestions/${suggestionId}/dismiss`, { method: 'POST' }),
    retry: (suggestionId) => apiRequest(`/admin/products/image-studio/suggestions/${suggestionId}/retry`, { method: 'POST' }),
    webSearch: (productId, q = '') => apiRequest(`/admin/products/image-studio/${productId}/web-search${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    webPick: (productId, result, query) => apiRequest(`/admin/products/image-studio/${productId}/web-pick`, {
        method: 'POST',
        body: JSON.stringify({ image_url: result.image_url, page_url: result.page_url, title: result.title, query }),
    }),
};
export const adminImageCheckApi = {
    list: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') query.set(k, v); });
        return apiRequest(`/admin/products/image-check?${query.toString()}`);
    },
    get: (productId) => apiRequest(`/admin/products/image-check/${productId}`),
    // `signature` is the row as the admin saw it: refused if the pictures changed since.
    dismiss: (productId, signature) => apiRequest(`/admin/products/image-check/${productId}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ signature }),
    }),
    restore: (productId) => apiRequest(`/admin/products/image-check/${productId}/restore`, { method: 'POST' }),
    makeMain: (productId, url, signature) => apiRequest(`/admin/products/image-check/${productId}/make-main`, {
        method: 'POST',
        body: JSON.stringify({ url, signature }),
    }),
    scan: () => apiRequest('/admin/products/image-check/scan', { method: 'POST' }),
};

export const adminFitmentApi = {
    list: (params = {}) => {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') query.set(k, v); });
        return apiRequest(`/admin/products/fitment-check?${query.toString()}`);
    },
    get: (productId) => apiRequest(`/admin/products/fitment-check/${productId}`),
    // changes: [{ make_id, model_id, years, all_years }]
    apply: (productId, changes) => apiRequest(`/admin/products/fitment-check/${productId}/apply`, {
        method: 'POST',
        body: JSON.stringify({ changes }),
    }),
    dismiss: (productId) => apiRequest(`/admin/products/fitment-check/${productId}/dismiss`, { method: 'POST' }),
};

/* ------------------------------------------------------------------ */
/*  Admin finance                                                     */
/* ------------------------------------------------------------------ */

const financeQuery = (params = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') query.set(key, value);
    });
    const qs = query.toString();
    return qs ? `?${qs}` : '';
};

export const adminFinanceApi = {
    // Overview — the company's position and this period's result.
    getOverview: (params = {}) => apiRequest(`/admin/finance/overview${financeQuery(params)}`),
    getTrend: (params = {}) => apiRequest(`/admin/finance/trend${financeQuery(params)}`),
    // Committed but not landed: carts, parcels at the vendor, parcels out for delivery.
    // Also arrives inside getOverview(); this refreshes the section on its own.
    getPipeline: () => apiRequest('/admin/finance/pipeline'),
    // Tracking report: orders finished in a period, and the same as an .xlsx file.
    getTrackingReport: (params = {}) => apiRequest(`/admin/finance/tracking-report${financeQuery(params)}`),
    // A URL to NAVIGATE to, not fetch: the server answers with Content-Disposition:
    // attachment and the browser saves the file itself. Fetching it into a blob and
    // clicking a temporary link silently did nothing inside in-app browsers on iPhone
    // (Google app, WhatsApp) — the file arrived and was never saved.
    trackingReportExportUrl: (params = {}) =>
        `${BASE_URL}/admin/finance/tracking-report/export${financeQuery(params)}`,

    // --- Wallets (the customer prepaid balance, reported inside Finance) ---
    getWallets: (params = {}) => apiRequest(`/admin/finance/wallets${financeQuery(params)}`),
    getWalletLedger: (params = {}) => apiRequest(`/admin/finance/wallets/ledger${financeQuery(params)}`),
    getWalletReconcile: () => apiRequest('/admin/finance/wallets/reconcile'),
    // Returns a URL rather than fetching: the browser must navigate to it so the
    // Content-Disposition header turns the response into a download.
    walletLedgerExportUrl: (params = {}) =>
        `${BASE_URL}/admin/finance/wallets/ledger/export${financeQuery(params)}`,

    // Vendor payouts.
    getVendors: (params = {}) => apiRequest(`/admin/finance/vendors${financeQuery(params)}`),
    getVendorLedger: (id, params = {}) => apiRequest(`/admin/finance/vendors/${id}${financeQuery(params)}`),
    getVendorPayouts: (id, params = {}) => apiRequest(`/admin/finance/vendors/${id}/payouts${financeQuery(params)}`),
    // data.channel: 'paymob' sends it now; 'manual' records a transfer made elsewhere.
    payVendor: (id, data) => apiRequest(`/admin/finance/vendors/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    previewVendorPay: (id, data) => apiRequest(`/admin/finance/vendors/${id}/pay/preview`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
    }),
    setVendorPayoutHold: (id, data) => apiRequest(`/admin/finance/vendors/${id}/payout-hold`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    freezeEarning: (id, data) => apiRequest(`/admin/finance/earnings/${id}/freeze`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    unfreezeEarning: (id, data) => apiRequest(`/admin/finance/earnings/${id}/unfreeze`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
    }),

    // Payouts (invoices) and Paymob.
    getPayouts: (params = {}) => apiRequest(`/admin/finance/payouts${financeQuery(params)}`),
    getPayout: (id) => apiRequest(`/admin/finance/payouts/${id}`),
    refreshPayout: (id) => apiRequest(`/admin/finance/payouts/${id}/refresh`, { method: 'POST' }),
    sendPayout: (id) => apiRequest(`/admin/finance/payouts/${id}/send`, { method: 'POST' }),
    resolvePayoutFailed: (id, data) => apiRequest(`/admin/finance/payouts/${id}/resolve-failed`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    retryPayout: (id) => apiRequest(`/admin/finance/payouts/${id}/retry`, { method: 'POST' }),
    getPaymobBudget: () => apiRequest('/admin/finance/paymob/budget'),

    // The payout calendar.
    getPayoutSchedule: () => apiRequest('/admin/finance/payout-schedule'),
    updatePayoutSchedule: (data) => apiRequest('/admin/finance/payout-schedule', {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    updateVendorSchedule: (id, data) => apiRequest(`/admin/finance/vendors/${id}/payout-schedule`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),

    // Commissions and customers.
    getCommissions: (params = {}) => apiRequest(`/admin/finance/commissions${financeQuery(params)}`),
    getCustomers: (params = {}) => apiRequest(`/admin/finance/customers${financeQuery(params)}`),
    getProfit: (params = {}) => apiRequest(`/admin/finance/profit${financeQuery(params)}`),

    // Ad spend ledger.
    getAdSpend: (params = {}) => apiRequest(`/admin/finance/ad-spend${financeQuery(params)}`),
    createAdSpend: (data) => apiRequest('/admin/finance/ad-spend', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    updateAdSpend: (id, data) => apiRequest(`/admin/finance/ad-spend/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteAdSpend: (id) => apiRequest(`/admin/finance/ad-spend/${id}`, { method: 'DELETE' }),

    // --- Couriers: the cash they are holding, and the prepaid Bosta bundle ---
    // `refresh` re-reads the bundle from Bosta; without it the screen shows the mirror,
    // so opening the page never waits on a third party.
    getCourierCash: (params = {}) => apiRequest(`/admin/finance/couriers${financeQuery(params)}`),
    getCourierParcels: (provider, params = {}) =>
        apiRequest(`/admin/finance/couriers/${provider}/parcels${financeQuery(params)}`),
    getCourierSettlements: (params = {}) =>
        apiRequest(`/admin/finance/couriers/settlements${financeQuery(params)}`),
    recordCourierSettlement: (data) => apiRequest('/admin/finance/couriers/settlements', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    deleteCourierSettlement: (id) =>
        apiRequest(`/admin/finance/couriers/settlements/${id}`, { method: 'DELETE' }),

    // --- Treasury: where the money is sitting, and what came in each month ---
    getTreasury: () => apiRequest('/admin/finance/treasury'),
    getTreasuryMonthly: (params = {}) => apiRequest(`/admin/finance/treasury/monthly${financeQuery(params)}`),
    getGatewayLedger: (provider, params = {}) =>
        apiRequest(`/admin/finance/treasury/gateways/${provider}/ledger${financeQuery(params)}`),
    getGatewayPayouts: (params = {}) =>
        apiRequest(`/admin/finance/treasury/gateway-payouts${financeQuery(params)}`),
    recordGatewayPayout: (data) => apiRequest('/admin/finance/treasury/gateway-payouts', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    deleteGatewayPayout: (id) =>
        apiRequest(`/admin/finance/treasury/gateway-payouts/${id}`, { method: 'DELETE' }),

    // --- The Paymob Payouts account (the budget vendors are paid from) ---
    getPayoutsStatement: (params = {}) =>
        apiRequest(`/admin/finance/paymob-payouts/statement${financeQuery(params)}`),
    syncPayoutsTopups: () => apiRequest('/admin/finance/paymob-payouts/sync', { method: 'POST' }),
    recordPayoutsTopup: (data) => apiRequest('/admin/finance/paymob-payouts/topups', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    deletePayoutsTopup: (id) =>
        apiRequest(`/admin/finance/paymob-payouts/topups/${id}`, { method: 'DELETE' }),
};

/* ------------------------------------------------------------------ */
/*  Corporate accounts (feature 14)                                   */
/* ------------------------------------------------------------------ */

const companyQuery = financeQuery;

/** POST a file as multipart and parse the JSON answer, keeping the error code. */
async function apiUpload(endpoint, file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${BASE_URL}${endpoint}`, { method: 'POST', credentials: 'include', body: formData, headers: companyScopeHeaders(endpoint) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(data.message || 'Could not read the file');
        if (data.code) err.code = data.code;
        throw err;
    }
    return data;
}

/**
 * POST fields and an optional file named `receipt` as multipart (phase 4 — transfer
 * receipts), keeping the error code.
 */
async function apiUploadForm(endpoint, fields = {}, file = null) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null && value !== '') formData.append(key, value);
    }
    if (file) formData.append('receipt', file);
    const response = await fetch(`${BASE_URL}${endpoint}`, { method: 'POST', credentials: 'include', body: formData, headers: companyScopeHeaders(endpoint) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(data.message || 'Could not send the form');
        if (data.code) err.code = data.code;
        throw err;
    }
    return data;
}

// The company portal — a manager's own company, derived from their session.
export const companyPortalApi = {
    getWallet: (page = 1, companyId = null) => apiRequest(`/company/wallet?page=${page}`, companyId ? { headers: { 'X-Company-Id': companyId } } : {}),
    topupWallet: (amount) => apiRequest('/company/wallet/topups', { method: 'POST', body: JSON.stringify({ amount }) }),
    confirmWalletTopup: (topupId, companyId) => apiRequest('/company/wallet/topups/confirm', { method: 'POST', headers: { 'X-Company-Id': companyId }, body: JSON.stringify({ topupId }) }),
    getOverview: () => apiRequest('/company/overview'),
    confirmSetupStep: (step) => apiRequest(`/company/setup/${step}`, { method: 'POST' }),

    getEmployees: () => apiRequest('/company/employees'),
    inviteEmployee: (data) => apiRequest('/company/employees/invite', { method: 'POST', body: JSON.stringify(data) }),
    // For downloadFile.
    employeesTemplateUrl: () => fileUrl('/company/employees/template'),
    previewImport: (file) => apiUpload('/company/employees/import/preview', file),
    importEmployees: (rows, language) => apiRequest('/company/employees/import', {
        method: 'POST',
        body: JSON.stringify({ rows, language }),
        // Every row is an email or a WhatsApp message; a few hundred take a while.
        timeoutMs: 300000,
    }),
    updateEmployee: (membershipId, data) => apiRequest(`/company/employees/${membershipId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    }),
    removeEmployee: (membershipId) => apiRequest(`/company/employees/${membershipId}`, { method: 'DELETE' }),
    // Pause / resume an employee's company ordering (reversible), and who changed them.
    deactivateEmployee: (membershipId) => apiRequest(`/company/employees/${membershipId}/deactivate`, { method: 'POST' }),
    reactivateEmployee: (membershipId) => apiRequest(`/company/employees/${membershipId}/reactivate`, { method: 'POST' }),
    getEmployeeHistory: (membershipId) => apiRequest(`/company/employees/${membershipId}/history`),
    bulkEmployees: (data) => apiRequest('/company/employees/bulk', { method: 'POST', body: JSON.stringify(data) }),

    resendInvitation: (id, language) => apiRequest(`/company/invitations/${id}/resend`, {
        method: 'POST',
        body: JSON.stringify({ language }),
    }),
    resendExpired: (language) => apiRequest('/company/invitations/resend-expired', {
        method: 'POST',
        body: JSON.stringify({ language }),
        timeoutMs: 180000,
    }),
    revokeInvitation: (id) => apiRequest(`/company/invitations/${id}`, { method: 'DELETE' }),

    getGroups: () => apiRequest('/company/groups'),
    createGroup: (data) => apiRequest('/company/groups', { method: 'POST', body: JSON.stringify(data) }),
    updateGroup: (id, data) => apiRequest(`/company/groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteGroup: (id) => apiRequest(`/company/groups/${id}`, { method: 'DELETE' }),

    getOffices: () => apiRequest('/company/offices'),
    createOffice: (data) => apiRequest('/company/offices', { method: 'POST', body: JSON.stringify(data) }),
    updateOffice: (id, data) => apiRequest(`/company/offices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteOffice: (id) => apiRequest(`/company/offices/${id}`, { method: 'DELETE' }),

    // Invoices (phase 4)
    getInvoices: () => apiRequest('/company/invoices'),
    getInvoice: (id) => apiRequest(`/company/invoices/${id}`),
    submitReceipt: (id, fields, file) => apiUploadForm(`/company/invoices/${id}/receipts`, fields, file),
    getReceipt: (paymentId) => apiRequestBlob(`/company/payments/${paymentId}/receipt`),

    getCars: () => apiRequest('/company/cars'),
    createCar: (data) => apiRequest('/company/cars', { method: 'POST', body: JSON.stringify(data) }),
    updateCar: (id, data) => apiRequest(`/company/cars/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteCar: (id) => apiRequest(`/company/cars/${id}`, { method: 'DELETE' }),

    // The company's ledger, month by month, and the same month as an .xlsx.
    getPurchases: (params = {}) => apiRequest(`/company/purchases${companyQuery(params)}`),
    exportPurchasesUrl: (params = {}) => fileUrl(`/company/purchases/export${companyQuery(params)}`),

    getSettings: () => apiRequest('/company/settings'),
    updateSettings: (data) => apiRequest('/company/settings', { method: 'PATCH', body: JSON.stringify(data) }),
    // The account's logo, shown on Ready Marine's home page while `show_logo_on_homepage` is on.
    uploadLogo: (file) => apiUpload('/company/logo', file),
    removeLogo: () => apiRequest('/company/logo', { method: 'DELETE' }),
    inviteManager: (data) => apiRequest('/company/managers', { method: 'POST', body: JSON.stringify(data) }),
    removeManager: (membershipId) => apiRequest(`/company/managers/${membershipId}`, { method: 'DELETE' }),
};

// The signed-in customer's own company membership ("My company").
export const myCompanyApi = {
    get: () => apiRequest('/users/company'),
    getOrders: () => apiRequest('/users/company/orders'),
    // Consolidation (phase 3): parcels waiting in a batch, and sending one on now.
    getBatches: () => apiRequest('/users/company/batches'),
    shipNow: (orderId, subOrderId) => apiRequest(`/users/company/orders/${orderId}/parcels/${subOrderId}/ship-now`, { method: 'POST' }),
    // Pay the company's share of your own order from your wallet; the limit comes back.
    settle: (orderId) => apiRequest(`/users/company/orders/${orderId}/settle`, { method: 'POST' }),
};

// Company invitations — token-addressed, usable while signed out.
export const companyInvitationApi = {
    preview: (token) => apiRequest(`/company-invitations/${encodeURIComponent(token)}`),
    accept: (token) => apiRequest(`/company-invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
    acceptWithRegistration: (token, data) => apiRequest(`/company-invitations/${encodeURIComponent(token)}/accept-with-registration`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    sendCode: (token, language) => apiRequest(`/company-invitations/${encodeURIComponent(token)}/send-code`, {
        method: 'POST',
        body: JSON.stringify({ language }),
    }),
    acceptWithCode: (token, data) => apiRequest(`/company-invitations/${encodeURIComponent(token)}/accept-with-code`, {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    decline: (token) => apiRequest(`/company-invitations/${encodeURIComponent(token)}/decline`, { method: 'POST' }),
};

// Admin — every company, and what Ready Marine lends each one.
export const adminCompanyApi = {
    getWallet: (id, page = 1) => apiRequest(`/admin/companies/${id}/wallet?page=${page}`),
    list: (params = {}) => apiRequest(`/admin/companies${companyQuery(params)}`),
    create: (data) => apiRequest('/admin/companies', { method: 'POST', body: JSON.stringify(data) }),
    get: (id) => apiRequest(`/admin/companies/${id}`),
    getEmployees: (id) => apiRequest(`/admin/companies/${id}/employees`),
    getEmployeeHistory: (id, membershipId) => apiRequest(`/admin/companies/${id}/employees/${membershipId}/history`),
    update: (id, data) => apiRequest(`/admin/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => apiRequest(`/admin/companies/${id}`, { method: 'DELETE' }),
    suspend: (id, note) => apiRequest(`/admin/companies/${id}/suspend`, { method: 'POST', body: JSON.stringify({ note }) }),
    reactivate: (id) => apiRequest(`/admin/companies/${id}/reactivate`, { method: 'POST' }),
    endContract: (id, note) => apiRequest(`/admin/companies/${id}/end-contract`, { method: 'POST', body: JSON.stringify({ note }) }),
    recordRefund: (id, data) => apiRequest(`/admin/companies/${id}/refunds`, { method: 'POST', body: JSON.stringify(data) }),
    inviteManager: (id, data) => apiRequest(`/admin/companies/${id}/managers`, { method: 'POST', body: JSON.stringify(data) }),
    updateManager: (id, membershipId, data) => apiRequest(`/admin/companies/${id}/managers/${membershipId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    removeManager: (id, membershipId) => apiRequest(`/admin/companies/${id}/managers/${membershipId}`, { method: 'DELETE' }),
    getManagerInvitations: (id) => apiRequest(`/admin/companies/${id}/manager-invitations`),
    resendInvitation: (id, invitationId) => apiRequest(`/admin/companies/${id}/invitations/${invitationId}/resend`, { method: 'POST' }),
    revokeInvitation: (id, invitationId) => apiRequest(`/admin/companies/${id}/invitations/${invitationId}`, { method: 'DELETE' }),
    getPurchases: (id, params = {}) => apiRequest(`/admin/companies/${id}/purchases${companyQuery(params)}`),
    exportPurchasesUrl: (id, params = {}) => fileUrl(`/admin/companies/${id}/purchases/export${companyQuery(params)}`),
    getSettings: () => apiRequest('/admin/companies/settings'),
    updateSettings: (data) => apiRequest('/admin/companies/settings', { method: 'PUT', body: JSON.stringify(data) }),
    getBatches: (id, params = {}) => apiRequest(`/admin/companies/${id}/batches${companyQuery(params)}`),
    // Invoices and payments (phase 4)
    getInvoices: (id) => apiRequest(`/admin/companies/${id}/invoices`),
    getInvoice: (id, invoiceId) => apiRequest(`/admin/companies/${id}/invoices/${invoiceId}`),
    recordPayment: (id, invoiceId, fields, file) => apiUploadForm(`/admin/companies/${id}/invoices/${invoiceId}/payments`, fields, file),
    confirmPayment: (id, paymentId, data = {}) => apiRequest(`/admin/companies/${id}/payments/${paymentId}/confirm`, { method: 'POST', body: JSON.stringify(data) }),
    rejectPayment: (id, paymentId, reason) => apiRequest(`/admin/companies/${id}/payments/${paymentId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    getReceipt: (id, paymentId) => apiRequestBlob(`/admin/companies/${id}/payments/${paymentId}/receipt`),
    // Statistics (phase 5): every company together, or one.
    getStats: (params = {}) => apiRequest(`/admin/companies/stats${companyQuery(params)}`),
    exportStatsUrl: (params = {}) => fileUrl(`/admin/companies/stats/export${companyQuery(params)}`),
    getCompanyStats: (id, params = {}) => apiRequest(`/admin/companies/${id}/stats${companyQuery(params)}`),
    exportCompanyStatsUrl: (id, params = {}) => fileUrl(`/admin/companies/${id}/stats/export${companyQuery(params)}`),
    closeBatch: (id, batchId) => apiRequest(`/admin/companies/${id}/batches/${batchId}/close`, { method: 'POST' }),
};

/* ------------------------------------------------------------------ */
/* AI chat assistant (EverySecond chat commerce — components/chat)     */
/* ------------------------------------------------------------------ */

// A guest is known by the random session id their browser keeps; a signed-in
// customer by their session cookie, which apiRequest already sends.
const assistantQuery = (params = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') q.set(key, String(value));
    }
    const s = q.toString();
    return s ? `?${s}` : '';
};

export const assistantApi = {
    // { enabled, messages[], cart, cartSync }
    history: ({ sessionId, after } = {}) =>
        apiRequest(`/assistant/messages${assistantQuery({ sessionId, after })}`).then((r) => r.data),
    // The agent thinks for a few seconds — allow it a minute.
    send: ({ sessionId, message, locale }) =>
        apiRequest('/assistant/messages', {
            method: 'POST',
            body: JSON.stringify({ sessionId, message, locale }),
            timeoutMs: 70000,
        }).then((r) => r.data),
    // The recording Blob is the request body as it is.
    sendVoice: ({ sessionId, locale, blob }) =>
        apiRequest(`/assistant/voice${assistantQuery({ sessionId, locale })}`, {
            method: 'POST',
            body: blob,
            headers: { 'Content-Type': blob.type || 'audio/webm' },
            timeoutMs: 90000,
        }).then((r) => r.data),
    // The website cart, put into the chat basket.
    syncCart: ({ sessionId, locale, create, items }) =>
        apiRequest('/assistant/cart', {
            method: 'PUT',
            body: JSON.stringify({ sessionId, locale, create, items }),
            timeoutMs: 15000,
        }).then((r) => r.data),
    closeCart: ({ sessionId, reason = 'ordered_on_website' } = {}) =>
        apiRequest(`/assistant/cart${assistantQuery({ sessionId, reason })}`, { method: 'DELETE' }).then((r) => r.data),
    reset: ({ sessionId } = {}) =>
        apiRequest(`/assistant/messages${assistantQuery({ sessionId })}`, { method: 'DELETE' }).then((r) => r.data),
};
