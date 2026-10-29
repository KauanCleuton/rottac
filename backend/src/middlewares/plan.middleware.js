const prisma = require('../utils/prisma');
const { loadRole } = require('./role.middleware');
const billing = require('../services/billing');

const LABEL = Object.fromEntries(billing.FEATURES.map((f) => [f.key, f.label]));

const planRequired = (res, feature, message) => res.status(402).json({
  success: false,
  code: 'PLAN_REQUIRED',
  feature,
  message: message || `"${LABEL[feature] || feature}" não está incluído no seu plano. Faça upgrade para liberar.`,
});

async function entitlementsFor(req) {
  if (!req.entitlements) {
    const role = await loadRole(req);
    req.entitlements = await billing.getEntitlements(req.user.id, role);
  }
  return req.entitlements;
}

// Bloqueia a rota se o recurso (booleano) não estiver no plano
const requireFeature = (feature) => async (req, res, next) => {
  try {
    const ent = await entitlementsFor(req);
    if (!ent.features[feature]) return planRequired(res, feature);
    next();
  } catch (err) {
    next(err);
  }
};

// Limite diário de questões (null = ilimitado)
async function checkDailyQuestions(req, res) {
  const ent = await entitlementsFor(req);
  const limit = ent.features.questionsPerDay;
  if (limit === null || limit === undefined) return true;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const used = await prisma.questionAttempt.count({ where: { userId: req.user.id, createdAt: { gte: start } } });
  if (used >= limit) {
    planRequired(res, 'questionsPerDay', `Você atingiu o limite de ${limit} questões por dia do seu plano. Volte amanhã ou faça upgrade.`);
    return false;
  }
  return true;
}

async function checkNotebookLimit(req, res) {
  const ent = await entitlementsFor(req);
  const limit = ent.features.notebooksMax;
  if (limit === null || limit === undefined) return true;
  const count = await prisma.questionNotebook.count({ where: { userId: req.user.id } });
  if (count >= limit) {
    planRequired(res, 'notebooksMax', `Seu plano permite até ${limit} cadernos. Exclua um ou faça upgrade.`);
    return false;
  }
  return true;
}

module.exports = { requireFeature, checkDailyQuestions, checkNotebookLimit, entitlementsFor };
