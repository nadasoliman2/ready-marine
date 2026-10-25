'use client';

import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { pruneCategoryTree } from '../../lib/brandCategoryLink';

/**
 * `allowedIds` (a Set, optional) cuts the tree down to the categories the chosen brand
 * makes things for — see lib/brandCategoryLink. Omitted or null means the whole tree.
 */
export default function NestedCategorySelector({ categories: allCategories, initialValue, onChange, allowedIds = null }) {
  const { language, t } = useApp();
  const categories = useMemo(() => pruneCategoryTree(allCategories || [], allowedIds), [allCategories, allowedIds]);
  
  // Array of selected category IDs at each depth level
  const [selections, setSelections] = useState([]);

  // On mount or when initialValue/categories change, figure out the path to the initialValue.
  useEffect(() => {
    if (!initialValue || !categories || categories.length === 0) {
      setSelections([]);
      return;
    }

    const findPath = (cats, targetId, currentPath = []) => {
      for (const cat of cats) {
        const catId = String(cat._id);
        if (catId === String(targetId)) {
          return [...currentPath, catId];
        }
        if (cat.subcategories && cat.subcategories.length > 0) {
          const foundPath = findPath(cat.subcategories, targetId, [...currentPath, catId]);
          if (foundPath) return foundPath;
        }
      }
      return null;
    };

    const path = findPath(categories, initialValue);
    if (path) setSelections(path);
  }, [initialValue, categories]);

  // When a selection changes at a specific level, we slice off any deeper selections
  // because picking a new parent invalidates old children.
  const handleChange = (levelIndex, value) => {
    let newSelections = selections.slice(0, levelIndex);
    if (value) {
      newSelections.push(value);
    }
    setSelections(newSelections);
    onChange(newSelections.length > 0 ? newSelections[newSelections.length - 1] : '');
  };

  const renderDropdowns = () => {
    const dropdowns = [];
    let currentOptions = categories;

    for (let i = 0; i < selections.length; i++) {
      const selectedId = selections[i];
      dropdowns.push(
        <select
          key={`level-${i}`}
          value={selectedId}
          onChange={(e) => handleChange(i, e.target.value)}
          className="w-full bg-white dark:bg-[#09090b] border border-zinc-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
        >
          <option value="">{t.selectCategory || 'Select Category'}</option>
          {currentOptions.map((cat) => (
            <option key={String(cat._id)} value={String(cat._id)}>
              {language === 'ar' ? (cat.name_ar || cat.name) : (cat.name_en || cat.name)}
            </option>
          ))}
        </select>
      );

      const selectedCat = currentOptions.find(c => String(c._id) === String(selectedId));
      if (selectedCat && selectedCat.subcategories && selectedCat.subcategories.length > 0) {
        currentOptions = selectedCat.subcategories;
      } else {
        currentOptions = null;
        break;
      }
    }

    if (currentOptions) {
      dropdowns.push(
        <select
          key={`level-${selections.length}`}
          value=""
          onChange={(e) => handleChange(selections.length, e.target.value)}
          className="w-full bg-white dark:bg-[#09090b] border border-zinc-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
        >
          <option value="">{t.selectSubcategory || 'Select Subcategory...'}</option>
          {currentOptions.map((cat) => (
            <option key={String(cat._id)} value={String(cat._id)}>
              {language === 'ar' ? (cat.name_ar || cat.name) : (cat.name_en || cat.name)}
            </option>
          ))}
        </select>
      );
    }

    return dropdowns;
  };

  if (!allCategories || allCategories.length === 0) return <p className="text-sm text-zinc-500">{t.loadingCategories || 'Loading categories...'}</p>;
  if (categories.length === 0) return <p className="text-sm text-zinc-500">{language === 'ar' ? 'لا توجد فئات لهذه الماركة' : 'No categories for this brand'}</p>;

  return (
    <div className="space-y-3">
      {renderDropdowns()}
    </div>
  );
}
