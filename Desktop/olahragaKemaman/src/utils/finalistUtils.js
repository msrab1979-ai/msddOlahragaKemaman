/**
 * finalistUtils.js
 * ─────────────────
 * Logik pilih finalis — kongsi antara InputKeputusan, KeputusanRasmi, Home.
 *
 * Model: bestHeat + bestTime (dari tetapan/finalSetup)
 *   bestHeat = ambil N terbaik dari SETIAP heat saringan
 *   bestTime = ambil M terbaik keseluruhan sebagai wildcard (yang belum masuk)
 *
 * Gate lookup: jenisTab (larian/relay/padang) + kategoriKod + override per aceraId
 */

// ─── Lane order standard ──────────────────────────────────────────────────────
const LANE_ORDER = [4, 5, 3, 6, 2, 7, 1, 8]

// ─── Map jenisAcara → tab dalam tetapan/finalSetup ───────────────────────────
export function getJenisTab(acara) {
  if (acara.jenisAcara === 'relay') return 'relay'
  if (acara.jenisAcara === 'padang_lompat' || acara.jenisAcara === 'padang_balin') return 'padang'
  return 'larian' // lorong, mass_start
}

/**
 * Dapatkan {bestHeat, bestTime} untuk satu acara.
 * Priority: override per aceraId > default per kategori > fallback (1, 3)
 */
export function getFinalistSetup(acara, finalSetup) {
  const FALLBACK = { bestHeat: 1, bestTime: 3 }
  if (!finalSetup) return FALLBACK

  // 1. Override per acara
  const aceraId = String(acara.noAcara || acara.acaraId || acara.aceraId || acara.id || '')
  const ovr = finalSetup.overrideByAcara?.[aceraId]
  if (ovr && (ovr.bestHeat != null || ovr.bestTime != null)) {
    return { bestHeat: ovr.bestHeat ?? 1, bestTime: ovr.bestTime ?? 3 }
  }

  // 2. Default per kategori
  const jenisTab = getJenisTab(acara)
  const kat      = acara.kategoriKod || ''
  const katSetup = finalSetup[jenisTab]?.[kat]
  if (katSetup && (katSetup.bestHeat != null || katSetup.bestTime != null)) {
    return { bestHeat: katSetup.bestHeat ?? 1, bestTime: katSetup.bestTime ?? 3 }
  }

  return FALLBACK
}

/**
 * Pilih finalis dari heats saringan.
 *
 * Algorithm:
 *   Step 1 — Ambil top bestHeat dari setiap heat saringan
 *   Step 2 — Ambil top bestTime dari baki atlet sebagai wildcard
 *
 * @param {Array}  heats       - senarai heat (field: heatId|id, peserta, peringkat, statusKeputusan, noHeat)
 * @param {Object} acara       - acara doc (jenisAcara, kategoriKod, noAcara, ...)
 * @param {Object} finalSetup  - dari Firestore tetapan/finalSetup (boleh null → guna fallback)
 * @returns {Array} senarai atlet layak { noBib, namaAtlet, kodSekolah, noKP, keputusan, heatId, noHeat }
 */
export function selectFinalists(heats, acara, finalSetup) {
  const { bestHeat, bestTime } = getFinalistSetup(acara, finalSetup)
  const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
  const isRelay  = acara.jenisAcara === 'relay'

  const saringanHeats = heats.filter(h =>
    h.peringkat !== 'final' && ['rasmi', 'tidak_rasmi', 'diterima'].includes(h.statusKeputusan)
  )
  if (saringanHeats.length === 0) return []

  // Key unik: relay guna kodSekolah, individu guna noBib
  const getKey = p => isRelay ? (p.kodSekolah || 'UNKNOWN') : (p.noBib || '')

  const toEntry = (p, heat) => isRelay ? ({
    kodSekolah:  p.kodSekolah  || '',
    ahliPasukan: p.ahliPasukan || [],
    keputusan:   Number(p.keputusan),
    heatId:      heat.heatId   || heat.id || '',
    noHeat:      heat.noHeat   || 0,
  }) : ({
    noBib:      p.noBib      || '',
    namaAtlet:  p.namaAtlet  || '',
    kodSekolah: p.kodSekolah || '',
    noKP:       p.noKP       || '',
    keputusan:  Number(p.keputusan),
    heatId:     heat.heatId  || heat.id || '',
    noHeat:     heat.noHeat  || 0,
  })

  const isValid  = p => !['DNS', 'DNF', 'DQ'].includes(p.status) && Number(p.keputusan) > 0
  const sortFn   = (a, b) => isPadang ? b.keputusan - a.keputusan : a.keputusan - b.keputusan
  const selected = new Map() // key → entry

  // Step 1: top bestHeat dari setiap heat → qualifyType 'Q'
  if (bestHeat > 0) {
    saringanHeats.forEach(heat => {
      ;(heat.peserta || [])
        .filter(isValid)
        .map(p => toEntry(p, heat))
        .sort(sortFn)
        .slice(0, bestHeat)
        .forEach(a => { if (!selected.has(getKey(a))) selected.set(getKey(a), { ...a, qualifyType: 'Q' }) })
    })
  }

  // Step 2: wildcard bestTime dari baki → qualifyType 'q'
  if (bestTime > 0) {
    const wildcards = []
    saringanHeats.forEach(heat => {
      ;(heat.peserta || []).filter(isValid).forEach(p => {
        if (!selected.has(getKey(p))) wildcards.push(toEntry(p, heat))
      })
    })
    wildcards
      .sort(sortFn)
      .slice(0, bestTime)
      .forEach(a => { if (!selected.has(getKey(a))) selected.set(getKey(a), { ...a, qualifyType: 'q' }) })
  }

  return [...selected.values()]
}

/**
 * Assign lorong kepada finalis mengikut prestasi.
 * Rank 1 → lorong 4, Rank 2 → lorong 5, dst.
 */
export function assignLorong(finalists, isPadang) {
  const ranked = [...finalists].sort((a, b) =>
    isPadang ? b.keputusan - a.keputusan : a.keputusan - b.keputusan
  )
  return ranked.map((f, i) => ({ ...f, lorong: LANE_ORDER[i] || (i + 1) }))
}
