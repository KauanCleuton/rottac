const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');

const getNotes = async (req, res, next) => {
  try {
    const { topicId, isPinned, search } = req.query;
    const where = { userId: req.user.id };
    if (topicId) where.topicId = topicId;
    if (isPinned !== undefined) where.isPinned = isPinned === 'true';
    if (search) where.OR = [
      { title: { contains: search } },
      { content: { contains: search } },
    ];

    const notes = await prisma.note.findMany({
      where,
      include: { topic: { include: { module: { include: { subject: true } } } } },
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
    });
    return success(res, notes);
  } catch (err) {
    next(err);
  }
};

const createNote = async (req, res, next) => {
  try {
    const { title, content, topicId, tags, isPinned } = req.body;
    const note = await prisma.note.create({
      data: {
        title,
        content,
        topicId: topicId || null,
        tags: tags ? JSON.stringify(tags) : null,
        isPinned: isPinned || false,
        userId: req.user.id,
      },
    });
    return created(res, note, 'Anotação criada');
  } catch (err) {
    next(err);
  }
};

const updateNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, content, tags, isPinned } = req.body;

    const note = await prisma.note.findFirst({ where: { id, userId: req.user.id } });
    if (!note) return notFound(res, 'Anotação não encontrada');

    const updated = await prisma.note.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(content !== undefined && { content }),
        ...(tags !== undefined && { tags: JSON.stringify(tags) }),
        ...(isPinned !== undefined && { isPinned }),
      },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

const deleteNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const note = await prisma.note.findFirst({ where: { id, userId: req.user.id } });
    if (!note) return notFound(res, 'Anotação não encontrada');
    await prisma.note.delete({ where: { id } });
    return success(res, null, 'Anotação removida');
  } catch (err) {
    next(err);
  }
};

module.exports = { getNotes, createNote, updateNote, deleteNote };
