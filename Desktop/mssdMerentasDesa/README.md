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

1. **Tetapan Kejohanan** — nama (namaB1/B2/B3), tarikh, lokasi, logo, tarikh tutup pendaftaran
2. **Kategori Larian** — SK L12, SK P12, SM L15, SM L18, dsb. (termasuk umurMin, umurMax, kiraanPasukan, minLayak)
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
| `/settings/main` | Tetapan kejohanan: nama (namaB1/B2/B3), logo, tarikh, tarikhTutupPendaftaran |
| `/kategori/{id}` | Kategori larian — jenis, jantina, umurMin/Max, hadDaftar, kiraanPasukan, minLayak |
| `/kumpulanLarian/{id}` | Kumpulan start serentak (pilihan) |
| `/pasukan/{kodSekolah}` | Sekolah peserta — doc ID = kodSekolah (huruf besar) |
| `/atlet/{id}` | Atlet berdaftar — noKPHash, noBib, pasukanId, kategoriId, aktif |
| `/keputusan/{id}` | Keputusan larian — kedudukan, masa, statusAtlet |
| `/publikasi/{kategoriId}` | Status terbit keputusan (draf/tidakRasmi/rasmi) |
| `/users/{docId}` | Akaun admin & pencatat |
| `/auditLog/{id}` | Log semua tindakan penting |

---

## Modul Pencatat

Pencatat merekod keputusan semasa larian berlangsung.

**Ciri utama:**
- Input fleksibel: Bib (wajib) + Masa (pilihan) + Kedudukan (auto jika kosong)
- **Optimistik UI** — rekod papar serta-merta, Firestore simpan di latar belakang
- **onSnapshot masa nyata** — 2 peranti boleh guna serentak (1 masuk Bib, 1 isi masa)
- Sel masa kosong ditonjolkan kuning — klik terus untuk isi masa
- Catatan khas: **DNS** / **DNF** / **DQ**
- **Penyemak Tally** — bandingkan jumlah berdaftar vs direkod
- **Susun Semula by Masa** — atur semula kedudukan tanpa lubang
- Bib disekat jika sudah direkod (butang Simpan digreyed)
- Sunting dalam baris (inline) tanpa modal

**Cetakan (butang dalam navbar):**
- 📄 **Cetak Individu** — KED | BIB | NAMA | PASUKAN | MASA, DNS/DNF/DQ di bawah
- 🏫 **Cetak Pasukan** — KED | PASUKAN | MATA + senarai atlet dikira (BIB | NAMA | KED.IND) + baris jumlah
- Header dinamik: ambil namaB1/B2/B3, logo, tarikh dari `/settings/main`

**Logik catatan:**
- DNS / DNF / DQ → kedudukan `null`, masa `null`, tidak dikira dalam pasukan
- DQ → dibuang sepenuhnya dari pengiraan mata pasukan

---

## Modul Pengurus

Pengurus sekolah mendaftar atlet melalui halaman `/pengurus/`.

**Ciri utama:**
- Semak kuota per kategori secara masa nyata
- **Semak umur dari No KP** — ekstrak tahun lahir, kira umur = tahunKejohanan - tahunLahir
  - Live feedback semasa taip (hijau = layak, merah = diluar had)
  - Sekat simpan jika umur diluar `umurMin`–`umurMax` kategori
- **Semak KP duplikat global** — semua kategori, bukan hanya kategori semasa
- **Semak Bib duplikat global** — semua kategori, luar transaction
- Upload Excel beramai-ramai (semak umur + KP dalam batch)
- Countdown tarikh tutup pendaftaran (warna berubah hijau→kuning→merah)
- Selepas tarikh tutup — semua butang daftar dilumpuhkan

---

## Pungutan Mata Pasukan

| Perkara | Nilai |
|---|---|
| Atlet dikira | `kiraanPasukan` terbaik (terendah kedudukan) |
| Mata pasukan | jumlah kedudukan individu atlet dikira |
| Syarat layak | ≥ `minLayak` atlet selesai |
| DQ | tidak dikira |
| DNS / DNF | tidak dikira |
| Pasukan DNQ | dipapar di bawah dengan sebab |

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
`KED | PASUKAN | MATA` + senarai atlet dikira (BIB | NAMA | KED.IND) + baris jumlah

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
