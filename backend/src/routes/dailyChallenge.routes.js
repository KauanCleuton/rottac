const router = require('express').Router();
const c = require('../controllers/dailyChallenge.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/today', c.getToday);
router.post('/:id/answer', c.answer);
router.get('/history', c.getHistory);

module.exports = router;
