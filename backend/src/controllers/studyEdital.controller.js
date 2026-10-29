// Edital verticalizado: o aluno cola o conteúdo programático, o sistema separa matérias e tópicos,
// liga cada tópico à árvore de assuntos e acompanha teoria, revisões, questões e acerto.
const prisma = require('../utils/prisma');
const { success, created, notFound, badRequest } = require('../utils/response');
const taxonomy = require('../services/taxonomy');
const { parseEdital } = require('../services/editalParser');

const MAX_TEXT = 200_000;
const MAX_ITEMS = 1500;

const cleanStr = (v, max = 191) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

async function suggest(text) {
  const tree = await taxonomy.getTree();
  const disciplines = parseEdital(text);
  const out = [];
  for (const d of disciplines) {
    const items = [];
    let root = null;
    for (const label of d.items) {
      const m = await taxonomy.matchEditalTopic(d.name, label);
      root = root || m.root;
      const node = m.node || m.root;
      items.push({
        label,
        assuntoId: node?.id ?? null,
        path: node ? taxonomy.pathOf(tree, node.id).map((n) => n.name) : null,
        exact: Boolean(m.node), // false = só a matéria foi reconhecida
      });
    }
    out.push({ name: d.name, assuntoId: root?.id ?? null, items });
  }
  return out;
}

// POST /study-editais/parse  { text } -> prévia para o aluno revisar
const parse = async (req, res, next) => {
  try {
    const text = String(req.body.text || '');
    if (text.trim().length < 10) return badRequest(res, 'Cole o conteúdo programático do edital');
    if (text.length > MAX_TEXT) return badRequest(res, 'Texto muito longo (máx. 200 mil caracteres)');
    const disciplines = await suggest(text);
    if (!disciplines.length) return badRequest(res, 'Não encontrei matérias e tópicos nesse texto');
    const items = disciplines.reduce((s, d) => s + d.items.length, 0);
    const matched = disciplines.reduce((s, d) => s + d.items.filter((i) => i.exact).length, 0);
    return success(res, { disciplines, items, matched });
  } catch (err) { next(err); }
};

async function validAssunto(id) {
  if (id === null || id === undefined || id === '') return null;
  const tree = await taxonomy.getTree();
  const n = parseInt(id, 10);
  return tree.byId.has(n) ? n : undefined;
}

// POST /study-editais  { name, banca?, examDate?, disciplines: [{ name, items: [{ label, assuntoId }] }] } ou { text }
const create = async (req, res, next) => {
  try {
    const name = cleanStr(req.body.name);
    if (!name) return badRequest(res, 'Dê um nome ao edital (ex.: TJ-CE 2026 — Técnico Judiciário)');
    let disciplines = req.body.disciplines;
    if (!Array.isArray(disciplines) && req.body.text) disciplines = await suggest(String(req.body.text).slice(0, MAX_TEXT));
    if (!Array.isArray(disciplines) || !disciplines.length) return badRequest(res, 'Informe as matérias e tópicos');

    const items = [];
    for (const d of disciplines) {
      const discipline = cleanStr(d?.name) || 'Geral';
      for (const it of Array.isArray(d?.items) ? d.items : []) {
        const label = cleanStr(it?.label, 2000);
        if (!label) continue;
        const assuntoId = await validAssunto(it.assuntoId);
        if (assuntoId === undefined) return badRequest(res, `Assunto inválido no tópico "${label.slice(0, 60)}"`);
        items.push({ discipline, label, assuntoId, position: items.length });
        if (items.length > MAX_ITEMS) return badRequest(res, `Máximo de ${MAX_ITEMS} tópicos por edital`);
      }
    }
    if (!items.length) return badRequest(res, 'Nenhum tópico informado');

    const examDate = req.body.examDate ? new Date(req.body.examDate) : null;
    const edital = await prisma.studyEdital.create({
      data: {
        userId: req.user.id,
        name,
        banca: cleanStr(req.body.banca, 100),
        examDate: examDate && !Number.isNaN(examDate.getTime()) ? examDate : null,
        items: { create: items },
      },
    });
    return created(res, { ...edital, total: items.length }, `Edital criado com ${items.length} tópicos`);
  } catch (err) { next(err); }
};

// Progresso: tópicos com teoria vista / total
async function summaries(userId) {
  const editais = await prisma.studyEdital.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { items: true } } },
  });
  const studied = await prisma.editalItem.groupBy({
    by: ['editalId'],
    where: { editalId: { in: editais.map((e) => e.id) }, studied: true },
    _count: { _all: true },
  });
  const map = new Map(studied.map((s) => [s.editalId, s._count._all]));
  return editais.map(({ _count, ...e }) => ({
    ...e,
    total: _count.items,
    studied: map.get(e.id) || 0,
    progress: _count.items ? Math.round(((map.get(e.id) || 0) / _count.items) * 100) : 0,
  }));
}

const list = async (req, res, next) => {
  try {
    return success(res, await summaries(req.user.id));
  } catch (err) { next(err); }
};

// GET /study-editais/:id — tópicos + questões disponíveis, resolvidas e acerto em cada um
const getOne = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const edital = await prisma.studyEdital.findFirst({
      where: { id: req.params.id, userId },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!edital) return notFound(res, 'Edital não encontrado');

    const tree = await taxonomy.getTree();
    const [available, mine] = await Promise.all([
      prisma.question.groupBy({
        by: ['assuntoId'],
        where: { OR: [{ isPublic: true }, { userId }], assuntoId: { not: null } },
        _count: { _all: true },
      }),
      prisma.$queryRaw`
        SELECT q.assuntoId AS id, COUNT(*) AS total, SUM(qa.isCorrect) AS correct, COUNT(DISTINCT qa.questionId) AS solved
        FROM question_attempts qa JOIN questions q ON q.id = qa.questionId
        WHERE qa.userId = ${userId} AND q.assuntoId IS NOT NULL
        GROUP BY q.assuntoId`,
    ]);
    const availableBy = taxonomy.rollUp(tree, available.map((r) => ({ id: r.assuntoId, count: r._count._all })));
    const answeredBy = taxonomy.rollUp(tree, mine.map((r) => ({ id: Number(r.id), count: Number(r.total) })));
    const correctBy = taxonomy.rollUp(tree, mine.map((r) => ({ id: Number(r.id), count: Number(r.correct || 0) })));
    const solvedBy = taxonomy.rollUp(tree, mine.map((r) => ({ id: Number(r.id), count: Number(r.solved) })));

    const items = edital.items.map((it) => {
      const answered = it.assuntoId ? answeredBy[it.assuntoId] || 0 : 0;
      return {
        ...it,
        path: it.assuntoId ? taxonomy.pathOf(tree, it.assuntoId).map((n) => n.name) : null,
        questions: it.assuntoId ? availableBy[it.assuntoId] || 0 : 0,
        solved: it.assuntoId ? solvedBy[it.assuntoId] || 0 : 0,
        answered,
        accuracy: answered ? Math.round(((correctBy[it.assuntoId] || 0) / answered) * 100) : null,
      };
    });
    const studied = items.filter((i) => i.studied).length;
    const withQuestions = items.filter((i) => i.answered > 0).length;
    return success(res, {
      ...edital,
      items,
      total: items.length,
      studied,
      withQuestions,
      progress: items.length ? Math.round((studied / items.length) * 100) : 0,
    });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const edital = await prisma.studyEdital.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!edital) return notFound(res, 'Edital não encontrado');
    const data = {};
    if (req.body.name !== undefined) {
      data.name = cleanStr(req.body.name);
      if (!data.name) return badRequest(res, 'Nome obrigatório');
    }
    if (req.body.banca !== undefined) data.banca = cleanStr(req.body.banca, 100);
    if (req.body.examDate !== undefined) {
      const d = req.body.examDate ? new Date(req.body.examDate) : null;
      data.examDate = d && !Number.isNaN(d.getTime()) ? d : null;
    }
    return success(res, await prisma.studyEdital.update({ where: { id: edital.id }, data }));
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { count } = await prisma.studyEdital.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!count) return notFound(res, 'Edital não encontrado');
    return success(res, null, 'Edital excluído');
  } catch (err) { next(err); }
};

// PATCH /study-editais/:id/items/:itemId  { studied?, reviews?, addReview?, assuntoId?, notes?, label? }
const updateItem = async (req, res, next) => {
  try {
    const item = await prisma.editalItem.findFirst({
      where: { id: req.params.itemId, editalId: req.params.id, edital: { userId: req.user.id } },
    });
    if (!item) return notFound(res, 'Tópico não encontrado');
    const data = {};
    if (req.body.studied !== undefined) {
      data.studied = Boolean(req.body.studied);
      if (data.studied && !item.studied) data.lastStudiedAt = new Date();
    }
    if (req.body.addReview) {
      data.reviews = { increment: 1 };
      data.lastStudiedAt = new Date();
      if (!item.studied) data.studied = true;
    } else if (req.body.reviews !== undefined) {
      data.reviews = Math.max(0, Math.min(99, parseInt(req.body.reviews, 10) || 0));
    }
    if (req.body.assuntoId !== undefined) {
      const a = await validAssunto(req.body.assuntoId);
      if (a === undefined) return badRequest(res, 'Assunto inválido');
      data.assuntoId = a;
    }
    if (req.body.notes !== undefined) data.notes = req.body.notes ? String(req.body.notes).slice(0, 5000) : null;
    if (req.body.label !== undefined) {
      data.label = cleanStr(req.body.label, 2000);
      if (!data.label) return badRequest(res, 'Tópico vazio');
    }
    const updated = await prisma.editalItem.update({ where: { id: item.id }, data });
    const tree = await taxonomy.getTree();
    return success(res, { ...updated, path: updated.assuntoId ? taxonomy.pathOf(tree, updated.assuntoId).map((n) => n.name) : null });
  } catch (err) { next(err); }
};

// POST /study-editais/:id/items  { discipline, label, assuntoId? }
const addItem = async (req, res, next) => {
  try {
    const edital = await prisma.studyEdital.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { _count: { select: { items: true } } },
    });
    if (!edital) return notFound(res, 'Edital não encontrado');
    if (edital._count.items >= MAX_ITEMS) return badRequest(res, `Máximo de ${MAX_ITEMS} tópicos por edital`);
    const label = cleanStr(req.body.label, 2000);
    const discipline = cleanStr(req.body.discipline) || 'Geral';
    if (!label) return badRequest(res, 'Escreva o tópico');
    let assuntoId = await validAssunto(req.body.assuntoId);
    if (assuntoId === undefined) return badRequest(res, 'Assunto inválido');
    if (assuntoId === null) {
      const m = await taxonomy.matchEditalTopic(discipline, label);
      assuntoId = (m.node || m.root)?.id ?? null;
    }
    // Entra no fim da matéria
    const last = await prisma.editalItem.findFirst({
      where: { editalId: edital.id, discipline }, orderBy: { position: 'desc' }, select: { position: true },
    });
    const position = last ? last.position + 1 : edital._count.items;
    if (last) {
      await prisma.editalItem.updateMany({ where: { editalId: edital.id, position: { gte: position } }, data: { position: { increment: 1 } } });
    }
    const item = await prisma.editalItem.create({ data: { editalId: edital.id, discipline, label, assuntoId, position } });
    return created(res, item, 'Tópico adicionado');
  } catch (err) { next(err); }
};

const removeItem = async (req, res, next) => {
  try {
    const { count } = await prisma.editalItem.deleteMany({
      where: { id: req.params.itemId, editalId: req.params.id, edital: { userId: req.user.id } },
    });
    if (!count) return notFound(res, 'Tópico não encontrado');
    return success(res, null, 'Tópico removido');
  } catch (err) { next(err); }
};

module.exports = { parse, create, list, getOne, update, remove, updateItem, addItem, removeItem, summaries };
