/**
 * Olahragawan — /dashboard/olahragawan
 *
 * Ranking individu per Kategori (A/B/C/D/E) × Jantina (L/P).
 * Mata: Emas=5, Perak=3, Gangsa=2, Tempat4=1
 * Tiebreak: Mata → Emas → Perak → Gangsa → Nama (abjad)
 * Admin pilih manual Murid Terbaik per kategori.
 * Real-time via onSnapshot. Sulit — admin sahaja.
 */

import { useState, useEffect, useRef } from 'react'
import {
  collection, doc, getDoc, getDocs, query, where, onSnapshot, orderBy,
  setDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'

// ─── Konstanta ────────────────────────────────────────────────────────────────

const PINGAT_STYLE = {
  emas:    { bg: 'bg-yellow-100 text-yellow-800 border-yellow-300', coin: 'bg-yellow-400 border-yellow-500 text-white', label: 'E', short: 'Emas' },
  perak:   { bg: 'bg-gray-100 text-gray-700 border-gray-300',       coin: 'bg-gray-400 border-gray-500 text-white',     label: 'P', short: 'Perak' },
  gangsa:  { bg: 'bg-orange-100 text-orange-800 border-orange-300', coin: 'bg-orange-400 border-orange-500 text-white', label: 'G', short: 'Gangsa' },
  tempat4: { bg: 'bg-slate-100 text-slate-700 border-slate-300',    coin: 'bg-slate-400 border-slate-500 text-white',   label: '4', short: 'T.4' },
}

const RANK_STYLE = {
  1: 'bg-yellow-400 text-white border-yellow-500',
  2: 'bg-gray-400 text-white border-gray-500',
  3: 'bg-orange-400 text-white border-orange-500',
}

// Hardcode sebagai fallback — digantikan dengan data Firestore
const KAT_LABEL_FALLBACK = {
  A: 'Kat A — Bwh 10', B: 'Kat B — Bwh 12', C: 'Kat C — Bwh 14',
  D: 'Kat D — Bwh 16', E: 'Kat E — Bwh 18', PPKI: 'Kat PPKI',
}
const PERINGKAT_LABEL = { D: 'Daerah', N: 'Negeri', K: 'Kebangsaan' }

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

function sortOlahragawan(a, b) {
  if ((b.jumlahMata    || 0) !== (a.jumlahMata    || 0)) return (b.jumlahMata    || 0) - (a.jumlahMata    || 0)
  if ((b.pingat_emas   || 0) !== (a.pingat_emas   || 0)) return (b.pingat_emas   || 0) - (a.pingat_emas   || 0)
  if ((b.pingat_perak  || 0) !== (a.pingat_perak  || 0)) return (b.pingat_perak  || 0) - (a.pingat_perak  || 0)
  if ((b.pingat_gangsa || 0) !== (a.pingat_gangsa || 0)) return (b.pingat_gangsa || 0) - (a.pingat_gangsa || 0)
  return (a.namaAtlet || '').localeCompare(b.namaAtlet || '', 'ms')
}

function rankWithTies(sorted) {
  let rank = 1
  return sorted.map((item, i) => {
    if (i === 0) return { ...item, rank: 1 }
    const prev = sorted[i - 1]
    const sama =
      (item.jumlahMata   || 0) === (prev.jumlahMata   || 0) &&
      (item.pingat_emas  || 0) === (prev.pingat_emas  || 0) &&
      (item.pingat_perak || 0) === (prev.pingat_perak || 0) &&
      (item.pingat_gangsa|| 0) === (prev.pingat_gangsa|| 0)
    if (!sama) rank = i + 1
    return { ...item, rank }
  })
}

function getAcaraDetail(atlet) {
  return Object.entries(atlet)
    .filter(([k]) => k.startsWith('acaraDetail_'))
    .map(([, v]) => v)
    .sort((a, b) => {
      const order = { emas: 0, perak: 1, gangsa: 2, tempat4: 3 }
      return (order[a.pingat] ?? 9) - (order[b.pingat] ?? 9)
    })
}

function getRekodDetail(atlet) {
  return Object.entries(atlet)
    .filter(([k]) => k.startsWith('rekod_'))
    .map(([, v]) => v)
}

function formatPrestasi(prestasi, unit) {
  if (prestasi == null || prestasi === '') return '—'
  const v = Number(prestasi)
  if (isNaN(v)) return '—'
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

function formatSelisih(baru, lama, unit) {
  if (baru == null || lama == null) return null
  const diff = Math.abs(Number(baru) - Number(lama)).toFixed(2)
  return unit === 's' ? `-${diff}s (lebih pantas)` : `+${diff}m (lebih jauh)`
}

function makeRekodKey(namaAcara, jantina, kategoriKod, peringkat) {
  return [namaAcara, jantina, kategoriKod, peringkat]
    .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

const REKOD_PERINGKAT_META = {
  K: { label: 'Kebangsaan', bg: 'bg-amber-50 border-amber-200', badge: 'bg-amber-500', text: 'text-amber-700' },
  N: { label: 'Negeri',     bg: 'bg-blue-50 border-blue-200',   badge: 'bg-blue-600',  text: 'text-blue-700' },
  D: { label: 'Daerah',     bg: 'bg-green-50 border-green-200', badge: 'bg-green-600', text: 'text-green-700' },
}

// ─── AtletModal ───────────────────────────────────────────────────────────────

function AtletModal({ atlet, namaKej, katLabelFn, onClose }) {
  if (!atlet) return null
  const acaraList = getAcaraDetail(atlet)

  // rekodList: dari mata_olahragawan (rekod_* fields) ATAU fallback fetch rekod collection
  const [rekodList,    setRekodList]    = useState(() => getRekodDetail(atlet))
  const [rekodLoading, setRekodLoading] = useState(false)

  useEffect(() => {
    const fromAtlet = getRekodDetail(atlet)
    if (fromAtlet.length > 0) { setRekodList(fromAtlet); return }
    // Fallback: rekod_* tiada dalam mata_olahragawan — fetch terus dari rekod collection
    if (!atlet.noKP || !atlet.kejohananId) return
    setRekodLoading(true)
    getDocs(query(
      collection(db, 'rekod'),
      where('noKP', '==', atlet.noKP),
      where('kejohananId', '==', atlet.kejohananId),
    ))
      .then(snap => {
        const docs = snap.docs
          .map(d => d.data())
          .filter(r => r.rekodId && !r.rekodId.endsWith('_tuntutan'))
          .map(r => ({
            namaAcara:       r.namaAcara       || '',
            namaAcaraPendek: r.namaAcaraPendek || r.namaAcara || '',
            kategoriKod:     r.kategoriKod     || '',
            jantina:         r.jantina         || '',
            peringkat:       r.peringkat       || '',
            unit:            r.unit            || 's',
            prestasiBaru:    r.prestasi        ?? null,  // rekod coll guna 'prestasi'
            tarikhBaru:      r.tarikhRekod     || null,
            prestasiLama:    r.prestasiLama    ?? null,
            tahunLama:       r.tahunLama       || null,
            namaLama:        r.namaLama        || null,
            lokasiLama:      r.lokasiLama      || null,
            catatanLama:     null,
          }))
        setRekodList(docs)
      })
      .catch(e => console.warn('AtletModal rekod fallback:', e))
      .finally(() => setRekodLoading(false))
  }, [atlet.noKP, atlet.kejohananId])

  // Close on backdrop click or Escape
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  async function cetakKadAtlet() {
    const { jsPDF }              = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W  = 210
    const ML = 12
    const MR = 12
    const tarikhCetak = new Date().toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' })

    // ── Helper: Header Rasmi (B)
    function lukisHeader(label) {
      pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0, 0, 0)
      pdf.text('MAJLIS SUKAN SEKOLAH DAERAH KEMAMAN', W / 2, 13, { align: 'center' })
      pdf.setFontSize(10)
      pdf.text(namaKej || '', W / 2, 19, { align: 'center' })
      pdf.setFontSize(8.5); pdf.setFont('helvetica', 'normal')
      pdf.text(tarikhCetak, W / 2, 25, { align: 'center' })
      pdf.setDrawColor(0, 51, 153); pdf.setLineWidth(0.5)
      pdf.line(ML, 28, W - MR, 28)
      pdf.setFontSize(11); pdf.setFont('helvetica', 'bold')
      pdf.text(label, W / 2, 35, { align: 'center' })
      pdf.setDrawColor(150, 150, 150); pdf.setLineWidth(0.3)
      pdf.line(ML, 38, W - MR, 38)
      return 38
    }

    // ── Helper: Maklumat atlet
    function lukisAtlet(afterHeader) {
      const y0 = afterHeader + 7
      pdf.setFontSize(12); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(0, 0, 0)
      pdf.text(atlet.namaAtlet || '—', ML, y0)
      pdf.setFontSize(8.5); pdf.setFont('helvetica', 'normal')
      pdf.text(
        `${atlet.namaSekolah || atlet.kodSekolah || '—'}   ·   ${katLabelFn(atlet.kategoriKod)}   ·   ${atlet.jantina === 'L' ? 'Lelaki' : 'Perempuan'}`,
        ML, y0 + 6,
      )
      const medalsShort = [
        (atlet.pingat_emas    || 0) > 0 ? `E×${atlet.pingat_emas}`    : null,
        (atlet.pingat_perak   || 0) > 0 ? `P×${atlet.pingat_perak}`   : null,
        (atlet.pingat_gangsa  || 0) > 0 ? `G×${atlet.pingat_gangsa}`  : null,
        (atlet.pingat_tempat4 || 0) > 0 ? `T4×${atlet.pingat_tempat4}`: null,
      ].filter(Boolean).join('  ')
      pdf.setFont('helvetica', 'bold')
      pdf.text(`${medalsShort || 'Tiada pingat'}   ·   ${atlet.jumlahMata || 0} mata`, ML, y0 + 12)
      pdf.setDrawColor(200, 200, 200); pdf.setLineWidth(0.3)
      pdf.line(ML, y0 + 15, W - MR, y0 + 15)
      return y0 + 21
    }

    // ── Helper: Jadual acara
    function lukisJadual(startY, showRekodCol) {
      if (acaraList.length === 0) {
        pdf.setFontSize(8); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(160, 160, 160)
        pdf.text('Tiada acara dimenangi.', ML, startY + 6)
        pdf.setTextColor(0, 0, 0)
        return startY + 12
      }
      const rows = acaraList.map(a => {
        const hasR = rekodList.some(r => r.namaAcara === a.namaAcara)
        const pLabel = a.pingat ? a.pingat.charAt(0).toUpperCase() + a.pingat.slice(1) : '—'
        const row = [a.namaAcara || '—', pLabel, formatPrestasi(a.prestasi, a.unit), `+${a.mata || 0}`]
        if (showRekodCol) row.push(hasR ? 'REKOD' : '')
        return row
      })
      const head = showRekodCol
        ? [['Acara', 'Pingat', 'Prestasi', '+Mata', 'Rekod']]
        : [['Acara', 'Pingat', 'Prestasi', '+Mata']]
      const colStyles = showRekodCol
        ? { 0: { cellWidth: 70 }, 1: { cellWidth: 26, halign: 'center' }, 2: { cellWidth: 30, halign: 'center' }, 3: { cellWidth: 18, halign: 'center' }, 4: { cellWidth: 22, halign: 'center', fontStyle: 'bold', textColor: [180, 100, 0] } }
        : { 0: { cellWidth: 80 }, 1: { cellWidth: 30, halign: 'center' }, 2: { cellWidth: 36, halign: 'center' }, 3: { cellWidth: 20, halign: 'center' } }
      autoTable(pdf, {
        startY,
        head,
        body: rows,
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { fillColor: [0, 51, 153], fontSize: 7.5, fontStyle: 'bold' },
        columnStyles: colStyles,
        theme: 'striped',
        didParseCell(d) {
          if (showRekodCol && d.column.index === 4 && d.cell.raw === 'REKOD')
            d.cell.styles.fillColor = [255, 245, 220]
        },
      })
      return pdf.lastAutoTable.finalY
    }

    // ── Helper: Section rekod dipecahkan
    function lukisRekod(startY) {
      if (rekodList.length === 0) return startY
      let y = startY + 7
      if (y > 242) { pdf.addPage(); y = 18 }
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(160, 0, 0)
      pdf.text('REKOD DIPECAHKAN', ML, y)
      pdf.setTextColor(0, 0, 0)
      pdf.setDrawColor(220, 180, 180); pdf.setLineWidth(0.3)
      pdf.line(ML, y + 2, W - MR, y + 2)
      y += 8
      rekodList.forEach((r, idx) => {
        const pLabel = PERINGKAT_LABEL[r.peringkat] || r.peringkat || '—'
        const lBg = r.peringkat === 'K' ? [255, 240, 200] : r.peringkat === 'N' ? [220, 235, 255] : [220, 245, 220]
        const lFg = r.peringkat === 'K' ? [140, 80, 0]   : r.peringkat === 'N' ? [0, 50, 150]    : [0, 100, 40]
        const body = [
          [{ content: `REKOD ${pLabel.toUpperCase()}`, styles: { fontStyle: 'bold', textColor: lFg, fillColor: lBg } },
           { content: r.namaAcara || '—', styles: { fontStyle: 'bold' } }],
          ['Rekod Baru', formatPrestasi(r.prestasiBaru, r.unit) + (r.tarikhBaru ? `  (${r.tarikhBaru})` : '')],
        ]
        if (r.prestasiLama != null) {
          body.push(['Rekod Lama', formatPrestasi(r.prestasiLama, r.unit) + (r.tahunLama ? `  (${r.tahunLama})` : '')])
          if (r.namaLama) body.push(['Pemegang Lama', r.namaLama + (r.lokasiLama ? `   ·   ${r.lokasiLama}` : '')])
          const sel = formatSelisih(r.prestasiBaru, r.prestasiLama, r.unit)
          if (sel) body.push(['Perbezaan', sel])
        } else {
          body.push(['Rekod Lama', 'Rekod pertama — tiada rekod sebelum ini'])
        }
        autoTable(pdf, {
          startY: y, body,
          styles: { fontSize: 8.5, cellPadding: 2.5 },
          columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold', fillColor: [250, 245, 245] }, 1: { cellWidth: 138 } },
          theme: 'plain', tableLineColor: [210, 180, 180], tableLineWidth: 0.35,
        })
        y = pdf.lastAutoTable.finalY + 4
        if (idx < rekodList.length - 1 && y > 255) { pdf.addPage(); y = 18 }
      })
      return y
    }

    // ── Helper: footer semua halaman
    function lukisFooters() {
      const total = pdf.getNumberOfPages()
      for (let pg = 1; pg <= total; pg++) {
        pdf.setPage(pg)
        pdf.setFontSize(7); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(150, 150, 150)
        pdf.text(`Dicetak: ${tarikhCetak}   |   ms. ${pg}/${total}`, W - MR, 287, { align: 'right' })
      }
    }

    // ══════════════════════════════════════════════════════
    // PAGE 1 — SKRIP PENGACARA (MC)
    // ══════════════════════════════════════════════════════
    let y = lukisHeader('SKRIP PENGACARA')
    y = lukisAtlet(y)
    y = lukisJadual(y, false)   // tanpa kolum rekod
    y = lukisRekod(y)           // rekod baru + lama

    // ══════════════════════════════════════════════════════
    // PAGE 2 — SLIP HADIAH
    // ══════════════════════════════════════════════════════
    pdf.addPage()
    y = lukisHeader('SLIP HADIAH')
    y = lukisAtlet(y)

    const medalsLong = [
      (atlet.pingat_emas    || 0) > 0 ? `Emas x${atlet.pingat_emas}`    : null,
      (atlet.pingat_perak   || 0) > 0 ? `Perak x${atlet.pingat_perak}`  : null,
      (atlet.pingat_gangsa  || 0) > 0 ? `Gangsa x${atlet.pingat_gangsa}`: null,
      (atlet.pingat_tempat4 || 0) > 0 ? `T.4 x${atlet.pingat_tempat4}`  : null,
    ].filter(Boolean)
    autoTable(pdf, {
      startY: y,
      body: [
        ['Pingat Olahragawan', medalsLong.length > 0 ? medalsLong.join('   ') : 'Tiada pingat'],
        ['Jumlah Mata', `${atlet.jumlahMata || 0} mata`],
      ],
      styles: { fontSize: 10, cellPadding: 4.5 },
      columnStyles: {
        0: { cellWidth: 55, fontStyle: 'bold', fillColor: [235, 242, 255] },
        1: { cellWidth: 121, fontStyle: 'bold', fontSize: 12 },
      },
      theme: 'plain', tableLineColor: [0, 51, 153], tableLineWidth: 0.4,
    })
    y = pdf.lastAutoTable.finalY + 22
    pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0, 0, 0)
    pdf.text('Tandatangan Penerima :', ML, y)
    pdf.setDrawColor(0); pdf.setLineWidth(0.3)
    pdf.line(ML + 50, y, ML + 140, y)
    y += 9
    pdf.text('Tandatangan Pegawai  :', ML, y)
    pdf.line(ML + 50, y, ML + 140, y)

    // ══════════════════════════════════════════════════════
    // PAGE 3 — REKOD PENCAPAIAN RASMI (FAIL)
    // ══════════════════════════════════════════════════════
    pdf.addPage()
    y = lukisHeader('REKOD PENCAPAIAN RASMI')
    y = lukisAtlet(y)
    y = lukisJadual(y, true)    // dengan kolum rekod
    y = lukisRekod(y)           // rekod baru + lama

    y += 8
    if (y > 265) { pdf.addPage(); y = 20 }
    pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(0, 0, 0)
    pdf.text('Disahkan oleh :', ML, y)
    pdf.setDrawColor(0); pdf.setLineWidth(0.3)
    pdf.line(ML + 35, y, ML + 110, y)
    pdf.text('Tarikh :', ML + 118, y)
    pdf.line(ML + 133, y, W - MR, y)

    lukisFooters()

    const safeName = (atlet.namaAtlet || 'Atlet').replace(/\s+/g, '_')
    pdf.save(`KadAtlet_${safeName}.pdf`)
  }

  const REKOD_COLOR = { K: 'bg-amber-400 text-white', N: 'bg-blue-500 text-white', D: 'bg-green-600 text-white' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3 py-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="bg-[#003399] px-5 py-4 flex items-start justify-between shrink-0">
          <div>
            <p className="text-white font-black text-sm leading-snug">{atlet.namaAtlet || '—'}</p>
            <p className="text-white/70 text-[10px] mt-0.5">{atlet.namaSekolah || atlet.kodSekolah}</p>
            <p className="text-white/60 text-[9px]">{katLabelFn(atlet.kategoriKod)} · {atlet.jantina === 'L' ? 'Lelaki' : 'Perempuan'}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors p-1 shrink-0 ml-3">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Medal summary */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-3 shrink-0">
          {[
            { v: atlet.pingat_emas,    cls: 'text-yellow-600', label: 'E' },
            { v: atlet.pingat_perak,   cls: 'text-gray-500',   label: 'P' },
            { v: atlet.pingat_gangsa,  cls: 'text-orange-500', label: 'G' },
            { v: atlet.pingat_tempat4, cls: 'text-slate-400',  label: 'T4' },
          ].map(m => (
            <span key={m.label} className={`text-xs font-black ${(m.v||0)>0 ? m.cls : 'text-gray-200'}`}>
              {m.label}×{m.v||0}
            </span>
          ))}
          <span className="ml-auto text-sm font-black text-[#003399]">{atlet.jumlahMata||0} mata</span>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 divide-y divide-gray-100">

          {/* Acara dimenangi */}
          {acaraList.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-3">Acara Dimenangi</p>
              <div className="space-y-2">
                {acaraList.map((a, i) => {
                  const s     = PINGAT_STYLE[a.pingat] || PINGAT_STYLE.tempat4
                  const rekod = rekodList.find(r => r.namaAcara === a.namaAcara)
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-0.5 px-2 py-1 rounded-full border text-[9px] font-bold shrink-0 ${s.bg}`}>
                        <span className={`w-3 h-3 rounded-full border flex items-center justify-center text-[7px] font-black ${s.coin}`}>{s.label}</span>
                        {s.short}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{a.namaAcara}</p>
                        <p className="text-[9px] text-gray-400 font-mono">{formatPrestasi(a.prestasi, a.unit)}</p>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {rekod && (
                          <span className={`text-[7px] font-black px-1.5 py-0.5 rounded border ${REKOD_COLOR[rekod.peringkat] || 'bg-red-100 text-red-700'}`}>
                            🏆 REKOD
                          </span>
                        )}
                        <span className="text-[9px] font-black text-[#003399]">+{a.mata||0}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Rekod dipecahkan */}
          {rekodList.map((r, i) => (
            <div key={i} className="px-5 py-4 bg-red-50/40">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-[8px] font-black px-2 py-0.5 rounded-full text-white ${
                  r.peringkat === 'K' ? 'bg-amber-500' : r.peringkat === 'N' ? 'bg-blue-600' : 'bg-green-600'
                }`}>
                  🏆 REKOD {PERINGKAT_LABEL[r.peringkat] || r.peringkat}
                </span>
                <p className="text-xs font-bold text-gray-800">{r.namaAcara}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[9px]">
                {/* Rekod Baru */}
                <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
                  <p className="text-[8px] font-bold text-green-500 uppercase mb-1">Rekod Baru</p>
                  <p className="font-black text-green-700 text-sm">{formatPrestasi(r.prestasiBaru, r.unit)}</p>
                  {r.tarikhBaru && <p className="text-green-600 mt-0.5">{r.tarikhBaru}</p>}
                  {r.prestasiLama != null && (
                    <p className="text-green-600 font-semibold mt-0.5">{formatSelisih(r.prestasiBaru, r.prestasiLama, r.unit)}</p>
                  )}
                </div>
                {/* Rekod Lama */}
                <div className="bg-gray-100 rounded-xl px-3 py-2.5">
                  <p className="text-[8px] font-bold text-gray-400 uppercase mb-1">Rekod Lama</p>
                  {r.prestasiLama != null ? (
                    <>
                      <p className="font-black text-gray-700 text-sm">{formatPrestasi(r.prestasiLama, r.unit)}</p>
                      {r.tahunLama   && <p className="text-gray-500 mt-0.5">Tahun: {r.tahunLama}</p>}
                      {r.namaLama    && <p className="text-gray-700 font-semibold">{r.namaLama}</p>}
                      {r.lokasiLama  && <p className="text-gray-500">{r.lokasiLama}</p>}
                      {r.catatanLama && <p className="text-gray-500 italic mt-0.5">{r.catatanLama}</p>}
                    </>
                  ) : r.catatanLama ? (
                    <p className="text-gray-600 text-[9px] italic">{r.catatanLama}</p>
                  ) : (
                    <p className="text-gray-400 italic text-[9px]">Rekod pertama</p>
                  )}
                </div>
              </div>
            </div>
          ))}

          {acaraList.length === 0 && rekodList.length === 0 && !rekodLoading && (
            <div className="px-5 py-8 text-center text-gray-400 text-xs">Tiada detail acara lagi.</div>
          )}
          {rekodLoading && (
            <div className="px-5 py-4 text-center text-xs text-gray-400">Semak rekod…</div>
          )}
        </div>

        {/* Footer — butang cetak */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-2 shrink-0">
          <button
            onClick={cetakKadAtlet}
            disabled={rekodLoading}
            className="flex-1 text-xs font-bold px-3 py-2 bg-[#003399] hover:bg-[#002277] text-white rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {rekodLoading ? 'Semak rekod…' : 'Cetak PDF'}
          </button>
          <button
            onClick={onClose}
            className="text-xs font-semibold px-3 py-2 bg-white text-gray-600 border border-gray-300 hover:bg-gray-100 rounded-lg transition-colors">
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AtletRow({ atlet, rank, isDipilih, onPilih, onDetail }) {
  const [expand,      setExpand]      = useState(false)
  const [rekodShown,  setRekodShown]  = useState(null)   // 'D' | 'N' | 'K' | null
  const [rekodCache,  setRekodCache]  = useState({})     // key → { loading, data }
  const acaraList = getAcaraDetail(atlet)
  const rekodList = getRekodDetail(atlet)

  async function toggleRekodPanel(e, peringkat) {
    e.stopPropagation()
    if (rekodShown === peringkat) { setRekodShown(null); return }
    setRekodShown(peringkat)
    // Fetch semua rekod untuk peringkat ini dari collection
    const items = rekodList.filter(r => r.peringkat === peringkat)
    for (const r of items) {
      const key = makeRekodKey(
        r.namaAcaraPendek || r.namaAcara, r.jantina || atlet.jantina,
        r.kategoriKod || atlet.kategoriKod, peringkat
      )
      if (rekodCache[key]) continue
      setRekodCache(prev => ({ ...prev, [key]: { loading: true, data: null } }))
      getDoc(doc(db, 'rekod', key))
        .then(snap => setRekodCache(prev => ({ ...prev, [key]: { loading: false, data: snap.exists() ? snap.data() : null } })))
        .catch(() => setRekodCache(prev => ({ ...prev, [key]: { loading: false, data: null } })))
    }
  }
  const isTop3    = rank <= 3
  const rankStyle = RANK_STYLE[rank] || ''

  const hasRekod   = rekodList.length > 0
  const rekodPeringkat = hasRekod
    ? [...new Set(rekodList.map(r => r.peringkat).filter(Boolean))].sort((a,b) => ['K','N','D'].indexOf(a) - ['K','N','D'].indexOf(b))
    : []
  const topPeringkat = rekodPeringkat[0] || null
  const REKOD_STRIPE = { K: 'border-l-amber-400', N: 'border-l-blue-500', D: 'border-l-green-500' }

  const rowBg = isDipilih
    ? 'bg-amber-50 border-l-4 border-l-yellow-400'
    : hasRekod
      ? `bg-red-50/30 border-l-4 ${REKOD_STRIPE[topPeringkat] || 'border-l-red-400'}`
      : isTop3
        ? rank === 1 ? 'bg-yellow-50 hover:bg-yellow-100'
        : rank === 2 ? 'bg-gray-50 hover:bg-gray-100'
        :              'bg-orange-50 hover:bg-orange-100'
      : 'hover:bg-slate-50'

  return (
    <>
      <tr
        className={`border-b border-gray-100 transition-colors ${rowBg} ${expand ? 'border-b-0' : ''} ${acaraList.length > 0 ? 'cursor-pointer' : ''}`}
        onClick={() => acaraList.length > 0 && setExpand(v => !v)}
      >
        {/* Rank */}
        <td className="px-2 py-2 text-center w-8">
          {isDipilih ? (
            <span className="text-yellow-500 font-black text-sm">★</span>
          ) : isTop3 ? (
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full border-2 text-[9px] font-black ${rankStyle}`}>{rank}</span>
          ) : (
            <span className="text-[10px] text-gray-400 font-bold">{rank}</span>
          )}
        </td>

        {/* Nama + Sekolah — klik untuk modal detail */}
        <td className="px-2 py-2 max-w-[110px]" onClick={e => { e.stopPropagation(); onDetail && onDetail(atlet) }}>
          <div className="flex items-center gap-1 flex-wrap">
            <p className={`font-semibold text-xs leading-snug truncate cursor-pointer hover:text-[#003399] hover:underline ${isTop3 || isDipilih ? 'text-gray-900' : 'text-gray-700'}`}>
              {atlet.namaAtlet || '—'}
            </p>
            {hasRekod && (
              <span className={`shrink-0 text-[7px] font-black px-1 py-0.5 rounded text-white leading-tight ${
                topPeringkat === 'K' ? 'bg-amber-400' :
                topPeringkat === 'N' ? 'bg-blue-500' : 'bg-green-600'
              }`}>
                🏆R{topPeringkat}
              </span>
            )}
          </div>
          <p className="text-[9px] text-gray-400 truncate">{atlet.namaSekolah || atlet.kodSekolah || '—'}</p>
        </td>

        {/* Emas */}
        <td className="px-1 py-2 text-center">
          <span className={`text-xs font-black ${(atlet.pingat_emas || 0) > 0 ? 'text-yellow-500' : 'text-gray-200'}`}>
            {atlet.pingat_emas || 0}
          </span>
        </td>
        {/* Perak */}
        <td className="px-1 py-2 text-center">
          <span className={`text-xs font-black ${(atlet.pingat_perak || 0) > 0 ? 'text-gray-400' : 'text-gray-200'}`}>
            {atlet.pingat_perak || 0}
          </span>
        </td>
        {/* Gangsa */}
        <td className="px-1 py-2 text-center">
          <span className={`text-xs font-black ${(atlet.pingat_gangsa || 0) > 0 ? 'text-orange-400' : 'text-gray-200'}`}>
            {atlet.pingat_gangsa || 0}
          </span>
        </td>
        {/* T4 */}
        <td className="px-1 py-2 text-center">
          <span className={`text-xs font-black ${(atlet.pingat_tempat4 || 0) > 0 ? 'text-slate-400' : 'text-gray-200'}`}>
            {atlet.pingat_tempat4 || 0}
          </span>
        </td>

        {/* Mata */}
        <td className="px-2 py-2 text-center">
          <span className={`text-sm font-black ${isTop3 || isDipilih ? 'text-[#003399]' : 'text-gray-600'}`}>
            {atlet.jumlahMata || 0}
          </span>
        </td>

        {/* Rekod badge — klik untuk popup inline */}
        <td className="px-1 py-2 text-center" onClick={e => e.stopPropagation()}>
          {rekodList.length > 0 && (() => {
            const REKOD_COLOR = {
              K: 'bg-amber-400 text-white border-amber-500 hover:bg-amber-500',
              N: 'bg-blue-500 text-white border-blue-600 hover:bg-blue-600',
              D: 'bg-green-500 text-white border-green-600 hover:bg-green-600',
            }
            const peringkats = [...new Set(rekodList.map(r => r.peringkat).filter(Boolean))]
              .sort((a, b) => ['K','N','D'].indexOf(a) - ['K','N','D'].indexOf(b))
            return (
              <div className="flex flex-col gap-0.5 items-center">
                {peringkats.map(p => (
                  <button key={p}
                    onClick={e => toggleRekodPanel(e, p)}
                    title={`Lihat Rekod ${REKOD_PERINGKAT_META[p]?.label || p}`}
                    className={`text-[7px] font-black px-1 py-0.5 rounded border leading-tight transition-colors cursor-pointer ${
                      rekodShown === p
                        ? 'ring-2 ring-offset-1 ring-white ' + (REKOD_COLOR[p] || 'bg-red-400 text-white border-red-500')
                        : REKOD_COLOR[p] || 'bg-red-100 text-red-700 border-red-300'
                    }`}>
                    R{p}
                  </button>
                ))}
              </div>
            )
          })()}
        </td>

        {/* Pilih button */}
        <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onPilih(atlet)}
            className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-colors ${
              isDipilih
                ? 'bg-yellow-400 text-white border-yellow-500 hover:bg-yellow-500'
                : 'bg-white text-[#003399] border-[#003399] hover:bg-blue-50'
            }`}
          >
            {isDipilih ? '★ Dipilih' : 'Pilih'}
          </button>
        </td>

        {/* Expand toggle */}
        <td className="px-1 py-2 text-center text-gray-300 text-[10px] w-5">
          {acaraList.length > 0 ? (expand ? '▲' : '▼') : null}
        </td>
      </tr>

      {/* ── Expand Panel ── */}
      {expand && (
        <tr className={`border-b border-gray-200 ${
          isDipilih ? 'bg-amber-50' : rank === 1 ? 'bg-yellow-50' : rank === 2 ? 'bg-gray-50' : rank === 3 ? 'bg-orange-50' : 'bg-slate-50'
        }`}>
          <td colSpan={10} className="px-5 pb-4 pt-1.5 space-y-3">

            {/* Senarai Acara */}
            <div>
              <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Acara Dimenangi</p>
              <div className="overflow-x-auto">
                <table className="text-[10px] w-full">
                  <thead>
                    <tr className="text-[8px] text-gray-400 border-b border-gray-200">
                      <th className="text-left pb-1 font-semibold">Acara</th>
                      <th className="text-center pb-1 font-semibold w-20">Pingat</th>
                      <th className="text-center pb-1 font-semibold w-20">Prestasi</th>
                      <th className="text-center pb-1 font-semibold w-10">+Mata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acaraList.map((a, i) => {
                      const s = PINGAT_STYLE[a.pingat] || PINGAT_STYLE.tempat4
                      return (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="py-1 font-semibold text-gray-700">{a.namaAcara || a.aceraId}</td>
                          <td className="py-1 text-center">
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${s.bg}`}>
                              <span className={`w-3 h-3 rounded-full border flex items-center justify-center text-[7px] font-black ${s.coin}`}>{s.label}</span>
                              {s.short}
                            </span>
                          </td>
                          <td className="py-1 text-center font-mono text-gray-700">{formatPrestasi(a.prestasi, a.unit)}</td>
                          <td className="py-1 text-center font-black text-[#003399]">+{a.mata || 0}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Rekod Dipecahkan */}
            {rekodList.length > 0 && (
              <div>
                <p className="text-[8px] font-bold text-red-500 uppercase tracking-widest mb-1.5">Rekod Dipecahkan</p>
                <div className="space-y-2">
                  {rekodList.map((r, i) => (
                    <div key={i} className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full text-white ${
                          r.peringkat === 'K' ? 'bg-amber-500' :
                          r.peringkat === 'N' ? 'bg-blue-600' :
                          'bg-green-600'
                        }`}>
                          R{r.peringkat} — {PERINGKAT_LABEL[r.peringkat] || r.peringkat}
                        </span>
                        <span className="text-[10px] font-bold text-gray-800">{r.namaAcara}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[9px]">
                        {/* Rekod Lama */}
                        <div className="bg-gray-100 rounded-lg px-2.5 py-2">
                          <p className="text-[8px] font-bold text-gray-400 uppercase mb-1">Rekod Lama</p>
                          <p className="font-black text-gray-700 text-xs">{formatPrestasi(r.prestasiLama, r.unit)}</p>
                          {r.tahunLama  && <p className="text-gray-500 mt-0.5">Tahun: {r.tahunLama}</p>}
                          {r.namaLama   && <p className="text-gray-600 font-semibold">{r.namaLama}</p>}
                          {r.lokasiLama && <p className="text-gray-400">{r.lokasiLama}</p>}
                        </div>
                        {/* Rekod Baru */}
                        <div className="bg-green-50 border border-green-200 rounded-lg px-2.5 py-2">
                          <p className="text-[8px] font-bold text-green-500 uppercase mb-1">Rekod Baru</p>
                          <p className="font-black text-green-700 text-xs">{formatPrestasi(r.prestasiBaru, r.unit)}</p>
                          {r.tarikhBaru && <p className="text-green-600 mt-0.5">{r.tarikhBaru}</p>}
                          {r.prestasiLama != null && r.prestasiBaru != null && (
                            <p className="text-green-600 font-semibold mt-0.5">
                              {formatSelisih(r.prestasiBaru, r.prestasiLama, r.unit)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </td>
        </tr>
      )}

      {/* ── Rekod Popup Row — muncul bila badge RD/RN/RK diklik ── */}
      {rekodShown && (() => {
        const pc = REKOD_PERINGKAT_META[rekodShown] || { label: rekodShown, bg: 'bg-gray-50 border-gray-200', badge: 'bg-gray-500', text: 'text-gray-700' }
        const items = rekodList.filter(r => r.peringkat === rekodShown)
        return (
          <tr className="border-b border-gray-100">
            <td colSpan={10} className="px-4 py-2.5">
              <div className={`border rounded-xl p-3 ${pc.bg}`}>
                {/* Header */}
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={`text-[8px] font-black px-2.5 py-1 rounded-full text-white ${pc.badge}`}>
                    🏆 REKOD {pc.label.toUpperCase()}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); setRekodShown(null) }}
                    className="ml-auto text-gray-400 hover:text-gray-700 text-xs font-bold px-1">
                    ✕
                  </button>
                </div>

                {/* Senarai rekod dipecah untuk peringkat ini */}
                <div className="space-y-3">
                  {items.map((r, i) => {
                    const key = makeRekodKey(
                      r.namaAcara, r.jantina || atlet.jantina,
                      r.kategoriKod || atlet.kategoriKod, rekodShown
                    )
                    const cached    = rekodCache[key]
                    const isLoading = cached?.loading
                    const rekodDoc  = cached?.data
                    const isBrokenNow = rekodDoc?.kejohananId && rekodDoc.kejohananId === atlet.kejohananId

                    return (
                      <div key={i}>
                        <p className={`text-[9px] font-bold mb-1.5 ${pc.text}`}>{r.namaAcara}</p>
                        {isLoading || !cached ? (
                          <p className="text-[9px] text-gray-400 italic">Memuatkan...</p>
                        ) : !rekodDoc ? (
                          <p className="text-[9px] text-gray-400 italic">Tiada rekod dalam sistem untuk acara ini.</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {/* Rekod Baru (kalau dipecah dalam kejohanan ini) */}
                            {isBrokenNow ? (
                              <div className="bg-green-50 border border-green-200 rounded-lg px-2.5 py-2">
                                <p className="text-[7px] font-bold text-green-500 uppercase tracking-wide mb-1">Rekod Baru</p>
                                <p className="font-black text-green-700 text-sm font-mono">
                                  {formatPrestasi(rekodDoc.prestasi, rekodDoc.unit)}
                                </p>
                                <p className="text-green-600 text-[9px] mt-0.5 font-semibold">{rekodDoc.namaAtlet || '—'}</p>
                                <p className="text-green-500 text-[9px]">{rekodDoc.namaSekolah || ''}</p>
                                {rekodDoc.tarikhRekod && <p className="text-green-400 text-[9px]">{rekodDoc.tarikhRekod}</p>}
                                {rekodDoc.prestasiLama != null && (
                                  <p className="text-green-600 text-[8px] font-semibold mt-1">
                                    {formatSelisih(rekodDoc.prestasi, rekodDoc.prestasiLama, rekodDoc.unit)}
                                  </p>
                                )}
                              </div>
                            ) : null}

                            {/* Rekod Lama / Rekod Semasa */}
                            <div className={`${isBrokenNow ? '' : 'col-span-2'} bg-white/70 border border-gray-200 rounded-lg px-2.5 py-2`}>
                              <p className="text-[7px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                                {isBrokenNow ? 'Rekod Lama' : 'Rekod Semasa (Rujukan)'}
                              </p>
                              {isBrokenNow ? (
                                rekodDoc.prestasiLama != null ? (
                                  <>
                                    <p className="font-black text-gray-700 text-sm font-mono">
                                      {formatPrestasi(rekodDoc.prestasiLama, rekodDoc.unit)}
                                    </p>
                                    {rekodDoc.namaLama   && <p className="text-gray-600 text-[9px] mt-0.5 font-semibold">{rekodDoc.namaLama}</p>}
                                    {rekodDoc.lokasiLama && <p className="text-gray-400 text-[9px]">{rekodDoc.lokasiLama}</p>}
                                    {rekodDoc.tahunLama  && <p className="text-gray-400 text-[9px]">Tahun: {rekodDoc.tahunLama}</p>}
                                  </>
                                ) : (
                                  <p className="text-gray-400 text-[9px] italic">Rekod pertama ditetapkan</p>
                                )
                              ) : (
                                <>
                                  <p className="font-black text-gray-700 text-sm font-mono">
                                    {formatPrestasi(rekodDoc.prestasi, rekodDoc.unit)}
                                  </p>
                                  <p className="text-gray-600 text-[9px] mt-0.5 font-semibold">{rekodDoc.namaAtlet || '—'}</p>
                                  <p className="text-gray-400 text-[9px]">
                                    {rekodDoc.namaSekolah || rekodDoc.namaDaerah || rekodDoc.namaNegeri || ''}
                                    {rekodDoc.tarikhRekod ? '  ·  ' + rekodDoc.tarikhRekod.slice(0, 4) : ''}
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </td>
          </tr>
        )
      })()}
    </>
  )
}

// ─── Ranking Table per Jantina ────────────────────────────────────────────────

function RankingTable({ data, jantina, pilihanNoKP, onPilih, onDetail }) {
  const filtered = data.filter(a => a.jantina === jantina && (a.jumlahMata || 0) > 0)
  const ranked   = rankWithTies([...filtered].sort(sortOlahragawan))
  const isL      = jantina === 'L'
  const title    = isL ? 'Olahragawan' : 'Olahragawati'
  const headerCls = isL
    ? 'bg-blue-700 text-white'
    : 'bg-pink-600 text-white'

  return (
    <div className="flex-1 min-w-0 border border-gray-200 rounded-xl overflow-hidden">
      <div className={`px-4 py-2.5 flex items-center justify-between ${headerCls}`}>
        <span className="text-xs font-bold">{isL ? '♂' : '♀'} {title}</span>
        <span className="text-[9px] font-semibold opacity-80">{ranked.length} atlet</span>
      </div>

      {ranked.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-xs">Tiada data lagi.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-[8px] font-bold text-gray-400 uppercase tracking-wide">
                <th className="px-2 py-2 text-center w-8">Kd</th>
                <th className="px-2 py-2 text-left">Nama / Sekolah</th>
                <th className="px-1 py-2 text-center text-yellow-600" title="Emas">E</th>
                <th className="px-1 py-2 text-center text-gray-400"  title="Perak">P</th>
                <th className="px-1 py-2 text-center text-orange-400" title="Gangsa">G</th>
                <th className="px-1 py-2 text-center"                title="Tempat 4">4</th>
                <th className="px-1 py-2 text-center text-[#003399]">Mata</th>
                <th className="px-1 py-2 text-center text-red-400"   title="Rekod Pecah (RD=Daerah, RN=Negeri, RK=Kebangsaan)">Rkd</th>
                <th className="px-2 py-2 text-center">Pilih</th>
                <th className="w-5"></th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(atlet => (
                <AtletRow
                  key={atlet.id}
                  atlet={atlet}
                  rank={atlet.rank}
                  isDipilih={atlet.noKP === pilihanNoKP}
                  onPilih={atlet => onPilih(atlet, jantina)}
                  onDetail={onDetail}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Murid Terbaik Card ───────────────────────────────────────────────────────

function MuridTerbaikCard({ jantina, pilihan, liveData, onTukar }) {
  const isL    = jantina === 'L'
  const title  = isL ? 'Olahragawan' : 'Olahragawati'
  const color  = isL ? 'border-blue-200 bg-blue-50' : 'border-pink-200 bg-pink-50'
  const txtClr = isL ? 'text-blue-700' : 'text-pink-700'

  if (!pilihan) {
    return (
      <div className={`border-2 border-dashed rounded-xl px-4 py-3 flex-1 min-w-0 ${color}`}>
        <p className={`text-[9px] font-bold uppercase tracking-wide mb-1 ${txtClr}`}>{isL ? '♂' : '♀'} {title}</p>
        <p className="text-xs text-gray-400 italic">Belum dipilih</p>
        <p className="text-[9px] text-gray-400 mt-0.5">Klik [Pilih] dalam senarai ranking</p>
      </div>
    )
  }

  // Ambil mata TERKINI dari onSnapshot (liveData) bukan dari snapshot pilihan
  const live = liveData || {}
  const emas   = live.pingat_emas   || 0
  const perak  = live.pingat_perak  || 0
  const gangsa = live.pingat_gangsa || 0
  const mata   = live.jumlahMata    || 0

  return (
    <div className={`border-2 rounded-xl px-4 py-3 flex-1 min-w-0 ${color}`}>
      <div className="flex items-start justify-between mb-1">
        <p className={`text-[9px] font-bold uppercase tracking-wide ${txtClr}`}>★ {isL ? '♂' : '♀'} {title}</p>
        <button onClick={onTukar} className="text-[8px] text-gray-400 hover:text-red-500 underline">
          Nyah Pilih
        </button>
      </div>
      <p className="text-sm font-black text-gray-800 leading-snug">{pilihan.namaAtlet}</p>
      <p className="text-[10px] text-gray-500 mb-1.5">{pilihan.namaSekolah || pilihan.kodSekolah}</p>
      <div className="flex gap-2 text-[9px]">
        {emas   > 0 && <span className="text-yellow-600 font-bold">E×{emas}</span>}
        {perak  > 0 && <span className="text-gray-500 font-bold">P×{perak}</span>}
        {gangsa > 0 && <span className="text-orange-500 font-bold">G×{gangsa}</span>}
        <span className="font-black text-[#003399] ml-1">{mata} mata</span>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Olahragawan() {
  const { userData }  = useAuth()
  const [selKej, setSelKej]             = useState('')
  const [namaKej, setNamaKej]           = useState('')
  const [allData, setAllData]           = useState([])
  const [pilihan, setPilihan]           = useState({}) // key: `${kat}_${jantina}` → rec
  const [loading, setLoading]           = useState(false)
  const [selKat, setSelKat]             = useState('')
  const [lastUpdate, setLastUpdate]     = useState(null)
  const [savingPilihan, setSavingPilihan] = useState(false)
  const [kategoriList, setKategoriList] = useState([]) // dari Firestore
  const unsubRef = useRef(null)

  const [anugerahCustom,   setAnugerahCustom]   = useState([])   // list custom anugerah defs
  const [formAnugerah,     setFormAnugerah]     = useState(null) // null=hidden, ''=new
  const [savingAnugerah,   setSavingAnugerah]   = useState(false)
  const [modalAtlet,       setModalAtlet]       = useState(null) // atlet doc untuk modal
  const [searchAtlet,      setSearchAtlet]      = useState('')   // search in terbaik/custom tabs

  // ── Kategori dari Firestore ──────────────────────────────────────────────
  useEffect(() => {
    getDocs(query(collection(db, 'kategori'), orderBy('urutan')))
      .then(snap => setKategoriList(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  // Helpers dinamik (fallback ke hardcode jika Firestore belum loaded)
  function katLabel(kod) {
    const info = kategoriList.find(k => k.kod === kod)
    if (info) return `Kat ${kod} — Bwh ${info.umurHad}`
    return KAT_LABEL_FALLBACK[kod] || `Kat ${kod}`
  }
  // Urutan kategori — dari Firestore (ikut urutan), fallback ke A-E-PPKI
  const katOrder = kategoriList.length > 0
    ? kategoriList.map(k => k.kod)
    : ['A', 'B', 'C', 'D', 'E', 'PPKI']

  // ── Kejohanan aktif ──────────────────────────────────────────────────────
  useEffect(() => {
    getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif')))
      .then(snap => {
        if (!snap.empty) {
          const d = snap.docs[0]
          setSelKej(d.data().kejohananId || d.id)
          setNamaKej(d.data().namaKejohanan || '')
        }
      }).catch(() => {})
  }, [])

  // ── Real-time mata_olahragawan ───────────────────────────────────────────
  useEffect(() => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    if (!selKej) { setAllData([]); return }
    setLoading(true)
    unsubRef.current = onSnapshot(
      query(collection(db, 'mata_olahragawan'), where('kejohananId', '==', selKej)),
      snap => {
        setAllData(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLastUpdate(new Date())
        setLoading(false)
      },
      () => setLoading(false)
    )
    return () => { if (unsubRef.current) unsubRef.current() }
  }, [selKej])

  // ── Load pilihan admin ───────────────────────────────────────────────────
  useEffect(() => {
    if (!selKej) { setPilihan({}); return }
    getDocs(query(collection(db, 'pilihan_olahragawan'), where('kejohananId', '==', selKej)))
      .then(snap => {
        const map = {}
        snap.docs.forEach(d => {
          const r = d.data()
          const key = r.pilihanKey || `${r.kategoriKod}_${r.jantina}`
          map[key] = r
        })
        setPilihan(map)
      }).catch(() => {})
  }, [selKej])

  // ── Load anugerah custom ─────────────────────────────────────────────────
  useEffect(() => {
    if (!selKej) { setAnugerahCustom([]); return }
    getDocs(query(collection(db, 'anugerah_custom'), where('kejohananId', '==', selKej), orderBy('cipta')))
      .then(snap => setAnugerahCustom(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [selKej])

  // ── Kat yang ada data ────────────────────────────────────────────────────
  // Ikut urutan dari Firestore; termasuk kat yang ada data walaupun tiada dalam kategoriList
  const katDariData = [...new Set(allData.filter(a => (a.jumlahMata || 0) > 0).map(a => a.kategoriKod).filter(Boolean))]
  const katAda = [
    ...katOrder.filter(k => katDariData.includes(k)),
    ...katDariData.filter(k => !katOrder.includes(k)),
  ]
  const customTabKeys = anugerahCustom.map(a => `CUSTOM_${a.id}`)
  const allTabKeys    = [...katAda, 'TERBAIK_KEJ', ...customTabKeys]
  const activeTab     = selKat && allTabKeys.includes(selKat) ? selKat : (katAda[0] || '')
  // keep activeKat for backward compat
  const activeKat     = katAda.includes(activeTab) ? activeTab : ''

  // ── Pilih Murid Terbaik ──────────────────────────────────────────────────
  async function handlePilihByKey(atlet, pilihanKey) {
    if (!selKej || savingPilihan) return
    const docId  = `${selKej}_${pilihanKey}`
    const ref    = doc(db, 'pilihan_olahragawan', docId)
    const isSame = pilihan[pilihanKey]?.noKP === atlet.noKP
    setSavingPilihan(true)
    try {
      if (isSame) {
        await deleteDoc(ref)
        setPilihan(p => { const n = { ...p }; delete n[pilihanKey]; return n })
      } else {
        const payload = {
          kejohananId: selKej,
          pilihanKey,
          noKP:        atlet.noKP,
          namaAtlet:   atlet.namaAtlet   || '',
          kodSekolah:  atlet.kodSekolah  || '',
          namaSekolah: atlet.namaSekolah || atlet.kodSekolah || '',
          kategoriKod: atlet.kategoriKod || '',
          jantina:     atlet.jantina     || '',
          dipilihOleh: userData?.uid || '',
          dipilihPada: serverTimestamp(),
        }
        await setDoc(ref, payload)
        setPilihan(p => ({ ...p, [pilihanKey]: payload }))
      }
    } catch (e) { alert('Gagal simpan: ' + e.message) }
    finally { setSavingPilihan(false) }
  }

  async function handlePilih(atlet, jantina) {
    return handlePilihByKey(atlet, `${atlet.kategoriKod}_${jantina}`)
  }

  // ── Tambah / Padam Anugerah Custom ──────────────────────────────────────
  async function handleTambahAnugerah(nama) {
    if (!nama.trim() || !selKej) return
    setSavingAnugerah(true)
    try {
      const id  = `${selKej}_${Date.now()}`
      const ref = doc(db, 'anugerah_custom', id)
      const payload = { id, kejohananId: selKej, nama: nama.trim(), cipta: serverTimestamp() }
      await setDoc(ref, payload)
      setAnugerahCustom(prev => [...prev, payload])
      setFormAnugerah(null)
      setSelKat(`CUSTOM_${id}`)
    } catch (e) { alert('Gagal simpan: ' + e.message) }
    finally { setSavingAnugerah(false) }
  }

  async function handlePadamAnugerah(anugerah) {
    if (!confirm(`Padam anugerah "${anugerah.nama}"? Pilihan winner turut dipadam.`)) return
    try {
      await deleteDoc(doc(db, 'anugerah_custom', anugerah.id))
      await deleteDoc(doc(db, 'pilihan_olahragawan', `${selKej}_CUSTOM_${anugerah.id}`))
      setAnugerahCustom(prev => prev.filter(a => a.id !== anugerah.id))
      setPilihan(p => { const n = { ...p }; delete n[`CUSTOM_${anugerah.id}`]; return n })
      if (activeTab === `CUSTOM_${anugerah.id}`) setSelKat(katAda[0] || '')
    } catch (e) { alert('Gagal padam: ' + e.message) }
  }

  // ── Cetak PDF ────────────────────────────────────────────────────────────
  async function cetakPDF(jenis, katFilter) {
    const { jsPDF }         = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W   = 210

    // ── Header global
    pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
    pdf.text('SENARAI MURID TERBAIK KEJOHANAN', W / 2, 15, { align: 'center' })
    pdf.setFontSize(9);  pdf.setFont('helvetica', 'normal')
    pdf.text(namaKej || 'Kejohanan Olahraga', W / 2, 21, { align: 'center' })
    pdf.setDrawColor(0, 51, 153); pdf.setLineWidth(0.5)
    pdf.line(12, 24, W - 12, 24)

    const katsList = jenis === 'satu' && katFilter ? [katFilter] : katAda

    if (jenis === 'terbaik') {
      // ── PDF A: Murid Terbaik sahaja — 1 halaman
      const rows = katsList.map(kat => {
        const pL = pilihan[`${kat}_L`]
        const pP = pilihan[`${kat}_P`]
        const fmt = p => p
          ? `${p.namaAtlet}\n${p.namaSekolah || p.kodSekolah}\nMata: ${p.jumlahMata} (E${p.pingat_emas||0} P${p.pingat_perak||0} G${p.pingat_gangsa||0})`
          : 'Belum dipilih'
        return [katLabel(kat), fmt(pL), fmt(pP)]
      })
      autoTable(pdf, {
        startY: 30,
        head: [['Kategori', 'Olahragawan (Lelaki)', 'Olahragawati (Perempuan)']],
        body: rows,
        styles: { fontSize: 9, cellPadding: 4, valign: 'top' },
        headStyles: { fillColor: [0, 51, 153], fontSize: 8, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 74 }, 2: { cellWidth: 74 } },
        theme: 'grid',
      })

    } else {
      // ── PDF B/C: Ranking full per kat
      katsList.forEach((kat, ki) => {
        if (ki > 0) pdf.addPage()
        let y = 30
        const katLabelStr = katLabel(kat)

        pdf.setFontSize(11); pdf.setFont('helvetica', 'bold')
        pdf.text(katLabelStr.toUpperCase(), 12, y); y += 8

        ;['L', 'P'].forEach(j => {
          const title  = j === 'L' ? 'OLAHRAGAWAN' : 'OLAHRAGAWATI'
          const pil    = pilihan[`${kat}_${j}`]
          const ranked = rankWithTies(
            allData
              .filter(a => a.kategoriKod === kat && a.jantina === j && (a.jumlahMata || 0) > 0)
              .sort(sortOlahragawan)
          )

          pdf.setFontSize(9); pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(j === 'L' ? 0 : 190, 0, j === 'L' ? 153 : 80)
          pdf.text(title, 12, y)
          pdf.setTextColor(0, 0, 0)
          if (pil) {
            pdf.setFontSize(8); pdf.setFont('helvetica', 'italic')
            pdf.text(`★ Murid Terbaik: ${pil.namaAtlet} (${pil.namaSekolah || pil.kodSekolah})`, 55, y)
          }
          y += 5

          const rows = ranked.map(a => {
            const rekodList  = getRekodDetail(a)
            const rekodStr   = rekodList.length > 0
              ? rekodList.map(r =>
                  `${r.namaAcara} [${PERINGKAT_LABEL[r.peringkat] || r.peringkat}]: ${formatPrestasi(r.prestasiBaru, r.unit)} (lama: ${formatPrestasi(r.prestasiLama, r.unit)}, ${r.tahunLama || '—'}, ${r.namaLama || '—'})`
                ).join('\n')
              : '—'
            return [
              a.rank,
              `${a.namaAtlet || '—'}\n${a.namaSekolah || a.kodSekolah || '—'}`,
              a.pingat_emas   || 0,
              a.pingat_perak  || 0,
              a.pingat_gangsa || 0,
              a.pingat_tempat4|| 0,
              a.jumlahMata    || 0,
              rekodStr,
            ]
          })

          autoTable(pdf, {
            startY: y,
            head: [['#', 'Nama / Sekolah', 'E', 'P', 'G', 'T4', 'Mata', 'Rekod Dipecahkan']],
            body: rows,
            styles: { fontSize: 7.5, cellPadding: 2, valign: 'top' },
            headStyles: { fillColor: [60, 60, 60], fontSize: 7, fontStyle: 'bold' },
            columnStyles: {
              0: { cellWidth: 8,  halign: 'center' },
              1: { cellWidth: 55 },
              2: { cellWidth: 8,  halign: 'center' },
              3: { cellWidth: 8,  halign: 'center' },
              4: { cellWidth: 8,  halign: 'center' },
              5: { cellWidth: 8,  halign: 'center' },
              6: { cellWidth: 10, halign: 'center' },
              7: { cellWidth: 'auto' },
            },
            theme: 'striped',
          })
          y = pdf.lastAutoTable.finalY + 6
        })
      })
    }

    const fname = jenis === 'terbaik'
      ? 'MuridTerbaik'
      : jenis === 'satu' && katFilter ? `Kat${katFilter}_Ranking`
      : 'SemuaKat_Ranking'
    pdf.save(`Olahragawan_${fname}_${namaKej || 'KOAM'}.pdf`)
  }

  async function cetakTerbaikKategori() {
    const { jsPDF }             = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210

    pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
    pdf.text('ATLET TERBAIK KATEGORI', W / 2, 15, { align: 'center' })
    pdf.setFontSize(9); pdf.setFont('helvetica', 'normal')
    pdf.text(namaKej || 'Kejohanan Olahraga', W / 2, 21, { align: 'center' })
    pdf.setDrawColor(0, 51, 153); pdf.setLineWidth(0.5)
    pdf.line(12, 24, W - 12, 24)

    const rows = katAda.map(kat => {
      const pL   = pilihan[`${kat}_L`]
      const pP   = pilihan[`${kat}_P`]
      const live = n => allData.find(a => a.noKP === n?.noKP)
      const fmt  = p => {
        if (!p) return 'Belum dipilih'
        const d = live(p) || p
        return `${p.namaAtlet}\n${p.namaSekolah || p.kodSekolah}\nE×${d.pingat_emas||0}  P×${d.pingat_perak||0}  G×${d.pingat_gangsa||0}  ·  ${d.jumlahMata||0} mata`
      }
      return [katLabel(kat), fmt(pL), fmt(pP)]
    })

    autoTable(pdf, {
      startY: 30,
      head: [['Kategori', '♂ Olahragawan (Lelaki)', '♀ Olahragawati (Perempuan)']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 4, valign: 'top' },
      headStyles: { fillColor: [0, 51, 153], fontSize: 8, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 76 }, 2: { cellWidth: 76 } },
      theme: 'grid',
    })

    pdf.save(`AtletTerbaikKategori_${namaKej || 'KOAM'}.pdf`)
  }

  async function cetakTerbaikKejohanan() {
    const { jsPDF }             = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210

    pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
    pdf.text('ATLET TERBAIK KEJOHANAN', W / 2, 15, { align: 'center' })
    pdf.setFontSize(9); pdf.setFont('helvetica', 'normal')
    pdf.text(namaKej || 'Kejohanan Olahraga', W / 2, 21, { align: 'center' })
    pdf.setDrawColor(0, 51, 153); pdf.setLineWidth(0.5)
    pdf.line(12, 24, W - 12, 24)

    let y = 32
    ;['L', 'P'].forEach((j, ji) => {
      const title = j === 'L' ? 'OLAHRAGAWAN TERBAIK KEJOHANAN' : 'OLAHRAGAWATI TERBAIK KEJOHANAN'
      const pil   = pilihan[`TERBAIK_KEJ_${j}`]
      const live  = pil ? (allData.find(a => a.noKP === pil.noKP) || pil) : null
      const x     = ji === 0 ? 12 : W / 2 + 3
      const bW    = W / 2 - 15

      // Box border
      pdf.setDrawColor(j === 'L' ? 0 : 180, 0, j === 'L' ? 153 : 90)
      pdf.setLineWidth(0.8)
      pdf.rect(x, y, bW, 60)

      // Header
      pdf.setFillColor(j === 'L' ? 0 : 180, 0, j === 'L' ? 153 : 90)
      pdf.rect(x, y, bW, 10, 'F')
      pdf.setTextColor(255, 255, 255)
      pdf.setFontSize(8); pdf.setFont('helvetica', 'bold')
      pdf.text(title, x + bW / 2, y + 6.5, { align: 'center' })
      pdf.setTextColor(0, 0, 0)

      if (live) {
        pdf.setFontSize(12); pdf.setFont('helvetica', 'bold')
        pdf.text(live.namaAtlet || pil.namaAtlet || '—', x + bW / 2, y + 22, { align: 'center' })
        pdf.setFontSize(9); pdf.setFont('helvetica', 'normal')
        pdf.text(live.namaSekolah || pil.namaSekolah || '—', x + bW / 2, y + 29, { align: 'center' })
        pdf.setFontSize(8)
        const kat = live.kategoriKod ? `Kategori: ${katLabel(live.kategoriKod)}` : ''
        if (kat) pdf.text(kat, x + bW / 2, y + 35, { align: 'center' })
        pdf.setFontSize(10); pdf.setFont('helvetica', 'bold')
        const medalStr = `🥇 ${live.pingat_emas||0}   🥈 ${live.pingat_perak||0}   🥉 ${live.pingat_gangsa||0}`
        pdf.text(medalStr, x + bW / 2, y + 44, { align: 'center' })
        pdf.setFontSize(13)
        pdf.text(`${live.jumlahMata || 0} mata`, x + bW / 2, y + 54, { align: 'center' })
      } else {
        pdf.setFontSize(9); pdf.setFont('helvetica', 'italic')
        pdf.setTextColor(150, 150, 150)
        pdf.text('Belum dipilih', x + bW / 2, y + 35, { align: 'center' })
        pdf.setTextColor(0, 0, 0)
      }
    })

    pdf.save(`AtletTerbaikKejohanan_${namaKej || 'KOAM'}.pdf`)
  }

  // ── Cetak Best Atlet per Kategori — format paparan umum (satu halaman per kat) ──
  async function cetakBestAtletUmum() {
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210, H = 297, M = 12

    let isFirst = true

    katAda.forEach(kat => {
      if (!isFirst) pdf.addPage()
      isFirst = false

      const katInfo = kategoriList.find(k => k.kod === kat)
      const katNama = katInfo
        ? `KATEGORI ${kat} — BAWAH ${katInfo.umurHad}`
        : `KATEGORI ${kat}`

      // ── Header bar ──
      pdf.setFillColor(0, 51, 153)
      pdf.rect(0, 0, W, 30, 'F')
      pdf.setTextColor(255, 255, 255)
      pdf.setFontSize(9); pdf.setFont('helvetica', 'normal')
      pdf.text('OLAHRAGAWAN & OLAHRAGAWATI TERBAIK', W / 2, 10, { align: 'center' })
      pdf.setFontSize(10); pdf.setFont('helvetica', 'bold')
      pdf.text((namaKej || 'KEJOHANAN OLAHRAGA').toUpperCase(), W / 2, 18, { align: 'center' })
      pdf.setFontSize(14); pdf.setFont('helvetica', 'bold')
      pdf.text(katNama, W / 2, 27, { align: 'center' })
      pdf.setTextColor(0, 0, 0)

      // ── Dua kolum (L dan P) ──
      const gap  = 6
      const colW = (W - M * 2 - gap) / 2
      const colYStart = 38

      ;['L', 'P'].forEach((j, ji) => {
        const x    = ji === 0 ? M : M + colW + gap
        const isL  = j === 'L'
        const fillR = isL ? 0 : 160
        const fillG = isL ? 51 : 0
        const fillB = isL ? 153 : 100

        // Dapatkan atlet: pilihan admin atau rank #1
        const pil  = pilihan[`${kat}_${j}`]
        const live = pil ? (allData.find(a => a.noKP === pil.noKP) || pil) : null
        let atlet  = live
        if (!atlet) {
          const sorted = rankWithTies(
            [...allData]
              .filter(a => a.jantina === j && a.kategoriKod === kat && (a.jumlahMata || 0) > 0)
              .sort(sortOlahragawan)
          )
          atlet = sorted.find(a => a.rank === 1) || null
        }

        // ── Tajuk kolum ──
        const hdrH = 12
        pdf.setFillColor(fillR, fillG, fillB)
        pdf.rect(x, colYStart, colW, hdrH, 'F')
        pdf.setTextColor(255, 255, 255)
        pdf.setFontSize(10); pdf.setFont('helvetica', 'bold')
        pdf.text(isL ? '\u2642 OLAHRAGAWAN' : '\u2640 OLAHRAGAWATI', x + colW / 2, colYStart + 8, { align: 'center' })
        pdf.setTextColor(0, 0, 0)

        // ── Kotak kandungan ──
        const boxY = colYStart + hdrH
        const boxH = 200
        pdf.setDrawColor(fillR, fillG, fillB)
        pdf.setLineWidth(0.4)
        pdf.rect(x, boxY, colW, boxH)
        pdf.setFillColor(fillR === 0 ? 240 : 255, fillG === 51 ? 242 : 240, fillB === 153 ? 255 : 248)
        pdf.rect(x, boxY, colW, boxH, 'F')
        pdf.setDrawColor(fillR, fillG, fillB)
        pdf.rect(x, boxY, colW, boxH)

        if (atlet) {
          const nama   = atlet.namaAtlet || '—'
          const sekolah = atlet.namaSekolah || atlet.kodSekolah || '—'
          const emas   = atlet.pingat_emas   || 0
          const perak  = atlet.pingat_perak  || 0
          const gangsa = atlet.pingat_gangsa || 0
          const mata   = atlet.jumlahMata    || 0

          // Bintang (jika dipilih manual)
          if (pil) {
            pdf.setFontSize(18)
            pdf.setTextColor(fillR, fillG, fillB)
            pdf.text('\u2605', x + colW / 2, boxY + 16, { align: 'center' })
          }

          // Nama (besar)
          pdf.setFontSize(15); pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(20, 20, 20)
          const namaLines = pdf.splitTextToSize(nama, colW - 8)
          const namaY = pil ? boxY + 30 : boxY + 20
          pdf.text(namaLines, x + colW / 2, namaY, { align: 'center' })

          // Sekolah
          pdf.setFontSize(8); pdf.setFont('helvetica', 'normal')
          pdf.setTextColor(80, 80, 80)
          const sklLines = pdf.splitTextToSize(sekolah, colW - 6)
          pdf.text(sklLines, x + colW / 2, namaY + (namaLines.length * 7) + 2, { align: 'center' })

          // Divider
          const divY = namaY + (namaLines.length * 7) + (sklLines.length * 5) + 8
          pdf.setDrawColor(200, 200, 210)
          pdf.setLineWidth(0.2)
          pdf.line(x + 10, divY, x + colW - 10, divY)

          // Medal row
          const mY = divY + 14
          const coinR = 8
          const centers = [x + colW/2 - 26, x + colW/2, x + colW/2 + 26]
          const mColors = [[212,175,55], [180,180,180], [205,127,50]]
          const mCounts = [emas, perak, gangsa]
          const mLabels = ['E', 'P', 'G']

          centers.forEach((cx, ci) => {
            pdf.setFillColor(...mColors[ci])
            pdf.circle(cx, mY, coinR, 'F')
            pdf.setTextColor(255, 255, 255)
            pdf.setFontSize(9); pdf.setFont('helvetica', 'bold')
            pdf.text(mLabels[ci], cx, mY + 3.5, { align: 'center' })
            pdf.setTextColor(50, 50, 50)
            pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
            pdf.text(String(mCounts[ci]), cx, mY + 22, { align: 'center' })
          })

          // Mata (nombor besar)
          pdf.setTextColor(fillR, fillG, fillB)
          pdf.setFontSize(52); pdf.setFont('helvetica', 'bold')
          pdf.text(String(mata), x + colW / 2, boxY + boxH - 28, { align: 'center' })
          pdf.setFontSize(9); pdf.setFont('helvetica', 'normal')
          pdf.setTextColor(120, 120, 120)
          pdf.text('MATA', x + colW / 2, boxY + boxH - 16, { align: 'center' })
        } else {
          pdf.setFontSize(9); pdf.setFont('helvetica', 'italic')
          pdf.setTextColor(160, 160, 160)
          pdf.text('Tiada data / belum dipilih', x + colW / 2, boxY + boxH / 2, { align: 'center' })
        }
        pdf.setTextColor(0, 0, 0)
      })

      // ── Footer ──
      pdf.setFontSize(7); pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(180, 180, 180)
      pdf.text(
        new Date().toLocaleDateString('ms-MY', { day: '2-digit', month: 'long', year: 'numeric' }),
        W / 2, H - 6, { align: 'center' }
      )
      pdf.setTextColor(0, 0, 0)
    })

    pdf.save(`BestAtlet_PerKategori_${(namaKej || 'KOAM').replace(/\s+/g, '_')}.pdf`)
  }

  async function cetakAnugerahKhas() {
    if (anugerahCustom.length === 0) return
    const { jsPDF }             = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210

    pdf.setFontSize(13); pdf.setFont('helvetica', 'bold')
    pdf.text('ANUGERAH KHAS', W / 2, 15, { align: 'center' })
    pdf.setFontSize(9); pdf.setFont('helvetica', 'normal')
    pdf.text(namaKej || 'Kejohanan Olahraga', W / 2, 21, { align: 'center' })
    pdf.setDrawColor(0, 51, 153); pdf.setLineWidth(0.5)
    pdf.line(12, 24, W - 12, 24)

    const rows = anugerahCustom.map(a => {
      const pil  = pilihan[`CUSTOM_${a.id}`]
      const live = pil ? (allData.find(atl => atl.noKP === pil.noKP) || pil) : null
      const fmt  = live
        ? `${live.namaAtlet || pil.namaAtlet}\n${live.namaSekolah || pil.namaSekolah || '—'}\nE×${live.pingat_emas||0}  P×${live.pingat_perak||0}  G×${live.pingat_gangsa||0}  ·  ${live.jumlahMata||0} mata`
        : 'Belum dipilih'
      return [a.nama, fmt]
    })

    autoTable(pdf, {
      startY: 30,
      head: [['Anugerah', 'Pemenang']],
      body: rows,
      styles: { fontSize: 10, cellPadding: 5, valign: 'top' },
      headStyles: { fillColor: [120, 80, 0], fontSize: 9, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 60, fontStyle: 'bold' }, 1: { cellWidth: 130 } },
      theme: 'grid',
    })

    pdf.save(`AnugerahKhas_${namaKej || 'KOAM'}.pdf`)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-6xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-800">Olahragawan & Olahragawati</h1>
          <p className="text-xs text-gray-500 mt-0.5">Admin · Sulit · Ranking per Kategori · Real-time</p>
          {namaKej && <p className="text-xs font-semibold text-[#003399] mt-0.5">{namaKej}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastUpdate && (
            <span className="text-[9px] text-gray-400 font-mono">{lastUpdate.toLocaleTimeString('ms-MY', { hour12: true })}</span>
          )}
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
          <button onClick={cetakBestAtletUmum}
            className="text-[10px] font-bold px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
            Cetak Best Atlet (Per Kat)
          </button>
          <button onClick={cetakTerbaikKategori}
            className="text-[10px] font-bold px-3 py-1.5 bg-[#003399] text-white rounded-lg hover:bg-[#002288]">
            Cetak Terbaik Kategori
          </button>
          <button onClick={cetakTerbaikKejohanan}
            className="text-[10px] font-bold px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            Cetak Terbaik Kejohanan
          </button>
          {anugerahCustom.length > 0 && (
            <button onClick={cetakAnugerahKhas}
              className="text-[10px] font-bold px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700">
              Cetak Anugerah Khas
            </button>
          )}
          {activeKat && (
            <button onClick={() => cetakPDF('satu', activeKat)}
              className="text-[10px] font-bold px-3 py-1.5 bg-gray-700 text-white rounded-lg hover:bg-gray-800">
              Cetak Kat {activeKat}
            </button>
          )}
          <button onClick={() => cetakPDF('semua')}
            className="text-[10px] font-bold px-3 py-1.5 bg-gray-500 text-white rounded-lg hover:bg-gray-600">
            Cetak Semua Ranking
          </button>
        </div>
      </div>

      {!selKej ? (
        <div className="py-16 text-center bg-white rounded-xl border border-gray-200 text-gray-400">
          <p className="text-sm font-semibold">Tiada kejohanan aktif.</p>
        </div>

      ) : loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          Memuatkan…
        </div>

      ) : katAda.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-xl border border-gray-200">
          <p className="text-sm font-semibold text-gray-500">Tiada data lagi.</p>
          <p className="text-xs text-gray-400 mt-1">Mata dikira automatik selepas keputusan RASMI.</p>
        </div>

      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">

          {/* Tab Kategori */}
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {/* Kategori tabs */}
            {katAda.map(kat => (
              <button key={kat} onClick={() => setSelKat(kat)}
                className={`px-5 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === kat
                    ? 'border-[#003399] text-[#003399] bg-blue-50/60'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}>
                {katLabel(kat)}
                <span className="ml-1.5 text-[8px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded-full font-semibold">
                  {allData.filter(a => a.kategoriKod === kat && (a.jumlahMata || 0) > 0).length}
                </span>
              </button>
            ))}
            {/* Divider */}
            {katAda.length > 0 && <div className="w-px bg-gray-200 mx-1 self-stretch my-2" />}
            {/* Terbaik Kejohanan tab */}
            <button onClick={() => setSelKat('TERBAIK_KEJ')}
              className={`px-5 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                activeTab === 'TERBAIK_KEJ'
                  ? 'border-amber-500 text-amber-700 bg-amber-50/60'
                  : 'border-transparent text-gray-500 hover:text-amber-600 hover:bg-amber-50/40'
              }`}>
              🏆 Terbaik Kejohanan
            </button>
            {/* Custom anugerah tabs */}
            {anugerahCustom.map(a => (
              <button key={a.id} onClick={() => setSelKat(`CUSTOM_${a.id}`)}
                className={`px-5 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === `CUSTOM_${a.id}`
                    ? 'border-purple-500 text-purple-700 bg-purple-50/60'
                    : 'border-transparent text-gray-500 hover:text-purple-600 hover:bg-purple-50/40'
                }`}>
                ★ {a.nama}
              </button>
            ))}
            {/* Add anugerah button */}
            <button onClick={() => setFormAnugerah('')}
              className="px-4 py-3 text-xs font-bold whitespace-nowrap border-b-2 border-transparent text-gray-400 hover:text-green-600 hover:bg-green-50/40 transition-colors">
              + Anugerah
            </button>
          </div>

          {/* Add anugerah form */}
          {formAnugerah !== null && (
            <div className="border-b border-gray-200 bg-green-50 px-4 py-3 flex items-center gap-3">
              <span className="text-xs font-bold text-green-700">Nama Anugerah:</span>
              <input
                type="text"
                value={formAnugerah}
                onChange={e => setFormAnugerah(e.target.value)}
                placeholder="cth: Atlet Harapan, Atlet Veteran…"
                autoFocus
                className="flex-1 border border-green-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-400"
              />
              <button
                onClick={() => handleTambahAnugerah(formAnugerah)}
                disabled={savingAnugerah || !formAnugerah.trim()}
                className="text-xs font-bold px-3 py-1.5 bg-green-600 text-white rounded-lg disabled:opacity-50">
                {savingAnugerah ? 'Simpan…' : 'Simpan'}
              </button>
              <button onClick={() => setFormAnugerah(null)}
                className="text-xs text-gray-400 hover:text-red-500 px-2">Batal</button>
            </div>
          )}

          {/* Content */}
          {activeTab === 'TERBAIK_KEJ' ? (
            <div className="p-4 space-y-4">
              {/* Terbaik Kejohanan Cards */}
              <div className="flex gap-3 flex-wrap sm:flex-nowrap">
                {['L', 'P'].map(j => {
                  const key  = `TERBAIK_KEJ_${j}`
                  const pil  = pilihan[key] || null
                  const live = pil ? allData.find(a => a.noKP === pil.noKP) : null
                  return (
                    <MuridTerbaikCard
                      key={j}
                      jantina={j}
                      pilihan={pil}
                      liveData={live}
                      onTukar={() => handlePilihByKey(pil, key)}
                    />
                  )
                })}
              </div>
              {/* Search */}
              <div className="flex items-center gap-2">
                <input type="text" value={searchAtlet} onChange={e => setSearchAtlet(e.target.value)}
                  placeholder="Cari nama atau sekolah…"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#003399]/25" />
                {searchAtlet && <button onClick={() => setSearchAtlet('')} className="text-xs text-gray-400 hover:text-red-500">✕</button>}
              </div>
              {/* Ranking — all atlet, L/P side by side */}
              <div className="flex gap-3 flex-wrap lg:flex-nowrap">
                {['L', 'P'].map(j => {
                  const key = `TERBAIK_KEJ_${j}`
                  const filtered = allData
                    .filter(a => a.jantina === j && (a.jumlahMata || 0) > 0)
                    .filter(a => !searchAtlet || (a.namaAtlet||'').toLowerCase().includes(searchAtlet.toLowerCase()) || (a.namaSekolah||'').toLowerCase().includes(searchAtlet.toLowerCase()))
                  const ranked = rankWithTies([...filtered].sort(sortOlahragawan))
                  const isL = j === 'L'
                  return (
                    <div key={j} className="flex-1 min-w-0 border border-gray-200 rounded-xl overflow-hidden">
                      <div className={`px-4 py-2.5 flex items-center justify-between ${isL ? 'bg-blue-700' : 'bg-pink-600'} text-white`}>
                        <span className="text-xs font-bold">{isL ? '♂ Olahragawan' : '♀ Olahragawati'} — Semua Kategori</span>
                        <span className="text-[9px] font-semibold opacity-80">{ranked.length} atlet</span>
                      </div>
                      {ranked.length === 0 ? (
                        <div className="py-8 text-center text-gray-400 text-xs">Tiada data.</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100 text-[8px] font-bold text-gray-400 uppercase tracking-wide">
                                <th className="px-2 py-2 text-center w-8">Kd</th>
                                <th className="px-2 py-2 text-left">Nama / Sekolah / Kat</th>
                                <th className="px-1 py-2 text-center text-yellow-600">E</th>
                                <th className="px-1 py-2 text-center text-gray-400">P</th>
                                <th className="px-1 py-2 text-center text-orange-400">G</th>
                                <th className="px-2 py-2 text-center text-[#003399]">Mata</th>
                                <th className="px-2 py-2 text-center">Pilih</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ranked.map(atlet => {
                                const isDipilih = pilihan[key]?.noKP === atlet.noKP
                                const isTop3 = atlet.rank <= 3
                                const rs = RANK_STYLE[atlet.rank] || ''
                                return (
                                  <tr key={atlet.id} className={`border-b border-gray-100 ${isDipilih ? 'bg-amber-50 border-l-4 border-l-yellow-400' : isTop3 ? 'bg-yellow-50/40' : 'hover:bg-gray-50/50'}`}>
                                    <td className="px-2 py-2 text-center">
                                      {isDipilih ? <span className="text-yellow-500 font-black text-sm">★</span>
                                        : isTop3 ? <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full border-2 text-[9px] font-black ${rs}`}>{atlet.rank}</span>
                                        : <span className="text-[10px] text-gray-400 font-bold">{atlet.rank}</span>}
                                    </td>
                                    <td className="px-2 py-2 cursor-pointer" onClick={() => setModalAtlet(atlet)}>
                                      <p className="font-semibold text-xs text-gray-800 truncate hover:text-[#003399] hover:underline">{atlet.namaAtlet || '—'}</p>
                                      <p className="text-[9px] text-gray-400 truncate">{atlet.namaSekolah || atlet.kodSekolah}</p>
                                      <p className="text-[8px] text-blue-400 font-bold">{katLabel(atlet.kategoriKod)}</p>
                                    </td>
                                    <td className="px-1 py-2 text-center"><span className={`text-xs font-black ${(atlet.pingat_emas||0)>0?'text-yellow-500':'text-gray-200'}`}>{atlet.pingat_emas||0}</span></td>
                                    <td className="px-1 py-2 text-center"><span className={`text-xs font-black ${(atlet.pingat_perak||0)>0?'text-gray-400':'text-gray-200'}`}>{atlet.pingat_perak||0}</span></td>
                                    <td className="px-1 py-2 text-center"><span className={`text-xs font-black ${(atlet.pingat_gangsa||0)>0?'text-orange-400':'text-gray-200'}`}>{atlet.pingat_gangsa||0}</span></td>
                                    <td className="px-2 py-2 text-center"><span className="text-sm font-black text-[#003399]">{atlet.jumlahMata||0}</span></td>
                                    <td className="px-2 py-2 text-center">
                                      <button onClick={() => handlePilihByKey(atlet, key)}
                                        className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-colors ${isDipilih ? 'bg-yellow-400 text-white border-yellow-500' : 'bg-white text-[#003399] border-[#003399] hover:bg-blue-50'}`}>
                                        {isDipilih ? '★ Dipilih' : 'Pilih'}
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : activeTab.startsWith('CUSTOM_') ? (() => {
            const anugerah = anugerahCustom.find(a => `CUSTOM_${a.id}` === activeTab)
            if (!anugerah) return null
            const key     = `CUSTOM_${anugerah.id}`
            const pil     = pilihan[key] || null
            const live    = pil ? allData.find(a => a.noKP === pil.noKP) : null
            const filtered = allData
              .filter(a => (a.jumlahMata || 0) > 0)
              .filter(a => !searchAtlet ||
                (a.namaAtlet||'').toLowerCase().includes(searchAtlet.toLowerCase()) ||
                (a.namaSekolah||'').toLowerCase().includes(searchAtlet.toLowerCase()))
            const ranked = rankWithTies([...filtered].sort(sortOlahragawan))
            return (
              <div className="p-4 space-y-4">
                {/* Header anugerah */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Anugerah Khas</p>
                    <p className="text-base font-black text-gray-800">{anugerah.nama}</p>
                  </div>
                  <button onClick={() => handlePadamAnugerah(anugerah)}
                    className="text-[10px] text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 rounded-lg px-2 py-1 transition-colors">
                    Padam Anugerah
                  </button>
                </div>

                {/* Winner card */}
                <div className={`border-2 rounded-xl px-4 py-3 ${pil ? 'border-amber-300 bg-amber-50' : 'border-dashed border-gray-200 bg-gray-50'}`}>
                  <p className="text-[9px] font-bold text-amber-600 uppercase tracking-wide mb-1">★ Pemenang</p>
                  {pil ? (
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-black text-gray-800">{live?.namaAtlet || pil.namaAtlet}</p>
                        <p className="text-xs text-gray-500">{live?.namaSekolah || pil.namaSekolah} · {katLabel(live?.kategoriKod || pil.kategoriKod)}</p>
                        <div className="flex gap-2 text-[9px] mt-1">
                          {(live?.pingat_emas||0)>0 && <span className="text-yellow-600 font-bold">E×{live.pingat_emas}</span>}
                          {(live?.pingat_perak||0)>0 && <span className="text-gray-500 font-bold">P×{live.pingat_perak}</span>}
                          {(live?.pingat_gangsa||0)>0 && <span className="text-orange-500 font-bold">G×{live.pingat_gangsa}</span>}
                          <span className="font-black text-[#003399]">{live?.jumlahMata||pil.jumlahMata||0} mata</span>
                        </div>
                      </div>
                      <button onClick={() => handlePilihByKey(pil, key)}
                        className="text-[9px] text-gray-400 hover:text-red-500 underline ml-3">Nyah Pilih</button>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Belum dipilih — klik [Pilih] dalam senarai</p>
                  )}
                </div>

                {/* Search */}
                <div className="flex items-center gap-2">
                  <input type="text" value={searchAtlet} onChange={e => setSearchAtlet(e.target.value)}
                    placeholder="Cari nama atau sekolah…"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#003399]/25" />
                  {searchAtlet && <button onClick={() => setSearchAtlet('')} className="text-xs text-gray-400 hover:text-red-500">✕</button>}
                </div>

                {/* All atlet list — both L and P */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-gray-700 text-white px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs font-bold">Semua Atlet (L & P)</span>
                    <span className="text-[9px] opacity-80">{ranked.length} atlet</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100 text-[8px] font-bold text-gray-400 uppercase tracking-wide">
                          <th className="px-2 py-2 text-center w-8">Kd</th>
                          <th className="px-2 py-2 text-left">Nama / Sekolah / Kat</th>
                          <th className="px-1 py-2 text-center">J</th>
                          <th className="px-1 py-2 text-center text-yellow-600">E</th>
                          <th className="px-1 py-2 text-center text-gray-400">P</th>
                          <th className="px-1 py-2 text-center text-orange-400">G</th>
                          <th className="px-2 py-2 text-center text-[#003399]">Mata</th>
                          <th className="px-2 py-2 text-center">Pilih</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ranked.map(atlet => {
                          const isDipilih = pilihan[key]?.noKP === atlet.noKP
                          return (
                            <tr key={atlet.id} className={`border-b border-gray-100 ${isDipilih ? 'bg-amber-50 border-l-4 border-l-yellow-400' : 'hover:bg-gray-50/50'}`}>
                              <td className="px-2 py-2 text-center">
                                {isDipilih ? <span className="text-yellow-500 font-black text-sm">★</span>
                                  : <span className="text-[10px] text-gray-400 font-bold">{atlet.rank}</span>}
                              </td>
                              <td className="px-2 py-2 cursor-pointer" onClick={() => setModalAtlet(atlet)}>
                                <p className="font-semibold text-xs text-gray-800 truncate hover:text-[#003399] hover:underline">{atlet.namaAtlet || '—'}</p>
                                <p className="text-[9px] text-gray-400 truncate">{atlet.namaSekolah || atlet.kodSekolah}</p>
                                <p className="text-[8px] text-blue-400 font-bold">{katLabel(atlet.kategoriKod)}</p>
                              </td>
                              <td className="px-1 py-2 text-center text-[9px] font-bold text-gray-500">{atlet.jantina}</td>
                              <td className="px-1 py-2 text-center"><span className={`text-xs font-black ${(atlet.pingat_emas||0)>0?'text-yellow-500':'text-gray-200'}`}>{atlet.pingat_emas||0}</span></td>
                              <td className="px-1 py-2 text-center"><span className={`text-xs font-black ${(atlet.pingat_perak||0)>0?'text-gray-400':'text-gray-200'}`}>{atlet.pingat_perak||0}</span></td>
                              <td className="px-1 py-2 text-center"><span className={`text-xs font-black ${(atlet.pingat_gangsa||0)>0?'text-orange-400':'text-gray-200'}`}>{atlet.pingat_gangsa||0}</span></td>
                              <td className="px-2 py-2 text-center"><span className="text-sm font-black text-[#003399]">{atlet.jumlahMata||0}</span></td>
                              <td className="px-2 py-2 text-center">
                                <button onClick={() => handlePilihByKey(atlet, key)}
                                  className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-colors ${isDipilih ? 'bg-yellow-400 text-white border-yellow-500' : 'bg-white text-[#003399] border-[#003399] hover:bg-blue-50'}`}>
                                  {isDipilih ? '★ Dipilih' : 'Pilih'}
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )
          })() : activeKat ? (
            <div className="p-4 space-y-4">

              {/* Murid Terbaik Cards */}
              <div className="flex gap-3 flex-wrap sm:flex-nowrap">
                {['L', 'P'].map(j => {
                  const pil = pilihan[`${activeKat}_${j}`] || null
                  // Cari data terkini (live) dari onSnapshot berdasarkan noKP pilihan
                  const live = pil ? allData.find(a => a.noKP === pil.noKP) : null
                  return (
                  <MuridTerbaikCard
                    key={j}
                    jantina={j}
                    pilihan={pil}
                    liveData={live}
                    onTukar={() => handlePilih(pil, j)}
                  />
                )})}
              </div>

              {/* Ranking side-by-side */}
              <div className="flex gap-3 flex-wrap lg:flex-nowrap">
                {['L', 'P'].map(j => (
                  <RankingTable
                    key={j}
                    data={allData.filter(a => a.kategoriKod === activeKat)}
                    jantina={j}
                    pilihanNoKP={pilihan[`${activeKat}_${j}`]?.noKP || null}
                    onPilih={handlePilih}
                    onDetail={setModalAtlet}
                  />
                ))}
              </div>

            </div>
          ) : null}
        </div>
      )}

      {/* Nota */}
      {selKej && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[10px] text-blue-700 space-y-0.5">
          <p className="font-bold">Nota Sistem:</p>
          <p>· Mata: Emas=5, Perak=3, Gangsa=2, Tempat 4=1. Tempat ke-5 ke bawah: tiada mata.</p>
          <p>· Relay: Pingat untuk sekolah sahaja — tiada mata individu.</p>
          <p>· Tiebreak: Jumlah Mata → Emas → Perak → Gangsa → Nama (abjad).</p>
          <p>· Klik nama atlet untuk lihat detail acara & rekod. Boleh cetak kad atlet.</p>
          <p>· Pilihan Murid Terbaik adalah manual oleh admin — boleh tukar bila-bila masa.</p>
        </div>
      )}

      {/* Modal detail atlet */}
      {modalAtlet && (
        <AtletModal
          atlet={modalAtlet}
          namaKej={namaKej}
          katLabelFn={katLabel}
          onClose={() => setModalAtlet(null)}
        />
      )}
    </div>
  )
}
