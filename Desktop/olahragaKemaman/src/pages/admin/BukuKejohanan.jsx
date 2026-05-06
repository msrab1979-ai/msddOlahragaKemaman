/**
 * BukuKejohanan.jsx — /dashboard/buku
 *
 * Jana satu PDF komprehensif (Buku Program Kejohanan):
 *   1. Muka Depan
 *   2. Jadual Acara (per hari)
 *   3. Keputusan Rasmi (per hari → per acara, top 3 + prestasi)
 *   4. Rekod Semasa (grouped by kategori)
 *   5. Olahragawan & Olahragawati (per kategori)
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

function katLabel(kod, kategoriList = []) {
  if (!kod) return '—'
  const kat = kategoriList.find(k => k.kod === kod)
  return kat?.label || kod
}

function rekodKey(namaAcara, jantina, kategoriKod, peringkat) {
  return [namaAcara, jantina, kategoriKod, peringkat]
    .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BukuKejohanan() {
  const [loading,   setLoading]   = useState(false)
  const [loadData,  setLoadData]  = useState(false)
  const [msg,       setMsg]       = useState(null)
  const [preview,   setPreview]   = useState(null) // ringkasan data loaded
  const [progress,  setProgress]  = useState('')

  // ── Load & Jana PDF ─────────────────────────────────────────────────────────

  async function handleJana() {
    setLoading(true)
    setMsg(null)
    setProgress('Memuatkan tetapan…')
    try {
      // 1. Tetapan & config
      const cfgSnap = await getDoc(doc(db, 'tetapan', 'home'))
      const cfg = cfgSnap.exists() ? cfgSnap.data() : {}

      // 2. Kejohanan aktif
      setProgress('Memuatkan data kejohanan…')
      const kejSnap = await getDocs(query(
        collection(db, 'kejohanan'),
        where('statusKejohanan', '==', 'aktif')
      ))
      if (kejSnap.empty) {
        setMsg({ type: 'err', text: 'Tiada kejohanan aktif.' })
        return
      }
      const kejDoc  = kejSnap.docs[0]
      const kejId   = kejDoc.id
      const kej     = kejDoc.data()
      const namaKej = kej.namaKejohanan || cfg.namaKejohanan || 'Kejohanan Olahraga'
      const peringkatKej = { daerah: 'D', negeri: 'N', kebangsaan: 'K' }[kej.peringkat] || 'D'

      // 3. Sekolah
      setProgress('Memuatkan senarai sekolah…')
      const sklSnap  = await getDocs(collection(db, 'sekolah'))
      const sekolahList = sklSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.kategori || '').localeCompare(b.kategori || '') || (a.namaSekolah || '').localeCompare(b.namaSekolah || '', 'ms'))

      // 4. Jadual acara
      setProgress('Memuatkan jadual acara…')
      const jadualSnap = await getDocs(
        query(collection(db, 'jadual_acara'), orderBy('tarikhAcara'), orderBy('masaMula'))
      )
      const jadualList = jadualSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(j => j.statusJadual !== 'batal' && j.tarikhAcara)

      // 5. Semua acara dalam kejohanan
      setProgress('Memuatkan senarai acara…')
      const acaraSnap = await getDocs(
        query(collection(db, 'kejohanan', kejId, 'acara'), orderBy('noAcara'))
      )
      const acaraList = acaraSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const acaraMap  = Object.fromEntries(acaraList.map(a => [a.id, a]))

      // 6. Heats untuk acara yang RASMI — parallel load
      setProgress('Memuatkan keputusan rasmi…')
      const rasmiAcara = acaraList.filter(a => a.statusAcara === 'rasmi')
      const heatResults = await Promise.all(
        rasmiAcara.map(async a => {
          const hSnap = await getDocs(
            collection(db, 'kejohanan', kejId, 'acara', a.id, 'heat')
          )
          const heats = hSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          // Cari final heat
          const final = heats.find(h =>
            ['final', 'terus_final'].includes(h.fasa) && h.statusKeputusan === 'rasmi'
          ) || (heats.length === 1 && heats[0].statusKeputusan === 'rasmi' ? heats[0] : null)
          return { acaraId: a.id, heat: final }
        })
      )
      // Map: acaraId → final heat
      const finalHeatMap = {}
      heatResults.forEach(({ acaraId, heat }) => {
        if (heat) finalHeatMap[acaraId] = heat
      })

      // 7. Rekod semasa
      setProgress('Memuatkan rekod semasa…')
      const rekodSnap = await getDocs(
        query(collection(db, 'rekod'), where('statusRekod', '==', 'aktif'))
      )
      const rekodList = rekodSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const rekodMap  = Object.fromEntries(rekodList.map(r => [r.id, r]))

      // 8. Pilihan olahragawan
      setProgress('Memuatkan pilihan olahragawan…')
      const pilSnap = await getDocs(
        query(collection(db, 'pilihan_olahragawan'), where('kejohananId', '==', kejId))
      )
      const pilihan = {}
      pilSnap.docs.forEach(d => {
        const r = d.data()
        pilihan[`${r.kategoriKod}_${r.jantina}`] = r
      })

      // 9. Mata olahragawan (untuk nilai terkini pilihan)
      setProgress('Memuatkan mata olahragawan…')
      const mataSnap = await getDocs(
        query(collection(db, 'mata_olahragawan'), where('kejohananId', '==', kejId))
      )
      const mataMap = {} // noKP → data
      mataSnap.docs.forEach(d => {
        const r = d.data()
        if (r.noKP) mataMap[r.noKP] = { id: d.id, ...r }
      })

      // 10. Kategori
      const katSnap = await getDocs(query(collection(db, 'kategori'), orderBy('urutan')))
      const katList = katSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      // ── Preview ringkasan ──
      setPreview({
        namaKej,
        jumlahSekolah:  sekolahList.length,
        jumlahAcara:    acaraList.length,
        jumlahRasmi:    Object.keys(finalHeatMap).length,
        jumlahRekod:    rekodList.length,
        jumlahPilihan:  Object.keys(pilihan).length,
      })

      // ── Jana PDF ──
      setProgress('Menjana PDF…')
      await janaPDF({
        cfg, kej, kejId, namaKej, peringkatKej,
        sekolahList, jadualList, acaraList, acaraMap,
        finalHeatMap, rekodMap, pilihan, mataMap, katList,
      })

      setMsg({ type: 'ok', text: 'Buku Kejohanan berjaya dijana dan dimuat turun.' })
    } catch (e) {
      console.error(e)
      setMsg({ type: 'err', text: 'Ralat: ' + e.message })
    } finally {
      setLoading(false)
      setProgress('')
    }
  }

  // ── Jana PDF ─────────────────────────────────────────────────────────────────

  async function janaPDF({
    cfg, kej, namaKej, peringkatKej,
    sekolahList, jadualList, acaraList, acaraMap,
    finalHeatMap, rekodMap, pilihan, mataMap, katList,
  }) {
    const { jsPDF }         = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const pdf  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W    = 210
    const M    = 14 // margin kiri/kanan
    const BLUE = [0, 51, 153]

    // ── Helper: header halaman ──
    function hdrHalaman(tajuk, sub) {
      pdf.setFillColor(...BLUE)
      pdf.rect(0, 0, W, 10, 'F')
      pdf.setFontSize(7)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(255, 255, 255)
      pdf.text(namaKej.toUpperCase(), M, 6.5)
      pdf.text(tajuk.toUpperCase(), W - M, 6.5, { align: 'right' })
      pdf.setTextColor(0, 0, 0)
      if (sub) {
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(...BLUE)
        pdf.text(sub, M, 18)
        pdf.setTextColor(0, 0, 0)
        pdf.setDrawColor(...BLUE)
        pdf.setLineWidth(0.3)
        pdf.line(M, 20, W - M, 20)
      }
    }

    // ── Nombor halaman ──
    function nomorHalaman() {
      const total = pdf.getNumberOfPages()
      for (let i = 1; i <= total; i++) {
        pdf.setPage(i)
        pdf.setFontSize(7)
        pdf.setFont('helvetica', 'normal')
        pdf.setTextColor(150, 150, 150)
        pdf.text(`Halaman ${i} / ${total}`, W / 2, 290, { align: 'center' })
        pdf.text(namaKej, M, 290)
      }
    }

    // ════════════════════════════════════════════════════════════
    // HALAMAN 1 — MUKA DEPAN
    // ════════════════════════════════════════════════════════════
    let y = 30

    // Logo
    const logoSize = 25
    if (cfg.logoKiriBase64) {
      try { pdf.addImage(cfg.logoKiriBase64, 'PNG', M, y, logoSize, logoSize) } catch {}
    }
    if (cfg.logoKananBase64) {
      try { pdf.addImage(cfg.logoKananBase64, 'PNG', W - M - logoSize, y, logoSize, logoSize) } catch {}
    }
    y += logoSize + 15

    pdf.setFillColor(...BLUE)
    pdf.rect(M, y, W - M * 2, 0.5, 'F')
    y += 6

    pdf.setFontSize(18)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(...BLUE)
    const namaLines = pdf.splitTextToSize(namaKej.toUpperCase(), W - M * 2 - 10)
    pdf.text(namaLines, W / 2, y, { align: 'center' })
    y += namaLines.length * 9 + 4

    if (cfg.tempatKejohanan || kej.lokasi) {
      pdf.setFontSize(11)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(80, 80, 80)
      pdf.text(cfg.tempatKejohanan || kej.lokasi || '', W / 2, y, { align: 'center' })
      y += 7
    }

    const tarikhMula  = kej.tarikhMula  || cfg.tarikhMula  || ''
    const tarikhTamat = kej.tarikhTamat || cfg.tarikhTamat || ''
    if (tarikhMula) {
      pdf.setFontSize(10)
      pdf.setTextColor(60, 60, 60)
      const tStr = tarikhMula === tarikhTamat || !tarikhTamat
        ? fmtTarikh(tarikhMula)
        : `${fmtTarikh(tarikhMula)} — ${fmtTarikh(tarikhTamat)}`
      pdf.text(tStr, W / 2, y, { align: 'center' })
      y += 8
    }

    const PERINGKAT_LABEL = { D: 'Peringkat Daerah', N: 'Peringkat Negeri', K: 'Peringkat Kebangsaan' }
    pdf.setFontSize(9)
    pdf.setTextColor(120, 120, 120)
    pdf.text(PERINGKAT_LABEL[peringkatKej] || '', W / 2, y, { align: 'center' })
    y += 20

    pdf.setFillColor(...BLUE)
    pdf.rect(M, y, W - M * 2, 0.5, 'F')
    y += 10

    // Ringkasan stats dalam kotak
    const stats = [
      { label: 'Sekolah', val: sekolahList.length },
      { label: 'Acara',   val: acaraList.length },
      { label: 'Rekod',   val: Object.keys(rekodMap).length },
    ]
    const boxW = (W - M * 2) / stats.length - 4
    stats.forEach((s, i) => {
      const bx = M + i * (boxW + 4)
      pdf.setFillColor(240, 244, 255)
      pdf.roundedRect(bx, y, boxW, 20, 3, 3, 'F')
      pdf.setFontSize(20)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(...BLUE)
      pdf.text(String(s.val), bx + boxW / 2, y + 12, { align: 'center' })
      pdf.setFontSize(7)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(100, 100, 100)
      pdf.text(s.label.toUpperCase(), bx + boxW / 2, y + 18, { align: 'center' })
    })
    y += 35

    pdf.setFontSize(8)
    pdf.setTextColor(150)
    pdf.text('Dokumen ini dijana secara automatik oleh Sistem KOAM', W / 2, y, { align: 'center' })

    // ════════════════════════════════════════════════════════════
    // HALAMAN 2+ — SENARAI SEKOLAH
    // ════════════════════════════════════════════════════════════
    pdf.addPage()
    hdrHalaman('Senarai Sekolah', 'SENARAI SEKOLAH PESERTA')
    y = 26

    // Group sekolah by kategori
    const sklByKat = sekolahList.reduce((acc, s) => {
      const k = s.kategori || 'Lain-lain'
      if (!acc[k]) acc[k] = []
      acc[k].push(s)
      return acc
    }, {})
    // Susun mengikut urutan dari katList (jenisSekolah unik, ikut urutan kategori)
    const jenisOrder = [...new Set(katList.map(k => k.jenisSekolah).filter(Boolean))]
    const katKeys = [
      ...jenisOrder.filter(k => sklByKat[k]),
      ...Object.keys(sklByKat).filter(k => !jenisOrder.includes(k)),
    ]
    // Label dari jenisSekolah itu sendiri (sudah dinamik)
    const KAT_LABEL = Object.fromEntries(jenisOrder.map(j => [j, j]))

    const sklRows = []
    katKeys.forEach(kat => {
      sklByKat[kat].forEach((s, i) => {
        sklRows.push([
          i + 1,
          s.namaSekolah || s.kodSekolah || '—',
          s.kodSekolah  || '—',
          KAT_LABEL[kat] || kat,
        ])
      })
    })

    autoTable(pdf, {
      startY: y,
      head: [['#', 'Nama Sekolah', 'Kod', 'Kategori']],
      body: sklRows,
      styles:      { fontSize: 8, cellPadding: 2.5 },
      headStyles:  { fillColor: BLUE, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 32, fontStyle: 'bold' },
        3: { cellWidth: 40 },
      },
      theme: 'striped',
    })

    // ════════════════════════════════════════════════════════════
    // HALAMAN — JADUAL ACARA (per hari)
    // ════════════════════════════════════════════════════════════
    // Group jadual by tarikh
    const jadualByDay = jadualList.reduce((acc, j) => {
      const d = j.tarikhAcara
      if (!acc[d]) acc[d] = []
      acc[d].push(j)
      return acc
    }, {})
    const days = Object.keys(jadualByDay).sort()

    if (days.length > 0) {
      pdf.addPage()
      hdrHalaman('Jadual Acara', 'JADUAL ACARA KEJOHANAN')
      y = 26

      days.forEach((date, di) => {
        const items = jadualByDay[date]
        const dayLabel = `HARI ${di + 1} — ${fmtTarikh(date).toUpperCase()}`

        const rows = items.map(j => {
          const acara  = acaraMap[j.aceraId || j.acaraId] || {}
          return [
            acara.noAcara  || j.aceraId || '—',
            j.masaMula     || '—',
            acara.namaAcara || '—',
            acara.jantina  === 'L' ? 'Lelaki' : acara.jantina === 'P' ? 'Perempuan' : '—',
            katLabel(acara.kategoriKod, katList) || '—',
            j.lokasi || acara.lokasi || cfg.tempatKejohanan || '—',
          ]
        })

        autoTable(pdf, {
          startY: y,
          head: [[{ content: dayLabel, colSpan: 6, styles: { fillColor: [30, 60, 130], fontStyle: 'bold', halign: 'center', fontSize: 8 } }],
                 ['No.', 'Masa', 'Nama Acara', 'Jantina', 'Kat', 'Lokasi']],
          body: rows,
          styles:      { fontSize: 7.5, cellPadding: 2 },
          headStyles:  { fillColor: [220, 225, 245], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 7 },
          columnStyles: {
            0: { cellWidth: 12, halign: 'center' },
            1: { cellWidth: 16, halign: 'center' },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 22 },
            4: { cellWidth: 12, halign: 'center' },
            5: { cellWidth: 40 },
          },
          theme: 'grid',
          didParseCell: (data) => {
            if (data.row.index === 0 && data.section === 'head') {
              data.cell.styles.fillColor = [30, 60, 130]
              data.cell.styles.textColor = [255, 255, 255]
            }
          },
        })
        y = pdf.lastAutoTable.finalY + 6
        if (y > 260 && di < days.length - 1) { pdf.addPage(); hdrHalaman('Jadual Acara', ''); y = 16 }
      })
    }

    // ════════════════════════════════════════════════════════════
    // HALAMAN — KEPUTUSAN RASMI (per hari → per acara)
    // ════════════════════════════════════════════════════════════
    // Bina senarai acara rasmi + susun ikut hari
    const rasmiItems = [] // { acara, heat, tarikh }
    days.forEach(date => {
      jadualByDay[date].forEach(j => {
        const aId  = j.aceraId || j.acaraId
        const heat = finalHeatMap[aId]
        if (!heat) return
        const acara = acaraMap[aId]
        if (!acara) return
        rasmiItems.push({ acara, heat, tarikh: date })
      })
    })
    // Juga tambah acara rasmi yang tiada dalam jadual
    Object.entries(finalHeatMap).forEach(([aId, heat]) => {
      if (rasmiItems.find(r => r.acara.id === aId)) return
      const acara = acaraMap[aId]
      if (!acara) return
      rasmiItems.push({ acara, heat, tarikh: '' })
    })

    if (rasmiItems.length > 0) {
      pdf.addPage()
      hdrHalaman('Keputusan Rasmi', 'KEPUTUSAN RASMI')
      y = 26

      // Group by tarikh
      const rasmiByDay = rasmiItems.reduce((acc, r) => {
        const d = r.tarikh || 'Lain-lain'
        if (!acc[d]) acc[d] = []
        acc[d].push(r)
        return acc
      }, {})
      const rDays = Object.keys(rasmiByDay).sort()

      rDays.forEach((date, di) => {
        const dayItems = rasmiByDay[date]
        const dayLabel = date
          ? `HARI ${days.indexOf(date) + 1} — ${fmtTarikh(date).toUpperCase()}`
          : 'LAIN-LAIN'

        // Tulis label hari
        if (y > 250) { pdf.addPage(); hdrHalaman('Keputusan Rasmi', ''); y = 16 }
        pdf.setFillColor(30, 60, 130)
        pdf.rect(M, y, W - M * 2, 7, 'F')
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(255, 255, 255)
        pdf.text(dayLabel, W / 2, y + 4.8, { align: 'center' })
        pdf.setTextColor(0, 0, 0)
        y += 10

        dayItems.forEach(({ acara, heat }) => {
          if (y > 255) { pdf.addPage(); hdrHalaman('Keputusan Rasmi', ''); y = 16 }

          const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
          const isRelay  = acara.jenisAcara === 'relay'

          // Peserta sorted
          const peserta = (heat.peserta || [])
            .filter(p => p.rankDalamHeat && p.status === 'selesai')
            .sort((a, b) => (a.rankDalamHeat || 99) - (b.rankDalamHeat || 99))
            .slice(0, 3) // top 3 sahaja

          if (peserta.length === 0) return

          // Semak rekod
          const rKey    = rekodKey(acara.namaAcara, acara.jantina, acara.kategoriKod, peringkatKej)
          const rekodDoc = rekodMap[rKey] || rekodMap[rKey + '_tuntutan']
          const top1    = peserta[0]
          const adaRekod = rekodDoc && top1 && (() => {
            const np = Number(top1.keputusan)
            const rp = Number(rekodDoc.prestasi)
            return isPadang ? np > rp : np < rp
          })()

          // Header acara
          const jantinaLabel = acara.jantina === 'L' ? 'Lelaki' : acara.jantina === 'P' ? 'Perempuan' : ''
          const acaraHeader  = `${acara.noAcara ? `[${acara.noAcara}] ` : ''}${acara.namaAcara}  ${jantinaLabel}  Kat ${katLabel(acara.kategoriKod, katList) || '—'}`

          const rows = peserta.map((p, i) => {
            const pingat = ['🥇', '🥈', '🥉'][i] || ''
            const isRK   = i === 0 && adaRekod
            return [
              `${pingat} ${p.rankDalamHeat}`,
              isRelay ? (p.kodSekolah || '—') : (p.namaAtlet || '—'),
              isRelay ? '' : (p.kodSekolah || '—'),
              fmtPrestasi(p.keputusan, acara.jenisAcara) + (isRK ? ' ★RD' : ''),
            ]
          })

          autoTable(pdf, {
            startY: y,
            head: [[{
              content: acaraHeader,
              colSpan: 4,
              styles: { fillColor: [235, 240, 255], textColor: [0, 30, 100], fontStyle: 'bold', fontSize: 7.5 },
            }]],
            body: rows,
            styles:      { fontSize: 7.5, cellPadding: 1.8 },
            headStyles:  { fontSize: 7.5 },
            columnStyles: {
              0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
              1: { cellWidth: 'auto' },
              2: { cellWidth: 35 },
              3: { cellWidth: 30, halign: 'right', fontStyle: 'bold', textColor: [0, 51, 153] },
            },
            theme: 'plain',
            tableLineColor: [220, 220, 220],
            tableLineWidth: 0.1,
          })
          y = pdf.lastAutoTable.finalY + 4
        })

        y += 4
      })
    }

    // ════════════════════════════════════════════════════════════
    // HALAMAN — REKOD SEMASA
    // ════════════════════════════════════════════════════════════
    const rekodList = Object.values(rekodMap)
    if (rekodList.length > 0) {
      pdf.addPage()
      hdrHalaman('Rekod Semasa', 'REKOD SEMASA KEJOHANAN')
      y = 26

      // Group by kategori
      const rekodByKat = rekodList.reduce((acc, r) => {
        const k = r.kategoriKod || 'Lain-lain'
        if (!acc[k]) acc[k] = []
        acc[k].push(r)
        return acc
      }, {})
      const katMap = Object.fromEntries(katList.map(k => [k.kod, k]))
      const katKeys2 = [
        ...katList.map(k => k.kod).filter(k => rekodByKat[k]),
        ...Object.keys(rekodByKat).filter(k => !katList.find(kl => kl.kod === k)),
      ]

      const PERINGKAT = { D: 'Daerah', N: 'Negeri', K: 'Kebangsaan' }

      katKeys2.forEach(katKod => {
        if (y > 245) { pdf.addPage(); hdrHalaman('Rekod Semasa', ''); y = 16 }
        const kat  = katMap[katKod]
        const rows = (rekodByKat[katKod] || [])
          .sort((a, b) => (a.namaAcara || '').localeCompare(b.namaAcara || '') || (a.jantina || '').localeCompare(b.jantina || ''))
          .map(r => [
            r.namaAcara   || '—',
            r.jantina === 'L' ? 'L' : 'P',
            PERINGKAT[r.peringkat] || r.peringkat || '—',
            r.namaAtlet   || '—',
            r.namaSekolah || r.kodSekolah || '—',
            r.tarikhRekod || '—',
            fmtPrestasi(r.prestasi, r.unit === 'm' ? 'padang_lompat' : 'lorong'),
          ])

        autoTable(pdf, {
          startY: y,
          head: [[{
            content: `${kat?.nama || katKod}${kat ? ` (Kat ${katKod})` : ''}`.toUpperCase(),
            colSpan: 7,
            styles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
          }],
          ['Acara', 'Jan', 'Peringkat', 'Atlet', 'Sekolah', 'Tarikh', 'Prestasi']],
          body: rows,
          styles:      { fontSize: 7, cellPadding: 2 },
          headStyles:  { fillColor: [220, 225, 245], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 6.5 },
          columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 8,  halign: 'center' },
            2: { cellWidth: 20 },
            3: { cellWidth: 38 },
            4: { cellWidth: 35 },
            5: { cellWidth: 20 },
            6: { cellWidth: 22, halign: 'right', fontStyle: 'bold', textColor: [0, 51, 153] },
          },
          theme: 'striped',
          didParseCell: (data) => {
            if (data.row.index === 0 && data.section === 'head') {
              data.cell.styles.fillColor = BLUE
              data.cell.styles.textColor = [255, 255, 255]
            }
          },
        })
        y = pdf.lastAutoTable.finalY + 5
      })
    }

    // ════════════════════════════════════════════════════════════
    // HALAMAN — OLAHRAGAWAN & OLAHRAGAWATI
    // ════════════════════════════════════════════════════════════
    const pilihanKeys = Object.keys(pilihan)
    if (pilihanKeys.length > 0) {
      pdf.addPage()
      hdrHalaman('Olahragawan & Olahragawati', 'OLAHRAGAWAN & OLAHRAGAWATI KEJOHANAN')
      y = 26

      const katMap2 = Object.fromEntries(katList.map(k => [k.kod, k]))

      // Group pilihan by kategori
      const katDariPilihan = [...new Set(pilihanKeys.map(k => k.split('_')[0]))]
        .sort((a, b) => {
          const au = katMap2[a]?.urutan ?? 99
          const bu = katMap2[b]?.urutan ?? 99
          return au - bu || a.localeCompare(b)
        })

      const rows = []
      katDariPilihan.forEach(katKod => {
        const kat  = katMap2[katKod]
        const katLabel = kat ? `Kat ${katKod} — ${kat.nama || ''}` : `Kat ${katKod}`
        ;['L', 'P'].forEach(jantina => {
          const pil  = pilihan[`${katKod}_${jantina}`]
          if (!pil) return
          const live = mataMap[pil.noKP] || {}
          const E    = live.pingat_emas   || 0
          const P    = live.pingat_perak  || 0
          const G    = live.pingat_gangsa || 0
          const mata = live.jumlahMata    || 0
          rows.push([
            katLabel,
            jantina === 'L' ? 'Olahragawan' : 'Olahragawati',
            pil.namaAtlet    || '—',
            pil.namaSekolah  || pil.kodSekolah || '—',
            `E:${E}  P:${P}  G:${G}`,
            mata + ' mata',
          ])
        })
      })

      if (rows.length > 0) {
        autoTable(pdf, {
          startY: y,
          head: [['Kategori', 'Anugerah', 'Nama Atlet', 'Sekolah', 'Pingat', 'Jumlah Mata']],
          body: rows,
          styles:      { fontSize: 8.5, cellPadding: 3 },
          headStyles:  { fillColor: BLUE, fontStyle: 'bold', fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 42 },
            1: { cellWidth: 28 },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 40 },
            4: { cellWidth: 22, halign: 'center' },
            5: { cellWidth: 22, halign: 'center', fontStyle: 'bold', textColor: [0, 51, 153] },
          },
          theme: 'grid',
          alternateRowStyles: { fillColor: [245, 247, 255] },
        })
      } else {
        pdf.setFontSize(9)
        pdf.setTextColor(150)
        pdf.text('Tiada pilihan olahragawan/wati lagi.', W / 2, y + 10, { align: 'center' })
      }
    }

    // ── Nombor halaman semua halaman ──
    nomorHalaman()

    // ── Simpan ──
    const tarikh = new Date().toISOString().slice(0, 10)
    pdf.save(`BukuKejohanan_${namaKej.replace(/\s+/g, '_')}_${tarikh}.pdf`)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-base font-bold text-[#003399]">Buku Kejohanan</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Jana PDF komprehensif — Jadual, Keputusan, Rekod, Olahragawan
        </p>
      </div>

      {/* Kandungan PDF */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <p className="text-xs font-bold text-gray-600 mb-3 uppercase tracking-wide">Kandungan PDF</p>
        <div className="space-y-2">
          {[
            { icon: '📄', label: 'Muka Depan', desc: 'Logo, nama kejohanan, tarikh, lokasi, statistik ringkas' },
            { icon: '🏫', label: 'Senarai Sekolah', desc: 'Semua sekolah peserta grouped by kategori' },
            { icon: '📅', label: 'Jadual Acara', desc: 'Jadual lengkap per hari — masa, nama acara, lokasi' },
            { icon: '🏆', label: 'Keputusan Rasmi', desc: 'Tempat 1-3 per acara yang telah RASMI, grouped by hari' },
            { icon: '⭐', label: 'Rekod Semasa', desc: 'Semua rekod aktif, grouped by kategori' },
            { icon: '🥇', label: 'Olahragawan & Olahragawati', desc: 'Pilihan admin per kategori dengan mata terkini' },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
              <span className="text-base w-6 text-center shrink-0">{icon}</span>
              <div>
                <p className="text-xs font-semibold text-gray-700">{label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview data */}
      {preview && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs font-bold text-blue-700 mb-2">Data Dimuatkan</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Sekolah',       val: preview.jumlahSekolah },
              { label: 'Acara',         val: preview.jumlahAcara },
              { label: 'Acara Rasmi',   val: preview.jumlahRasmi },
              { label: 'Rekod',         val: preview.jumlahRekod },
              { label: 'Pilihan Atlet', val: preview.jumlahPilihan },
            ].map(({ label, val }) => (
              <div key={label} className="bg-white rounded-lg py-2 border border-blue-100">
                <p className="text-lg font-black text-[#003399]">{val}</p>
                <p className="text-[9px] text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mesej */}
      {msg && (
        <div className={`px-4 py-3 rounded-lg text-xs font-medium border ${
          msg.type === 'ok'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      {/* Progress */}
      {loading && progress && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
          <svg className="w-4 h-4 animate-spin text-[#003399] shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          {progress}
        </div>
      )}

      {/* Butang Jana */}
      <button
        onClick={handleJana}
        disabled={loading}
        className="w-full py-3 bg-[#003399] hover:bg-[#002280] disabled:bg-gray-300 text-white font-bold text-sm rounded-xl shadow-sm transition-colors"
      >
        {loading ? 'Menjana PDF…' : '📥  Jana Buku Kejohanan PDF'}
      </button>

      {/* Nota */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[10px] text-amber-700 space-y-0.5">
        <p className="font-bold">Nota:</p>
        <p>· Hanya acara dengan status RASMI akan muncul dalam bahagian Keputusan.</p>
        <p>· Nilai mata Olahragawan/wati adalah terkini (dikira semasa jana PDF).</p>
        <p>· PDF mengambil masa 5–15 saat bergantung jumlah acara rasmi.</p>
      </div>
    </div>
  )
}
