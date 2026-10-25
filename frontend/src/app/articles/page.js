'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from '../../lib/navigation';
import Link from '../../components/LocaleLink';
import { useApp } from '../../context/AppContext';
import Pagination from '../../components/products/Pagination';
import { Search, Calendar, Eye, Tag, BookOpen } from 'lucide-react';
import { formatLocalizedDate } from '../../lib/dateFormat';

function ArticlesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { language, t, isMounted } = useApp();
  const isAr = language === 'ar';

  const [articles, setArticles] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (page > 1) params.set('page', page);
    const qs = params.toString();
    router.replace(`/articles${qs ? `?${qs}` : ''}`, { scroll: false });

    const fetchArticles = async () => {
      setLoading(true);
      try {
        const apiParams = new URLSearchParams({ page, limit: 12 });
        if (search) apiParams.set('search', search);
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/articles?${apiParams.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch articles');
        const data = await res.json();
        setArticles(data.articles || []);
        setPagination(data.pagination || null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchArticles, 300);
    return () => clearTimeout(timer);
  }, [search, page, router]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(e.target.searchInput.value);
    setPage(1);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return formatLocalizedDate(dateStr, isAr, {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  if (!isMounted) return null;

  return (
    <div className="bg-white min-h-screen" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-zinc-50 via-white to-zinc-50 border-b border-zinc-100 py-6 sm:py-16">
        <div className="max-w-7xl mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center space-y-3 sm:space-y-6">
            <div className="inline-flex items-center gap-2 bg-zinc-100 text-zinc-600 px-4 py-1.5 rounded-full text-sm font-bold">
              <BookOpen size={14} />
              <span>{isAr ? 'المدونة' : 'Blog'}</span>
            </div>
            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-[#09090b] tracking-tight">
              {t.articlesTitle || (isAr ? 'أحدث المقالات' : 'Latest Articles')}
            </h1>
            <p className="text-zinc-500 font-medium text-sm sm:text-lg max-w-xl mx-auto">
              {t.articlesSubtitle || (isAr ? 'نصائح وأدلة وأخبار حول قطع غيار السيارات والصيانة' : 'Tips, guides, and news about car parts and maintenance')}
            </p>
            <form onSubmit={handleSearch} className="relative group max-w-2xl mx-auto">
              <input
                name="searchInput"
                type="text"
                defaultValue={search}
                placeholder={isAr ? 'ابحث في المقالات...' : 'Search articles...'}
                className="w-full bg-white border-2 border-transparent shadow-xl rounded-[2rem] px-5 sm:px-8 py-3.5 sm:py-5 text-base sm:text-lg font-bold outline-none focus:border-marine-cyan transition-all duration-300 pe-16"
              />
              <button className="absolute end-4 top-1/2 -translate-y-1/2 bg-marine-cyan p-2 sm:p-3 rounded-xl sm:rounded-2xl text-white hover:bg-marine-cyan-dark transition-colors shadow-lg shadow-red-900/20">
                <Search size={24} />
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-12">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="bg-zinc-50 rounded-2xl h-96 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-500 font-bold">{error}</div>
        ) : articles.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <BookOpen size={48} className="mx-auto text-zinc-200" />
            <h3 className="text-xl font-black text-[#09090b]">{t.noArticlesFound || (isAr ? 'لم يتم العثور على مقالات.' : 'No articles found.')}</h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {articles.map((article) => {
              const title = isAr ? (article.title_ar || article.title_en) : (article.title_en || article.title_ar);
              const excerpt = isAr ? (article.excerpt_ar || article.excerpt_en) : (article.excerpt_en || article.excerpt_ar);
              const slug = isAr ? (article.slug_ar || article.slug_en) : (article.slug_en || article.slug_ar);

              return (
                <Link
                  key={article._id}
                  href={`/articles/${slug}`}
                  className="group bg-white border border-zinc-100 rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-zinc-200/50 transition-all duration-300 hover:-translate-y-1"
                >
                  {/* Image */}
                  <div className="relative h-52 bg-zinc-100 overflow-hidden">
                    {article.featured_image ? (
                      <img
                        src={article.featured_image}
                        alt={title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-50">
                        <BookOpen size={40} className="text-zinc-300" />
                      </div>
                    )}
                    {article.category && (
                      <span className="absolute top-3 start-3 bg-marine-cyan text-white text-xs font-bold px-3 py-1 rounded-full">
                        {article.category}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-6 space-y-3">
                    <h2 className="text-lg font-black text-[#09090b] line-clamp-2 group-hover:text-marine-primary transition-colors">
                      {title}
                    </h2>
                    {excerpt && (
                      <p className="text-sm text-zinc-500 line-clamp-3 leading-relaxed">{excerpt}</p>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-zinc-50">
                      <div className="flex items-center gap-3 text-xs text-zinc-400">
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          {formatDate(article.published_at || article.created_at)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Eye size={12} />
                          {article.view_count || 0} {t.views || (isAr ? 'مشاهدات' : 'views')}
                        </span>
                      </div>
                    </div>

                    {article.tags && article.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {article.tags.slice(0, 3).map((tag, i) => (
                          <span key={i} className="bg-zinc-50 text-zinc-500 text-[10px] font-bold px-2 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-12">
            {Array.from({ length: pagination.pages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-10 h-10 rounded-xl font-bold text-sm transition-colors ${
                  p === pagination.page
                    ? 'bg-marine-cyan text-white shadow-lg shadow-red-900/20'
                    : 'bg-white text-zinc-500 hover:bg-zinc-50 border border-zinc-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ArticlesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-marine-cyan"></div>
      </div>
    }>
      <ArticlesContent />
    </Suspense>
  );
}
