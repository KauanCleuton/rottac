const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');

const startSession = async (req, res, next) => {
  try {
    const { studyTaskId, technique, workMinutes, breakMinutes } = req.body;

    // Encerrar sessão ativa anterior
    await prisma.focusSession.updateMany({
      where: { userId: req.user.id, status: 'ATIVO' },
      data: { status: 'CANCELADO', endedAt: new Date() },
    });

    const session = await prisma.focusSession.create({
      data: {
        userId: req.user.id,
        studyTaskId: studyTaskId || null,
        technique: technique || 'POMODORO',
        workMinutes: workMinutes || 25,
        breakMinutes: breakMinutes || 5,
        status: 'ATIVO',
      },
    });
    return created(res, session, 'Sessão de foco iniciada');
  } catch (err) {
    next(err);
  }
};

const updateSession = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, cycles, totalMinutes } = req.body;

    const session = await prisma.focusSession.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!session) return notFound(res, 'Sessão não encontrada');

    const data = {};
    if (status) data.status = status;
    if (cycles !== undefined) data.cycles = cycles;
    if (totalMinutes !== undefined) data.totalMinutes = totalMinutes;
    if (status === 'CONCLUIDO' || status === 'CANCELADO') data.endedAt = new Date();

    const updated = await prisma.focusSession.update({ where: { id }, data });

    // Atualizar total de horas de gamificação
    if (status === 'CONCLUIDO' && totalMinutes) {
      await prisma.gamification.updateMany({
        where: { userId: req.user.id },
        data: {
          xp: { increment: Math.floor(totalMinutes / 5) },
          totalHours: { increment: totalMinutes / 60 },
        },
      });
    }

    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const sessions = await prisma.focusSession.findMany({
      where: { userId: req.user.id, status: 'CONCLUIDO' },
      include: { studyTask: true },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return success(res, sessions);
  } catch (err) {
    next(err);
  }
};

module.exports = { startSession, updateSession, getHistory };
