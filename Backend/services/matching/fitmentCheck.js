/**
 * Does a product's fitment say what its own text says?
 *
 * Vendors name the cars in the title ("تيل امامى لانسر بومة - لانسر مكواه") and then fill the
 * fitment by hand, and the two drift apart: a car named and never ticked, a part named for one
 * car and marked universal, a model ticked with no year (which no year search ever finds), a
 * title written for "شارك 2008-2015" ticked for every Lancer ever made. Each of those is a
 * customer who owns the car and never sees the part — or who sees a part that does not fit.
 *
 * `checkFitment(product, reader)` reads the product's text (vehicleMentions.js), compares it
 * with `compatible_cars`, and returns what disagrees as findings, plus the fitment it would
 * become with the additions applied (`suggested`). Nothing here writes; `applyFitmentFix`
 * builds the new fitment from the findings an admin accepted.
 *
 * Finding types, most important first:
 *   universal_but_named  marked "fits every car", and the title names specific cars
 *   missing_car          a car the text names is not in the fitment
 *   model_without_years  a model ticked with no year and not "all years": invisible to a
 *                        search by year
 *   years_not_covered    the text gives years the fitment's years leave out
 *   years_narrower       the text gives years; the fitment says every year
 *   generation_only      the text names a generation ("بومة", "N16", "HD") and the fitment
 *                        says every year — the years have to be looked up, not guessed
 *   not_in_text          the fitment has a car the text never names, while the title names
 *                        others — worth a look, never changed automatically
 */

const { canonicalModelKey } = require('./vehicleMentions');
const { fold } = require('./text');

const TEXT_FIELDS = ['title_ar', 'title_en', 'subtitle_ar', 'subtitle_en', 'description_ar', 'description_en'];
const isTitleField = (field) => /^(title|subtitle)_/.test(field);
const idOf = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : v ? String(v) : '');

/** Every year in `ranges`, kept inside the model's own years when the car list knows them. */
const yearsFromRanges = (ranges, modelYears) => {
    const lo = modelYears?.from ?? 1950;
    const hi = modelYears?.to ?? new Date().getFullYear() + 1;
    const out = new Set();
    for (const r of ranges) {
        const from = Math.max(r.from, lo);
        const to = Math.min(r.to ?? hi, hi);
        for (let y = from; y <= to; y += 1) out.add(y);
    }
    return [...out].sort((a, b) => a - b);
};

const rangeLabel = (ranges) => ranges
    .map((r) => (r.to == null ? `${r.from}+` : r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`))
    .join('، ');

/** The product's fitment, as lookups. */
const readFitment = (product) => {
    const makes = new Map();
    for (const car of product.compatible_cars || []) {
        const brandId = idOf(car.brand_id);
        const models = new Map();
        for (const m of car.models || []) {
            models.set(idOf(m.model_id), {
                name: m.model_name, all_years: !!m.all_years, years: (m.years || []).map(Number),
                key: canonicalModelKey(car.brand_name, m.model_name),
            });
        }
        makes.set(brandId, { name: car.brand_name, all_models: !!car.all_models, models });
    }
    const keys = new Map();
    for (const [brandId, mk] of makes) for (const [modelId, md] of mk.models) keys.set(md.key, { brandId, modelId, ...md });
    return { makes, keys };
};

/** Mentions of one car, merged: every place it was named, its years, its generation names. */
const groupMentions = (mentions) => {
    const groups = new Map();
    for (const m of mentions) {
        const k = m.model ? canonicalModelKey(m.make, m.model) : `${fold(m.make)}|`;
        const g = groups.get(k) || {
            key: k, make: m.make, make_id: m.make_id, model: m.model, model_id: m.model_id,
            model_years: m.model_years, ranges: [], unyeared: false, gens: new Set(), evidence: [],
        };
        // A make named outright beats the lexicon's default badge ("دايو لانوس").
        if (!g.model_id && m.model_id) Object.assign(g, { make: m.make, make_id: m.make_id, model: m.model, model_id: m.model_id, model_years: m.model_years });
        for (const y of m.years) if (!g.ranges.some((r) => r.from === y.from && r.to === y.to)) g.ranges.push(y);
        if (!m.years.length) g.unyeared = true;
        if (m.gen) g.gens.add(m.gen);
        g.evidence.push({ field: m.field, written: m.written, gen: m.gen, typo: m.typo, conditional: m.conditional, years: m.years });
        groups.set(k, g);
    }
    for (const g of groups.values()) {
        g.in_title = g.evidence.some((e) => isTitleField(e.field));
        g.firm = g.evidence.some((e) => isTitleField(e.field) && !e.typo && !e.conditional);
        g.gens = [...g.gens];
    }
    return [...groups.values()];
};

const describeEvidence = (g) => [...new Set(g.evidence.map((e) => e.written))].join('، ');

/**
 * @param product  a product (lean), with the text fields and is_universal / compatible_cars
 * @param reader   createVehicleReader(carBrands)
 */
const checkFitment = (product, reader) => {
    const fields = TEXT_FIELDS.map((field) => ({ field, text: product[field] }));
    const fitMakes = product.is_universal ? [] : (product.compatible_cars || []).map((c) => c.brand_name).filter(Boolean);
    const { mentions, universal, not_fitment: notFitment, makes_named: makesNamed } = reader.read(fields, { makes: fitMakes });
    const groups = groupMentions(mentions);
    const fit = readFitment(product);
    const titleGroups = groups.filter((g) => g.in_title);
    const findings = [];

    const fitmentHas = (g) => {
        if (!g.model) return [...fit.makes.values()].some((mk) => fold(mk.name) === fold(g.make)) || (g.make_id && fit.makes.has(idOf(g.make_id)));
        if (fit.keys.has(g.key)) return true;
        const brand = g.make_id ? fit.makes.get(idOf(g.make_id)) : null;
        return !!brand?.all_models;
    };

    const addition = (g) => ({
        make: g.make, make_id: g.make_id ? idOf(g.make_id) : null,
        model: g.model, model_id: g.model_id ? idOf(g.model_id) : null,
        years: g.ranges.length && !g.unyeared ? yearsFromRanges(g.ranges, g.model_years) : [],
        all_years: !(g.ranges.length && !g.unyeared),
        years_label: g.ranges.length ? rangeLabel(g.ranges) : null,
        gens: g.gens,
        written: describeEvidence(g),
        typo: g.evidence.find((e) => e.typo)?.typo || null,
    });

    // A toy or scale model of a car names the car without being a part for it.
    if (notFitment) return { findings, mentions: [] };

    // Marked universal, while the title names the cars it is for.
    if (product.is_universal) {
        const named = titleGroups.filter((g) => g.make_id);
        if (named.length && !universal) {
            const models = named.filter((g) => g.model_id);
            findings.push({
                type: 'universal_but_named',
                // A make alone ("Kia logo keychain") is a weaker claim than a model.
                severity: models.some((g) => g.firm) ? 'high' : models.length ? 'medium' : 'low',
                cars: named.map(addition),
            });
        }
    } else {
        for (const g of groups) {
            if (fitmentHas(g)) continue;
            if (!g.make_id) continue; // a make the car list does not hold cannot be ticked
            findings.push({
                type: 'missing_car',
                severity: g.firm ? 'high' : g.in_title ? 'medium' : 'low',
                source: g.in_title ? 'title' : 'description',
                car: addition(g),
                model_unknown: !!(g.model && !g.model_id),
            });
        }
    }

    // What the fitment already says, read against the years the text gives.
    if (!product.is_universal) {
        for (const [brandId, mk] of fit.makes) {
            for (const [modelId, md] of mk.models) {
                const g = groups.find((x) => x.key === md.key);
                if (!md.all_years && !md.years.length) {
                    const explicit = g && g.ranges.length && !g.unyeared;
                    findings.push({
                        type: 'model_without_years',
                        severity: 'medium',
                        car: {
                            make: mk.name, make_id: brandId, model: md.name, model_id: modelId,
                            years: explicit ? yearsFromRanges(g.ranges, g.model_years) : [],
                            all_years: !explicit,
                            years_label: explicit ? rangeLabel(g.ranges) : null,
                            gens: g?.gens || [], written: g ? describeEvidence(g) : null,
                        },
                    });
                    continue;
                }
                if (!g) continue;
                if (g.ranges.length && !g.unyeared) {
                    const textYears = yearsFromRanges(g.ranges, g.model_years);
                    // A single year ("كورولا 2001") names a model year, not where the part
                    // stops fitting: only a range is a reason to narrow "every year".
                    const isRange = g.ranges.some((r) => r.to == null || r.to !== r.from);
                    if (md.all_years && isRange) {
                        findings.push({ type: 'years_narrower', severity: 'low', car: { ...addition(g), make_id: brandId, model_id: modelId } });
                    } else if (!md.all_years) {
                        const have = new Set(md.years);
                        const uncovered = textYears.filter((y) => !have.has(y));
                        if (uncovered.length) {
                            findings.push({
                                type: 'years_not_covered', severity: 'low',
                                car: { ...addition(g), make_id: brandId, model_id: modelId, years: [...new Set([...md.years, ...textYears])].sort((a, b) => a - b), all_years: false },
                                uncovered,
                            });
                        }
                    }
                } else if (md.all_years && g.gens.length && !g.ranges.length) {
                    findings.push({ type: 'generation_only', severity: 'info', car: { ...addition(g), make_id: brandId, model_id: modelId } });
                }
            }
        }

        // A car in the fitment the text never names, while the title names others.
        const firmTitle = titleGroups.filter((g) => g.firm && g.model);
        if (firmTitle.length) {
            const named = new Set(groups.map((g) => g.key));
            // "اريزو" with no number names every Arrizo, so it covers Arrizo 7 as well as 5.
            const families = new Set(groups.filter((g) => g.model && !/\d/.test(describeEvidence(g)))
                .map((g) => `${fold(g.make)}|${fold(g.model).split(' ')[0]}`));
            const familyOf = (make, model) => `${fold(make)}|${fold(model).split(' ')[0]}`;
            const namedMakes = new Set([...(makesNamed || [])].map(fold));
            const missingMakes = new Set(findings.filter((f) => f.type === 'missing_car').map((f) => fold(f.car.make)));
            const severityFor = (make) => (missingMakes.has(fold(make)) ? 'medium' : 'info');
            for (const [brandId, mk] of fit.makes) {
                if (!mk.models.size) {
                    if (!namedMakes.has(fold(mk.name))) findings.push({ type: 'not_in_text', severity: 'info', car: { make: mk.name, make_id: brandId, model: null, model_id: null } });
                    continue;
                }
                for (const [modelId, md] of mk.models) {
                    if (named.has(md.key) || families.has(familyOf(mk.name, md.name))) continue;
                    findings.push({ type: 'not_in_text', severity: severityFor(mk.name), car: { make: mk.name, make_id: brandId, model: md.name, model_id: modelId } });
                }
            }
        }
    }

    return { findings, mentions: groups.map((g) => ({ ...addition(g), in_title: g.in_title, firm: g.firm })) };
};

const ACTIONABLE = new Set(['universal_but_named', 'missing_car', 'model_without_years', 'years_not_covered', 'years_narrower']);

/**
 * The fitment after the accepted fixes.
 *
 * @param product   the product as stored
 * @param changes   [{ make_id, model_id|null, years: number[], all_years }] — each car to add
 *                  or whose years to set; a car already present has its years replaced
 * @param carIndex  reader.cars, to name the makes and models and check they exist
 * @returns {{ is_universal: false, compatible_cars: object[] }}
 */
const applyFitmentFix = (product, changes, carIndex) => {
    const byBrand = new Map();
    const list = (product.is_universal ? [] : (product.compatible_cars || [])).map((c) => ({
        brand_id: idOf(c.brand_id), brand_name: c.brand_name, all_models: !!c.all_models,
        models: (c.models || []).map((m) => ({ model_id: idOf(m.model_id), model_name: m.model_name, years: [...(m.years || [])], all_years: !!m.all_years })),
    }));
    list.forEach((c) => byBrand.set(c.brand_id, c));

    const brandById = new Map();
    for (const brand of carIndex.values()) brandById.set(String(brand._id), brand);

    for (const change of changes || []) {
        const brand = brandById.get(String(change.make_id));
        if (!brand) throw Object.assign(new Error('That car make is not in the car list.'), { status: 400 });
        let row = byBrand.get(String(brand._id));
        if (!row) {
            row = { brand_id: String(brand._id), brand_name: brand.name, all_models: false, models: [] };
            byBrand.set(row.brand_id, row);
            list.push(row);
        }
        if (!change.model_id) continue;
        const model = [...brand.models.values()].find((m) => String(m._id) === String(change.model_id));
        if (!model) throw Object.assign(new Error('That model is not in the car list.'), { status: 400 });
        const years = (change.all_years ? [] : (change.years || []).map(Number).filter(Number.isFinite));
        const allYears = !!change.all_years || !years.length;
        const existing = row.models.find((m) => m.model_id === String(model._id));
        if (existing) Object.assign(existing, { years, all_years: allYears });
        else row.models.push({ model_id: String(model._id), model_name: model.name, years, all_years: allYears });
    }
    return { is_universal: false, compatible_cars: list };
};

module.exports = { checkFitment, applyFitmentFix, ACTIONABLE, TEXT_FIELDS };
