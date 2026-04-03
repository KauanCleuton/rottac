const prisma = require('../utils/prisma');
const { success, created } = require('../utils/response');

const logEmotion = async (req, res, next) => {
  try {
    const { emotion, energy, notes } = req.body;
    const log = await prisma.emotionLog.create({
      data: {
        userId: req.user.id,
        emotion,
        energy: parseInt(energy),
        notes: notes || null,
      },
    });
    return created(res, log, 'Estado emocional registrado');
  } catch (err) {
    next(err);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const logs = await prisma.emotionLog.findMany({
      where: { userId: req.user.id },
      orderBy: { loggedAt: 'desc' },
      take: 30,
    });
    return success(res, logs);
  } catch (err) {
    next(err);
  }
};

module.exports = { logEmotion, getHistory };
