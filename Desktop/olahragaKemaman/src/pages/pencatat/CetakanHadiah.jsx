/**
 * CetakanHadiah.jsx — /dashboard/cetakanhadiah
 *
 * Print slip hadiah (Juruhebah / Hadiah / Fail) tanpa perlu
 * melalui InputKeputusan. Browse by hari → klik acara → cetak.
 *
 * Logic PDF: sama dengan handleCetakHasil dalam InputKeputusan.
 * Roles: pencatat, admin, superadmin, pengurus_teknik
 */

import { useState, useEffect, useCallback } from 'react'
import {
  collection, getDocs, getDoc, doc, query, orderBy, where,
} from 'firebase/firestore'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db } from '../../firebase/config'
import { selectFinalists } from '../../utils/finalistUtils'

// ─── PDF Generator (sama logik dengan InputKeputusan handleCetakHasil) ─────────

async function cetakHadiahPDF({
  acara, finalHeat, allHeats,
  sekolahMap, kategoriMap,
  kejohananData, homeCfg, finalSetup,
  cetakBilangan, peringkatKej,
}) {
  const isPadang  = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
  const isRelay   = acara.jenisAcara === 'relay'

  // Rekod
  const rekodNamaCetak = acara.namaAcaraPendek || acara.namaAcara || ''
  const rKey = [rekodNamaCetak, acara.jantina, acara.kategoriKod, peringkatKej]
    .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')

  const [rSnap, rTuntSnap] = await Promise.all([
    getDoc(doc(db, 'rekod', rKey)).catch(() => null),
    getDoc(doc(db, 'rekod', rKey + '_tuntutan')).catch(() => null),
  ])

  let rekodDoc = null, isRekodBaru = false
  if (rTuntSnap?.exists() && rTuntSnap.data().kejohananId === kejohananData?.id) {
    rekodDoc = rTuntSnap.data(); isRekodBaru = true
  } else if (rSnap?.exists() && rSnap.data().statusRekod === 'aktif') {
    rekodDoc = rSnap.data(); isRekodBaru = false
  }

  function imgFmt(b64) {
    if (!b64) return 'PNG'
    return (b64.startsWith('data:image/jpeg') || b64.startsWith('data:image/jpg')) ? 'JPEG' : 'PNG'
  }

  // Helpers
  function fmtPrestasi(val) {
    if (val == null || val === '') return '—'
    const n = Number(val)
    if (isNaN(n)) return String(val)
    if (isPadang) return `${n.toFixed(2)} m`
    const min = Math.floor(n / 60)
    const sek = (n % 60).toFixed(2).padStart(5, '0')
    return min > 0 ? `${min}:${sek}` : `${Number(sek).toFixed(2)}s`
  }

  function fmtTarikh(t) {
    if (!t) return '—'
    return new Date(t + 'T00:00:00').toLocaleDateString('ms-MY', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  }

  // Peserta final
  const pesertaFinal = (finalHeat.peserta || [])
    .filter(p => p.rankDalamHeat && (p.status === 'selesai' || p.keputusan != null))
    .sort((a, b) => a.rankDalamHeat - b.rankDalamHeat)
    .slice(0, cetakBilangan)

  // Q/q map
  const isSaringanHeat = !['final', 'terus_final'].includes(finalHeat?.fasa) && finalHeat?.peringkat !== 'final'
  const cetakQMap = new Map()
  if (isSaringanHeat && acara) {
    selectFinalists(allHeats, acara, finalSetup).forEach(f => {
      const key = isRelay ? f.kodSekolah : f.noBib
      if (key) cetakQMap.set(key, f.qualifyType || 'q')
    })
  }

  const namaKej  = homeCfg?.tajukUtama || kejohananData?.namaKejohanan || 'Kejohanan Olahraga'
  const katLabel = kategoriMap[acara.kategoriKod] || acara.kategoriKod || '—'
  const tarikh   = fmtTarikh(acara.tarikhAcara)
  const now      = new Date().toLocaleString('ms-MY')

  const SALINAN = [
    { label: 'JURUHEBAH', clr: [0, 51, 153],  tblSize: 13 },
    { label: 'HADIAH',    clr: [0, 120, 50],  tblSize: 10 },
    { label: 'FAIL',      clr: [70, 70, 70],  tblSize: 10 },
  ]

  const pdf    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const M      = 15
  const W      = pdf.internal.pageSize.getWidth()
  const H      = pdf.internal.pageSize.getHeight()
  let isFirst  = true

  function buatHeader(clr) {
    let y = 10
    const logoW = 18, logoH = 18
    if (homeCfg?.logoKiriBase64) {
      try { pdf.addImage(homeCfg.logoKiriBase64, imgFmt(homeCfg.logoKiriBase64), M, y, logoW, logoH) } catch {}
    }
    if (homeCfg?.logoKananBase64) {
      try { pdf.addImage(homeCfg.logoKananBase64, imgFmt(homeCfg.logoKananBase64), W - M - logoW, y, logoW, logoH) } catch {}
    }
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(0, 0, 0)
    pdf.text(namaKej, W / 2, y + 7, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor(60, 60, 60)
    pdf.text('KEPUTUSAN RASMI', W / 2, y + 13, { align: 'center' })
    pdf.setFontSize(7.5)
    pdf.setTextColor(120, 120, 120)
    pdf.text(tarikh, W / 2, y + 18.5, { align: 'center' })
    pdf.setDrawColor(...clr)
    pdf.setLineWidth(0.7)
    pdf.line(M, y + 22, W - M, y + 22)
    return y + 28
  }

  for (const sal of SALINAN) {
    if (!isFirst) pdf.addPage()
    isFirst = false

    let y = buatHeader(sal.clr)

    // Label salinan
    const lblW = 36, lblH = 8
    pdf.setFillColor(...sal.clr)
    pdf.rect(W - M - lblW, y, lblW, lblH, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(255, 255, 255)
    pdf.text(sal.label, W - M - lblW / 2, y + 5.5, { align: 'center' })
    pdf.setTextColor(0, 0, 0)
    y += 12

    pdf.setDrawColor(200, 200, 200)
    pdf.setLineWidth(0.3)
    pdf.line(M, y, W - M, y)
    y += 6

    // Info acara
    const col2 = M + 32
    const infoRows = [
      ['No. Acara', String(acara.noAcara || '—')],
      ['Kategori',  katLabel],
      ['Acara',     acara.namaAcara || '—'],
    ]
    pdf.setFontSize(9.5)
    infoRows.forEach(([lbl, val]) => {
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(110, 110, 110)
      pdf.text(lbl, M, y)
      pdf.text(':', col2 - 4, y)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(0, 0, 0)
      pdf.text(val, col2, y)
      y += 6.5
    })
    y += 4

    pdf.setDrawColor(200, 200, 200)
    pdf.setLineWidth(0.3)
    pdf.line(M, y, W - M, y)
    y += 4

    // Jadual keputusan
    const MEDAL = { 1: 'EMAS', 2: 'PERAK', 3: 'GANGSA', 4: 'T4', 5: 'T5' }
    const tblHead = isRelay
      ? [['No.', 'Pasukan / Sekolah', 'Ahli Pasukan', 'Masa', 'Status']]
      : [['No.', 'Nama Atlet', 'Sekolah', 'Prestasi', 'Status']]

    const tblBody = pesertaFinal.map(p => {
      const flagged     = ['DNS', 'DNF', 'DQ'].includes(p.status)
      const qType       = !flagged && isSaringanHeat
        ? (cetakQMap.get(isRelay ? p.kodSekolah : p.noBib) || null) : null
      const statusLabel = flagged ? p.status : (qType || (MEDAL[p.rankDalamHeat] || ''))
      const prestasi    = flagged ? '—' : fmtPrestasi(p.keputusan)
      if (isRelay) {
        const ahli = (p.ahliPasukan || []).map(a => a.namaAtlet || a.noBib || '').filter(Boolean).join(', ')
        return [String(p.rankDalamHeat), sekolahMap[p.kodSekolah] || p.kodSekolah || '—', ahli || '—', prestasi, statusLabel]
      }
      return [String(p.rankDalamHeat), p.namaAtlet || '—', sekolahMap[p.kodSekolah] || p.kodSekolah || '—', prestasi, statusLabel]
    })

    autoTable(pdf, {
      startY: y, head: tblHead, body: tblBody,
      styles: {
        fontSize: sal.tblSize,
        cellPadding: sal.tblSize >= 12 ? 3 : 2.5,
        minCellHeight: sal.tblSize >= 12 ? 8 : 7,
        overflow: 'hidden',
      },
      headStyles: {
        fillColor: sal.clr, textColor: [255, 255, 255], fontStyle: 'bold',
        fontSize: sal.tblSize - 1, halign: 'center', minCellHeight: 8,
      },
      columnStyles: isRelay ? {
        0: { halign: 'center', cellWidth: 12, fontStyle: 'bold' },
        1: { cellWidth: 50 }, 2: { cellWidth: 'auto' },
        3: { halign: 'center', cellWidth: 26, fontStyle: 'bold', textColor: [0, 51, 153] },
        4: { halign: 'center', cellWidth: 28, fontStyle: 'bold', textColor: [180, 60, 60] },
      } : {
        0: { halign: 'center', cellWidth: 12, fontStyle: 'bold' },
        1: { cellWidth: 'auto' }, 2: { cellWidth: 55 },
        3: { halign: 'center', cellWidth: 26, fontStyle: 'bold', textColor: [0, 51, 153] },
        4: { halign: 'center', cellWidth: 28, fontStyle: 'bold', textColor: [180, 60, 60] },
      },
      alternateRowStyles: { fillColor: [248, 248, 252] },
      margin: { left: M, right: M },
      didParseCell: (data) => {
        if (data.section === 'body') {
          const rank = pesertaFinal[data.row.index]?.rankDalamHeat
          if (rank === 1) data.cell.styles.fillColor = [255, 248, 210]
          else if (rank === 2) data.cell.styles.fillColor = [242, 242, 248]
          else if (rank === 3) data.cell.styles.fillColor = [255, 244, 232]
        }
      },
    })

    y = pdf.lastAutoTable.finalY + 5

    // Kotak rekod
    if (rekodDoc) {
      const PLAB = { D: 'Daerah', N: 'Negeri', K: 'Kebangsaan' }
      const pLabel = PLAB[peringkatKej] || peringkatKej
      pdf.setLineWidth(0.3); pdf.setFontSize(8)

      if (isRekodBaru) {
        const hasLama = rekodDoc.prestasiLama != null
        const boxH   = hasLama ? 18 : 14
        pdf.setFillColor(255, 248, 215); pdf.setDrawColor(200, 145, 30)
        pdf.rect(M, y, W - M * 2, boxH, 'FD')
        pdf.setFont('helvetica', 'bold'); pdf.setTextColor(130, 60, 0)
        pdf.text(
          '[RBK — REKOD BARU KEJOHANAN]  ' + fmtPrestasi(rekodDoc.prestasi) +
          '  --  ' + (rekodDoc.namaAtlet || '—') +
          (rekodDoc.namaSekolah ? ' (' + rekodDoc.namaSekolah + ')' : ''),
          M + 3, y + 5.5
        )
        if (hasLama) {
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(100, 70, 20)
          pdf.text(
            'Rekod Lama: ' + fmtPrestasi(rekodDoc.prestasiLama) +
            '  --  ' + (rekodDoc.namaLama || '—') +
            (rekodDoc.lokasiLama ? ' (' + rekodDoc.lokasiLama + ')' : '') +
            (rekodDoc.tahunLama ? '  ' + rekodDoc.tahunLama : ''),
            M + 3, y + 12
          )
        } else {
          pdf.setFont('helvetica', 'normal'); pdf.setTextColor(100, 70, 20)
          pdf.text('Rekod Pertama Ditetapkan', M + 3, y + 12)
        }
        pdf.setTextColor(0, 0, 0); y += boxH + 4
      } else {
        pdf.setFillColor(235, 242, 255); pdf.setDrawColor(150, 170, 220)
        pdf.rect(M, y, W - M * 2, 10, 'FD')
        pdf.setFont('helvetica', 'normal'); pdf.setTextColor(40, 60, 130)
        const rThn = rekodDoc.tarikhRekod ? String(rekodDoc.tarikhRekod).slice(0, 4) : ''
        pdf.text(
          'Rekod ' + pLabel + ':  ' + fmtPrestasi(rekodDoc.prestasi) +
          '  --  ' + (rekodDoc.namaAtlet || '—') +
          (rekodDoc.namaSekolah ? ' (' + rekodDoc.namaSekolah + ')' : '') +
          (rThn ? '  ' + rThn : ''),
          M + 3, y + 7
        )
        pdf.setTextColor(0, 0, 0); y += 14
      }
    }

    // Kotak MRKL
    const mrkl = pesertaFinal.find(p => p.samaiRekod)
    if (mrkl) {
      pdf.setLineWidth(0.3); pdf.setFontSize(8)
      pdf.setFillColor(209, 250, 229); pdf.setDrawColor(20, 150, 100)
      pdf.rect(M, y, W - M * 2, 10, 'FD')
      pdf.setFont('helvetica', 'bold'); pdf.setTextColor(10, 80, 50)
      const mrklSkol = isRelay ? '' : (sekolahMap[mrkl.kodSekolah] || mrkl.kodSekolah || '')
      pdf.text(
        '[MRKL — MENYAMAI REKOD KEJOHANAN LEPAS]  ' + fmtPrestasi(mrkl.keputusan) +
        '  --  ' + (mrkl.namaAtlet || sekolahMap[mrkl.kodSekolah] || '—') +
        (mrklSkol ? ' (' + mrklSkol + ')' : ''),
        M + 3, y + 7
      )
      pdf.setTextColor(0, 0, 0); y += 14
    }

    // Footer
    const footY = H - 18
    pdf.setDrawColor(...sal.clr); pdf.setLineWidth(0.4)
    pdf.line(M, footY, W - M, footY)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(80, 80, 80)
    pdf.text('Pegawai Teknikal: _______________________', M, footY + 6)
    pdf.text('Tandatangan: _______________________', W / 2, footY + 6)
    pdf.setFontSize(7); pdf.setTextColor(170, 170, 170)
    pdf.text(`Dicetak: ${now}`, M, footY + 12)
    pdf.setTextColor(0, 0, 0)
  }

  pdf.save(`Keputusan_No${acara.noAcara || 'Acara'}_${katLabel}.pdf`)
}

// ─── Komponen ────────────────────────────────────────────────────────────────

const MEDAL_CLR = {
  1: 'text-yellow-600', 2: 'text-gray-500', 3: 'text-orange-600',
  4: 'text-gray-400',   5: 'text-gray-400',
}
const MEDAL_LBL = { 1: 'EMAS', 2: 'PERAK', 3: 'GANGSA', 4: 'T4', 5: 'T5' }

export default function CetakanHadiah() {
  // Kejohanan
  const [kejList,       setKejList]       = useState([])
  const [selKejId,      setSelKejId]      = useState('')
  const [kejohananData, setKejohananData] = useState(null)

  // Acara (hanya yang ada_keputusan)
  const [acaraList,  setAcaraList]  = useState([])
  const [loadingAcara, setLoadingAcara] = useState(false)

  // Hari filter
  const [selectedHari, setSelectedHari] = useState(null)

  // Acara dipilih
  const [selAcara,    setSelAcara]    = useState(null)
  const [finalHeat,   setFinalHeat]   = useState(null)
  const [allHeats,    setAllHeats]    = useState([])
  const [loadingHeat, setLoadingHeat] = useState(false)

  // Config
  const [sekolahMap,  setSekolahMap]  = useState({})
  const [kategoriMap, setKategoriMap] = useState({})
  const [homeCfg,     setHomeCfg]     = useState({})
  const [finalSetup,  setFinalSetup]  = useState(null)

  // Print
  const [cetakBilangan, setCetakBilangan] = useState(3)
  const [cetakLoading,  setCetakLoading]  = useState(false)
  const [cariTeks, setCariTeks] = useState('')

  // ── Load config sekali ────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'sekolah')),
      getDocs(collection(db, 'kategori')),
      getDoc(doc(db, 'tetapan', 'home')),
      getDoc(doc(db, 'tetapan', 'finalSetup')),
    ]).then(([skSnap, katSnap, homeSnap, fsSnap]) => {
      const sm = {}; skSnap.forEach(d => { sm[d.id] = d.data().namaSekolah || d.id })
      setSekolahMap(sm)
      const km = {}; katSnap.forEach(d => { km[d.id] = d.data().nama || d.id })
      setKategoriMap(km)
      if (homeSnap.exists()) setHomeCfg(homeSnap.data())
      if (fsSnap.exists())   setFinalSetup(fsSnap.data())
    })
  }, [])

  // ── Load senarai kejohanan ────────────────────────────────────────────────

  useEffect(() => {
    getDocs(query(collection(db, 'kejohanan'), orderBy('tarikhMula', 'desc')))
      .then(snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setKejList(list)
        // Auto-pilih aktif atau pertama
        const aktif = list.find(k => k.isAktif) || list[0]
        if (aktif) { setSelKejId(aktif.id); setKejohananData(aktif) }
      })
  }, [])

  // ── Load acara bila kejohanan tukar ──────────────────────────────────────

  useEffect(() => {
    if (!selKejId) return
    setAcaraList([]); setSelAcara(null); setFinalHeat(null)
    setLoadingAcara(true)

    getDocs(query(
      collection(db, 'kejohanan', selKejId, 'acara'),
      where('statusAcara', '==', 'ada_keputusan'),
      orderBy('noAcara', 'asc')
    ))
      .then(snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setAcaraList(list)
        // Auto-pilih hari pertama ada keputusan
        if (list.length > 0) {
          const hariUnik = [...new Set(list.map(a => a.tarikhAcara || 'Tiada Tarikh').filter(Boolean))]
          setSelectedHari(hariUnik[0] || null)
        }
      })
      .finally(() => setLoadingAcara(false))
  }, [selKejId])

  // ── Load heat bila acara dipilih ─────────────────────────────────────────

  const loadHeat = useCallback(async (acara) => {
    if (!acara || !selKejId) return
    setFinalHeat(null); setAllHeats([]); setLoadingHeat(true)
    try {
      const aceraKey = acara.aceraId || acara.id
      const hSnap = await getDocs(
        query(collection(db, 'kejohanan', selKejId, 'acara', aceraKey, 'heat'), orderBy('noHeat', 'asc'))
      )
      const heats = hSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      setAllHeats(heats)
      // Cari final heat: fasa='final'|'terus_final' atau last heat
      const fh = heats.find(h => h.fasa === 'final' || h.fasa === 'terus_final')
        || heats[heats.length - 1]
        || null
      setFinalHeat(fh)
    } finally {
      setLoadingHeat(false)
    }
  }, [selKejId])

  function handleSelectAcara(acara) {
    setSelAcara(acara)
    loadHeat(acara)
  }

  // ── Cetak ────────────────────────────────────────────────────────────────

  async function handleCetak(bilangan) {
    if (!selAcara || !finalHeat) return
    setCetakLoading(true)
    try {
      const PKOD = { daerah: 'D', negeri: 'N', kebangsaan: 'K' }
      const peringkatKej = PKOD[(kejohananData?.peringkat || '').toLowerCase()] || 'D'
      await cetakHadiahPDF({
        acara: selAcara, finalHeat, allHeats,
        sekolahMap, kategoriMap,
        kejohananData, homeCfg, finalSetup,
        cetakBilangan: bilangan, peringkatKej,
      })
    } catch (e) {
      alert('Ralat cetak: ' + e.message)
    } finally {
      setCetakLoading(false)
    }
  }

  // ── Derived data ─────────────────────────────────────────────────────────

  const hariList = [...new Set(acaraList.map(a => a.tarikhAcara || 'Tiada Tarikh'))]

  const acaraHari = acaraList
    .filter(a => (a.tarikhAcara || 'Tiada Tarikh') === selectedHari)
    .filter(a => {
      if (!cariTeks) return true
      const t = cariTeks.toLowerCase()
      return (a.namaAcara || '').toLowerCase().includes(t) ||
             String(a.noAcara || '').includes(t) ||
             (a.kategoriKod || '').toLowerCase().includes(t)
    })

  const pemenang = finalHeat
    ? (finalHeat.peserta || [])
        .filter(p => p.rankDalamHeat && (p.status === 'selesai' || p.keputusan != null))
        .sort((a, b) => a.rankDalamHeat - b.rankDalamHeat)
        .slice(0, 5)
    : []

  const isPadangSelAcara = selAcara && ['padang_lompat', 'padang_balin'].includes(selAcara.jenisAcara)
  function fmtHasil(val) {
    if (val == null || val === '') return '—'
    const n = Number(val)
    if (isNaN(n)) return String(val)
    if (isPadangSelAcara) return `${n.toFixed(2)} m`
    const min = Math.floor(n / 60)
    const sek = (n % 60).toFixed(2).padStart(5, '0')
    return min > 0 ? `${min}:${sek}` : `${Number(sek).toFixed(2)}s`
  }

  function fmtHari(t) {
    if (!t) return 'Tiada Tarikh'
    return new Date(t + 'T00:00:00').toLocaleDateString('ms-MY', {
      weekday: 'short', day: 'numeric', month: 'short',
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* Header + Selector kejohanan */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 bg-white flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-base font-bold text-gray-800">Cetakan Hadiah</h1>
          <p className="text-xs text-gray-400">Cetak slip keputusan (Juruhebah / Hadiah / Fail)</p>
        </div>
        <div className="ml-auto">
          <select
            value={selKejId}
            onChange={e => {
              setSelKejId(e.target.value)
              const kej = kejList.find(k => k.id === e.target.value)
              setKejohananData(kej || null)
            }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#003399]/20"
          >
            {kejList.map(k => (
              <option key={k.id} value={k.id}>{k.namaKejohanan || k.id}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Body — 2 panel */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Panel Kiri: Senarai Acara ── */}
        <div className="w-56 sm:w-64 shrink-0 border-r border-gray-100 flex flex-col bg-gray-50 overflow-hidden">

          {/* Cari */}
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={cariTeks}
              onChange={e => setCariTeks(e.target.value)}
              placeholder="Cari acara..."
              className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#003399]/20"
            />
          </div>

          {/* Tab hari */}
          {hariList.length > 0 && (
            <div className="flex overflow-x-auto border-b border-gray-100 bg-white shrink-0">
              {hariList.map(h => (
                <button key={h}
                  onClick={() => { setSelectedHari(h); setSelAcara(null); setFinalHeat(null) }}
                  className={`px-3 py-2 text-[10px] font-semibold shrink-0 border-b-2 transition-colors whitespace-nowrap ${
                    selectedHari === h
                      ? 'border-[#003399] text-[#003399] bg-blue-50'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >{fmtHari(h)}</button>
              ))}
            </div>
          )}

          {/* Senarai acara */}
          <div className="flex-1 overflow-y-auto py-1">
            {loadingAcara && (
              <p className="text-center text-xs text-gray-400 py-8">Memuatkan...</p>
            )}
            {!loadingAcara && acaraHari.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-8">
                {acaraList.length === 0 ? 'Tiada acara selesai' : 'Tiada hasil carian'}
              </p>
            )}
            {acaraHari.map(a => {
              const isActive = selAcara?.id === a.id
              const kat = kategoriMap[a.kategoriKod] || a.kategoriKod || ''
              return (
                <button key={a.id}
                  onClick={() => handleSelectAcara(a)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors ${
                    isActive ? 'bg-[#003399] text-white' : 'hover:bg-white text-gray-700'
                  }`}
                >
                  <p className={`text-[10px] font-mono font-bold ${isActive ? 'text-blue-200' : 'text-[#003399]'}`}>
                    No. {a.noAcara}
                  </p>
                  <p className={`text-xs font-semibold leading-tight mt-0.5 ${isActive ? 'text-white' : 'text-gray-800'}`}>
                    {a.namaAcara}
                  </p>
                  <p className={`text-[10px] mt-0.5 ${isActive ? 'text-blue-200' : 'text-gray-400'}`}>
                    {kat} · {a.jantina === 'L' ? 'Lelaki' : 'Perempuan'}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Footer count */}
          <div className="px-3 py-2 border-t border-gray-100 bg-white">
            <p className="text-[9px] text-gray-400">{acaraList.length} acara ada keputusan</p>
          </div>
        </div>

        {/* ── Panel Kanan: Preview + Cetak ── */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* Empty state */}
          {!selAcara && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <p className="text-4xl mb-3">🏆</p>
              <p className="text-sm font-semibold text-gray-500">Pilih acara untuk melihat keputusan</p>
              <p className="text-xs text-gray-400 mt-1">Hanya acara yang ada keputusan tersenarai</p>
            </div>
          )}

          {/* Preview acara */}
          {selAcara && (
            <div className="max-w-lg space-y-4">

              {/* Info acara */}
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-mono font-bold text-[#003399]">No. {selAcara.noAcara}</p>
                    <h2 className="text-sm font-bold text-gray-800 mt-0.5">{selAcara.namaAcara}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {kategoriMap[selAcara.kategoriKod] || selAcara.kategoriKod} · {selAcara.jantina === 'L' ? 'Lelaki' : 'Perempuan'}
                    </p>
                  </div>
                  {finalHeat && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-green-100 text-green-700 shrink-0">
                      {finalHeat.fasa === 'final' || finalHeat.fasa === 'terus_final' ? 'FINAL' : `Heat ${finalHeat.noHeat}`}
                    </span>
                  )}
                </div>
              </div>

              {/* Loading heat */}
              {loadingHeat && (
                <div className="bg-white border border-gray-200 rounded-xl p-6 text-center">
                  <p className="text-sm text-gray-400">Memuatkan keputusan...</p>
                </div>
              )}

              {/* Pemenang */}
              {!loadingHeat && finalHeat && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Keputusan</p>
                  </div>
                  {pemenang.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-6">Tiada keputusan direkod</p>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {pemenang.map(p => {
                        const isRelay  = selAcara.jenisAcara === 'relay'
                        const nama     = isRelay
                          ? (sekolahMap[p.kodSekolah] || p.kodSekolah || '—')
                          : (p.namaAtlet || '—')
                        const sekolah  = isRelay
                          ? (p.ahliPasukan || []).map(a => a.namaAtlet).filter(Boolean).join(', ')
                          : (sekolahMap[p.kodSekolah] || p.kodSekolah || '—')
                        const hasil = fmtHasil(p.keputusan)
                        return (
                          <div key={p.noBib || p.kodSekolah || p.rankDalamHeat}
                            className="flex items-center gap-3 px-4 py-3">
                            <span className={`text-lg font-black w-8 text-center shrink-0 ${MEDAL_CLR[p.rankDalamHeat] || 'text-gray-400'}`}>
                              {p.rankDalamHeat}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-800 truncate">{nama}</p>
                              <p className="text-[10px] text-gray-400 truncate">{sekolah}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs font-black text-[#003399]">{hasil}</p>
                              <p className={`text-[10px] font-bold ${MEDAL_CLR[p.rankDalamHeat] || 'text-gray-400'}`}>
                                {MEDAL_LBL[p.rankDalamHeat] || ''}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Tiada heat */}
              {!loadingHeat && !finalHeat && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <p className="text-sm text-amber-700">Tiada heat dijumpai untuk acara ini.</p>
                </div>
              )}

              {/* Cetak buttons */}
              {!loadingHeat && finalHeat && pemenang.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-gray-500 mb-3">Bilangan pemenang untuk dicetak:</p>
                  <div className="flex gap-2">
                    {[3, 4, 5].map(n => (
                      <button key={n}
                        onClick={() => handleCetak(n)}
                        disabled={cetakLoading}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 ${
                          cetakBilangan === n
                            ? 'bg-[#003399] text-white shadow-sm'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                        onMouseEnter={() => setCetakBilangan(n)}
                      >
                        {cetakLoading && cetakBilangan === n ? '...' : `${n} Teratas`}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 text-center">
                    PDF: 3 salinan (Juruhebah · Hadiah · Fail)
                  </p>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
