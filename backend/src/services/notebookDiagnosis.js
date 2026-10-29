// Diagnóstico pós-caderno: lê o desempenho e receita o próximo passo de estudo.
// Funções puras (sem banco) para facilitar teste e ajuste das regras.

const MIN_SAMPLE = 5;

// Faixas de aproveitamento
const LEVELS = [
  { key: 'critico', min: 0, label: 'Base crítica' },
  { key: 'atencao', min: 40, label: 'Base parcial' },
  { key: 'bom', min: 70, label: 'Bom desempenho' },
  { key: 'excelente', min: 85, label: 'Domínio' },
];

// Lei seca por disciplina (Planalto). A ordem importa: "processo penal" antes de "penal".
const LAW_SOURCES = [
  { match: /constitucional/i, items: [{ title: 'Constituição Federal de 1988', url: 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm' }] },
  {
    match: /administrativ/i,
    items: [
      { title: 'Lei 8.112/1990 (servidores públicos federais)', url: 'https://www.planalto.gov.br/ccivil_03/leis/l8112cons.htm' },
      { title: 'Lei 9.784/1999 (processo administrativo)', url: 'https://www.planalto.gov.br/ccivil_03/leis/l9784.htm' },
      { title: 'Lei 14.133/2021 (licitações e contratos)', url: 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm' },
      { title: 'Lei 8.429/1992 (improbidade administrativa)', url: 'https://www.planalto.gov.br/ccivil_03/leis/l8429.htm' },
    ],
  },
  { match: /processo penal|processual penal/i, items: [{ title: 'Código de Processo Penal', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689compilado.htm' }] },
  { match: /penal/i, items: [{ title: 'Código Penal', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del2848compilado.htm' }] },
  { match: /processo civil|processual civil/i, items: [{ title: 'Código de Processo Civil', url: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm' }] },
  { match: /civil/i, items: [{ title: 'Código Civil', url: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm' }] },
  { match: /tribut/i, items: [{ title: 'Código Tributário Nacional', url: 'https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm' }] },
  { match: /trabalh/i, items: [{ title: 'Consolidação das Leis do Trabalho (CLT)', url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm' }] },
];

function lawSourcesFor(disciplines) {
  const seen = new Set();
  const out = [];
  for (const d of disciplines) {
    const src = LAW_SOURCES.find((s) => s.match.test(d || ''));
    for (const item of src?.items || []) {
      if (!seen.has(item.url)) { seen.add(item.url); out.push(item); }
    }
  }
  return out;
}

const UNCLASSIFIED = 'Sem classificação';
const MAX_LAW_LINKS = 3;

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r) || UNCLASSIFIED;
    const g = map.get(k) || { name: k, total: 0, correct: 0 };
    g.total++;
    if (r.attempt.isCorrect) g.correct++;
    map.set(k, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, wrong: g.total - g.correct, accuracy: pct(g.correct, g.total) }))
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
}

/**
 * @param {{ question: object, attempt: { isCorrect: boolean, timeSpent: number|null } | null }[]} items
 * @param {{ notebookName: string }} ctx
 */
function diagnose(items, { notebookName } = {}) {
  const answered = items.filter((i) => i.attempt);
  const correct = answered.filter((i) => i.attempt.isCorrect).length;
  const wrong = answered.length - correct;
  const accuracy = pct(correct, answered.length);
  const times = answered.map((i) => i.attempt.timeSpent).filter((t) => Number.isFinite(t) && t > 0);
  const avgTime = times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null;

  const byDiscipline = groupBy(answered, (i) => i.question.discipline);
  const byTopic = groupBy(answered, (i) => i.question.topic || i.question.discipline);
  const byBanca = groupBy(answered, (i) => i.question.banca);
  const byDifficulty = groupBy(answered, (i) => ({ FACIL: 'Fácil', MEDIO: 'Média', DIFICIL: 'Difícil' })[i.question.difficulty]);
  const byType = groupBy(answered, (i) => (i.question.type === 'CERTO_ERRADO' ? 'Certo/Errado' : 'Múltipla escolha'));
  const disciplines = [...new Set(items.map((i) => i.question.discipline).filter(Boolean))];
  // Disciplina predominante (ignora questões sem disciplina cadastrada)
  const mainDiscipline = byDiscipline.filter((d) => d.name !== UNCLASSIFIED).sort((a, b) => b.total - a.total)[0]?.name
    || disciplines[0] || null;

  const stats = { total: items.length, answered: answered.length, correct, wrong, blank: items.length - answered.length, accuracy, avgTime };

  if (answered.length < MIN_SAMPLE) {
    return {
      level: 'insuficiente',
      label: 'Dados insuficientes',
      headline: `Resolva pelo menos ${MIN_SAMPLE} questões para receber o diagnóstico.`,
      message: 'Com poucas respostas, qualquer conclusão seria chute. Continue resolvendo o caderno.',
      stats, byDiscipline, byTopic, byBanca, byDifficulty, byType, insights: [], actions: [],
    };
  }

  const level = [...LEVELS].reverse().find((l) => accuracy >= l.min);
  const weakTopics = byTopic.filter((t) => t.name !== UNCLASSIFIED && t.total >= 2 && t.accuracy < 50).slice(0, 4);
  const weakNames = weakTopics.map((t) => t.name);
  const subject = mainDiscipline ? ` de ${mainDiscipline}` : '';

  // ── Mensagem principal
  const headlines = {
    critico: `Você errou ${wrong} de ${answered.length}. Pare de fazer questões${subject} por enquanto.`,
    atencao: `Base parcial${subject}: ${accuracy}% de acerto. Hora de consolidar antes de avançar.`,
    bom: `Bom resultado${subject}: ${accuracy}%. Agora é fixar os pontos que escaparam.`,
    excelente: `Domínio${subject}: ${accuracy}% de acerto. Você está pronto para subir o nível.`,
  };
  const messages = {
    critico: 'Com menos de 40% de acerto, a teoria ainda não está formada. Continuar resolvendo questões agora só treina o erro. Volte à base: lei seca, teoria e revisão ativa dos erros. Depois, refaça as erradas.',
    atencao: 'Você já reconhece parte do conteúdo, mas ainda erra em pontos importantes. Revise a teoria dos assuntos fracos e transforme os erros em flashcards.',
    bom: 'O conteúdo está sólido. Revise os erros pontuais com revisão espaçada para não perder o que já conquistou.',
    excelente: 'Mantenha a disciplina em revisão periódica e invista o tempo em matérias mais fracas ou em questões de nível difícil.',
  };

  // ── Padrões de erro (insights)
  const insights = [];
  if (weakTopics.length) {
    insights.push({
      type: 'topics', severity: 'high', title: 'Assuntos críticos',
      text: `Concentre o estudo em: ${weakTopics.map((t) => `${t.name} (${t.accuracy}%)`).join(', ')}.`,
    });
  }
  const easy = answered.filter((i) => i.question.difficulty === 'FACIL');
  const easyWrong = easy.filter((i) => !i.attempt.isCorrect).length;
  if (easy.length >= 3 && easyWrong / easy.length >= 0.3) {
    insights.push({
      type: 'attention', severity: 'medium', title: 'Erros em questões fáceis',
      text: `Você errou ${easyWrong} de ${easy.length} questões fáceis. Isso costuma ser leitura apressada: grife o comando ("INCORRETA", "EXCETO", "NÃO") com a caneta antes de responder.`,
    });
  }
  const ce = answered.filter((i) => i.question.type === 'CERTO_ERRADO');
  const ceWrong = ce.filter((i) => !i.attempt.isCorrect).length;
  if (ce.length >= 4 && ceWrong >= ce.length - ceWrong) {
    insights.push({
      type: 'cebraspe', severity: 'high', title: 'Cuidado com o chute no Cebraspe',
      text: `Nos itens Certo/Errado você errou ${ceWrong} de ${ce.length}. Na prova, cada erro anula um acerto: sua nota líquida aqui seria ${ce.length - 2 * ceWrong}. Na dúvida, deixe em branco.`,
    });
  }
  if (avgTime !== null && avgTime > 180 && accuracy < 70) {
    insights.push({
      type: 'slow', severity: 'medium', title: 'Ritmo lento',
      text: `Média de ${Math.round(avgTime / 60)} min por questão. Lentidão com acerto baixo indica dúvida de conteúdo, não falta de tempo: a solução é teoria, não velocidade.`,
    });
  } else if (avgTime !== null && avgTime < 40 && accuracy < 60) {
    insights.push({
      type: 'rush', severity: 'medium', title: 'Pressa demais',
      text: `Média de ${avgTime}s por questão com ${accuracy}% de acerto. Desacelere: leia o enunciado inteiro e elimine alternativas antes de marcar.`,
    });
  }
  const hard = answered.filter((i) => i.question.difficulty === 'DIFICIL');
  if (level.key === 'excelente' && hard.length < answered.length * 0.3) {
    insights.push({
      type: 'level-up', severity: 'low', title: 'Suba a dificuldade',
      text: 'A maior parte deste caderno era de nível fácil ou médio. Teste-se com questões difíceis para ter certeza do domínio.',
    });
  }

  // ── Ações (cada uma é um botão no front)
  const actions = [];
  // Lei da disciplina principal primeiro; no máximo MAX_LAW_LINKS links para não diluir a sugestão
  const laws = lawSourcesFor([mainDiscipline, ...byDiscipline.map((d) => d.name)]).slice(0, MAX_LAW_LINKS);
  const topicsHint = weakNames.length ? ` (${weakNames.slice(0, 3).join(', ')})` : '';

  if (level.key === 'critico' || level.key === 'atencao') {
    for (const law of laws) {
      actions.push({
        key: 'law', kind: 'link', href: law.url, external: true, primary: level.key === 'critico',
        title: `Ler a letra da lei: ${law.title}`,
        description: level.key === 'critico'
          ? 'Comece pela lei seca: a maioria das questões cobra o texto literal.'
          : 'Releia os artigos dos assuntos em que você errou.',
      });
    }
    actions.push({
      key: 'theory', kind: 'action', primary: level.key === 'critico',
      title: 'Agendar teoria no plano de estudos',
      description: `Cria uma sessão de teoria${subject}${topicsHint} amanhã no seu plano ativo.`,
    });
  }
  if (wrong > 0 && level.key !== 'excelente') {
    actions.push({
      key: 'flashcards', kind: 'action', primary: level.key === 'atencao',
      title: `Gerar ${wrong} flashcards dos erros`,
      description: 'Cada questão errada vira um card (pergunta + gabarito comentado) com revisão espaçada.',
    });
  }
  if (wrong > 0) {
    const days = { critico: 3, atencao: 2, bom: 7, excelente: 14 }[level.key];
    actions.push({
      key: 'redo', kind: 'action', payload: { days }, primary: level.key === 'bom',
      title: `Refazer só as ${wrong} erradas daqui a ${days} dias`,
      description: 'Cria um caderno só com as erradas e agenda a revisão no plano.',
    });
  }
  if (level.key === 'critico' || level.key === 'atencao') {
    actions.push({ key: 'pdfs', kind: 'link', href: '/pdfs', title: 'Abrir meus PDFs de teoria', description: 'Material que você já subiu na plataforma.' });
    actions.push({ key: 'mindmap', kind: 'link', href: '/mapas-mentais', title: 'Montar um mapa mental do assunto', description: 'Organizar a teoria ajuda a enxergar o que está faltando.' });
  }
  if (level.key === 'bom' || level.key === 'excelente') {
    const qs = new URLSearchParams({ ...(mainDiscipline && { discipline: mainDiscipline }), status: 'nao_resolvidas' });
    actions.push({
      key: 'simulado', kind: 'link', href: `/questoes/praticar?modo=simulado&${qs}`, primary: level.key === 'excelente',
      title: 'Fazer um simulado cronometrado', description: 'Treine o ritmo de prova com questões que você ainda não viu.',
    });
    actions.push({
      key: 'harder', kind: 'link', href: `/questoes/banco?difficulty=DIFICIL&${qs}`,
      title: 'Resolver questões difíceis', description: 'Confirme o domínio no nível mais alto.',
    });
  }

  return {
    level: level.key,
    label: level.label,
    headline: headlines[level.key],
    message: messages[level.key],
    stats,
    byDiscipline,
    byTopic,
    byBanca,
    byDifficulty,
    byType,
    weakTopics: weakNames,
    insights,
    actions,
    notebookName,
  };
}

module.exports = { diagnose, lawSourcesFor, MIN_SAMPLE };
