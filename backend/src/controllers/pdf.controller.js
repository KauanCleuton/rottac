const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');
const fs = require('fs');
const path = require('path');

const getPdfs = async (req, res, next) => {
  try {
    const { subjectId, topicId } = req.query;
    const where = { userId: req.user.id };
    if (subjectId) where.subjectId = subjectId;
    if (topicId) where.topicId = topicId;

    const pdfs = await prisma.pDF.findMany({
      where,
      include: { subject: true, topic: true },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, pdfs);
  } catch (err) {
    next(err);
  }
};

const uploadPdf = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado' });

    const { title, subjectId, topicId } = req.body;

    // Caminho relativo a partir da raiz do servidor (organizado por userId/subjectId)
    const relativePath = req.file.path
      .replace(/\\/g, '/')
      .split('uploads/')[1];

    const pdf = await prisma.pDF.create({
      data: {
        title: title || req.file.originalname,
        filename: req.file.originalname,
        path: `/uploads/${relativePath}`,
        size: req.file.size,
        subjectId: subjectId || null,
        topicId: topicId || null,
        userId: req.user.id,
      },
    });
    return created(res, pdf, 'PDF enviado com sucesso');
  } catch (err) {
    next(err);
  }
};

const updateProgress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { currentPage } = req.body;

    const pdf = await prisma.pDF.findFirst({ where: { id, userId: req.user.id } });
    if (!pdf) return notFound(res, 'PDF não encontrado');

    const updated = await prisma.pDF.update({
      where: { id },
      data: { currentPage: parseInt(currentPage) },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
};

const deletePdf = async (req, res, next) => {
  try {
    const { id } = req.params;
    const pdf = await prisma.pDF.findFirst({ where: { id, userId: req.user.id } });
    if (!pdf) return notFound(res, 'PDF não encontrado');

    const filePath = path.join(__dirname, '../../', pdf.path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await prisma.pDF.delete({ where: { id } });
    return success(res, null, 'PDF removido');
  } catch (err) {
    next(err);
  }
};

const getFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const pdf = await prisma.pDF.findFirst({ where: { id, userId: req.user.id } });
    if (!pdf) return notFound(res, 'PDF não encontrado');

    const filePath = path.join(__dirname, '../../', pdf.path);
    if (!fs.existsSync(filePath)) return notFound(res, 'Arquivo não encontrado no disco');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(pdf.filename)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
};

module.exports = { getPdfs, uploadPdf, updateProgress, deletePdf, getFile };
