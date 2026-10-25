import ArticleDetail from './ArticleDetail';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

// Each slug lives under its own language: the English slug at /en/articles/…, the Arabic one
// at /ar/articles/….
const articleUrl = (article, slug) =>
  `${SITE_URL}/${slug === article.slug_ar && slug !== article.slug_en ? 'ar' : 'en'}/articles/${slug}`;

async function fetchArticle(slug) {
  try {
    const res = await fetch(`${API_URL}/articles/slug/${slug}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.article || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }) {
  const article = await fetchArticle(params.slug);
  if (!article) {
    return { title: 'Article Not Found' };
  }

  const title = article.meta_title_en || article.title_en || article.meta_title_ar || article.title_ar || 'Article';
  const description = article.meta_description_en || article.excerpt_en || article.meta_description_ar || article.excerpt_ar || '';

  const metadata = {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      publishedTime: article.published_at,
      authors: article.author_name ? [article.author_name] : undefined,
      images: article.featured_image ? [{ url: article.featured_image, width: 1200, height: 630 }] : [],
      siteName: 'Ready Marine',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: article.featured_image ? [article.featured_image] : [],
    },
    alternates: {
      canonical: article.canonical_url || articleUrl(article, params.slug),
    },
  };

  // Add hreflang alternates
  if (article.slug_en || article.slug_ar) {
    metadata.alternates.languages = {};
    if (article.slug_en) metadata.alternates.languages['en'] = articleUrl(article, article.slug_en);
    if (article.slug_ar) metadata.alternates.languages['ar'] = articleUrl(article, article.slug_ar);
  }

  if (article.keywords && article.keywords.length > 0) {
    metadata.keywords = article.keywords;
  }

  return metadata;
}

export default async function ArticlePage({ params }) {
  const article = await fetchArticle(params.slug);

  // JSON-LD structured data
  const jsonLd = article ? {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title_en || article.title_ar,
    description: article.excerpt_en || article.excerpt_ar || '',
    image: article.featured_image || undefined,
    author: article.author_name ? { '@type': 'Person', name: article.author_name } : undefined,
    datePublished: article.published_at,
    dateModified: article.published_at,
    publisher: {
      '@type': 'Organization',
      name: 'Ready Marine',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': articleUrl(article, params.slug),
    },
    inLanguage: article.slug_en === params.slug ? 'en' : 'ar',
  } : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <ArticleDetail article={article} />
    </>
  );
}
