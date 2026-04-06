const router = require('express').Router();
const c = require('../controllers/mentoring.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/mentors', c.getMentors);
router.get('/my', c.getMyMentoring);
router.post('/request', c.requestMentoring);

router.post('/mentor/register', c.registerAsMentor);
router.get('/mentor/dashboard', c.getMentorDashboard);
router.get('/mentor/student/:studentId/insights', c.getStudentInsights);

router.patch('/:id/accept', c.acceptMentoring);
router.get('/:id/messages', c.getMessages);
router.post('/:id/messages', c.sendMessage);
router.get('/:id/sessions', c.getSessions);
router.post('/:id/sessions', c.scheduleSession);
router.post('/:id/plans', c.createWeeklyPlan);

module.exports = router;
