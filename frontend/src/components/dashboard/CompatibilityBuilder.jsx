import { useState } from 'react';
import { Plus, Trash2, X, Car, ChevronRight, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import SearchableSelect from '../SearchableSelect';
import BrandLogo from '../BrandLogo';

/**
 * `searchable` (on unless turned off): the make and model lists are dropdowns with a search
 * box, the makes with their logos. A plain `<select>` jumps to the first name starting with
 * each letter typed — type slowly and the second letter starts over, on another car; in the
 * model list that jump adds the model at once.
 *
 * `allowCustomYears`: a model's specific years can include ones its car list does not have —
 * an older car than the list starts at. Typed in under the year chips. On in the admin's forms.
 */
const MIN_YEAR = 1950;

export default function CompatibilityBuilder({ compatibleCars, setCompatibleCars, carBrands, searchable = true, allowCustomYears = false }) {
  const { t, language } = useApp();
  const isAr = language === 'ar';
  const [addingBrandId, setAddingBrandId] = useState('');
  // What is typed in each model's "another year" box, by model id.
  const [yearDrafts, setYearDrafts] = useState({});
  
  const handleAddBrand = () => {
    if (!addingBrandId) return;
    const brand = carBrands.find(b => b._id === addingBrandId);
    if (!brand) return;
    
    // Check if already added
    if (compatibleCars.some(c => c.brand_id === brand._id)) {
      setAddingBrandId('');
      return;
    }

    setCompatibleCars([
      ...compatibleCars,
      {
        brand_id: brand._id,
        brand_name: brand.name,
        all_models: true,
        models: []
      }
    ]);
    setAddingBrandId('');
  };

  const handleRemoveBrand = (index) => {
    const newCars = [...compatibleCars];
    newCars.splice(index, 1);
    setCompatibleCars(newCars);
  };

  const handleToggleAllModels = (index, value) => {
    const newCars = [...compatibleCars];
    newCars[index].all_models = value;
    if (value) {
      newCars[index].models = []; // Clear specific models if 'all' is selected
    }
    // UX change: Don't automatically add the first model. Let user choose.
    setCompatibleCars(newCars);
  };

  const handleAddModel = (brandIdx, modelId) => {
    if (!modelId) return;
    const brand = carBrands.find(b => b._id === compatibleCars[brandIdx].brand_id);
    const model = brand?.models?.find(m => m._id === modelId);
    if (!model) return;

    const newCars = [...compatibleCars];
    // Check if model already added
    if (newCars[brandIdx].models.some(m => m.model_id === model._id)) return;

    newCars[brandIdx].models.push({
      model_id: model._id,
      model_name: model.name,
      all_years: true,
      years: []
    });
    setCompatibleCars(newCars);
  };

  const handleRemoveModel = (brandIdx, modelIdx) => {
    const newCars = [...compatibleCars];
    newCars[brandIdx].models.splice(modelIdx, 1);
    setCompatibleCars(newCars);
  };

  const handleToggleAllYears = (brandIdx, modelIdx, value) => {
    const newCars = [...compatibleCars];
    newCars[brandIdx].models[modelIdx].all_years = value;
    if (value) {
      newCars[brandIdx].models[modelIdx].years = [];
    }
    setCompatibleCars(newCars);
  };

  const handleToggleYear = (brandIdx, modelIdx, year) => {
    const newCars = [...compatibleCars];
    const yearsArr = newCars[brandIdx].models[modelIdx].years;
    
    if (yearsArr.includes(year)) {
      newCars[brandIdx].models[modelIdx].years = yearsArr.filter(y => y !== year);
    } else {
      newCars[brandIdx].models[modelIdx].years.push(year);
    }
    setCompatibleCars(newCars);
  };

  const maxYear = new Date().getFullYear() + 1;
  const handleAddCustomYear = (brandIdx, modelIdx, modelId) => {
    const year = Number(String(yearDrafts[modelId] || '').trim());
    if (!Number.isInteger(year) || year < MIN_YEAR || year > maxYear) return;
    const newCars = [...compatibleCars];
    const model = newCars[brandIdx].models[modelIdx];
    if (!model.years.includes(year)) {
      newCars[brandIdx].models[modelIdx] = { ...model, years: [...model.years, year].sort((a, b) => a - b) };
      setCompatibleCars(newCars);
    }
    setYearDrafts(prev => ({ ...prev, [modelId]: '' }));
  };

  return (
    <div className="space-y-6">
      {/* Brand Selector */}
      <div className="flex gap-2">
        {searchable ? (
          <SearchableSelect
            value={addingBrandId}
            onChange={setAddingBrandId}
            options={(carBrands || []).map(b => ({ value: b._id, label: b.name, keywords: (b.name_aliases || []).join(' '), image: b.image }))}
            placeholder={t.selectCarBrandToAdd || 'Select Car Brand...'}
            isAr={isAr}
            buttonClassName="bg-white dark:bg-[#09090b] border border-zinc-300 dark:border-white/10 rounded-lg ps-3 pe-9 py-2 text-sm text-zinc-900 dark:text-white focus:border-marine-cyan focus:outline-none"
          />
        ) : (
        <div className="relative flex-1">
          <Car size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <select 
            value={addingBrandId} 
            onChange={e => setAddingBrandId(e.target.value)}
            className="w-full bg-white dark:bg-[#09090b] border border-zinc-300 dark:border-white/10 rounded-lg pl-10 pr-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white appearance-none"
          >
            <option value="">{t.selectCarBrandToAdd || 'Select Car Brand...'}</option>
            {carBrands?.map(b => (
              <option key={b._id} value={b._id}>{b.name}</option>
            ))}
          </select>
          <ChevronRight size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
        </div>
        )}
        <button 
          type="button"
          onClick={handleAddBrand}
          disabled={!addingBrandId}
          className="bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm"
        >
          <Plus size={18} />
          {t.addBrand || 'Add Brand'}
        </button>
      </div>

      {/* Selected Brands List */}
      <div className="space-y-4">
        {compatibleCars.length === 0 ? (
          <div className="bg-zinc-50 dark:bg-white/[0.02] border border-dashed border-zinc-200 dark:border-white/10 rounded-xl p-8 text-center">
            <Car size={32} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-500">{t.noCompatibleCarsAdded || 'No car brands added yet. Start by selecting a brand above.'}</p>
          </div>
        ) : (
          compatibleCars.map((compCar, bIdx) => {
            const matchedBrand = carBrands?.find(b => b._id === compCar.brand_id);

            return (
              <div key={compCar.brand_id} className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-xl p-4 shadow-sm animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-100 dark:border-white/5">
                  <div className="flex items-center gap-2">
                    {/* The make's logo, as in the list it was picked from. */}
                    <div className="w-8 h-8 rounded-lg bg-zinc-50 dark:bg-[#0E1012] flex items-center justify-center border border-zinc-100 dark:border-white/5 overflow-hidden">
                      <BrandLogo image={matchedBrand?.image} name={compCar.brand_name} className="w-6 h-6" fallback={<Car size={16} className="text-marine-primary" />} />
                    </div>
                    <h4 className="font-bold text-zinc-900 dark:text-white text-base">{compCar.brand_name}</h4>
                  </div>
                  <button type="button" onClick={() => handleRemoveBrand(bIdx)} className="text-zinc-400 hover:text-red-500 p-1.5 rounded-lg transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Models Scope Toggle */}
                <div className="mb-4 flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300 group">
                    <input type="radio" name={`scope_${compCar.brand_id}`} checked={compCar.all_models} onChange={() => handleToggleAllModels(bIdx, true)} className="w-4 h-4 text-marine-primary focus:ring-marine-cyan border-zinc-300" />
                    <span className="group-hover:text-marine-primary transition-colors">{t.allModels || 'All Models'}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-300 group">
                    <input type="radio" name={`scope_${compCar.brand_id}`} checked={!compCar.all_models} onChange={() => handleToggleAllModels(bIdx, false)} className="w-4 h-4 text-marine-primary focus:ring-marine-cyan border-zinc-300" />
                    <span className="group-hover:text-marine-primary transition-colors">{t.specificModels || 'Specific Models'}</span>
                  </label>
                </div>

                {/* Specific Models Manager */}
                {!compCar.all_models && (
                  <div className="pl-4 border-l-2 border-red-100 dark:border-marine-cyan/20 space-y-4">
                    {/* Select Model to Add */}
                    <div className="flex gap-2 max-w-sm">
                      {searchable ? (
                        <SearchableSelect
                          value=""
                          onChange={(modelId) => handleAddModel(bIdx, modelId)}
                          // The models already added are left out, as the plain list greys them.
                          options={(matchedBrand?.models || [])
                            .filter(m => !compCar.models.some(cm => cm.model_id === m._id))
                            .map(m => ({ value: m._id, label: m.name }))}
                          placeholder={`+ ${t.addSpecificModel || 'Add Specific Model...'}`}
                          isAr={isAr}
                          buttonClassName="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-3 pe-8 py-1.5 text-xs text-zinc-900 dark:text-white focus:border-marine-cyan focus:outline-none"
                        />
                      ) : (
                      <select 
                        onChange={e => {
                          handleAddModel(bIdx, e.target.value);
                          e.target.value = ''; // Reset after selecting
                        }}
                        className="flex-1 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs focus:border-marine-cyan focus:outline-none dark:text-white"
                      >
                        <option value="">{`+ ${t.addSpecificModel || 'Add Specific Model...'}`}</option>
                        {matchedBrand?.models?.map(m => (
                          <option key={m._id} value={m._id} disabled={compCar.models.some(cm => cm.model_id === m._id)}>{m.name}</option>
                        ))}
                      </select>
                      )}
                    </div>

                    {/* Empty Specific Models State */}
                    {compCar.models.length === 0 && (
                      <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 p-3 rounded-lg border border-amber-100 dark:border-amber-500/20">
                        <AlertCircle size={14} />
                        <span>{t.addModelInstructions || 'Select one or more specific models from the dropdown above.'}</span>
                      </div>
                    )}

                    {/* List of Models */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {compCar.models.map((mod, mIdx) => {
                        const matchedModel = matchedBrand?.models?.find(m => m._id === mod.model_id);
                        
                        return (
                          <div key={mod.model_id} className="bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/5 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-3">
                              <span className="font-bold text-sm text-zinc-900 dark:text-white">{mod.model_name}</span>
                              <button type="button" onClick={() => handleRemoveModel(bIdx, mIdx)} className="text-zinc-400 hover:text-red-500 transition-colors">
                                <X size={14} />
                              </button>
                            </div>
                            
                            <div className="flex items-center gap-4 mb-2">
                              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                                <input type="radio" name={`years_${mod.model_id}`} checked={mod.all_years} onChange={() => handleToggleAllYears(bIdx, mIdx, true)} className="w-3.5 h-3.5 text-marine-primary focus:ring-marine-cyan" />
                                <span>{t.allYears || 'All Years'}</span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                                <input type="radio" name={`years_${mod.model_id}`} checked={!mod.all_years} onChange={() => handleToggleAllYears(bIdx, mIdx, false)} className="w-3.5 h-3.5 text-marine-primary focus:ring-marine-cyan" />
                                <span>{t.specificYears || 'Specific Years'}</span>
                              </label>
                            </div>

                            {!mod.all_years && (
                              <>
                              <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-zinc-100 dark:border-white/5">
                                {/* The car list's years, plus any added by hand that it lacks. */}
                                {[...new Set([
                                  ...(matchedModel?.years || []).map(y => y.year),
                                  ...(allowCustomYears ? mod.years : []),
                                ])].sort((a, b) => a - b).map(year => {
                                  const isSelected = mod.years.includes(year);
                                  return (
                                    <button
                                      key={year}
                                      type="button"
                                      onClick={() => handleToggleYear(bIdx, mIdx, year)}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                                        isSelected 
                                          ? 'bg-marine-cyan border-marine-cyan text-white shadow-sm' 
                                          : 'bg-white dark:bg-[#14171A] border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/20'
                                      }`}
                                    >
                                      {year}
                                    </button>
                                  );
                                })}
                              </div>
                              {allowCustomYears && (
                                <div className="flex items-center gap-1.5 mt-2">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={MIN_YEAR}
                                    max={maxYear}
                                    value={yearDrafts[mod.model_id] || ''}
                                    onChange={e => setYearDrafts(prev => ({ ...prev, [mod.model_id]: e.target.value }))}
                                    // Enter adds the year; it must not submit the whole product form.
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomYear(bIdx, mIdx, mod.model_id); } }}
                                    placeholder={isAr ? 'سنة تانية (مثلاً 2005)' : 'Another year (e.g. 2005)'}
                                    className="w-44 bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 rounded px-2 py-1 text-[11px] font-bold text-zinc-700 dark:text-zinc-200 focus:border-marine-cyan focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleAddCustomYear(bIdx, mIdx, mod.model_id)}
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-zinc-900 dark:bg-white/10 text-white hover:bg-marine-cyan transition-colors"
                                  >
                                    <Plus size={12} />
                                    {isAr ? 'إضافة' : 'Add'}
                                  </button>
                                </div>
                              )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
