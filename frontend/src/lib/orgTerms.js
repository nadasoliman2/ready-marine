/**
 * What a corporate account is called, by the kind of organisation behind it — a company,
 * an authority, a school or a residential property. Only the words change: a property has
 * "residents" and "buildings" where a company has "employees" and "branches".
 * Mirrors Backend/services/shared/orgTerms.js; keep the two in step.
 *
 * Arabic carries the noun's gender (`fem`) because the verbs around it follow it:
 * "الشركة بتدفع" but "العقار بيدفع" — use `v(fem, masc)` for those.
 */
export const ORG_TYPES = ['company', 'authority', 'school', 'property'];

const AR = {
    company: { one: 'شركة', the: 'الشركة', toThe: 'للشركة', your: 'شركتك', plural: 'شركات', member: 'موظف', theMember: 'الموظف', members: 'الموظفين', membersN: 'موظفين', branch: 'فرع', theBranch: 'الفرع', toTheBranch: 'للفرع', branches: 'الفروع', mine: 'شركتي', fem: true },
    authority: { one: 'هيئة', the: 'الهيئة', toThe: 'للهيئة', your: 'هيئتك', plural: 'هيئات', member: 'موظف', theMember: 'الموظف', members: 'الموظفين', membersN: 'موظفين', branch: 'فرع', theBranch: 'الفرع', toTheBranch: 'للفرع', branches: 'الفروع', mine: 'هيئتي', fem: true },
    school: { one: 'مدرسة', the: 'المدرسة', toThe: 'للمدرسة', your: 'مدرستك', plural: 'مدارس', member: 'موظف', theMember: 'الموظف', members: 'الموظفين', membersN: 'موظفين', branch: 'فرع', theBranch: 'الفرع', toTheBranch: 'للفرع', branches: 'الفروع', mine: 'مدرستي', fem: true },
    property: { one: 'عقار', the: 'العقار', toThe: 'للعقار', your: 'عقارك', plural: 'عقارات', member: 'ساكن', theMember: 'الساكن', members: 'السكان', membersN: 'سكان', branch: 'مبنى', theBranch: 'المبنى', toTheBranch: 'للمبنى', branches: 'المباني', mine: 'عقاري', fem: false },
};

const EN = {
    company: { one: 'company', One: 'Company', member: 'employee', Member: 'Employee', members: 'employees', Members: 'Employees', branch: 'branch', Branch: 'Branch', branches: 'branches', Branches: 'Branches' },
    authority: { one: 'authority', One: 'Authority', member: 'employee', Member: 'Employee', members: 'employees', Members: 'Employees', branch: 'branch', Branch: 'Branch', branches: 'branches', Branches: 'Branches' },
    school: { one: 'school', One: 'School', member: 'staff member', Member: 'Staff member', members: 'staff', Members: 'Staff', branch: 'branch', Branch: 'Branch', branches: 'branches', Branches: 'Branches' },
    property: { one: 'property', One: 'Property', member: 'resident', Member: 'Resident', members: 'residents', Members: 'Residents', branch: 'building', Branch: 'Building', branches: 'buildings', Branches: 'Buildings' },
};

export const orgType = (value) => (ORG_TYPES.includes(value) ? value : 'company');

/**
 * The words for one account, in the screen's language:
 *   const t = orgTerms(company.org_type, isAr);
 *   t.the → "العقار" / "property";  t.members → "السكان" / "residents"
 *   t.v('بتدفع', 'بيدفع') → the verb that agrees with the noun (Arabic only).
 */
export function orgTerms(type, isAr) {
    const key = orgType(type);
    const ar = AR[key];
    const en = EN[key];
    if (isAr) {
        return {
            ...ar,
            aOne: ar.one, aMember: ar.member,
            One: ar.one, the: ar.the, The: ar.the, Members: ar.members, Branch: ar.branch, Branches: ar.branches,
            name: `اسم ${ar.the}`,
            account: `حساب ${ar.the}`,
            portal: `لوحة ${ar.the}`,
            v: (fem, masc) => (ar.fem ? fem : masc),
        };
    }
    return {
        ...en,
        the: `the ${en.one}`, The: `The ${en.one}`, your: `your ${en.one}`, plural: { company: 'companies', authority: 'authorities', school: 'schools', property: 'properties' }[key],
        theMember: `the ${en.member}`,
        toThe: `to the ${en.one}`, membersN: en.members, theBranch: `the ${en.branch}`, toTheBranch: `to the ${en.branch}`,
        aOne: `${en.one === 'authority' ? 'an' : 'a'} ${en.one}`,
        aMember: `${/^[aeiou]/.test(en.member) ? 'an' : 'a'} ${en.member}`,
        mine: `My ${en.one}`,
        name: `${en.One} name`,
        account: `${en.one} account`,
        portal: `${en.One} portal`,
        fem: false,
        v: (fem) => fem,
    };
}

/** Labels for the type picker. */
export const orgTypeLabel = (type, isAr) => (isAr
    ? { company: 'شركة', authority: 'هيئة', school: 'مدرسة', property: 'عقار' }
    : { company: 'Company', authority: 'Authority', school: 'School', property: 'Property' })[orgType(type)];
