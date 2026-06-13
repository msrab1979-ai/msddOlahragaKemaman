/**
 * MedalTally — /dashboard/medal
 *
 * Ranking Olympic style: Emas → Perak → Gangsa → nama abjad
 * Real-time via onSnapshot.
 * Accordion by jenisSekolah (SR / SM / PPKI / Lain-lain)
 */

import { useState, useEffect, useRef } from 'react'
import {
  collection, getDocs, query, where, onSnapshot, doc, getDoc,
} from 'firebase/firestore'
import { db } from '../../firebase/config'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortTally(a, b) {
  const ae = a.emas || 0, be = b.emas || 0
  if (be !== ae) return be - ae
  const ap = a.perak || 0, bp = b.perak || 0
  if (bp !== ap) return bp - ap
  const ag = a.gangsa || 0, bg = b.gangsa || 0
  if (bg !== ag) return bg - ag
  // T4/T5 sebagai tiebreaker — bukan pingat, tidak masuk jumlah
  const a4 = a.tempat4 || 0, b4 = b.tempat4 || 0
  if (b4 !== a4) return b4 - a4
  const a5 = a.tempat5 || 0, b5 = b.tempat5 || 0
  if (b5 !== a5) return b5 - a5
  return (a.namaSekolah || a.kodSekolah || '').localeCompare(
    b.namaSekolah || b.kodSekolah || '', 'ms'
  )
}

function rankWithTies(sorted) {
  let rank = 1
  return sorted.map((item, i) => {
    if (i === 0) return { ...item, rank: 1 }
    const prev = sorted[i - 1]
    // Seri hanya jika E, P, G, T4, T5 semua sama
    const sama =
      (item.emas    || 0) === (prev.emas    || 0) &&
      (item.perak   || 0) === (prev.perak   || 0) &&
      (item.gangsa  || 0) === (prev.gangsa  || 0) &&
      (item.tempat4 || 0) === (prev.tempat4 || 0) &&
      (item.tempat5 || 0) === (prev.tempat5 || 0)
    if (!sama) rank = i + 1
    return { ...item, rank }
  })
}

const MEDAL_STYLE = {
  1: { bg: 'bg-yellow-50  border-yellow-300', text: 'text-yellow-700', rankBg: 'bg-yellow-400  text-white', label: 'EMAS'   },
  2: { bg: 'bg-gray-50    border-gray-300',   text: 'text-gray-600',   rankBg: 'bg-gray-400    text-white', label: 'PERAK'  },
  3: { bg: 'bg-orange-50  border-orange-200', text: 'text-orange-700', rankBg: 'bg-orange-400  text-white', label: 'GANGSA' },
}

const JENIS_CONFIG = {
  SR:         { label: 'Sekolah Rendah',          bar: 'bg-blue-600',   badge: 'bg-blue-100 text-blue-700'   },
  SM:         { label: 'Sekolah Menengah',         bar: 'bg-green-600',  badge: 'bg-green-100 text-green-700' },
  PPKI:       { label: 'Pendidikan Khas (PPKI)',   bar: 'bg-purple-600', badge: 'bg-purple-100 text-purple-700' },
  'Lain-lain':{ label: 'Lain-lain',               bar: 'bg-gray-400',   badge: 'bg-gray-100 text-gray-600'   },
}

function jenisLabel(jenis) {
  return JENIS_CONFIG[jenis]?.label || jenis
}

function MedalCoin({ count, type }) {
  const cfg = {
    emas:   { bg: 'bg-yellow-400', border: 'border-yellow-500', text: 'text-yellow-900' },
    perak:  { bg: 'bg-gray-300',   border: 'border-gray-400',   text: 'text-gray-800'  },
    gangsa: { bg: 'bg-orange-300', border: 'border-orange-400', text: 'text-orange-900'},
  }[type] || { bg: 'bg-gray-200', border: 'border-gray-300', text: 'text-gray-700' }
  return (
    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-black ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      {count || 0}
    </div>
  )
}

// ─── Tally Table (within accordion) ──────────────────────────────────────────

const EXTRA_COL = {
  tempat4: { label: 'T4', text: 'text-slate-600',  bg: 'bg-slate-100', border: 'border-slate-300' },
  tempat5: { label: 'T5', text: 'text-zinc-500',   bg: 'bg-zinc-100',  border: 'border-zinc-300'  },
}

function TallyTable({ rows, bilanganKedudukan = 3, showJumlah = false }) {
  const showT4 = bilanganKedudukan >= 4
  const showT5 = bilanganKedudukan >= 5

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-gray-400">Tiada sekolah dengan pingat lagi.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
            <th className="px-4 py-3 text-center w-12">No.</th>
            <th className="px-4 py-3 text-left">Sekolah</th>
            <th className="px-4 py-3 text-center w-14">
              <span className="inline-block w-4 h-4 rounded-full bg-yellow-400 border-2 border-yellow-500" title="Emas" />
            </th>
            <th className="px-4 py-3 text-center w-14">
              <span className="inline-block w-4 h-4 rounded-full bg-gray-300 border-2 border-gray-400" title="Perak" />
            </th>
            <th className="px-4 py-3 text-center w-14">
              <span className="inline-block w-4 h-4 rounded-full bg-orange-300 border-2 border-orange-400" title="Gangsa" />
            </th>
            {showT4 && <th className="px-3 py-3 text-center w-12 text-slate-500">T4</th>}
            {showT5 && <th className="px-3 py-3 text-center w-12 text-zinc-400">T5</th>}
            {showJumlah && <th className="px-4 py-3 text-center w-16">Jum</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const style = MEDAL_STYLE[t.rank] || {}
            const isTop3 = t.rank <= 3
            const jumlah = (t.emas||0)+(t.perak||0)+(t.gangsa||0)
            return (
              <tr
                key={t.id}
                className={`border-b border-gray-100 transition-colors ${
                  isTop3
                    ? `${style.bg} border-l-4 ${
                        t.rank === 1 ? 'border-l-yellow-400'
                      : t.rank === 2 ? 'border-l-gray-400'
                      : 'border-l-orange-400'
                      }`
                    : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-4 py-3 text-center">
                  {isTop3 ? (
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-black ${style.rankBg}`}>
                      {t.rank}
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-gray-400">{t.rank}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className={`font-semibold ${isTop3 ? style.text : 'text-gray-800'}`}>
                    {t.namaSekolah || t.kodSekolah}
                  </p>
                  <p className="text-[10px] text-gray-400 font-mono">{t.kodSekolah}</p>
                </td>
                <td className="px-4 py-3 text-center"><MedalCoin count={t.emas}   type="emas"   /></td>
                <td className="px-4 py-3 text-center"><MedalCoin count={t.perak}  type="perak"  /></td>
                <td className="px-4 py-3 text-center"><MedalCoin count={t.gangsa} type="gangsa" /></td>
                {showT4 && (
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs font-bold ${(t.tempat4||0)>0 ? EXTRA_COL.tempat4.text : 'text-gray-300'}`}>
                      {t.tempat4 || 0}
                    </span>
                  </td>
                )}
                {showT5 && (
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs font-bold ${(t.tempat5||0)>0 ? EXTRA_COL.tempat5.text : 'text-gray-300'}`}>
                      {t.tempat5 || 0}
                    </span>
                  </td>
                )}
                {showJumlah && (
                  <td className="px-4 py-3 text-center">
                    <span className={`text-sm font-black ${isTop3 ? style.text : 'text-gray-600'}`}>
                      {jumlah}
                    </span>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 border-t-2 border-gray-200">
            <td />
            <td className="px-4 py-2.5 text-[10px] font-bold text-gray-500 uppercase tracking-wide">
              {rows.length} sekolah
            </td>
            <td className="px-4 py-2.5 text-center">
              <span className="text-sm font-black text-yellow-700">{rows.reduce((s,t)=>s+(t.emas||0),0)}</span>
            </td>
            <td className="px-4 py-2.5 text-center">
              <span className="text-sm font-black text-gray-600">{rows.reduce((s,t)=>s+(t.perak||0),0)}</span>
            </td>
            <td className="px-4 py-2.5 text-center">
              <span className="text-sm font-black text-orange-700">{rows.reduce((s,t)=>s+(t.gangsa||0),0)}</span>
            </td>
            {showT4 && (
              <td className="px-3 py-2.5 text-center">
                <span className="text-sm font-black text-slate-500">{rows.reduce((s,t)=>s+(t.tempat4||0),0)}</span>
              </td>
            )}
            {showT5 && (
              <td className="px-3 py-2.5 text-center">
                <span className="text-sm font-black text-zinc-400">{rows.reduce((s,t)=>s+(t.tempat5||0),0)}</span>
              </td>
            )}
            {showJumlah && (
              <td className="px-4 py-2.5 text-center">
                <span className="text-sm font-black text-gray-700">
                  {rows.reduce((s,t)=>s+(t.emas||0)+(t.perak||0)+(t.gangsa||0),0)}
                </span>
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MedalTally() {
  const [selKej, setSelKej]               = useState('')
  const [namaKej, setNamaKej]             = useState('')
  const [bilanganKedudukan, setBilKed]    = useState(3)
  const [showJumlah, setShowJumlah]       = useState(false) // dari Firestore kejohanan.showJumlahMedalTally
  const [tallyList, setTallyList]         = useState([])
  const [sekolahMap, setSekolahMap]       = useState({}) // { kodSekolah: jenisSekolah }
  const [loading, setLoading]             = useState(false)
  const [lastUpdate, setLastUpdate]       = useState(null)
  const [expandedGroups, setExpandedGroups] = useState(new Set(['SR', 'SM', 'PPKI']))
  const unsubRef = useRef(null)

  // ── Load sekolah map (jenisSekolah per kodSekolah) ────────────────────────
  useEffect(() => {
    getDocs(collection(db, 'sekolah'))
      .then(snap => {
        const map = {}
        snap.docs.forEach(d => {
          const data = d.data()
          map[data.kodSekolah || d.id] = {
            jenisSekolah: data.jenisSekolah || 'Lain-lain',
            isAktif: data.isAktif !== false,
          }
        })
        setSekolahMap(map)
      })
      .catch(() => {})
  }, [])

  // ── Load kejohanan aktif ───────────────────────────────────────────────────
  useEffect(() => {
    getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif')))
      .then(snap => {
        if (!snap.empty) {
          const d = snap.docs[0]
          setSelKej(d.data().kejohananId || d.id)
          setNamaKej(d.data().namaKejohanan || '')
          setBilKed(d.data().bilanganKedudukan ?? 3)
          setShowJumlah(d.data().showJumlahMedalTally ?? false)
        }
      })
      .catch(() => {})
  }, [])

  // ── Subscribe real-time bila kejohanan bertukar ────────────────────────────
  useEffect(() => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    if (!selKej) { setTallyList([]); return }

    setLoading(true)
    const q = query(
      collection(db, 'medal_tally'),
      where('kejohananId', '==', selKej)
    )
    unsubRef.current = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setTallyList(data)
      setLastUpdate(new Date())
      setLoading(false)
    }, () => setLoading(false))

    return () => { if (unsubRef.current) unsubRef.current() }
  }, [selKej])

  // ── Group by jenisSekolah — sekolah nyahaktif disembunyikan ──────────────
  const activeTally = tallyList.filter(t => (sekolahMap[t.kodSekolah]?.isAktif ?? true))
  const groupedTally = activeTally.reduce((acc, t) => {
    const jenis = sekolahMap[t.kodSekolah]?.jenisSekolah || 'Lain-lain'
    if (!acc[jenis]) acc[jenis] = []
    acc[jenis].push(t)
    return acc
  }, {})

  // Sort within each group and apply ranking
  const rankedGroups = Object.fromEntries(
    Object.entries(groupedTally).map(([jenis, rows]) => [
      jenis,
      rankWithTies([...rows].sort(sortTally)),
    ])
  )

  // Order groups: SR, SM, PPKI, then the rest
  const GROUP_ORDER = ['SR', 'SM', 'PPKI']
  const jenisKeys = [
    ...GROUP_ORDER.filter(j => rankedGroups[j]),
    ...Object.keys(rankedGroups).filter(j => !GROUP_ORDER.includes(j)),
  ]

  // ── Derived totals (sekolah nyahaktif dikecualikan) ────────────────────────
  const totalEmas   = activeTally.reduce((s, t) => s + (t.emas   || 0), 0)
  const totalPerak  = activeTally.reduce((s, t) => s + (t.perak  || 0), 0)
  const totalGangsa = activeTally.reduce((s, t) => s + (t.gangsa || 0), 0)

  function toggleGroup(jenis) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(jenis)) next.delete(jenis)
      else next.add(jenis)
      return next
    })
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-800">Medal Tally</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Ranking Olympic — Emas → Perak → Gangsa · Real-time
          </p>
          {namaKej && <p className="text-xs font-semibold text-[#003399] mt-0.5">{namaKej}</p>}
        </div>
        {lastUpdate && (
          <p className="text-[10px] text-gray-400 font-mono self-end">
            Dikemaskini: {lastUpdate.toLocaleTimeString('ms-MY', { hour12: true })}
          </p>
        )}
      </div>

      {/* ── Summary Cards ─────────────────────────────────────────────────── */}
      {selKej && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Emas',   count: totalEmas,   bg: 'bg-yellow-50 border-yellow-200', coin: 'bg-yellow-400 border-yellow-500', text: 'text-yellow-800' },
            { label: 'Perak',  count: totalPerak,  bg: 'bg-gray-50 border-gray-200',     coin: 'bg-gray-400 border-gray-500',     text: 'text-gray-700'   },
            { label: 'Gangsa', count: totalGangsa, bg: 'bg-orange-50 border-orange-200', coin: 'bg-orange-300 border-orange-400', text: 'text-orange-800' },
          ].map(({ label, count, bg, coin, text }) => (
            <div key={label} className={`${bg} border rounded-xl shadow-sm p-3 sm:p-4 flex items-center gap-2 sm:gap-3`}>
              <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 ${coin} flex items-center justify-center shrink-0`}>
                <span className="text-xs font-black text-white">{count}</span>
              </div>
              <div>
                <p className={`text-lg font-black ${text}`}>{count}</p>
                <p className="text-[9px] text-gray-500 uppercase tracking-widest">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {!selKej ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm py-16 text-center">
          <p className="text-3xl mb-2">🏆</p>
          <p className="text-sm font-semibold text-gray-600">Pilih kejohanan untuk paparkan medal tally.</p>
        </div>
      ) : loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-gray-400 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          Memuatkan…
        </div>
      ) : tallyList.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm py-16 text-center">
          <p className="text-3xl mb-2">🏅</p>
          <p className="text-sm font-semibold text-gray-600">Tiada pingat direkod lagi.</p>
          <p className="text-xs text-gray-400 mt-1">
            Pingat dikira secara automatik selepas keputusan RASMI direkodkan.
          </p>
        </div>
      ) : (
        /* ── Accordion by jenisSekolah ── */
        <div className="space-y-3">
          {/* Live badge + nama kejohanan */}
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-gray-600">{namaKej}</p>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] text-gray-500 font-semibold">LIVE</span>
            </div>
          </div>

          {jenisKeys.map(jenis => {
            const rows = rankedGroups[jenis] || []
            const cfg  = JENIS_CONFIG[jenis] || JENIS_CONFIG['Lain-lain']
            const isOpen = expandedGroups.has(jenis)
            const gEmas   = rows.reduce((s,t)=>s+(t.emas||0),0)
            const gPerak  = rows.reduce((s,t)=>s+(t.perak||0),0)
            const gGangsa = rows.reduce((s,t)=>s+(t.gangsa||0),0)

            return (
              <div key={jenis} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(jenis)}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-1.5 h-6 rounded-sm shrink-0 ${cfg.bar}`} />
                    <div className="text-left min-w-0">
                      <p className="text-sm font-bold text-gray-800">{jenisLabel(jenis)}</p>
                      <p className="text-[10px] text-gray-400">{rows.length} sekolah</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {/* Mini medal summary */}
                    <div className="hidden sm:flex items-center gap-2 text-[10px] font-bold">
                      <span className="text-yellow-700">{gEmas}E</span>
                      <span className="text-gray-500">{gPerak}P</span>
                      <span className="text-orange-700">{gGangsa}G</span>
                    </div>
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100">
                    <TallyTable rows={rows} bilanganKedudukan={bilanganKedudukan} showJumlah={showJumlah} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Nota Sistem ───────────────────────────────────────────────────── */}
      {selKej && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[10px] text-blue-700 space-y-0.5">
          <p className="font-bold">Nota Sistem:</p>
          <p>· Pingat dikira secara automatik selepas keputusan RASMI direkodkan.</p>
          <p>· Ranking per kumpulan: Emas → Perak → Gangsa → T4 → T5 → nama sekolah (abjad).</p>
          <p>· T4/T5 adalah tiebreaker sahaja — tidak dikira dalam jumlah pingat.</p>
          <p>· Dikemaskini masa nyata (real-time) tanpa perlu refresh halaman.</p>
        </div>
      )}
    </div>
  )
}
