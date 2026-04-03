const prisma = require('../utils/prisma');
const { success, created, notFound, badRequest } = require('../utils/response');

// ─── Disciplinas ───────────────────────────────────────────────────────────

const getSubjects = async (req, res, next) => {
  try {
    const subjects = await prisma.subject.findMany({
      where: { userId: req.user.id },
      include: {
        modules: {
          include: { topics: true },
          orderBy: { order: 'asc' },
        },
        _count: { select: { questionLogs: true, errorEntries: true } },
      },
      orderBy: { name: 'asc' },
    });
    return success(res, subjects);
  } catch (err) {
    next(err);
  }
};

const createSubject = async (req, res, next) => {
  try {
    const { name, color, icon, weight } = req.body;
    const subject = await prisma.subject.create({
      data: {
        name,
        color: color || '#1976d2',
        icon,
        weight: weight ? parseFloat(weight) : 1.0,
        userId: req.user.id,
      },
    });
    return created(res, subject, 'Disciplina criada com sucesso');
  } catch (err) {
    next(err);
  }
};

const updateSubject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, color, icon, weight } = req.body;

    const subject = await prisma.subject.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!subject) return notFound(res, 'Disciplina não encontrada');

    const updated = await prisma.subject.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(color && { color }),
        ...(icon !== undefined && { icon }),
        ...(weight !== undefined && { weight: parseFloat(weight) }),
      },
    });
    return success(res, updated, 'Disciplina atualizada');
  } catch (err) {
    next(err);
  }
};

const deleteSubject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const subject = await prisma.subject.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!subject) return notFound(res, 'Disciplina não encontrada');

    await prisma.subject.delete({ where: { id } });
    return success(res, null, 'Disciplina removida');
  } catch (err) {
    next(err);
  }
};

// ─── Módulos ───────────────────────────────────────────────────────────────

const createModule = async (req, res, next) => {
  try {
    const { subjectId } = req.params;
    const { name, order } = req.body;

    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, userId: req.user.id },
    });
    if (!subject) return notFound(res, 'Disciplina não encontrada');

    const module = await prisma.module.create({
      data: { name, order: order || 0, subjectId },
    });
    return created(res, module, 'Módulo criado');
  } catch (err) {
    next(err);
  }
};

const updateModule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, order } = req.body;

    const module = await prisma.module.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(order !== undefined && { order }),
      },
    });
    return success(res, module, 'Módulo atualizado');
  } catch (err) {
    next(err);
  }
};

const deleteModule = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.module.delete({ where: { id } });
    return success(res, null, 'Módulo removido');
  } catch (err) {
    next(err);
  }
};

// ─── Tópicos ───────────────────────────────────────────────────────────────

const createTopic = async (req, res, next) => {
  try {
    const { moduleId } = req.params;
    const { name, order, difficulty, estimatedHours } = req.body;

    const topic = await prisma.topic.create({
      data: {
        name,
        moduleId,
        order: order || 0,
        difficulty: difficulty || 'MEDIO',
        estimatedHours: estimatedHours ? parseFloat(estimatedHours) : 1,
      },
    });

    // Atualizar contador de tópicos na disciplina
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      include: { topics: true },
    });
    await prisma.subject.update({
      where: { id: module.subjectId },
      data: { totalTopics: { increment: 1 } },
    });

    return created(res, topic, 'Tópico criado');
  } catch (err) {
    next(err);
  }
};

const updateTopic = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, order, difficulty, estimatedHours, progress, isCompleted } = req.body;

    const data = {};
    if (name) data.name = name;
    if (order !== undefined) data.order = order;
    if (difficulty) data.difficulty = difficulty;
    if (estimatedHours !== undefined) data.estimatedHours = parseFloat(estimatedHours);
    if (progress !== undefined) data.progress = parseFloat(progress);
    if (isCompleted !== undefined) {
      data.isCompleted = isCompleted;
      if (isCompleted) data.lastStudiedAt = new Date();
    }

    const topic = await prisma.topic.update({ where: { id }, data });
    return success(res, topic, 'Tópico atualizado');
  } catch (err) {
    next(err);
  }
};

const deleteTopic = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.topic.delete({ where: { id } });
    return success(res, null, 'Tópico removido');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getSubjects, createSubject, updateSubject, deleteSubject,
  createModule, updateModule, deleteModule,
  createTopic, updateTopic, deleteTopic,
};
