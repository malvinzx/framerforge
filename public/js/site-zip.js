/* FrameForge — membaca ZIP website, menulis ulang path aset (blob URL), dan estimasi durasi */
(() => {
  const FF = window.FF;
  const zipper = (FF.siteZip = {});

  const MIME = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', txt: 'text/plain', xml: 'application/xml',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', glb: 'model/gltf-binary', gltf: 'model/gltf+json', wasm: 'application/wasm', vtt: 'text/vtt', srt: 'text/plain', webmanifest: 'application/manifest+json',
  };
  const extOf = (p) => ((p.split('.').pop() || '').toLowerCase());
  zipper.mimeOf = (p) => MIME[extOf(p)] || 'application/octet-stream';

  /* ---------- Helper path (murni, bisa diuji tanpa browser) ---------- */
  function normalizePath(path) {
    const stack = [];
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop(); else stack.push(part);
    }
    return stack.join('/');
  }
  function dirname(p) { return p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : ''; }
  /** Ubah referensi (relatif atau /root-absolut) menjadi path di dalam ZIP. null bila eksternal/anchor/data. */
  function resolveRef(fromFile, ref, root) {
    if (!ref) return null;
    ref = ref.trim();
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(ref)) return null;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) return null;
    let dec = clean; try { dec = decodeURI(clean); } catch {}
    return normalizePath(dec.startsWith('/') ? root + dec.slice(1) : dirname(fromFile) + dec);
  }
  zipper._normalizePath = normalizePath; zipper._resolveRef = resolveRef; zipper._shim = () => SHIM;

  async function replaceAsync(str, re, fn) {
    const parts = []; let last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(str))) { parts.push(str.slice(last, m.index)); parts.push(fn(...m)); last = m.index + m[0].length; if (m[0].length === 0) re.lastIndex++; }
    parts.push(str.slice(last));
    const done = await Promise.all(parts);
    return done.join('');
  }

  /* ---------- Representasi isi ZIP ---------- */
  async function openSite(file) {
    if (!(await FF.libs.jszip())) throw new Error('Library ZIP gagal dimuat. Periksa koneksi internet atau letakkan jszip.min.js di folder vendor/.');
    const zip = await JSZip.loadAsync(file);
    const entries = Object.keys(zip.files).filter((p) => !zip.files[p].dir && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(p));
    const lower = new Map(entries.map((p) => [p.toLowerCase(), p]));
    return { zip, entries, lower, urls: [], urlCache: new Map(), textCache: new Map(), root: '' };
  }
  const has = (site, p) => (p && (site.zip.files[p] ? p : site.lower.get(p.toLowerCase()))) || null;
  const find = (site, from, ref) => { const r = resolveRef(from, ref, site.root); return r ? has(site, r) : null; };
  async function text(site, p) {
    if (!site.textCache.has(p)) site.textCache.set(p, await site.zip.file(p).async('string'));
    return site.textCache.get(p);
  }
  async function blobUrl(site, p, override) {
    const key = override ? p + '\u0000' + override.key : p;
    if (site.urlCache.has(key)) return site.urlCache.get(key);
    const data = override ? override.text : await site.zip.file(p).async('arraybuffer');
    const url = URL.createObjectURL(new Blob([data], { type: zipper.mimeOf(p) }));
    site.urls.push(url); site.urlCache.set(key, url);
    return url;
  }

  /* ---------- CSS: inline @import dan tulis ulang url() ---------- */
  async function processCss(site, path, css, depth = 0) {
    const importRe = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*[^;]*;/gi;
    css = await replaceAsync(css, importRe, async (m, q1, u1, q2, u2) => {
      const t = find(site, path, u1 || u2);
      if (t && /\.css$/i.test(t) && depth < 6) return processCss(site, t, await text(site, t), depth + 1);
      return m;
    });
    return replaceAsync(css, /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, async (m, q, ref) => {
      if (/^data:/i.test(ref)) return m;
      const t = find(site, path, ref);
      return t ? `url("${await blobUrl(site, t)}")` : m;
    });
  }

  /* ---------- JS module: tulis ulang import lokal ---------- */
  const importRe = /((?:\bfrom|\bimport)\s*\(?\s*)(['"])([^'"\n]+)\2/g;
  async function rewriteImports(site, path, code, stack) {
    return replaceAsync(code, importRe, async (m, pre, q, spec) => {
      const t = find(site, path, spec);
      if (!t || stack.includes(t) || stack.length > 8) return m;
      return `${pre}${q}${await moduleUrl(site, t, stack.concat(path))}${q}`;
    });
  }
  async function moduleUrl(site, path, stack) {
    const code = await rewriteImports(site, path, await text(site, path), stack.concat(path));
    return blobUrl(site, path, { key: 'mod', text: code });
  }

  /* ---------- Shim: mengarahkan fetch/XHR/src relatif ke blob URL ---------- */
  const SHIM = `(function(){var MAP=__MAP__;
function fix(u){try{if(typeof u!=='string'||!u)return u;if(/^(?:[a-z][a-z0-9+.-]*:|\\/\\/|#)/i.test(u))return u;var c=u.split('#')[0].split('?')[0].replace(/^\\//,'');try{c=decodeURI(c)}catch(e){}var p=[],s=c.split('/');for(var i=0;i<s.length;i++){if(!s[i]||s[i]==='.')continue;if(s[i]==='..')p.pop();else p.push(s[i]);}c=p.join('/');return Object.prototype.hasOwnProperty.call(MAP,c)?MAP[c]:u}catch(e){return u}}
try{var of=window.fetch;if(of)window.fetch=function(i,n){if(typeof i==='string')i=fix(i);return of.call(this,i,n)}}catch(e){}
try{var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=fix(u);return oo.apply(this,arguments)}}catch(e){}
[[window.HTMLImageElement,'src'],[window.HTMLMediaElement,'src'],[window.HTMLSourceElement,'src'],[window.HTMLScriptElement,'src'],[window.HTMLLinkElement,'href'],[window.HTMLVideoElement,'poster']].forEach(function(x){try{var d=Object.getOwnPropertyDescriptor(x[0].prototype,x[1]);if(d&&d.set&&d.get)Object.defineProperty(x[0].prototype,x[1],{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,fix(v))}})}catch(e){}});
try{var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(typeof v==='string'&&/^(src|poster|data-src)$/i.test(n)||(typeof v==='string'&&/^href$/i.test(n)&&this.tagName!=='A'))v=fix(v);return sa.call(this,n,v)}}catch(e){}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h||h.charAt(0)==='#'||/^(javascript:|mailto:|tel:)/i.test(h))return;if(/^(?:[a-z][a-z0-9+.-]*:|\\/\\/)/i.test(h)){a.target='_blank';a.rel='noopener';return}e.preventDefault()},true);
})();`;

  /* ---------- Proses utama ---------- */
  /**
   * Hasil: { kind:'site', html, entry, count, urls, duration } atau { kind:'media', files:[File], count }
   */
  zipper.process = async (file) => {
    const site = await openSite(file);
    const htmlFiles = site.entries.filter((p) => /\.html?$/i.test(p));

    if (!htmlFiles.length) {
      // ZIP berisi kumpulan media → ekstrak gambar/video/audio ke daftar file
      const out = [];
      for (const p of site.entries) {
        if (!/\.(png|jpe?g|gif|webp|avif|bmp|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(p)) continue;
        const blob = await site.zip.file(p).async('blob');
        out.push(new File([blob], p.split('/').pop(), { type: zipper.mimeOf(p), lastModified: Date.now() }));
      }
      if (!out.length) throw new Error('ZIP ini tidak berisi file HTML maupun gambar/video/audio.');
      return { kind: 'media', files: out, count: site.entries.length };
    }

    htmlFiles.sort((a, b) => {
      const ia = /^index\.html?$/i.test(a.split('/').pop()) ? 0 : 1, ib = /^index\.html?$/i.test(b.split('/').pop()) ? 0 : 1;
      return ia - ib || a.split('/').length - b.split('/').length || a.localeCompare(b);
    });
    const entry = htmlFiles[0];
    site.root = dirname(entry);

    const doc = new DOMParser().parseFromString(await text(site, entry), 'text/html');
    doc.querySelectorAll('base').forEach((b) => b.remove());

    // Stylesheet & link lain
    for (const link of [...doc.querySelectorAll('link[href]')]) {
      const t = find(site, entry, link.getAttribute('href'));
      if (!t) continue;
      const rel = (link.getAttribute('rel') || '').toLowerCase();
      if (rel.includes('stylesheet')) {
        const css = await processCss(site, t, await text(site, t));
        link.setAttribute('href', await blobUrl(site, t, { key: 'css', text: css }));
        link.removeAttribute('integrity');
      } else link.setAttribute('href', await blobUrl(site, t));
    }
    for (const st of doc.querySelectorAll('style')) st.textContent = await processCss(site, entry, st.textContent);

    // Script
    for (const sc of [...doc.querySelectorAll('script')]) {
      const src = sc.getAttribute('src'), type = (sc.getAttribute('type') || '').toLowerCase();
      if (src) {
        const t = find(site, entry, src);
        if (!t) continue;
        sc.removeAttribute('integrity');
        sc.setAttribute('src', type === 'module' ? await moduleUrl(site, t, []) : await blobUrl(site, t));
      } else if (type === 'module') {
        sc.textContent = await rewriteImports(site, entry, sc.textContent, [entry]);
      }
    }

    // Atribut aset lain
    const simple = ['src', 'poster', 'data-src', 'data-poster'];
    for (const el of [...doc.querySelectorAll('[src],[poster],[data-src],[data-poster]')]) {
      if (el.tagName === 'SCRIPT') continue;
      for (const attr of simple) {
        const v = el.getAttribute(attr); if (!v) continue;
        const t = find(site, entry, v); if (t) el.setAttribute(attr, await blobUrl(site, t));
      }
    }
    for (const el of [...doc.querySelectorAll('image[href],use[href]')]) {
      const t = find(site, entry, el.getAttribute('href')); if (t) el.setAttribute('href', await blobUrl(site, t));
    }
    for (const el of [...doc.querySelectorAll('[srcset]')]) {
      const parts = await Promise.all(el.getAttribute('srcset').split(',').map(async (c) => {
        const [u, ...rest] = c.trim().split(/\s+/); const t = find(site, entry, u);
        return (t ? await blobUrl(site, t) : u) + (rest.length ? ' ' + rest.join(' ') : '');
      }));
      el.setAttribute('srcset', parts.join(', '));
    }
    for (const el of [...doc.querySelectorAll('[style*="url("]')]) el.setAttribute('style', await processCss(site, entry, el.getAttribute('style')));

    // Peta path → blob URL untuk fetch()/XHR/src dinamis (relatif terhadap folder index)
    const map = {};
    for (const p of site.entries) {
      if (/\.html?$/i.test(p) || !p.startsWith(site.root)) continue;
      map[p.slice(site.root.length)] = await blobUrl(site, p);
    }
    if (!doc.querySelector('meta[charset]')) { const m = doc.createElement('meta'); m.setAttribute('charset', 'utf-8'); doc.head.prepend(m); }
    const shim = doc.createElement('script');
    shim.textContent = SHIM.replace('__MAP__', JSON.stringify(map).replace(/<\//g, '<\\/'));
    doc.head.prepend(shim);
    doc.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });

    const html = '<!doctype html>\n' + doc.documentElement.outerHTML;
    return { kind: 'site', html, entry, count: site.entries.length, urls: site.urls, duration: await estimateDuration(site, entry, doc) };
  };

  /* ---------- Estimasi durasi (heuristik, 8–60 detik) ---------- */
  async function estimateDuration(site, entry, doc) {
    let css = '', js = '', assets = 0;
    for (const p of site.entries) {
      const e = extOf(p);
      if (e === 'css') css += '\n' + (await text(site, p).catch(() => ''));
      else if (e === 'js' || e === 'mjs') js += '\n' + (await text(site, p).catch(() => ''));
      else if (/^(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|mp3|wav|ogg)$/.test(e)) assets++;
    }
    doc.querySelectorAll('style').forEach((s) => { css += '\n' + s.textContent; });
    const all = css + '\n' + js;
    let maxMs = 0, m;
    const re = /(\d*\.?\d+)\s*(ms|s)\b/gi;
    while ((m = re.exec(css))) { const v = Number(m[1]) * (m[2].toLowerCase() === 's' ? 1000 : 1); if (Number.isFinite(v) && v <= 20000) maxMs = Math.max(maxMs, v); }
    const hasMotion = /requestAnimationFrame|gsap\.|ScrollTrigger|anime\(|motion\.|animate\(|transition|@keyframes/i.test(all);
    const words = (doc.body ? doc.body.textContent.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length : 0);
    const reading = Math.min(24, Math.max(4, words / 3.2));
    const visual = Math.min(16, Math.max(3, assets * 1.1));
    const motion = hasMotion ? Math.min(14, Math.max(4, maxMs / 1000 || 6)) : 2;
    const complexity = Math.min(10, doc.documentElement.outerHTML.length / 9000 + all.length / 16000);
    return Math.round(FF.clamp(reading * 0.55 + visual * 0.65 + motion + complexity, 8, 60));
  }
})();
