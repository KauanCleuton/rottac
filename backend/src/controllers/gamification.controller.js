const prisma = require('../utils/prisma');
const { success } = require('../utils/response');

const XP_PER_LEVEL = 500;

const BADGES = [
  { id: 'first_study', name: 'Primeira Aula', description: 'Completou sua primeira tarefa', xpRequired: 10 },
  { id: 'streak_7', name: 'Semana Consistente', description: '7 dias seguidos estudando', streakRequired: 7 },
  { id: 'streak_30', name: 'Mês de Dedicação', description: '30 dias seguidos estudando', streakRequired: 30 },
  { id: 'hours_10', name: 'Estudante Dedicado', description: '10 horas de estudo acumuladas', hoursRequired: 10 },
  { id: 'hours_100', name: 'Centurião do Estudo', description: '100 horas de estudo acumuladas', hoursRequired: 100 },
  { id: 'questions_100', name: 'Resolvedor', description: '100 questões respondidas', questionsRequired: 100 },
  { id: 'flashcards_50', name: 'Mestre dos Cards', description: '50 flashcards revisados', flashcardsRequired: 50 },
  { id: 'errors_master', name: 'Aprendendo com Erros', description: '20 erros registrados no caderno', errorsRequired: 20 },
];

const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [gami, questionCount, totalErrors] = await Promise.all([
      prisma.gamification.findUnique({ where: { userId } }),
      prisma.questionLog.count({ where: { userId } }),
      prisma.errorEntry.count({ where: { userId } }),
    ]);

    if (!gami) return success(res, null);

    // Calcular nível atual
    const level = Math.floor(gami.xp / XP_PER_LEVEL) + 1;
    const xpCurrentLevel = gami.xp % XP_PER_LEVEL;
    const xpToNextLevel = XP_PER_LEVEL - xpCurrentLevel;

    // Verificar badges conquistados
    const earnedBadges = JSON.parse(gami.badges || '[]');
    const newBadges = [];

    for (const badge of BADGES) {
      if (earnedBadges.includes(badge.id)) continue;

      let earned = false;
      if (badge.xpRequired && gami.xp >= badge.xpRequired) earned = true;
      if (badge.streakRequired && gami.streak >= badge.streakRequired) earned = true;
      if (badge.hoursRequired && gami.totalHours >= badge.hoursRequired) earned = true;
      if (badge.questionsRequired && questionCount >= badge.questionsRequired) earned = true;
      if (badge.errorsRequired && totalErrors >= badge.errorsRequired) earned = true;

      if (earned) {
        newBadges.push(badge.id);
        earnedBadges.push(badge.id);
      }
    }

    // Salvar novos badges e nível
    const updatedGami = await prisma.gamification.update({
      where: { userId },
      data: {
        level,
        badges: JSON.stringify(earnedBadges),
      },
    });

    return success(res, {
      ...updatedGami,
      level,
      xpCurrentLevel,
      xpToNextLevel,
      xpPerLevel: XP_PER_LEVEL,
      progressPercent: Math.round((xpCurrentLevel / XP_PER_LEVEL) * 100),
      earnedBadges: earnedBadges.map((id) => BADGES.find((b) => b.id === id)).filter(Boolean),
      newBadges: newBadges.map((id) => BADGES.find((b) => b.id === id)).filter(Boolean),
      allBadges: BADGES,
      questionCount,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getProfile };
