const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');
const dayjs = require('dayjs');

const getPlans = async (req, res, next) => {
  try {
    const plans = await prisma.studyPlan.findMany({
      where: { userId: req.user.id },
      include: {
        tasks: {
          include: { topic: { include: { module: { include: { subject: true } } } } },
          orderBy: [{ scheduledDate: 'asc' }, { order: 'asc' }],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, plans);
  } catch (err) {
    next(err);
  }
};

const getActivePlan = async (req, res, next) => {
  try {
    const plan = await prisma.studyPlan.findFirst({
      where: { userId: req.user.id, isActive: true },
      include: {
        tasks: {
          include: { topic: { include: { module: { include: { subject: true } } } } },
          orderBy: [{ scheduledDate: 'asc' }, { order: 'asc' }],
        },
      },
    });
    return success(res, plan);
  } catch (err) {
    next(err);
  }
};

const getTodayTasks = async (req, res, next) => {
  try {
    const today = dayjs().startOf('day').toDate();
    const tomorrow = dayjs().endOf('day').toDate();

    const tasks = await prisma.studyTask.findMany({
      where: {
        studyPlan: { userId: req.user.id, isActive: true },
        scheduledDate: { gte: today, lte: tomorrow },
      },
      include: {
        topic: { include: { module: { include: { subject: true } } } },
      },
      orderBy: { order: 'asc' },
    });

    const totalMinutes = tasks.reduce((acc, t) => acc + t.estimatedMinutes, 0);
    const completedMinutes = tasks
      .filter((t) => t.isCompleted)
      .reduce((acc, t) => acc + t.estimatedMinutes, 0);

    return success(res, {
      tasks,
      summary: {
        total: tasks.length,
        completed: tasks.filter((t) => t.isCompleted).length,
        pending: tasks.filter((t) => !t.isCompleted).length,
        totalMinutes,
        completedMinutes,
        progressPercent: totalMinutes > 0 ? Math.round((completedMinutes / totalMinutes) * 100) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

const createPlan = async (req, res, next) => {
  try {
    const { name, startDate, endDate } = req.body;

    // Desativar plano anterior
    await prisma.studyPlan.updateMany({
      where: { userId: req.user.id, isActive: true },
      data: { isActive: false },
    });

    const plan = await prisma.studyPlan.create({
      data: {
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        userId: req.user.id,
      },
    });

    return created(res, plan, 'Plano criado com sucesso');
  } catch (err) {
    next(err);
  }
};

// Geração automática de cronograma baseado nas disciplinas e rotina do usuário
const generateAutoSchedule = async (req, res, next) => {
  try {
    const { planId, startDate, endDate } = req.body;

    const [subjects, user] = await Promise.all([
      prisma.subject.findMany({
        where: { userId: req.user.id },
        include: { modules: { include: { topics: { where: { isCompleted: false } } } } },
        orderBy: { weight: 'desc' },
      }),
      prisma.user.findUnique({ where: { id: req.user.id }, include: { routines: true } }),
    ]);

    const tasks = [];
    const start = dayjs(startDate);
    const end = dayjs(endDate);
    let currentDate = start;
    let topicQueue = [];

    // Montar fila de tópicos priorizados por peso da disciplina
    for (const subject of subjects) {
      for (const module of subject.modules) {
        for (const topic of module.topics) {
          topicQueue.push({
            topicId: topic.id,
            title: `${subject.name} - ${topic.name}`,
            estimatedMinutes: Math.round(topic.estimatedHours * 60),
            subjectWeight: subject.weight,
          });
        }
      }
    }

    // Distribuir tópicos nos dias com estudo disponível
    let topicIndex = 0;
    while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
      const dayOfWeek = currentDate.day();
      const dayRoutines = user.routines.filter(
        (r) => r.dayOfWeek === dayOfWeek && r.type === 'ESTUDO'
      );

      if (dayRoutines.length > 0 && topicIndex < topicQueue.length) {
        let remainingMinutes = dayRoutines.reduce((acc, r) => {
          const [sh, sm] = r.startTime.split(':').map(Number);
          const [eh, em] = r.endTime.split(':').map(Number);
          return acc + (eh * 60 + em) - (sh * 60 + sm);
        }, 0);

        let order = 0;
        while (remainingMinutes > 0 && topicIndex < topicQueue.length) {
          const topic = topicQueue[topicIndex];
          const mins = Math.min(topic.estimatedMinutes, remainingMinutes);

          tasks.push({
            studyPlanId: planId,
            topicId: topic.topicId,
            title: topic.title,
            scheduledDate: currentDate.toDate(),
            estimatedMinutes: mins,
            order: order++,
            type: 'LEITURA',
          });

          remainingMinutes -= mins;
          if (mins >= topic.estimatedMinutes) topicIndex++;
          else {
            topicQueue[topicIndex] = { ...topic, estimatedMinutes: topic.estimatedMinutes - mins };
          }
        }

        // Adicionar revisão no final do dia
        if (tasks.length > 0) {
          tasks.push({
            studyPlanId: planId,
            topicId: null,
            title: 'Revisão rápida do dia',
            scheduledDate: currentDate.toDate(),
            estimatedMinutes: 15,
            order: order++,
            type: 'REVISAO',
          });
        }
      }

      currentDate = currentDate.add(1, 'day');
    }

    if (tasks.length > 0) {
      await prisma.studyTask.createMany({ data: tasks });
    }

    const plan = await prisma.studyPlan.findUnique({
      where: { id: planId },
      include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { order: 'asc' }] } },
    });

    return success(res, plan, `Cronograma gerado com ${tasks.length} tarefas`);
  } catch (err) {
    next(err);
  }
};

const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, startDate, endDate, status } = req.body;

    const plan = await prisma.studyPlan.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!plan) return notFound(res, 'Plano não encontrado');

    const updated = await prisma.studyPlan.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(status && { status }),
      },
    });
    return success(res, updated, 'Plano atualizado');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPlans, getActivePlan, getTodayTasks,
  createPlan, generateAutoSchedule, updatePlan,
};
