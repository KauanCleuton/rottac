const router = require('express').Router();
const c = require('../controllers/emotion.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.post('/', c.logEmotion);
router.get('/history', c.getHistory);

module.exports = router;
