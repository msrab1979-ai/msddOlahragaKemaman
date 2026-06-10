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
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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

  const totalEvents = sortedEvents.length

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

    const filledEvents = events.filter(ev => ev.cols.some(c => c.cnt > 0)).length

    return {
      kodSekolah: s.kodSekolah,
      namaSekolah: s.namaSekolah || s.kodSekolah,
      events,
      filledCols,
      filledEvents,
      totalEvents,
      isLengkap: totalEvents > 0 && filledEvents === totalEvents,
    }
  })

  // 7. Jumlah per sub-kolum
  const colTotals = {}
  rows.forEach(r => {
    r.events.forEach(ev => {
      ev.cols.forEach(c => {
        colTotals[c.acaraId] = (colTotals[c.acaraId] || 0) + c.cnt
      })
    })
  })

  return { sortedEvents, rows, totalSubCols, totalEvents, colTotals }
}

// ─── Helpers — Tab 3 (Pendaftaran By Acara) ──────────────────────────────────

function buildByAcara(acaraList, pendaftaranDocs, sekolahList, filterSekolah) {
  const sekolahMap = Object.fromEntries(sekolahList.map(s => [s.kodSekolah || s.id, s.namaSekolah || s.kodSekolah || s.id]))

  // acaraId → list of athletes
  const acaraAtletMap = {}
  pendaftaranDocs.forEach(p => {
    if (filterSekolah && p.kodSekolah !== filterSekolah) return
    ;(p.acaraIds || []).forEach(aid => {
      if (!acaraAtletMap[aid]) acaraAtletMap[aid] = []
      acaraAtletMap[aid].push({
        noBib:      p.noBib      || '—',
        namaAtlet:  p.namaAtlet  || p.noKP || '—',
        noKP:       p.noKP       || '',
        jantina:    p.jantina    || '',
        kategoriKod: p.kategoriKod || '',
        kodSekolah: p.kodSekolah || '',
        namaSekolah: sekolahMap[p.kodSekolah] || p.kodSekolah || '—',
      })
    })
  })

  return acaraList
    .filter(a => acaraAtletMap[a.id]?.length > 0)
    .sort((a, b) => (Number(a.noAcara) || 0) - (Number(b.noAcara) || 0))
    .map(a => ({
      ...a,
      atlet: (acaraAtletMap[a.id] || []).sort((x, y) =>
        (x.noBib || '').localeCompare(y.noBib || '', undefined, { numeric: true })
      ),
    }))
}

// ─── Tab 3: Pendaftaran By Acara (pilih sekolah dahulu) ──────────────────────

function TabPendaftaranByAcara({ sekolahList, acaraList, pendaftaranDocs, kategoriList, namaKej }) {
  const katLabelMap = Object.fromEntries(kategoriList.map(k => [k.id, k.label || k.id]))

  const sekolahAda = [...new Map(
    pendaftaranDocs.map(p => [p.kodSekolah, sekolahList.find(s => (s.kodSekolah || s.id) === p.kodSekolah)])
  ).entries()]
    .filter(([, s]) => s)
    .map(([kod, s]) => ({ kod, nama: s.namaSekolah || kod }))
    .sort((a, b) => a.nama.localeCompare(b.nama))

  const [selectedSekolah, setSelectedSekolah] = useState(sekolahAda[0]?.kod || '')
  const [cari, setCari] = useState('')

  const sekolahTapis = cari.trim()
    ? sekolahAda.filter(s => s.nama.toLowerCase().includes(cari.toLowerCase()))
    : sekolahAda

  const sekolahDipilih = sekolahAda.find(s => s.kod === selectedSekolah)
  const data = buildByAcara(acaraList, pendaftaranDocs, sekolahList, selectedSekolah)
  const totalPendaftaran = data.reduce((n, a) => n + a.atlet.length, 0)

  function cetakPDF() {
    if (!sekolahDipilih || data.length === 0) return
    const doc = new jsPDF('p', 'mm', 'a4')
    const margin = 14, pageW = 210, contentW = pageW - margin * 2
    let y = margin

    // Header
    doc.setFontSize(13).setFont('helvetica', 'bold').setTextColor(0, 51, 153)
    doc.text('SENARAI PENDAFTARAN SEKOLAH', margin, y); y += 7
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(30, 30, 30)
    doc.text(sekolahDipilih.nama, margin, y); y += 6
    doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(100, 100, 100)
    if (namaKej) { doc.text(namaKej, margin, y); y += 5 }
    doc.text(`${data.length} acara  •  ${totalPendaftaran} pendaftaran`, margin, y); y += 8

    // Per acara
    data.forEach(acara => {
      if (y > 265) { doc.addPage(); y = margin }

      // Bar header acara
      doc.setFillColor(0, 51, 153)
      doc.roundedRect(margin, y, contentW, 6.5, 1, 1, 'F')
      doc.setFontSize(8).setFont('helvetica', 'bold').setTextColor(255, 255, 255)
      doc.text(`#${acara.noAcara}  ${acara.namaAcara || acara.namaAcaraPendek || acara.id}`, margin + 3, y + 4.5)
      doc.text(`${acara.atlet.length} atlet`, pageW - margin - 3, y + 4.5, { align: 'right' })
      y += 8

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        tableWidth: contentW,
        head: [['Bil', 'No Bib', 'Nama Atlet', 'Kat']],
        body: acara.atlet.map((atlet, i) => [
          i + 1,
          atlet.noBib,
          atlet.namaAtlet,
          `${atlet.jantina}${katLabelMap[atlet.kategoriKod] || atlet.kategoriKod}`,
        ]),
        styles: { fontSize: 8, cellPadding: 1.8 },
        headStyles: { fillColor: [0, 68, 187], textColor: 255, fontStyle: 'bold', fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 12, halign: 'center' },
          1: { cellWidth: 26 },
          3: { cellWidth: 20, halign: 'center' },
        },
        alternateRowStyles: { fillColor: [248, 249, 252] },
      })
      y = doc.lastAutoTable.finalY + 6
    })

    doc.setFontSize(7).setTextColor(150).text(
      `Dicetak: ${new Date().toLocaleDateString('ms-MY')}`,
      pageW - margin, y, { align: 'right' }
    )
    doc.save(`Pendaftaran_${sekolahDipilih.nama.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  return (
    <div className="space-y-4">

      {/* Pilih sekolah — utama */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex flex-wrap gap-3 items-start justify-between">
        <div className="flex flex-wrap gap-3 items-start">
          <div className="shrink-0 space-y-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cari Sekolah</p>
            <input
              type="text"
              value={cari}
              onChange={e => setCari(e.target.value)}
              placeholder="Taip nama sekolah…"
              className="border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 bg-white focus:outline-none focus:border-[#003399] w-64"
            />
            {sekolahTapis.length > 0 ? (
              <select
                value={selectedSekolah}
                onChange={e => setSelectedSekolah(e.target.value)}
                size={Math.min(sekolahTapis.length, 6)}
                className="block border border-gray-200 rounded-lg px-3 py-1 text-xs font-semibold text-gray-700 bg-white focus:outline-none focus:border-[#003399] w-64"
              >
                {sekolahTapis.map(s => (
                  <option key={s.kod} value={s.kod}>{s.nama}</option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-gray-400 italic">Tiada sekolah ditemui.</p>
            )}
          </div>
          {sekolahDipilih && (
            <div className="flex flex-col gap-1 pt-5">
              <p className="text-xs font-bold text-gray-700">{sekolahDipilih.nama}</p>
              <div className="flex gap-4 text-center">
                <div>
                  <p className="text-lg font-black text-[#003399]">{data.length}</p>
                  <p className="text-[10px] text-gray-400">Acara</p>
                </div>
                <div>
                  <p className="text-lg font-black text-[#003399]">{totalPendaftaran}</p>
                  <p className="text-[10px] text-gray-400">Pendaftaran</p>
                </div>
              </div>
            </div>
          )}
        </div>
        {sekolahDipilih && data.length > 0 && (
          <button
            onClick={cetakPDF}
            className="flex items-center gap-2 px-3 py-2 bg-[#003399] text-white text-xs font-bold rounded-lg hover:bg-[#002280] transition-colors shrink-0 mt-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
            </svg>
            Cetak PDF
          </button>
        )}
      </div>

      {/* Tiada pendaftaran */}
      {data.length === 0 && selectedSekolah && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-400">Tiada pendaftaran untuk sekolah ini.</p>
        </div>
      )}

      {/* Jadual per acara */}
      {data.length > 0 && (
        <div className="space-y-3">
          {data.map(acara => (
            <div key={acara.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2 bg-[#003399] flex items-center justify-between">
                <p className="text-xs font-bold text-white">
                  #{acara.noAcara}&nbsp;&nbsp;{acara.namaAcara || acara.namaAcaraPendek || acara.id}
                </p>
                <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full font-semibold">
                  {acara.atlet.length} atlet
                </span>
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-3 py-2 font-bold text-gray-500 w-8">Bil</th>
                    <th className="text-left px-3 py-2 font-bold text-gray-500 w-24">No Bib</th>
                    <th className="text-left px-3 py-2 font-bold text-gray-500">Nama Atlet</th>
                    <th className="text-left px-3 py-2 font-bold text-gray-500 w-16">Kat</th>
                  </tr>
                </thead>
                <tbody>
                  {acara.atlet.map((atlet, i) => (
                    <tr key={atlet.noKP || i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-mono font-bold text-[#003399]">{atlet.noBib}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{atlet.namaAtlet}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          atlet.jantina === 'L' ? 'bg-blue-100 text-blue-700' :
                          atlet.jantina === 'P' ? 'bg-pink-100 text-pink-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {atlet.jantina}{katLabelMap[atlet.kategoriKod] || atlet.kategoriKod}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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

function TabRingkasanAcara({ analisis, totalAtlet, namaKej }) {
  if (!analisis) return null
  const { colHeaders, rows, colTotals, grandTotal } = analisis

  function cetakPDF() {
    const doc = new jsPDF('p', 'mm', 'a4')
    const margin = 14, pageW = 210, contentW = pageW - margin * 2
    let y = margin

    doc.setFontSize(13).setFont('helvetica', 'bold').setTextColor(0, 51, 153)
    doc.text('RINGKASAN PENDAFTARAN ACARA', margin, y); y += 7
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(80, 80, 80)
    if (namaKej) { doc.text(namaKej, margin, y); y += 5 }
    doc.text(`Jumlah Atlet: ${totalAtlet}  •  Jenis Acara: ${rows.length}  •  Jumlah Pendaftaran: ${grandTotal}`, margin, y); y += 8

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      tableWidth: contentW,
      head: [['Acara', ...colHeaders, 'Jumlah']],
      body: rows.map(r => [r.namaPendek, ...colHeaders.map(c => r.cols[c] || ''), r.total]),
      foot: [['JUMLAH', ...colHeaders.map(c => colTotals[c] || 0), grandTotal]],
      styles: { fontSize: 7, cellPadding: 1.5, halign: 'center' },
      headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      footStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold', fontSize: 7 },
      columnStyles: { 0: { halign: 'left', cellWidth: 38 } },
      alternateRowStyles: { fillColor: [248, 249, 252] },
    })

    doc.setFontSize(7).setTextColor(150).text(
      `Dicetak: ${new Date().toLocaleDateString('ms-MY')}`,
      pageW - margin, doc.lastAutoTable.finalY + 5, { align: 'right' }
    )
    doc.save(`RingkasanPendaftaran_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  return (
    <div className="space-y-4">
      {/* Stat + butang cetak */}
      <div className="flex flex-wrap gap-3 items-start justify-between">
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
        <button
          onClick={cetakPDF}
          className="flex items-center gap-2 px-3 py-2 bg-[#003399] text-white text-xs font-bold rounded-lg hover:bg-[#002280] transition-colors shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
          </svg>
          Cetak PDF
        </button>
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

function TabAnalisisSekolah({ sekolahList, acaraList, pendaftaranDocs, kategoriList, namaKej }) {
  const jenisOptions = [...new Set(
    kategoriList.map(k => k.jenisSekolah).filter(Boolean)
  )].sort()

  const [jenisSekolah, setJenisSekolah] = useState(() => jenisOptions[0] || 'SR')
  const [statusFilter, setStatusFilter] = useState('semua')

  const data = buildAnalisisBySekolah(
    sekolahList, acaraList, pendaftaranDocs, kategoriList, jenisSekolah
  )
  const { sortedEvents, rows, colTotals } = data

  const sudahRows    = rows.filter(r => r.filledCols > 0)
  const belumRows    = rows.filter(r => r.filledCols === 0)
  const lengkapCount = rows.filter(r => r.isLengkap).length

  const visibleRows = statusFilter === 'sudah' ? sudahRows
    : statusFilter === 'belum' ? belumRows
    : rows

  function cetakPDF() {
    const doc = new jsPDF('p', 'mm', 'a4')
    const margin = 14, pageW = 210, contentW = pageW - margin * 2
    const statusLabel = statusFilter === 'belum' ? 'Belum Daftar'
      : statusFilter === 'sudah' ? 'Sudah Daftar' : 'Semua Sekolah'
    let y = margin

    doc.setFontSize(13).setFont('helvetica', 'bold').setTextColor(0, 51, 153)
    doc.text('ANALISIS PENDAFTARAN SEKOLAH', margin, y); y += 7
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(80, 80, 80)
    if (namaKej) { doc.text(namaKej, margin, y); y += 5 }
    doc.text(`Jenis Sekolah: ${jenisSekolah}  •  ${statusLabel}`, margin, y); y += 5
    doc.text(`Sudah Daftar: ${sudahRows.length}  •  Belum Daftar: ${belumRows.length}  •  Lengkap: ${lengkapCount}`, margin, y); y += 8

    if (statusFilter === 'belum') {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        tableWidth: contentW,
        head: [['Bil', 'Nama Sekolah', 'Kod Sekolah']],
        body: belumRows.map((r, i) => [i + 1, r.namaSekolah, r.kodSekolah]),
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [180, 0, 0], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 14, halign: 'center' }, 2: { cellWidth: 36 } },
        alternateRowStyles: { fillColor: [255, 248, 248] },
      })
    } else {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        tableWidth: contentW,
        head: [['Bil', 'Nama Sekolah', 'Daftar', 'Status']],
        body: visibleRows.map((r, i) => [
          i + 1,
          r.namaSekolah,
          r.filledEvents === 0 ? '—' : `${r.filledEvents}/${r.totalEvents}`,
          r.filledEvents === 0 ? 'Belum Daftar' : r.isLengkap ? 'Lengkap' : 'Sebahagian',
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 12, halign: 'center' },
          2: { cellWidth: 24, halign: 'center' },
          3: { cellWidth: 30, halign: 'center' },
        },
        alternateRowStyles: { fillColor: [248, 249, 252] },
        didParseCell: d => {
          if (d.column.index === 3 && d.cell.section === 'body') {
            const v = d.cell.raw
            d.cell.styles.textColor = v === 'Lengkap' ? [0, 120, 0]
              : v === 'Belum Daftar' ? [180, 0, 0]
              : [160, 80, 0]
            d.cell.styles.fontStyle = 'bold'
          }
        },
      })
    }

    doc.setFontSize(7).setTextColor(150).text(
      `Dicetak: ${new Date().toLocaleDateString('ms-MY')}`,
      pageW - margin, doc.lastAutoTable.finalY + 5, { align: 'right' }
    )
    doc.save(`AnalisisSekolah_${jenisSekolah}_${statusLabel.replace(' ', '')}_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  return (
    <div className="space-y-4">

      {/* Filter jenis sekolah */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 font-medium">Jenis Sekolah:</span>
        {jenisOptions.map(jenis => (
          <button
            key={jenis}
            onClick={() => { setJenisSekolah(jenis); setStatusFilter('semua') }}
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

      {/* Stat cards — boleh klik untuk filter */}
      <div className="flex flex-wrap gap-3">
        {[
          { key: 'semua',  label: 'Jumlah Sekolah',   val: rows.length,       color: 'text-[#003399]' },
          { key: 'sudah',  label: 'Sudah Daftar',      val: sudahRows.length,  color: 'text-green-600' },
          { key: 'belum',  label: 'Belum Daftar',      val: belumRows.length,  color: 'text-red-500'   },
          { key: null,     label: 'Lengkap',           val: lengkapCount,      color: 'text-blue-600'  },
        ].map(({ key, label, val, color }) => (
          <div
            key={label}
            onClick={() => key && setStatusFilter(key)}
            className={`bg-white border rounded-lg px-4 py-2 text-center min-w-[100px] ${
              key ? 'cursor-pointer hover:shadow-sm transition-shadow' : ''
            } ${statusFilter === key ? 'border-[#003399] ring-1 ring-[#003399]' : 'border-gray-200'}`}
          >
            <p className={`text-xl font-black ${color}`}>{val}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Toggle status + butang cetak */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[
            { key: 'semua', label: 'Semua' },
            { key: 'sudah', label: 'Sudah Daftar' },
            { key: 'belum', label: 'Belum Daftar' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setStatusFilter(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                statusFilter === t.key
                  ? 'bg-white text-[#003399] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={cetakPDF}
          className="flex items-center gap-2 px-3 py-2 bg-[#003399] text-white text-xs font-bold rounded-lg hover:bg-[#002280] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
          </svg>
          Cetak PDF
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6 bg-white border border-gray-100 rounded-xl">
          Tiada sekolah {jenisSekolah} atau tiada acara untuk kategori ini.
        </p>
      ) : statusFilter === 'belum' ? (

        /* ── Senarai ringkas Belum Daftar ── */
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-red-50 border-b border-red-100 flex items-center justify-between">
            <p className="text-xs font-bold text-red-700">Sekolah Belum Mendaftar</p>
            <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">
              {belumRows.length} sekolah
            </span>
          </div>
          {belumRows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Semua sekolah sudah mendaftar.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {belumRows.map((r, i) => (
                <li key={r.kodSekolah} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[10px] text-gray-400 w-6 text-right">{i + 1}.</span>
                  <span className="text-xs font-medium text-gray-800">{r.namaSekolah}</span>
                  <span className="ml-auto text-[10px] text-gray-400">{r.kodSekolah}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

      ) : (

        /* ── Jadual penuh (Semua / Sudah Daftar) ── */
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
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
              {visibleRows.map((row, i) => (
                <tr key={row.kodSekolah} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-inherit border-r border-gray-100 whitespace-nowrap">
                    {row.namaSekolah}
                  </td>
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
                  <td className="px-3 py-1.5 text-center border-l border-blue-100 bg-blue-50/50">
                    {row.filledEvents === 0 ? (
                      <span className="inline-flex items-center gap-1 bg-red-50 text-red-500 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        Belum Daftar
                      </span>
                    ) : row.isLengkap ? (
                      <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        ✓ {row.filledEvents} acara
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-orange-50 text-orange-600 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                        {row.filledEvents}/{row.totalEvents} acara
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
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
                  {sudahRows.length}/{rows.length}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[10px] text-gray-400">
        * Klik kad stat untuk tapis. Belum Daftar = sekolah tiada sebarang pendaftaran.
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
          { key: 'bysekolah', label: 'Pendaftaran Sekolah' },
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
        <TabRingkasanAcara analisis={analisis} totalAtlet={totalAtlet} namaKej={namaKej} />
      )}

      {activeTab === 'sekolah' && (
        <TabAnalisisSekolah
          sekolahList={sekolahList}
          acaraList={acaraList}
          pendaftaranDocs={pendaftaranDocs}
          kategoriList={kategoriList}
          namaKej={namaKej}
        />
      )}

      {activeTab === 'bysekolah' && (
        <TabPendaftaranByAcara
          sekolahList={sekolahList}
          acaraList={acaraList}
          pendaftaranDocs={pendaftaranDocs}
          kategoriList={kategoriList}
          namaKej={namaKej}
        />
      )}
    </div>
  )
}
