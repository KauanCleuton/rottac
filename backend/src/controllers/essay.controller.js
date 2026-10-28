const prisma = require('../utils/prisma');
const { success, created, notFound } = require('../utils/response');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ─── Multer para PDF do aluno ──────────────────────────────────────────────────

const essayPdfStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/essay-pdfs');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `essay_${req.user?.id || 'u'}_${Date.now()}${ext}`);
  },
});
const uploadEssayPdf = multer({
  storage: essayPdfStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Apenas arquivos PDF são aceitos'));
  },
}).single('pdf');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const countWords = (text) => (!text ? 0 : text.trim().split(/\s+/).filter(Boolean).length);

const computeTotal = (c1, c2, c3, c4, c5) =>
  [c1, c2, c3, c4, c5].reduce((s, v) => s + (v || 0), 0);

// ─── ALUNO: Submeter redação ───────────────────────────────────────────────────

const submitEssay = (req, res, next) => {
  const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data');
  if (isMultipart) {
    uploadEssayPdf(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      try { await _doSubmitEssay(req, res); } catch (e) { next(e); }
    });
  } else {
    _doSubmitEssay(req, res).catch(next);
  }
};

const _doSubmitEssay = async (req, res) => {
    const { title, theme, content, parentId } = req.body;
    const studentId = req.user.id;
    const pdfUrl = req.file ? `/uploads/essay-pdfs/${req.file.filename}` : null;

    // PDF ou texto obrigatório
    if (!pdfUrl && (!content || content.trim().length < 50)) {
      return res.status(400).json({ error: 'Envie o texto (mínimo 50 caracteres) ou um arquivo PDF.' });
    }

    const finalContent = content || '(Redação enviada em PDF — ver anexo)';
    const wordCount = countWords(finalContent);
    const charCount = finalContent.length;

    // Se for reescrita, incrementa versão
    let version = 1;
    if (parentId) {
      const parent = await prisma.essay.findFirst({ where: { id: parentId, studentId } });
      if (parent) {
        version = parent.version + 1;
        await prisma.essay.update({ where: { id: parentId }, data: { status: 'REWRITTEN' } });
      }
    }

    const essay = await prisma.essay.create({
      data: { studentId, title, theme, content: finalContent, pdfUrl, wordCount, charCount, version, parentId: parentId || null },
    });

    // XP por escrever redação
    await prisma.gamification.updateMany({
      where: { userId: studentId },
      data: { xp: { increment: 20 } },
    });

    // Notifica professores vinculados
    const links = await prisma.teacherStudent.findMany({
      where: { studentId, isActive: true },
      include: { student: true },
    });
    if (links.length > 0) {
      await prisma.notification.createMany({
        data: links.map((l) => ({
          userId: l.teacherId,
          title: 'Nova redação para corrigir',
          body: `${l.student.name} enviou "${title}" para correção.`,
          type: 'REDACAO',
          data: { essayId: essay.id, studentId },
        })),
      });
    }

    return created(res, essay, 'Redação enviada com sucesso!');
};

// ─── ALUNO: Listar redações ────────────────────────────────────────────────────

const listEssays = async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = { studentId: req.user.id };
    if (status) where.status = status;

    const essays = await prisma.essay.findMany({
      where,
      include: {
        corrections: {
          select: {
            id: true, totalScore: true, correctedAt: true, requestRewrite: true,
            rewriteDeadline: true, teacher: { select: { id: true, name: true, avatar: true } },
          },
        },
        _count: { select: { comments: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return success(res, essays);
  } catch (err) {
    next(err);
  }
};

// ─── ALUNO: Detalhes de uma redação ───────────────────────────────────────────

const getEssay = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Aluno vê a própria; professor vê a de seus alunos
    const essay = await prisma.essay.findFirst({
      where: {
        id,
        OR: [
          { studentId: userId },
          { student: { studentTeachers: { some: { teacherId: userId, isActive: true } } } },
        ],
      },
      include: {
        student: { select: { id: true, name: true, avatar: true, email: true } },
        corrections: {
          include: {
            teacher: { select: { id: true, name: true, avatar: true } },
            comments: { include: { author: { select: { id: true, name: true, avatar: true } } } },
          },
        },
        comments: {
          include: { author: { select: { id: true, name: true, avatar: true } } },
          orderBy: { createdAt: 'asc' },
        },
        versions: {
          select: { id: true, version: true, status: true, submittedAt: true },
          orderBy: { version: 'desc' },
        },
      },
    });

    if (!essay) return notFound(res, 'Redação não encontrada');
    return success(res, essay);
  } catch (err) {
    next(err);
  }
};

// ─── ALUNO: Gerar link de convite para professor ───────────────────────────────

const generateInvite = async (req, res, next) => {
  try {
    const studentId = req.user.id;
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

    const invite = await prisma.teacherInvite.create({
      data: { studentId, token, expiresAt },
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return success(res, {
      token,
      link: `${baseUrl}/professor/convite?token=${token}`,
      expiresAt,
    });
  } catch (err) {
    next(err);
  }
};

// ─── ALUNO: Listar professores vinculados ─────────────────────────────────────

const listMyTeachers = async (req, res, next) => {
  try {
    const links = await prisma.teacherStudent.findMany({
      where: { studentId: req.user.id, isActive: true },
      include: { teacher: { select: { id: true, name: true, avatar: true, email: true } } },
      orderBy: { linkedAt: 'desc' },
    });
    return success(res, links.map((l) => ({ ...l.teacher, linkedAt: l.linkedAt })));
  } catch (err) {
    next(err);
  }
};

// ─── ALUNO: Evolução (gráfico de notas) ───────────────────────────────────────

const getEvolution = async (req, res, next) => {
  try {
    const studentId = req.user.id;

    const corrections = await prisma.essayCorrection.findMany({
      where: { essay: { studentId } },
      include: { essay: { select: { title: true, theme: true, submittedAt: true, version: true } } },
      orderBy: { correctedAt: 'asc' },
    });

    const timeline = corrections.map((c) => ({
      date: c.correctedAt,
      title: c.essay.title,
      theme: c.essay.theme,
      version: c.essay.version,
      totalScore: c.totalScore,
      scoreC1: c.scoreC1,
      scoreC2: c.scoreC2,
      scoreC3: c.scoreC3,
      scoreC4: c.scoreC4,
      scoreC5: c.scoreC5,
    }));

    // Calcula médias por competência
    const avg = (key) => {
      const vals = corrections.filter((c) => c[key] != null).map((c) => c[key]);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };

    // Identifica erros recorrentes via comentários
    const commentTypes = await prisma.essayComment.groupBy({
      by: ['type'],
      where: { essay: { studentId } },
      _count: { type: true },
      orderBy: { _count: { type: 'desc' } },
    });

    return success(res, {
      timeline,
      averages: {
        totalScore: avg('totalScore'),
        scoreC1: avg('scoreC1'),
        scoreC2: avg('scoreC2'),
        scoreC3: avg('scoreC3'),
        scoreC4: avg('scoreC4'),
        scoreC5: avg('scoreC5'),
      },
      recurringErrors: commentTypes.map((c) => ({ type: c.type, count: c._count.type })),
      totalEssays: await prisma.essay.count({ where: { studentId } }),
      correctedEssays: corrections.length,
    });
  } catch (err) {
    next(err);
  }
};

// ─── ACEITAR CONVITE (rota pública — qualquer usuário logado pode aceitar) ─────

const acceptInvite = async (req, res, next) => {
  try {
    const { token } = req.body;
    const teacherId = req.user.id;

    // Primeiro valida sem modificar
    const invite = await prisma.teacherInvite.findUnique({ where: { token } });
    if (!invite) return res.status(404).json({ error: 'Convite não encontrado.' });
    if (invite.expiresAt < new Date()) return res.status(400).json({ error: 'Convite expirado.' });
    if (invite.studentId === teacherId) return res.status(400).json({ error: 'Você não pode se convidar.' });

    // Marca convite como usado atomicamente — updateMany retorna count=0 se já foi usado
    const { count } = await prisma.teacherInvite.updateMany({
      where: { token, usedAt: null },
      data: { usedAt: new Date(), teacherId },
    });
    if (count === 0) return res.status(400).json({ error: 'Convite já utilizado.' });

    // Atualiza role para TEACHER
    await prisma.user.update({ where: { id: teacherId }, data: { role: 'TEACHER' } });

    // Cria vínculo (upsert para idempotência)
    await prisma.teacherStudent.upsert({
      where: { teacherId_studentId: { teacherId, studentId: invite.studentId } },
      create: { teacherId, studentId: invite.studentId },
      update: { isActive: true },
    });

    // Notifica o aluno
    const teacher = await prisma.user.findUnique({ where: { id: teacherId }, select: { name: true } });
    await prisma.notification.create({
      data: {
        userId: invite.studentId,
        title: 'Professor vinculado!',
        body: `${teacher.name} aceitou ser seu professor de redação.`,
        type: 'PROFESSOR',
      },
    });

    return success(res, { message: 'Vínculo criado com sucesso!' });
  } catch (err) {
    next(err);
  }
};

// ─── INFO DO CONVITE (pré-visualização sem auth) ───────────────────────────────

const getInviteInfo = async (req, res, next) => {
  try {
    const { token } = req.params;
    const invite = await prisma.teacherInvite.findUnique({
      where: { token },
      include: { student: { select: { name: true, avatar: true } } },
    });
    if (!invite || invite.expiresAt < new Date()) {
      return res.status(404).json({ error: 'Convite inválido ou expirado.' });
    }
    return success(res, {
      studentName: invite.student.name,
      studentAvatar: invite.student.avatar,
      expiresAt: invite.expiresAt,
      used: !!invite.usedAt,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitEssay, listEssays, getEssay,
  generateInvite, listMyTeachers, getEvolution,
  acceptInvite, getInviteInfo,
};
