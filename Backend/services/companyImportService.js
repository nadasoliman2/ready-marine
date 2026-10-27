/**
 * Adding employees from an Excel sheet: the template a manager downloads, and
 * the preview that reads a filled one back.
 *
 * The preview writes nothing and sends nothing. It classifies every row with the
 * same `classifyInvitee` a real invitation uses, so the screen cannot promise
 * something the send will then refuse; the confirmed rows are posted back and
 * each is re-checked on the way out (companyInvitationService.importEmployees).
 */
const { flatTerms } = require('./shared/orgTerms');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

const { parseInviteIdentifier } = require('./shared/guestInvites');
const { classifyInvitee, MAX_IMPORT_ROWS } = require('./companyInvitationService');
const { requireManager, activeOffices, cleanText } = require('./companyService');

const SHEET = 'Employees';
const LISTS_SHEET = 'Lists';
const HEADERS = [
    'الاسم — Name',
    'الإيميل أو الموبايل — Email or mobile',
    'الجروب (اختياري) — Group (optional)',
    'الفرع (اختياري) — Branch (optional)',
];
const TEMPLATE_ROWS = MAX_IMPORT_ROWS;

/**
 * The template, with the company's own groups and offices offered as dropdowns
 * so a typo in a group name cannot happen in the first place.
 */
const buildTemplateWorkbook = async (userId) => {
    const { company } = await requireManager(userId);
    // The account's own words: a property's residents and buildings (shared/orgTerms).
    const oa = flatTerms(company.org_type, true);
    const oe = flatTerms(company.org_type, false);
    const headers = [...HEADERS.slice(0, 3), `${oa.theBranch} (اختياري) — ${oe.Branch} (optional)`];
    const groups = (company.groups || []).map((g) => g.name);
    const offices = activeOffices(company).map((o) => o.name);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ready Marine';
    wb.created = new Date();

    const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }] });
    ws.columns = [{ width: 26 }, { width: 34 }, { width: 26 }, { width: 26 }];
    const header = ws.getRow(1);
    headers.forEach((text, i) => {
        const cell = header.getCell(i + 1);
        cell.value = text;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    header.height = 32;
    // Numbers typed into a general cell lose their leading zero; keep the column text.
    ws.getColumn(2).numFmt = '@';

    // Dropdown sources live on their own sheet: an inline list is capped at 255
    // characters, which a company with a few long group names would exceed.
    const lists = wb.addWorksheet(LISTS_SHEET, { state: 'hidden' });
    lists.getCell('A1').value = 'Groups';
    lists.getCell('B1').value = 'Branches';
    groups.forEach((name, i) => { lists.getCell(`A${i + 2}`).value = name; });
    offices.forEach((name, i) => { lists.getCell(`B${i + 2}`).value = name; });

    const lastRow = TEMPLATE_ROWS + 1;
    if (groups.length) {
        ws.dataValidations.add(`C2:C${lastRow}`, {
            type: 'list',
            allowBlank: true,
            formulae: [`${LISTS_SHEET}!$A$2:$A$${groups.length + 1}`],
        });
    }
    if (offices.length) {
        ws.dataValidations.add(`D2:D${lastRow}`, {
            type: 'list',
            allowBlank: true,
            formulae: [`${LISTS_SHEET}!$B$2:$B$${offices.length + 1}`],
        });
    }

    const help = wb.addWorksheet('Instructions', { views: [{ rightToLeft: true }] });
    help.getColumn(1).width = 110;
    [
        `املا شيت Employees — صف لكل ${oa.member}، من الصف التاني.`,
        'الإيميل أو الموبايل إجباري. رقم الموبايل لازم يكون موبايل مصري (مثلاً 01012345678) — الدعوة بتروحله واتساب.',
        `الجروب و${oa.theBranch} اختياريين. لو سبت الجروب فاضي ${oa.theMember} بياخد الليميت الافتراضي، ولو سبت ${oa.theBranch} بيتبع أول ${oa.branch}.`,
        `أقصى عدد في الملف الواحد ${MAX_IMPORT_ROWS} ${oa.member}.`,
        '',
        `Fill the Employees sheet — one ${oe.member} per row, starting on row 2.`,
        'Email or mobile is required. A mobile must be an Egyptian mobile (e.g. 01012345678) — the invitation goes to WhatsApp.',
        `Group and ${oe.branch} are optional. No group means the default limit; no ${oe.branch} means the first ${oe.branch}.`,
        `At most ${MAX_IMPORT_ROWS} ${oe.members} per file.`,
    ].forEach((line, i) => { help.getCell(`A${i + 1}`).value = line; });

    return { workbook: wb, filename: `readymarine-employees-${company._id}.xlsx` };
};

const normalizeName = (value) => cleanText(value, 120).toLowerCase();

/**
 * Read a filled template and say, row by row, what sending it would do.
 *
 * Row statuses:
 *   valid            will be invited
 *   make_employee    already a manager here — will get a limit, no invitation needed
 *   invalid_contact  not an email or an Egyptian mobile
 *   duplicate        the same person appears earlier in this file
 *   already_member   already an employee here
 *   pending_invite   an invitation is already waiting for them
 *   (belonging to another company is fine — a person may be in several)
 *   unknown_group    the group named does not exist
 *   unknown_office   the office named does not exist
 */
const previewImport = async (userId, fileBuffer) => {
    const { company } = await requireManager(userId);

    let workbook;
    try {
        workbook = XLSX.read(fileBuffer, { type: 'buffer', cellText: true, raw: false });
    } catch (e) {
        const err = new Error('Invalid .xlsx file — could not read the workbook.');
        err.code = 'INVALID_FILE';
        err.status = 400;
        throw err;
    }
    const sheetName = workbook.SheetNames.includes(SHEET) ? SHEET : workbook.SheetNames[0];
    const raw = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });

    const dataRows = raw
        .slice(1)
        .map((cells, i) => ({ cells, row_number: i + 2 }))
        .filter(({ cells }) => cells.some((c) => String(c).trim() !== ''));

    if (!dataRows.length) {
        const err = new Error('The file has no employee rows. Fill the sheet from row 2.');
        err.code = 'EMPTY_FILE';
        err.status = 400;
        throw err;
    }
    if (dataRows.length > MAX_IMPORT_ROWS) {
        const err = new Error(`The file has ${dataRows.length} rows — the most one file can hold is ${MAX_IMPORT_ROWS}.`);
        err.code = 'TOO_MANY_ROWS';
        err.status = 400;
        throw err;
    }

    const groupsByName = new Map((company.groups || []).map((g) => [normalizeName(g.name), g]));
    const officesByName = new Map(activeOffices(company).map((o) => [normalizeName(o.name), o]));
    const seen = new Set();

    const rows = [];
    for (const { cells, row_number } of dataRows) {
        const [nameCell, identifierCell, groupCell, officeCell] = cells.map((c) => String(c ?? '').trim());
        const parsed = parseInviteIdentifier(identifierCell);
        const group = groupCell ? groupsByName.get(normalizeName(groupCell)) : null;
        const office = officeCell ? officesByName.get(normalizeName(officeCell)) : null;

        let status;
        if (!parsed.type) status = 'invalid_contact';
        else if (seen.has(parsed.normalized)) status = 'duplicate';
        else if (groupCell && !group) status = 'unknown_group';
        else if (officeCell && !office) status = 'unknown_office';
        else {
            const verdict = await classifyInvitee(company, parsed, 'employee');
            status = {
                invite: 'valid',
                make_employee: 'make_employee',
                already_member: 'already_member',
                pending_invite: 'pending_invite',
            }[verdict.status] || 'valid';
        }
        if (parsed.type) seen.add(parsed.normalized);

        rows.push({
            row_number,
            name: cleanText(nameCell, 80),
            identifier: parsed.type ? parsed.normalized : identifierCell,
            identifier_type: parsed.type,
            group_name: groupCell || null,
            group_id: group?._id || null,
            office_name: officeCell || null,
            office_id: office?._id || null,
            status,
            sendable: status === 'valid' || status === 'make_employee',
        });
    }

    const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    return {
        rows,
        counts,
        total: rows.length,
        sendable: rows.filter((r) => r.sendable).length,
        groups: (company.groups || []).map((g) => ({ _id: g._id, name: g.name })),
        offices: activeOffices(company).map((o) => ({ _id: o._id, name: o.name })),
    };
};

module.exports = { buildTemplateWorkbook, previewImport };
