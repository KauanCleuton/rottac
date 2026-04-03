const router = require('express').Router();
const c = require('../controllers/habit.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/', c.getHabits);
router.post('/', c.createHabit);
router.post('/:id/complete', c.completeHabit);
router.delete('/:id', c.deleteHabit);

module.exports = router;
