/**
 * Rekod.jsx — /dashboard/rekod
 *
 * Paparan & pengurusan rekod daerah/negeri/kebangsaan per acara.
 * Pengurus Teknik boleh:
 *   - Tambah rekod awal (seed)
 *   - Import rekod dari Excel/CSV (template disediakan)
 *   - Cetak rekod semasa ke PDF
 *   - Sahkan / Tolak tuntutan rekod baru dari KeputusanRasmi
 *   - Edit & padam rekod (dengan audit ke rekod_sejarah)
 *
 * Doc key: {namaAcara}_{jantina}_{kategoriKod}_{peringkat} (uppercase, space→_)
 * Tuntutan: rekod/{rekodKey}_tuntutan (doc berasingan, pending confirmation)
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, getDoc, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERINGKAT_META = {
  D: { label: 'Daerah',      cls: 'bg-gray-100 text-gray-700 border-gray-300' },
  N: { label: 'Negeri',      cls: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  K: { label: 'Kebangsaan',  cls: 'bg-red-100 text-red-800 border-red-300' },
}

const PERINGKAT_LABEL = { D: 'DAERAH', N: 'NEGERI', K: 'KEBANGSAAN' }

const STATUS_META = {
  aktif:    { label: 'Aktif',    cls: 'bg-green-100 text-green-700' },
  dipecah:  { label: 'Dipecah',  cls: 'bg-gray-100 text-gray-500' },
}

const UNIT_LABEL = { s: 'saat', m: 'meter', mata: 'mata' }

function formatPrestasi(prestasi, unit) {
  if (prestasi === null || prestasi === undefined || prestasi === '') return '—'
  const v = Number(prestasi)
  if (isNaN(v)) return String(prestasi)
  if (unit === 's') {
    if (v >= 60) {
      const m = Math.floor(v / 60)
      const s = (v - m * 60).toFixed(2).padStart(5, '0')
      return `${m}:${s}`
    }
    return v.toFixed(2) + 's'
  }
  if (unit === 'm') return v.toFixed(2) + 'm'
  return String(v)
}

function rekodKey(namaAcara, jantina, kategoriKod, peringkat) {
  return [namaAcara, jantina, kategoriKod, peringkat]
    .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50'

const EMPTY_FORM = {
  namaAcara: '', jantina: 'L', kategoriKod: '', peringkat: 'D',
  noKP: '', namaAtlet: '', kodSekolah: '', namaSekolah: '',
  namaDaerah: '', namaNegeri: '',
  prestasi: '', unit: 's',
  windSpeed: '', isWindLegal: true, jenisRekod: 'elektronik',
  tarikhRekod: new Date().toISOString().split('T')[0],
  catatanKhas: '',
}

// ─── Import: validate satu baris ─────────────────────────────────────────────

function validateImportRow(r) {
  const errors = []
  const warnings = []

  const na = r.namaAcara?.toString().trim()
  const jt = r.jantina?.toString().trim()
  const kk = r.kategoriKod?.toString().trim()
  const pp = r.peringkat?.toString().trim()
  const pr = r.prestasi
  const un = r.unit?.toString().trim()

  if (!na)                          errors.push('namaAcara kosong')
  if (!['L','P'].includes(jt))      errors.push('jantina mesti L atau P')
  if (!kk)                          errors.push('kategoriKod kosong')
  if (!['D','N','K'].includes(pp))  errors.push('peringkat mesti D / N / K')
  if (!pr || isNaN(Number(pr)) || Number(pr) <= 0) errors.push('prestasi tidak sah')
  if (!['s','m'].includes(un))      errors.push('unit mesti s atau m')

  if (errors.length === 0) {
    if (pp === 'D' && !r.namaSekolah?.toString().trim()) warnings.push('namaSekolah kosong (Daerah)')
    if (pp === 'N' && !r.namaDaerah?.toString().trim())  warnings.push('namaDaerah kosong (Negeri)')
    if (pp === 'K' && !r.namaNegeri?.toString().trim())  warnings.push('namaNegeri kosong (Kebangsaan)')
  }

  return {
    errors,
    warnings,
    status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok',
  }
}

// ─── Template download ────────────────────────────────────────────────────────

function downloadTemplate(acaraList) {
  const wb = XLSX.utils.book_new()

  // Sheet 1: REKOD — headers + 3 contoh
  const headers = [
    'namaAcara','jantina','kategoriKod','peringkat',
    'namaAtlet','noKP','namaSekolah','namaDaerah','namaNegeri',
    'prestasi','unit','windSpeed','isWindLegal','jenisRekod','tarikhRekod','catatanKhas',
  ]
  const examples = [
    ['100M','L','C','D','Ahmad bin Ali','050112-11-1234','SK Sultan Ismail','','',12.45,'s',1.8,true,'elektronik','2025-04-12',''],
    ['Lompat Jauh','P','B','N','Siti binti Abu','','','Kemaman','',4.85,'m',0.5,true,'elektronik','2024-08-20',''],
    ['400M','L','A','K','','','','','Terengganu',52.30,'s','','','manual','2023-11-05','Rekod lama'],
  ]
  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...examples])
  // Set column widths
  ws1['!cols'] = [
    {wch:18},{wch:8},{wch:12},{wch:10},
    {wch:22},{wch:16},{wch:24},{wch:16},{wch:16},
    {wch:10},{wch:6},{wch:10},{wch:12},{wch:12},{wch:14},{wch:20},
  ]
  XLSX.utils.book_append_sheet(wb, ws1, 'REKOD')

  // Sheet 2: RUJUKAN — panduan nilai sah
  const rujukan = [
    ['KOLUM','NILAI SAH','NOTA'],
    ['jantina','L, P','L = Lelaki, P = Perempuan'],
    ['peringkat','D, N, K','D = Daerah, N = Negeri, K = Kebangsaan'],
    ['unit','s, m','s = masa (saat), m = jarak (meter)'],
    ['jenisRekod','elektronik, manual',''],
    ['isWindLegal','TRUE, FALSE','Angin ≤ 2.0 m/s = TRUE'],
    ['tarikhRekod','YYYY-MM-DD','Contoh: 2025-04-12'],
    ['prestasi','Nombor positif','Masa dalam saat (12.45), Jarak dalam meter (5.80). Masa >1 min dalam saat (800m = 125.32)'],
    ['windSpeed','Nombor atau kosong','Positif atau negatif. Cth: 1.8 atau -0.5'],
    ['','',''],
    ['PERINGKAT','KOLUM LOKASI WAJIB',''],
    ['D (Daerah)','namaSekolah',''],
    ['N (Negeri)','namaDaerah',''],
    ['K (Kebangsaan)','namaNegeri',''],
    ['','',''],
    ['NOTA PENTING','',''],
    ['Kolum wajib: namaAcara, jantina, kategoriKod, peringkat, prestasi, unit','',''],
    ['Kolum lain: boleh kosong (akan guna nilai default)','',''],
  ]
  const ws2 = XLSX.utils.aoa_to_sheet(rujukan)
  ws2['!cols'] = [{wch:20},{wch:20},{wch:60}]
  XLSX.utils.book_append_sheet(wb, ws2, 'RUJUKAN')

  // Sheet 3: CONTOH_ACARA — senarai acara unik dari sistem
  const acaraRows = [...new Set(
    acaraList.map(a => `${a.namaAcara}|||${a.kategoriKod}|||${a.jantina}`)
  )]
    .map(s => { const [n,k,j] = s.split('|||'); return [n, k, j] })
    .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))

  const ws3 = XLSX.utils.aoa_to_sheet([
    ['namaAcara (SALIN TEPAT)', 'kategoriKod', 'jantina'],
    ...acaraRows,
  ])
  ws3['!cols'] = [{wch:24},{wch:14},{wch:10}]
  XLSX.utils.book_append_sheet(wb, ws3, 'CONTOH_ACARA')

  XLSX.writeFile(wb, 'template_rekod_olahraga.xlsx')
}

// ─── Cetak Rekod PDF ──────────────────────────────────────────────────────────

function cetakRekodPDF(rekodList, kategoriList, selectedPeringkat) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.width
  const pageH = pdf.internal.pageSize.height
  const katMap = Object.fromEntries(kategoriList.map(k => [k.kod, k]))
  const today  = new Date().toLocaleDateString('ms-MY', { day:'2-digit', month:'2-digit', year:'numeric' })

  let isFirst = true

  selectedPeringkat.forEach(prg => {
    const filtered = rekodList.filter(r => r.peringkat === prg)
    if (filtered.length === 0) return

    if (!isFirst) pdf.addPage()
    isFirst = false

    // Header
    pdf.setFillColor(0, 51, 153)
    pdf.rect(0, 0, pageW, 30, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(13)
    pdf.setFont('helvetica', 'bold')
    pdf.text('REKOD OLAHRAGA MSSD KEMAMAN', pageW / 2, 11, { align: 'center' })
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`Peringkat: ${PERINGKAT_LABEL[prg]}`, pageW / 2, 19, { align: 'center' })
    pdf.text(`Tarikh Cetak: ${today}`, pageW / 2, 25, { align: 'center' })
    pdf.setTextColor(0, 0, 0)

    // Group by kategoriKod
    const grouped = filtered.reduce((acc, r) => {
      const k = r.kategoriKod || 'Lain-lain'
      if (!acc[k]) acc[k] = []
      acc[k].push(r)
      return acc
    }, {})

    const groupKeys = Object.keys(grouped).sort((a, b) => {
      const au = katMap[a]?.urutan ?? 999
      const bu = katMap[b]?.urutan ?? 999
      return au !== bu ? au - bu : a.localeCompare(b)
    })

    const lokasiHeader = prg === 'D' ? 'Sekolah' : prg === 'N' ? 'Daerah' : 'Negeri'
    const lokasiField  = prg === 'D' ? 'namaSekolah' : prg === 'N' ? 'namaDaerah' : 'namaNegeri'

    let startY = 34

    groupKeys.forEach(katKod => {
      const kat  = katMap[katKod]
      const rows = grouped[katKod]
        .sort((a, b) => a.namaAcara.localeCompare(b.namaAcara) || a.jantina.localeCompare(b.jantina))
        .map(r => [
          r.namaAcara,
          r.jantina,
          r.namaAtlet || '—',
          r[lokasiField] || '—',
          formatPrestasi(r.prestasi, r.unit) + (r.jenisRekod === 'manual' ? ' *' : ''),
          r.windSpeed != null
            ? `${r.windSpeed >= 0 ? '+' : ''}${Number(r.windSpeed).toFixed(1)}`
            : '—',
          r.tarikhRekod || '—',
        ])

      autoTable(pdf, {
        startY,
        head: [
          [{ content: `${kat?.nama || katKod}  (${katKod})`, colSpan: 7, styles: { fillColor: [0,51,153], textColor:[255,255,255], fontStyle:'bold', fontSize:8 } }],
          ['Acara','Jan.','Atlet', lokasiHeader,'Prestasi','Angin','Tarikh'],
        ],
        body: rows,
        styles:     { fontSize: 7, cellPadding: 1.8 },
        headStyles: { fillColor: [80,80,80], textColor:[255,255,255], fontSize:7, fontStyle:'bold' },
        alternateRowStyles: { fillColor: [248,249,252] },
        columnStyles: {
          0: { cellWidth: 36 },
          1: { cellWidth: 10, halign: 'center' },
          2: { cellWidth: 48 },
          3: { cellWidth: 48 },
          4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
          5: { cellWidth: 14, halign: 'center' },
          6: { cellWidth: 22, halign: 'center' },
        },
        margin: { left: 10, right: 10 },
        theme: 'grid',
      })

      startY = pdf.lastAutoTable.finalY + 5
    })

    // Footer
    pdf.setFontSize(6)
    pdf.setTextColor(150)
    pdf.text('* Rekod manual   |   Angin > 2.0 m/s tidak layak sebagai rekod rasmi (WA Rule)', 10, pageH - 6)
    pdf.text(`Sistem KOAM — mssdkemaman-olahraga.web.app`, pageW - 10, pageH - 6, { align: 'right' })
    pdf.setTextColor(0)
  })

  const label = selectedPeringkat.map(p => PERINGKAT_LABEL[p]).join('_')
  pdf.save(`Rekod_Olahraga_${label}_${new Date().toISOString().slice(0,10)}.pdf`)
}

// ─── Modal: Import Rekod ──────────────────────────────────────────────────────

function ImportRekodModal({ onClose, onDone }) {
  const [step,   setStep]   = useState('idle')   // idle | preview | importing | done
  const [rows,   setRows]   = useState([])
  const [result, setResult] = useState(null)
  const [err,    setErr]    = useState('')

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setErr('')
    try {
      const buffer = await file.arrayBuffer()
      const wb  = XLSX.read(buffer, { type: 'array' })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
      if (raw.length === 0) { setErr('Fail kosong atau format salah.'); return }

      const parsed = raw.map((r, i) => ({ data: r, idx: i + 2, ...validateImportRow(r) }))
      setRows(parsed)
      setStep('preview')
    } catch (ex) {
      setErr('Gagal baca fail: ' + ex.message)
    }
  }

  async function handleImport(includeWarns) {
    const toImport = rows.filter(r => r.status === 'ok' || (includeWarns && r.status === 'warn'))
    if (toImport.length === 0) { setErr('Tiada rekod untuk diimport.'); return }
    setStep('importing')

    let success = 0, failed = 0
    const CHUNK = 500

    try {
      for (let i = 0; i < toImport.length; i += CHUNK) {
        const chunk = toImport.slice(i, i + CHUNK)
        const batch = writeBatch(db)

        chunk.forEach(({ data: r }) => {
          const key = rekodKey(
            r.namaAcara.toString().trim(),
            r.jantina.toString().trim(),
            r.kategoriKod.toString().trim(),
            r.peringkat.toString().trim(),
          )
          const ref = doc(db, 'rekod', key)

          const windSpeed = (r.windSpeed !== '' && r.windSpeed != null)
            ? Number(r.windSpeed) : null

          const rawWind = r.isWindLegal?.toString().toLowerCase()
          const isWindLegal = rawWind === 'false' || rawWind === '0' ? false : true

          batch.set(ref, {
            rekodId:      key,
            namaAcara:    r.namaAcara.toString().trim(),
            jantina:      r.jantina.toString().trim(),
            kategoriKod:  r.kategoriKod.toString().trim().toUpperCase(),
            peringkat:    r.peringkat.toString().trim(),
            noKP:         r.noKP?.toString().trim()        || '',
            namaAtlet:    r.namaAtlet?.toString().trim()   || '',
            kodSekolah:   '',
            namaSekolah:  r.namaSekolah?.toString().trim() || '',
            namaDaerah:   r.namaDaerah?.toString().trim()  || '',
            namaNegeri:   r.namaNegeri?.toString().trim()  || '',
            prestasi:     Number(r.prestasi),
            unit:         r.unit.toString().trim(),
            windSpeed,
            isWindLegal,
            jenisRekod:   r.jenisRekod?.toString().trim() || 'elektronik',
            statusRekod:  'aktif',
            tarikhRekod:  r.tarikhRekod?.toString().trim() || new Date().toISOString().split('T')[0],
            kejohananId:  '',
            disahkanOleh: null,
            catatanKhas:  r.catatanKhas?.toString().trim() || '',
            updatedAt:    serverTimestamp(),
          })
        })

        try {
          await batch.commit()
          success += chunk.length
        } catch {
          failed += chunk.length
        }
      }

      setResult({ success, failed })
      setStep('done')
    } catch (ex) {
      setErr('Gagal import: ' + ex.message)
      setStep('preview')
    }
  }

  const okCount   = rows.filter(r => r.status === 'ok').length
  const warnCount = rows.filter(r => r.status === 'warn').length
  const errCount  = rows.filter(r => r.status === 'error').length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4">
      <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-[#003399] text-white px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-widest">Import Excel / CSV</p>
            <p className="text-sm font-bold">Import Rekod ke Sistem</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {err && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>
          )}

          {/* Step: idle */}
          {step === 'idle' && (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center space-y-3">
              <p className="text-3xl">📂</p>
              <p className="text-sm font-semibold text-gray-700">Pilih fail Excel (.xlsx) atau CSV (.csv)</p>
              <p className="text-xs text-gray-400">
                Gunakan template yang disediakan untuk elak ralat format.<br/>
                Sheet pertama dalam fail akan dibaca sebagai data rekod.
              </p>
              <label className="inline-block mt-2 px-6 py-2.5 bg-[#003399] hover:bg-[#002277] text-white text-xs font-bold rounded-lg cursor-pointer transition-colors">
                Pilih Fail
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
              </label>
            </div>
          )}

          {/* Step: preview */}
          {step === 'preview' && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-3 text-center">
                  <p className="text-2xl font-black text-green-700">{okCount}</p>
                  <p className="text-[10px] text-green-600 font-bold uppercase tracking-wide mt-0.5">OK — Sedia Import</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 text-center">
                  <p className="text-2xl font-black text-amber-600">{warnCount}</p>
                  <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wide mt-0.5">Amaran (boleh import)</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-3 text-center">
                  <p className="text-2xl font-black text-red-600">{errCount}</p>
                  <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide mt-0.5">Error — akan skip</p>
                </div>
              </div>

              {/* Preview table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                      <tr className="text-[10px] text-gray-400 uppercase tracking-wide">
                        <th className="px-3 py-2 text-left w-12">Baris</th>
                        <th className="px-3 py-2 text-left">Acara</th>
                        <th className="px-2 py-2 text-center w-10">Jan.</th>
                        <th className="px-2 py-2 text-center w-12">Kat.</th>
                        <th className="px-2 py-2 text-center w-10">Prg.</th>
                        <th className="px-3 py-2 text-right w-24">Prestasi</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.idx} className={`border-b border-gray-50 ${
                          r.status === 'error' ? 'bg-red-50' :
                          r.status === 'warn'  ? 'bg-amber-50' : ''
                        }`}>
                          <td className="px-3 py-2 text-gray-400 font-mono text-[10px]">{r.idx}</td>
                          <td className="px-3 py-2 font-semibold text-gray-800">{r.data.namaAcara || '—'}</td>
                          <td className="px-2 py-2 text-center">{r.data.jantina || '—'}</td>
                          <td className="px-2 py-2 text-center font-mono">{r.data.kategoriKod || '—'}</td>
                          <td className="px-2 py-2 text-center">{r.data.peringkat || '—'}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {r.data.prestasi || '—'}{r.data.unit ? ` ${r.data.unit}` : ''}
                          </td>
                          <td className="px-3 py-2">
                            {r.status === 'ok' && (
                              <span className="text-green-600 font-semibold text-[10px]">✓ OK</span>
                            )}
                            {r.status === 'warn' && (
                              <span className="text-amber-600 font-semibold text-[10px]" title={r.warnings.join(', ')}>
                                ⚠ {r.warnings[0]}
                              </span>
                            )}
                            {r.status === 'error' && (
                              <span className="text-red-600 font-semibold text-[10px]" title={r.errors.join(', ')}>
                                ✗ {r.errors[0]}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => handleImport(true)}
                  disabled={okCount + warnCount === 0}
                  className="flex-1 py-2.5 bg-[#003399] hover:bg-[#002277] disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  Import Semua ({okCount + warnCount} rekod)
                </button>
                {errCount > 0 && okCount > 0 && (
                  <button
                    onClick={() => handleImport(false)}
                    className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg transition-colors"
                  >
                    Import OK Sahaja ({okCount} rekod)
                  </button>
                )}
                <button onClick={() => { setStep('idle'); setRows([]) }}
                  className="px-4 py-2.5 border border-gray-200 text-xs text-gray-500 rounded-lg hover:bg-gray-50">
                  Pilih Semula
                </button>
              </div>
            </>
          )}

          {/* Step: importing */}
          {step === 'importing' && (
            <div className="py-14 text-center space-y-3">
              <div className="w-10 h-10 border-2 border-[#003399] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-gray-500">Mengimport rekod ke Firestore…</p>
              <p className="text-xs text-gray-400">Sila tunggu, jangan tutup tetingkap ini.</p>
            </div>
          )}

          {/* Step: done */}
          {step === 'done' && result && (
            <div className="py-10 text-center space-y-4">
              <p className="text-4xl">✅</p>
              <p className="text-sm font-bold text-gray-800">Import Selesai!</p>
              <div className="flex justify-center gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-3">
                  <p className="text-2xl font-black text-green-700">{result.success}</p>
                  <p className="text-[10px] text-green-600 font-semibold">Rekod Berjaya</p>
                </div>
                {result.failed > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-6 py-3">
                    <p className="text-2xl font-black text-red-600">{result.failed}</p>
                    <p className="text-[10px] text-red-600 font-semibold">Gagal</p>
                  </div>
                )}
              </div>
              <button onClick={onDone}
                className="px-8 py-2.5 bg-[#003399] hover:bg-[#002277] text-white text-xs font-bold rounded-lg transition-colors">
                Tutup & Muat Semula
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Cetak Rekod ───────────────────────────────────────────────────────

function CetakModal({ rekodList, kategoriList, onClose }) {
  const [sel, setSel] = useState(['D'])

  function toggle(p) {
    setSel(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  function handleCetak() {
    if (sel.length === 0) return
    const ordered = ['D','N','K'].filter(p => sel.includes(p))
    cetakRekodPDF(rekodList, kategoriList, ordered)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl overflow-hidden">
        <div className="bg-[#003399] text-white px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-widest">PDF</p>
            <p className="text-sm font-bold">Cetak Rekod</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs font-bold text-gray-600 mb-3 uppercase tracking-wide">Pilih Peringkat:</p>
            <div className="space-y-2">
              {[['D','Daerah'],['N','Negeri'],['K','Kebangsaan']].map(([p, label]) => {
                const count = rekodList.filter(r => r.peringkat === p).length
                return (
                  <label key={p} className={`flex items-center gap-3 cursor-pointer p-3 rounded-xl border transition-all ${
                    sel.includes(p)
                      ? 'border-[#003399] bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}>
                    <input type="checkbox" checked={sel.includes(p)} onChange={() => toggle(p)}
                      className="rounded border-gray-300 text-[#003399] w-4 h-4" />
                    <span className="text-sm text-gray-700 font-semibold flex-1">{label}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      PERINGKAT_META[p].cls
                    }`}>
                      {count} rekod
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          <p className="text-[10px] text-gray-400">
            Format: A4 Landscape · Dikumpul ikut kategori · PDF akan dimuat turun secara automatik.
          </p>

          <div className="flex gap-3 pt-1">
            <button onClick={handleCetak} disabled={sel.length === 0}
              className="flex-1 py-2.5 bg-[#003399] hover:bg-[#002277] disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Cetak PDF
            </button>
            <button onClick={onClose}
              className="px-4 py-2.5 border border-gray-200 text-xs text-gray-500 rounded-lg hover:bg-gray-50">
              Batal
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Tambah / Edit Rekod ────────────────────────────────────────────────

function RekodModal({ initial, kategoriList, acaraList, onClose, onSaved }) {
  const { userData } = useAuth()
  const isEdit = !!initial?.rekodId
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Nama acara unik — tapis ikut kategori + jantina yang dipilih
  const acaraOptions = useMemo(() => {
    const filtered = acaraList.filter(a => {
      if (form.kategoriKod && a.kategoriKod !== form.kategoriKod) return false
      if (form.jantina && a.jantina !== form.jantina) return false
      return true
    })
    return [...new Set(filtered.map(a => a.namaAcara))].sort()
  }, [acaraList, form.kategoriKod, form.jantina])

  // Auto-set unit apabila nama acara dipilih
  function handleNamaAcaraChange(nama) {
    set('namaAcara', nama)
    const match = acaraList.find(a =>
      a.namaAcara === nama &&
      (!form.kategoriKod || a.kategoriKod === form.kategoriKod) &&
      a.jantina === form.jantina
    )
    if (match) {
      set('unit', ['padang_lompat', 'padang_balin'].includes(match.jenisAcara) ? 'm' : 's')
    }
  }

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!form.namaAcara.trim()) return setErr('Nama acara diperlukan.')
    if (!form.kategoriKod.trim()) return setErr('Kategori diperlukan.')
    if (!form.prestasi || isNaN(Number(form.prestasi)) || Number(form.prestasi) <= 0)
      return setErr('Prestasi tidak sah.')

    setSaving(true)
    try {
      const rKey = rekodKey(form.namaAcara, form.jantina, form.kategoriKod, form.peringkat)
      const ref  = doc(db, 'rekod', rKey)
      const snap = await getDoc(ref)

      // Kalau edit rekod aktif, archive ke sejarah dulu
      if (isEdit && snap.exists() && snap.data().statusRekod === 'aktif') {
        const sejarahRef = doc(collection(db, 'rekod_sejarah'))
        await setDoc(sejarahRef, { ...snap.data(), diarchivPada: serverTimestamp() })
      }

      await setDoc(ref, {
        rekodId:     rKey,
        namaAcara:   form.namaAcara.trim(),
        jantina:     form.jantina,
        kategoriKod: form.kategoriKod.trim().toUpperCase(),
        peringkat:   form.peringkat,
        noKP:        form.noKP.trim(),
        namaAtlet:   form.namaAtlet.trim(),
        kodSekolah:  form.kodSekolah.trim().toUpperCase(),
        namaSekolah: form.namaSekolah.trim(),
        namaDaerah:  form.namaDaerah.trim(),
        namaNegeri:  form.namaNegeri.trim(),
        prestasi:    Number(form.prestasi),
        unit:        form.unit,
        windSpeed:   form.windSpeed !== '' ? Number(form.windSpeed) : null,
        isWindLegal: form.isWindLegal,
        jenisRekod:  form.jenisRekod,
        statusRekod: 'aktif',
        tarikhRekod: form.tarikhRekod,
        kejohananId: '',       // rekod input manual — tiada kejohanan spesifik
        disahkanOleh: userData?.uid || null,
        catatanKhas: form.catatanKhas.trim(),
        updatedAt:   serverTimestamp(),
      })
      onSaved()
    } catch (e) {
      setErr(e.message || 'Ralat tidak dijangka.')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
        <div className="bg-[#003399] text-white px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-widest">Rekod Sistem</p>
            <p className="text-sm font-bold">{isEdit ? 'Kemaskini Rekod' : 'Tambah Rekod'}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</p>}

          {/* Langkah 1: Pilih Kategori + Jantina dahulu supaya dropdown acara terisi */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Kategori *</label>
              <select className={inputCls} value={form.kategoriKod}
                onChange={e => { set('kategoriKod', e.target.value); set('namaAcara', '') }}>
                <option value="">— Pilih —</option>
                {kategoriList.map(k => (
                  <option key={k.id} value={k.kod}>{k.kod} — {k.nama}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Jantina</label>
              <select className={inputCls} value={form.jantina}
                onChange={e => { set('jantina', e.target.value); set('namaAcara', '') }}>
                <option value="L">Lelaki</option>
                <option value="P">Perempuan</option>
              </select>
            </div>
          </div>

          {/* Langkah 2: Pilih Nama Acara dari dropdown (auto-filter ikut kat+jantina) */}
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Nama Acara *</label>
            {isEdit ? (
              <input className={inputCls + ' bg-gray-100 text-gray-500 cursor-not-allowed'}
                value={form.namaAcara} readOnly />
            ) : (
              <select className={inputCls} value={form.namaAcara}
                onChange={e => handleNamaAcaraChange(e.target.value)}>
                <option value="">— Pilih Acara —</option>
                {acaraOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            {!isEdit && acaraOptions.length === 0 && form.kategoriKod && (
              <p className="text-[10px] text-amber-600 mt-1">
                Tiada acara untuk Kat {form.kategoriKod} dalam sistem. Pilih kategori & jantina dahulu.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Peringkat</label>
              <select className={inputCls} value={form.peringkat} onChange={e => set('peringkat', e.target.value)}>
                <option value="D">Daerah</option>
                <option value="N">Negeri</option>
                <option value="K">Kebangsaan</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Unit</label>
              <select className={inputCls} value={form.unit} onChange={e => set('unit', e.target.value)}>
                <option value="s">Masa (s)</option>
                <option value="m">Jarak (m)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Prestasi *</label>
              <input className={inputCls} type="number" step="0.01" min="0"
                value={form.prestasi} onChange={e => set('prestasi', e.target.value)}
                placeholder={form.unit === 's' ? 'cth: 12.45' : 'cth: 5.80'} />
              <p className="text-[10px] text-gray-400 mt-0.5">
                {form.unit === 's' ? 'Dalam saat — cth: 12.45 (100m) atau 125.32 (800m)' : 'Dalam meter — cth: 5.80'}
              </p>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Angin (m/s)</label>
              <input className={inputCls} type="number" step="0.1" min="-10" max="10"
                value={form.windSpeed} onChange={e => set('windSpeed', e.target.value)}
                placeholder="cth: 1.8 atau -0.5" />
              <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                <input type="checkbox" checked={form.isWindLegal}
                  onChange={e => set('isWindLegal', e.target.checked)}
                  className="rounded border-gray-300" />
                <span className="text-[10px] text-gray-500">Angin Sah (≤ 2.0 m/s)</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Nama Atlet</label>
              <input className={inputCls} value={form.namaAtlet}
                onChange={e => set('namaAtlet', e.target.value)}
                placeholder="Nama penuh" />
            </div>
            {/* Field lokasi — berbeza ikut peringkat */}
            {form.peringkat === 'D' && (
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Sekolah</label>
                <input className={inputCls} value={form.namaSekolah}
                  onChange={e => set('namaSekolah', e.target.value)}
                  placeholder="Nama sekolah pemegang rekod" />
              </div>
            )}
            {form.peringkat === 'N' && (
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Daerah</label>
                <input className={inputCls} value={form.namaDaerah}
                  onChange={e => set('namaDaerah', e.target.value)}
                  placeholder="Nama daerah pemegang rekod" />
              </div>
            )}
            {form.peringkat === 'K' && (
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Negeri</label>
                <input className={inputCls} value={form.namaNegeri}
                  onChange={e => set('namaNegeri', e.target.value)}
                  placeholder="Nama negeri pemegang rekod" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">No. KP</label>
              <input className={inputCls} value={form.noKP}
                onChange={e => set('noKP', e.target.value)}
                placeholder="cth: 990112-11-1234" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Tarikh Rekod</label>
              <input className={inputCls} type="date" value={form.tarikhRekod}
                onChange={e => set('tarikhRekod', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Jenis Rekod</label>
              <select className={inputCls} value={form.jenisRekod}
                onChange={e => set('jenisRekod', e.target.value)}>
                <option value="elektronik">Elektronik</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Catatan</label>
              <input className={inputCls} value={form.catatanKhas}
                onChange={e => set('catatanKhas', e.target.value)}
                placeholder="Nota pengurus teknik..." />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={saving}
              className="px-6 py-2.5 bg-[#003399] hover:bg-[#002277] disabled:bg-gray-300 text-white text-sm font-bold rounded-lg transition-colors">
              {saving ? 'Menyimpan…' : isEdit ? 'Kemaskini' : 'Simpan Rekod'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 border border-gray-200 text-sm text-gray-500 rounded-lg hover:bg-gray-50">
              Batal
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Rekod() {
  const { userData } = useAuth()
  const userRole = userData?.role

  const canEdit   = ['superadmin', 'pengurus_teknik'].includes(userRole)
  const canSahkan = ['superadmin', 'pengurus_teknik'].includes(userRole)

  const [rekodList,    setRekodList]    = useState([])
  const [tuntutanList, setTuntutanList] = useState([])
  const [kategoriList, setKategoriList] = useState([])
  const [acaraList,    setAcaraList]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selPeringkat, setSelPeringkat] = useState('D')
  const [activeTab,    setActiveTab]    = useState('semasa')  // 'semasa' | 'tuntutan' | 'semak'
  const [semakPeringkat, setSemakPeringkat] = useState('D')
  const [semakFilter,    setSemakFilter]    = useState('semua')  // 'semua' | 'tiada' | 'orphan'
  const [baikiOrphanId,    setBaikiOrphanId]    = useState(null)   // r.id orphan yang sedang dibaiki
  const [baikiTargetAcara, setBaikiTargetAcara] = useState('')     // namaAcara dipilih dari dropdown
  const [baikiSaving,      setBaikiSaving]      = useState(false)
  const [modal,        setModal]        = useState(null)      // null | { mode, initial }
  const [showImport,   setShowImport]   = useState(false)
  const [showCetak,    setShowCetak]    = useState(false)
  const [msg,          setMsg]          = useState(null)

  // ── Load data ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rekodSnap, katSnap] = await Promise.all([
        getDocs(query(collection(db, 'rekod'), orderBy('updatedAt', 'desc'))),
        getDocs(query(collection(db, 'kategori'), orderBy('urutan'))),
      ])
      const allRekod = rekodSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      setRekodList(allRekod.filter(r => !r.id.endsWith('_tuntutan') && r.statusRekod !== 'dipecah'))
      setTuntutanList(allRekod.filter(r => r.id.endsWith('_tuntutan')))
      setKategoriList(katSnap.docs.map(d => ({ id: d.id, ...d.data() })))

      // Fetch acara dari kejohanan aktif — untuk dropdown nama acara dalam modal
      const kejSnap = await getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif')))
      if (!kejSnap.empty) {
        const kejId = kejSnap.docs[0].id
        const aSnap = await getDocs(query(collection(db, 'kejohanan', kejId, 'acara'), orderBy('kategoriKod')))
        setAcaraList(aSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleSahkan(tuntutan) {
    if (!confirm(`Sahkan rekod baru?\n${tuntutan.namaAcara} ${tuntutan.jantina} ${tuntutan.kategoriKod}\nPrestasi: ${formatPrestasi(tuntutan.prestasi, tuntutan.unit)}`)) return
    try {
      const rekodRef    = doc(db, 'rekod', tuntutan.rekodAsal)
      const tuntutanRef = doc(db, 'rekod', tuntutan.id)
      const rekodSnap   = await getDoc(rekodRef)

      // Archive rekod lama ke rekod_sejarah
      if (rekodSnap.exists()) {
        const sejarahRef = doc(collection(db, 'rekod_sejarah'))
        await setDoc(sejarahRef, {
          ...rekodSnap.data(),
          dipecahOleh: {
            namaAtlet:   tuntutan.namaAtlet,
            prestasi:    tuntutan.prestasi,
            tarikhRekod: tuntutan.tarikhRekod,
            kejohananId: tuntutan.kejohananId,
          },
          diarchivPada: serverTimestamp(),
        })
        await updateDoc(rekodRef, { statusRekod: 'dipecah' })
      }

      // Tulis rekod baru (dari tuntutan)
      const { id: _id, rekodAsal: _asal, ...tuntutanData } = tuntutan
      await setDoc(rekodRef, {
        ...tuntutanData,
        rekodId:      tuntutan.rekodAsal,
        statusRekod:  'aktif',
        disahkanOleh: userData?.uid || null,
        updatedAt:    serverTimestamp(),
      })

      // Padam tuntutan
      await deleteDoc(tuntutanRef)
      setMsg({ type: 'ok', text: 'Rekod baru disahkan.' })
      load()
    } catch (e) {
      setMsg({ type: 'err', text: 'Gagal: ' + e.message })
    }
  }

  async function handleTolak(tuntutan) {
    if (!confirm('Tolak tuntutan rekod ini?')) return
    try {
      await deleteDoc(doc(db, 'rekod', tuntutan.id))
      setMsg({ type: 'ok', text: 'Tuntutan ditolak dan dibuang.' })
      load()
    } catch (e) {
      setMsg({ type: 'err', text: 'Gagal: ' + e.message })
    }
  }

  // ── Kemaskini Rekod Library — sahkan SEMUA tuntutan sekaligus ─────────────────

  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkResult, setBulkResult] = useState(null) // { berjaya, gagal }

  async function handleKemaskiniSemua() {
    if (tuntutanList.length === 0) return
    if (!confirm(
      `Kemaskini rekod library dengan ${tuntutanList.length} tuntutan?\n\n` +
      `Semua rekod lama yang dipecahkan akan diarkibkan.\n` +
      `Tindakan ini tidak boleh dibatalkan.`
    )) return

    setBulkSaving(true); setBulkResult(null); setMsg(null)
    let berjaya = 0, gagal = 0

    for (const tuntutan of tuntutanList) {
      try {
        const rekodRef    = doc(db, 'rekod', tuntutan.rekodAsal)
        const tuntutanRef = doc(db, 'rekod', tuntutan.id)
        const rekodSnap   = await getDoc(rekodRef)

        // Archive rekod lama
        if (rekodSnap.exists()) {
          const sejarahRef = doc(collection(db, 'rekod_sejarah'))
          await setDoc(sejarahRef, {
            ...rekodSnap.data(),
            dipecahOleh: {
              namaAtlet:   tuntutan.namaAtlet,
              prestasi:    tuntutan.prestasi,
              tarikhRekod: tuntutan.tarikhRekod,
              kejohananId: tuntutan.kejohananId,
            },
            diarchivPada: serverTimestamp(),
          })
          await updateDoc(rekodRef, { statusRekod: 'dipecah' })
        }

        // Tulis rekod baru
        const { id: _id, rekodAsal: _asal, ...tuntutanData } = tuntutan
        await setDoc(rekodRef, {
          ...tuntutanData,
          rekodId:      tuntutan.rekodAsal,
          statusRekod:  'aktif',
          disahkanOleh: userData?.uid || null,
          updatedAt:    serverTimestamp(),
        })

        // Padam tuntutan
        await deleteDoc(tuntutanRef)
        berjaya++
      } catch (e) {
        console.warn('bulk sahkan gagal:', tuntutan.id, e.message)
        gagal++
      }
    }

    setBulkResult({ berjaya, gagal })
    setMsg({
      type: gagal === 0 ? 'ok' : 'warn',
      text: `${berjaya} rekod berjaya dikemaskini${gagal > 0 ? `, ${gagal} gagal` : ''}.`,
    })
    setBulkSaving(false)
    load()
  }

  // ── Refresh Rekod Lama dalam mata_olahragawan ────────────────────────────────
  // Scan semua mata_olahragawan untuk kejohanan aktif
  // Untuk setiap rekod_ field, baca balik rekod library dan kemaskini prestasiLama dll

  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState(null)

  async function handleRefreshRekodLama() {
    if (!confirm('Refresh data rekod lama dalam semua rekod atlet?\n\nIni akan kemaskini prestasiLama, namaLama, lokasiLama untuk semua atlet yang pecah rekod dalam kejohanan aktif.')) return
    setRefreshing(true); setRefreshResult(null)
    let kemaskini = 0, skip = 0
    try {
      // 1. Ambil kejohananId aktif
      const kejSnap = await getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif')))
      if (kejSnap.empty) { setRefreshResult({ err: 'Tiada kejohanan aktif.' }); return }
      const kejId = kejSnap.docs[0].data().kejohananId || kejSnap.docs[0].id

      // 2. Ambil semua mata_olahragawan untuk kejohanan ini
      const mataSnap = await getDocs(query(collection(db, 'mata_olahragawan'), where('kejohananId', '==', kejId)))

      for (const mataDoc of mataSnap.docs) {
        const mataData = mataDoc.data()
        const patch = {}

        // 3. Cari semua rekod_ fields
        const rekodFields = Object.entries(mataData).filter(([k]) => k.startsWith('rekod_'))
        for (const [fieldKey, fieldVal] of rekodFields) {
          if (!fieldVal?.namaAcara || !fieldVal?.kategoriKod || !fieldVal?.jantina || !fieldVal?.peringkat) continue

          // 4. Bina key dan baca dari library
          const rKey = [fieldVal.namaAcara, fieldVal.jantina, fieldVal.kategoriKod, fieldVal.peringkat]
            .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')

          // Kita nak rekod SEBELUM yang ini — iaitu rekod yang wujud
          // Untuk rekod pertama yang pernah dihantar, rekod library sekarang = rekod baru itu sendiri
          // Kita skip jika prestasiBaru == prestasi dalam library (bermakna atlet ini ADALAH rekod semasa)
          const rekodSnap = await getDoc(doc(db, 'rekod', rKey))
          if (!rekodSnap.exists()) { skip++; continue }
          const lib = rekodSnap.data()

          // Jika prestasi library == prestasiBaru atlet → atlet ini yang pegang rekod → rekod lama dari sejarah
          const samaPrestasi = Number(lib.prestasi) === Number(fieldVal.prestasiBaru)
          if (samaPrestasi) {
            // Cuba cari rekod_sejarah untuk acara ini
            const sejarahSnap = await getDocs(
              query(collection(db, 'rekod_sejarah'), where('rekodId', '==', rKey), orderBy('diarchivPada', 'desc'))
            )
            if (!sejarahSnap.empty) {
              const lama = sejarahSnap.docs[0].data()
              patch[fieldKey] = {
                ...fieldVal,
                prestasiLama: lama.prestasi != null ? Number(lama.prestasi) : null,
                tahunLama:    lama.tarikhRekod ? String(lama.tarikhRekod).slice(0,4) : null,
                namaLama:     lama.namaAtlet   || null,
                lokasiLama:   lama.namaSekolah || lama.namaDaerah || lama.namaNegeri || null,
                catatanLama:  lama.catatanKhas || null,
              }
              kemaskini++
            } else {
              // Rekod pertama — tiada sejarah
              patch[fieldKey] = { ...fieldVal, prestasiLama: null, namaLama: null, lokasiLama: null, catatanLama: null }
              skip++
            }
          } else {
            // Library ada rekod berbeza — itu rekod lama
            patch[fieldKey] = {
              ...fieldVal,
              prestasiLama: lib.prestasi != null ? Number(lib.prestasi) : null,
              tahunLama:    lib.tarikhRekod ? String(lib.tarikhRekod).slice(0,4) : null,
              namaLama:     lib.namaAtlet   || null,
              lokasiLama:   lib.namaSekolah || lib.namaDaerah || lib.namaNegeri || null,
              catatanLama:  lib.catatanKhas || null,
            }
            kemaskini++
          }
        }

        if (Object.keys(patch).length > 0) {
          await setDoc(doc(db, 'mata_olahragawan', mataDoc.id), patch, { merge: true })
        }
      }
      setRefreshResult({ kemaskini, skip })
    } catch (e) {
      setRefreshResult({ err: e.message })
    } finally {
      setRefreshing(false)
    }
  }

  async function handleDelete(rekod) {
    if (!confirm(`Padam rekod ${rekod.namaAcara} ${rekod.jantina} ${rekod.kategoriKod}?\nTindakan ini tidak boleh dibatalkan.`)) return
    try {
      // Archive ke sejarah
      const sejarahRef = doc(collection(db, 'rekod_sejarah'))
      await setDoc(sejarahRef, { ...rekod, dipadamPada: serverTimestamp() })
      await deleteDoc(doc(db, 'rekod', rekod.id))
      setMsg({ type: 'ok', text: 'Rekod dipadam dan diarkibkan.' })
      load()
    } catch (e) {
      setMsg({ type: 'err', text: 'Gagal: ' + e.message })
    }
  }

  // ── Baiki Orphan — re-key rekod ke namaAcara yang betul ─────────────────────

  async function handleBaikiOrphan(orphan, targetNamaAcara, targetKatKod) {
    if (!targetNamaAcara || !targetKatKod) return
    const peringkat = orphan.peringkat || semakPeringkat
    const newKey  = rekodKey(targetNamaAcara, orphan.jantina, targetKatKod, peringkat)
    const oldKey  = orphan.id

    if (newKey === oldKey) {
      setMsg({ type: 'err', text: 'Key sama — tiada perubahan diperlukan.' })
      return
    }

    setBaikiSaving(true)
    try {
      const newRef  = doc(db, 'rekod', newKey)
      const newSnap = await getDoc(newRef)

      if (newSnap.exists()) {
        // Key baru sudah wujud — tanya sama ada padam orphan sahaja
        if (!confirm(
          `Rekod dengan key "${newKey}" sudah wujud dalam sistem.\n\n` +
          `Padam orphan ini sahaja dan kekalkan rekod sedia ada?`
        )) { setBaikiSaving(false); return }
        await deleteDoc(doc(db, 'rekod', oldKey))
        setMsg({ type: 'ok', text: 'Orphan dipadam. Rekod sedia ada dikekalkan.' })
      } else {
        // Selamat — pindah ke key baru, kemaskini namaAcara + kategoriKod
        const { id: _id, rekodId: _rId, ...rest } = orphan
        await setDoc(newRef, {
          ...rest,
          rekodId:     newKey,
          namaAcara:   targetNamaAcara,
          kategoriKod: targetKatKod,
          updatedAt:   serverTimestamp(),
        })
        await deleteDoc(doc(db, 'rekod', oldKey))
        setMsg({ type: 'ok', text: `Rekod berjaya dipindah: ${oldKey} → ${newKey}` })
      }

      setBaikiOrphanId(null)
      setBaikiTargetAcara('')
      load()
    } catch (e) {
      setMsg({ type: 'err', text: 'Gagal: ' + e.message })
    } finally {
      setBaikiSaving(false)
    }
  }

  // ── Baiki Key — tukar key lama (L12) ke key baru (C) tanpa tukar data ───────

  async function handleBaikiKey(x) {
    if (!confirm(
      `Kemaskini key rekod?\n\n` +
      `Lama: ${x.rKey}\n` +
      `Baru: ${x.rKeyBaru}\n\n` +
      `Data rekod dikekalkan, hanya key diubah.`
    )) return
    try {
      const newRef  = doc(db, 'rekod', x.rKeyBaru)
      const newSnap = await getDoc(newRef)
      if (newSnap.exists()) {
        if (!confirm(`Key "${x.rKeyBaru}" sudah wujud.\nPadam rekod lama (${x.rKey}) sahaja?`)) return
        await deleteDoc(doc(db, 'rekod', x.rKey))
        setMsg({ type: 'ok', text: 'Rekod lama dipadam. Rekod baru dikekalkan.' })
      } else {
        const { id: _id, rekodId: _rId, ...rest } = x.rekodItem
        await setDoc(newRef, { ...rest, rekodId: x.rKeyBaru, updatedAt: serverTimestamp() })
        await deleteDoc(doc(db, 'rekod', x.rKey))
        setMsg({ type: 'ok', text: `Key dikemas: ${x.rKey} → ${x.rKeyBaru}` })
      }
      load()
    } catch (e) {
      setMsg({ type: 'err', text: 'Gagal: ' + e.message })
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredRekod = rekodList.filter(r => r.peringkat === selPeringkat)

  // Group by kategoriKod then sort by namaAcara + jantina
  const grouped = filteredRekod.reduce((acc, r) => {
    const k = r.kategoriKod || 'Lain-lain'
    if (!acc[k]) acc[k] = []
    acc[k].push(r)
    return acc
  }, {})

  const katMap = Object.fromEntries(kategoriList.map(k => [k.kod, k]))
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    const au = katMap[a]?.urutan ?? 999
    const bu = katMap[b]?.urutan ?? 999
    return au !== bu ? au - bu : a.localeCompare(b)
  })

  // ── Semak Sambungan — audit rekod vs acara ───────────────────────────────────

  // Unique acara combos dari acaraList (saringan/final disatukan — guna namaAcaraPendek || namaAcara)
  const semakData = useMemo(() => {
    const seen = new Set()
    const combos = []
    acaraList.forEach(a => {
      const namaKey = a.namaAcaraPendek || a.namaAcara
      const uid = `${namaKey}__${a.jantina}__${a.kategoriKod}`
      if (seen.has(uid)) return
      seen.add(uid)
      combos.push({
        namaKey,
        namaAcara: a.namaAcara,
        jantina: a.jantina,
        kategoriKod: a.kategoriKod,
        jenisAcara: a.jenisAcara,
      })
    })
    return combos.map(c => {
      // ── Sambungan Kuat: key primary (format baru — kategoriKod A/B/C) ─────────
      const rKeyPrimary = rekodKey(c.namaKey, c.jantina, c.kategoriKod, semakPeringkat)
      const rekodPrimary = rekodList.find(r => (r.id || r.rekodId) === rKeyPrimary)
      if (rekodPrimary) {
        return { ...c, rKey: rKeyPrimary, hasRekod: true, rekodItem: rekodPrimary, connectionType: 'kuat' }
      }

      // ── Sambungan Lemah: key fallback (format lama — kelasDariNama L12/P12) ───
      const namaPenuh  = (c.namaAcara || '').trim()
      const namaPendek = c.namaKey.trim()
      const kelasDariNama = (namaPenuh && namaPendek && namaPenuh !== namaPendek)
        ? namaPenuh.slice(namaPendek.length).trim() : ''
      if (kelasDariNama && kelasDariNama !== c.kategoriKod) {
        const rKeyFallback = rekodKey(c.namaKey, c.jantina, kelasDariNama, semakPeringkat)
        const rekodFallback = rekodList.find(r => (r.id || r.rekodId) === rKeyFallback)
        if (rekodFallback) {
          return {
            ...c,
            rKey:    rKeyFallback,  // key lama dalam Firestore
            rKeyBaru: rKeyPrimary,  // key baru yang patut
            hasRekod: true,
            rekodItem: rekodFallback,
            connectionType: 'lemah',
          }
        }
      }

      // ── Tiada Sambungan ──────────────────────────────────────────────────────
      return { ...c, rKey: rKeyPrimary, hasRekod: false, rekodItem: null, connectionType: 'tiada' }
    })
  }, [acaraList, rekodList, semakPeringkat])

  // Rekod orphan — ada dalam rekodList tapi tiada padanan dalam acaraList
  const semakOrphan = useMemo(() => {
    const validKeys = new Set(semakData.map(x => x.rKey))
    return rekodList.filter(r => {
      const rKey = r.id || r.rekodId || ''
      // Hanya semak rekod peringkat yang sama dengan semakPeringkat
      return rKey.endsWith(`_${semakPeringkat}`) && !validKeys.has(rKey)
    })
  }, [semakData, rekodList, semakPeringkat])

  const semakTiadaCount = useMemo(() => semakData.filter(x => x.connectionType === 'tiada').length, [semakData])
  const semakLemahCount = useMemo(() => semakData.filter(x => x.connectionType === 'lemah').length, [semakData])

  const semakDisplayData = useMemo(() => {
    if (semakFilter === 'tiada') return semakData.filter(x => x.connectionType === 'tiada')
    if (semakFilter === 'lemah') return semakData.filter(x => x.connectionType === 'lemah')
    return semakData
  }, [semakData, semakFilter])

  const semakGrouped = useMemo(() => {
    return semakDisplayData.reduce((acc, x) => {
      const k = x.kategoriKod || 'Lain-lain'
      if (!acc[k]) acc[k] = []
      acc[k].push(x)
      return acc
    }, {})
  }, [semakDisplayData])

  const semakGroupKeys = useMemo(() =>
    Object.keys(semakGrouped).sort((a, b) => {
      const au = katMap[a]?.urutan ?? 999
      const bu = katMap[b]?.urutan ?? 999
      return au !== bu ? au - bu : a.localeCompare(b)
    }), [semakGrouped, katMap])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-800">Rekod Semasa</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Rekod acara peringkat daerah / negeri / kebangsaan
          </p>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Download Template */}
            <button
              onClick={() => downloadTemplate(acaraList)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 hover:border-gray-400 bg-white text-gray-600 hover:text-gray-800 text-xs font-semibold rounded-lg transition-colors"
              title="Muat turun template Excel"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Template
            </button>

            {/* Import */}
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-green-300 hover:border-green-400 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-semibold rounded-lg transition-colors"
              title="Import rekod dari Excel/CSV"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import
            </button>

            {/* Cetak */}
            <button
              onClick={() => setShowCetak(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-indigo-300 hover:border-indigo-400 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg transition-colors"
              title="Cetak rekod ke PDF"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Cetak
            </button>

            {/* Tambah Rekod */}
            <button
              onClick={() => setModal({ mode: 'add', initial: null })}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#003399] hover:bg-[#002277] text-white text-xs font-bold rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Tambah Rekod
            </button>
          </div>
        )}
      </div>

      {/* Msg */}
      {msg && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
          msg.type === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <span>{msg.type === 'ok' ? '✓' : '✗'}</span>
          <span className="flex-1">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-current/50 hover:text-current">✕</button>
        </div>
      )}

      {/* Tuntutan baru — alert banner */}
      {tuntutanList.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-400 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-xs font-bold text-amber-800">
              {tuntutanList.length} Tuntutan Rekod Baru — Perlu Disahkan
            </p>
            <p className="text-[11px] text-amber-600 mt-0.5">
              Keputusan RASMI mengesan prestasi lebih baik dari rekod semasa.
            </p>
          </div>
          <button
            onClick={() => setActiveTab('tuntutan')}
            className="px-3 py-1.5 bg-amber-400 hover:bg-amber-500 text-white text-xs font-bold rounded-lg transition-colors shrink-0"
          >
            Semak Tuntutan
          </button>
        </div>
      )}

      {/* Refresh Rekod Lama tool */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-gray-700">Refresh Rekod Lama Atlet</p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Kemaskini data rekod lama (nama, prestasi, tahun) dalam rekod atlet untuk kejohanan aktif.
            Jalankan selepas kemaskini rekod library.
          </p>
          {refreshResult && !refreshResult.err && (
            <p className="text-[10px] font-bold text-green-600 mt-1">
              ✓ {refreshResult.kemaskini} rekod dikemaskini, {refreshResult.skip} rekap dilepas.
            </p>
          )}
          {refreshResult?.err && (
            <p className="text-[10px] font-bold text-red-500 mt-1">✗ {refreshResult.err}</p>
          )}
        </div>
        <button
          onClick={handleRefreshRekodLama}
          disabled={refreshing}
          className="shrink-0 px-3 py-1.5 bg-gray-700 hover:bg-gray-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors">
          {refreshing ? '⏳ Memproses…' : '🔄 Refresh Rekod Lama'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[
          { key: 'semasa',   label: 'Rekod Semasa' },
          { key: 'tuntutan', label: `Tuntutan${tuntutanList.length ? ` (${tuntutanList.length})` : ''}` },
          { key: 'semak',    label: `Semak Sambungan${semakLemahCount > 0 ? ` · ${semakLemahCount} lemah` : ''}${semakTiadaCount > 0 ? ` · ${semakTiadaCount} tiada` : ''}${semakOrphan.length > 0 ? ` · ${semakOrphan.length} orphan` : ''}` },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === t.key
                ? 'bg-white text-[#003399] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Rekod Semasa ── */}
      {activeTab === 'semasa' && (
        <div className="space-y-4">
          {/* Peringkat pills */}
          <div className="flex gap-2 flex-wrap">
            {['D', 'N', 'K'].map(p => {
              const m = PERINGKAT_META[p]
              return (
                <button key={p} onClick={() => setSelPeringkat(p)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all ${
                    selPeringkat === p ? m.cls + ' shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}>
                  {m.label}
                </button>
              )
            })}
            <span className="ml-auto text-xs text-gray-400 self-center">
              {filteredRekod.length} rekod
            </span>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">Memuatkan…</div>
          ) : filteredRekod.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm py-14 text-center">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-sm font-semibold text-gray-500">Tiada rekod untuk peringkat {PERINGKAT_META[selPeringkat]?.label}.</p>
              {canEdit && (
                <div className="flex items-center justify-center gap-3 mt-4">
                  <button onClick={() => setShowImport(true)}
                    className="text-xs text-green-600 hover:underline font-semibold">
                    ↑ Import dari Excel
                  </button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => setModal({ mode: 'add', initial: null })}
                    className="text-xs text-[#003399] hover:underline font-semibold">
                    + Tambah Manual
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {groupKeys.map(katKod => {
                const rows = grouped[katKod] || []
                const kat  = katMap[katKod]
                return (
                  <div key={katKod} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                    {/* Group header */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <div className="w-1.5 h-6 rounded-sm" style={{ backgroundColor: kat?.warna || '#94a3b8' }} />
                      <div>
                        <span className="text-sm font-bold text-gray-800">{kat?.nama || katKod}</span>
                        <span className="ml-2 text-[10px] text-gray-400 font-mono">{katKod}</span>
                      </div>
                      <span className="ml-auto text-[10px] text-gray-400">{rows.length} rekod</span>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 text-[10px] uppercase tracking-wide border-b border-gray-100">
                            <th className="px-4 py-2 text-left">Acara</th>
                            <th className="px-3 py-2 text-center">Jan.</th>
                            <th className="px-4 py-2 text-left">Atlet</th>
                            <th className="px-4 py-2 text-left">
                              {selPeringkat === 'D' ? 'Sekolah' : selPeringkat === 'N' ? 'Daerah' : 'Negeri'}
                            </th>
                            <th className="px-4 py-2 text-right font-bold">Prestasi</th>
                            <th className="px-3 py-2 text-center">Angin</th>
                            <th className="px-3 py-2 text-center">Tarikh</th>
                            {canEdit && <th className="px-3 py-2 text-center">Aksi</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {rows
                            .sort((a, b) => a.namaAcara.localeCompare(b.namaAcara) || a.jantina.localeCompare(b.jantina))
                            .map(r => (
                            <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 group">
                              <td className="px-4 py-2.5 font-semibold text-gray-800">{r.namaAcara}</td>
                              <td className="px-3 py-2.5 text-center">
                                <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  r.jantina === 'L' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                                }`}>{r.jantina}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                <p className="text-gray-800">{r.namaAtlet || '—'}</p>
                                {r.noKP && <p className="text-[10px] text-gray-400 font-mono">{r.noKP}</p>}
                              </td>
                              <td className="px-4 py-2.5 text-gray-600">
                                {selPeringkat === 'D' ? (r.namaSekolah || r.kodSekolah || '—')
                                  : selPeringkat === 'N' ? (r.namaDaerah || '—')
                                  : (r.namaNegeri || '—')}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <span className="font-black text-[#003399] text-sm">
                                  {formatPrestasi(r.prestasi, r.unit)}
                                </span>
                                {r.jenisRekod === 'manual' && (
                                  <span className="ml-1 text-[10px] text-gray-400" title="Rekod manual">*</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {r.windSpeed !== null && r.windSpeed !== undefined ? (
                                  <span className={`text-[11px] font-semibold ${
                                    r.isWindLegal ? 'text-green-600' : 'text-red-500'
                                  }`}>
                                    {r.windSpeed >= 0 ? '+' : ''}{Number(r.windSpeed).toFixed(1)}
                                  </span>
                                ) : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-3 py-2.5 text-center text-gray-500">{r.tarikhRekod || '—'}</td>
                              {canEdit && (
                                <td className="px-3 py-2.5 text-center">
                                  <div className="flex items-center gap-1.5 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => setModal({ mode: 'edit', initial: { ...EMPTY_FORM, ...r, prestasi: String(r.prestasi), windSpeed: r.windSpeed != null ? String(r.windSpeed) : '' } })}
                                      className="text-[10px] px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded font-semibold transition-colors"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleDelete(r)}
                                      className="text-[10px] px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded font-semibold transition-colors"
                                    >
                                      Padam
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Tuntutan Baru ── */}
      {activeTab === 'tuntutan' && (
        <div className="space-y-4">
          {tuntutanList.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm py-14 text-center">
              <p className="text-2xl mb-2">✅</p>
              <p className="text-sm font-semibold text-gray-500">Tiada tuntutan rekod yang menunggu.</p>
              <p className="text-xs text-gray-400 mt-1">
                Apabila keputusan RASMI mengesan prestasi lebih baik, tuntutan akan muncul di sini.
              </p>
            </div>
          ) : (
            <>
              {/* Bulk button */}
              <div className="bg-[#003399]/5 border border-[#003399]/20 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-xs font-bold text-[#003399]">
                    {tuntutanList.length} rekod baru menunggu — kemaskini library untuk kejohanan akan datang
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Semak setiap tuntutan di bawah, atau sahkan semua sekaligus selepas kejohanan tamat.
                  </p>
                  {bulkResult && (
                    <p className={`text-[11px] font-semibold mt-1 ${bulkResult.gagal > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                      {bulkResult.berjaya} rekod dikemaskini{bulkResult.gagal > 0 ? `, ${bulkResult.gagal} gagal` : ' ✓'}
                    </p>
                  )}
                </div>
                <button
                  onClick={handleKemaskiniSemua}
                  disabled={bulkSaving}
                  className="shrink-0 px-4 py-2 bg-[#003399] hover:bg-[#002277] disabled:bg-gray-300 text-white text-xs font-black rounded-xl tracking-wide transition-colors"
                >
                  {bulkSaving ? 'MEMPROSES…' : `KEMASKINI SEMUA (${tuntutanList.length})`}
                </button>
              </div>

              <p className="text-[11px] text-gray-400">
                Atau sahkan satu-satu di bawah — semak angin dan kelayakan atlet dahulu.
              </p>
              {tuntutanList.map(t => {
                const isMasa    = t.unit === 's'
                const rekodAsal = rekodList.find(r => r.id === t.rekodAsal)
                return (
                  <div key={t.id} className="bg-white border-2 border-amber-200 rounded-xl shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <div className="flex-1">
                        <p className="text-sm font-bold text-amber-900">
                          {t.namaAcara} · {t.jantina === 'L' ? 'Lelaki' : 'Perempuan'} · {t.kategoriKod}
                        </p>
                        <p className="text-[10px] text-amber-700">{PERINGKAT_META[t.peringkat]?.label} — tuntutan dari keputusan RASMI</p>
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="grid grid-cols-2 gap-6 mb-4">
                        {/* Rekod lama */}
                        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Rekod Semasa</p>
                          {rekodAsal ? (
                            <>
                              <p className="text-xl font-black text-gray-600">{formatPrestasi(rekodAsal.prestasi, rekodAsal.unit)}</p>
                              <p className="text-xs text-gray-500 mt-1">{rekodAsal.namaAtlet || '—'}</p>
                              <p className="text-[10px] text-gray-400">{rekodAsal.namaSekolah || '—'} · {rekodAsal.tarikhRekod}</p>
                              {rekodAsal.windSpeed != null && (
                                <p className="text-[10px] text-gray-400">Angin: {rekodAsal.windSpeed >= 0 ? '+' : ''}{Number(rekodAsal.windSpeed).toFixed(1)} m/s</p>
                              )}
                            </>
                          ) : (
                            <p className="text-sm text-gray-400 italic">Tiada rekod sebelum ini</p>
                          )}
                        </div>

                        {/* Tuntutan baru */}
                        <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                          <p className="text-[10px] font-bold text-green-700 uppercase tracking-widest mb-2">Tuntutan Baru</p>
                          <p className="text-xl font-black text-green-700">{formatPrestasi(t.prestasi, t.unit)}</p>
                          <p className="text-xs text-gray-700 mt-1">{t.namaAtlet || '—'}</p>
                          <p className="text-[10px] text-gray-500">{t.namaSekolah || '—'} · {t.tarikhRekod}</p>
                          {t.windSpeed != null && (
                            <p className={`text-[10px] font-semibold mt-0.5 ${t.isWindLegal ? 'text-green-600' : 'text-red-500'}`}>
                              Angin: {t.windSpeed >= 0 ? '+' : ''}{Number(t.windSpeed).toFixed(1)} m/s
                              {!t.isWindLegal && ' ⚠ TIDAK SAH'}
                            </p>
                          )}
                          {rekodAsal && (
                            <p className="text-[10px] text-green-700 font-bold mt-1">
                              Lebih baik sebanyak: {isMasa
                                ? (Number(rekodAsal.prestasi) - Number(t.prestasi)).toFixed(2) + 's'
                                : (Number(t.prestasi) - Number(rekodAsal.prestasi)).toFixed(2) + 'm'}
                            </p>
                          )}
                        </div>
                      </div>

                      {!t.isWindLegal && t.windSpeed !== null && (
                        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-xs text-red-700 font-semibold">
                            ⚠ Amaran: Angin melebihi had ({Number(t.windSpeed).toFixed(1)} m/s).
                            Rekod ini TIDAK SAH untuk rekod rasmi. Pertimbangkan untuk menolak.
                          </p>
                        </div>
                      )}

                      {canSahkan && (
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleSahkan(t)}
                            className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg transition-colors">
                            ✓ Sahkan Rekod Baru
                          </button>
                          <button onClick={() => handleTolak(t)}
                            className="flex-1 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold rounded-lg transition-colors">
                            ✕ Tolak Tuntutan
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Semak Sambungan ── */}
      {activeTab === 'semak' && (
        <div className="space-y-4">

          {/* Controls row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Peringkat pills */}
            <div className="flex gap-1">
              {['D','N','K'].map(p => (
                <button key={p} onClick={() => setSemakPeringkat(p)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all ${
                    semakPeringkat === p
                      ? PERINGKAT_META[p].cls + ' shadow-sm'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}>
                  {PERINGKAT_META[p].label}
                </button>
              ))}
            </div>
            {/* Filter toggle */}
            <div className="ml-auto flex gap-1 bg-gray-100 p-1 rounded-lg">
              {[
                ['semua',  'Semua',          null],
                ['lemah',  'Lemah',          semakLemahCount],
                ['tiada',  'Tiada',          semakTiadaCount],
                ['orphan', 'Orphan',         semakOrphan.length],
              ].map(([k, l, count]) => (
                <button key={k} onClick={() => setSemakFilter(k)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    semakFilter === k ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                  }`}>
                  {l}
                  {count > 0 && (
                    <span className={`ml-1 ${
                      k === 'tiada' ? 'text-red-500' :
                      k === 'lemah' ? 'text-amber-500' : 'text-amber-500'
                    }`}>({count})</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 text-center">
              <p className="text-2xl font-black text-gray-700">{semakData.length}</p>
              <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mt-0.5">Jumlah Acara</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-3 text-center">
              <p className="text-2xl font-black text-green-700">{semakData.filter(x => x.connectionType === 'kuat').length}</p>
              <p className="text-[10px] text-green-600 font-semibold uppercase tracking-wide mt-0.5">Sambungan Kuat</p>
            </div>
            <div className={`border rounded-xl px-3 py-3 text-center ${semakLemahCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`text-2xl font-black ${semakLemahCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{semakLemahCount}</p>
              <p className={`text-[10px] font-semibold uppercase tracking-wide mt-0.5 ${semakLemahCount > 0 ? 'text-amber-500' : 'text-gray-400'}`}>Sambungan Lemah</p>
            </div>
            <div className={`border rounded-xl px-3 py-3 text-center ${semakTiadaCount > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`text-2xl font-black ${semakTiadaCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>{semakTiadaCount}</p>
              <p className={`text-[10px] font-semibold uppercase tracking-wide mt-0.5 ${semakTiadaCount > 0 ? 'text-red-500' : 'text-gray-400'}`}>Tiada Rekod</p>
            </div>
          </div>

          {/* Orphan rekod alert */}
          {semakOrphan.length > 0 && semakFilter !== 'orphan' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="text-amber-500 text-base mt-0.5">⚠</span>
              <div className="flex-1">
                <p className="text-xs font-bold text-amber-800">
                  {semakOrphan.length} rekod orphan — ada dalam library tapi tiada padanan acara
                </p>
                <p className="text-[10px] text-amber-600 mt-0.5">
                  Mungkin namaAcara berbeza (typo/kes huruf) atau acara sudah dihapus.
                  Semak dan delete jika perlu.
                </p>
              </div>
              <button onClick={() => setSemakFilter('orphan')}
                className="shrink-0 px-3 py-1.5 bg-amber-400 hover:bg-amber-500 text-white text-xs font-bold rounded-lg transition-colors">
                Semak Orphan
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">Memuatkan…</div>

          ) : semakFilter === 'orphan' ? (
            /* ── View: Rekod Orphan ── */
            semakOrphan.length === 0 ? (
              <div className="bg-green-50 border border-green-200 rounded-xl py-12 text-center">
                <p className="text-3xl mb-2">✅</p>
                <p className="text-sm font-bold text-green-700">Tiada rekod orphan — semua rekod ada padanan acara.</p>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200">
                  <span className="text-amber-500">⚠</span>
                  <p className="text-sm font-bold text-amber-800">Rekod Orphan — tiada padanan acara dalam sistem</p>
                  <span className="ml-auto text-[10px] text-amber-600">{semakOrphan.length} rekod</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 text-[10px] uppercase tracking-wide border-b border-gray-100">
                        <th className="px-4 py-2 text-left">Nama Acara (dalam rekod)</th>
                        <th className="px-3 py-2 text-center w-16">Jan.</th>
                        <th className="px-3 py-2 text-center">Kat.</th>
                        <th className="px-4 py-2 text-right">Prestasi</th>
                        <th className="px-4 py-2 text-left">Rekod Key</th>
                        {canEdit && <th className="px-3 py-2 text-center">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {semakOrphan.map(r => {
                        const kat = katMap[r.kategoriKod]
                        const isExpanded = baikiOrphanId === r.id
                        // Dropdown: acara dalam sistem yang sama jantina (semua kategori)
                        // Guna label dari katMap supaya user boleh kenal pasti kategori betul
                        const acaraOptions = Object.values(
                          acaraList
                            .filter(a => a.jantina === r.jantina)
                            .reduce((acc, a) => {
                              const nama = a.namaAcaraPendek || a.namaAcara
                              const compositeKey = `${nama}::${a.kategoriKod}`
                              if (!acc[compositeKey]) {
                                const katLabel = katMap[a.kategoriKod]?.label || katMap[a.kategoriKod]?.nama || a.kategoriKod
                                acc[compositeKey] = { value: compositeKey, nama, kategoriKod: a.kategoriKod, katLabel, noAcara: a.noAcara }
                              }
                              return acc
                            }, {})
                        ).sort((a, b) => a.nama.localeCompare(b.nama))
                        const [_targetNama, _targetKat] = (baikiTargetAcara || '').includes('::')
                          ? baikiTargetAcara.split('::') : ['', '']
                        const previewNewKey = _targetNama && _targetKat && isExpanded
                          ? rekodKey(_targetNama, r.jantina, _targetKat, r.peringkat || semakPeringkat)
                          : null

                        return (
                          <>
                            <tr key={r.id} className={`border-b border-gray-50 ${isExpanded ? 'bg-amber-100/40' : 'bg-amber-50/30'}`}>
                              <td className="px-4 py-2.5 font-semibold text-gray-800">{r.namaAcara}</td>
                              <td className="px-3 py-2.5 text-center">
                                <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  r.jantina === 'L' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                                }`}>{r.jantina}</span>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className="text-[10px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                                  {kat?.label || kat?.nama || r.kategoriKod}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-black text-[#003399]">
                                {formatPrestasi(r.prestasi, r.unit)}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-[9px] text-red-400 break-all">{r.id}</td>
                              {canEdit && (
                                <td className="px-3 py-2.5 text-center">
                                  <div className="flex items-center gap-1 justify-center">
                                    <button
                                      onClick={() => {
                                        if (isExpanded) {
                                          setBaikiOrphanId(null)
                                          setBaikiTargetAcara('')
                                        } else {
                                          setBaikiOrphanId(r.id)
                                          setBaikiTargetAcara('')
                                        }
                                      }}
                                      className={`text-[10px] px-2 py-1 rounded font-semibold transition-colors ${
                                        isExpanded
                                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                          : 'bg-amber-500 hover:bg-amber-600 text-white'
                                      }`}
                                    >
                                      {isExpanded ? 'Tutup' : 'Baiki'}
                                    </button>
                                    <button
                                      onClick={() => handleDelete(r)}
                                      className="text-[10px] px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded font-semibold transition-colors"
                                    >
                                      Padam
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>

                            {/* ── Inline Baiki Panel ── */}
                            {isExpanded && (
                              <tr key={`${r.id}_baiki`} className="border-b border-amber-200">
                                <td colSpan={canEdit ? 6 : 5} className="px-4 py-0">
                                  <div className="my-3 bg-white border border-amber-300 rounded-xl overflow-hidden shadow-sm">
                                    {/* Panel header */}
                                    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2">
                                      <span className="text-amber-500 text-sm">🔧</span>
                                      <p className="text-xs font-bold text-amber-800">Baiki Rekod Orphan</p>
                                      <p className="text-[10px] text-amber-600 ml-1">— padankan ke acara yang betul</p>
                                    </div>

                                    <div className="p-4 space-y-3">
                                      {/* Key semasa */}
                                      <div className="flex items-start gap-3">
                                        <div className="flex-1">
                                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Key Semasa (orphan)</p>
                                          <p className="font-mono text-[10px] bg-red-50 border border-red-200 rounded px-2 py-1.5 text-red-700 break-all">{r.id}</p>
                                        </div>
                                      </div>

                                      {/* Pilih acara betul */}
                                      <div>
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
                                          Padankan ke acara{acaraOptions.length === 0 ? ' — tiada acara jantina sama dalam sistem' : ':'}
                                        </p>
                                        {acaraOptions.length > 0 ? (
                                          <select
                                            value={baikiTargetAcara}
                                            onChange={e => setBaikiTargetAcara(e.target.value)}
                                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 bg-white"
                                          >
                                            <option value="">— Pilih acara + kategori yang betul —</option>
                                            {acaraOptions.map(opt => (
                                              <option key={opt.value} value={opt.value}>
                                                [{opt.noAcara || '—'}] {opt.nama} · {opt.katLabel}
                                              </option>
                                            ))}
                                          </select>
                                        ) : (
                                          <p className="text-[10px] text-gray-400 italic">
                                            Tiada acara dengan jantina={r.jantina} dalam sistem.
                                            Gunakan Padam untuk buang rekod ini.
                                          </p>
                                        )}
                                      </div>

                                      {/* Preview key baru */}
                                      {previewNewKey && (
                                        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                                          <span className="font-mono text-[9px] text-red-400 line-through break-all">{r.id}</span>
                                          <span className="text-gray-400 shrink-0">→</span>
                                          <span className={`font-mono text-[9px] break-all font-bold ${
                                            previewNewKey === r.id ? 'text-amber-600' : 'text-green-600'
                                          }`}>{previewNewKey}</span>
                                          {previewNewKey === r.id && (
                                            <span className="ml-1 text-[9px] text-amber-600 shrink-0">(tiada beza)</span>
                                          )}
                                        </div>
                                      )}

                                      {/* Action buttons */}
                                      <div className="flex items-center gap-2 pt-1">
                                        <button
                                          onClick={() => {
                                            const [tNama, tKat] = (baikiTargetAcara || '').split('::')
                                            handleBaikiOrphan(r, tNama, tKat)
                                          }}
                                          disabled={!_targetNama || !_targetKat || baikiSaving || previewNewKey === r.id}
                                          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-bold rounded-lg transition-colors"
                                        >
                                          {baikiSaving ? '⏳ Memproses…' : 'Baiki Sekarang'}
                                        </button>
                                        <button
                                          onClick={() => handleDelete(r)}
                                          disabled={baikiSaving}
                                          className="px-4 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                                        >
                                          Padam Terus
                                        </button>
                                        <button
                                          onClick={() => { setBaikiOrphanId(null); setBaikiTargetAcara('') }}
                                          className="px-3 py-2 text-xs text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                                        >
                                          Batal
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )

          ) : acaraList.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl py-14 text-center">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-sm font-semibold text-gray-500">Tiada acara — pastikan kejohanan aktif wujud.</p>
            </div>

          ) : semakGroupKeys.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl py-12 text-center">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-sm font-bold text-green-700">
                Semua acara ada rekod peringkat {PERINGKAT_META[semakPeringkat]?.label}!
              </p>
            </div>

          ) : (
            /* ── View: Semua / Tiada ── */
            <div className="space-y-4">
              {semakGroupKeys.map(katKod => {
                const rows = (semakGrouped[katKod] || [])
                  .sort((a, b) => a.namaKey.localeCompare(b.namaKey) || a.jantina.localeCompare(b.jantina))
                const kat = katMap[katKod]
                const tiadaInGroup = rows.filter(x => !x.hasRekod).length
                return (
                  <div key={katKod} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                    {/* Group header */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <div className="w-1.5 h-6 rounded-sm" style={{ backgroundColor: kat?.warna || '#94a3b8' }} />
                      <div>
                        <span className="text-sm font-bold text-gray-800">{kat?.nama || katKod}</span>
                        <span className="ml-2 text-[10px] text-gray-400 font-mono">({kat?.label || kat?.kod || katKod})</span>
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        {tiadaInGroup > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                            {tiadaInGroup} tiada rekod
                          </span>
                        )}
                        {rows.filter(x => x.connectionType === 'lemah').length > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            {rows.filter(x => x.connectionType === 'lemah').length} sambungan lemah
                          </span>
                        )}
                        {tiadaInGroup === 0 && rows.filter(x => x.connectionType === 'lemah').length === 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                            Lengkap ✓
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400">{rows.length} acara</span>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 text-[10px] uppercase tracking-wide border-b border-gray-100">
                            <th className="px-4 py-2 text-left">Acara</th>
                            <th className="px-3 py-2 text-center w-16">Jan.</th>
                            <th className="px-3 py-2 text-center">Kategori</th>
                            <th className="px-4 py-2 text-left">Status Rekod</th>
                            <th className="px-4 py-2 text-right">Prestasi</th>
                            {canEdit && <th className="px-3 py-2 text-center">Aksi</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(x => {
                            const xKat = katMap[x.kategoriKod]
                            return (
                              <tr key={x.rKey} className={`border-b border-gray-50 ${
                                x.connectionType === 'tiada' ? 'bg-red-50/40' :
                                x.connectionType === 'lemah' ? 'bg-amber-50/40' :
                                'hover:bg-gray-50'
                              }`}>
                                <td className="px-4 py-2.5 font-semibold text-gray-800">{x.namaKey}</td>
                                <td className="px-3 py-2.5 text-center">
                                  <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                    x.jantina === 'L' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                                  }`}>{x.jantina}</span>
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <span className="text-[10px] font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">
                                    {xKat?.label || xKat?.nama || x.kategoriKod}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  {x.connectionType === 'kuat' && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                                      <span className="text-green-700 font-semibold">Sambungan Kuat</span>
                                      {x.rekodItem?.namaAtlet && (
                                        <span className="text-gray-400 truncate max-w-[120px]">— {x.rekodItem.namaAtlet}</span>
                                      )}
                                    </div>
                                  )}
                                  {x.connectionType === 'lemah' && (
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                                        <span className="text-amber-700 font-semibold">Sambungan Lemah</span>
                                      </div>
                                      <p className="text-[9px] font-mono text-amber-500 pl-3.5">
                                        key lama: {x.rKey}
                                      </p>
                                    </div>
                                  )}
                                  {x.connectionType === 'tiada' && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                                      <span className="text-red-600 font-semibold">Tiada Rekod</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  {x.hasRekod ? (
                                    <span className={`font-black text-sm ${x.connectionType === 'lemah' ? 'text-amber-600' : 'text-[#003399]'}`}>
                                      {formatPrestasi(x.rekodItem.prestasi, x.rekodItem.unit)}
                                    </span>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                                {canEdit && (
                                  <td className="px-3 py-2.5 text-center">
                                    {x.connectionType === 'tiada' && (
                                      <button
                                        onClick={() => {
                                          const matchAcara = acaraList.find(a =>
                                            (a.namaAcaraPendek || a.namaAcara) === x.namaKey &&
                                            a.jantina === x.jantina && a.kategoriKod === x.kategoriKod
                                          )
                                          const unitAuto = matchAcara?.jenisAcara?.startsWith('padang') ? 'm' : 's'
                                          setModal({ mode: 'add', initial: {
                                            ...EMPTY_FORM,
                                            namaAcara:   x.namaKey,
                                            jantina:     x.jantina,
                                            kategoriKod: x.kategoriKod,
                                            peringkat:   semakPeringkat,
                                            unit:        unitAuto,
                                          }})
                                        }}
                                        className="text-[10px] px-2.5 py-1 bg-[#003399] hover:bg-[#002277] text-white rounded font-semibold transition-colors"
                                      >
                                        + Tambah
                                      </button>
                                    )}
                                    {x.connectionType === 'lemah' && (
                                      <button
                                        onClick={() => handleBaikiKey(x)}
                                        className="text-[10px] px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded font-semibold transition-colors"
                                        title={`Tukar key: ${x.rKey} → ${x.rKeyBaru}`}
                                      >
                                        Baiki Key
                                      </button>
                                    )}
                                    {x.connectionType === 'kuat' && (
                                      <button
                                        onClick={() => setModal({ mode: 'edit', initial: {
                                          ...EMPTY_FORM,
                                          ...x.rekodItem,
                                          prestasi:  String(x.rekodItem.prestasi),
                                          windSpeed: x.rekodItem.windSpeed != null ? String(x.rekodItem.windSpeed) : '',
                                        }})}
                                        className="text-[10px] px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded font-semibold transition-colors"
                                      >
                                        Edit
                                      </button>
                                    )}
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Nota */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[10px] text-blue-700 space-y-0.5">
        <p className="font-bold">Nota Sistem Rekod:</p>
        <p>· D = Rekod Daerah &nbsp;·&nbsp; N = Rekod Negeri &nbsp;·&nbsp; K = Rekod Kebangsaan</p>
        <p>· Rekod manual ada tanda asterisk (*). Rekod elektronik lebih dipercayai.</p>
        <p>· Angin &gt; 2.0 m/s — prestasi TIDAK layak sebagai rekod rasmi (WA Rule).</p>
        <p>· Sahkan tuntutan selepas semak angin, kelayakan atlet, dan timing system.</p>
        <p>· Import: gunakan template Excel yang disediakan. Sheet pertama = data rekod.</p>
      </div>

      {/* ── Modals ── */}
      {modal && (
        <RekodModal
          initial={modal.initial}
          kategoriList={kategoriList}
          acaraList={acaraList}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setMsg({ type: 'ok', text: 'Rekod disimpan.' }); load() }}
        />
      )}

      {showImport && (
        <ImportRekodModal
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); setMsg({ type: 'ok', text: 'Import selesai. Rekod dikemaskini.' }); load() }}
        />
      )}

      {showCetak && (
        <CetakModal
          rekodList={rekodList}
          kategoriList={kategoriList}
          onClose={() => setShowCetak(false)}
        />
      )}
    </div>
  )
}
