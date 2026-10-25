const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

// Every page's URL starts with its language (lib/locale.js). A page that is the same in both
// languages is listed twice, each entry naming the other as its alternate.
const bothLanguages = (path, entry) => {
  const languages = { en: `${SITE_URL}/en${path}`, ar: `${SITE_URL}/ar${path}` };
  return [
    { ...entry, url: languages.en, alternates: { languages } },
    { ...entry, url: languages.ar, alternates: { languages } },
  ];
};

// A product or article has a slug per language; each is listed under its own language, with
// the other slug as its alternate when there is one.
const perLanguageSlugs = (base, item, entry) => {
  const languages = {};
  if (item.slug_en) languages.en = `${SITE_URL}/en/${base}/${item.slug_en}`;
  if (item.slug_ar) languages.ar = `${SITE_URL}/ar/${base}/${item.slug_ar}`;
  const alternates = Object.keys(languages).length > 1 ? { alternates: { languages } } : {};
  return Object.values(languages).map((url) => ({ ...entry, url, ...alternates }));
};

export default async function sitemap() {
  // Static pages
  const staticPages = [
    ['', 'daily', 1.0],
    ['/products', 'daily', 0.9],
    ['/girls', 'daily', 0.8],
    ['/trunk', 'daily', 0.8],
    ['/articles', 'daily', 0.8],
    ['/services', 'weekly', 0.7],
    ['/contact', 'monthly', 0.5],
    ['/delivery', 'monthly', 0.5],
    ['/privacy', 'yearly', 0.3],
    ['/terms', 'yearly', 0.3],
  ].flatMap(([path, changeFrequency, priority]) => bothLanguages(path, { changeFrequency, priority }));

  // Dynamic article pages
  let articleUrls = [];
  try {
    const res = await fetch(`${API_URL}/articles?limit=1000`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const articles = data.articles || [];
      articleUrls = articles.flatMap(article => perLanguageSlugs('articles', article, {
        lastModified: article.published_at || article.created_at,
        changeFrequency: 'weekly',
        priority: 0.7,
      }));
    }
  } catch (err) {
    console.error('Sitemap: failed to fetch articles:', err);
  }

  // Dynamic product pages
  let productUrls = [];
  try {
    const res = await fetch(`${API_URL}/products?limit=1000`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const products = data.products || [];
      productUrls = products.flatMap(product => perLanguageSlugs('product', product, {
        lastModified: product.created_at,
        changeFrequency: 'weekly',
        priority: 0.6,
      }));
    }
  } catch (err) {
    console.error('Sitemap: failed to fetch products:', err);
  }

  return [...staticPages, ...articleUrls, ...productUrls];
}
