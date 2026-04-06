/**
 * Desafio Diário de Questão
 * Todo dia o sistema seleciona 1 questão baseada nas fraquezas do usuário
 * e mantém um streak de respostas diárias.
 */
const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const dayjs = require('dayjs');

// ─── GET /daily-challenge/today ────────────────────────────────────────────
const getToday = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const todayStart = dayjs().startOf('day').toDate();
    const todayEnd = dayjs().endOf('day').toDate();

    // Verifica se já tem desafio do dia
    let challenge = await prisma.dailyChallenge.findFirst({
      where: { userId, createdAt: { gte: todayStart, lte: todayEnd } },
      include: { subject: { select: { name: true, color: true } } },
    });

    if (!challenge) {
      challenge = await generateChallenge(userId);
    }

    // Calcula streak atual
    const streak = await calcStreak(userId);

    return success(res, { challenge, streak });
  } catch (err) { next(err); }
};

// ─── POST /daily-challenge/:id/answer ─────────────────────────────────────
const answer = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { selectedOption, timeSpent } = req.body;

    const challenge = await prisma.dailyChallenge.findFirst({ where: { id, userId } });
    if (!challenge) return res.status(404).json({ error: 'Desafio não encontrado.' });
    if (challenge.answeredAt) return res.status(400).json({ error: 'Desafio já respondido hoje.' });

    const isCorrect = selectedOption === challenge.correctOption;

    await prisma.dailyChallenge.update({
      where: { id },
      data: {
        isCorrect,
        userAnswer: selectedOption,
        answeredAt: new Date(),
        timeSpent,
      },
    });

    // Registra no log de questões
    if (challenge.subjectId) {
      await prisma.questionLog.create({
        data: {
          userId,
          subjectId: challenge.subjectId,
          isCorrect,
          source: 'desafio_diario',
          timeSpent,
        },
      });
    }

    // XP + streak
    const xpEarned = isCorrect ? 30 : 5;
    await prisma.gamification.updateMany({
      where: { userId },
      data: { xp: { increment: xpEarned } },
    });

    const streak = await calcStreak(userId);

    // Notificação se streak alto
    if (streak > 0 && streak % 7 === 0) {
      await prisma.notification.create({
        data: {
          userId,
          title: `🔥 ${streak} dias de streak!`,
          body: `Você respondeu o desafio diário por ${streak} dias seguidos. Incrível consistência!`,
          type: 'SISTEMA',
        },
      });
    }

    return success(res, {
      isCorrect,
      correctOption: challenge.correctOption,
      explanation: challenge.explanation,
      xpEarned,
      streak,
      message: isCorrect ? 'Correto! 🎯' : 'Errou! Mas você aprendeu algo novo.',
    });
  } catch (err) { next(err); }
};

// ─── GET /daily-challenge/history ─────────────────────────────────────────
const getHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const challenges = await prisma.dailyChallenge.findMany({
      where: { userId },
      include: { subject: { select: { name: true, color: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const answered = challenges.filter((c) => c.answeredAt);
    const correct = answered.filter((c) => c.isCorrect);
    const streak = await calcStreak(userId);

    return success(res, {
      challenges,
      stats: {
        total: challenges.length,
        answered: answered.length,
        correct: correct.length,
        accuracy: answered.length > 0 ? Math.round((correct.length / answered.length) * 100) : 0,
        streak,
      },
    });
  } catch (err) { next(err); }
};

// ─── Gera desafio do dia ────────────────────────────────────────────────────
async function generateChallenge(userId) {
  // Pega disciplinas com mais erros recentes
  const recentErrors = await prisma.questionLog.groupBy({
    by: ['subjectId'],
    where: {
      userId,
      isCorrect: false,
      loggedAt: { gte: dayjs().subtract(14, 'day').toDate() },
    },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 3,
  });

  // Pega disciplinas do usuário como fallback
  const subjects = await prisma.subject.findMany({
    where: { userId },
    select: { id: true, name: true, color: true },
    take: 5,
  });

  // Escolhe disciplina-alvo (preferência: com mais erros)
  const targetSubjectId = recentErrors[0]?.subjectId || subjects[0]?.id || null;
  const targetSubject = subjects.find((s) => s.id === targetSubjectId);

  // Banco de questões interno (exemplos por área)
  const questionBank = getQuestionForSubject(targetSubject?.name || 'Geral');

  const challengeData = {
    userId,
    subjectId: targetSubjectId,
    question: questionBank.question,
    options: JSON.stringify(questionBank.options),
    correctOption: questionBank.correct,
    explanation: questionBank.explanation,
    difficulty: questionBank.difficulty || 'MEDIO',
    banca: questionBank.banca || null,
  };

  return prisma.dailyChallenge.create({
    data: challengeData,
    include: { subject: { select: { name: true, color: true } } },
  });
}

// ─── Calcula streak ─────────────────────────────────────────────────────────
async function calcStreak(userId) {
  const challenges = await prisma.dailyChallenge.findMany({
    where: { userId, answeredAt: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { createdAt: true, answeredAt: true },
  });

  let streak = 0;
  let checkDate = dayjs().startOf('day');

  for (const c of challenges) {
    const challengeDay = dayjs(c.createdAt).startOf('day');
    if (challengeDay.isSame(checkDate) || challengeDay.isSame(checkDate.subtract(1, 'day'))) {
      streak++;
      checkDate = challengeDay;
    } else {
      break;
    }
  }

  return streak;
}

// ─── Banco interno de questões modelo ───────────────────────────────────────
function getQuestionForSubject(subjectName) {
  const norm = subjectName.toLowerCase();

  // Aqui ficam questões reais por disciplina.
  // Em produção, esses dados viriam de um banco de questões externo.
  const banks = {
    'Direito Constitucional': [
      {
        question: 'Segundo a CF/88, os direitos e garantias fundamentais têm aplicação:',
        options: ['Mediata, dependendo de lei regulamentadora', 'Imediata, independentemente de lei regulamentadora', 'Restrita a cidadãos brasileiros natos', 'Facultativa, a critério do legislador'],
        correct: 'B',
        explanation: 'Art. 5º, §1º da CF/88: "As normas definidoras dos direitos e garantias fundamentais têm aplicação imediata."',
        banca: 'CESPE',
        difficulty: 'MEDIO',
      },
    ],
    'Direito Administrativo': [
      {
        question: 'O princípio da legalidade na Administração Pública significa que:',
        options: ['O administrador pode fazer tudo que a lei não proíbe', 'O administrador só pode fazer o que a lei autoriza', 'A lei é optativa para a Administração', 'O gestor tem liberdade absoluta de ação'],
        correct: 'B',
        explanation: 'Na Administração Pública, vigora a legalidade estrita: o agente público só pode agir quando há previsão legal expressa.',
        banca: 'FCC',
        difficulty: 'FACIL',
      },
    ],
    'Raciocínio Lógico': [
      {
        question: 'Se "Todo A é B" e "Algum B é C", podemos concluir que:',
        options: ['Todo A é C', 'Algum A é C', 'Nenhum A é C', 'Nada pode ser concluído'],
        correct: 'D',
        explanation: 'Não é possível concluir nada sobre A e C diretamente. "Todo A é B" e "Algum B é C" não garantem relação entre A e C.',
        banca: 'CESPE',
        difficulty: 'DIFICIL',
      },
    ],
    'Língua Portuguesa': [
      {
        question: 'A palavra "Portanto" é classificada como:',
        options: ['Conjunção adversativa', 'Conjunção conclusiva', 'Conjunção aditiva', 'Conjunção causal'],
        correct: 'B',
        explanation: '"Portanto" é conjunção coordenativa conclusiva, pois indica conclusão de uma ideia anteriormente expressa.',
        banca: 'FGV',
        difficulty: 'FACIL',
      },
    ],
    'Matemática': [
      {
        question: 'Se 20% de um número é 30, qual é o número?',
        options: ['120', '150', '100', '180'],
        correct: 'B',
        explanation: '20% = 30 → 100% = 30 ÷ 0,20 = 150',
        banca: 'CESPE',
        difficulty: 'FACIL',
      },
    ],
  };

  // Encontra a melhor correspondência
  for (const [key, questions] of Object.entries(banks)) {
    if (norm.includes(key.toLowerCase()) || key.toLowerCase().includes(norm.split(' ')[0])) {
      const q = questions[Math.floor(Math.random() * questions.length)];
      return q;
    }
  }

  // Default: questão genérica de raciocínio
  return {
    question: 'Em uma sequência lógica: 2, 4, 8, 16, ___. Qual é o próximo número?',
    options: ['24', '28', '32', '30'],
    correct: 'C',
    explanation: 'A sequência é geométrica com razão 2: cada termo é o dobro do anterior. 16 × 2 = 32.',
    banca: 'CESPE',
    difficulty: 'FACIL',
  };
}

module.exports = { getToday, answer, getHistory };
