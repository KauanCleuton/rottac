const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const questionBank = require('./questionBank.controller');

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
          hint: 'Verifique se o PDF contém questões numeradas com alternativas A) B) C) D) E), ou itens Certo/Errado com gabarito.',
        });
      }

      // Normaliza para garantir que todas as questões tenham os campos necessários
      const questions = result.questions.map((q) => ({
        number: q.number,
        type: q.type === 'CERTO_ERRADO' ? 'CERTO_ERRADO' : 'MULTIPLA_ESCOLHA',
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
        // Metadados lidos do cabeçalho de cada questão (ex.: "QUESTÃO 01 (IBADE / 2026 / ...)")
        banca: q.banca || null,
        year: q.year || null,
        orgao: q.orgao || null,
        cargo: q.cargo || null,
        textKey: q.textKey ?? null,
      }));

      return success(res, {
        total: questions.length,
        format: result.format,
        texts: Array.isArray(result.texts) ? result.texts : [],
        questions,
      });
    } catch (e) {
      fs.unlink(req.file?.path, () => {});
      next(e);
    }
  });
};

// ─── POST /question-extract/confirm ──────────────────────────────────────────
// Reaproveita a validação do banco de questões: metadados do formulário viram defaults
const extractConfirm = (req, res, next) => {
  const { questions, subjectId, assuntoId, banca, year, source, discipline, topic, orgao, cargo, level, isPublic, texts } = req.body;
  req.body = {
    questions: (questions || []).map((q) => ({
      type: q.type || 'MULTIPLA_ESCOLHA',
      statement: q.statement,
      options: q.type === 'CERTO_ERRADO' ? undefined : q.options,
      answer: q.answer || null,
      explanation: q.explanation || null,
      number: q.number,
      // Metadados por questão têm prioridade sobre os do formulário
      banca: q.banca || undefined,
      year: q.year || undefined,
      orgao: q.orgao || undefined,
      cargo: q.cargo || undefined,
      textKey: q.textKey ?? undefined,
    })),
    texts: Array.isArray(texts) ? texts : [],
    defaults: { subjectId, assuntoId, banca, year, source, discipline, topic, orgao, cargo, level, isPublic },
  };
  return questionBank.bulkCreate(req, res, next);
};

// ─── GET /question-extract/list (legado) ─────────────────────────────────────
const listQuestions = questionBank.list;

// ─── POST /question-extract/:id/answer (legado) ──────────────────────────────
const answerQuestion = questionBank.answer;

module.exports = { extractPreview, extractConfirm, listQuestions, answerQuestion };
