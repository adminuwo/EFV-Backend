const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const adminAuth = require('../middleware/adminAuth');

// Local storage path
const ragUploadDir = path.join(__dirname, '..', 'uploads', 'rag');
if (!fs.existsSync(ragUploadDir)) {
    fs.mkdirSync(ragUploadDir, { recursive: true });
}

// Multer for local storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, ragUploadDir);
    },
    filename: function (req, file, cb) {
        // Keep original name for RAG identification
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/rag/files - List all local documents
router.get('/files', adminAuth, async (req, res) => {
    try {
        const files = fs.readdirSync(ragUploadDir);
        const fileList = files.map(filename => {
            const stats = fs.statSync(path.join(ragUploadDir, filename));
            return {
                name: filename,
                size: stats.size,
                updated: stats.mtime
            };
        });
        res.json(fileList);
    } catch (error) {
        console.error('RAG Local List Error:', error);
        res.status(500).json({ error: 'Failed to list RAG documents' });
    }
});

// POST /api/rag/upload - Upload to local storage
router.post('/upload', adminAuth, upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        res.json({ message: 'Document saved locally', name: req.file.filename });
    } catch (error) {
        console.error('RAG Local Upload Error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// DELETE /api/rag/files/:name - Delete local document
router.delete('/files/:name', adminAuth, async (req, res) => {
    try {
        const filePath = path.join(ragUploadDir, req.params.name);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.json({ message: 'Document deleted locally' });
    } catch (error) {
        console.error('RAG Local Delete Error:', error);
        res.status(500).json({ error: 'Delete failed' });
    }
});

module.exports = router;
