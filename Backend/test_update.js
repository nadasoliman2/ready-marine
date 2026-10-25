require('dotenv').config();
const mongoose = require('mongoose');
const { Product } = require('./models/products'); // adjust path if needed

async function test() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/sayarty');
    console.log('Connected');
    
    // We don't have the exact payload, but let's try finding the product
    const prod = await Product.findById('69e7fc4afb36531f7bf67e7a');
    if (!prod) {
        console.log("Product not found");
        return;
    }
    console.log("Found product:", prod.title_en);
    
    // Let's force a validation error check on its current state or try saving it
    try {
        await prod.validate();
        console.log("Product is currently valid in DB");
    } catch (e) {
        console.log("Validation error on current DB state:", e.message);
    }
    
    // Now let's try an update similar to what the frontend sends
    const vendorService = require('./services/vendorService');
    const updateData = {
        title_en: prod.title_en,
        variants: [
            {
                selected_options: [
                    { type_name: "Color", option_value: "Red" }
                ],
                price: null,
                discount_type: null,
                discount_value: null,
                stock: 10
            }
        ],
        variation_types: [
            {
                name: "Color",
                options: [{ value: "Red" }]
            }
        ]
    };
    
    try {
        await vendorService.updateProduct(prod.vendor_id, prod._id, updateData);
        console.log("Update succeeded");
    } catch (e) {
        console.error("Update failed:", e);
    }
    
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.disconnect();
  }
}
test();
