const router = require('express').Router();
const c = require('../controllers/provas.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/', c.search);
router.get('/sugestoes', c.suggestions);

module.exports = router;
