const router = require('express').Router();
const c = require('../controllers/gamification.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/profile', c.getProfile);

module.exports = router;
