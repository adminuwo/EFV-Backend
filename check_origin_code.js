const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });
const { Product } = require('./src/models');
mongoose.connect(process.env.MONGO_URI).then(async () => {
    const ab = await Product.findOne({ title: /ORIGIN CODE/i });
    console.log(JSON.stringify(ab, null, 2));
    process.exit(0);
});
