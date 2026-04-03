const router = require('express').Router();
const c = require('../controllers/studyPlan.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/', c.getPlans);
router.get('/active', c.getActivePlan);
router.get('/today', c.getTodayTasks);
router.post('/', c.createPlan);
router.post('/generate', c.generateAutoSchedule);
router.put('/:id', c.updatePlan);

module.exports = router;
