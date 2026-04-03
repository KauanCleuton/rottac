const errorHandler = (err, req, res, next) => {
  console.error('[ERROR]', err);

  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      message: 'Registro duplicado. Este dado já existe.',
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Registro não encontrado.',
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Erro interno do servidor';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
