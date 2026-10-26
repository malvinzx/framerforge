/* FrameForge — penghubung UI: upload, daftar file, pengaturan, tombol */
(() => {
  const FF = window.FF, { $, esc, fmtBytes } = FF;
  const S = FF.state, M = FF.media, ui = FF.ui;
  const input = $('fileInput'), list = $('fileList'), drop = $('dropzone');
  const iconFor = (t) => ({ image: '▧', video: '▷', audio: '♫', text: '≡', zip: 'ZIP', other: '⌁' }[t] || '⌁');
  const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

  function renderFiles() {
    $('fileCount').textContent = S.files.length ? `${S.files.length} file dipilih` : 'Belum ada file';
    if (!S.files.length) { list.innerHTML = '<div class="empty-files"><span>▧</span><p>File yang kamu pilih akan muncul di sini.</p></div>'; return; }
    list.innerHTML = S.files.map((f, i) => {
      const t = M.typeOf(f);
      return `<div class="file-item"><span class="file-icon ${t}">${iconFor(t)}</span><div class="file-meta"><div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-size">${fmtBytes(f.size)} · ${t}</div></div><button class="remove-file" data-remove="${i}" aria-label="Hapus ${esc(f.name)}" title="Hapus file">×</button></div>`;
    }).join('');
    list.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => removeFile(Number(b.dataset.remove))));
  }

  function syncSiteWithFiles() {
    if (!S.files.some((f) => M.typeOf(f) === 'zip')) FF.website.reset();
  }
  async function refresh() { renderFiles(); await M.buildAssets(); M.updateEstimate(); }

  function removeFile(i) { if (S.busy) return; S.files.splice(i, 1); syncSiteWithFiles(); refresh(); }

  async function addFiles(incoming) {
    if (S.busy) { ui.setMessage('Tunggu proses render selesai sebelum menambah file.'); return; }
    const all = [...incoming];
    const accepted = all.filter((f) => M.typeOf(f) !== 'other');
    const skipped = all.length - accepted.length;
    for (const f of accepted) if (!S.files.some((x) => sameFile(x, f))) S.files.push(f);
    await refresh();
    const zipFile = [...accepted].reverse().find((f) => M.typeOf(f) === 'zip');
    if (zipFile) {
      const extra = await FF.website.loadZip(zipFile);
      if (extra.length) { for (const f of extra) if (!S.files.some((x) => sameFile(x, f))) S.files.push(f); await refresh(); }
    }
    if (skipped) ui.setMessage(`${skipped} file yang formatnya tidak didukung dilewati.`);
  }

  /* ----- Upload ----- */
  const uploadAccept = {
    all: '',
    video: 'video/*,.mp4,.webm,.mov,.m4v,.ogv',
    image: 'image/*,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg',
    audio: 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus',
    text: '.txt,.md,.json,.xml,.html,.htm,.css,.js,.mjs,.ts,.tsx,.jsx,.py,.php,.java,.c,.cpp,.h,.yml,.yaml,.toml,.ini,.log,.csv,.srt,.vtt',
    zip: '.zip,application/zip',
  };
  document.querySelectorAll('[data-upload-kind]').forEach((btn) => btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    document.querySelectorAll('[data-upload-kind]').forEach((b) => b.classList.toggle('active', b === btn));
    const acc = uploadAccept[btn.dataset.uploadKind];
    if (acc) input.setAttribute('accept', acc); else input.removeAttribute('accept');
    input.click();
  }));
  input.addEventListener('change', (e) => { addFiles(e.target.files); input.value = ''; });
  $('clearFiles').addEventListener('click', () => { if (S.busy) return; S.files = []; FF.website.reset(); refresh(); });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  /* ----- Pengaturan ----- */
  ['ratio', 'resolution', 'fit', 'titleText', 'accent', 'showFilename'].forEach((id) => $(id).addEventListener('input', () => {
    if (id === 'ratio' || id === 'resolution') M.setCanvasSize(); else M.redrawPreview();
    if (id === 'ratio') FF.website.layout();
    $('accentValue').textContent = $('accent').value.toUpperCase();
  }));
  ['imageDuration', 'fps', 'transition', 'audioMode', 'format'].forEach((id) => $(id).addEventListener('change', M.updateEstimate));
  $('exportBtn').addEventListener('click', () => FF.exportVideo());
  $('recordSiteBtn').addEventListener('click', () => FF.website.record());
  $('cancelBtn').addEventListener('click', () => { S.cancelled = true; });

  /* ----- Mode rekam: default Tab di desktop, Snapshot di HP/browser tanpa getDisplayMedia ----- */
  const canTab = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const modeSel = $('siteMode');
  if (!canTab) { modeSel.value = 'snapshot'; modeSel.querySelector('option[value="tab"]').disabled = true; }

  M.setCanvasSize(); renderFiles(); M.updateEstimate();
})();
