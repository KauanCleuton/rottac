const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');

const getMindMaps = async (req, res, next) => {
  try {
    const mindMaps = await prisma.mindMap.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return success(res, mindMaps);
  } catch (err) {
    next(err);
  }
};

const getMindMap = async (req, res, next) => {
  try {
    const { id } = req.params;
    const mindMap = await prisma.mindMap.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!mindMap) return notFound(res, 'Mapa mental não encontrado');
    return success(res, mindMap);
  } catch (err) {
    next(err);
  }
};

const createMindMap = async (req, res, next) => {
  try {
    const { title, data } = req.body;
    const mindMap = await prisma.mindMap.create({
      data: { title, data: data || {}, userId: req.user.id },
    });
    return created(res, mindMap, 'Mapa mental criado');
  } catch (err) {
    next(err);
  }
};

const updateMindMap = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, data, thumbnail } = req.body;

    const mindMap = await prisma.mindMap.findFirst({ where: { id, userId: req.user.id } });
    if (!mindMap) return notFound(res, 'Mapa mental não encontrado');

    const updated = await prisma.mindMap.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(data !== undefined && { data }),
        ...(thumbnail !== undefined && { thumbnail }),
      },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

const deleteMindMap = async (req, res, next) => {
  try {
    const { id } = req.params;
    const mindMap = await prisma.mindMap.findFirst({ where: { id, userId: req.user.id } });
    if (!mindMap) return notFound(res, 'Mapa mental não encontrado');
    await prisma.mindMap.delete({ where: { id } });
    return success(res, null, 'Mapa mental removido');
  } catch (err) {
    next(err);
  }
};

module.exports = { getMindMaps, getMindMap, createMindMap, updateMindMap, deleteMindMap };
