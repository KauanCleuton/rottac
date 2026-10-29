// Lei seca: separa o texto colado (formato do Planalto) em artigos, guardando
// em que título/capítulo/seção cada um está, e acha citações "art. 37" em questões.

const HEADING = /^(LIVRO|PARTE|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O)\b/i;
const LEVELS = ['LIVRO', 'PARTE', 'TITULO', 'CAPITULO', 'SECAO', 'SUBSECAO'];
// Sufixos podem encadear: "Art. 359-M-A"
const ARTICLE = /^Art\.?\s*(\d{1,4})(?:\.(\d{3}))?\s*[º°o]?\s*(?:-\s*([A-Z]{1,2}(?:-[A-Z]{1,2})*)\b)?\s*[.\-–—]?\s*/i;
// Parte que reinicia a numeração dos artigos (ADCT, no fim da Constituição)
// (só a linha do cabeçalho, em maiúsculas: o índice do Planalto também cita "Ato das Disposições…")
const ANNEX = /^ATO DAS DISPOSI[ÇC][ÕO]ES CONSTITUCIONAIS TRANSIT[ÓO]RIAS$/;
// Nota do Planalto sozinha na linha: "(Incluído pela Lei nº 14.197, de 2021) (Vigência)"
const NOTE = /^\(.*\)(\s*\(?Vig[êe]ncia\)?)?$/i;

const levelOf = (line) => {
  const k = line.match(HEADING)[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return LEVELS.indexOf(k);
};
const isUpper = (s) => {
  const l = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
  return l.length >= 3 && l === l.toUpperCase();
};

// -> [{ number: "37" | "121-A", heading, text }]
function parseLaw(raw) {
  const lines = String(raw || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const stack = []; // títulos/capítulos ativos, por nível
  const articles = [];
  let cur = null;
  let pendingHeading = -1; // nível do cabeçalho que ainda pode receber o nome na linha seguinte

  for (const line of lines) {
    const art = line.match(ARTICLE);
    if (art) {
      const number = `${art[1]}${art[2] || ''}${art[3] ? `-${art[3].toUpperCase()}` : ''}`;
      cur = { number, heading: stack.filter(Boolean).join(' › ') || null, text: line };
      articles.push(cur);
      pendingHeading = -1;
      continue;
    }
    if (ANNEX.test(line)) {
      stack.length = 0;
      stack[0] = 'ADCT – Ato das Disposições Constitucionais Transitórias';
      pendingHeading = -1;
      cur = null;
      continue;
    }
    if (HEADING.test(line) && line.length <= 200) {
      const lvl = levelOf(line);
      stack[lvl] = line;
      stack.length = lvl + 1; // novo capítulo encerra as seções do anterior
      pendingHeading = lvl;
      cur = null;
      continue;
    }
    // Nota entre o cabeçalho e o nome dele: ignora e continua esperando o nome
    if (pendingHeading >= 0 && NOTE.test(line)) continue;
    // Nome do título/capítulo na linha de baixo ("DOS DIREITOS E GARANTIAS FUNDAMENTAIS")
    if (pendingHeading >= 0 &&(isUpper(line) || line.length <= 120) && !/^[IVXLC]+\s*[-–]/.test(line)) {
      stack[pendingHeading] = `${stack[pendingHeading]} – ${line}`;
      pendingHeading = -1;
      continue;
    }
    pendingHeading = -1;
    // Incisos, alíneas e parágrafos continuam o artigo atual
    if (cur) cur.text += `\n${line}`;
  }
  return articles.map((a) => ({ ...a, text: a.text.slice(0, 60000) }));
}

// Números de artigo citados num texto: "art. 5º", "arts. 37 e 38", "artigo 121-A", "art. 5º, LXVIII"
function citedArticles(text) {
  const out = new Set();
  const re = /\b(?:arts?\.|artigos?)\s*((?:\d{1,4}(?:\.\d{3})?\s*[º°o]?(?:\s*-\s*[A-Z]{1,2}(?:-[A-Z]{1,2})*\b)?(?:\s*(?:,|e|a)\s*)?)+)/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const nums = m[1].match(/\d{1,4}(?:\.\d{3})?\s*[º°o]?(?:\s*-\s*[A-Z]{1,2}(?:-[A-Z]{1,2})*\b)?/g) || [];
    for (const n of nums) {
      const k = n.match(/(\d{1,4})(?:\.(\d{3}))?\s*[º°o]?(?:\s*-\s*([A-Z]{1,2}(?:-[A-Z]{1,2})*))?/);
      out.add(`${k[1]}${k[2] || ''}${k[3] ? `-${k[3].toUpperCase()}` : ''}`);
    }
  }
  return out;
}

module.exports = { parseLaw, citedArticles };
