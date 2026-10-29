// Popula o banco público com questões de exemplo (inéditas, não atribuídas a provas reais).
// Idempotente: não duplica questões com o mesmo enunciado.
// Uso: npm run db:seed-questions -- admin@email.com
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const SOURCE = 'Questão de exemplo — Rotta Concursos';
const BANCA = 'Rotta (inédita)';

const QUESTIONS = [
  {
    type: 'CERTO_ERRADO', discipline: 'Direito Constitucional', topic: 'Direitos e garantias fundamentais', difficulty: 'FACIL',
    statement: 'Segundo a Constituição Federal de 1988, a casa é asilo inviolável do indivíduo, ninguém nela podendo penetrar sem consentimento do morador, salvo em caso de flagrante delito ou desastre, ou para prestar socorro, ou, durante o dia, por determinação judicial.',
    answer: 'C',
    explanation: 'Certo. É a redação literal do art. 5º, XI, da CF/88. Atenção: a ordem judicial só autoriza o ingresso durante o dia; flagrante, desastre e socorro autorizam a qualquer hora.',
  },
  {
    type: 'CERTO_ERRADO', discipline: 'Direito Administrativo', topic: 'Administração indireta', difficulty: 'FACIL',
    statement: 'As autarquias são pessoas jurídicas de direito privado, criadas por lei específica para executar atividades típicas da administração pública.',
    answer: 'E',
    explanation: 'Errado. Autarquias são pessoas jurídicas de DIREITO PÚBLICO (art. 5º, I, do DL 200/1967), criadas por lei específica (art. 37, XIX, da CF/88).',
  },
  {
    type: 'MULTIPLA_ESCOLHA', discipline: 'Direito Administrativo', topic: 'Princípios da administração pública', difficulty: 'FACIL',
    statement: 'De acordo com o caput do art. 37 da Constituição Federal, a administração pública direta e indireta de qualquer dos Poderes obedecerá aos princípios de:',
    options: {
      A: 'legalidade, impessoalidade, moralidade, publicidade e eficiência.',
      B: 'legalidade, razoabilidade, moralidade, publicidade e eficiência.',
      C: 'legalidade, impessoalidade, motivação, publicidade e eficiência.',
      D: 'supremacia do interesse público, impessoalidade, moralidade, publicidade e eficiência.',
      E: 'legalidade, impessoalidade, moralidade, proporcionalidade e eficiência.',
    },
    answer: 'A',
    explanation: 'Os princípios expressos no caput do art. 37 formam o mnemônico LIMPE: Legalidade, Impessoalidade, Moralidade, Publicidade e Eficiência. Razoabilidade, motivação, proporcionalidade e supremacia do interesse público são princípios implícitos (ou previstos em outras leis), não estão no caput.',
  },
  {
    type: 'MULTIPLA_ESCOLHA', discipline: 'Língua Portuguesa', topic: 'Crase', difficulty: 'MEDIO',
    statement: 'Assinale a alternativa em que o acento grave indicativo de crase foi empregado corretamente.',
    options: {
      A: 'Ele começou à estudar logo cedo.',
      B: 'O servidor entregou o relatório à diretora.',
      C: 'Fomos à pé até o fórum.',
      D: 'Refiro-me à esta proposta.',
      E: 'Chegamos à uma conclusão rapidamente.',
    },
    answer: 'B',
    explanation: '"Entregar algo A alguém" + artigo "a" de "a diretora" = crase. Não há crase antes de verbo (A), de palavra masculina (C, "pé"), de pronome demonstrativo "esta" (D) nem, em regra, antes do artigo indefinido "uma" (E).',
  },
  {
    type: 'MULTIPLA_ESCOLHA', discipline: 'Raciocínio Lógico', topic: 'Negação de proposições', difficulty: 'MEDIO',
    statement: 'A negação lógica da proposição "Todos os servidores são pontuais" é:',
    options: {
      A: 'Nenhum servidor é pontual.',
      B: 'Algum servidor não é pontual.',
      C: 'Todos os servidores não são pontuais.',
      D: 'Algum servidor é pontual.',
      E: 'Nenhum servidor é impontual.',
    },
    answer: 'B',
    explanation: 'A negação de "Todo A é B" é "Algum A não é B" (basta um contraexemplo). "Nenhum servidor é pontual" é o contrário, não a negação — pegadinha clássica.',
  },
  {
    type: 'CERTO_ERRADO', discipline: 'Raciocínio Lógico', topic: 'Equivalências lógicas', difficulty: 'MEDIO',
    statement: 'A proposição "Se chove, então a rua fica molhada" é logicamente equivalente a "Se a rua não fica molhada, então não chove".',
    answer: 'C',
    explanation: 'Certo. É a contrapositiva: (p → q) ≡ (~q → ~p). Cuidado: "Se não chove, então a rua não fica molhada" (inversa) NÃO é equivalente.',
  },
  {
    type: 'CERTO_ERRADO', discipline: 'Informática', topic: 'Planilhas eletrônicas', difficulty: 'FACIL',
    statement: 'Em planilhas do Microsoft Excel, a fórmula =SOMA(A1:A3) retorna a soma dos valores contidos nas células A1, A2 e A3.',
    answer: 'C',
    explanation: 'Certo. O operador ":" define um intervalo contínuo (A1 até A3). Já =SOMA(A1;A3) somaria apenas A1 e A3.',
  },
  {
    type: 'MULTIPLA_ESCOLHA', discipline: 'Direito Constitucional', topic: 'Organização dos Poderes', difficulty: 'FACIL',
    statement: 'Conforme o art. 2º da Constituição Federal, são Poderes da União, independentes e harmônicos entre si:',
    options: {
      A: 'o Legislativo, o Executivo e o Judiciário.',
      B: 'o Legislativo, o Executivo, o Judiciário e o Ministério Público.',
      C: 'o Executivo, o Judiciário e o Tribunal de Contas da União.',
      D: 'o Legislativo, o Judiciário e a Defensoria Pública.',
    },
    answer: 'A',
    explanation: 'O art. 2º adota a tripartição: Legislativo, Executivo e Judiciário. Ministério Público, Defensoria e Tribunais de Contas são instituições/órgãos autônomos, mas não Poderes.',
  },
];

async function main() {
  const email = process.argv[2];
  const where = email ? { email } : { role: 'ADMIN' };
  const author = await prisma.user.findFirst({ where });
  if (!author) throw new Error(email ? `Usuário ${email} não encontrado` : 'Nenhum ADMIN encontrado. Rode: npm run make-admin -- seu@email.com');

  let created = 0;
  for (const q of QUESTIONS) {
    const exists = await prisma.question.findFirst({ where: { statement: q.statement, isPublic: true }, select: { id: true } });
    if (exists) continue;
    const { options, ...rest } = q;
    await prisma.question.create({
      data: {
        ...rest,
        optionA: options?.A ?? null, optionB: options?.B ?? null, optionC: options?.C ?? null,
        optionD: options?.D ?? null, optionE: options?.E ?? null,
        banca: BANCA, source: SOURCE, level: 'SUPERIOR', isPublic: true, userId: author.id,
      },
    });
    created++;
  }
  console.log(`✔ ${created} questões de exemplo criadas (${QUESTIONS.length - created} já existiam)`);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
