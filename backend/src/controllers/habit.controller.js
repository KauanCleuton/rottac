const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');
const dayjs = require('dayjs');

const getHabits = async (req, res, next) => {
  try {
    const habits = await prisma.habit.findMany({
      where: { userId: req.user.id, isActive: true },
      include: {
        completions: {
          where: {
            completedAt: {
              gte: dayjs().startOf('week').toDate(),
            },
          },
          orderBy: { completedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const today = dayjs().format('YYYY-MM-DD');
    const habitsWithStatus = habits.map((h) => {
      const completedToday = h.completions.some(
        (c) => dayjs(c.completedAt).format('YYYY-MM-DD') === today
      );
      return { ...h, completedToday };
    });

    return success(res, habitsWithStatus);
  } catch (err) {
    next(err);
  }
};

const createHabit = async (req, res, next) => {
  try {
    const { name, description, frequency, targetDays } = req.body;
    const habit = await prisma.habit.create({
      data: {
        name,
        description: description || null,
        frequency: frequency || 'DIARIO',
        targetDays: targetDays ? JSON.stringify(targetDays) : null,
        userId: req.user.id,
      },
    });
    return created(res, habit, 'Hábito criado');
  } catch (err) {
    next(err);
  }
};

const completeHabit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const habit = await prisma.habit.findFirst({
      where: { id, userId: req.user.id },
      include: {
        completions: {
          orderBy: { completedAt: 'desc' },
          take: 2,
        },
      },
    });
    if (!habit) return notFound(res, 'Hábito não encontrado');

    // Verificar se já completou hoje
    const today = dayjs().format('YYYY-MM-DD');
    const alreadyDone = habit.completions.some(
      (c) => dayjs(c.completedAt).format('YYYY-MM-DD') === today
    );
    if (alreadyDone) return success(res, habit, 'Hábito já concluído hoje');

    await prisma.habitCompletion.create({ data: { habitId: id } });

    // Calcular streak
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const doneYesterday = habit.completions.some(
      (c) => dayjs(c.completedAt).format('YYYY-MM-DD') === yesterday
    );
    const newStreak = doneYesterday ? habit.streak + 1 : 1;
    const bestStreak = Math.max(newStreak, habit.bestStreak);

    const updated = await prisma.habit.update({
      where: { id },
      data: { streak: newStreak, bestStreak },
    });

    // XP de gamificação
    await prisma.gamification.updateMany({
      where: { userId: req.user.id },
      data: { xp: { increment: 5 } },
    });

    return success(res, updated, 'Hábito concluído!');
  } catch (err) {
    next(err);
  }
};

const deleteHabit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const habit = await prisma.habit.findFirst({ where: { id, userId: req.user.id } });
    if (!habit) return notFound(res, 'Hábito não encontrado');
    await prisma.habit.update({ where: { id }, data: { isActive: false } });
    return success(res, null, 'Hábito arquivado');
  } catch (err) {
    next(err);
  }
};

module.exports = { getHabits, createHabit, completeHabit, deleteHabit };
