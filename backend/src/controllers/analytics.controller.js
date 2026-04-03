const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const dayjs = require('dayjs');

// Dashboard principal com todos os indicadores
const getDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const today = dayjs().startOf('day').toDate();
    const tomorrow = dayjs().endOf('day').toDate();
    const weekStart = dayjs().startOf('week').toDate();
    const monthStart = dayjs().startOf('month').toDate();

    const [
      todayTasks,
      weekTasks,
      gamification,
      questionStats,
      errorStats,
      flashcardsDue,
      recentEmotions,
      goals,
    ] = await Promise.all([
      prisma.studyTask.findMany({
        where: {
          studyPlan: { userId, isActive: true },
          scheduledDate: { gte: today, lte: tomorrow },
        },
      }),
      prisma.studyTask.findMany({
        where: {
          studyPlan: { userId, isActive: true },
          scheduledDate: { gte: weekStart },
          isCompleted: true,
        },
      }),
      prisma.gamification.findUnique({ where: { userId } }),
      prisma.questionLog.groupBy({
        by: ['isCorrect'],
        where: { userId, loggedAt: { gte: monthStart } },
        _count: { id: true },
      }),
      prisma.errorEntry.count({
        where: { userId, isResolved: false },
      }),
      prisma.flashcard.count({
        where: { userId, nextReviewAt: { lte: new Date() } },
      }),
      prisma.emotionLog.findMany({
        where: { userId },
        orderBy: { loggedAt: 'desc' },
        take: 7,
      }),
      prisma.goal.findMany({
        where: { userId, isCompleted: false },
        orderBy: { endDate: 'asc' },
        take: 5,
      }),
    ]);

    const todayMinutes = todayTasks.reduce((acc, t) => acc + t.estimatedMinutes, 0);
    const completedToday = todayTasks.filter((t) => t.isCompleted).length;
    const weekMinutes = weekTasks.reduce((acc, t) => acc + (t.actualMinutes || t.estimatedMinutes), 0);

    const totalQuestions = questionStats.reduce((acc, s) => acc + s._count.id, 0);
    const correctQuestions = questionStats.find((s) => s.isCorrect)?._count?.id || 0;
    const accuracy = totalQuestions > 0 ? Math.round((correctQuestions / totalQuestions) * 100) : 0;

    return success(res, {
      today: {
        totalTasks: todayTasks.length,
        completedTasks: completedToday,
        pendingTasks: todayTasks.length - completedToday,
        estimatedMinutes: todayMinutes,
        progressPercent: todayTasks.length > 0 ? Math.round((completedToday / todayTasks.length) * 100) : 0,
      },
      week: {
        studiedMinutes: weekMinutes,
        completedTasks: weekTasks.length,
      },
      gamification: {
        xp: gamification?.xp || 0,
        level: gamification?.level || 1,
        streak: gamification?.streak || 0,
        bestStreak: gamification?.bestStreak || 0,
      },
      questions: {
        total: totalQuestions,
        correct: correctQuestions,
        accuracy,
      },
      pendingErrors: errorStats,
      flashcardsDue,
      recentEmotions,
      goals,
    });
  } catch (err) {
    next(err);
  }
};

// Histórico de horas estudadas por dia (últimos 30 dias)
const getStudyHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const days = parseInt(req.query.days) || 30;
    const startDate = dayjs().subtract(days, 'day').startOf('day').toDate();

    const tasks = await prisma.studyTask.findMany({
      where: {
        studyPlan: { userId },
        isCompleted: true,
        completedAt: { gte: startDate },
      },
      select: { completedAt: true, actualMinutes: true, estimatedMinutes: true },
    });

    // Agrupar por dia
    const byDay = {};
    tasks.forEach((t) => {
      const day = dayjs(t.completedAt).format('YYYY-MM-DD');
      if (!byDay[day]) byDay[day] = 0;
      byDay[day] += t.actualMinutes || t.estimatedMinutes;
    });

    // Preencher dias sem estudo
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      result.push({ date, minutes: byDay[date] || 0 });
    }

    return success(res, result);
  } catch (err) {
    next(err);
  }
};

// Desempenho por disciplina
const getSubjectPerformance = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const subjects = await prisma.subject.findMany({
      where: { userId },
      include: {
        modules: {
          include: {
            topics: { select: { id: true, progress: true, isCompleted: true } },
          },
        },
        questionLogs: { select: { isCorrect: true } },
        errorEntries: { select: { id: true, isResolved: true } },
      },
    });

    const performance = subjects.map((s) => {
      const allTopics = s.modules.flatMap((m) => m.topics);
      const completedTopics = allTopics.filter((t) => t.isCompleted).length;
      const avgProgress = allTopics.length > 0
        ? allTopics.reduce((acc, t) => acc + t.progress, 0) / allTopics.length
        : 0;

      const totalQ = s.questionLogs.length;
      const correctQ = s.questionLogs.filter((q) => q.isCorrect).length;
      const accuracy = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : null;

      return {
        id: s.id,
        name: s.name,
        color: s.color,
        totalTopics: allTopics.length,
        completedTopics,
        progressPercent: Math.round(avgProgress),
        questionAccuracy: accuracy,
        totalErrors: s.errorEntries.length,
        unresolvedErrors: s.errorEntries.filter((e) => !e.isResolved).length,
      };
    });

    return success(res, performance);
  } catch (err) {
    next(err);
  }
};

// Consistência semanal (dias estudados)
const getConsistency = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const weeks = parseInt(req.query.weeks) || 12;

    const startDate = dayjs().subtract(weeks, 'week').startOf('week').toDate();

    const completedTasks = await prisma.studyTask.findMany({
      where: {
        studyPlan: { userId },
        isCompleted: true,
        completedAt: { gte: startDate },
      },
      select: { completedAt: true },
    });

    // Calcular dias únicos por semana
    const byWeek = {};
    completedTasks.forEach((t) => {
      const week = dayjs(t.completedAt).startOf('week').format('YYYY-MM-DD');
      if (!byWeek[week]) byWeek[week] = new Set();
      byWeek[week].add(dayjs(t.completedAt).format('YYYY-MM-DD'));
    });

    const result = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const weekStart = dayjs().subtract(i, 'week').startOf('week').format('YYYY-MM-DD');
      result.push({
        week: weekStart,
        daysStudied: byWeek[weekStart]?.size || 0,
      });
    }

    return success(res, result);
  } catch (err) {
    next(err);
  }
};

module.exports = { getDashboard, getStudyHistory, getSubjectPerformance, getConsistency };
