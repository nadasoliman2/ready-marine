const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '../product_bulk_upload_template.xlsx');
console.log('Modifying:', filePath);
const wb = XLSX.readFile(filePath);
I2NlWCUf31gqrl8
// 1. Modify Products sheet to remove slugs
const ws = wb.Sheets['Products'];
if (ws) {
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Columns to remove: Slug (EN) which is index 6, Slug (AR) which is index 10.
    // We remove backwards so indices don't shift.
    let modified = false;
    data.forEach(row => {
        // If row 3 (0-indexed) has 'Slug (AR)' at index 10, remove it.
        if (row.length > 10 && (row[10] === 'Slug (AR)' || data[3][10] === 'Slug (AR)')) {
            row.splice(10, 1);
            modified = true;
        }
        if (row.length > 6 && (row[6] === 'Slug (EN)' || data[3][6] === 'Slug (EN)')) {
            row.splice(6, 1);
            modified = true;
        }
    });

    if (modified) {
        const newWs = XLSX.utils.aoa_to_sheet(data);
        // Copy cols info if exists
        if (ws['!cols']) {
            const newCols = [...ws['!cols']];
            if (newCols.length > 10) newCols.splice(10, 1);
            if (newCols.length > 6) newCols.splice(6, 1);
            newWs['!cols'] = newCols;
        }
        wb.Sheets['Products'] = newWs;
        console.log('Removed Slugs from Products sheet.');
    } else {
        console.log('Slugs not found at expected indices.');
    }
}

// 2. Modify Instructions sheet for variants discount_price
const instWs = wb.Sheets['Instructions'];
if (instWs) {
    let instModified = false;
    const instData = XLSX.utils.sheet_to_json(instWs, { header: 1, defval: '' });
    for (let i = 0; i < instData.length; i++) {
        for (let j = 0; j < instData[i].length; j++) {
            if (typeof instData[i][j] === 'string' && instData[i][j].includes('price=49.99')) {
                if (!instData[i][j].includes('discount_price')) {
                    instData[i][j] = instData[i][j].replace('price=49.99', 'price=49.99::discount_price=39.99');
                    instModified = true;
                }
            }
        }
    }
    if (instModified) {
        const newInstWs = XLSX.utils.aoa_to_sheet(instData);
        if (instWs['!cols']) newInstWs['!cols'] = instWs['!cols'];
        if (instWs['!merges']) newInstWs['!merges'] = instWs['!merges'];
        wb.Sheets['Instructions'] = newInstWs;
        console.log('Updated Instructions for discount_price.');
    }
}

// Save back
XLSX.writeFile(wb, filePath);
console.log('Template modified successfully');
