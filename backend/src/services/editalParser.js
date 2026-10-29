// Lê o conteúdo programático colado pelo aluno e separa matérias e tópicos.
//
// Formatos comuns:
//   LÍNGUA PORTUGUESA: 1 Compreensão de textos. 2 Ortografia oficial. 3 Emprego da crase.
//   DIREITO ADMINISTRATIVO
//   1. Atos administrativos. 1.1 Conceito e requisitos. 2. Licitações (Lei nº 14.133/2021).
//   Raciocínio Lógico: proposições; tabelas-verdade; equivalências.

const MAX_ITEMS = 1500;

const UPPER = /^[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9 ,.'’\-–()/ªº]+$/;
const letters = (s) => s.replace(/[^A-Za-zÀ-ÿ]/g, '');
const isUpperWord = (s) => {
  const l = letters(s);
  return l.length >= 3 && l === l.toUpperCase();
};

// "LÍNGUA PORTUGUESA: texto..." ou "Direito Constitucional:" -> { name, rest }
function headerOf(line) {
  const m = line.match(/^([^:]{3,90}):\s*(.*)$/);
  if (m) {
    const name = m[1].trim();
    // Cabeçalho = trecho em maiúsculas, ou título curto sem números ("Raciocínio Lógico: proposições; ...")
    if (isUpperWord(name) || (!/\d/.test(name) && name.split(/\s+/).length <= 6 && /^[A-ZÀ-Ý]/.test(name))) {
      return { name, rest: m[2] };
    }
  }
  // Linha inteira em maiúsculas e sem numeração = nome da matéria
  if (line.length <= 90 && UPPER.test(line) && isUpperWord(line) && !/^\d/.test(line)) {
    return { name: line.replace(/[.:]$/, '').trim(), rest: '' };
  }
  return null;
}

const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[\s\-–•·;,.]+|[\s;,.]+$/g, '').trim();

// Separa pela numeração do edital (1, 1.1, 2...) aceitando só números em sequência,
// para não quebrar em "Lei nº 8.112" ou "art. 5".
function splitNumbered(text) {
  const re = /(^|[\s.;:])(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s+(?=[A-Za-zÀ-ÿ"“(])/g;
  const cuts = [];
  let last = null;
  let m;
  while ((m = re.exec(text))) {
    const parts = m[2].split('.').map(Number);
    const ok = !last
      ? parts[0] <= 2
      : (parts[0] === last[0] + 1 && parts.length === 1)
        || (parts[0] === last[0] && parts.length > 1 && parts.length <= last.length + 1);
    if (!ok) continue;
    cuts.push({ at: m.index + m[1].length, start: m.index + m[0].length, num: m[2] });
    last = parts;
  }
  if (cuts.length < 2) return null;
  const out = [];
  const head = clean(text.slice(0, cuts[0].at));
  if (head.length > 3) out.push(head);
  cuts.forEach((c, i) => {
    const body = clean(text.slice(c.start, i + 1 < cuts.length ? cuts[i + 1].at : undefined));
    if (body) out.push(`${c.num} ${body}`);
  });
  return out;
}

function splitTopics(text) {
  const numbered = splitNumbered(text);
  if (numbered) return numbered;
  // Sem numeração: ponto e vírgula, ou frases terminadas em ponto
  const parts = text.includes(';') ? text.split(';') : text.split(/\.\s+(?=[A-ZÀ-Ý])/);
  return parts.map(clean).filter((p) => p.length > 2);
}

function parseEdital(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const h = headerOf(line);
    if (h) {
      cur = { name: clean(h.name), text: h.rest };
      blocks.push(cur);
    } else if (cur) {
      cur.text += `\n${line}`;
    } else {
      cur = { name: 'Geral', text: line };
      blocks.push(cur);
    }
  }

  const disciplines = [];
  let count = 0;
  for (const b of blocks) {
    // Linhas do bloco: se cada uma já é um tópico (lista), respeita; senão junta e separa pela numeração
    const joined = b.text.replace(/\n+/g, ' ');
    const items = splitTopics(joined).slice(0, MAX_ITEMS - count);
    // Cabeçalhos de grupo ("CONHECIMENTOS BÁSICOS") ficam sem tópicos e são descartados
    if (!items.length) continue;
    count += items.length;
    const existing = disciplines.find((d) => d.name.toLowerCase() === b.name.toLowerCase());
    if (existing) existing.items.push(...items);
    else disciplines.push({ name: b.name.slice(0, 191), items });
    if (count >= MAX_ITEMS) break;
  }
  return disciplines;
}

module.exports = { parseEdital, splitTopics };
