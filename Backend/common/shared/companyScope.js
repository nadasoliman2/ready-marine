/**
 * Which company a company-portal request is about.
 *
 * A person may manage more than one company (feature 14). The portal sends the company it
 * is showing in the `X-Company-Id` header; the portal router stores it here for the
 * duration of the request, and `companyService.requireManager` reads it — so the ~40
 * portal operations keep their `(userId, …)` signatures and none of them can be pointed at
 * a company the caller does not manage: the id only ever SELECTS among the caller's own
 * memberships.
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/** Run `fn` with `companyId` as the selected company (null = let the service choose). */
const runInCompanyScope = (companyId, fn) => storage.run({ companyId: companyId ? String(companyId) : null }, fn);

/** The company selected for the current request, or null. */
const scopedCompanyId = () => storage.getStore()?.companyId || null;

module.exports = { runInCompanyScope, scopedCompanyId };
