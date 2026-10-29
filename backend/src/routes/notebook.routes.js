const router = require('express').Router();
const c = require('../controllers/notebook.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const { requireFeature } = require('../middlewares/plan.middleware');

router.use(authenticate);

// Pastas (antes de /:id)
router.get('/folders', c.listFolders);
router.post('/folders', c.createFolder);
router.put('/folders/:id', c.updateFolder);
router.delete('/folders/:id', c.deleteFolder);

// Cadernos
router.get('/', c.list);
router.post('/', c.create);
router.get('/:id', c.getOne);
router.put('/:id', c.update);
router.delete('/:id', c.remove);
router.post('/:id/questions', c.addQuestions);
router.delete('/:id/questions/:questionId', c.removeQuestion);
router.post('/:id/reset', c.reset);

// Diagnóstico e ações sugeridas
router.get('/:id/diagnosis', c.diagnosis);
router.get('/:id/print', requireFeature('printPdf'), c.printData);
router.post('/:id/actions/flashcards', c.actionFlashcards);
router.post('/:id/actions/redo', c.actionRedo);
router.post('/:id/actions/theory', c.actionTheory);

module.exports = router;
