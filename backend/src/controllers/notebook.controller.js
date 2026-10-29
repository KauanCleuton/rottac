const prisma = require('../utils/prisma');
const { success, created, notFound, badRequest, error } = require('../utils/response');
const { helpers } = require('./questionBank.controller');
const { diagnose } = require('../services/notebookDiagnosis');
const { checkNotebookLimit } = require('../middlewares/plan.middleware');

const { buildWhere, serialize, userContext, visibleWhere, listInclude } = helpers;
const MAX_QUESTIONS = 300;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

const cleanName = (v) => String(v ?? '').trim().slice(0, 120);

// Última tentativa de cada questão dentro de cada caderno: Map<notebookId, Map<questionId, attempt>>
async function lastAttemptsByNotebook(userId, notebookIds) {
  if (!notebookIds.length) return new Map();
  const rows = await prisma.questionAttempt.findMany({
    where: { userId, notebookId: { in: notebookIds } },
    orderBy: { createdAt: 'desc' },
    select: { notebookId: true, questionId: true, isCorrect: true, selected: true, timeSpent: true, createdAt: true },
  });
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.notebookId)) out.set(r.notebookId, new Map());
    const m = out.get(r.notebookId);
    if (!m.has(r.questionId)) m.set(r.questionId, r);
  }
  return out;
}

const findOwnNotebook = (id, userId) => prisma.questionNotebook.findFirst({ where: { id, userId } });

async function ensureOwnFolder(folderId, userId) {
  if (!folderId) return true;
  return Boolean(await prisma.questionNotebookFolder.findFirst({ where: { id: folderId, userId }, select: { id: true } }));
}

// ─── Pastas ──────────────────────────────────────────────────────────────────

const listFolders = async (req, res, next) => {
  try {
    const folders = await prisma.questionNotebookFolder.findMany({
      where: { userId: req.user.id },
      include: { _count: { select: { notebooks: true } } },
      orderBy: { name: 'asc' },
    });
    return success(res, folders.map(({ _count, ...f }) => ({ ...f, notebookCount: _count.notebooks })));
  } catch (err) { next(err); }
};

const createFolder = async (req, res, next) => {
  try {
    const name = cleanName(req.body.name);
    if (!name) return badRequest(res, 'Dê um nome à pasta');
    const color = COLOR_RE.test(req.body.color) ? req.body.color : undefined;
    const folder = await prisma.questionNotebookFolder.create({ data: { userId: req.user.id, name, ...(color && { color }) } });
    return created(res, { ...folder, notebookCount: 0 }, 'Pasta criada');
  } catch (err) { next(err); }
};

const updateFolder = async (req, res, next) => {
  try {
    const folder = await prisma.questionNotebookFolder.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!folder) return notFound(res, 'Pasta não encontrada');
    const data = {};
    if (req.body.name !== undefined) {
      data.name = cleanName(req.body.name);
      if (!data.name) return badRequest(res, 'Dê um nome à pasta');
    }
    if (COLOR_RE.test(req.body.color || '')) data.color = req.body.color;
    const updated = await prisma.questionNotebookFolder.update({ where: { id: folder.id }, data });
    return success(res, updated, 'Pasta atualizada');
  } catch (err) { next(err); }
};

// Excluir a pasta não apaga os cadernos: eles ficam "sem pasta"
const deleteFolder = async (req, res, next) => {
  try {
    const folder = await prisma.questionNotebookFolder.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!folder) return notFound(res, 'Pasta não encontrada');
    await prisma.questionNotebook.updateMany({ where: { folderId: folder.id }, data: { folderId: null } });
    await prisma.questionNotebookFolder.delete({ where: { id: folder.id } });
    return success(res, null, 'Pasta removida (os cadernos foram mantidos)');
  } catch (err) { next(err); }
};

// ─── Cadernos ────────────────────────────────────────────────────────────────

// GET /notebooks?folderId=<id>|none
const list = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const where = { userId };
    if (req.query.folderId === 'none') where.folderId = null;
    else if (req.query.folderId) where.folderId = String(req.query.folderId);

    const notebooks = await prisma.questionNotebook.findMany({
      where,
      include: {
        folder: { select: { id: true, name: true, color: true } },
        items: { select: { questionId: true, question: { select: { discipline: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const attempts = await lastAttemptsByNotebook(userId, notebooks.map((n) => n.id));

    return success(res, notebooks.map(({ items, ...n }) => {
      const last = attempts.get(n.id) || new Map();
      const ids = new Set(items.map((i) => i.questionId));
      const answered = [...last.values()].filter((a) => ids.has(a.questionId));
      const correct = answered.filter((a) => a.isCorrect).length;
      const disciplines = [...new Set(items.map((i) => i.question.discipline).filter(Boolean))];
      return {
        ...n,
        total: items.length,
        answered: answered.length,
        correct,
        accuracy: answered.length ? Math.round((correct / answered.length) * 100) : null,
        disciplines: disciplines.slice(0, 3),
      };
    }));
  } catch (err) { next(err); }
};

// POST /notebooks  { name, folderId?, description?, questionIds?: [], filters?: {...}, limit?, order? }
const create = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const name = cleanName(req.body.name);
    if (!name) return badRequest(res, 'Dê um nome ao caderno');
    if (!(await ensureOwnFolder(req.body.folderId, userId))) return badRequest(res, 'Pasta inválida');
    if (!(await checkNotebookLimit(req, res))) return;

    let questionIds = [];
    if (Array.isArray(req.body.questionIds) && req.body.questionIds.length) {
      const visible = await prisma.question.findMany({
        where: { id: { in: req.body.questionIds.map(String).slice(0, MAX_QUESTIONS) }, ...visibleWhere(userId) },
        select: { id: true },
      });
      const ok = new Set(visible.map((q) => q.id));
      questionIds = req.body.questionIds.map(String).filter((id) => ok.has(id));
    } else if (req.body.filters) {
      const limit = Math.min(MAX_QUESTIONS, Math.max(1, parseInt(req.body.limit, 10) || 30));
      const where = buildWhere(req.body.filters, userId);
      if (req.body.order === 'random') {
        const ids = await prisma.question.findMany({ where, select: { id: true }, take: 5000 });
        questionIds = ids.map((r) => r.id).sort(() => Math.random() - 0.5).slice(0, limit);
      } else {
        const rows = await prisma.question.findMany({ where, select: { id: true }, orderBy: [{ year: 'desc' }, { createdAt: 'desc' }], take: limit });
        questionIds = rows.map((r) => r.id);
      }
      if (!questionIds.length) return badRequest(res, 'Nenhuma questão encontrada com esses filtros');
    }

    const notebook = await prisma.questionNotebook.create({
      data: {
        userId, name,
        folderId: req.body.folderId || null,
        description: req.body.description ? String(req.body.description).slice(0, 2000) : null,
        items: { create: questionIds.map((questionId, position) => ({ questionId, position })) },
      },
    });
    return created(res, { ...notebook, total: questionIds.length }, `Caderno criado com ${questionIds.length} questões`);
  } catch (err) { next(err); }
};

// GET /notebooks/:id  — caderno + questões (com a última resposta dentro dele)
const getOne = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const notebook = await prisma.questionNotebook.findFirst({
      where: { id: req.params.id, userId },
      include: {
        folder: { select: { id: true, name: true, color: true } },
        items: { orderBy: { position: 'asc' }, include: { question: { include: listInclude } } },
      },
    });
    if (!notebook) return notFound(res, 'Caderno não encontrado');

    const questions = notebook.items.map((i) => i.question);
    const ctx = await userContext(req, questions.map((q) => q.id));
    const last = (await lastAttemptsByNotebook(userId, [notebook.id])).get(notebook.id) || new Map();

    const { items, ...rest } = notebook;
    return success(res, {
      ...rest,
      questions: questions.map((q) => {
        const a = last.get(q.id);
        return {
          ...serialize(q, ctx),
          notebookAttempt: a ? { selected: a.selected, isCorrect: a.isCorrect, createdAt: a.createdAt } : null,
        };
      }),
    });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const nb = await findOwnNotebook(req.params.id, req.user.id);
    if (!nb) return notFound(res, 'Caderno não encontrado');
    const data = {};
    if (req.body.name !== undefined) {
      data.name = cleanName(req.body.name);
      if (!data.name) return badRequest(res, 'Dê um nome ao caderno');
    }
    if (req.body.description !== undefined) data.description = req.body.description ? String(req.body.description).slice(0, 2000) : null;
    if (req.body.folderId !== undefined) {
      if (!(await ensureOwnFolder(req.body.folderId, req.user.id))) return badRequest(res, 'Pasta inválida');
      data.folderId = req.body.folderId || null;
    }
    const updated = await prisma.questionNotebook.update({ where: { id: nb.id }, data });
    return success(res, updated, 'Caderno atualizado');
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const nb = await findOwnNotebook(req.params.id, req.user.id);
    if (!nb) return notFound(res, 'Caderno não encontrado');
    // As tentativas continuam no histórico do aluno (notebookId vira null)
    await prisma.questionNotebook.delete({ where: { id: nb.id } });
    return success(res, null, 'Caderno excluído');
  } catch (err) { next(err); }
};

// POST /notebooks/:id/questions { questionIds: [] }
const addQuestions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const nb = await findOwnNotebook(req.params.id, userId);
    if (!nb) return notFound(res, 'Caderno não encontrado');
    const ids = Array.isArray(req.body.questionIds) ? req.body.questionIds.map(String).slice(0, MAX_QUESTIONS) : [];
    if (!ids.length) return badRequest(res, 'Nenhuma questão informada');

    const [visible, existing, count] = await Promise.all([
      prisma.question.findMany({ where: { id: { in: ids }, ...visibleWhere(userId) }, select: { id: true } }),
      prisma.notebookQuestion.findMany({ where: { notebookId: nb.id, questionId: { in: ids } }, select: { questionId: true } }),
      prisma.notebookQuestion.count({ where: { notebookId: nb.id } }),
    ]);
    if (count >= MAX_QUESTIONS) return badRequest(res, `Um caderno comporta até ${MAX_QUESTIONS} questões`);
    const have = new Set(existing.map((e) => e.questionId));
    const toAdd = visible.map((q) => q.id).filter((id) => !have.has(id)).slice(0, MAX_QUESTIONS - count);
    if (toAdd.length) {
      await prisma.notebookQuestion.createMany({ data: toAdd.map((questionId, i) => ({ notebookId: nb.id, questionId, position: count + i })) });
      await prisma.questionNotebook.update({ where: { id: nb.id }, data: { updatedAt: new Date() } });
    }
    return success(res, { added: toAdd.length, alreadyIn: have.size }, toAdd.length ? `${toAdd.length} questão(ões) adicionada(s)` : 'A questão já está no caderno');
  } catch (err) { next(err); }
};

const removeQuestion = async (req, res, next) => {
  try {
    const nb = await findOwnNotebook(req.params.id, req.user.id);
    if (!nb) return notFound(res, 'Caderno não encontrado');
    await prisma.notebookQuestion.deleteMany({ where: { notebookId: nb.id, questionId: req.params.questionId } });
    return success(res, null, 'Questão removida do caderno');
  } catch (err) { next(err); }
};

// POST /notebooks/:id/reset — recomeça o caderno (as respostas seguem no histórico geral)
const reset = async (req, res, next) => {
  try {
    const nb = await findOwnNotebook(req.params.id, req.user.id);
    if (!nb) return notFound(res, 'Caderno não encontrado');
    await prisma.questionAttempt.updateMany({ where: { notebookId: nb.id, userId: req.user.id }, data: { notebookId: null } });
    return success(res, null, 'Caderno zerado. Bons estudos!');
  } catch (err) { next(err); }
};

// ─── Diagnóstico ─────────────────────────────────────────────────────────────

async function loadForDiagnosis(notebookId, userId) {
  const nb = await prisma.questionNotebook.findFirst({
    where: { id: notebookId, userId },
    include: { items: { orderBy: { position: 'asc' }, include: { question: true } } },
  });
  if (!nb) return null;
  const last = (await lastAttemptsByNotebook(userId, [nb.id])).get(nb.id) || new Map();
  const items = nb.items.map((i) => ({ question: i.question, attempt: last.get(i.questionId) || null }));
  return { nb, items };
}

const diagnosis = async (req, res, next) => {
  try {
    const data = await loadForDiagnosis(req.params.id, req.user.id);
    if (!data) return notFound(res, 'Caderno não encontrado');
    return success(res, diagnose(data.items, { notebookName: data.nb.name }));
  } catch (err) { next(err); }
};

// ─── GET /notebooks/:id/print — questões completas (com gabarito) para o PDF ─
const printData = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const nb = await prisma.questionNotebook.findFirst({
      where: { id: req.params.id, userId },
      include: {
        folder: { select: { name: true } },
        items: { orderBy: { position: 'asc' }, include: { question: { include: { text: true } } } },
      },
    });
    if (!nb) return notFound(res, 'Caderno não encontrado');
    const last = (await lastAttemptsByNotebook(userId, [nb.id])).get(nb.id) || new Map();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return success(res, {
      name: nb.name,
      description: nb.description,
      folder: nb.folder?.name || null,
      student: user?.name,
      generatedAt: new Date(),
      questions: nb.items.map(({ question: q }, i) => ({
        number: i + 1,
        id: q.id,
        type: q.type,
        statement: q.statement,
        options: LETTERS.filter((l) => q[`option${l}`]).map((l) => ({ letter: l, text: q[`option${l}`] })),
        answer: q.answer,
        explanation: q.explanation,
        discipline: q.discipline, topic: q.topic, banca: q.banca, orgao: q.orgao, cargo: q.cargo, year: q.year,
        isAnnulled: q.isAnnulled,
        text: q.text ? { id: q.text.id, title: q.text.title, body: q.text.body, source: q.text.source } : null,
        myAnswer: last.get(q.id)?.selected || null,
        myResult: last.has(q.id) ? last.get(q.id).isCorrect : null,
      })),
    });
  } catch (err) { next(err); }
};

const activePlan = (userId) =>
  prisma.studyPlan.findFirst({ where: { userId, isActive: true }, orderBy: { createdAt: 'desc' } });

const daysFromNow = (days, hour = 9) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};

function correctText(q) {
  if (!q.answer) return 'Questão sem gabarito cadastrado.';
  if (q.type === 'CERTO_ERRADO') return `Gabarito: ${q.answer === 'C' ? 'CERTO' : 'ERRADO'}`;
  return `Gabarito: ${q.answer}) ${q[`option${q.answer}`] || ''}`.trim();
}

// POST /notebooks/:id/actions/flashcards — cada questão errada vira um flashcard
const actionFlashcards = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const data = await loadForDiagnosis(req.params.id, userId);
    if (!data) return notFound(res, 'Caderno não encontrado');
    const wrong = data.items.filter((i) => i.attempt && !i.attempt.isCorrect).map((i) => i.question);
    if (!wrong.length) return badRequest(res, 'Nenhuma questão errada neste caderno');

    const folderName = `Erros · ${data.nb.name}`.slice(0, 120);
    const folder = (await prisma.flashcardFolder.findFirst({ where: { userId, name: folderName } }))
      || (await prisma.flashcardFolder.create({ data: { userId, name: folderName, color: '#EF4444', icon: 'error' } }));

    const existing = new Set((await prisma.flashcard.findMany({ where: { folderId: folder.id }, select: { front: true } })).map((f) => f.front));
    const ownSubjects = new Set((await prisma.subject.findMany({ where: { userId }, select: { id: true } })).map((s) => s.id));

    const cards = wrong.map((q) => {
      const options = q.type === 'MULTIPLA_ESCOLHA'
        ? '\n\n' + LETTERS.filter((l) => q[`option${l}`]).map((l) => `${l}) ${q[`option${l}`]}`).join('\n')
        : '\n\n(Certo ou Errado?)';
      const front = `${q.statement}${options}`.slice(0, 8000);
      const back = [correctText(q), q.explanation].filter(Boolean).join('\n\n').slice(0, 8000);
      return { userId, folderId: folder.id, front, back, subjectId: ownSubjects.has(q.subjectId) ? q.subjectId : null };
    }).filter((c) => !existing.has(c.front));

    if (cards.length) await prisma.flashcard.createMany({ data: cards });
    return success(res, { created: cards.length, skipped: wrong.length - cards.length, folderId: folder.id, folderName },
      cards.length ? `${cards.length} flashcards criados na pasta "${folderName}"` : 'Os flashcards desses erros já existiam');
  } catch (err) { next(err); }
};

// POST /notebooks/:id/actions/redo { days } — caderno só com as erradas + revisão agendada
const actionRedo = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const days = Math.min(60, Math.max(0, parseInt(req.body.days, 10) || 3));
    const data = await loadForDiagnosis(req.params.id, userId);
    if (!data) return notFound(res, 'Caderno não encontrado');
    const wrongIds = data.items.filter((i) => i.attempt && !i.attempt.isCorrect).map((i) => i.question.id);
    if (!wrongIds.length) return badRequest(res, 'Nenhuma questão errada neste caderno');

    const notebook = await prisma.questionNotebook.create({
      data: {
        userId,
        folderId: data.nb.folderId,
        name: `Refazer erros · ${data.nb.name}`.slice(0, 120),
        description: `Questões erradas no caderno "${data.nb.name}". Refaça a partir de ${daysFromNow(days).toLocaleDateString('pt-BR')}.`,
        items: { create: wrongIds.map((questionId, position) => ({ questionId, position })) },
      },
    });

    const plan = await activePlan(userId);
    let scheduledFor = null;
    if (plan) {
      scheduledFor = daysFromNow(days);
      await prisma.studyTask.create({
        data: {
          studyPlanId: plan.id, type: 'REVISAO', scheduledDate: scheduledFor,
          estimatedMinutes: Math.max(15, Math.min(180, wrongIds.length * 3)),
          title: `Refazer ${wrongIds.length} questões erradas`.slice(0, 191),
          description: `Caderno: ${notebook.name}. Abra em Cadernos de Questões.`,
        },
      });
    }
    return created(res, { notebookId: notebook.id, total: wrongIds.length, scheduledFor },
      plan
        ? `Caderno criado e revisão agendada para ${scheduledFor.toLocaleDateString('pt-BR')}`
        : 'Caderno criado. Crie um plano de estudos ativo para agendar a revisão automaticamente.');
  } catch (err) { next(err); }
};

// POST /notebooks/:id/actions/theory — sessões de teoria (e lei seca) amanhã no plano ativo
const actionTheory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const data = await loadForDiagnosis(req.params.id, userId);
    if (!data) return notFound(res, 'Caderno não encontrado');
    const plan = await activePlan(userId);
    if (!plan) return error(res, 'Você não tem um plano de estudos ativo. Crie um em "Plano de Estudos" para agendar a teoria.', 409);

    const d = diagnose(data.items, { notebookName: data.nb.name });
    const discipline = d.byDiscipline.slice().sort((a, b) => b.total - a.total)[0]?.name || 'a disciplina do caderno';
    const topics = d.weakTopics?.length ? d.weakTopics.slice(0, 3).join(', ') : null;

    const tasks = [
      {
        type: 'LEITURA', estimatedMinutes: 60, scheduledDate: daysFromNow(1, 9),
        title: `Teoria: ${discipline}`.slice(0, 191),
        description: topics ? `Foco nos assuntos com mais erros: ${topics}.` : `Revisão da teoria após o caderno "${data.nb.name}".`,
      },
    ];
    if (d.level === 'critico') {
      tasks.push({
        type: 'LEITURA', estimatedMinutes: 30, scheduledDate: daysFromNow(1, 14),
        title: `Lei seca: ${discipline}`.slice(0, 191),
        description: 'Leitura ativa dos artigos cobrados, grifando prazos, exceções e palavras-chave.',
      });
    }
    await prisma.studyTask.createMany({ data: tasks.map((t) => ({ ...t, studyPlanId: plan.id })) });
    return created(res, { created: tasks.length, scheduledFor: tasks[0].scheduledDate },
      `${tasks.length === 1 ? 'Sessão de teoria agendada' : 'Teoria e lei seca agendadas'} para amanhã no plano "${plan.name}"`);
  } catch (err) { next(err); }
};

module.exports = {
  listFolders, createFolder, updateFolder, deleteFolder,
  list, create, getOne, update, remove, addQuestions, removeQuestion, reset,
  diagnosis, actionFlashcards, actionRedo, actionTheory, printData,
};
