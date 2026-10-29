const prisma = require('../utils/prisma');
const { success, created, notFound, badRequest } = require('../utils/response');
const billing = require('../services/billing');
const { loadRole } = require('../middlewares/role.middleware');

const publicPlan = async (plan) => {
  const promo = await billing.bestPromotion(plan);
  return {
    id: plan.id, slug: plan.slug, name: plan.name, tagline: plan.tagline, description: plan.description,
    priceCents: plan.priceCents,
    finalCents: plan.priceCents - (promo?.discountCents || 0),
    promotion: promo ? { name: promo.promotion.name, badge: promo.promotion.badge, endsAt: promo.promotion.endsAt } : null,
    billingPeriod: plan.billingPeriod, color: plan.color, highlight: plan.highlight, isDefault: plan.isDefault,
    features: billing.sanitizeFeatures(plan.features),
  };
};

// ─── GET /billing/plans (público) ───────────────────────────────────────────
const plans = async (req, res, next) => {
  try {
    const [rows, settings] = await Promise.all([
      prisma.plan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }] }),
      billing.getSettings(),
    ]);
    return success(res, {
      plans: await Promise.all(rows.map(publicPlan)),
      features: billing.FEATURES,
      freeAccessForAll: Boolean(settings.freeAccessForAll),
      freeAccessMessage: settings.freeAccessMessage,
    });
  } catch (err) { next(err); }
};

// ─── GET /billing/me ─────────────────────────────────────────────────────────
const me = async (req, res, next) => {
  try {
    const role = await loadRole(req);
    const [ent, orders] = await Promise.all([
      billing.getEntitlements(req.user.id, role),
      prisma.order.findMany({
        where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 20,
        include: { plan: { select: { name: true } }, coupon: { select: { code: true } } },
      }),
    ]);
    return success(res, { ...ent, orders });
  } catch (err) { next(err); }
};

const loadPlan = async (planId) => prisma.plan.findFirst({ where: { id: String(planId || ''), isActive: true } });

// ─── POST /billing/quote { planId, couponCode } ─────────────────────────────
const quote = async (req, res, next) => {
  try {
    const plan = await loadPlan(req.body.planId);
    if (!plan) return notFound(res, 'Plano não encontrado');
    const q = await billing.quote(plan, { couponCode: req.body.couponCode, userId: req.user.id });
    if (q.error) return badRequest(res, q.error);
    return success(res, q);
  } catch (err) { next(err); }
};

// ─── POST /billing/checkout { planId, couponCode } ──────────────────────────
// Sem gateway de pagamento ainda: preço zero ativa na hora; preço > 0 gera pedido pendente
// que o admin confirma em "Vendas" (ou um gateway confirmará no futuro).
const checkout = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const plan = await loadPlan(req.body.planId);
    if (!plan) return notFound(res, 'Plano não encontrado');
    const q = await billing.quote(plan, { couponCode: req.body.couponCode, userId });
    if (q.error) return badRequest(res, q.error);

    // Evita pedidos pendentes duplicados para o mesmo plano
    await prisma.order.updateMany({ where: { userId, planId: plan.id, status: 'PENDING' }, data: { status: 'CANCELED' } });

    const order = await prisma.order.create({
      data: {
        userId, planId: plan.id,
        couponId: q.coupon?.id || null,
        promotionId: q.promotion?.id || null,
        originalCents: q.originalCents,
        discountCents: q.discountCents,
        finalCents: q.finalCents,
        paymentMethod: q.finalCents === 0 ? 'FREE' : null,
      },
    });

    if (q.finalCents === 0) {
      await billing.markOrderPaid(order.id, { method: 'FREE' });
      return created(res, { orderId: order.id, status: 'PAID', plan: plan.name }, `Plano ${plan.name} ativado!`);
    }
    return created(res, { orderId: order.id, status: 'PENDING', finalCents: q.finalCents, plan: plan.name },
      'Pedido registrado. Assim que o pagamento for confirmado, seu plano é ativado.');
  } catch (err) { next(err); }
};

// ─── POST /billing/cancel — volta ao plano gratuito ao fim do período ────────
const cancel = async (req, res, next) => {
  try {
    const sub = await prisma.subscription.findFirst({ where: { userId: req.user.id, status: 'ACTIVE' } });
    if (!sub) return badRequest(res, 'Você não tem assinatura ativa');
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELED', canceledAt: new Date() } });
    return success(res, null, 'Assinatura cancelada. Você voltou ao plano gratuito.');
  } catch (err) { next(err); }
};

module.exports = { plans, me, quote, checkout, cancel };
