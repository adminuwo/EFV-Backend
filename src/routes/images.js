const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// ─── Initialize GCS client (optional, graceful fallback if not available) ───
let storage;
try {
    const { Storage } = require('@google-cloud/storage');
    storage = new Storage();
} catch (e) {
    console.warn('⚠️ GCS Storage not initialized (local mode):', e.message);
}

// Local uploads base directory
const uploadsDir = path.join(__dirname, '..', 'uploads');

/**
 * Try GCS first, fall back to local disk.
 * filePath: e.g. "covers/cover-xxx.jpg" or "gallery/gallery-xxx.jpg"
 */
async function serveImage(bucketName, filePath, subfolder, res) {
    // 1️⃣ Try GCS first
    if (storage && bucketName) {
        try {
            const bucket = storage.bucket(bucketName);
            const file = bucket.file(filePath);
            const [exists] = await file.exists();

            if (exists) {
                const [metadata] = await file.getMetadata();
                res.setHeader('Content-Type', metadata.contentType || 'image/jpeg');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                return file.createReadStream()
                    .on('error', (err) => {
                        if (!res.headersSent) res.status(500).send('Stream error');
                    })
                    .pipe(res);
            }
        } catch (e) {
            console.warn(`⚠️ GCS error for ${filePath}:`, e.message);
        }
    }

    // 2️⃣ Fall back to local disk
    // filePath could be "covers/cover-xxx.jpg" → look in uploads/covers/cover-xxx.jpg
    // or just the filename without folder
    const localPaths = [
        path.join(uploadsDir, filePath),
        path.join(uploadsDir, subfolder, path.basename(filePath))
    ];

    for (const localPath of localPaths) {
        if (fs.existsSync(localPath)) {
            console.log(`📁 Serving local fallback: ${localPath}`);
            return res.sendFile(localPath);
        }
    }

    return res.status(404).json({ message: 'Image not found in GCS or local storage' });
}

// SECURE ROUTE: Serve cover images
router.get('/cover/*', async (req, res) => {
    const filePath = req.params[0]; // e.g. "covers/cover-xxx.jpg"
    const bucketName = process.env.GCS_COVER_BUCKET_NAME || 'efvbookcover';
    await serveImage(bucketName, filePath, 'covers', res);
});

// SECURE ROUTE: Serve gallery images
router.get('/gallery/*', async (req, res) => {
    const filePath = req.params[0];
    const bucketName = process.env.GCS_BUCKET_NAME || 'efvbucket';
    await serveImage(bucketName, filePath, 'gallery', res);
});

module.exports = router;
