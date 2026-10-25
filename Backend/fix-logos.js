const mongoose = require('mongoose');

// Connect
mongoose.connect('mongodb://localhost:27017/sayarty');

const updateLogos = async () => {
    const { CarBrand } = require('./models/car_brands');
    const { Brand } = require('./models/product_brands');

    const carMap = {
        'Toyota': 'https://cdn.simpleicons.org/toyota',
        'Honda': 'https://cdn.simpleicons.org/honda',
        'BMW': 'https://cdn.simpleicons.org/bmw',
        'Mercedes-Benz': 'https://cdn.simpleicons.org/mercedes',
        'Nissan': 'https://cdn.simpleicons.org/nissan',
        'Hyundai': 'https://cdn.simpleicons.org/hyundai',
        'Kia': 'https://cdn.simpleicons.org/kia',
        'Ford': 'https://cdn.simpleicons.org/ford',
        'Chevrolet': 'https://cdn.simpleicons.org/chevrolet',
        'Lexus': 'https://cdn.simpleicons.org/lexus'
    };

    const brandMap = {
        'bosch': 'https://cdn.simpleicons.org/bosch',
        'denso': 'https://logo.clearbit.com/denso.com',
        'ngk': 'https://logo.clearbit.com/ngkntk.com',
        'brembo': 'https://cdn.simpleicons.org/brembo',
        'mobil 1': 'https://logo.clearbit.com/mobil.com',
        'castrol': 'https://cdn.simpleicons.org/castrol',
        'kyb': 'https://logo.clearbit.com/kyb.com',
        'aisin': 'https://logo.clearbit.com/aisin.com'
    };

    console.log('Updating Car Brands...');
    for (const [name, url] of Object.entries(carMap)) {
        await CarBrand.updateOne({ name: name }, { $set: { image: url } });
    }

    console.log('Updating Product Brands...');
    for (const [name, url] of Object.entries(brandMap)) {
        await Brand.updateOne({ name: name }, { $set: { image: url } });
    }

    console.log('Done.');
    process.exit(0);
};

updateLogos().catch(console.error);
