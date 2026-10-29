// Árvore de matérias e assuntos (tabela assuntos), mantida em memória.
// São ~6.600 nós que quase nunca mudam: carregar uma vez deixa filtros, contagens e
// caminhos ("Direito Administrativo › Atos Administrativos › Atributos") instantâneos.
const prisma = require('../utils/prisma');

let cache = null; // { byId: Map, roots: [], list: [] }
let loading = null;

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
// "Direito Processual Civil (DPC)" -> "direito processual civil"
const bare = (s) => norm(String(s || '').replace(/\([^)]*\)/g, ' '));

// Nomes usuais em editais/PDFs que diferem do nome da matéria na árvore
const ALIASES = {
  'lingua portuguesa': 'Português',
  'portugues e interpretacao de texto': 'Português',
  'lingua inglesa': 'Inglês',
  'lingua espanhola': 'Espanhol',
  'lingua francesa': 'Francês',
  'nocoes de informatica': 'Informática',
  'informatica basica': 'Informática',
  'raciocinio logico-matematico': 'Raciocínio Lógico',
  'raciocinio logico matematico': 'Raciocínio Lógico',
  'matematica e raciocinio logico': 'Raciocínio Lógico',
  'conhecimentos gerais': 'Atualidades + Conhecimentos Gerais',
  'atualidades': 'Atualidades + Conhecimentos Gerais',
  'direito processual civil': 'Direito Processual Civil (DPC)',
  'contabilidade': 'Contabilidade Geral',
  'afo': 'Administração Financeira e Orçamentária (AFO) + Direito Financeiro',
  'direito financeiro': 'Administração Financeira e Orçamentária (AFO) + Direito Financeiro',
  'eca': 'Direito da Criança e do Adolescente',
};

async function load() {
  const rows = await prisma.assunto.findMany({
    select: { id: true, parentId: true, name: true, path: true, depth: true },
    orderBy: { path: 'asc' },
  });
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const n of byId.values()) {
    const p = n.parentId ? byId.get(n.parentId) : null;
    if (p) p.children.push(n);
    else roots.push(n);
  }
  return { byId, roots, list: rows };
}

async function getTree() {
  if (cache) return cache;
  if (!loading) loading = load().then((c) => { cache = c; loading = null; return c; });
  return loading;
}

function invalidate() { cache = null; }

// Versão síncrona para quem não pode esperar (montagem de filtros); carregada no boot do servidor
const peek = () => cache;

// Ids do nó e de todos os descendentes
function descendantIds(tree, id) {
  const start = tree.byId.get(id);
  if (!start) return [];
  const out = [];
  const stack = [start];
  while (stack.length) {
    const n = stack.pop();
    out.push(n.id);
    for (const c of n.children) stack.push(c);
  }
  return out;
}

// Caminho da matéria até o nó: [{ id, name }, ...]
function pathOf(tree, id) {
  const out = [];
  let n = tree.byId.get(id);
  while (n) {
    out.unshift({ id: n.id, name: n.name });
    n = n.parentId ? tree.byId.get(n.parentId) : null;
  }
  return out;
}

// Campos de texto mantidos em sincronia com o nó (diagnóstico, PDF e estatísticas usam discipline/topic)
function labelsOf(tree, id) {
  const path = pathOf(tree, id);
  if (!path.length) return null;
  return { discipline: path[0].name, topic: path.length > 1 ? path[path.length - 1].name : null };
}

// Soma as contagens de cada nó nos seus ancestrais: { [id]: total da subárvore }
function rollUp(tree, rows) {
  const totals = {};
  for (const { id, count } of rows) {
    let n = tree.byId.get(id);
    while (n) {
      totals[n.id] = (totals[n.id] || 0) + count;
      n = n.parentId ? tree.byId.get(n.parentId) : null;
    }
  }
  return totals;
}

function findRoot(tree, discipline) {
  const d = norm(discipline);
  if (!d) return null;
  const alias = ALIASES[d] || ALIASES[bare(discipline)];
  if (alias) {
    const hit = tree.roots.find((r) => r.name === alias);
    if (hit) return hit;
  }
  const exact = tree.roots.find((r) => norm(r.name) === d || bare(r.name) === bare(discipline));
  if (exact) return exact;
  // Matérias compostas: "Engenharia Civil + Auditoria de obras", "Direito Empresarial - Comercial"
  const part = tree.roots.find((r) => r.name.split(/\s\+\s|\s-\s/).some((p) => bare(p) === bare(discipline)));
  if (part) return part;
  // Por último, nome contido (só com nomes razoavelmente longos para não casar por acaso)
  const b = bare(discipline);
  if (b.length < 6) return null;
  const loose = tree.roots
    .filter((r) => bare(r.name).includes(b) || (bare(r.name).length >= 6 && b.includes(bare(r.name))))
    .sort((x, y) => bare(y.name).length - bare(x.name).length);
  return loose[0] || null;
}

function findInSubtree(tree, root, topic) {
  const t = bare(topic);
  if (!t) return null;
  const nodes = descendantIds(tree, root.id).slice(1).map((id) => tree.byId.get(id));
  const exact = nodes.filter((n) => bare(n.name) === t).sort((a, b) => a.depth - b.depth);
  if (exact.length) return exact[0];
  if (t.length < 5) return null;
  const loose = nodes
    .filter((n) => bare(n.name).includes(t) || (bare(n.name).length >= 5 && t.includes(bare(n.name))))
    .sort((a, b) => Math.abs(bare(a.name).length - t.length) - Math.abs(bare(b.name).length - t.length) || a.depth - b.depth);
  return loose[0] || null;
}

// Reconhece o nó a partir dos textos "disciplina" e "assunto" (cadastro, PDF, questões antigas)
async function matchAssunto(discipline, topic) {
  const tree = await getTree();
  if (!tree.roots.length) return null;
  const root = findRoot(tree, discipline);
  if (!root) return null;
  return (topic && findInSubtree(tree, root, topic)) || root;
}

// ─── Tópicos longos de edital ────────────────────────────────────────────────
// "Atos administrativos: conceito, requisitos, atributos e espécies" -> "Atos Administrativos".
// Compara palavras (sem acento, sem plural, sem palavras vazias) em vez do texto inteiro.
const STOP = new Set(('a o e as os ao aos da das de do dos em na nas no nos para por pela pelas pelo pelos com sem sua suas seu seus '
  + 'um uma uns umas que ou se sobre entre ate apos sua lei n no nº art arts inclusive noções nocoes nocao conceito conceitos '
  + 'geral gerais aspectos principais basicas basicos disposicoes emprego uso dominio reconhecimento estudo').split(' '));
const stem = (w) => (w.length > 3 ? w.replace(/(oes|aes)$/, 'ao').replace(/(is)$/, 'l').replace(/s$/, '') : w);
const tokens = (s) => new Set(bare(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w)).map(stem));
const tokensOf = (n) => n._tok || (n._tok = tokens(n.name));

function matchTopic(tree, root, text) {
  const t = tokens(text);
  if (!t.size) return null;
  const nodes = descendantIds(tree, root.id).slice(1).map((id) => tree.byId.get(id));

  // 1) Tópico curto cujas palavras estão todas no nome de um nó ("Licitações" -> "Licitações e Contratos"):
  //    o mais raso e com menos palavras sobrando
  const covering = nodes.filter((n) => { const nt = tokensOf(n); for (const w of t) if (!nt.has(w)) return false; return true; });
  if (covering.length) return covering.sort((a, b) => a.depth - b.depth || tokensOf(a).size - tokensOf(b).size)[0];

  // 2) Nós cujo nome aparece inteiro no tópico; se um é ancestral de outro, fica o ancestral
  //    (o tópico do edital cobre o assunto todo, não só o subassunto citado)
  const contained = nodes.filter((n) => {
    const nt = tokensOf(n);
    if (!nt.size) return false;
    const letters = [...nt].join('').length;
    if (letters < 5) return false;
    for (const w of nt) if (!t.has(w)) return false;
    return true;
  });
  const ids = new Set(contained.map((n) => n.id));
  const isUnderPicked = (n) => {
    for (let p = tree.byId.get(n.parentId); p && p.id !== root.id; p = tree.byId.get(p.parentId)) if (ids.has(p.id)) return true;
    return false;
  };
  const tops = contained.filter((n) => !isUnderPicked(n));
  if (tops.length) {
    // Vários ramos citados no mesmo tópico: o mais específico em palavras vence; empate -> mais raso
    return tops.sort((a, b) => tokensOf(b).size - tokensOf(a).size || a.depth - b.depth)[0];
  }

  // 3) Semelhança de palavras (cosseno); precisa ser razoavelmente alta
  let best = null;
  let bestScore = 0;
  for (const n of nodes) {
    const nt = tokensOf(n);
    if (!nt.size) continue;
    let overlap = 0;
    for (const w of nt) if (t.has(w)) overlap += 1;
    if (!overlap) continue;
    const score = overlap / Math.sqrt(nt.size * t.size);
    if (score > bestScore || (score === bestScore && best && n.depth < best.depth)) { best = n; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}

// Matéria do edital -> nó raiz; tópico -> nó dentro dela (ou null)
async function matchEditalTopic(discipline, topic) {
  const tree = await getTree();
  const root = findRoot(tree, discipline);
  if (!root) return { root: null, node: null };
  return { root, node: matchTopic(tree, root, topic) };
}

module.exports = {
  getTree, peek, invalidate, descendantIds, pathOf, labelsOf, rollUp, matchAssunto, matchEditalTopic, norm,
};
