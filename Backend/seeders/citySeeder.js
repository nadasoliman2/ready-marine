require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");
const { City } = require("../models/cities");
const { ShippingZone } = require("../models/shipping_zones");
const bostaTariff = require("../services/bostaTariff");
const bostaRatesSeeder = require("./bostaRatesSeeder");

const EGYPT_CITIES = [
  { name: "Cairo", name_ar: "القاهره", bosta_code: "EG-01" },
  { name: "Alexandria", name_ar: "الاسكندريه", bosta_code: "EG-02" },
  { name: "North Coast", name_ar: "الساحل الشمالي", bosta_code: "EG-03" },
  { name: "Behira", name_ar: "البحيره", bosta_code: "EG-04" },
  { name: "Dakahlia", name_ar: "الدقهليه", bosta_code: "EG-05" },
  { name: "El Kalioubia", name_ar: "القليوبيه", bosta_code: "EG-06" },
  { name: "Gharbia", name_ar: "الغربيه", bosta_code: "EG-07" },
  { name: "Kafr Alsheikh", name_ar: "كفر الشيخ", bosta_code: "EG-08" },
  { name: "Monufia", name_ar: "المنوفيه", bosta_code: "EG-09" },
  { name: "Sharqia", name_ar: "الشرقيه", bosta_code: "EG-10" },
  { name: "Ismailia", name_ar: "الاسماعيليه", bosta_code: "EG-11" },
  { name: "Suez", name_ar: "السويس", bosta_code: "EG-12" },
  { name: "Port Said", name_ar: "بور سعيد", bosta_code: "EG-13" },
  { name: "Damietta", name_ar: "دمياط", bosta_code: "EG-14" },
  { name: "Fayoum", name_ar: "الفيوم", bosta_code: "EG-15" },
  { name: "Bani Suif", name_ar: "بني سويف", bosta_code: "EG-16" },
  { name: "Assuit", name_ar: "اسيوط", bosta_code: "EG-17" },
  { name: "Sohag", name_ar: "سوهاج", bosta_code: "EG-18" },
  { name: "Menya", name_ar: "المنيا", bosta_code: "EG-19" },
  { name: "Qena", name_ar: "قنا", bosta_code: "EG-20" },
  { name: "Aswan", name_ar: "اسوان", bosta_code: "EG-21" },
  { name: "Luxor", name_ar: "الاقصر", bosta_code: "EG-22" },
  { name: "Red Sea", name_ar: "البحر الاحمر", bosta_code: "EG-23" },
  { name: "New Valley", name_ar: "الوادي الجديد", bosta_code: "EG-24" },
  { name: "Giza", name_ar: "الجيزه", bosta_code: "EG-25" },
  { name: "South Sinai", name_ar: "جنوب سيناء", bosta_code: "EG-26" },
  { name: "North Sinai", name_ar: "شمال سيناء", bosta_code: "EG-27" },
  { name: "Matrouh", name_ar: "مرسي مطروح", bosta_code: "EG-28" },
];

async function seed() {
  let shouldDisconnect = false;
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("Connected to DB");
      shouldDisconnect = true;
    }

    // Seed cities (upsert by name — never overwrites bosta_code)
    let seeded = 0;
    for (const city of EGYPT_CITIES) {
      const exists = await City.findOne({ name: city.name });
      if (!exists) {
        await City.create({
          ...city,
          country: "Egypt",
          country_ar: "مصر",
          bosta_sector: bostaTariff.sectorForCity(city.name),
        });
        seeded++;
      }
    }
    if (seeded > 0) console.log(`✅ Seeded ${seeded} Egyptian cities`);

    // Shipping zones are NOT built here any more. Bosta prices by sector, not by country,
    // so a single "Egypt" zone cannot express the rate — Cairo and Aswan differ by 72 EGP
    // for the same parcel. `bostaRatesSeeder` owns the seven sector zones and the rates
    // inside them; this seeder owns only the cities and which sector each one is in.
    if (await ShippingZone.countDocuments({ is_active: true }) === 0) {
      console.log("No active shipping zones — seeding Bosta sector zones and rates…");
      await bostaRatesSeeder.seed({ apply: true });
    }

    console.log("City seeding completed.");
    if (shouldDisconnect) {
      await mongoose.disconnect();
      console.log("🔌 Disconnected.");
    }
  } catch (err) {
    console.error("City seeding failed:", err);
    if (shouldDisconnect) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  seed();
}

module.exports = { seed, EGYPT_CITIES };
