/**
 * What a corporate account is called, by the kind of organisation behind it.
 *
 * Not every account is a company: an authority, a school or a residential property
 * orders the same way, with the same limits — only the words differ ("residents" of a
 * property, not "employees"). Mirrored in frontend/src/lib/orgTerms.js; keep the two in step.
 *
 * Arabic carries the noun's gender (`fem`) because the verbs around it follow it:
 * "الشركة بتدفع" but "العقار بيدفع".
 */
const ORG_TYPES = ['company', 'authority', 'school', 'property'];

const TERMS = {
    company: {
        ar: { one: 'شركة', the: 'الشركة', your: 'شركتك', member: 'موظف', theMember: 'الموظف', members: 'الموظفين', branch: 'فرع', branches: 'الفروع', fem: true },
        en: { one: 'company', One: 'Company', member: 'employee', Member: 'Employee', members: 'employees', Members: 'Employees', branch: 'branch', Branch: 'Branch', branches: 'branches', Branches: 'Branches' },
    },
    authority: {
        ar: { one: 'هيئة', the: 'الهيئة', your: 'هيئتك', member: 'موظف', theMember: 'الموظف', members: 'الموظفين', branch: 'فرع', branches: 'الفروع', fem: true },
        en: { one: 'authority', One: 'Authority', member: 'employee', Member: 'Employee', members: 'employees', Members: 'Employees', branch: 'branch', Branch: 'Branch', branches: 'branches', Branches: 'Branches' },
    },
    school: {
        ar: { one: 'مدرسة', the: 'المدرسة', your: 'مدرستك', member: 'موظف', theMember: 'الموظف', members: 'الموظفين', branch: 'فرع', branches: 'الفروع', fem: true },
        en: { one: 'school', One: 'School', member: 'staff member', Member: 'Staff member', members: 'staff', Members: 'Staff', branch: 'branch', Branch: 'Branch', branches: 'branches', Branches: 'Branches' },
    },
    property: {
        ar: { one: 'عقار', the: 'العقار', your: 'عقارك', member: 'ساكن', theMember: 'الساكن', members: 'السكان', branch: 'مبنى', branches: 'المباني', fem: false },
        en: { one: 'property', One: 'Property', member: 'resident', Member: 'Resident', members: 'residents', Members: 'Residents', branch: 'building', Branch: 'Building', branches: 'buildings', Branches: 'Buildings' },
    },
};

const orgType = (value) => (ORG_TYPES.includes(value) ? value : 'company');
/** The words for an account: `orgTerms(company.org_type).ar.the` → "العقار". */
const orgTerms = (type) => TERMS[orgType(type)];

/**
 * The same words flattened for one language, the shape the frontend uses:
 *   const oa = flatTerms(company.org_type, true);   // oa.the → "العقار", oa.v('بتدفع', 'بيدفع')
 *   const oe = flatTerms(company.org_type, false);  // oe.one → "property"
 */
const flatTerms = (type, isAr) => {
    const key = orgType(type);
    const { ar, en } = TERMS[key];
    if (isAr) {
        const the = ar.the;
        return {
            ...ar,
            toThe: `لل${the.slice(2)}`,
            membersN: ar.members.replace(/^ال/, ''),
            theBranch: `ال${ar.branch}`,
            toTheBranch: `لل${ar.branch}`,
            plural: { company: 'شركات', authority: 'هيئات', school: 'مدارس', property: 'عقارات' }[key],
            aOne: ar.one, aMember: ar.member,
            One: ar.one, The: the, Member: ar.member, Members: ar.members, Branch: ar.branch, Branches: ar.branches,
            portal: `لوحة ${the}`,
            account: `حساب ${the}`,
            v: (fem, masc) => (ar.fem ? fem : masc),
        };
    }
    return {
        ...en,
        the: `the ${en.one}`, The: `The ${en.one}`, your: `your ${en.one}`,
        theMember: `the ${en.member}`, membersN: en.members,
        toThe: `to the ${en.one}`, theBranch: `the ${en.branch}`, toTheBranch: `to the ${en.branch}`,
        plural: { company: 'companies', authority: 'authorities', school: 'schools', property: 'properties' }[key],
        aOne: `${en.one === 'authority' ? 'an' : 'a'} ${en.one}`,
        aMember: `${/^[aeiou]/.test(en.member) ? 'an' : 'a'} ${en.member}`,
        portal: `${en.One} portal`,
        account: `${en.one} account`,
        fem: false,
        v: (fem) => fem,
    };
};

module.exports = { ORG_TYPES, orgType, orgTerms, flatTerms };
