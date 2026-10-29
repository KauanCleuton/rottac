const prisma = require('../utils/prisma');
const { success, created, notFound, badRequest } = require('../utils/response');
const billing = require('../services/billing');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => { const d = new Date(Date.now() - n * DAY); d.setHours(0, 0, 0, 0); return d; };
const PERIODS = ['FREE', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY', 'LIFETIME'];
const DISCOUNTS = ['PERCENT', 'FIXED'];
const toInt = (v, def = 0) => (v === '' || v === null || v === undefined ? def : parseInt(v, 10));
const toDate = (v) => (v ? new Date(v) : null);
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Série diária (últimos N dias) a partir de linhas { day, total }
function fillDays(rows, days) {
  const map = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.total)]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(daysAgo(days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    return { day: key, total: map.get(key) || 0 };
  });
}

// ─── GET /admin/overview ─────────────────────────────────────────────────────
const overview = async (req, res, next) => {
  try {
    const d7 = daysAgo(7);
    const d30 = daysAgo(30);
    const today = daysAgo(0);
    const [
      users, students, new7, new30, activeSubs, plans, revenueAll, revenue30, pendingOrders,
      answersToday, answers7, answers30, activeStudents7, signups, answersDaily, topStudents, settings,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      prisma.subscription.groupBy({ by: ['planId'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
      prisma.plan.findMany({ select: { id: true, name: true, color: true, isDefault: true } }),
      prisma.order.aggregate({ where: { status: 'PAID' }, _sum: { finalCents: true }, _count: { _all: true } }),
      prisma.order.aggregate({ where: { status: 'PAID', paidAt: { gte: d30 } }, _sum: { finalCents: true }, _count: { _all: true } }),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.questionAttempt.count({ where: { createdAt: { gte: today } } }),
      prisma.questionAttempt.count({ where: { createdAt: { gte: d7 } } }),
      prisma.questionAttempt.count({ where: { createdAt: { gte: d30 } } }),
      prisma.questionAttempt.groupBy({ by: ['userId'], where: { createdAt: { gte: d7 } } }).then((r) => r.length),
      prisma.$queryRaw`SELECT DATE(createdAt) AS day, COUNT(*) AS total FROM users WHERE createdAt >= ${d30} GROUP BY day`,
      prisma.$queryRaw`SELECT DATE(createdAt) AS day, COUNT(*) AS total FROM question_attempts WHERE createdAt >= ${d30} GROUP BY day`,
      prisma.$queryRaw`
        SELECT u.id, u.name, u.email, COUNT(qa.id) AS total, SUM(qa.isCorrect) AS correct
        FROM question_attempts qa JOIN users u ON u.id = qa.userId
        WHERE qa.createdAt >= ${d30}
        GROUP BY u.id, u.name, u.email ORDER BY total DESC LIMIT 8`,
      billing.getSettings(),
    ]);
    const openReports = await prisma.questionReport.count({ where: { status: { in: ['ABERTO', 'EM_ANALISE'] } } });

    const subsByPlan = Object.fromEntries(activeSubs.map((s) => [s.planId, s._count._all]));
    const paidUsers = activeSubs.reduce((s, x) => s + x._count._all, 0);
    return success(res, {
      users, students, new7, new30, activeStudents7, pendingOrders,
      revenue: { allCents: revenueAll._sum.finalCents || 0, allOrders: revenueAll._count._all, last30Cents: revenue30._sum.finalCents || 0, last30Orders: revenue30._count._all },
      answers: { today: answersToday, last7: answers7, last30: answers30 },
      plans: plans.map((p) => ({
        ...p,
        // Quem não tem assinatura ativa está no plano padrão (gratuito)
        users: (subsByPlan[p.id] || 0) + (p.isDefault ? Math.max(0, users - paidUsers) : 0),
      })),
      signupsDaily: fillDays(signups, 30),
      answersDaily: fillDays(answersDaily, 30),
      topStudents: topStudents.map((t) => ({ id: t.id, name: t.name, email: t.email, total: Number(t.total), accuracy: Number(t.total) ? Math.round((Number(t.correct) / Number(t.total)) * 100) : 0 })),
      freeAccessForAll: Boolean(settings.freeAccessForAll),
      openReports,
    });
  } catch (err) { next(err); }
};

// ─── Planos ──────────────────────────────────────────────────────────────────
const listPlans = async (req, res, next) => {
  try {
    const rows = await prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } } },
    });
    return success(res, {
      plans: rows.map(({ _count, ...p }) => ({ ...p, features: billing.sanitizeFeatures(p.features), activeSubscribers: _count.subscriptions })),
      features: billing.FEATURES,
    });
  } catch (err) { next(err); }
};

function planData(body, partial) {
  const data = {};
  if (body.name !== undefined || !partial) {
    data.name = String(body.name || '').trim().slice(0, 80);
    if (!data.name) return { error: 'Dê um nome ao plano' };
  }
  if (body.slug !== undefined || !partial) data.slug = slugify(body.slug || body.name || '').slice(0, 60);
  for (const k of ['tagline', 'description']) if (body[k] !== undefined) data[k] = body[k] ? String(body[k]).slice(0, k === 'tagline' ? 120 : 2000) : null;
  if (body.priceCents !== undefined) {
    data.priceCents = toInt(body.priceCents);
    if (!Number.isFinite(data.priceCents) || data.priceCents < 0) return { error: 'Preço inválido' };
  }
  if (body.billingPeriod !== undefined) {
    if (!PERIODS.includes(body.billingPeriod)) return { error: 'Período de cobrança inválido' };
    data.billingPeriod = body.billingPeriod;
  }
  if (body.features !== undefined || !partial) data.features = billing.sanitizeFeatures(body.features);
  if (/^#[0-9a-fA-F]{6}$/.test(body.color || '')) data.color = body.color;
  for (const k of ['highlight', 'isActive', 'isDefault']) if (body[k] !== undefined) data[k] = Boolean(body[k]);
  if (body.sortOrder !== undefined) data.sortOrder = toInt(body.sortOrder);
  return { data };
}

const createPlan = async (req, res, next) => {
  try {
    const { data, error } = planData(req.body, false);
    if (error) return badRequest(res, error);
    if (data.isDefault) await prisma.plan.updateMany({ data: { isDefault: false } });
    const plan = await prisma.plan.create({ data });
    return created(res, plan, 'Plano criado');
  } catch (err) {
    if (err.code === 'P2002') return badRequest(res, 'Já existe um plano com esse identificador (slug)');
    next(err);
  }
};

const updatePlan = async (req, res, next) => {
  try {
    const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
    if (!plan) return notFound(res, 'Plano não encontrado');
    const { data, error } = planData(req.body, true);
    if (error) return badRequest(res, error);
    if (data.isDefault) await prisma.plan.updateMany({ where: { id: { not: plan.id } }, data: { isDefault: false } });
    const updated = await prisma.plan.update({ where: { id: plan.id }, data });
    return success(res, updated, 'Plano atualizado');
  } catch (err) {
    if (err.code === 'P2002') return badRequest(res, 'Já existe um plano com esse identificador (slug)');
    next(err);
  }
};

// Plano com histórico de vendas/assinaturas não é apagado: só desativado
const deletePlan = async (req, res, next) => {
  try {
    const plan = await prisma.plan.findUnique({ where: { id: req.params.id }, include: { _count: { select: { subscriptions: true, orders: true } } } });
    if (!plan) return notFound(res, 'Plano não encontrado');
    if (plan.isDefault) return badRequest(res, 'Defina outro plano como padrão antes de remover este');
    if (plan._count.subscriptions || plan._count.orders) {
      await prisma.plan.update({ where: { id: plan.id }, data: { isActive: false } });
      return success(res, null, 'O plano tem histórico de vendas, então foi desativado (não aparece mais para compra)');
    }
    await prisma.plan.delete({ where: { id: plan.id } });
    return success(res, null, 'Plano removido');
  } catch (err) { next(err); }
};

// ─── Configurações ───────────────────────────────────────────────────────────
const getSettings = async (req, res, next) => {
  try { return success(res, await billing.getSettings()); } catch (err) { next(err); }
};

const updateSettings = async (req, res, next) => {
  try {
    const allowed = { freeAccessForAll: 'boolean', freeAccessMessage: 'string' };
    for (const [key, type] of Object.entries(allowed)) {
      if (req.body[key] === undefined) continue;
      const value = type === 'boolean' ? Boolean(req.body[key]) : String(req.body[key]).slice(0, 300);
      await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    billing.invalidateSettings();
    return success(res, await billing.getSettings(), 'Configurações salvas');
  } catch (err) { next(err); }
};

// ─── Cupons ──────────────────────────────────────────────────────────────────
function couponData(body, partial) {
  const data = {};
  if (body.code !== undefined || !partial) {
    data.code = String(body.code || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);
    if (!/^[A-Z0-9_-]{3,40}$/.test(data.code)) return { error: 'Código inválido: use de 3 a 40 letras, números, - ou _' };
  }
  if (body.discountType !== undefined || !partial) {
    if (!DISCOUNTS.includes(body.discountType)) return { error: 'Tipo de desconto inválido' };
    data.discountType = body.discountType;
  }
  if (body.value !== undefined || !partial) {
    data.value = toInt(body.value);
    const type = data.discountType || body.discountType;
    if (!(data.value > 0) || (type === 'PERCENT' && data.value > 100)) return { error: 'Valor do desconto inválido' };
  }
  if (body.description !== undefined) data.description = body.description ? String(body.description).slice(0, 191) : null;
  if (body.maxUses !== undefined) data.maxUses = body.maxUses === '' || body.maxUses === null ? null : Math.max(1, toInt(body.maxUses));
  if (body.perUserLimit !== undefined) data.perUserLimit = Math.max(1, toInt(body.perUserLimit, 1));
  if (body.planIds !== undefined) data.planIds = Array.isArray(body.planIds) && body.planIds.length ? body.planIds.map(String) : null;
  if (body.validFrom !== undefined) data.validFrom = toDate(body.validFrom);
  if (body.validUntil !== undefined) data.validUntil = toDate(body.validUntil);
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  return { data };
}

const listCoupons = async (req, res, next) => {
  try {
    const rows = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { orders: { where: { status: 'PAID' } } } } } });
    return success(res, rows.map(({ _count, ...c }) => ({ ...c, paidOrders: _count.orders })));
  } catch (err) { next(err); }
};
const createCoupon = async (req, res, next) => {
  try {
    const { data, error } = couponData(req.body, false);
    if (error) return badRequest(res, error);
    return created(res, await prisma.coupon.create({ data }), 'Cupom criado');
  } catch (err) {
    if (err.code === 'P2002') return badRequest(res, 'Já existe um cupom com esse código');
    next(err);
  }
};
const updateCoupon = async (req, res, next) => {
  try {
    const c = await prisma.coupon.findUnique({ where: { id: req.params.id } });
    if (!c) return notFound(res, 'Cupom não encontrado');
    const { data, error } = couponData({ discountType: c.discountType, ...req.body }, true);
    if (error) return badRequest(res, error);
    return success(res, await prisma.coupon.update({ where: { id: c.id }, data }), 'Cupom atualizado');
  } catch (err) {
    if (err.code === 'P2002') return badRequest(res, 'Já existe um cupom com esse código');
    next(err);
  }
};
const deleteCoupon = async (req, res, next) => {
  try {
    const c = await prisma.coupon.findUnique({ where: { id: req.params.id } });
    if (!c) return notFound(res, 'Cupom não encontrado');
    if (c.usedCount > 0) {
      await prisma.coupon.update({ where: { id: c.id }, data: { isActive: false } });
      return success(res, null, 'O cupom já foi usado, então foi desativado');
    }
    await prisma.coupon.delete({ where: { id: c.id } });
    return success(res, null, 'Cupom removido');
  } catch (err) { next(err); }
};

// ─── Promoções ───────────────────────────────────────────────────────────────
function promoData(body, partial) {
  const data = {};
  if (body.name !== undefined || !partial) {
    data.name = String(body.name || '').trim().slice(0, 120);
    if (!data.name) return { error: 'Dê um nome à promoção' };
  }
  if (body.discountType !== undefined || !partial) {
    if (!DISCOUNTS.includes(body.discountType)) return { error: 'Tipo de desconto inválido' };
    data.discountType = body.discountType;
  }
  if (body.value !== undefined || !partial) {
    data.value = toInt(body.value);
    const type = data.discountType || body.discountType;
    if (!(data.value > 0) || (type === 'PERCENT' && data.value > 100)) return { error: 'Valor do desconto inválido' };
  }
  for (const k of ['description', 'badge']) if (body[k] !== undefined) data[k] = body[k] ? String(body[k]).slice(0, 191) : null;
  if (body.planId !== undefined) data.planId = body.planId || null;
  if (body.startsAt !== undefined) data.startsAt = toDate(body.startsAt) || new Date();
  if (body.endsAt !== undefined) data.endsAt = toDate(body.endsAt);
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  return { data };
}
const listPromotions = async (req, res, next) => {
  try {
    return success(res, await prisma.promotion.findMany({ orderBy: { createdAt: 'desc' }, include: { plan: { select: { name: true } } } }));
  } catch (err) { next(err); }
};
const createPromotion = async (req, res, next) => {
  try {
    const { data, error } = promoData(req.body, false);
    if (error) return badRequest(res, error);
    return created(res, await prisma.promotion.create({ data }), 'Promoção criada');
  } catch (err) { next(err); }
};
const updatePromotion = async (req, res, next) => {
  try {
    const p = await prisma.promotion.findUnique({ where: { id: req.params.id } });
    if (!p) return notFound(res, 'Promoção não encontrada');
    const { data, error } = promoData({ discountType: p.discountType, ...req.body }, true);
    if (error) return badRequest(res, error);
    return success(res, await prisma.promotion.update({ where: { id: p.id }, data }), 'Promoção atualizada');
  } catch (err) { next(err); }
};
const deletePromotion = async (req, res, next) => {
  try {
    const p = await prisma.promotion.findUnique({ where: { id: req.params.id } });
    if (!p) return notFound(res, 'Promoção não encontrada');
    await prisma.promotion.delete({ where: { id: p.id } });
    return success(res, null, 'Promoção removida');
  } catch (err) { next(err); }
};

// ─── Vendas e assinaturas ────────────────────────────────────────────────────
const listOrders = async (req, res, next) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = 30;
    const where = {};
    if (['PENDING', 'PAID', 'CANCELED', 'REFUNDED'].includes(req.query.status)) where.status = req.query.status;
    if (req.query.planId) where.planId = String(req.query.planId);
    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { user: { select: { id: true, name: true, email: true } }, plan: { select: { name: true, color: true } }, coupon: { select: { code: true } } },
      }),
      prisma.order.count({ where }),
    ]);
    return success(res, { orders: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) { next(err); }
};

const markOrderPaid = async (req, res, next) => {
  try {
    const order = await billing.markOrderPaid(req.params.id, { method: 'MANUAL' });
    return success(res, order, 'Pagamento confirmado e plano ativado');
  } catch (err) {
    if (err.statusCode === 404) return notFound(res, err.message);
    next(err);
  }
};

const cancelOrder = async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return notFound(res, 'Pedido não encontrado');
    const status = order.status === 'PAID' ? 'REFUNDED' : 'CANCELED';
    await prisma.order.update({ where: { id: order.id }, data: { status } });
    if (order.status === 'PAID') {
      await prisma.subscription.updateMany({ where: { orderId: order.id, status: 'ACTIVE' }, data: { status: 'CANCELED', canceledAt: new Date() } });
    }
    return success(res, null, status === 'REFUNDED' ? 'Pedido estornado e assinatura cancelada' : 'Pedido cancelado');
  } catch (err) { next(err); }
};

const listSubscriptions = async (req, res, next) => {
  try {
    const where = {};
    if (['ACTIVE', 'CANCELED', 'EXPIRED'].includes(req.query.status)) where.status = req.query.status;
    if (req.query.planId) where.planId = String(req.query.planId);
    const rows = await prisma.subscription.findMany({
      where, orderBy: { startedAt: 'desc' }, take: 200,
      include: { user: { select: { id: true, name: true, email: true } }, plan: { select: { name: true, color: true } } },
    });
    return success(res, rows);
  } catch (err) { next(err); }
};

// ─── Alunos ──────────────────────────────────────────────────────────────────
const listUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = 25;
    const where = {};
    if (req.query.search) {
      const s = String(req.query.search).slice(0, 100);
      where.OR = [{ name: { contains: s } }, { email: { contains: s } }];
    }
    if (['STUDENT', 'TEACHER', 'ADMIN'].includes(req.query.role)) where.role = req.query.role;
    if (req.query.planId) {
      const plan = await prisma.plan.findUnique({ where: { id: String(req.query.planId) } });
      where.subscriptions = plan?.isDefault
        ? { none: { status: 'ACTIVE', planId: { not: plan.id } } }
        : { some: { status: 'ACTIVE', planId: String(req.query.planId) } };
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        select: {
          id: true, name: true, email: true, role: true, isActive: true, createdAt: true, examName: true,
          subscriptions: { where: { status: 'ACTIVE' }, include: { plan: { select: { id: true, name: true, color: true } } }, take: 1 },
          _count: { select: { questionNotebooks: true, flashcards: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const ids = users.map((u) => u.id);
    const d7 = daysAgo(7);
    const [totals, last7, lastActivity, defaultPlan] = await Promise.all([
      ids.length ? prisma.questionAttempt.groupBy({ by: ['userId', 'isCorrect'], where: { userId: { in: ids } }, _count: { _all: true } }) : [],
      ids.length ? prisma.questionAttempt.groupBy({ by: ['userId'], where: { userId: { in: ids }, createdAt: { gte: d7 } }, _count: { _all: true } }) : [],
      ids.length ? prisma.questionAttempt.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { createdAt: true } }) : [],
      prisma.plan.findFirst({ where: { isDefault: true }, select: { id: true, name: true, color: true } }),
    ]);

    return success(res, {
      total, page, pages: Math.max(1, Math.ceil(total / limit)),
      users: users.map(({ subscriptions, _count, ...u }) => {
        const right = totals.find((t) => t.userId === u.id && t.isCorrect)?._count._all || 0;
        const wrong = totals.find((t) => t.userId === u.id && !t.isCorrect)?._count._all || 0;
        return {
          ...u,
          plan: subscriptions[0]?.plan || defaultPlan,
          subscriptionExpiresAt: subscriptions[0]?.expiresAt || null,
          questions: right + wrong,
          accuracy: right + wrong ? Math.round((right / (right + wrong)) * 100) : null,
          questionsLast7: last7.find((t) => t.userId === u.id)?._count._all || 0,
          lastActivity: lastActivity.find((t) => t.userId === u.id)?._max.createdAt || null,
          notebooks: _count.questionNotebooks,
          flashcards: _count.flashcards,
        };
      }),
    });
  } catch (err) { next(err); }
};

const getUser = async (req, res, next) => {
  try {
    const id = req.params.id;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true, isActive: true, createdAt: true, avatar: true,
        examName: true, examDate: true, targetRole: true, experienceLevel: true, dailyStudyHours: true,
        gamification: { select: { xp: true, level: true, streak: true, bestStreak: true, totalHours: true, lastStudyAt: true } },
        _count: { select: { questionNotebooks: true, flashcards: true, errorNotebook: true, focusSessions: true, essays: true } },
      },
    });
    if (!user) return notFound(res, 'Usuário não encontrado');

    const d30 = daysAgo(30);
    const [subscriptions, orders, attempts, byDiscipline, daily, reviews, ent] = await Promise.all([
      prisma.subscription.findMany({ where: { userId: id }, orderBy: { startedAt: 'desc' }, include: { plan: { select: { name: true, color: true } } } }),
      prisma.order.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, include: { plan: { select: { name: true } }, coupon: { select: { code: true } } } }),
      prisma.questionAttempt.groupBy({ by: ['isCorrect'], where: { userId: id }, _count: { _all: true }, _avg: { timeSpent: true } }),
      prisma.$queryRaw`
        SELECT COALESCE(q.discipline, 'Sem disciplina') AS name, COUNT(*) AS total, SUM(qa.isCorrect) AS correct
        FROM question_attempts qa JOIN questions q ON q.id = qa.questionId
        WHERE qa.userId = ${id} GROUP BY name ORDER BY total DESC LIMIT 12`,
      prisma.$queryRaw`SELECT DATE(createdAt) AS day, COUNT(*) AS total FROM question_attempts WHERE userId = ${id} AND createdAt >= ${d30} GROUP BY day`,
      prisma.questionReview.groupBy({ by: ['mastered'], where: { userId: id }, _count: { _all: true } }),
      billing.getEntitlements(id, user.role),
    ]);
    const right = attempts.find((a) => a.isCorrect)?._count._all || 0;
    const wrong = attempts.find((a) => !a.isCorrect)?._count._all || 0;
    const avgTimes = attempts.map((a) => a._avg.timeSpent).filter(Boolean);

    return success(res, {
      user,
      plan: ent.plan,
      subscriptions,
      orders,
      stats: {
        questions: right + wrong,
        correct: right,
        wrong,
        accuracy: right + wrong ? Math.round((right / (right + wrong)) * 100) : null,
        avgTime: avgTimes.length ? Math.round(avgTimes.reduce((s, t) => s + t, 0) / avgTimes.length) : null,
        inReview: reviews.find((r) => !r.mastered)?._count._all || 0,
        mastered: reviews.find((r) => r.mastered)?._count._all || 0,
        byDiscipline: byDiscipline.map((d) => ({ name: d.name, total: Number(d.total), accuracy: Number(d.total) ? Math.round((Number(d.correct) / Number(d.total)) * 100) : 0 })),
        daily: fillDays(daily, 30),
      },
    });
  } catch (err) { next(err); }
};

const updateUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return notFound(res, 'Usuário não encontrado');
    const data = {};
    if (['STUDENT', 'TEACHER', 'ADMIN'].includes(req.body.role)) {
      if (user.id === req.user.id && req.body.role !== 'ADMIN') return badRequest(res, 'Você não pode remover seu próprio acesso de admin');
      data.role = req.body.role;
    }
    if (req.body.isActive !== undefined) {
      if (user.id === req.user.id && !req.body.isActive) return badRequest(res, 'Você não pode desativar sua própria conta');
      data.isActive = Boolean(req.body.isActive);
    }
    const updated = await prisma.user.update({ where: { id: user.id }, data, select: { id: true, role: true, isActive: true } });
    return success(res, updated, 'Usuário atualizado');
  } catch (err) { next(err); }
};

// Concede um plano manualmente (cortesia, parceria, pagamento fora do sistema)
const grantPlan = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) return notFound(res, 'Usuário não encontrado');
    const plan = await prisma.plan.findUnique({ where: { id: String(req.body.planId || '') } });
    if (!plan) return notFound(res, 'Plano não encontrado');
    const days = req.body.days === '' || req.body.days === null || req.body.days === undefined ? undefined : Math.max(1, toInt(req.body.days));
    const sub = await billing.activatePlan({ userId: user.id, plan, source: 'ADMIN', days });
    return created(res, sub, `Plano ${plan.name} concedido`);
  } catch (err) { next(err); }
};

const revokePlan = async (req, res, next) => {
  try {
    const { count } = await prisma.subscription.updateMany({
      where: { userId: req.params.id, status: 'ACTIVE' }, data: { status: 'CANCELED', canceledAt: new Date() },
    });
    return success(res, null, count ? 'Assinatura cancelada: o aluno voltou ao plano gratuito' : 'O aluno não tinha assinatura ativa');
  } catch (err) { next(err); }
};

// ─── Reportes de questões ────────────────────────────────────────────────────
const REPORT_STATUS = ['ABERTO', 'EM_ANALISE', 'RESOLVIDO', 'REJEITADO'];
const REPORT_LABEL = {
  ERRO_GABARITO: 'erro no gabarito', ERRO_ENUNCIADO: 'erro no enunciado', DESATUALIZADA: 'questão desatualizada',
  PEDIDO_ANULACAO: 'pedido de anulação', CLASSIFICACAO_ERRADA: 'classificação errada', OUTRO: 'reporte',
};

const listReports = async (req, res, next) => {
  try {
    const where = {};
    if (REPORT_STATUS.includes(req.query.status)) where.status = req.query.status;
    else if (req.query.status === 'pendentes') where.status = { in: ['ABERTO', 'EM_ANALISE'] };
    const [rows, counts] = await Promise.all([
      prisma.questionReport.findMany({
        where, orderBy: { createdAt: 'desc' }, take: 200,
        include: {
          user: { select: { id: true, name: true, email: true } },
          question: { select: { id: true, statement: true, discipline: true, topic: true, banca: true, year: true, answer: true, type: true, isAnnulled: true, isOutdated: true } },
        },
      }),
      prisma.questionReport.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return success(res, { reports: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) });
  } catch (err) { next(err); }
};

// Atualiza status/resposta; opcionalmente marca a questão como anulada/desatualizada; avisa o aluno
const updateReport = async (req, res, next) => {
  try {
    const r = await prisma.questionReport.findUnique({ where: { id: req.params.id } });
    if (!r) return notFound(res, 'Reporte não encontrado');
    const data = {};
    if (req.body.status !== undefined) {
      if (!REPORT_STATUS.includes(req.body.status)) return badRequest(res, 'Status inválido');
      data.status = req.body.status;
      data.resolvedAt = ['RESOLVIDO', 'REJEITADO'].includes(req.body.status) ? new Date() : null;
    }
    if (req.body.adminReply !== undefined) data.adminReply = req.body.adminReply ? String(req.body.adminReply).slice(0, 5000) : null;
    const updated = await prisma.questionReport.update({ where: { id: r.id }, data });

    const qPatch = {};
    if (req.body.markAnnulled) qPatch.isAnnulled = true;
    if (req.body.markOutdated) qPatch.isOutdated = true;
    if (Object.keys(qPatch).length) await prisma.question.update({ where: { id: r.questionId }, data: qPatch });

    if (data.status && ['RESOLVIDO', 'REJEITADO'].includes(data.status)) {
      await prisma.notification.create({
        data: {
          userId: r.userId,
          type: 'SISTEMA',
          title: data.status === 'RESOLVIDO' ? 'Seu reporte foi atendido' : 'Seu reporte foi analisado',
          body: (data.adminReply || updated.adminReply)
            ? `Resposta da equipe sobre o seu ${REPORT_LABEL[r.type]}: ${(data.adminReply || updated.adminReply).slice(0, 300)}`
            : `Seu ${REPORT_LABEL[r.type]} foi ${data.status === 'RESOLVIDO' ? 'atendido' : 'analisado e não procede'}. Obrigado por ajudar!`,
          data: { questionId: r.questionId, reportId: r.id },
        },
      });
    }
    return success(res, updated, 'Reporte atualizado');
  } catch (err) { next(err); }
};

module.exports = {
  overview, listReports, updateReport,
  listPlans, createPlan, updatePlan, deletePlan,
  getSettings, updateSettings,
  listCoupons, createCoupon, updateCoupon, deleteCoupon,
  listPromotions, createPromotion, updatePromotion, deletePromotion,
  listOrders, markOrderPaid, cancelOrder, listSubscriptions,
  listUsers, getUser, updateUser, grantPlan, revokePlan,
};
