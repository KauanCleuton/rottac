const router = require('express').Router();
const c = require('../controllers/notification.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/', c.getNotifications);
router.patch('/:id/read', c.markRead);
router.patch('/read-all', c.markAllRead);

module.exports = router;
