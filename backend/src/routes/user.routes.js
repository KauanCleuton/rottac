const router = require('express').Router();
const { getProfile, updateProfile, getRoutines, saveRoutines } = require('../controllers/user.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.get('/routines', getRoutines);
router.post('/routines', saveRoutines);

module.exports = router;
