// Planos, preços e direitos de acesso (entitlements).
const prisma = require('../utils/prisma');

// ─── Catálogo de recursos ────────────────────────────────────────────────────
// type: 'bool' (liberado ou não) | 'limit' (número; null = ilimitado)
const FEATURES = [
  { key: 'questionsPerDay', type: 'limit', label: 'Questões resolvidas por dia', group: 'Questões' },
  { key: 'notebooksMax', type: 'limit', label: 'Cadernos de questões', group: 'Questões' },
  { key: 'simulado', type: 'bool', label: 'Simulados cronometrados', group: 'Questões' },
  { key: 'revisaoEspacada', type: 'bool', label: 'Revisão espaçada e Caderno de Erros automático', group: 'Questões' },
  { key: 'caneta', type: 'bool', label: 'Caneta e marca-texto nas questões', group: 'Questões' },
  { key: 'printPdf', type: 'bool', label: 'Imprimir cadernos em PDF', group: 'Questões' },
  { key: 'importPdf', type: 'bool', label: 'Importar questões de PDF', group: 'Questões' },
  { key: 'provasAnteriores', type: 'bool', label: 'Catálogo de provas anteriores', group: 'Questões' },
  { key: 'estatisticasAvancadas', type: 'bool', label: 'Diagnóstico e estatísticas avançadas', group: 'Desempenho' },
  { key: 'leiSeca', type: 'bool', label: 'Lei seca com questões por artigo', group: 'Estudo' },
  { key: 'flashcards', type: 'bool', label: 'Flashcards com revisão espaçada', group: 'Estudo' },
  { key: 'planoEstudos', type: 'bool', label: 'Plano de estudos e metas', group: 'Estudo' },
  { key: 'inteligencia', type: 'bool', label: 'Central de IA e edital inteligente', group: 'Estudo' },
  { key: 'redacao', type: 'bool', label: 'Correção de redação com professor', group: 'Extras' },
  { key: 'mentoria', type: 'bool', label: 'Mentoria', group: 'Extras' },
];
const FEATURE_KEYS = new Set(FEATURES.map((f) => f.key));

const ALL_FEATURES = Object.fromEntries(FEATURES.map((f) => [f.key, f.type === 'bool' ? true : null]));

const DEFAULT_PLANS = [
  {
    slug: 'free', name: 'Free', tagline: 'Para começar a estudar', isDefault: true, sortOrder: 0, color: '#9CA3AF',
    billingPeriod: 'FREE', priceCents: 0,
    description: 'Resolva questões todos os dias, monte seus primeiros cadernos e revise com flashcards.',
    features: {
      questionsPerDay: 30, notebooksMax: 3, simulado: false, revisaoEspacada: true, caneta: true, printPdf: false,
      importPdf: false, provasAnteriores: true, estatisticasAvancadas: false, leiSeca: false, flashcards: true, planoEstudos: true,
      inteligencia: false, redacao: false, mentoria: false,
    },
  },
  {
    slug: 'premium', name: 'Premium', tagline: 'Para quem estuda sério', highlight: true, sortOrder: 1, color: '#F2B705',
    billingPeriod: 'MONTHLY', priceCents: 0,
    description: 'Questões ilimitadas, simulados, diagnóstico completo, impressão e importação de provas.',
    features: {
      questionsPerDay: null, notebooksMax: 50, simulado: true, revisaoEspacada: true, caneta: true, printPdf: true,
      importPdf: true, provasAnteriores: true, estatisticasAvancadas: true, leiSeca: true, flashcards: true, planoEstudos: true,
      inteligencia: false, redacao: false, mentoria: false,
    },
  },
  {
    slug: 'rottapapiro', name: 'RottaPapiro', tagline: 'Tudo liberado, sem limites', sortOrder: 2, color: '#0A0A0B',
    billingPeriod: 'MONTHLY', priceCents: 0,
    description: 'Acesso completo: Central de IA, redação com professor, mentoria e tudo do Premium.',
    features: { ...ALL_FEATURES },
  },
];

const SETTINGS_DEFAULTS = {
  freeAccessForAll: true, // "tudo liberado" enquanto não houver cobrança
  freeAccessMessage: 'Período de lançamento: todos os recursos estão liberados gratuitamente.',
};

// ─── Inicialização (idempotente) ─────────────────────────────────────────────
async function ensureDefaults() {
  const count = await prisma.plan.count();
  if (count === 0) {
    for (const p of DEFAULT_PLANS) await prisma.plan.create({ data: p });
    console.log('[billing] planos padrão criados (Free, Premium, RottaPapiro)');
  }
  // Recursos novos entram nos planos padrão já existentes com o valor de fábrica (sem mexer no que o admin mudou)
  for (const def of DEFAULT_PLANS) {
    const plan = await prisma.plan.findUnique({ where: { slug: def.slug } });
    if (!plan) continue;
    const missing = Object.keys(def.features).filter((k) => !(k in (plan.features || {})));
    if (missing.length) {
      await prisma.plan.update({
        where: { id: plan.id },
        data: { features: { ...plan.features, ...Object.fromEntries(missing.map((k) => [k, def.features[k]])) } },
      });
    }
  }
  for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
}

// ─── Configurações (cache curto: são lidas em toda resposta de questão) ─────
let settingsCache = null;
let settingsAt = 0;
async function getSettings() {
  if (settingsCache && Date.now() - settingsAt < 30_000) return settingsCache;
  const rows = await prisma.systemSetting.findMany();
  settingsCache = { ...SETTINGS_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  settingsAt = Date.now();
  return settingsCache;
}
function invalidateSettings() { settingsCache = null; }

// Normaliza o objeto de recursos vindo do admin (só chaves conhecidas, tipos corretos)
function sanitizeFeatures(input = {}) {
  const out = {};
  for (const f of FEATURES) {
    const v = input[f.key];
    if (f.type === 'bool') out[f.key] = Boolean(v);
    else out[f.key] = v === null || v === '' || v === undefined ? null : Math.max(0, parseInt(v, 10) || 0);
  }
  return out;
}

// ─── Assinatura e direitos do usuário ────────────────────────────────────────
async function activeSubscription(userId) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { plan: true },
    orderBy: { startedAt: 'desc' },
  });
  if (sub?.expiresAt && sub.expiresAt < new Date()) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'EXPIRED' } });
    return null;
  }
  return sub;
}

async function getEntitlements(userId, role) {
  const [settings, sub] = await Promise.all([getSettings(), activeSubscription(userId)]);
  const plan = sub?.plan || (await prisma.plan.findFirst({ where: { isDefault: true, isActive: true } }));
  const planFeatures = { ...ALL_FEATURES, ...(plan ? sanitizeFeatures(plan.features) : {}) };
  // Admin/professor e o modo "tudo liberado" não têm restrição
  const unrestricted = settings.freeAccessForAll || role === 'ADMIN' || role === 'TEACHER';
  return {
    plan: plan ? { id: plan.id, slug: plan.slug, name: plan.name, color: plan.color } : null,
    subscription: sub ? { id: sub.id, status: sub.status, startedAt: sub.startedAt, expiresAt: sub.expiresAt } : null,
    planFeatures,
    features: unrestricted ? { ...ALL_FEATURES } : planFeatures,
    freeAccessForAll: Boolean(settings.freeAccessForAll),
    freeAccessMessage: settings.freeAccessMessage,
    unrestricted,
  };
}

// ─── Preço: promoção ativa + cupom ───────────────────────────────────────────
const applyDiscount = (cents, type, value) =>
  type === 'PERCENT' ? Math.round((cents * Math.min(100, Math.max(0, value))) / 100) : Math.min(cents, Math.max(0, value));

async function bestPromotion(plan, now = new Date()) {
  if (plan.priceCents <= 0) return null;
  const promos = await prisma.promotion.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      AND: [{ OR: [{ planId: null }, { planId: plan.id }] }],
    },
  });
  let best = null;
  for (const p of promos) {
    const d = applyDiscount(plan.priceCents, p.discountType, p.value);
    if (!best || d > best.discountCents) best = { promotion: p, discountCents: d };
  }
  return best;
}

async function validateCoupon(code, plan, userId) {
  if (!code) return { coupon: null };
  const coupon = await prisma.coupon.findUnique({ where: { code: String(code).trim().toUpperCase() } });
  const now = new Date();
  if (!coupon || !coupon.isActive) return { error: 'Cupom inválido' };
  if (coupon.validFrom && coupon.validFrom > now) return { error: 'Este cupom ainda não está valendo' };
  if (coupon.validUntil && coupon.validUntil < now) return { error: 'Este cupom expirou' };
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return { error: 'Este cupom esgotou' };
  if (Array.isArray(coupon.planIds) && coupon.planIds.length && !coupon.planIds.includes(plan.id)) {
    return { error: `Este cupom não vale para o plano ${plan.name}` };
  }
  if (userId && coupon.perUserLimit) {
    const used = await prisma.order.count({ where: { userId, couponId: coupon.id, status: 'PAID' } });
    if (used >= coupon.perUserLimit) return { error: 'Você já usou este cupom' };
  }
  return { coupon };
}

async function quote(plan, { couponCode, userId } = {}) {
  const promo = await bestPromotion(plan);
  let price = plan.priceCents - (promo?.discountCents || 0);
  const { coupon, error } = await validateCoupon(couponCode, plan, userId);
  if (error) return { error };
  const couponDiscount = coupon ? applyDiscount(price, coupon.discountType, coupon.value) : 0;
  price -= couponDiscount;
  return {
    originalCents: plan.priceCents,
    promotion: promo ? { id: promo.promotion.id, name: promo.promotion.name, badge: promo.promotion.badge, discountCents: promo.discountCents } : null,
    coupon: coupon ? { id: coupon.id, code: coupon.code, discountCents: couponDiscount } : null,
    discountCents: plan.priceCents - Math.max(0, price),
    finalCents: Math.max(0, price),
  };
}

const PERIOD_DAYS = { FREE: null, MONTHLY: 30, QUARTERLY: 90, SEMIANNUAL: 180, YEARLY: 365, LIFETIME: null };

// Ativa o plano: encerra a assinatura anterior e cria a nova
async function activatePlan({ userId, plan, orderId = null, source = 'CHECKOUT', days }) {
  const now = new Date();
  const span = days ?? PERIOD_DAYS[plan.billingPeriod];
  await prisma.subscription.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'CANCELED', canceledAt: now } });
  return prisma.subscription.create({
    data: {
      userId, planId: plan.id, orderId, source, startedAt: now,
      expiresAt: span ? new Date(now.getTime() + span * 24 * 60 * 60 * 1000) : null,
    },
  });
}

// Confirma pagamento de um pedido (checkout gratuito ou admin marcando como pago)
async function markOrderPaid(orderId, { method } = {}) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { plan: true } });
  if (!order) throw Object.assign(new Error('Pedido não encontrado'), { statusCode: 404 });
  if (order.status === 'PAID') return order;
  const paid = await prisma.order.update({
    where: { id: order.id },
    data: { status: 'PAID', paidAt: new Date(), ...(method && { paymentMethod: method }) },
  });
  if (order.couponId) await prisma.coupon.update({ where: { id: order.couponId }, data: { usedCount: { increment: 1 } } });
  await activatePlan({ userId: order.userId, plan: order.plan, orderId: order.id });
  return paid;
}

module.exports = {
  FEATURES, FEATURE_KEYS, ALL_FEATURES,
  ensureDefaults, getSettings, invalidateSettings, sanitizeFeatures,
  getEntitlements, quote, validateCoupon, activatePlan, markOrderPaid, bestPromotion,
};
