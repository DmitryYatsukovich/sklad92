import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, '../../node_modules/dejavu-fonts-ttf/ttf');

const FONT_PATHS = {
  regular: path.join(FONT_DIR, 'DejaVuSans.ttf'),
  bold: path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'),
  mono: path.join(FONT_DIR, 'DejaVuSansMono.ttf'),
};

export function registerPdfFonts(doc) {
  doc.registerFont('DejaVu', FONT_PATHS.regular);
  doc.registerFont('DejaVu-Bold', FONT_PATHS.bold);
  doc.registerFont('DejaVuMono', FONT_PATHS.mono);
  doc.font('DejaVu');
}

export function createLandscapePdfDoc() {
  const doc = new PDFDocument({ margin: 28, size: 'A4', layout: 'landscape' });
  registerPdfFonts(doc);
  return doc;
}

export function pdfDocToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
