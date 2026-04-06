const router = require('express').Router();
const c = require('../controllers/flashcardFolder.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/', c.getFolders);
router.post('/', c.createFolder);
router.put('/:id', c.updateFolder);
router.delete('/:id', c.deleteFolder);
router.get('/:id/study', c.getStudyQueue);
router.get('/:id/stats', c.getFolderStatsEndpoint);
router.patch('/cards/:id/move', c.moveCard);

module.exports = router;
