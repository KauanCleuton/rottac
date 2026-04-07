const router = require('express').Router();
const c = require('../controllers/teacher.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

// Dashboard e alunos
router.get('/dashboard', c.getDashboard);
router.get('/students', c.listStudents);
router.get('/students/:studentId/stats', c.getStudentStats);
router.get('/students/:studentId/insights', c.getStudentInsights);

// Redações
router.get('/essays', c.listEssays);

// Correção
router.post('/essays/:id/correct', c.correctEssay);
router.patch('/essays/:id/annotations', c.saveAnnotations);
router.post('/essays/:essayId/comments', c.addComment);
router.post('/essays/:essayId/audio', c.uploadAudio);
router.post('/essays/:essayId/file', c.uploadCorrectedFile);

// Comentários
router.patch('/comments/:id/resolve', c.resolveComment);

// Templates de feedback
router.get('/templates', c.listTemplates);
router.post('/templates', c.createTemplate);
router.patch('/templates/:id/use', c.useTemplate);

module.exports = router;
