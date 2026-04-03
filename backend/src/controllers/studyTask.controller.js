const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');

const completeTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { actualMinutes } = req.body;

    const task = await prisma.studyTask.findFirst({
      where: { id, studyPlan: { userId: req.user.id } },
    });
    if (!task) return notFound(res, 'Tarefa não encontrada');

    const updated = await prisma.studyTask.update({
      where: { id },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        actualMinutes: actualMinutes || task.estimatedMinutes,
      },
    });

    // Atualizar tópico se vinculado
    if (task.topicId) {
      await prisma.topic.update({
        where: { id: task.topicId },
        data: { lastStudiedAt: new Date() },
      });
    }

    // Atualizar XP de gamificação
    await prisma.gamification.updateMany({
      where: { userId: req.user.id },
      data: { xp: { increment: 10 } },
    });

    // Recalcular streak
    await updateStreak(req.user.id);

    return success(res, updated, 'Tarefa concluída!');
  } catch (err) {
    next(err);
  }
};

const uncompleteTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await prisma.studyTask.update({
      where: { id },
      data: { isCompleted: false, completedAt: null, actualMinutes: null },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

const createTask = async (req, res, next) => {
  try {
    const { studyPlanId, topicId, title, description, scheduledDate, estimatedMinutes, type, order } = req.body;

    const plan = await prisma.studyPlan.findFirst({
      where: { id: studyPlanId, userId: req.user.id },
    });
    if (!plan) return notFound(res, 'Plano não encontrado');

    const task = await prisma.studyTask.create({
      data: {
        studyPlanId,
        topicId,
        title,
        description,
        scheduledDate: new Date(scheduledDate),
        estimatedMinutes: estimatedMinutes || 60,
        type: type || 'LEITURA',
        order: order || 0,
      },
    });

    return created(res, task);
  } catch (err) {
    next(err);
  }
};

const updateTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, scheduledDate, estimatedMinutes, type, order } = req.body;

    const task = await prisma.studyTask.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(scheduledDate && { scheduledDate: new Date(scheduledDate) }),
        ...(estimatedMinutes && { estimatedMinutes }),
        ...(type && { type }),
        ...(order !== undefined && { order }),
      },
    });
    return success(res, task, 'Tarefa atualizada');
  } catch (err) {
    next(err);
  }
};

const deleteTask = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.studyTask.delete({ where: { id } });
    return success(res, null, 'Tarefa removida');
  } catch (err) {
    next(err);
  }
};

async function updateStreak(userId) {
  const gami = await prisma.gamification.findUnique({ where: { userId } });
  if (!gami) return;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterday);
  yesterdayEnd.setHours(23, 59, 59, 999);

  const studiedYesterday = await prisma.studyTask.count({
    where: {
      studyPlan: { userId },
      isCompleted: true,
      completedAt: { gte: yesterday, lte: yesterdayEnd },
    },
  });

  const newStreak = studiedYesterday > 0 ? gami.streak + 1 : 1;
  const bestStreak = Math.max(newStreak, gami.bestStreak);

  await prisma.gamification.update({
    where: { userId },
    data: { streak: newStreak, bestStreak, lastStudyAt: new Date() },
  });
}

module.exports = { completeTask, uncompleteTask, createTask, updateTask, deleteTask };
