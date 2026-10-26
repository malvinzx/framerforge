/* FrameForge — ekspor slideshow (gambar + video + audio) menjadi video */
(() => {
  const FF = window.FF, { $, wait } = FF;
  const S = FF.state, M = FF.media, ui = FF.ui;

  /** Kunci/lepas kontrol saat proses render berjalan. */
  FF.setBusy = (busy) => {
    S.busy = busy;
    document.querySelectorAll('.editor-panel select, .editor-panel input, .source-panel button, .source-panel input, #exportBtn, #recordSiteBtn')
      .forEach((el) => { el.disabled = busy; });
    if (!busy) {
      M.updateEstimate();
      $('recordSiteBtn').disabled = !(FF.website && FF.website.isReady());
    }
  };

  async function exportVideo() {
    const visual = S.assets.filter(M.isVisual);
    if (!visual.length || S.busy) return;
    if (!window.MediaRecorder || !M.canvas.captureStream) {
      ui.showError('Browser tidak didukung', 'Browser ini belum mendukung perekaman video dari kanvas. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru.');
      return;
    }
    S.cancelled = false;
    FF.setBusy(true);
    ui.showProgress(true); ui.hideResult(); ui.setProgress(0, 'Menyiapkan video…');
    const lock = await FF.encoder.keepAwake();
    let audio = null, stream = null;
    try {
      const fps = Number($('fps').value) || 30;
      const perImage = FF.clamp(Number($('imageDuration').value) || 4, 1, 60);
      const durationOf = (a) => (a.type === 'image' ? perImage : FF.clamp(Number.isFinite(a.el.duration) ? a.el.duration : 8, 1, 120));
      const total = visual.reduce((s, a) => s + durationOf(a), 0);
      const transition = $('transition').value;
      const { w, h } = M.getDimensions();

      M.drawBackground();
      stream = M.canvas.captureStream(fps);
      const audioFiles = $('audioMode').value === 'mute' ? [] : S.assets.filter((a) => a.type === 'audio').map((a) => a.file);
      audio = await FF.encoder.addAudio(stream, audioFiles);

      const pick = FF.encoder.pickFormat($('format').value);
      const bps = Math.round(w * h * fps * 0.12); // ± bitrate adaptif terhadap resolusi
      const rec = FF.encoder.startRecorder(stream, pick, FF.clamp(bps, 1_500_000, 12_000_000));

      let elapsed = 0;
      for (let i = 0; i < visual.length && !S.cancelled; i++) {
        const a = visual[i], dur = durationOf(a), el = a.el;
        if (a.type === 'video') {
          try { el.currentTime = 0; await new Promise((res) => { el.onseeked = res; setTimeout(res, 600); }); } catch {}
          el.muted = true; el.loop = true;
          try { await el.play(); } catch {}
        }
        const start = performance.now();
        while (!S.cancelled && performance.now() - start < dur * 1000) {
          const t = (performance.now() - start) / 1000;
          M.drawBackground();
          if (transition === 'fade' && t < 0.45) M.drawAsset(a, t / 0.45);
          else if (transition === 'zoom' && t < 0.45) {
            const k = 0.92 + (0.08 * t) / 0.45;
            M.ctx.save(); M.ctx.translate(w / 2, h / 2); M.ctx.scale(k, k); M.ctx.translate(-w / 2, -h / 2);
            M.drawAsset(a, Math.min(1, t / 0.2)); M.ctx.restore();
          } else M.drawAsset(a, 1);
          ui.setProgress(Math.min(97, ((elapsed + t) / total) * 97), `Scene ${i + 1} dari ${visual.length}`);
          await wait(Math.max(4, 1000 / fps - 4));
        }
        if (a.type === 'video') { el.pause(); try { el.currentTime = 0; } catch {} }
        elapsed += dur;
      }

      if (S.cancelled) { rec.abort(); ui.setProgress(0, 'Ekspor dibatalkan.'); return; }
      ui.setProgress(97, 'Menyelesaikan file video…');
      await wait(300);
      await rec.stop();
      const out = await FF.encoder.finalize(rec, pick, ui.setProgress);
      let note = out.note;
      if (audio.failed.length) note += `${note ? ' ' : ''}Audio tidak bisa dibaca dan dilewati: ${audio.failed.join(', ')}.`;
      ui.showResult({ blob: out.blob, ext: out.ext, info: `${w} × ${h} px · ${fps} FPS`, note });
      ui.setProgress(100, 'Selesai!');
    } catch (err) {
      console.error(err);
      ui.setProgress(0, 'Ekspor gagal.');
      ui.showError('Ekspor belum berhasil', `${err.message || 'Terjadi kesalahan saat membuat video.'} Coba kurangi resolusi atau gunakan Chrome terbaru.`);
    } finally {
      if (audio) audio.stop();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (lock) lock.release().catch(() => {});
      FF.setBusy(false);
      M.redrawPreview();
    }
  }
  FF.exportVideo = exportVideo;
})();
