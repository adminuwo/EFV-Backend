const mongoose = require('./node_modules/mongoose');
require('./node_modules/dotenv').config({ path: './.env' });

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const db = mongoose.connection.db;
    
    // Fix ebook paths that start with 'ebooks/' instead of 'uploads/ebooks/'
    const resultEbooks = await db.collection('products').updateMany(
        { filePath: { $regex: '^ebooks/' } },
        [{ $set: { filePath: { $concat: ['uploads/', '$filePath'] } } }]
    );
    console.log(`Updated ${resultEbooks.modifiedCount} ebooks paths`);
    
    // Fix audio paths that start with 'audios/' instead of 'uploads/audios/'
    const resultAudios = await db.collection('products').updateMany(
        { filePath: { $regex: '^audios/' } },
        [{ $set: { filePath: { $concat: ['uploads/', '$filePath'] } } }]
    );
    console.log(`Updated ${resultAudios.modifiedCount} audio paths`);
    
    // Also need to check chapters array for each product
    const productsWithChapters = await db.collection('products').find({ chapters: { $exists: true, $not: {$size: 0} } }).toArray();
    let chapterUpdateCount = 0;
    
    for (const p of productsWithChapters) {
        let changed = false;
        const newChapters = p.chapters.map(ch => {
            if (ch.filePath && ch.filePath.startsWith('audios/')) {
                ch.filePath = 'uploads/' + ch.filePath;
                changed = true;
            }
            return ch;
        });
        
        if (changed) {
            await db.collection('products').updateOne({_id: p._id}, { $set: { chapters: newChapters } });
            chapterUpdateCount++;
            console.log(`Updated chapters for product: ${p.title}`);
        }
    }
    console.log(`Updated chapters in ${chapterUpdateCount} products`);

    process.exit(0);
}).catch(console.error);
