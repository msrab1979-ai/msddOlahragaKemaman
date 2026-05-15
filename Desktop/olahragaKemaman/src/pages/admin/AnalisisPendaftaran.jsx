/**
 * AnalisisPendaftaran.jsx — /dashboard/analisis
 *
 * Jadual analisis pendaftaran:
 *   Baris  = namaAcaraPendek (e.g. 100m, 200m, Lompat Jauh…)
 *   Lajur  = jantina + label kategori (L12, P12, L15, P10…)
 *   Nilai  = bilangan atlet yang mendaftar
 *
 * Data diambil dari:
 *   kejohanan/{id}/pendaftaran/{noKP} → { acaraIds[] }
 *   kejohanan/{id}/acara/{acaraId}    → { namaAcaraPendek, noAcara, jantina, kategoriKod }
 *   kategori/{kod}                    → { label, urutan }
 */

import { useState, useEffect } from 'react'
import {
  collection, getDocs, query, where, orderBy,
} from 'firebase/firestore'
import { db } from '../../firebase/config'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildAnalisis(acaraList, pendaftaranDocs, kategoriList) {
  // kod → { label, urutan }
  const katMeta = Object.fromEntries(
    kategoriList.map(k => [k.id, { label: k.label || k.id, urutan: k.urutan ?? 99 }])
  )

  // acaraId → bilangan atlet mendaftar
  const countMap = {}
  pendaftaranDocs.forEach(p => {
    ;(p.acaraIds || []).forEach(aid => {
      countMap[aid] = (countMap[aid] || 0) + 1
    })
  })

  // acaraId → kolum header "L12", "P12" dll
  const acaraColMap = {}
  acaraList.forEach(a => {
    const { label } = katMeta[a.kategoriKod] || { label: a.kategoriKod || '?' }
    acaraColMap[a.id] = `${a.jantina || '?'}${label}`
  })

  // Kolum unik & susun: L dulu, kemudian P, dalam jantina susun ikut urutan kategori
  const colSet = new Set(Object.values(acaraColMap))
  const colHeaders = Array.from(colSet).sort((a, b) => {
    const ja = a[0], jb = b[0]
    if (ja !== jb) return ja === 'L' ? -1 : 1
    const la = a.slice(1), lb = b.slice(1)
    const ua = kategoriList.find(k => (k.label || k.id) === la)?.urutan ?? 99
    const ub = kategoriList.find(k => (k.label || k.id) === lb)?.urutan ?? 99
    return ua - ub || la.localeCompare(lb)
  })

  // Kumpul acara by namaAcaraPendek
  const byNamaPendek = {}
  acaraList.forEach(a => {
    const key = a.namaAcaraPendek || a.namaAcara || '—'
    if (!byNamaPendek[key]) byNamaPendek[key] = []
    byNamaPendek[key].push(a)
  })

  // Susun kumpulan ikut noAcara terkecil
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

  // Jumlah per kolum
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AnalisisPendaftaran() {
  const [loading,    setLoading]    = useState(true)
  const [err,        setErr]        = useState(null)
  const [analisis,   setAnalisis]   = useState(null)
  const [namaKej,    setNamaKej]    = useState('')
  const [totalAtlet, setTotalAtlet] = useState(0) // bilangan doc pendaftaran unik

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

        // 2. Kategori
        const katSnap = await getDocs(query(collection(db, 'kategori'), orderBy('urutan')))
        const katList = katSnap.docs.map(d => ({ id: d.id, ...d.data() }))

        // 3. Acara (subkoleksi)
        const acaraSnap = await getDocs(
          query(collection(db, 'kejohanan', kejId, 'acara'), orderBy('noAcara'))
        )
        const acaraList = acaraSnap.docs.map(d => ({ id: d.id, ...d.data() }))

        // 4. Pendaftaran (subkoleksi)
        const daftarSnap = await getDocs(
          collection(db, 'kejohanan', kejId, 'pendaftaran')
        )
        const pendaftaranDocs = daftarSnap.docs.map(d => d.data())
        if (cancelled) return

        setTotalAtlet(pendaftaranDocs.length)
        setAnalisis(buildAnalisis(acaraList, pendaftaranDocs, katList))
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

  if (loading) {
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

  if (err) {
    return (
      <div className="p-6 max-w-xl">
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{err}</div>
      </div>
    )
  }

  if (!analisis) return null

  const { colHeaders, rows, colTotals, grandTotal } = analisis

  return (
    <div className="p-4 max-w-full space-y-4">

      {/* Header */}
      <div>
        <h1 className="text-base font-bold text-[#003399]">Analisis Pendaftaran</h1>
        {namaKej && <p className="text-xs text-gray-400 mt-0.5">{namaKej}</p>}
      </div>

      {/* Stat ringkas */}
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
              <tr
                key={row.namaPendek}
                className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-inherit border-r border-gray-100">
                  {row.namaPendek}
                </td>
                {colHeaders.map(col => {
                  const cnt = row.cols[col] || 0
                  return (
                    <td key={col} className="px-3 py-1.5 text-center text-gray-700">
                      {cnt > 0 ? (
                        <span className="font-semibold text-[#003399]">{cnt}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
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
                <td key={col} className="px-3 py-2 text-center">
                  {colTotals[col] || 0}
                </td>
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
        * Nilai menunjukkan bilangan slot pendaftaran, bukan bilangan atlet unik (atlet boleh mendaftar lebih dari satu acara).
      </p>
    </div>
  )
}
