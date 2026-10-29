const router = require('express').Router();
const c = require('../controllers/studyEdital.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/', c.list);
router.post('/parse', c.parse);
router.post('/', c.create);
router.get('/:id', c.getOne);
router.put('/:id', c.update);
router.delete('/:id', c.remove);
router.post('/:id/items', c.addItem);
router.patch('/:id/items/:itemId', c.updateItem);
router.delete('/:id/items/:itemId', c.removeItem);

module.exports = router;
