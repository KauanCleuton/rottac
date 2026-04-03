const router = require('express').Router();
const c = require('../controllers/analytics.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/dashboard', c.getDashboard);
router.get('/study-history', c.getStudyHistory);
router.get('/subject-performance', c.getSubjectPerformance);
router.get('/consistency', c.getConsistency);

module.exports = router;
