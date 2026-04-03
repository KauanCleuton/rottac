const router = require('express').Router();
const c = require('../controllers/subject.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

// Disciplinas
router.get('/', c.getSubjects);
router.post('/', c.createSubject);
router.put('/:id', c.updateSubject);
router.delete('/:id', c.deleteSubject);

// Módulos
router.post('/:subjectId/modules', c.createModule);
router.put('/modules/:id', c.updateModule);
router.delete('/modules/:id', c.deleteModule);

// Tópicos
router.post('/modules/:moduleId/topics', c.createTopic);
router.put('/topics/:id', c.updateTopic);
router.delete('/topics/:id', c.deleteTopic);

module.exports = router;
