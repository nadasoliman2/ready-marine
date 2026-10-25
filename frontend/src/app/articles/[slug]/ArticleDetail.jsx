'use client';

import { useApp } from '../../../context/AppContext';
import Link from '../../../components/LocaleLink';
import { Calendar, Eye, Tag, ArrowLeft, User, BookOpen, ShoppingBag } from 'lucide-react';
import { formatLocalizedDate } from '../../../lib/dateFormat';

export default function ArticleDetail({ article }) {
  const { language, t } = useApp();
  const isAr = language === 'ar';

  if (!article) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="text-center space-y-4">
          <BookOpen size={48} className="mx-auto text-zinc-200" />
          <h1 className="text-2xl font-black text-zinc-900">{t.articleNotFound || (isAr ? 'المقال غير موجود.' : 'Article not found.')}</h1>
          <Link href="/articles" className="text-marine-primary font-bold hover:underline">
            {isAr ? 'العودة للمقالات' : 'Back to Articles'}
          </Link>
        </div>
      </div>
    );
  }

  const title = isAr ? (article.title_ar || article.title_en) : (article.title_en || article.title_ar);
  const content = isAr ? (article.content_ar || article.content_en) : (article.content_en || article.content_ar);
  const excerpt = isAr ? (article.excerpt_ar || article.excerpt_en) : (article.excerpt_en || article.excerpt_ar);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return formatLocalizedDate(dateStr, isAr, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  return (
    <div className="bg-white min-h-screen" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Featured Image Hero or Standard Header */}
      {article.featured_image ? (
        <div className="relative h-[400px] md:h-[500px] bg-zinc-900 overflow-hidden flex flex-col justify-end">
          <img
            src={article.featured_image}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover opacity-50"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          
          <div className="relative z-10 max-w-4xl mx-auto px-4 w-full pb-10">
            <Link href="/articles" className="inline-flex items-center gap-2 text-sm font-bold text-white/70 hover:text-white transition-colors mb-6">
              <ArrowLeft size={16} className="rtl:rotate-180" />
              {isAr ? 'العودة للمقالات' : 'Back to Articles'}
            </Link>

            {article.category && (
              <span className="inline-block bg-marine-cyan text-white text-xs font-bold px-3 py-1 rounded-full mb-4">
                {article.category}
              </span>
            )}
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight mb-4 drop-shadow-lg">
              {title}
            </h1>
            {excerpt && (
              <p className="text-lg font-medium text-white/80 leading-relaxed mb-6 max-w-2xl">
                {excerpt}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4 text-sm text-white/70">
              {article.author_name && (
                <span className="flex items-center gap-1.5">
                  <User size={14} />
                  {article.author_name}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Calendar size={14} />
                {t.publishedOn || (isAr ? 'نُشر في' : 'Published on')} {formatDate(article.published_at || article.created_at)}
              </span>
              <span className="flex items-center gap-1.5">
                <Eye size={14} />
                {article.view_count || 0} {t.views || (isAr ? 'مشاهدات' : 'views')}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto px-4 pt-8">
          <Link href="/articles" className="inline-flex items-center gap-2 text-sm font-bold text-zinc-400 hover:text-marine-primary transition-colors mb-6">
            <ArrowLeft size={16} className="rtl:rotate-180" />
            {isAr ? 'العودة للمقالات' : 'Back to Articles'}
          </Link>
          <header className="pb-8 border-b border-zinc-100">
            {article.category && (
              <span className="inline-block bg-marine-cyan text-white text-xs font-bold px-3 py-1 rounded-full mb-4">
                {article.category}
              </span>
            )}
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-black text-[#09090b] tracking-tight leading-tight mb-6">
              {title}
            </h1>
            {excerpt && (
              <p className="text-lg font-medium text-zinc-500 leading-relaxed mb-6">
                {excerpt}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-400">
              {article.author_name && (
                <span className="flex items-center gap-1.5">
                  <User size={14} />
                  {article.author_name}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Calendar size={14} />
                {t.publishedOn || (isAr ? 'نُشر في' : 'Published on')} {formatDate(article.published_at || article.created_at)}
              </span>
              <span className="flex items-center gap-1.5">
                <Eye size={14} />
                {article.view_count || 0} {t.views || (isAr ? 'مشاهدات' : 'views')}
              </span>
            </div>
          </header>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4">

        {/* Article Content */}
        <article className="py-10">
          <div
            className="prose prose-lg max-w-none prose-headings:font-black prose-headings:text-[#09090b] prose-p:text-zinc-600 prose-p:leading-relaxed prose-a:text-marine-primary prose-a:no-underline hover:prose-a:underline prose-img:rounded-2xl prose-blockquote:border-marine-cyan prose-strong:text-[#09090b]"
            dangerouslySetInnerHTML={{ __html: content || '' }}
          />
        </article>

        {/* Tags */}
        {article.tags && article.tags.length > 0 && (
          <div className="pb-10 border-t border-zinc-100 pt-6">
            <div className="flex items-center gap-2 mb-3">
              <Tag size={16} className="text-zinc-400" />
              <span className="text-sm font-bold text-zinc-500">{t.tags || (isAr ? 'العلامات' : 'Tags')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {article.tags.map((tag, i) => (
                <span key={i} className="bg-zinc-50 text-zinc-600 text-sm font-bold px-4 py-1.5 rounded-full border border-zinc-100">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Article CTA */}
        <div className="border-t border-zinc-100 py-8">
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/products"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-marine-cyan px-5 py-3 text-sm font-black text-white shadow-lg shadow-red-900/10 transition-colors hover:bg-marine-cyan-dark"
            >
              <ShoppingBag size={18} />
              {t.browseProducts || (isAr ? 'تصفح المنتجات' : 'Browse Products')}
            </Link>
            <Link
              href="/articles"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 py-3 text-sm font-black text-zinc-800 transition-colors hover:border-marine-cyan hover:text-marine-primary"
            >
              <BookOpen size={18} />
              {t.readOtherArticles || (isAr ? 'قراءة مقالات أخرى' : 'Read Other Articles')}
            </Link>
          </div>
        </div>

        {/* Bottom spacing */}
        <div className="pb-12" />
      </div>
    </div>
  );
}
