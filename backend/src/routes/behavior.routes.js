const router = require('express').Router();
const c = require('../controllers/behavior.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.post('/event', c.trackEvent);
router.get('/events', c.getEvents);
router.post('/energy', c.logEnergy);
router.get('/energy/pattern', c.getEnergyPattern);
router.get('/procrastination', c.getProcrastination);
router.post('/procrastination/detect', c.detectProcrastinationManual);
router.get('/metrics', c.getMetrics);

module.exports = router;
