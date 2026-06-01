import { db } from './firebase-config.js'
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'

export async function getPDFHeader() {
  const snap = await getDoc(doc(db, 'settings', 'main'))
  if (!snap.exists()) return {}
  const s = snap.data()
  return {
    namaB1: s.namaB1 || '',
    namaB2: s.namaB2 || '',
    namaB3: s.namaB3 || '',
    logoKiri: s.logoKiri || null,
    logoKanan: s.logoKanan || null,
    tarikh: s.tarikh?.toDate().toLocaleDateString('ms-MY') || '',
    lokasi: s.lokasi || ''
  }
}

export function adaWatermark(publikasi) {
  return publikasi?.status === 'tidakRasmi'
}

export function bolehPapar(publikasi) {
  return publikasi?.status === 'tidakRasmi' || publikasi?.status === 'rasmi'
}

export function filterKedudukan(keputusan, publikasi) {
  if (!publikasi || publikasi.status === 'rasmi') return keputusan
  return keputusan.filter(k =>
    k.kedudukan >= publikasi.dariKedudukan &&
    k.kedudukan <= publikasi.hinggaKedudukan
  )
}

export async function cetakIndividu(kategoriNama, keputusan, atletMap, pasukanMap, publikasi) {
  const { jsPDF } = window.jspdf
  const pdfdoc = new jsPDF()
  const header = await getPDFHeader()
  const watermark = adaWatermark(publikasi)

  let y = 10

  if (header.logoKiri) {
    pdfdoc.addImage(header.logoKiri, 'PNG', 10, 8, 20, 20)
  }
  if (header.logoKanan) {
    pdfdoc.addImage(header.logoKanan, 'PNG', 175, 8, 20, 20)
  }

  pdfdoc.setFont('helvetica', 'bold')
  pdfdoc.setFontSize(14)
  pdfdoc.text(header.namaB1, 105, y + 4, { align: 'center' })
  if (header.namaB2) {
    pdfdoc.setFontSize(11)
    pdfdoc.text(header.namaB2, 105, y + 10, { align: 'center' })
  }
  if (header.namaB3) {
    pdfdoc.setFontSize(10)
    pdfdoc.text(header.namaB3, 105, y + 16, { align: 'center' })
  }
  y = header.namaB3 ? 30 : 26

  if (watermark) {
    pdfdoc.setTextColor(200, 0, 0)
    pdfdoc.setFontSize(50)
    pdfdoc.setFont('helvetica', 'bold')
    pdfdoc.setGState(pdfdoc.GState({ opacity: 0.08 }))
    pdfdoc.text('TIDAK RASMI', 105, 150, { align: 'center', angle: 45 })
    pdfdoc.setGState(pdfdoc.GState({ opacity: 1 }))
    pdfdoc.setTextColor(0, 0, 0)
  }

  pdfdoc.setFont('helvetica', 'bold')
  pdfdoc.setFontSize(12)
  pdfdoc.text(`Keputusan Individu — ${kategoriNama}`, 105, y + 4, { align: 'center' })
  if (watermark) {
    pdfdoc.setTextColor(180, 0, 0)
    pdfdoc.setFontSize(9)
    pdfdoc.text('(TIDAK RASMI)', 105, y + 10, { align: 'center' })
    pdfdoc.setTextColor(0, 0, 0)
  }

  pdfdoc.autoTable({
    startY: y + 14,
    head: [['Tempat', 'Bib', 'Nama Atlet', 'Pasukan', 'Masa', 'Status']],
    body: keputusan.map(k => [
      k.kedudukan,
      atletMap[k.atletId]?.noBib || '?',
      atletMap[k.atletId]?.nama || '?',
      pasukanMap[k.pasukanId]?.nama || '?',
      k.masa || '-',
      k.statusAtlet.toUpperCase()
    ]),
    styles: { font: 'helvetica', fontSize: 9 },
    headStyles: { fillColor: [0, 51, 153] },
    margin: { left: 14, right: 14 }
  })

  if (!watermark) {
    const pageHeight = pdfdoc.internal.pageSize.height
    pdfdoc.setFontSize(9)
    pdfdoc.setFont('helvetica', 'normal')
    pdfdoc.text('Disahkan oleh:', 20, pageHeight - 30)
    pdfdoc.line(20, pageHeight - 16, 90, pageHeight - 16)
    pdfdoc.text('Pengadil Kejohanan', 20, pageHeight - 12)
    pdfdoc.text(`Tarikh: ${header.tarikh}`, 20, pageHeight - 7)
    pdfdoc.text(`Lokasi: ${header.lokasi}`, 20, pageHeight - 2)
  }

  const statusLabel = watermark ? 'TIDAK-RASMI' : 'RASMI'
  pdfdoc.save(`Individu_${kategoriNama.replace(/\s/g, '_')}_${statusLabel}.pdf`)
}
