/**
 * AnalisisPendaftaran.jsx — /dashboard/analisis
 *
 * Tab 1 — Ringkasan Acara:
 *   Baris  = namaAcaraPendek (e.g. 100m, 200m…)
 *   Lajur  = jantina + label kategori (L12, P12…)
 *   Nilai  = bilangan atlet mendaftar
 *
 * Tab 2 — Analisis Sekolah:
 *   Filter = jenis sekolah (SR / SM / PPKI)
 *   Baris  = nama sekolah
 *   Lajur  = acara (grouped) × sub-kategori (L12, P12…)
 *   Nilai  = bilangan atlet per sekolah per acara×sub-kategori
 *   Rumusan = ✓ jika semua kolum ada nilai, ✗ jika ada yang kosong
 */

import { useState, useEffect } from 'react'
import {
  collection, getDocs, query, where, orderBy,
} from 'firebase/firestore'
import { db } from '../../firebase/config'

// ─── Helpers — Tab 1 (Ringkasan Acara) ───────────────────────────────────────

function buildAnalisis(acaraList, pendaftaranDocs, kategoriList) {
  const katMeta = Object.fromEntries(
    kategoriList.map(k => [k.id, { label: k.label || k.id, urutan: k.urutan ?? 99 }])
  )

  const relayAcaraIds = new Set(
    acaraList.filter(a => a.jenisAcara === 'relay').map(a => a.id)
  )

  const countMap = {}
  const relaySekolahMap = {}

  pendaftaranDocs.forEach(p => {
    ;(p.acaraIds || []).forEach(aid => {
      if (relayAcaraIds.has(aid)) {
        if (!relaySekolahMap[aid]) relaySekolahMap[aid] = new Set()
        if (p.kodSekolah) relaySekolahMap[aid].add(p.kodSekolah)
      } else {
        countMap[aid] = (countMap[aid] || 0) + 1
      }
    })
  })

  Object.entries(relaySekolahMap).forEach(([aid, sekolahSet]) => {
    countMap[aid] = sekolahSet.size
  })

  const acaraColMap = {}
  acaraList.forEach(a => {
    const { label } = katMeta[a.kategoriKod] || { label: a.kategoriKod || '?' }
    acaraColMap[a.id] = `${a.jantina || '?'}${label}`
  })

  const colSet = new Set(Object.values(acaraColMap))
  const colHeaders = Array.from(colSet).sort((a, b) => {
    const ja = a[0], jb = b[0]
    if (ja !== jb) return ja === 'L' ? -1 : 1
    const la = a.slice(1), lb = b.slice(1)
    const ua = kategoriList.find(k => (k.label || k.id) === la)?.urutan ?? 99
    const ub = kategoriList.find(k => (k.label || k.id) === lb)?.urutan ?? 99
    return ua - ub || la.localeCompare(lb)
  })

  const byNamaPendek = {}
  acaraList.forEach(a => {
    const key = a.namaAcaraPendek || a.namaAcara || '—'
    if (!byNamaPendek[key]) byNamaPendek[key] = []
    byNamaPendek[key].push(a)
  })

  const rows = Object.entries(byNamaPendek)
    .map(([namaPendek, acList]) => {
      const minNo = Math.min(...acList.map(a => Number(a.noAcara) || 9999))
      const cols = {}
      let rowTotal = 0
      acList.forEach(a => {
        const col = acaraColMap[a.id]
        const cnt = countMap[a.id] || 0
        cols[col] = (cols[col] || 0) + cnt
        rowTotal += cnt
      })
      return { namaPendek, minNo, cols, total: rowTotal }
    })
    .sort((a, b) => a.minNo - b.minNo)

  const colTotals = {}
  let grandTotal = 0
  rows.forEach(r => {
    colHeaders.forEach(c => {
      colTotals[c] = (colTotals[c] || 0) + (r.cols[c] || 0)
    })
    grandTotal += r.total
  })

  return { colHeaders, rows, colTotals, grandTotal }
}

// ─── Helpers — Tab 2 (Analisis Sekolah) ──────────────────────────────────────

function buildAnalisisBySekolah(sekolahList, acaraList, pendaftaranDocs, kategoriList, jenisSekolah) {
  // 1. Sekolah ikut jenis
  const schools = sekolahList
    .filter(s => s.kategori === jenisSekolah)
    .sort((a, b) => (a.namaSekolah || '').localeCompare(b.namaSekolah || ''))

  // 2. Kategori atlet ikut jenisSekolah
  const relevantKats = kategoriList.filter(k => k.jenisSekolah === jenisSekolah)
  const relevantKatKods = new Set(relevantKats.map(k => k.id))
  const katLabel = Object.fromEntries(relevantKats.map(k => [k.id, k.label || k.id]))
  const katUrutan = Object.fromEntries(relevantKats.map(k => [k.id, k.urutan ?? 99]))

  // 3. Acara yang berkaitan
  const relevantAcara = acaraList.filter(a => relevantKatKods.has(a.kategoriKod))

  // 4. Kumpul acara ikut namaAcaraPendek
  const eventGroupMap = {}
  relevantAcara.forEach(a => {
    const key = a.namaAcaraPendek || a.namaAcara || '?'
    if (!eventGroupMap[key]) eventGroupMap[key] = []
    eventGroupMap[key].push(a)
  })

  const sortedEvents = Object.entries(eventGroupMap)
    .map(([name, acList]) => ({
      name,
      minNo: Math.min(...acList.map(a => Number(a.noAcara) || 9999)),
      acara: acList.sort((a, b) => {
        if (a.jantina !== b.jantina) return a.jantina === 'L' ? -1 : 1
        return (katUrutan[a.kategoriKod] ?? 99) - (katUrutan[b.kategoriKod] ?? 99)
      }),
    }))
    .sort((a, b) => a.minNo - b.minNo)

  const totalSubCols = sortedEvents.reduce((s, e) => s + e.acara.length, 0)

  // 5. countMap: { kodSekolah: { acaraId: count } }
  const countMap = {}
  pendaftaranDocs.forEach(p => {
    if (!p.kodSekolah) return
    if (!countMap[p.kodSekolah]) countMap[p.kodSekolah] = {}
    ;(p.acaraIds || []).forEach(aid => {
      countMap[p.kodSekolah][aid] = (countMap[p.kodSekolah][aid] || 0) + 1
    })
  })

  // 6. Bina baris
  const rows = schools.map(s => {
    const schoolCounts = countMap[s.kodSekolah] || {}
    let filledCols = 0

    const events = sortedEvents.map(ev => {
      const cols = ev.acara.map(a => {
        const cnt = schoolCounts[a.id] || 0
        if (cnt > 0) filledCols++
        return {
          acaraId: a.id,
          colKey: `${a.jantina}${katLabel[a.kategoriKod] || a.kategoriKod}`,
          cnt,
        }
      })
      return { name: ev.name, cols }
    })

    return {
      kodSekolah: s.kodSekolah,
      namaSekolah: s.namaSekolah || s.kodSekolah,
      events,
      filledCols,
      totalCols: totalSubCols,
      isLengkap: totalSubCols > 0 && filledCols === totalSubCols,
    }
  })

  // 7. Jumlah per sub-kolum
  const colTotals = {} // acaraId → total
  rows.forEach(r => {
    r.events.forEach(ev => {
      ev.cols.forEach(c => {
        colTotals[c.acaraId] = (colTotals[c.acaraId] || 0) + c.cnt
      })
    })
  })

  return { sortedEvents, rows, totalSubCols, colTotals }
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="p-6 flex items-center gap-2 text-sm text-gray-500">
      <svg className="w-4 h-4 animate-spin text-[#003399]" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
      Memuatkan analisis pendaftaran…
    </div>
  )
}

// ─── Tab 1: Ringkasan Acara ───────────────────────────────────────────────────

function TabRingkasanAcara({ analisis, totalAtlet }) {
  if (!analisis) return null
  const { colHeaders, rows, colTotals, grandTotal } = analisis

  return (
    <div className="space-y-4">
      {/* Stat */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: 'Jumlah Atlet Daftar', val: totalAtlet },
          { label: 'Jenis Acara',          val: rows.length },
          { label: 'Kategori',             val: colHeaders.length },
          { label: 'Jumlah Pendaftaran',   val: grandTotal },
        ].map(({ label, val }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-center min-w-[100px]">
            <p className="text-xl font-black text-[#003399]">{val}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Jadual */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#003399] text-white">
              <th className="text-left px-3 py-2 font-bold sticky left-0 bg-[#003399] z-10 min-w-[120px]">
                Acara
              </th>
              {colHeaders.map(col => (
                <th key={col} className="px-3 py-2 text-center font-bold whitespace-nowrap">
                  {col}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-bold bg-[#002280]">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.namaPendek} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-inherit border-r border-gray-100">
                  {row.namaPendek}
                </td>
                {colHeaders.map(col => {
                  const cnt = row.cols[col] || 0
                  return (
                    <td key={col} className="px-3 py-1.5 text-center text-gray-700">
                      {cnt > 0
                        ? <span className="font-semibold text-[#003399]">{cnt}</span>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                  )
                })}
                <td className="px-3 py-1.5 text-center font-bold text-gray-800 bg-blue-50 border-l border-blue-100">
                  {row.total}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[#003399] text-white font-bold">
              <td className="px-3 py-2 sticky left-0 bg-[#003399]">JUMLAH</td>
              {colHeaders.map(col => (
                <td key={col} className="px-3 py-2 text-center">{colTotals[col] || 0}</td>
              ))}
              <td className="px-3 py-2 text-center bg-[#002280]">{grandTotal}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">Tiada data pendaftaran lagi.</p>
      )}
      <p className="text-[10px] text-gray-400">
        * Acara biasa: bilangan atlet mendaftar. Acara relay: bilangan pasukan (sekolah unik).
      </p>
    </div>
  )
}

// ─── Tab 2: Analisis Sekolah ──────────────────────────────────────────────────

function TabAnalisisSekolah({ sekolahList, acaraList, pendaftaranDocs, kategoriList }) {
  // Jenis sekolah unik dari data kategori (dinamik)
  const jenisOptions = [...new Set(
    kategoriList.map(k => k.jenisSekolah).filter(Boolean)
  )].sort()

  const [jenisSekolah, setJenisSekolah] = useState(() => jenisOptions[0] || 'SR')

  const data = buildAnalisisBySekolah(
    sekolahList, acaraList, pendaftaranDocs, kategoriList, jenisSekolah
  )
  const { sortedEvents, rows, totalSubCols, colTotals } = data

  const lengkapCount  = rows.filter(r => r.isLengkap).length
  const semuaSekolah  = rows.length

  return (
    <div className="space-y-4">

      {/* Filter jenis sekolah */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 font-medium">Jenis Sekolah:</span>
        {jenisOptions.map(jenis => (
          <button
            key={jenis}
            onClick={() => setJenisSekolah(jenis)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              jenisSekolah === jenis
                ? 'bg-[#003399] text-white border-[#003399]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#003399]'
            }`}
          >
            {jenis}
          </button>
        ))}
      </div>

      {/* Stat */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: 'Sekolah Berdaftar',   val: semuaSekolah },
          { label: 'Sekolah Lengkap',     val: lengkapCount },
          { label: 'Sekolah Tidak Lengkap', val: semuaSekolah - lengkapCount },
          { label: 'Jenis Acara',          val: sortedEvents.length },
        ].map(({ label, val }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-center min-w-[100px]">
            <p className="text-xl font-black text-[#003399]">{val}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6 bg-white border border-gray-100 rounded-xl">
          Tiada sekolah {jenisSekolah} atau tiada acara untuk kategori ini.
        </p>
      ) : (

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              {/* Baris 1: nama acara (grouped) */}
              <tr className="bg-[#003399] text-white">
                <th
                  rowSpan={2}
                  className="text-left px-3 py-2 font-bold sticky left-0 bg-[#003399] z-20 min-w-[160px] border-r border-[#002280]"
                >
                  Nama Sekolah
                </th>
                {sortedEvents.map(ev => (
                  <th
                    key={ev.name}
                    colSpan={ev.acara.length}
                    className="px-2 py-1.5 text-center font-bold whitespace-nowrap border-l border-[#002280] text-[10px] uppercase tracking-wide"
                  >
                    {ev.name}
                  </th>
                ))}
                <th
                  rowSpan={2}
                  className="px-3 py-2 text-center font-bold bg-[#002280] whitespace-nowrap border-l border-[#001a66]"
                >
                  Rumusan
                </th>
              </tr>
              {/* Baris 2: sub-kategori (L12, P12, …) */}
              <tr className="bg-[#0044bb] text-white">
                {sortedEvents.map(ev =>
                  ev.acara.map(a => (
                    <th
                      key={a.id}
                      className="px-2 py-1 text-center font-semibold whitespace-nowrap border-l border-[#0033aa] text-[10px]"
                    >
                      {`${a.jantina}${(kategoriList.find(k => k.id === a.kategoriKod)?.label) || a.kategoriKod}`}
                    </th>
                  ))
                )}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, i) => (
                <tr key={row.kodSekolah} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {/* Nama sekolah */}
                  <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-inherit border-r border-gray-100 whitespace-nowrap">
                    {row.namaSekolah}
                  </td>
                  {/* Nilai per acara × sub-kategori */}
                  {row.events.map(ev =>
                    ev.cols.map(c => (
                      <td key={c.acaraId} className="px-2 py-1.5 text-center border-l border-gray-100">
                        {c.cnt > 0
                          ? <span className="font-semibold text-[#003399]">{c.cnt}</span>
                          : <span className="text-red-300 font-bold">0</span>
                        }
                      </td>
                    ))
                  )}
                  {/* Rumusan */}
                  <td className="px-3 py-1.5 text-center border-l border-blue-100 bg-blue-50/50">
                    {row.isLengkap ? (
                      <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        ✓ Lengkap
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-red-50 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                        ✗ {row.filledCols}/{row.totalCols}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>

            {/* Footer: jumlah per sub-kolum */}
            <tfoot>
              <tr className="bg-[#003399] text-white font-bold">
                <td className="px-3 py-2 sticky left-0 bg-[#003399]">JUMLAH</td>
                {sortedEvents.map(ev =>
                  ev.acara.map(a => (
                    <td key={a.id} className="px-2 py-2 text-center border-l border-[#002280]">
                      {colTotals[a.id] || 0}
                    </td>
                  ))
                )}
                <td className="px-3 py-2 text-center bg-[#002280] border-l border-[#001a66]">
                  {lengkapCount}/{semuaSekolah}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[10px] text-gray-400">
        * Nilai 0 (merah) = tiada pendaftaran untuk acara × kategori tersebut. Rumusan ✓ jika semua kolum ada nilai.
      </p>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AnalisisPendaftaran() {
  const [loading,          setLoading]          = useState(true)
  const [err,              setErr]              = useState(null)
  const [namaKej,          setNamaKej]          = useState('')
  const [totalAtlet,       setTotalAtlet]       = useState(0)
  const [analisis,         setAnalisis]         = useState(null)   // Tab 1
  const [sekolahList,      setSekolahList]      = useState([])     // Tab 2
  const [acaraList,        setAcaraList]        = useState([])     // Tab 2
  const [pendaftaranDocs,  setPendaftaranDocs]  = useState([])     // Tab 2
  const [kategoriList,     setKategoriList]     = useState([])     // Tab 2
  const [activeTab,        setActiveTab]        = useState('acara') // 'acara' | 'sekolah'

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setErr(null)
      try {
        // 1. Kejohanan aktif
        const kejSnap = await getDocs(
          query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif'))
        )
        if (cancelled) return
        if (kejSnap.empty) { setErr('Tiada kejohanan aktif.'); setLoading(false); return }
        const kejDoc = kejSnap.docs[0]
        const kejId  = kejDoc.id
        setNamaKej(kejDoc.data().namaKejohanan || '')

        // 2. Kategori atlet + sekolah (parallel)
        const [katSnap, sekolahSnap] = await Promise.all([
          getDocs(query(collection(db, 'kategori'), orderBy('urutan'))),
          getDocs(collection(db, 'sekolah')),
        ])
        if (cancelled) return
        const katList   = katSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        const sklList   = sekolahSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        setKategoriList(katList)
        setSekolahList(sklList)

        // 3. Acara
        const acaraSnap = await getDocs(
          query(collection(db, 'kejohanan', kejId, 'acara'), orderBy('noAcara'))
        )
        const acList = acaraSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        setAcaraList(acList)

        // 4. Pendaftaran
        const daftarSnap = await getDocs(
          collection(db, 'kejohanan', kejId, 'pendaftaran')
        )
        const daftarDocs = daftarSnap.docs.map(d => d.data())
        if (cancelled) return
        setPendaftaranDocs(daftarDocs)
        setTotalAtlet(daftarDocs.length)

        // Tab 1 data
        setAnalisis(buildAnalisis(acList, daftarDocs, katList))
      } catch (e) {
        if (!cancelled) setErr('Ralat memuatkan data: ' + e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) return <Spinner />

  if (err) {
    return (
      <div className="p-6 max-w-xl">
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{err}</div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-full space-y-4">

      {/* Header */}
      <div>
        <h1 className="text-base font-bold text-[#003399]">Analisis Pendaftaran</h1>
        {namaKej && <p className="text-xs text-gray-400 mt-0.5">{namaKej}</p>}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'acara',   label: 'Ringkasan Acara'  },
          { key: 'sekolah', label: 'Analisis Sekolah' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-[#003399] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'acara' && (
        <TabRingkasanAcara analisis={analisis} totalAtlet={totalAtlet} />
      )}

      {activeTab === 'sekolah' && (
        <TabAnalisisSekolah
          sekolahList={sekolahList}
          acaraList={acaraList}
          pendaftaranDocs={pendaftaranDocs}
          kategoriList={kategoriList}
        />
      )}
    </div>
  )
}
