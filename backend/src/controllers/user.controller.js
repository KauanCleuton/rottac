const prisma = require('../utils/prisma');
const { success, notFound, badRequest } = require('../utils/response');

const getProfile = async (req, res, next) => {
  try {
    const raw = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { routines: true, gamification: true },
    });
    if (!raw) return notFound(res);
    const { password: _, ...user } = raw;
    return success(res, user);
  } catch (err) {
    next(err);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const {
      name, examName, examDate, targetRole, experienceLevel,
      learningStyle, dailyStudyHours, avatar,
    } = req.body;

    const raw = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name && { name }),
        ...(examName !== undefined && { examName }),
        ...(examDate !== undefined && { examDate: examDate ? new Date(examDate) : null }),
        ...(targetRole !== undefined && { targetRole }),
        ...(experienceLevel && { experienceLevel }),
        ...(learningStyle && { learningStyle }),
        ...(dailyStudyHours !== undefined && { dailyStudyHours: parseFloat(dailyStudyHours) }),
        ...(avatar !== undefined && { avatar }),
      },
    });
    const { password: _, ...user } = raw;
    return success(res, user, 'Perfil atualizado com sucesso');
  } catch (err) {
    next(err);
  }
};

// ─── Rotinas ───────────────────────────────────────────────────────────────

const getRoutines = async (req, res, next) => {
  try {
    const routines = await prisma.routine.findMany({
      where: { userId: req.user.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return success(res, routines);
  } catch (err) {
    next(err);
  }
};

const saveRoutines = async (req, res, next) => {
  try {
    const { routines } = req.body; // Array de { dayOfWeek, startTime, endTime, type, label }

    // Deletar antigas e recriar
    await prisma.routine.deleteMany({ where: { userId: req.user.id } });

    const created = await prisma.routine.createMany({
      data: routines.map((r) => ({ ...r, userId: req.user.id })),
    });

    const all = await prisma.routine.findMany({ where: { userId: req.user.id } });
    return success(res, all, 'Rotina salva com sucesso');
  } catch (err) {
    next(err);
  }
};

module.exports = { getProfile, updateProfile, getRoutines, saveRoutines };
