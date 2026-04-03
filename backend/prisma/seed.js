const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Usuário demo
  const hash = await bcrypt.hash('demo1234', 12);
  const user = await prisma.user.upsert({
    where: { email: 'demo@aprovaai.com' },
    update: {},
    create: {
      name: 'João Concurseiro',
      email: 'demo@aprovaai.com',
      password: hash,
      experienceLevel: 'INTERMEDIARIO',
      learningStyle: 'LEITURA',
      dailyStudyHours: 4,
      examName: 'Concurso INSS 2025',
      examDate: new Date('2025-08-01'),
      targetRole: 'Técnico do Seguro Social',
    },
  });

  // Gamificação
  await prisma.gamification.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, xp: 250, level: 1, streak: 5, bestStreak: 12 },
  });

  // Rotina
  await prisma.routine.deleteMany({ where: { userId: user.id } });
  await prisma.routine.createMany({
    data: [
      { userId: user.id, dayOfWeek: 1, startTime: '06:00', endTime: '08:00', type: 'ESTUDO', label: 'Manhã' },
      { userId: user.id, dayOfWeek: 1, startTime: '19:00', endTime: '22:00', type: 'ESTUDO', label: 'Noite' },
      { userId: user.id, dayOfWeek: 2, startTime: '06:00', endTime: '08:00', type: 'ESTUDO', label: 'Manhã' },
      { userId: user.id, dayOfWeek: 3, startTime: '19:00', endTime: '22:00', type: 'ESTUDO', label: 'Noite' },
      { userId: user.id, dayOfWeek: 4, startTime: '06:00', endTime: '08:00', type: 'ESTUDO', label: 'Manhã' },
      { userId: user.id, dayOfWeek: 5, startTime: '19:00', endTime: '22:00', type: 'ESTUDO', label: 'Noite' },
      { userId: user.id, dayOfWeek: 6, startTime: '08:00', endTime: '12:00', type: 'ESTUDO', label: 'Sábado manhã' },
    ],
  });

  // Disciplinas com módulos e tópicos
  const disciplinas = [
    {
      name: 'Português', color: '#1976d2', weight: 2.0,
      modules: [
        { name: 'Gramática', topics: ['Morfologia', 'Sintaxe', 'Ortografia', 'Pontuação'] },
        { name: 'Interpretação', topics: ['Tipos textuais', 'Figuras de linguagem', 'Coesão e coerência'] },
      ],
    },
    {
      name: 'Raciocínio Lógico', color: '#388e3c', weight: 1.8,
      modules: [
        { name: 'Lógica Proposicional', topics: ['Proposições', 'Conectivos', 'Tabela verdade', 'Equivalências'] },
        { name: 'Matemática', topics: ['Regra de três', 'Porcentagem', 'Razão e proporção'] },
      ],
    },
    {
      name: 'Direito Previdenciário', color: '#f57c00', weight: 2.5,
      modules: [
        { name: 'Regime Geral', topics: ['Beneficiários', 'Benefícios', 'Custeio', 'Perícia médica'] },
        { name: 'Legislação', topics: ['Lei 8.212', 'Lei 8.213', 'Decreto 3.048'] },
      ],
    },
    {
      name: 'Direito Administrativo', color: '#7b1fa2', weight: 1.5,
      modules: [
        { name: 'Administração Pública', topics: ['Princípios', 'Atos administrativos', 'Licitações', 'Contratos'] },
      ],
    },
  ];

  for (const disc of disciplinas) {
    const subject = await prisma.subject.create({
      data: {
        name: disc.name,
        color: disc.color,
        weight: disc.weight,
        userId: user.id,
        totalTopics: disc.modules.reduce((acc, m) => acc + m.topics.length, 0),
      },
    });

    for (let mi = 0; mi < disc.modules.length; mi++) {
      const mod = disc.modules[mi];
      const module = await prisma.module.create({
        data: { name: mod.name, subjectId: subject.id, order: mi },
      });

      for (let ti = 0; ti < mod.topics.length; ti++) {
        await prisma.topic.create({
          data: {
            name: mod.topics[ti],
            moduleId: module.id,
            order: ti,
            difficulty: ti % 3 === 0 ? 'FACIL' : ti % 3 === 1 ? 'MEDIO' : 'DIFICIL',
            estimatedHours: 1.5,
          },
        });
      }
    }
  }

  console.log('✅ Seed concluído!');
  console.log('👤 Login demo: demo@aprovaai.com | Senha: demo1234');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
