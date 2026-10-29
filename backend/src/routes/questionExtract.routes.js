const router = require('express').Router();
const c = require('../controllers/questionExtract.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const { requireFeature } = require('../middlewares/plan.middleware');

router.use(authenticate);

router.post('/preview', requireFeature('importPdf'), c.extractPreview);
router.post('/confirm', c.extractConfirm);
router.get('/list', c.listQuestions);
router.post('/:id/answer', c.answerQuestion);

module.exports = router;
