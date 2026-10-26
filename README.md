# FrameForge — Media to Video (v2)

Ubah gambar, video, audio, dan **ZIP website** menjadi video **MP4** langsung di browser. Tanpa server backend — semua diproses di perangkat pengguna.

## Teknologi
HTML + CSS + JavaScript murni (tanpa framework). Rendering memakai API bawaan browser: Canvas, MediaRecorder, Web Audio, Screen Capture. Library (JSZip, html2canvas, FFmpeg.wasm) di-host sendiri lewat `npm run build`.

## Struktur folder
```
frameforge/
├─ public/                 ← yang dideploy ke Vercel
│  ├─ index.html
│  ├─ css/style.css
│  ├─ js/
│  │  ├─ utils.js          state, pemuat library, UI progres/hasil
│  │  ├─ encoder.js        MediaRecorder, audio, MP4 (native + FFmpeg)
│  │  ├─ media.js          klasifikasi file, aset, gambar ke kanvas
│  │  ├─ exporter.js       ekspor slideshow
│  │  ├─ site-zip.js       baca ZIP website, tulis ulang path aset
│  │  ├─ site-record.js    pratinjau + rekam website (Tab / Snapshot)
│  │  └─ main.js           penghubung UI
│  └─ vendor/              diisi otomatis saat build
├─ scripts/copy-vendor.js  salin library dari node_modules
├─ serve.js                server lokal dengan header COOP/COEP
├─ vercel.json             konfigurasi build + header
└─ package.json
```

## Deploy ke Vercel
1. Upload folder ini ke GitHub, lalu **Add New → Project** di Vercel dan pilih repo-nya. (Atau `npx vercel` dari folder ini.)
2. Biarkan pengaturan default — `vercel.json` sudah mengatur build (`npm run build`), output (`public`), dan header `COOP/COEP`.
3. Deploy. Selesai.

## Jalan lokal
```
npm install
npm run build
npm start        # http://localhost:5173
```
(Slideshow sederhana juga bisa dibuka langsung lewat `public/index.html`, tetapi fitur FFmpeg butuh `npm start`.)

## Cara MP4 dihasilkan
1. Browser yang mendukung MediaRecorder MP4 (Chrome/Edge 126+, Safari) → langsung H.264/AAC.
2. Selain itu → rekam WebM lalu dikonversi ke MP4 dengan FFmpeg.wasm (di-host sendiri, butuh header COOP/COEP yang sudah ada di `vercel.json`).
3. Jika keduanya tidak tersedia, hasil tetap diunduh sebagai WebM dengan penjelasan.

## Rekam website dari ZIP
- **Tab capture** (Chrome/Edge desktop): kualitas asli, pilih tab FrameForge ini saat diminta. Hanya area pratinjau yang direkam.
- **Snapshot** (semua browser & HP): memotret halaman berkala, FPS lebih rendah.
- ZIP tanpa HTML tetapi berisi gambar/video/audio otomatis dimasukkan ke daftar media.

## Batasan
- Suara dari klip video tidak ikut (hanya file audio yang dipilih).
- Jangan pindah tab / kunci layar saat render berjalan.
- Pratinjau ZIP menjalankan skrip project; unggah hanya project yang kamu percaya.
