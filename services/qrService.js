const fs = require('fs/promises');
const QRCode = require('qrcode');
const sharp = require('sharp');
const { logoPath } = require('./imageService');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function sanitizeOptions(opts = {}) {
  return {
    fg: HEX_RE.test(opts.fg || '') ? opts.fg : '#000000',
    bg: HEX_RE.test(opts.bg || '') ? opts.bg : '#ffffff',
    size: Math.min(2048, Math.max(128, parseInt(opts.size, 10) || 512)),
    margin: Math.min(10, Math.max(0, parseInt(opts.margin, 10) || 2)),
    // High error correction is forced when a logo is embedded so the QR
    // stays scannable with part of the matrix covered.
    errorCorrection: ['L', 'M', 'Q', 'H'].includes(opts.errorCorrection) ? opts.errorCorrection : 'H',
    embedLogo: Boolean(opts.embedLogo)
  };
}

/**
 * Generates a PNG QR code buffer for the given (permanent) URL.
 * Optionally embeds the organization logo centered on a white tile.
 */
async function generatePng(url, options = {}, logoFilename = null) {
  const opts = sanitizeOptions(options);
  const ec = opts.embedLogo && logoFilename ? 'H' : opts.errorCorrection;

  const qrBuffer = await QRCode.toBuffer(url, {
    type: 'png',
    width: opts.size,
    margin: opts.margin,
    errorCorrectionLevel: ec,
    color: { dark: opts.fg, light: opts.bg }
  });

  if (!opts.embedLogo || !logoFilename) return qrBuffer;

  // Logo tile is ~22% of the QR width: small enough for level-H recovery.
  const tileSize = Math.round(opts.size * 0.22);
  const logoSize = Math.round(tileSize * 0.84);
  const radius = Math.round(tileSize * 0.15);

  let logoBuffer;
  try {
    logoBuffer = await sharp(logoPath(logoFilename))
      .resize(logoSize, logoSize, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer();
  } catch {
    return qrBuffer; // Logo missing/corrupt: fall back to plain QR.
  }
  const logoMeta = await sharp(logoBuffer).metadata();

  // White rounded tile behind the logo preserves contrast and readability.
  const tile = Buffer.from(
    `<svg width="${tileSize}" height="${tileSize}">
       <rect width="${tileSize}" height="${tileSize}" rx="${radius}" fill="#ffffff"/>
     </svg>`
  );

  const tileWithLogo = await sharp(tile)
    .composite([{
      input: logoBuffer,
      left: Math.round((tileSize - logoMeta.width) / 2),
      top: Math.round((tileSize - logoMeta.height) / 2)
    }])
    .png()
    .toBuffer();

  return sharp(qrBuffer)
    .composite([{ input: tileWithLogo, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/**
 * Generates an SVG QR code string. The logo (if embedded) is inlined as a
 * base64 data URI on a white rounded tile in the center.
 */
async function generateSvg(url, options = {}, logoFilename = null) {
  const opts = sanitizeOptions(options);
  const ec = opts.embedLogo && logoFilename ? 'H' : opts.errorCorrection;

  let svg = await QRCode.toString(url, {
    type: 'svg',
    width: opts.size,
    margin: opts.margin,
    errorCorrectionLevel: ec,
    color: { dark: opts.fg, light: opts.bg }
  });

  if (opts.embedLogo && logoFilename) {
    try {
      const logoBuffer = await sharp(logoPath(logoFilename))
        .resize(300, 300, { fit: 'inside' })
        .png()
        .toBuffer();
      const dataUri = `data:image/png;base64,${logoBuffer.toString('base64')}`;

      // The generated SVG uses a viewBox of (modules + 2*margin) units.
      const viewBoxMatch = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
      const vb = viewBoxMatch ? parseFloat(viewBoxMatch[1]) : 37;
      const tile = vb * 0.22;
      const logo = tile * 0.84;
      const tileX = (vb - tile) / 2;
      const logoX = (vb - logo) / 2;
      const overlay =
        `<rect x="${tileX}" y="${tileX}" width="${tile}" height="${tile}" rx="${tile * 0.15}" fill="#ffffff"/>` +
        `<image x="${logoX}" y="${logoX}" width="${logo}" height="${logo}" href="${dataUri}" preserveAspectRatio="xMidYMid meet"/>`;
      svg = svg.replace('</svg>', `${overlay}</svg>`);
    } catch {
      // Logo missing/corrupt: return plain SVG.
    }
  }
  return svg;
}

module.exports = { generatePng, generateSvg, sanitizeOptions };
