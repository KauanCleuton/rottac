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

    if (!planId) return res.status(400).json({ success: false, message: 'Crie um plano primeiro.' });

    const [subjects, user] = await Promise.all([
      prisma.subject.findMany({
        where: { userId: req.user.id },
        include: { modules: { include: { topics: { where: { isCompleted: false } } } } },
        orderBy: { weight: 'desc' },
      }),
      prisma.user.findUnique({ where: { id: req.user.id }, include: { routines: true } }),
    ]);

    if (subjects.length === 0) {
      return res.status(400).json({ success: false, message: 'Cadastre disciplinas antes de gerar o cronograma.' });
    }

    // ── Fila de itens a agendar ───────────────────────────────────────────
    // Prioridade: tópicos cadastrados. Fallback: uma tarefa por disciplina.
    const queue = [];

    for (const subject of subjects) {
      const allTopics = subject.modules.flatMap(m => m.topics);
      if (allTopics.length > 0) {
        for (const topic of allTopics) {
          queue.push({
            topicId: topic.id,
            title: `${subject.name} — ${topic.name}`,
            estimatedMinutes: Math.max(30, Math.round((topic.estimatedHours || 1) * 60)),
          });
        }
      } else {
        // Disciplina sem tópicos: cria tarefa genérica de leitura
        queue.push({
          topicId: null,
          title: `${subject.name} — Estudo`,
          estimatedMinutes: Math.round((subject.weight || 1) * 60),
        });
      }
    }

    // ── Minutos disponíveis por dia ───────────────────────────────────────
    // Se o usuário tiver rotinas de ESTUDO, usa elas; senão assume 120 min/dia
    // Calcula minutos disponíveis por dia da semana respeitando virada de meia-noite
    const calcDuration = (startTime, endTime) => {
      const [sh, sm] = (startTime || '00:00').split(':').map(Number);
      const [eh, em] = (endTime || '00:00').split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      // Virada de meia-noite: ex. 20:00 → 00:00 = 240 min
      return endMins <= startMins
        ? (24 * 60 - startMins) + endMins
        : endMins - startMins;
    };

    const routineByDay = {};
    for (const r of user.routines || []) {
      if (r.type !== 'ESTUDO') continue;
      const duration = calcDuration(r.startTime, r.endTime);
      if (duration > 0) {
        routineByDay[r.dayOfWeek] = (routineByDay[r.dayOfWeek] || 0) + duration;
      }
    }
    const hasRoutines = Object.keys(routineByDay).length > 0;
    const DEFAULT_DAILY_MINUTES = 120;

    // ── Distribuição nos dias ─────────────────────────────────────────────
    const tasks = [];
    const start = dayjs(startDate || dayjs().format('YYYY-MM-DD'));
    const end = dayjs(endDate || dayjs().add(3, 'month').format('YYYY-MM-DD'));
    let currentDate = start;
    let qi = 0; // índice na fila

    while ((currentDate.isBefore(end) || currentDate.isSame(end, 'day')) && qi < queue.length) {
      const dow = currentDate.day();
      let availableMinutes;

      if (hasRoutines) {
        availableMinutes = routineByDay[dow] || 0; // 0 = dia sem estudo na rotina
      } else {
        availableMinutes = dow === 0 ? 60 : DEFAULT_DAILY_MINUTES; // domingo menos
      }

      if (availableMinutes > 0) {
        let order = 0;
        while (availableMinutes > 0 && qi < queue.length) {
          const item = queue[qi];
          const mins = Math.min(item.estimatedMinutes, availableMinutes);

          tasks.push({
            studyPlanId: planId,
            topicId: item.topicId,
            title: item.title,
            scheduledDate: currentDate.toDate(),
            estimatedMinutes: mins,
            order: order++,
            type: 'LEITURA',
          });

          availableMinutes -= mins;
          if (mins >= item.estimatedMinutes) {
            qi++;
          } else {
            queue[qi] = { ...item, estimatedMinutes: item.estimatedMinutes - mins };
          }
        }

        // Revisão rápida no final de cada dia com conteúdo
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

      currentDate = currentDate.add(1, 'day');
    }

    // Apaga tarefas antigas do plano antes de criar as novas
    await prisma.studyTask.deleteMany({ where: { studyPlanId: planId } });

    if (tasks.length > 0) {
      await prisma.studyTask.createMany({ data: tasks });
    }

    const plan = await prisma.studyPlan.findUnique({
      where: { id: planId },
      include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { order: 'asc' }] } },
    });

    return success(res, plan, `Cronograma gerado com ${tasks.length} tarefas distribuídas até ${end.format('DD/MM/YYYY')}`);
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
