export function formatLocalizedDate(value, isAr = false, options = {}) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  if (!isAr) {
    return date.toLocaleDateString('en-US', options);
  }

  const hijri = date.toLocaleDateString('ar-SA-u-ca-islamic-umalqura', options);
  const gregorian = date.toLocaleDateString('ar-EG-u-ca-gregory', options);

  return `${hijri} / ${gregorian} ميلادي`;
}
