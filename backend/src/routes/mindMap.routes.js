const router = require('express').Router();
const c = require('../controllers/mindMap.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/', c.getMindMaps);
router.get('/:id', c.getMindMap);
router.post('/', c.createMindMap);
router.put('/:id', c.updateMindMap);
router.delete('/:id', c.deleteMindMap);

module.exports = router;
