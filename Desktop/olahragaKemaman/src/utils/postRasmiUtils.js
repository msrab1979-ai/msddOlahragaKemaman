/**
 * postRasmiUtils.js
 * ─────────────────
 * Logic post-rasmi yang dikongsi antara KeputusanRasmi (admin) dan
 * InputKeputusan (pencatat — Option C: sahkan rasmi selepas countdown tamat).
 *
 * Fungsi utama:
 *   runPostRasmi(db, heatDoc, acaraDoc, kejId, config)
 *
 * Config:
 *   mataPingat        — { 1: 5, 2: 3, 3: 2, 4: 1 }  (dari kejohanan doc)
 *   bilanganKedudukan — bilangan kedudukan yang dapat medal_tally (default 8)
 *   peringkatKej      — 'D' | 'N' | 'K'  (peringkat kejohanan)
 *   grantMedal        — boolean (adakah heat ini layak bagi medal)
 *   isRelay           — boolean
 *   onPesertaPatch    — callback(pesertaPatched) untuk update UI state (optional)
 */

import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, increment,
} from 'firebase/firestore'

// ─── Konstanta ────────────────────────────────────────────────────────────────
const NAMA_PINGAT = { 1: 'emas', 2: 'perak', 3: 'gangsa', 4: 'tempat4', 5: 'tempat5' }
const DEFAULT_MATA_PINGAT = { 1: 5, 2: 3, 3: 2, 4: 1 }

export function rekodKeyStr(namaAcara, jantina, kategoriKod, peringkat) {
  return [namaAcara, jantina, kategoriKod, peringkat]
    .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

/**
 * Jalankan proses selepas keputusan RASMI:
 *   1. Kira rank + mata olahragawan
 *   2. Kemas kini medal_tally
 *   3. Detect rekod baru (tuntutan)
 *   4. Patch peserta dalam heat doc dengan pecahRekod flag
 */
export async function runPostRasmi(db, heatDoc, acaraDoc, kejId, config = {}) {
  const {
    mataPingat        = DEFAULT_MATA_PINGAT,
    bilanganKedudukan = 8,
    peringkatKej      = 'D',
    grantMedal        = false,
    isRelay           = acaraDoc.isRelay || acaraDoc.jenisAcara === 'relay',
    onPesertaPatch    = null,  // callback(pesertaPatched) — untuk update UI state
  } = config

  const pecahRekodMap = {} // noKP → peringkat

  // Bina map namaSekolah dari Firestore (backup untuk data lama tanpa namaSekolah)
  const kodSekolahSet = [...new Set((heatDoc.peserta || []).map(p => p.kodSekolah).filter(Boolean))]
  const sekolahNamaMap = {}
  await Promise.all(kodSekolahSet.map(async kod => {
    try {
      const snap = await getDoc(doc(db, 'sekolah', kod))
      if (snap.exists()) sekolahNamaMap[kod] = snap.data().namaSekolah || kod
    } catch { sekolahNamaMap[kod] = kod }
  }))
  const getNamaSekolah = p => p.namaSekolah || sekolahNamaMap[p.kodSekolah] || p.kodSekolah || ''

  // Kira rank dari keputusan (on-the-fly — lebih tepat dari rankDalamHeat yang mungkin lapuk)
  const isPadang = ['padang_lompat', 'padang_balin'].includes(acaraDoc.jenisAcara)
  const semua    = heatDoc.peserta || []
  const finishers = semua
    .filter(p => !['DNS','DNF','DQ'].includes(p.status) && p.keputusan != null && Number(p.keputusan) > 0)
    .sort((a, b) => isPadang ? Number(b.keputusan) - Number(a.keputusan) : Number(a.keputusan) - Number(b.keputusan))
  const computedRankMap = new Map()
  finishers.forEach((p, i) => {
    const prev = i > 0 && p.keputusan === finishers[i - 1].keputusan
    computedRankMap.set(
      p.noKP || p.noBib,
      prev ? computedRankMap.get(finishers[i - 1].noKP || finishers[i - 1].noBib) : i + 1
    )
  })

  // ── Loop peserta ─────────────────────────────────────────────────────────────
  for (const p of semua) {
    const rank      = computedRankMap.get(p.noKP || p.noBib) || p.rankDalamHeat || null
    const isFlagged = ['DNS','DNF','DQ'].includes(p.status)
    const hasResult = p.keputusan != null && Number(p.keputusan) > 0
    if (!rank || isFlagged || !hasResult) continue

    // ── Mata olahragawan (individu, bukan relay, top 4) ──────────────────────
    if (!isRelay && p.noKP && rank <= 4) {
      const mata      = mataPingat[rank] ?? 0
      const pingat    = NAMA_PINGAT[rank]
      const mId       = `${p.noKP}_${kejId}`
      const mRef      = doc(db, 'mata_olahragawan', mId)
      const unitAcara = isPadang ? 'm' : 's'
      const acaraKey  = `acaraDetail_${acaraDoc.id}`
      try {
        await setDoc(mRef, {
          noKP:        p.noKP,
          namaAtlet:   p.namaAtlet   || '',
          kodSekolah:  p.kodSekolah  || '',
          namaSekolah: getNamaSekolah(p),
          jantina:     acaraDoc.jantina    || '',
          kategoriKod: acaraDoc.kategoriKod || '',
          kejohananId: kejId,
        }, { merge: true })

        const existingSnap = await getDoc(mRef)
        const existingData = existingSnap.exists() ? existingSnap.data() : {}
        const prevDetail   = existingData[acaraKey]

        const patch = { [acaraKey]: { aceraId: acaraDoc.id, namaAcara: acaraDoc.namaAcara, pingat, mata, rank, prestasi: p.keputusan ?? null, unit: unitAcara } }
        if (prevDetail) {
          const prevMata   = prevDetail.mata   || 0
          const prevPingat = prevDetail.pingat  || ''
          if (mata !== prevMata)     patch.jumlahMata           = increment(mata - prevMata)
          if (pingat !== prevPingat) {
            patch[`pingat_${prevPingat}`] = increment(-1)
            patch[`pingat_${pingat}`]     = increment(1)
          }
        } else {
          patch.jumlahMata          = increment(mata)
          patch[`pingat_${pingat}`] = increment(1)
        }
        await updateDoc(mRef, patch)
      } catch (e) { console.warn('mata_olahragawan:', e.message) }
    }

    // ── Medal tally (per sekolah, fasa final sahaja) ─────────────────────────
    if (grantMedal && p.kodSekolah && rank <= Math.min(bilanganKedudukan, 5) && NAMA_PINGAT[rank]) {
      const pingat     = NAMA_PINGAT[rank]
      const tId        = `${p.kodSekolah}_${kejId}`
      const tRef       = doc(db, 'medal_tally', tId)
      const contribKey = `contrib_${heatDoc.id}_${p.noKP || p.noBib || rank}`
      try {
        await setDoc(tRef, {
          kodSekolah: p.kodSekolah, namaSekolah: getNamaSekolah(p), kejohananId: kejId,
        }, { merge: true })

        const tSnap    = await getDoc(tRef)
        const tData    = tSnap.exists() ? tSnap.data() : {}
        const prevContr = tData[contribKey]

        const katPingat    = `kat_${acaraDoc.kategoriKod}_${acaraDoc.jantina}_${pingat}`
        const tPatch = { [contribKey]: { pingat, noKP: p.noKP || null, rank, kategoriKod: acaraDoc.kategoriKod, jantina: acaraDoc.jantina } }
        if (prevContr) {
          const prevPingat   = prevContr.pingat      || ''
          const prevKat      = prevContr.kategoriKod || acaraDoc.kategoriKod
          const prevJantina  = prevContr.jantina     || acaraDoc.jantina
          const prevKatField = `kat_${prevKat}_${prevJantina}_${prevPingat}`
          if (pingat !== prevPingat || prevKat !== acaraDoc.kategoriKod || prevJantina !== acaraDoc.jantina) {
            tPatch[prevPingat]    = increment(-1)
            tPatch.jumlahPingat   = increment(-1)
            tPatch[prevKatField]  = increment(-1)
            tPatch[pingat]        = increment(1)
            tPatch.jumlahPingat   = increment(1)
            tPatch[katPingat]     = increment(1)
          }
        } else {
          tPatch[pingat]      = increment(1)
          tPatch.jumlahPingat = increment(1)
          tPatch[katPingat]   = increment(1)
        }
        await updateDoc(tRef, tPatch)
      } catch (e) { console.warn('medal_tally:', e.message) }
    }

    // ── Rekod detection — individu, tempat 1, fasa final sahaja ─────────────
    const isPadangAcara = ['padang_lompat', 'padang_balin'].includes(acaraDoc.jenisAcara)
    if (
      grantMedal && !isRelay && rank === 1 &&
      p.keputusan != null && p.keputusan !== '' &&
      acaraDoc.namaAcara && acaraDoc.jantina && acaraDoc.kategoriKod
    ) {
      try {
        const unit        = isPadangAcara ? 'm' : 's'
        const rKey        = rekodKeyStr(acaraDoc.namaAcara, acaraDoc.jantina, acaraDoc.kategoriKod, peringkatKej)
        const rekodRef    = doc(db, 'rekod', rKey)
        const tuntutanRef = doc(db, 'rekod', rKey + '_tuntutan')
        const [rekodSnap, tuntutanSnap] = await Promise.all([getDoc(rekodRef), getDoc(tuntutanRef)])
        const newPrestasi = Number(p.keputusan)

        // Semak rekod sedia ada — dari rekodRef (aktif) atau tuntutanRef (aktif/tuntutan)
        const rekodSedia = rekodSnap.exists() && rekodSnap.data().statusRekod === 'aktif'
          ? rekodSnap.data()
          : tuntutanSnap.exists() && tuntutanSnap.data().catatanKhas?.includes?.(heatDoc.id) !== true
            ? tuntutanSnap.data()
            : null

        let isBetter = false
        if (rekodSedia) {
          const oldPrestasi = Number(rekodSedia.prestasi)
          isBetter = unit === 's' ? newPrestasi < oldPrestasi : newPrestasi > oldPrestasi
        } else {
          isBetter = true // rekod pertama untuk acara ini
        }

        if (isBetter) {
          const today    = new Date().toISOString().split('T')[0]
          if (p.noKP) pecahRekodMap[p.noKP] = peringkatKej

          // Simpan dalam mata_olahragawan untuk paparan Olahragawan
          if (p.noKP) {
            const rekodLama = rekodSedia ?? null
            await setDoc(doc(db, 'mata_olahragawan', `${p.noKP}_${kejId}`), {
              [`rekod_${acaraDoc.id}`]: {
                namaAcara:    acaraDoc.namaAcara,
                kategoriKod:  acaraDoc.kategoriKod,
                jantina:      acaraDoc.jantina,
                peringkat:    peringkatKej,
                unit,
                prestasiBaru: Number(p.keputusan),
                tarikhBaru:   today,
                prestasiLama: rekodLama ? Number(rekodLama.prestasi) : null,
                tahunLama:    rekodLama ? String(rekodLama.tarikhRekod || '').slice(0, 4) : null,
                namaLama:     rekodLama?.namaAtlet   || null,
                lokasiLama:   rekodLama?.namaSekolah || rekodLama?.namaDaerah || rekodLama?.namaNegeri || null,
                catatanLama:  rekodLama?.catatanKhas || null,
              },
            }, { merge: true }).catch(() => {})
          }

          const rekodData = {
            rekodId:      rKey,
            namaAcara:    acaraDoc.namaAcara,
            jantina:      acaraDoc.jantina,
            kategoriKod:  acaraDoc.kategoriKod,
            peringkat:    peringkatKej,
            noKP:         p.noKP    || '',
            namaAtlet:    p.namaAtlet  || '',
            kodSekolah:   p.kodSekolah || '',
            namaSekolah:  getNamaSekolah(p),
            prestasi:     newPrestasi,
            unit,
            windSpeed:    heatDoc.windSpeed  ?? null,
            isWindLegal:  heatDoc.isWindLegal ?? true,
            jenisRekod:   'elektronik',
            statusRekod:  'aktif',
            tarikhRekod:  today,
            kejohananId:  kejId,
            prestasiLama: rekodSedia ? Number(rekodSedia.prestasi) : null,
            tahunLama:    rekodSedia ? String(rekodSedia.tarikhRekod || '').slice(0, 4) : null,
            namaLama:     rekodSedia?.namaAtlet   || null,
            lokasiLama:   rekodSedia?.namaSekolah || rekodSedia?.namaDaerah || null,
            updatedAt:    serverTimestamp(),
          }

          // Tulis terus ke rekod/{key} (aktif) + rekod/{key}_tuntutan (untuk keserasian)
          await Promise.all([
            setDoc(rekodRef, rekodData),
            setDoc(tuntutanRef, { ...rekodData, rekodId: rKey + '_tuntutan', rekodAsal: rKey }),
          ])
        }
      } catch (e) { console.warn('rekod_tuntutan:', e.message) }
    }

    // ── Rekod relay ───────────────────────────────────────────────────────────
    if (
      grantMedal && isRelay && rank === 1 &&
      p.keputusan != null && p.keputusan !== '' && p.kodSekolah &&
      acaraDoc.namaAcara && acaraDoc.jantina && acaraDoc.kategoriKod
    ) {
      try {
        const rKey        = rekodKeyStr(acaraDoc.namaAcara, acaraDoc.jantina, acaraDoc.kategoriKod, peringkatKej)
        const rekodRef    = doc(db, 'rekod', rKey)
        const tuntutanRef = doc(db, 'rekod', rKey + '_tuntutan')
        const [rekodSnap, tuntutanSnap] = await Promise.all([getDoc(rekodRef), getDoc(tuntutanRef)])
        const newPrestasi = Number(p.keputusan)

        const rekodSediaRelay = rekodSnap.exists() && rekodSnap.data().statusRekod === 'aktif'
          ? rekodSnap.data()
          : tuntutanSnap.exists() ? tuntutanSnap.data() : null

        let isBetter = false
        if (rekodSediaRelay) {
          isBetter = newPrestasi < Number(rekodSediaRelay.prestasi)
        } else {
          isBetter = true
        }

        if (isBetter) {
          const today     = new Date().toISOString().split('T')[0]
          const rekodLama = rekodSediaRelay ?? null
          const relayData = {
            rekodId:      rKey,
            namaAcara:    acaraDoc.namaAcara,
            jantina:      acaraDoc.jantina,
            kategoriKod:  acaraDoc.kategoriKod,
            peringkat:    peringkatKej,
            noKP:         null,
            namaAtlet:    getNamaSekolah(p),
            kodSekolah:   p.kodSekolah || '',
            namaSekolah:  getNamaSekolah(p),
            prestasi:     newPrestasi,
            unit:         's',
            isRelay:      true,
            windSpeed:    null,
            isWindLegal:  true,
            jenisRekod:   'elektronik',
            statusRekod:  'aktif',
            tarikhRekod:  today,
            kejohananId:  kejId,
            prestasiLama: rekodLama ? Number(rekodLama.prestasi) : null,
            tahunLama:    rekodLama ? String(rekodLama.tarikhRekod || '').slice(0, 4) : null,
            namaLama:     rekodLama?.namaAtlet  || null,
            lokasiLama:   rekodLama?.namaSekolah || null,
            updatedAt:    serverTimestamp(),
          }
          await Promise.all([
            setDoc(rekodRef, relayData),
            setDoc(tuntutanRef, { ...relayData, rekodId: rKey + '_tuntutan', rekodAsal: rKey }),
          ])
        }
      } catch (e) { console.warn('rekod_relay:', e.message) }
    }
  }

  // ── Patch peserta dalam heat doc dengan pecahRekod flag ──────────────────────
  if (Object.keys(pecahRekodMap).length > 0) {
    try {
      const pesertaPatched = semua.map(p =>
        pecahRekodMap[p.noKP] ? { ...p, pecahRekod: pecahRekodMap[p.noKP] } : p
      )
      const hRef = doc(db, 'kejohanan', kejId, 'acara', acaraDoc.id, 'heat', heatDoc.id)
      await updateDoc(hRef, { peserta: pesertaPatched, updatedAt: serverTimestamp() })
      if (onPesertaPatch) onPesertaPatch(pesertaPatched)
    } catch (e) { console.warn('patch pecahRekod:', e.message) }
  }
}
