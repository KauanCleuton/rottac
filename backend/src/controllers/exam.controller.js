// Simulados com ranking: mesma prova para todos, janela para começar, tempo de prova real,
// correção automática (com "uma errada anula uma certa" opcional), ranking e nota de corte.
const prisma = require('../utils/prisma');
const { success, created, notFound, badRequest, forbidden } = require('../utils/response');
const { loadRole } = require('../middlewares/role.middleware');
const { entitlementsFor } = require('../middlewares/plan.middleware');
const questionReview = require('../services/questionReview');
const { helpers } = require('./questionBank.controller');

const MAX_QUESTIONS = 200;
const GRACE_MS = 30_000; // tolerância de rede para salvar/entregar após o fim do tempo
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

const isAdmin = async (req) => (await loadRole(req)) === 'ADMIN';
const cleanStr = (v, max = 191) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
const deadlineOf = (exam, attempt) => new Date(attempt.startedAt.getTime() + exam.durationMinutes * 60_000);
const phaseOf = (exam, now = new Date()) => (now < exam.startsAt ? 'upcoming' : now <= exam.endsAt ? 'open' : 'closed');
// "Maria Souza" -> "Maria S." (ranking público sem expor o nome completo)
const shortName = (name) => {
  const p = String(name || 'Aluno').trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
};

// ─── Correção ────────────────────────────────────────────────────────────────

async function finalize(exam, attempt, answersIn) {
  if (attempt.finishedAt) return attempt;
  const items = await prisma.examQuestion.findMany({
    where: { examId: exam.id },
    include: { question: true },
    orderBy: { position: 'asc' },
  });
  const answers = answersIn || attempt.answers || {};
  let correct = 0; let wrong = 0; let blank = 0;
  const graded = [];
  for (const { question: q } of items) {
    const sel = answers[q.id];
    if (!sel) { blank += 1; continue; }
    const ok = q.isAnnulled || sel === q.answer;
    if (ok) correct += 1; else wrong += 1;
    graded.push({ q, sel, ok });
  }
  const score = correct - (exam.wrongPenalty ? wrong : 0);

  // Só um "finalizar" vence (duas abas, entrega + expiração ao mesmo tempo)
  const { count } = await prisma.examAttempt.updateMany({
    where: { id: attempt.id, finishedAt: null },
    data: { answers, correct, wrong, blank, score, finishedAt: new Date() },
  });
  if (count && graded.length) {
    // As respostas entram nas estatísticas do aluno; erros vão para a revisão espaçada
    await prisma.questionAttempt.createMany({
      data: graded.map(({ q, sel, ok }) => ({ questionId: q.id, userId: attempt.userId, selected: sel, isCorrect: ok })),
    });
    const ent = await entitlementsFor({ user: { id: attempt.userId } });
    if (ent.features.revisaoEspacada) {
      for (const { q, sel, ok } of graded.filter((g) => !g.ok)) {
        await questionReview.applyAnswer({ userId: attempt.userId, question: q, isCorrect: ok, selected: sel })
          .catch((e) => console.warn('[exam] revisão espaçada:', e.message));
      }
    }
  }
  return prisma.examAttempt.findUnique({ where: { id: attempt.id } });
}

// Fecha tentativas cujo tempo acabou sem entrega (aluno fechou a aba)
async function finalizeExpired(exam) {
  const open = await prisma.examAttempt.findMany({ where: { examId: exam.id, finishedAt: null } });
  const now = Date.now();
  for (const a of open) {
    if (deadlineOf(exam, a).getTime() + GRACE_MS < now) await finalize(exam, a);
  }
}

async function loadExam(req, id) {
  const admin = await isAdmin(req);
  return prisma.exam.findFirst({ where: { id, ...(admin ? {} : { isPublished: true }) } });
}

// ─── Aluno ───────────────────────────────────────────────────────────────────

// GET /exams
const list = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const exams = await prisma.exam.findMany({
      where: { isPublished: true },
      orderBy: { startsAt: 'desc' },
      include: { _count: { select: { questions: true, attempts: true } } },
      take: 100,
    });
    const mine = await prisma.examAttempt.findMany({
      where: { userId, examId: { in: exams.map((e) => e.id) } },
      select: { examId: true, finishedAt: true, score: true, startedAt: true },
    });
    const byExam = new Map(mine.map((a) => [a.examId, a]));
    const ent = await entitlementsFor(req);
    return success(res, exams.map(({ _count, ...e }) => {
      const a = byExam.get(e.id);
      return {
        ...e,
        phase: phaseOf(e),
        questions: _count.questions,
        participants: _count.attempts,
        locked: e.isPremium && !ent.features.simulado,
        myStatus: !a ? 'none' : a.finishedAt ? 'finished' : 'in_progress',
        myScore: a?.finishedAt ? a.score : null,
      };
    }));
  } catch (err) { next(err); }
};

// GET /exams/:id
const getOne = async (req, res, next) => {
  try {
    const exam = await loadExam(req, req.params.id);
    if (!exam) return notFound(res, 'Simulado não encontrado');
    const [questions, participants, attempt, ent] = await Promise.all([
      prisma.examQuestion.count({ where: { examId: exam.id } }),
      prisma.examAttempt.count({ where: { examId: exam.id } }),
      prisma.examAttempt.findUnique({ where: { examId_userId: { examId: exam.id, userId: req.user.id } } }),
      entitlementsFor(req),
    ]);
    // Disciplinas cobradas (sem revelar as questões)
    const disciplines = await prisma.$queryRaw`
      SELECT COALESCE(q.discipline, 'Outras') AS name, COUNT(*) AS total
      FROM exam_questions eq JOIN questions q ON q.id = eq.questionId
      WHERE eq.examId = ${exam.id} GROUP BY name ORDER BY MIN(eq.position)`;
    return success(res, {
      ...exam,
      phase: phaseOf(exam),
      questions,
      participants,
      locked: exam.isPremium && !ent.features.simulado,
      disciplines: disciplines.map((d) => ({ name: d.name, total: Number(d.total) })),
      myStatus: !attempt ? 'none' : attempt.finishedAt ? 'finished' : 'in_progress',
      serverNow: new Date(),
    });
  } catch (err) { next(err); }
};

async function attemptPayload(exam, attempt) {
  const items = await prisma.examQuestion.findMany({
    where: { examId: exam.id },
    orderBy: { position: 'asc' },
    include: { question: { include: helpers.listInclude } },
  });
  // Sem gabarito nem comentário durante a prova
  const ctx = { userId: null, isAdmin: false, attempts: [], favoriteIds: new Set(), annotatedIds: new Set() };
  return {
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
    deadline: deadlineOf(exam, attempt),
    serverNow: new Date(),
    answers: attempt.answers || {},
    questions: items.map((i) => {
      const { answer, explanation, lastAttempt, myAttempts, isFavorite, hasAnnotation, isOwner, commentsCount, author, ...q } = helpers.serialize(i.question, ctx);
      return q;
    }),
  };
}

// POST /exams/:id/start
const start = async (req, res, next) => {
  try {
    const exam = await loadExam(req, req.params.id);
    if (!exam) return notFound(res, 'Simulado não encontrado');
    const userId = req.user.id;
    const existing = await prisma.examAttempt.findUnique({ where: { examId_userId: { examId: exam.id, userId } } });
    if (existing?.finishedAt) return badRequest(res, 'Você já fez este simulado — veja seu resultado');
    if (existing) {
      if (deadlineOf(exam, existing).getTime() + GRACE_MS < Date.now()) {
        await finalize(exam, existing);
        return badRequest(res, 'Seu tempo acabou — a prova foi entregue automaticamente');
      }
      return success(res, await attemptPayload(exam, existing));
    }
    const phase = phaseOf(exam);
    if (phase === 'upcoming') return badRequest(res, 'O simulado ainda não começou');
    if (phase === 'closed') return badRequest(res, 'O prazo para começar este simulado terminou');
    if (exam.isPremium) {
      const ent = await entitlementsFor(req);
      if (!ent.features.simulado) {
        return res.status(402).json({ success: false, code: 'PLAN_REQUIRED', feature: 'simulado', message: 'Este simulado é exclusivo para assinantes. Faça upgrade para participar.' });
      }
    }
    let attempt;
    try {
      attempt = await prisma.examAttempt.create({ data: { examId: exam.id, userId, answers: {} } });
    } catch (e) {
      if (e.code !== 'P2002') throw e; // duplo clique: usa a tentativa já criada
      attempt = await prisma.examAttempt.findUnique({ where: { examId_userId: { examId: exam.id, userId } } });
    }
    return created(res, await attemptPayload(exam, attempt), 'Boa prova!');
  } catch (err) { next(err); }
};

async function validAnswers(examId, raw) {
  const items = await prisma.examQuestion.findMany({
    where: { examId },
    select: { question: { select: { id: true, type: true, optionA: true, optionB: true, optionC: true, optionD: true, optionE: true } } },
  });
  const out = {};
  for (const { question: q } of items) {
    const v = raw && typeof raw === 'object' ? String(raw[q.id] || '').toUpperCase() : '';
    const allowed = q.type === 'CERTO_ERRADO' ? ['C', 'E'] : LETTERS.filter((l) => q[`option${l}`]);
    if (allowed.includes(v)) out[q.id] = v;
  }
  return out;
}

async function myOpenAttempt(req, res) {
  const exam = await loadExam(req, req.params.id);
  if (!exam) { notFound(res, 'Simulado não encontrado'); return {}; }
  const attempt = await prisma.examAttempt.findUnique({ where: { examId_userId: { examId: exam.id, userId: req.user.id } } });
  if (!attempt) { badRequest(res, 'Você ainda não começou este simulado'); return {}; }
  return { exam, attempt };
}

// GET /exams/:id/attempt — retoma a prova (outra aba, recarregou a página)
const getAttempt = async (req, res, next) => {
  try {
    const { exam, attempt } = await myOpenAttempt(req, res);
    if (!exam) return;
    if (!attempt.finishedAt && deadlineOf(exam, attempt).getTime() + GRACE_MS < Date.now()) await finalize(exam, attempt);
    const fresh = await prisma.examAttempt.findUnique({ where: { id: attempt.id } });
    if (fresh.finishedAt) return success(res, { finished: true });
    return success(res, await attemptPayload(exam, fresh));
  } catch (err) { next(err); }
};

// PUT /exams/:id/attempt  { answers } — salvamento automático
const saveAnswers = async (req, res, next) => {
  try {
    const { exam, attempt } = await myOpenAttempt(req, res);
    if (!exam) return;
    if (attempt.finishedAt) return badRequest(res, 'A prova já foi entregue');
    if (deadlineOf(exam, attempt).getTime() + GRACE_MS < Date.now()) {
      await finalize(exam, attempt);
      return badRequest(res, 'Tempo esgotado — a prova foi entregue automaticamente');
    }
    const answers = await validAnswers(exam.id, req.body.answers);
    await prisma.examAttempt.updateMany({ where: { id: attempt.id, finishedAt: null }, data: { answers } });
    return success(res, { saved: Object.keys(answers).length });
  } catch (err) { next(err); }
};

// POST /exams/:id/finish  { answers }
const finish = async (req, res, next) => {
  try {
    const { exam, attempt } = await myOpenAttempt(req, res);
    if (!exam) return;
    if (attempt.finishedAt) return success(res, { finished: true });
    // Depois do prazo vale o que estava salvo
    const late = deadlineOf(exam, attempt).getTime() + GRACE_MS < Date.now();
    const answers = !late && req.body.answers ? await validAnswers(exam.id, req.body.answers) : undefined;
    await finalize(exam, attempt, answers);
    return success(res, { finished: true }, 'Prova entregue');
  } catch (err) { next(err); }
};

// GET /exams/:id/result — nota, posição, percentil, nota de corte, gabarito e ranking
const result = async (req, res, next) => {
  try {
    const exam = await loadExam(req, req.params.id);
    if (!exam) return notFound(res, 'Simulado não encontrado');
    await finalizeExpired(exam);
    const userId = req.user.id;
    const mine = await prisma.examAttempt.findUnique({ where: { examId_userId: { examId: exam.id, userId } } });
    const admin = await isAdmin(req);
    if (!admin && (!mine || !mine.finishedAt)) return forbidden(res, 'Entregue a prova para ver o resultado');

    const finished = await prisma.examAttempt.findMany({
      where: { examId: exam.id, finishedAt: { not: null } },
      include: { user: { select: { id: true, name: true } } },
    });
    const dur = (a) => a.finishedAt.getTime() - a.startedAt.getTime();
    finished.sort((a, b) => b.score - a.score || dur(a) - dur(b));
    const total = finished.length;
    const positionOf = (a) => 1 + finished.filter((x) => x.score > a.score).length; // empate divide a posição
    const items = await prisma.examQuestion.findMany({
      where: { examId: exam.id },
      orderBy: { position: 'asc' },
      include: { question: { include: helpers.listInclude } },
    });
    const qCount = items.length;
    const avg = total ? finished.reduce((s, a) => s + a.score, 0) / total : 0;

    let me = null;
    if (mine?.finishedAt) {
      const below = finished.filter((x) => x.score < mine.score).length;
      me = {
        score: mine.score, correct: mine.correct, wrong: mine.wrong, blank: mine.blank,
        percent: qCount ? Math.round((mine.score / qCount) * 1000) / 10 : 0,
        position: positionOf(mine),
        // "à frente de X% dos participantes"
        percentile: total > 1 ? Math.round((below / (total - 1)) * 100) : 100,
        minutes: Math.round(dur(mine) / 60000),
        approved: exam.cutoffScore !== null ? mine.score >= exam.cutoffScore : null,
        missing: exam.cutoffScore !== null ? Math.max(0, Math.ceil(exam.cutoffScore - mine.score)) : null,
      };
    }

    // Desempenho por disciplina (o aluno vê o próprio)
    const answers = mine?.answers || {};
    const byDiscipline = new Map();
    for (const { question: q } of items) {
      const k = q.discipline || 'Outras';
      const d = byDiscipline.get(k) || { name: k, total: 0, correct: 0, wrong: 0, blank: 0 };
      d.total += 1;
      const sel = answers[q.id];
      if (!sel) d.blank += 1;
      else if (q.isAnnulled || sel === q.answer) d.correct += 1;
      else d.wrong += 1;
      byDiscipline.set(k, d);
    }

    // Gabarito comentado: questões com resposta e comentário (a prova já foi entregue)
    const ctx = await helpers.userContext(req, items.map((i) => i.question.id));
    const gabarito = items.map((i) => ({
      ...helpers.serialize(i.question, { ...ctx, isAdmin: true }),
      mySelected: answers[i.question.id] || null,
    }));

    return success(res, {
      exam: { ...exam, phase: phaseOf(exam), questions: qCount },
      me,
      stats: {
        participants: total,
        average: Math.round(avg * 10) / 10,
        best: total ? finished[0].score : null,
        approved: exam.cutoffScore !== null ? finished.filter((a) => a.score >= exam.cutoffScore).length : null,
        provisional: phaseOf(exam) !== 'closed', // ainda dá para começar: o ranking pode mudar
      },
      ranking: finished.slice(0, 100).map((a) => ({
        position: positionOf(a),
        name: a.userId === userId ? `${shortName(a.user.name)} (você)` : shortName(a.user.name),
        isMe: a.userId === userId,
        score: a.score,
        correct: a.correct,
        minutes: Math.round(dur(a) / 60000),
      })),
      byDiscipline: [...byDiscipline.values()],
      gabarito,
    });
  } catch (err) { next(err); }
};

// ─── Admin ───────────────────────────────────────────────────────────────────

function examData(body, partial) {
  const data = {};
  const has = (k) => !partial || body[k] !== undefined;
  if (has('title')) { data.title = cleanStr(body.title); if (!data.title) return { error: 'Informe o título' }; }
  if (body.description !== undefined) data.description = body.description ? String(body.description).slice(0, 5000) : null;
  if (body.banca !== undefined) data.banca = cleanStr(body.banca, 100);
  if (body.cargo !== undefined) data.cargo = cleanStr(body.cargo, 191);
  for (const k of ['startsAt', 'endsAt']) {
    if (has(k)) {
      const d = new Date(body[k]);
      if (Number.isNaN(d.getTime())) return { error: k === 'startsAt' ? 'Data de início inválida' : 'Data final inválida' };
      data[k] = d;
    }
  }
  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) return { error: 'O prazo final deve ser depois do início' };
  if (has('durationMinutes')) {
    data.durationMinutes = parseInt(body.durationMinutes, 10);
    if (!(data.durationMinutes >= 5 && data.durationMinutes <= 720)) return { error: 'Duração entre 5 e 720 minutos' };
  }
  if (body.cutoffScore !== undefined) {
    data.cutoffScore = body.cutoffScore === null || body.cutoffScore === '' ? null : Number(body.cutoffScore);
    if (data.cutoffScore !== null && !Number.isFinite(data.cutoffScore)) return { error: 'Nota de corte inválida' };
  }
  for (const k of ['wrongPenalty', 'isPremium', 'isPublished']) if (body[k] !== undefined) data[k] = Boolean(body[k]);
  return { data };
}

// Blocos: [{ assuntos: "12,45", count: 10, label? }] + filtros gerais (banca, anos...)
async function pickQuestions(adminId, body) {
  const blocks = Array.isArray(body.blocks) && body.blocks.length ? body.blocks : [{ ...(body.filters || {}), count: body.count }];
  const chosen = [];
  const used = new Set();
  for (const [i, b] of blocks.slice(0, 30).entries()) {
    const count = Math.min(MAX_QUESTIONS, Math.max(1, parseInt(b.count, 10) || 10));
    const where = helpers.buildWhere({ ...(body.filters || {}), ...b, scope: 'public', hideAnnulled: '1' }, adminId);
    where.AND.push({ answer: { not: null } });
    const ids = await prisma.question.findMany({ where, select: { id: true }, take: 5000 });
    const pool = ids.map((r) => r.id).filter((id) => !used.has(id)).sort(() => Math.random() - 0.5).slice(0, count);
    if (pool.length < count) {
      return { error: `Bloco ${i + 1}: só há ${pool.length} questão(ões) com gabarito (pedido: ${count})` };
    }
    pool.forEach((id) => used.add(id));
    chosen.push(...pool);
  }
  if (chosen.length > MAX_QUESTIONS) return { error: `Máximo de ${MAX_QUESTIONS} questões` };
  return { ids: chosen };
}

const adminList = async (req, res, next) => {
  try {
    const exams = await prisma.exam.findMany({
      orderBy: { startsAt: 'desc' },
      include: { _count: { select: { questions: true, attempts: true } } },
    });
    return success(res, exams.map(({ _count, ...e }) => ({ ...e, phase: phaseOf(e), questions: _count.questions, participants: _count.attempts })));
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const { data, error } = examData(req.body, false);
    if (error) return badRequest(res, error);
    let ids;
    if (Array.isArray(req.body.questionIds) && req.body.questionIds.length) {
      const found = await prisma.question.findMany({
        where: { id: { in: req.body.questionIds.map(String).slice(0, MAX_QUESTIONS) }, answer: { not: null } },
        select: { id: true },
      });
      const ok = new Set(found.map((q) => q.id));
      ids = [...new Set(req.body.questionIds.map(String))].filter((id) => ok.has(id));
    } else {
      const picked = await pickQuestions(req.user.id, req.body);
      if (picked.error) return badRequest(res, picked.error);
      ids = picked.ids;
    }
    if (!ids.length) return badRequest(res, 'Nenhuma questão com gabarito encontrada');
    const exam = await prisma.exam.create({
      data: {
        ...data,
        createdById: req.user.id,
        questions: { create: ids.map((questionId, position) => ({ questionId, position })) },
      },
    });
    return created(res, { ...exam, questions: ids.length }, `Simulado criado com ${ids.length} questões`);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id }, include: { _count: { select: { attempts: true } } } });
    if (!exam) return notFound(res, 'Simulado não encontrado');
    const { data, error } = examData(req.body, true);
    if (error) return badRequest(res, error);
    const starts = data.startsAt || exam.startsAt;
    const ends = data.endsAt || exam.endsAt;
    if (ends <= starts) return badRequest(res, 'O prazo final deve ser depois do início');
    // Com alunos já fazendo, regras de correção ficam travadas
    if (exam._count.attempts && ((data.wrongPenalty !== undefined && data.wrongPenalty !== exam.wrongPenalty)
      || (data.durationMinutes !== undefined && data.durationMinutes !== exam.durationMinutes))) {
      return badRequest(res, 'Duração e penalidade não podem mudar depois que alguém começou o simulado');
    }
    const { _count, ...rest } = await prisma.exam.update({ where: { id: exam.id }, data, include: { _count: { select: { attempts: true } } } });
    return success(res, rest, 'Simulado atualizado');
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    const { count } = await prisma.exam.deleteMany({ where: { id: req.params.id } });
    if (!count) return notFound(res, 'Simulado não encontrado');
    return success(res, null, 'Simulado excluído');
  } catch (err) { next(err); }
};

module.exports = { list, getOne, start, getAttempt, saveAnswers, finish, result, adminList, create, update, remove };
