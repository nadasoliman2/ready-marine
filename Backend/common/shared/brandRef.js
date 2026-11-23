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

const vesselBrandIds = async () => new Set();
const carBrandIds = vesselBrandIds;

const invalidateBrandRefCache = () => {};

/** Always 'Brand' - products only use the single Brand model */
const resolveBrandSource = async () => "Brand";

const attachBrandSourceHooks = (schema) => {
    schema.pre("validate", function () {
        this.product_brand_source = "Brand";
    });
    schema.pre("findOneAndUpdate", function () {
        const update = this.getUpdate() || {};
        const set = update.$set || update;
        set.product_brand_source = "Brand";
        if (update.$set) update.$set = set;
    });
};

const vesselBrandsAsProductBrands = async () => [];
const carBrandsAsProductBrands = vesselBrandsAsProductBrands;

/**
 * Returns product brands directly without injecting separate car/vessel make tables.
 */
const mergedProductBrands = async (manualBrands) => {
    return (manualBrands || []).map((b) => ({ ...b, source: "Brand", is_vessel_brand: false, is_car_brand: false }));
};

module.exports = {
    resolveBrandSource,
    attachBrandSourceHooks,
    vesselBrandsAsProductBrands,
    carBrandsAsProductBrands,
    mergedProductBrands,
    invalidateBrandRefCache,
    BRAND_SOURCES: ["Brand"],
};
