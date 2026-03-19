const express = require('express');
const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// 🖼️ IMAGE PROXY: Serve private GCS bucket images through backend
// This allows GCS buckets to remain PRIVATE while still serving images to frontend
// Usage: GET /api/images/cover/<gcs-object-path>
//        GET /api/images/gallery/<gcs-object-path>
// ─────────────────────────────────────────────────────────────────────────────

let storageClient = null;

const initStorage = () => {
    if (storageClient) return storageClient;
    try {
        const { Storage } = require('@google-cloud/storage');
        storageClient = new Storage({ projectId: process.env.GCS_PROJECT_ID || 'efvframework' });
        return storageClient;
    } catch (e) {
        console.error('❌ GCS Storage client failed to init:', e.message);
        return null;
    }
};

// Proxy a file from a private GCS bucket
const proxyGCSFile = async (req, res, bucketName, objectPath) => {
    try {
        const gcs = initStorage();
        if (!gcs) return res.status(503).json({ message: 'Storage unavailable' });
        
        if (!bucketName) return res.status(500).json({ message: 'Bucket not configured' });
        if (!objectPath) return res.status(400).json({ message: 'Invalid image path' });

        const bucket = gcs.bucket(bucketName);
        const file = bucket.file(objectPath);

        // Check file exists
        const [exists] = await file.exists();
        if (!exists) {
            console.warn(`⚠️ Image not found in GCS: gs://${bucketName}/${objectPath}`);
            return res.status(404).json({ message: 'Image not found' });
        }

        // Get metadata for content-type
        const [metadata] = await file.getMetadata();
        const contentType = metadata.contentType || 'image/jpeg';
        
        // Set caching headers (1 hour) so browser caches the image
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        
        // Stream the file directly
        console.log(`📤 Proxying GCS image: gs://${bucketName}/${objectPath}`);
        file.createReadStream()
            .on('error', (err) => {
                console.error('GCS stream error:', err);
                if (!res.headersSent) res.status(500).json({ message: 'Error reading image' });
            })
            .pipe(res);

    } catch (err) {
        console.error('❌ Image proxy error:', err.message);
        if (!res.headersSent) res.status(500).json({ message: 'Image proxy failed' });
    }
};

// ── COVER IMAGES: GET /api/images/cover/*
// Serves from efvbookcover bucket (private)
router.get('/cover/*', async (req, res) => {
    const coverBucket = process.env.GCS_COVER_BUCKET_NAME || process.env.GCS_BUCKET_NAME;
    const objectPath = req.params[0]; // Everything after /cover/
    await proxyGCSFile(req, res, coverBucket, objectPath);
});

// ── GALLERY IMAGES: GET /api/images/gallery/*
// Serves from the main bucket (private)
router.get('/gallery/*', async (req, res) => {
    const mainBucket = process.env.GCS_BUCKET_NAME;
    const objectPath = 'gallery/' + req.params[0];
    await proxyGCSFile(req, res, mainBucket, objectPath);
});

// ── GENERIC GCS IMAGE: GET /api/images/gcs?bucket=xxx&path=yyy
// Flexible proxy for any GCS path
router.get('/gcs', async (req, res) => {
    const bucketName = req.query.bucket || process.env.GCS_BUCKET_NAME;
    const objectPath = req.query.path;
    if (!objectPath) return res.status(400).json({ message: 'Missing path parameter' });
    await proxyGCSFile(req, res, bucketName, objectPath);
});

module.exports = router;
