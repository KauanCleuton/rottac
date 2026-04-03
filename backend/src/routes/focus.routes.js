const router = require('express').Router();
const c = require('../controllers/focus.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.post('/start', c.startSession);
router.patch('/:id', c.updateSession);
router.get('/history', c.getHistory);

module.exports = router;
