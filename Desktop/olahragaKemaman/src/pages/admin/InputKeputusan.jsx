/**
 * InputKeputusan — /dashboard/keputusan
 *
 * Pencatat input keputusan per heat/giliran.
 * Accordion by kategoriKod — large tap targets, status traffic lights.
 *
 * Sokong:
 *  - Larian lorong  : input masa (ss.ms)
 *  - Mass start     : input masa (m:ss.ms)
 *  - Padang lompat  : input cubaan (m) × 3/6
 *  - Padang balin   : input cubaan (m) × 3/6
 *  - Relay          : input masa pasukan
 *  - Wind reading   : per heat (jika isWindReading = true)
 *  - Auto-rank dalam heat
 */

import { useState, useEffect, useCallback } from 'react'
import {
  collection, getDocs, doc, updateDoc,
  serverTimestamp, query, orderBy, where,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'

// ─── Konstanta ────────────────────────────────────────────────────────────────

const inputCls =
  'w-full border border-gray-200 rounded px-2 py-1.5 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-white'

const STATUS_LARIAN = ['selesai', 'DNS', 'DNF', 'DQ', 'FS']
const STATUS_PADANG  = ['selesai', 'DQ']
const STATUS_RELAY   = ['selesai', 'DNS', 'DNF', 'DQ']

const STATUS_COLOR = {
  selesai: 'bg-green-100 text-green-700 border-green-200',
  DNS:     'bg-gray-100  text-gray-600  border-gray-200',
  DNF:     'bg-amber-100 text-amber-700 border-amber-200',
  DQ:      'bg-red-100   text-red-700   border-red-200',
  FS:      'bg-orange-100 text-orange-700 border-orange-200',
  NM:      'bg-slate-100 text-slate-600 border-slate-200',
}

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }

const FASA_LABEL = {
  heat:     'Heat',
  final:    'Final',
  saringan: 'Saringan',
}

const JENIS_SHORT = {
  lorong:       'Lorong',
  mass_start:   'Mass',
  padang_lompat:'Lompat',
  padang_balin: 'Balin',
  relay:        'Relay',
}

const JENIS_COLOR = {
  lorong:       'bg-blue-50 text-blue-700',
  mass_start:   'bg-cyan-50 text-cyan-700',
  padang_lompat:'bg-green-50 text-green-700',
  padang_balin: 'bg-orange-50 text-orange-700',
  relay:        'bg-purple-50 text-purple-700',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function masaKeSaat(str) {
  if (!str || str.trim() === '') return null
  const s = str.trim()
  const colonIdx = s.indexOf(':')
  if (colonIdx !== -1) {
    const minit = parseFloat(s.substring(0, colonIdx))
    const saat  = parseFloat(s.substring(colonIdx + 1))
    if (isNaN(minit) || isNaN(saat)) return null
    return minit * 60 + saat
  }
  const v = parseFloat(s)
  return isNaN(v) ? null : v
}

function jarakTerbaik(cubaan) {
  if (!cubaan || cubaan.length === 0) return null
  const vals = cubaan
    .filter(c => c !== 'NM' && c !== '' && c !== null)
    .map(c => parseFloat(c))
    .filter(v => !isNaN(v))
  return vals.length > 0 ? Math.max(...vals) : null
}

function kiraRank(pesertaInputs, peserta, jenisAcara) {
  const isPadang = ['padang_lompat', 'padang_balin'].includes(jenisAcara)
  const nilai = peserta.map(p => {
    const inp = pesertaInputs[p.noBib] || {}
    const status = inp.status || 'selesai'
    if (['DNS', 'DNF', 'DQ', 'FS'].includes(status)) return { noBib: p.noBib, val: null }
    if (isPadang) {
      return { noBib: p.noBib, val: jarakTerbaik(inp.cubaan || []) }
    } else {
      return { noBib: p.noBib, val: masaKeSaat(inp.keputusan || '') }
    }
  })
  const sorted = [...nilai]
    .filter(n => n.val !== null)
    .sort((a, b) => isPadang ? b.val - a.val : a.val - b.val)
  const rankMap = {}
  let currentRank = 1
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].val === sorted[i - 1].val) {
      rankMap[sorted[i].noBib] = rankMap[sorted[i - 1].noBib]
    } else {
      rankMap[sorted[i].noBib] = currentRank
    }
    currentRank++
  }
  return rankMap
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBtn({ status, current, onClick, label }) {
  const isActive = current === status
  const col = STATUS_COLOR[status] || 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <button
      onClick={() => onClick(status)}
      className={`text-[10px] font-bold px-2 py-1 rounded border transition-all min-h-[32px] ${
        isActive
          ? `${col} ring-1 ring-offset-0 ring-current`
          : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
      }`}
    >
      {label || status}
    </button>
  )
}

function WindBadge({ windSpeed }) {
  if (windSpeed === null || windSpeed === undefined || windSpeed === '') return null
  const v = parseFloat(windSpeed)
  const legal = !isNaN(v) && Math.abs(v) <= 2.0
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
      legal ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
      {isNaN(v) ? '?' : (v > 0 ? '+' : '')}{isNaN(v) ? '' : v.toFixed(1)} m/s {legal ? '✓' : '✗'}
    </span>
  )
}

// ─── Row: Larian / Relay ──────────────────────────────────────────────────────

function LaranRow({ p, inp, onUpdate, rank, jenisAcara }) {
  const status    = inp.status || 'selesai'
  const cleared   = ['DNS', 'DNF', 'DQ', 'FS'].includes(status)
  const isRelay   = jenisAcara === 'relay'
  const isMass    = jenisAcara === 'mass_start'
  const statusList = isRelay ? STATUS_RELAY : STATUS_LARIAN

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50">
      <td className="px-3 py-3 text-center text-sm font-mono text-gray-500">
        {p.lorong ?? p.giliran ?? '—'}
      </td>
      <td className="px-3 py-3 text-center">
        <span className="text-xs font-bold text-[#003399]">{p.noBib}</span>
      </td>
      <td className="px-3 py-3">
        <p className="text-xs font-medium text-gray-800 leading-tight">{p.namaAtlet}</p>
        <p className="text-[10px] text-gray-400">{p.kodSekolah}</p>
      </td>
      <td className="px-3 py-3 w-32">
        {cleared ? (
          <span className={`text-[10px] font-bold px-2 py-1 rounded border ${STATUS_COLOR[status]}`}>{status}</span>
        ) : (
          <input
            type="text"
            value={inp.keputusan || ''}
            onChange={e => onUpdate({ keputusan: e.target.value })}
            placeholder={isMass ? 'm:ss.ms' : 'ss.ms'}
            className={inputCls + ' text-center font-mono'}
          />
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {statusList.map(s => (
            <StatusBtn key={s} status={s} current={status}
              onClick={v => onUpdate({ status: v, keputusan: v !== 'selesai' ? '' : inp.keputusan })}
            />
          ))}
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        {rank ? (
          <span className="text-sm">{RANK_MEDAL[rank] || rank}</span>
        ) : cleared ? (
          <span className="text-[10px] text-gray-300">—</span>
        ) : null}
      </td>
    </tr>
  )
}

// ─── Row: Padang ──────────────────────────────────────────────────────────────

function PadangRow({ p, inp, onUpdate, rank, bilanganCubaan }) {
  const status = inp.status || 'selesai'
  const isDQ   = status === 'DQ'
  const cubaan = inp.cubaan || Array(bilanganCubaan).fill('')
  const best   = jarakTerbaik(cubaan)

  function setCubaan(idx, val) {
    const arr = [...cubaan]
    arr[idx] = val
    onUpdate({ cubaan: arr })
  }

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50">
      <td className="px-3 py-3 text-center text-sm font-mono text-gray-500">
        {p.giliran ?? '—'}
      </td>
      <td className="px-3 py-3 text-center">
        <span className="text-xs font-bold text-[#003399]">{p.noBib}</span>
      </td>
      <td className="px-3 py-3">
        <p className="text-xs font-medium text-gray-800 leading-tight">{p.namaAtlet}</p>
        <p className="text-[10px] text-gray-400">{p.kodSekolah}</p>
      </td>
      <td className="px-3 py-3">
        {isDQ ? (
          <span className={`text-[10px] font-bold px-2 py-1 rounded border ${STATUS_COLOR.DQ}`}>DQ</span>
        ) : (
          <div className="flex gap-1 flex-wrap">
            {Array.from({ length: bilanganCubaan }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] text-gray-400">{i + 1}</span>
                <input
                  type="text"
                  value={cubaan[i] ?? ''}
                  onChange={e => setCubaan(i, e.target.value)}
                  placeholder="m/NM"
                  className="w-14 border border-gray-200 rounded px-1 py-1.5 text-[11px] text-center font-mono focus:outline-none focus:border-[#003399]"
                />
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-center">
        {best !== null ? (
          <span className="text-sm font-bold text-gray-800">{best.toFixed(2)}m</span>
        ) : (
          <span className="text-[10px] text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex gap-1">
          {STATUS_PADANG.map(s => (
            <StatusBtn key={s} status={s} current={status}
              onClick={v => onUpdate({ status: v })}
            />
          ))}
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        {rank ? (
          <span className="text-sm">{RANK_MEDAL[rank] || rank}</span>
        ) : isDQ ? (
          <span className="text-[10px] text-gray-300">—</span>
        ) : null}
      </td>
    </tr>
  )
}

// ─── Traffic light status for acara ──────────────────────────────────────────

function AcaraStatusDot({ heatList }) {
  if (!heatList) return <span className="w-2.5 h-2.5 rounded-full bg-gray-200 inline-block" title="Memuatkan…" />
  if (heatList.length === 0) return <span className="w-2.5 h-2.5 rounded-full bg-gray-200 inline-block" title="Tiada heat" />
  const rasmi = heatList.filter(h => h.statusKeputusan === 'rasmi').length
  const input = heatList.filter(h => h.statusKeputusan === 'tidak_rasmi').length
  if (rasmi === heatList.length)
    return <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" title="Selesai (Rasmi)" />
  if (rasmi > 0 || input > 0)
    return <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" title="Sebahagian diinput" />
  return <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" title="Belum diinput" />
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function InputKeputusan() {
  const { userData } = useAuth()

  // ── Data
  const [acaraList, setAcaraList]         = useState([])
  const [heatList, setHeatList]           = useState([])
  const [acaraHeats, setAcaraHeats]       = useState({}) // { aceraId: heatList } — for status dots

  // ── Selection
  const [selKejohanan, setSelKejohanan]   = useState('')
  const [namaKej, setNamaKej]             = useState('')
  const [selAcara, setSelAcara]           = useState('')
  const [selHeat, setSelHeat]             = useState('')

  // ── Active docs
  const [heat, setHeat]   = useState(null)
  const [acara, setAcara] = useState(null)

  // ── Input state
  const [pesertaInputs, setPesertaInputs] = useState({})
  const [windInput, setWindInput]         = useState('')

  // ── UI
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState(null)
  const [openKat, setOpenKat]   = useState(new Set())
  const [loadingHeats, setLoadingHeats] = useState(false)

  // ─── Load kejohanan aktif ────────────────────────────────────────────────────
  useEffect(() => {
    getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif')))
      .then(snap => {
        if (!snap.empty) {
          const d = snap.docs[0]
          setSelKejohanan(d.id)
          setNamaKej(d.data().namaKejohanan || '')
        }
      })
      .catch(() => {})
  }, [])

  // ─── Load acara bila kejohanan berubah ───────────────────────────────────────
  useEffect(() => {
    setAcaraList([])
    setSelAcara('')
    setHeatList([])
    setSelHeat('')
    setHeat(null)
    setAcara(null)
    setPesertaInputs({})
    setAcaraHeats({})
    setOpenKat(new Set())
    if (!selKejohanan) return

    getDocs(query(
      collection(db, 'kejohanan', selKejohanan, 'acara'),
      orderBy('kategoriKod')
    ))
      .then(snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setAcaraList(list)
        // Open all kategori by default
        const kats = new Set(list.map(a => a.kategoriKod).filter(Boolean))
        setOpenKat(kats)
      })
      .catch(() => {})
  }, [selKejohanan])

  // ─── Load heats bila acara dipilih ──────────────────────────────────────────
  useEffect(() => {
    setHeatList([])
    setSelHeat('')
    setHeat(null)
    setPesertaInputs({})
    if (!selKejohanan || !selAcara) return

    const ac = acaraList.find(a => a.id === selAcara || a.aceraId === selAcara)
    setAcara(ac || null)
    setLoadingHeats(true)

    getDocs(query(
      collection(db, 'kejohanan', selKejohanan, 'acara', selAcara, 'heat'),
      orderBy('noHeat')
    ))
      .then(snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setHeatList(list)
        // Cache heat status for this acara
        setAcaraHeats(prev => ({ ...prev, [selAcara]: list }))
      })
      .catch(() => {})
      .finally(() => setLoadingHeats(false))
  }, [selAcara, selKejohanan, acaraList])

  // ─── Load heat bila selHeat berubah ─────────────────────────────────────────
  useEffect(() => {
    setHeat(null)
    setPesertaInputs({})
    setWindInput('')
    if (!selHeat) return
    const h = heatList.find(h => h.id === selHeat || h.heatId === selHeat)
    if (!h) return
    setHeat(h)
    setWindInput(h.windSpeed != null ? String(h.windSpeed) : '')
    const inputs = {}
    ;(h.peserta || []).forEach(p => {
      inputs[p.noBib] = {
        status:    p.status    || 'selesai',
        keputusan: p.keputusan != null ? String(p.keputusan) : '',
        cubaan:    p.cubaan    || [],
      }
    })
    setPesertaInputs(inputs)
  }, [selHeat, heatList])

  // ─── Update input satu peserta ───────────────────────────────────────────────
  const updatePeserta = useCallback((noBib, patch) => {
    setPesertaInputs(prev => ({
      ...prev,
      [noBib]: { ...(prev[noBib] || {}), ...patch },
    }))
  }, [])

  // ─── Kira rank ───────────────────────────────────────────────────────────────
  const rankMap = heat && acara
    ? kiraRank(pesertaInputs, heat.peserta || [], acara.jenisAcara)
    : {}

  // ─── Simpan ──────────────────────────────────────────────────────────────────
  async function handleSimpan() {
    if (!heat || !acara || !selKejohanan) return
    setSaving(true)
    setMsg(null)
    try {
      const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
      const windVal  = windInput.trim() !== '' ? parseFloat(windInput) : null
      const isWL     = windVal !== null ? Math.abs(windVal) <= 2.0 : null

      const updatedPeserta = (heat.peserta || []).map(p => {
        const inp    = pesertaInputs[p.noBib] || {}
        const status = inp.status || 'selesai'
        const rank   = rankMap[p.noBib] || null

        if (isPadang) {
          const cubaan = (inp.cubaan || []).map(c => {
            if (c === '' || c === null || c === undefined) return null
            if (String(c).toUpperCase() === 'NM') return 'NM'
            const v = parseFloat(c)
            return isNaN(v) ? null : v
          })
          return { ...p, status, cubaan, keputusan: jarakTerbaik(cubaan), rankDalamHeat: rank }
        } else {
          const masaSaat = masaKeSaat(inp.keputusan || '')
          return {
            ...p, status,
            keputusan:     ['DNS','DNF','DQ','FS'].includes(status) ? null : (masaSaat ?? null),
            rankDalamHeat: rank,
          }
        }
      })

      const heatRef = doc(db, 'kejohanan', selKejohanan, 'acara', selAcara, 'heat', heat.id)
      await updateDoc(heatRef, {
        peserta: updatedPeserta,
        windSpeed: windVal,
        isWindLegal: isWL,
        statusKeputusan: 'tidak_rasmi',
        statusHeat: 'selesai',
        updatedAt: serverTimestamp(),
        updatedBy: userData?.uid || null,
      })

      const updatedHeat = {
        ...heat,
        peserta: updatedPeserta,
        windSpeed: windVal,
        isWindLegal: isWL,
        statusKeputusan: 'tidak_rasmi',
      }
      setHeat(updatedHeat)
      // Refresh heat status cache for this acara
      setAcaraHeats(prev => ({
        ...prev,
        [selAcara]: (prev[selAcara] || []).map(h => h.id === heat.id ? updatedHeat : h),
      }))
      setHeatList(prev => prev.map(h => h.id === heat.id ? updatedHeat : h))
      setMsg({ type: 'ok', text: 'Keputusan disimpan sebagai TIDAK RASMI.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Ralat: ' + e.message })
    } finally {
      setSaving(false)
    }
  }

  // ─── Derived ─────────────────────────────────────────────────────────────────
  const isPadang = acara && ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
  const isMass   = acara && acara.jenisAcara === 'mass_start'
  const isRelay  = acara && acara.jenisAcara === 'relay'
  const needWind = acara && acara.isWindReading
  const peserta  = heat?.peserta || []

  const bilanganCubaan = isPadang ? (acara?.bilanganCubaan || 6) : 0

  // Group acara by kategoriKod
  const acaraByKat = acaraList.reduce((acc, a) => {
    const kat = a.kategoriKod || 'Lain-lain'
    if (!acc[kat]) acc[kat] = []
    acc[kat].push(a)
    return acc
  }, {})
  const katKeys = Object.keys(acaraByKat).sort()

  function toggleKat(kat) {
    setOpenKat(prev => {
      const next = new Set(prev)
      if (next.has(kat)) next.delete(kat)
      else next.add(kat)
      return next
    })
  }

  function selectAcara(a) {
    setMsg(null)
    const newId = a.aceraId || a.id
    if (selAcara === newId) {
      setSelAcara('')
      setSelHeat('')
    } else {
      setSelAcara(newId)
      setSelHeat('')
    }
  }

  // ─── UI ──────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">

      {/* ── Page Header ── */}
      <div>
        <h1 className="text-base font-bold text-[#003399]">Input Keputusan</h1>
        <p className="text-xs text-gray-400 mt-0.5">Pilih kategori → acara → heat</p>
        {namaKej && <p className="text-xs font-semibold text-[#003399] mt-0.5">{namaKej}</p>}
      </div>

      {/* ── Accordion by Kategori ── */}
      {selKejohanan && acaraList.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm py-10 text-center text-gray-400">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm">Tiada acara dalam kejohanan ini.</p>
        </div>
      )}

      {selKejohanan && katKeys.length > 0 && (
        <div className="space-y-2">
          {katKeys.map(kat => {
            const acaraInKat = acaraByKat[kat]
            const isKatOpen  = openKat.has(kat)

            return (
              <div key={kat} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* Kategori header */}
                <button
                  onClick={() => toggleKat(kat)}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#003399] flex items-center justify-center text-white font-black text-sm shrink-0">
                      {kat}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">Kategori {kat}</p>
                      <p className="text-[10px] text-gray-400">{acaraInKat.length} acara</p>
                    </div>
                  </div>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${isKatOpen ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Acara list */}
                {isKatOpen && (
                  <div className="border-t border-gray-100">
                    {acaraInKat.map(a => {
                      const aceraId = a.aceraId || a.id
                      const isAceraOpen = selAcara === aceraId
                      const cachedHeats = acaraHeats[aceraId]

                      return (
                        <div key={aceraId}>
                          {/* Acara row — large tap target */}
                          <button
                            onClick={() => selectAcara(a)}
                            className={`w-full flex items-center justify-between px-5 py-4 border-b border-gray-50 transition-colors text-left min-h-[60px] ${
                              isAceraOpen
                                ? 'bg-blue-50 border-l-4 border-l-[#003399]'
                                : 'hover:bg-gray-50/70'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <AcaraStatusDot heatList={cachedHeats} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className={`text-sm font-semibold ${isAceraOpen ? 'text-[#003399]' : 'text-gray-800'}`}>
                                    {a.namaAcara}
                                  </p>
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                    a.jantina === 'L' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                                  }`}>
                                    {a.jantina === 'L' ? 'Lelaki' : 'Perempuan'}
                                  </span>
                                  {a.jenisAcara && (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${JENIS_COLOR[a.jenisAcara] || 'bg-gray-100 text-gray-600'}`}>
                                      {JENIS_SHORT[a.jenisAcara] || a.jenisAcara}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] font-mono text-gray-400 mt-0.5">{aceraId}</p>
                              </div>
                            </div>
                            <svg
                              className={`w-4 h-4 shrink-0 transition-transform ${isAceraOpen ? 'rotate-180 text-[#003399]' : 'text-gray-300'}`}
                              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>

                          {/* Heat list — expands when acara selected */}
                          {isAceraOpen && (
                            <div className="bg-blue-50/40 border-b border-blue-100">
                              {loadingHeats ? (
                                <div className="px-6 py-3 text-xs text-gray-400">Memuatkan heat…</div>
                              ) : heatList.length === 0 ? (
                                <div className="px-6 py-3 text-xs text-amber-600">
                                  Tiada heat. Jana start list dahulu.
                                </div>
                              ) : (
                                heatList.map(h => {
                                  const isHeatActive = selHeat === h.id
                                  return (
                                    <button
                                      key={h.id}
                                      onClick={() => setSelHeat(isHeatActive ? '' : h.id)}
                                      className={`w-full flex items-center justify-between px-7 py-3 border-b border-blue-50/70 transition-colors min-h-[48px] text-left ${
                                        isHeatActive
                                          ? 'bg-[#003399] text-white'
                                          : 'hover:bg-blue-50 bg-white/80'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className={`text-xs font-bold ${isHeatActive ? 'text-white' : 'text-gray-700'}`}>
                                          {FASA_LABEL[h.fasa] || h.fasa} {h.noHeat}
                                        </span>
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                          h.statusKeputusan === 'rasmi'
                                            ? 'bg-green-100 text-green-700'
                                            : h.statusKeputusan === 'tidak_rasmi'
                                              ? 'bg-amber-100 text-amber-700'
                                              : isHeatActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                                        }`}>
                                          {h.statusKeputusan === 'rasmi' ? '✅ Rasmi' : h.statusKeputusan === 'tidak_rasmi' ? '✏️ Draft' : 'Belum'}
                                        </span>
                                      </div>
                                      <span className={`text-[10px] ${isHeatActive ? 'text-white/70' : 'text-gray-400'}`}>
                                        {(h.peserta || []).length} peserta
                                      </span>
                                    </button>
                                  )
                                })
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Heat info + Wind ── */}
      {heat && acara && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-[#003399]">{acara.namaAcara}</span>
                <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold">
                  {FASA_LABEL[heat.fasa] || heat.fasa} {heat.noHeat}
                </span>
                {heat.statusKeputusan === 'tidak_rasmi' && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">TIDAK RASMI</span>
                )}
                {heat.statusKeputusan === 'rasmi' && (
                  <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">RASMI ✓</span>
                )}
                {!heat.statusKeputusan && (
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold">BELUM INPUT</span>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                {peserta.length} peserta ·{' '}
                {isPadang ? `${bilanganCubaan} cubaan` : isMass ? 'Mass Start' : isRelay ? 'Relay' : 'Larian Lorong'}
              </p>
            </div>

            {needWind && (
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase whitespace-nowrap">Angin (m/s)</label>
                <input
                  type="number" step="0.1" min="-9.9" max="9.9"
                  value={windInput}
                  onChange={e => setWindInput(e.target.value)}
                  placeholder="+1.2"
                  className="w-24 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center font-mono focus:outline-none focus:border-[#003399]"
                />
                <WindBadge windSpeed={windInput} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Results Table ── */}
      {heat && acara && peserta.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {!isPadang && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#003399] text-white text-[10px] uppercase tracking-wide">
                    <th className="px-3 py-3 text-center w-14">{isMass || isRelay ? 'Giliran' : 'Lorong'}</th>
                    <th className="px-3 py-3 text-center w-14">BIB</th>
                    <th className="px-3 py-3">Peserta</th>
                    <th className="px-3 py-3 w-32">Masa {isMass ? '(m:ss.ms)' : '(ss.ms)'}</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-center w-12">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {[...peserta]
                    .sort((a, b) => (isMass || isRelay ? (a.giliran ?? 0) - (b.giliran ?? 0) : (a.lorong ?? 0) - (b.lorong ?? 0)))
                    .map(p => (
                      <LaranRow
                        key={p.noBib} p={p}
                        inp={pesertaInputs[p.noBib] || { status: 'selesai', keputusan: '' }}
                        onUpdate={patch => updatePeserta(p.noBib, patch)}
                        rank={rankMap[p.noBib]}
                        jenisAcara={acara.jenisAcara}
                      />
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {isPadang && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#003399] text-white text-[10px] uppercase tracking-wide">
                    <th className="px-3 py-3 text-center w-14">Giliran</th>
                    <th className="px-3 py-3 text-center w-14">BIB</th>
                    <th className="px-3 py-3">Peserta</th>
                    <th className="px-3 py-3">Cubaan ({bilanganCubaan}×) — m/NM</th>
                    <th className="px-3 py-3 text-center w-20">Terbaik</th>
                    <th className="px-3 py-3 w-20">Status</th>
                    <th className="px-3 py-3 text-center w-12">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {[...peserta]
                    .sort((a, b) => (a.giliran ?? 0) - (b.giliran ?? 0))
                    .map(p => (
                      <PadangRow
                        key={p.noBib} p={p}
                        inp={pesertaInputs[p.noBib] || { status: 'selesai', cubaan: [] }}
                        onUpdate={patch => updatePeserta(p.noBib, patch)}
                        rank={rankMap[p.noBib]}
                        bilanganCubaan={bilanganCubaan}
                      />
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Empty states ── */}
      {heat && peserta.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 shadow-sm">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm">Tiada peserta dalam heat ini.</p>
        </div>
      )}

      {!selKejohanan && (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400 shadow-sm">
          <p className="text-4xl mb-3">🏟️</p>
          <p className="text-sm font-medium text-gray-500">Pilih kejohanan untuk bermula.</p>
        </div>
      )}

      {/* ── Message ── */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium border ${
          msg.type === 'ok'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      {/* ── Action Bar ── */}
      {heat && peserta.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
          <div className="flex gap-2 text-[10px] text-gray-500 flex-wrap">
            {Object.entries(
              peserta.reduce((acc, p) => {
                const s = pesertaInputs[p.noBib]?.status || 'selesai'
                acc[s] = (acc[s] || 0) + 1
                return acc
              }, {})
            ).map(([s, n]) => (
              <span key={s} className={`px-2 py-1 rounded-full border font-bold ${STATUS_COLOR[s] || 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                {s}: {n}
              </span>
            ))}
          </div>

          <button
            onClick={handleSimpan}
            disabled={saving || heat.statusKeputusan === 'rasmi'}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all ${
              heat.statusKeputusan === 'rasmi'
                ? 'bg-gray-300 cursor-not-allowed'
                : saving
                  ? 'bg-[#003399]/60 cursor-wait'
                  : 'bg-[#003399] hover:bg-[#002277] active:scale-95 shadow-sm'
            }`}
          >
            {saving ? 'Menyimpan…' : heat.statusKeputusan === 'rasmi' ? 'Rasmi — Terkunci' : 'Simpan (Tidak Rasmi)'}
          </button>
        </div>
      )}

      {/* ── Panduan ── */}
      {heat && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[10px] text-blue-700 leading-relaxed">
          <p className="font-bold mb-1">Panduan:</p>
          <ul className="space-y-0.5 list-disc list-inside">
            {!isPadang && <li>Masa: <code className="font-mono bg-blue-100 px-1 rounded">10.85</code> atau <code className="font-mono bg-blue-100 px-1 rounded">2:01.35</code></li>}
            {isPadang && <li>Jarak: meter cth <code className="font-mono bg-blue-100 px-1 rounded">7.85</code>. Cubaan tidak sah → <code className="font-mono bg-blue-100 px-1 rounded">NM</code></li>}
            {needWind && <li>Angin: +tailwind / -headwind. Had sah ≤ 2.0 m/s</li>}
            <li>DNS/DNF/DQ/FS → masa dikosongkan, tiada rank</li>
            <li>Disimpan sebagai TIDAK RASMI — admin sahkan sebelum rasmi</li>
          </ul>
        </div>
      )}
    </div>
  )
}
