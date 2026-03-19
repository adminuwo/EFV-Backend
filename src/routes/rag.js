const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const adminAuth = require('../middleware/adminAuth');

const { Storage } = require('@google-cloud/storage');

// Local storage path
const ragUploadDir = path.join(__dirname, '..', 'uploads', 'rag');
if (!fs.existsSync(ragUploadDir)) {
    fs.mkdirSync(ragUploadDir, { recursive: true });
}

// GCS Setting
const gcsBucketName = process.env.GCS_RAG_BUCKET_NAME || 'efvrag';
let storageClient;
try {
    storageClient = new Storage();
} catch (e) { console.warn('Cloud Storage not initialized for RAG:', e.message); }

// Multer for local storage (primary write)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, ragUploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/rag/files - List documents (Merge Local + GCS)
router.get('/files', adminAuth, async (req, res) => {
    try {
        const localFiles = fs.readdirSync(ragUploadDir);
        const fileList = localFiles.map(filename => {
            const stats = fs.statSync(path.join(ragUploadDir, filename));
            return {
                name: filename,
                size: stats.size,
                updated: stats.mtime,
                source: 'local'
            };
        });

        // Optional: Merge with GCS files if available to show "Live" status
        if (storageClient) {
            try {
                const [gcsFiles] = await storageClient.bucket(gcsBucketName).getFiles();
                gcsFiles.forEach(gf => {
                    const localIdx = fileList.findIndex(lf => lf.name === gf.name);
                    if (localIdx === -1) {
                        fileList.push({
                            name: gf.name,
                            size: gf.metadata.size,
                            updated: gf.metadata.updated,
                            source: 'cloud'
                        });
                    } else {
                        fileList[localIdx].source = 'synced'; // Found in both
                    }
                });
            } catch (e) { console.warn('GCS List Error:', e.message); }
        }
        res.json(fileList);
    } catch (error) {
        console.error('RAG List Error:', error);
        res.status(500).json({ error: 'Failed to list RAG documents' });
    }
});

// POST /api/rag/upload - Upload to Local + GCS Sync
router.post('/upload', adminAuth, upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const localFilePath = req.file.path;
        let syncedToCloud = false;

        // Automatically push to cloud bucket if available
        if (storageClient) {
            try {
                const bucket = storageClient.bucket(gcsBucketName);
                await bucket.upload(localFilePath, {
                    destination: req.file.originalname,
                    metadata: { contentType: req.file.mimetype }
                });
                syncedToCloud = true;
            } catch (cloudErr) {
                console.error('⚠️ Sync to Cloud Bucket failed:', cloudErr.message);
            }
        }

        res.json({ 
            message: syncedToCloud ? 'Document uploaded and synced to cloud 🌩️' : 'Document saved locally (cloud sync pending)', 
            name: req.file.filename,
            cloud: syncedToCloud
        });
    } catch (error) {
        console.error('RAG Upload Error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// DELETE /api/rag/files/:name - Delete Local + GCS
router.delete('/files/:name', adminAuth, async (req, res) => {
    try {
        const fileName = req.params.name;
        const localPath = path.join(ragUploadDir, fileName);

        // Remove from Cloud
        if (storageClient) {
            try {
                await storageClient.bucket(gcsBucketName).file(fileName).delete();
            } catch (e) { console.warn('Could not delete from cloud:', e.message); }
        }

        // Remove from local
        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
        }

        res.json({ message: 'Document deleted successfully' });
    } catch (error) {
        console.error('RAG Delete Error:', error);
        res.status(500).json({ error: 'Delete failed' });
    }
});

module.exports = router;
