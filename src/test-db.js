require('dotenv').config();
const mongoose = require('mongoose');

const test = async () => {
    console.log('Testing connection to:', process.env.MONGO_URI);
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        });
        console.log('✅ Connection successful!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Connection failed:', e.message);
        process.exit(1);
    }
};

test();
