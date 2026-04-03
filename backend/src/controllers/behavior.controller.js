const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const dayjs = require('dayjs');

// ─── POST /behavior/event ─────────────────────────────────────────────────
const trackEvent = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type, subjectId, topicId, metadata } = req.body;

    const event = await prisma.behaviorEvent.create({
      data: { userId, type, subjectId, topicId, metadata: metadata || {} },
    });

    // Detecta procrastinação em tempo real
    if (type === 'TAREFA_PULADA' || type === 'TAREFA_ABANDONADA') {
      await detectProcrastination(userId, type, subjectId, metadata);
    }

    return success(res, event);
  } catch (err) {
    next(err);
  }
};

// ─── GET /behavior/events ─────────────────────────────────────────────────
const getEvents = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const days = parseInt(req.query.days) || 7;
    const events = await prisma.behaviorEvent.findMany({
      where: { userId, occurredAt: { gte: dayjs().subtract(days, 'day').toDate() } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    return success(res, events);
  } catch (err) {
    next(err);
  }
};

// ─── POST /behavior/energy ────────────────────────────────────────────────
const logEnergy = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { level, taskType, performance } = req.body;
    const now = dayjs();

    const log = await prisma.energyLog.create({
      data: {
        userId,
        level,
        hour: now.hour(),
        dayOfWeek: now.day(),
        taskType,
        performance,
      },
    });

    return success(res, log);
  } catch (err) {
    next(err);
  }
};

// ─── GET /behavior/energy/pattern ─────────────────────────────────────────
const getEnergyPattern = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const logs = await prisma.energyLog.findMany({ where: { userId } });

    // Agrega média de energia por hora
    const byHour = {};
    logs.forEach((log) => {
      if (!byHour[log.hour]) byHour[log.hour] = { total: 0, count: 0, performance: [] };
      byHour[log.hour].total += log.level;
      byHour[log.hour].count += 1;
      if (log.performance != null) byHour[log.hour].performance.push(log.performance);
    });

    const pattern = Array.from({ length: 24 }, (_, h) => {
      const data = byHour[h];
      if (!data) return { hour: h, avgEnergy: null, avgPerformance: null };
      const avgPerf = data.performance.length > 0
        ? data.performance.reduce((a, b) => a + b, 0) / data.performance.length
        : null;
      return {
        hour: h,
        avgEnergy: Math.round((data.total / data.count) * 10) / 10,
        avgPerformance: avgPerf ? Math.round(avgPerf * 10) / 10 : null,
        samples: data.count,
      };
    });

    // Identifica horários de pico
    const peakHours = pattern
      .filter((p) => p.avgEnergy !== null && p.avgEnergy >= 4)
      .map((p) => `${String(p.hour).padStart(2, '0')}:00`);

    return success(res, { pattern, peakHours });
  } catch (err) {
    next(err);
  }
};

// ─── GET /behavior/procrastination ────────────────────────────────────────
const getProcrastination = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const events = await prisma.procrastinationEvent.findMany({
      where: { userId },
      orderBy: { detectedAt: 'desc' },
      take: 50,
    });

    const byType = {};
    events.forEach((e) => {
      byType[e.type] = (byType[e.type] || 0) + 1;
    });

    return success(res, { events, summary: byType, total: events.length });
  } catch (err) {
    next(err);
  }
};

// ─── POST /behavior/procrastination/detect ────────────────────────────────
const detectProcrastinationManual = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { type, avoidedSubject, avoidedTaskId, inactivityMinutes } = req.body;

    const event = await detectProcrastination(userId, type, avoidedSubject, {
      avoidedTaskId,
      inactivityMinutes,
    });

    return success(res, event);
  } catch (err) {
    next(err);
  }
};

// ─── GET /behavior/metrics ────────────────────────────────────────────────
const getMetrics = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const days = parseInt(req.query.days) || 30;
    const since = dayjs().subtract(days, 'day').toDate();

    const [tasks, focusSessions, questionLogs, behaviorEvents, flashcardReviews] = await Promise.all([
      prisma.studyTask.findMany({
        where: { studyPlan: { userId }, scheduledDate: { gte: since } },
        select: { isCompleted: true, estimatedMinutes: true, actualMinutes: true, scheduledDate: true, completedAt: true },
      }),
      prisma.focusSession.findMany({
        where: { userId, startedAt: { gte: since } },
        select: { totalMinutes: true, status: true, startedAt: true },
      }),
      prisma.questionLog.findMany({
        where: { userId, loggedAt: { gte: since } },
        include: { subject: { select: { name: true } } },
      }),
      prisma.behaviorEvent.findMany({
        where: { userId, occurredAt: { gte: since } },
        select: { type: true, occurredAt: true },
      }),
      prisma.flashcardReview.findMany({
        where: { flashcard: { userId }, reviewedAt: { gte: since } },
        select: { rating: true, reviewedAt: true },
      }),
    ]);

    // Taxa de conclusão
    const completionRate = tasks.length > 0
      ? Math.round((tasks.filter((t) => t.isCompleted).length / tasks.length) * 100)
      : 0;

    // Horas totais estudadas
    const totalMinutes = tasks
      .filter((t) => t.isCompleted)
      .reduce((acc, t) => acc + (t.actualMinutes || t.estimatedMinutes), 0);

    // Taxa de acerto geral
    const totalQ = questionLogs.length;
    const correctQ = questionLogs.filter((q) => q.isCorrect).length;
    const accuracy = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0;

    // Eficiência por hora do dia
    const byHour = {};
    questionLogs.forEach((q) => {
      const h = dayjs(q.loggedAt).hour();
      if (!byHour[h]) byHour[h] = { total: 0, correct: 0 };
      byHour[h].total += 1;
      if (q.isCorrect) byHour[h].correct += 1;
    });
    const efficiencyByHour = Object.entries(byHour).map(([h, d]) => ({
      hour: parseInt(h),
      accuracy: Math.round((d.correct / d.total) * 100),
      questions: d.total,
    }));

    // Taxa de retenção (flashcards)
    const totalReviews = flashcardReviews.length;
    const goodReviews = flashcardReviews.filter((f) => f.rating >= 2).length;
    const retentionRate = totalReviews > 0 ? Math.round((goodReviews / totalReviews) * 100) : 0;

    // Índice de abandono (eventos)
    const abandonCount = behaviorEvents.filter((e) => e.type === 'TAREFA_ABANDONADA').length;
    const startCount = behaviorEvents.filter((e) => e.type === 'TAREFA_INICIADA').length;
    const abandonmentRate = startCount > 0 ? Math.round((abandonCount / startCount) * 100) : 0;

    // Disciplina por taxa de acerto
    const bySubject = {};
    questionLogs.forEach((q) => {
      const name = q.subject?.name || 'Desconhecido';
      if (!bySubject[name]) bySubject[name] = { total: 0, correct: 0 };
      bySubject[name].total += 1;
      if (q.isCorrect) bySubject[name].correct += 1;
    });

    const subjectAccuracy = Object.entries(bySubject)
      .map(([name, d]) => ({ name, accuracy: Math.round((d.correct / d.total) * 100), questions: d.total }))
      .sort((a, b) => a.accuracy - b.accuracy);

    return success(res, {
      period: `${days} dias`,
      completionRate,
      totalHours: Math.round(totalMinutes / 60 * 10) / 10,
      accuracy,
      retentionRate,
      abandonmentRate,
      efficiencyByHour,
      subjectAccuracy,
      weakSubjects: subjectAccuracy.filter((s) => s.accuracy < 60).slice(0, 3),
      strongSubjects: subjectAccuracy.filter((s) => s.accuracy >= 80).slice(-3),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Função interna: detectar procrastinação ──────────────────────────────
async function detectProcrastination(userId, eventType, avoidedSubject, metadata = {}) {
  let procType = 'ABANDONO_SESSAO';
  if (eventType === 'TAREFA_PULADA') procType = 'FUGA_MATERIA_DIFICIL';
  if (metadata?.inactivityMinutes > 30) procType = 'INATIVIDADE_LONGA';

  const event = await prisma.procrastinationEvent.create({
    data: {
      userId,
      type: procType,
      avoidedSubject: avoidedSubject || null,
      avoidedTaskId: metadata?.avoidedTaskId || null,
      inactivityMinutes: metadata?.inactivityMinutes || null,
      systemAction: 'Notificacao enviada',
    },
  });

  const messages = {
    INATIVIDADE_LONGA: 'Voce esta parado ha muito tempo. Que tal comecar com 10 minutos?',
    FUGA_MATERIA_DIFICIL: 'Percebi que voce esta evitando uma materia dificil. Enfrente-a agora!',
    ABANDONO_SESSAO: 'Voce saiu antes de terminar. Volte e conclua pelo menos uma tarefa.',
    LOOP_MATERIA_FACIL: 'Voce esta so fazendo o que e facil. Hora de avançar!',
    INICIO_TARDIO: 'Voce esta comecando muito tarde. Organize seu horario.',
  };

  await prisma.notification.create({
    data: {
      userId,
      title: 'Alerta do Sistema Inteligente',
      body: messages[procType] || 'Mantenha o foco!',
      type: 'PROCRASTINACAO',
      data: { procrastinationType: procType },
    },
  });

  return event;
}

module.exports = {
  trackEvent,
  getEvents,
  logEnergy,
  getEnergyPattern,
  getProcrastination,
  detectProcrastinationManual,
  getMetrics,
};
