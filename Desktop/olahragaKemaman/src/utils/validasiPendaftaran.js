/**
 * validasiPendaftaran.js
 * ─────────────────────
 * 7-gate validation engine untuk pendaftaran atlet ke acara.
 *
 * SEMUA had dibaca secara LIVE dari Firestore.
 * Admin ubah had dalam DB → sistem ikut automatik.
 * Tiada nilai hardcode dalam fungsi ini.
 *
 * GATE 1 — key: noKP
 *   Had: kategori/{kategoriId}.hadAcaraIndividu + hadAcaraBeregu
 *   Semak bilangan acara individu & relay yang atlet sudah daftar.
 *
 * GATE 2 — key: kodSekolah + aceraId
 *   Had: acara/{aceraId}.hadAtletPerSekolah (dalam sub-collection kejohanan)
 *   Semak bilangan atlet sekolah yang sudah daftar acara yang sama.
 *
 * GATE 3 — key: noKP + tarikhLahir
 *   Had: kategori/{kategoriId}.tahunLahirMin + tahunLahirMax
 *   Kira dari TAHUN LAHIR sahaja (standard WA — bukan tarikh tepat).
 *
 * GATE 4 — key: noKP + jantina
 *   Sumber: atlet/{noKP}.jantina vs acara.jantina dari Firestore
 *
 * GATE 5 — key: kodSekolah + kategoriAcara
 *   Sumber: sekolah/{kodSekolah}.kategori vs acara.kategori dari Firestore
 *
 * GATE 6 — key: noKP + aceraId + kejohananId
 *   Duplikasi: semak pendaftaran wujud untuk kombinasi ini.
 *
 * GATE 7 — key: noKP + jadualId
 *   Sumber: jadual_acara — semak masa bertindih dengan acara sedia ada.
 *
 * GATE 8 — key: aceraId + kejohananId
 *   Semak sama ada heat sudah dijana — jika ya, pendaftaran ditutup.
 *
 * Return format:
 *   { valid: boolean, gate: string, mesej: string, had: number, semasa: number }
 */

import { db } from '../firebase/config'
import {
  collection, query, where,
  getDocs, getDoc, doc, getCountFromServer,
} from 'firebase/firestore'

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function masaKeMinit(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return null
  return h * 60 + m
}

function tambahMinit(masa, minit) {
  const [h, m] = masa.split(':').map(Number)
  const jumlah = h * 60 + m + minit
  return `${String(Math.floor(jumlah / 60)).padStart(2, '0')}:${String(jumlah % 60).padStart(2, '0')}`
}

// ─── GATE 1 — Had Acara Per Atlet ─────────────────────────────────────────────

async function gate1_hadAcaraAtlet(noKP, kejohananId, kategoriId, jenisAcaraBaru) {
  // Baca had LIVE dari Firestore — kategori/{kategoriId}
  const katDoc = await getDoc(doc(db, 'kategori', kategoriId))
  const hadIndividu = katDoc.exists() ? (katDoc.data().hadAcaraIndividu ?? 2) : 2
  const hadBeregu   = katDoc.exists() ? (katDoc.data().hadAcaraBeregu   ?? 2) : 2

  // Semak pendaftaran atlet dalam kejohanan ini
  const pendSnap = await getDocs(
    query(
      collection(db, 'kejohanan', kejohananId, 'pendaftaran'),
      where('noKP', '==', noKP),
    )
  )

  // Kumpul semua aceraId yang sudah didaftar
  const semuaAceraIds = []
  pendSnap.docs.forEach(d => (d.data().acaraIds || []).forEach(id => semuaAceraIds.push(id)))

  if (semuaAceraIds.length === 0) {
    const isRelay = jenisAcaraBaru === 'relay'
    return { valid: true, had: isRelay ? hadBeregu : hadIndividu, semasa: 0 }
  }

  // Dapatkan jenisAcara bagi setiap aceraId — untuk kira individu vs beregu
  const acaraDocs = await Promise.all(
    semuaAceraIds.map(id => getDoc(doc(db, 'kejohanan', kejohananId, 'acara', id)))
  )

  let bilanganIndividu = 0
  let bilanganBeregu   = 0
  acaraDocs.forEach(d => {
    if (!d.exists()) return
    // Kira hanya acara dalam KATEGORI yang sama — atlet Open boleh daftar
    // walaupun sudah penuh kuota individu dalam kategori lain (cth: Kat A).
    if (d.data().kategoriKod !== kategoriId) return
    d.data().jenisAcara === 'relay' ? bilanganBeregu++ : bilanganIndividu++
  })

  const isRelay = jenisAcaraBaru === 'relay'

  if (isRelay) {
    if (bilanganBeregu >= hadBeregu) {
      return {
        valid: false,
        gate: 'GATE1',
        mesej: `Atlet sudah mencapai had ${hadBeregu} acara berkumpulan (relay).`,
        had: hadBeregu,
        semasa: bilanganBeregu,
      }
    }
  } else {
    if (bilanganIndividu >= hadIndividu) {
      return {
        valid: false,
        gate: 'GATE1',
        mesej: `Atlet sudah mencapai had ${hadIndividu} acara individu.`,
        had: hadIndividu,
        semasa: bilanganIndividu,
      }
    }
  }

  return {
    valid: true,
    had: isRelay ? hadBeregu : hadIndividu,
    semasa: isRelay ? bilanganBeregu : bilanganIndividu,
  }
}

// ─── GATE 2 — Had Atlet Per Sekolah Per Acara ─────────────────────────────────

async function gate2_hadAtletSekolah(kodSekolah, aceraId, kejohananId) {
  // Baca had LIVE dari Firestore — acara/{aceraId}
  const acaraDoc = await getDoc(doc(db, 'kejohanan', kejohananId, 'acara', aceraId))
  const aData = acaraDoc.exists() ? acaraDoc.data() : {}

  // Relay: had = saizPasukan × hadPasukan (dari kategori) — bukan hadAtletPerSekolah
  let hadPerSekolah = aData.hadAtletPerSekolah ?? 2
  if (aData.jenisAcara === 'relay' && aData.kategoriKod) {
    const katDoc = await getDoc(doc(db, 'kategori', aData.kategoriKod))
    if (katDoc.exists()) {
      const kat = katDoc.data()
      const saizPasukan = Number(kat.saizPasukan) || 4
      const hadPasukan  = aData.jantina === 'P'
        ? (Number(kat.hadPasukanP) || 1)
        : (Number(kat.hadPasukanL) || 1)
      hadPerSekolah = saizPasukan * hadPasukan
    }
  }

  // Semak bilangan atlet sekolah yang sudah daftar acara ini
  const pendSnap = await getDocs(
    query(
      collection(db, 'kejohanan', kejohananId, 'pendaftaran'),
      where('kodSekolah', '==', kodSekolah),
    )
  )

  const semasa = pendSnap.docs
    .filter(d => (d.data().acaraIds || []).includes(aceraId))
    .length

  if (semasa >= hadPerSekolah) {
    return {
      valid: false,
      gate: 'GATE2',
      mesej: `Had atlet sekolah ini untuk acara ini sudah penuh. Maks ${hadPerSekolah} atlet per sekolah.`,
      had: hadPerSekolah,
      semasa,
    }
  }

  return { valid: true, had: hadPerSekolah, semasa }
}

// ─── GATE 3 — Kelayakan Umur (WA Standard) ────────────────────────────────────
//
// KategoriSetup simpan: umurMin (cth: 9) + umurHad (cth: 10) — nilai UMUR
// Gate ini tukar kepada tahun lahir ikut tahunKejohanan:
//   tahunLahirMin = tahunKejohanan - umurHad  ← lahir paling awal (paling tua)
//   tahunLahirMax = tahunKejohanan - umurMin  ← lahir paling lewat (paling muda)
// Contoh: Kat A (umurMin=9, umurHad=10), tahun 2026:
//   tahunLahirMin = 2026 - 10 = 2016
//   tahunLahirMax = 2026 - 9  = 2017
//   → atlet lahir 2016 atau 2017 sahaja layak

async function gate3_kelayakanUmur(tarikhLahir, kategoriId, tahunKejohanan) {
  // Baca had LIVE dari Firestore — kategori/{kategoriId}
  const katDoc = await getDoc(doc(db, 'kategori', kategoriId))

  // Kategori belum dikonfigurasi — lulus (fail-open)
  if (!katDoc.exists()) return { valid: true }

  const { umurMin, umurHad } = katDoc.data()

  // Tiada had umur dikonfigurasi → lulus
  if (!umurHad) return { valid: true }

  // Kira julat tahun lahir dari tahunKejohanan (WA standard — ikut TAHUN bukan tarikh)
  const tKej         = tahunKejohanan || new Date().getFullYear()
  const tahunLahirMin = tKej - Number(umurHad)           // paling awal (paling tua)
  const tahunLahirMax = umurMin ? tKej - Number(umurMin) : tKej  // paling lewat (paling muda)

  const tahunLahir = new Date(tarikhLahir).getFullYear()

  if (tahunLahir < tahunLahirMin || tahunLahir > tahunLahirMax) {
    return {
      valid: false,
      gate: 'GATE3',
      mesej: `Atlet tidak layak mengikut umur untuk kategori ${kategoriId}. ` +
             `Lahir ${tahunLahir} — mestilah antara ${tahunLahirMin}–${tahunLahirMax} ` +
             `(umur ${umurMin ?? '?'}–${umurHad} tahun pada ${tKej}).`,
      had: tahunLahirMax,
      semasa: tahunLahir,
    }
  }

  return { valid: true, had: tahunLahirMax, semasa: tahunLahir }
}

// ─── GATE 4 — Jantina ─────────────────────────────────────────────────────────

async function gate4_jantina(noKP, aceraId, kejohananId) {
  // Baca jantina atlet LIVE dari Firestore
  const atletDoc = await getDoc(doc(db, 'atlet', noKP))
  if (!atletDoc.exists()) {
    return {
      valid: false,
      gate: 'GATE4',
      mesej: 'Rekod atlet tidak ditemui dalam sistem.',
      had: 0,
      semasa: 0,
    }
  }
  const jantinaAtlet = atletDoc.data().jantina

  // Baca jantina acara LIVE dari Firestore
  const acaraDoc = await getDoc(doc(db, 'kejohanan', kejohananId, 'acara', aceraId))
  if (!acaraDoc.exists()) {
    return {
      valid: false,
      gate: 'GATE4',
      mesej: 'Acara tidak ditemui dalam sistem.',
      had: 0,
      semasa: 0,
    }
  }
  const jantinaAcara = acaraDoc.data().jantina

  // Acara campuran — semua jantina dibenarkan
  if (jantinaAcara === 'campuran') return { valid: true }

  if (jantinaAtlet !== jantinaAcara) {
    const label = { L: 'Lelaki', P: 'Perempuan' }
    return {
      valid: false,
      gate: 'GATE4',
      mesej: `Jantina tidak sepadan. Acara ini untuk ${label[jantinaAcara] || jantinaAcara} sahaja.`,
      had: 0,
      semasa: 0,
    }
  }

  return { valid: true }
}

// ─── GATE 5 — Kategori Sekolah ────────────────────────────────────────────────
//
// Acara doc TIDAK ada field `kategori` (jenis sekolah SR/SM/PPKI).
// Dapatkan jenisSekolah acara dengan cara:
//   1. Baca kategoriKod dari acara (A/B/C/D/E/PPKI)
//   2. Cari kategori/{kategoriKod}.jenisSekolah (SR/SM/PPKI)
// Kemudian bandingkan dengan sekolah.kategori.

async function gate5_kategoriSekolah(kodSekolah, aceraId, kejohananId) {
  // Baca kategori sekolah LIVE dari Firestore
  const sekolahDoc = await getDoc(doc(db, 'sekolah', kodSekolah))
  const kategoriSekolah = sekolahDoc.exists() ? sekolahDoc.data().kategori : null

  // Tiada data sekolah — bagi lulus (fail-open)
  if (!kategoriSekolah) return { valid: true }

  // Baca acara untuk dapat kategoriKod
  const acaraDoc = await getDoc(doc(db, 'kejohanan', kejohananId, 'acara', aceraId))
  if (!acaraDoc.exists()) return { valid: true }

  const kategoriKodAcara = acaraDoc.data().kategoriKod  // A | B | C | D | E | PPKI

  // Dapatkan jenisSekolah dari kategori collection
  const katDoc = await getDoc(doc(db, 'kategori', kategoriKodAcara))
  const jenisSekolahAcara = katDoc.exists() ? katDoc.data().jenisSekolah : null

  // Kategori tidak dikonfigurasi atau gabungan — lulus
  if (!jenisSekolahAcara || jenisSekolahAcara === 'gabungan') return { valid: true }

  if (kategoriSekolah !== jenisSekolahAcara) {
    const katLabel = { A:'B10',B:'B12',C:'B14',D:'B16',E:'B18',PPKI:'PPKI' }
    return {
      valid: false,
      gate: 'GATE5',
      mesej: `Sekolah ${kategoriSekolah} tidak boleh mendaftar acara ${jenisSekolahAcara} ` +
             `(Kategori ${katLabel[kategoriKodAcara] || kategoriKodAcara}).`,
      had: 0,
      semasa: 0,
    }
  }

  return { valid: true }
}

// ─── GATE 6 — Duplikasi ───────────────────────────────────────────────────────

async function gate6_duplikasi(noKP, aceraId, kejohananId) {
  const pendSnap = await getDocs(
    query(
      collection(db, 'kejohanan', kejohananId, 'pendaftaran'),
      where('noKP', '==', noKP),
    )
  )

  const sudahDaftar = pendSnap.docs.some(d => (d.data().acaraIds || []).includes(aceraId))

  if (sudahDaftar) {
    return {
      valid: false,
      gate: 'GATE6',
      mesej: 'Atlet sudah berdaftar untuk acara ini.',
      had: 1,
      semasa: 1,
    }
  }

  return { valid: true }
}

// ─── GATE 7 — Konflik Jadual ──────────────────────────────────────────────────
//
// Acara doc TIDAK ada field `jadualId`.
// Jadual disimpan dalam `jadual_acara/{kejohananId}-{aceraId}` (format dari JadualSetup).
// Baca terus menggunakan format ID tersebut.

async function gate7_konflikJadual(noKP, aceraId, kejohananId) {
  // Baca jadual acara baru terus dari jadual_acara collection
  const jadualDocId = `${kejohananId}-${aceraId}`
  const jadualBaruDoc = await getDoc(doc(db, 'jadual_acara', jadualDocId))

  // Tiada jadual ditetapkan — tiada konflik yang boleh dikesan
  if (!jadualBaruDoc.exists()) return { valid: true }

  const jadualBaru = jadualBaruDoc.data()
  if (!jadualBaru.tarikhAcara || !jadualBaru.masaMula) return { valid: true }
  if (jadualBaru.statusJadual === 'batal') return { valid: true }

  const startBaru = masaKeMinit(jadualBaru.masaMula)
  if (startBaru === null) return { valid: true }
  const endBaru = startBaru + (jadualBaru.masaJangka || 60)

  // Dapatkan semua acara yang atlet sudah daftar
  const pendSnap = await getDocs(
    query(
      collection(db, 'kejohanan', kejohananId, 'pendaftaran'),
      where('noKP', '==', noKP),
    )
  )

  const semuaAceraIds = []
  pendSnap.docs.forEach(d => (d.data().acaraIds || []).forEach(id => semuaAceraIds.push(id)))

  if (semuaAceraIds.length === 0) return { valid: true }

  // Baca jadual bagi setiap acara sedia ada — format: {kejId}-{aceraId}
  const jadualSediaDocs = await Promise.all(
    semuaAceraIds.map(id => getDoc(doc(db, 'jadual_acara', `${kejohananId}-${id}`)))
  )

  for (let i = 0; i < jadualSediaDocs.length; i++) {
    const jDoc = jadualSediaDocs[i]
    if (!jDoc.exists()) continue

    const j = jDoc.data()
    // Berbeza tarikh — tiada konflik
    if (!j.tarikhAcara || j.tarikhAcara !== jadualBaru.tarikhAcara) continue
    // Acara batal — abaikan
    if (j.statusJadual === 'batal') continue
    // Acara yang sama — abaikan (akan ditangkap Gate 6)
    if (semuaAceraIds[i] === aceraId) continue

    const startSedia = masaKeMinit(j.masaMula)
    if (startSedia === null) continue
    const endSedia = startSedia + (j.masaJangka || 60)

    // Semak pertindihan masa — WARN sahaja, tidak sekat
    if (startBaru < endSedia && endBaru > startSedia) {
      const namaAcaraSedia = j.namaAcara || semuaAceraIds[i]
      const masaKonflik = `${j.masaMula}–${tambahMinit(j.masaMula, j.masaJangka || 60)}`
      return {
        valid: true,
        warning: `Amaran: Konflik jadual dengan "${namaAcaraSedia}" ` +
                 `pada ${jadualBaru.tarikhAcara}, jam ${masaKonflik}. ` +
                 `Pendaftaran masih boleh diteruskan.`,
        gate: 'GATE7',
      }
    }
  }

  return { valid: true }
}

// ─── GATE 8 — Heat Sudah Dijana ───────────────────────────────────────────────

async function gate8_heatSudahDijana(aceraId, kejohananId) {
  const snap = await getCountFromServer(
    collection(db, 'kejohanan', kejohananId, 'acara', aceraId, 'heat')
  )
  if (snap.data().count > 0) {
    return {
      valid: false,
      gate: 'GATE8',
      mesej: 'Pendaftaran ditutup — heat sudah dijana untuk acara ini. Hubungi admin untuk membuat perubahan.',
      had: 0,
      semasa: snap.data().count,
    }
  }
  return { valid: true }
}

// ─── Fungsi Utama ─────────────────────────────────────────────────────────────

/**
 * Validasi lengkap pendaftaran atlet ke acara.
 * Semua had dibaca secara live dari Firestore — tiada nilai hardcode.
 *
 * @param {object} params
 * @param {string} params.noKP            - No. Kad Pengenalan atlet
 * @param {string} params.tarikhLahir     - Tarikh lahir atlet (YYYY-MM-DD)
 * @param {string} params.kodSekolah      - Kod sekolah atlet
 * @param {string} params.kejohananId     - ID kejohanan
 * @param {string} params.aceraId         - ID acara baru yang hendak didaftar
 * @param {string} params.kategoriId      - Kod kategori acara (A|B|C|D|E|PPKI)
 * @param {string} params.jenisAcara      - Jenis acara ('relay' atau lain-lain)
 * @param {number} params.tahunKejohanan  - Tahun kejohanan — untuk kira kelayakan umur (Gate 3)
 * @returns {Promise<{valid: boolean, gate: string, mesej: string, had: number, semasa: number}>}
 */
export async function validasiPendaftaran({
  noKP,
  tarikhLahir,
  kodSekolah,
  kejohananId,
  aceraId,
  kategoriId,
  jenisAcara,
  tahunKejohanan,
}) {
  let result

  // GATE 1 — Had acara per atlet (individu + berkumpulan)
  result = await gate1_hadAcaraAtlet(noKP, kejohananId, kategoriId, jenisAcara)
  if (!result.valid) return result

  // GATE 2 — Had atlet per sekolah per acara
  result = await gate2_hadAtletSekolah(kodSekolah, aceraId, kejohananId)
  if (!result.valid) return result

  // GATE 3 — Kelayakan umur (WA standard — ikut tahun lahir)
  result = await gate3_kelayakanUmur(tarikhLahir, kategoriId, tahunKejohanan)
  if (!result.valid) return result

  // GATE 4 — Jantina match
  result = await gate4_jantina(noKP, aceraId, kejohananId)
  if (!result.valid) return result

  // GATE 5 — Kategori sekolah match acara
  result = await gate5_kategoriSekolah(kodSekolah, aceraId, kejohananId)
  if (!result.valid) return result

  // GATE 6 — Duplikasi check
  result = await gate6_duplikasi(noKP, aceraId, kejohananId)
  if (!result.valid) return result

  // GATE 7 — Konflik jadual (warn sahaja — tidak sekat)
  let gate7Warning = null
  result = await gate7_konflikJadual(noKP, aceraId, kejohananId)
  if (result.warning) gate7Warning = result.warning

  // GATE 8 — Heat sudah dijana (pendaftaran ditutup)
  result = await gate8_heatSudahDijana(aceraId, kejohananId)
  if (!result.valid) return result

  return { valid: true, gate: '', mesej: '', had: 0, semasa: 0, warning: gate7Warning }
}

/**
 * Dapatkan status slot acara untuk sebuah sekolah.
 * Untuk badge "X/Y slot" atau "PENUH" dalam UI.
 * Baca live dari Firestore.
 *
 * @param {string} kodSekolah
 * @param {string} aceraId
 * @param {string} kejohananId
 * @returns {Promise<{semasa: number, had: number, penuh: boolean, slotBaki: number}>}
 */
export async function dapatSlotAcara(kodSekolah, aceraId, kejohananId) {
  const [acaraDoc, pendSnap] = await Promise.all([
    getDoc(doc(db, 'kejohanan', kejohananId, 'acara', aceraId)),
    getDocs(
      query(
        collection(db, 'kejohanan', kejohananId, 'pendaftaran'),
        where('kodSekolah', '==', kodSekolah),
      )
    ),
  ])

  const had    = acaraDoc.exists() ? (acaraDoc.data().hadAtletPerSekolah ?? 2) : 2
  const semasa = pendSnap.docs.filter(d => (d.data().acaraIds || []).includes(aceraId)).length
  const slotBaki = had - semasa

  return { semasa, had, penuh: semasa >= had, slotBaki }
}
