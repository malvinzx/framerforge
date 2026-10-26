// Menyalin library dari node_modules ke public/vendor agar semuanya di-host sendiri (tanpa CDN).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'public', 'vendor');

const files = [
  ['jszip/dist/jszip.min.js', 'jszip.min.js'],
  ['html2canvas/dist/html2canvas.min.js', 'html2canvas.min.js'],
  ['@ffmpeg/ffmpeg/dist/ffmpeg.min.js', 'ffmpeg/ffmpeg.min.js'],
  ['@ffmpeg/core/dist/ffmpeg-core.js', 'ffmpeg/ffmpeg-core.js'],
  ['@ffmpeg/core/dist/ffmpeg-core.wasm', 'ffmpeg/ffmpeg-core.wasm'],
  ['@ffmpeg/core/dist/ffmpeg-core.worker.js', 'ffmpeg/ffmpeg-core.worker.js'],
];
let missing = 0;
for (const [from, to] of files) {
  const src = path.join(root, 'node_modules', from);
  const dst = path.join(out, to);
  if (!fs.existsSync(src)) { console.warn('! tidak ditemukan:', from, '(jalankan "npm install" dulu)'); missing++; continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('✓', to);
}
if (missing && process.env.VERCEL) { console.error('Build gagal: dependensi tidak lengkap.'); process.exit(1); }
