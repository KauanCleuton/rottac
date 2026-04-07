const router = require('express').Router();
const c = require('../controllers/essay.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// Rota pública: info do convite
router.get('/invite/:token', c.getInviteInfo);

router.use(authenticate);

router.post('/', c.submitEssay);
router.get('/', c.listEssays);
router.get('/my-teachers', c.listMyTeachers);
router.get('/evolution', c.getEvolution);
router.get('/:id', c.getEssay);
router.post('/invite', c.generateInvite);
router.post('/accept-invite', c.acceptInvite);

module.exports = router;
