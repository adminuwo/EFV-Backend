const mongoose = require('./node_modules/mongoose');
require('./node_modules/dotenv').config({ path: './.env' });
const fs = require('fs');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const ps = await mongoose.connection.db.collection('products').find({
        type: { $in: ['EBOOK', 'AUDIOBOOK'] }
    }).toArray();
    
    let output = '=== DIGITAL PRODUCTS ===\n';
    ps.forEach(p => {
        output += p.title + ' | ' + p.type + ' | ' + (p.language || 'N/A') + '\n';
        output += '  ID: ' + p._id.toString() + '\n';
        output += '  filePath: ' + (p.filePath || 'NONE') + '\n';
        output += '  chapters: ' + (p.chapters ? p.chapters.length : 0) + '\n';
        if (p.chapters && p.chapters.length > 0) {
            p.chapters.forEach((ch, i) => {
                output += '    ch' + i + ': ' + (ch.title || 'untitled') + ' -> ' + (ch.filePath || 'NO FILE') + '\n';
            });
        }
        output += '---\n';
    });
    
    fs.writeFileSync('check_result.txt', output, 'utf8');
    console.log('Written to check_result.txt');
    process.exit(0);
}).catch(console.error);
