import jsPDF from 'jspdf'

const W = 210, H = 297  // Portrait A4 mm

export function janaSijilPDF(namaAtlet, sijilCfg) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const {
    templateImg,
    posNama, posKejohanan, posTarikh,
    styleNama = {}, styleKejohanan = {}, styleTarikh = {},
    namaKejohanan = '', tarikhKejohanan = '',
  } = sijilCfg

  if (templateImg) pdf.addImage(templateImg, 'JPEG', 0, 0, W, H)

  function lukis(teks, pos, style) {
    if (!pos || !teks) return
    pdf.setFontSize(style.size || 24)
    pdf.setTextColor(style.warna || '#000000')
    pdf.setFont('helvetica', style.bold !== false ? 'bold' : 'normal')
    pdf.text(teks, pos.x * W / 100, pos.y * H / 100, { align: style.align || 'center' })
  }

  lukis(namaAtlet,       posNama,      styleNama)
  lukis(namaKejohanan,   posKejohanan, styleKejohanan)
  lukis(tarikhKejohanan, posTarikh,    styleTarikh)
  return pdf
}

export function namaFail(nama, noBib) {
  const bersih = (nama || 'atlet').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').toUpperCase()
  return `SIJIL_${bersih}${noBib ? '_' + noBib : ''}.pdf`
}
