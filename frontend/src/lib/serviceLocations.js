export function getServiceLocations(service = {}) {
  const locations = Array.isArray(service.locations)
    ? service.locations
      .map(location => {
        const legacyName = String(location?.name || '').trim();
        const legacyLanguage = location?.language === 'ar' ? 'ar' : 'en';
        return {
          name_en: String(location?.name_en || (legacyLanguage === 'en' ? legacyName : '')).trim(),
          name_ar: String(location?.name_ar || (legacyLanguage === 'ar' ? legacyName : '')).trim(),
          link: String(location?.link || '').trim(),
        };
      })
      .filter(location => location.name_en || location.name_ar)
    : [];

  if (locations.length) return locations;

  const legacy = [];
  const locationEn = String(service.vendor_location_en || '').trim();
  const locationAr = String(service.vendor_location_ar || '').trim();

  if (locationEn) {
    legacy.push({ name_en: locationEn, name_ar: locationAr, link: '' });
  } else if (locationAr) {
    legacy.push({ name_en: '', name_ar: locationAr, link: '' });
  }

  return legacy;
}

export function pickServiceLocation(service = {}, language = 'en') {
  const location = getServiceLocations(service)[0];
  if (!location) return null;

  const name = language === 'ar'
    ? (location.name_ar || location.name_en)
    : (location.name_en || location.name_ar);

  return { ...location, name };
}

export function getLocalizedServiceLocations(service = {}, language = 'en') {
  return getServiceLocations(service).map(location => ({
    ...location,
    name: language === 'ar'
      ? (location.name_ar || location.name_en)
      : (location.name_en || location.name_ar),
  }));
}

export function getServiceLocationSearchValues(service = {}) {
  return [
    ...getServiceLocations(service).flatMap(location => [location.name_en, location.name_ar, location.link]),
    service.vendor_location_en,
    service.vendor_location_ar,
  ];
}
