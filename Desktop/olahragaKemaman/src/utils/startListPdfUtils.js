/**
 * startListPdfUtils.js
 * ────────────────────
 * Fungsi dikongsi antara StartList (admin) dan InputKeputusan (pencatat):
 *   - WA_LORONG_KUMPULAN_DEFAULT
 *   - deserializeKumpulan
 *   - detectJenisLorong
 *   - assignLorongFinal
 *   - katLabel
 *   - buatStartListPDFUnified
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatPrestasiRekod, tahunRekod, lokasiRekod } from './rekodUtils'

// ─── Kumpulan lorong WA untuk FINAL ──────────────────────────────────────────
export const WA_LORONG_KUMPULAN_DEFAULT = {
  lurus:     [[3,4,5,6],[2,7],[1,8]],
  dua_ratus: [[5,6,7],[3,4,8],[1,2]],
  selekoh:   [[4,5,6,7],[3,8],[1,2]],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deserialize kumpulan lorong dari Firestore (string → number array).
 * Firestore tidak sokong nested arrays → simpan sebagai "3,4,5,6".
 */
export function deserializeKumpulan(data) {
  if (!data || typeof data !== 'object') return null
  const out = {}
  Object.entries(data).forEach(([jenis, grps]) => {
    if (!Array.isArray(grps)) return
    out[jenis] = grps.map(s =>
      String(s).split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v))
    )
  })
  return out
}

/**
 * Auto-detect jenisLorong dari nama acara.
 * Priority: acara.jenisLorong (jika ada) → auto-detect dari nama.
 */
export function detectJenisLorong(acara) {
  if (acara.jenisLorong) return acara.jenisLorong
  const n = (acara.namaAcaraPendek || acara.namaAcara || '').toLowerCase()
  if (/\d\s*x\s*\d|relay/.test(n)) return 'selekoh'
  if (/\b200\s*m/.test(n))         return 'dua_ratus'
  if (/\b400|\b800|\b1500|\b3000|\b5000/.test(n)) return 'selekoh'
  return 'lurus'
}

/**
 * Assign lorong FINAL mengikut WA — kumpulan undian rawak.
 * pesertaSorted: sudah disusun rank 1 = terbaik/terpantas.
 * jenisLorong: 'lurus' | 'dua_ratus' | 'selekoh'
 * lorongKumpulan: override kumpulan (dari wa_config), atau null untuk guna default.
 * kumpulanOverride: override terus (satu jenis sahaja).
 */
export function assignLorongFinal(pesertaSorted, jenisLorong, lorongKumpulan, kumpulanOverride) {
  const pool     = lorongKumpulan || WA_LORONG_KUMPULAN_DEFAULT
  const kumpulan = kumpulanOverride || pool[jenisLorong] || pool.lurus
  const result   = pesertaSorted.map(p => ({ ...p }))
  let rankIdx    = 0

  kumpulan.forEach(lanePool => {
    const count = Math.min(lanePool.length, result.length - rankIdx)
    if (count <= 0) return
    const shuffled = [...lanePool].sort(() => Math.random() - 0.5)
    for (let i = 0; i < count; i++) {
      result[rankIdx + i].lorong = shuffled[i]
    }
    rankIdx += count
  })

  return result.sort((a, b) => (a.lorong ?? 99) - (b.lorong ?? 99))
}

/**
 * Bina label kategori dari kategoriList.
 */
export function katLabel(kod, kategoriList = []) {
  if (!kod) return '—'
  const kat = kategoriList.find(k => k.kod === kod)
  return kat?.label || kod
}

// ─── PDF Unified — Start List 4 Salinan ──────────────────────────────────────
// Setiap heat → 4 muka surat: Juruhebah | Call Room | Teknikal | Fail
// Salinan box (X) di header kanan. Kolum berbeza mengikut salinan.

export function buatStartListPDFUnified({
  acara, heats, namaKej, jadual, rekodDNK = { D: null, N: null, K: null },
  namaSekolahMap = {}, kategoriList = [], logoKiri = null, logoKanan = null,
}) {
  const isPadang       = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
  const isMass         = acara.jenisAcara === 'mass_start'
  const isRelay        = acara.jenisAcara === 'relay'
  const bilanganCubaan = isPadang ? (acara.bilanganCubaan || 6) : 0

  const pdf = new jsPDF({ orientation: isPadang ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const M   = 12
  const katLbl   = katLabel(acara.kategoriKod, kategoriList)
  const masa     = jadual?.masaMula || '—'
  const lokasi   = jadual?.lokasi   || '—'
  const tarikhLabel = jadual?.tarikhAcara
    ? new Date(jadual.tarikhAcara + 'T00:00:00').toLocaleDateString('ms-MY',
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '—'
  const peringkatLabel = acara.peringkat === 'saringan' ? 'Saringan'
    : acara.parentAcaraId ? `Final (← #${acara.parentAcaraId})`
    : 'Final'

  function imgFmt(b64) {
    if (!b64) return 'PNG'
    return (b64.startsWith('data:image/jpeg') || b64.startsWith('data:image/jpg')) ? 'JPEG' : 'PNG'
  }

  const SALINAN = [
    { id: 'juruhebah', label: 'JURUHEBAH', clr: [0,   51,  153] },
    { id: 'callroom',  label: 'CALL ROOM', clr: [0,   120,  50] },
    { id: 'teknikal',  label: 'TEKNIKAL',  clr: [160,  60,   0] },
    { id: 'fail',      label: 'FAIL',      clr: [70,   70,  70] },
  ]

  const PERINGKAT_LABEL = { D: 'Daerah', N: 'Negeri', K: 'Kebangsaan' }
  let isFirst = true

  for (const heat of heats) {
    const peserta = [...(heat.peserta || [])].sort((a, b) =>
      isPadang || isMass
        ? (a.giliran ?? 99) - (b.giliran ?? 99)
        : (a.lorong  ?? 99) - (b.lorong  ?? 99)
    )
    const fasaStr = heat.fasa === 'final'    ? 'FINAL'
                  : heat.fasa === 'saringan' ? 'SARINGAN'
                  : `HEAT ${heat.noHeat}`

    for (const sal of SALINAN) {
      const isTeknikal = sal.id === 'teknikal'
      if (!isFirst) {
        pdf.addPage(isPadang ? [297, 210] : [210, 297])
      }
      isFirst = false

      const W = pdf.internal.pageSize.getWidth()

      // ── Salinan checkbox (kanan atas) ────────────────────────────────────
      const boxW  = 38
      const boxX  = W - M - boxW
      const rowH  = 6.5
      const startY_box = 8

      SALINAN.forEach((s, i) => {
        const cy = startY_box + i * rowH
        const isThis = s.id === sal.id
        if (isThis) {
          pdf.setFillColor(sal.clr[0], sal.clr[1], sal.clr[2])
          pdf.rect(boxX, cy, boxW, rowH, 'F')
        }
        pdf.setDrawColor(isThis ? sal.clr[0] : 160, isThis ? sal.clr[1] : 160, isThis ? sal.clr[2] : 160)
        pdf.setLineWidth(0.3)
        pdf.rect(boxX, cy, boxW, rowH)
        const cbX = boxX + 2, cbY = cy + 1.5, cbS = 3.5
        pdf.setDrawColor(isThis ? 255 : 130, isThis ? 255 : 130, isThis ? 255 : 130)
        pdf.setFillColor(255, 255, 255)
        pdf.rect(cbX, cbY, cbS, cbS, isThis ? 'FD' : 'S')
        if (isThis) {
          pdf.setDrawColor(255, 255, 255)
          pdf.setLineWidth(0.7)
          pdf.line(cbX + 0.5, cbY + 1.8, cbX + 1.5, cbY + 2.8)
          pdf.line(cbX + 1.5, cbY + 2.8, cbX + 3.2, cbY + 0.7)
        }
        pdf.setLineWidth(0.3)
        pdf.setFont('helvetica', isThis ? 'bold' : 'normal')
        pdf.setFontSize(7.5)
        pdf.setTextColor(isThis ? 255 : 100, isThis ? 255 : 100, isThis ? 255 : 100)
        pdf.text(s.label, boxX + 7.5, cy + 4.3)
        pdf.setTextColor(0, 0, 0)
      })

      // ── Logo & teks header ────────────────────────────────────────────────
      const headerRight = boxX - 3
      const centerX = (M + 18 + headerRight) / 2
      let y = 10
      if (logoKiri) {
        try { pdf.addImage(logoKiri, imgFmt(logoKiri), M, y, 18, 18) } catch {}
      }
      if (logoKanan) {
        try { pdf.addImage(logoKanan, imgFmt(logoKanan), headerRight - 18, y, 18, 18) } catch {}
      }
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11)
      pdf.setTextColor(0, 0, 0)
      pdf.text(namaKej || 'Kejohanan Olahraga Antara Murid', centerX, y + 7, { align: 'center' })
      pdf.setFontSize(9)
      pdf.setFont('helvetica', 'normal')
      pdf.text('START LIST', centerX, y + 13, { align: 'center' })
      pdf.setFontSize(8.5)
      pdf.setFont('helvetica', 'bold')
      pdf.text(
        `No. Acara : ${acara.noAcara || '—'}     |     Acara : ${acara.namaAcara}`,
        centerX, y + 19, { align: 'center' }
      )
      pdf.setFontSize(8)
      pdf.setFont('helvetica', 'normal')
      pdf.text(
        `Kategori : ${katLbl}     |     Peringkat : ${peringkatLabel}`,
        centerX, y + 25, { align: 'center' }
      )
      pdf.text(
        `${tarikhLabel}   |   Masa : ${masa}   |   Lokasi : ${lokasi}`,
        centerX, y + 31, { align: 'center' }
      )

      y = 44
      pdf.setDrawColor(sal.clr[0], sal.clr[1], sal.clr[2])
      pdf.setLineWidth(0.7)
      pdf.line(M, y, W - M, y)
      y += 3

      // ── Rekod DNK ─────────────────────────────────────────────────────────
      const rekodRows = ['D', 'N', 'K'].map(p => {
        const r = rekodDNK[p]
        if (!r) return [PERINGKAT_LABEL[p], '—', '—', '—', '—']
        return [
          PERINGKAT_LABEL[p],
          tahunRekod(r.tarikhRekod),
          formatPrestasiRekod(r.prestasi, r.unit),
          r.namaAtlet || '—',
          lokasiRekod(r),
        ]
      })
      autoTable(pdf, {
        startY: y,
        head: [['Rekod', 'Tahun', 'Prestasi', 'Nama Atlet', 'Catatan']],
        body: rekodRows,
        styles: { fontSize: 7, cellPadding: 1 },
        headStyles: { fillColor: [80, 80, 80], textColor: 255, fontStyle: 'bold', fontSize: 7 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 20 },
          1: { halign: 'center', cellWidth: 14 },
          2: { halign: 'center', cellWidth: 24 },
          3: { cellWidth: 52 },
          4: { cellWidth: 'auto' },
        },
        margin: { left: M, right: M },
        tableLineColor: [200, 200, 200], tableLineWidth: 0.2,
      })
      y = pdf.lastAutoTable.finalY + 3

      // ── Heat header bar ───────────────────────────────────────────────────
      pdf.setFillColor(sal.clr[0], sal.clr[1], sal.clr[2])
      pdf.roundedRect(M, y, W - M * 2, 9, 1, 1, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.setTextColor(255, 255, 255)
      pdf.text(`${fasaStr}  —  ${acara.namaAcara}`, M + 3, y + 6)
      pdf.setFontSize(8)
      pdf.text(`${peserta.length} peserta`, W - M - 3, y + 6, { align: 'right' })
      pdf.setTextColor(0, 0, 0)
      y += 11

      // ── Jadual atlet ──────────────────────────────────────────────────────
      let head, body, colStyles

      if (isPadang) {
        const c0 = 'Gil.'
        if (sal.id === 'juruhebah') {
          head = [[c0, 'No. BIB', 'Nama Atlet', 'Sekolah']]
          body = peserta.map(p => [
            p.giliran ?? '—', p.noBib, p.namaAtlet,
            namaSekolahMap[p.kodSekolah] || p.kodSekolah,
          ])
          colStyles = { 0:{halign:'center',cellWidth:14}, 1:{cellWidth:20} }
        } else if (sal.id === 'callroom') {
          head = [[c0, 'No. BIB', 'Nama Atlet', 'Sekolah', 'Hadir (✓ / DNS)']]
          body = peserta.map(p => [
            p.giliran ?? '—', p.noBib, p.namaAtlet,
            namaSekolahMap[p.kodSekolah] || p.kodSekolah, '',
          ])
          colStyles = { 0:{halign:'center',cellWidth:14}, 1:{cellWidth:20}, 4:{cellWidth:40} }
        } else {
          const gilW = 12, bibW = 16, namaW = 60, kddkW = 16, cW = 28
          head = [
            [
              { content: 'Gil.', rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
              { content: 'No. BIB', rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
              { content: 'Nama Atlet / Sekolah', rowSpan: 2, styles: { valign: 'middle' } },
              { content: 'Cubaan (m)', colSpan: bilanganCubaan, styles: { halign: 'center' } },
              { content: 'Kddk', rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
            ],
            Array.from({ length: bilanganCubaan }, (_, i) => ({
              content: String(i + 1),
              styles: { halign: 'center' },
            })),
          ]
          body = peserta.map(p => [
            p.giliran ?? '—',
            p.noBib ?? '—',
            `${p.namaAtlet || '—'}\n${namaSekolahMap[p.kodSekolah] || p.kodSekolah || ''}`,
            ...Array(bilanganCubaan).fill(''),
            '',
          ])
          colStyles = {
            0: { halign: 'center', cellWidth: gilW, valign: 'middle' },
            1: { halign: 'center', cellWidth: bibW, fontStyle: 'bold', valign: 'middle' },
            2: { cellWidth: namaW, fontStyle: 'bold', valign: 'middle', overflow: 'linebreak' },
            ...Object.fromEntries(Array.from({ length: bilanganCubaan }, (_, i) => [
              i + 3, { halign: 'center', cellWidth: cW, valign: 'middle' }
            ])),
            [3 + bilanganCubaan]: { halign: 'center', cellWidth: kddkW, valign: 'middle' },
          }
        }
      } else if (isRelay) {
        if (sal.id === 'juruhebah') {
          head = [['Lrg', 'Sekolah / Pasukan', 'Ahli Pasukan']]
          body = peserta.map(p => [
            p.lorong ?? '—',
            namaSekolahMap[p.kodSekolah] || p.kodSekolah,
            (p.ahliPasukan || []).map(a => a.namaAtlet || a.noBib || '?').join(', '),
          ])
          colStyles = { 0:{halign:'center',cellWidth:14}, 1:{cellWidth:55} }
        } else if (sal.id === 'callroom') {
          head = [['Lrg', 'Sekolah / Pasukan', 'Ahli Pasukan', 'Hadir (✓ / DNS)']]
          body = peserta.map(p => [
            p.lorong ?? '—',
            namaSekolahMap[p.kodSekolah] || p.kodSekolah,
            (p.ahliPasukan || []).map(a => a.namaAtlet || a.noBib || '?').join(', '),
            '',
          ])
          colStyles = { 0:{halign:'center',cellWidth:14}, 1:{cellWidth:55}, 3:{cellWidth:35} }
        } else {
          head = [['Lrg', 'Sekolah / Pasukan', 'Ahli Pasukan', 'Masa', 'Keputusan']]
          body = peserta.map(p => [
            p.lorong ?? '—',
            namaSekolahMap[p.kodSekolah] || p.kodSekolah,
            (p.ahliPasukan || []).map(a => a.namaAtlet || a.noBib || '?').join(', '),
            '', '',
          ])
          colStyles = {
            0:{halign:'center',cellWidth:14}, 1:{cellWidth:55},
            3:{cellWidth:30}, 4:{cellWidth:30},
          }
        }
      } else {
        const c0 = isMass ? 'Bil' : 'Lrg'
        const getPos = p => isMass ? (p.giliran ?? '—') : (p.lorong ?? '—')
        const isFinal = heat.fasa === 'final'
        if (sal.id === 'juruhebah') {
          if (isFinal && !isMass) {
            // Final: tambah kolum H (Heat asal) dan Q (Kelayakan)
            head = [[c0, 'No. BIB', 'Nama Atlet', 'Sekolah', 'H', 'Q']]
            body = peserta.map(p => [
              getPos(p), p.noBib, p.namaAtlet,
              namaSekolahMap[p.kodSekolah] || p.kodSekolah,
              p.noHeat ? `H${p.noHeat}` : (p._dariHeat ? `H${p._dariHeat}` : '—'),
              p.qualifyType || p._qualifyType || '—',
            ])
            colStyles = {
              0:{halign:'center',cellWidth:14}, 1:{cellWidth:18},
              4:{halign:'center',cellWidth:12}, 5:{halign:'center',cellWidth:10, fontStyle:'bold'},
            }
          } else {
            head = [[c0, 'No. BIB', 'Nama Atlet', 'Sekolah']]
            body = peserta.map(p => [
              getPos(p), p.noBib, p.namaAtlet,
              namaSekolahMap[p.kodSekolah] || p.kodSekolah,
            ])
            colStyles = { 0:{halign:'center',cellWidth:14}, 1:{cellWidth:20} }
          }
        } else if (sal.id === 'callroom') {
          head = [[c0, 'No. BIB', 'Nama Atlet', 'Sekolah', 'Hadir (✓ / DNS)']]
          body = peserta.map(p => [
            getPos(p), p.noBib, p.namaAtlet,
            namaSekolahMap[p.kodSekolah] || p.kodSekolah, '',
          ])
          colStyles = { 0:{halign:'center',cellWidth:14}, 1:{cellWidth:20}, 4:{cellWidth:40} }
        } else {
          head = [[c0, 'No. BIB', 'Nama Atlet', 'Sekolah', 'Masa', 'Keputusan']]
          body = peserta.map(p => [
            getPos(p), p.noBib, p.namaAtlet,
            namaSekolahMap[p.kodSekolah] || p.kodSekolah,
            '', '',
          ])
          colStyles = {
            0:{halign:'center',cellWidth:14}, 1:{cellWidth:20},
            4:{cellWidth:34}, 5:{cellWidth:34},
          }
        }
      }

      const isTeknikalPadang = isPadang && isTeknikal
      autoTable(pdf, {
        startY: y,
        head,
        body,
        styles: isTeknikalPadang
          ? { fontSize: 9, cellPadding: { top: 3, right: 2, bottom: 3, left: 3 }, minCellHeight: 16, overflow: 'linebreak' }
          : { fontSize: 9, cellPadding: 4, minCellHeight: 12 },
        headStyles: {
          fillColor: [sal.clr[0], sal.clr[1], sal.clr[2]],
          textColor: 255, fontStyle: 'bold', fontSize: 8,
          cellPadding: isTeknikalPadang ? 3 : 2,
          halign: 'center',
        },
        alternateRowStyles: isTeknikalPadang ? {} : { fillColor: [248, 248, 252] },
        columnStyles: colStyles,
        margin: { left: M, right: M },
        tableLineColor: isTeknikalPadang ? [80, 80, 80] : [160, 160, 160],
        tableLineWidth: isTeknikalPadang ? 0.5 : 0.3,
      })

      // ── Footer tandatangan ────────────────────────────────────────────────
      const H = pdf.internal.pageSize.getHeight()
      const footY = H - 24
      pdf.setDrawColor(sal.clr[0], sal.clr[1], sal.clr[2])
      pdf.setLineWidth(0.4)
      pdf.line(M, footY, W - M, footY)
      pdf.setTextColor(0, 0, 0)

      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8)
      pdf.text('Angin:', M, footY + 7)
      pdf.setDrawColor(100, 100, 100)
      pdf.setLineWidth(0.3)
      pdf.rect(M + 13, footY + 2.5, 24, 8)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7)
      pdf.text('m/s', M + 38.5, footY + 7.5)

      const sig1X = M + 55, sig2X = M + 120, sigW = 58, sigH = 11
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7.5)
      pdf.text('Pegawai Teknikal:', sig1X, footY + 4)
      pdf.setFont('helvetica', 'normal')
      pdf.setDrawColor(100, 100, 100)
      pdf.rect(sig1X, footY + 5, sigW, sigH)

      pdf.setFont('helvetica', 'bold')
      pdf.text('Pengadil Ketua:', sig2X, footY + 4)
      pdf.setFont('helvetica', 'normal')
      pdf.rect(sig2X, footY + 5, sigW, sigH)

      const dicetak = new Date().toLocaleString('ms-MY', {
        timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
      pdf.setFontSize(6.5)
      pdf.setTextColor(150, 150, 150)
      pdf.text(`Dicetak: ${dicetak}   |   ${heat.heatId || 'final'}`, M, H - 5)
      pdf.setTextColor(0, 0, 0)
    }
  }

  return pdf
}
