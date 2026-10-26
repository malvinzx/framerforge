/* FrameForge — klasifikasi file, pembuatan aset, dan penggambaran ke kanvas pratinjau */
(() => {
  const FF = window.FF, { $ } = FF;
  const media = (FF.media = {});
  const canvas = $('previewCanvas'), ctx = canvas.getContext('2d');
  media.canvas = canvas; media.ctx = ctx;

  const imageExt = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
  const videoExt = /\.(mp4|webm|mov|m4v|ogv)$/i;
  const audioExt = /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/i;
  const textExt = /\.(txt|srt|vtt|md|json|xml|html?|css|m?js|ts|tsx|jsx|py|php|java|c|cpp|h|yml|yaml|toml|ini|log|csv)$/i;
  media.typeOf = (f) => {
    const t = f.type || '';
    if (/\.zip$/i.test(f.name) || t === 'application/zip' || t === 'application/x-zip-compressed') return 'zip';
    if (t.startsWith('image/') || imageExt.test(f.name)) return 'image';
    if (t.startsWith('video/') || videoExt.test(f.name)) return 'video';
    if (t.startsWith('audio/') || audioExt.test(f.name)) return 'audio';
    if (textExt.test(f.name)) return 'text';
    return 'other';
  };
  media.isVisual = (a) => a.type === 'image' || a.type === 'video';

  /** Ukuran video: resolusi = sisi PENDEK (720p di 9:16 → 720×1280). Selalu genap agar H.264 valid. */
  media.getDimensions = () => {
    const [rw, rh] = $('ratio').value.split(':').map(Number);
    const s = Number($('resolution').value) || 720;
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    return rw >= rh ? { w: even((s * rw) / rh), h: even(s) } : { w: even(s), h: even((s * rh) / rw) };
  };
  media.setCanvasSize = () => {
    const d = media.getDimensions();
    canvas.width = d.w; canvas.height = d.h;
    $('previewInfo').textContent = `${d.w} × ${d.h} px`;
    $('previewRatio').textContent = $('ratio').value;
    $('previewStage').style.aspectRatio = `${d.w}/${d.h}`;
    media.redrawPreview();
  };
  media.drawBackground = () => { ctx.fillStyle = '#11131a'; ctx.fillRect(0, 0, canvas.width, canvas.height); };
  media.redrawPreview = () => {
    media.drawBackground();
    const first = FF.state.assets.find(media.isVisual);
    if (first) { media.drawAsset(first, 1); $('previewOverlay').classList.add('hidden'); }
    else $('previewOverlay').classList.remove('hidden');
  };

  /* ---------- Membangun aset dari daftar file ---------- */
  let buildToken = 0;
  media.buildAssets = async () => {
    const token = ++buildToken;
    const S = FF.state;
    S.assets.forEach((a) => { if (a.url) URL.revokeObjectURL(a.url); if (a.el && a.el.pause) a.el.pause(); });
    S.assets = [];
    const next = [], problems = [];
    for (const f of S.files) {
      const type = media.typeOf(f), asset = { file: f, type, url: null, el: null };
      if (type === 'image') {
        asset.url = URL.createObjectURL(f);
        asset.el = new Image();
        asset.el.src = asset.url;
        try { await asset.el.decode(); } catch { problems.push(f.name); URL.revokeObjectURL(asset.url); continue; }
      } else if (type === 'video') {
        asset.url = URL.createObjectURL(f);
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = asset.url;
        await new Promise((resolve) => {
          const done = () => resolve();
          v.addEventListener('loadeddata', done, { once: true });
          v.addEventListener('error', done, { once: true });
          setTimeout(done, 8000);
        });
        if (!v.videoWidth) { problems.push(f.name); URL.revokeObjectURL(asset.url); continue; }
        asset.el = v;
      } else if (type === 'audio') {
        asset.url = URL.createObjectURL(f);
      }
      next.push(asset);
      if (token !== buildToken) { next.forEach((a) => a.url && URL.revokeObjectURL(a.url)); return; }
    }
    if (token !== buildToken) { next.forEach((a) => a.url && URL.revokeObjectURL(a.url)); return; }
    S.assets = next;
    media.redrawPreview();
    media.updateEstimate();
    if (problems.length) FF.ui.setMessage(`${problems.length} file tidak bisa dibaca browser (codec/format): ${problems.slice(0, 2).join(', ')}${problems.length > 2 ? '…' : ''}`);
  };

  /* ---------- Menggambar ---------- */
  function roundedRect(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); c.closePath(); }
  function drawMedia(el, vw, vh, w, h) {
    if (!vw || !vh) return;
    const mode = $('fit').value;
    if (mode === 'blur') {
      const s = Math.max(w / vw, h / vh), bw = vw * s, bh = vh * s;
      ctx.save();
      if ('filter' in ctx) ctx.filter = 'blur(18px)';
      ctx.drawImage(el, (w - bw) / 2, (h - bh) / 2, bw, bh);
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, w, h);
      const s2 = Math.min(w / vw, h / vh);
      ctx.drawImage(el, (w - vw * s2) / 2, (h - vh * s2) / 2, vw * s2, vh * s2);
    } else {
      const s = mode === 'contain' ? Math.min(w / vw, h / vh) : Math.max(w / vw, h / vh);
      const dw = vw * s, dh = vh * s;
      ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
  }
  media.drawAsset = (a, alpha = 1) => {
    if (!a || !a.el) return;
    const w = canvas.width, h = canvas.height, el = a.el;
    ctx.save();
    ctx.globalAlpha = FF.clamp(alpha, 0, 1);
    if (a.type === 'video') { if (el.readyState >= 2) drawMedia(el, el.videoWidth || w, el.videoHeight || h, w, h); }
    else if (a.type === 'image') drawMedia(el, el.naturalWidth || 1280, el.naturalHeight || 720, w, h);
    ctx.globalAlpha = 1;
    const title = $('titleText').value.trim();
    if (title) {
      const size = Math.max(20, Math.round(w * 0.045));
      ctx.font = `800 ${size}px Manrope, Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const maxWidth = w * 0.82; let t = title;
      while (ctx.measureText(t).width > maxWidth && t.length > 4) t = t.slice(0, -2) + '…';
      const y = h * 0.78;
      ctx.fillStyle = '#00000088'; roundedRect(ctx, w * 0.08, y - size * 1.25, w * 0.84, size * 2.25, size * 0.35); ctx.fill();
      ctx.fillStyle = $('accent').value; ctx.fillText(t, w / 2, y);
    }
    if ($('showFilename').checked) {
      const name = a.file.name.replace(/\.[^.]+$/, '');
      const size = Math.max(12, Math.round(w * 0.018));
      ctx.font = `500 ${size}px Arial,sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      const label = name.length > 80 ? name.slice(0, 77) + '…' : name;
      ctx.fillStyle = '#0000009c';
      roundedRect(ctx, w * 0.035, h * 0.925, Math.min(w * 0.82, ctx.measureText(label).width + size * 1.4), size * 2, size * 0.3); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillText(label, w * 0.05, h * 0.965, w * 0.8);
    }
    ctx.restore();
  };

  media.updateEstimate = () => {
    const S = FF.state;
    const visual = S.assets.filter(media.isVisual);
    const audio = S.assets.some((a) => a.type === 'audio');
    const perImage = FF.clamp(Number($('imageDuration').value) || 4, 1, 60);
    const secs = visual.reduce((sum, a) => sum + (a.type === 'image' ? perImage : FF.clamp(a.el.duration || 8, 1, 120)), 0);
    if (!S.busy) {
      FF.ui.setMessage(visual.length ? `${visual.length} media visual · sekitar ${Math.ceil(secs)} detik${audio ? ' · audio tersedia' : ''}` : 'Tambahkan minimal satu gambar atau video.');
      $('exportBtn').disabled = !visual.length;
    }
  };
})();
