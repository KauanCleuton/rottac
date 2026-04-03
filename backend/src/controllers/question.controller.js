const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');

const getLogs = async (req, res, next) => {
  try {
    const { subjectId, topicId, isCorrect } = req.query;
    const where = { userId: req.user.id };
    if (subjectId) where.subjectId = subjectId;
    if (topicId) where.topicId = topicId;
    if (isCorrect !== undefined) where.isCorrect = isCorrect === 'true';

    const logs = await prisma.questionLog.findMany({
      where,
      include: { subject: true, topic: true },
      orderBy: { loggedAt: 'desc' },
      take: 200,
    });
    return success(res, logs);
  } catch (err) {
    next(err);
  }
};

const getStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [bySubject, overall] = await Promise.all([
      prisma.$queryRaw`
        SELECT s.id, s.name, s.color,
               COUNT(ql.id) as total,
               SUM(CASE WHEN ql.isCorrect = 1 THEN 1 ELSE 0 END) as correct,
               ROUND(SUM(CASE WHEN ql.isCorrect = 1 THEN 1 ELSE 0 END) / COUNT(ql.id) * 100, 1) as accuracy
        FROM question_logs ql
        JOIN subjects s ON s.id = ql.subjectId
        WHERE ql.userId = ${userId}
        GROUP BY s.id, s.name, s.color
        ORDER BY total DESC
      `,
      prisma.questionLog.aggregate({
        where: { userId },
        _count: { id: true },
      }),
    ]);

    const correct = await prisma.questionLog.count({
      where: { userId, isCorrect: true },
    });

    const total = overall._count.id;
    return success(res, {
      total,
      correct,
      incorrect: total - correct,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      bySubject,
    });
  } catch (err) {
    next(err);
  }
};

const createLog = async (req, res, next) => {
  try {
    const { subjectId, topicId, source, isCorrect, timeSpent, notes } = req.body;

    const log = await prisma.questionLog.create({
      data: {
        userId: req.user.id,
        subjectId,
        topicId: topicId || null,
        source: source || null,
        isCorrect,
        timeSpent: timeSpent || null,
        notes: notes || null,
      },
    });

    // XP por questão
    await prisma.gamification.updateMany({
      where: { userId: req.user.id },
      data: { xp: { increment: isCorrect ? 5 : 2 } },
    });

    return created(res, log, 'Questão registrada');
  } catch (err) {
    next(err);
  }
};

const bulkCreate = async (req, res, next) => {
  try {
    const { logs } = req.body; // Array de { subjectId, topicId, isCorrect, source }

    const data = logs.map((l) => ({
      ...l,
      userId: req.user.id,
      topicId: l.topicId || null,
    }));

    await prisma.questionLog.createMany({ data });

    const correct = logs.filter((l) => l.isCorrect).length;
    await prisma.gamification.updateMany({
      where: { userId: req.user.id },
      data: { xp: { increment: correct * 5 + (logs.length - correct) * 2 } },
    });

    return success(res, { created: logs.length }, `${logs.length} questões registradas`);
  } catch (err) {
    next(err);
  }
};

module.exports = { getLogs, getStats, createLog, bulkCreate };
