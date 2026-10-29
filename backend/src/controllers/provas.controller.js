const { success, badRequest, error } = require('../utils/response');

// Catálogo de provas do PCI Concursos.
// Só lemos as páginas de listagem (permitidas no robots.txt deles) e devolvemos
// metadados + link. Os PDFs NÃO são baixados: o robots.txt proíbe (/pdf/, *.pdf).
// O aluno abre a prova no PCI e importa o PDF pelo importador de questões.

const BASE = 'https://www.pciconcursos.com.br/provas';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/<[^>]+>/g, '').trim();

const slugify = (s) => String(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .slice(0, 120);

async function fetchPage(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.html;

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'RottaConcursos/1.0 (catalogo de provas; links para o PCI)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`PCI respondeu ${resp.status}`);
  const html = await resp.text();
  cache.set(url, { html, at: Date.now() });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return html;
}

function parseExams(html) {
  const exams = [];
  const rowRe = /<tr class="lk_link[^"]*" data-url="([^"]+)">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1]));
    const [title, year, orgao, banca] = cells;
    const orgaoSlug = /provas\/([a-z0-9-]+)"/.exec(m[2].split('</td>')[2] || '')?.[1] || null;
    const bancaSlug = /provas\/([a-z0-9-]+)"/.exec(m[2].split('</td>')[3] || '')?.[1] || null;
    exams.push({
      title,
      year: parseInt(year, 10) || null,
      orgao: orgao || null,
      orgaoSlug,
      banca: banca || null,
      bancaSlug,
      url: m[1],
    });
  }
  const pageInfo = /Mostrando página <strong>(\d+)<\/strong> de <strong>([\d.]+)/.exec(html);
  return {
    exams,
    page: pageInfo ? parseInt(pageInfo[1], 10) : 1,
    pages: pageInfo ? parseInt(pageInfo[2].replace(/\./g, ''), 10) : 1,
  };
}

// ─── GET /provas?q=analista judiciario&page=1 ────────────────────────────────
// q pode ser cargo, banca (cebraspe), órgão (tj-ce) ou combinação (tjce analista)
const search = async (req, res, next) => {
  try {
    const slug = slugify(req.query.slug || req.query.q || '');
    if (!slug) return badRequest(res, 'Informe um cargo, banca ou órgão');
    const page = Math.min(500, Math.max(1, parseInt(req.query.page, 10) || 1));
    const url = page > 1 ? `${BASE}/${slug}/${page}` : `${BASE}/${slug}`;

    let html;
    try {
      html = await fetchPage(url);
    } catch (e) {
      console.warn('[provas] PCI indisponível:', e.message);
      return error(res, 'Não foi possível consultar o PCI Concursos agora. Tente novamente em instantes.', 502);
    }
    if (!html) return success(res, { slug, exams: [], page, pages: 0, source: url });

    const parsed = parseExams(html);
    let exams = parsed.exams;
    if (req.query.year) exams = exams.filter((e) => String(e.year) === String(req.query.year));
    return success(res, { slug, ...parsed, exams, source: url });
  } catch (err) {
    next(err);
  }
};

// ─── GET /provas/sugestoes ───────────────────────────────────────────────────
// Cargos populares listados no índice do PCI
const suggestions = async (req, res, next) => {
  try {
    let html;
    try {
      html = await fetchPage(`${BASE}/`);
    } catch (e) {
      return error(res, 'Não foi possível consultar o PCI Concursos agora.', 502);
    }
    const seen = new Set();
    const items = [];
    for (const m of (html || '').matchAll(/href="https:\/\/www\.pciconcursos\.com\.br\/provas\/([a-z0-9-]+)" title="Provas de ([^"]+)"/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      items.push({ slug: m[1], label: decode(m[2]) });
    }
    const q = slugify(req.query.q || '');
    return success(res, q ? items.filter((i) => i.slug.includes(q)).slice(0, 30) : items);
  } catch (err) {
    next(err);
  }
};

module.exports = { search, suggestions };
