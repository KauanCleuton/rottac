const prisma = require('../utils/prisma');
const { success } = require('../utils/response');
const dayjs = require('dayjs');

// ─── GET /mentoring/mentors ────────────────────────────────────────────────
const getMentors = async (req, res, next) => {
  try {
    const mentors = await prisma.mentor.findMany({
      where: { isAvailable: true },
      include: { user: { select: { name: true, avatar: true } } },
    });
    return success(res, mentors);
  } catch (err) { next(err); }
};

// ─── POST /mentoring/mentor/register ──────────────────────────────────────
const registerAsMentor = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { bio, specialties, pricePerHour } = req.body;
    const mentor = await prisma.mentor.upsert({
      where: { userId },
      create: { userId, bio, specialties: specialties || [], pricePerHour },
      update: { bio, specialties: specialties || [], pricePerHour },
    });
    return success(res, mentor);
  } catch (err) { next(err); }
};

// ─── GET /mentoring/my ────────────────────────────────────────────────────
const getMyMentoring = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const mentoring = await prisma.mentoring.findFirst({
      where: { studentId: userId, status: { in: ['ATIVA', 'PENDENTE'] } },
      include: {
        mentor: { include: { user: { select: { name: true, avatar: true, email: true } } } },
        sessions: { orderBy: { scheduledAt: 'asc' }, take: 5 },
        plans: { orderBy: { weekNumber: 'desc' }, take: 4 },
      },
    });
    return success(res, mentoring);
  } catch (err) { next(err); }
};

// ─── POST /mentoring/request ───────────────────────────────────────────────
const requestMentoring = async (req, res, next) => {
  try {
    const studentId = req.user.id;
    const { mentorId, goals } = req.body;

    const existing = await prisma.mentoring.findFirst({
      where: { studentId, mentorId, status: { in: ['ATIVA', 'PENDENTE'] } },
    });
    if (existing) return res.status(400).json({ error: 'Você já tem uma mentoria com este mentor.' });

    const mentoring = await prisma.mentoring.create({
      data: { studentId, mentorId, goals: goals || [] },
      include: { mentor: { include: { user: { select: { name: true, avatar: true } } } } },
    });

    await prisma.notification.create({
      data: {
        userId: mentoring.mentor.userId,
        title: 'Nova solicitação de mentoria',
        body: `Um novo aluno solicitou sua mentoria.`,
        type: 'SISTEMA',
        data: { mentoringId: mentoring.id },
      },
    });

    return success(res, mentoring);
  } catch (err) { next(err); }
};

// ─── PATCH /mentoring/:id/accept ──────────────────────────────────────────
const acceptMentoring = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const mentor = await prisma.mentor.findUnique({ where: { userId } });
    if (!mentor) return res.status(403).json({ error: 'Apenas mentores podem aceitar mentorias.' });

    const mentoring = await prisma.mentoring.update({
      where: { id },
      data: { status: 'ATIVA', startedAt: new Date() },
    });

    await prisma.mentor.update({
      where: { userId },
      data: { totalStudents: { increment: 1 } },
    });

    await prisma.notification.create({
      data: {
        userId: mentoring.studentId,
        title: 'Mentoria aceita!',
        body: 'Seu mentor aceitou o pedido de mentoria. Você pode começar a conversar agora.',
        type: 'SISTEMA',
        data: { mentoringId: mentoring.id },
      },
    });

    return success(res, mentoring);
  } catch (err) { next(err); }
};

// ─── GET /mentoring/:id/messages ──────────────────────────────────────────
const getMessages = async (req, res, next) => {
  try {
    const { id } = req.params;
    const messages = await prisma.mentoringMessage.findMany({
      where: { mentoringId: id },
      include: { sender: { select: { id: true, name: true, avatar: true } } },
      orderBy: { sentAt: 'asc' },
      take: 100,
    });

    // Marca mensagens como lidas
    await prisma.mentoringMessage.updateMany({
      where: { mentoringId: id, senderId: { not: req.user.id }, isRead: false },
      data: { isRead: true },
    });

    return success(res, messages);
  } catch (err) { next(err); }
};

// ─── POST /mentoring/:id/messages ─────────────────────────────────────────
const sendMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content, type, fileUrl } = req.body;

    const message = await prisma.mentoringMessage.create({
      data: {
        mentoringId: id,
        senderId: req.user.id,
        content,
        type: type || 'TEXT',
        fileUrl,
      },
      include: { sender: { select: { id: true, name: true, avatar: true } } },
    });

    return success(res, message);
  } catch (err) { next(err); }
};

// ─── GET /mentoring/:id/sessions ──────────────────────────────────────────
const getSessions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const sessions = await prisma.mentoringSession.findMany({
      where: { mentoringId: id },
      orderBy: { scheduledAt: 'asc' },
    });
    return success(res, sessions);
  } catch (err) { next(err); }
};

// ─── POST /mentoring/:id/sessions ─────────────────────────────────────────
const scheduleSession = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scheduledAt, durationMin, platform, meetUrl, notes } = req.body;

    const session = await prisma.mentoringSession.create({
      data: {
        mentoringId: id,
        scheduledAt: new Date(scheduledAt),
        durationMin: durationMin || 60,
        platform,
        meetUrl,
        notes,
      },
    });

    const mentoring = await prisma.mentoring.findUnique({
      where: { id },
      select: { studentId: true, mentor: { select: { userId: true } } },
    });

    await prisma.notification.create({
      data: {
        userId: mentoring.studentId,
        title: 'Sessão agendada!',
        body: `Sessão marcada para ${dayjs(scheduledAt).format('DD/MM/YYYY [às] HH:mm')}.`,
        type: 'SISTEMA',
        data: { sessionId: session.id, mentoringId: id },
      },
    });

    return success(res, session);
  } catch (err) { next(err); }
};

// ─── GET /mentoring/mentor/dashboard ──────────────────────────────────────
const getMentorDashboard = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const mentor = await prisma.mentor.findUnique({ where: { userId } });
    if (!mentor) return res.status(403).json({ error: 'Você não é um mentor.' });

    const [activeStudents, pendingRequests, upcomingSessions, messages] = await Promise.all([
      prisma.mentoring.count({ where: { mentorId: mentor.id, status: 'ATIVA' } }),
      prisma.mentoring.findMany({
        where: { mentorId: mentor.id, status: 'PENDENTE' },
        include: { student: { select: { name: true, avatar: true } } },
      }),
      prisma.mentoringSession.findMany({
        where: {
          mentoring: { mentorId: mentor.id },
          scheduledAt: { gte: new Date() },
          status: 'AGENDADA',
        },
        include: { mentoring: { select: { student: { select: { name: true } } } } },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
      }),
      prisma.mentoringMessage.count({
        where: {
          mentoring: { mentorId: mentor.id },
          isRead: false,
          senderId: { not: userId },
        },
      }),
    ]);

    return success(res, {
      mentor,
      stats: { activeStudents, pendingRequests: pendingRequests.length, unreadMessages: messages },
      pendingRequests,
      upcomingSessions,
    });
  } catch (err) { next(err); }
};

// ─── GET /mentoring/mentor/student/:studentId/insights ─────────────────────
const getStudentInsights = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const [profile, insights, metrics] = await Promise.all([
      prisma.brainProfile.findUnique({ where: { userId: studentId } }),
      prisma.analysisInsight.findMany({
        where: { userId: studentId, isRead: false },
        orderBy: { severity: 'desc' },
        take: 10,
      }),
      // Coleta métricas resumidas
      prisma.questionLog.groupBy({
        by: ['subjectId'],
        where: { userId: studentId, loggedAt: { gte: dayjs().subtract(14, 'day').toDate() } },
        _count: true,
        _avg: { timeSpent: true },
      }),
    ]);

    return success(res, { profile, insights, recentActivity: metrics });
  } catch (err) { next(err); }
};

// ─── POST /mentoring/:id/plans ─────────────────────────────────────────────
const createWeeklyPlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { weekNumber, weekStart, weekEnd, goals, tasks } = req.body;

    const plan = await prisma.mentoringWeeklyPlan.create({
      data: {
        mentoringId: id,
        weekNumber,
        weekStart: new Date(weekStart),
        weekEnd: new Date(weekEnd),
        goals: goals || [],
        tasks: tasks || [],
      },
    });

    const mentoring = await prisma.mentoring.findUnique({
      where: { id },
      select: { studentId: true },
    });

    await prisma.notification.create({
      data: {
        userId: mentoring.studentId,
        title: 'Novo plano semanal do seu mentor!',
        body: `Semana ${weekNumber}: ${goals.length} metas e ${tasks.length} tarefas definidas.`,
        type: 'SISTEMA',
        data: { planId: plan.id, mentoringId: id },
      },
    });

    return success(res, plan);
  } catch (err) { next(err); }
};

module.exports = {
  getMentors,
  registerAsMentor,
  getMyMentoring,
  requestMentoring,
  acceptMentoring,
  getMessages,
  sendMessage,
  getSessions,
  scheduleSession,
  getMentorDashboard,
  getStudentInsights,
  createWeeklyPlan,
};
