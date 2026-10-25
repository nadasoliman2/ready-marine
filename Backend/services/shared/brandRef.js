/**
 * A product's brand can be one of two things, and this is the one place that tells them apart.
 *
 * WHY. A great many parts are made by the car maker itself — a Toyota filter, a BMW sensor —
 * so "Toyota" is as much a product brand as "Bosch" is. Before this, only the brands an admin
 * typed by hand (`Brand`, collection `brands`) could be picked, and to offer Toyota you had
 * to type it again beside the Toyota that already exists as a car make (`CarBrand`), with a
 * second logo and a second name to keep in step. Now every car make is offered on every
 * brand list as it stands, and `product_brand_id` may point at either collection.
 *
 * HOW. Mongoose resolves the reference through `product_brand_source`
 * ('Brand' | 'CarBrand', a `refPath`). Nothing that writes a product needs to know which it
 * picked: the hooks below look the id up and stamp the source on every save and every
 * findOneAndUpdate. ObjectIds are unique across collections in practice, so an id is enough.
 *
 * Car-make ids are cached for a minute — there are ~115 of them and the lookup runs on every
 * product write and every filter payload.
 */
const mongoose = require("mongoose");

const CACHE_MS = 60 * 1000;
let cache = { ids: null, at: 0 };

const carBrandIds = async () => {
    if (cache.ids && Date.now() - cache.at < CACHE_MS) return cache.ids;
    const { CarBrand } = require("../../models/car_brands");
    const rows = await CarBrand.find().select("_id").lean();
    cache = { ids: new Set(rows.map((r) => String(r._id))), at: Date.now() };
    return cache.ids;
};

/** Forget the cached makes — called when an admin adds or removes one. */
const invalidateBrandRefCache = () => { cache = { ids: null, at: 0 }; };

/** 'CarBrand' when `id` is a car make, 'Brand' otherwise (including null). */
const resolveBrandSource = async (id) => {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return "Brand";
    return (await carBrandIds()).has(String(id)) ? "CarBrand" : "Brand";
};

/**
 * Stamp `product_brand_source` on every write path of a schema that carries
 * `product_brand_id`: document saves, and findOneAndUpdate / findByIdAndUpdate with the
 * brand in `$set` or at the top level.
 */
const attachBrandSourceHooks = (schema) => {
    schema.pre("validate", async function () {
        if (this.isModified("product_brand_id") || !this.product_brand_source) {
            this.product_brand_source = await resolveBrandSource(this.product_brand_id);
        }
    });
    schema.pre("findOneAndUpdate", async function () {
        const update = this.getUpdate() || {};
        const set = update.$set || update;
        if (!Object.prototype.hasOwnProperty.call(set, "product_brand_id")) return;
        set.product_brand_source = await resolveBrandSource(set.product_brand_id);
        if (update.$set) update.$set = set;
    });
};

/**
 * The car makes shaped like product brands, for any list that offers both. `categories`
 * is empty on purpose: an untagged brand fits every category, which is exactly right for
 * a maker whose parts span the whole car.
 */
const carBrandsAsProductBrands = async () => {
    const { CarBrand } = require("../../models/car_brands");
    const rows = await CarBrand.find().select("name image").sort({ name: 1 }).lean();
    return rows.map((r) => ({
        _id: r._id,
        name: r.name,
        image: r.image || "",
        categories: [],
        source: "CarBrand",
        is_car_brand: true,
    }));
};

/**
 * Hand-entered brands and car makes as one list, sorted by name. A make whose name is
 * also typed as a hand-entered brand appears once, as the hand-entered one, so an admin
 * can still override a make's logo or category tags by creating it explicitly.
 */
const mergedProductBrands = async (manualBrands) => {
    const manual = (manualBrands || []).map((b) => ({ ...b, source: "Brand", is_car_brand: false }));
    const taken = new Set(manual.map((b) => String(b.name || "").trim().toLowerCase()));
    const makes = (await carBrandsAsProductBrands()).filter((c) => !taken.has(String(c.name).trim().toLowerCase()));
    return [...manual, ...makes].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
};

module.exports = {
    resolveBrandSource,
    attachBrandSourceHooks,
    carBrandsAsProductBrands,
    mergedProductBrands,
    invalidateBrandRefCache,
    BRAND_SOURCES: ["Brand", "CarBrand"],
};
