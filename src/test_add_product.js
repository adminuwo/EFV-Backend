const mongoose = require('mongoose');
const path = require('path');
const Product = require('./models/index').Product;
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    try {
        console.log('Attempting to create a product WITHOUT legacyId...');
        const p1 = await Product.create({
            title: "Test Product " + Date.now(),
            price: 100,
            type: "HARDCOVER"
        });
        console.log('Success 1:', p1._id);

        console.log('Attempting to create another product WITHOUT legacyId...');
        const p2 = await Product.create({
            title: "Test Product " + (Date.now() + 1),
            price: 100,
            type: "HARDCOVER"
        });
        console.log('Success 2:', p2._id);
        
        // Cleanup
        await Product.deleteOne({ _id: p1._id });
        await Product.deleteOne({ _id: p2._id });
        console.log('Cleanup done.');

    } catch (e) {
        console.error('FAILED:', e.message);
        if (e.code === 11000) {
            console.error('Duplicate Key Error Detail:', JSON.stringify(e.keyPattern), JSON.stringify(e.keyValue));
        }
    } finally {
        await mongoose.disconnect();
    }
}
test();
