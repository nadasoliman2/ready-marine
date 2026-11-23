const userService = require("./user.service");
const { User } = require("../../models/users");

/**
 * GET /api/users/profile
 */
const getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select("-password").lean();
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * PUT /api/users/profile
 */
const updateProfile = async (req, res) => {
    try {
        const updated = await User.findByIdAndUpdate(req.user._id, req.body, { new: true }).select("-password");
        res.json({ success: true, user: updated });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

module.exports = {
    getProfile,
    updateProfile,
};
