const { verifyToken } = require('../utils/jwt');
const { unauthorized } = require('../utils/response');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return unauthorized(res, 'Token de autenticação não fornecido');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return unauthorized(res, 'Token inválido ou expirado');
  }
};

module.exports = { authenticate };
