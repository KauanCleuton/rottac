const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');

// ─── PASTAS ───────────────────────────────────────────────────────────────────

const getFolders = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const folders = await prisma.flashcardFolder.findMany({
      where: { userId, parentId: null },
      include: {
        children: {
          include: { _count: { select: { flashcards: true } } },
        },
        _count: { select: { flashcards: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Conta estatísticas por pasta
    const foldersWithStats = await Promise.all(
      folders.map(async (folder) => {
        const stats = await getFolderStats(folder.id, userId);
        return { ...folder, stats };
      })
    );

    return success(res, foldersWithStats);
  } catch (err) {
    next(err);
  }
};

const createFolder = async (req, res, next) => {
  try {
    const { name, color, icon, parentId } = req.body;
    const folder = await prisma.flashcardFolder.create({
      data: { userId: req.user.id, name, color: color || '#6C63FF', icon: icon || 'folder', parentId: parentId || null },
    });
    return created(res, folder, 'Pasta criada');
  } catch (err) {
    next(err);
  }
};

const updateFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, color, icon } = req.body;
    const folder = await prisma.flashcardFolder.findFirst({ where: { id, userId: req.user.id } });
    if (!folder) return notFound(res, 'Pasta não encontrada');
    const updated = await prisma.flashcardFolder.update({
      where: { id },
      data: { ...(name && { name }), ...(color && { color }), ...(icon && { icon }) },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

const deleteFolder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const folder = await prisma.flashcardFolder.findFirst({ where: { id, userId: req.user.id } });
    if (!folder) return notFound(res, 'Pasta não encontrada');
    // Move cards para sem-pasta antes de deletar
    await prisma.flashcard.updateMany({ where: { folderId: id }, data: { folderId: null } });
    await prisma.flashcardFolder.delete({ where: { id } });
    return success(res, null, 'Pasta removida');
  } catch (err) {
    next(err);
  }
};

const moveCard = async (req, res, next) => {
  try {
    const { id } = req.params;       // flashcard id
    const { folderId } = req.body;   // null = sem pasta
    const card = await prisma.flashcard.findFirst({ where: { id, userId: req.user.id } });
    if (!card) return notFound(res, 'Flashcard não encontrado');
    const updated = await prisma.flashcard.update({ where: { id }, data: { folderId: folderId || null } });
    return success(res, updated, 'Card movido');
  } catch (err) {
    next(err);
  }
};

// ─── FILAS DE ESTUDO ──────────────────────────────────────────────────────────

// GET /flashcard-folders/:id/study?mode=due|weak|new|marathon
const getStudyQueue = async (req, res, next) => {
  try {
    const { id } = req.params;   // pasta; 'all' = todas
    const { mode = 'due' } = req.query;
    const userId = req.user.id;
    const now = new Date();

    const baseWhere = {
      userId,
      ...(id !== 'all' ? { folderId: id } : {}),
    };

    let cards = [];

    if (mode === 'due') {
      // Revisão espaçada: cards com nextReviewAt vencido
      cards = await prisma.flashcard.findMany({
        where: { ...baseWhere, nextReviewAt: { lte: now } },
        include: { folder: true, subject: true },
        orderBy: { nextReviewAt: 'asc' },
        take: 50,
      });
    } else if (mode === 'weak') {
      // Cards fracos: acerto < 50% com pelo menos 3 revisões
      cards = await prisma.flashcard.findMany({
        where: { ...baseWhere, totalReviews: { gte: 3 } },
        include: { folder: true, subject: true },
        orderBy: { easeFactor: 'asc' },
        take: 40,
      });
      // Filtra os que têm taxa de acerto abaixo de 60%
      cards = cards.filter(c => c.totalReviews > 0 && (c.correctReviews / c.totalReviews) < 0.6);
    } else if (mode === 'new') {
      // Cards nunca revisados
      cards = await prisma.flashcard.findMany({
        where: { ...baseWhere, totalReviews: 0 },
        include: { folder: true, subject: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
    } else if (mode === 'marathon') {
      // Todos os cards da pasta em ordem aleatória
      cards = await prisma.flashcard.findMany({
        where: baseWhere,
        include: { folder: true, subject: true },
      });
      // Embaralha
      cards = cards.sort(() => Math.random() - 0.5);
    }

    return success(res, { cards, total: cards.length, mode });
  } catch (err) {
    next(err);
  }
};

// GET /flashcard-folders/:id/stats
const getFolderStatsEndpoint = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const stats = await getFolderStats(id, userId);
    return success(res, stats);
  } catch (err) {
    next(err);
  }
};

// ─── Helper interno ────────────────────────────────────────────────────────────
async function getFolderStats(folderId, userId) {
  const now = new Date();
  const where = { userId, folderId: folderId === 'all' ? undefined : folderId };

  const [total, dueCount, newCount, masteredCount, cards] = await Promise.all([
    prisma.flashcard.count({ where }),
    prisma.flashcard.count({ where: { ...where, nextReviewAt: { lte: now } } }),
    prisma.flashcard.count({ where: { ...where, totalReviews: 0 } }),
    prisma.flashcard.count({ where: { ...where, interval: { gte: 21 }, easeFactor: { gte: 2.4 } } }),
    prisma.flashcard.findMany({ where, select: { totalReviews: true, correctReviews: true } }),
  ]);

  const totalReviews = cards.reduce((a, c) => a + c.totalReviews, 0);
  const totalCorrect = cards.reduce((a, c) => a + c.correctReviews, 0);
  const accuracy = totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : 0;

  return { total, dueCount, newCount, masteredCount, accuracy, totalReviews };
}

module.exports = { getFolders, createFolder, updateFolder, deleteFolder, moveCard, getStudyQueue, getFolderStatsEndpoint };
