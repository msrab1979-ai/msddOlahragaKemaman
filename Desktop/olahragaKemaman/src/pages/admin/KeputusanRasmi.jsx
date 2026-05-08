/**
 * KeputusanRasmi — /dashboard/rasmi
 *
 * Aliran: TIDAK_RASMI → Countdown → AUTO RASMI (atau override)
 *         Jika ada bantahan → DALAM_BANTAHAN → Terima/Tolak
 * Post-rasmi: tulis mata_olahragawan + medal_tally
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  collection, getDocs, getDoc, doc, updateDoc, addDoc, setDoc,
  query, orderBy, where, serverTimestamp, Timestamp, increment, runTransaction,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'

// ─── Konstanta ────────────────────────────────────────────────────────────────

const MATA_PINGAT = { 1: 5, 2: 3, 3: 2, 4: 1 }
const NAMA_PINGAT = { 1: 'emas', 2: 'perak', 3: 'gangsa', 4: 'tempat4', 5: 'tempat5' }
const TEMPOH_OPT  = [
  { label: '30 Minit', nilai: 30 },
  { label: '1 Jam',    nilai: 60 },
  { label: '2 Jam',    nilai: 120 },
]
function rekodKeyStr(namaAcara, jantina, kategoriKod, peringkat) {
  return [namaAcara, jantina, kategoriKod, peringkat]
    .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

const FASA_LABEL = {
  heat: 'Heat', final: 'Final', saringan: 'Saringan',
  separuh_akhir: 'Separuh Akhir', terus_final: 'Final',
}
const STATUS_COLOR = {
  selesai: 'bg-green-50 text-green-700 border-green-200',
  DNS:     'bg-gray-50  text-gray-500  border-gray-200',
  DNF:     'bg-amber-50 text-amber-700 border-amber-200',
  DQ:      'bg-red-50   text-red-700   border-red-200',
  FS:      'bg-orange-50 text-orange-700 border-orange-200',
  NM:      'bg-slate-50 text-slate-500 border-slate-200',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSaat(s) {
  if (s === null || s === undefined) return '—'
  const v = Number(s)
  if (v < 60) return v.toFixed(2) + 's'
  const m = Math.floor(v / 60)
  const ss = (v - m * 60).toFixed(2).padStart(5, '0')
  return `${m}:${ss}`
}

function formatMeter(m) {
  if (m === null || m === undefined) return '—'
  return Number(m).toFixed(2) + 'm'
}

function formatCountdown(secs) {
  if (secs <= 0) return '00:00'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}j ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatTarikh(ts) {
  if (!ts) return '—'
  const d = ts?.toDate?.() || new Date(ts)
  return d.toLocaleString('ms-MY', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const cls = {
  select: 'w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-white disabled:bg-gray-50 disabled:text-gray-400',
  input:  'w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-white',
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function KeputusanRasmi() {
  const { userRole, userData } = useAuth()

  const isSuperadmin     = userRole === 'superadmin'
  const isPengurusTeknik = userRole === 'pengurus_teknik'
  const isAdmin          = ['admin', 'pengurus_pasukan'].includes(userRole)
  const canRasmi         = isSuperadmin || isPengurusTeknik
  const canBantah        = isAdmin || isSuperadmin
  const kodSekolahUser   = userData?.kodSekolah || null

  // ── Selectors ──────────────────────────────────────────────────────────────
  const [selKej,        setSelKej]        = useState('')
  const [namaKej,       setNamaKej]       = useState('')
  const [peringkatKej,  setPeringkatKej]  = useState('D') // D | N | K — ikut kejohanan
  const [acaraList,     setAcaraList]     = useState([])
  const [selAcara,      setSelAcara]      = useState('')
  const [heatList,      setHeatList]      = useState([])
  const [selHeat,       setSelHeat]       = useState('')

  // ── Data ───────────────────────────────────────────────────────────────────
  const [heat,         setHeat]         = useState(null)
  const [acara,        setAcara]        = useState(null)
  const [bantahanList, setBantahanList] = useState([])

  // ── Countdown ──────────────────────────────────────────────────────────────
  const [remainSecs,  setRemainSecs]  = useState(null)
  const intervalRef                   = useRef(null)
  const autoRasmiDone                 = useRef(false)

  // ── Medal Tally & Mata Pingat setting ─────────────────────────────────────
  const [bilanganKedudukan, setBilanganKedudukan] = useState(3)
  // mataPingatKej: map tempat → mata, dimuatkan dari kejohanan doc (fallback hardcode)
  const [mataPingatKej, setMataPingatKej] = useState({ 1: 5, 2: 3, 3: 2, 4: 1 })

  // Muatkan dari tetapan/home sebagai fallback global
  useEffect(() => {
    getDoc(doc(db, 'tetapan', 'home'))
      .then(s => {
        if (s.exists() && s.data().bilanganKedudukan != null) {
          setBilanganKedudukan(s.data().bilanganKedudukan)
        }
      })
      .catch(() => {})
  }, [])

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [tempohPilih,    setTempohPilih]    = useState(30)
  const [savingRasmi,    setSavingRasmi]    = useState(false)
  const [bantahanModal,  setBantahanModal]  = useState(false)
  const [bantahanForm,   setBantahanForm]   = useState({ sebab: '', noBib: '' })
  const [savingBantahan, setSavingBantahan] = useState(false)
  const [savingPutusan,  setSavingPutusan]  = useState(null)
  const [msg,            setMsg]            = useState(null)

  // Mapping peringkat kejohanan (lowercase) → kod rekod (uppercase)
  const PERINGKAT_KOD = { daerah: 'D', negeri: 'N', kebangsaan: 'K' }

  // ─── Load kejohanan aktif ──────────────────────────────────────────────────

  useEffect(() => {
    getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif')))
      .then(snap => {
        if (!snap.empty) {
          const d = snap.docs[0]
          const kd = d.data()
          setSelKej(d.id)
          setNamaKej(kd.namaKejohanan || '')
          // Peringkat → kod rekod
          const pKod = PERINGKAT_KOD[kd.peringkat] || 'D'
          setPeringkatKej(pKod)
          // Bilangan kedudukan dari kejohanan doc (override global tetapan/home)
          if (kd.bilanganKedudukan != null) setBilanganKedudukan(kd.bilanganKedudukan)
          // Mata pingat dari kejohanan doc (override hardcode)
          if (kd.mataPingat) {
            const mp = kd.mataPingat
            setMataPingatKej({
              1: Number(mp[1] ?? mp['1'] ?? 5),
              2: Number(mp[2] ?? mp['2'] ?? 3),
              3: Number(mp[3] ?? mp['3'] ?? 2),
              4: Number(mp[4] ?? mp['4'] ?? 1),
            })
          }
        }
      })
      .catch(() => {})
  }, [])

  // ─── Load acara bila kejohanan berubah ─────────────────────────────────────

  useEffect(() => {
    setAcaraList([]); setSelAcara('')
    setHeatList([]); setSelHeat('')
    setHeat(null); setAcara(null); setBantahanList([])
    if (!selKej) return
    getDocs(query(collection(db, 'kejohanan', selKej, 'acara'), orderBy('namaAcara')))
      .then(snap => setAcaraList(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [selKej])

  // ─── Load heats bila acara berubah ────────────────────────────────────────

  useEffect(() => {
    setHeatList([]); setSelHeat(''); setHeat(null); setBantahanList([])
    if (!selKej || !selAcara) return
    setAcara(acaraList.find(a => a.id === selAcara) || null)
    getDocs(collection(db, 'kejohanan', selKej, 'acara', selAcara, 'heat'))
      .then(snap => {
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(h => (h.peserta || []).length > 0)
          .sort((a, b) => (a.noHeat || 0) - (b.noHeat || 0))
        setHeatList(list)
        if (list.length === 1) setSelHeat(list[0].id)
      })
      .catch(() => {})
  }, [selAcara, selKej, acaraList])

  // ─── Load heat + bantahan bila heat berubah ───────────────────────────────

  const loadHeatAndBantahan = useCallback(async () => {
    if (!selHeat) { setHeat(null); setBantahanList([]); return }
    const h = heatList.find(x => x.id === selHeat)
    setHeat(h || null)
    autoRasmiDone.current = false
    try {
      const bSnap = await getDocs(query(
        collection(db, 'bantahan'),
        where('heatId', '==', selHeat),
        orderBy('hantarPada', 'desc'),
      ))
      setBantahanList(bSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch { setBantahanList([]) }
  }, [selHeat, heatList])

  useEffect(() => { loadHeatAndBantahan() }, [loadHeatAndBantahan])

  // ─── Countdown timer ──────────────────────────────────────────────────────

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (!heat?.countdownTamat || heat.statusKeputusan === 'rasmi') {
      setRemainSecs(null); return
    }
    const tick = () => {
      const tamatMs = heat.countdownTamat?.toDate?.()?.getTime?.() || null
      if (!tamatMs) { setRemainSecs(null); return }
      setRemainSecs(Math.max(0, Math.floor((tamatMs - Date.now()) / 1000)))
    }
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => clearInterval(intervalRef.current)
  }, [heat])

  // ─── Auto-rasmi bila countdown tamat ─────────────────────────────────────

  useEffect(() => {
    if (remainSecs !== 0) return
    if (!canRasmi || !heat || heat.statusKeputusan === 'rasmi') return
    if (autoRasmiDone.current) return
    if (bantahanList.some(b => b.status === 'menunggu')) return
    autoRasmiDone.current = true
    sahkanRasmi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainSecs])

  // ─── Derived ──────────────────────────────────────────────────────────────

  const isPadang  = acara && ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
  const isRelay   = acara?.isRelay || acara?.jenisAcara === 'relay'
  const statusKep = heat?.statusKeputusan || null
  const isRasmi   = statusKep === 'rasmi'
  const isDlmBant = statusKep === 'dalam_bantahan'

  const pesertaSorted = (heat?.peserta || []).slice().sort((a, b) => {
    const ra = a.rankDalamHeat ?? 999
    const rb = b.rankDalamHeat ?? 999
    return ra - rb
  })

  const bantahanAktif = bantahanList.filter(b => b.status === 'menunggu')

  // Fasa final = layak medal
  // BUG3 FIX: jangan fallback ke 'final' — heat tanpa fasa bukan final kecuali cuma 1 heat
  const grantMedal = (() => {
    if (!heat) return false
    const fasa = heat.fasa
    return (fasa ? ['final', 'terus_final'].includes(fasa) : false) || heatList.length === 1
  })()

  // ─── Actions ──────────────────────────────────────────────────────────────

  async function mulakanCountdown() {
    if (!heat || !canRasmi) return
    const tamatMs = Date.now() + tempohPilih * 60 * 1000
    const tamatTs = Timestamp.fromMillis(tamatMs)
    const hRef    = doc(db, 'kejohanan', selKej, 'acara', selAcara, 'heat', heat.id)
    try {
      await updateDoc(hRef, {
        countdownMula:   serverTimestamp(),
        countdownTempoh: tempohPilih,
        countdownTamat:  tamatTs,
        updatedAt:       serverTimestamp(),
      })
      const updated = { ...heat, countdownTamat: tamatTs, countdownTempoh: tempohPilih }
      setHeat(updated)
      setHeatList(l => l.map(h => h.id === heat.id ? updated : h))
      setMsg({ type: 'ok', text: `Countdown ${tempohPilih} minit dimulakan.` })
    } catch (e) {
      setMsg({ type: 'err', text: 'Gagal: ' + e.message })
    }
  }

  async function postRasmi(heatDoc, acaraDoc, kejId) {
    const pecahRekodMap = {} // noKP → peringkat (untuk patch peserta selepas loop)

    // Bina sekolah nama map sebagai backup untuk heat lama (tiada namaSekolah dalam peserta)
    const kodSekolahSet = [...new Set((heatDoc.peserta || []).map(p => p.kodSekolah).filter(Boolean))]
    const sekolahNamaMap = {}
    await Promise.all(kodSekolahSet.map(async kod => {
      try {
        const snap = await getDoc(doc(db, 'sekolah', kod))
        if (snap.exists()) sekolahNamaMap[kod] = snap.data().namaSekolah || kod
      } catch { sekolahNamaMap[kod] = kod }
    }))
    const getNamaSekolah = (p) => p.namaSekolah || sekolahNamaMap[p.kodSekolah] || p.kodSekolah || ''

    // ── Kunci idempoten: satu acara hanya boleh contribute sekali ke medal_tally ──
    // contrib key: heatId + noKP/kodSekolah — unik per atlet per heat
    // Jika postRasmi dijalankan semula (selepas bantahan), contribution lama
    // dibalikkan dahulu sebelum contribution baru ditulis. Elak double-count.

    for (const p of (heatDoc.peserta || [])) {
      const rank = p.rankDalamHeat
      if (!rank || p.status !== 'selesai') continue

      // Mata olahragawan (bukan relay, top 4 sahaja)
      // R2/R3 FIX: semak sama ada acaraDetail sudah ada — jika ya, kira diff bukan tambah blind
      if (!isRelay && p.noKP && rank <= 4) {
        const mata      = mataPingatKej[rank] ?? 0
        const pingat    = NAMA_PINGAT[rank]
        const mId       = `${p.noKP}_${kejId}`
        const mRef      = doc(db, 'mata_olahragawan', mId)
        const unitAcara = ['padang_lompat', 'padang_balin'].includes(acaraDoc.jenisAcara) ? 'm' : 's'
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

          // Baca doc semasa — semak contribution lama untuk acara ini
          const existingSnap = await getDoc(mRef)
          const existingData = existingSnap.exists() ? existingSnap.data() : {}
          const prevDetail   = existingData[acaraKey]

          const patch = { [acaraKey]: { aceraId: acaraDoc.id, namaAcara: acaraDoc.namaAcara, pingat, mata, rank, prestasi: p.keputusan ?? null, unit: unitAcara } }
          if (prevDetail) {
            // Sudah ada — kira diff: balik lama, tambah baru
            const prevMata   = prevDetail.mata   || 0
            const prevPingat = prevDetail.pingat  || ''
            if (mata !== prevMata)     patch.jumlahMata         = increment(mata - prevMata)
            if (pingat !== prevPingat) {
              patch[`pingat_${prevPingat}`] = increment(-1)
              patch[`pingat_${pingat}`]     = increment(1)
            }
          } else {
            // Contribution pertama — tambah terus
            patch.jumlahMata          = increment(mata)
            patch[`pingat_${pingat}`] = increment(1)
          }
          await updateDoc(mRef, patch)
        } catch (e) { console.warn('mata_olahragawan:', e.message) }
      }

      // Medal tally agregat per sekolah (fasa final, sehingga ke-5 jika setting benarkan)
      // R2 FIX: track contribution per heat per peserta — elak double-count pada retry
      if (grantMedal && p.kodSekolah && rank <= Math.min(bilanganKedudukan, 5) && NAMA_PINGAT[rank]) {
        const pingat      = NAMA_PINGAT[rank]
        const tId         = `${p.kodSekolah}_${kejId}`
        const tRef        = doc(db, 'medal_tally', tId)
        const contribKey  = `contrib_${heatDoc.id}_${p.noKP || p.noBib || rank}`
        try {
          await setDoc(tRef, {
            kodSekolah: p.kodSekolah, namaSekolah: getNamaSekolah(p),
            kejohananId: kejId,
          }, { merge: true })

          const tSnap     = await getDoc(tRef)
          const tData     = tSnap.exists() ? tSnap.data() : {}
          const prevContr = tData[contribKey]

          const tPatch = { [contribKey]: { pingat, noKP: p.noKP || null, rank } }
          if (prevContr) {
            const prevPingat = prevContr.pingat || ''
            if (pingat !== prevPingat) {
              tPatch[prevPingat]    = increment(-1)
              tPatch.jumlahPingat   = increment(-1)
              tPatch[pingat]        = increment(1)
              tPatch.jumlahPingat   = increment(1)
            }
            // pingat sama — tiada perubahan kiraan
          } else {
            tPatch[pingat]      = increment(1)
            tPatch.jumlahPingat = increment(1)
          }
          await updateDoc(tRef, tPatch)
        } catch (e) { console.warn('medal_tally:', e.message) }
      }

      // Rekod detection — fasa final, individu, tempat 1 sahaja
      const isRelayAcara  = acaraDoc.isRelay || acaraDoc.jenisAcara === 'relay'
      const isPadangAcara = ['padang_lompat', 'padang_balin'].includes(acaraDoc.jenisAcara)
      if (
        grantMedal && !isRelayAcara && rank === 1 &&
        p.keputusan != null && p.keputusan !== '' &&
        acaraDoc.namaAcara && acaraDoc.jantina && acaraDoc.kategoriKod
      ) {
        try {
          const unit    = isPadangAcara ? 'm' : 's'
          const rKey    = rekodKeyStr(acaraDoc.namaAcara, acaraDoc.jantina, acaraDoc.kategoriKod, peringkatKej)
          const rekodRef = doc(db, 'rekod', rKey)
          const rekodSnap = await getDoc(rekodRef)
          const newPrestasi = Number(p.keputusan)

          // Semak juga tuntutan sedia ada — elak tuntutan berganda
          const tuntutanRef = doc(db, 'rekod', rKey + '_tuntutan')
          const tuntutanSnap = await getDoc(tuntutanRef)

          let isBetter = false
          if (rekodSnap.exists() && rekodSnap.data().statusRekod === 'aktif') {
            const oldPrestasi = Number(rekodSnap.data().prestasi)
            // Masa (s): lebih rendah = lebih baik | Jarak (m): lebih tinggi = lebih baik
            isBetter = unit === 's' ? newPrestasi < oldPrestasi : newPrestasi > oldPrestasi
          } else if (
            tuntutanSnap.exists() &&
            tuntutanSnap.data().statusRekod === 'tuntutan' &&
            // R8 FIX: elak self-compare — jangan bandingkan tuntutan dari heat ini sendiri
            // (berlaku bila postRasmi dijalankan semula selepas bantahan diterima)
            tuntutanSnap.data().catatanKhas?.includes?.(heatDoc.id) !== true
          ) {
            // Ada tuntutan dari heat lain — bandingkan dengan tuntutan sedia ada
            const oldTuntutan = Number(tuntutanSnap.data().prestasi)
            isBetter = unit === 's' ? newPrestasi < oldTuntutan : newPrestasi > oldTuntutan
          } else if (!tuntutanSnap.exists() || tuntutanSnap.data().catatanKhas?.includes?.(heatDoc.id)) {
            isBetter = true // tiada rekod, tiada tuntutan, atau tuntutan dari heat ini sendiri
          }

          if (isBetter) {
            const today       = new Date().toISOString().split('T')[0]

            // Catat untuk patch peserta dalam heat doc (untuk badge dalam KeputusanRasmi)
            if (p.noKP) pecahRekodMap[p.noKP] = peringkatKej

            // Simpan rekod pecah dalam mata_olahragawan (untuk paparan Olahragawan)
            if (p.noKP) {
              const mRef2 = doc(db, 'mata_olahragawan', `${p.noKP}_${kejId}`)
              const rekodLama = rekodSnap.exists() ? rekodSnap.data() : null
              await setDoc(mRef2, {
                [`rekod_${acaraDoc.id}`]: {
                  namaAcara:    acaraDoc.namaAcara,
                  kategoriKod:  acaraDoc.kategoriKod,
                  jantina:      acaraDoc.jantina,
                  peringkat:    peringkatKej,
                  unit,
                  // Rekod baru (atlet ini)
                  prestasiBaru: Number(p.keputusan),
                  tarikhBaru:   today,
                  // Rekod lama (yang dipecahkan)
                  prestasiLama: rekodLama ? Number(rekodLama.prestasi) : null,
                  tahunLama:    rekodLama ? String(rekodLama.tarikhRekod || '').slice(0, 4) : null,
                  namaLama:     rekodLama?.namaAtlet  || null,
                  lokasiLama:   rekodLama?.namaSekolah || rekodLama?.namaDaerah || rekodLama?.namaNegeri || null,
                },
              }, { merge: true }).catch(() => {})
            }

            await setDoc(tuntutanRef, {
              rekodId:     rKey + '_tuntutan',
              rekodAsal:   rKey,
              namaAcara:   acaraDoc.namaAcara,
              jantina:     acaraDoc.jantina,
              kategoriKod: acaraDoc.kategoriKod,
              peringkat:   peringkatKej,
              noKP:        p.noKP    || '',
              namaAtlet:   p.namaAtlet  || '',
              kodSekolah:  p.kodSekolah || '',
              namaSekolah: getNamaSekolah(p),
              prestasi:    newPrestasi,
              unit,
              windSpeed:   heatDoc.windSpeed  ?? null,
              isWindLegal: heatDoc.isWindLegal ?? true,
              jenisRekod:  'elektronik',
              statusRekod: 'tuntutan',
              tarikhRekod: today,
              kejohananId: kejId,
              catatanKhas: `Auto-tuntutan dari keputusan RASMI (${heatDoc.id})`,
              updatedAt:   serverTimestamp(),
            })
          }
        } catch (e) { console.warn('rekod_tuntutan:', e.message) }
      }

      // ── Relay rekod — fasa final, pasukan tempat 1 sahaja ─────────────────
      // Rekod relay disimpan atas nama sekolah (bukan individu). noKP = null.
      if (
        grantMedal && isRelayAcara && rank === 1 &&
        p.keputusan != null && p.keputusan !== '' &&
        p.kodSekolah &&
        acaraDoc.namaAcara && acaraDoc.jantina && acaraDoc.kategoriKod
      ) {
        try {
          const rKey        = rekodKeyStr(acaraDoc.namaAcara, acaraDoc.jantina, acaraDoc.kategoriKod, peringkatKej)
          const rekodRef    = doc(db, 'rekod', rKey)
          const tuntutanRef = doc(db, 'rekod', rKey + '_tuntutan')
          const [rekodSnap, tuntutanSnap] = await Promise.all([getDoc(rekodRef), getDoc(tuntutanRef)])
          const newPrestasi = Number(p.keputusan)

          let isBetter = false
          if (rekodSnap.exists() && rekodSnap.data().statusRekod === 'aktif') {
            isBetter = newPrestasi < Number(rekodSnap.data().prestasi) // masa: lebih rendah lebih baik
          } else if (tuntutanSnap.exists() && tuntutanSnap.data().statusRekod === 'tuntutan') {
            isBetter = newPrestasi < Number(tuntutanSnap.data().prestasi)
          } else {
            isBetter = true // rekod pertama untuk acara ini
          }

          if (isBetter) {
            const rekodLama = rekodSnap.exists() ? rekodSnap.data() : null
            await setDoc(tuntutanRef, {
              rekodId:      rKey + '_tuntutan',
              rekodAsal:    rKey,
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
              statusRekod:  'tuntutan',
              tarikhRekod:  new Date().toISOString().split('T')[0],
              kejohananId:  kejId,
              catatanKhas:  `Auto-tuntutan relay dari keputusan RASMI (${heatDoc.id})`,
              prestasiLama: rekodLama ? Number(rekodLama.prestasi) : null,
              tahunLama:    rekodLama ? String(rekodLama.tarikhRekod || '').slice(0, 4) : null,
              namaLama:     rekodLama?.namaAtlet  || null,
              lokasiLama:   rekodLama?.namaSekolah || null,
              updatedAt:    serverTimestamp(),
            })
          }
        } catch (e) { console.warn('rekod_relay:', e.message) }
      }
    }

    // Patch heat doc — tambah pecahRekod pada peserta yang pecah rekod
    const hRef3 = doc(db, 'kejohanan', kejId, 'acara', acaraDoc.id, 'heat', heatDoc.id)
    if (Object.keys(pecahRekodMap).length > 0) {
      try {
        const pesertaPatched = (heatDoc.peserta || []).map(p =>
          pecahRekodMap[p.noKP] ? { ...p, pecahRekod: pecahRekodMap[p.noKP] } : p
        )
        await updateDoc(hRef3, { peserta: pesertaPatched, updatedAt: serverTimestamp() })
        // Kemaskini state heat supaya badge nampak terus tanpa reload
        setHeat(prev => prev ? { ...prev, peserta: pesertaPatched } : prev)
      } catch (e) { console.warn('patch pecahRekod:', e.message) }
    }

    // postRasmiSelesai kini diset secara atomic dalam runTransaction di sahkanRasmi()
    // — tidak perlu set semula di sini
  }

  async function sahkanRasmi() {
    if (!heat || !selKej || !selAcara || !acara) return
    setSavingRasmi(true); setMsg(null)

    const hRef    = doc(db, 'kejohanan', selKej, 'acara', selAcara, 'heat', heat.id)
    const acaraRef = doc(db, 'kejohanan', selKej, 'acara', selAcara)

    try {
      // ── Atomic check-and-set ───────────────────────────────────────────────
      // runTransaction: jika postRasmiSelesai sudah true (dari browser/tab lain),
      // transaction abort dan tiada double-count berlaku.
      let alreadyDone = false
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(hRef)
        if (snap.data()?.postRasmiSelesai) {
          alreadyDone = true
          return // keluar transaction tanpa tulis — sudah rasmi
        }
        tx.update(hRef, {
          statusKeputusan:  'rasmi',
          postRasmiSelesai: true,        // kunci awal — elak race condition
          tarikhRasmi:      serverTimestamp(),
          rasmiOleh:        userData?.uid || null,
          updatedAt:        serverTimestamp(),
        })
      })

      if (alreadyDone) {
        setMsg({ type: 'ok', text: 'Keputusan sudah RASMI. Medal tally telah dikira sebelum ini.' })
        setSavingRasmi(false)
        return
      }

      // Kemaskini statusAcara pada acara doc
      const updatedHeatList = heatList.map(h => h.id === heat.id ? { ...h, statusKeputusan: 'rasmi' } : h)
      const finalHeat = updatedHeatList.find(h => h.fasa === 'final' || h.fasa === 'terus_final')
      const newAcaraStatus = finalHeat
        ? (finalHeat.statusKeputusan === 'rasmi' ? 'rasmi' : 'tidak_rasmi')
        : (updatedHeatList.every(h => h.statusKeputusan === 'rasmi') ? 'rasmi' : 'tidak_rasmi')
      await updateDoc(acaraRef, { statusAcara: newAcaraStatus, updatedAt: serverTimestamp() }).catch(() => {})

      const updated = { ...heat, statusKeputusan: 'rasmi', postRasmiSelesai: true }
      setHeat(updated)
      setHeatList(updatedHeatList)

      // Jalankan postRasmi — jika gagal, rollback postRasmiSelesai supaya boleh retry
      try {
        await postRasmi(updated, acara, selKej)
      } catch (postErr) {
        await updateDoc(hRef, { postRasmiSelesai: false }).catch(() => {})
        throw new Error('Ralat kira medal/mata: ' + postErr.message + ' (postRasmiSelesai dibatalkan — boleh cuba semula)')
      }

      setMsg({ type: 'ok', text: 'Keputusan RASMI. Medal tally & mata olahragawan dikemaskini.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Ralat: ' + e.message })
    } finally { setSavingRasmi(false) }
  }

  async function hantarBantahan() {
    if (!bantahanForm.sebab.trim() || !heat) return
    setSavingBantahan(true)
    try {
      // R5 FIX: hadkan 1 bantahan menunggu per heat per sekolah — elak spam
      const spamSnap = await getDocs(query(
        collection(db, 'bantahan'),
        where('heatId', '==', heat.id),
        where('hantarOlehSekolah', '==', kodSekolahUser || ''),
        where('status', '==', 'menunggu'),
      ))
      if (!spamSnap.empty) {
        setMsg({ type: 'err', text: 'Anda sudah ada bantahan menunggu untuk heat ini. Tunggu keputusan dahulu.' })
        setBantahanModal(false)
        setSavingBantahan(false)
        return
      }

      await addDoc(collection(db, 'bantahan'), {
        heatId: heat.id, aceraId: selAcara, kejohananId: selKej,
        noBib: bantahanForm.noBib || null,
        sebab: bantahanForm.sebab.trim(),
        hantarOlehUid:     userData?.uid || null,
        hantarOlehNama:    userData?.nama || userData?.email || null,
        hantarOlehSekolah: kodSekolahUser || null,
        hantarPada:        serverTimestamp(),
        status:            'menunggu',
      })
      const hRef = doc(db, 'kejohanan', selKej, 'acara', selAcara, 'heat', heat.id)
      await updateDoc(hRef, { statusKeputusan: 'dalam_bantahan', updatedAt: serverTimestamp() })
      const updated = { ...heat, statusKeputusan: 'dalam_bantahan' }
      setHeat(updated)
      setHeatList(l => l.map(h => h.id === heat.id ? updated : h))
      await loadHeatAndBantahan()
      setBantahanModal(false)
      setBantahanForm({ sebab: '', noBib: '' })
      setMsg({ type: 'ok', text: 'Bantahan dihantar. Menunggu semakan.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Gagal: ' + e.message })
    } finally { setSavingBantahan(false) }
  }

  async function putuskanBantahan(bantahanId, terima) {
    setSavingPutusan(bantahanId)
    try {
      await updateDoc(doc(db, 'bantahan', bantahanId), {
        status: terima ? 'diterima' : 'ditolak',
        semakOlehUid: userData?.uid || null,
        putusanPada: serverTimestamp(),
      })
      const bSnap = await getDocs(query(
        collection(db, 'bantahan'),
        where('heatId', '==', selHeat),
        orderBy('hantarPada', 'desc'),
      ))
      const bList = bSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      setBantahanList(bList)
      const masihAda = bList.some(b => b.status === 'menunggu')

      const hRef = doc(db, 'kejohanan', selKej, 'acara', selAcara, 'heat', heat.id)
      if (terima) {
        // Reset countdown 30 min, unlock untuk input semula
        const tamatTs = Timestamp.fromMillis(Date.now() + 30 * 60 * 1000)
        await updateDoc(hRef, {
          statusKeputusan: 'tidak_rasmi',
          countdownTamat: tamatTs,
          updatedAt: serverTimestamp(),
        })
        const updated = { ...heat, statusKeputusan: 'tidak_rasmi', countdownTamat: tamatTs }
        setHeat(updated)
        setHeatList(l => l.map(h => h.id === heat.id ? updated : h))
        setMsg({ type: 'ok', text: 'Bantahan diterima. Countdown 30 minit baharu. Pencatat boleh input semula.' })
      } else {
        if (!masihAda) {
          await updateDoc(hRef, { statusKeputusan: 'tidak_rasmi', updatedAt: serverTimestamp() })
          const updated = { ...heat, statusKeputusan: 'tidak_rasmi' }
          setHeat(updated)
          setHeatList(l => l.map(h => h.id === heat.id ? updated : h))
        }
        setMsg({ type: 'ok', text: 'Bantahan ditolak.' + (!masihAda ? ' Countdown bersambung.' : '') })
      }
    } catch (e) {
      setMsg({ type: 'err', text: 'Ralat: ' + e.message })
    } finally { setSavingPutusan(null) }
  }

  // ─── UI ───────────────────────────────────────────────────────────────────

  const statusBadge = (() => {
    if (!heat || !statusKep) return null
    if (isRasmi) return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-green-600 text-white">
        ✓ RASMI — DIKUNCI
      </span>
    )
    if (isDlmBant) return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500 text-white animate-pulse">
        ⚠ DALAM BANTAHAN
      </span>
    )
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
        ⏳ TIDAK RASMI
      </span>
    )
  })()

  return (
    <div className="p-4 max-w-6xl mx-auto">

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-base font-bold text-[#003399]">Keputusan Rasmi</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Semak keputusan, urus bantahan, dan sahkan keputusan rasmi
        </p>
        {namaKej && <p className="text-xs font-semibold text-[#003399] mt-0.5">{namaKej}</p>}
      </div>

      {/* Selectors */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Acara</label>
            <select className={cls.select} value={selAcara} onChange={e => setSelAcara(e.target.value)}
              disabled={!selKej || acaraList.length === 0}>
              <option value="">-- Pilih Acara --</option>
              {acaraList.filter(a => a.isAktif !== false).map(a => (
                <option key={a.id} value={a.id}>{a.namaAcara}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Heat / Giliran</label>
            <select className={cls.select} value={selHeat} onChange={e => setSelHeat(e.target.value)}
              disabled={!selAcara || heatList.length === 0}>
              <option value="">-- Pilih Heat --</option>
              {heatList.map(h => (
                <option key={h.id} value={h.id}>
                  {FASA_LABEL[h.fasa] || h.fasa || 'Heat'} {h.noHeat || ''}
                  {h.statusKeputusan === 'rasmi' ? ' ✓' : ''}
                  {h.statusKeputusan === 'dalam_bantahan' ? ' ⚠' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!heat && (
        <div className="bg-white border border-gray-100 rounded-lg p-10 text-center text-gray-400 shadow-sm">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm font-medium">Pilih kejohanan, acara dan heat</p>
          <p className="text-xs mt-1">untuk melihat keputusan dan urus proses rasmi</p>
        </div>
      )}

      {heat && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Kiri: Keputusan + Tindakan ─────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Status + Countdown */}
            <div className={`bg-white border rounded-lg p-4 shadow-sm ${isRasmi ? 'border-green-300' : isDlmBant ? 'border-amber-300' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1.5">
                    <span className="font-semibold">{acara?.namaAcara}</span>
                    {' — '}
                    {FASA_LABEL[heat.fasa] || heat.fasa} {heat.noHeat ? `#${heat.noHeat}` : ''}
                    {grantMedal && <span className="ml-2 text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-bold">FINAL</span>}
                  </p>
                  {statusBadge}
                  {heat.windSpeed !== null && heat.windSpeed !== undefined && (
                    <span className={`inline-block ml-2 text-[10px] font-bold px-2 py-0.5 rounded ${heat.isWindLegal ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      Angin: {heat.windSpeed > 0 ? '+' : ''}{heat.windSpeed} m/s
                      {heat.isWindLegal ? ' ✓' : ' ✗ ILLEGAL'}
                    </span>
                  )}
                </div>

                {/* Countdown */}
                {!isRasmi && heat.countdownTamat && remainSecs !== null && (
                  <div className={`text-right ${remainSecs <= 60 ? 'text-red-600' : remainSecs <= 300 ? 'text-amber-600' : 'text-[#003399]'}`}>
                    <p className="text-[10px] text-gray-400 mb-0.5">Masa bantahan berbaki</p>
                    <p className="text-2xl font-mono font-bold leading-none">{formatCountdown(remainSecs)}</p>
                    {remainSecs === 0 && (
                      <p className="text-[10px] text-amber-600 font-semibold mt-0.5">Menunggu auto-rasmi...</p>
                    )}
                  </div>
                )}
              </div>

              {/* Butang tindakan */}
              {!isRasmi && canRasmi && (
                <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2 items-center">
                  {!heat.countdownTamat ? (
                    <>
                      <select
                        className="border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none"
                        value={tempohPilih}
                        onChange={e => setTempohPilih(Number(e.target.value))}
                      >
                        {TEMPOH_OPT.map(o => <option key={o.nilai} value={o.nilai}>{o.label}</option>)}
                      </select>
                      <button
                        onClick={mulakanCountdown}
                        className="px-3 py-1.5 bg-[#003399] text-white text-xs font-semibold rounded hover:bg-[#002280] transition-colors"
                      >
                        Mulakan Countdown Bantahan
                      </button>
                    </>
                  ) : remainSecs === 0 ? (
                    <span className="text-xs text-amber-600 font-medium">Countdown tamat —</span>
                  ) : (
                    <span className="text-xs text-gray-400">Countdown sedang berjalan...</span>
                  )}

                  <button
                    onClick={() => {
                      // Semak peserta status selesai tapi tiada rank — akan dilangkau postRasmi senyap
                      const tanpaRank = (heat.peserta || []).filter(
                        p => p.status === 'selesai' && (p.rankDalamHeat == null || p.rankDalamHeat === 0)
                      )
                      if (tanpaRank.length > 0) {
                        const nama = tanpaRank.map(p => p.namaAtlet || p.noBib || p.noKP).join(', ')
                        const teruskan = window.confirm(
                          `⚠️ Amaran: ${tanpaRank.length} peserta status "selesai" tetapi tiada kedudukan:\n${nama}\n\nMedal & mata mereka TIDAK akan dikira.\n\nTeruskan sahkan RASMI?`
                        )
                        if (!teruskan) return
                      }
                      const msg = heat.countdownTamat && remainSecs > 0
                        ? 'Override countdown? Sahkan keputusan RASMI sekarang?'
                        : 'Sahkan keputusan sebagai RASMI? Tindakan ini tidak boleh dibatalkan.'
                      if (window.confirm(msg)) sahkanRasmi()
                    }}
                    disabled={savingRasmi}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded hover:bg-green-700 disabled:opacity-50 transition-colors ml-auto"
                  >
                    {savingRasmi ? 'Memproses...' : '✓ Rasmi Sekarang'}
                  </button>
                </div>
              )}

              {isRasmi && (
                <div className="mt-3 pt-3 border-t border-green-100">
                  <p className="text-xs text-green-600">
                    ✓ Keputusan dikunci. Medal tally dan mata olahragawan dikemaskini secara automatik.
                  </p>
                </div>
              )}
            </div>

            {/* Mesej */}
            {msg && (
              <div className={`px-3 py-2.5 rounded text-xs font-medium ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {msg.text}
                <button onClick={() => setMsg(null)} className="ml-2 text-[10px] underline opacity-60">tutup</button>
              </div>
            )}

            {/* Jadual keputusan */}
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-600">
                  Keputusan — {pesertaSorted.length} peserta
                </p>
                {isRasmi && (
                  <span className="text-[10px] text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded">RASMI</span>
                )}
              </div>

              {pesertaSorted.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-400">
                  Tiada keputusan direkod. Gunakan <strong>Input Keputusan</strong> untuk memasukkan keputusan terlebih dahulu.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 text-[10px] text-gray-400 uppercase tracking-wide">
                        <th className="px-3 py-2 text-left w-10">#</th>
                        <th className="px-3 py-2 text-left">Bib</th>
                        <th className="px-3 py-2 text-left">Nama</th>
                        <th className="px-3 py-2 text-left">Sekolah</th>
                        {!isPadang && <th className="px-3 py-2 text-center">L</th>}
                        <th className="px-3 py-2 text-right">Keputusan</th>
                        {isPadang && <th className="px-3 py-2 text-left max-w-[120px]">Cubaan</th>}
                        <th className="px-3 py-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pesertaSorted.map((p, i) => {
                        const rank = p.rankDalamHeat
                        const medal = isRasmi && rank === 1 ? '🥇' : isRasmi && rank === 2 ? '🥈' : isRasmi && rank === 3 ? '🥉' : null
                        const rowBg = isRasmi
                          ? rank === 1 ? 'bg-yellow-50/70' : rank === 2 ? 'bg-gray-50/60' : rank === 3 ? 'bg-orange-50/40' : ''
                          : ''
                        const rekodBadge = p.pecahRekod
                          ? { D: 'RD', N: 'RN', K: 'RK' }[p.pecahRekod] || `R${p.pecahRekod}`
                          : null
                        return (
                          <tr key={p.noBib || i} className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${rowBg}`}>
                            <td className="px-3 py-2 font-bold text-gray-600">
                              {medal || (rank ? `#${rank}` : '—')}
                            </td>
                            <td className="px-3 py-2 font-mono text-gray-400 text-[11px]">{p.noBib || '—'}</td>
                            <td className="px-3 py-2 font-semibold text-gray-700 max-w-[130px]">
                              <span className="truncate block">{p.namaAtlet || '—'}</span>
                              {rekodBadge && (
                                <span className="inline-block mt-0.5 text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-400 text-white tracking-wide">
                                  {rekodBadge}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-400 text-[11px]">{p.kodSekolah || '—'}</td>
                            {!isPadang && <td className="px-3 py-2 text-center text-gray-400">{p.lorong || p.giliran || '—'}</td>}
                            <td className="px-3 py-2 text-right font-mono font-semibold text-[#003399]">
                              {isPadang
                                ? (p.keputusan != null ? formatMeter(p.keputusan) : '—')
                                : (p.keputusan != null ? formatSaat(p.keputusan) : '—')
                              }
                            </td>
                            {isPadang && (
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-400 max-w-[120px]">
                                {(p.cubaan || []).map((c, ci) => (
                                  <span key={ci} className={`mr-1.5 ${c === 'NM' ? 'text-red-400 font-bold' : ''}`}>
                                    {c === null || c === undefined ? '—' : c === 'NM' ? 'NM' : Number(c).toFixed(2)}
                                  </span>
                                ))}
                              </td>
                            )}
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${STATUS_COLOR[p.status] || 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                                {p.status || '—'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── Kanan: Bantahan Panel ──────────────────────────────────── */}
          <div className="space-y-3">

            {/* Butang hantar bantahan */}
            {!isRasmi && canBantah && (
              <button
                onClick={() => { setBantahanModal(true); setBantahanForm({ sebab: '', noBib: '' }) }}
                className="w-full px-3 py-2.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors shadow-sm"
              >
                ⚠ Hantar Bantahan
              </button>
            )}

            {/* Senarai bantahan */}
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-600">
                  Bantahan
                </p>
                {bantahanAktif.length > 0 && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">
                    {bantahanAktif.length} menunggu
                  </span>
                )}
              </div>

              {bantahanList.length === 0 ? (
                <div className="p-5 text-center text-xs text-gray-400">
                  Tiada bantahan.
                </div>
              ) : (
                <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
                  {bantahanList.map(b => (
                    <div key={b.id} className="p-3">
                      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          b.status === 'menunggu' ? 'bg-amber-100 text-amber-700' :
                          b.status === 'diterima' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {b.status === 'menunggu' ? '⏳ Menunggu' :
                           b.status === 'diterima' ? '✓ Diterima' : '✗ Ditolak'}
                        </span>
                        <span className="text-[10px] text-gray-400">{formatTarikh(b.hantarPada)}</span>
                      </div>
                      {b.noBib && (
                        <p className="text-[10px] text-gray-500 mb-1">Berkaitan: #{b.noBib}</p>
                      )}
                      <p className="text-xs text-gray-700 leading-relaxed mb-1.5">{b.sebab}</p>
                      <p className="text-[10px] text-gray-400">
                        {b.hantarOlehNama || '—'}
                        {b.hantarOlehSekolah ? ` (${b.hantarOlehSekolah})` : ''}
                      </p>

                      {b.status === 'menunggu' && canRasmi && (
                        <div className="flex gap-1.5 mt-2">
                          <button
                            onClick={() => putuskanBantahan(b.id, true)}
                            disabled={savingPutusan === b.id}
                            className="flex-1 py-1 bg-green-600 text-white text-[10px] font-bold rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                          >
                            {savingPutusan === b.id ? '...' : '✓ Terima'}
                          </button>
                          <button
                            onClick={() => putuskanBantahan(b.id, false)}
                            disabled={savingPutusan === b.id}
                            className="flex-1 py-1 bg-red-500 text-white text-[10px] font-bold rounded hover:bg-red-600 disabled:opacity-50 transition-colors"
                          >
                            {savingPutusan === b.id ? '...' : '✗ Tolak'}
                          </button>
                        </div>
                      )}

                      {b.putusanPada && (
                        <p className="text-[10px] text-gray-400 mt-1">
                          Semak: {formatTarikh(b.putusanPada)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={loadHeatAndBantahan}
              className="w-full py-1.5 border border-gray-200 text-gray-500 text-xs rounded hover:bg-gray-50 transition-colors"
            >
              ↺ Muat Semula
            </button>
          </div>
        </div>
      )}

      {/* ── Modal Hantar Bantahan ─────────────────────────────────────────── */}
      {bantahanModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-800">Hantar Bantahan</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {acara?.namaAcara} — {FASA_LABEL[heat?.fasa] || heat?.fasa} {heat?.noHeat || ''}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Berkaitan Peserta <span className="font-normal text-gray-400">(pilihan)</span>
                </label>
                <select
                  className={cls.select}
                  value={bantahanForm.noBib}
                  onChange={e => setBantahanForm(f => ({ ...f, noBib: e.target.value }))}
                >
                  <option value="">-- Bantahan am --</option>
                  {pesertaSorted.map(p => (
                    <option key={p.noBib} value={p.noBib}>
                      {p.noBib} — {p.namaAtlet}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Sebab Bantahan <span className="text-red-500">*</span>
                </label>
                <textarea
                  className={cls.input + ' resize-none'}
                  rows={4}
                  maxLength={500}
                  placeholder="Huraikan sebab bantahan dengan jelas..."
                  value={bantahanForm.sebab}
                  onChange={e => setBantahanForm(f => ({ ...f, sebab: e.target.value }))}
                />
                <p className="text-[10px] text-gray-400 mt-0.5 text-right">
                  {bantahanForm.sebab.length}/500
                </p>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-end">
              <button
                onClick={() => setBantahanModal(false)}
                className="px-4 py-1.5 border border-gray-200 text-gray-600 text-xs rounded hover:bg-gray-50 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={hantarBantahan}
                disabled={savingBantahan || !bantahanForm.sebab.trim()}
                className="px-4 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {savingBantahan ? 'Menghantar...' : 'Hantar Bantahan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
