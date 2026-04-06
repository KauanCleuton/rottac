const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');

// Algoritmo SM-2 para revisão espaçada
function sm2(easeFactor, interval, repetitions, rating) {
  // rating: 0=Errou, 1=Difícil, 2=Ok, 3=Fácil
  let newEF = easeFactor;
  let newInterval = interval;
  let newReps = repetitions;

  if (rating >= 2) {
    if (repetitions === 0) newInterval = 1;
    else if (repetitions === 1) newInterval = 6;
    else newInterval = Math.round(interval * easeFactor);
    newReps = repetitions + 1;
  } else {
    newInterval = 1;
    newReps = 0;
  }

  newEF = easeFactor + (0.1 - (3 - rating) * (0.08 + (3 - rating) * 0.02));
  if (newEF < 1.3) newEF = 1.3;

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + newInterval);

  return { newEF, newInterval, newReps, nextReviewAt };
}

const getFlashcards = async (req, res, next) => {
  try {
    const { subjectId, topicId, dueOnly, folderId } = req.query;
    const where = { userId: req.user.id };
    if (subjectId) where.subjectId = subjectId;
    if (topicId) where.topicId = topicId;
    if (folderId) where.folderId = folderId;
    if (dueOnly === 'true') where.nextReviewAt = { lte: new Date() };

    const flashcards = await prisma.flashcard.findMany({
      where,
      include: { subject: true, topic: true, folder: true },
      orderBy: { nextReviewAt: 'asc' },
    });

    return success(res, flashcards);
  } catch (err) {
    next(err);
  }
};

const getDueFlashcards = async (req, res, next) => {
  try {
    const flashcards = await prisma.flashcard.findMany({
      where: {
        userId: req.user.id,
        nextReviewAt: { lte: new Date() },
      },
      include: { subject: true, topic: true, folder: true },
      orderBy: { nextReviewAt: 'asc' },
      take: 50,
    });
    return success(res, { flashcards, total: flashcards.length });
  } catch (err) {
    next(err);
  }
};

const createFlashcard = async (req, res, next) => {
  try {
    const { front, back, subjectId, topicId, difficulty } = req.body;

    const flashcard = await prisma.flashcard.create({
      data: {
        front,
        back,
        subjectId: subjectId || null,
        topicId: topicId || null,
        difficulty: difficulty || 'MEDIO',
        userId: req.user.id,
      },
    });
    return created(res, flashcard, 'Flashcard criado');
  } catch (err) {
    next(err);
  }
};

const reviewFlashcard = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rating } = req.body; // 0-3

    const card = await prisma.flashcard.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!card) return notFound(res, 'Flashcard não encontrado');

    const { newEF, newInterval, newReps, nextReviewAt } = sm2(
      card.easeFactor, card.interval, card.repetitions, rating
    );

    const isCorrect = rating >= 2;
    const [updated] = await Promise.all([
      prisma.flashcard.update({
        where: { id },
        data: {
          easeFactor: newEF,
          interval: newInterval,
          repetitions: newReps,
          nextReviewAt,
          totalReviews: { increment: 1 },
          correctReviews: isCorrect ? { increment: 1 } : undefined,
        },
      }),
      prisma.flashcardReview.create({
        data: { flashcardId: id, rating },
      }),
    ]);

    return success(res, { flashcard: updated, nextReviewAt });
  } catch (err) {
    next(err);
  }
};

const updateFlashcard = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { front, back, difficulty } = req.body;

    const card = await prisma.flashcard.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!card) return notFound(res, 'Flashcard não encontrado');

    const updated = await prisma.flashcard.update({
      where: { id },
      data: {
        ...(front && { front }),
        ...(back && { back }),
        ...(difficulty && { difficulty }),
      },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

const deleteFlashcard = async (req, res, next) => {
  try {
    const { id } = req.params;
    const card = await prisma.flashcard.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!card) return notFound(res, 'Flashcard não encontrado');

    await prisma.flashcard.delete({ where: { id } });
    return success(res, null, 'Flashcard removido');
  } catch (err) {
    next(err);
  }
};

module.exports = { getFlashcards, getDueFlashcards, createFlashcard, reviewFlashcard, updateFlashcard, deleteFlashcard };
