const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');

// ─── Multer config ─────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/editais');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `edital_${req.user?.id}_${ts}${ext}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Apenas arquivos PDF são aceitos.'));
    }
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
}).single('edital');

// ─── POST /edital/upload ───────────────────────────────────────────────────
const uploadEdital = (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Arquivo não recebido.' });

    try {
      const userId = req.user.id;

      const record = await prisma.editalImport.create({
        data: {
          userId,
          fileName: req.file.originalname,
          fileUrl: `/uploads/editais/${req.file.filename}`,
          status: 'PROCESSANDO',
        },
      });

      // Processa em background
      processEdital(record.id, req.file.path).catch(console.error);

      return success(res, { id: record.id, status: 'PROCESSANDO', message: 'Edital recebido. Processando extração...' });
    } catch (dbErr) { next(dbErr); }
  });
};

// ─── GET /edital/:id/status ────────────────────────────────────────────────
const getStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const record = await prisma.editalImport.findUnique({ where: { id } });
    if (!record) return res.status(404).json({ error: 'Importação não encontrada.' });
    return success(res, record);
  } catch (err) { next(err); }
};

// ─── GET /edital ───────────────────────────────────────────────────────────
const getAll = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const imports = await prisma.editalImport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, imports);
  } catch (err) { next(err); }
};

// ─── POST /edital/:id/confirm ──────────────────────────────────────────────
const confirm = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { contestName, year, subjects } = req.body;

    const record = await prisma.editalImport.findFirst({ where: { id, userId } });
    if (!record) return res.status(404).json({ error: 'Importação não encontrada.' });

    // Persiste os dados confirmados
    await prisma.editalImport.update({
      where: { id },
      data: {
        contestName,
        year,
        status: 'CONFIRMADO',
        confirmedData: { contestName, year, subjects },
      },
    });

    // Cria disciplinas no sistema
    const created = [];
    for (const subj of subjects) {
      const subject = await prisma.subject.create({
        data: {
          userId,
          name: subj.name,
          weight: subj.weight || 1.0,
          color: getSubjectColor(subj.name),
          modules: {
            create: subj.topics
              ? [{
                  name: 'Módulo Principal',
                  topics: {
                    create: subj.topics.map((t, i) => ({
                      name: t,
                      order: i,
                      difficulty: 'MEDIO',
                      estimatedHours: (subj.weight || 1) * 2,
                    })),
                  },
                }]
              : [],
          },
        },
      });
      created.push(subject);
    }

    // Gera notificação
    await prisma.notification.create({
      data: {
        userId,
        title: 'Edital importado com sucesso!',
        body: `${created.length} disciplinas criadas para ${contestName || 'seu concurso'}.`,
        type: 'SISTEMA',
        data: { editalId: id, subjectsCount: created.length },
      },
    });

    return success(res, {
      message: 'Edital confirmado! Disciplinas criadas.',
      subjectsCreated: created.length,
      subjects: created,
    });
  } catch (err) { next(err); }
};

// ─── Processamento assíncrono do edital ───────────────────────────────────
async function processEdital(importId, filePath) {
  try {
    // Tenta usar o serviço Python (porta 3003 — unified intelligence service)
    const EDITAL_SERVICE = process.env.INTELLIGENCE_SERVICE_URL || 'http://localhost:3003';

    let extractedData;
    try {
      const formData = new FormData();
      const fileBuffer = fs.readFileSync(filePath);
      const blob = new Blob([fileBuffer], { type: 'application/pdf' });
      formData.append('file', blob, path.basename(filePath));

      const resp = await fetch(`${EDITAL_SERVICE}/extract`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(120_000),
      });

      if (resp.ok) {
        extractedData = await resp.json();
      }
    } catch (serviceErr) {
      // Serviço Python indisponível — usa extração heurística local
      console.warn('Serviço Python indisponível. Usando extração heurística...');
      extractedData = await extractHeuristic(filePath);
    }

    await prisma.editalImport.update({
      where: { id: importId },
      data: {
        status: 'AGUARDANDO_CONFIRMACAO',
        extractedData,
        processedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.editalImport.update({
      where: { id: importId },
      data: { status: 'ERRO', errorMessage: err.message },
    });
  }
}

// ─── Extração heurística local (fallback sem Python) ──────────────────────
async function extractHeuristic(filePath) {
  // Lê o PDF via serviço Python
  const PYTHON_SERVICE = process.env.INTELLIGENCE_SERVICE_URL || 'http://localhost:3003';
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
  const pdfData = await resp.json();
  const rawText = pdfData.text || '';
  const text = rawText.toLowerCase();

  // Tenta extrair nome do concurso das primeiras linhas
  const firstLines = rawText.split('\n').slice(0, 20).join(' ');
  const contestName = firstLines.substring(0, 100).trim() || null;

  // Mapeamento: termo buscado no PDF → metadados da disciplina
  const SUBJECT_MAP = {
    'língua portuguesa':      { name: 'Língua Portuguesa',       weight: 2.0, topics: ['Interpretação de texto', 'Gramática', 'Ortografia', 'Coesão e coerência', 'Redação oficial'] },
    'portugues':              { name: 'Língua Portuguesa',       weight: 2.0, topics: ['Interpretação de texto', 'Gramática'] },
    'direito constitucional': { name: 'Direito Constitucional',  weight: 2.0, topics: ['Princípios fundamentais', 'Direitos e garantias', 'Organização do Estado', 'Poderes da União'] },
    'direito administrativo': { name: 'Direito Administrativo',  weight: 2.0, topics: ['Princípios da administração', 'Atos administrativos', 'Licitação', 'Contratos'] },
    'direito penal':          { name: 'Direito Penal',           weight: 1.5, topics: ['Teoria do crime', 'Crimes contra a pessoa', 'Penas'] },
    'direito processual penal': { name: 'Direito Processual Penal', weight: 1.5, topics: ['Inquérito policial', 'Ação penal', 'Prisões'] },
    'direito processual civil': { name: 'Direito Processual Civil', weight: 1.5, topics: ['Processo de conhecimento', 'Recursos', 'Execução'] },
    'direito civil':          { name: 'Direito Civil',           weight: 1.5, topics: ['Pessoas', 'Bens', 'Negócio jurídico', 'Contratos', 'Responsabilidade civil'] },
    'direito do trabalho':    { name: 'Direito do Trabalho',     weight: 1.5, topics: ['Contrato de trabalho', 'Rescisão', 'FGTS', 'Jornada'] },
    'direito tributário':     { name: 'Direito Tributário',      weight: 1.5, topics: ['Sistema tributário', 'Impostos', 'CTN', 'Obrigação tributária'] },
    'direito financeiro':     { name: 'Direito Financeiro',      weight: 1.0, topics: ['Orçamento público', 'Lei de responsabilidade fiscal'] },
    'matemática':             { name: 'Matemática',              weight: 1.5, topics: ['Aritmética', 'Álgebra', 'Geometria', 'Probabilidade'] },
    'raciocínio lógico':      { name: 'Raciocínio Lógico',       weight: 1.5, topics: ['Proposições', 'Silogismos', 'Sequências', 'Análise combinatória'] },
    'raciocinio logico':      { name: 'Raciocínio Lógico',       weight: 1.5, topics: ['Proposições', 'Silogismos'] },
    'informática':            { name: 'Informática',             weight: 1.0, topics: ['Windows', 'Pacote Office', 'Internet', 'Segurança da informação'] },
    'informatica':            { name: 'Informática',             weight: 1.0, topics: ['Windows', 'Pacote Office'] },
    'tecnologia da informação': { name: 'Tecnologia da Informação', weight: 1.5, topics: ['Redes', 'Banco de dados', 'Segurança', 'Sistemas operacionais'] },
    'contabilidade':          { name: 'Contabilidade',           weight: 1.5, topics: ['Patrimônio', 'Balanço patrimonial', 'DRE', 'Conciliação'] },
    'administração pública':  { name: 'Administração Pública',   weight: 1.5, topics: ['Princípios', 'Gestão por competências', 'Planejamento estratégico'] },
    'administracao publica':  { name: 'Administração Pública',   weight: 1.5, topics: ['Princípios', 'Gestão por competências'] },
    'administração geral':    { name: 'Administração Geral',     weight: 1.5, topics: ['Funções administrativas', 'Organização', 'Liderança'] },
    'economia':               { name: 'Economia',                weight: 1.0, topics: ['Microeconomia', 'Macroeconomia', 'Política fiscal'] },
    'estatística':            { name: 'Estatística',             weight: 1.0, topics: ['Medidas de tendência central', 'Dispersão', 'Probabilidade'] },
    'inglês':                 { name: 'Inglês',                  weight: 1.0, topics: ['Interpretação de texto', 'Gramática', 'Vocabulário'] },
    'legislação específica':  { name: 'Legislação Específica',   weight: 1.5, topics: ['Lei orgânica', 'Estatuto do órgão', 'Normas internas'] },
    'conhecimentos gerais':   { name: 'Conhecimentos Gerais',    weight: 1.0, topics: ['Atualidades', 'História', 'Geografia', 'Ciências'] },
    'atualidades':            { name: 'Atualidades',             weight: 1.0, topics: ['Fatos recentes', 'Política', 'Economia', 'Sociedade'] },
    'ética':                  { name: 'Ética e Moral',           weight: 1.0, topics: ['Ética no serviço público', 'Código de ética'] },
    'ética no serviço público': { name: 'Ética no Serviço Público', weight: 1.0, topics: ['Decreto 1.171/94', 'Conduta profissional'] },
    'finanças públicas':      { name: 'Finanças Públicas',       weight: 1.5, topics: ['Orçamento', 'Dívida pública', 'LRF'] },
    'português instrumental': { name: 'Português Instrumental',  weight: 1.5, topics: ['Interpretação de texto', 'Correspondência oficial'] },
    'comunicação social':     { name: 'Comunicação Social',      weight: 1.0, topics: ['Teorias da comunicação', 'Jornalismo', 'Publicidade'] },
    'segurança da informação':{ name: 'Segurança da Informação', weight: 1.5, topics: ['Criptografia', 'Firewall', 'Gestão de riscos', 'LGPD'] },
    'banco de dados':         { name: 'Banco de Dados',          weight: 1.5, topics: ['SQL', 'Modelagem relacional', 'NoSQL', 'Transações'] },
    'redes de computadores':  { name: 'Redes de Computadores',   weight: 1.5, topics: ['TCP/IP', 'Roteamento', 'DNS', 'HTTP', 'Cabeamento'] },
    'engenharia de software': { name: 'Engenharia de Software',  weight: 1.5, topics: ['Scrum', 'UML', 'Testes', 'Padrões de projeto'] },
    'sistemas operacionais':  { name: 'Sistemas Operacionais',   weight: 1.0, topics: ['Linux', 'Windows Server', 'Processos', 'Memória'] },
    'programação':            { name: 'Programação',             weight: 1.5, topics: ['Algoritmos', 'Estruturas de dados', 'Lógica de programação'] },
    'legislação trabalhista': { name: 'Legislação Trabalhista',  weight: 1.5, topics: ['CLT', 'Constituição - capítulo trabalhista', 'Reforma trabalhista'] },
    'gestão de pessoas':      { name: 'Gestão de Pessoas',       weight: 1.0, topics: ['Motivação', 'Liderança', 'Avaliação de desempenho'] },
    'gestão de projetos':     { name: 'Gestão de Projetos',      weight: 1.0, topics: ['PMBOK', 'Scrum', 'Cronograma', 'Riscos'] },
    'arquivologia':           { name: 'Arquivologia',            weight: 1.0, topics: ['Gestão de documentos', 'Arquivos públicos', 'Classificação'] },
    'biblioteconomia':        { name: 'Biblioteconomia',         weight: 1.0, topics: ['Catalogação', 'Indexação', 'Referência'] },
    'auditoria':              { name: 'Auditoria',               weight: 1.5, topics: ['Auditoria interna', 'Normas de auditoria', 'Relatórios'] },
    'controle interno':       { name: 'Controle Interno',        weight: 1.5, topics: ['Controle na administração pública', 'TCU', 'CGU'] },
    'licitações':             { name: 'Licitações e Contratos',  weight: 1.5, topics: ['Lei 8.666', 'Lei 14.133', 'Modalidades de licitação', 'Pregão'] },
    'licitacao':              { name: 'Licitações e Contratos',  weight: 1.5, topics: ['Lei 8.666', 'Lei 14.133'] },
  };

  const seen = new Set();
  const detected = [];

  for (const [key, val] of Object.entries(SUBJECT_MAP)) {
    // Só adiciona se o termo realmente aparecer no texto do PDF
    if (!text.includes(key) && !text.includes(key.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) continue;
    // Evita duplicatas (ex: "informática" e "informatica" mapeando para o mesmo nome)
    if (seen.has(val.name)) continue;
    seen.add(val.name);

    detected.push({
      name: val.name,
      weight: val.weight,
      topics: val.topics,
      confidence: 0.85,
      source: 'heuristic',
    });
  }

  // Tenta também extrair linhas que parecem nomes de disciplinas (letras maiúsculas, número de questões, etc.)
  // Ex: "MATEMÁTICA - 20 questões" ou "3. DIREITO CONSTITUCIONAL"
  const disciplineLineRegex = /^[\d\s.)-]*([A-ZÁÉÍÓÚÃÕÀÊÔÛÇ][A-ZÁÉÍÓÚÃÕÀÊÔÛÇ\s\/]{4,50}?)[\s:–-]+\d/gm;
  const matches = [...data.text.matchAll(disciplineLineRegex)];
  for (const m of matches) {
    const name = m[1].trim().replace(/\s+/g, ' ');
    if (name.length > 4 && name.length < 60 && !seen.has(name)) {
      seen.add(name);
      detected.push({ name, weight: 1.0, topics: [], confidence: 0.6, source: 'auto_detect' });
    }
  }

  return {
    subjects: detected,
    contestName,
    method: 'heuristic_local',
    totalPages: rawText.split('\n').length,
    warning: detected.length === 0
      ? 'Nenhuma disciplina detectada automaticamente. Adicione manualmente.'
      : `${detected.length} disciplinas detectadas no PDF. Revise antes de confirmar.`,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function getSubjectColor(name) {
  const colors = {
    'Língua Portuguesa': '#6C63FF',
    'Direito Constitucional': '#3B82F6',
    'Direito Administrativo': '#10B981',
    'Matemática': '#F59E0B',
    'Raciocínio Lógico': '#EF4444',
    'Informática': '#8B5CF6',
    'Direito Penal': '#DC2626',
    'Direito Civil': '#2563EB',
    'Direito do Trabalho': '#D97706',
    'Contabilidade': '#059669',
  };
  return colors[name] || '#9CA3AF';
}

module.exports = { uploadEdital, getStatus, getAll, confirm };
