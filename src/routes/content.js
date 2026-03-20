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
        if (!product || !product.filePath) {
            console.error(`❌ E-Book not found in DB for ID: ${req.params.productId}`);
            return res.status(404).json({ message: 'E-Book not found' });
        }

        const bucketName = process.env.GCS_BUCKET_NAME;

        // --- GCS HANDLING ---
        if (product.filePath.startsWith('http') && hasGCS) {
            try {
                const relPath = getGcsRelativePath(product.filePath);
                if (relPath) {
                    console.log(`☁️ Proxying GCS E-Book Stream for: ${relPath}`);
                    // Force proxy for Ebooks. pdf.js relies on fetch and custom headers (Authorization/Range), 
                    // which fail CORS checks if redirected directly to GCS. Proxying safely streams it.
                    return await streamFromGCS(relPath, req, res);
                }
            } catch (err) {
                console.warn(`⚠️ GCS Ebook Proxy fail: ${err.message}.`);
                return res.status(500).json({ message: 'Cloud stream failed.' });
            }
        }

        // --- LOCAL FALLBACK ---
        // Strip domain and leading slash
        let cleanPath = product.filePath.replace(/^https?:\/\/[^\/]+\/[^\/]+\//, '').replace(/^\//, '');
        
        // Remove 'uploads/' prefix if we're going to use it for matching
        const relativeToUploads = cleanPath.replace(/^src\/uploads\//, '').replace(/^uploads\//, '');

        // Potential paths to check
        const searchPaths = [
            path.resolve(__dirname, '../../', cleanPath),                     // As stored (relative to project root/src)
            path.resolve(__dirname, '../../src/uploads/', relativeToUploads),  // Native project source structure
            path.resolve(__dirname, '../../uploads/', relativeToUploads),      // Root uploads structure
            path.resolve(__dirname, '../../src/', cleanPath),                  // Direct src relative
        ];

        let finalPath = null;
        for (const p of searchPaths) {
            if (fs.existsSync(p) && !fs.lstatSync(p).isDirectory()) {
                finalPath = p;
                break;
            }
        }

        // Add PWD fallback if everything else fails
        if (!finalPath) {
            const pwdPath1 = path.join(process.cwd(), cleanPath);
            const pwdPath2 = path.join(process.cwd(), 'src', cleanPath);
            if (fs.existsSync(pwdPath1) && !fs.lstatSync(pwdPath1).isDirectory()) finalPath = pwdPath1;
            else if (fs.existsSync(pwdPath2) && !fs.lstatSync(pwdPath2).isDirectory()) finalPath = pwdPath2;
        }

        if (!finalPath) {
            console.error(`❌ Local File Exhaustion: Could not find ${cleanPath} in any search path.`);
            return res.status(404).json({ message: 'Local eBook file not found on server.' });
        }

        console.log(`🔌 Streaming Ebook: ${finalPath}`);
        streamLocalFile(finalPath, req, res);
    } catch (error) {
        console.error('EBOOK stream error:', error);
        res.status(500).json({ message: error.message });
    }
});

// 🎧 Secure Audiobook Endpoint (Single File)
router.get('/audio/:productId', protect, validatePurchase, async (req, res) => {
    try {
        const product = await findProductById(req.params.productId);
        if (!product || !product.filePath) return res.status(404).json({ message: 'Audiobook not found' });

        const bucketName = process.env.GCS_BUCKET_NAME;

        if (product.filePath.startsWith('http') && hasGCS) {
            try {
                const relPath = getGcsRelativePath(product.filePath);
                if (relPath) {
                    const options = { version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000 };
                    const [url] = await storage.bucket(bucketName).file(relPath).getSignedUrl(options);
                    return res.redirect(url);
                }
            } catch (err) {
                console.warn(`⚠️ GCS Audio fail: ${err.message}. Proxying...`);
                const relPath = getGcsRelativePath(product.filePath);
                if (relPath) return streamFromGCS(relPath, req, res);
            }
        }

        // --- LOCAL FALLBACK ---
        // Strip domain and leading slash to get relative path
        let cleanPath = product.filePath.replace(/^https?:\/\/[^\/]+\/[^\/]+\//, '').replace(/^\//, '');
        
        // Remove common prefixes to get a pure relative path for matching
        const relativeToUploads = cleanPath.replace(/^src\/uploads\//, '').replace(/^uploads\//, '');

        // Comprehensive search paths to handle various deployment environments
        const searchPaths = [
            path.resolve(__dirname, '../../', cleanPath),                     // Root relative (V1 style)
            path.resolve(__dirname, '../../src/uploads/', relativeToUploads),  // src/uploads relative (V2 style)
            path.resolve(__dirname, '../../uploads/', relativeToUploads),      // root/uploads relative
            path.resolve(__dirname, '../../src/', cleanPath),                  // src relative
            path.join(process.cwd(), cleanPath),                               // PWD relative
            path.join(process.cwd(), 'src', cleanPath)                         // PWD/src relative
        ];

        let finalPath = null;
        for (const p of searchPaths) {
            if (fs.existsSync(p) && !fs.lstatSync(p).isDirectory()) {
                finalPath = p;
                break;
            }
        }

        if (!finalPath) {
            console.error(`❌ Audio File Not Found: Tried ${searchPaths.length} locations for ${cleanPath}`);
            return res.status(404).json({ message: 'Local audio file not found on server.' });
        }

        console.log(`🔌 Streaming Audio: ${finalPath}`);
        streamLocalFile(finalPath, req, res);
    } catch (error) {
        console.error('AUDIO stream error:', error);
        res.status(500).json({ message: error.message });
    }
});

// 🎵 Chapter Endpoint (Multi-file Audiobooks)
router.get('/chapter/:productId/:chapterIndex', protect, validatePurchase, async (req, res) => {
    try {
        const product = await findProductById(req.params.productId);
        const idx = parseInt(req.params.chapterIndex);
        if (!product || !product.chapters) return res.status(404).json({ message: 'Product or chapters not found' });

        const sortedChapters = [...product.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
        const chapter = sortedChapters[idx];
        if (!chapter || !chapter.filePath) return res.status(404).json({ message: 'Chapter file path not found' });

        const bucketName = process.env.GCS_BUCKET_NAME;

        if (chapter.filePath.startsWith('http') && hasGCS) {
            try {
                const relPath = getGcsRelativePath(chapter.filePath);
                if (relPath) {
                    const options = { version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000 };
                    const [url] = await storage.bucket(bucketName).file(relPath).getSignedUrl(options);
                    return res.redirect(url);
                }
            } catch (err) {
                console.warn(`⚠️ Chapter GCS fail: ${err.message}. Proxying...`);
                const relPath = getGcsRelativePath(chapter.filePath);
                if (relPath) return streamFromGCS(relPath, req, res);
            }
        }

        // --- LOCAL FALLBACK ---
        let cleanPath = chapter.filePath.replace(/^https?:\/\/[^\/]+\/[^\/]+\//, '').replace(/^\//, '');
        const relativeToUploads = cleanPath.replace(/^src\/uploads\//, '').replace(/^uploads\//, '');

        const searchPaths = [
            path.resolve(__dirname, '../../', cleanPath),
            path.resolve(__dirname, '../../src/uploads/', relativeToUploads),
            path.resolve(__dirname, '../../uploads/', relativeToUploads),
            path.resolve(__dirname, '../../src/', cleanPath),
            path.join(process.cwd(), cleanPath),
            path.join(process.cwd(), 'src', cleanPath)
        ];

        let finalPath = null;
        for (const p of searchPaths) {
            if (fs.existsSync(p) && !fs.lstatSync(p).isDirectory()) {
                finalPath = p;
                break;
            }
        }

        if (!finalPath) {
            console.error(`❌ Chapter File Not Found: Tried ${searchPaths.length} locations for ${cleanPath}`);
            return res.status(404).json({ message: 'Local chapter file not found on server.' });
        }

        console.log(`🎵 Streaming Chapter ${idx}: ${finalPath}`);
        streamLocalFile(finalPath, req, res);
    } catch (error) {
        console.error('CHAPTER stream error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
