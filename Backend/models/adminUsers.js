const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * A dashboard staff account below the super admin.
 *
 * The super admin is NOT in this collection — it is the `ADMIN_USERNAME` / `ADMIN_PASSWORD`
 * pair in the server environment. Keeping the master key out of the database is the point:
 * no row here can delete it, no permission edit can lock it out, and there is always exactly
 * one way back into the dashboard. See `services/adminAccessService.js`.
 */

/**
 * `view` reads the section; `manage` also changes it. The split is enforced by HTTP method
 * (GET reads, everything else writes) rather than by a per-route list, so a route added
 * tomorrow is classified correctly without anyone remembering to classify it.
 */
const ADMIN_ACCESS_LEVELS = ["view", "manage"];

const adminPermissionSchema = new Schema(
    {
        // A key from `MODULES` in services/adminAccessService.js. Deliberately a plain
        // string and not an enum: the module list lives in one place, and duplicating it
        // here would let the two drift, with the schema silently rejecting a module the
        // service considers real.
        module: { type: String, required: true, trim: true },
        access: { type: String, enum: ADMIN_ACCESS_LEVELS, default: "view" },
    },
    { _id: false }
);

const adminUserSchema = new Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            minlength: 3,
            index: true,
        },
        name: { type: String, default: "", trim: true },
        // bcrypt hash. Never selected by default, so it cannot leak through a route that
        // forgets to exclude it.
        password: { type: String, required: true, select: false },

        permissions: { type: [adminPermissionSchema], default: [] },

        // Switched off rather than deleted, so the audit trail its actions left behind still
        // resolves to a real account. Checked on EVERY request, so turning it off logs the
        // account out at once instead of whenever its token expires.
        is_active: { type: Boolean, default: true, index: true },

        // Invalidates tokens issued before a password change — the same guard the customer
        // and vendor models use, read by `protect` in middleware/authMiddleware.js.
        password_changed_at: { type: Date, default: null },

        last_login_at: { type: Date, default: null },
        // "super" when the super admin created it; otherwise the username that did.
        created_by: { type: String, default: "super" },
    },
    { timestamps: true }
);

const AdminUser = mongoose.model("AdminUser", adminUserSchema);

module.exports = { AdminUser, ADMIN_ACCESS_LEVELS };
