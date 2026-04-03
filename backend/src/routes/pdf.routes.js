const router = require('express').Router();
const c = require('../controllers/pdf.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { uploadPDF } = require('../middlewares/upload.middleware');

router.use(authenticate);
router.get('/', c.getPdfs);
router.post('/', uploadPDF, c.uploadPdf);
router.get('/:id/file', c.getFile);
router.patch('/:id/progress', c.updateProgress);
router.delete('/:id', c.deletePdf);

module.exports = router;
