const express = require('express');
const router = express.Router();
const { protect, validatePurchase } = require('../middleware/auth');
const { getFileStream } = require('../services/storage');
const { Product } = require('../models');

const fs = require('fs');
const path = require('path');

const getMimeType = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.pdf': 'application/pdf',
        '.epub': 'application/epub+zip',
        '.mp3': 'audio/mpeg',
        '.mpeg': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.aac': 'audio/aac',
        '.m4a': 'audio/mp4',
        '.mp4': 'audio/mp4',
        '.m4v': 'video/mp4',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.txt': 'text/plain',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.html': 'text/html'
    };
    return map[ext] || 'application/octet-stream';
};

// Helper: Find product by ObjectId or legacyId (string)
async function findProductById(id) {
    const isObjectId = /^[a-f\d]{24}$/i.test(id);
    let product = null;
    if (isObjectId) {
        product = await Product.findById(id);
    }
    if (!product) {
        product = await Product.findOne({ legacyId: id });
    }
    return product;
}

const streamAudioFile = (filePath, req, res) => {
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Audio file not found' });

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const mimeType = getMimeType(filePath);

    // Security headers - prevent download
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': mimeType,
            'Cache-Control': 'no-store'
        });
        file.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
        });
        fs.createReadStream(filePath).pipe(res);
    }
};

// Secure E-Book Streaming
router.get('/ebook/:productId', protect, validatePurchase, async (req, res) => {
    try {
        const product = await findProductById(req.params.productId);
        if (!product || product.type !== 'EBOOK') {
            return res.status(404).json({ message: 'E-Book not found' });
        }

        if (!product.filePath) {
            console.error(`❌ EBOOK: No filePath set for product ${product._id} (${product.title})`);
            return res.status(404).json({ message: 'E-Book file path not configured. Please upload the ebook file.' });
        }

        const uploadStore = path.join(__dirname, '../');
        // Auto-fix legacy paths: ebooks/ -> uploads/ebooks/
        let filePath = product.filePath;
        if (filePath.startsWith('ebooks/')) filePath = 'uploads/' + filePath;
        const fullPath = path.resolve(uploadStore, filePath);

        console.log(`📖 EBOOK STREAM: Product=${product._id}, filePath=${filePath}, fullPath=${fullPath}, exists=${fs.existsSync(fullPath)}`);

        if (!fs.existsSync(fullPath)) {
            console.error(`❌ EBOOK FILE MISSING: ${fullPath}`);
            return res.status(404).json({ message: 'PDF file not found on server. Please ensure the file was uploaded correctly.' });
        }

        const stat = fs.statSync(fullPath);
        const fileSize = stat.size;
        const range = req.headers.range;
        const mimeType = getMimeType(product.filePath);

        // Security headers - prevent download
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(fullPath, { start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': mimeType,
                'Cache-Control': 'no-store'
            });
            file.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': mimeType,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-store'
            });
            fs.createReadStream(fullPath).pipe(res);
        }
    } catch (error) {
        console.error('🔥 EBOOK STREAM ERROR:', error);
        res.status(500).json({ message: `Streaming error: ${error.message}` });
    }
});

// Secure Audiobook Streaming (legacy single-file)
router.get('/audio/:productId', protect, validatePurchase, async (req, res) => {
    try {
        const product = await findProductById(req.params.productId);
        if (!product || product.type !== 'AUDIOBOOK') {
            return res.status(404).json({ message: 'Audiobook not found' });
        }

        if (!product.filePath) {
            console.error(`❌ AUDIO: No filePath for product ${product._id} (${product.title})`);
            return res.status(404).json({ message: 'Audio file path not configured.' });
        }

        const uploadStore = path.join(__dirname, '../');
        // Auto-fix legacy paths
        let filePath = product.filePath;
        if (filePath.startsWith('audios/')) filePath = 'uploads/' + filePath;
        const fullPath = path.resolve(uploadStore, filePath);

        console.log(`🎧 AUDIO STREAM: Product=${product._id}, fullPath=${fullPath}, exists=${fs.existsSync(fullPath)}`);
        streamAudioFile(fullPath, req, res);
    } catch (error) {
        res.status(500).json({ message: 'Audio streaming error' });
    }
});

// ─── CHAPTER AUDIO STREAMING ────────────────────────────────────────────────
// GET /api/content/chapter/:productId/:chapterIndex
// Streams a specific chapter's audio. chapterIndex is 0-based.
router.get('/chapter/:productId/:chapterIndex', protect, validatePurchase, async (req, res) => {
    try {
        const product = await findProductById(req.params.productId);
        if (!product || product.type !== 'AUDIOBOOK') {
            return res.status(404).json({ message: 'Audiobook not found' });
        }

        const chapterIndex = parseInt(req.params.chapterIndex, 10);
        if (isNaN(chapterIndex) || chapterIndex < 0) {
            return res.status(400).json({ message: 'Invalid chapter index' });
        }

        // Find chapter by 0-based index (chapters array is sorted by chapterNumber)
        const sortedChapters = (product.chapters || [])
            .filter(c => c.filePath)
            .sort((a, b) => a.chapterNumber - b.chapterNumber);

        const chapter = sortedChapters[chapterIndex];
        if (!chapter || !chapter.filePath) {
            return res.status(404).json({ message: `Chapter ${chapterIndex + 1} not found or not uploaded yet` });
        }

        const uploadStore = path.join(__dirname, '../');
        // Auto-fix legacy paths
        let chFilePath = chapter.filePath;
        if (chFilePath.startsWith('audios/')) chFilePath = 'uploads/' + chFilePath;
        const fullPath = path.resolve(uploadStore, chFilePath);

        console.log(`🎵 CHAPTER STREAM: Product=${req.params.productId}, Ch=${chapterIndex}, fullPath=${fullPath}, exists=${fs.existsSync(fullPath)}`);

        if (!fs.existsSync(fullPath)) {
            console.error(`❌ CHAPTER FILE MISSING: ${fullPath}`);
            return res.status(404).json({ message: `Chapter ${chapterIndex + 1} audio file not found on server.` });
        }

        streamAudioFile(fullPath, req, res);
    } catch (error) {
        console.error('Chapter stream error:', error);
        res.status(500).json({ message: 'Chapter audio streaming error' });
    }
});

module.exports = router;
