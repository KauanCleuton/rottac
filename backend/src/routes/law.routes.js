const router = require('express').Router();
const c = require('../controllers/law.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { requireFeature } = require('../middlewares/plan.middleware');

router.use(authenticate);

// Admin (antes de /:id)
router.post('/preview', requireRole('ADMIN'), c.preview);
router.post('/', requireRole('ADMIN'), c.create);
router.put('/:id', requireRole('ADMIN'), c.update);
router.delete('/:id', requireRole('ADMIN'), c.remove);
router.post('/:id/autolink', requireRole('ADMIN'), c.autoLink);
router.post('/:id/articles/:articleId/questions', requireRole('ADMIN'), c.linkQuestion);
router.delete('/:id/articles/:articleId/questions/:questionId', requireRole('ADMIN'), c.unlinkQuestion);

// Leitura
router.get('/', c.list);
router.get('/:id', requireFeature('leiSeca'), c.getOne);
router.get('/:id/articles/:articleId/questions', requireFeature('leiSeca'), c.articleQuestions);
router.put('/:id/articles/:articleId/highlight', requireFeature('leiSeca'), c.saveHighlight);

module.exports = router;
