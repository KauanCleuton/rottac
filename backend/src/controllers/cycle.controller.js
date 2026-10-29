// Ciclo de estudos: sequência de matérias com meta de tempo em cada volta.
// Não depende do calendário: se o aluno perde um dia, continua da etapa em que parou.
// O cronômetro registra horas líquidas (StudyTimeLog), que alimentam os gráficos.
const prisma = require('../utils/prisma');
const { success, created, notFound, badRequest } = require('../utils/response');
const taxonomy = require('../services/taxonomy');

const MAX_ITEMS = 60;
const MAX_LOG_MINUTES = 12 * 60;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const DAY = 24 * 60 * 60 * 1000;

const cleanStr = (v, max = 191) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

// Etapa atual = primeira (na ordem) que ainda não bateu a meta nesta volta
function withProgress(cycle) {
  const items = [...cycle.items].sort((a, b) => a.position - b.position);
  const current = items.find((i) => i.doneMinutes < i.minutes) || null;
  const target = items.reduce((s, i) => s + i.minutes, 0);
  const done = items.reduce((s, i) => s + Math.min(i.minutes, i.doneMinutes), 0);
  return {
    ...cycle,
    items,
    currentItemId: current?.id ?? null,
    targetMinutes: target,
    doneMinutes: done,
    progress: target ? Math.round((done / target) * 100) : 0,
  };
}

async function loadCycle(id, userId) {
  return prisma.studyCycle.findFirst({ where: { id, userId }, include: { items: true } });
}

async function parseItems(raw) {
  if (!Array.isArray(raw) || !raw.length) return { error: 'Adicione pelo menos uma matéria ao ciclo' };
  if (raw.length > MAX_ITEMS) return { error: `Máximo de ${MAX_ITEMS} etapas` };
  const tree = await taxonomy.getTree();
  const items = [];
  for (const [position, it] of raw.entries()) {
    const assuntoId = it?.assuntoId ? parseInt(it.assuntoId, 10) : null;
    if (assuntoId && !tree.byId.has(assuntoId)) return { error: 'Matéria inválida' };
    const label = cleanStr(it?.label) || (assuntoId ? tree.byId.get(assuntoId).name : null);
    if (!label) return { error: `Etapa ${position + 1}: escreva o nome da matéria` };
    const minutes = parseInt(it?.minutes, 10);
    if (!(minutes >= 5 && minutes <= 600)) return { error: `"${label}": meta entre 5 e 600 minutos` };
    items.push({
      id: it?.id ? String(it.id) : undefined,
      label, assuntoId, minutes, position,
      color: COLOR.test(it?.color || '') ? it.color : '#F2B705',
    });
  }
  return { items };
}

// GET /cycles
const list = async (req, res, next) => {
  try {
    const cycles = await prisma.studyCycle.findMany({
      where: { userId: req.user.id },
      include: { items: true },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });
    return success(res, cycles.map(withProgress));
  } catch (err) { next(err); }
};

// POST /cycles  { name, items: [{ label, assuntoId?, minutes, color? }] }
const create = async (req, res, next) => {
  try {
    const name = cleanStr(req.body.name) || 'Meu ciclo';
    const { items, error } = await parseItems(req.body.items);
    if (error) return badRequest(res, error);
    // Um ciclo ativo por vez: o novo passa a ser o atual
    await prisma.studyCycle.updateMany({ where: { userId: req.user.id, isActive: true }, data: { isActive: false } });
    const cycle = await prisma.studyCycle.create({
      data: { userId: req.user.id, name, isActive: true, items: { create: items.map(({ id, ...i }) => i) } },
      include: { items: true },
    });
    return created(res, withProgress(cycle), 'Ciclo criado');
  } catch (err) { next(err); }
};

// PUT /cycles/:id  { name?, isActive?, items? } — itens com id são mantidos (com o progresso)
const update = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cycle = await loadCycle(req.params.id, userId);
    if (!cycle) return notFound(res, 'Ciclo não encontrado');
    const data = {};
    if (req.body.name !== undefined) data.name = cleanStr(req.body.name) || cycle.name;
    if (req.body.isActive !== undefined) {
      data.isActive = Boolean(req.body.isActive);
      if (data.isActive) await prisma.studyCycle.updateMany({ where: { userId, isActive: true, id: { not: cycle.id } }, data: { isActive: false } });
    }
    const ops = [];
    if (req.body.items !== undefined) {
      const { items, error } = await parseItems(req.body.items);
      if (error) return badRequest(res, error);
      const existing = new Set(cycle.items.map((i) => i.id));
      const keep = items.filter((i) => i.id && existing.has(i.id));
      const keepIds = new Set(keep.map((i) => i.id));
      ops.push(prisma.studyCycleItem.deleteMany({ where: { cycleId: cycle.id, id: { notIn: [...keepIds] } } }));
      for (const { id, ...i } of items) {
        ops.push(id && keepIds.has(id)
          ? prisma.studyCycleItem.update({ where: { id }, data: i })
          : prisma.studyCycleItem.create({ data: { ...i, cycleId: cycle.id } }));
      }
    }
    ops.push(prisma.studyCycle.update({ where: { id: cycle.id }, data }));
    await prisma.$transaction(ops);
    return success(res, withProgress(await loadCycle(cycle.id, userId)), 'Ciclo atualizado');
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { count } = await prisma.studyCycle.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!count) return notFound(res, 'Ciclo não encontrado');
    return success(res, null, 'Ciclo excluído');
  } catch (err) { next(err); }
};

// Fechou todas as etapas: começa a próxima volta
async function rollRound(cycleId) {
  const items = await prisma.studyCycleItem.findMany({ where: { cycleId } });
  if (items.length && items.every((i) => i.doneMinutes >= i.minutes)) {
    await prisma.$transaction([
      prisma.studyCycleItem.updateMany({ where: { cycleId }, data: { doneMinutes: 0 } }),
      prisma.studyCycle.update({ where: { id: cycleId }, data: { round: { increment: 1 } } }),
    ]);
    return true;
  }
  return false;
}

// POST /cycles/time  { minutes, label?, cycleId?, itemId?, startedAt? } — horas líquidas do cronômetro
const logTime = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const minutes = parseInt(req.body.minutes, 10);
    if (!(minutes >= 1 && minutes <= MAX_LOG_MINUTES)) return badRequest(res, 'Tempo entre 1 minuto e 12 horas');
    let startedAt = req.body.startedAt ? new Date(req.body.startedAt) : new Date(Date.now() - minutes * 60000);
    if (Number.isNaN(startedAt.getTime()) || startedAt.getTime() > Date.now() + 60000) startedAt = new Date(Date.now() - minutes * 60000);

    let item = null;
    let cycle = null;
    if (req.body.itemId) {
      item = await prisma.studyCycleItem.findFirst({ where: { id: String(req.body.itemId), cycle: { userId } }, include: { cycle: true } });
      if (!item) return notFound(res, 'Etapa não encontrada');
      cycle = item.cycle;
    } else if (req.body.cycleId) {
      cycle = await prisma.studyCycle.findFirst({ where: { id: String(req.body.cycleId), userId } });
      if (!cycle) return notFound(res, 'Ciclo não encontrado');
    }
    const label = item?.label || cleanStr(req.body.label);
    if (!label) return badRequest(res, 'Informe o que você estudou');

    const log = await prisma.studyTimeLog.create({
      data: { userId, label, minutes, startedAt, cycleId: cycle?.id ?? null, itemId: item?.id ?? null },
    });
    let newRound = false;
    if (item) {
      await prisma.studyCycleItem.update({ where: { id: item.id }, data: { doneMinutes: { increment: minutes } } });
      newRound = await rollRound(item.cycleId);
    }
    // Também conta nas sessões de estudo e no XP, como o Modo Foco
    await Promise.all([
      prisma.studySession.create({ data: { userId, date: startedAt, totalMinutes: minutes, notes: `Ciclo: ${label}`.slice(0, 191) } }),
      prisma.gamification.updateMany({ where: { userId }, data: { xp: { increment: Math.min(60, Math.floor(minutes / 5)) } } }),
    ]).catch((e) => console.warn('[cycle] registro auxiliar:', e.message));

    const fresh = cycle ? withProgress(await loadCycle(cycle.id, userId)) : null;
    return created(res, { log, cycle: fresh, newRound }, newRound ? 'Volta completa! Começando a próxima.' : 'Tempo registrado');
  } catch (err) { next(err); }
};

// DELETE /cycles/time/:logId — desfaz um registro errado
const removeTime = async (req, res, next) => {
  try {
    const log = await prisma.studyTimeLog.findFirst({ where: { id: req.params.logId, userId: req.user.id } });
    if (!log) return notFound(res, 'Registro não encontrado');
    await prisma.studyTimeLog.delete({ where: { id: log.id } });
    if (log.itemId) {
      const item = await prisma.studyCycleItem.findUnique({ where: { id: log.itemId } });
      if (item) await prisma.studyCycleItem.update({ where: { id: item.id }, data: { doneMinutes: Math.max(0, item.doneMinutes - log.minutes) } });
    }
    return success(res, null, 'Registro removido');
  } catch (err) { next(err); }
};

// POST /cycles/:id/items/:itemId/skip — pula a etapa nesta volta
const skipItem = async (req, res, next) => {
  try {
    const item = await prisma.studyCycleItem.findFirst({ where: { id: req.params.itemId, cycleId: req.params.id, cycle: { userId: req.user.id } } });
    if (!item) return notFound(res, 'Etapa não encontrada');
    await prisma.studyCycleItem.update({ where: { id: item.id }, data: { doneMinutes: Math.max(item.doneMinutes, item.minutes) } });
    const newRound = await rollRound(item.cycleId);
    return success(res, { cycle: withProgress(await loadCycle(item.cycleId, req.user.id)), newRound }, 'Etapa pulada');
  } catch (err) { next(err); }
};

// POST /cycles/:id/restart — zera a volta atual
const restart = async (req, res, next) => {
  try {
    const cycle = await loadCycle(req.params.id, req.user.id);
    if (!cycle) return notFound(res, 'Ciclo não encontrado');
    await prisma.studyCycleItem.updateMany({ where: { cycleId: cycle.id }, data: { doneMinutes: 0 } });
    return success(res, withProgress(await loadCycle(cycle.id, req.user.id)), 'Volta reiniciada');
  } catch (err) { next(err); }
};

// GET /cycles/stats — horas líquidas: últimos 7 dias, últimas 8 semanas, por matéria, registros recentes
const stats = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Semana começa na segunda-feira
    const weekStart = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY);
    const since = new Date(weekStart.getTime() - 7 * 7 * DAY);
    const logs = await prisma.studyTimeLog.findMany({
      where: { userId, startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
      select: { id: true, label: true, minutes: true, startedAt: true, itemId: true, cycleId: true },
    });

    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getTime() - (6 - i) * DAY);
      return { day: ymd(d), minutes: 0, byLabel: {} };
    });
    const dayIdx = new Map(days.map((d, i) => [d.day, i]));
    const weeks = Array.from({ length: 8 }, (_, i) => ({ week: ymd(new Date(since.getTime() + i * 7 * DAY)), minutes: 0, byLabel: {} }));
    const totals = {};
    for (const l of logs) {
      // Conta no dia em que a sessão terminou (estudar das 23h à 0h30 vale para "hoje")
      const end = new Date(new Date(l.startedAt).getTime() + l.minutes * 60000);
      const di = dayIdx.get(ymd(end));
      if (di !== undefined) {
        days[di].minutes += l.minutes;
        days[di].byLabel[l.label] = (days[di].byLabel[l.label] || 0) + l.minutes;
      }
      const wi = Math.floor((end.getTime() - since.getTime()) / (7 * DAY));
      if (wi >= 0 && wi < 8) {
        weeks[wi].minutes += l.minutes;
        weeks[wi].byLabel[l.label] = (weeks[wi].byLabel[l.label] || 0) + l.minutes;
      }
      if (end >= weekStart) totals[l.label] = (totals[l.label] || 0) + l.minutes;
    }
    const all = await prisma.studyTimeLog.groupBy({ by: ['label'], where: { userId }, _sum: { minutes: true }, orderBy: { _sum: { minutes: 'desc' } }, take: 30 });
    return success(res, {
      days,
      weeks,
      thisWeek: Object.entries(totals).map(([label, minutes]) => ({ label, minutes })).sort((a, b) => b.minutes - a.minutes),
      allTime: all.map((r) => ({ label: r.label, minutes: r._sum.minutes || 0 })),
      todayMinutes: days[6].minutes,
      weekMinutes: weeks[7].minutes,
      recent: logs.slice(0, 20),
    });
  } catch (err) { next(err); }
};

module.exports = { list, create, update, remove, logTime, removeTime, skipItem, restart, stats };
