'use client';

import { ExternalLink, PlayCircle, X } from 'lucide-react';
import Overlay from '../Overlay';

export const vendorEducationVideos = [
  {
    id: 'cSu24-SEr2A',
    url: 'https://youtu.be/cSu24-SEr2A?si=HKv0_wHESilqnHQ3',
    titleAr: 'طريقة تسجيل حساب تاجر جديد على Ready Marine خطوة بخطوة',
    titleEn: 'Step-by-step guide to creating a new vendor account on Ready Marine',
  },
  {
    id: 'cc1A4d9Dqdc',
    url: 'https://youtu.be/cc1A4d9Dqdc?si=f6NceQ5uG5_mDb1H',
    titleAr: 'جولة في لوحة تحكم التاجر على Ready Marine | المنتجات والطلبات والأرباح',
    titleEn: 'Tour of the Ready Marine vendor dashboard | Products, orders, and earnings',
  },
  {
    id: 'Gg128Z4WEnA',
    url: 'https://youtu.be/Gg128Z4WEnA?si=-A4hxrvtkjv2a3rK',
    titleAr: 'إزاي ترفع منتجاتك بسرعة على Ready Marine | إضافة المنتجات وتوافق السيارات',
    titleEn: 'How to upload your products quickly on Ready Marine | Adding products and car compatibility',
  },
  {
    id: 'Oz3YPqdQG6I',
    url: 'https://youtu.be/Oz3YPqdQG6I?si=ZTv6iLQniC9TI8hv',
    titleAr: 'إزاي تضيف منتج بشكل تفصيلي على Ready Marine | شرح بيانات المنتج وتوافق السيارة',
    titleEn: 'How to add a product in detail on Ready Marine | Product details and car compatibility',
  },
];

export const vendorEducationLabel = (isAr) => (
  isAr ? 'شاهد فيديوهات تعليمية' : 'Watch platform Educational videos'
);

export default function VendorEducationModal({ open, onClose, language = 'en' }) {
  const isAr = language === 'ar';

  if (!open) return null;

  return (
    <Overlay className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#14171A]">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-white/10">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-marine-primary">
              {isAr ? 'مركز تعليم التاجر' : 'Vendor learning center'}
            </p>
            <h2 className="mt-1 text-xl font-black text-zinc-900 dark:text-white">
              {vendorEducationLabel(isAr)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label={isAr ? 'إغلاق' : 'Close'}
          >
            <X size={22} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-88px)] overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {vendorEducationVideos.map((video) => (
              <a
                key={video.id}
                href={video.url}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-xl border border-zinc-200 bg-white text-start shadow-sm transition-all hover:-translate-y-0.5 hover:border-marine-cyan hover:shadow-lg dark:border-white/10 dark:bg-[#0E1012]"
              >
                <div className="relative aspect-video bg-zinc-100 dark:bg-white/5">
                  <img
                    src={`https://img.youtube.com/vi/${video.id}/hqdefault.jpg`}
                    alt={isAr ? video.titleAr : video.titleEn}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/35">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-marine-cyan text-white shadow-xl shadow-marine-cyan/30">
                      <PlayCircle size={30} />
                    </span>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  <h3 className="min-h-[3rem] text-sm font-black leading-6 text-zinc-900 dark:text-white">
                    {isAr ? video.titleAr : video.titleEn}
                  </h3>
                  <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-marine-primary">
                    {isAr ? 'مشاهدة الفيديو' : 'Watch video'}
                    <ExternalLink size={14} />
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </Overlay>
  );
}
