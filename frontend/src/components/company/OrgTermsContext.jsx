'use client';

import { createContext, useContext, useEffect } from 'react';
import { orgTerms } from '../../lib/orgTerms';
import { setActiveOrgType } from '../../lib/companyLocalization';

/**
 * The kind of organisation a screen is showing (company, authority, school, property), so
 * every page below can say "residents" for a property instead of "employees". Provided by
 * the portal layout from the current membership, and by the admin's account page.
 */
const OrgTypeContext = createContext('company');

export function OrgTypeProvider({ value = 'company', children }) {
    useActiveOrgType(value);
    return <OrgTypeContext.Provider value={value}>{children}</OrgTypeContext.Provider>;
}

/** The words for the account open on this screen — see lib/orgTerms.js. */
export function usePortalTerms(isAr) {
    return orgTerms(useContext(OrgTypeContext), isAr);
}

/**
 * Tell the shared error and label copy (lib/companyLocalization.js) which account this
 * screen is about, so "the company's cap" reads "the property's cap" where it should.
 * Back to the default when the screen goes away.
 */
export function useActiveOrgType(type) {
    useEffect(() => {
        setActiveOrgType(type);
        return () => setActiveOrgType('company');
    }, [type]);
}
