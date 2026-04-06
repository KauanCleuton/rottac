const router = require('express').Router();
const c = require('../controllers/postSimulado.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.post('/analyze', c.analyzeSimulado);
router.get('/history', c.getHistory);

module.exports = router;
