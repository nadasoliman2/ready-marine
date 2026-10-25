'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from '../../../../../../lib/navigation';
import dynamic from 'next/dynamic';
import { Loader2, ArrowLeft, Save, Send, ImagePlus, X, Search as SearchIcon } from 'lucide-react';
import { useApp } from '../../../../../../context/AppContext';
import { adminApi } from '../../../../../../lib/api';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

const UPLOAD_URL = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/upload`;

// Upload a file to the server and return its public URL
async function uploadImageToServer(file) {
  const formData = new FormData();
  formData.append('images', file);
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });
  const data = await res.json();
  if (data.images && data.images.length > 0) {
    return data.images[0].url;
  }
  throw new Error('Upload failed');
}

export default function EditArticlePage() {
  const router = useRouter();
  const params = useParams();
  const { language, t } = useApp();
  const isAr = language === 'ar';

  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('en');
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    const loadArticle = async () => {
      try {
        const data = await adminApi.getArticleById(params.id);
        const a = data.article;
        setForm({
          title_en: a.title_en || '', title_ar: a.title_ar || '',
          excerpt_en: a.excerpt_en || '', excerpt_ar: a.excerpt_ar || '',
          content_en: a.content_en || '', content_ar: a.content_ar || '',
          featured_image: a.featured_image || '',
          author_name: a.author_name || '',
          tags: (a.tags || []).join(', '),
          category: a.category || '',
          meta_title_en: a.meta_title_en || '', meta_title_ar: a.meta_title_ar || '',
          meta_description_en: a.meta_description_en || '', meta_description_ar: a.meta_description_ar || '',
          keywords: (a.keywords || []).join(', '),
          canonical_url: a.canonical_url || '',
          status: a.status || 'draft',
        });
      } catch (err) {
        setError(err.message || 'Failed to load article');
      } finally {
        setLoading(false);
      }
    };
    loadArticle();
  }, [params.id]);

  const handleSubmit = async (status) => {
    setSaving(true);
    setError('');
    try {
      const data = {
        ...form,
        status,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        keywords: form.keywords ? form.keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
      };
      await adminApi.updateArticle(params.id, data);
      router.push('/admin/dashboard/articles');
    } catch (err) {
      setError(err.message || 'Failed to update article');
    } finally {
      setSaving(false);
    }
  };

  const quillModulesWithHandler = useMemo(() => ({
    toolbar: {
      container: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['blockquote', 'code-block'],
        ['link', 'image'],
        [{ align: [] }],
        [{ direction: 'rtl' }],
        ['clean'],
      ],
      handlers: {
        image: function () {
          const quill = this.quill;
          const input = document.createElement('input');
          input.setAttribute('type', 'file');
          input.setAttribute('accept', 'image/*');
          input.click();
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              const url = await uploadImageToServer(file);
              let range = quill.getSelection();
              if (!range) range = { index: quill.getLength() };
              quill.insertEmbed(range.index, 'image', url);
              quill.setSelection(range.index + 1);
            } catch (err) {
              console.error('Inline image upload failed:', err);
              alert('Image upload failed. Please try again.');
            }
          };
        },
      },
    },
  }), []);

  // Featured image upload
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const url = await uploadImageToServer(file);
      setForm(prev => ({ ...prev, featured_image: url }));
    } catch (err) {
      console.error('Featured image upload failed:', err);
      alert('Upload failed');
    } finally {
      setUploadingImage(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-zinc-500 font-bold">{t.articleNotFound || 'Article not found.'}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-xl transition-colors">
            <ArrowLeft size={20} className="text-zinc-500 rtl:rotate-180" />
          </button>
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
              {t.editArticle || 'Edit Article'}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleSubmit('draft')}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300 font-bold px-5 py-3 rounded-xl transition-colors"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {t.saveDraft || 'Save as Draft'}
          </button>
          <button
            onClick={() => handleSubmit('published')}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-5 py-3 rounded-xl transition-colors shadow-lg shadow-red-900/10"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {t.publish || 'Publish'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold mb-6">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="xl:col-span-2 space-y-6">
          {/* Language Tabs */}
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setActiveTab('en')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${activeTab === 'en' ? 'bg-marine-cyan text-white' : 'bg-zinc-100 dark:bg-white/5 text-zinc-500'}`}
            >
              English
            </button>
            <button
              onClick={() => setActiveTab('ar')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${activeTab === 'ar' ? 'bg-marine-cyan text-white' : 'bg-zinc-100 dark:bg-white/5 text-zinc-500'}`}
            >
              العربية
            </button>
          </div>

          {/* Title */}
          <section className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-2">
                {t.articleTitle || 'Article Title'} ({activeTab === 'en' ? 'English' : 'Arabic'})
              </label>
              <input
                type="text"
                value={activeTab === 'en' ? form.title_en : form.title_ar}
                onChange={(e) => setForm(prev => ({ ...prev, [activeTab === 'en' ? 'title_en' : 'title_ar']: e.target.value }))}
                dir={activeTab === 'ar' ? 'rtl' : 'ltr'}
                className="w-full px-4 py-3 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-lg font-bold outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-2">
                {t.articleExcerpt || 'Excerpt'} ({activeTab === 'en' ? 'English' : 'Arabic'})
              </label>
              <textarea
                rows={3}
                value={activeTab === 'en' ? form.excerpt_en : form.excerpt_ar}
                onChange={(e) => setForm(prev => ({ ...prev, [activeTab === 'en' ? 'excerpt_en' : 'excerpt_ar']: e.target.value }))}
                dir={activeTab === 'ar' ? 'rtl' : 'ltr'}
                className="w-full px-4 py-3 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white resize-none"
              />
            </div>
          </section>

          {/* Content Editor */}
          <section className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-6">
            <label className="block text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-3">
              {t.articleContent || 'Content'} ({activeTab === 'en' ? 'English' : 'Arabic'})
            </label>
            <div className="prose-editor" dir={activeTab === 'ar' ? 'rtl' : 'ltr'}>
              {activeTab === 'en' ? (
                <ReactQuill
                  key="article-content-en"
                  theme="snow"
                  value={form.content_en}
                  onChange={(val) => setForm(prev => ({ ...prev, content_en: val }))}
                  modules={quillModulesWithHandler}
                  style={{ minHeight: '300px' }}
                />
              ) : (
                <ReactQuill
                  key="article-content-ar"
                  theme="snow"
                  value={form.content_ar}
                  onChange={(val) => setForm(prev => ({ ...prev, content_ar: val }))}
                  modules={quillModulesWithHandler}
                  style={{ minHeight: '300px' }}
                />
              )}
            </div>
          </section>

          {/* SEO Settings */}
          <section className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <SearchIcon size={18} className="text-marine-primary" />
              <h3 className="font-bold text-zinc-900 dark:text-white">{t.seoSettings || 'SEO Settings'}</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 mb-1.5">{t.metaTitle || 'Meta Title'} ({activeTab === 'en' ? 'EN' : 'AR'})</label>
                <input
                  type="text"
                  value={activeTab === 'en' ? form.meta_title_en : form.meta_title_ar}
                  onChange={(e) => setForm(prev => ({ ...prev, [activeTab === 'en' ? 'meta_title_en' : 'meta_title_ar']: e.target.value }))}
                  dir={activeTab === 'ar' ? 'rtl' : 'ltr'}
                  className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 mb-1.5">{t.canonicalUrl || 'Canonical URL'}</label>
                <input
                  type="text"
                  value={form.canonical_url}
                  onChange={(e) => setForm(prev => ({ ...prev, canonical_url: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1.5">{t.metaDescription || 'Meta Description'} ({activeTab === 'en' ? 'EN' : 'AR'})</label>
              <textarea
                rows={2}
                value={activeTab === 'en' ? form.meta_description_en : form.meta_description_ar}
                onChange={(e) => setForm(prev => ({ ...prev, [activeTab === 'en' ? 'meta_description_en' : 'meta_description_ar']: e.target.value }))}
                dir={activeTab === 'ar' ? 'rtl' : 'ltr'}
                className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1.5">{t.keywords || 'Keywords'} ({isAr ? 'مفصولة بفواصل' : 'comma-separated'})</label>
              <input
                type="text"
                value={form.keywords}
                onChange={(e) => setForm(prev => ({ ...prev, keywords: e.target.value }))}
                className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white"
              />
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Featured Image */}
          <section className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-6">
            <h3 className="font-bold text-zinc-900 dark:text-white mb-3">{t.featuredImage || 'Featured Image'}</h3>
            {form.featured_image ? (
              <div className="relative group">
                <img src={form.featured_image} alt="" className="w-full h-48 object-cover rounded-xl" />
                <button
                  onClick={() => setForm(prev => ({ ...prev, featured_image: '' }))}
                  className="absolute top-2 end-2 p-1.5 bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-zinc-200 dark:border-white/10 rounded-xl cursor-pointer hover:border-marine-cyan hover:bg-red-50/50 dark:hover:bg-red-500/5 transition-colors">
                {uploadingImage ? (
                  <>
                    <Loader2 size={32} className="text-marine-primary animate-spin mb-2" />
                    <span className="text-sm font-bold text-zinc-400">{isAr ? 'جاري الرفع...' : 'Uploading...'}</span>
                  </>
                ) : (
                  <>
                    <ImagePlus size={32} className="text-zinc-300 dark:text-zinc-600 mb-2" />
                    <span className="text-sm font-bold text-zinc-400">{isAr ? 'رفع صورة' : 'Upload Image'}</span>
                  </>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
              </label>
            )}
          </section>

          {/* Author & Category */}
          <section className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1.5">{t.authorName || 'Author Name'}</label>
              <input
                type="text"
                value={form.author_name}
                onChange={(e) => setForm(prev => ({ ...prev, author_name: e.target.value }))}
                className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1.5">{t.articleCategory || 'Category'}</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))}
                className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1.5">{t.tags || 'Tags'}</label>
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setForm(prev => ({ ...prev, tags: e.target.value }))}
                className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl text-sm outline-none focus:ring-2 focus:ring-marine-cyan/20 text-zinc-900 dark:text-white"
              />
            </div>
          </section>
        </div>
      </div>

      {/* Quill editor styling overrides */}
      <style jsx global>{`
        .ql-toolbar.ql-snow {
          border-radius: 12px 12px 0 0;
          border-color: rgba(0,0,0,0.1);
          background: rgba(0,0,0,0.02);
        }
        .ql-container.ql-snow {
          border-radius: 0 0 12px 12px;
          border-color: rgba(0,0,0,0.1);
          min-height: 300px;
          font-size: 15px;
        }
        .dark .ql-toolbar.ql-snow {
          border-color: rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.02);
        }
        .dark .ql-container.ql-snow {
          border-color: rgba(255,255,255,0.1);
          color: white;
        }
        .dark .ql-editor.ql-blank::before {
          color: rgba(255,255,255,0.3);
        }
        .dark .ql-snow .ql-stroke {
          stroke: rgba(255,255,255,0.5);
        }
        .dark .ql-snow .ql-fill {
          fill: rgba(255,255,255,0.5);
        }
        .dark .ql-snow .ql-picker-label {
          color: rgba(255,255,255,0.5);
        }
      `}</style>
    </div>
  );
}
