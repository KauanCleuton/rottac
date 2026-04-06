const router = require('express').Router();
const c = require('../controllers/edital.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/', c.getAll);
router.post('/upload', c.uploadEdital);
router.get('/:id/status', c.getStatus);
router.post('/:id/confirm', c.confirm);

module.exports = router;
