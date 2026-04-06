/**
 * Revisão Pós-Simulado Automática
 * Após concluir um simulado, o sistema:
 * 1. Cria entradas no caderno de erros para as questões erradas
 * 2. Gera flashcards automáticos para os conceitos errados
 * 3. Monta plano de revisão para os próximos 3 dias
 * 4. Registra insights de desempenho
 */
const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const dayjs = require('dayjs');

// ─── POST /post-simulado/analyze ──────────────────────────────────────────
const analyzeSimulado = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      title,           // nome do simulado
      questions,       // array de { subjectId, topicId, isCorrect, questionText, correctAnswer, userAnswer, explanation, banca }
      totalTime,       // minutos gastos
      date,
    } = req.body;

    if (!questions || questions.length === 0) {
      return res.status(400).json({ error: 'Nenhuma questão enviada.' });
    }

    const wrong = questions.filter((q) => !q.isCorrect);
    const correct = questions.filter((q) => q.isCorrect);

    // ── 1. Registra logs de questão ────────────────────────────────────
    const logs = questions.map((q) => ({
      userId,
      subjectId: q.subjectId,
      topicId: q.topicId || null,
      isCorrect: q.isCorrect,
      source: q.banca || title || 'simulado',
      timeSpent: q.timeSpent || null,
    }));
    await prisma.questionLog.createMany({ data: logs });

    // ── 2. Cria entradas no caderno de erros para questões erradas ─────
    const errorEntries = [];
    for (const q of wrong) {
      if (!q.subjectId) continue;

      const entry = await prisma.errorEntry.create({
        data: {
          userId,
          subjectId: q.subjectId,
          topicId: q.topicId || null,
          title: q.questionText
            ? q.questionText.substring(0, 120)
            : `Erro em ${q.banca || 'simulado'} — ${dayjs(date || undefined).format('DD/MM')}`,
          description: q.questionText || '',
          errorType: detectErrorType(q),
          correctAnswer: q.correctAnswer || '',
          myAnswer: q.userAnswer || '',
          explanation: q.explanation || '',
          source: q.banca || title,
          nextReviewAt: dayjs().add(1, 'day').toDate(),
        },
      });
      errorEntries.push(entry);
    }

    // ── 3. Gera flashcards automáticos para os erros ───────────────────
    const flashcardsCreated = [];
    for (const q of wrong) {
      if (!q.questionText || !q.correctAnswer || !q.subjectId) continue;

      // Só cria flashcard se tem conteúdo suficiente
      if (q.questionText.length < 10 || q.correctAnswer.length < 5) continue;

      const card = await prisma.flashcard.create({
        data: {
          userId,
          subjectId: q.subjectId,
          topicId: q.topicId || null,
          front: q.questionText.substring(0, 400),
          back: q.correctAnswer + (q.explanation ? `\n\n💡 ${q.explanation.substring(0, 200)}` : ''),
          difficulty: 'DIFICIL', // Errou → começa como difícil
        },
      });
      flashcardsCreated.push(card);
    }

    // ── 4. Plano de revisão: próximos 3 dias ───────────────────────────
    // Agrupa erros por disciplina
    const errorsBySubject = {};
    for (const q of wrong) {
      if (q.subjectId) {
        errorsBySubject[q.subjectId] = (errorsBySubject[q.subjectId] || 0) + 1;
      }
    }

    const revisionPlan = [];
    const subjects = await prisma.subject.findMany({
      where: { id: { in: Object.keys(errorsBySubject) } },
      select: { id: true, name: true },
    });

    const subjectMap = {};
    subjects.forEach((s) => { subjectMap[s.id] = s.name; });

    Object.entries(errorsBySubject)
      .sort((a, b) => b[1] - a[1])
      .forEach(([subjectId, count], idx) => {
        const daysAhead = (idx % 3) + 1;
        revisionPlan.push({
          day: dayjs().add(daysAhead, 'day').format('DD/MM/YYYY'),
          subject: subjectMap[subjectId] || subjectId,
          type: count >= 5 ? 'FORCA_BRUTA' : 'REVISAO',
          errors: count,
          action: count >= 5
            ? `Revisão intensiva: ${count} erros — recomendado 45min`
            : `Revisar ${count} erros no caderno`,
        });
      });

    // ── 5. Score e análise ──────────────────────────────────────────────
    const totalQ = questions.length;
    const accuracy = Math.round((correct.length / totalQ) * 100);
    const score = {
      total: totalQ,
      correct: correct.length,
      wrong: wrong.length,
      accuracy,
      grade: accuracy >= 70 ? 'APROVADO' : accuracy >= 50 ? 'REGULAR' : 'REPROVADO',
      timeMinutes: totalTime,
      avgTimePerQuestion: totalTime && totalQ ? Math.round((totalTime * 60) / totalQ) : null,
    };

    // Detecta disciplinas com alto índice de erros (> 60%)
    const criticalSubjects = Object.entries(errorsBySubject)
      .filter(([id, count]) => {
        const total = questions.filter((q) => q.subjectId === id).length;
        return total > 0 && (count / total) >= 0.6;
      })
      .map(([id]) => subjectMap[id] || id);

    // ── 6. Insight + notificação ─────────────────────────────────────────
    const insight = {
      grade: score.grade,
      criticalSubjects,
      topMistake: getTopMistakeType(wrong),
      recommendation: getRecommendation(accuracy, criticalSubjects),
    };

    if (wrong.length > 0) {
      await prisma.analysisInsight.create({
        data: {
          userId,
          type: accuracy < 50 ? 'QUEDA_DESEMPENHO' : 'PADRAO_ERRO',
          title: `Análise do Simulado: ${accuracy}% de acerto`,
          body: insight.recommendation,
          severity: accuracy < 50 ? 'CRITICO' : accuracy < 70 ? 'AVISO' : 'INFO',
          data: { score, criticalSubjects, revisionPlan },
          expiresAt: dayjs().add(7, 'day').toDate(),
        },
      });
    }

    await prisma.notification.create({
      data: {
        userId,
        title: `Simulado concluído: ${accuracy}% de acerto`,
        body: `${wrong.length} erros identificados. ${flashcardsCreated.length} flashcards criados. Plano de revisão gerado.`,
        type: 'SISTEMA',
        data: { accuracy, errors: wrong.length, flashcards: flashcardsCreated.length },
      },
    });

    // XP
    const xpEarned = Math.round(correct.length * 10 + totalQ * 2);
    await prisma.gamification.updateMany({
      where: { userId },
      data: { xp: { increment: xpEarned } },
    });

    await prisma.behaviorEvent.create({
      data: {
        userId,
        type: accuracy >= 70 ? 'ALTO_DESEMPENHO' : 'BAIXO_DESEMPENHO',
        metadata: { type: 'simulado', accuracy, totalQ, title },
      },
    });

    return success(res, {
      score,
      insight,
      errorEntriesCreated: errorEntries.length,
      flashcardsCreated: flashcardsCreated.length,
      revisionPlan,
      xpEarned,
      message: `Análise completa! ${errorEntries.length} erros no caderno, ${flashcardsCreated.length} flashcards gerados.`,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /post-simulado/history ────────────────────────────────────────────
const getHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    // Retorna insights de simulado dos últimos 30 dias
    const insights = await prisma.analysisInsight.findMany({
      where: {
        userId,
        type: { in: ['PADRAO_ERRO', 'QUEDA_DESEMPENHO'] },
        generatedAt: { gte: dayjs().subtract(30, 'day').toDate() },
      },
      orderBy: { generatedAt: 'desc' },
      take: 20,
    });
    return success(res, insights);
  } catch (err) {
    next(err);
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────
function detectErrorType(q) {
  const text = ((q.questionText || '') + (q.userAnswer || '')).toLowerCase();
  if (text.includes('interpreta') || text.includes('texto') || text.includes('leitura')) {
    return 'INTERPRETACAO';
  }
  if (text.includes('calculo') || text.includes('calcul') || text.includes('matemat')) {
    return 'CALCULO';
  }
  return 'ESQUECIMENTO'; // default
}

function getTopMistakeType(wrongQuestions) {
  const types = {};
  for (const q of wrongQuestions) {
    const t = detectErrorType(q);
    types[t] = (types[t] || 0) + 1;
  }
  return Object.entries(types).sort((a, b) => b[1] - a[1])[0]?.[0] || 'ESQUECIMENTO';
}

function getRecommendation(accuracy, criticalSubjects) {
  if (accuracy < 50) {
    return criticalSubjects.length > 0
      ? `Desempenho crítico! Ative o Modo Força Bruta em: ${criticalSubjects.join(', ')}. Antes de fazer mais simulados, revise os conceitos básicos.`
      : 'Desempenho abaixo do mínimo. Volte para revisão dos conteúdos antes de fazer novos simulados.';
  }
  if (accuracy < 70) {
    return criticalSubjects.length > 0
      ? `Resultado regular. Foco nos pontos fracos: ${criticalSubjects.join(', ')}. Revise o caderno de erros nos próximos 3 dias.`
      : 'Resultado regular. Use o plano de revisão gerado para corrigir os pontos fracos.';
  }
  return `Bom desempenho! ${criticalSubjects.length > 0 ? `Ainda há espaço para melhorar em: ${criticalSubjects.join(', ')}.` : 'Continue mantendo o ritmo.'}`;
}

module.exports = { analyzeSimulado, getHistory };
