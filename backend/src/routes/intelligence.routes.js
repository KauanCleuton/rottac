const router = require('express').Router();
const c = require('../controllers/intelligence.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/profile', c.getProfile);
router.post('/profile/analyze', c.analyzeProfile);
router.get('/plan/today', c.getTodayPlan);
router.post('/plan/generate', c.generatePlan);
router.post('/plan/replan', c.replan);
router.get('/next-action', c.getNextAction);
router.post('/next-action/:itemId/complete', c.completeAction);
router.get('/insights', c.getInsights);
router.patch('/insights/:id/read', c.markInsightRead);
router.post('/mode', c.setMode);
router.post('/reverse-plan', c.reversePlan);
router.post('/brute-force', c.activateBruteForce);
router.post('/war-mode', c.activateWarMode);

module.exports = router;
