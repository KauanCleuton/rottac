const router = require('express').Router();
const c = require('../controllers/exam.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');

router.use(authenticate);

// Admin (antes de /:id)
router.get('/admin/all', requireRole('ADMIN'), c.adminList);
router.post('/', requireRole('ADMIN'), c.create);
router.put('/:id', requireRole('ADMIN'), c.update);
router.delete('/:id', requireRole('ADMIN'), c.remove);

// Aluno
router.get('/', c.list);
router.get('/:id', c.getOne);
router.post('/:id/start', c.start);
router.get('/:id/attempt', c.getAttempt);
router.put('/:id/attempt', c.saveAnswers);
router.post('/:id/finish', c.finish);
router.get('/:id/result', c.result);

module.exports = router;
