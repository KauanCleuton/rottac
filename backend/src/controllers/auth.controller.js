const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { generateToken } = require('../utils/jwt');
const { success, created, badRequest, unauthorized, error } = require('../utils/response');

const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return badRequest(res, 'Email já cadastrado');

    const hashed = await bcrypt.hash(password, 12);

    const role = req.body.role === 'TEACHER' ? 'TEACHER' : 'STUDENT';

    const user = await prisma.user.create({
      data: { name, email, password: hashed, role },
    });

    // Criar gamificação inicial
    await prisma.gamification.create({ data: { userId: user.id } });

    const token = generateToken({ id: user.id, email: user.email, name: user.name });

    return created(res, {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    }, 'Conta criada com sucesso');
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return unauthorized(res, 'Email ou senha inválidos');

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return unauthorized(res, 'Email ou senha inválidos');

    if (!user.isActive) return unauthorized(res, 'Conta desativada');

    const token = generateToken({ id: user.id, email: user.email, name: user.name });

    return success(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        experienceLevel: user.experienceLevel,
        examName: user.examName,
        examDate: user.examDate,
        avatar: user.avatar,
      },
    }, 'Login realizado com sucesso');
  } catch (err) {
    next(err);
  }
};

const me = async (req, res, next) => {
  try {
    const { password: _, ...userRaw } = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { gamification: true },
    }) || {};
    const user = userRaw;
    if (!user) return unauthorized(res, 'Usuário não encontrado');
    return success(res, user);
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return badRequest(res, 'Senha atual incorreta');

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashed },
    });

    return success(res, null, 'Senha alterada com sucesso');
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, me, changePassword };
