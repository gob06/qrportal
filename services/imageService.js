const path = require('path');
const fs = require('fs/promises');
const sharp = require('sharp');

const LOGOS_DIR = path.join(__dirname, '..', 'uploads', 'logos');

/**
 * Optimizes an uploaded logo in place: resizes to a sane maximum while
 * preserving aspect ratio and transparency, and re-encodes as PNG or WEBP.
 * Returns the (possibly new) filename.
 */
async function optimizeLogo(filename) {
  const inputPath = path.join(LOGOS_DIR, filename);
  const base = filename.replace(/\.[^.]+$/, '');
  const outputName = `${base}-opt.png`;
  const outputPath = path.join(LOGOS_DIR, outputName);

  await sharp(inputPath)
    .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);

  await fs.unlink(inputPath).catch(() => {});
  return outputName;
}

async function deleteLogo(filename) {
  if (!filename) return;
  // Guard against path traversal: only ever delete inside the logos dir.
  const safe = path.basename(filename);
  await fs.unlink(path.join(LOGOS_DIR, safe)).catch(() => {});
}

function logoPath(filename) {
  return path.join(LOGOS_DIR, path.basename(filename));
}

module.exports = { optimizeLogo, deleteLogo, logoPath, LOGOS_DIR };
