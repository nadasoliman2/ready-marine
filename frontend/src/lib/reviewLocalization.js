/** Copy for the review link, the product-page reviews, and admin moderation. */

export const reviewErrorCopy = (code, isAr) => ({
    INVITE_NOT_FOUND: isAr
        ? 'رابط التقييم غير صالح.'
        : 'This review link is not valid.',
    INVITE_ALREADY_USED: isAr
        ? 'شكراً! سبق وقيّمت هذا الطلب.'
        : 'Thank you! You have already reviewed this order.',
    INVITE_EXPIRED: isAr
        ? 'انتهت صلاحية رابط التقييم.'
        : 'This review link has expired.',
    PRODUCT_NOT_IN_ORDER: isAr
        ? 'أحد المنتجات غير موجود في هذا الطلب.'
        : 'One of the products is not part of this order.',
    VENDOR_NOT_IN_ORDER: isAr
        ? 'أحد المتاجر غير موجود في هذا الطلب.'
        : 'One of the sellers is not part of this order.',
    UPLOAD_FAILED: isAr
        ? 'تعذر رفع الصورة. جرب صورة أصغر أو بصيغة أخرى.'
        : 'The image could not be uploaded. Try a smaller file or another format.',
    NO_FILE: isAr
        ? 'اختر صورة أولاً.'
        : 'Pick an image first.',
    INVALID_RATING: isAr
        ? 'اختر تقييماً من نجمة إلى 5 نجوم.'
        : 'Pick a rating between 1 and 5 stars.',
    NO_RATINGS: isAr
        ? 'قيّم منتجاً واحداً على الأقل.'
        : 'Rate at least one product.',
    RATE_LIMITED: isAr
        ? 'محاولات كثيرة. حاول مرة أخرى بعد قليل.'
        : 'Too many attempts. Please try again shortly.',
}[code] || null);

export const reviewCopy = (isAr) => (isAr ? {
    pageTitle: 'قيّم طلبك',
    intro: 'قيّمك بيساعد باقي العملاء ويوصل للتاجر. اختر عدد النجوم لكل منتج.',
    orderRef: 'رقم الطلب',
    optionalComment: 'اكتب رأيك (اختياري)',
    submit: 'إرسال التقييم',
    submitting: 'جاري الإرسال...',
    thanksTitle: 'شكراً لك',
    thanksBody: 'وصلنا تقييمك، وهيظهر في صفحة المنتج بعد المراجعة.',
    backHome: 'العودة للرئيسية',
    ratingRequired: 'اختر تقييماً لمنتج أو متجر واحد على الأقل.',
    starLabel: (n) => `${n} من 5 نجوم`,

    // Photos
    addPhotos: 'أضف صورة (اختياري)',
    photosHint: (n) => `حتى ${n} صور · 5 ميجا للصورة`,
    uploading: 'جاري رفع الصورة...',
    removePhoto: 'حذف الصورة',

    // Vendor block on the review form
    rateVendorTitle: 'قيّم المتجر',
    rateVendorHint: 'التعامل، التغليف، وسرعة التجهيز.',
    soldByVendor: 'منتجات من',

    // Product page
    reviewsTitle: 'تقييمات العملاء',
    noReviews: 'لا توجد تقييمات بعد لهذا المنتج.',
    verifiedPurchase: 'عملية شراء موثقة',
    basedOn: (n) => `بناءً على ${n} تقييم`,
    showMore: 'عرض المزيد',

    // Store page / vendor cards
    vendorReviewsTitle: 'تقييمات المتجر',
    noVendorReviews: 'لا توجد تقييمات بعد لهذا المتجر.',
    completedOrders: 'طلب مكتمل',
    completedOrdersLong: (n) => `${n} طلب تم تسليمه بنجاح`,
    noCompletedOrders: 'متجر جديد',

    // Admin
    adminTitle: 'تقييمات المنتجات',
    targetProduct: 'تقييم منتج',
    targetVendor: 'تقييم متجر',
    onVendor: 'على متجر',
    reviewPhotos: 'صور العميل',
    pending: 'بانتظار المراجعة',
    approved: 'منشورة',
    rejected: 'مرفوضة',
    all: 'الكل',
    approve: 'نشر',
    reject: 'رفض',
    rejectReason: 'سبب الرفض (اختياري)',
    noPending: 'لا توجد تقييمات بانتظار المراجعة.',
    onProduct: 'على منتج',
    by: 'بواسطة',
    moderatedBy: 'روجع بواسطة',
} : {
    pageTitle: 'Rate your order',
    intro: 'Your review helps other customers and reaches the vendor. Pick a star rating for each product.',
    orderRef: 'Order',
    optionalComment: 'Write your thoughts (optional)',
    submit: 'Submit review',
    submitting: 'Submitting...',
    thanksTitle: 'Thank you',
    thanksBody: 'We received your review. It will appear on the product page once it has been checked.',
    backHome: 'Back to home',
    ratingRequired: 'Pick a rating for at least one product or store.',
    starLabel: (n) => `${n} out of 5 stars`,

    // Photos
    addPhotos: 'Add a photo (optional)',
    photosHint: (n) => `Up to ${n} photos · 5MB each`,
    uploading: 'Uploading...',
    removePhoto: 'Remove photo',

    // Vendor block on the review form
    rateVendorTitle: 'Rate the store',
    rateVendorHint: 'Service, packing, and how quickly they got it out.',
    soldByVendor: 'Sold by',

    // Product page
    reviewsTitle: 'Customer reviews',
    noReviews: 'No reviews yet for this product.',
    verifiedPurchase: 'Verified purchase',
    basedOn: (n) => `Based on ${n} review${n === 1 ? '' : 's'}`,
    showMore: 'Show more',

    // Store page / vendor cards
    vendorReviewsTitle: 'Store reviews',
    noVendorReviews: 'No reviews yet for this store.',
    completedOrders: 'completed orders',
    completedOrdersLong: (n) => `${n} order${n === 1 ? '' : 's'} delivered successfully`,
    noCompletedOrders: 'New store',

    // Admin
    adminTitle: 'Product Reviews',
    targetProduct: 'Product review',
    targetVendor: 'Store review',
    onVendor: 'on store',
    reviewPhotos: 'Customer photos',
    pending: 'Pending',
    approved: 'Published',
    rejected: 'Rejected',
    all: 'All',
    approve: 'Publish',
    reject: 'Reject',
    rejectReason: 'Rejection reason (optional)',
    noPending: 'No reviews waiting for moderation.',
    onProduct: 'on',
    by: 'by',
    moderatedBy: 'Moderated by',
});
