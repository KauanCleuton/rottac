const router = require('express').Router();
const c = require('../controllers/note.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/', c.getNotes);
router.post('/', c.createNote);
router.put('/:id', c.updateNote);
router.delete('/:id', c.deleteNote);

module.exports = router;
