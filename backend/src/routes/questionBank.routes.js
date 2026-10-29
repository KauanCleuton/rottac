const router = require('express').Router();
const c = require('../controllers/questionBank.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { requireFeature } = require('../middlewares/plan.middleware');

router.use(authenticate);

// Rotas fixas antes de /:id
router.get('/', c.list);
router.get('/filters', c.filters);
router.get('/facets', c.facets);
router.get('/assuntos', c.listAssuntos);
router.get('/incidence', c.incidence);
router.get('/stats/me', c.myStats);
router.get('/review/due', requireFeature('revisaoEspacada'), c.reviewDue);
router.get('/texts', c.listTexts);
router.post('/texts', c.createText);
router.get('/texts/:textId', c.getText);
router.put('/texts/:textId', c.updateText);
router.get('/reports/mine', c.myReports);
router.get('/admin/overview', requireRole('ADMIN'), c.adminOverview);
router.post('/', c.create);
router.post('/bulk', c.bulkCreate);
router.delete('/comments/:commentId', c.deleteComment);
router.post('/comments/:commentId/like', c.toggleCommentLike);
router.post('/comments/:commentId/pin', requireRole('ADMIN'), c.togglePinComment);

router.get('/:id', c.getOne);
router.put('/:id', c.update);
router.delete('/:id', c.remove);
router.post('/:id/answer', c.answer);
router.post('/:id/favorite', c.toggleFavorite);
router.get('/:id/comments', c.listComments);
router.get('/:id/annotation', c.getAnnotation);
router.put('/:id/annotation', requireFeature('caneta'), c.saveAnnotation);
router.post('/:id/comments', c.addComment);
router.post('/:id/reports', c.createReport);

module.exports = router;
