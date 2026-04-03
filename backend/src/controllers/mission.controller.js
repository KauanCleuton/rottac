const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const dayjs = require('dayjs');

const getAll = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const missions = await prisma.mission.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return success(res, missions);
  } catch (err) { next(err); }
};

const accept = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const mission = await prisma.mission.findFirst({ where: { id, userId } });
    if (!mission) return res.status(404).json({ error: 'Missao nao encontrada' });

    await prisma.behaviorEvent.create({
      data: { userId, type: 'MISSAO_ACEITA', metadata: { missionId: id } },
    });
    return success(res, mission);
  } catch (err) { next(err); }
};

const complete = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const mission = await prisma.mission.update({
      where: { id },
      data: { status: 'CONCLUIDA', completedAt: new Date() },
    });

    // Aplica recompensa XP
    await prisma.gamification.updateMany({
      where: { userId },
      data: { xp: { increment: mission.xpReward } },
    });

    await prisma.behaviorEvent.create({
      data: { userId, type: 'MISSAO_CONCLUIDA', metadata: { missionId: id, xp: mission.xpReward } },
    });

    await prisma.notification.create({
      data: {
        userId,
        title: 'Missao Concluida!',
        body: `+${mission.xpReward} XP conquistados. "${mission.title}"`,
        type: 'MISSAO',
        data: { missionId: id, xpReward: mission.xpReward },
      },
    });

    return success(res, { mission, xpEarned: mission.xpReward });
  } catch (err) { next(err); }
};

const generate = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [profile, subjects, errorEntries] = await Promise.all([
      prisma.brainProfile.findUnique({ where: { userId } }),
      prisma.subject.findMany({
        where: { userId },
        include: {
          questionLogs: {
            where: { loggedAt: { gte: dayjs().subtract(14, 'day').toDate() } },
            select: { isCorrect: true },
          },
        },
      }),
      prisma.errorEntry.count({ where: { userId, isResolved: false } }),
    ]);

    const missionsToCreate = [];

    // Missão baseada em fraqueza
    const weakSubject = subjects
      .filter((s) => s.questionLogs.length >= 5)
      .map((s) => {
        const total = s.questionLogs.length;
        const correct = s.questionLogs.filter((q) => q.isCorrect).length;
        return { ...s, accuracy: (correct / total) * 100 };
      })
      .sort((a, b) => a.accuracy - b.accuracy)[0];

    if (weakSubject && weakSubject.accuracy < 60) {
      missionsToCreate.push({
        userId,
        title: `Forca Bruta: ${weakSubject.name}`,
        description: `Sua taxa de acerto em ${weakSubject.name} esta em ${Math.round(weakSubject.accuracy)}%. Resolva 30 questoes dessa disciplina hoje.`,
        type: 'FORCA_BRUTA',
        criteria: { subjectId: weakSubject.id, questoes: 30, minAccuracy: 60 },
        xpReward: 100,
        expiresAt: dayjs().endOf('day').toDate(),
      });
    }

    // Missão de revisão de erros
    if (errorEntries >= 5) {
      missionsToCreate.push({
        userId,
        title: 'Elimine seus Erros',
        description: `Voce tem ${errorEntries} erros pendentes no caderno. Resolva pelo menos 5 hoje.`,
        type: 'REVISAO',
        criteria: { errorsToResolve: 5 },
        xpReward: 75,
        expiresAt: dayjs().endOf('day').toDate(),
      });
    }

    // Missão de consistência
    if (profile?.consistencyScore < 70) {
      missionsToCreate.push({
        userId,
        title: 'Desafio de Consistencia',
        description: 'Estude pelo menos 1 hora por dia durante os proximos 3 dias.',
        type: 'CONSISTENCIA',
        criteria: { days: 3, minMinutes: 60 },
        xpReward: 150,
        expiresAt: dayjs().add(3, 'day').toDate(),
      });
    }

    // Micro-ação diária (sempre gera uma)
    missionsToCreate.push({
      userId,
      title: 'Micro-Acao do Dia',
      description: 'Resolva 10 questoes em qualquer disciplina antes das 22h.',
      type: 'MICRO_ACAO',
      criteria: { questoes: 10 },
      xpReward: 30,
      expiresAt: dayjs().endOf('day').toDate(),
    });

    const created = await prisma.mission.createMany({ data: missionsToCreate });
    const missions = await prisma.mission.findMany({
      where: { userId, status: 'ATIVA' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return success(res, missions);
  } catch (err) { next(err); }
};

module.exports = { getAll, accept, complete, generate };
