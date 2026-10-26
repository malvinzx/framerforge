/* FrameForge — pratinjau website dan perekaman (mode Tab-capture & mode Snapshot) */
(() => {
  const FF = window.FF, { $, wait, clamp } = FF;
  const S = FF.state, ui = FF.ui;
  const site = (FF.website = {});

  const frame = $('siteFrame'), stage = $('siteStage'), wrap = $('siteFrameWrap');
  let ready = false, lastHtml = '', objectUrls = [], estDuration = 15;
  site.isReady = () => ready;

  /** Ukuran viewport (px CSS) yang disimulasikan sesuai rasio video. */
  const VIEWPORTS = { '16:9': { w: 1280, h: 720 }, '9:16': { w: 414, h: 736 }, '1:1': { w: 800, h: 800 }, '4:5': { w: 720, h: 900 } };
  const viewport = () => VIEWPORTS[$('ratio').value] || VIEWPORTS['16:9'];

  function layoutStage() {
    if (!ready) return;
    const vp = viewport();
    const availW = Math.max(120, wrap.clientWidth - 24), maxH = Math.min(560, window.innerHeight * 0.7);
    const k = Math.min(availW / vp.w, maxH / vp.h, 1);
    stage.style.width = `${Math.round(vp.w * k)}px`; stage.style.height = `${Math.round(vp.h * k)}px`;
    frame.style.width = `${vp.w}px`; frame.style.height = `${vp.h}px`; frame.style.transform = `scale(${k})`;
  }
  site.layout = layoutStage;
  if (window.ResizeObserver) new ResizeObserver(layoutStage).observe(wrap);
  window.addEventListener('resize', layoutStage);

  site.reset = () => {
    objectUrls.forEach((u) => URL.revokeObjectURL(u)); objectUrls = [];
    ready = false; lastHtml = '';
    frame.hidden = true; frame.removeAttribute('srcdoc'); stage.classList.remove('ready');
    const empty = wrap.querySelector('.site-empty'); if (empty) empty.style.display = 'flex';
    $('siteStatus').textContent = 'Belum ada project'; $('siteDurationDisplay').textContent = 'Menunggu project…';
    $('recordSiteBtn').disabled = true;
  };

  /** Dipanggil saat ZIP dipilih. Mengembalikan File[] bila ZIP ternyata berisi media saja. */
  site.loadZip = async (file) => {
    $('siteStatus').textContent = 'Membaca ZIP…'; $('recordSiteBtn').disabled = true;
    try {
      const res = await FF.siteZip.process(file);
      if (res.kind === 'media') { site.reset(); ui.setMessage(`ZIP berisi ${res.files.length} file media — ditambahkan ke daftar.`); return res.files; }
      site.reset();
      objectUrls = res.urls; lastHtml = res.html; estDuration = res.duration;
      $('siteDurationDisplay').textContent = `± ${estDuration} detik`;
      stage.classList.add('ready'); frame.hidden = false; ready = true;
      const empty = wrap.querySelector('.site-empty'); if (empty) empty.style.display = 'none';
      layoutStage();
      frame.srcdoc = lastHtml;
      $('siteStatus').textContent = `${res.count} file · ${res.entry}`;
      $('recordSiteBtn').disabled = false;
      ui.setMessage(`Project ZIP siap dipratinjau: ${res.entry}`);
    } catch (err) {
      console.error(err);
      site.reset();
      $('siteStatus').textContent = 'Gagal membaca ZIP';
      const empty = wrap.querySelector('.site-empty');
      if (empty) { empty.style.display = 'flex'; empty.innerHTML = `<span>!</span><strong>ZIP tidak bisa dipratinjau</strong><p>${FF.esc(err.message || 'Pastikan ZIP berisi file HTML.')}</p>`; }
    }
    return [];
  };

  /* ---------- Perekaman ---------- */
  const reloadFrame = () => new Promise((resolve) => {
    const done = () => resolve();
    frame.addEventListener('load', done, { once: true });
    frame.srcdoc = lastHtml + `\n<!-- ${Date.now()} -->`; // string berbeda → paksa muat ulang agar animasi intro ikut terekam
    setTimeout(done, 15000);
  });

  async function openTabCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('Browser ini tidak mendukung rekam tab. Pilih mode "Snapshot".');
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' });
    } catch (e) {
      throw new Error('Izin berbagi tab ditolak atau dibatalkan. Ulangi dan pilih tab FrameForge ini (atau pakai mode Snapshot).');
    }
    const track = display.getVideoTracks()[0];
    let cropped = false;
    if (window.CropTarget && track.cropTo) {
      try { await track.cropTo(await CropTarget.fromElement(stage)); cropped = true; }
      catch (e) { display.getTracks().forEach((t) => t.stop()); throw new Error('Yang dibagikan bukan tab FrameForge ini. Ulangi dan pilih tab ini, atau gunakan mode Snapshot.'); }
    }
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = display;
    await video.play();
    return { display, video, cropped };
  }

  async function recordWebsite() {
    if (!ready || S.busy) return;
    if (!window.MediaRecorder) { ui.showError('Browser tidak didukung', 'Browser ini tidak mendukung MediaRecorder. Gunakan Chrome, Edge, Firefox, atau Safari terbaru.'); return; }
    const mode = $('siteMode').value;
    const manual = Number($('siteDurationManual').value);
    const duration = clamp(manual > 0 ? manual : estDuration, 3, 180);
    const { w: W, h: H } = FF.media.getDimensions();
    const vp = viewport();
    const fps = mode === 'snapshot' ? 12 : Math.min(30, Number($('fps').value) || 30);
    const autoScroll = $('siteAutoScroll').checked;

    S.cancelled = false; FF.setBusy(true);
    ui.showProgress(true); ui.hideResult(); ui.setProgress(1, 'Menyiapkan perekaman…');
    const lock = await FF.encoder.keepAwake();
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const octx = out.getContext('2d', { alpha: false });
    octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, W, H);
    let capture = null, audio = null, stream = null, rec = null, timer = null;
    const htmlEl = document.documentElement, prevOverflow = htmlEl.style.overflow;
    try {
      if (mode === 'snapshot' && !(await FF.libs.html2canvas())) throw new Error('Renderer snapshot (html2canvas) gagal dimuat. Periksa koneksi internet atau letakkan html2canvas.min.js di folder vendor/.');
      if (mode === 'tab') { stage.scrollIntoView({ block: 'center' }); await wait(250); htmlEl.style.overflow = 'hidden'; capture = await openTabCapture(); }

      ui.setProgress(3, 'Memuat ulang website…');
      await reloadFrame(); await wait(500);
      const win = frame.contentWindow, doc = frame.contentDocument;
      if (!doc || !doc.documentElement) throw new Error('Pratinjau website belum siap. Tunggu beberapa detik lalu coba lagi.');

      stream = out.captureStream(fps);
      const audioFiles = $('audioMode').value === 'mute' ? [] : S.files.filter((f) => FF.media.typeOf(f) === 'audio');
      audio = await FF.encoder.addAudio(stream, audioFiles);
      const pick = FF.encoder.pickFormat($('format').value);
      rec = FF.encoder.startRecorder(stream, pick, clamp(Math.round(W * H * fps * 0.12), 1_500_000, 12_000_000));

      let lastShot = null;
      const paintLast = () => { if (lastShot) octx.drawImage(lastShot, 0, 0, W, H); };
      const drawTab = () => {
        const v = capture.video; if (v.readyState < 2 || !v.videoWidth) return;
        if (capture.cropped) octx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, W, H);
        else { const r = stage.getBoundingClientRect(), k = v.videoWidth / window.innerWidth; octx.drawImage(v, r.left * k, r.top * k, r.width * k, r.height * k, 0, 0, W, H); }
      };
      if (mode === 'snapshot') timer = setInterval(paintLast, 1000 / fps);

      const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
      const scrollMax = () => Math.max(0, Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0) - vp.h);
      const applyScroll = (p) => { if (!autoScroll) return; const max = scrollMax(); if (max > 0) win.scrollTo({ top: max * ease(clamp((p - 0.1) / 0.8, 0, 1)), left: 0, behavior: 'instant' }); };

      const t0 = performance.now();
      while (!S.cancelled) {
        const elapsed = (performance.now() - t0) / 1000;
        if (elapsed >= duration) break;
        applyScroll(elapsed / duration);
        if (mode === 'tab') { drawTab(); await new Promise((r) => requestAnimationFrame(r)); }
        else {
          try {
            lastShot = await html2canvas(doc.documentElement, { backgroundColor: '#ffffff', logging: false, useCORS: true, allowTaint: false, scale: W / vp.w, width: vp.w, height: vp.h, x: win.scrollX || 0, y: win.scrollY || 0, windowWidth: vp.w, windowHeight: vp.h });
          } catch (e) { console.warn('Frame dilewati:', e); await wait(100); }
        }
        ui.setProgress(5 + (elapsed / duration) * 90, `Merekam website… ${Math.max(0, Math.ceil(duration - elapsed))} dtk tersisa`);
      }
      if (S.cancelled) { rec.abort(); ui.setProgress(0, 'Perekaman dibatalkan.'); return; }
      if (mode === 'snapshot') paintLast();
      await wait(250);
      ui.setProgress(96, 'Menyelesaikan file video…');
      await rec.stop();
      const res = await FF.encoder.finalize(rec, pick, ui.setProgress);
      let note = res.note;
      if (mode === 'tab' && !capture.cropped) note += `${note ? ' ' : ''}Browser ini tidak mendukung pemotongan area otomatis; pastikan area pratinjau tidak tertutup saat merekam.`;
      if (mode === 'snapshot') note += `${note ? ' ' : ''}Mode Snapshot memotret halaman berkala (± beberapa FPS). Untuk gerak yang halus, pakai mode Tab di Chrome/Edge desktop.`;
      ui.showResult({ blob: res.blob, ext: res.ext, info: `${W} × ${H} px · ${Math.round(duration)} detik`, note });
      ui.setProgress(100, 'Render selesai!');
      try { win.scrollTo({ top: 0, behavior: 'instant' }); } catch {}
    } catch (err) {
      console.error(err);
      if (rec) rec.abort();
      ui.setProgress(0, 'Render gagal.');
      ui.showError('Render belum berhasil', err.message || 'Terjadi kesalahan saat merender website.');
    } finally {
      if (timer) clearInterval(timer);
      htmlEl.style.overflow = prevOverflow;
      if (capture) capture.display.getTracks().forEach((t) => t.stop());
      if (audio) audio.stop();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (lock) lock.release().catch(() => {});
      FF.setBusy(false);
    }
  }
  site.record = recordWebsite;
})();
