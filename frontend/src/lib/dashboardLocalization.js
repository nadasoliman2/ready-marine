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
  Images: 'الصور',
  Content: 'المحتوى',
  Compatibility: 'التوافق',
  Discount: 'الخصم',
  Quantity: 'الكمية',
};

const BULK_MESSAGE_PATTERNS = [
  [/sku is required/i, 'رمز المنتج (SKU) مطلوب'],
  [/price must be positive/i, 'يجب أن يكون السعر رقماً موجباً'],
  [/pick a category/i, 'اختر فئة'],
  [/final.*category|most specific.*category/i, 'اختر فئة نهائية هي الأكثر تحديداً'],
  [/at least one image/i, 'أضف صورة واحدة على الأقل'],
  [/complete the en or ar set/i, 'أكمل مجموعة إنجليزية أو عربية: العنوان والعنوان الفرعي والوصف'],
  [/compatible cars|mark universal/i, 'أضف سيارات متوافقة أو فعّل خيار القطعة العامة'],
  [/remove cars|turn off universal/i, 'احذف السيارات أو أوقف خيار القطعة العامة'],
  [/discount.*less than.*price/i, 'يجب أن يكون سعر الخصم أقل من السعر'],
  [/quantity.*non-negative integer/i, 'يجب أن تكون الكمية عدداً صحيحاً غير سالب'],
  [/duplicate.*sku/i, 'رمز المنتج مستخدم بالفعل'],
  [/required/i, 'هذا الحقل مطلوب'],
];

export function localizeBulkError(error, language) {
  if (language !== 'ar') return error;
  const matched = BULK_MESSAGE_PATTERNS.find(([pattern]) => pattern.test(error?.message || ''));
  return {
    ...error,
    field: BULK_FIELD_AR[error?.field] || error?.field || 'خطأ',
    message: matched?.[1] || 'تعذر حفظ هذا الصف. راجع بياناته وحاول مرة أخرى.',
  };
}
