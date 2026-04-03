const router = require('express').Router();
const c = require('../controllers/mission.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/', c.getAll);
router.post('/generate', c.generate);
router.post('/:id/accept', c.accept);
router.post('/:id/complete', c.complete);

module.exports = router;
