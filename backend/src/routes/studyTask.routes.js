const router = require('express').Router();
const c = require('../controllers/studyTask.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.post('/', c.createTask);
router.put('/:id', c.updateTask);
router.patch('/:id/complete', c.completeTask);
router.patch('/:id/uncomplete', c.uncompleteTask);
router.delete('/:id', c.deleteTask);

module.exports = router;
