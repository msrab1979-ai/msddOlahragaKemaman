/**
 * KeputusanRasmi — /dashboard/rasmi
 *
 * Aliran: TIDAK_RASMI → Countdown → AUTO RASMI (atau override)
 *         Jika ada bantahan → DALAM_BANTAHAN → Terima/Tolak
 * Post-rasmi: tulis mata_olahragawan + medal_tally
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  collection, getDocs, getDoc, doc, updateDoc, addDoc, setDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, Timestamp, increment, runTransaction,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { selectFinalists as _selectFinalists, assignLorong as _assignLorong } from '../../utils/finalistUtils'
import { runPostRasmi, rekodKeyStr as _rekodKeyStr } from '../../utils/postRasmiUtils'

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

// selectFinalistsKR + assignLorongKR diganti dengan import dari finalistUtils

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
  const [finalSetup,    setFinalSetup]    = useState(null) // tetapan/finalSetup
  const [selAcara,      setSelAcara]      = useState('')
  const [heatList,      setHeatList]      = useState([])
  const [selHeat,       setSelHeat]       = useState('')

  // ── Filter acara ───────────────────────────────────────────────────────────
  const [filterHari,      setFilterHari]      = useState('') // '' = semua hari
  const [filterPeringkat, setFilterPeringkat] = useState('') // '' | 'saringan' | 'final'
  const [filterCari,      setFilterCari]      = useState('') // cari by no acara / nama

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
  const [sweeping,       setSweeping]       = useState(false)
  const [sweepResult,    setSweepResult]    = useState(null)

  // ── Jana Final ────────────────────────────────────────────────────────────
  const [janaFinalLoading, setJanaFinalLoading] = useState(false)

  // ── Inline edit (superadmin sahaja) ───────────────────────────────────────
  const [editMode,       setEditMode]       = useState(false)
  const [editValues,     setEditValues]     = useState({}) // { noBib: { keputusan, status } }
  const [savingEdit,     setSavingEdit]     = useState(false)

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

    // Load tetapan finalSetup untuk pilih finalis
    getDoc(doc(db, 'tetapan', 'finalSetup'))
      .then(snap => { if (snap.exists()) setFinalSetup(snap.data()) })
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
    let h = heatList.find(x => x.id === selHeat) || null
    autoRasmiDone.current = false

    // ── Patch: heat tidak_rasmi + publishedAt tapi tiada countdownTamat ──────
    // Berlaku bila heat dihantar dari InputKeputusan lama (sebelum fix) atau
    // bila heat dihantar sebelum field countdownTamat wujud.
    // Fix: compute countdownTamat dari publishedAt + timer kejohanan.
    if (h && h.statusKeputusan === 'tidak_rasmi' && h.publishedAt && !h.countdownTamat) {
      try {
        const pubMs     = h.publishedAt?.toDate?.()?.getTime?.() || (h.publishedAt?.seconds * 1000) || null
        const timerMin  = h.timerAutoRasmi ?? 30
        if (pubMs) {
          const tamatTs = Timestamp.fromMillis(pubMs + timerMin * 60 * 1000)
          const hRef    = doc(db, 'kejohanan', selKej, 'acara', selAcara, 'heat', selHeat)
          await updateDoc(hRef, { countdownTamat: tamatTs })
          h = { ...h, countdownTamat: tamatTs }
        }
      } catch { /* patch gagal — teruskan sahaja */ }
    }

    setHeat(h)
    try {
      const bSnap = await getDocs(query(
        collection(db, 'bantahan'),
        where('heatId', '==', selHeat),
        orderBy('hantarPada', 'desc'),
      ))
      setBantahanList(bSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch { setBantahanList([]) }
  }, [selHeat, heatList, selKej, selAcara])

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

  // Saringan acara = TIDAK PERNAH dapat medal (walaupun 1 heat sahaja)
  const isSaringanAcara = (() => {
    if (!acara) return false
    const p = (acara.peringkat || '').toLowerCase()
    const n = (acara.namaAcara  || '').toLowerCase()
    return p.includes('saringan') || n.includes('saringan')
  })()

  // Fasa final = layak medal — TAPI saringan acara tidak layak walaupun 1 heat
  const grantMedal = (() => {
    if (!heat || !acara || isSaringanAcara) return false
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

  async function postRasmi(heatDoc, acaraDoc, kejId, opts = {}) {
    // Delegate ke shared utility — hantar semua config dari component state
    const isRelayLocal    = opts.isRelayOverride   ?? (acaraDoc.isRelay || acaraDoc.jenisAcara === 'relay')
    const grantMedalLocal = opts.grantMedalOverride ?? grantMedal
    await runPostRasmi(db, heatDoc, acaraDoc, kejId, {
      mataPingat:        mataPingatKej,
      bilanganKedudukan: bilanganKedudukan,
      peringkatKej:      peringkatKej,
      grantMedal:        grantMedalLocal,
      isRelay:           isRelayLocal,
      onPesertaPatch:    patched => setHeat(prev => prev ? { ...prev, peserta: patched } : prev),
    })
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
      // Untuk acara saringan: statusAcara ikut saringan heats sahaja (abaikan final heat)
      // Untuk acara lain: ikut final heat jika ada, else semua heat
      const heatsUntukStatus = isSaringanAcara
        ? updatedHeatList.filter(h => h.fasa !== 'final' && h.fasa !== 'terus_final' && h.peringkat !== 'final')
        : updatedHeatList
      const finalHeatStatus = !isSaringanAcara && heatsUntukStatus.find(h => h.fasa === 'final' || h.fasa === 'terus_final')
      const newAcaraStatus = finalHeatStatus
        ? (finalHeatStatus.statusKeputusan === 'rasmi' ? 'rasmi' : 'tidak_rasmi')
        : (heatsUntukStatus.every(h => h.statusKeputusan === 'rasmi') ? 'rasmi' : 'tidak_rasmi')
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

  // ── Rerun Medal — jalankan semula postRasmi untuk heat rasmi semasa ──────────

  async function rerunMedal() {
    if (!heat || !acara || !selKej || !canRasmi) return
    if (!window.confirm('Jalankan semula kira medal & mata olahragawan untuk heat ini?\n\nIni akan betulkan medal tally dan kedudukan jika sebelum ini gagal.')) return
    setSavingRasmi(true); setMsg(null)
    try {
      const hRef = doc(db, 'kejohanan', selKej, 'acara', selAcara, 'heat', heat.id)

      // Baca data terbaru dari Firestore
      await updateDoc(hRef, { postRasmiSelesai: false })
      const freshSnap = await getDoc(hRef)
      const freshHeat = { id: heat.id, ...freshSnap.data() }

      // Kira semula rankDalamHeat dari keputusan terkini
      const isPadangRerun = ['padang_lompat', 'padang_balin'].includes(acara?.jenisAcara)
      const finishersRerun = (freshHeat.peserta || [])
        .filter(p => !['DNS','DNF','DQ'].includes(p.status) && p.keputusan != null && Number(p.keputusan) > 0)
        .sort((a, b) => isPadangRerun ? Number(b.keputusan) - Number(a.keputusan) : Number(a.keputusan) - Number(b.keputusan))
      const rankMapRerun = new Map()
      finishersRerun.forEach((p, i) => {
        const prev = i > 0 && p.keputusan === finishersRerun[i-1].keputusan
        rankMapRerun.set(p.noKP || p.noBib, prev ? rankMapRerun.get(finishersRerun[i-1].noKP || finishersRerun[i-1].noBib) : i + 1)
      })
      const pesertaWithRank = (freshHeat.peserta || []).map(p => ({
        ...p,
        rankDalamHeat: rankMapRerun.get(p.noKP || p.noBib) ?? null,
      }))

      // Simpan rankDalamHeat yang dikira semula ke Firestore
      await updateDoc(hRef, { peserta: pesertaWithRank, updatedAt: serverTimestamp() })

      // Jalankan postRasmi dengan data terkini
      const heatWithRank = { ...freshHeat, peserta: pesertaWithRank }
      await postRasmi(heatWithRank, acara, selKej)
      await updateDoc(hRef, { postRasmiSelesai: true })

      // Refresh UI
      setHeat({ ...heatWithRank, postRasmiSelesai: true })
      setMsg({ type: 'ok', text: '✓ Kedudukan dan medal tally dikemaskini semula.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Ralat rerun: ' + e.message })
    } finally { setSavingRasmi(false) }
  }

  // ── Simpan Edit Rasmi (superadmin) + Jalankan Semula Medal ──────────────────

  async function simpanEditRasmi() {
    if (!heat || !acara || !selKej || !isSuperadmin) return
    if (!window.confirm('Simpan perubahan keputusan dan kemas kini medal tally?\n\nTindakan ini akan overwrite keputusan rasmi.')) return
    setSavingEdit(true); setMsg(null)
    try {
      const hRef = doc(db, 'kejohanan', selKej, 'acara', selAcara, 'heat', heat.id)
      const isPadangEdit = ['padang_lompat', 'padang_balin'].includes(acara?.jenisAcara)

      // Patch peserta array dengan nilai baru
      const pesertaTanpaRank = (heat.peserta || []).map(p => {
        const key = p.noBib || p.noKP
        const ev = editValues[key]
        if (!ev) return p
        const keputusanBaru = ev.keputusan !== '' && ev.keputusan !== undefined
          ? Number(ev.keputusan) : p.keputusan
        const statusBaru = ev.status || p.status
        const isFlagged = ['DNS', 'DNF', 'DQ'].includes(statusBaru)
        const hasResult = keputusanBaru != null && !isNaN(keputusanBaru) && keputusanBaru > 0
        const finalStatus = isFlagged ? statusBaru : hasResult ? 'selesai' : statusBaru
        return { ...p, keputusan: keputusanBaru, status: finalStatus }
      })

      // Kira semula rankDalamHeat berdasarkan keputusan baru
      const finishersEdit = pesertaTanpaRank
        .filter(p => !['DNS','DNF','DQ'].includes(p.status) && p.keputusan != null && Number(p.keputusan) > 0)
        .sort((a, b) => isPadangEdit ? Number(b.keputusan) - Number(a.keputusan) : Number(a.keputusan) - Number(b.keputusan))
      const rankMapEdit = new Map()
      finishersEdit.forEach((p, i) => {
        const prev = i > 0 && p.keputusan === finishersEdit[i-1].keputusan
        rankMapEdit.set(p.noKP || p.noBib, prev ? rankMapEdit.get(finishersEdit[i-1].noKP || finishersEdit[i-1].noBib) : i + 1)
      })
      const pesertaBaru = pesertaTanpaRank.map(p => ({
        ...p,
        rankDalamHeat: rankMapEdit.get(p.noKP || p.noBib) ?? null,
      }))

      await updateDoc(hRef, { peserta: pesertaBaru, updatedAt: serverTimestamp() })
      // Jalankan semula medal
      await updateDoc(hRef, { postRasmiSelesai: false })
      const freshSnap = await getDoc(hRef)
      const freshHeat = { id: heat.id, ...freshSnap.data() }
      await postRasmi(freshHeat, acara, selKej)
      await updateDoc(hRef, { postRasmiSelesai: true })
      // Refresh local state
      setHeat({ ...freshHeat, peserta: pesertaBaru, postRasmiSelesai: true })
      setEditMode(false)
      setEditValues({})
      setMsg({ type: 'ok', text: '✓ Keputusan dikemas kini dan medal tally diperbaharui.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Ralat simpan: ' + e.message })
    } finally { setSavingEdit(false) }
  }

  // ── Kelayakan Final — kira dari heatList semasa ───────────────────────────────

  const finalistList = (() => {
    if (!acara || !isSaringanAcara || heatList.length === 0) return []
    const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
    const finalists = _selectFinalists(heatList, acara, finalSetup)
    return isPadang ? finalists : _assignLorong(finalists, false)
  })()

  const finalistBibs = new Set(finalistList.map(f => f.noBib))

  const semakHeatFinalAda = heatList.some(h => h.peringkat === 'final')
  const semakSaringanSelesai = heatList
    .filter(h => h.peringkat !== 'final')
    .every(h => ['rasmi', 'tidak_rasmi'].includes(h.statusKeputusan))
  const bolehJanaFinal = isSaringanAcara && canRasmi && semakSaringanSelesai && finalistList.length > 0

  async function handleJanaFinalAdmin() {
    if (!bolehJanaFinal || !selKej || !selAcara) return
    const konfirm = window.confirm(
      `Jana heat Final dengan ${finalistList.length} atlet terpilih?\n\n` +
      (semakHeatFinalAda ? '⚠ Heat Final lama akan dipadam dan dijana semula.' : 'Heat Final baru akan dicipta.')
    )
    if (!konfirm) return
    setJanaFinalLoading(true)
    try {
      // Padam heat final lama jika ada
      const finalLama = heatList.filter(h => h.peringkat === 'final')
      for (const lama of finalLama) {
        await deleteDoc(doc(db, 'kejohanan', selKej, 'acara', selAcara, 'heat', lama.id)).catch(() => {})
      }

      const nonFinalHeats = heatList.filter(h => h.peringkat !== 'final')
      const maxHeatNo = Math.max(0, ...nonFinalHeats.map(h => h.noHeat || 0))
      const newHeatId = `final_${Date.now()}`
      const isPadang  = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)

      const finalPeserta = finalistList.map(f => ({
        lorong:     !isPadang ? (f.lorong || null) : null,
        noBib:      f.noBib,
        namaAtlet:  f.namaAtlet,
        kodSekolah: f.kodSekolah,
        noKP:       f.noKP || null,
        keputusan:  null,
        status:     'belum',
        dariHeat:   f.noHeat,
        masaHeat:   f.keputusan,
      }))

      await setDoc(doc(db, 'kejohanan', selKej, 'acara', selAcara, 'heat', newHeatId), {
        noHeat:          maxHeatNo + 1,
        fasa:            'final',
        peringkat:       'final',
        statusKeputusan: 'belum',
        peserta:         finalPeserta,
        bilanganLorong:  finalistList.length,
        caraPilih:       acara.caraPilihFinal || 'hybrid',
        janaFinalDari:   nonFinalHeats.map(h => h.id),
        createdAt:       serverTimestamp(),
      })

      // Reload heat list
      const snap = await getDocs(collection(db, 'kejohanan', selKej, 'acara', selAcara, 'heat'))
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(h => (h.peserta || []).length > 0)
        .sort((a, b) => (a.noHeat || 0) - (b.noHeat || 0))
      setHeatList(list)
      setMsg({ type: 'ok', text: `✓ Heat Final dijana dengan ${finalistList.length} atlet. Pilih heat Final untuk masukkan keputusan.` })
    } catch (e) {
      setMsg({ type: 'err', text: 'Ralat jana final: ' + e.message })
    } finally { setJanaFinalLoading(false) }
  }

  // ── Proses Semua Tertunggak — sweep heat tidak_rasmi yang timer tamat ────────

  async function prosesSemuaTertunggak() {
    if (!selKej || !canRasmi) return
    setSweeping(true)
    setSweepResult(null)
    let berjaya = 0, gagal = 0, tiada = 0
    try {
      // Load semua acara aktif
      const acaraSnap = await getDocs(collection(db, 'kejohanan', selKej, 'acara'))
      const now = Date.now()

      for (const acaraDoc of acaraSnap.docs) {
        const acaraData = { id: acaraDoc.id, ...acaraDoc.data() }
        const heatSnap  = await getDocs(
          collection(db, 'kejohanan', selKej, 'acara', acaraDoc.id, 'heat')
        )
        for (const heatDoc of heatSnap.docs) {
          const h = { id: heatDoc.id, ...heatDoc.data() }
          if (h.statusKeputusan !== 'tidak_rasmi') continue
          if (h.postRasmiSelesai) continue

          // Semak sama ada timer tamat
          let expired = false
          if (h.countdownTamat) {
            const tamatMs = h.countdownTamat?.toDate?.()?.getTime?.() || null
            if (tamatMs && now > tamatMs) expired = true
          } else if (h.publishedAt) {
            const pubMs   = h.publishedAt?.toDate?.()?.getTime?.() || (h.publishedAt?.seconds * 1000) || null
            const timerMs = (h.timerAutoRasmi ?? 30) * 60 * 1000
            if (pubMs && now > pubMs + timerMs) expired = true
          }
          if (!expired) { tiada++; continue }

          // Semak tiada bantahan menunggu
          try {
            const bSnap = await getDocs(query(
              collection(db, 'bantahan'),
              where('heatId', '==', h.id),
              where('status', '==', 'menunggu'),
            ))
            if (!bSnap.empty) { tiada++; continue }
          } catch { tiada++; continue }

          // Rasmi + postRasmi
          try {
            const hRef = doc(db, 'kejohanan', selKej, 'acara', acaraDoc.id, 'heat', h.id)
            let alreadyDone = false
            await runTransaction(db, async (tx) => {
              const snap = await tx.get(hRef)
              if (snap.data()?.postRasmiSelesai) { alreadyDone = true; return }
              tx.update(hRef, {
                statusKeputusan:  'rasmi',
                postRasmiSelesai: true,
                tarikhRasmi:      serverTimestamp(),
                rasmiOleh:        'auto_sweep',
                updatedAt:        serverTimestamp(),
              })
            })
            if (!alreadyDone) {
              const hUpdated      = { ...h, statusKeputusan: 'rasmi', postRasmiSelesai: true }
              const sweepHeatList = heatSnap.docs.map(d => ({ id: d.id, ...d.data() }))
              const isRelayOvr    = acaraData.isRelay || acaraData.jenisAcara === 'relay'
              const fasa          = h.fasa
              const isSaringAcara = (acaraData.peringkat || '').toLowerCase().includes('saringan') ||
                                    (acaraData.namaAcara  || '').toLowerCase().includes('saringan')
              const grantOvr      = !isSaringAcara && ((fasa ? ['final', 'terus_final'].includes(fasa) : false) || sweepHeatList.length === 1)
              await postRasmi(hUpdated, acaraData, selKej, { isRelayOverride: isRelayOvr, grantMedalOverride: grantOvr })
              // Update statusAcara — untuk saringan acara, abaikan final heat
              const heatAllSnap = await getDocs(collection(db, 'kejohanan', selKej, 'acara', acaraDoc.id, 'heat'))
              const isSaringSnap = (acaraData.peringkat || '').toLowerCase().includes('saringan') ||
                                   (acaraData.namaAcara  || '').toLowerCase().includes('saringan')
              const heatsUntukStatusSnap = heatAllSnap.docs.filter(d => {
                if (!isSaringSnap) return true
                const fd = d.data()
                return fd.fasa !== 'final' && fd.fasa !== 'terus_final' && fd.peringkat !== 'final'
              })
              const allRasmiSnap = heatsUntukStatusSnap.every(d => d.data().statusKeputusan === 'rasmi')
              if (allRasmiSnap) {
                await updateDoc(doc(db, 'kejohanan', selKej, 'acara', acaraDoc.id),
                  { statusAcara: 'rasmi' }).catch(() => {})
              }
            }
            berjaya++
          } catch { gagal++ }
        }
      }

      const msg = berjaya > 0
        ? `✓ ${berjaya} heat dirasmi. Medal tally dikemaskini.`
        : tiada > 0
        ? 'Tiada heat tertunggak ditemui.'
        : 'Tiada heat untuk diproses.'
      setSweepResult({ type: berjaya > 0 ? 'ok' : 'info', berjaya, gagal, tiada, msg })

      // Refresh heatList semasa
      if (selAcara) {
        const refreshed = await getDocs(
          collection(db, 'kejohanan', selKej, 'acara', selAcara, 'heat')
        )
        setHeatList(refreshed.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.noHeat || 0) - (b.noHeat || 0)))
      }
    } catch (e) {
      setSweepResult({ type: 'err', msg: 'Ralat sweep: ' + e.message })
    } finally { setSweeping(false) }
  }

  // ── Betulkan statusAcara semua acara dalam kejohanan ────────────────────────

  const [fixingStatus,    setFixingStatus]    = useState(false)
  const [fixStatusResult, setFixStatusResult] = useState(null)

  async function betulkanStatusAcara() {
    if (!selKej || !canRasmi) return
    if (!window.confirm('Kira semula dan betulkan statusAcara untuk SEMUA acara?\n\nIni akan betulkan label "Rasmi/Tidak Rasmi" dalam paparan awam.')) return
    setFixingStatus(true); setFixStatusResult(null)
    let fixed = 0, skip = 0
    try {
      const acaraSnap = await getDocs(collection(db, 'kejohanan', selKej, 'acara'))
      for (const acaraDoc of acaraSnap.docs) {
        const acaraData = acaraDoc.data()
        const heatSnap  = await getDocs(collection(db, 'kejohanan', selKej, 'acara', acaraDoc.id, 'heat'))
        const allHeats  = heatSnap.docs.map(d => ({ id: d.id, ...d.data() }))

        const isSaring = (acaraData.peringkat || '').toLowerCase().includes('saringan') ||
                         (acaraData.namaAcara  || '').toLowerCase().includes('saringan')

        // Heats yang relevan: saringan acara → abaikan final heat
        const relevantHeats = allHeats.filter(h => {
          if (!isSaring) return true
          return h.fasa !== 'final' && h.fasa !== 'terus_final' && h.peringkat !== 'final'
        })

        if (relevantHeats.length === 0) { skip++; continue }

        // Kira status betul
        const finalHeatRel = !isSaring && relevantHeats.find(h =>
          h.fasa === 'final' || h.fasa === 'terus_final' || h.peringkat === 'final'
        )
        let newStatus
        if (finalHeatRel) {
          newStatus = finalHeatRel.statusKeputusan === 'rasmi' ? 'rasmi' : 'tidak_rasmi'
        } else if (relevantHeats.some(h => h.statusKeputusan === 'rasmi')) {
          newStatus = relevantHeats.every(h => h.statusKeputusan === 'rasmi') ? 'rasmi' : 'tidak_rasmi'
        } else if (relevantHeats.some(h => h.statusKeputusan === 'tidak_rasmi')) {
          newStatus = 'tidak_rasmi'
        } else {
          skip++; continue // semua belum — jangan ubah
        }

        // Update jika berbeza
        if (acaraData.statusAcara !== newStatus) {
          await updateDoc(doc(db, 'kejohanan', selKej, 'acara', acaraDoc.id),
            { statusAcara: newStatus, updatedAt: serverTimestamp() }).catch(() => {})
          fixed++
        } else { skip++ }
      }
      setFixStatusResult({ type: 'ok', msg: `✓ ${fixed} acara dibetulkan. ${skip} acara tiada perubahan.` })
      // Refresh acaraList
      const refreshed = await getDocs(query(collection(db, 'kejohanan', selKej, 'acara'), orderBy('namaAcara')))
      setAcaraList(refreshed.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (e) {
      setFixStatusResult({ type: 'err', msg: 'Ralat: ' + e.message })
    } finally { setFixingStatus(false) }
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
        // Reset countdown 30 min, unlock untuk input semula + tandakan bantahanDiterima
        const tamatTs = Timestamp.fromMillis(Date.now() + 30 * 60 * 1000)
        await updateDoc(hRef, {
          statusKeputusan:  'tidak_rasmi',
          bantahanDiterima: true,
          countdownTamat:   tamatTs,
          updatedAt:        serverTimestamp(),
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

  // Senarai hari unik dari acaraList (sort ascending)
  const hariList = [...new Set(
    acaraList.map(a => a.hari).filter(h => h != null)
  )].sort((a, b) => Number(a) - Number(b))

  // Acara ditapis berdasarkan filter
  const acaraTapis = acaraList.filter(a => {
    if (a.isAktif === false) return false
    if (filterHari && String(a.hari) !== String(filterHari)) return false
    if (filterPeringkat) {
      const p = (a.peringkat || '').toLowerCase()
      const n = (a.namaAcara || '').toLowerCase()
      if (filterPeringkat === 'final' && !p.includes('final') && !n.includes('final')) return false
      if (filterPeringkat === 'saringan' && (p.includes('final') || n.includes('final'))) return false
    }
    if (filterCari.trim()) {
      const q = filterCari.trim().toLowerCase()
      const noMatch = String(a.noAcara || '').includes(q)
      const namaMatch = (a.namaAcara || '').toLowerCase().includes(q)
      if (!noMatch && !namaMatch) return false
    }
    return true
  })

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
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-[#003399]">Keputusan Rasmi</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Semak keputusan, urus bantahan, dan sahkan keputusan rasmi
          </p>
          {namaKej && <p className="text-xs font-semibold text-[#003399] mt-0.5">{namaKej}</p>}
        </div>

        {/* Butang Proses Semua Tertunggak + Betulkan Status — PT & Superadmin */}
        {canRasmi && selKej && (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-2 flex-wrap justify-end">
              <button
                onClick={prosesSemuaTertunggak}
                disabled={sweeping || fixingStatus}
                className="flex items-center gap-2 px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors active:scale-95">
                {sweeping
                  ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg> Memproses…</>
                  : '⚡ Proses Semua Tertunggak'}
              </button>
              <button
                onClick={betulkanStatusAcara}
                disabled={fixingStatus || sweeping}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors active:scale-95">
                {fixingStatus
                  ? <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg> Memproses…</>
                  : '🔧 Betulkan Status Acara'}
              </button>
            </div>
            {sweepResult && (
              <p className={`text-[10px] font-semibold ${sweepResult.type === 'ok' ? 'text-green-600' : sweepResult.type === 'err' ? 'text-red-500' : 'text-gray-500'}`}>
                {sweepResult.msg}
                {sweepResult.gagal > 0 && ` (${sweepResult.gagal} gagal)`}
              </p>
            )}
            {fixStatusResult && (
              <p className={`text-[10px] font-semibold ${fixStatusResult.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                {fixStatusResult.msg}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Selectors */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm space-y-3">

        {/* Baris 1: Carian + Filter Peringkat */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Carian no acara / nama */}
          <input
            type="text"
            placeholder="Cari no. acara atau nama…"
            value={filterCari}
            onChange={e => { setFilterCari(e.target.value); setSelAcara('') }}
            className="border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] w-44 bg-white"
          />
          {/* Filter Peringkat */}
          {(['', 'saringan', 'final']).map(p => (
            <button key={p}
              onClick={() => { setFilterPeringkat(p); setSelAcara('') }}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${filterPeringkat === p ? 'bg-[#003399] text-white border-[#003399]' : 'bg-white text-gray-500 border-gray-200 hover:border-[#003399] hover:text-[#003399]'}`}>
              {p === '' ? 'Semua' : p === 'saringan' ? 'Saringan' : 'Final'}
            </button>
          ))}
        </div>

        {/* Baris 2: Filter Hari */}
        {hariList.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mr-1">Hari:</span>
            <button
              onClick={() => { setFilterHari(''); setSelAcara('') }}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${filterHari === '' ? 'bg-[#003399] text-white border-[#003399]' : 'bg-white text-gray-500 border-gray-200 hover:border-[#003399] hover:text-[#003399]'}`}>
              Semua
            </button>
            {hariList.map(h => (
              <button key={h}
                onClick={() => { setFilterHari(String(h)); setSelAcara('') }}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${filterHari === String(h) ? 'bg-[#003399] text-white border-[#003399]' : 'bg-white text-gray-500 border-gray-200 hover:border-[#003399] hover:text-[#003399]'}`}>
                Hari {h}
              </button>
            ))}
          </div>
        )}

        {/* Baris 3: Pilih Acara + Heat */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Acara <span className="text-gray-300 font-normal normal-case">({acaraTapis.length} acara)</span>
            </label>
            <select className={cls.select} value={selAcara} onChange={e => setSelAcara(e.target.value)}
              disabled={!selKej || acaraTapis.length === 0}>
              <option value="">-- Pilih Acara --</option>
              {acaraTapis.map(a => (
                <option key={a.id} value={a.id}>
                  {a.noAcara ? `[${a.noAcara}] ` : ''}{a.namaAcara}
                </option>
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
                <div className="mt-3 pt-3 border-t border-green-100 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs text-green-600">
                    ✓ Keputusan dikunci. Medal tally dan mata olahragawan dikemaskini secara automatik.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {isSuperadmin && !editMode && (
                      <button
                        onClick={() => {
                          const init = {}
                          ;(heat.peserta || []).forEach(p => {
                            const key = p.noBib || p.noKP
                            init[key] = { keputusan: p.keputusan ?? '', status: p.status || 'selesai' }
                          })
                          setEditValues(init)
                          setEditMode(true)
                        }}
                        className="text-[10px] font-bold px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors shrink-0">
                        ✏️ Edit Keputusan Rasmi
                      </button>
                    )}
                    {isSuperadmin && editMode && (
                      <>
                        <button onClick={() => { setEditMode(false); setEditValues({}) }}
                          className="text-[10px] font-bold px-2.5 py-1.5 bg-gray-400 hover:bg-gray-500 text-white rounded-lg transition-colors shrink-0">
                          Batal
                        </button>
                        <button onClick={simpanEditRasmi} disabled={savingEdit}
                          className="text-[10px] font-bold px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition-colors shrink-0">
                          {savingEdit ? 'Menyimpan...' : '💾 Simpan + Kemas Kini Medal'}
                        </button>
                      </>
                    )}
                    {canRasmi && !editMode && (
                      <button onClick={rerunMedal} disabled={savingRasmi}
                        className="text-[10px] font-bold px-2.5 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-50 transition-colors shrink-0">
                        🔄 Jalankan Semula Medal
                      </button>
                    )}
                  </div>
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
                        const key = p.noBib || p.noKP
                        const rank = p.rankDalamHeat
                        const medal = isRasmi && rank === 1 ? '🥇' : isRasmi && rank === 2 ? '🥈' : isRasmi && rank === 3 ? '🥉' : null
                        const rowBg = isRasmi
                          ? rank === 1 ? 'bg-yellow-50/70' : rank === 2 ? 'bg-gray-50/60' : rank === 3 ? 'bg-orange-50/40' : ''
                          : ''
                        const rekodBadge = p.pecahRekod
                          ? { D: 'RD', N: 'RN', K: 'RK' }[p.pecahRekod] || `R${p.pecahRekod}`
                          : null
                        const ev = editValues[key] || {}
                        return (
                          <tr key={p.noBib || i} className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${editMode ? 'bg-amber-50/30' : rowBg}`}>
                            <td className="px-3 py-2 font-bold text-gray-600">
                              {medal || (rank ? `#${rank}` : '—')}
                            </td>
                            <td className="px-3 py-2 font-mono text-gray-400 text-[11px]">{p.noBib || '—'}</td>
                            <td className="px-3 py-2 font-semibold text-gray-700 max-w-[130px]">
                              <span className="truncate block">{p.namaAtlet || '—'}</span>
                              <div className="flex gap-1 flex-wrap mt-0.5">
                                {rekodBadge && (
                                  <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-400 text-white tracking-wide">
                                    {rekodBadge}
                                  </span>
                                )}
                                {isSaringanAcara && finalistBibs.has(p.noBib) && (
                                  <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-[#003399] text-white tracking-wide">
                                    FINAL
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-gray-400 text-[11px]">{p.kodSekolah || '—'}</td>
                            {!isPadang && <td className="px-3 py-2 text-center text-gray-400">{p.lorong || p.giliran || '—'}</td>}
                            <td className="px-3 py-2 text-right font-mono font-semibold text-[#003399]">
                              {editMode ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={ev.keputusan ?? ''}
                                  onChange={e => setEditValues(prev => ({ ...prev, [key]: { ...prev[key], keputusan: e.target.value } }))}
                                  className="w-20 border border-amber-300 rounded px-1.5 py-1 text-xs font-mono text-right focus:outline-none focus:border-amber-500 bg-white"
                                />
                              ) : (
                                isPadang
                                  ? (p.keputusan != null ? formatMeter(p.keputusan) : '—')
                                  : (p.keputusan != null ? formatSaat(p.keputusan) : '—')
                              )}
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
                              {editMode ? (
                                <select
                                  value={ev.status ?? p.status ?? 'selesai'}
                                  onChange={e => setEditValues(prev => ({ ...prev, [key]: { ...prev[key], status: e.target.value } }))}
                                  className="border border-amber-300 rounded px-1 py-1 text-[10px] focus:outline-none focus:border-amber-500 bg-white"
                                >
                                  <option value="selesai">selesai</option>
                                  <option value="DNS">DNS</option>
                                  <option value="DNF">DNF</option>
                                  <option value="DQ">DQ</option>
                                </select>
                              ) : (
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${STATUS_COLOR[p.status] || 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                                  {p.status || '—'}
                                </span>
                              )}
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

            {/* ── Panel Kelayakan Final (saringan sahaja) ── */}
            {isSaringanAcara && (
              <div className="bg-white border border-blue-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-blue-100 bg-blue-50 flex items-center justify-between">
                  <p className="text-xs font-semibold text-blue-700">🏁 Kelayakan Final</p>
                  <span className="text-[10px] text-blue-500">
                    {acara?.bilanganFinalis || 8} tempat
                  </span>
                </div>

                {finalistList.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-400">
                    {heatList.filter(h => h.peringkat !== 'final').length === 0
                      ? 'Tiada heat saringan.'
                      : 'Saringan belum selesai — tunggu semua heat rasmi/tidak rasmi.'}
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                      {finalistList.map((f, i) => {
                        const isCurrent = heat && (heat.peserta || []).some(p => p.noBib === f.noBib)
                        return (
                          <div key={f.noBib || i} className={`flex items-center gap-2 px-3 py-2 ${isCurrent ? 'bg-blue-50/60' : ''}`}>
                            <span className="text-[10px] font-mono text-gray-400 w-5 shrink-0">
                              {f.lorong ? `L${f.lorong}` : `${i+1}.`}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-700 truncate">{f.namaAtlet || '—'}</p>
                              <p className="text-[10px] text-gray-400">{f.kodSekolah} · H{f.noHeat}</p>
                            </div>
                            <span className="text-[10px] font-mono text-[#003399] shrink-0">
                              {['padang_lompat','padang_balin'].includes(acara?.jenisAcara)
                                ? formatMeter(f.keputusan)
                                : formatSaat(f.keputusan)}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Butang Jana Final */}
                    {bolehJanaFinal && (
                      <div className="px-3 py-2.5 border-t border-blue-100">
                        <button
                          onClick={handleJanaFinalAdmin}
                          disabled={janaFinalLoading}
                          className="w-full py-2 bg-[#003399] hover:bg-[#002280] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          {janaFinalLoading ? 'Menjana...' : semakHeatFinalAda ? '🔄 Jana Semula Final' : '🏁 Jana Heat Final'}
                        </button>
                        {semakHeatFinalAda && (
                          <p className="text-[10px] text-amber-600 mt-1.5 text-center">Heat Final sedia ada akan dipadam</p>
                        )}
                      </div>
                    )}
                    {!semakSaringanSelesai && (
                      <div className="px-3 py-2 border-t border-gray-100">
                        <p className="text-[10px] text-amber-600 text-center">⏳ Tunggu semua heat saringan selesai</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

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
