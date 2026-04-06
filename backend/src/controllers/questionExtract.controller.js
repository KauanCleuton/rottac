const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PYTHON_SERVICE = process.env.INTELLIGENCE_SERVICE_URL || 'http://localhost:3003';

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/question-pdfs');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `q_${req.user?.id}_${Date.now()}.pdf`);
  },
});

const uploadMiddleware = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Apenas PDF aceito.'));
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 },
}).single('pdf');

// ─── POST /question-extract/preview ──────────────────────────────────────────
const extractPreview = (req, res, next) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

    try {
      const fileBuffer = fs.readFileSync(req.file.path);
      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: 'application/pdf' });
      formData.append('file', blob, path.basename(req.file.path));

      let result;
      try {
        const resp = await fetch(`${PYTHON_SERVICE}/extract-questions`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(120_000),
        });
        if (!resp.ok) throw new Error(`Python retornou ${resp.status}`);
        result = await resp.json();
      } catch (serviceErr) {
        console.warn('[questionExtract] Python indisponível:', serviceErr.message);
        fs.unlink(req.file.path, () => {});
        return res.status(503).json({
          error: 'Serviço de extração indisponível. Certifique-se que o servidor Python está rodando.',
        });
      }

      fs.unlink(req.file.path, () => {});

      if (!result.questions || result.questions.length === 0) {
        return res.status(422).json({
          error: 'Nenhuma questão detectada.',
          format: result.format,
          hint: 'Verifique se o PDF contém questões numeradas com alternativas A) B) C) D) E).',
        });
      }

      // Normaliza para garantir que todas as questões tenham os campos necessários
      const questions = result.questions.map((q) => ({
        number: q.number,
        statement: q.statement || '',
        options: {
          A: q.options?.A || '',
          B: q.options?.B || '',
          C: q.options?.C || '',
          D: q.options?.D || '',
          E: q.options?.E || null,
        },
        answer: q.answer || '',
        explanation: q.explanation || '',
      }));

      return success(res, {
        total: questions.length,
        format: result.format,
        questions,
      });
    } catch (e) {
      fs.unlink(req.file?.path, () => {});
      next(e);
    }
  });
};

// ─── POST /question-extract/confirm ──────────────────────────────────────────
const extractConfirm = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { questions, subjectId, banca, year, source } = req.body;

    if (!questions || questions.length === 0) {
      return res.status(400).json({ error: 'Nenhuma questão enviada.' });
    }

    const data = questions
      .filter((q) => q.statement?.trim() && q.options?.A && q.options?.B && q.answer)
      .map((q) => ({
        userId,
        subjectId: subjectId || null,
        statement: q.statement.trim(),
        optionA: q.options.A.trim(),
        optionB: q.options.B.trim(),
        optionC: (q.options.C || '').trim(),
        optionD: (q.options.D || '').trim(),
        optionE: q.options.E ? q.options.E.trim() : null,
        answer: q.answer.toUpperCase(),
        explanation: q.explanation?.trim() || null,
        banca: banca || null,
        year: year ? parseInt(year) : null,
        source: source || null,
        difficulty: 'MEDIO',
      }));

    await prisma.question.createMany({ data });

    // XP por importar questões
    await prisma.gamification.updateMany({
      where: { userId },
      data: { xp: { increment: data.length * 2 } },
    });

    return success(res, {
      created: data.length,
      message: `${data.length} questões importadas com sucesso!`,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /question-extract/list ───────────────────────────────────────────────
const listQuestions = async (req, res, next) => {
  try {
    const { subjectId, banca, page = '1', limit = '20' } = req.query;
    const userId = req.user.id;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { userId };
    if (subjectId) where.subjectId = subjectId;
    if (banca) where.banca = banca;

    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        include: { subject: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.question.count({ where }),
    ]);

    return success(res, { questions, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    next(err);
  }
};

// ─── POST /question-extract/:id/answer ───────────────────────────────────────
const answerQuestion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { selected, timeSpent } = req.body;
    const userId = req.user.id;

    const question = await prisma.question.findUnique({ where: { id } });
    if (!question) return res.status(404).json({ error: 'Questão não encontrada.' });

    const isCorrect = selected.toUpperCase() === question.answer.toUpperCase();

    await prisma.questionAttempt.create({
      data: { questionId: id, userId, selected: selected.toUpperCase(), isCorrect, timeSpent: timeSpent || null },
    });

    if (isCorrect) {
      await prisma.gamification.updateMany({ where: { userId }, data: { xp: { increment: 5 } } });
    }

    return success(res, {
      isCorrect,
      correctAnswer: question.answer,
      explanation: question.explanation,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { extractPreview, extractConfirm, listQuestions, answerQuestion };
