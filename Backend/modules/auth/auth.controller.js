const authService = require("./auth.service");
const { startSession, refreshSession, endSession } = require("../../common/services/sessionService");

const setAuthCookie = (req, res, token, rememberMe = false) => startSession(req, res, token, { persistent: rememberMe });

/**
 * Register User
 * POST /api/auth/register
 */
const register = async (req, res) => {
    try {
        const result = await authService.registerUser(req.body);
        if (result.token) setAuthCookie(req, res, result.token, false);
        res.status(201).json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * Login User
 * POST /api/auth/login
 */
const login = async (req, res) => {
    try {
        const { email, password, rememberMe } = req.body;
        const result = await authService.authenticateUser({ email, password });
        if (result.token) setAuthCookie(req, res, result.token, rememberMe);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(401).json({ success: false, message: error.message });
    }
};

/**
 * Logout
 * POST /api/auth/logout
 */
const logout = async (req, res) => {
    try {
        await endSession(req, res);
        res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Refresh Session
 * POST /api/auth/refresh
 */
const refresh = async (req, res) => {
    try {
        const session = await refreshSession(req, res);
        if (!session) return res.status(401).json({ success: false, message: "Session expired" });
        res.json({ success: true, user: session.user });
    } catch (error) {
        res.status(401).json({ success: false, message: error.message });
    }
};

/**
 * Get current authenticated user
 * GET /api/auth/me
 */
const getMe = async (req, res) => {
    res.json({ success: true, user: req.user });
};

module.exports = {
    register,
    login,
    logout,
    refresh,
    getMe,
};
