/* FrameForge — utilitas umum, state bersama, pemuat library, dan UI progres/hasil */
(() => {
  const FF = (window.FF = window.FF || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtBytes = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  FF.$ = $; FF.esc = esc; FF.fmtBytes = fmtBytes; FF.wait = wait; FF.clamp = clamp;
  FF.state = { files: [], assets: [], cancelled: false, busy: false, resultUrl: null };

  /* ---------- Pemuat library (lokal di /vendor dulu, lalu CDN cadangan) ---------- */
  const scriptCache = new Map();
  function loadScript(src) {
    if (scriptCache.has(src)) return scriptCache.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve(src);
      s.onerror = () => { scriptCache.delete(src); s.remove(); reject(new Error('Gagal memuat ' + src)); };
      document.head.appendChild(s);
    });
    scriptCache.set(src, p);
    return p;
  }
  async function loadLib(sources, isReady) {
    if (isReady()) return true;
    for (const src of sources) {
      try { await loadScript(src); if (isReady()) return true; } catch (e) { console.warn(e.message); }
    }
    return false;
  }
  FF.libs = {
    jszip: () => loadLib(['vendor/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'], () => !!window.JSZip),
    html2canvas: () => loadLib(['vendor/html2canvas.min.js', 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'], () => !!window.html2canvas),
    ffmpeg: () => loadLib(['vendor/ffmpeg/ffmpeg.min.js', 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js', 'https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js'], () => !!(window.FFmpeg && window.FFmpeg.createFFmpeg)),
  };

  /* ---------- UI: progres, hasil, error ---------- */
  const ui = (FF.ui = {});
  ui.setProgress = (p, label) => {
    $('progressBar').style.width = `${clamp(p, 0, 100)}%`;
    $('progressPercent').textContent = `${Math.round(clamp(p, 0, 100))}%`;
    if (label) $('progressLabel').textContent = label;
  };
  ui.setMessage = (msg) => { $('exportEstimate').textContent = msg; };
  ui.showProgress = (show) => $('progressWrap').classList.toggle('hidden', !show);
  ui.hideResult = () => $('result').classList.add('hidden');
  ui.showError = (title, message) => {
    const r = $('result');
    r.className = 'result error';
    r.innerHTML = `<strong>${esc(title)}</strong><p>${esc(message)}</p>`;
  };
  ui.showResult = ({ blob, ext, info, note }) => {
    if (!blob || !blob.size) { ui.showError('Render belum berhasil', 'Hasil video kosong. Coba ulangi dengan resolusi lebih rendah.'); return; }
    if (FF.state.resultUrl) URL.revokeObjectURL(FF.state.resultUrl);
    const url = (FF.state.resultUrl = URL.createObjectURL(blob));
    const name = `frameforge-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    const EXT = ext.toUpperCase();
    const r = $('result');
    r.className = 'result';
    r.innerHTML =
      `<strong>✓ Video berhasil dibuat</strong><p>${fmtBytes(blob.size)} · ${EXT} · ${esc(info)}</p>` +
      (note ? `<p class="render-note">${esc(note)}</p>` : '') +
      `<video class="result-video" controls playsinline src="${url}"></video>` +
      `<div class="result-actions"><a class="download-link" href="${url}" download="${name}">↓ Simpan video ${EXT}</a>` +
      `<a class="open-link" href="${url}" target="_blank" rel="noopener">Buka di tab baru</a></div>`;
    r.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
})();
