const router = require('express').Router();
const c = require('../controllers/cycle.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/', c.list);
router.post('/', c.create);
router.get('/stats', c.stats);
router.post('/time', c.logTime);
router.delete('/time/:logId', c.removeTime);
router.put('/:id', c.update);
router.delete('/:id', c.remove);
router.post('/:id/restart', c.restart);
router.post('/:id/items/:itemId/skip', c.skipItem);

module.exports = router;
