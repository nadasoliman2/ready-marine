'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Truck, FileText, RefreshCcw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { pagesApi } from '../lib/api';

const ICONS = {
  'privacy-policy': ShieldCheck,
  'shipping-policy': Truck,
  'delivery-and-return': RefreshCcw,
  'terms-and-conditions': FileText,
};

export default function PolicyPageLayout({ slug }) {
  const { language } = useApp();
  const isAr = language === 'ar';
  
  const [pageData, setPageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchPage = async () => {
      try {
        setLoading(true);
        const res = await pagesApi.getPageBySlug(slug);
        setPageData(res.page);
      } catch (err) {
        setError(err.message || 'Failed to load page content.');
      } finally {
        setLoading(false);
      }
    };
    fetchPage();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-zinc-50 dark:bg-[#0E1012]">
        <Loader2 size={40} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  if (error || !pageData) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center bg-zinc-50 dark:bg-[#0E1012] px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-marine-cyan/10 flex items-center justify-center text-marine-primary mb-4">
          <FileText size={28} />
        </div>
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white mb-2">
          {isAr ? 'الصفحة غير موجودة' : 'Page Not Found'}
        </h1>
        <p className="text-zinc-500 max-w-md">
          {isAr ? 'تعذر تحميل محتوى هذه الصفحة. ربما لم يتم إضافتها بعد.' : 'We could not load the content for this page. It might not be added yet.'}
        </p>
      </div>
    );
  }

  const title = isAr ? pageData.title_ar : pageData.title_en;
  const content = isAr ? pageData.content_ar : pageData.content_en;
  const Icon = ICONS[slug] || FileText;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#0E1012] font-sans text-zinc-900 dark:text-zinc-100" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Hero Section */}
      <div className="relative bg-zinc-900 overflow-hidden pt-8 pb-8 sm:pt-24 sm:pb-16 lg:pt-32 lg:pb-24">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-marine-navy  z-10" />
          {/* Subtle grid pattern background */}
          <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-10" />
          <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-marine-navy to-transparent z-10" />
        </div>
        
        <div className="relative z-20 max-w-4xl mx-auto px-4 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-marine-cyan/20 backdrop-blur-md border border-marine-cyan/30 text-marine-primary mb-3 sm:mb-6">
            <Icon size={32} />
          </div>
          <h1 className="text-2xl md:text-5xl font-black text-white mb-2 sm:mb-4 tracking-tight leading-tight">
            {title}
          </h1>
          <p className="text-zinc-400 max-w-2xl mx-auto text-sm sm:text-lg">
            {isAr ? 'نلتزم بالشفافية والوضوح في جميع تعاملاتنا.' : 'We are committed to transparency and clarity in all our dealings.'}
          </p>
        </div>
      </div>

      {/* Content Section */}
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-12 md:py-20">
        <div className="bg-white dark:bg-[#14171A] rounded-3xl p-6 md:p-12 shadow-xl border border-zinc-200 dark:border-white/5">
          <div 
            className="prose prose-zinc dark:prose-invert max-w-none text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed space-y-6 text-sm md:text-base"
          >
            {content.split('\n').map((paragraph, index) => {
              if (!paragraph.trim()) return <br key={index} />;
              
              // Simple parsing for numbered lists or headings
              const isHeading = /^\d+\.\s/.test(paragraph) || paragraph.length < 50 && paragraph.endsWith(':');
              const isBullet = paragraph.startsWith('•') || paragraph.startsWith('-');

              if (isHeading) {
                return <h3 key={index} className="text-lg md:text-xl font-bold text-zinc-900 dark:text-white mt-8 mb-4">{paragraph}</h3>;
              }

              if (isBullet) {
                return (
                  <div key={index} className="flex items-start gap-3 my-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-marine-cyan mt-2 shrink-0" />
                    <span>{paragraph.substring(1).trim()}</span>
                  </div>
                );
              }

              return <p key={index}>{paragraph}</p>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
