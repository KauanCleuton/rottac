const prisma = require('../utils/prisma');
const { success, created, notFound, badRequest, forbidden } = require('../utils/response');
const { loadRole } = require('../middlewares/role.middleware');
const questionReview = require('../services/questionReview');
const taxonomy = require('../services/taxonomy');
const { checkDailyQuestions, entitlementsFor } = require('../middlewares/plan.middleware');

// ─── Constantes ───────────────────────────────────────────────────────────────

const TYPES = ['MULTIPLA_ESCOLHA', 'CERTO_ERRADO'];
const DIFFICULTIES = ['FACIL', 'MEDIO', 'DIFICIL'];
const LEVELS = ['FUNDAMENTAL', 'MEDIO', 'SUPERIOR'];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const TEXT_FIELDS = ['discipline', 'topic', 'banca', 'orgao', 'cargo', 'source'];
const MAX_BULK = 500;

// Questões visíveis: banco público + as do próprio usuário
const visibleWhere = (userId) => ({ OR: [{ isPublic: true }, { userId }] });

const isAdminReq = async (req) => (await loadRole(req)) === 'ADMIN';

const cleanText = (v, max = 191) => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
};

// ─── Validação / normalização ─────────────────────────────────────────────────

// Retorna { data } ou { error }. `partial` = update (só valida o que veio).
function normalizeQuestion(body, { isAdmin, partial = false } = {}) {
  const data = {};
  const type = body.type ?? (partial ? undefined : 'MULTIPLA_ESCOLHA');

  if (type !== undefined) {
    if (!TYPES.includes(type)) return { error: 'Tipo de questão inválido' };
    data.type = type;
  }

  if (body.statement !== undefined || !partial) {
    const statement = String(body.statement ?? '').trim();
    if (statement.length < 5) return { error: 'O enunciado é obrigatório' };
    data.statement = statement;
  }

  // Alternativas: aceita { options: {A..E} } ou optionA..optionE
  const opts = {};
  for (const l of LETTERS) {
    const raw = body.options?.[l] ?? body[`option${l}`];
    if (raw !== undefined) opts[l] = raw === null ? null : String(raw).trim() || null;
  }

  if (data.type === 'CERTO_ERRADO') {
    for (const l of LETTERS) data[`option${l}`] = null;
  } else if (data.type === 'MULTIPLA_ESCOLHA' || Object.keys(opts).length) {
    for (const l of LETTERS) if (l in opts) data[`option${l}`] = opts[l];
    if (data.type === 'MULTIPLA_ESCOLHA') {
      const filled = LETTERS.filter((l) => opts[l]);
      if (filled.length < 2) return { error: 'Informe pelo menos as alternativas A e B' };
      // Alternativas devem ser contíguas (A, B, C... sem buracos)
      if (filled.some((l, i) => l !== LETTERS[i])) {
        return { error: 'Preencha as alternativas em ordem, sem pular letras' };
      }
    }
  }

  if (body.answer !== undefined) {
    const answer = body.answer ? String(body.answer).trim().toUpperCase() : null;
    if (answer) {
      const finalType = data.type ?? body._currentType;
      if (finalType === 'CERTO_ERRADO') {
        if (!['C', 'E'].includes(answer)) return { error: 'Gabarito deve ser C (Certo) ou E (Errado)' };
      } else {
        const available = LETTERS.filter((l) => (opts[l] ?? body._currentOptions?.[l]));
        if (!available.includes(answer)) return { error: `Gabarito "${answer}" não corresponde a uma alternativa preenchida` };
      }
    }
    data.answer = answer;
  }

  if (body.explanation !== undefined) data.explanation = cleanText(body.explanation, 20000);

  for (const f of TEXT_FIELDS) if (body[f] !== undefined) data[f] = cleanText(body[f]);

  if (body.year !== undefined) {
    if (body.year === null || body.year === '') data.year = null;
    else {
      const year = parseInt(body.year, 10);
      if (!year || year < 1950 || year > new Date().getFullYear() + 1) return { error: 'Ano inválido' };
      data.year = year;
    }
  }

  if (body.difficulty !== undefined) {
    if (!DIFFICULTIES.includes(body.difficulty)) return { error: 'Dificuldade inválida' };
    data.difficulty = body.difficulty;
  }

  if (body.level !== undefined) {
    if (body.level && !LEVELS.includes(body.level)) return { error: 'Escolaridade inválida' };
    data.level = body.level || null;
  }

  if (body.isAnnulled !== undefined) data.isAnnulled = Boolean(body.isAnnulled);
  if (body.isOutdated !== undefined) data.isOutdated = Boolean(body.isOutdated);

  // Só admin publica no banco compartilhado
  if (body.isPublic !== undefined) data.isPublic = isAdmin ? Boolean(body.isPublic) : false;
  else if (!partial) data.isPublic = false;

  if (body.subjectId !== undefined) data.subjectId = body.subjectId || null;
  if (body.textId !== undefined) data.textId = body.textId || null;
  if (body.assuntoId !== undefined) {
    if (body.assuntoId === null || body.assuntoId === '') data.assuntoId = null;
    else {
      const id = parseInt(body.assuntoId, 10);
      if (!id) return { error: 'Assunto inválido' };
      data.assuntoId = id;
    }
  }

  return { data };
}

// Liga a questão à árvore de assuntos e mantém disciplina/assunto (texto) em sincronia:
// - assuntoId informado: disciplina = matéria raiz, assunto = nome do nó
// - só disciplina/assunto em texto (PDF, cadastro antigo): tenta reconhecer o nó pelo nome
async function applyAssunto(data) {
  const tree = await taxonomy.getTree();
  if (data.assuntoId) {
    const labels = taxonomy.labelsOf(tree, data.assuntoId);
    if (!labels) return 'Assunto inválido';
    Object.assign(data, labels);
  } else if (data.assuntoId === undefined && data.discipline) {
    const node = await taxonomy.matchAssunto(data.discipline, data.topic);
    if (node) Object.assign(data, { assuntoId: node.id, ...taxonomy.labelsOf(tree, node.id) });
    else data.assuntoId = null;
  }
  return null;
}

// Esconde gabarito/explicação de quem ainda não respondeu (e não é dono/admin)
function serialize(q, { userId, isAdmin, attempts = [], favoriteIds = new Set(), annotatedIds = new Set() }) {
  const mine = attempts.filter((a) => a.questionId === q.id);
  const last = mine[0] || null;
  const canSee = isAdmin || q.userId === userId || mine.length > 0;
  const { attempts: _a, favorites: _f, _count, user, ...rest } = q;
  return {
    ...rest,
    answer: canSee ? q.answer : undefined,
    explanation: canSee ? q.explanation : undefined,
    hasAnswer: Boolean(q.answer),
    isOwner: q.userId === userId,
    author: user ? { id: user.id, name: user.name } : undefined,
    assuntoPath: q.assuntoId && taxonomy.peek() ? taxonomy.pathOf(taxonomy.peek(), q.assuntoId).map((n) => n.name) : null,
    commentsCount: _count?.comments ?? 0,
    isFavorite: favoriteIds.has(q.id),
    hasAnnotation: annotatedIds.has(q.id),
    myAttempts: mine.length,
    lastAttempt: last ? { selected: last.selected, isCorrect: last.isCorrect, createdAt: last.createdAt } : null,
  };
}

async function userContext(req, questionIds) {
  const userId = req.user.id;
  const [isAdmin, attempts, favorites, annotations] = await Promise.all([
    isAdminReq(req),
    questionIds.length
      ? prisma.questionAttempt.findMany({
          where: { userId, questionId: { in: questionIds } },
          orderBy: { createdAt: 'desc' },
          select: { questionId: true, selected: true, isCorrect: true, createdAt: true },
        })
      : [],
    questionIds.length
      ? prisma.questionFavorite.findMany({
          where: { userId, questionId: { in: questionIds } },
          select: { questionId: true },
        })
      : [],
    questionIds.length
      ? prisma.questionAnnotation.findMany({
          where: { userId, questionId: { in: questionIds } },
          select: { questionId: true },
        })
      : [],
  ]);
  return {
    userId,
    isAdmin,
    attempts,
    favoriteIds: new Set(favorites.map((f) => f.questionId)),
    annotatedIds: new Set(annotations.map((a) => a.questionId)),
  };
}

function parseTree(raw) {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 300)
    .filter((n) => n && (typeof n.d === 'string' || n.d === null))
    .map((n) => ({
      d: n.d === null ? null : String(n.d).slice(0, 191),
      t: n.t === undefined ? undefined : n.t === null ? null : String(n.t).slice(0, 191),
    }));
}

function buildWhere(query, userId) {
  const and = [visibleWhere(userId)];
  const { search, type, difficulty, level, year, scope, status, favorites } = query;

  for (const f of ['discipline', 'topic', 'banca', 'orgao', 'cargo']) {
    if (query[f]) {
      const values = String(query[f]).split('|').filter(Boolean);
      and.push(values.length > 1 ? { [f]: { in: values } } : { [f]: values[0] });
    }
  }
  if (search) {
    const term = String(search).slice(0, 200);
    and.push({ OR: [{ statement: { contains: term } }, { topic: { contains: term } }, { source: { contains: term } }] });
  }
  // Aceitam um ou vários valores separados por "|"
  const multi = (v, allowed) => String(v || '').split('|').filter((x) => allowed.includes(x));
  const types = multi(type, TYPES);
  if (types.length) and.push({ type: { in: types } });
  const diffs = multi(difficulty, DIFFICULTIES);
  if (diffs.length) and.push({ difficulty: { in: diffs } });
  const levels = multi(level, LEVELS);
  if (levels.length) and.push({ level: { in: levels } });

  // Árvore disciplina › assunto: cada ramo é um "OU" ([{ d, t? }]; t ausente = disciplina inteira;
  // d/t null = "sem disciplina"/"sem assunto")
  // Árvore de assuntos: "12,45" (cada nó inclui todos os descendentes); 0 = sem classificação
  if (query.assuntos) {
    const picked = String(query.assuntos).split(',').map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v) && v >= 0).slice(0, 500);
    const t = taxonomy.peek();
    const ids = new Set();
    for (const id of picked) {
      if (id === 0) continue;
      if (t) for (const d of taxonomy.descendantIds(t, id)) ids.add(d);
      else ids.add(id);
    }
    // Ids inexistentes resultam em nenhuma questão (não em "sem filtro")
    const or = [{ assuntoId: { in: [...ids] } }];
    if (picked.includes(0)) or.push({ assuntoId: null });
    if (picked.length || String(query.assuntos).trim()) and.push({ OR: or });
  }

  const tree = parseTree(query.tree);
  if (tree.length) {
    and.push({
      OR: tree.map(({ d, t }) => (t === undefined ? { discipline: d } : { discipline: d, topic: t })),
    });
  }
  if (year) {
    const years = String(year).split('|').map((y) => parseInt(y, 10)).filter(Boolean);
    if (years.length) and.push({ year: { in: years } });
  }
  if (scope === 'public') and.push({ isPublic: true });
  if (scope === 'mine') and.push({ userId });
  if (status === 'nao_resolvidas') and.push({ attempts: { none: { userId } } });
  if (status === 'resolvidas') and.push({ attempts: { some: { userId } } });
  if (status === 'acertei') and.push({ attempts: { some: { userId, isCorrect: true } } });
  if (status === 'errei') and.push({ attempts: { some: { userId, isCorrect: false } } });
  if (favorites === '1' || favorites === 'true') and.push({ favorites: { some: { userId } } });
  if (status === 'revisar') and.push({ reviews: { some: { userId, mastered: false, nextReviewAt: { lte: new Date() } } } });
  if (query.hideAnnulled === '1') and.push({ isAnnulled: false });
  if (query.hideOutdated === '1') and.push({ isOutdated: false });
  // Pendências de curadoria (painel do admin)
  if (query.missing === 'answer') and.push({ answer: null });
  if (query.missing === 'explanation') and.push({ explanation: null });
  if (query.missing === 'discipline') and.push({ discipline: null });
  if (query.missing === 'assunto') and.push({ assuntoId: null });
  return { AND: and };
}

const listInclude = {
  subject: { select: { id: true, name: true, color: true } },
  text: { select: { id: true, title: true, body: true, source: true } },
  user: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
};

// ─── GET /question-bank ──────────────────────────────────────────────────────
const list = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const where = buildWhere(req.query, userId);

    let questions;
    let total;
    if (req.query.order === 'random') {
      // MySQL + Prisma não têm ORDER BY RAND(): sorteia entre os ids que batem com o filtro
      const ids = await prisma.question.findMany({ where, select: { id: true }, take: 5000 });
      total = ids.length;
      const picked = ids
        .map((r) => r.id)
        .sort(() => Math.random() - 0.5)
        .slice(0, limit);
      const rows = await prisma.question.findMany({ where: { id: { in: picked } }, include: listInclude });
      const pos = new Map(picked.map((id, i) => [id, i]));
      questions = rows.sort((a, b) => pos.get(a.id) - pos.get(b.id));
    } else {
      const orderBy = req.query.order === 'oldest' ? { createdAt: 'asc' }
        : req.query.order === 'year' ? [{ year: 'desc' }, { createdAt: 'desc' }]
        : { createdAt: 'desc' };
      [questions, total] = await Promise.all([
        prisma.question.findMany({ where, include: listInclude, orderBy, skip: (page - 1) * limit, take: limit }),
        prisma.question.count({ where }),
      ]);
    }

    const ctx = await userContext(req, questions.map((q) => q.id));
    return success(res, {
      questions: questions.map((q) => serialize(q, ctx)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /question-bank/filters ──────────────────────────────────────────────
const filters = async (req, res, next) => {
  try {
    const where = visibleWhere(req.user.id);
    const distinct = (field) =>
      prisma.question.groupBy({
        by: [field],
        where: { ...where, [field]: { not: null } },
        _count: { _all: true },
        orderBy: { [field]: field === 'year' ? 'desc' : 'asc' },
      }).then((rows) => rows.map((r) => ({ value: r[field], count: r._count._all })));

    const [discipline, topic, banca, orgao, cargo, year, total] = await Promise.all([
      distinct('discipline'), distinct('topic'), distinct('banca'),
      distinct('orgao'), distinct('cargo'), distinct('year'),
      prisma.question.count({ where }),
    ]);
    return success(res, { discipline, topic, banca, orgao, cargo, year, total });
  } catch (err) {
    next(err);
  }
};

// ─── GET /question-bank/facets ───────────────────────────────────────────────
// Montador de cadernos: árvore disciplina › assunto + contagens de cada filtro.
// Cada faceta conta respeitando os OUTROS filtros (não o próprio), para as opções
// continuarem visíveis enquanto o aluno marca e desmarca.
const FACET_FIELDS = ['banca', 'orgao', 'cargo', 'year', 'type', 'difficulty', 'level'];

const facets = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const q = req.query;
    const without = (...keys) => buildWhere(Object.fromEntries(Object.entries(q).filter(([k]) => !keys.includes(k))), userId);
    const group = (field, where) => prisma.question.groupBy({ by: [field], where, _count: { _all: true } })
      .then((rows) => rows
        .filter((r) => r[field] !== null)
        .map((r) => ({ value: r[field], count: r._count._all }))
        .sort((a, b) => (field === 'year' ? b.value - a.value : b.count - a.count)));

    const tax = await taxonomy.getTree();
    const [total, assuntoRows, treeRows, subjects, accuracyRows, ...facetValues] = await Promise.all([
      prisma.question.count({ where: buildWhere(q, userId) }),
      // Contagem por nó da árvore (sem o próprio filtro de assuntos, para mostrar o que dá para marcar)
      prisma.question.groupBy({ by: ['assuntoId'], where: without('assuntos', 'tree', 'discipline', 'topic'), _count: { _all: true } }),
      prisma.question.groupBy({ by: ['discipline', 'topic'], where: without('tree', 'discipline', 'topic'), _count: { _all: true } }),
      // Disciplinas e tópicos do edital/plano do aluno (aparecem mesmo sem questões)
      prisma.subject.findMany({
        where: { userId },
        select: { name: true, color: true, modules: { select: { topics: { select: { name: true } } } } },
      }),
      // Acerto do aluno por disciplina (mostrado na árvore)
      prisma.$queryRaw`
        SELECT q.discipline AS name, COUNT(*) AS total, SUM(qa.isCorrect) AS correct
        FROM question_attempts qa JOIN questions q ON q.id = qa.questionId
        WHERE qa.userId = ${userId} AND q.discipline IS NOT NULL
        GROUP BY q.discipline`,
      ...FACET_FIELDS.map((f) => group(f, without(f))),
    ]);

    // Monta a árvore: disciplina -> assuntos (com contagem)
    const tree = new Map();
    const node = (name) => {
      const key = name ?? '';
      if (!tree.has(key)) tree.set(key, { discipline: name, count: 0, color: null, topics: new Map(), fromEdital: false });
      return tree.get(key);
    };
    for (const r of treeRows) {
      const d = node(r.discipline);
      d.count += r._count._all;
      const tk = r.topic ?? '';
      const t = d.topics.get(tk) || { topic: r.topic, count: 0, fromEdital: false };
      t.count += r._count._all;
      d.topics.set(tk, t);
    }
    for (const s of subjects) {
      const d = node(s.name);
      d.color = s.color;
      d.fromEdital = true;
      for (const m of s.modules) for (const t of m.topics) {
        if (!d.topics.has(t.name)) d.topics.set(t.name, { topic: t.name, count: 0, fromEdital: true });
        else d.topics.get(t.name).fromEdital = true;
      }
    }
    const accuracy = Object.fromEntries(accuracyRows.map((r) => [r.name, {
      answered: Number(r.total),
      accuracy: Number(r.total) ? Math.round((Number(r.correct) / Number(r.total)) * 100) : null,
    }]));

    const treeOut = [...tree.values()]
      .map((d) => ({
        discipline: d.discipline,
        count: d.count,
        color: d.color,
        fromEdital: d.fromEdital,
        mine: d.discipline ? accuracy[d.discipline] || null : null,
        topics: [...d.topics.values()].sort((a, b) => b.count - a.count || String(a.topic).localeCompare(String(b.topic))),
      }))
      // Disciplinas com questões primeiro; "sem disciplina" por último
      .sort((a, b) => (a.discipline === null) - (b.discipline === null) || b.count - a.count || String(a.discipline).localeCompare(String(b.discipline)));

    const assuntoCounts = taxonomy.rollUp(tax, assuntoRows
      .filter((r) => r.assuntoId !== null)
      .map((r) => ({ id: r.assuntoId, count: r._count._all })));
    const semAssunto = assuntoRows.find((r) => r.assuntoId === null)?._count._all ?? 0;

    return success(res, {
      total,
      assuntoCounts,
      semAssunto,
      tree: treeOut,
      ...Object.fromEntries(FACET_FIELDS.map((f, i) => [f, facetValues[i]])),
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /question-bank/incidence ────────────────────────────────────────────
// "O que mais cai": ranking dos assuntos mais cobrados (banca/órgão/cargo/anos opcionais)
// dentro de uma matéria (ou entre as matérias), com o acerto do aluno em cada um.
//   root  = nó de partida (vazio = matérias)   depth = quantos níveis abaixo agrupar (1-3)
const incidence = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tree = await taxonomy.getTree();
    const rootId = parseInt(req.query.root, 10) || null;
    const root = rootId ? tree.byId.get(rootId) : null;
    if (rootId && !root) return notFound(res, 'Assunto não encontrado');
    const levels = Math.min(3, Math.max(1, parseInt(req.query.depth, 10) || 1));
    const targetDepth = (root ? root.depth : 0) + levels;

    // Só o banco público: é o retrato do que as bancas cobram
    const { root: _r, depth: _d, ...rest } = req.query;
    const where = buildWhere({ ...rest, scope: 'public', assuntos: root ? String(root.id) : undefined }, userId);
    where.AND.push({ assuntoId: { not: null } });

    const [rows, mine] = await Promise.all([
      prisma.question.groupBy({ by: ['assuntoId'], where, _count: { _all: true } }),
      prisma.questionAttempt.findMany({
        where: { userId, question: where },
        select: { isCorrect: true, question: { select: { assuntoId: true } } },
        take: 20000,
      }),
    ]);

    // Sobe cada nó até o nível pedido; o que foi classificado só no nó de partida fica em "geral"
    const bucketOf = (id) => {
      let n = tree.byId.get(id);
      while (n && n.depth > targetDepth) n = tree.byId.get(n.parentId);
      return n && n.id !== root?.id ? n : null;
    };
    const buckets = new Map();
    let total = 0;
    let general = 0;
    for (const r of rows) {
      const b = bucketOf(r.assuntoId);
      total += r._count._all;
      if (!b) { general += r._count._all; continue; }
      const cur = buckets.get(b.id) || { id: b.id, count: 0, answered: 0, correct: 0 };
      cur.count += r._count._all;
      buckets.set(b.id, cur);
    }
    for (const a of mine) {
      const b = bucketOf(a.question.assuntoId);
      const cur = b && buckets.get(b.id);
      if (!cur) continue;
      cur.answered += 1;
      if (a.isCorrect) cur.correct += 1;
    }

    const ranking = [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .map((b) => ({
        id: b.id,
        name: tree.byId.get(b.id).name,
        path: taxonomy.pathOf(tree, b.id).map((n) => n.name),
        count: b.count,
        share: total ? Math.round((b.count / total) * 1000) / 10 : 0,
        answered: b.answered,
        accuracy: b.answered ? Math.round((b.correct / b.answered) * 100) : null,
      }));

    return success(res, {
      root: root ? { id: root.id, name: root.name, path: taxonomy.pathOf(tree, root.id).map((n) => n.name) } : null,
      total,
      general,
      ranking,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /question-bank/assuntos ─────────────────────────────────────────────
// Árvore completa em formato compacto [[id, parentId, nome], ...] na ordem da árvore.
// Muda raramente: o navegador guarda por 1h e revalida pelo ETag.
let assuntosPayload = null;
const listAssuntos = async (req, res, next) => {
  try {
    const tree = await taxonomy.getTree();
    if (!assuntosPayload || assuntosPayload.tree !== tree) {
      const body = JSON.stringify({ success: true, data: tree.list.map((n) => [n.id, n.parentId, n.name]) });
      assuntosPayload = { tree, body, etag: `"as-${tree.list.length}-${body.length}"` };
    }
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('ETag', assuntosPayload.etag);
    if (req.headers['if-none-match'] === assuntosPayload.etag) return res.status(304).end();
    return res.type('application/json').send(assuntosPayload.body);
  } catch (err) {
    next(err);
  }
};

// ─── GET /question-bank/:id ──────────────────────────────────────────────────
const getOne = async (req, res, next) => {
  try {
    const q = await prisma.question.findFirst({
      where: { id: req.params.id, ...visibleWhere(req.user.id) },
      include: listInclude,
    });
    if (!q) return notFound(res, 'Questão não encontrada');
    const ctx = await userContext(req, [q.id]);
    return success(res, serialize(q, ctx));
  } catch (err) {
    next(err);
  }
};

// Verifica se o usuário pode editar/excluir (dono ou admin)
async function findEditable(req, id) {
  const q = await prisma.question.findUnique({ where: { id } });
  if (!q) return { status: 404 };
  if (q.userId !== req.user.id && !(await isAdminReq(req))) return { status: 403 };
  return { q };
}

async function ensureVisibleText(textId, userId) {
  if (!textId) return true;
  return Boolean(await prisma.questionText.findFirst({ where: { id: textId, OR: [{ isPublic: true }, { userId }] }, select: { id: true } }));
}

async function ensureOwnSubject(subjectId, userId) {
  if (!subjectId) return true;
  return Boolean(await prisma.subject.findFirst({ where: { id: subjectId, userId }, select: { id: true } }));
}

// ─── POST /question-bank ─────────────────────────────────────────────────────
const create = async (req, res, next) => {
  try {
    const isAdmin = await isAdminReq(req);
    const { data, error } = normalizeQuestion(req.body, { isAdmin });
    if (error) return badRequest(res, error);
    const assuntoError = await applyAssunto(data);
    if (assuntoError) return badRequest(res, assuntoError);
    if (!(await ensureOwnSubject(data.subjectId, req.user.id))) return badRequest(res, 'Disciplina inválida');
    if (!(await ensureVisibleText(data.textId, req.user.id))) return badRequest(res, 'Texto de apoio inválido');

    const q = await prisma.question.create({ data: { ...data, userId: req.user.id }, include: listInclude });
    return created(res, serialize(q, { userId: req.user.id, isAdmin }), 'Questão cadastrada');
  } catch (err) {
    next(err);
  }
};

// ─── PUT /question-bank/:id ──────────────────────────────────────────────────
const update = async (req, res, next) => {
  try {
    const { q, status } = await findEditable(req, req.params.id);
    if (status === 404) return notFound(res, 'Questão não encontrada');
    if (status === 403) return forbidden(res, 'Você só pode editar suas próprias questões');

    const isAdmin = await isAdminReq(req);
    const { data, error } = normalizeQuestion(
      {
        ...req.body,
        _currentType: q.type,
        _currentOptions: Object.fromEntries(LETTERS.map((l) => [l, q[`option${l}`]])),
      },
      { isAdmin, partial: true },
    );
    if (error) return badRequest(res, error);
    // Mudou só o assunto em texto: reclassifica a partir da disciplina atual
    if (data.assuntoId === undefined && data.topic !== undefined && data.discipline === undefined) data.discipline = q.discipline;
    const assuntoError = await applyAssunto(data);
    if (assuntoError) return badRequest(res, assuntoError);
    if (!(await ensureOwnSubject(data.subjectId, req.user.id))) return badRequest(res, 'Disciplina inválida');
    if (!(await ensureVisibleText(data.textId, req.user.id))) return badRequest(res, 'Texto de apoio inválido');

    const updated = await prisma.question.update({ where: { id: q.id }, data, include: listInclude });
    return success(res, serialize(updated, { userId: req.user.id, isAdmin }), 'Questão atualizada');
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /question-bank/:id ───────────────────────────────────────────────
const remove = async (req, res, next) => {
  try {
    const { q, status } = await findEditable(req, req.params.id);
    if (status === 404) return notFound(res, 'Questão não encontrada');
    if (status === 403) return forbidden(res, 'Você só pode excluir suas próprias questões');
    await prisma.question.delete({ where: { id: q.id } });
    return success(res, null, 'Questão excluída');
  } catch (err) {
    next(err);
  }
};

// ─── POST /question-bank/bulk ────────────────────────────────────────────────
// Recebe { questions: [...], defaults: { discipline, banca, ... , isPublic } }
const bulkCreate = async (req, res, next) => {
  try {
    const { questions, defaults = {}, texts = [] } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) return badRequest(res, 'Nenhuma questão enviada');
    if (questions.length > MAX_BULK) return badRequest(res, `Máximo de ${MAX_BULK} questões por envio`);

    const isAdmin = await isAdminReq(req);
    if (!(await ensureOwnSubject(defaults.subjectId, req.user.id))) return badRequest(res, 'Disciplina inválida');

    // Textos de apoio do PDF: só os que alguma questão usa
    const usedKeys = new Set(questions.map((q) => q.textKey).filter((k) => k !== undefined && k !== null && k !== ''));
    const textIds = {};
    for (const t of Array.isArray(texts) ? texts.slice(0, 100) : []) {
      if (!usedKeys.has(t.key) || !String(t.body || '').trim()) continue;
      const created = await prisma.questionText.create({
        data: {
          userId: req.user.id,
          title: t.title ? String(t.title).slice(0, 191) : null,
          body: String(t.body).slice(0, 60000),
          source: t.source ? String(t.source).slice(0, 2000) : null,
          isPublic: isAdmin && Boolean(defaults.isPublic),
        },
      });
      textIds[t.key] = created.id;
    }

    const valid = [];
    const errors = [];
    for (const [i, raw] of questions.entries()) {
      const { textKey, ...rest } = raw;
      const merged = { ...defaults, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== '' && v !== undefined)) };
      // Assunto escolhido na questão vale mais que a disciplina padrão do envio
      if (rest.discipline && !rest.assuntoId) delete merged.assuntoId;
      if (textKey !== undefined && textIds[textKey]) merged.textId = textIds[textKey];
      const { data, error } = normalizeQuestion(merged, { isAdmin });
      const assuntoError = error ? null : await applyAssunto(data);
      if (error || assuntoError) errors.push({ index: i, number: raw.number ?? i + 1, error: error || assuntoError });
      else valid.push({ ...data, userId: req.user.id });
    }

    if (valid.length) await prisma.question.createMany({ data: valid });
    return success(res, { created: valid.length, errors, texts: Object.keys(textIds).length }, `${valid.length} questões cadastradas`);
  } catch (err) {
    next(err);
  }
};

// Liga a tentativa às disciplinas do aluno para alimentar analytics/IA (QuestionLog)
async function mirrorToQuestionLog(userId, question, isCorrect, timeSpent) {
  let subjectId = null;
  if (question.subjectId) {
    const own = await prisma.subject.findFirst({ where: { id: question.subjectId, userId }, select: { id: true } });
    subjectId = own?.id ?? null;
  }
  if (!subjectId && question.discipline) {
    const match = await prisma.subject.findFirst({ where: { userId, name: question.discipline }, select: { id: true } });
    subjectId = match?.id ?? null;
  }
  if (!subjectId) return;
  const source = [question.banca, question.orgao, question.year].filter(Boolean).join(' · ') || 'Banco de questões';
  await prisma.questionLog.create({
    data: { userId, subjectId, isCorrect, timeSpent: timeSpent || null, source: source.slice(0, 191) },
  });
}

// ─── POST /question-bank/:id/answer ──────────────────────────────────────────
const answer = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const selected = String(req.body.selected || '').trim().toUpperCase();
    const timeSpent = Number.isFinite(+req.body.timeSpent) ? Math.max(0, Math.round(+req.body.timeSpent)) : null;

    const question = await prisma.question.findFirst({ where: { id: req.params.id, ...visibleWhere(userId) } });
    if (!question) return notFound(res, 'Questão não encontrada');
    if (!(await checkDailyQuestions(req, res))) return;

    // Resposta dentro de um caderno: o caderno precisa ser do aluno e conter a questão
    let notebookId = null;
    if (req.body.notebookId) {
      const item = await prisma.notebookQuestion.findFirst({
        where: { notebookId: String(req.body.notebookId), questionId: question.id, notebook: { userId } },
        select: { notebookId: true },
      });
      if (!item) return badRequest(res, 'Esta questão não pertence ao caderno informado');
      notebookId = item.notebookId;
    }

    const allowed = question.type === 'CERTO_ERRADO'
      ? ['C', 'E']
      : LETTERS.filter((l) => question[`option${l}`]);
    if (!allowed.includes(selected)) return badRequest(res, 'Alternativa inválida');

    // Questão anulada: qualquer resposta conta como certa (regra das bancas)
    const isCorrect = question.isAnnulled
      ? true
      : Boolean(question.answer) && selected === question.answer;

    await prisma.questionAttempt.create({
      data: { questionId: question.id, userId, selected, isCorrect, timeSpent, notebookId },
    });

    // Errou: vai para o Caderno de Erros e para a revisão espaçada; acertou na data: avança a agenda
    // Revisão espaçada / Caderno de Erros automático só se o plano incluir
    const ent = await entitlementsFor(req);
    const reviewPromise = ent.features.revisaoEspacada
      ? questionReview.applyAnswer({ userId, question, isCorrect, selected, timeSpent })
        .catch((e) => { console.warn('[questionBank] falha na revisão espaçada:', e.message); return null; })
      : Promise.resolve(null);

    const [review] = await Promise.all([
      reviewPromise,
      prisma.gamification.updateMany({ where: { userId }, data: { xp: { increment: isCorrect ? 5 : 1 } } }),
      mirrorToQuestionLog(userId, question, isCorrect, timeSpent).catch((e) =>
        console.warn('[questionBank] falha ao espelhar em QuestionLog:', e.message)),
    ]);

    // Estatística da comunidade: distribuição de todas as respostas já dadas
    const dist = await prisma.questionAttempt.groupBy({
      by: ['selected'],
      where: { questionId: question.id },
      _count: { _all: true },
    });
    const totalAnswers = dist.reduce((s, d) => s + d._count._all, 0);
    const distribution = Object.fromEntries(dist.map((d) => [d.selected, d._count._all]));
    const correctCount = question.answer ? distribution[question.answer] || 0 : 0;

    return success(res, {
      isCorrect,
      hasAnswer: Boolean(question.answer),
      correctAnswer: question.answer,
      explanation: question.explanation,
      isAnnulled: question.isAnnulled,
      review,
      community: {
        totalAnswers,
        distribution,
        accuracy: totalAnswers ? Math.round((correctCount / totalAnswers) * 100) : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /question-bank/:id/favorite ────────────────────────────────────────
const toggleFavorite = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const q = await prisma.question.findFirst({ where: { id: req.params.id, ...visibleWhere(userId) }, select: { id: true } });
    if (!q) return notFound(res, 'Questão não encontrada');

    const existing = await prisma.questionFavorite.findUnique({
      where: { userId_questionId: { userId, questionId: q.id } },
    });
    if (existing) await prisma.questionFavorite.delete({ where: { id: existing.id } });
    else await prisma.questionFavorite.create({ data: { userId, questionId: q.id } });
    return success(res, { isFavorite: !existing });
  } catch (err) {
    next(err);
  }
};

// ─── Comentários ─────────────────────────────────────────────────────────────
const listComments = async (req, res, next) => {
  try {
    const q = await prisma.question.findFirst({
      where: { id: req.params.id, ...visibleWhere(req.user.id) }, select: { id: true },
    });
    if (!q) return notFound(res, 'Questão não encontrada');
    const comments = await prisma.questionComment.findMany({
      where: { questionId: q.id },
      include: {
        user: { select: { id: true, name: true, avatar: true, role: true } },
        likes: { where: { userId: req.user.id }, select: { id: true } },
      },
      // Fixado pela equipe primeiro, depois os mais curtidos
      orderBy: [{ isPinned: 'desc' }, { likesCount: 'desc' }, { createdAt: 'asc' }],
      take: 200,
    });
    // "Mais útil": o mais curtido (com pelo menos 2 curtidas) quando a equipe não fixou nenhum
    const top = comments.some((c) => c.isPinned) ? null : comments.find((c) => c.likesCount >= 2);
    return success(res, comments.map(({ likes, ...c }) => ({ ...c, likedByMe: likes.length > 0, isTop: c.id === top?.id })));
  } catch (err) {
    next(err);
  }
};

const addComment = async (req, res, next) => {
  try {
    const body = String(req.body.body || '').trim();
    if (body.length < 2) return badRequest(res, 'Comentário vazio');
    if (body.length > 5000) return badRequest(res, 'Comentário muito longo (máx. 5000 caracteres)');

    const q = await prisma.question.findFirst({
      where: { id: req.params.id, ...visibleWhere(req.user.id) }, select: { id: true },
    });
    if (!q) return notFound(res, 'Questão não encontrada');

    const comment = await prisma.questionComment.create({
      data: { questionId: q.id, userId: req.user.id, body },
      include: { user: { select: { id: true, name: true, avatar: true, role: true } } },
    });
    return created(res, comment, 'Comentário publicado');
  } catch (err) {
    next(err);
  }
};

const deleteComment = async (req, res, next) => {
  try {
    const comment = await prisma.questionComment.findUnique({ where: { id: req.params.commentId } });
    if (!comment) return notFound(res, 'Comentário não encontrado');
    if (comment.userId !== req.user.id && !(await isAdminReq(req))) {
      return forbidden(res, 'Você só pode excluir seus comentários');
    }
    await prisma.questionComment.delete({ where: { id: comment.id } });
    return success(res, null, 'Comentário removido');
  } catch (err) {
    next(err);
  }
};

// POST /question-bank/comments/:commentId/like — curte/descurte
const toggleCommentLike = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const comment = await prisma.questionComment.findFirst({
      where: { id: req.params.commentId, question: visibleWhere(userId) },
      select: { id: true, userId: true },
    });
    if (!comment) return notFound(res, 'Comentário não encontrado');
    if (comment.userId === userId) return badRequest(res, 'Você não pode curtir o próprio comentário');

    const existing = await prisma.questionCommentLike.findUnique({
      where: { commentId_userId: { commentId: comment.id, userId } },
    });
    const [, updated] = await prisma.$transaction(existing
      ? [prisma.questionCommentLike.delete({ where: { id: existing.id } }),
        prisma.questionComment.update({ where: { id: comment.id }, data: { likesCount: { decrement: 1 } }, select: { likesCount: true } })]
      : [prisma.questionCommentLike.create({ data: { commentId: comment.id, userId } }),
        prisma.questionComment.update({ where: { id: comment.id }, data: { likesCount: { increment: 1 } }, select: { likesCount: true } })]);
    return success(res, { liked: !existing, likesCount: Math.max(0, updated.likesCount) });
  } catch (err) {
    next(err);
  }
};

// POST /question-bank/comments/:commentId/pin (ADMIN) — fixa como melhor comentário (um por questão)
const togglePinComment = async (req, res, next) => {
  try {
    const comment = await prisma.questionComment.findUnique({ where: { id: req.params.commentId } });
    if (!comment) return notFound(res, 'Comentário não encontrado');
    const pin = !comment.isPinned;
    await prisma.$transaction([
      ...(pin ? [prisma.questionComment.updateMany({ where: { questionId: comment.questionId, isPinned: true }, data: { isPinned: false } })] : []),
      prisma.questionComment.update({ where: { id: comment.id }, data: { isPinned: pin } }),
    ]);
    return success(res, { isPinned: pin }, pin ? 'Comentário fixado no topo' : 'Comentário desafixado');
  } catch (err) {
    next(err);
  }
};

// ─── Anotações de caneta ────────────────────────────────────────────────────
const MAX_ANNOTATION_BYTES = 400_000;

const getAnnotation = async (req, res, next) => {
  try {
    const a = await prisma.questionAnnotation.findUnique({
      where: { userId_questionId: { userId: req.user.id, questionId: req.params.id } },
    });
    return success(res, { strokes: a?.strokes ?? [] });
  } catch (err) {
    next(err);
  }
};

const saveAnnotation = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { strokes } = req.body;
    if (!Array.isArray(strokes)) return badRequest(res, 'Formato de anotação inválido');
    if (JSON.stringify(strokes).length > MAX_ANNOTATION_BYTES) {
      return badRequest(res, 'Anotação muito grande. Limpe alguns riscos e tente de novo.');
    }
    const q = await prisma.question.findFirst({ where: { id: req.params.id, ...visibleWhere(userId) }, select: { id: true } });
    if (!q) return notFound(res, 'Questão não encontrada');

    if (strokes.length === 0) {
      await prisma.questionAnnotation.deleteMany({ where: { userId, questionId: q.id } });
      return success(res, { strokes: [] });
    }
    await prisma.questionAnnotation.upsert({
      where: { userId_questionId: { userId, questionId: q.id } },
      create: { userId, questionId: q.id, strokes },
      update: { strokes },
    });
    return success(res, { saved: true });
  } catch (err) {
    next(err);
  }
};

// ─── GET /question-bank/review/due — revisões espaçadas do dia ─────────────
const reviewDue = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const active = { userId, mastered: false };

    const [due, dueCount, upcoming, inReview, mastered] = await Promise.all([
      prisma.questionReview.findMany({
        where: { ...active, nextReviewAt: { lte: now } },
        orderBy: [{ lapses: 'desc' }, { nextReviewAt: 'asc' }], // mais erradas primeiro
        take: limit,
        include: { question: { include: listInclude } },
      }),
      prisma.questionReview.count({ where: { ...active, nextReviewAt: { lte: now } } }),
      prisma.questionReview.count({ where: { ...active, nextReviewAt: { gt: now, lte: in7 } } }),
      prisma.questionReview.count({ where: active }),
      prisma.questionReview.count({ where: { userId, mastered: true } }),
    ]);

    // Só questões que o aluno ainda enxerga (pode ter sido despublicada)
    const visible = due.filter((r) => r.question.isPublic || r.question.userId === userId);
    const ctx = await userContext(req, visible.map((r) => r.questionId));
    return success(res, {
      counts: { due: dueCount, upcoming7: upcoming, inReview, mastered },
      questions: visible.map((r) => ({
        ...serialize(r.question, ctx),
        review: { interval: r.interval, repetitions: r.repetitions, lapses: r.lapses, nextReviewAt: r.nextReviewAt },
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Textos de apoio ────────────────────────────────────────────────────────
const textVisible = (userId) => ({ OR: [{ isPublic: true }, { userId }] });

const listTexts = async (req, res, next) => {
  try {
    const where = { AND: [textVisible(req.user.id)] };
    if (req.query.search) {
      const s = String(req.query.search).slice(0, 100);
      where.AND.push({ OR: [{ title: { contains: s } }, { body: { contains: s } }, { source: { contains: s } }] });
    }
    const rows = await prisma.questionText.findMany({
      where, orderBy: { updatedAt: 'desc' }, take: 30,
      include: { _count: { select: { questions: true } } },
    });
    return success(res, rows.map(({ _count, body, ...t }) => ({ ...t, preview: body.slice(0, 220), questions: _count.questions })));
  } catch (err) { next(err); }
};

const getText = async (req, res, next) => {
  try {
    const t = await prisma.questionText.findFirst({ where: { id: req.params.textId, ...textVisible(req.user.id) } });
    if (!t) return notFound(res, 'Texto não encontrado');
    return success(res, t);
  } catch (err) { next(err); }
};

function textData(body, isAdmin) {
  const text = String(body.body ?? '').trim();
  if (text.length < 10) return { error: 'O texto de apoio está vazio ou muito curto' };
  return {
    data: {
      title: body.title ? String(body.title).slice(0, 191) : null,
      body: text.slice(0, 60000),
      source: body.source ? String(body.source).slice(0, 2000) : null,
      ...(body.isPublic !== undefined && { isPublic: isAdmin && Boolean(body.isPublic) }),
    },
  };
}

const createText = async (req, res, next) => {
  try {
    const isAdmin = await isAdminReq(req);
    const { data, error } = textData(req.body, isAdmin);
    if (error) return badRequest(res, error);
    const t = await prisma.questionText.create({ data: { ...data, isPublic: isAdmin && Boolean(req.body.isPublic), userId: req.user.id } });
    return created(res, t, 'Texto de apoio criado');
  } catch (err) { next(err); }
};

const updateText = async (req, res, next) => {
  try {
    const t = await prisma.questionText.findUnique({ where: { id: req.params.textId } });
    if (!t) return notFound(res, 'Texto não encontrado');
    const isAdmin = await isAdminReq(req);
    if (t.userId !== req.user.id && !isAdmin) return forbidden(res, 'Você só pode editar seus textos');
    const { data, error } = textData({ body: t.body, ...req.body }, isAdmin);
    if (error) return badRequest(res, error);
    return success(res, await prisma.questionText.update({ where: { id: t.id }, data }), 'Texto atualizado');
  } catch (err) { next(err); }
};

// ─── Reportes ────────────────────────────────────────────────────────────────
const REPORT_TYPES = ['ERRO_GABARITO', 'ERRO_ENUNCIADO', 'DESATUALIZADA', 'PEDIDO_ANULACAO', 'CLASSIFICACAO_ERRADA', 'OUTRO'];

const createReport = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const type = String(req.body.type || '');
    const message = String(req.body.message || '').trim();
    if (!REPORT_TYPES.includes(type)) return badRequest(res, 'Escolha o tipo do problema');
    if (message.length < 10) return badRequest(res, 'Descreva o problema com um pouco mais de detalhe');
    const q = await prisma.question.findFirst({ where: { id: req.params.id, ...visibleWhere(userId) }, select: { id: true } });
    if (!q) return notFound(res, 'Questão não encontrada');
    const open = await prisma.questionReport.count({ where: { questionId: q.id, userId, status: { in: ['ABERTO', 'EM_ANALISE'] } } });
    if (open >= 3) return badRequest(res, 'Você já tem reportes em aberto para esta questão. Aguarde a análise.');
    const r = await prisma.questionReport.create({ data: { questionId: q.id, userId, type, message: message.slice(0, 5000) } });
    return created(res, r, 'Obrigado! Sua solicitação foi enviada para a equipe.');
  } catch (err) { next(err); }
};

const myReports = async (req, res, next) => {
  try {
    const rows = await prisma.questionReport.findMany({
      where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50,
      include: { question: { select: { id: true, statement: true, discipline: true } } },
    });
    return success(res, rows);
  } catch (err) { next(err); }
};

// ─── GET /question-bank/stats/me ─────────────────────────────────────────────
const myStats = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    since.setHours(0, 0, 0, 0);

    const [byDiscipline, byBanca, daily, totals, distinctSolved] = await Promise.all([
      prisma.$queryRaw`
        SELECT COALESCE(q.discipline, 'Sem disciplina') AS name,
               COUNT(*) AS total, SUM(qa.isCorrect) AS correct
        FROM question_attempts qa JOIN questions q ON q.id = qa.questionId
        WHERE qa.userId = ${userId}
        GROUP BY name ORDER BY total DESC LIMIT 30`,
      prisma.$queryRaw`
        SELECT COALESCE(q.banca, 'Sem banca') AS name,
               COUNT(*) AS total, SUM(qa.isCorrect) AS correct
        FROM question_attempts qa JOIN questions q ON q.id = qa.questionId
        WHERE qa.userId = ${userId}
        GROUP BY name ORDER BY total DESC LIMIT 20`,
      prisma.$queryRaw`
        SELECT DATE(qa.createdAt) AS day, COUNT(*) AS total, SUM(qa.isCorrect) AS correct
        FROM question_attempts qa
        WHERE qa.userId = ${userId} AND qa.createdAt >= ${since}
        GROUP BY day ORDER BY day`,
      prisma.questionAttempt.groupBy({ by: ['isCorrect'], where: { userId }, _count: { _all: true } }),
      prisma.questionAttempt.groupBy({ by: ['questionId'], where: { userId } }).then((r) => r.length),
    ]);

    const toRow = (r) => {
      const total = Number(r.total);
      const correct = Number(r.correct || 0);
      return { name: r.name, total, correct, accuracy: total ? Math.round((correct / total) * 100) : 0 };
    };
    const correct = totals.find((t) => t.isCorrect)?._count._all || 0;
    const wrong = totals.find((t) => !t.isCorrect)?._count._all || 0;

    return success(res, {
      total: correct + wrong,
      correct,
      wrong,
      accuracy: correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0,
      distinctSolved,
      byDiscipline: byDiscipline.map(toRow),
      byBanca: byBanca.map(toRow),
      daily: daily.map((d) => ({
        day: new Date(d.day).toISOString().slice(0, 10),
        total: Number(d.total),
        correct: Number(d.correct || 0),
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /question-bank/admin/overview (ADMIN) ───────────────────────────────
const adminOverview = async (req, res, next) => {
  try {
    const [publicCount, privateCount, attempts, comments, users, withoutAnswer, withoutExplanation, withoutAssunto] = await Promise.all([
      prisma.question.count({ where: { isPublic: true } }),
      prisma.question.count({ where: { isPublic: false } }),
      prisma.questionAttempt.count(),
      prisma.questionComment.count(),
      prisma.user.count(),
      prisma.question.count({ where: { isPublic: true, answer: null } }),
      prisma.question.count({ where: { isPublic: true, explanation: null } }),
      prisma.question.count({ where: { isPublic: true, assuntoId: null } }),
    ]);
    return success(res, { publicCount, privateCount, attempts, comments, users, withoutAnswer, withoutExplanation, withoutAssunto });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  list, filters, facets, incidence, listAssuntos, getOne, create, update, remove, bulkCreate,
  answer, toggleFavorite, listComments, addComment, deleteComment, toggleCommentLike, togglePinComment,
  getAnnotation, saveAnnotation, reviewDue,
  listTexts, getText, createText, updateText, createReport, myReports, REPORT_TYPES,
  myStats, adminOverview,
  // Reaproveitados pelo controller de cadernos
  helpers: { buildWhere, serialize, userContext, visibleWhere, listInclude },
};
