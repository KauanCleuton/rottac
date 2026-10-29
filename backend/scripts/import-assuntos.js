// Importa a árvore de matérias e assuntos e classifica as questões que ainda não têm assunto.
// Uso: npm run db:assuntos                       (usa prisma/data/assuntos.json)
//      npm run db:assuntos -- "caminho/arquivo"  (aceita também o JSON aninhado original com "children")
// Pode rodar de novo: atualiza nomes e posições sem duplicar nem perder vínculos.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../src/utils/prisma');
const taxonomy = require('../src/services/taxonomy');

function readNodes(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const nodes = [];
  if (Array.isArray(raw) && Array.isArray(raw[0])) {
    // Formato compacto: [id, parentId, name, path]
    for (const [id, parentId, name, p] of raw) nodes.push({ id, parentId, name, path: p });
  } else {
    // Formato aninhado: { id, name, parentId, hierarchy, children: [...] }
    (function walk(list) {
      for (const n of list || []) {
        if (n.disabled) continue;
        nodes.push({ id: n.id, parentId: n.parentId ?? null, name: n.name, path: n.hierarchy });
        walk(n.children);
      }
    })(raw);
  }
  return nodes
    .map((n) => ({
      id: Number(n.id),
      parentId: n.parentId === null || n.parentId === undefined ? null : Number(n.parentId),
      name: String(n.name).replace(/\s+/g, ' ').trim().slice(0, 255),
      path: String(n.path),
      depth: String(n.path).split('.').length,
    }))
    .filter((n) => Number.isInteger(n.id) && n.name)
    .sort((a, b) => a.depth - b.depth);
}

async function main() {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '../prisma/data/assuntos.json'));
  const nodes = readNodes(file);
  const ids = new Set(nodes.map((n) => n.id));
  const orphans = nodes.filter((n) => n.parentId !== null && !ids.has(n.parentId));
  if (orphans.length) throw new Error(`${orphans.length} assunto(s) apontam para um pai inexistente (ex.: id ${orphans[0].id})`);

  // Insere os novos (pais antes dos filhos) e atualiza os que mudaram
  const existing = new Map((await prisma.assunto.findMany()).map((a) => [a.id, a]));
  const toCreate = nodes.filter((n) => !existing.has(n.id));
  for (let i = 0; i < toCreate.length; i += 1000) {
    await prisma.assunto.createMany({ data: toCreate.slice(i, i + 1000), skipDuplicates: true });
  }
  const toUpdate = nodes.filter((n) => {
    const e = existing.get(n.id);
    return e && (e.name !== n.name || e.path !== n.path || e.parentId !== n.parentId || e.depth !== n.depth);
  });
  for (const n of toUpdate) {
    await prisma.assunto.update({ where: { id: n.id }, data: { name: n.name, path: n.path, parentId: n.parentId, depth: n.depth } });
  }
  console.log(`✔ Árvore: ${nodes.length} assuntos (${toCreate.length} novos, ${toUpdate.length} atualizados)`);

  // Classifica questões antigas pelo texto de disciplina/assunto
  taxonomy.invalidate();
  const tree = await taxonomy.getTree();
  const pending = await prisma.question.findMany({
    where: { assuntoId: null, discipline: { not: null } },
    select: { id: true, discipline: true, topic: true },
  });
  let matched = 0;
  const misses = new Map();
  for (const q of pending) {
    const node = await taxonomy.matchAssunto(q.discipline, q.topic);
    if (!node) {
      misses.set(q.discipline, (misses.get(q.discipline) || 0) + 1);
      continue;
    }
    await prisma.question.update({
      where: { id: q.id },
      data: { assuntoId: node.id, ...taxonomy.labelsOf(tree, node.id) },
    });
    matched++;
  }
  console.log(`✔ Questões classificadas automaticamente: ${matched} de ${pending.length}`);
  if (misses.size) {
    console.log('  Sem correspondência (ficam em "Sem classificação"; ajuste pela edição da questão):');
    for (const [d, n] of misses) console.log(`  - ${d}: ${n}`);
  }
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
