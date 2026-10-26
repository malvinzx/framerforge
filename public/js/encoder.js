/* FrameForge — perekam (MediaRecorder), pencampur audio, dan konversi MP4 */
(() => {
  const FF = window.FF;
  const enc = (FF.encoder = {});

  const MP4_TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'];
  const WEBM_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

  /** Pilih format rekam terbaik. MP4 asli dipakai bila browser mendukung; jika tidak, WebM (+ konversi FFmpeg bila memungkinkan). */
  enc.pickFormat = (wanted) => {
    const ok = (t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } };
    if (wanted === 'mp4') {
      const m = MP4_TYPES.find(ok);
      if (m) return { mime: m, ext: 'mp4', needsConvert: false };
    }
    const w = WEBM_TYPES.find(ok);
    if (w) return { mime: w, ext: 'webm', needsConvert: wanted === 'mp4' };
    const m = MP4_TYPES.find(ok);
    if (m) return { mime: m, ext: 'mp4', needsConvert: false };
    return { mime: '', ext: 'webm', needsConvert: wanted === 'mp4' }; // biarkan browser memilih default
  };

  /** Campur semua file audio menjadi satu track dan tambahkan ke stream. */
  enc.addAudio = async (stream, files) => {
    const handle = { ctx: null, sources: [], added: 0, failed: [], stop() { this.sources.forEach((s) => { try { s.stop(); } catch {} }); if (this.ctx) this.ctx.close().catch(() => {}); } };
    if (!files.length) return handle;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return handle;
    try {
      handle.ctx = new AC();
      const dest = handle.ctx.createMediaStreamDestination();
      for (const f of files) {
        try {
          const decoded = await handle.ctx.decodeAudioData((await f.arrayBuffer()).slice(0));
          const src = handle.ctx.createBufferSource();
          src.buffer = decoded; src.loop = true;
          const gain = handle.ctx.createGain();
          gain.gain.value = 1 / files.length;
          src.connect(gain); gain.connect(dest);
          handle.sources.push(src); handle.added++;
        } catch (e) { handle.failed.push(f.name); console.warn('Audio tidak dapat didekode:', f.name, e); }
      }
      if (handle.added) {
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
        await handle.ctx.resume();
        handle.sources.forEach((s) => s.start());
      }
    } catch (e) { console.warn('Audio dinonaktifkan:', e); }
    return handle;
  };

  /** Mulai merekam stream. Mengembalikan { chunks, stop() -> Promise<void> }. */
  enc.startRecorder = (stream, pick, bitsPerSecond) => {
    const opts = { videoBitsPerSecond: bitsPerSecond };
    if (pick.mime) opts.mimeType = pick.mime;
    let recorder;
    try { recorder = new MediaRecorder(stream, opts); } catch { recorder = new MediaRecorder(stream); }
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    let rejectFn;
    const failed = new Promise((_, rej) => { rejectFn = rej; });
    const stopped = new Promise((res) => { recorder.onstop = () => res(); });
    recorder.onerror = (e) => rejectFn(e.error || new Error('Perekam video gagal.'));
    recorder.start(500);
    return {
      chunks,
      mime: recorder.mimeType || pick.mime || 'video/webm',
      async stop() {
        if (recorder.state !== 'inactive') { try { recorder.requestData(); } catch {} recorder.stop(); }
        await Promise.race([stopped, failed]);
      },
      abort() { try { if (recorder.state !== 'inactive') recorder.stop(); } catch {} },
    };
  };

  /** Ubah hasil rekaman menjadi Blob final (+ konversi MP4 bila diminta dan perlu). */
  enc.finalize = async (rec, pick, onProgress) => {
    const baseType = (rec.mime || 'video/webm').split(';')[0];
    let blob = new Blob(rec.chunks, { type: baseType });
    let ext = baseType.includes('mp4') ? 'mp4' : 'webm';
    let note = '';
    if (pick.needsConvert) {
      try {
        onProgress(98, 'Mengonversi ke MP4…');
        blob = await enc.convertToMp4(blob, onProgress);
        ext = 'mp4';
      } catch (e) {
        console.warn('Konversi MP4 gagal:', e);
        note = 'Browser ini tidak bisa membuat MP4 langsung, jadi hasilnya disimpan sebagai WebM (bisa diputar di Chrome/Edge/Firefox/VLC). ' +
          'Untuk MP4: gunakan Chrome/Edge/Safari terbaru, atau jalankan lewat "node serve.js". Penyebab: ' + (e.message || e);
      }
    }
    return { blob, ext, note };
  };

  /* ---------- Cadangan: FFmpeg.wasm (butuh crossOriginIsolated / SharedArrayBuffer) ---------- */
  let ffmpeg = null, ffProgress = () => {};
  enc.convertToMp4 = async (webm, onProgress) => {
    if (typeof SharedArrayBuffer === 'undefined' || !window.crossOriginIsolated) {
      throw new Error('FFmpeg memerlukan header COOP/COEP (jalankan "node serve.js").');
    }
    if (!(await FF.libs.ffmpeg())) throw new Error('Library FFmpeg gagal dimuat.');
    ffProgress = (r) => onProgress(98, `Mengonversi MP4… ${Math.round(FF.clamp(r, 0, 1) * 100)}%`);
    if (!ffmpeg) {
      let corePath = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js';
      try {
        const local = new URL('vendor/ffmpeg/ffmpeg-core.js', document.baseURI).href;
        const r = await fetch(local, { method: 'HEAD' });
        if (r.ok) corePath = local; // core self-host (dibuat saat build) → tidak bergantung CDN
      } catch {}
      ffmpeg = window.FFmpeg.createFFmpeg({
        log: false,
        corePath,
        progress: ({ ratio }) => { if (Number.isFinite(ratio)) ffProgress(ratio); },
      });
    }
    if (!ffmpeg.isLoaded()) await ffmpeg.load();
    const inName = 'in.webm', outName = 'out.mp4';
    ffmpeg.FS('writeFile', inName, new Uint8Array(await webm.arrayBuffer()));
    await ffmpeg.run('-i', inName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outName);
    const out = ffmpeg.FS('readFile', outName);
    try { ffmpeg.FS('unlink', inName); ffmpeg.FS('unlink', outName); } catch {}
    return new Blob([out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)], { type: 'video/mp4' });
  };

  /** Jaga layar tetap menyala selama render (jika didukung). */
  enc.keepAwake = async () => {
    try { return (await navigator.wakeLock?.request('screen')) || null; } catch { return null; }
  };
})();
