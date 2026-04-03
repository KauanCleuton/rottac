const router = require('express').Router();
const c = require('../controllers/flashcard.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/', c.getFlashcards);
router.get('/due', c.getDueFlashcards);
router.post('/', c.createFlashcard);
router.post('/:id/review', c.reviewFlashcard);
router.put('/:id', c.updateFlashcard);
router.delete('/:id', c.deleteFlashcard);

module.exports = router;
