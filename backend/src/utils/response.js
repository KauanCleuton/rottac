const success = (res, data = null, message = 'Sucesso', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const created = (res, data = null, message = 'Criado com sucesso') => {
  return success(res, data, message, 201);
};

const error = (res, message = 'Erro interno', statusCode = 500, details = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    details,
  });
};

const notFound = (res, message = 'Recurso não encontrado') => {
  return error(res, message, 404);
};

const unauthorized = (res, message = 'Não autorizado') => {
  return error(res, message, 401);
};

const forbidden = (res, message = 'Acesso negado') => {
  return error(res, message, 403);
};

const badRequest = (res, message = 'Dados inválidos', details = null) => {
  return error(res, message, 400, details);
};

module.exports = { success, created, error, notFound, unauthorized, forbidden, badRequest };
