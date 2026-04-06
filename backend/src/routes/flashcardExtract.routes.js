const router = require('express').Router();
const c = require('../controllers/flashcardExtract.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.post('/debug', c.extractDebug);
router.post('/preview', c.extractPreview);
router.post('/confirm', c.extractConfirm);

module.exports = router;
