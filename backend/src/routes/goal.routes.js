const router = require('express').Router();
const c = require('../controllers/goal.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/', c.getGoals);
router.post('/', c.createGoal);
router.put('/:id', c.updateGoal);
router.delete('/:id', c.deleteGoal);

module.exports = router;
