import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const app = express();
const uploadRoot = path.join(os.tmpdir(), 'convertly-uploads');
await mkdir(uploadRoot, { recursive: true });

const allowedOffice = new Set(['.doc','.docx','.xls','.xlsx','.ppt','.pptx','.odt','.ods','.odp','.rtf']);
const allowedOcr = new Set(['.pdf','.png','.jpg','.jpeg','.tif','.tiff','.bmp']);
const storage = multer.diskStorage({
  destination: uploadRoot,
  filename: (_req, file, done) => done(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const uploader = multer({ storage, limits: { fileSize: 100 * 1024 * 1024, files: 20 } });

app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, service: 'convertly-api' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'convertly-api' }));

app.post('/api/office-to-pdf', uploader.array('files', 20), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Choose at least one Office document.' });
  if (files.some(file => !allowedOffice.has(path.extname(file.originalname).toLowerCase()))) return cleanupResponse(res, files, 415, 'One of those Office formats is not supported.');
  const job = await mkdtemp(path.join(os.tmpdir(), 'convertly-office-'));
  const outDir = path.join(job, 'out');
  const profileDir = path.join(job, 'profile');
  await mkdir(outDir); await mkdir(profileDir);
  try {
    await exec('libreoffice', [`-env:UserInstallation=file://${profileDir}`, '--headless', '--nologo', '--nodefault', '--nofirststartwizard', '--convert-to', 'pdf', '--outdir', outDir, ...files.map(file => file.path)], { timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
    const outputs = (await readdir(outDir)).filter(name => name.toLowerCase().endsWith('.pdf'));
    if (!outputs.length) throw new Error('LibreOffice did not produce a PDF from that document.');
    if (outputs.length === 1) return sendAndClean(res, path.join(outDir, outputs[0]), safeBase(files[0].originalname) + '.pdf', files, job);
    const zipPath = path.join(job, 'converted-office-files.zip');
    await zipFiles(zipPath, outputs.map(name => ({ path: path.join(outDir, name), name })));
    return sendAndClean(res, zipPath, 'converted-office-files.zip', files, job);
  } catch (error) {
    await cleanup(files, job);
    console.error('office conversion failed', error.message);
    return res.status(422).json({ error: 'That Office document could not be converted. It may be damaged, encrypted, or use unsupported features.' });
  }
});

app.post('/api/ocr', uploader.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Choose a scanned PDF or image.' });
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedOcr.has(ext)) return cleanupResponse(res, [file], 415, 'That scan format is not supported.');
  const job = await mkdtemp(path.join(os.tmpdir(), 'convertly-ocr-'));
  const outputType = req.body.output === 'txt' ? 'txt' : 'pdf';
  try {
    if (ext === '.pdf') {
      const searchable = path.join(job, 'searchable.pdf');
      await exec('ocrmypdf', ['--skip-text', '--deskew', '--rotate-pages', '--optimize', '1', file.path, searchable], { timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
      if (outputType === 'pdf') return sendAndClean(res, searchable, `${safeBase(file.originalname)}-searchable.pdf`, [file], job);
      const textPath = path.join(job, 'text.txt');
      await exec('pdftotext', [searchable, textPath], { timeout: 120000 });
      return sendAndClean(res, textPath, `${safeBase(file.originalname)}.txt`, [file], job);
    }
    if (outputType === 'txt') {
      const { stdout } = await exec('tesseract', [file.path, 'stdout'], { timeout: 240000, maxBuffer: 20 * 1024 * 1024 });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase(file.originalname)}.txt"`);
      res.send(stdout);
      return cleanup([file], job);
    }
    const base = path.join(job, 'scan');
    await exec('tesseract', [file.path, base, 'pdf'], { timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
    return sendAndClean(res, `${base}.pdf`, `${safeBase(file.originalname)}-searchable.pdf`, [file], job);
  } catch (error) {
    await cleanup([file], job);
    console.error('ocr failed', error.message);
    return res.status(422).json({ error: 'OCR could not read that file. Try a clearer scan or a smaller document.' });
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Files are limited to 100 MB each.' });
  res.status(500).json({ error: 'The conversion service encountered an unexpected error.' });
});

function safeBase(name) { return path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 100) || 'converted'; }
async function sendAndClean(res, filePath, name, uploads, job) { res.download(filePath, name, async () => cleanup(uploads, job)); }
async function cleanup(uploads = [], job) { await Promise.allSettled(uploads.map(file => rm(file.path, { force: true }))); if (job) await rm(job, { recursive: true, force: true }); }
async function cleanupResponse(res, files, status, message) { await cleanup(files); return res.status(status).json({ error: message }); }
function zipFiles(outputPath, files) { return new Promise((resolve, reject) => { const output = createWriteStream(outputPath); const zip = archiver('zip', { zlib: { level: 7 } }); output.on('close', resolve); output.on('error', reject); zip.on('error', reject); zip.pipe(output); files.forEach(file => zip.file(file.path, { name: file.name })); zip.finalize(); }); }

app.listen(3000, '0.0.0.0', () => console.log('Convertly API listening on port 3000'));
