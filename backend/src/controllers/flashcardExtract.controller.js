const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PYTHON_SERVICE = process.env.INTELLIGENCE_SERVICE_URL || 'http://localhost:3003';

// ─── Multer config ─────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/flashcard-pdfs');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `fc_${req.user?.id}_${Date.now()}.pdf`);
  },
});

const uploadMiddleware = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Apenas PDF aceito.'));
    cb(null, true);
  },
  limits: { fileSize: 30 * 1024 * 1024 },
}).single('pdf');

// ─── Helper: extrai texto do PDF via serviço Python ───────────────────────
async function extractTextFromPdf(filePath) {
  const fileBuffer = fs.readFileSync(filePath);

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  formData.append('file', blob, path.basename(filePath));

  const resp = await fetch(`${PYTHON_SERVICE}/text`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) throw new Error(`Python service retornou ${resp.status}`);
  const data = await resp.json();
  console.log(`[flashcard/extract] chars extraídos: ${data.chars}`);
  return data.text || '';
}

// ─── POST /flashcards/extract/debug ───────────────────────────────────────
// Retorna o texto bruto extraído do PDF — útil para diagnosticar problemas
const extractDebug = (req, res, next) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

    try {
      const rawText = await extractTextFromPdf(req.file.path);
      fs.unlink(req.file.path, () => {});

      // Mostra primeiros 3000 chars + amostra do meio
      return res.json({
        totalChars: rawText.length,
        totalLines: rawText.split('\n').length,
        sample_start: rawText.substring(0, 1500),
        sample_mid: rawText.substring(Math.floor(rawText.length / 2), Math.floor(rawText.length / 2) + 1000),
        lines_sample: rawText.split('\n').slice(0, 50),
      });
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      next(e);
    }
  });
};

// ─── POST /flashcards/extract/preview ─────────────────────────────────────
const extractPreview = (req, res, next) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });

    try {
      const rawText = await extractTextFromPdf(req.file.path);
      fs.unlink(req.file.path, () => {});

      const pairs = parseFlashcards(rawText);

      if (pairs.length === 0) {
        return res.status(422).json({
          error: 'Nenhum par detectado.',
          hint: 'Use o endpoint /debug para ver o texto que foi extraído do PDF.',
          rawSample: rawText.substring(0, 800),
          totalChars: rawText.length,
        });
      }

      return success(res, {
        total: pairs.length,
        pairs,
      });
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {});
      next(parseErr);
    }
  });
};

// ─── POST /flashcards/extract/confirm ─────────────────────────────────────
const extractConfirm = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { pairs, subjectId } = req.body;

    if (!pairs || pairs.length === 0) {
      return res.status(400).json({ error: 'Nenhum par enviado.' });
    }

    const data = pairs
      .filter((p) => p.front?.trim() && p.back?.trim())
      .map((p) => ({
        userId,
        front: p.front.trim(),
        back: p.back.trim(),
        subjectId: subjectId || null,
        difficulty: 'MEDIO',
      }));

    await prisma.flashcard.createMany({ data });

    await prisma.gamification.updateMany({
      where: { userId },
      data: { xp: { increment: data.length * 3 } },
    });

    return success(res, {
      created: data.length,
      message: `${data.length} flashcards criados!`,
    });
  } catch (err) {
    next(err);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ─── PARSER PRINCIPAL (MÁQUINA DE ESTADOS) ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
//
// Lê linha a linha e mantém estado: IDLE → QUESTION → ANSWER
// Muito mais robusto que regex porque:
// - Trata respostas que continuam em múltiplas linhas
// - Ignora cabeçalhos/rodapés/números de página automaticamente
// - Funciona com o formato exato: "1. PERGUNTA?\nR: RESPOSTA"
//
function parseFlashcards(rawText) {
  // ── 1. Limpeza inicial do texto bruto ─────────────────────────────────
  const cleaned = cleanPdfText(rawText);
  const lines = cleaned.split('\n');

  // ── 2. Tenta cada estratégia em ordem ─────────────────────────────────
  let pairs = [];

  // Estratégia A: Máquina de estados (formatos numerados + R:)
  pairs = stateMachineParser(lines);
  if (pairs.length > 0) return deduplicate(pairs);

  // Estratégia B: Busca por R: sem número (pergunta antes, R: depois)
  pairs = answerPrefixParser(cleaned);
  if (pairs.length > 0) return deduplicate(pairs);

  // Estratégia C: Blocos Q/A com delimitadores variados
  pairs = blockParser(cleaned);
  if (pairs.length > 0) return deduplicate(pairs);

  // Estratégia D: Par de linhas (linha par = frente, ímpar = verso)
  pairs = alternatingLineParser(lines);
  return deduplicate(pairs);
}

// ── Estratégia A: Máquina de estados ──────────────────────────────────────
// Detecta início de questão por número ou palavra-chave,
// detecta início de resposta por R:, RESPOSTA:, A:, etc.
function stateMachineParser(lines) {
  const pairs = [];
  let state = 'IDLE'; // IDLE | IN_QUESTION | IN_ANSWER
  let currentFront = [];
  let currentBack = [];

  // Padrões de início de questão:
  // "1.", "1)", "1 -", "Questão 1", "QUESTÃO 1", "Q1.", "1º"
  const IS_QUESTION_START = /^(\d{1,3}[.):\-–]|questão\s*\d|q\d+[.):]|\d{1,3}º[.):])/i;

  // Padrões de início de resposta:
  // "R:", "R.", "R -", "RESPOSTA:", "Resp:", "A:", "Gabarito:"
  const IS_ANSWER_START = /^(r[.:)\-–\s]|resposta[.:)\s]|resp[.:)\s]|gabarito[.:)\s]|a[.:)\-]\s)/i;

  // Linhas que provavelmente são lixo de PDF (número de página, cabeçalho curto)
  const IS_NOISE = /^(\d{1,3}|página\s*\d+|pág\.\s*\d+|www\.|http)$/i;

  function savePair() {
    const front = currentFront.join(' ').trim();
    const back = currentBack.join(' ').trim();
    if (front.length > 5 && back.length > 3) {
      pairs.push({ front: cleanFinal(front), back: cleanFinal(back) });
    }
    currentFront = [];
    currentBack = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (IS_NOISE.test(line)) continue;

    const isQStart = IS_QUESTION_START.test(line);
    const isAStart = IS_ANSWER_START.test(line);

    if (isQStart) {
      // Inicia nova questão — salva o par anterior se existia
      if (state === 'IN_ANSWER' && currentBack.length > 0) savePair();
      else if (state === 'IN_QUESTION') { currentFront = []; }

      state = 'IN_QUESTION';
      // Remove o prefixo numérico da linha
      currentFront = [line.replace(/^\d{1,3}[.):\-–\s]+/, '').replace(/^questão\s*\d+[.:)\s]*/i, '').trim()];
      currentBack = [];

    } else if (isAStart) {
      // Inicia resposta
      if (state === 'IN_QUESTION' || state === 'IN_ANSWER') {
        if (state === 'IN_ANSWER') savePair();
        state = 'IN_ANSWER';
        // Remove o prefixo R: da linha
        const answerText = line.replace(/^(r[.:)\-–\s]+|resposta[.:)\s]+|resp[.:)\s]+|gabarito[.:)\s]+|a[.:)\-]\s+)/i, '').trim();
        currentBack = answerText ? [answerText] : [];
      }

    } else {
      // Linha de continuação
      if (state === 'IN_QUESTION') {
        currentFront.push(line);
      } else if (state === 'IN_ANSWER') {
        // Continuação da resposta (pode ser multi-linha)
        currentBack.push(line);
      }
    }
  }

  // Salva o último par
  if (state === 'IN_ANSWER') savePair();

  return pairs;
}

// ── Estratégia B: Busca por R: como âncora ────────────────────────────────
// Divide o texto inteiro em blocos terminados por "R: ..." e
// trata o texto antes como pergunta.
function answerPrefixParser(text) {
  const pairs = [];

  // Divide antes de cada "R:" / "R." que apareça início de linha (ou após quebra)
  // Captura tudo entre um R: e o próximo início de questão numerada
  const blocks = text.split(/\n(?=\s*[RA][.:)\s])/);

  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i];
    const nextBlock = blocks[i + 1];

    // Extrai a resposta do próximo bloco (começa com R:)
    const answerMatch = nextBlock.match(/^[RA][.:)\s]+(.+)/s);
    if (!answerMatch) continue;

    // A questão é o bloco atual — pega a última linha não vazia como pergunta
    const questionLines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (questionLines.length === 0) continue;

    const front = cleanFinal(questionLines.join(' '));
    const back = cleanFinal(answerMatch[1].split('\n')[0]); // pega só a 1ª linha da resposta

    if (front.length > 5 && back.length > 3) {
      pairs.push({ front, back });
    }
  }

  return pairs;
}

// ── Estratégia C: Blocos Q/A ──────────────────────────────────────────────
// Divide por linhas em branco e trata blocos alternados
function blockParser(text) {
  const pairs = [];
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(b => b.length > 5);

  for (let i = 0; i + 1 < blocks.length; i += 2) {
    const front = cleanFinal(blocks[i].replace(/^\d+[.):\s]+/, ''));
    const back = cleanFinal(blocks[i + 1].replace(/^[RA][.:)\s]+/i, ''));
    if (front.length > 5 && back.length > 3) {
      pairs.push({ front, back });
    }
  }

  return pairs.length <= 3 ? [] : pairs; // Muito poucos → provavelmente falso positivo
}

// ── Estratégia D: Linhas alternadas ───────────────────────────────────────
function alternatingLineParser(lines) {
  const meaningful = lines
    .map(l => l.trim())
    .filter(l => l.length > 8 && !/^\d{1,3}$/.test(l));

  if (meaningful.length < 4) return [];

  const pairs = [];
  for (let i = 0; i + 1 < meaningful.length; i += 2) {
    const front = cleanFinal(meaningful[i]);
    const back = cleanFinal(meaningful[i + 1]);
    if (front.length > 5 && back.length > 3) {
      pairs.push({ front, back });
    }
  }

  // Rejeita se parece muito aleatório (sem perguntas entre os fronts)
  const hasQuestions = pairs.some(p => p.front.includes('?') || /^(o que|como|qual|quando|onde|por que|quem)/i.test(p.front));
  return hasQuestions ? pairs.slice(0, 200) : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── LIMPEZA DE TEXTO ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function cleanPdfText(text) {
  return text
    // Normaliza quebras de linha
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove hífens de quebra de palavra no meio (ex: "consti-\ntuição" → "constituição")
    .replace(/-\n([a-záéíóúãõàêôû])/gi, '$1')
    // Colapsa espaços múltiplos em um só
    .replace(/[^\S\n]+/g, ' ')
    // Remove linhas que são só números (página)
    .replace(/^\s*\d{1,3}\s*$/gm, '')
    // Remove espaços no início/fim de cada linha
    .replace(/^ +/gm, '')
    .replace(/ +$/gm, '')
    // Reduz linhas em branco excessivas
    .replace(/\n{4,}/g, '\n\n');
}

function cleanFinal(text) {
  return text
    // Remove prefixo numérico "1.", "1)", etc.
    .replace(/^\d{1,3}[.):\-–\s]+/, '')
    // Remove prefixo de resposta "R:", "A:", etc.
    .replace(/^[RA][.:)\-–\s]+/i, '')
    // Normaliza espaços
    .replace(/\s+/g, ' ')
    .trim();
}

function deduplicate(pairs) {
  const seen = new Set();
  return pairs.filter(p => {
    const key = p.front.substring(0, 40).toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { extractPreview, extractConfirm, extractDebug };
