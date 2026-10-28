const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ─── Multer para áudio e PDF corrigido ────────────────────────────────────────

const makeStorage = (subfolder) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../uploads', subfolder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${subfolder}_${req.user.id}_${Date.now()}${ext}`);
    },
  });

const uploadAudioMiddleware = multer({ storage: makeStorage('essay-audio'), limits: { fileSize: 30 * 1024 * 1024 } }).single('audio');
const uploadFileMiddleware = multer({ storage: makeStorage('essay-corrected'), limits: { fileSize: 20 * 1024 * 1024 } }).single('file');

// ─── PROFESSOR: Dashboard ──────────────────────────────────────────────────────

const getDashboard = async (req, res, next) => {
  try {
    const teacherId = req.user.id;

    const [pendingCount, correctedCount, students, recentEssays] = await Promise.all([
      prisma.essay.count({
        where: {
          status: { in: ['PENDING', 'REWRITE_REQUESTED', 'REWRITTEN'] },
          student: { studentTeachers: { some: { teacherId, isActive: true } } },
        },
      }),
      prisma.essay.count({
        where: {
          status: 'CORRECTED',
          student: { studentTeachers: { some: { teacherId, isActive: true } } },
        },
      }),
      prisma.teacherStudent.count({ where: { teacherId, isActive: true } }),
      prisma.essay.findMany({
        where: {
          status: { in: ['PENDING', 'REWRITE_REQUESTED', 'REWRITTEN'] },
          student: { studentTeachers: { some: { teacherId, isActive: true } } },
        },
        include: { student: { select: { id: true, name: true, avatar: true } } },
        orderBy: { submittedAt: 'desc' },
        take: 10,
      }),
    ]);

    return success(res, { pendingCount, correctedCount, students, recentEssays });
  } catch (err) {
    next(err);
  }
};

// ─── PROFESSOR: Listar redações ────────────────────────────────────────────────

const listEssays = async (req, res, next) => {
  try {
    const teacherId = req.user.id;
    const { status, studentId, page = '1', limit = '20' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      student: { studentTeachers: { some: { teacherId, isActive: true } } },
    };
    if (status) where.status = status;
    if (studentId) where.studentId = studentId;

    const [essays, total] = await Promise.all([
      prisma.essay.findMany({
        where,
        include: {
          student: { select: { id: true, name: true, avatar: true } },
          corrections: { select: { id: true, totalScore: true, correctedAt: true } },
          _count: { select: { comments: true } },
        },
        orderBy: { submittedAt: 'desc' },
        skip, take: parseInt(limit),
      }),
      prisma.essay.count({ where }),
    ]);

    return success(res, { essays, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    next(err);
  }
};

// ─── PROFESSOR: Listar alunos ──────────────────────────────────────────────────

const listStudents = async (req, res, next) => {
  try {
    const teacherId = req.user.id;

    const links = await prisma.teacherStudent.findMany({
      where: { teacherId, isActive: true },
      include: {
        student: {
          select: {
            id: true, name: true, avatar: true, email: true,
            essays: {
              select: { id: true, status: true, submittedAt: true },
              orderBy: { submittedAt: 'desc' },
              take: 5,
            },
          },
        },
      },
      orderBy: { linkedAt: 'desc' },
    });

    const studentIds = links.map((l) => l.student.id);

    // Busca todas as correções dos alunos de uma vez (evita N+1)
    const allCorrections = await prisma.essayCorrection.findMany({
      where: { essay: { studentId: { in: studentIds } } },
      orderBy: { correctedAt: 'desc' },
      select: { totalScore: true, correctedAt: true, essay: { select: { studentId: true } } },
    });

    // Mapeia studentId → última correção (já vem ordenado desc)
    const lastScoreMap = {};
    for (const c of allCorrections) {
      const sid = c.essay.studentId;
      if (!lastScoreMap[sid]) lastScoreMap[sid] = { totalScore: c.totalScore, correctedAt: c.correctedAt };
    }

    const students = links.map((l) => {
      const lastScore = lastScoreMap[l.student.id];
      return {
        ...l.student,
        linkedAt: l.linkedAt,
        lastScore: lastScore?.totalScore,
        lastCorrectedAt: lastScore?.correctedAt,
        pendingEssays: l.student.essays.filter((e) => e.status === 'PENDING' || e.status === 'REWRITTEN').length,
      };
    });

    return success(res, students);
  } catch (err) {
    next(err);
  }
};

// ─── PROFESSOR: Estatísticas de um aluno ──────────────────────────────────────

const getStudentStats = async (req, res, next) => {
  try {
    const teacherId = req.user.id;
    const { studentId } = req.params;

    // Verifica vínculo
    const link = await prisma.teacherStudent.findUnique({
      where: { teacherId_studentId: { teacherId, studentId } },
    });
    if (!link) return res.status(403).json({ error: 'Aluno não vinculado.' });

    const corrections = await prisma.essayCorrection.findMany({
      where: { essay: { studentId } },
      orderBy: { correctedAt: 'asc' },
      include: { essay: { select: { title: true, theme: true, version: true } } },
    });

    const recurringErrors = await prisma.essayComment.groupBy({
      by: ['type'],
      where: { essay: { studentId } },
      _count: { type: true },
      orderBy: { _count: { type: 'desc' } },
    });

    return success(res, {
      timeline: corrections.map((c) => ({
        date: c.correctedAt, title: c.essay.title,
        totalScore: c.totalScore, scoreC1: c.scoreC1, scoreC2: c.scoreC2,
        scoreC3: c.scoreC3, scoreC4: c.scoreC4, scoreC5: c.scoreC5,
      })),
      recurringErrors: recurringErrors.map((e) => ({ type: e.type, count: e._count.type })),
      totalCorrected: corrections.length,
      avgScore: corrections.length
        ? Math.round(corrections.reduce((s, c) => s + (c.totalScore || 0), 0) / corrections.length)
        : null,
    });
  } catch (err) {
    next(err);
  }
};

// ─── PROFESSOR: Corrigir redação ───────────────────────────────────────────────

const correctEssay = async (req, res, next) => {
  try {
    const teacherId = req.user.id;
    const { id: essayId } = req.params;
    const {
      generalFeedback, strengthPoints, improvementPoints,
      scoreC1, scoreC2, scoreC3, scoreC4, scoreC5,
      requestRewrite, rewriteDeadline,
    } = req.body;

    const essay = await prisma.essay.findFirst({
      where: {
        id: essayId,
        student: { studentTeachers: { some: { teacherId, isActive: true } } },
      },
    });
    if (!essay) return notFound(res, 'Redação não encontrada');

    const totalScore = [scoreC1, scoreC2, scoreC3, scoreC4, scoreC5]
      .reduce((s, v) => s + (parseInt(v) || 0), 0);

    const correction = await prisma.essayCorrection.upsert({
      where: { essayId },
      create: {
        essayId, teacherId, generalFeedback, strengthPoints, improvementPoints,
        scoreC1: parseInt(scoreC1) || null, scoreC2: parseInt(scoreC2) || null,
        scoreC3: parseInt(scoreC3) || null, scoreC4: parseInt(scoreC4) || null,
        scoreC5: parseInt(scoreC5) || null, totalScore,
        requestRewrite: !!requestRewrite,
        rewriteDeadline: rewriteDeadline ? new Date(rewriteDeadline) : null,
      },
      update: {
        generalFeedback, strengthPoints, improvementPoints,
        scoreC1: parseInt(scoreC1) || null, scoreC2: parseInt(scoreC2) || null,
        scoreC3: parseInt(scoreC3) || null, scoreC4: parseInt(scoreC4) || null,
        scoreC5: parseInt(scoreC5) || null, totalScore,
        requestRewrite: !!requestRewrite,
        rewriteDeadline: rewriteDeadline ? new Date(rewriteDeadline) : null,
        correctedAt: new Date(),
      },
      include: { teacher: { select: { id: true, name: true, avatar: true } } },
    });

    await prisma.essay.update({
      where: { id: essayId },
      data: { status: requestRewrite ? 'REWRITE_REQUESTED' : 'CORRECTED' },
    });

    // XP para o professor
    await prisma.gamification.updateMany({
      where: { userId: teacherId },
      data: { xp: { increment: 15 } },
    });

    // Notifica o aluno
    const teacher = await prisma.user.findUnique({ where: { id: teacherId }, select: { name: true } });
    await prisma.notification.create({
      data: {
        userId: essay.studentId,
        title: requestRewrite ? 'Reescrita solicitada' : 'Redação corrigida!',
        body: requestRewrite
          ? `${teacher.name} solicitou uma reescrita de "${essay.title}".`
          : `${teacher.name} corrigiu sua redação "${essay.title}". Nota: ${totalScore}/1000`,
        type: 'REDACAO',
        data: { essayId, totalScore },
      },
    });

    return success(res, correction, 'Correção salva com sucesso!');
  } catch (err) {
    next(err);
  }
};

// ─── PROFESSOR: Adicionar comentário inline ────────────────────────────────────

const addComment = async (req, res, next) => {
  try {
    const teacherId = req.user.id;
    const { essayId } = req.params;
    const { text, selectedText, startOffset, endOffset, type, correctionId } = req.body;

    const essay = await prisma.essay.findFirst({
      where: {
        id: essayId,
        student: { studentTeachers: { some: { teacherId, isActive: true } } },
      },
    });
    if (!essay) return notFound(res, 'Redação não encontrada');

    const comment = await prisma.essayComment.create({
      data: {
        essayId, authorId: teacherId,
        text, selectedText,
        startOffset: startOffset ?? null,
        endOffset: endOffset ?? null,
        type: type || 'ANNOTATION',
        correctionId: correctionId || null,
      },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    });

    return created(res, comment);
  } catch (err) {
    next(err);
  }
};

// ─── PROFESSOR: Upload de áudio ────────────────────────────────────────────────

const uploadAudio = (req, res, next) => {
  uploadAudioMiddleware(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Arquivo de áudio não enviado.' });

    const { essayId } = req.params;
    const audioUrl = `/uploads/essay-audio/${req.file.filename}`;

    try {
      await prisma.essayCorrection.update({ where: { essayId }, data: { audioUrl } });
      return success(res, { audioUrl });
    } catch (e) {
      next(e);
    }
  });
};

// ─── PROFESSOR: Upload de PDF corrigido ───────────────────────────────────────

const uploadCorrectedFile = (req, res, next) => {
  uploadFileMiddleware(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

    const { essayId } = req.params;
    const correctedFileUrl = `/uploads/essay-corrected/${req.file.filename}`;

    try {
      await prisma.essayCorrection.update({ where: { essayId }, data: { correctedFileUrl } });
      return success(res, { correctedFileUrl });
    } catch (e) {
      next(e);
    }
  });
};

// ─── PROFESSOR: Templates de feedback ─────────────────────────────────────────

const listTemplates = async (req, res, next) => {
  try {
    const templates = await prisma.feedbackTemplate.findMany({
      where: { teacherId: req.user.id },
      orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
    });
    return success(res, templates);
  } catch (err) {
    next(err);
  }
};

const createTemplate = async (req, res, next) => {
  try {
    const { title, content, category } = req.body;
    const template = await prisma.feedbackTemplate.create({
      data: { teacherId: req.user.id, title, content, category },
    });
    return created(res, template);
  } catch (err) {
    next(err);
  }
};

const useTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.feedbackTemplate.update({
      where: { id, teacherId: req.user.id },
      data: { usageCount: { increment: 1 } },
    });
    return success(res, { ok: true });
  } catch (err) {
    next(err);
  }
};

// ─── PROFESSOR: Resolver comentário ───────────────────────────────────────────

const resolveComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.essayComment.update({ where: { id }, data: { isResolved: true } });
    return success(res, { ok: true });
  } catch (err) {
    next(err);
  }
};

// ─── PROFESSOR: Insights do aluno (erros recorrentes + sugestões) ─────────────

const getStudentInsights = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const teacherId = req.user.id;

    const link = await prisma.teacherStudent.findUnique({
      where: { teacherId_studentId: { teacherId, studentId } },
    });
    if (!link) return res.status(403).json({ error: 'Aluno não vinculado.' });

    const corrections = await prisma.essayCorrection.findMany({
      where: { essay: { studentId } },
      orderBy: { correctedAt: 'desc' },
      take: 10,
    });

    const commentTypes = await prisma.essayComment.groupBy({
      by: ['type'],
      where: { essay: { studentId } },
      _count: { type: true },
      orderBy: { _count: { type: 'desc' } },
    });

    // Tendência das notas
    const trend = corrections.length >= 2
      ? corrections[0].totalScore - corrections[corrections.length - 1].totalScore
      : 0;

    // Competência mais fraca
    const avgC = (key) => {
      const vals = corrections.filter((c) => c[key] != null).map((c) => c[key]);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    const competencies = {
      'Domínio da norma culta': avgC('scoreC1'),
      'Compreensão da proposta': avgC('scoreC2'),
      'Seleção de argumentos': avgC('scoreC3'),
      'Coesão e coerência': avgC('scoreC4'),
      'Proposta de intervenção': avgC('scoreC5'),
    };

    const weakest = Object.entries(competencies)
      .filter(([, v]) => v != null)
      .sort(([, a], [, b]) => a - b)[0];

    const insights = [];
    if (commentTypes[0]?.type === 'GRAMMAR' && commentTypes[0]._count.type >= 3) {
      insights.push({ type: 'warning', text: 'Erros gramaticais recorrentes nas últimas redações.' });
    }
    if (trend > 50) insights.push({ type: 'success', text: `Melhora de ${trend} pontos nas últimas correções!` });
    if (trend < -50) insights.push({ type: 'error', text: `Queda de ${Math.abs(trend)} pontos. Atenção necessária.` });
    if (weakest) insights.push({ type: 'info', text: `Competência mais fraca: ${weakest[0]} (média ${Math.round(weakest[1])}/200).` });

    return success(res, { insights, competencies, recurringErrors: commentTypes, trend });
  } catch (err) {
    next(err);
  }
};

// ─── PROFESSOR: Salvar anotações (rabiscos) do PDF ────────────────────────────

const saveAnnotations = async (req, res, next) => {
  try {
    const { id: essayId } = req.params;
    const { annotations } = req.body; // JSON string: [{page, dataUrl}]

    // Upsert correction para garantir que existe
    const correction = await prisma.essayCorrection.upsert({
      where: { essayId },
      create: { essayId, teacherId: req.user.id, pdfAnnotations: JSON.stringify(annotations) },
      update: { pdfAnnotations: JSON.stringify(annotations) },
    });

    return success(res, { ok: true }, 'Anotações salvas');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboard, listEssays, listStudents, getStudentStats,
  correctEssay, addComment, uploadAudio, uploadCorrectedFile,
  listTemplates, createTemplate, useTemplate, resolveComment,
  getStudentInsights, saveAnnotations,
};
