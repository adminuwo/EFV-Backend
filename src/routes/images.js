const express = require('express');
const router = express.Router();
const path = require('path');
const { Storage } = require('@google-cloud/storage');

// Initialize GCS client
let storage;
try {
    storage = new Storage();
} catch (e) {
    console.error('❌ GCS Storage initialization failed:', e.message);
}

/**
 * Proxy function to stream a file from a private GCS bucket to the response.
 */
async function proxyGCSFile(bucketName, filePath, res) {
    if (!storage) {
        return res.status(500).json({ message: 'Storage service unavailable' });
    }

    try {
        const bucket = storage.bucket(bucketName);
        const file = bucket.file(filePath);

        // Check if file exists
        const [exists] = await file.exists();
        if (!exists) {
            return res.status(404).json({ message: 'File not found in bucket' });
        }

        // Get metadata for content-type
        const [metadata] = await file.getMetadata();
        
        // Set headers
        res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

        // Stream the file
        file.createReadStream()
            .on('error', (err) => {
                console.error(`Stream error for ${filePath}:`, err);
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Error streaming file' });
                }
            })
            .pipe(res);

    } catch (error) {
        console.error(`Proxy error for bucket ${bucketName}, file ${filePath}:`, error);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Internal server error during image proxy' });
        }
    }
}

// SECURE ROUTE: Serve cover images from private GCS
router.get('/cover/*', async (req, res) => {
    // Path will be like /api/images/cover/vol1-cover.png
    const filePath = req.params[0];
    const bucketName = process.env.GCS_COVER_BUCKET_NAME || 'efvbookcover';
    
    await proxyGCSFile(bucketName, filePath, res);
});

// SECURE ROUTE: Serve gallery/product images from main private GCS
router.get('/gallery/*', async (req, res) => {
    const filePath = req.params[0];
    const bucketName = process.env.GCS_BUCKET_NAME || 'efvbucket';
    
    await proxyGCSFile(bucketName, filePath, res);
});

module.exports = router;
