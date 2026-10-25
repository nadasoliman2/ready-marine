/**
 * WhatsApp link for a service ad, with the opening message already written.
 *
 * The advertiser gets many chats a day and cannot tell where each one came from. The
 * pre-filled text says the person is writing about THIS ad on Ready Marine, names the ad,
 * and links back to it, so the advertiser knows what is being asked about before the
 * first reply. The sender can still edit the message before sending.
 */
export function serviceWhatsappUrl(number, service, language = 'en') {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '#';

  const isAr = language === 'ar';
  const title = isAr
    ? (service?.title_ar || service?.title_en || '')
    : (service?.title_en || service?.title_ar || '');
  const slug = isAr
    ? (service?.slug_ar || service?.slug_en || '')
    : (service?.slug_en || service?.slug_ar || '');
  const origin = typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_SITE_URL || '');
  const link = slug && origin ? `${origin}/services/${slug}` : '';

  const message = isAr
    ? `مرحباً، أتواصل معكم بخصوص إعلانكم على موقع Ready Marine${title ? `: "${title}"` : ''}${link ? `\n${link}` : ''}`
    : `Hi, I'm contacting you about your ad on Ready Marine${title ? `: "${title}"` : ''}${link ? `\n${link}` : ''}`;

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
