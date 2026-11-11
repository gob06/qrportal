const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const ALLOWED_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
};

const maxSizeMb = Number(process.env.UPLOAD_MAX_SIZE_MB || 5);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'logos'));
  },
  filename: (req, file, cb) => {
    // Sanitized, collision-free filename; the original name is discarded.
    const ext = ALLOWED_MIME[file.mimetype] || '.png';
    cb(null, `logo-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const uploadLogo = multer({
  storage,
  limits: { fileSize: maxSizeMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) return cb(null, true);
    cb(new Error('Only PNG, JPG/JPEG and WEBP images are allowed.'));
  }
}).single('logo');

/** Wraps multer so upload errors render as friendly messages. */
function handleLogoUpload(req, res, next) {
  uploadLogo(req, res, (err) => {
    if (err) {
      req.uploadError = err.code === 'LIMIT_FILE_SIZE'
        ? `Logo exceeds the ${maxSizeMb}MB upload limit.`
        : err.message;
    }
    next();
  });
}

module.exports = { handleLogoUpload };
