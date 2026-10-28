const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const dayjs = require('dayjs');

const INTEL_SERVICE = process.env.INTELLIGENCE_SERVICE_URL || 'http://localhost:3003';

// ─── Helper: chamada ao serviço de inteligência ────────────────────────────
async function callIntel(path, body = null, method = 'POST') {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${INTEL_SERVICE}${path}`, opts);
  if (!res.ok) throw new Error(`Intel service error: ${res.status}`);
  return res.json();
}

// ─── GET /intelligence/profile ─────────────────────────────────────────────
const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    let profile = await prisma.brainProfile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await prisma.brainProfile.create({ data: { userId } });
    }
    return success(res, profile);
  } catch (err) {
    next(err);
  }
};

// ─── POST /intelligence/profile/analyze ────────────────────────────────────
const analyzeProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    // Coleta dados para o motor de análise
    const [
      questionLogs,
      studyTasks,
      focusSessions,
      errorEntries,
      emotionLogs,
      energyLogs,
      behaviorEvents,
    ] = await Promise.all([
      prisma.questionLog.findMany({
        where: { userId, loggedAt: { gte: dayjs().subtract(30, 'day').toDate() } },
        include: { subject: { select: { name: true } } },
      }),
      prisma.studyTask.findMany({
        where: { studyPlan: { userId }, scheduledDate: { gte: dayjs().subtract(30, 'day').toDate() } },
        select: { isCompleted: true, completedAt: true, scheduledDate: true, estimatedMinutes: true, actualMinutes: true },
      }),
      prisma.focusSession.findMany({
        where: { userId, startedAt: { gte: dayjs().subtract(30, 'day').toDate() } },
        select: { totalMinutes: true, status: true, startedAt: true },
      }),
      prisma.errorEntry.findMany({
        where: { userId },
        include: { subject: { select: { name: true } }, reviews: true },
      }),
      prisma.emotionLog.findMany({
        where: { userId, loggedAt: { gte: dayjs().subtract(30, 'day').toDate() } },
        select: { energy: true, emotion: true, loggedAt: true },
      }),
      prisma.energyLog.findMany({
        where: { userId },
        select: { level: true, hour: true, dayOfWeek: true, performance: true },
      }),
      prisma.behaviorEvent.findMany({
        where: { userId, occurredAt: { gte: dayjs().subtract(30, 'day').toDate() } },
        select: { type: true, occurredAt: true, metadata: true },
      }),
    ]);

    const payload = {
      userId,
      examDate: user.examDate,
      questionLogs: questionLogs.map((q) => ({
        subject: q.subject?.name,
        isCorrect: q.isCorrect,
        timeSpent: q.timeSpent,
        loggedAt: q.loggedAt,
      })),
      studyTasks: studyTasks.map((t) => ({
        isCompleted: t.isCompleted,
        completedAt: t.completedAt,
        scheduledDate: t.scheduledDate,
        estimatedMinutes: t.estimatedMinutes,
        actualMinutes: t.actualMinutes,
      })),
      focusSessions: focusSessions.map((f) => ({
        totalMinutes: f.totalMinutes,
        status: f.status,
        startedAt: f.startedAt,
      })),
      errorEntries: errorEntries.map((e) => ({
        subject: e.subject?.name,
        errorType: e.errorType,
        reviewCount: e.reviewCount,
        isResolved: e.isResolved,
      })),
      emotionLogs,
      energyLogs,
      behaviorEvents: behaviorEvents.map((b) => ({
        type: b.type,
        occurredAt: b.occurredAt,
      })),
    };

    const analysis = await callIntel('/analyze/profile', payload);

    // Atualiza o perfil com resultado da análise
    const profile = await prisma.brainProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...analysis.profile,
        lastAnalyzedAt: new Date(),
      },
      update: {
        ...analysis.profile,
        lastAnalyzedAt: new Date(),
      },
    });

    // Salva insights gerados
    if (analysis.insights?.length > 0) {
      await prisma.analysisInsight.createMany({
        data: analysis.insights.map((i) => ({
          userId,
          type: i.type,
          title: i.title,
          body: i.body,
          data: i.data || {},
          severity: i.severity,
          action: i.action,
          expiresAt: i.expiresAt ? new Date(i.expiresAt) : null,
        })),
      });
    }

    return success(res, { profile, insights: analysis.insights || [] });
  } catch (err) {
    next(err);
  }
};

// ─── GET /intelligence/plan/today ──────────────────────────────────────────
const getTodayPlan = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = dayjs().startOf('day').toDate();

    let plan = await prisma.dailyIntelligencePlan.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (!plan) {
      // Gera plano via motor de decisão
      plan = await generateTodayPlan(userId, today);
    }

    return success(res, plan);
  } catch (err) {
    next(err);
  }
};

// ─── POST /intelligence/plan/generate ──────────────────────────────────────
const generatePlan = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = dayjs().startOf('day').toDate();
    const plan = await generateTodayPlan(userId, today);
    return success(res, plan);
  } catch (err) {
    next(err);
  }
};

async function generateTodayPlan(userId, date) {
  const [profile, subjects, tasks, errorEntries, missionsActive] = await Promise.all([
    prisma.brainProfile.findUnique({ where: { userId } }),
    prisma.subject.findMany({
      where: { userId },
      include: {
        modules: { include: { topics: { where: { isCompleted: false } } } },
        questionLogs: {
          where: { loggedAt: { gte: dayjs().subtract(7, 'day').toDate() } },
          select: { isCorrect: true },
        },
      },
    }),
    prisma.studyTask.findMany({
      where: {
        studyPlan: { userId, isActive: true },
        scheduledDate: {
          gte: dayjs(date).startOf('day').toDate(),
          lte: dayjs(date).endOf('day').toDate(),
        },
      },
      include: { topic: true },
    }),
    prisma.errorEntry.findMany({
      where: { userId, isResolved: false, nextReviewAt: { lte: new Date() } },
      include: { subject: { select: { name: true } } },
      take: 10,
    }),
    prisma.mission.findMany({
      where: { userId, status: 'ATIVA' },
      take: 3,
    }),
  ]);

  const subjectsData = subjects.map((s) => {
    const total = s.questionLogs.length;
    const correct = s.questionLogs.filter((q) => q.isCorrect).length;
    const pendingTopics = s.modules.flatMap((m) => m.topics).length;
    return {
      id: s.id,
      name: s.name,
      weight: s.weight,
      accuracy: total > 0 ? (correct / total) * 100 : null,
      pendingTopics,
    };
  });

  const payload = {
    userId,
    date: dayjs(date).format('YYYY-MM-DD'),
    profile: profile || {},
    subjects: subjectsData,
    scheduledTasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      estimatedMinutes: t.estimatedMinutes,
      topic: t.topic?.name,
    })),
    pendingErrors: errorEntries.map((e) => ({
      id: e.id,
      subject: e.subject?.name,
      errorType: e.errorType,
    })),
    activeMissions: missionsActive.map((m) => ({ id: m.id, type: m.type, title: m.title })),
  };

  // Fallback: se o serviço de IA não estiver rodando, usa as tarefas reais do plano ativo
  const fallbackPlan = tasks.map((t) => ({
    id: t.id,          // ID real da StudyTask — usado para sincronizar ao completar
    taskId: t.id,
    title: t.title,
    type: t.type,
    estimatedMinutes: t.estimatedMinutes,
    subject: t.topic?.name,
    done: t.isCompleted,
    completedAt: t.completedAt || null,
  }));

  const decision = await fetch(`${INTEL_SERVICE}/decide/today`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json()).catch(() => ({ plan: null }));

  // Se o serviço retornou itens, adiciona taskId quando o título coincide com uma StudyTask
  let finalPlan = decision?.plan?.length
    ? decision.plan.map((item) => {
        const match = tasks.find((t) => t.id === item.id || t.title === item.title);
        return { ...item, taskId: match?.id || null, done: match?.isCompleted || item.done || false };
      })
    : fallbackPlan;

  const saved = await prisma.dailyIntelligencePlan.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId,
      date,
      plan: finalPlan,
      dayMode: (profile?.activeMode) || 'NORMAL',
    },
    update: {
      plan: finalPlan,
      replans: [],
      status: 'GERADO',
      dayMode: (profile?.activeMode) || 'NORMAL',
    },
  });

  return saved;
}

// ─── POST /intelligence/plan/replan ────────────────────────────────────────
const replan = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { reason, completedItems } = req.body;
    const today = dayjs().startOf('day').toDate();

    const existing = await prisma.dailyIntelligencePlan.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (!existing) return res.status(404).json({ error: 'Plano do dia não encontrado' });

    const payload = {
      currentPlan: existing.plan,
      completedItems: completedItems || [],
      reason,
      currentTime: dayjs().format('HH:mm'),
      profile: await prisma.brainProfile.findUnique({ where: { userId } }),
    };

    const newPlan = await callIntel('/decide/replan', payload);

    const replans = Array.isArray(existing.replans) ? existing.replans : [];
    replans.push({ at: new Date(), reason, plan: newPlan.plan });

    const updated = await prisma.dailyIntelligencePlan.update({
      where: { userId_date: { userId, date: today } },
      data: {
        plan: newPlan.plan,
        replans,
        status: 'REPLANEJADO',
      },
    });

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

// ─── POST /intelligence/next-action ────────────────────────────────────────
const getNextAction = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = dayjs().startOf('day').toDate();

    const [plan, profile] = await Promise.all([
      prisma.dailyIntelligencePlan.findUnique({ where: { userId_date: { userId, date: today } } }),
      prisma.brainProfile.findUnique({ where: { userId } }),
    ]);

    if (!plan) {
      return success(res, { action: null, message: 'Nenhum plano gerado para hoje. Gere seu plano primeiro.' });
    }

    const planItems = Array.isArray(plan.plan) ? plan.plan : [];
    const nextItem = planItems.find((item) => !item.done);

    if (!nextItem) {
      return success(res, { action: null, message: 'Parabens! Voce concluiu todas as acoes do dia.' });
    }

    return success(res, {
      action: nextItem,
      dayMode: plan.dayMode,
      profile: { behaviorType: profile?.behaviorType, activeMode: profile?.activeMode },
      totalItems: planItems.length,
      completedItems: planItems.filter((i) => i.done).length,
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /intelligence/next-action/:itemId/complete ──────────────────────
const completeAction = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;
    const today = dayjs().startOf('day').toDate();

    const plan = await prisma.dailyIntelligencePlan.findUnique({
      where: { userId_date: { userId, date: today } },
    });

    if (!plan) return res.status(404).json({ error: 'Plano nao encontrado' });

    const items = Array.isArray(plan.plan) ? plan.plan : [];
    const completedItem = items.find((i) => i.id === itemId);
    const updated = items.map((item) =>
      item.id === itemId ? { ...item, done: true, completedAt: new Date() } : item
    );

    const allDone = updated.every((i) => i.done);

    await prisma.dailyIntelligencePlan.update({
      where: { userId_date: { userId, date: today } },
      data: {
        plan: updated,
        status: allDone ? 'CONCLUIDO' : 'EM_EXECUCAO',
        executionScore: allDone ? 100 : Math.round((updated.filter((i) => i.done).length / updated.length) * 100),
      },
    });

    // Sincroniza com StudyTask real (quando o item tem taskId)
    const taskId = completedItem?.taskId || completedItem?.id;
    if (taskId) {
      await prisma.studyTask.updateMany({
        where: { id: taskId, studyPlan: { userId } },
        data: { isCompleted: true, completedAt: new Date() },
      });
      // XP de gamificação
      await prisma.gamification.updateMany({
        where: { userId },
        data: { xp: { increment: 10 } },
      });
    }

    // Registra evento comportamental
    await prisma.behaviorEvent.create({
      data: {
        userId,
        type: 'TAREFA_CONCLUIDA',
        metadata: { itemId, planDate: dayjs().format('YYYY-MM-DD') },
      },
    });

    const nextItem = updated.find((i) => !i.done);
    return success(res, { nextAction: nextItem || null, allDone });
  } catch (err) {
    next(err);
  }
};

// ─── GET /intelligence/insights ────────────────────────────────────────────
const getInsights = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const insights = await prisma.analysisInsight.findMany({
      where: { userId, isRead: false },
      orderBy: [{ severity: 'desc' }, { generatedAt: 'desc' }],
      take: 20,
    });
    return success(res, insights);
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /intelligence/insights/:id/read ────────────────────────────────
const markInsightRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const insight = await prisma.analysisInsight.update({
      where: { id },
      data: { isRead: true },
    });
    return success(res, insight);
  } catch (err) {
    next(err);
  }
};

// ─── POST /intelligence/mode ───────────────────────────────────────────────
const setMode = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { mode } = req.body; // NORMAL | FORCA_BRUTA | MODO_GUERRA | RETORNO | CANSADO

    const profile = await prisma.brainProfile.upsert({
      where: { userId },
      create: { userId, activeMode: mode },
      update: { activeMode: mode },
    });

    // Notificar via sistema
    const modeMessages = {
      MODO_GUERRA: 'Modo Guerra ativado! Foco total em revisao e simulados.',
      FORCA_BRUTA: 'Modo Forca Bruta ativado! Suas fraquezas serao eliminadas.',
      CANSADO: 'Modo Cansado ativado. Tarefas leves ate voce se recuperar.',
      RETORNO: 'Bem-vindo de volta! Plano de retorno gradual ativado.',
      NORMAL: 'Modo Normal restaurado.',
    };

    await prisma.notification.create({
      data: {
        userId,
        title: 'Modo alterado',
        body: modeMessages[mode] || 'Modo atualizado.',
        type: 'INTELIGENCIA',
        data: { mode },
      },
    });

    return success(res, { profile, message: modeMessages[mode] });
  } catch (err) {
    next(err);
  }
};

// ─── POST /intelligence/reverse-plan ──────────────────────────────────────
const reversePlan = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.examDate) {
      return res.status(400).json({ error: 'Data da prova nao configurada no perfil.' });
    }

    const subjects = await prisma.subject.findMany({
      where: { userId },
      include: {
        modules: {
          include: {
            topics: { select: { id: true, name: true, isCompleted: true, difficulty: true, estimatedHours: true } },
          },
        },
        questionLogs: {
          where: { loggedAt: { gte: dayjs().subtract(30, 'day').toDate() } },
          select: { isCorrect: true },
        },
      },
    });

    const payload = {
      examDate: user.examDate,
      today: new Date(),
      dailyStudyHours: user.dailyStudyHours,
      subjects: subjects.map((s) => {
        const pendingTopics = s.modules.flatMap((m) => m.topics).filter((t) => !t.isCompleted);
        const total = s.questionLogs.length;
        const correct = s.questionLogs.filter((q) => q.isCorrect).length;
        return {
          id: s.id,
          name: s.name,
          weight: s.weight,
          accuracy: total > 0 ? (correct / total) * 100 : null,
          pendingTopics: pendingTopics.map((t) => ({
            name: t.name,
            difficulty: t.difficulty,
            estimatedHours: t.estimatedHours,
          })),
        };
      }),
    };

    const plan = await callIntel('/decide/reverse-plan', payload);
    return success(res, plan);
  } catch (err) {
    next(err);
  }
};

// ─── POST /intelligence/brute-force ───────────────────────────────────────
const activateBruteForce = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { subjectId, trigger } = req.body;

    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
      include: {
        modules: { include: { topics: { where: { isCompleted: false } } } },
        questionLogs: {
          where: { loggedAt: { gte: dayjs().subtract(14, 'day').toDate() } },
          select: { isCorrect: true, topicId: true },
        },
        errorEntries: {
          where: { isResolved: false },
          select: { topicId: true, errorType: true },
        },
      },
    });

    if (!subject) return res.status(404).json({ error: 'Disciplina nao encontrada' });

    // Identifica topicos criticos
    const topicErrorCount = {};
    subject.errorEntries.forEach((e) => {
      if (e.topicId) topicErrorCount[e.topicId] = (topicErrorCount[e.topicId] || 0) + 1;
    });

    const allTopics = subject.modules.flatMap((m) => m.topics);
    const criticalTopics = allTopics
      .sort((a, b) => (topicErrorCount[b.id] || 0) - (topicErrorCount[a.id] || 0))
      .slice(0, 5)
      .map((t) => ({ id: t.id, name: t.name, errors: topicErrorCount[t.id] || 0 }));

    // Desativa sessoes ativas anteriores
    await prisma.bruteForceSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });

    const session = await prisma.bruteForceSession.create({
      data: {
        userId,
        subjectId,
        criticalTopics,
        trigger: trigger || 'manual',
        plannedDays: 7,
      },
    });

    await prisma.brainProfile.upsert({
      where: { userId },
      create: { userId, activeMode: 'FORCA_BRUTA' },
      update: { activeMode: 'FORCA_BRUTA' },
    });

    await prisma.notification.create({
      data: {
        userId,
        title: 'Modo Forca Bruta Ativado',
        body: `Foco total em ${subject.name} por 7 dias. ${criticalTopics.length} topicos criticos identificados.`,
        type: 'INTELIGENCIA',
      },
    });

    return success(res, { session, criticalTopics, subject: subject.name });
  } catch (err) {
    next(err);
  }
};

// ─── POST /intelligence/war-mode ──────────────────────────────────────────
const activateWarMode = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.examDate) {
      return res.status(400).json({ error: 'Configure a data da prova primeiro.' });
    }

    const daysLeft = dayjs(user.examDate).diff(dayjs(), 'day');
    if (daysLeft > 60) {
      return res.status(400).json({ error: `Ainda faltam ${daysLeft} dias. Modo Guerra e para os ultimos 60 dias.` });
    }

    await prisma.brainProfile.upsert({
      where: { userId },
      create: { userId, activeMode: 'MODO_GUERRA' },
      update: { activeMode: 'MODO_GUERRA' },
    });

    // Gera missao de modo guerra
    await prisma.mission.create({
      data: {
        userId,
        title: 'Modo Guerra: Contagem Regressiva',
        description: `Faltam ${daysLeft} dias para a prova. Revisao intensiva e simulados diarios.`,
        type: 'MODO_GUERRA',
        criteria: {
          dailySimulados: 1,
          dailyRevisions: 3,
          minQuestoes: 50,
          daysLeft,
        },
        xpReward: 500,
        badge: 'guerreiro',
        expiresAt: user.examDate,
      },
    });

    await prisma.notification.create({
      data: {
        userId,
        title: 'MODO GUERRA ATIVADO',
        body: `${daysLeft} dias para a prova. Foco maximo. Simulados diarios. Zero desperdicio.`,
        type: 'MODO_GUERRA',
        data: { daysLeft, examDate: user.examDate },
      },
    });

    return success(res, { daysLeft, examDate: user.examDate, mode: 'MODO_GUERRA' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProfile,
  analyzeProfile,
  getTodayPlan,
  generatePlan,
  replan,
  getNextAction,
  completeAction,
  getInsights,
  markInsightRead,
  setMode,
  reversePlan,
  activateBruteForce,
  activateWarMode,
};
