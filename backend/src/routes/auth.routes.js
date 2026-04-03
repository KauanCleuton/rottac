const router = require('express').Router();
const { register, login, me, changePassword } = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticate, me);
router.put('/change-password', authenticate, changePassword);

module.exports = router;
