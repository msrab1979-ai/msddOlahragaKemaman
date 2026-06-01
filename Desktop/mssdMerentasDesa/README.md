# Sistem Merentas Desa — MSSD Kemaman

Sistem pengurusan kejohanan merentas desa peringkat daerah Kemaman.

**Live:** https://mssdkemaman-merentasdesa.web.app  
**Firebase Project:** `mssdkemaman-merentasdesa`

---

## Halaman & Fungsi

| Halaman | URL | Pengguna |
|---|---|---|
| Laman Utama / Papan Keputusan | `/` | Awam |
| Admin Panel | `/admin/` | Admin |
| Pencatat Keputusan | `/pencatat/` | Pencatat / Admin |
| Pengurus Pasukan | `/pengurus/` | Pengurus Sekolah |
| Papan Individu | `/papan/individu.html` | Awam |
| Papan Pasukan | `/papan/pasukan.html` | Awam |
| Setup Awal DB | `/setup.html` | Admin (guna sekali sahaja) |

---

## Aliran Persediaan (ikut urutan)

1. **Tetapan Kejohanan** — nama, tarikh, lokasi, logo, tarikh tutup pendaftaran
2. **Kategori Larian** — SK L12, SK P12, SM L15, SM L18, dsb.
3. **Daftar Sekolah** — nama, jenis (SK/SM/PPKI), bib prefix, kod, PIN
4. **Pengguna Sistem** — akaun pencatat & admin tambahan
5. **Kongsi** kod sekolah + PIN kepada setiap pengurus pasukan

---

## Model Pengesahan

Sistem **tidak menggunakan Firebase Auth**. Semua login berasaskan `sessionStorage`.

| Peranan | Cara Login | Kunci Sesi |
|---|---|---|
| Admin / Pencatat | E-mel + Kata Laluan → semak koleksi `users` | `mssd_md_user` |
| Pengurus Pasukan | Kod Sekolah + PIN → semak koleksi `pasukan` | `mssd_md_pasukan` |

**Lupa PIN:** Pengurus boleh semak sendiri menggunakan Kod Sekolah + E-mel Sekolah.

---

## Koleksi Firestore

| Koleksi | Penerangan |
|---|---|
| `/settings/main` | Tetapan kejohanan, termasuk `tarikhTutupPendaftaran` |
| `/kategori/{id}` | Kategori larian — jenis, jantina, had daftar, kiraan pasukan |
| `/kumpulanLarian/{id}` | Kumpulan start serentak (pilihan) |
| `/pasukan/{kodSekolah}` | Sekolah peserta — doc ID = kodSekolah (huruf besar) |
| `/atlet/{id}` | Atlet berdaftar — noKPHash, noBib, pasukanId, kategoriId |
| `/keputusan/{id}` | Keputusan larian — kedudukan, masa, statusAtlet |
| `/publikasi/{kategoriId}` | Status terbit keputusan (draf/tidakRasmi/rasmi) |
| `/users/{docId}` | Akaun admin & pencatat |
| `/auditLog/{id}` | Log semua tindakan penting |

---

## Modul Pencatat

Pencatat merekod keputusan semasa larian berlangsung.

**Ciri utama:**
- Rekod 1 peserta setiap kali: No Bib → Kedudukan → Masa → Simpan
- Catatan khas: **DNS** (Tidak Mula) / **DNF** (Tidak Tamat) / **DQ** (Didiskualifikasi)
- **Penyemak Tally** — bandingkan jumlah berdaftar vs direkod, papar senarai belum direkod
- **Susun Semula by Masa** — atur semula kedudukan 1, 2, 3… tanpa lubang
- Sunting dalam baris (inline) tanpa modal

**Logik catatan:**
- DNS / DNF / DQ → kedudukan `null`, masa `null`
- Selepas Susun Semula → hanya rekod `selesai` diberi nombor, catatan kekal di bawah

---

## Modul Pengurus

Pengurus sekolah mendaftar atlet melalui halaman `/pengurus/`.

**Ciri utama:**
- Semak kuota per kategori secara masa nyata
- Pengesahan No KP (di-hash SHA-256, tidak disimpan teks asal)
- Pengesahan No Bib — semak duplikat global (semua atlet aktif)
- Upload Excel beramai-ramai
- Countdown tarikh tutup pendaftaran (tunjuk hari/jam/minit/saat)
- Selepas tarikh tutup — semua butang daftar dilumpuhkan

---

## Peraturan Firestore

Semua peraturan `if true` — tiada `request.auth` kerana Firebase Auth tidak digunakan.

```
auditLog: cipta = benar, kemaskini/padam = salah
users: padam = salah
```

---

## Format Keputusan (Rujukan MSSM Labuan 2026)

### Individu
`KED | BIB | NAMA | PASUKAN | MASA`

### Berpasukan
`KED | PASUKAN | MATA` + senarai atlet dikira (indent)

### Pungutan Mata
- SK: L12 + P12 (berasingan)
- SM: L15 + P15 + L18 + P18 (berasingan)

---

## Sistem Rekabentuk

- **Warna utama:** `green-900` (pengurus), `blue-900` (admin/pencatat)
- **Fon:** Bebas Neue + DM Sans + JetBrains Mono
- **Tailwind CSS** via CDN
- Mobile-first

---

## Deploy

```bash
firebase deploy --only hosting
```
