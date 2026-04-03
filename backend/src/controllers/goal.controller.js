const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');
const dayjs = require('dayjs');

const getGoals = async (req, res, next) => {
  try {
    const { period, isCompleted } = req.query;
    const where = { userId: req.user.id };
    if (period) where.period = period;
    if (isCompleted !== undefined) where.isCompleted = isCompleted === 'true';

    const goals = await prisma.goal.findMany({
      where,
      orderBy: [{ isCompleted: 'asc' }, { endDate: 'asc' }],
    });

    // Calcular progresso atual das metas de tempo
    const goalsWithProgress = await Promise.all(
      goals.map(async (goal) => {
        let current = goal.current;

        if (goal.type === 'TEMPO') {
          const tasks = await prisma.studyTask.findMany({
            where: {
              studyPlan: { userId: req.user.id },
              isCompleted: true,
              completedAt: { gte: goal.startDate, lte: goal.endDate },
            },
            select: { actualMinutes: true, estimatedMinutes: true },
          });
          current = tasks.reduce((acc, t) => acc + (t.actualMinutes || t.estimatedMinutes), 0) / 60;
        } else if (goal.type === 'QUESTOES') {
          current = await prisma.questionLog.count({
            where: {
              userId: req.user.id,
              loggedAt: { gte: goal.startDate, lte: goal.endDate },
            },
          });
        } else if (goal.type === 'TOPICOS') {
          current = await prisma.topic.count({
            where: {
              module: { subject: { userId: req.user.id } },
              isCompleted: true,
              lastStudiedAt: { gte: goal.startDate, lte: goal.endDate },
            },
          });
        }

        const percent = goal.target > 0 ? Math.min(Math.round((current / goal.target) * 100), 100) : 0;
        const isLate = !goal.isCompleted && dayjs().isAfter(goal.endDate) && percent < 100;

        return { ...goal, current, progressPercent: percent, isLate };
      })
    );

    return success(res, goalsWithProgress);
  } catch (err) {
    next(err);
  }
};

const createGoal = async (req, res, next) => {
  try {
    const { title, type, period, target, unit, startDate, endDate } = req.body;

    const goal = await prisma.goal.create({
      data: {
        title,
        type,
        period,
        target: parseFloat(target),
        unit,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        userId: req.user.id,
      },
    });
    return created(res, goal, 'Meta criada com sucesso');
  } catch (err) {
    next(err);
  }
};

const updateGoal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, target, current, isCompleted } = req.body;

    const goal = await prisma.goal.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!goal) return notFound(res, 'Meta não encontrada');

    const newCurrent = current !== undefined ? parseFloat(current) : undefined;
    const autoCompleted = newCurrent !== undefined && goal.target > 0 && newCurrent >= goal.target;

    const updated = await prisma.goal.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(target !== undefined && { target: parseFloat(target) }),
        ...(newCurrent !== undefined && { current: newCurrent }),
        ...(isCompleted !== undefined ? { isCompleted } : autoCompleted ? { isCompleted: true } : {}),
      },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

const deleteGoal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const goal = await prisma.goal.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!goal) return notFound(res, 'Meta não encontrada');
    await prisma.goal.delete({ where: { id } });
    return success(res, null, 'Meta removida');
  } catch (err) {
    next(err);
  }
};

module.exports = { getGoals, createGoal, updateGoal, deleteGoal };
