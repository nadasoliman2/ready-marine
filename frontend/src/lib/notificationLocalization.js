const formatArabicDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
};

export function localizeNotification(notification, language) {
  if (language !== 'ar') {
    return {
      title: notification.title,
      message: notification.message,
    };
  }

  const data = notification.data || {};
  const packageName = data.packageNameAr || data.packageName || 'الباقة';
  const returnNumber = data.return_number || '';
  const refundNumber = data.refund_number || '';

  const content = {
    trial_activated: {
      title: 'تم تفعيل الفترة التجريبية',
      message: `تم تفعيل الفترة التجريبية لباقة «${packageName}»${data.expiresAt ? ` حتى ${formatArabicDate(data.expiresAt)}` : ''}.`,
    },
    subscription_activated: {
      title: 'تم تفعيل الاشتراك',
      message: `أصبحت باقة «${packageName}» نشطة الآن${data.expiresAt ? ` حتى ${formatArabicDate(data.expiresAt)}` : ''}.`,
    },
    subscription_expiring_soon: {
      title: data.daysUntilExpiry === 1 ? 'ينتهي الاشتراك غداً' : 'الاشتراك على وشك الانتهاء',
      message: `ستنتهي باقة «${packageName}» خلال ${data.daysUntilExpiry || 0} يوم. جدّد الآن للحفاظ على ظهور منتجاتك.`,
    },
    subscription_expired: {
      title: 'انتهى الاشتراك',
      message: `انتهى اشتراك باقة «${packageName}» وتم إخفاء المنتجات. أعد الاشتراك لاستعادة ظهورها.`,
    },
    subscription_cancelled: {
      title: 'تم إلغاء الاشتراك',
      message: `تم إلغاء اشتراك باقة «${packageName}» وإخفاء المنتجات.`,
    },
    account_became_not_subscribed: {
      title: 'الحساب غير مشترك',
      message: 'لا يوجد اشتراك نشط للحساب. لا يمكنك نشر المنتجات أو بيعها حتى تعيد الاشتراك.',
    },
    account_suspended: {
      title: 'تم إيقاف الحساب',
      message: `تم إيقاف حسابك${data.reason ? ` للسبب التالي: ${data.reason}` : ''}. تواصل مع الدعم لمزيد من المعلومات.`,
    },
    account_reactivated: {
      title: 'تمت إعادة تفعيل الحساب',
      message: 'تمت إعادة تفعيل حسابك. أهلاً بعودتك!',
    },
    product_visibility_restored: {
      title: 'عادت المنتجات للظهور',
      message: data.productCount
        ? `أصبحت منتجاتك ظاهرة في المتجر مرة أخرى. تمت استعادة ${data.productCount} منتج.`
        : 'أصبحت منتجاتك ظاهرة في المتجر مرة أخرى.',
    },
    renewal_successful: {
      title: 'تم تجديد الاشتراك',
      message: `تم تجديد باقة «${packageName}»${data.expiresAt ? ` حتى ${formatArabicDate(data.expiresAt)}` : ''}.`,
    },
    product_limit_warning: {
      title: 'تنبيه حد المنتجات',
      message: `لديك ${data.used || 0} من أصل ${data.max || 0} منتج منشور، والمتبقي ${data.remaining || 0}. قم بترقية باقتك لنشر المزيد.`,
    },
    new_order_received: {
      title: 'تم استلام طلب جديد',
      message: `الطلب رقم ${data.reference || ''} بانتظار مراجعتك${data.item_count ? ` ويحتوي على ${data.item_count} منتج` : ''}.`,
    },
    return_request_received: {
      title: 'طلب إرجاع جديد',
      message: `تم استلام طلب الإرجاع ${returnNumber}. يرجى مراجعته.`,
    },
    return_admin_approved: {
      title: 'تمت الموافقة على الإرجاع',
      message: `تمت الموافقة على طلب الإرجاع ${returnNumber} وسيتم ترتيب شحنة الإرجاع.`,
    },
    return_admin_rejected: {
      title: 'تم رفض الإرجاع',
      message: `تم رفض طلب الإرجاع ${returnNumber}.`,
    },
    return_shipment_created: {
      title: 'تم إنشاء شحنة الإرجاع',
      message: `تم تحديد موعد استلام لطلب الإرجاع ${returnNumber}.`,
    },
    return_received_by_vendor: {
      title: 'تم استلام المنتجات المرتجعة',
      message: `تم استلام منتجات طلب الإرجاع ${returnNumber} وسيبدأ تنفيذ الاسترداد قريباً.`,
    },
    refund_processing: {
      title: 'جاري تنفيذ الاسترداد',
      message: `جاري تنفيذ استرداد طلب الإرجاع ${returnNumber}${data.amount ? ` بقيمة ${data.amount} ج.م` : ''}.`,
    },
    refund_completed: {
      title: 'اكتمل الاسترداد',
      message: `اكتمل الاسترداد ${refundNumber}${data.commission_reversal ? ` وتم تعديل العمولة بقيمة ${data.commission_reversal} ج.م` : ''}.`,
    },
    earnings_available: {
      title: 'الأرباح متاحة',
      message: data.amount ? `أصبحت أرباح بقيمة ${data.amount} ج.م متاحة في محفظتك.` : 'أصبحت أرباح جديدة متاحة في محفظتك.',
    },
    earnings_clawback: {
      title: 'تم تعديل الأرباح',
      message: data.amount ? `تم خصم ${data.amount} ج.م من الأرباح بسبب استرداد أو إلغاء.` : 'تم تعديل رصيد الأرباح بسبب استرداد أو إلغاء.',
    },
    withdrawal_approved: {
      title: 'تمت الموافقة على طلب السحب',
      message: data.amount ? `تمت الموافقة على سحب ${data.amount} ج.م.` : 'تمت الموافقة على طلب السحب.',
    },
    withdrawal_rejected: {
      title: 'تم رفض طلب السحب',
      message: data.reason ? `تم رفض طلب السحب للسبب التالي: ${data.reason}` : 'تم رفض طلب السحب.',
    },
    withdrawal_paid: {
      title: 'تم دفع طلب السحب',
      message: data.amount ? `تم دفع مبلغ ${data.amount} ج.م.` : 'تم دفع طلب السحب.',
    },
    // Products the admin published, with what was corrected on them (data.fixes: key → count).
    products_published: {
      title: (data.count || 1) > 1 ? `اتنشر ${data.count} منتج ليك` : 'منتجك اتنشر',
      message: (() => {
        const names = { title: 'العنوان', description: 'الوصف', category: 'الفئة', brand: 'الماركة', part_type: 'نوع القطعة', part_number: 'رقم القطعة', sku: 'كود المنتج', gtin: 'الباركود', price: 'السعر', discount: 'الخصم', fitment: 'العربيات المناسبة', images: 'الصور', stock: 'المخزون' };
        const many = (data.count || 1) > 1;
        const fixed = Object.entries(data.fixes || {}).map(([k, n]) => `${names[k] || k}${many ? ` (${n})` : ''}`);
        const head = many ? `${data.count} منتج ليك اتنشروا على ريدي مارين.` : `«${data.titles?.[0] || 'منتجك'}» اتنشر على ريدي مارين.`;
        return fixed.length ? `${head} ظبطنالك ${fixed.join('، ')} قبل النشر.` : head;
      })(),
    },
    ad_approved: {
      title: 'تمت الموافقة على الإعلان',
      message: 'تمت الموافقة على طلب الإعلان الخاص بك.',
    },
    ad_rejected: {
      title: 'تم رفض الإعلان',
      message: data.reason ? `تم رفض طلب الإعلان للسبب التالي: ${data.reason}` : 'تم رفض طلب الإعلان.',
    },
    // Prepaid Bosta bundle. Rebuilt from `data` rather than echoed from the server so the
    // wording matches every other notification here — and so an unmapped type never falls
    // through to the generic "you have a notification", which would swallow the numbers.
    bosta_bundle_low: {
      title: 'رصيد باقة بوسطة قرب يخلص',
      message: `فاضل ${data.remaining_orders ?? 0} شحنة بس في الباقة. اشتري الباقة الجاية قبل ما الشحن يقف.`,
    },
    bosta_bundle_expiring: {
      title: 'باقة بوسطة قرب تخلص مدتها',
      message: `فاضل ${data.days_left ?? 0} يوم على انتهاء الباقة، ولسه عندك ${data.remaining_orders ?? 0} شحنة متستخدمتش`
        + `${data.value_at_risk ? ` بقيمة ${data.value_at_risk} ج.م` : ''}. الشحنات دي بتضيع ومش بتترحّل.`,
    },
    bosta_bundle_depleted: {
      title: 'رصيد باقة بوسطة خلص',
      message: 'مفيش شحنات فاضلة في الباقة. الشحن على بوسطة هيقف لحد ما تشتري باقة جديدة.',
    },
  }[notification.type];

  return content || {
    title: 'إشعار',
    message: 'لديك إشعار جديد.',
  };
}
