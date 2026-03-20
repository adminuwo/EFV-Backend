const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });

const { Product } = require('./src/models');

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        const audiobooks = await Product.find({ type: 'AUDIOBOOK' }).select('title type filePath chapters');
        console.log("Found Audiobooks:");
        audiobooks.forEach(ab => {
            console.log(`- ${ab.title} | Main filePath: ${ab.filePath}`);
            if (ab.chapters && ab.chapters.length > 0) {
                console.log(`  - Chapters: ${ab.chapters.length}`);
                ab.chapters.forEach(c => console.log(`    - Chap ${c.chapterNumber}: ${c.filePath}`));
            }
        });
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
