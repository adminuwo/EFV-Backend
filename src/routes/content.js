const express = require('express');
const router = express.Router();
const { protect, validatePurchase } = require('../middleware/auth');
const { Product } = require('../models');
const { Storage } = require('@google-cloud/storage');

const fs = require('fs');
const path = require('path');

// Initialize GCS for private streaming
const hasGCS = process.env.GCS_BUCKET_NAME && process.env.GCS_BUCKET_NAME !== 'efv-assets-bucket';

let storage;
if (hasGCS) {
    storage = new Storage({
        projectId: process.env.GCS_PROJECT_ID,
        // Intentionally omitted keyFilename to force Application Default Credentials (ADC)
    });
}

const getMimeType = (filePath) => {
    const ext = path.extname(filePath.split('?')[0].split('#')[0]).toLowerCase();
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

// HELPER: Extract relative path from GCS URL
const getGcsRelativePath = (fullUrl) => {
    if (!fullUrl) return null;
    // URL looks like https://storage.googleapis.com/efvframework/ebooks/file.pdf
    try {
        const parts = fullUrl.split(`${process.env.GCS_BUCKET_NAME}/`);
        if (parts.length > 1) return parts[1];
    } catch (e) {}
    return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// PROXY STREAMER: Fetches from private GCS and pipes to response
// ─────────────────────────────────────────────────────────────────────────────
const streamFromGCS = async (gcsPath, req, res) => {
    try {
        const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
        const file = bucket.file(gcsPath);

        const [metadata] = await file.getMetadata();
        const fileSize = parseInt(metadata.size);
        const mimeType = metadata.contentType || getMimeType(gcsPath);

        // Standard Security Headers
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');

        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': mimeType,
            });

            file.createReadStream({ start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': mimeType,
                'Accept-Ranges': 'bytes',
            });
            file.createReadStream().pipe(res);
        }
    } catch (error) {
        console.error('❌ GCS Stream Error:', error);
        res.status(404).json({ message: 'File could not be fetched from cloud storage.' });
    }
};

const streamLocalFile = (fullPath, req, res) => {
    if (!fs.existsSync(fullPath)) return res.status(404).json({ message: 'Local file not found.' });
    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const mimeType = getMimeType(fullPath);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': (end - start) + 1,
            'Content-Type': mimeType,
        });
        fs.createReadStream(fullPath, { start, end }).pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': mimeType,
            'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(fullPath).pipe(res);
    }
};

// Helper: Find product
async function findProductById(id) {
    const isObjectId = /^[a-f\d]{24}$/i.test(id);
    return isObjectId ? await Product.findById(id) : await Product.findOne({ legacyId: id });
}

// 📖 Secure E-Book Endpoint
router.get('/ebook/:productId', protect, validatePurchase, async (req, res) => {
    try {
        const product = await findProductById(req.params.productId);
        if (!product || !product.filePath) return res.status(404).json({ message: 'E-Book not found' });

        if (product.filePath.startsWith('http') && hasGCS) {
            const relPath = getGcsRelativePath(product.filePath);
            if (relPath) {
                // Generate a signed URL valid for 1 hour
                const options = {
                    version: 'v4',
                    action: 'read',
                    expires: Date.now() + 60 * 60 * 1000, // 1 hour
                };
                
                const [url] = await storage.bucket(process.env.GCS_BUCKET_NAME).file(relPath).getSignedUrl(options);
                return res.redirect(url); // Redirect the client to the signed URL
            }
        }

        const fullPath = path.resolve(__dirname, '../', product.filePath.startsWith('ebooks/') ? 'uploads/' + product.filePath : product.filePath);
        streamLocalFile(fullPath, req, res);
    } catch (error) {
        console.error('EBOOK signed URL error:', error);
        res.status(500).json({ message: error.message });
    }
});

// 🎧 Secure Audiobook Endpoint
router.get('/audio/:productId', protect, validatePurchase, async (req, res) => {
    try {
        const product = await findProductById(req.params.productId);
        if (!product || !product.filePath) return res.status(404).json({ message: 'Audiobook not found' });

        if (product.filePath.startsWith('http') && hasGCS) {
            const relPath = getGcsRelativePath(product.filePath);
            if (relPath) {
                const options = { version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000 };
                const [url] = await storage.bucket(process.env.GCS_BUCKET_NAME).file(relPath).getSignedUrl(options);
                return res.redirect(url);
            }
        }

        const fullPath = path.resolve(__dirname, '../', product.filePath.startsWith('audios/') ? 'uploads/' + product.filePath : product.filePath);
        streamLocalFile(fullPath, req, res);
    } catch (error) {
        console.error('AUDIO signed URL error:', error);
        res.status(500).json({ message: 'Audio stream error' });
    }
});

// 🎵 Chapter Endpoint
router.get('/chapter/:productId/:chapterIndex', protect, validatePurchase, async (req, res) => {
    try {
        const product = await findProductById(req.params.productId);
        const idx = parseInt(req.params.chapterIndex);
        const chapter = (product?.chapters || []).sort((a, b) => a.chapterNumber - b.chapterNumber)[idx];
        if (!chapter?.filePath) return res.status(404).json({ message: 'Chapter not found' });

        if (chapter.filePath.startsWith('http') && hasGCS) {
            const relPath = getGcsRelativePath(chapter.filePath);
            if (relPath) {
                const options = { version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000 };
                const [url] = await storage.bucket(process.env.GCS_BUCKET_NAME).file(relPath).getSignedUrl(options);
                return res.redirect(url);
            }
        }

        const fullPath = path.resolve(__dirname, '../', chapter.filePath.startsWith('audios/') ? 'uploads/' + chapter.filePath : chapter.filePath);
        streamLocalFile(fullPath, req, res);
    } catch (error) {
        console.error('CHAPTER signed URL error:', error);
        res.status(500).json({ message: 'Chapter stream error' });
    }
});

module.exports = router;
