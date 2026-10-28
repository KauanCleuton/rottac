const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// ─── Helper ───────────────────────────────────────────────────────────────────
async function createSubject(userId, name, weight, modules) {
  const subject = await prisma.subject.create({
    data: { name, userId, weight },
  });

  for (let i = 0; i < modules.length; i++) {
    const { name: modName, difficulty = 'MEDIO', topics } = modules[i];
    const mod = await prisma.module.create({
      data: { name: modName, subjectId: subject.id, order: i },
    });
    for (let j = 0; j < topics.length; j++) {
      const { name: topicName, hours } = topics[j];
      await prisma.topic.create({
        data: {
          name: topicName,
          moduleId: mod.id,
          order: j,
          difficulty,
          estimatedHours: hours,
        },
      });
    }
  }

  return subject;
}

async function main() {
  console.log('🌱 Iniciando seed do edital TJCE – C03 Analista Judiciário / Sistemas da Informação...');

  const hash = await bcrypt.hash('TenKauanCleuton123@', 12);

  const user = await prisma.user.upsert({
    where: { email: 'kauancleuton733@gmail.com' },
    update: {},
    create: {
      name: 'Kauan Cleuton',
      email: 'kauancleuton733@gmail.com',
      password: hash,
    },
  });

  // Limpa tudo antes de recriar
  await prisma.subject.deleteMany({ where: { userId: user.id } });

  // ═══════════════════════════════════════════════════════════════════════════
  // BÁSICO
  // ═══════════════════════════════════════════════════════════════════════════

  // 1. LÍNGUA PORTUGUESA
  await createSubject(user.id, 'Língua Portuguesa', 8, [
    {
      name: 'Leitura e Interpretação',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Interpretação de texto', hours: 4 },
        { name: 'Argumentação', hours: 4 },
        { name: 'Pressupostos e subentendidos', hours: 3 },
        { name: 'Níveis de linguagem', hours: 3 },
        { name: 'Articulação do texto: coesão e coerência', hours: 4 },
      ],
    },
    {
      name: 'Classes e Sintaxe',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Classes de palavras', hours: 5 },
        { name: 'Sintaxe', hours: 5 },
        { name: 'Termos da oração', hours: 4 },
        { name: 'Processos de coordenação e subordinação', hours: 5 },
        { name: 'Discurso direto e indireto', hours: 4 },
        { name: 'Equivalência e transformação de estruturas', hours: 4 },
      ],
    },
    {
      name: 'Morfologia e Flexão',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Tempos, modos e vozes verbais', hours: 5 },
        { name: 'Flexão nominal e verbal', hours: 4 },
        { name: 'Ortografia e acentuação', hours: 4 },
      ],
    },
    {
      name: 'Concordância, Regência e Pontuação',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Concordância nominal e verbal', hours: 5 },
        { name: 'Regência nominal e verbal', hours: 5 },
        { name: 'Ocorrência da Crase', hours: 4 },
        { name: 'Pontuação', hours: 4 },
      ],
    },
  ]);

  // 2. INGLÊS INSTRUMENTAL
  await createSubject(user.id, 'Inglês Instrumental', 5, [
    {
      name: 'Estratégias de Leitura',
      difficulty: 'FACIL',
      topics: [
        { name: 'Reconhecimento do tipo de texto e da linguagem usada', hours: 2 },
        { name: 'Uso da linguagem não-verbal', hours: 1 },
        { name: 'Palavras cognatas', hours: 1 },
        { name: 'Inferência e inferência contextual', hours: 2 },
        { name: 'Palavras repetidas e palavras-chave', hours: 1 },
        { name: 'Seletividade', hours: 1 },
        { name: 'Skimming e Scanning', hours: 2 },
        { name: 'Identificação das ideias principais e subjacentes', hours: 2 },
        { name: 'Identificação do que expressam os números do texto', hours: 1 },
        { name: 'Reconhecimento de gêneros textuais', hours: 2 },
        { name: 'Objetivos e níveis de leitura', hours: 1 },
        { name: 'Conhecimento prévio', hours: 1 },
      ],
    },
    {
      name: 'Gramática Contextualizada',
      difficulty: 'FACIL',
      topics: [
        { name: 'Presente (Present Simple e Continuous)', hours: 1 },
        { name: 'Passado (Past Simple, Continuous e Perfect)', hours: 1 },
        { name: 'Futuro (will, going to, Present Continuous)', hours: 1 },
        { name: 'Grupos Nominais (Noun Phrases)', hours: 2 },
        { name: 'Referência Pronominal', hours: 2 },
        { name: 'Apostos', hours: 2 },
        { name: 'Afixos (prefixos e sufixos)', hours: 2 },
        { name: 'Grau de adjetivo e advérbio', hours: 1 },
      ],
    },
  ]);

  // 3. RACIOCÍNIO LÓGICO-MATEMÁTICO
  await createSubject(user.id, 'Raciocínio Lógico-Matemático', 7, [
    {
      name: 'Lógica Formal e Estrutural',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Estrutura lógica de relações entre pessoas, lugares, objetos e eventos fictícios', hours: 3 },
        { name: 'Dedução de novas informações a partir de relações fornecidas', hours: 3 },
        { name: 'Avaliação das condições que estabelecem relações lógicas', hours: 3 },
        { name: 'Compreensão do processo lógico: hipóteses → conclusões válidas', hours: 3 },
      ],
    },
    {
      name: 'Tipos de Raciocínio',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Raciocínio verbal', hours: 3 },
        { name: 'Raciocínio matemático', hours: 2 },
        { name: 'Raciocínio sequencial', hours: 2 },
        { name: 'Orientação espacial e temporal', hours: 3 },
        { name: 'Formação de conceitos', hours: 2 },
        { name: 'Discriminação de elementos', hours: 2 },
      ],
    },
  ]);

  // 4. ÉTICA NO SERVIÇO PÚBLICO
  await createSubject(user.id, 'Ética no Serviço Público', 6, [
    {
      name: 'Fundamentos de Ética',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Ética e moral', hours: 3 },
        { name: 'Ética, princípios e valores', hours: 3 },
        { name: 'Ética e democracia: exercício da cidadania', hours: 3 },
        { name: 'Ética e função pública', hours: 4 },
        { name: 'Ética no setor público', hours: 4 },
      ],
    },
    {
      name: 'Legislação de Ética do TJCE',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Resolução nº 08/2017 – Código de Ética e Regulamento Disciplinar dos Servidores do PJ/CE', hours: 5 },
        { name: 'Comissão Permanente de Ética e Disciplina', hours: 3 },
        { name: 'Regimento Interno do Poder Judiciário do Estado do Ceará', hours: 5 },
      ],
    },
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CONHECIMENTOS ESPECÍFICOS – BÁSICOS
  // ═══════════════════════════════════════════════════════════════════════════

  // 5. NOÇÕES DE DIREITO CONSTITUCIONAL
  await createSubject(user.id, 'Noções de Direito Constitucional', 8, [
    {
      name: 'Constituição e Princípios',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Constituição: conceito, classificações e princípios fundamentais', hours: 4 },
      ],
    },
    {
      name: 'Direitos e Garantias Fundamentais',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Direitos e deveres individuais e coletivos', hours: 5 },
        { name: 'Direitos sociais', hours: 4 },
      ],
    },
    {
      name: 'Organização Político-Administrativa',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'União, Estados, Distrito Federal, Municípios e Territórios', hours: 4 },
      ],
    },
    {
      name: 'Poder Judiciário',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Disposições gerais do Poder Judiciário', hours: 4 },
        { name: 'Órgãos do Poder Judiciário e suas competências', hours: 4 },
        { name: 'Conselho Nacional de Justiça (CNJ): composição e competência', hours: 4 },
        { name: 'Ministério Público, Advocacia e Defensoria Pública', hours: 4 },
      ],
    },
  ]);

  // 6. NOÇÕES DE DIREITO ADMINISTRATIVO
  await createSubject(user.id, 'Noções de Direito Administrativo', 8, [
    {
      name: 'Organização Administrativa',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Noções de organização administrativa', hours: 4 },
        { name: 'Administração direta e indireta, centralizada e descentralizada', hours: 4 },
        { name: 'Princípios expressos e implícitos da administração pública', hours: 5 },
      ],
    },
    {
      name: 'Regime Jurídico dos Servidores – Lei nº 9.826/1974',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Provimento e Vacância', hours: 4 },
        { name: 'Direitos e Vantagens dos servidores', hours: 4 },
        { name: 'Deveres dos servidores', hours: 3 },
        { name: 'Proibições', hours: 3 },
        { name: 'Acumulação de cargos', hours: 3 },
        { name: 'Responsabilidades dos servidores', hours: 4 },
        { name: 'Penalidades disciplinares', hours: 4 },
      ],
    },
    {
      name: 'Legislação Específica do TJCE',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'Lei estadual nº 16.397/2017 – Organização do Poder Judiciário do CE', hours: 5 },
        { name: 'Lei estadual nº 14.786/2010 – Plano de cargos, carreiras e remunerações do PJ/CE', hours: 5 },
      ],
    },
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CONHECIMENTOS ESPECÍFICOS – TI (C03)
  // Cada "- MATERIA:" do edital vira uma Subject separada
  // ═══════════════════════════════════════════════════════════════════════════

  // 7. Engenharia de Software
  await createSubject(user.id, 'Engenharia de Software', 7, [
    {
      name: 'Fundamentos',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Processo de desenvolvimento de software', hours: 2 },
        { name: 'Ciclos de vida do software', hours: 2 },
        { name: 'Engenharia de requisitos', hours: 3 },
        { name: 'Low-code e no-code software development', hours: 2 },
      ],
    },
  ]);

  // 8. DevOps e DevSecOps
  await createSubject(user.id, 'DevOps e DevSecOps', 6, [
    {
      name: 'Ferramentas e Práticas',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Docker', hours: 1 },
        { name: 'Kubernetes', hours: 2 },
        { name: 'Jenkins', hours: 2 },
        { name: 'Maven', hours: 2 },
        { name: 'CircleCI', hours: 2 },
        { name: 'Git e GitHub', hours: 1 },
        { name: 'Selenium e Testes Automatizados', hours: 2 },
      ],
    },
  ]);

  // 9. Metodologia de Desenvolvimento de Software
  await createSubject(user.id, 'Metodologia de Desenvolvimento de Software', 7, [
    {
      name: 'Fundamentos e Ciclo de Vida',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Fundamentos e ciclo de vida do desenvolvimento de sistemas', hours: 2 },
        { name: 'Metodologias ágeis: SCRUM e XP', hours: 3 },
        { name: 'Metodologias tradicionais', hours: 2 },
        { name: 'Análise, projeto, implementação e testes', hours: 3 },
        { name: 'Métricas: análise de pontos de função', hours: 3 },
        { name: 'Modelagem de processos de negócios', hours: 3 },
      ],
    },
  ]);

  // 10. Orientação a Objetos
  await createSubject(user.id, 'Orientação a Objetos', 6, [
    {
      name: 'Conceitos e UML',
      difficulty: 'FACIL',
      topics: [
        { name: 'Conceitos fundamentais de OO', hours: 2 },
        { name: 'Princípios de concepção e programação OO', hours: 2 },
        { name: 'Reutilização de componentes', hours: 2 },
        { name: 'UML: notações e diagramas', hours: 3 },
      ],
    },
  ]);

  // 11. Gerência de Projetos, Serviços e Governança de TI
  await createSubject(user.id, 'Gerência de Projetos, Serviços e Governança de TI', 7, [
    {
      name: 'Gestão de Projetos',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Fluxos de gerência de projetos', hours: 3 },
        { name: 'Gerência de configuração e mudança', hours: 3 },
        { name: 'Ambiente e implantação', hours: 2 },
        { name: 'Projeto de interfaces', hours: 2 },
        { name: 'PMBOK 6ª Edição', hours: 4 },
      ],
    },
    {
      name: 'Governança de TI',
      difficulty: 'MEDIO',
      topics: [
        { name: 'ITIL V4', hours: 4 },
        { name: 'COBIT 2019', hours: 4 },
      ],
    },
  ]);

  // 12. Programação
  await createSubject(user.id, 'Programação', 5, [
    {
      name: 'Linguagens e Ferramentas',
      difficulty: 'FACIL',
      topics: [
        { name: 'Python', hours: 1 },
        { name: 'Ruby', hours: 2 },
        { name: 'PHP', hours: 1 },
        { name: 'C#', hours: 1 },
        { name: 'Java', hours: 1 },
        { name: 'Visual Studio e Eclipse IDE', hours: 1 },
      ],
    },
    {
      name: 'Arcabouços (Frameworks)',
      difficulty: 'FACIL',
      topics: [
        { name: '.NET e Hibernate/NHibernate', hours: 2 },
        { name: 'Ruby on Rails', hours: 2 },
        { name: 'Spring Boot', hours: 2 },
      ],
    },
  ]);

  // 13. Desenvolvimento Web e Mobile
  await createSubject(user.id, 'Desenvolvimento Web e Mobile', 6, [
    {
      name: 'Web Fundamentos',
      difficulty: 'FACIL',
      topics: [
        { name: 'Funcionamento do protocolo HTTP', hours: 1 },
        { name: 'Servidores Web e de aplicação', hours: 1 },
        { name: 'HTML, CSS e JSF', hours: 1 },
        { name: 'JavaScript e jQuery', hours: 1 },
        { name: 'Node.js', hours: 1 },
        { name: 'XML: criação, elementos e atributos', hours: 2 },
        { name: 'Progressive Web Apps (PWA)', hours: 2 },
      ],
    },
    {
      name: 'Frameworks Frontend e Mobile',
      difficulty: 'FACIL',
      topics: [
        { name: 'React e ReactNative', hours: 1 },
        { name: 'Flutter', hours: 2 },
        { name: 'Angular e Vue', hours: 2 },
      ],
    },
  ]);

  // 14. Desenvolvimento de Software Seguro
  await createSubject(user.id, 'Desenvolvimento de Software Seguro', 6, [
    {
      name: 'Práticas de Segurança no Desenvolvimento',
      difficulty: 'MEDIO',
      topics: [
        { name: 'SDL (Security Development Lifecycle)', hours: 3 },
        { name: 'CLASP', hours: 3 },
        { name: 'Codificação Segura e Programação Defensiva', hours: 3 },
        { name: 'Inteligência Artificial: Machine Learning e Deep Learning', hours: 3 },
      ],
    },
  ]);

  // 15. Banco de Dados
  await createSubject(user.id, 'Banco de Dados', 8, [
    {
      name: 'Modelagem',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Modelagem de dados e Modelo Entidade-Relacionamento', hours: 3 },
        { name: 'Formas normais', hours: 3 },
      ],
    },
    {
      name: 'SGBDs e SQL',
      difficulty: 'FACIL',
      topics: [
        { name: 'Oracle 18c', hours: 2 },
        { name: 'SQL Server 2019', hours: 2 },
        { name: 'PostgreSQL 9.x e 11.x', hours: 1 },
        { name: 'MySQL 8+', hours: 1 },
        { name: 'SQL padrão ANSI', hours: 2 },
        { name: 'PL/SQL e PL/pgSQL', hours: 2 },
        { name: 'TransactSQL', hours: 2 },
        { name: 'Tuning de banco de dados', hours: 3 },
      ],
    },
    {
      name: 'BI e Big Data',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Business Intelligence 3.0 e Data Warehouse', hours: 3 },
        { name: 'ETL e Data Mining', hours: 3 },
        { name: 'Data Mart e OLAP', hours: 3 },
        { name: 'Big Data e Data Science', hours: 3 },
      ],
    },
  ]);

  // 16. Fundamentos de Programação
  await createSubject(user.id, 'Fundamentos de Programação', 5, [
    {
      name: 'Estrutura e Lógica',
      difficulty: 'FACIL',
      topics: [
        { name: 'Sintaxe básica, palavras-chave e estrutura de um programa', hours: 1 },
        { name: 'Compilação e execução de programas', hours: 1 },
        { name: 'Tipos primitivos de dados', hours: 1 },
        { name: 'Declaração e inicialização de variáveis', hours: 1 },
        { name: 'Literais, strings e operadores', hours: 1 },
        { name: 'Controle de fluxo, repetição e estruturas de seleção', hours: 2 },
      ],
    },
    {
      name: 'OO e Acesso a Dados',
      difficulty: 'FACIL',
      topics: [
        { name: 'Classes, métodos, variáveis e encapsulamento', hours: 1 },
        { name: 'Packages e sobrecarga de métodos', hours: 1 },
        { name: 'Bibliotecas, componentes e exceções', hours: 2 },
        { name: 'Acesso a banco de dados e SQL', hours: 2 },
      ],
    },
  ]);

  // 17. Manutenção de Sistemas
  await createSubject(user.id, 'Manutenção de Sistemas', 5, [
    {
      name: 'Diagnóstico e Correção',
      difficulty: 'FACIL',
      topics: [
        { name: 'Compreensão e solução de implementações de rotinas, programas e arquivos', hours: 2 },
        { name: 'Diagnóstico de problemas e depuração de erros', hours: 2 },
        { name: 'Metodologias de teste de software', hours: 3 },
        { name: 'Versionamento de código com Git e GitHub', hours: 1 },
      ],
    },
  ]);

  // 18. Qualidade do Software
  await createSubject(user.id, 'Qualidade do Software', 6, [
    {
      name: 'Modelos de Qualidade',
      difficulty: 'MEDIO',
      topics: [
        { name: 'CMMI-DEV v1.3', hours: 4 },
        { name: 'ABNT NBR ISO/IEC/IEEE 12207:2021', hours: 4 },
        { name: 'MR-MPS-SW (MPS para Software)', hours: 4 },
      ],
    },
  ]);

  // 19. Arquiteturas
  await createSubject(user.id, 'Arquiteturas', 7, [
    {
      name: 'Padrões Arquiteturais',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Multi-camadas e Cliente-servidor', hours: 2 },
        { name: 'Objetos distribuídos', hours: 2 },
        { name: 'Padrão MVC', hours: 2 },
        { name: 'SOA – Arquitetura orientada a serviços', hours: 3 },
        { name: 'Multi-cloud architectures', hours: 2 },
        { name: 'Blockchain technology', hours: 3 },
        { name: 'Serverless computing', hours: 2 },
        { name: 'Cloud Computing', hours: 2 },
        { name: 'Internet of Things (IoT)', hours: 2 },
      ],
    },
  ]);

  // 20. Noções de Infraestrutura
  await createSubject(user.id, 'Noções de Infraestrutura', 6, [
    {
      name: 'Sistemas Operacionais',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Princípios de sistemas operacionais', hours: 2 },
        { name: 'Linux', hours: 2 },
        { name: 'Windows 10 e Windows Server', hours: 2 },
      ],
    },
    {
      name: 'Redes de Computadores',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Fundamentos de comunicação de dados e meios físicos', hours: 3 },
        { name: 'Elementos de interconexão: gateways, switches, roteadores', hours: 3 },
        { name: 'Tecnologias de redes locais e de longa distância', hours: 3 },
        { name: 'Arquitetura TCP/IP, IPv4 e IPv6', hours: 3 },
        { name: 'VoIP', hours: 2 },
        { name: 'Administração de usuários, grupos e permissões (LDAP e Active Directory)', hours: 3 },
      ],
    },
  ]);

  // 21. Segurança de Redes de Computadores
  await createSubject(user.id, 'Segurança de Redes de Computadores', 7, [
    {
      name: 'Ameaças e Defesas',
      difficulty: 'MEDIO',
      topics: [
        { name: 'Antivírus e Malwares', hours: 2 },
        { name: 'Ataques e ameaças da Internet e de redes sem fio', hours: 3 },
        { name: 'Técnicas de defesa', hours: 3 },
        { name: 'Teste de intrusão (Pentest)', hours: 3 },
      ],
    },
  ]);

  // 22. Segurança da Informação
  await createSubject(user.id, 'Segurança da Informação', 8, [
    {
      name: 'Normas ISO/IEC',
      difficulty: 'DIFICIL',
      topics: [
        { name: 'ABNT NBR ISO/IEC 27001:2013 – SGSI', hours: 4 },
        { name: 'ABNT NBR ISO/IEC 27002:2013 – Controles de segurança', hours: 4 },
        { name: 'ABNT NBR ISO/IEC 27701:2019 – Privacidade', hours: 3 },
        { name: 'ABNT NBR ISO/IEC 27005:2019 – Gestão de riscos', hours: 4 },
        { name: 'Lei Geral de Proteção de Dados (LGPD)', hours: 4 },
      ],
    },
  ]);

  // ─── Resumo ────────────────────────────────────────────────────────────────
  const totalSubjects = await prisma.subject.count({ where: { userId: user.id } });
  const totalModules  = await prisma.module.count();
  const totalTopics   = await prisma.topic.count();

  console.log(`\n✅ Seed concluído!`);
  console.log(`   👤 Usuário : ${user.email}`);
  console.log(`   📚 Matérias: ${totalSubjects}`);
  console.log(`   📂 Módulos : ${totalModules}`);
  console.log(`   📝 Tópicos : ${totalTopics}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
