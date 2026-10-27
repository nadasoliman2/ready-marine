const mongoose = require('mongoose');
const { User } = require('../models/users');
const { Order } = require('../models/orders');
const { Product } = require('../models/products');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const seedOrder = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/readymarine');
        console.log('Connected to MongoDB');

        const user = await User.findOne({ email: 'ziad.abdelkader@test.com' }) || await User.findOne();
        if (!user) {
            console.log('No user found to assign order. Please register first.');
            process.exit(1);
        }

        const product = await Product.findOne();
        if (!product) {
            console.log('No products found to order.');
            process.exit(1);
        }

        const order = new Order({
            user_id: user._id,
            status: 'completed',
            shipping_address: {
                recipient_name: user.name,
                phone: user.phone || '0500000000',
                full_address: 'Al-Rawdah, Jeddah, KSA'
            },
            items: [
                {
                    product_id: product._id,
                    product_title: product.title_en || product.title_ar,
                    product_image: product.images[0]?.url || '',
                    variant_id: new mongoose.Types.ObjectId(),
                    variant_label: 'Standard Pack',
                    quantity: 2,
                    unit_price: product.price,
                    vendor_id: product.vendor_id
                }
            ],
            vendor_supervisions: [{
                vendor_id: product.vendor_id,
                total_amount: product.price * 2,
                fulfillment_location: 'Main Warehouse, Riyadh',
                status: 'pending'
            }],
            total_price: product.price * 2,
            transaction: {
                amount: product.price * 2,
                payment_method: 'credit_card',
                status: 'paid',
                reference: 'TRX_MOCK_12345'
            }
        });

        await order.save();
        console.log('Mock order seeded successfully for ' + user.email);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

seedOrder();
