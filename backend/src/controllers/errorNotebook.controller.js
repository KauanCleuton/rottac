const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');
const fs = require('fs');
const path = require('path');

const getEntries = async (req, res, next) => {
  try {
    const { subjectId, topicId, errorType, isResolved, dueOnly } = req.query;
    const where = { userId: req.user.id };

    if (subjectId) where.subjectId = subjectId;
    if (topicId) where.topicId = topicId;
    if (errorType) where.errorType = errorType;
    if (isResolved !== undefined) where.isResolved = isResolved === 'true';
    if (dueOnly === 'true') where.nextReviewAt = { lte: new Date() };

    const entries = await prisma.errorEntry.findMany({
      where,
      include: {
        subject: true,
        topic: true,
        reviews: { orderBy: { reviewedAt: 'desc' }, take: 5 },
      },
      orderBy: { createdAt: 'desc' },
    });

    return success(res, entries);
  } catch (err) {
    next(err);
  }
};

const getDueEntries = async (req, res, next) => {
  try {
    const entries = await prisma.errorEntry.findMany({
      where: {
        userId: req.user.id,
        isResolved: false,
        nextReviewAt: { lte: new Date() },
      },
      include: { subject: true, topic: true },
      orderBy: { nextReviewAt: 'asc' },
      take: 20,
    });
    return success(res, { entries, total: entries.length });
  } catch (err) {
    next(err);
  }
};

const getPatterns = async (req, res, next) => {
  try {
    // Análise de padrões de erro por tipo, disciplina e tópico
    const [byType, bySubject, byTopic] = await Promise.all([
      prisma.errorEntry.groupBy({
        by: ['errorType'],
        where: { userId: req.user.id },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      prisma.errorEntry.groupBy({
        by: ['subjectId'],
        where: { userId: req.user.id },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
      prisma.errorEntry.groupBy({
        by: ['topicId'],
        where: { userId: req.user.id, topicId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
    ]);

    // Buscar nomes dos subjects
    const subjectIds = bySubject.map((s) => s.subjectId);
    const subjects = await prisma.subject.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true, name: true },
    });

    return success(res, {
      byType,
      bySubject: bySubject.map((s) => ({
        ...s,
        subject: subjects.find((sub) => sub.id === s.subjectId),
      })),
      byTopic,
    });
  } catch (err) {
    next(err);
  }
};

const createEntry = async (req, res, next) => {
  try {
    const {
      subjectId, topicId, questionText, description,
      correctAnswer, personalNotes, errorType, difficulty,
    } = req.body;

    const toRelative = (file) => {
      if (!file) return null;
      const rel = file.path.replace(/\\/g, '/').split('uploads/')[1];
      return `/uploads/${rel}`;
    };

    const imageUrl = req.files?.image ? toRelative(req.files.image[0]) : null;
    const audioUrl = req.files?.audio ? toRelative(req.files.audio[0]) : null;

    const entry = await prisma.errorEntry.create({
      data: {
        userId: req.user.id,
        subjectId,
        topicId: topicId || null,
        questionText: questionText || null,
        description,
        correctAnswer,
        personalNotes: personalNotes || null,
        errorType,
        difficulty: difficulty || 'MEDIO',
        imageUrl,
        audioUrl,
      },
      include: { subject: true, topic: true },
    });

    return created(res, entry, 'Erro registrado no caderno');
  } catch (err) {
    next(err);
  }
};

const updateEntry = async (req, res, next) => {
  try {
    const { id } = req.params;

    const entry = await prisma.errorEntry.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!entry) return notFound(res, 'Registro não encontrado');

    const {
      description, correctAnswer, personalNotes,
      errorType, difficulty, isResolved, audioTranscription,
    } = req.body;

    const updated = await prisma.errorEntry.update({
      where: { id },
      data: {
        ...(description && { description }),
        ...(correctAnswer && { correctAnswer }),
        ...(personalNotes !== undefined && { personalNotes }),
        ...(errorType && { errorType }),
        ...(difficulty && { difficulty }),
        ...(isResolved !== undefined && { isResolved }),
        ...(audioTranscription && { audioTranscription }),
      },
    });

    return success(res, updated, 'Registro atualizado');
  } catch (err) {
    next(err);
  }
};

const reviewEntry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { result } = req.body; // ACERTOU, ERROU_NOVAMENTE, PARCIALMENTE

    const entry = await prisma.errorEntry.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!entry) return notFound(res, 'Registro não encontrado');

    // Calcular próxima revisão (revisão espaçada simples)
    const intervals = {
      ACERTOU: entry.reviewCount >= 3 ? 14 : entry.reviewCount >= 1 ? 7 : 3,
      PARCIALMENTE: 2,
      ERROU_NOVAMENTE: 1,
    };

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + intervals[result]);

    const [review] = await Promise.all([
      prisma.errorReview.create({ data: { errorEntryId: id, result } }),
      prisma.errorEntry.update({
        where: { id },
        data: {
          reviewCount: { increment: 1 },
          nextReviewAt: nextReview,
          isResolved: result === 'ACERTOU' && entry.reviewCount >= 2,
        },
      }),
    ]);

    return success(res, review, 'Revisão registrada');
  } catch (err) {
    next(err);
  }
};

const deleteEntry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const entry = await prisma.errorEntry.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!entry) return notFound(res, 'Registro não encontrado');

    // Remover arquivos físicos
    if (entry.imageUrl) {
      const imgPath = path.join(__dirname, '../../', entry.imageUrl);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    if (entry.audioUrl) {
      const audioPath = path.join(__dirname, '../../', entry.audioUrl);
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    }

    await prisma.errorEntry.delete({ where: { id } });
    return success(res, null, 'Registro removido');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getEntries, getDueEntries, getPatterns,
  createEntry, updateEntry, reviewEntry, deleteEntry,
};
