const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// Organiza por: uploads/<tipo>/<userId>/<subjectId?>/<arquivo>
const createStorage = (folder) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const userId = req.user?.id || 'anonymous';
      // path.basename previne path traversal (../../etc)
      const rawSubjectId = req.body?.subjectId || req.query?.subjectId || '_geral';
      const subjectId = path.basename(String(rawSubjectId)).replace(/[^a-zA-Z0-9_-]/g, '_') || '_geral';
      const dir = path.join(__dirname, '../../uploads', folder, userId, subjectId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  });

const pdfFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') cb(null, true);
  else cb(new Error('Apenas arquivos PDF são permitidos'), false);
};

const imageFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Apenas imagens são permitidas'), false);
};

const audioFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('audio/')) cb(null, true);
  else cb(new Error('Apenas arquivos de áudio são permitidos'), false);
};

const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 52428800; // 50MB

const uploadPDF = multer({
  storage: createStorage('pdfs'),
  fileFilter: pdfFilter,
  limits: { fileSize: MAX_SIZE },
}).single('file');

const uploadImage = multer({
  storage: createStorage('images'),
  fileFilter: imageFilter,
  limits: { fileSize: 10485760 }, // 10MB
}).single('image');

const uploadAudio = multer({
  storage: createStorage('audios'),
  fileFilter: audioFilter,
  limits: { fileSize: 20971520 }, // 20MB
}).single('audio');

module.exports = { uploadPDF, uploadImage, uploadAudio };
