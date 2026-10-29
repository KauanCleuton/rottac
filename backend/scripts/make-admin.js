// Promove um usuário a ADMIN (único jeito de criar admin; o cadastro nunca concede esse papel).
// Uso: npm run make-admin -- email@dominio.com
require('dotenv').config();
const prisma = require('../src/utils/prisma');

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error('Informe o email: npm run make-admin -- email@dominio.com');
  const user = await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
  console.log(`✔ ${user.name} <${user.email}> agora é ADMIN`);
}

main()
  .catch((e) => { console.error(e.code === 'P2025' ? 'Usuário não encontrado' : e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
