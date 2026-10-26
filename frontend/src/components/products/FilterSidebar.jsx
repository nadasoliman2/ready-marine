'use client';

import { useEffect, useState } from 'react';
import { useBrandModels } from '../../lib/carBrandModels';
import { ChevronDown, ChevronRight, Car, Settings, Tag, Filter, Layers } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useLinkedBrandCategory } from '../../lib/brandCategoryLink';
import useGarageCars, { garageCarLabel, rememberCompanyCar } from '../company/useGarageCars';
import SearchableSelect from '../SearchableSelect';
import { makeOptions, modelOptions, yearOptions } from '../../lib/pickerOptions';
import { matchScore } from '../../lib/searchSuggest';
import BrandLogo from '../BrandLogo';

const PICKER = 'border border-marine-teal/15 rounded-xl ps-4 pe-9 py-3 text-sm font-bold text-marine-ink focus:outline-none focus:ring-2 focus:ring-marine-cyan/20 transition-all';

const findCategoryPath = (cats, categoryId, path = []) => {
  if (!categoryId || !Array.isArray(cats)) return null;

  for (const cat of cats) {
    const nextPath = [...path, cat];
    if (String(cat._id) === String(categoryId)) return nextPath;

    const found = findCategoryPath(cat.subcategories, categoryId, nextPath);
    if (found) return found;
  }

  return null;
};

/**
 * The categories a product type groups, found in the (possibly brand-narrowed) tree: each
 * assigned category with what is under it. A category under another assigned one is already
 * shown inside it.
 */
const typeCategories = (cats, type) => {
  const assigned = new Set((type?.category_ids || []).map(String));
  const found = [];
  const walk = (list) => (list || []).forEach((cat) => {
    if (assigned.has(String(cat._id))) found.push(cat);
    else walk(cat.subcategories);
  });
  walk(cats);
  return found;
};

export default function FilterSidebar({ filters, setFilters, language, t, metadata, loading, error }) {
  const { user, siteSettings, isMounted } = useApp();
  const isAr = language === 'ar';
  const [expandedCats, setExpandedCats] = useState({});
  const [brandSearch, setBrandSearch] = useState('');
  // The garage, plus the company's cars for someone who manages a company account.
  const garageCars = useGarageCars();
  const currency = siteSettings?.currency || 'QAR';

  // Brand and category narrow each other: pick a category and only the brands that make
  // things for it are offered; pick a brand and only its categories are shown.
  const linked = useLinkedBrandCategory({
    brands: metadata?.productBrands || [],
    categories: metadata?.categories || [],
    brandId: filters.product_brand_id,
    categoryId: filters.category_id,
    setBrandId: (id) => setFilters(prev => ({ ...prev, product_brand_id: id, page: 1 })),
    setCategoryId: (id) => setFilters(prev => ({ ...prev, category_id: id, page: 1 })),
  });

  const handleCarBrandChange = (brandId) => {
    setFilters(prev => ({ 
      ...prev, 
      garage_car_id: '',
      car_brand_id: brandId, 
      car_model_id: '', 
      car_year: '',
      page: 1 
    }));
  };

  const handleGarageCarChange = (carId) => {
    const car = garageCars.find(c => String(c._id) === String(carId));
    rememberCompanyCar(car);
    if (!car) {
      setFilters(prev => ({
        ...prev,
        garage_car_id: '',
        car_brand_id: '',
        car_model_id: '',
        car_year: '',
        page: 1,
      }));
      return;
    }

    setFilters(prev => ({
      ...prev,
      garage_car_id: carId,
      car_brand_id: car.car_brand_id,
      car_model_id: car.car_model_id,
      car_year: car.year,
      page: 1,
    }));
  };

  const selectedBrand = metadata?.carBrands?.find(b => b._id === filters.car_brand_id);
  // Fetched for the picked make only; the payload no longer carries every make's models.
  const brandModels = useBrandModels(selectedBrand);
  const selectedModel = brandModels.find(m => m._id === filters.car_model_id);

  useEffect(() => {
    const path = findCategoryPath(metadata?.categories || [], filters.category_id);
    if (!path?.length) return;

    setExpandedCats(prev => {
      const next = { ...prev };
      path.forEach(cat => {
        if (cat.subcategories?.length > 0) {
          next[cat._id] = true;
        }
      });
      return next;
    });
  }, [filters.category_id, metadata?.categories]);

  // Product types come before the categories: picking one narrows the categories below to its own.
  const productTypes = metadata?.productTypes || [];
  const selectedType = productTypes.find((type) => String(type._id) === String(filters.type_id));
  const shownCategories = selectedType ? typeCategories(linked.categories || [], selectedType) : (linked.categories || []);
  const pickType = (id) => setFilters(prev => (
    String(prev.type_id || '') === String(id) ? prev : { ...prev, type_id: id, category_id: '', page: 1 }
  ));

  // The brand list's search matches like every search box on the site (Arabic letter
  // variants folded, best matches first).
  const shownBrands = (() => {
    const all = linked.brands || [];
    const q = brandSearch.trim();
    if (!q) return all;
    return all
      .map((b, i) => ({ b, i, score: matchScore([b.name, b.name_ar].filter(Boolean).join(' '), q) }))
      .filter((r) => r.score > 0)
      .sort((x, y) => y.score - x.score || x.i - y.i)
      .map((r) => r.b);
  })();

  const toggleCat = (id) => {
    setExpandedCats(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderCategories = (cats) => {
    return (
      <ul className="space-y-2">
        {cats.map(cat => (
          <li key={cat._id} className="space-y-2">
            <div className="flex items-center gap-2 group">
              {cat.subcategories?.length > 0 && (
                <button 
                  type="button"
                  onClick={() => toggleCat(cat._id)}
                  className="p-1 hover:bg-marine-mist rounded text-marine-outline group-hover:text-marine-primary"
                >
                  {expandedCats[cat._id] ? <ChevronDown size={14} /> : <ChevronRight size={14} className={isAr ? 'rotate-180' : ''} />}
                </button>
              )}
              <button
                type="button"
                onClick={() => setFilters(prev => (
                  String(prev.category_id) === String(cat._id)
                    ? prev
                    : { ...prev, category_id: cat._id, page: 1 }
                ))}
                className={`flex-1 text-sm text-start py-1 transition-colors ${
                  filters.category_id === cat._id 
                    ? 'text-marine-primary font-bold' 
                    : 'text-marine-muted hover:text-marine-primary'
                }`}
              >
                {isAr ? (cat.name_ar || cat.name) : cat.name}
              </button>
            </div>
            {expandedCats[cat._id] && cat.subcategories?.length > 0 && (
              <div className={isAr ? 'pr-4 border-r border-marine-teal/15 mr-2' : 'pl-4 border-l border-marine-teal/15 ml-2'}>
                {renderCategories(cat.subcategories)}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-4">
            <div className="h-4 w-24 bg-marine-frost rounded"></div>
            <div className="h-10 bg-marine-mist rounded-xl"></div>
          </div>
        ))}
      </div>
    );
  }

  // Inside the main return function, replace the Product Brands Filter portion:

  return (
    <div className="space-y-8 sticky top-24">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-marine-teal/15">
        <Filter className="text-marine-primary" size={20} />
        <h2 className="font-bold text-xl text-marine-ink">{t.filters || 'Filters'}</h2>
        {(filters.type_id || filters.category_id || filters.car_brand_id || filters.car_model_id || filters.car_year || filters.product_brand_id || filters.search || filters.min_price || filters.max_price || filters.garage_car_id) && (
          <button 
            type="button"
            onClick={() => setFilters({ page: 1 })}
            className="ms-auto text-xs font-bold text-marine-outline hover:text-red-500 transition-colors"
          >
            {t.clearAll || 'Clear All'}
          </button>
        )}
      </div>

      {/* Car Compatibility Filter */}
      <div className="space-y-4">
        {/* <h3 className="text-xs font-bold text-marine-outline uppercase tracking-widest flex items-center gap-2">
          <Car size={14} />
          {t.carCompatibility || 'Vehicle Fitment'}
        </h3> */}
        
        <div className="space-y-3">
          {/* Garage car, make, model, year: searchable, the makes with their logos — the same
              dropdowns as the home page's search (SearchableSelect, lib/pickerOptions). */}
          {/* <SearchableSelect
            value={filters.garage_car_id || ''}
            onChange={handleGarageCarChange}
            options={garageCars.map(car => ({ value: car._id, label: garageCarLabel(car, isAr) }))}
            placeholder={!user
              ? (isAr ? 'يناسب سيارتي — سجل الدخول لاختيار سيارة من جراجي' : 'Fit with my car — sign in to choose from my garage')
              : garageCars.length === 0
                ? (isAr ? 'يناسب سيارتي — لا توجد سيارات في جراجي' : 'Fit with my car — no cars in my garage')
                : (isAr ? 'يناسب سيارتي' : 'Fit with my car')}
            disabled={!user || garageCars.length === 0}
            isAr={isAr}
            buttonClassName={`${PICKER} bg-white`}
          />
          <SearchableSelect
            value={filters.car_brand_id || ''}
            onChange={handleCarBrandChange}
            options={makeOptions(metadata?.carBrands)}
            placeholder={t.selectBrand || 'Select Car Brand'}
            isAr={isAr}
            buttonClassName={`${PICKER} bg-marine-canvas`}
          />
          <SearchableSelect
            value={filters.car_model_id || ''}
            onChange={(v) => setFilters(prev => ({ ...prev, garage_car_id: '', car_model_id: v, page: 1 }))}
            options={modelOptions(brandModels)}
            placeholder={t.selectModel || 'Select Car Model'}
            disabled={!filters.car_brand_id}
            isAr={isAr}
            buttonClassName={`${PICKER} bg-marine-canvas`}
          />
          <SearchableSelect
            value={filters.car_year || ''}
            onChange={(v) => setFilters(prev => ({ ...prev, garage_car_id: '', car_year: v, page: 1 }))}
            options={yearOptions(selectedModel?.years)}
            placeholder={t.selectYear || 'Select Year'}
            disabled={!filters.car_model_id}
            isAr={isAr}
            buttonClassName={`${PICKER} bg-marine-canvas`}
          /> */}
        </div>
      
      
      </div>

      {/* Price Filter */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-marine-outline uppercase tracking-widest flex items-center gap-2">
          <Tag size={14} />
          {isAr ? 'السعر' : 'Price'}
        </h3>
        <div className="grid grid-cols-1 gap-3">
          <input
            type="number"
            min="0"
            step="0.01"
            value={filters.min_price || ''}
            onChange={(e) => setFilters(prev => ({ ...prev, min_price: e.target.value, page: 1 }))}
            placeholder={isAr ? `أقل سعر (${currency})` : `Min price (${currency})`}
            className="w-full bg-marine-canvas border border-marine-teal/15 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={filters.max_price || ''}
            onChange={(e) => setFilters(prev => ({ ...prev, max_price: e.target.value, page: 1 }))}
            placeholder={isAr ? `أعلى سعر (${currency})` : `Max price (${currency})`}
            className="w-full bg-marine-canvas border border-marine-teal/15 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all"
          />
        </div>
      </div>

      {/* Product Type Filter */}
      {productTypes.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-marine-outline uppercase tracking-widest flex items-center gap-2">
            <Layers size={14} />
            {isAr ? 'نوع المنتج' : 'Product type'}
          </h3>
          <div className="flex flex-wrap gap-2">
            {[{ _id: '', name: 'All types', name_ar: 'كل الأنواع' }, ...productTypes].map((type) => {
              const active = String(filters.type_id || '') === String(type._id);
              return (
                <button
                  key={type._id || 'all'}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pickType(type._id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                    active
                      ? 'border-marine-cyan bg-marine-cyan text-white'
                      : 'border-marine-teal/15 bg-white text-marine-muted hover:border-marine-cyan hover:text-marine-primary'
                  }`}
                >
                  {isAr ? (type.name_ar || type.name) : type.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Categories Filter */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-marine-outline uppercase tracking-widest flex items-center gap-2">
          <Settings size={14} />
          {selectedType
            ? (isAr ? `فئات ${selectedType.name_ar || selectedType.name}` : `${selectedType.name} categories`)
            : (t.categories || 'Categories')}
        </h3>
        <div className="bg-marine-canvas/50 p-4 rounded-lg border border-marine-teal/15 max-h-[300px] overflow-y-auto scrollbar-hide">
          {renderCategories(shownCategories)}
        </div>
      </div>

      {/* Product Brands Filter (Searchable) */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-marine-outline uppercase tracking-widest flex items-center gap-2">
          <Tag size={14} />
          {t.productBrands || 'Product Brands'}
        </h3>
        <div className="bg-marine-canvas/50 rounded-lg border border-marine-teal/15 p-2 overflow-hidden flex flex-col">
          <input 
            type="text"
            placeholder={t.search || "Search brands..."}
            value={brandSearch}
            onChange={(e) => setBrandSearch(e.target.value)}
            className="w-full bg-white border border-marine-teal/15 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-marine-cyan transition-all mb-2"
          />
          <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto scrollbar-hide px-2 pb-2">
            {shownBrands.map(brand => (
              <label key={brand._id} className="flex items-center gap-3 group cursor-pointer py-1">
                <input 
                  type="checkbox"
                  checked={filters.product_brand_id === brand._id}
                  onChange={() => setFilters(prev => ({ 
                    ...prev, 
                    product_brand_id: prev.product_brand_id === brand._id ? '' : brand._id,
                    page: 1
                  }))}
                  className="w-4 h-4 rounded border-marine-teal/25 text-marine-primary focus:ring-marine-cyan transition-colors"
                />
                {/* The brand's logo, as in every brand list on the site; its first letter without one. */}
                <BrandLogo image={brand.image} name={brand.name} className="w-6 h-6" letterClassName="text-[10px]" />
                <span className={`text-sm font-medium transition-colors ${
                  filters.product_brand_id === brand._id ? 'text-marine-primary font-bold' : 'text-marine-muted group-hover:text-marine-ink'
                }`}>
                  {brand.name}
                </span>
              </label>
            ))}
            {shownBrands.length === 0 && (
                <p className="text-xs text-marine-outline font-medium text-center py-4">{isAr ? 'مفيش ماركات بالاسم ده' : 'No brands found'}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
