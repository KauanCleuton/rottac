const router = require('express').Router();
const c = require('../controllers/admin.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');

router.use(authenticate, requireRole('ADMIN'));

router.get('/overview', c.overview);

router.get('/reports', c.listReports);
router.put('/reports/:id', c.updateReport);

router.get('/plans', c.listPlans);
router.post('/plans', c.createPlan);
router.put('/plans/:id', c.updatePlan);
router.delete('/plans/:id', c.deletePlan);

router.get('/settings', c.getSettings);
router.put('/settings', c.updateSettings);

router.get('/coupons', c.listCoupons);
router.post('/coupons', c.createCoupon);
router.put('/coupons/:id', c.updateCoupon);
router.delete('/coupons/:id', c.deleteCoupon);

router.get('/promotions', c.listPromotions);
router.post('/promotions', c.createPromotion);
router.put('/promotions/:id', c.updatePromotion);
router.delete('/promotions/:id', c.deletePromotion);

router.get('/orders', c.listOrders);
router.post('/orders/:id/mark-paid', c.markOrderPaid);
router.post('/orders/:id/cancel', c.cancelOrder);
router.get('/subscriptions', c.listSubscriptions);

router.get('/users', c.listUsers);
router.get('/users/:id', c.getUser);
router.put('/users/:id', c.updateUser);
router.post('/users/:id/grant', c.grantPlan);
router.post('/users/:id/revoke', c.revokePlan);

module.exports = router;
