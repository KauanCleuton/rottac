const prisma = require('../utils/prisma');
const { forbidden, unauthorized } = require('../utils/response');

// O papel não vai no JWT porque pode mudar (ex.: aluno vira professor ao aceitar convite),
// então é lido do banco a cada requisição protegida.
const loadRole = async (req) => {
  if (req.user.role) return req.user.role;
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  req.user.role = user.role;
  return user.role;
};

// ADMIN tem acesso a tudo que exige papel
const requireRole = (...roles) => async (req, res, next) => {
  try {
    const role = await loadRole(req);
    if (!role) return unauthorized(res, 'Conta inválida ou desativada');
    if (role !== 'ADMIN' && !roles.includes(role)) {
      return forbidden(res, 'Você não tem permissão para acessar este recurso');
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireRole, loadRole };
