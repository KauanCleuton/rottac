const router = require('express').Router();
const c = require('../controllers/errorNotebook.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Upload múltiplo para caderno de erros — organizado por tipo/userId/subjectId
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = file.mimetype.startsWith('image/') ? 'images' : 'audios';
    const userId = req.user?.id || 'anonymous';
    const subjectId = req.body?.subjectId || '_geral';
    const dir = path.join(__dirname, '../../uploads', folder, userId, subjectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 20971520 } });
const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'audio', maxCount: 1 },
]);

router.use(authenticate);

router.get('/', c.getEntries);
router.get('/due', c.getDueEntries);
router.get('/patterns', c.getPatterns);
router.post('/', uploadFields, c.createEntry);
router.put('/:id', c.updateEntry);
router.post('/:id/review', c.reviewEntry);
router.delete('/:id', c.deleteEntry);

module.exports = router;
