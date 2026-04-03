const router = require('express').Router();
const c = require('../controllers/question.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/', c.getLogs);
router.get('/stats', c.getStats);
router.post('/', c.createLog);
router.post('/bulk', c.bulkCreate);

module.exports = router;
