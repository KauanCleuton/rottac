// Lei seca: leitura de leis por artigo, com marca-texto do aluno e as questões que cobram cada artigo.
const prisma = require('../utils/prisma');
const { success, created, notFound, badRequest } = require('../utils/response');
const { loadRole } = require('../middlewares/role.middleware');
const taxonomy = require('../services/taxonomy');
const { parseLaw, citedArticles } = require('../services/lawParser');
const { helpers } = require('./questionBank.controller');

const MAX_TEXT = 3_000_000;
const MARK_COLORS = ['amarelo', 'verde', 'azul', 'rosa'];

const isAdmin = async (req) => (await loadRole(req)) === 'ADMIN';
const cleanStr = (v, max = 191) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
const norm = (s) => taxonomy.norm(s);

async function findLaw(req, id) {
  const admin = await isAdmin(req);
  return prisma.law.findFirst({ where: { id, ...(admin ? {} : { isPublished: true }) } });
}

// GET /laws
const list = async (req, res, next) => {
  try {
    const admin = await isAdmin(req);
    const laws = await prisma.law.findMany({
      where: admin ? {} : { isPublished: true },
      orderBy: { title: 'asc' },
      include: { _count: { select: { articles: true } } },
    });
    const links = laws.length ? await prisma.$queryRaw`
      SELECT a.lawId AS lawId, COUNT(DISTINCT l.questionId) AS questions
      FROM question_law_links l JOIN law_articles a ON a.id = l.articleId
      GROUP BY a.lawId` : [];
    const byLaw = new Map(links.map((r) => [r.lawId, Number(r.questions)]));
    return success(res, laws.map(({ _count, ...l }) => ({ ...l, articles: _count.articles, questions: byLaw.get(l.id) || 0 })));
  } catch (err) { next(err); }
};

// GET /laws/:id — artigos + nº de questões em cada um + marcações do aluno
const getOne = async (req, res, next) => {
  try {
    const law = await findLaw(req, req.params.id);
    if (!law) return notFound(res, 'Lei não encontrada');
    const [articles, counts, highlights] = await Promise.all([
      prisma.lawArticle.findMany({ where: { lawId: law.id }, orderBy: { position: 'asc' } }),
      prisma.$queryRaw`
        SELECT l.articleId AS id, COUNT(*) AS total
        FROM question_law_links l JOIN law_articles a ON a.id = l.articleId JOIN questions q ON q.id = l.questionId
        WHERE a.lawId = ${law.id} AND (q.isPublic = true OR q.userId = ${req.user.id})
        GROUP BY l.articleId`,
      prisma.lawHighlight.findMany({
        where: { userId: req.user.id, article: { lawId: law.id } },
        select: { articleId: true, marks: true, note: true },
      }),
    ]);
    const countBy = new Map(counts.map((c) => [c.id, Number(c.total)]));
    return success(res, {
      ...law,
      articles: articles.map((a) => ({ ...a, questionCount: countBy.get(a.id) || 0 })),
      highlights: Object.fromEntries(highlights.map((h) => [h.articleId, { marks: h.marks, note: h.note }])),
    });
  } catch (err) { next(err); }
};

// GET /laws/:id/articles/:articleId/questions
const articleQuestions = async (req, res, next) => {
  try {
    const law = await findLaw(req, req.params.id);
    if (!law) return notFound(res, 'Lei não encontrada');
    const userId = req.user.id;
    const links = await prisma.questionLawLink.findMany({
      where: { articleId: req.params.articleId, article: { lawId: law.id }, question: helpers.visibleWhere(userId) },
      include: { question: { include: helpers.listInclude } },
      orderBy: [{ question: { year: 'desc' } }, { createdAt: 'asc' }],
      take: 200,
    });
    const questions = links.map((l) => l.question);
    const ctx = await helpers.userContext(req, questions.map((q) => q.id));
    return success(res, questions.map((q, i) => ({ ...helpers.serialize(q, ctx), linkAuto: links[i].auto })));
  } catch (err) { next(err); }
};

// PUT /laws/:id/articles/:articleId/highlight  { marks: [{ start, end, color }], note }
const saveHighlight = async (req, res, next) => {
  try {
    const article = await prisma.lawArticle.findFirst({
      where: { id: req.params.articleId, lawId: req.params.id, law: (await isAdmin(req)) ? {} : { isPublished: true } },
      select: { id: true, text: true },
    });
    if (!article) return notFound(res, 'Artigo não encontrado');
    const len = article.text.length;
    const marks = (Array.isArray(req.body.marks) ? req.body.marks : [])
      .map((m) => ({ start: parseInt(m?.start, 10), end: parseInt(m?.end, 10), color: MARK_COLORS.includes(m?.color) ? m.color : 'amarelo' }))
      .filter((m) => Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.end <= len && m.end > m.start)
      .slice(0, 300);
    const note = req.body.note ? String(req.body.note).slice(0, 5000) : null;
    const key = { userId_articleId: { userId: req.user.id, articleId: article.id } };
    if (!marks.length && !note) {
      await prisma.lawHighlight.deleteMany({ where: { userId: req.user.id, articleId: article.id } });
      return success(res, { marks: [], note: null });
    }
    const h = await prisma.lawHighlight.upsert({
      where: key,
      create: { userId: req.user.id, articleId: article.id, marks, note },
      update: { marks, note },
    });
    return success(res, { marks: h.marks, note: h.note });
  } catch (err) { next(err); }
};

// ─── Admin ───────────────────────────────────────────────────────────────────

async function lawData(body, partial) {
  const data = {};
  if (!partial || body.title !== undefined) {
    data.title = cleanStr(body.title);
    if (!data.title) return { error: 'Informe o nome da lei' };
  }
  if (!partial || body.shortName !== undefined) {
    data.shortName = cleanStr(body.shortName, 60) || (data.title ? data.title.slice(0, 60) : undefined);
    if (partial && !data.shortName) return { error: 'Informe a sigla' };
  }
  if (body.aliases !== undefined) {
    data.aliases = String(body.aliases || '').split(/[|\n]/).map((a) => a.trim()).filter(Boolean).slice(0, 30).join('|') || null;
  }
  if (body.description !== undefined) data.description = body.description ? String(body.description).slice(0, 5000) : null;
  if (body.isPublished !== undefined) data.isPublished = Boolean(body.isPublished);
  if (body.assuntoId !== undefined) {
    const tree = await taxonomy.getTree();
    const id = body.assuntoId ? parseInt(body.assuntoId, 10) : null;
    if (id && !tree.byId.has(id)) return { error: 'Matéria inválida' };
    data.assuntoId = id;
  }
  return { data };
}

// Substitui o texto mantendo os artigos que já existiam (mesmo número na mesma ordem),
// para não perder vínculos de questões nem marcações dos alunos
async function syncArticles(lawId, text) {
  const parsed = parseLaw(text);
  if (!parsed.length) return { error: 'Não encontrei artigos no texto (cada artigo deve começar com "Art. 1º", "Art. 2º"...)' };
  const existing = await prisma.lawArticle.findMany({ where: { lawId }, select: { id: true, number: true }, orderBy: { position: 'asc' } });
  const seen = {};
  const keyOf = (n) => { seen[n] = (seen[n] || 0) + 1; return `${n}#${seen[n]}`; };
  const byKey = new Map(existing.map((a) => [keyOf(a.number), a.id]));
  for (const k of Object.keys(seen)) delete seen[k];

  const keep = new Set();
  const toCreate = [];
  const updates = [];
  parsed.forEach((a, position) => {
    const id = byKey.get(keyOf(a.number));
    if (id) { keep.add(id); updates.push(prisma.lawArticle.update({ where: { id }, data: { text: a.text, heading: a.heading, position } })); }
    else toCreate.push({ lawId, number: a.number, heading: a.heading, text: a.text, position });
  });
  const stale = existing.filter((a) => !keep.has(a.id)).map((a) => a.id);
  for (let i = 0; i < updates.length; i += 200) await prisma.$transaction(updates.slice(i, i + 200));
  if (stale.length) await prisma.lawArticle.deleteMany({ where: { id: { in: stale } } });
  for (let i = 0; i < toCreate.length; i += 500) await prisma.lawArticle.createMany({ data: toCreate.slice(i, i + 500) });
  return { total: parsed.length, created: toCreate.length, updated: updates.length, removed: stale.length };
}

// POST /laws/preview  { text } — quantos artigos o texto rende (admin confere antes de salvar)
const preview = async (req, res, next) => {
  try {
    const text = String(req.body.text || '');
    if (text.length > MAX_TEXT) return badRequest(res, 'Texto muito longo');
    const parsed = parseLaw(text);
    return success(res, {
      total: parsed.length,
      sample: parsed.slice(0, 5).map((a) => ({ ...a, text: a.text.slice(0, 300) })),
      last: parsed.length ? { ...parsed[parsed.length - 1], text: parsed[parsed.length - 1].text.slice(0, 300) } : null,
    });
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const { data, error } = await lawData(req.body, false);
    if (error) return badRequest(res, error);
    const text = String(req.body.text || '');
    if (text.length > MAX_TEXT) return badRequest(res, 'Texto muito longo');
    if (!parseLaw(text).length) return badRequest(res, 'Cole o texto da lei com os artigos ("Art. 1º ...")');
    const law = await prisma.law.create({ data });
    const sync = await syncArticles(law.id, text);
    const linked = req.body.autoLink === false ? null : await autoLinkLaw(law.id);
    return created(res, { ...law, articles: sync.total, linked }, `Lei criada com ${sync.total} artigos`);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const law = await prisma.law.findUnique({ where: { id: req.params.id } });
    if (!law) return notFound(res, 'Lei não encontrada');
    const { data, error } = await lawData(req.body, true);
    if (error) return badRequest(res, error);
    const updated = await prisma.law.update({ where: { id: law.id }, data });
    let sync = null;
    if (req.body.text) {
      if (String(req.body.text).length > MAX_TEXT) return badRequest(res, 'Texto muito longo');
      sync = await syncArticles(law.id, String(req.body.text));
      if (sync.error) return badRequest(res, sync.error);
    }
    return success(res, { ...updated, sync }, 'Lei atualizada');
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { count } = await prisma.law.deleteMany({ where: { id: req.params.id } });
    if (!count) return notFound(res, 'Lei não encontrada');
    return success(res, null, 'Lei excluída');
  } catch (err) { next(err); }
};

// Vincula questões públicas que citam "art. N" a esta lei. Só conta a questão se ela for da matéria
// da lei ou citar a lei pelo nome/sigla (evita ligar "art. 5º" do CP à Constituição).
async function autoLinkLaw(lawId) {
  const law = await prisma.law.findUnique({ where: { id: lawId } });
  const articles = await prisma.lawArticle.findMany({ where: { lawId }, select: { id: true, number: true }, orderBy: { position: 'asc' } });
  const byNumber = new Map();
  for (const a of articles) if (!byNumber.has(a.number)) byNumber.set(a.number, a.id); // repetidos (ex.: ADCT): o primeiro

  const names = [law.shortName, law.title, ...(law.aliases ? law.aliases.split('|') : [])].map(norm).filter((n) => n.length >= 2);
  const tree = await taxonomy.getTree();
  const subtree = law.assuntoId ? new Set(taxonomy.descendantIds(tree, law.assuntoId)) : null;
  const mentions = (text) => {
    const t = norm(text);
    return names.some((n) => (n.length <= 4 ? new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9]|$)`).test(t) : t.includes(n)));
  };

  await prisma.questionLawLink.deleteMany({ where: { auto: true, article: { lawId } } });
  const links = [];
  const questionIds = new Set();
  let cursor;
  for (;;) {
    const batch = await prisma.question.findMany({
      where: { isPublic: true, OR: [{ statement: { contains: 'art' } }, { explanation: { contains: 'art' } }] },
      select: { id: true, statement: true, explanation: true, optionA: true, optionB: true, optionC: true, optionD: true, optionE: true, assuntoId: true },
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) break;
    cursor = batch[batch.length - 1].id;
    for (const q of batch) {
      const text = [q.statement, q.explanation, q.optionA, q.optionB, q.optionC, q.optionD, q.optionE].filter(Boolean).join('\n');
      const inSubject = subtree && q.assuntoId && subtree.has(q.assuntoId);
      if (!inSubject && !mentions(text)) continue;
      for (const n of citedArticles(text)) {
        const articleId = byNumber.get(n);
        if (articleId) { links.push({ questionId: q.id, articleId, auto: true }); questionIds.add(q.id); }
      }
    }
    if (batch.length < 1000) break;
  }
  for (let i = 0; i < links.length; i += 1000) {
    await prisma.questionLawLink.createMany({ data: links.slice(i, i + 1000), skipDuplicates: true });
  }
  return { links: links.length, questions: questionIds.size };
}

const autoLink = async (req, res, next) => {
  try {
    const law = await prisma.law.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!law) return notFound(res, 'Lei não encontrada');
    const r = await autoLinkLaw(law.id);
    return success(res, r, `${r.questions} questões vinculadas automaticamente`);
  } catch (err) { next(err); }
};

// POST /laws/:id/articles/:articleId/questions  { questionId } — vínculo manual
const linkQuestion = async (req, res, next) => {
  try {
    const article = await prisma.lawArticle.findFirst({ where: { id: req.params.articleId, lawId: req.params.id }, select: { id: true } });
    if (!article) return notFound(res, 'Artigo não encontrado');
    const q = await prisma.question.findUnique({ where: { id: String(req.body.questionId || '') }, select: { id: true } });
    if (!q) return notFound(res, 'Questão não encontrada');
    await prisma.questionLawLink.upsert({
      where: { questionId_articleId: { questionId: q.id, articleId: article.id } },
      create: { questionId: q.id, articleId: article.id, auto: false },
      update: { auto: false }, // vínculo confirmado à mão não some na próxima vinculação automática
    });
    return success(res, null, 'Questão vinculada ao artigo');
  } catch (err) { next(err); }
};

const unlinkQuestion = async (req, res, next) => {
  try {
    await prisma.questionLawLink.deleteMany({
      where: { questionId: req.params.questionId, articleId: req.params.articleId, article: { lawId: req.params.id } },
    });
    return success(res, null, 'Vínculo removido');
  } catch (err) { next(err); }
};

module.exports = {
  list, getOne, articleQuestions, saveHighlight,
  preview, create, update, remove, autoLink, linkQuestion, unlinkQuestion,
};
