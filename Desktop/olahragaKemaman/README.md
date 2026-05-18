# KOAM — Sistem Pengurusan Kejohanan Olahraga MSSD Kemaman

Sistem pengurusan kejohanan olahraga sekolah (MSSD) berasaskan web, dibina dengan React + Firebase.

**Live:** https://mssdkemaman-olahraga.web.app

---

## Stack

- **Frontend:** React 19, Vite, Tailwind CSS
- **Backend:** Firebase Firestore, Firebase Hosting, Firebase Auth
- **PDF:** jsPDF + jsPDF-AutoTable, html2canvas
- **Excel:** SheetJS (xlsx)

---

## Modul Utama

| Modul | Path | Keterangan |
|---|---|---|
| Home | `/` | Papan pemuka awam — jadual, keputusan, rekod |
| Pendaftaran | `/daftar` | Login sekolah, daftar atlet, pilih acara |
| Pencatat | `/pencatat` | Input keputusan masa/jarak/markah |
| Dashboard Admin | `/dashboard` | Pengurusan penuh kejohanan |

### Dashboard Admin

| Menu | Path | Keterangan |
|---|---|---|
| Analisis Pendaftaran | `/dashboard/analisis` | Ringkasan acara & analisis sekolah |
| Acara Setup | `/dashboard/acara` | Urus senarai acara |
| Jadual Setup | `/dashboard/jadual` | Urus jadual pertandingan |
| Kategori Setup | `/dashboard/kategori` | Urus kategori atlet (SR/SM/PPKI) |
| Sekolah Setup | `/dashboard/sekolah` | Urus sekolah & PIN |
| Pendaftaran Setup | `/dashboard/pendaftaran` | Semak & urus pendaftaran atlet |
| Start List | `/dashboard/startlist` | Jana & cetak start list PDF |
| Input Keputusan | `/dashboard/keputusan` | Masuk & publish keputusan |
| Medal Tally | `/dashboard/medal` | Kedudukan pingat |
| Olahragawan | `/dashboard/olahragawan` | Rekod & PDF sijil/hadiah |
| Rekod | `/dashboard/rekod` | Urus rekod kejohanan |
| Buku Kejohanan | `/dashboard/buku` | Jana buku program PDF |
| Cetak Acara | `/dashboard/cetak-acara` | Cetak keputusan ikut acara |
| Tetapan Home | `/dashboard/tetapan` | Urus dokumen & pautan |
| User Management | `/dashboard/users` | Urus akaun pengguna |

---

## Struktur Firestore

```
kejohanan/{kejId}
  ├─ acara/{acaraId}         — senarai acara (noAcara, namaAcara, jantina, kategoriKod)
  ├─ pendaftaran/{noKP}      — rekod atlet (acaraIds[], kodSekolah, noBib, kategoriKod)
  ├─ keputusan/{acaraId}     — keputusan acara (tempat, masa/jarak, dll)
  └─ jadual/{jadualId}       — jadual pertandingan (hari, masa, gelanggang)

kategori/{kod}               — kategori atlet (jenisSekolah, label, urutan, hadAtlet)
sekolah/{kodSekolah}         — data sekolah (namaSekolah, kategori, bibPrefix, pin)
atlet/{noKP}                 — rekod atlet (nama, sekolah, kategoriKod)
rekod/{id}                   — rekod kejohanan (acara, masa/jarak, pemegang, tahun)
tetapan/home                 — tetapan papan pemuka awam
```

---

## Analisis Pendaftaran (`/dashboard/analisis`)

Dua pandangan:

1. **Ringkasan Acara** — baris = jenis acara, lajur = kategori atlet (L12, P12…), nilai = bilangan pendaftaran
2. **Analisis Sekolah** — baris = sekolah, lajur grouped = acara × sub-kategori, rumusan ✓/✗ ikut kelengkapan pendaftaran. Filter jenis sekolah dinamik dari Firestore.

---

## Develop Lokal

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run build && firebase deploy --only hosting
```
