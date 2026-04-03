const prisma = require('../utils/prisma');
const { success } = require('../utils/response');

const getNotifications = async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return success(res, notifications);
  } catch (err) {
    next(err);
  }
};

const markRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
    return success(res, null, 'Notificação lida');
  } catch (err) {
    next(err);
  }
};

const markAllRead = async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    });
    return success(res, null, 'Todas as notificações marcadas como lidas');
  } catch (err) {
    next(err);
  }
};

module.exports = { getNotifications, markRead, markAllRead };
