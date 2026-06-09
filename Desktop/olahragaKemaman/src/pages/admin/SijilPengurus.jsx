/**
 * SijilPengurus — /dashboard/sijilsaya
 * Pengurus pasukan: lihat senarai atlet berdaftar, muat turun sijil per atlet atau ZIP semua.
 *
 * Sumber data:
 *   tetapan/sijil          — template + kedudukan + gaya
 *   kejohanan (aktif)      — namaKejohanan, tahun
 *   kejohanan/{id}/pendaftaran — senarai atlet berdaftar sekolah ini
 *   atlet/{noKP}           — nama atlet
 */

import { useState, useEffect } from 'react'
import {
  collection, getDocs, doc, getDoc, query, where,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import jsPDF from 'jspdf'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

// ─── PDF helpers ──────────────────────────────────────────────────────────────

const W = 210, H = 297  // Portrait A4 mm

function janaSijilPDF(namaAtlet, sijilCfg) {
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

  lukis(namaAtlet,      posNama,      styleNama)
  lukis(namaKejohanan,  posKejohanan, styleKejohanan)
  lukis(tarikhKejohanan, posTarikh,   styleTarikh)
  return pdf
}

function namaFail(nama, noBib) {
  const bersih = (nama || 'atlet').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').toUpperCase()
  return `SIJIL_${bersih}${noBib ? '_' + noBib : ''}.pdf`
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function SijilPengurus() {
  const { userData } = useAuth()
  const kodSekolah = userData?.kodSekolah || ''
  const namaSekolah = userData?.namaSekolah || kodSekolah

  const [sijilCfg, setSijilCfg]      = useState(null)
  const [kejohanan, setKejohanan]    = useState(null)
  const [atletList, setAtletList]    = useState([])
  const [loading, setLoading]        = useState(true)
  const [err, setErr]                = useState('')
  const [downloading, setDownloading]= useState({})
  const [zipping, setZipping]        = useState(false)

  useEffect(() => {
    if (!kodSekolah) return
    load()
  }, [kodSekolah])

  async function load() {
    setLoading(true); setErr('')
    try {
      // 1. Tetapan sijil
      const sijilSnap = await getDoc(doc(db, 'tetapan', 'sijil'))
      if (!sijilSnap.exists() || !sijilSnap.data().templateImg) {
        setErr('Tetapan sijil belum dikonfigurasi oleh admin. Sila hubungi admin.')
        setLoading(false)
        return
      }
      const cfg = sijilSnap.data()
      setSijilCfg(cfg)

      // 2. Cari kejohanan aktif
      const kejSnap = await getDocs(
        query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif'))
      )
      if (kejSnap.empty) {
        setErr('Tiada kejohanan aktif pada masa ini.')
        setLoading(false)
        return
      }
      const kej = { id: kejSnap.docs[0].id, ...kejSnap.docs[0].data() }
      setKejohanan(kej)

      // 3. Dapatkan semua atlet sekolah ini dari koleksi atlet
      const atletSnap = await getDocs(
        query(collection(db, 'atlet'), where('kodSekolah', '==', kodSekolah))
      )

      if (atletSnap.empty) {
        setAtletList([])
        setLoading(false)
        return
      }

      // 4. Dapatkan noBib dari pendaftaran (jika ada) — optional
      const pendSnap = await getDocs(
        query(
          collection(db, 'kejohanan', kej.id, 'pendaftaran'),
          where('kodSekolah', '==', kodSekolah)
        )
      )
      const bibMap = {}
      pendSnap.docs.forEach(d => { bibMap[d.id] = d.data().noBib || '' })

      const list = atletSnap.docs.map(d => {
        const a = d.data()
        return {
          noKP:        d.id,
          noBib:       bibMap[d.id] || '',
          nama:        a.nama || d.id,
          kategoriKod: a.kategoriKod || '',
          jantina:     a.jantina || '',
        }
      }).sort((a, b) => a.nama.localeCompare(b.nama))

      setAtletList(list)
    } catch (e) {
      setErr('Ralat memuatkan data: ' + e.message)
    }
    setLoading(false)
  }

  async function cetakSijil(atlet) {
    if (!sijilCfg) return
    setDownloading(prev => ({ ...prev, [atlet.noKP]: true }))
    try {
      const pdf = janaSijilPDF(atlet.nama, sijilCfg)
      pdf.save(namaFail(atlet.nama, atlet.noBib))
    } catch {}
    setDownloading(prev => ({ ...prev, [atlet.noKP]: false }))
  }

  async function cetakSemua() {
    if (!sijilCfg || atletList.length === 0) return
    setZipping(true)
    try {
      const zip = new JSZip()
      for (const atlet of atletList) {
        const pdf = janaSijilPDF(atlet.nama, sijilCfg)
        const blob = pdf.output('blob')
        zip.file(namaFail(atlet.nama, atlet.noBib), blob)
      }
      const content = await zip.generateAsync({ type: 'blob' })
      saveAs(content, `SIJIL_${kodSekolah}_${kejohanan?.tahun || ''}.zip`)
    } catch (e) {
      alert('Ralat menjana ZIP: ' + e.message)
    }
    setZipping(false)
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <svg className="w-8 h-8 animate-spin text-[#003399] mx-auto mb-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <p className="text-xs text-gray-500">Memuatkan data sijil...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-base font-bold text-gray-800">Sijil Penyertaan</h1>
        <p className="text-xs text-gray-500 mt-0.5">{namaSekolah}</p>
      </div>

      {err ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-medium text-amber-700">{err}</p>
        </div>
      ) : (
        <>
          {/* Info kejohanan */}
          {kejohanan && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5 flex items-start gap-3">
              <div className="w-8 h-8 bg-[#003399] rounded-lg flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-blue-900">{sijilCfg?.namaKejohanan || kejohanan?.namaKejohanan || '—'}</p>
                <p className="text-[11px] text-blue-600 mt-0.5">{atletList.length} atlet layak muat turun sijil</p>
              </div>
              {atletList.length > 0 && (
                <button
                  onClick={cetakSemua}
                  disabled={zipping}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#003399] text-white rounded-lg text-xs font-semibold hover:bg-[#002288] transition-colors disabled:opacity-50 shrink-0"
                >
                  {zipping ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : '📦'}
                  {zipping ? 'Menjana ZIP...' : 'Muat Turun Semua (ZIP)'}
                </button>
              )}
            </div>
          )}

          {/* Senarai atlet */}
          {atletList.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-sm font-medium text-gray-600">Tiada atlet berdaftar</p>
              <p className="text-xs text-gray-400 mt-1">Pastikan pendaftaran atlet telah dibuat untuk kejohanan ini.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Senarai Atlet</p>
              </div>
              <div className="divide-y divide-gray-100">
                {atletList.map((atlet, i) => (
                  <div key={atlet.noKP} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                    <span className="text-[11px] text-gray-400 w-5 shrink-0 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{atlet.nama}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {atlet.noBib && (
                          <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                            {atlet.noBib}
                          </span>
                        )}
                        {atlet.kategoriKod && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            atlet.jantina === 'L' ? 'bg-blue-100 text-blue-700' :
                            atlet.jantina === 'P' ? 'bg-pink-100 text-pink-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {atlet.kategoriKod}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => cetakSijil(atlet)}
                      disabled={!!downloading[atlet.noKP]}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors disabled:opacity-50 shrink-0"
                    >
                      {downloading[atlet.noKP] ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                      ) : '📜'}
                      {downloading[atlet.noKP] ? 'Jana...' : 'Sijil'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
