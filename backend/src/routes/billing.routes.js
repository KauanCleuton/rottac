const router = require('express').Router();
const c = require('../controllers/billing.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// Público: vitrine de planos (página de apresentação)
router.get('/plans', c.plans);

router.use(authenticate);
router.get('/me', c.me);
router.post('/quote', c.quote);
router.post('/checkout', c.checkout);
router.post('/cancel', c.cancel);

module.exports = router;
