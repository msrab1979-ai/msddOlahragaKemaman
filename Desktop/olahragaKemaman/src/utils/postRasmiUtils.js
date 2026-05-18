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
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, increment,
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

  const pecahRekodMap      = {} // noKP      → peringkat (individu)
  const pecahRekodRelayMap = {} // kodSekolah → peringkat (relay)

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
  // Relay guna kodSekolah sebagai key (noBib/noKP tiada)
  const pKey = p => isRelay ? (p.kodSekolah || p.lorong) : (p.noKP || p.noBib)
  const computedRankMap = new Map()
  finishers.forEach((p, i) => {
    const prev = i > 0 && p.keputusan === finishers[i - 1].keputusan
    computedRankMap.set(pKey(p), prev ? computedRankMap.get(pKey(finishers[i - 1])) : i + 1)
  })

  // ── Loop peserta ─────────────────────────────────────────────────────────────
  for (const p of semua) {
    const rank      = computedRankMap.get(pKey(p)) || p.rankDalamHeat || null
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
      // Relay: guna kodSekolah sebagai key unik (noBib/noKP tiada)
      const contribKey = `contrib_${heatDoc.id}_${isRelay ? p.kodSekolah : (p.noKP || p.noBib || rank)}`
      try {
        await setDoc(tRef, {
          kodSekolah: p.kodSekolah, namaSekolah: getNamaSekolah(p), kejohananId: kejId,
        }, { merge: true })

        const tSnap    = await getDoc(tRef)
        const tData    = tSnap.exists() ? tSnap.data() : {}
        const prevContr = tData[contribKey]

        // Relay guna 'RELAY' sebagai katKey supaya breakdown tally papar row berasingan
        const katKey       = isRelay ? 'RELAY' : (acaraDoc.kategoriKod || '')
        const katPingat    = `kat_${katKey}_${acaraDoc.jantina}_${pingat}`
        const tPatch = { [contribKey]: { pingat, noKP: p.noKP || null, rank, kategoriKod: katKey, jantina: acaraDoc.jantina, isRelay: !!isRelay } }
        if (prevContr) {
          const prevPingat   = prevContr.pingat      || ''
          const prevKat      = prevContr.kategoriKod || katKey
          const prevJantina  = prevContr.jantina     || acaraDoc.jantina
          const prevKatField = `kat_${prevKat}_${prevJantina}_${prevPingat}`
          if (pingat !== prevPingat || prevKat !== katKey || prevJantina !== acaraDoc.jantina) {
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

    // ── Rekod detection — individu, tempat 1, semua fasa (saringan/final/terus final) ──
    const isPadangAcara = ['padang_lompat', 'padang_balin'].includes(acaraDoc.jenisAcara)
    if (
      !isRelay && rank === 1 &&
      p.keputusan != null && p.keputusan !== '' &&
      acaraDoc.jantina && acaraDoc.kategoriKod && (acaraDoc.namaAcaraPendek || acaraDoc.namaAcara)
    ) {
      try {
        const unit      = isPadangAcara ? 'm' : 's'
        const rekodNama = acaraDoc.namaAcaraPendek || acaraDoc.namaAcara

        // Cuba pelbagai key format — sama seperti rekodUtils.cariRekodUntukAcara
        // Format baru: kategoriKod (A/B/C) | Format lama: kelasDariNama (L12/P12)
        const namaPenuh  = (acaraDoc.namaAcara      || '').trim()
        const namaPendek = (acaraDoc.namaAcaraPendek || '').trim()
        const kelasDariNamaI = (namaPenuh && namaPendek && namaPenuh !== namaPendek)
          ? namaPenuh.slice(namaPendek.length).trim() : ''
        const katsToTryI = [...new Set([acaraDoc.kategoriKod, kelasDariNamaI].filter(Boolean))]

        // Cari key yang wujud dalam Firestore
        let rKey = rekodKeyStr(rekodNama, acaraDoc.jantina, acaraDoc.kategoriKod, peringkatKej)
        let rekodSnap = null, tuntutanSnap = null
        for (const kat of katsToTryI) {
          const k = rekodKeyStr(rekodNama, acaraDoc.jantina, kat, peringkatKej)
          const [rs, ts] = await Promise.all([getDoc(doc(db, 'rekod', k)), getDoc(doc(db, 'rekod', k + '_tuntutan'))])
          if (rs.exists() || ts.exists()) { rKey = k; rekodSnap = rs; tuntutanSnap = ts; break }
        }
        // Jika tiada yang jumpa — fetch primary key (return not-exists snap)
        if (!rekodSnap) {
          const [rs, ts] = await Promise.all([getDoc(doc(db, 'rekod', rKey)), getDoc(doc(db, 'rekod', rKey + '_tuntutan'))])
          rekodSnap = rs; tuntutanSnap = ts
        }
        // SENTIASA guna primary key (format baru) untuk tulis rekod baru
        // supaya PDF dan lookup seterusnya jumpa dengan tepat
        const primaryKey  = rekodKeyStr(rekodNama, acaraDoc.jantina, acaraDoc.kategoriKod, peringkatKej)
        const rekodRef    = doc(db, 'rekod', primaryKey)
        const tuntutanRef = doc(db, 'rekod', primaryKey + '_tuntutan')
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
                namaAcara:        acaraDoc.namaAcara,
                namaAcaraPendek:  acaraDoc.namaAcaraPendek || acaraDoc.namaAcara,
                kategoriKod:      acaraDoc.kategoriKod,
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
            rekodId:      primaryKey,
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

          // Tulis ke primary key (format baru) + tuntutan
          await Promise.all([
            setDoc(rekodRef, rekodData),
            setDoc(tuntutanRef, { ...rekodData, rekodId: primaryKey + '_tuntutan', rekodAsal: primaryKey }),
          ])

          // Jika rekod lama tersimpan di key lain (format lama) — padam untuk elak orphan
          if (rKey !== primaryKey) {
            await Promise.all([
              deleteDoc(doc(db, 'rekod', rKey)).catch(() => {}),
              deleteDoc(doc(db, 'rekod', rKey + '_tuntutan')).catch(() => {}),
            ])
          }
        }
      } catch (e) { console.warn('rekod_tuntutan:', e.message) }
    }

    // ── Rekod relay — semua fasa (saringan/final/terus final) ────────────────
    if (
      isRelay && rank === 1 &&
      p.keputusan != null && p.keputusan !== '' && p.kodSekolah &&
      acaraDoc.jantina && acaraDoc.kategoriKod && (acaraDoc.namaAcaraPendek || acaraDoc.namaAcara)
    ) {
      try {
        const rekodNama = acaraDoc.namaAcaraPendek || acaraDoc.namaAcara

        // Cuba pelbagai key format (sama seperti individu di atas)
        const namaPenuhR  = (acaraDoc.namaAcara      || '').trim()
        const namaPendekR = (acaraDoc.namaAcaraPendek || '').trim()
        const kelasDariNamaR = (namaPenuhR && namaPendekR && namaPenuhR !== namaPendekR)
          ? namaPenuhR.slice(namaPendekR.length).trim() : ''
        const katsToTryR = [...new Set([acaraDoc.kategoriKod, kelasDariNamaR].filter(Boolean))]

        let rKey = rekodKeyStr(rekodNama, acaraDoc.jantina, acaraDoc.kategoriKod, peringkatKej)
        let rekodSnap = null, tuntutanSnap = null
        for (const kat of katsToTryR) {
          const k = rekodKeyStr(rekodNama, acaraDoc.jantina, kat, peringkatKej)
          const [rs, ts] = await Promise.all([getDoc(doc(db, 'rekod', k)), getDoc(doc(db, 'rekod', k + '_tuntutan'))])
          if (rs.exists() || ts.exists()) { rKey = k; rekodSnap = rs; tuntutanSnap = ts; break }
        }
        if (!rekodSnap) {
          const [rs, ts] = await Promise.all([getDoc(doc(db, 'rekod', rKey)), getDoc(doc(db, 'rekod', rKey + '_tuntutan'))])
          rekodSnap = rs; tuntutanSnap = ts
        }
        // SENTIASA guna primary key untuk tulis rekod baru relay
        const primaryKeyR = rekodKeyStr(rekodNama, acaraDoc.jantina, acaraDoc.kategoriKod, peringkatKej)
        const rekodRef    = doc(db, 'rekod', primaryKeyR)
        const tuntutanRef = doc(db, 'rekod', primaryKeyR + '_tuntutan')
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
          // Tandakan pasukan ini untuk patch pecahRekod dalam heat doc
          pecahRekodRelayMap[p.kodSekolah] = peringkatKej
          const rekodLama = rekodSediaRelay ?? null
          const relayData = {
            rekodId:      primaryKeyR,
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
            setDoc(tuntutanRef, { ...relayData, rekodId: primaryKeyR + '_tuntutan', rekodAsal: primaryKeyR }),
          ])
          // Jika rekod lama di key format lama — padam untuk elak orphan
          if (rKey !== primaryKeyR) {
            await Promise.all([
              deleteDoc(doc(db, 'rekod', rKey)).catch(() => {}),
              deleteDoc(doc(db, 'rekod', rKey + '_tuntutan')).catch(() => {}),
            ])
          }
        }
      } catch (e) { console.warn('rekod_relay:', e.message) }
    }
  }

  // ── Patch peserta dalam heat doc dengan pecahRekod flag ──────────────────────
  const hasIndivRekod = Object.keys(pecahRekodMap).length > 0
  const hasRelayRekod = Object.keys(pecahRekodRelayMap).length > 0
  if (hasIndivRekod || hasRelayRekod) {
    try {
      const pesertaPatched = semua.map(p => {
        if (isRelay && pecahRekodRelayMap[p.kodSekolah])
          return { ...p, pecahRekod: pecahRekodRelayMap[p.kodSekolah] }
        if (!isRelay && pecahRekodMap[p.noKP])
          return { ...p, pecahRekod: pecahRekodMap[p.noKP] }
        return p
      })
      const hRef = doc(db, 'kejohanan', kejId, 'acara', acaraDoc.id, 'heat', heatDoc.id)
      await updateDoc(hRef, { peserta: pesertaPatched, updatedAt: serverTimestamp() })
      if (onPesertaPatch) onPesertaPatch(pesertaPatched)
    } catch (e) { console.warn('patch pecahRekod:', e.message) }
  }
}
