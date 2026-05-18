/**
 * CetakKeputusan.jsx — /dashboard/cetakkeputusan
 *
 * Cetakan Keputusan by Day:
 *   - Pilih hari → senarai semua acara RASMI pada hari itu
 *   - Cetak PDF (font besar, margin jelas) atau Export Excel
 *   - PDF tunjuk: keputusan penuh + rekod dipecahkan & rekod terkini sahaja
 *
 * Roles: superadmin, admin, pengurus_teknik, urusetia
 */

import { useState, useEffect } from 'react'
import {
  collection, getDocs, getDoc, doc, query, where, orderBy,
} from 'firebase/firestore'
import { db } from '../../firebase/config'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrestasi(val, jenisAcara) {
  if (val == null || val === '') return '—'
  const n = Number(val)
  if (isNaN(n)) return String(val)
  if (['padang_lompat', 'padang_balin'].includes(jenisAcara)) return `${n.toFixed(2)} m`
  const min = Math.floor(n / 60)
  const sek = (n % 60).toFixed(2).padStart(5, '0')
  return min > 0 ? `${min}:${sek}` : `${n.toFixed(2)}s`
}

function fmtTarikh(str) {
  if (!str) return '—'
  return new Date(str + 'T00:00:00').toLocaleDateString('ms-MY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function rekodKey(namaAcara, jantina, kategoriKod, peringkat) {
  return [namaAcara, jantina, kategoriKod, peringkat]
    .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

// Lookup rekod dengan fallback ke format lama (kelasDariNama)
function cariRekodDalamMap(acara, peringkatKej, rekodMap) {
  const namaPendek = (acara.namaAcaraPendek || acara.namaAcara || '').trim()
  const namaPenuh  = (acara.namaAcara || '').trim()
  // Primary key (format baru)
  const rKeyPrimary = rekodKey(namaPendek, acara.jantina, acara.kategoriKod, peringkatKej)
  if (rekodMap[rKeyPrimary]) return rekodMap[rKeyPrimary]
  // Fallback key (format lama — kelasDariNama)
  const kelasDariNama = (namaPenuh && namaPendek && namaPenuh !== namaPendek)
    ? namaPenuh.slice(namaPendek.length).trim() : ''
  if (kelasDariNama) {
    const rKeyFallback = rekodKey(namaPendek, acara.jantina, kelasDariNama, peringkatKej)
    if (rekodMap[rKeyFallback]) return rekodMap[rKeyFallback]
  }
  return null
}

const PINGAT_UI  = { 1: '🥇', 2: '🥈', 3: '🥉' }  // untuk web preview sahaja

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CetakKeputusan() {
  const [loadingInit, setLoadingInit] = useState(true)
  const [generating,  setGenerating]  = useState(false)
  const [progress,    setProgress]    = useState('')
  const [msg,         setMsg]         = useState(null)

  // Data asas
  const [cfg,              setCfg]              = useState({})
  const [kejId,            setKejId]            = useState('')
  const [namaKej,          setNamaKej]          = useState('')
  const [peringkatKej,     setPeringkatKej]     = useState('D')
  const [bilanganKedudukan, setBilanganKedudukan] = useState(8)
  const [days,        setDays]        = useState([])       // ['2025-05-01', ...]
  const [acaraByDay,  setAcaraByDay]  = useState({})       // date → [{ acara, masaMula, lokasi }]
  const [acaraMap,    setAcaraMap]    = useState({})       // acaraId → acara data
  const [rekodMap,    setRekodMap]    = useState({})       // rekodKey → rekod data (aktif)
  const [tuntutanMap, setTuntutanMap] = useState({})       // rekodKey → rekod data (tuntutan)

  // UI state
  const [selDay,      setSelDay]      = useState('')
  const [heatCache,   setHeatCache]   = useState({})       // acaraId → final heat | null

  // ── Init: load data asas sekali ───────────────────────────────────────────

  useEffect(() => {
    async function init() {
      setLoadingInit(true)
      try {
        const [cfgSnap, kejSnap] = await Promise.all([
          getDoc(doc(db, 'tetapan', 'home')),
          getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', 'in', ['aktif', 'persediaan']))),
        ])
        const cfgData = cfgSnap.exists() ? cfgSnap.data() : {}
        setCfg(cfgData)
        if (kejSnap.empty) {
          setMsg({ type: 'err', text: 'Tiada kejohanan aktif atau persediaan dijumpai.' })
          setLoadingInit(false)
          return
        }

        const kej   = kejSnap.docs[0]
        const kData = kej.data()
        setKejId(kej.id)
        setNamaKej(kData.namaKejohanan || cfgData.namaKejohanan || 'Kejohanan Olahraga')
        setPeringkatKej({ daerah: 'D', negeri: 'N', kebangsaan: 'K' }[kData.peringkat] || 'D')
        setBilanganKedudukan(kData.bilanganKedudukan ?? 8)

        // Jadual & acara
        const [jadualSnap, acaraSnap, rekodSnap, tuntSnap] = await Promise.all([
          getDocs(query(collection(db, 'jadual_acara'), where('kejohananId', '==', kej.id))),
          getDocs(query(collection(db, 'kejohanan', kej.id, 'acara'), orderBy('noAcara'))),
          getDocs(query(collection(db, 'rekod'), where('statusRekod', '==', 'aktif'))),
          getDocs(query(collection(db, 'rekod'), where('kejohananId', '==', kej.id))).catch(() => ({ docs: [] })),
        ])

        const aMap = {}
        acaraSnap.docs.forEach(d => { aMap[d.id] = { id: d.id, ...d.data() } })
        setAcaraMap(aMap)

        const rMap = {}
        rekodSnap.docs.forEach(d => { rMap[d.id] = { id: d.id, ...d.data() } })
        setRekodMap(rMap)

        const tMap = {}
        tuntSnap.docs.forEach(d => {
          if (d.id.endsWith('_tuntutan')) {
            const rk = d.id.slice(0, -10)
            tMap[rk] = { id: d.id, ...d.data() }
          }
        })
        setTuntutanMap(tMap)

        // Group jadual by day, sort by masaMula client-side
        const byDay = {}
        jadualSnap.docs.forEach(d => {
          const j = d.data()
          if (j.statusJadual === 'batal' || !j.tarikhAcara) return
          const aId = j.aceraId || j.acaraId
          if (!aId || !aMap[aId]) return
          if (!byDay[j.tarikhAcara]) byDay[j.tarikhAcara] = []
          byDay[j.tarikhAcara].push({
            acara:    aMap[aId],
            masaMula: j.masaMula || '',
            lokasi:   j.lokasi   || '',
          })
        })
        // Sort acara dalam setiap hari by masaMula
        Object.keys(byDay).forEach(day => {
          byDay[day].sort((a, b) => (a.masaMula || '').localeCompare(b.masaMula || ''))
        })

        const sortedDays = Object.keys(byDay).sort()
        setDays(sortedDays)
        setAcaraByDay(byDay)
        if (sortedDays.length > 0) setSelDay(sortedDays[0])
      } catch (e) {
        console.error(e)
        setMsg({ type: 'err', text: 'Ralat muatkan data: ' + e.message })
      } finally { setLoadingInit(false) }
    }
    init()
  }, [])

  // ── Load heats untuk hari yang dipilih ───────────────────────────────────

  useEffect(() => {
    if (!selDay || !kejId) return
    const items = acaraByDay[selDay] || []
    const toLoad = items.filter(({ acara }) => heatCache[acara.id] === undefined)
    if (toLoad.length === 0) return

    // Mark as loading (null = loading, false = no final heat, object = heat data)
    setHeatCache(prev => {
      const next = { ...prev }
      toLoad.forEach(({ acara }) => { next[acara.id] = 'loading' })
      return next
    })

    Promise.all(toLoad.map(async ({ acara }) => {
      try {
        const snap = await getDocs(collection(db, 'kejohanan', kejId, 'acara', acara.id, 'heat'))
        const heats = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        // Guna heat final yang ada keputusan (diterima) — kalau 1 heat guna terus
        const final =
          heats.find(h => ['final', 'terus_final'].includes(h.fasa) && h.statusKeputusan === 'diterima') ||
          heats.find(h => ['final', 'terus_final'].includes(h.fasa)) ||
          (heats.length === 1 ? heats[0] : null)
        return { acaraId: acara.id, heat: final || false }
      } catch {
        return { acaraId: acara.id, heat: false }
      }
    })).then(results => {
      setHeatCache(prev => {
        const next = { ...prev }
        results.forEach(({ acaraId, heat }) => { next[acaraId] = heat })
        return next
      })
    })
  }, [selDay, kejId, acaraByDay]) // eslint-disable-line

  // ── Derived: acara rasmi untuk hari terpilih ──────────────────────────────

  const itemsSelDay  = (acaraByDay[selDay] || [])
  // Acara yang ada heat (rasmi atau draf) — boleh dicetak
  const rasmiItems   = itemsSelDay.filter(({ acara }) => {
    const h = heatCache[acara.id]
    return h && h !== 'loading'
  })
  const loadingHeats = itemsSelDay.some(({ acara }) => heatCache[acara.id] === 'loading')

  // ── Cetak PDF ─────────────────────────────────────────────────────────────

  async function cetakPDF() {
    if (!selDay || rasmiItems.length === 0) return
    setGenerating(true); setProgress('Menjana PDF…'); setMsg(null)
    try {
      const { jsPDF }              = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')

      const pdf  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const W    = 210
      const M    = 15
      const BLUE = [0, 51, 153]

      function addHdr(isFirst) {
        if (!isFirst) pdf.addPage()
        // Bar atas
        pdf.setFillColor(...BLUE)
        pdf.rect(0, 0, W, 12, 'F')
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(255, 255, 255)
        pdf.text(namaKej.toUpperCase(), M, 7.5)
        pdf.setTextColor(255, 220, 0)
        pdf.text('KEPUTUSAN RASMI', W - M, 7.5, { align: 'right' })
        pdf.setTextColor(0, 0, 0)

        // Tarikh hari
        pdf.setFontSize(10)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(...BLUE)
        const hariIdx = days.indexOf(selDay) + 1
        pdf.text(`HARI ${hariIdx} — ${fmtTarikh(selDay).toUpperCase()}`, M, 22)
        pdf.setTextColor(0, 0, 0)
        pdf.setDrawColor(...BLUE)
        pdf.setLineWidth(0.4)
        pdf.line(M, 24, W - M, 24)

        // Logo
        const lSize = 14
        if (cfg.logoKiriBase64) {
          try { pdf.addImage(cfg.logoKiriBase64, 'PNG', M, 13, lSize, lSize) } catch {}
        }
        if (cfg.logoKananBase64) {
          try { pdf.addImage(cfg.logoKananBase64, 'PNG', W - M - lSize, 13, lSize, lSize) } catch {}
        }
        return 28 // y start
      }

      let y = addHdr(true)
      let isFirst = true

      for (const { acara, masaMula } of rasmiItems) {
        const heat = heatCache[acara.id]
        if (!heat) continue

        const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
        const isRelay  = acara.jenisAcara === 'relay'

        // Peserta: had kepada bilanganKedudukan (dari tetapan kejohanan), sorted
        const peserta = (heat.peserta || [])
          .filter(p => p.rankDalamHeat)
          .sort((a, b) => (a.rankDalamHeat || 99) - (b.rankDalamHeat || 99))
          .slice(0, bilanganKedudukan)

        if (peserta.length === 0) continue

        // Rekod: cek tuntutan dulu (rekod baru belum lulus admin), lepas tu aktif
        const _rekodAktif    = cariRekodDalamMap(acara, peringkatKej, rekodMap)
        const _rekodTuntutan = cariRekodDalamMap(acara, peringkatKej, tuntutanMap)
        const rekodBaru = !!(_rekodTuntutan && _rekodTuntutan.kejohananId === kejId)
        const rekodDoc  = rekodBaru ? _rekodTuntutan : _rekodAktif
        const top1      = peserta[0]

        // Baris peserta
        const rows = peserta.map(p => {
          const flagged = ['DNS', 'DNF', 'DQ', 'FS', 'NM'].includes(p.status)
          return [
            p.rankDalamHeat,
            isRelay ? (p.kodSekolah || '—') : (p.namaAtlet || '—'),
            isRelay ? '—' : (p.kodSekolah || '—'),
            flagged ? p.status : fmtPrestasi(p.keputusan, acara.jenisAcara),
            p.status !== 'selesai' ? p.status : '',
          ]
        })

        // Header acara
        const janLabel   = acara.jantina === 'L' ? 'Lelaki' : acara.jantina === 'P' ? 'Perempuan' : ''
        const acaraTitle = [
          acara.noAcara ? `[${acara.noAcara}]` : '',
          acara.namaAcara || '',
          janLabel,
          acara.kategoriKod ? `Kat ${acara.kategoriKod}` : '',
          masaMula          ? `— ${masaMula}` : '',
        ].filter(Boolean).join('  ')

        // Perlu halaman baru?
        const estH = 8 + rows.length * 7 + (rekodDoc ? (rekodBaru ? 20 : 12) : 0)
        if (y + estH > 270) {
          y = addHdr(false)
          isFirst = false
        }

        // Jadual keputusan
        autoTable(pdf, {
          startY: y,
          head: [[{
            content: acaraTitle,
            colSpan: 5,
            styles: {
              fillColor: [235, 240, 255],
              textColor: [0, 30, 100],
              fontStyle: 'bold',
              fontSize:  9,
              cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
            },
          }],
          [
            { content: 'Kd.',    styles: { halign: 'center' } },
            { content: isRelay ? 'Pasukan / Sekolah' : 'Nama Atlet' },
            { content: isRelay ? '' : 'Sekolah' },
            { content: isPadang ? 'Jarak' : 'Masa', styles: { halign: 'right' } },
            { content: 'Status', styles: { halign: 'center' } },
          ]],
          body: rows,
          styles: {
            fontSize:    9,
            cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
            font:        'helvetica',
          },
          headStyles: {
            fillColor:  [200, 210, 240],
            textColor:  [0, 0, 0],
            fontStyle:  'bold',
            fontSize:   8,
          },
          columnStyles: {
            0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 42 },
            3: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: [0, 51, 153] },
            4: { cellWidth: 18, halign: 'center', fontSize: 7, textColor: [180, 60, 60] },
          },
          theme: 'grid',
          tableLineColor: [210, 215, 230],
          tableLineWidth: 0.2,
          didParseCell: (data) => {
            // Highlight baris 1, 2, 3
            if (data.section === 'body') {
              const rank = peserta[data.row.index]?.rankDalamHeat
              if (rank === 1) data.cell.styles.fillColor = [255, 248, 220]
              else if (rank === 2) data.cell.styles.fillColor = [245, 245, 248]
              else if (rank === 3) data.cell.styles.fillColor = [255, 245, 235]
            }
          },
        })
        y = pdf.lastAutoTable.finalY

        // ── Kotak rekod ──
        // Case A: rekod baru dipecah dalam kejohanan ini (postRasmi dah run)
        // Case B: rekod lama dari koleksi (untuk rujukan juruhebah)
        const PERINGKAT_LABEL_MAP = { D: 'Daerah', N: 'Negeri', K: 'Kebangsaan' }
        const pLabel = PERINGKAT_LABEL_MAP[peringkatKej] || peringkatKej

        if (rekodDoc) {
          pdf.setLineWidth(0.3)
          pdf.setFontSize(8)

          if (rekodBaru) {
            // ── Case A: Rekod baru dipecah ──
            const hasLama = rekodDoc.prestasiLama != null
            const boxH    = hasLama ? 18 : 14
            pdf.setFillColor(255, 243, 205)
            pdf.setDrawColor(200, 150, 0)
            pdf.roundedRect(M, y + 2, W - M * 2, boxH, 2, 2, 'FD')

            // Baris 1: rekod baru
            pdf.setFont('helvetica', 'bold')
            pdf.setTextColor(120, 80, 0)
            const newNama  = rekodDoc.namaAtlet  || (top1?.namaAtlet || '—')
            const newSkol  = rekodDoc.namaSekolah || rekodDoc.kodSekolah || (top1?.kodSekolah || '—')
            const newP     = fmtPrestasi(rekodDoc.prestasi, acara.jenisAcara)
            pdf.text(
              '[RBK — REKOD BARU KEJOHANAN]  ' + newP + '  --  ' + newNama + '  (' + newSkol + ')',
              M + 3, y + 8
            )

            // Baris 2: rekod lama
            pdf.setFont('helvetica', 'normal')
            pdf.setFontSize(7.5)
            pdf.setTextColor(80, 55, 10)
            if (hasLama) {
              const oldP    = fmtPrestasi(rekodDoc.prestasiLama, acara.jenisAcara)
              const oldNama = rekodDoc.namaLama    || '—'
              const oldLok  = rekodDoc.lokasiLama  || '—'
              const oldThn  = rekodDoc.tahunLama   || ''
              pdf.text(
                'Rekod Lama: ' + oldP + '  --  ' + oldNama + '  (' + oldLok + ')' +
                (oldThn ? '  ' + oldThn : ''),
                M + 3, y + 14
              )
            } else {
              pdf.text('Rekod Pertama Ditetapkan', M + 3, y + 14)
            }

            pdf.setTextColor(0, 0, 0)
            y += boxH + 6

          } else {
            // ── Case B: Tunjuk rekod semasa untuk rujukan juruhebah ──
            pdf.setFillColor(235, 242, 255)
            pdf.setDrawColor(150, 170, 220)
            pdf.roundedRect(M, y + 2, W - M * 2, 10, 2, 2, 'FD')

            pdf.setFont('helvetica', 'normal')
            pdf.setTextColor(40, 60, 130)
            const rP    = fmtPrestasi(rekodDoc.prestasi, acara.jenisAcara)
            const rNama = rekodDoc.namaAtlet  || '—'
            const rSkol = rekodDoc.namaSekolah || rekodDoc.lokasiLama || '—'
            const rThn  = rekodDoc.tarikhRekod ? String(rekodDoc.tarikhRekod).slice(0, 4) : ''
            pdf.text(
              'Rekod ' + pLabel + ':  ' + rP + '  --  ' + rNama + '  (' + rSkol + ')' +
              (rThn ? '  ' + rThn : ''),
              M + 3, y + 8
            )

            pdf.setTextColor(0, 0, 0)
            y += 16
          }
        } else {
          y += 4
        }
      }

      // Nombor halaman
      const total = pdf.getNumberOfPages()
      for (let i = 1; i <= total; i++) {
        pdf.setPage(i)
        pdf.setFontSize(7)
        pdf.setFont('helvetica', 'normal')
        pdf.setTextColor(160, 160, 160)
        pdf.text(`${i} / ${total}`, W - M, 290, { align: 'right' })
        pdf.text(namaKej, M, 290)
        pdf.setTextColor(0, 0, 0)
      }

      const fname = `Keputusan_Hari${days.indexOf(selDay) + 1}_${selDay}_${namaKej.replace(/\s+/g, '_')}.pdf`
      pdf.save(fname)
      setMsg({ type: 'ok', text: 'PDF berjaya dijana.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Ralat PDF: ' + e.message })
    } finally { setGenerating(false); setProgress('') }
  }

  // ── Export Excel ─────────────────────────────────────────────────────────

  async function exportExcel() {
    if (!selDay || rasmiItems.length === 0) return
    setGenerating(true); setProgress('Menjana Excel…'); setMsg(null)
    try {
      const XLSX = await import('xlsx')

      const rows = []
      // Header besar
      rows.push([namaKej])
      rows.push([`Keputusan Rasmi — ${fmtTarikh(selDay)}`])
      rows.push([])
      rows.push(['No Acara', 'Nama Acara', 'Kategori', 'Jantina', 'Kedudukan', 'Nama Atlet / Pasukan', 'Sekolah', 'Prestasi', 'Status', 'Rekod Pecah'])

      for (const { acara } of rasmiItems) {
        const heat = heatCache[acara.id]
        if (!heat) continue
        const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
        const isRelay  = acara.jenisAcara === 'relay'

        const peserta = (heat.peserta || [])
          .filter(p => p.rankDalamHeat)
          .sort((a, b) => (a.rankDalamHeat || 99) - (b.rankDalamHeat || 99))
          .slice(0, bilanganKedudukan)

        const rekodDoc = cariRekodDalamMap(acara, peringkatKej, rekodMap)

        peserta.forEach(p => {
          const flagged = ['DNS', 'DNF', 'DQ', 'FS', 'NM'].includes(p.status)
          const np      = Number(p.keputusan)
          const rp      = rekodDoc ? Number(rekodDoc.prestasi) : null
          const pecah   = !flagged && rp != null && p.rankDalamHeat === 1
            ? (isPadang ? np > rp : np < rp)
            : false
          rows.push([
            acara.noAcara    || '',
            acara.namaAcara  || '',
            acara.kategoriKod || '',
            acara.jantina === 'L' ? 'Lelaki' : acara.jantina === 'P' ? 'Perempuan' : '',
            p.rankDalamHeat  || '',
            isRelay ? (p.kodSekolah || '') : (p.namaAtlet || ''),
            isRelay ? '' : (p.kodSekolah || ''),
            flagged ? p.status : fmtPrestasi(p.keputusan, acara.jenisAcara),
            p.status         || '',
            pecah ? 'YA' : '',
          ])
        })
        rows.push([]) // baris kosong antara acara
      }

      const ws  = XLSX.utils.aoa_to_sheet(rows)
      // Lebar kolum
      ws['!cols'] = [
        { wch: 10 }, { wch: 28 }, { wch: 8 }, { wch: 12 },
        { wch: 10 }, { wch: 30 }, { wch: 28 }, { wch: 14 },
        { wch: 10 }, { wch: 12 },
      ]
      const wb   = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, `Hari ${days.indexOf(selDay) + 1}`)
      const fname = `Keputusan_Hari${days.indexOf(selDay) + 1}_${selDay}.xlsx`
      XLSX.writeFile(wb, fname)
      setMsg({ type: 'ok', text: 'Excel berjaya dijana.' })
    } catch (e) {
      setMsg({ type: 'err', text: 'Ralat Excel: ' + e.message })
    } finally { setGenerating(false); setProgress('') }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingInit) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-400 text-sm">
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
        Memuatkan…
      </div>
    )
  }

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-base font-bold text-[#003399]">Cetakan Keputusan</h1>
          <p className="text-xs text-gray-400 mt-0.5">Pilih hari → jana PDF atau Excel keputusan rasmi</p>
          {namaKej && <p className="text-xs font-semibold text-[#003399] mt-0.5">{namaKej}</p>}
        </div>

        {/* Butang cetak */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={cetakPDF}
            disabled={generating || rasmiItems.length === 0 || loadingHeats}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#003399] hover:bg-[#002280] disabled:bg-gray-300 text-white text-xs font-bold rounded-lg transition-colors"
          >
            {generating && progress.includes('PDF') ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            ) : '📄'}
            Cetak PDF
          </button>
          <button
            onClick={exportExcel}
            disabled={generating || rasmiItems.length === 0 || loadingHeats}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-xs font-bold rounded-lg transition-colors"
          >
            {generating && progress.includes('Excel') ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            ) : '📊'}
            Export Excel
          </button>
        </div>
      </div>

      {/* Mesej */}
      {msg && (
        <div className={`px-4 py-2.5 rounded-lg text-xs font-medium border ${
          msg.type === 'ok'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-2 opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Progress */}
      {generating && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
          <svg className="w-3.5 h-3.5 animate-spin text-[#003399] shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          {progress}
        </div>
      )}

      {days.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center text-gray-400">
          <p className="text-2xl mb-2">📅</p>
          <p className="text-sm font-semibold">Tiada jadual acara dijumpai.</p>
        </div>
      ) : (
        <div className="flex gap-4">

          {/* Kiri: Tab hari */}
          <div className="w-44 shrink-0 space-y-1">
            {days.map((date, i) => {
              const items    = acaraByDay[date] || []
              const nRasmi   = items.filter(({ acara }) => {
                const h = heatCache[acara.id]
                return h && h !== 'loading'
              }).length
              const loading  = items.some(({ acara }) => heatCache[acara.id] === 'loading')
              const isActive = date === selDay
              return (
                <button
                  key={date}
                  onClick={() => setSelDay(date)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-[#003399] text-white border-[#003399] shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-[#003399]/40 hover:bg-blue-50/40'
                  }`}
                >
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${isActive ? 'text-white/70' : 'text-gray-400'}`}>
                    Hari {i + 1}
                  </p>
                  <p className="text-xs font-semibold mt-0.5">
                    {new Date(date + 'T00:00:00').toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' })}
                  </p>
                  <p className={`text-[10px] mt-1 ${isActive ? 'text-white/80' : 'text-gray-400'}`}>
                    {loading ? '⏳ memuatkan…' : `${nRasmi} / ${items.length} rasmi`}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Kanan: Senarai acara hari terpilih */}
          <div className="flex-1 min-w-0">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">

              {/* Header hari */}
              <div className="px-4 py-3 bg-[#003399] text-white">
                <p className="text-xs font-bold">
                  Hari {days.indexOf(selDay) + 1} — {fmtTarikh(selDay)}
                </p>
                <p className="text-[10px] text-white/70 mt-0.5">
                  {rasmiItems.length} acara rasmi daripada {itemsSelDay.length} acara
                </p>
              </div>

              {/* Loading heats */}
              {loadingHeats && (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-gray-400 border-b border-gray-100">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Memuatkan keputusan…
                </div>
              )}

              {/* Senarai acara */}
              {itemsSelDay.length === 0 ? (
                <div className="py-10 text-center text-gray-400 text-sm">
                  Tiada acara pada hari ini.
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {itemsSelDay.map(({ acara, masaMula, lokasi }) => {
                    const heat     = heatCache[acara.id]
                    const isRasmi  = heat && heat !== 'loading'
                    const isLoad   = heat === 'loading'
                    const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
                    const isRelay  = acara.jenisAcara === 'relay'

                    // Semak rekod
                    const rekodDoc = cariRekodDalamMap(acara, peringkatKej, rekodMap)
                    const top1     = isRasmi ? (heat.peserta || []).find(p => p.rankDalamHeat === 1 && p.status === 'selesai') : null
                    const pecah    = top1 && rekodDoc && (() => {
                      const np = Number(top1.keputusan)
                      const rp = Number(rekodDoc.prestasi)
                      return isPadang ? np > rp : np < rp
                    })()

                    const janLabel = acara.jantina === 'L' ? 'L' : acara.jantina === 'P' ? 'P' : '—'

                    return (
                      <div key={acara.id} className={`px-4 py-3 ${isRasmi ? '' : 'opacity-50'}`}>
                        <div className="flex items-start gap-3">

                          {/* No acara */}
                          <span className="text-[10px] font-black text-[#003399] font-mono w-8 shrink-0 pt-0.5">
                            {acara.noAcara || '—'}
                          </span>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-gray-800 truncate">
                                {acara.namaAcara || '—'}
                              </span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                acara.jantina === 'L' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                              }`}>{janLabel}</span>
                              <span className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-bold">
                                Kat {acara.kategoriKod || '—'}
                              </span>
                              {isRelay && <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">Relay</span>}
                              {pecah && (
                                <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                                  ★ Rekod Pecah
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {masaMula && `${masaMula}  ·  `}{lokasi || ''}
                            </p>

                            {/* Top 3 preview */}
                            {isRasmi && (() => {
                              const top3 = (heat.peserta || [])
                                .filter(p => p.rankDalamHeat && p.rankDalamHeat <= 3 && p.status === 'selesai')
                                .sort((a, b) => a.rankDalamHeat - b.rankDalamHeat)
                              return top3.length > 0 ? (
                                <div className="mt-1.5 space-y-0.5">
                                  {top3.map(p => (
                                    <div key={p.noBib || p.rankDalamHeat} className="flex items-center gap-1.5 text-[10px]">
                                      <span>{PINGAT_UI[p.rankDalamHeat]}</span>
                                      <span className="font-semibold text-gray-700 truncate max-w-[140px]">
                                        {isRelay ? p.kodSekolah : p.namaAtlet}
                                      </span>
                                      {!isRelay && <span className="text-gray-400">{p.kodSekolah}</span>}
                                      <span className="font-mono font-bold text-[#003399] ml-auto">
                                        {fmtPrestasi(p.keputusan, acara.jenisAcara)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : null
                            })()}
                          </div>

                          {/* Status badge */}
                          <div className="shrink-0">
                            {isLoad ? (
                              <span className="text-[9px] text-gray-400">⏳</span>
                            ) : isRasmi ? (
                              <span className="text-[9px] font-bold text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">KEPUTUSAN</span>
                            ) : (
                              <span className="text-[9px] text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">—</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Nota */}
            <p className="text-[10px] text-gray-400 mt-2 px-1">
              Hanya acara status RASMI akan dimasukkan dalam PDF dan Excel.
              Rekod dipecahkan ditanda ★ dan dipaparkan dalam PDF.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
