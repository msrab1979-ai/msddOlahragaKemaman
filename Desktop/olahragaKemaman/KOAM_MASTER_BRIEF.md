# KOAM — Master Brief & Design Decisions
> Simpan dalam VSCode project root. Setiap sesi baru: "Baca KOAM_MASTER_BRIEF.md, sambung dari status semasa."

---

## 1. PROJECT OVERVIEW

**Nama:** Sistem Statistik Pengurusan Kejohanan Olahraga (KOAM Level Kebangsaan)
**Platform:** React + Firebase Web Apps
**Style:** Government style — clean, fast load, sharp
**Responsive:** Mobile / Tablet / Laptop / Skrin Stadium
**Long term:** Scalable, dinamik, multi-kejohanan
**PDF:** jsPDF + AutoTable (laporan) | CSS @media print (sijil)
**Firebase Project:** mssdkemaman-olahraga
**Auth Domain:** mssdkemaman-olahraga.firebaseapp.com

---

## 2. FIREBASE CONFIG (dari SDK)

```js
const firebaseConfig = {
  apiKey: "AIzaSyDLgrBGDgzuwlCw61R3_XzQH_B9XFNGHzA",
  authDomain: "mssdkemaman-olahraga.firebaseapp.com",
  projectId: "mssdkemaman-olahraga",
  storageBucket: "mssdkemaman-olahraga.firebasestorage.app",
  messagingSenderId: "1021868021960",
  appId: "1:1021868021960:web:f761065d822d025f59edfd"
}
```
> JANGAN commit .env ke GitHub. Simpan dalam .env.local

---

## 3. TECH STACK

```
Frontend   : React 18 + Vite + Tailwind CSS
Backend    : Firebase Firestore + Auth + Functions + Storage
PDF        : jsPDF + jspdf-autotable | CSS @media print
Hosting    : Firebase Hosting
State      : React Context + useReducer (bukan Redux — jimat)
Router     : React Router v6
```

---

## 4. ROLES & KEBENARAN

| Role | Kebenaran |
|---|---|
| superadmin | Semua akses — buat kejohanan, urus semua user, sahkan rekod, batal acara |
| admin | Daftar atlet sekolah sendiri, semak keputusan, hantar bantahan |
| pencatat | Input keputusan semua acara (assign by superadmin per kejohanan) |
| pengurus_teknik | Semak rekod, sahkan wind reading, approve rekod baru |
| viewer | Paparan awam — lihat keputusan, medal tally, rekod |

> pengurus_teknik — BARU. Penting untuk KOAM kebangsaan. Orang berbeza dari superadmin yang sahkan rekod teknikal.

---

## 5. FIRESTORE — NAMING CONVENTION

```
Collection : huruf_kecil_underscore     cth: mata_olahragawan
Field      : camelCase                  cth: kodSekolah, noKP
ID Prefix  : 3 HURUF + dash             cth: KPT- RKD- BTH- ACR-
Timestamp  : Firestore Timestamp        cth: createdAt, updatedAt
Boolean    : prefix is/has              cth: isAktif, hasBantahan, isWindLegal
Enum       : string konstant            cth: 'tidak_rasmi' | 'rasmi'
```

---

## 6. FIRESTORE COLLECTIONS & KEYS

| Collection | Primary Key | Format | Auto? | Catatan |
|---|---|---|---|---|
| sekolah | kodSekolah | TBB2024 | Manual | Admin set bebas |
| atlet | noKP | 990112-11-1234 | Manual | Master identity — TIDAK BERUBAH |
| users | uid | Firebase Auth UUID | Auto | — |
| kejohanan | kejohananId | KOAM-2024-xxxx | Auto | — |
| → acara | aceraId | ACR-100M-L-SR | Auto | Sub-collection |
| → → heat | heatId | ACR-100M-L-SR-H1 | Auto | Sub-collection |
| → → → keputusan | keputusanId | KPT-bib-aceraId | Auto | Sub-collection |
| → pendaftaran | noBib | TBB001 | Auto | Reset setiap kejohanan |
| → relay_pasukan | relayId | RLY-4x100-SR-L | Auto | BARU |
| rekod | rekodId | RKD-100M-L-SR-N | Auto | N=Negeri D=Daerah K=Kebangsaan |
| rekod_sejarah | sejarahId | UUID | Auto | Audit trail rekod lama |
| bantahan | bantahanId | BTH-timestamp-uid | Auto | — |
| mata_olahragawan | noKP_kejohananId | composite | Auto | — |
| jadual_acara | jadualId | JDL-yyyymmdd-HHmm | Auto | BARU — time schedule |
| notifikasi | notifId | UUID | Auto | BARU — in-app notification |
| audit_log | logId | UUID | Auto | BARU — semua perubahan |

### Peraturan Utama
```
noKP     = TIDAK PERNAH berubah (master identity seumur hidup)
noBib    = RESET setiap kejohanan (unik dalam kejohanan sahaja)
aceraId  = bawa metadata penuh → ACR-[acara]-[L/P]-[kategori]
Composite pendaftaran key: {kejohananId}_{noBib}
```

---

## 7. FIELDS PENTING — ATLET

```js
atlet/{noKP} = {
  noKP,           // PK — MyKad format
  nama,
  jantina,        // L | P
  tarikhLahir,    // untuk auto-kira kategori umur
  warganegara,    // MY | antarabangsa
  kodSekolah,     // FK
  kategoriSekolah,// SR | SM | PPKI
  negeri,
  daerah,
  isAktif,
  createdAt,
  updatedAt,
  // BARU:
  noPassport,     // jika antarabangsa
  namaSekolahSemasa, // jika pindah sekolah
  sejarahSekolah, // [{kodSekolah, dari, hingga}] — audit pindah sekolah
}
```

---

## 8. FIELDS PENTING — ACARA

```js
acara/{aceraId} = {
  aceraId,
  namaAcara,          // "100m Lelaki Sekolah Rendah"
  kodAcara,           // "100M-L-SR"
  jenisAcara,         // lorong | mass_start | padang
  kategori,           // SR | SM | PPKI | gabungan
  jantina,            // L | P | campuran
  unitUkuran,         // s (masa) | m (jarak/tinggi) | mata
  adaLorong,          // true | false
  bilanganLorong,     // 8
  adaHeat,            // auto: jika peserta > lorong
  caraPilihFinal,     // best_time | best_heat | hybrid
  bilanganFinalis,    // 8
  bilanganCubaan,     // 3 | 6 (padang)
  wildcardSlot,       // 2 (hybrid)
  minPeserta,         // 3
  minPesertaLorong,   // 5
  statusAcara,        // cukup|amaran|kritikal|batal|digabung|tangguh
  digabungDengan,     // aceraId[] — jika gabung kategori
  catatanAdmin,       // sebab tangguh/batal
  isRelay,            // false (default)
  // BARU:
  hadAkletPerSekolah, // 2 (max atlet sama sekolah dalam 1 acara)
  isWindReading,      // true — jika acara perlu catat angin
  jadualId,           // FK → jadual_acara
  tarikhAcara,
  masaMula,
  masaAkhir,
}
```

---

## 9. JENIS ACARA

| Jenis | Contoh | Lorong | Heat | Cara Rank |
|---|---|---|---|---|
| A — Lorong | 100m 200m 400m | 1–8 | Ada | Masa terpantas |
| B — Mass Start | 800m 1500m 3000m 5000m | Tiada | Jika >12 | Masa terpantas |
| C — Padang Melompat | Lompat jauh, tinggi, kijang | Giliran | Tiada | Jarak/tinggi terbaik |
| D — Padang Membaling | Peluru, cakera, lembing, tukul | Giliran | Tiada | Jarak terbaik |
| E — Relay | 4x100m 4x400m | Lorong | Ada | Masa pasukan |

> Relay (E) — BARU. Logik berbeza: pasukan bukan individu, pingat untuk sekolah.

---

## 10. CARA PILIH FINALIS

| Cara | Logik | Guna Untuk |
|---|---|---|
| best_time | Rank semua masa gabungan, top N masuk | Larian biasa |
| best_heat | Top N dari setiap heat | Jika heat seimbang |
| hybrid | Top 1 setiap heat + baki best time | STANDARD KOAM kebangsaan |

---

## 11. STATUS ATLET DALAM ACARA

```
DNS  — Did Not Start        (dipanggil, tidak muncul)
DNF  — Did Not Finish       (keluar pertengahan larian)
DQ   — Disqualified         (salah lorong / halangan / doping)
NM   — No Mark              (padang: cubaan tidak sah — jejak papan)
FS   — False Start          (restart heat, atlet ke-2 FS = DQ)
WO   — Walk Over            (lawan tidak hadir — kemenangan auto)
ELI  — Eliminated           (tidak layak dari heat ke final)
```

---

## 12. ALIRAN KEPUTUSAN RASMI

```
Pencatat input → TIDAK RASMI → paparan awam ada label jelas
  ↓
Countdown bantahan mula (admin set: 30min / 1j / 2j)
  ↓
Jika ada bantahan → status: DALAM_BANTAHAN
  → Admin sekolah hantar sebab
  → Superadmin / pengurus_teknik semak
  → Terima: pencatat input semula → countdown mula semula
  → Tolak: keputusan asal kekal → countdown sambung
  ↓
Countdown = 0 + tiada bantahan aktif → AUTO RASMI → LOCK
  ↓
Trigger auto selepas RASMI:
  ① Semak prestasi vs rekod semasa (daerah/negeri/kebangsaan)
  ② Jika pecah rekod → flag → notifikasi pengurus_teknik
  ③ Kira mata olahragawan (kecuali relay)
  ④ Update medal tally sekolah
  ⑤ Update ranking sekolah
  ⑥ Notifikasi admin sekolah
  ⑦ PDF keputusan rasmi sedia
```

---

## 13. SISTEM REKOD

### Peringkat
```
D — Daerah
N — Negeri  
K — Kebangsaan
```

### Fields Rekod
```js
rekod/{rekodId} = {
  aceraId, namaAcara, kategori, jantina,
  peringkat,        // D | N | K
  noKP,             // FK atlet
  namaAtlet,
  kodSekolah,
  prestasi,         // nilai (masa/jarak/mata)
  unit,             // s | m | mata
  isWindLegal,      // true jika angin ≤ 2.0m/s
  windSpeed,        // nilai angin (m/s)
  jenisRekod,       // elektronik | manual
  statusRekod,      // aktif | dipecah | pending_doping | ditarik
  kejohananId,
  tarikhRekod,
  lokasi,
  disahkanOleh,     // uid pengurus_teknik
  // BARU:
  isRekodDunia,     // false (tapi simpan jika berlaku)
  catatanKhas,      // nota pengurus teknik
}
```

### Trigger Rekod
```
Input keputusan → bandingkan dengan rekod semasa
Jika lebih baik:
  → flag isPecahRekod: true
  → notifikasi pengurus_teknik
  → pengurus_teknik sahkan (semak wind, kelayakan atlet)
  → jika sah: rekod lama status → 'dipecah', simpan rekod_sejarah
  → jika tidak sah: flag ditolak + sebab
```

---

## 14. SISTEM OLAHRAGAWAN & OLAHRAGAWATI

```
Mata:     Emas=5  Perak=3  Gangsa=2  Tempat4=1
Tiebreak: Bilangan Emas → Perak → Gangsa → nama (abjad)
Ranking:  L (Olahragawan) dan P (Olahragawati) berasingan
Relay:    Pingat untuk SEKOLAH — tiada mata individu
DQ semua: Mata gugur semua acara dalam kejohanan tersebut
```

---

## 15. MEDAL TALLY

```
Update:   Auto selepas RASMI
Cascade:  Pingat ditarik → auto recalculate semua tally
Relay:    Kira sekolah sahaja — tiada mata olahragawan
Batal:    Acara batal → auto tolak dari tally
Ranking:  Emas → Perak → Gangsa → jumlah pingat (tiebreak)
```

---

## 16. SITUASI KHAS — WAJIB HANDLE

### Pendaftaran
```
✦ Konflik jadual: atlet daftar 2 acara masa bertindih → sistem warn + block
✦ Had atlet per sekolah: max N (admin set) dalam 1 acara
✦ Relay: 4 atlet + 2 ganti, boleh tukar ahli sebelum acara (log perubahan)
✦ Atlet pindah sekolah: simpan sejarahSekolah[], pingat ikut sekolah semasa
✦ Atlet antarabangsa: guna noPassport, tidak layak rekod kebangsaan
✦ Sijil kesihatan: field isLulusKesihatan (optional — admin toggle)
```

### Semasa Pertandingan
```
✦ False start ke-2: auto DQ atlet tersebut
✦ Wind reading: wajib input sebelum keputusan boleh jadi rasmi (jika isWindReading)
✦ Masa sama (tie): rank sama — tunjuk "=" dalam keputusan, foto finish flag
✦ Tangguh acara: simpan sebab + masa tangguh + masa sambung semula
✦ Acara dibatal terus: semua keputusan void, medal tally auto adjust
✦ Walk-over: kemenangan auto jika lawan DNS — admin confirm
```

### Rekod
```
✦ Wind legal: rekod hanya sah jika angin ≤ 2.0m/s (larian lurus sahaja)
✦ Rekod manual vs elektronik: simpan jenis — rekod manual ada asterisk (*)
✦ Rekod pending: tunggu keputusan anti-doping (boleh ambil masa berbulan)
✦ Rekod ditarik: cascade — rekod sebelumnya naik semula jadi rekod aktif
```

### Relay (BARU)
```
✦ Daftar pasukan: 4 atlet utama + 2 ganti, semua noKP disimpan
✦ Tukar ahli: boleh sebelum acara bermula — log siapa tukar siapa
✦ Pingat: untuk sekolah — tiada mata olahragawan individu
✦ Rekod relay: disimpan atas nama sekolah bukan individu
✦ DQ relay: jika satu ahli DQ → seluruh pasukan DQ
```

---

## 17. JADUAL ACARA (BARU)

```js
jadual_acara/{jadualId} = {
  kejohananId,
  aceraId,
  tarikhAcara,      // "2024-04-15"
  masaMula,         // "08:00"
  masaJangka,       // minit (jangkaan tempoh)
  lokasi,           // "Trek Utama" | "Padang A" | "Padang B"
  statusJadual,     // aktif | tangguh | selesai | batal
  sebabTangguh,
  masaTangguhSemula,
}
```

> Sistem semak konflik jadual: jika atlet ada 2 acara masa bertindih → warn admin.

---

## 18. AUDIT LOG (BARU — KRITIKAL)

```js
audit_log/{logId} = {
  masa,             // Firestore Timestamp
  uid,              // siapa buat perubahan
  role,             // role masa perubahan
  aksi,             // 'ubah_keputusan' | 'batal_acara' | 'tarik_rekod' dll
  collection,       // collection yang diubah
  docId,            // ID dokumen yang diubah
  nilaiLama,        // {} — data sebelum
  nilaiBaru,        // {} — data selepas
  sebab,            // wajib isi jika ubah data rasmi
}
```

> KRITIKAL — semua perubahan pada data rasmi MESTI ada audit log. Penting untuk akauntabiliti KOAM kebangsaan.

---

## 19. NOTIFIKASI (BARU)

```
Trigger notifikasi kepada:
  superadmin    : rekod baru, bantahan baru, acara kritikal
  pengurus_teknik: rekod perlu disahkan, wind reading perlu semak
  admin sekolah  : keputusan rasmi, bantahan diterima/ditolak, atlet DQ
  pencatat       : acara sedia untuk input, acara tangguh
```

---

## 20. PAPARAN AWAM & STADIUM (BARU)

```
/live       — keputusan live, medal tally, rekod baru (auto refresh 30s)
/stadium    — skrin besar: font besar, kontras tinggi, tanpa nav
/rekod      — semua rekod semasa (daerah/negeri/kebangsaan)
/olahragawan— ranking olahragawan & olahragawati
```

---

## 21. KESELAMATAN — FIRESTORE RULES

```
Prinsip:
  - viewer: read sahaja collection awam
  - admin: read all + write pendaftaran sekolah sendiri sahaja
  - pencatat: write keputusan sahaja (bukan pendaftaran)
  - pengurus_teknik: write rekod sahaja
  - superadmin: full access
  - audit_log: write by functions sahaja (bukan client)
```

---

## 22. PDF OUTPUT

| Dokumen | Enjin | Bila Jana |
|---|---|---|
| Start List | jsPDF + AutoTable | Sebelum acara |
| Keputusan Tidak Rasmi | jsPDF + AutoTable | Selepas pencatat input |
| Keputusan Rasmi | jsPDF + AutoTable | Selepas rasmi |
| Medal Tally | jsPDF + AutoTable | Live + akhir |
| Rekod Semasa | jsPDF + AutoTable | Bila-bila masa |
| Buku Kejohanan | jsPDF + AutoTable | Akhir kejohanan |
| Sijil Pemenang | CSS @media print | Selepas rasmi |
| Sijil Peserta | CSS @media print | Akhir kejohanan |
| Laporan Sekolah | jsPDF + AutoTable | Akhir / request |

### Government Style Standard
```
Header : Logo KPM kiri + Logo MSN kanan | Tajuk tengah | No rujukan
Body   : Border hitam, header row gelap, baris selang warna
Font   : Arial 10pt (body) | Arial 12pt bold (header)
Footer : No halaman | Tarikh & masa cetak | "Keputusan Rasmi"
         Ruang cop rasmi + tandatangan pegawai teknikal
```

---

## 23. FOLDER STRUCTURE

```
koam-system/
├── .env.local                  ← Firebase keys (JANGAN commit)
├── KOAM_MASTER_BRIEF.md        ← fail ini
├── index.html
├── vite.config.js
├── tailwind.config.js
│
└── src/
    ├── main.jsx
    ├── App.jsx
    │
    ├── firebase/
    │   ├── config.js           ← firebaseConfig
    │   ├── firestore.js        ← db helper functions
    │   ├── auth.js             ← auth helper
    │   └── rules/
    │       └── firestore.rules
    │
    ├── context/
    │   ├── AuthContext.jsx
    │   └── KejohananContext.jsx
    │
    ├── hooks/
    │   ├── useAtlet.js
    │   ├── useAcara.js
    │   ├── useKeputusan.js
    │   └── useRekod.js
    │
    ├── pages/
    │   ├── Login.jsx
    │   ├── Dashboard.jsx
    │   ├── admin/
    │   │   ├── KejohananSetup.jsx
    │   │   ├── AcaraSetup.jsx
    │   │   ├── Pendaftaran.jsx
    │   │   ├── StartList.jsx
    │   │   └── UserManagement.jsx
    │   ├── pencatat/
    │   │   └── InputKeputusan.jsx
    │   └── public/
    │       ├── Live.jsx
    │       ├── MedalTally.jsx
    │       ├── Rekod.jsx
    │       └── Stadium.jsx
    │
    ├── components/
    │   ├── ui/                 ← button, input, table, badge
    │   ├── acara/
    │   ├── keputusan/
    │   ├── rekod/
    │   └── medal/
    │
    ├── pdf/
    │   ├── templates/
    │   │   ├── StartListPDF.js
    │   │   ├── KeputusanPDF.js
    │   │   ├── MedalTallyPDF.js
    │   │   ├── BukuKejohananPDF.js
    │   │   └── LaporanSekolahPDF.js
    │   └── components/
    │       ├── PDFHeader.js    ← guna semula semua PDF
    │       └── PDFFooter.js
    │
    └── utils/
        ├── kategoriUmur.js     ← auto kira kategori dari tarikhLahir
        ├── rankKeputusan.js    ← logik best_time/best_heat/hybrid
        ├── mataPingat.js       ← kira mata olahragawan
        ├── bibGenerator.js     ← auto generate noBib
        └── windValidator.js    ← semak isWindLegal
```

---

## 24. STATUS SEMASA

```
✅ Firebase project created (mssdkemaman-olahraga)
✅ Firebase SDK config ada
✅ Design DB lengkap + normalisasi
✅ Semua unique key defined
✅ Flow keputusan rasmi (tidak rasmi → countdown → rasmi)
✅ Sistem rekod (daerah/negeri/kebangsaan) + trigger
✅ Olahragawan + medal tally + cascade
✅ Semua jenis acara (lorong/mass start/padang/relay)
✅ Situasi khas (DNS/DNF/DQ/NM/FS/tie/wind/relay)
✅ Audit log + notifikasi + paparan stadium
✅ PDF strategy (jsPDF + CSS print)
✅ Folder structure defined

⏳ NEXT STEP:
   1. bina React project (Vite)
   2. setup Firebase config
   3. setup Firestore rules
   4. bina AuthContext + Login page
```

---

## 25. BLIND SIDE — TAMBAHAN DARI SEMAK DEEP

```
DITAMBAH DALAM VERSI INI:
✦ Role pengurus_teknik — sahkan rekod & wind reading
✦ Relay (Jenis E) — logik pasukan, pingat sekolah, tukar ahli
✦ Jadual acara — time schedule, konflik jadual auto check
✦ Audit log — akauntabiliti semua perubahan data rasmi
✦ Notifikasi in-app — semua role dapat makluman tepat
✦ Paparan stadium — skrin besar font besar
✦ Atlet antarabangsa — noPassport, tak layak rekod kebangsaan
✦ Sejarah sekolah atlet — jika pindah sekolah
✦ Rekod ditarik — rekod sebelumnya naik semula (cascade)
✦ Sijil peserta (bukan pemenang sahaja)
✦ Laporan sekolah — PDF untuk pengurus sekolah
✦ False start ke-2 = auto DQ
✦ Had atlet per sekolah per acara
✦ Pengesahan doping — rekod_pending status
✦ isWindReading flag per acara — wajib input angin sebelum rasmi
```

---
*Versi: 2.0 — Semak deep lengkap. Semua blind side ditutup.*

---

## 26. WORLD ATHLETICS (WA) RULES — BOLEH UBAH SUAI

### Config Per Kejohanan (collection: wa_config)
```js
wa_config/{kejohananId} = {

  // ANGIN
  windLimit: 2.0,           // m/s — rekod sah jika ≤ limit
  windAcara: [              // acara yang perlu wind reading
    '100m', '200m', '110mH', '100mH',
    'lompat_jauh', 'lompat_kijang'
  ],

  // FALSE START
  falseStartRule: 'one',    // 'one' = terus DQ (WA standard)
                            // 'two' = amaran dulu (sekolah)

  // MASA
  timeSystem: 'electronic', // 'electronic' | 'manual'
  handTimeAdjust: {         // tambah jika manual
    sprint: 0.24,           // 100m, 110mH, 100mH
    other: 0.14             // acara lain
  },

  // BALINGAN & LOMPATAN (PADANG)
  cubaan: {
    peringkatAwal: 3,       // semua peserta dapat 3 cubaan
    peringkatAkhir: 3,      // top 8 dapat 3 cubaan tambahan
    topFinalis: 8,          // berapa masuk peringkat akhir
    nmRule: 'foul_line'     // NM jika jejak papan/garisan
  },

  // LOMPAT TINGGI & BERGALAH
  lompat: {
    gagalBerturut: 3,       // 3 kegagalan = eliminated
    passBoleh: true         // boleh pass ketinggian
  },

  // RELAY
  relay: {
    zonSerah: 20,           // meter zon serah baton (WA)
    anggotaUtama: 4,
    anggotaGanti: 2,
    bolehTukar: true,       // boleh tukar sebelum acara
    dqJikaAnggotaDq: true   // satu DQ = seluruh pasukan DQ
  },

  // KATEGORI UMUR
  kategoriUmur: 'tahunLahir', // ikut TAHUN lahir (bukan tarikh)
  
  // LORONG
  lorongStandard: 8,        // standard WA
  lorongTengah: [4, 5],     // assign kepada atlet terbaik

  // HEAT & FINAL
  caraPilihFinal: 'hybrid', // standard KOAM kebangsaan
  wildcardSlot: 2,
}
```

---

## 27. SISTEM HEAT / SARINGAN / FINAL — LENGKAP

### Fasa Pertandingan

```
FASA 1 — SARINGAN (jika peserta ramai):
  Tujuan   : kurangkan peserta ke bilangan munasabah
  Bila     : jika peserta > (lorong × 3 heat)
  Cara     : best_time sahaja — top N ke separuh akhir
  Rekod    : masa saringan dikira untuk rekod

FASA 2 — SEPARUH AKHIR / HEAT:
  Tujuan   : pilih finalis
  Bila     : standard — hampir semua acara ada heat
  Cara     : hybrid (top 1 setiap heat + wildcard best time)
  Lorong   : random assign — lorong tengah untuk terbaik
  Rekod    : masa heat dikira untuk rekod

FASA 3 — FINAL:
  Tujuan   : tentukan pemenang & pingat
  Lorong   : assign ikut masa heat (terbaik = lorong 4,5)
  Rekod    : HANYA final dikira untuk rekod rasmi
  Pingat   : Emas/Perak/Gangsa dari final sahaja
```

### Logik Auto Sistem

```js
// Sistem auto decide berapa fasa diperlukan:

function tentukan_fasa(bilanganPeserta, bilanganLorong) {

  const maxPerHeat = bilanganLorong  // cth: 8

  if (bilanganPeserta <= maxPerHeat) {
    return 'terus_final'             // ≤8 orang = terus final
  }

  if (bilanganPeserta <= maxPerHeat * 3) {
    return 'heat_final'              // 9-24 = heat + final
  }

  return 'saringan_heat_final'       // >24 = 3 fasa
}
```

### Assign Lorong — Standard WA/KOAM

```
HEAT (saringan/separuh akhir):
  → Random assign
  → Lorong tengah (4,5) = bib terkecil atau random

FINAL:
  → Rank dari masa heat terbaik
  → Lorong 4 = masa terbaik (rank 1)
  → Lorong 5 = rank 2
  → Lorong 3 = rank 3
  → Lorong 6 = rank 4
  → Lorong 2 = rank 5
  → Lorong 7 = rank 6
  → Lorong 1 = rank 7
  → Lorong 8 = rank 8
  (Pola: dalam keluar dari tengah)
```

### DB Fields — collection: heat

```js
heat/{heatId} = {
  heatId,           // ACR-100M-L-SR-H1
  aceraId,          // FK
  kejohananId,      // FK
  fasa,             // saringan | heat | separuh_akhir | final
  noHeat,           // 1, 2, 3...
  status,           // belum_mula | sedang_jalan | selesai
  jadualMasa,       // masa dijadualkan
  masaMula,         // masa sebenar mula
  masaTamat,        // masa sebenar tamat
  windSpeed,        // bacaan angin (jika isWindReading)
  isWindLegal,      // auto: windSpeed <= wa_config.windLimit
  peserta: [{
    noBib,
    noKP,
    namaAtlet,
    kodSekolah,
    lorong,         // nombor lorong
    giliran,        // untuk padang/mass start
    keputusan,      // masa/jarak/mata
    status,         // selesai|DNS|DNF|DQ|NM|FS
    cubaan: [],     // untuk padang: [1.23, NM, 1.45]
    rankDalamHeat,  // auto kira selepas input
  }],
  finalisDipilih: [], // noBib[] yang layak ke final
}
```

### Cara Pilih Finalis — 3 Cara

```
BEST_TIME:
  → Gabung semua masa dari semua heat
  → Sort terpantas ke perlahan
  → Top N = finalis
  → Paling adil untuk atlet laju di heat susah

BEST_HEAT:
  → Ambil top N dari setiap heat
  → Seimbang — setiap heat ada wakil
  → Masalah: heat mudah vs heat susah tidak adil

HYBRID (STANDARD KOAM KEBANGSAAN):
  → Top 1 dari setiap heat = masuk final (guaranteed)
  → Selebihnya = best time dari semua heat
  → wildcardSlot = 2 (boleh ubah)
  → Contoh: 3 heat, 8 finalis, wildcard 2:
    - 3 orang (top 1 setiap heat) + 5 orang best time
```

### Mass Start — Cara Khas

```
Acara: 800m, 1500m, 3000m, 5000m

Jika peserta ≤ 12:
  → Terus final, semua start serentak
  → Tiada lorong tetap
  → Nombor giliran sahaja

Jika peserta > 12:
  → Buat heat (cth: 2 heat × 12 orang)
  → Cara pilih final: best_time (standard)
  → Rekod dari heat dikira

Start: semua lari serentak dari garisan melengkung
```

### Padang — Cara Khas

```
Lompat Jauh / Kijang / Peluru / Cakera / Lembing:

Jika peserta ≤ 8:
  → Terus final, semua dapat 6 cubaan
  
Jika peserta > 8:
  → Peringkat awal: semua dapat 3 cubaan
  → Top 8 (jarak terbaik) → peringkat akhir
  → Peringkat akhir: top 8 dapat 3 cubaan lagi
  → Rank akhir: cubaan terbaik dari 6 cubaan

NM (No Mark): cubaan tidak sah — jejak papan,
  jatuh ke belakang, keluar sektor
  → simpan sebagai 'NM' bukan 0

Lompat Tinggi / Bergalah:
  → Ketinggian naik berperingkat
  → 3 kegagalan berturut = eliminated
  → Boleh 'pass' ketinggian (skip)
  → Rank: ketinggian tertinggi berjaya
  → Tiebreak: bilangan gagal pada ketinggian itu
```

---

## 28. PROMPT SAMBUNG SEMULA (DIKEMASKINI)

```
Baca KOAM_MASTER_BRIEF.md.

STATUS SEMASA:
✅ React + Vite + Tailwind
✅ Firebase Auth + config (mssdkemaman-olahraga)
✅ Login page
✅ Dashboard layout + sidebar
✅ UserManagement.jsx
✅ KejohananSetup.jsx
✅ App.jsx routes (/ = Home, /login redirect ke /)
✅ Live: mssdkemaman-olahraga.web.app

URUTAN BINA SETERUSNYA:
1. Setup Sekolah (/dashboard/sekolah) ← SEKARANG
2. Setup Kategori (/dashboard/kategori)
3. Setup Acara + WA Config (/dashboard/acara)
4. Setup Jadual (/dashboard/jadual)
5. Setup User pencatat/urusetia (/dashboard/pengguna)
6. Home page 3 card login (/)
7. Portal Pengurus Pasukan
8. Pendaftaran Atlet
9. Start List + Lorong Auto
10. Input Keputusan + Heat/Final
11. Keputusan Rasmi + Countdown
12. Medal Tally + Olahragawan
13. Rekod + Trigger
14. PDF Output

WA RULES: Refer section 26 & 27 dalam brief ini.
Semua config boleh ubah oleh superadmin per kejohanan.

Mula dengan: Setup Sekolah (/dashboard/sekolah)
```

---
*Versi: 3.0 — Tambah WA Rules + Sistem Heat/Saringan/Final lengkap*

---

## 29. VALIDATION RULES — GATE SYSTEM (KRITIKAL)

### A. Pendaftaran Atlet — Semak Sebelum Daftar

```js
// SEMAK 1: Kategori Umur
// Ikut WA — tahun lahir bukan tarikh lahir
function semakUmur(tarikhLahir, kategoriAcara) {
  const tahunLahir = new Date(tarikhLahir).getFullYear()
  const tahunSemasa = new Date().getFullYear()
  const umur = tahunSemasa - tahunLahir
  
  const hadUmur = {
    'SR': { min: 10, max: 12 },  // tahun lahir 2012-2014
    'SM': { min: 13, max: 18 },  // tahun lahir 2006-2011
    'PPKI': { min: 10, max: 18 } // tahun lahir 2006-2014
  }
  return umur >= hadUmur[kategoriAcara].min && 
         umur <= hadUmur[kategoriAcara].max
}

// SEMAK 2: Had Acara Per Atlet
// Max acara individu + kumpulan
const hadAcara = {
  individu: 1,    // max 1 acara individu
  kumpulan: 1,    // max 1 acara kumpulan (relay)
  jumlah: 2       // max 2 acara keseluruhan
}

// SEMAK 3: Had Atlet Per Sekolah Per Acara
// Admin set — default 2
function semakHadSekolah(kodSekolah, aceraId, had) {
  // kira berapa atlet sekolah ni dah daftar acara ini
  // jika >= had → reject
}

// SEMAK 4: Konflik Jadual
// Atlet tidak boleh daftar 2 acara masa bertindih
function semakKonflikJadual(noKP, aceraId) {
  // ambil jadual acara baru
  // bandingkan dengan semua acara yang atlet dah daftar
  // jika bertindih → reject + tunjuk konflik
}

// SEMAK 5: Jantina
// Atlet L tidak boleh daftar acara P dan sebaliknya
function semakJantina(jantina, jantinaAcara) {
  if (jantinaAcara === 'campuran') return true
  return jantina === jantinaAcara
}

// SEMAK 6: Kategori Sekolah
// Atlet SR tidak boleh daftar acara SM
function semakKategoriSekolah(kategoriAtlet, kategoriAcara) {
  return kategoriAtlet === kategoriAcara
}

// SEMAK 7: Duplikasi
// Atlet tidak boleh daftar acara sama 2 kali
function semakDuplikasi(noKP, aceraId, kejohananId) {
  // semak dalam pendaftaran collection
}
```

### B. Urutan Semak — Sistem Wajib Ikut

```
1. Atlet wujud dalam DB (noKP valid)
2. Kategori sekolah match
3. Umur dalam had (ikut WA)
4. Jantina match
5. Belum daftar acara sama (duplikasi)
6. Had atlet sekolah belum penuh
7. Had acara atlet belum penuh (max individu + kumpulan)
8. Tiada konflik jadual
→ SEMUA PASS → boleh daftar → jana noBib
→ ADA YANG FAIL → reject + tunjuk sebab spesifik
```

---

## 30. VALIDATION — ACARA & HEAT

```js
// SEMAK SEBELUM JANA HEAT:
function semakSebelumJanaHeat(aceraId) {
  checks = {
    adaPeserta: peserta.length > 0,
    memenuhiMin: peserta.length >= minPeserta,
    acaraAktif: statusAcara !== 'batal',
    jadualDitetapkan: jadualId !== null,
    semakDupBib: tiada 2 atlet bib sama
  }
}

// SEMAK KEPUTUSAN:
function semakKeputusan(nilai, jenis, windSpeed) {
  if (jenis === 'masa') {
    // format: SS.ss atau MM:SS.ss
    // nilai > 0
    // tidak terlalu laju (sanity check)
  }
  if (jenis === 'jarak') {
    // dalam meter, 2 titik perpuluhan
    // nilai > 0
  }
  if (isWindReading) {
    // windSpeed mesti diisi sebelum input keputusan
    // windSpeed dalam julat -10.0 hingga +10.0
  }
}
```

---

## 31. MEDAL TALLY — OLYMPIC STYLE

```
RANKING OLYMPIC STYLE:
1. Emas terbanyak → ranking 1
2. Jika sama emas → Perak terbanyak
3. Jika sama perak → Gangsa terbanyak
4. Jika sama semua → nama sekolah abjad

PAPARAN:
Rank | Sekolah | E | P | G | Jumlah
  1  | SMK ... | 5 | 3 | 2 |  10
  2  | SK ...  | 4 | 5 | 1 |  10

KIRA AUTO:
- Update setiap kali keputusan RASMI
- Relay: kira untuk sekolah (bukan individu)
- Pingat ditarik: recalculate semua
- Acara batal: tolak pingat

DB: medal_tally/{kejohananId}_{kodSekolah}
{
  kejohananId,
  kodSekolah,
  namaSekolah,
  emas: 0,
  perak: 0,
  gangsa: 0,
  jumlah: 0,   // auto kira
  rank: 0,     // auto kira
  updatedAt
}
```

---

## 32. PENCATAT KEPUTUSAN — RULES KETAT

```
KEBENARAN PENCATAT:
- Hanya boleh input acara yang diassign
- Tidak boleh edit keputusan yang dah RASMI
- Tidak boleh padam keputusan
- Mesti input wind sebelum keputusan (jika isWindReading)
- Satu acara satu pencatat (tidak boleh 2 pencatat)

VALIDATION INPUT:
- Masa: format betul (00:00.00)
- Jarak: format betul (0.00m)
- Status DNS/DNF/DQ/NM/FS — mesti pilih sebab
- Wind: -10.0 hingga +10.0 m/s sahaja

AUDIT:
- Setiap input simpan: uid pencatat, masa input
- Setiap edit simpan: nilai lama, nilai baru, sebab
- Semua dalam audit_log
```

---

## 33. FIRESTORE RULES — PRODUCTION LEVEL

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper functions
    function isAuth() {
      return request.auth != null;
    }
    function getRole() {
      return get(/databases/$(database)/documents/
        users/$(request.auth.uid)).data.role;
    }
    function isRole(role) {
      return isAuth() && getRole() == role;
    }
    function isSuperadmin() {
      return isRole('superadmin');
    }
    function isAdmin() {
      return isRole('admin') || isSuperadmin();
    }
    function isPencatat() {
      return isRole('pencatat') || isSuperadmin();
    }
    function isPengurusTeknik() {
      return isRole('pengurus_teknik') || isSuperadmin();
    }
    function isAktif() {
      return get(/databases/$(database)/documents/
        users/$(request.auth.uid)).data.isAktif == true;
    }
    function mySekolah() {
      return get(/databases/$(database)/documents/
        users/$(request.auth.uid)).data.kodSekolah;
    }

    // SEKOLAH — superadmin CRUD, semua baca
    match /sekolah/{kodSekolah} {
      allow read: if isAuth() && isAktif();
      allow write: if isSuperadmin();
    }

    // ATLET — superadmin/admin CRUD (sekolah sendiri)
    match /atlet/{noKP} {
      allow read: if isAuth() && isAktif();
      allow create: if isAdmin() && isAktif();
      allow update: if isSuperadmin() || 
        (isAdmin() && resource.data.kodSekolah == mySekolah());
      allow delete: if isSuperadmin();
    }

    // USERS — superadmin CRUD, user baca sendiri
    match /users/{uid} {
      allow read: if isAuth() && 
        (request.auth.uid == uid || isSuperadmin());
      allow write: if isSuperadmin();
    }

    // KEJOHANAN — superadmin CRUD
    match /kejohanan/{kejohananId} {
      allow read: if true; // awam boleh baca
      allow write: if isSuperadmin();

      // ACARA — superadmin/admin setup
      match /acara/{aceraId} {
        allow read: if true;
        allow write: if isSuperadmin();
      }

      // PENDAFTARAN — admin sekolah sendiri
      match /pendaftaran/{noBib} {
        allow read: if isAuth() && isAktif();
        allow create: if isAdmin() && isAktif();
        allow update: if isSuperadmin() ||
          (isAdmin() && resource.data.kodSekolah == mySekolah());
        allow delete: if isSuperadmin();
      }

      // HEAT — pencatat input, semua baca
      match /heat/{heatId} {
        allow read: if true;
        allow create, update: if isSuperadmin();

        // KEPUTUSAN — pencatat input sahaja
        match /keputusan/{keputusanId} {
          allow read: if true;
          allow create: if isPencatat() && isAktif();
          allow update: if isPencatat() && isAktif() &&
            resource.data.status != 'rasmi'; // lock bila rasmi
          allow delete: if isSuperadmin();
        }
      }
    }

    // REKOD — pengurus_teknik sahkan
    match /rekod/{rekodId} {
      allow read: if true;
      allow create, update: if isPengurusTeknik();
      allow delete: if isSuperadmin();
    }

    // REKOD SEJARAH — read only
    match /rekod_sejarah/{id} {
      allow read: if isAuth();
      allow write: if false; // Functions sahaja
    }

    // MEDAL TALLY — auto update via Functions
    match /medal_tally/{id} {
      allow read: if true;
      allow write: if isSuperadmin(); // Functions guna admin SDK
    }

    // AUDIT LOG — write via Functions sahaja
    match /audit_log/{id} {
      allow read: if isSuperadmin();
      allow write: if false; // Functions sahaja
    }

    // BANTAHAN
    match /bantahan/{id} {
      allow read: if isAuth() && isAktif();
      allow create: if isAdmin() && isAktif();
      allow update: if isSuperadmin();
      allow delete: if isSuperadmin();
    }

    // NOTIFIKASI — user baca sendiri
    match /notifikasi/{id} {
      allow read: if isAuth() && 
        resource.data.uid == request.auth.uid;
      allow write: if false; // Functions sahaja
    }
  }
}
```

---

## 34. PDF — STANDARD PROFESSIONAL

```
ENJIN: jsPDF + AutoTable
JIWA: Government style — bersih, tepat, professional

SETIAP PDF MESTI ADA:
Header:
  - Logo KPM (kiri) + Logo MSN (kanan)
  - Tajuk kejohanan (tengah, bold)
  - Tarikh cetak + No rujukan (kanan atas)
  - Garisan bawah header

Body (AutoTable):
  - Font: Arial/Helvetica
  - Header row: background #003399, teks putih
  - Baris selang: putih / kelabu muda (#f5f5f5)
  - Border: hitam nipis
  - Padding: 3px atas bawah

Footer (setiap halaman):
  - No halaman: "Halaman X dari Y"
  - Tarikh & masa cetak
  - "KEPUTUSAN RASMI — SULIT"
  - Ruang cop + tandatangan pegawai teknikal

DOKUMEN SPESIFIK:
Start List:
  - Sorted by lorong/giliran
  - Kolum: No, Lorong, Bib, Nama, Sekolah, Kategori
  - Watermark "TIDAK RASMI" jika belum rasmi

Keputusan Rasmi:
  - Sorted by rank
  - Kolum: Rank, Bib, Nama, Sekolah, Keputusan, Catatan
  - Rekod baru: highlight kuning + simbol ★
  - DQ/DNS/DNF: merah

Medal Tally:
  - Olympic style ranking
  - Kolum: Rank, Sekolah, E, P, G, Jumlah
  - Top 3: background emas/perak/gangsa

Sijil:
  - CSS @media print
  - Landscape A4
  - Cop digital + tandatangan
```

---

## 35. CRUD RULES — BILA BOLEH EDIT/PADAM

```
ATLET:
  Edit   → bila-bila (jika tiada keputusan rasmi)
  Padam  → superadmin sahaja + audit log

PENDAFTARAN:
  Edit   → sebelum start list dijana
  Padam  → sebelum start list dijana
  Lock   → selepas start list dijana

KEPUTUSAN:
  Edit   → status tidak_rasmi sahaja
  Padam  → superadmin sahaja + audit log
  Lock   → status RASMI = tidak boleh ubah langsung

REKOD:
  Edit   → pengurus_teknik sahaja
  Padam  → superadmin sahaja
  
KEJOHANAN:
  Edit   → status persediaan sahaja
  Batal  → superadmin + sebab wajib
  Padam  → tidak dibenarkan (archive sahaja)

ACARA:
  Edit   → sebelum pendaftaran dibuka
  Batal  → superadmin + handle cascade
    → padam semua pendaftaran acara tu
    → adjust medal tally
    → notifikasi sekolah
```

---

## 36. STATUS SEMASA & PROMPT SAMBUNG (VERSI 4.0)

```
STATUS CONFIRMED:
✅ React + Vite + Tailwind
✅ Firebase config (mssdkemaman-olahraga)
✅ Login page
✅ Dashboard layout + sidebar  
✅ UserManagement.jsx
✅ KejohananSetup.jsx
✅ Setup Sekolah — siap
✅ Seed sekolah (20 sekolah) — siap
✅ Kejohanan aktif dalam Firebase — ada
✅ seedAtlet.js — siap (200 atlet)
✅ Live: mssdkemaman-olahraga.web.app

MASALAH DITEMUI — PERLU BAIKI:
❌ Validation pendaftaran tidak kukuh
   - Had acara per atlet tidak dikuatkuasakan
   - Had atlet per sekolah tidak dikuatkuasakan
   - Konflik jadual tidak disemak
❌ Gate kategori tidak berfungsi
❌ Firestore rules belum production level
❌ PDF belum professional
❌ CRUD rules tidak lengkap

URUTAN BAIKI & BINA:
1. Validation engine (section 29-30) ← KRITIKAL
2. Firestore rules (section 33) ← KESELAMATAN
3. Medal tally Olympic style (section 31)
4. Pencatat keputusan (section 32)
5. Heat/Final sistem (section 27)
6. PDF professional (section 34)
7. CRUD rules (section 35)
8. Home page 3 card login
9. Portal pengurus pasukan
10. Rekod + trigger
11. Olahragawan sistem
12. Paparan awam + stadium

PROMPT SAMBUNG:
Baca KOAM_MASTER_BRIEF.md sections 29-35.

Baiki sistem mengikut urutan:

LANGKAH 1 — Validation Engine (section 29):
Bina src/utils/validasiPendaftaran.js
- semakUmur() — ikut WA tahun lahir
- semakHadAcara() — max 1 individu + 1 kumpulan
- semakHadSekolah() — had atlet per acara
- semakKonflikJadual() — masa bertindih
- semakJantina() — match acara
- semakKategoriSekolah() — SR/SM/PPKI
- semakDuplikasi() — tidak daftar 2 kali
- validasiPendaftaran() — run semua semak, 
  return {valid: bool, sebab: string}

LANGKAH 2 — Firestore Rules (section 33):
Update firestore.rules dengan rules lengkap
Deploy: firebase deploy --only firestore:rules

LANGKAH 3 — Pendaftaran page:
Guna validasiPendaftaran() sebelum save
Tunjuk error message spesifik kepada user
```

---

## 37. STATUS SEMASA (DIKEMASKINI — VERSI 5.0)

```
✅ MedalTally.jsx (/dashboard/medal)
   - Ranking Olympic: Emas → Perak → Gangsa → nama abjad
   - Tiebreak betul (rank sama jika semua pingat sama)
   - Summary cards jumlah E/P/G
   - Real-time onSnapshot (LIVE)
   - Footer jumlah semua sekolah

✅ Olahragawan.jsx (/dashboard/olahragawan)
   - Tab L (Olahragawan) & P (Olahragawati) berasingan
   - Mata: E=5 P=3 G=2 T4=1
   - Tiebreak: Mata → E → P → G → nama abjad
   - Highlight card winner L & P
   - Expand row: senarai acara per atlet (dengan MiniCoin badges)
   - Real-time onSnapshot (LIVE)

✅ Firestore rules atlet/pendaftaran — FIXED
   - Guna resource.data.kodSekolah == request.resource.data.kodSekolah untuk update
   - Delete: isAdminOrPP() (tidak lagi bergantung pada getKodSekolah())

✅ tarikhTamatDaftar — datetime GMT+8 12-jam
   - Input datetime-local → simpan ISO UTC → papar Malaysia format
   - Countdown live per saat dalam TabAtlet

⏳ SETERUSNYA (ikut urutan):
10. Rekod + trigger pecah rekod   ← NEXT
11. PDF output (semua dokumen)
12. Paparan awam (/live /stadium /rekod /olahragawan)
```

---
*Versi: 5.0 — Medal Tally + Olahragawan siap. Firestore rules fixed. Next: Rekod.*

---

## 38. STATUS SEMASA (DIKEMASKINI — VERSI 6.0) — 2026-05-15

### Selesai sesi ini:

```
✅ SekolahSetup — bypass tarikh tutup daftar per sekolah
   - Field bypassDeadline (boolean) dalam doc sekolah
   - Butang "Bypass ON/OFF" dalam kolum Tindakan
   - Badge "BYPASS" dalam kolum Status jika ON

✅ PendaftaranSetup — semak bypassDeadline di 3 lokasi
   - TabAtlet (~line 2159)
   - TabPendaftaran (~line 2661)
   - PPPendaftaranView (~line 3744)
   - tamatDaftarLepas = false jika bypassDeadline === true

✅ DashboardLayout — sidebar roles dikemas:
   - Panduan Pendaftaran → roles: ['pengurus_pasukan'] sahaja
   - Input Keputusan → roles: ['pencatat'] sahaja
   - Laporan & PDF → roles: [] (buang dari semua)

✅ firestore.rules — tambah rekod_sejarah collection
   - read: true, create: true, update: false, delete: false

✅ CetakKeputusan — major fix:
   - Query kejohanan: where statusKejohanan in ['aktif', 'persediaan']
   - jadual_acara: filter by kejohananId + client-side sort
   - Heat detection: guna statusKeputusan === 'diterima' (bukan rasmi)
   - Buang semua DRAF / rasmi / tidak_rasmi references
   - PDF Kd. column: buang emoji (jsPDF tak support), guna rankDalamHeat

✅ StartList — dua butang cetak bulk baru (dalam Tab Status):
   - "Cetak Semua Balapan (Portrait)" → lorong/mass_start/relay → A4 portrait
   - "Cetak Semua Padang (Landscape)" → padang_lompat/padang_balin → A4 landscape
   - State: cetakBalapanLoading, cetakPadangLoading
   - Functions: cetakSemuaBalapan(), cetakSemuaPadang()

✅ rekodUtils — cariRekodUntukAcara — fix rekod tak jumpa
   - Masalah: kategoriKod dalam acara = kod huruf (A, B, C...)
             rekod dalam Firestore disimpan dengan kelas umur (L12, P12, L10...)
   - Fix: cuba kedua-dua kategoriKod DAN kelas dari namaAcara secara parallel
   - kelas = namaAcara.replace(namaAcaraPendek, '').trim()
   - Contoh: "80M BERPAGAR L12" → kelas = "L12" → cuba key dengan "L12" dan "A"

REKOD KEY FORMAT:
  rekodKey(nama, jantina, kategoriKod, peringkat)
  = join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  
  Sistem cuba KEDUA-DUA:
  1. namaAcaraPendek + jantina + kategoriKod (A/B/C...) + D/N/K
  2. namaAcaraPendek + jantina + kelas (L12/P12/L10...) + D/N/K
```

### Git Commit: 8a72e12

```
Fix: bypass deadline sekolah, rekod fallback kelas, cetak bulk 
balapan/padang, sidebar roles, CetakKeputusan & Firestore rules
```

### Pending / Isu Diketahui:

```
⏳ cariRekodUntukAcara — sesetengah acara mungkin masih x jumpa rekod
   jika format nama dalam rekod Firestore sangat berbeza
   → Semak dalam modul Rekod → lihat doc ID sebenar

⏳ Rekod semasa: modul Rekod.jsx perlukan audit
   → Pastikan namaAcara dalam rekod == namaAcaraPendek dalam acara

⏳ CetakKeputusan → canJanaFinal masih guna allHeatRasmi
   (statusKeputusan === 'rasmi') — perlu update ke 'diterima' 
   jika sistem fully migrate ke direct publish

⏳ Buku Kejohanan, CetakAcara — rekod juga guna namaAcaraPendek
   Jika rekod masih x jumpa, sama fix diperlukan di sana
```

### Prompt Sambung Sesi Seterusnya:

```
Baca KOAM_MASTER_BRIEF.md sections 37-38.

STATUS:
- Semua fix sesi 6.0 sudah deploy ke mssdkemaman-olahraga.web.app
- GitHub: msrab1979-ai/msddOlahragaKemaman (commit 8a72e12)

SEMAK REKOD:
1. Pergi modul Rekod → lihat senarai rekod — apa nama & kategoriKod
   disimpan dalam doc ID?
2. Compare dengan namaAcaraPendek dalam acara
3. Jika masih x match → update rekod atau update mapping dalam rekodUtils

SETERUSNYA (ikut keutamaan):
1. Audit rekod — pastikan rekod papar betul di semua modul
2. InputKeputusan — fix canJanaFinal guna 'diterima' bukan 'rasmi'
3. BukuKejohanan — semak rekod lookup
```

---
*Versi: 6.0 — Bypass deadline, rekod fallback, bulk print StartList, CetakKeputusan fix. Commit 8a72e12.*

---

## 39. STATUS SEMASA (DIKEMASKINI — VERSI 7.0) — 2026-05-16

### Selesai sesi ini: Relay end-to-end + Rekod dalam Keputusan

```
✅ Home.jsx — tab Keputusan: relay display fixes (keseluruhan)

   MASALAH & FIX:
   1. Relay "semua label Final" → isFinalHeat guna fasa === 'final' (bukan peringkat)
   2. heatLabel logic baru:
      - showingFinal + saringanHeats.length === 0 → "Terus Final"  
      - showingFinal + ada saringan → "Final"
      - !showingFinal + 1 heat → "Saringan"
      - !showingFinal + >1 heat → "N Heat Saringan"
   3. finalistBibs relay: f.kodSekolah (bukan f.noBib yang undefined)
   4. finalSetup prop MISSING dalam tab Keputusan → fixed (relay hanya 5 finalis)
   5. showCatatanCol relay: tambah `isRelay && saringanHeats.length > 0`
   6. layakFinal relay: guna kodSekolah (bukan noBib)
   7. labelOverride: 'Terus Final' | 'Final' (ganti 'Perlawanan')

✅ Home.jsx — Rekod D/N/K dalam keputusan (sync dengan StartList)
   - Import: cariRekodUntukAcara, formatPrestasiRekod, tahunRekod
   - State: rekodCache = { aceraKey: {D, N, K} }
   - loadHeatsForAcara: fetch heats + rekod PARALLEL (Promise.all)
   - KeputusanExpanded: papar rekod Daerah/Negeri/Kebangsaan di bawah heat table
     Format: [D]/[N]/[K] badge + prestasi (mono bold) + nama + tahun
   - Prop rekodDNK passed ke KeputusanExpanded di Jadual tab & Keputusan tab

✅ postRasmiUtils.js — Relay pecah rekod flag + badge
   - Masalah: pecahRekodMap guna noKP — relay tiada noKP → flag tidak pernah set
   - Fix: pecahRekodRelayMap keyed by kodSekolah (berasingan dari individu)
   - 🏆 REKOD badge kini papar dalam keputusan relay (bukan individu sahaja)

✅ InputKeputusan.jsx — Lorong kosong protection
   - InputLorong & InputRelay: jika semua field empty → render "— Lorong kosong —"
   - Prevent pencatat accidentally edit baris kosong
   - Row style: bg-gray-50, teks gray italic

✅ InputKeputusan.jsx — Label Saringan/Final/Terus Final betul
   - HeatTabBar: hasSaringanHeat = heats.some(h => h.fasa === 'heat')
   - fasa === 'final' + ada saringan → "FINAL"
   - fasa === 'final' + tiada saringan → "TERUS FINAL"
   - fasa !== 'final' → "Heat N"
```

### Git Commit: (sesi ini)

```
Fix: relay keputusan display, rekod D/N/K Home, 
pecahRekod relay, lorong kosong protection, label Terus Final
```

### Pending / Isu Diketahui:

```
⏳ Relay full e2e flow: jana heat → input → keputusan rasmi → 
   medal tally → home display → rekod (belum ditest secara live)

⏳ cariRekodUntukAcara: sesetengah acara mungkin masih x match
   jika format nama Firestore sangat berbeza dari namaAcaraPendek

⏳ CetakKeputusan → canJanaFinal masih guna allHeatRasmi
   (statusKeputusan === 'rasmi') — belum update ke 'diterima'
```

### Prompt Sambung Sesi Seterusnya:

```
Baca KOAM_MASTER_BRIEF.md section 39.

STATUS:
- Semua fix sesi 7.0 sudah deploy ke mssdkemaman-olahraga.web.app
- GitHub: msrab1979-ai/msddOlahragaKemaman (commit terkini)

PERKARA SELESAI SESI INI:
- Relay label (Terus Final/Saringan/Final) betul
- Relay finalis 8 pasukan (bukan 5 — finalSetup prop fixed)
- Rekod D/N/K papar dalam Home keputusan (sync StartList)
- 🏆 REKOD badge untuk relay
- Lorong kosong selamat dari pencatat

SETERUSNYA (ikut keutamaan):
1. Test relay full e2e live
2. CetakKeputusan canJanaFinal → update ke 'diterima'
3. Audit rekod — pastikan namaAcara match rekodUtils
```

---
*Versi: 7.0 — Relay end-to-end fix + rekod D/N/K dalam keputusan + lorong kosong + pecahRekod relay. Deploy 2026-05-16.*

---

## 41. STATUS SEMASA (DIKEMASKINI — VERSI 9.0) — 2026-05-17

### Selesai sesi ini:

```
✅ BukuKejohanan — major overhaul (10 bahagian PDF)
   - Muka Depan: redesign KOAM Official (band gelap 55mm, logo dalam band,
     jalur emas, trek decoration titik-titik, 4 stat boxes, penganjur, footer band)
   - Medal Tally (baharu): fetch medal_tally collection, separate SR/SM dinamik,
     sort emas→perak→gangsa, warna top 3 (emas/perak/gangsa rows)
   - Senarai Pendaftaran by Sekolah (baharu): bilangan atlet per sekolah per
     kategori+jantina, kolum dinamik dari data pendaftaran, separate SR/SM,
     baris jumlah per jenisSekolah
   - Keputusan Rasmi: .slice(0,3) → .slice(0,2) — top 2 sahaja
   - Rekod Dipecah (baharu): filter rekodList by kejohananId===kejId,
     jadual split Rekod Baharu | Rekod Lama dengan prestasi, nama, sekolah, tarikh
   - Page numbering: skip muka depan (muka depan ada footer band sendiri)
   - Preview UI: tambah jumlah rekod pecah, tally sekolah, atlet

✅ Olahragawan.jsx — fix getDoc is not defined
   - Tambah getDoc dalam Firestore imports

✅ Rekod badge dalam saringan (postRasmiUtils.js)
   - Buang grantMedal gate dari rekod detection
   - Rekod check untuk semua fasa (saringan + final)
   - Medal tally + mata olahragawan kekal gated by grantMedal (final sahaja)
```

### Pending:

```
⏳ Relay full e2e test live
⏳ Medal tally relay — verify "Relay P" papar betul (buildKatDetailFromTally)
⏳ CetakKeputusan canJanaFinal → update ke 'diterima'
```

### Prompt Sambung:

```
Baca KOAM_MASTER_BRIEF.md section 41.

Status deploy: mssdkemaman-olahraga.web.app
GitHub: msrab1979-ai/msddOlahragaKemaman

Selesai sesi ini:
- BukuKejohanan major overhaul: KOAM Official muka depan, medal tally, pendaftaran by sekolah, rekod dipecah, top 2
- Olahragawan getDoc fix
- Rekod badge untuk semua fasa (saringan + final)
```

---
*Versi: 9.0 — BukuKejohanan major overhaul, rekod badge saringan, Olahragawan fix. Deploy 2026-05-17.*

---

## 40. STATUS SEMASA (DIKEMASKINI — VERSI 8.0) — 2026-05-16

### Selesai sesi ini:

```
✅ Medal Tally breakdown — relay papar sebagai "Relay L/P" bukan P12
   - buildKatDetailFromTally: scan contrib_ fields
   - Detect relay: isRelay===true (data baru) ATAU noKP===null (data lama)
   - Pindah medal dari bucket individu → bucket RELAY dalam display
   - Tiada perlu re-publish — kerja dengan data Firestore lama
   - postRasmiUtils: tambah isRelay:true dalam contrib entry (data baru)
   - postRasmiUtils: katKey='RELAY' untuk kat_ field relay (data baru)

✅ Log Audit — dibuang dari sistem
   - Buang dari sidebar DashboardLayout.jsx
   - Buang route dari App.jsx
   - Buang quick link dari Dashboard.jsx

✅ PDF Cetak Hasil (InputKeputusan) — formal header dengan logo
   - Fetch tetapan/home serentak dengan rekod (Promise.all)
   - buatHeader(): logo kiri + logo kanan + nama kejohanan + KEPUTUSAN RASMI + tarikh
   - Garisan biru bawah header (sama standard StartList)
   - Label salinan (JURUHEBAH/HADIAH/FAIL) kekal, letaknya bawah header
   - Relay support: kolum jadual tukar ke Pasukan | Ahli Pasukan | Masa | Status
   - Buang field Tarikh dari info rows (dah ada dalam header)

✅ Home → Keputusan tab — badge Saringan/Final pada setiap acara row
   - peringkat === 'saringan' → badge amber "Saringan"
   - peringkat === 'akhir' + ada parentAcaraId → badge hijau "Final"
   - Acara tunggal (terus final) → tiada badge fasa
   - Data dari acara doc terus (tanpa query heat)
```

### Pending:

```
⏳ Relay full e2e test live
⏳ Medal tally relay — data lama: perlu verify "Relay P" papar betul
   selepas buildKatDetailFromTally fix (scan contrib_ noKP===null)
⏳ CetakKeputusan canJanaFinal → update ke 'diterima'
```

### Prompt Sambung:

```
Baca KOAM_MASTER_BRIEF.md section 40.

Status deploy: mssdkemaman-olahraga.web.app
GitHub: msrab1979-ai/msddOlahragaKemaman

Selesai sesi ini:
- Relay tally breakdown papar "Relay P/L" bukan P12
- Log Audit dibuang
- PDF cetak hasil formal (logo, header, relay)
- Badge Saringan/Final dalam keputusan tab
```

---
*Versi: 8.0 — Relay tally fix, Log Audit buang, PDF formal, badge Saringan/Final. Deploy 2026-05-16.*