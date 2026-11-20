const SHIPMENT_STATUS_AR = {
  PENDING: 'قيد الانتظار',
  PICKED_UP: 'تم الاستلام',
  IN_TRANSIT: 'قيد النقل',
  OUT_FOR_DELIVERY: 'خرج للتسليم',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
  RETURNED: 'تم الإرجاع',
};

const RETURN_HISTORY_AR = {
  return_requested: ['تم إرسال طلب الإرجاع', 'تم إنشاء طلب الإرجاع.'],
  vendor_approved: ['وافق البائع على الإرجاع', 'تمت الموافقة على طلب الإرجاع من البائع.'],
  vendor_rejected: ['رفض البائع الإرجاع', 'تم رفض طلب الإرجاع من البائع.'],
  escalated_to_admin: ['تم التصعيد إلى الإدارة', 'تم إرسال طلب الإرجاع إلى الإدارة للمراجعة النهائية.'],
  admin_approved: ['وافقت الإدارة على الإرجاع', 'تمت الموافقة على طلب الإرجاع من الإدارة.'],
  admin_rejected: ['رفضت الإدارة الإرجاع', 'تم رفض طلب الإرجاع من الإدارة.'],
  return_cancelled: ['تم إلغاء طلب الإرجاع', 'ألغى العميل طلب الإرجاع.'],
  return_shipment_created: ['تم إنشاء شحنة الإرجاع', 'تم إنشاء شحنة لإعادة المنتجات.'],
  return_auto_received: ['تم استلام شحنة الإرجاع', 'تم تسجيل وصول المنتجات المرتجعة تلقائياً.'],
  return_received: ['تم استلام المنتجات المرتجعة', 'تم تأكيد استلام المنتجات المرتجعة.'],
  fault_type_inferred: ['تم تحديد جهة المسؤولية', 'تم تحديد جهة المسؤولية وفقاً لسبب الإرجاع.'],
  refund_processing: ['بدأ تنفيذ الاسترداد', 'بدأت معالجة مبلغ الاسترداد.'],
  refund_completed: ['اكتمل الاسترداد', 'تم تنفيذ مبلغ الاسترداد بنجاح.'],
  refund_failed: ['فشل الاسترداد', 'تعذر تنفيذ مبلغ الاسترداد.'],
};

export function localizeShipmentStatus(status, language) {
  if (!status) return '—';
  if (language !== 'ar') return String(status).replace(/_/g, ' ');
  return SHIPMENT_STATUS_AR[String(status).toUpperCase()] || 'قيد المعالجة';
}

export function localizeReturnHistory(entry, language) {
  if (language !== 'ar') {
    return { title: entry.title, details: entry.details };
  }

  const translated = RETURN_HISTORY_AR[entry.action];
  if (!translated) {
    return { title: 'تحديث طلب الإرجاع', details: entry.details || '' };
  }

  const isManualNote = entry.details
    && !/return|vendor|admin|refund|fault type|customer/i.test(entry.details);

  return {
    title: translated[0],
    details: isManualNote ? entry.details : translated[1],
  };
}

const BULK_FIELD_AR = {
  SKU: 'رمز المنتج',
  Price: 'السعر',
  Category: 'الفئة',
  Brand: 'الماركة المصنعة',
  product_brand: 'الماركة المصنعة',
  product_brand_id: 'الماركة المصنعة',
  Catalog: 'الكتالوج',
  PartType: 'نوع القطعة',
  'Part Type': 'نوع القطعة',
  part_type: 'نوع القطعة',
  Images: 'الصور',
  Content: 'المحتوى',
  Compatibility: 'التوافق',
  Discount: 'الخصم',
  'Discount Type': 'نوع الخصم',
  'Discount Value': 'قيمة الخصم',
  Quantity: 'الكمية',
  Weight: 'الوزن',
  Dimensions: 'الأبعاد',
  Shipping: 'الشحن',
  'Shipping Class': 'فئة الشحن',
  'Target Audiences': 'المجموعات المخصصة',
  Variants: 'التنويعات',
  Options: 'الخيارات',
};

const BULK_MESSAGE_PATTERNS = [
  [/sku is required/i, 'رمز المنتج (SKU) مطلوب'],
  [/price must be positive/i, 'يجب أن يكون السعر رقماً موجباً'],
  [/brand.*required|الماركة.*مطلوبة/i, 'الماركة المصنعة مطلوبة'],
  [/part.*type.*required/i, 'نوع القطعة مطلوب (أصلي / OEM / تجاري)'],
  [/pick a category|category is required/i, 'الفئة مطلوبة، اختر فئة نهائية من القائمة'],
  [/final.*category|most specific.*category/i, 'اختر فئة نهائية هي الأكثر تحديداً (بدون فئات فرعية)'],
  [/at least one image/i, 'أضف صورة واحدة على الأقل'],
  [/complete the en or ar set|at least one complete language/i, 'أكمل مجموعة إنجليزية أو عربية كاملة: العنوان والعنوان الفرعي والوصف'],
  [/compatible (cars|vessels)|mark universal/i, 'أضف قوارب/محركات متوافقة أو فعّل خيار منتج عام'],
  [/remove (cars|vessels)|turn off universal/i, 'احذف القوارب/المحركات أو أوقف خيار منتج عام'],
  [/discount.*less than.*price/i, 'يجب أن يكون سعر الخصم أقل من السعر الأساسي'],
  [/quantity.*non-negative integer/i, 'يجب أن تكون الكمية عدداً صحيحاً غير سالب'],
  [/duplicate.*sku/i, 'رمز المنتج مستخدم بالفعل'],
  [/catalog/i, 'تم حفظ المنتج بشكل مستقل'],
  [/required/i, 'هذا الحقل مطلوب'],
];

export function localizeBulkError(error, language) {
  if (language !== 'ar') return error;
  const rawMsg = error?.message || '';
  // If the message is already in Arabic, keep it
  const isArabicMsg = /[\u0621-\u064A]/.test(rawMsg);
  const matched = BULK_MESSAGE_PATTERNS.find(([pattern]) => pattern.test(rawMsg));

  return {
    ...error,
    field: BULK_FIELD_AR[error?.field] || error?.field || 'خطأ',
    message: matched?.[1] || (isArabicMsg ? rawMsg : 'تعذر التحقق من هذا الحقل، يرجى مراجعته.'),
  };
}

export function localizeGeneralError(err, language) {
  const msg = typeof err === 'string' ? err : (err?.message || '');
  if (language !== 'ar') return msg || 'An error occurred';
  if (/[\u0621-\u064A]/.test(msg)) return msg;

  if (/is not defined|referenceerror|syntaxerror|typeerror|500/i.test(msg)) {
    return 'حدث خطأ تقني أثناء معالجة البيانات، يُرجى المحاولة مرة أخرى.';
  }
  if (/network error|failed to fetch/i.test(msg)) {
    return 'تعذر الاتصال بالخادم، يُرجى التحقق من اتصال الإنترنت.';
  }
  if (/file too large/i.test(msg)) {
    return 'حجم الملف كبير جداً (الحد الأقصى 5 ميجابايت).';
  }
  if (/only.*xlsx/i.test(msg)) {
    return 'يُقبل فقط ملفات Excel بتنسيق (.xlsx).';
  }
  if (/vendor not found/i.test(msg)) {
    return 'لم يتم العثور على التاجر المحدد.';
  }
  return msg ? `حدث خطأ: ${msg}` : 'حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى.';
}
