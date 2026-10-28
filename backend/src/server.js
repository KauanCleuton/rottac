const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

// BigInt não é serializável pelo JSON padrão — converte para Number globalmente
BigInt.prototype.toJSON = function () { return Number(this); };

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const subjectRoutes = require('./routes/subject.routes');
const studyPlanRoutes = require('./routes/studyPlan.routes');
const studyTaskRoutes = require('./routes/studyTask.routes');
const goalRoutes = require('./routes/goal.routes');
const flashcardRoutes = require('./routes/flashcard.routes');
const noteRoutes = require('./routes/note.routes');
const mindMapRoutes = require('./routes/mindMap.routes');
const pdfRoutes = require('./routes/pdf.routes');
const errorNotebookRoutes = require('./routes/errorNotebook.routes');
const questionRoutes = require('./routes/question.routes');
const focusRoutes = require('./routes/focus.routes');
const habitRoutes = require('./routes/habit.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const notificationRoutes = require('./routes/notification.routes');
const gamificationRoutes = require('./routes/gamification.routes');
const emotionRoutes = require('./routes/emotion.routes');
const intelligenceRoutes = require('./routes/intelligence.routes');
const behaviorRoutes = require('./routes/behavior.routes');
const missionRoutes = require('./routes/mission.routes');
const mentoringRoutes = require('./routes/mentoring.routes');
const editalRoutes = require('./routes/edital.routes');
const flashcardExtractRoutes = require('./routes/flashcardExtract.routes');
const postSimuladoRoutes = require('./routes/postSimulado.routes');
const dailyChallengeRoutes = require('./routes/dailyChallenge.routes');
const flashcardFolderRoutes = require('./routes/flashcardFolder.routes');
const questionExtractRoutes = require('./routes/questionExtract.routes');
const essayRoutes = require('./routes/essay.routes');
const teacherRoutes = require('./routes/teacher.routes');

const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./middlewares/errorHandler');

const app = express();

// ─── Middlewares globais ───────────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
  standardHeaders: true, legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 200,
  message: { error: 'Muitas requisições. Tente novamente em breve.' },
  standardHeaders: true, legacyHeaders: false,
});

// Servir uploads estaticamente
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Rotas ────────────────────────────────────────────────────────────────

const API = '/api/v1';

app.use(`${API}/auth`, authLimiter, authRoutes);
app.use(`${API}`, generalLimiter);
app.use(`${API}/users`, userRoutes);
app.use(`${API}/subjects`, subjectRoutes);
app.use(`${API}/study-plans`, studyPlanRoutes);
app.use(`${API}/study-tasks`, studyTaskRoutes);
app.use(`${API}/goals`, goalRoutes);
app.use(`${API}/flashcards/extract`, flashcardExtractRoutes);
app.use(`${API}/flashcards`, flashcardRoutes);
app.use(`${API}/notes`, noteRoutes);
app.use(`${API}/mind-maps`, mindMapRoutes);
app.use(`${API}/pdfs`, pdfRoutes);
app.use(`${API}/error-notebook`, errorNotebookRoutes);
app.use(`${API}/questions`, questionRoutes);
app.use(`${API}/focus`, focusRoutes);
app.use(`${API}/habits`, habitRoutes);
app.use(`${API}/analytics`, analyticsRoutes);
app.use(`${API}/notifications`, notificationRoutes);
app.use(`${API}/gamification`, gamificationRoutes);
app.use(`${API}/emotions`, emotionRoutes);
app.use(`${API}/intelligence`, intelligenceRoutes);
app.use(`${API}/behavior`, behaviorRoutes);
app.use(`${API}/missions`, missionRoutes);
app.use(`${API}/mentoring`, mentoringRoutes);
app.use(`${API}/edital`, editalRoutes);
app.use(`${API}/post-simulado`, postSimuladoRoutes);
app.use(`${API}/daily-challenge`, dailyChallengeRoutes);
app.use(`${API}/flashcard-folders`, flashcardFolderRoutes);
app.use(`${API}/question-extract`, questionExtractRoutes);
app.use(`${API}/essays`, essayRoutes);
app.use(`${API}/teacher`, teacherRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Error Handler ────────────────────────────────────────────────────────

app.use(errorHandler);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`\n🚀 Aprova.AI Backend rodando na porta ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/v1`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV}\n`);
});

module.exports = app;
