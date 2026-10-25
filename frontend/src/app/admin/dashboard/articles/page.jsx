'use client';

import { useState, useEffect } from 'react';
import { Loader2, FileText, Plus, Edit2, Trash2, Eye, Search } from 'lucide-react';
import Link from '../../../../components/LocaleLink';
import { useApp } from '../../../../context/AppContext';
import { adminApi } from '../../../../lib/api';
import { formatLocalizedDate } from '../../../../lib/dateFormat';
import useRowLink from '../../../../lib/useRowLink';

export default function AdminArticles() {
  const rowLink = useRowLink();
  const { language, t } = useApp();
  const isAr = language === 'ar';

  const [articles, setArticles] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const loadArticles = async () => {
    setLoading(true);
    try {
      const data = await adminApi.getArticles({ page, limit: 12, search });
      setArticles(data.articles || []);
      setPagination(data.pagination || null);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load articles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadArticles();
  }, [page, search]);

  const handleDelete = async (id) => {
    if (!confirm(t.confirmDeleteArticle || 'Are you sure you want to delete this article?')) return;
    try {
      await adminApi.deleteArticle(id);
      loadArticles();
    } catch (err) {
      setError(err.message || 'Failed to delete article');
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return formatLocalizedDate(dateStr, isAr, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  };

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {t.articles || 'Articles'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'إدارة المقالات والمحتوى.' : 'Manage your blog articles and content.'}
          </p>
        </div>
        <Link
          href="/admin/dashboard/articles/add"
          className="inline-flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-5 py-3 rounded-xl transition-colors shadow-lg shadow-red-900/10"
        >
          <Plus size={18} />
          {t.newArticle || 'New Article'}
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-md">
        <Search size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          placeholder={isAr ? 'بحث في المقالات...' : 'Search articles...'}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full ps-11 pe-4 py-3 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white"
        />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-marine-primary" />
        </div>
      ) : articles.length === 0 ? (
        <div className="text-center py-20 space-y-4">
          <FileText size={48} className="mx-auto text-zinc-300 dark:text-zinc-600" />
          <h3 className="text-lg font-black text-zinc-900 dark:text-white">{t.noArticlesFound || 'No articles found.'}</h3>
          <Link href="/admin/dashboard/articles/add" className="text-marine-primary font-bold hover:underline">
            {t.newArticle || 'Create your first article'}
          </Link>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-100 dark:border-white/5">
                    <th className="text-start px-6 py-4 font-bold text-zinc-500 uppercase text-xs tracking-wider">{t.articleTitle || 'Title'}</th>
                    <th className="text-start px-6 py-4 font-bold text-zinc-500 uppercase text-xs tracking-wider">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="text-start px-6 py-4 font-bold text-zinc-500 uppercase text-xs tracking-wider">{t.publishedOn || 'Published'}</th>
                    <th className="text-start px-6 py-4 font-bold text-zinc-500 uppercase text-xs tracking-wider">{t.views || 'Views'}</th>
                    <th className="text-end px-6 py-4 font-bold text-zinc-500 uppercase text-xs tracking-wider">{isAr ? 'إجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  {articles.map((article) => (
                    <tr key={article._id} {...rowLink(`/admin/dashboard/articles/${article._id}/edit`)} className="hover:bg-zinc-50/50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {article.featured_image ? (
                            <img src={article.featured_image} alt="" className="w-10 h-10 rounded-lg object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center">
                              <FileText size={18} className="text-zinc-400" />
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-zinc-900 dark:text-white line-clamp-1">
                              {isAr ? (article.title_ar || article.title_en) : (article.title_en || article.title_ar)}
                            </p>
                            {article.category && (
                              <p className="text-xs text-zinc-400 mt-0.5">{article.category}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                          article.status === 'published'
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                            : 'bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400'
                        }`}>
                          {article.status === 'published' ? (t.published || 'Published') : (t.draft || 'Draft')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-zinc-500 text-sm">{formatDate(article.published_at || article.created_at)}</td>
                      <td className="px-6 py-4 text-zinc-500 text-sm font-bold">{article.view_count || 0}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {article.status === 'published' && (article.slug_en || article.slug_ar) && (
                            <Link
                              href={`/articles/${isAr ? (article.slug_ar || article.slug_en) : (article.slug_en || article.slug_ar)}`}
                              target="_blank"
                              className="p-2 text-zinc-400 hover:text-blue-500 transition-colors"
                              title={isAr ? 'عرض' : 'View'}
                            >
                              <Eye size={16} />
                            </Link>
                          )}
                          <Link
                            href={`/admin/dashboard/articles/${article._id}/edit`}
                            className="p-2 text-zinc-400 hover:text-marine-primary transition-colors"
                            title={t.editArticle || 'Edit'}
                          >
                            <Edit2 size={16} />
                          </Link>
                          <button
                            onClick={() => handleDelete(article._id)}
                            className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                            title={t.deleteArticle || 'Delete'}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              {Array.from({ length: pagination.pages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-10 h-10 rounded-xl font-bold text-sm transition-colors ${
                    p === pagination.page
                      ? 'bg-marine-cyan text-white shadow-lg shadow-red-900/20'
                      : 'bg-white dark:bg-white/5 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/10 border border-zinc-200 dark:border-white/10'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
