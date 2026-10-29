// Revisão espaçada de questões + Caderno de Erros automático.
// Um sistema só: a agenda da questão (QuestionReview, SM-2) e o registro no Caderno de Erros
// (ErrorEntry com questionId) andam juntos, para o aluno não ter duas revisões do mesmo erro.
const prisma = require('../utils/prisma');

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const DAY = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;
const MASTERED_REPS = 4;
const MASTERED_INTERVAL = 30;
// Acerto só avança a agenda se a questão já venceu (tolerância de 2h, as revisões vencem às 4h);
// evita "decorar" respondendo de novo logo após ver o gabarito
const DUE_TOLERANCE = 2 * 60 * 60 * 1000;

const addDays = (days, from = new Date()) => {
  const d = new Date(from.getTime() + days * DAY);
  d.setHours(4, 0, 0, 0); // vence no começo do dia
  return d;
};

// SM-2 adaptado para revisão de erros: 1 dia após errar, depois 3, 7 e intervalo × fator
function nextSchedule(review, { isCorrect, timeSpent }) {
  const ease = review?.easeFactor ?? 2.5;
  if (!isCorrect) {
    return {
      easeFactor: Math.round(Math.max(MIN_EASE, ease - 0.2) * 100) / 100,
      interval: 1,
      repetitions: 0,
      lapses: (review?.lapses ?? 0) + 1,
      mastered: false,
    };
  }
  // Qualidade da resposta: rápida (< 60s) = 5, normal = 4
  const quality = Number.isFinite(timeSpent) && timeSpent > 0 && timeSpent < 60 ? 5 : 4;
  const newEase = Math.max(MIN_EASE, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  const reps = (review?.repetitions ?? 0) + 1;
  const interval = reps === 1 ? 3 : reps === 2 ? 7 : Math.round((review?.interval ?? 7) * newEase);
  return {
    easeFactor: Math.round(newEase * 100) / 100,
    interval,
    repetitions: reps,
    lapses: review?.lapses ?? 0,
    mastered: reps >= MASTERED_REPS && interval >= MASTERED_INTERVAL,
  };
}

const answerText = (q, letter) => {
  if (!letter) return '—';
  if (q.type === 'CERTO_ERRADO') return letter === 'C' ? 'CERTO' : 'ERRADO';
  const txt = q[`option${letter}`];
  return txt ? `${letter}) ${txt}` : letter;
};

// Disciplina do aluno para o registro: a vinculada à questão, a de mesmo nome, ou cria uma
async function resolveSubject(userId, question) {
  if (question.subjectId) {
    const own = await prisma.subject.findFirst({ where: { id: question.subjectId, userId }, select: { id: true } });
    if (own) return own.id;
  }
  const name = (question.discipline || 'Questões do banco').slice(0, 191);
  const existing = await prisma.subject.findFirst({ where: { userId, name }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.subject.create({ data: { userId, name, color: '#F2B705' } });
  return created.id;
}

// Tipo de erro sugerido (o aluno pode trocar no Caderno de Erros)
async function guessErrorType(userId, question) {
  const hadRight = await prisma.questionAttempt.findFirst({
    where: { userId, questionId: question.id, isCorrect: true }, select: { id: true },
  });
  if (hadRight) return 'ESQUECIMENTO';
  if (question.difficulty === 'FACIL') return 'FALTA_ATENCAO';
  return 'CONTEUDO_NAO_ESTUDADO';
}

/**
 * Aplica o resultado de uma resposta à revisão espaçada e ao Caderno de Erros.
 * Chamado ao responder no banco/caderno/simulado e ao revisar no Caderno de Erros.
 * @returns {{ inReview: boolean, nextReviewAt?: Date, interval?: number, mastered?: boolean, addedToErrorNotebook?: boolean, counted?: boolean }}
 */
async function applyAnswer({ userId, question, isCorrect, selected, timeSpent, fromErrorNotebook = false }) {
  const review = await prisma.questionReview.findUnique({
    where: { userId_questionId: { userId, questionId: question.id } },
  });

  // Acertou uma questão que nunca errou: não entra na revisão
  if (isCorrect && !review) return { inReview: false };

  const now = new Date();
  if (isCorrect && !review.mastered && review.nextReviewAt.getTime() - now.getTime() > DUE_TOLERANCE && !fromErrorNotebook) {
    // Acerto antes da data: registra, mas não avança a agenda
    return { inReview: true, counted: false, nextReviewAt: review.nextReviewAt, interval: review.interval, mastered: review.mastered };
  }

  const sched = nextSchedule(review, { isCorrect, timeSpent });
  const nextReviewAt = addDays(sched.interval, now);
  await prisma.questionReview.upsert({
    where: { userId_questionId: { userId, questionId: question.id } },
    create: { userId, questionId: question.id, ...sched, nextReviewAt, lastReviewAt: now },
    update: { ...sched, nextReviewAt, lastReviewAt: now },
  });

  // ── Caderno de Erros
  let addedToErrorNotebook = false;
  // Um registro por aluno+questão (garantido aqui, sem índice único no banco)
  const entry = await prisma.errorEntry.findFirst({
    where: { userId, questionId: question.id },
    orderBy: { createdAt: 'asc' },
  });

  if (!entry && !isCorrect) {
    const [subjectId, errorType] = await Promise.all([resolveSubject(userId, question), guessErrorType(userId, question)]);
    const source = [question.banca, question.year, question.orgao].filter(Boolean).join(' · ') || 'Banco de questões';
    const options = question.type === 'MULTIPLA_ESCOLHA'
      ? '\n\n' + LETTERS.filter((l) => question[`option${l}`]).map((l) => `${l}) ${question[`option${l}`]}`).join('\n')
      : '';
    await prisma.errorEntry.create({
      data: {
        userId,
        questionId: question.id,
        subjectId,
        title: [question.discipline, question.topic].filter(Boolean).join(' › ').slice(0, 191) || null,
        questionText: `${question.statement}${options}`,
        description: 'Registrado automaticamente ao errar a questão no banco.',
        correctAnswer: answerText(question, question.answer),
        myAnswer: answerText(question, selected),
        explanation: question.explanation || null,
        source: source.slice(0, 191),
        errorType,
        difficulty: question.difficulty,
        nextReviewAt,
      },
    });
    addedToErrorNotebook = true;
  } else if (entry) {
    await prisma.$transaction([
      prisma.errorReview.create({ data: { errorEntryId: entry.id, result: isCorrect ? 'ACERTOU' : 'ERROU_NOVAMENTE' } }),
      prisma.errorEntry.update({
        where: { id: entry.id },
        data: {
          reviewCount: { increment: 1 },
          nextReviewAt,
          myAnswer: !isCorrect && selected ? answerText(question, selected) : entry.myAnswer,
          isResolved: isCorrect && (sched.mastered || sched.repetitions >= 3),
        },
      }),
    ]);
  }

  return { inReview: !sched.mastered, counted: true, nextReviewAt, interval: sched.interval, mastered: sched.mastered, addedToErrorNotebook };
}

module.exports = { applyAnswer, nextSchedule, addDays };
