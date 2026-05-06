/**
 * StartList — /dashboard/startlist
 *
 * Jana start list dari pendaftaran, assign lorong/giliran, buat heat.
 *
 * Fungsi utama:
 *  1. Pilih kejohanan → pilih acara
 *  2. Papar semua peserta berdaftar
 *  3. Susun heat berdasarkan bilangan peserta + bilanganLorong
 *     - terus_final   : peserta ≤ lorong
 *     - heat_final    : peserta ≤ lorong × 3
 *     - saringan_heat_final : peserta > lorong × 3
 *  4. Assign lorong (random draw / manual drag)
 *  5. Padang & mass_start: assign giliran (no urutan)
 *  6. Simpan heat ke Firestore: kejohanan/{id}/acara/{id}/heat/{heatId}
 *  7. Export PDF Start List (jsPDF + AutoTable)
 *
 * heatId format: {aceraId}-H{noHeat}   cth: ACR-100M-L-A-H1
 * Fasa: heat | final | saringan
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  collection, getDocs, doc, setDoc, deleteDoc,
  serverTimestamp, query, orderBy, where, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cariRekodUntukAcara, formatPrestasiRekod, tahunRekod, lokasiRekod } from '../../utils/rekodUtils'

// ─── Helper ───────────────────────────────────────────────────────────────────

function katLabel(kod, kategoriList = []) {
  if (!kod) return '—'
  const kat = kategoriList.find(k => k.kod === kod)
  return kat?.label || kod
}

// ─── Konstanta ────────────────────────────────────────────────────────────────

const ASSIGN_LORONG_WA = [4, 5, 3, 6, 2, 7, 1, 8] // rank 1→8, WA standard dalam-keluar-tengah

const FASA_LABEL = {
  heat:     'Heat / Saringan',
  final:    'Final',
  saringan: 'Saringan',
}

const STATUS_HEAT = {
  belum_mula:   { label: 'Belum Mula',   color: 'bg-gray-100 text-gray-600' },
  sedang_jalan: { label: 'Sedang Jalan', color: 'bg-amber-100 text-amber-700' },
  selesai:      { label: 'Selesai',      color: 'bg-green-100 text-green-700' },
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tentukanFasa(bilanganPeserta, bilanganLorong) {
  if (bilanganPeserta <= bilanganLorong)       return 'terus_final'
  if (bilanganPeserta <= bilanganLorong * 3)   return 'heat_final'
  return 'saringan_heat_final'
}

/**
 * Bahagi peserta kepada heat secara merata.
 * Peserta diagihkan supaya setiap heat seimbang (bukan semua penuh dulu).
 * Kaedah: isi dari belakang (heat terakhir boleh ada kurang peserta).
 */
function bahagikanKeHeat(peserta, bilanganLorong) {
  const n = peserta.length
  if (n === 0) return []
  const bilanganHeat = Math.ceil(n / bilanganLorong)
  // Sapu dari kiri: agihkan merata
  const heats = Array.from({ length: bilanganHeat }, () => [])
  // Kaedah WA: isi heat secara bergilir (serpentine)
  let heatIdx = 0
  let arah = 1
  for (let i = 0; i < peserta.length; i++) {
    heats[heatIdx].push(peserta[i])
    heatIdx += arah
    if (heatIdx >= bilanganHeat) { heatIdx = bilanganHeat - 1; arah = -1 }
    if (heatIdx < 0)             { heatIdx = 0; arah = 1 }
  }
  return heats
}

/** Assign lorong WA standard (rank 1 → lorong 4, dst.) */
function assignLorong(pesertaHeat) {
  return pesertaHeat.map((p, idx) => ({
    ...p,
    lorong: ASSIGN_LORONG_WA[idx] ?? (idx + 1),
  })).sort((a, b) => a.lorong - b.lorong)
}

/** Assign giliran untuk padang/mass_start */
function assignGiliran(peserta) {
  return peserta.map((p, idx) => ({ ...p, giliran: idx + 1 }))
}

function buatHeatId(aceraId, fasa, noHeat) {
  const fasaKod = fasa === 'final' ? 'F' : fasa === 'saringan' ? 'S' : 'H'
  return `${aceraId}-${fasaKod}${noHeat}`
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

function exportStartListPDF(acara, heatList, namaKejohanan, namaSekolahMap = {}, rekodDNK = {}, kategoriList = []) {
  const pdf   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const now   = new Date().toLocaleString('ms-MY')

  // ── Bina baris rekod (3 peringkat) ───────────────────────────────────────────
  const PERINGKAT_LABEL = { D: 'Daerah', N: 'Negeri', K: 'Kebangsaan' }
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

  heatList.forEach((heat, hIdx) => {
    if (hIdx > 0) pdf.addPage()

    // ── Header kejohanan + acara ───────────────────────────────────────────────
    pdf.setFontSize(12)
    pdf.setFont('helvetica', 'bold')
    pdf.text('START LIST', pageW / 2, 18, { align: 'center' })
    pdf.setFontSize(10)
    pdf.text(namaKejohanan, pageW / 2, 24, { align: 'center' })
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.text(
      `${acara.namaAcara} — Kategori ${katLabel(acara.kategoriKod, kategoriList)} ${acara.jantina === 'L' ? 'Lelaki' : 'Perempuan'}`,
      pageW / 2, 30, { align: 'center' }
    )
    pdf.text(
      `${FASA_LABEL[heat.fasa] || heat.fasa} ${heat.noHeat} | ID: ${heat.heatId}`,
      pageW / 2, 35, { align: 'center' }
    )

    // ── Jadual rekod ──────────────────────────────────────────────────────────
    autoTable(pdf, {
      startY: 40,
      head: [['Rekod', 'Tahun', 'Masa / Jarak', 'Nama', 'Catatan']],
      body: rekodRows,
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [80, 80, 80], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 26 },
        1: { halign: 'center', cellWidth: 16 },
        2: { halign: 'center', cellWidth: 24 },
        3: { cellWidth: 50 },
        4: { cellWidth: 'auto' },
      },
      margin: { left: 15, right: 15 },
      tableLineColor: [200, 200, 200],
      tableLineWidth: 0.2,
    })

    // ── Jadual atlet / heat ───────────────────────────────────────────────────
    const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
    const isMass   = acara.jenisAcara === 'mass_start'
    const head     = isPadang || isMass
      ? [['Giliran', 'No. BIB', 'Nama Atlet', 'Sekolah', 'Kategori', 'Catatan']]
      : [['Lorong',  'No. BIB', 'Nama Atlet', 'Sekolah', 'Kategori', 'Catatan']]

    const rows = (heat.peserta || [])
      .sort((a, b) => (isPadang || isMass ? a.giliran - b.giliran : a.lorong - b.lorong))
      .map(p => [
        isPadang || isMass ? (p.giliran ?? '—') : (p.lorong ?? '—'),
        p.noBib,
        p.namaAtlet,
        namaSekolahMap[p.kodSekolah] || p.namaSekolah || p.kodSekolah,
        katLabel(p.kategoriKod, kategoriList) || '—',
        '',
      ])

    autoTable(pdf, {
      startY: pdf.lastAutoTable.finalY + 4,
      head,
      body: rows,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      columnStyles: { 0: { halign: 'center', cellWidth: 18 }, 1: { cellWidth: 20 }, 5: { cellWidth: 30 } },
      margin: { left: 15, right: 15 },
    })

    // ── Footer ────────────────────────────────────────────────────────────────
    const finalY = pdf.lastAutoTable.finalY + 8
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`Dicetak: ${now}`, 15, finalY)
    pdf.text('Tandatangan Pegawai Teknikal: ________________', pageW - 15, finalY, { align: 'right' })

    pdf.setDrawColor(0, 51, 153)
    pdf.setLineWidth(0.5)
    pdf.line(15, finalY + 4, pageW - 15, finalY + 4)
  })

  pdf.save(`StartList_${acara.aceraId}_${Date.now()}.pdf`)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = STATUS_HEAT[status] || STATUS_HEAT.belum_mula
  return <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
}

function FasaBadge({ fasa }) {
  const colors = { heat:'bg-blue-100 text-blue-700', final:'bg-purple-100 text-purple-700', saringan:'bg-orange-100 text-orange-700' }
  return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${colors[fasa]||'bg-gray-100 text-gray-500'}`}>{FASA_LABEL[fasa]||fasa}</span>
}

// ─── Modal: Tetapan Generate Heat ─────────────────────────────────────────────

function GenerateModal({ acara, peserta, onClose, onGenerated, sekolahMap = {} }) {
  const isPadang  = ['padang_lompat','padang_balin'].includes(acara.jenisAcara)
  const isMass    = acara.jenisAcara === 'mass_start'
  const isLorong  = !isPadang && !isMass

  const [bilanganLorong, setBL]   = useState(acara.bilanganLorong || 8)
  const [caraDraw, setCaraDraw]   = useState('random') // random | manual | seeding
  const [generating, setGen]      = useState(false)
  const [preview, setPreview]     = useState(null)

  function buatPreview() {
    const p = [...peserta]
    if (caraDraw === 'random') {
      // Fisher-Yates shuffle
      for (let i = p.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]]
      }
    }
    // Tentukan fasa
    const fasa = isPadang || isMass
      ? 'terus_final'
      : tentukanFasa(p.length, Number(bilanganLorong))

    let heats = []
    if (fasa === 'terus_final' || isPadang || isMass) {
      // 1 heat sahaja = final atau giliran terus
      const pesertaAssigned = isPadang || isMass
        ? assignGiliran(p)
        : assignLorong(p)
      heats = [{ fasa: isPadang || isMass ? 'final' : 'final', noHeat: 1, peserta: pesertaAssigned }]
    } else {
      // Banyak heat
      const bahagiHeat = bahagikanKeHeat(p, Number(bilanganLorong))
      heats = bahagiHeat.map((hp, i) => ({
        fasa: 'heat',
        noHeat: i + 1,
        peserta: assignLorong(hp),
      }))
    }
    setPreview({ fasa, heats })
  }

  async function handleGenerate(kejohananId) {
    if (!preview) return
    setGen(true)
    try {
      const batch = writeBatch(db)
      for (const h of preview.heats) {
        const heatId = buatHeatId(acara.aceraId, h.fasa, h.noHeat)
        const ref = doc(db, 'kejohanan', kejohananId, 'acara', acara.aceraId, 'heat', heatId)
        batch.set(ref, {
          heatId,
          aceraId: acara.aceraId,
          kejohananId,
          fasa: h.fasa,
          noHeat: h.noHeat,
          status: 'belum_mula',
          windSpeed: null,
          isWindLegal: null,
          peserta: h.peserta.map(p => ({
            noBib: p.noBib,
            noKP: p.noKP || '',
            namaAtlet: p.namaAtlet,
            kodSekolah: p.kodSekolah,
            kategoriKod: p.kategoriKod || '',
            lorong: p.lorong ?? null,
            giliran: p.giliran ?? null,
            keputusan: null,
            status: 'belum',
            cubaan: [],
            rankDalamHeat: null,
          })),
          finalisDipilih: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: false })
      }
      await batch.commit()
      onGenerated()
      onClose()
    } catch (e) {
      alert('Ralat: ' + e.message)
    } finally {
      setGen(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800">Jana Start List</h2>
            <p className="text-xs text-gray-500 mt-0.5">{acara.namaAcara} — {peserta.length} peserta</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Tetapan */}
          {isLorong && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">Bilangan Lorong</label>
                <input type="number" min={4} max={10} value={bilanganLorong}
                  onChange={e => { setBL(e.target.value); setPreview(null) }} className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">Kaedah Draw</label>
                <select value={caraDraw} onChange={e => { setCaraDraw(e.target.value); setPreview(null) }} className={inputCls}>
                  <option value="random">Random Draw (Loteri)</option>
                  <option value="seeding">Seeding (ikut urutan daftar)</option>
                </select>
              </div>
            </div>
          )}

          {/* Info fasa */}
          {isLorong && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
              <p className="font-bold mb-1">Auto tentukan fasa:</p>
              <p>≤ {bilanganLorong} peserta → <strong>Terus Final</strong></p>
              <p>≤ {bilanganLorong * 3} peserta → <strong>Heat → Final</strong></p>
              <p>&gt; {bilanganLorong * 3} peserta → <strong>Saringan → Heat → Final</strong></p>
              <p className="mt-1 font-semibold text-blue-600">Peserta semasa: {peserta.length} → {
                tentukanFasa(peserta.length, Number(bilanganLorong)) === 'terus_final' ? 'Terus Final' :
                tentukanFasa(peserta.length, Number(bilanganLorong)) === 'heat_final' ? 'Heat → Final' : 'Saringan → Heat → Final'
              }</p>
            </div>
          )}
          {(isPadang || isMass) && (
            <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-xs text-green-700">
              <p className="font-bold">{isPadang ? 'Padang' : 'Mass Start'}:</p>
              <p>Semua {peserta.length} peserta akan assign giliran 1–{peserta.length} secara {caraDraw === 'random' ? 'rawak' : 'ikut urutan daftar'}.</p>
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Preview — {preview.heats.length} Heat</p>
              {preview.heats.map(h => (
                <div key={h.noHeat} className="border border-gray-100 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-[#003399] flex items-center justify-between">
                    <span className="text-[10px] font-bold text-white">
                      {FASA_LABEL[h.fasa] || h.fasa} {h.noHeat} — {h.peserta.length} peserta
                    </span>
                    <span className="text-[9px] text-blue-200">{buatHeatId(acara.aceraId, h.fasa, h.noHeat)}</span>
                  </div>
                  <table className="w-full text-[10px]">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-center font-bold text-gray-400">{isPadang||isMass?'Gil':'Lorong'}</th>
                        <th className="px-2 py-1 text-left font-bold text-gray-400">BIB</th>
                        <th className="px-2 py-1 text-left font-bold text-gray-400">Nama</th>
                        <th className="px-2 py-1 text-left font-bold text-gray-400">Sekolah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(isPadang||isMass
                        ? [...h.peserta].sort((a,b)=>a.giliran-b.giliran)
                        : [...h.peserta].sort((a,b)=>a.lorong-b.lorong)
                      ).map(p => (
                        <tr key={p.noBib} className="border-t border-gray-50">
                          <td className="px-2 py-1 text-center font-black text-[#003399]">{isPadang||isMass?p.giliran:p.lorong}</td>
                          <td className="px-2 py-1 font-mono text-gray-700">{p.noBib}</td>
                          <td className="px-2 py-1 font-semibold text-gray-800">{p.namaAtlet}</td>
                          <td className="px-2 py-1 text-gray-500">{sekolahMap[p.kodSekolah] || p.namaSekolah || p.kodSekolah}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center gap-2 shrink-0">
          <button onClick={buatPreview}
            className="px-4 py-2 text-xs font-bold border border-[#003399] text-[#003399] rounded-lg hover:bg-blue-50 transition-colors">
            {preview ? 'Jana Semula' : 'Preview'}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Batal</button>
            <button
              onClick={() => {
                // Ambil kejohananId dari acara context — pass via prop
                handleGenerate(acara._kejohananId)
              }}
              disabled={!preview || generating}
              className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50">
              {generating ? 'Menyimpan…' : 'Simpan Start List'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Edit Lorong/Giliran manual ────────────────────────────────────────

function EditLorongModal({ heat, acara, kejohananId, onClose, onSaved, sekolahMap = {} }) {
  const isPadang = ['padang_lompat','padang_balin'].includes(acara.jenisAcara)
  const isMass   = acara.jenisAcara === 'mass_start'
  const [peserta, setPeserta] = useState(
    [...(heat.peserta||[])].sort((a,b)=> isPadang||isMass ? a.giliran-b.giliran : a.lorong-b.lorong)
  )
  const [saving, setSaving] = useState(false)

  function update(idx, field, val) {
    setPeserta(p => p.map((x, i) => i === idx ? { ...x, [field]: Number(val) || 0 } : x))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await setDoc(
        doc(db, 'kejohanan', kejohananId, 'acara', acara.aceraId, 'heat', heat.heatId),
        { peserta, updatedAt: serverTimestamp() },
        { merge: true }
      )
      onSaved(); onClose()
    } catch (e) { alert(e.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-bold text-gray-800">Edit {isPadang||isMass?'Giliran':'Lorong'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
          {peserta.map((p, i) => (
            <div key={p.noBib} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg">
              <input
                type="number" min={1} max={isPadang||isMass?peserta.length:10}
                value={isPadang||isMass ? p.giliran : p.lorong}
                onChange={e => update(i, isPadang||isMass?'giliran':'lorong', e.target.value)}
                className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center font-black text-[#003399] focus:outline-none focus:ring-2 focus:ring-[#003399]/25"
              />
              <div>
                <p className="text-xs font-bold text-gray-800">{p.namaAtlet}</p>
                <p className="text-[9px] font-mono text-gray-400">{p.noBib} — {sekolahMap[p.kodSekolah] || p.namaSekolah || p.kodSekolah}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Batal</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50">
            {saving?'Menyimpan…':'Simpan'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Helper: Jana heat untuk satu acara (boleh guna batch atau individual) ────

async function generateHeatsForAcara({ acara, pesertaAll, kejohananId, caraDraw, skipJikaAda }) {
  // Tapis peserta untuk acara ini
  const peserta = pesertaAll.filter(p => (p.acaraIds || []).includes(acara.aceraId))
  if (peserta.length === 0) return { status: 'skip', sebab: 'tiada peserta' }

  // Semak heat sedia ada
  if (skipJikaAda) {
    const existSnap = await getDocs(collection(db, 'kejohanan', kejohananId, 'acara', acara.aceraId, 'heat'))
    if (!existSnap.empty) return { status: 'skip', sebab: 'heat sedia ada' }
  } else {
    // Padam heat lama
    const existSnap = await getDocs(collection(db, 'kejohanan', kejohananId, 'acara', acara.aceraId, 'heat'))
    if (!existSnap.empty) {
      const delBatch = writeBatch(db)
      existSnap.docs.forEach(d => delBatch.delete(d.ref))
      await delBatch.commit()
    }
  }

  const isPadang = ['padang_lompat','padang_balin'].includes(acara.jenisAcara)
  const isMass   = acara.jenisAcara === 'mass_start'
  const bilLorong = acara.bilanganLorong || 8

  // Shuffle jika random
  const p = [...peserta]
  if (caraDraw === 'random') {
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]]
    }
  }

  const fasa = isPadang || isMass ? 'terus_final' : tentukanFasa(p.length, bilLorong)
  let heats = []

  if (fasa === 'terus_final' || isPadang || isMass) {
    const assigned = isPadang || isMass ? assignGiliran(p) : assignLorong(p)
    heats = [{ fasa: 'final', noHeat: 1, peserta: assigned }]
  } else {
    const bahagiHeat = bahagikanKeHeat(p, bilLorong)
    heats = bahagiHeat.map((hp, i) => ({ fasa: 'heat', noHeat: i + 1, peserta: assignLorong(hp) }))
  }

  const batch = writeBatch(db)
  for (const h of heats) {
    const heatId = buatHeatId(acara.aceraId, h.fasa, h.noHeat)
    const ref = doc(db, 'kejohanan', kejohananId, 'acara', acara.aceraId, 'heat', heatId)
    batch.set(ref, {
      heatId, aceraId: acara.aceraId, kejohananId,
      fasa: h.fasa, noHeat: h.noHeat, status: 'belum_mula',
      windSpeed: null, isWindLegal: null,
      peserta: h.peserta.map(pp => ({
        noBib: pp.noBib, noKP: pp.noKP || '',
        namaAtlet: pp.namaAtlet, kodSekolah: pp.kodSekolah,
        namaSekolah: namaSekolahMap[pp.kodSekolah] || pp.namaSekolah || pp.kodSekolah,
        kategoriKod: pp.kategoriKod || '',
        lorong: pp.lorong ?? null, giliran: pp.giliran ?? null,
        keputusan: null, status: 'belum', cubaan: [], rankDalamHeat: null,
      })),
      finalisDipilih: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }, { merge: false })
  }
  await batch.commit()
  return { status: 'ok', heatCount: heats.length, pesertaCount: peserta.length }
}

// ─── Logik Pilih Finalis (Heat → Final) ───────────────────────────────────────

/**
 * Pilih finalis berdasarkan setting acara:
 *  hybrid    — top 1 setiap heat + wildcard best time (STANDARD KOAM)
 *  best_time — gabung semua masa, rank, top N
 *  best_heat — top N dari setiap heat secara merata
 */
function pilihFinalis(heatPhaseHeats, acara, isPadang) {
  const cara          = acara.caraPilihFinal  || 'hybrid'
  const bilanganFinal = acara.bilanganFinalis || 8
  const wildcardSlot  = acara.wildcardSlot    ?? 2

  // masa: asc (kecil lebih baik) | jarak: desc (besar lebih baik)
  const sortFn = (a, b) => isPadang
    ? (b.keputusan ?? 0)   - (a.keputusan ?? 0)
    : (a.keputusan ?? 999) - (b.keputusan ?? 999)

  // Kumpul semua peserta layak dari semua heat fasa
  const semuaLayak = []
  heatPhaseHeats.forEach(heat => {
    ;(heat.peserta || []).forEach(p => {
      if (p.status === 'selesai' && p.keputusan != null && p.keputusan !== '') {
        semuaLayak.push({ ...p, _heatId: heat.heatId, _noHeat: heat.noHeat, _cara: null })
      }
    })
  })

  // ── best_time: gabung semua, ambil top N ────────────────────────────────────
  if (cara === 'best_time') {
    return [...semuaLayak]
      .sort(sortFn)
      .slice(0, bilanganFinal)
      .map(p => ({ ...p, _cara: 'best_time' }))
  }

  // ── best_heat: top N dari setiap heat, agihkan merata ──────────────────────
  if (cara === 'best_heat') {
    const numHeats = heatPhaseHeats.length
    const dipilih  = []
    heatPhaseHeats.forEach((heat, i) => {
      const slot       = Math.floor(bilanganFinal / numHeats) + (i < (bilanganFinal % numHeats) ? 1 : 0)
      const layakHeat  = semuaLayak
        .filter(p => p._heatId === heat.heatId)
        .sort(sortFn)
        .slice(0, slot)
      layakHeat.forEach(p => dipilih.push({ ...p, _cara: 'best_heat' }))
    })
    return dipilih
  }

  // ── hybrid (default KOAM): top 1 setiap heat + wildcard ────────────────────
  const dipilih   = []
  const pilihBibs = new Set()

  // 1. Top 1 dari setiap heat
  heatPhaseHeats.forEach(heat => {
    const layakHeat = semuaLayak.filter(p => p._heatId === heat.heatId).sort(sortFn)
    const top1      = layakHeat[0]
    if (top1 && !pilihBibs.has(top1.noBib)) {
      dipilih.push({ ...top1, _cara: 'heat_winner' })
      pilihBibs.add(top1.noBib)
    }
  })

  // 2. Wildcard: best time dari baki (sehingga wildcardSlot)
  const slotWildcard = Math.min(wildcardSlot, bilanganFinal - dipilih.length)
  if (slotWildcard > 0) {
    semuaLayak
      .filter(p => !pilihBibs.has(p.noBib))
      .sort(sortFn)
      .slice(0, slotWildcard)
      .forEach(p => {
        dipilih.push({ ...p, _cara: 'wildcard' })
        pilihBibs.add(p.noBib)
      })
  }

  return dipilih
}

// ─── Modal: Jana Semua Heat ───────────────────────────────────────────────────

function JanaSemuaModal({ kejohananId, acaraList, onClose, onDone }) {
  const [caraDraw,    setCaraDraw]    = useState('random')
  const [skipJikaAda, setSkip]       = useState(true)
  const [running,     setRunning]    = useState(false)
  const [progress,    setProgress]   = useState(null) // { done, total, log[] }
  const [done,        setDone]       = useState(false)

  const acaraAktif = acaraList.filter(a => a.isAktif !== false)

  async function handleJana() {
    setRunning(true)
    const log = []
    const total = acaraAktif.length

    // Ambil semua pendaftaran sekali
    let pesertaAll = []
    try {
      const snap = await getDocs(collection(db, 'kejohanan', kejohananId, 'pendaftaran'))
      pesertaAll = snap.docs.map(d => d.data())
    } catch (e) {
      setProgress({ done: 0, total, log: [{ status:'error', msg:'Gagal muat pendaftaran: ' + e.message }] })
      setRunning(false)
      return
    }

    let berjaya = 0, dilangkau = 0, gagal = 0

    for (let i = 0; i < acaraAktif.length; i++) {
      const acara = acaraAktif[i]
      const label = `${acara.namaAcara} Kat${katLabel(acara.kategoriKod, kategoriList)} ${acara.jantina}`
      try {
        const result = await generateHeatsForAcara({ acara, pesertaAll, kejohananId, caraDraw, skipJikaAda })
        if (result.status === 'ok') {
          berjaya++
          log.push({ status:'ok', msg:`✓ ${label} — ${result.heatCount} heat, ${result.pesertaCount} peserta` })
        } else {
          dilangkau++
          log.push({ status:'skip', msg:`⟳ ${label} — dilangkau (${result.sebab})` })
        }
      } catch (e) {
        gagal++
        log.push({ status:'error', msg:`✗ ${label} — ${e.message}` })
      }
      setProgress({ done: i + 1, total, log: [...log], berjaya, dilangkau, gagal })
    }

    setRunning(false)
    setDone(true)
  }

  const pct = progress ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800">Jana Heat — Semua Acara</h2>
            <p className="text-xs text-gray-400 mt-0.5">{acaraAktif.length} acara aktif dalam kejohanan ini</p>
          </div>
          {!running && <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>}
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {!running && !done && (
            <>
              {/* Tetapan */}
              <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">Kaedah Draw</label>
                  <div className="flex gap-2">
                    {[
                      { v:'random',  l:'Random Draw', sub:'Loteri — adil & ikut MSSM' },
                      { v:'seeding', l:'Seeding',     sub:'Ikut urutan daftar masuk' },
                    ].map(o => (
                      <button key={o.v} onClick={() => setCaraDraw(o.v)}
                        className={`flex-1 px-3 py-2.5 rounded-xl border text-left transition-all ${caraDraw===o.v?'border-[#003399] bg-[#003399]/5':'border-gray-200 hover:border-gray-300'}`}>
                        <p className={`text-xs font-bold ${caraDraw===o.v?'text-[#003399]':'text-gray-700'}`}>{o.l}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{o.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">Jika Heat Sudah Wujud</label>
                  <div className="flex gap-2">
                    {[
                      { v:true,  l:'Langkau',      sub:'Acara yang dah ada heat tidak disentuh', color:'text-green-700' },
                      { v:false, l:'Jana Semula',   sub:'Padam heat lama, jana baru',             color:'text-red-700'   },
                    ].map(o => (
                      <button key={String(o.v)} onClick={() => setSkip(o.v)}
                        className={`flex-1 px-3 py-2.5 rounded-xl border text-left transition-all ${skipJikaAda===o.v?'border-[#003399] bg-[#003399]/5':'border-gray-200 hover:border-gray-300'}`}>
                        <p className={`text-xs font-bold ${skipJikaAda===o.v?'text-[#003399]':'text-gray-700'}`}>{o.l}</p>
                        <p className={`text-[10px] mt-0.5 ${skipJikaAda===o.v?o.color:'text-gray-400'}`}>{o.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Senarai acara preview */}
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Acara yang akan diproses ({acaraAktif.length})</p>
                <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                  {acaraAktif.map(a => (
                    <div key={a.aceraId} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg">
                      <span className="text-[9px] font-bold text-[#003399] w-8">{katLabel(a.kategoriKod, kategoriList)}</span>
                      <span className={`text-[9px] font-black w-4 ${a.jantina==='L'?'text-blue-600':'text-pink-600'}`}>{a.jantina}</span>
                      <span className="text-[10px] text-gray-700 flex-1">{a.namaAcara}</span>
                      <span className="text-[9px] text-gray-400">{a.bilanganLorong || '—'} lorong</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Progress */}
          {(running || done) && progress && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs font-bold text-gray-700 mb-1.5">
                  <span>{done ? 'Selesai!' : `Memproses… ${progress.done}/${progress.total}`}</span>
                  <span>{pct}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5">
                  <div className="bg-[#003399] h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }} />
                </div>
              </div>

              {/* Ringkasan */}
              {progress.berjaya !== undefined && (
                <div className="flex gap-2">
                  <div className="flex-1 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-center">
                    <p className="text-lg font-black text-green-700">{progress.berjaya}</p>
                    <p className="text-[9px] text-green-600 font-semibold">Berjaya</p>
                  </div>
                  <div className="flex-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
                    <p className="text-lg font-black text-amber-700">{progress.dilangkau}</p>
                    <p className="text-[9px] text-amber-600 font-semibold">Dilangkau</p>
                  </div>
                  <div className="flex-1 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">
                    <p className="text-lg font-black text-red-700">{progress.gagal}</p>
                    <p className="text-[9px] text-red-600 font-semibold">Gagal</p>
                  </div>
                </div>
              )}

              {/* Log terminal */}
              <div className="bg-gray-900 rounded-xl p-3 max-h-48 overflow-y-auto font-mono text-[10px] space-y-0.5">
                {progress.log.map((l, i) => (
                  <p key={i} className={
                    l.status === 'ok'    ? 'text-green-400' :
                    l.status === 'skip'  ? 'text-amber-400' :
                    'text-red-400'
                  }>{l.msg}</p>
                ))}
                {running && <p className="text-gray-400 animate-pulse">▋</p>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          {!running && !done && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Batal</button>
              <button onClick={handleJana}
                className="flex items-center gap-2 px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288]">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Jana {acaraAktif.length} Acara Sekarang
              </button>
            </>
          )}
          {done && (
            <button onClick={() => { onDone(); onClose() }}
              className="px-5 py-2 text-xs font-bold bg-green-600 text-white rounded-lg hover:bg-green-700">
              Selesai — Tutup
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Jana Final dari Heat ─────────────────────────────────────────────

function JanaFinalModal({ acara, heatList, kejohananId, onClose, onGenerated, sekolahMap = {} }) {
  const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
  const isMass   = acara.jenisAcara === 'mass_start'

  const heatPhaseHeats = heatList.filter(h => h.fasa === 'heat' || h.fasa === 'saringan')
  const cara           = acara.caraPilihFinal  || 'hybrid'
  const bilanganFinal  = acara.bilanganFinalis || 8
  const wildcardSlot   = acara.wildcardSlot    ?? 2

  const [finalis] = useState(() => pilihFinalis(heatPhaseHeats, acara, isPadang))
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState('')

  const CARA_LABEL = {
    hybrid:    'Hybrid — Heat Winner + Wildcard',
    best_time: 'Best Time Keseluruhan',
    best_heat: 'Best Per Heat',
  }

  function fmtPrestasi(val) {
    if (val == null) return '—'
    const n = Number(val)
    if (isPadang) return n.toFixed(2) + 'm'
    if (n < 60) return n.toFixed(2) + 's'
    const m = Math.floor(n / 60)
    return `${m}:${(n - m * 60).toFixed(2).padStart(5, '0')}`
  }

  async function handleSimpan() {
    if (finalis.length === 0) return
    setSaving(true)
    setMsg('')
    try {
      const heatId = buatHeatId(acara.aceraId, 'final', 1)
      const ref    = doc(db, 'kejohanan', kejohananId, 'acara', acara.aceraId, 'heat', heatId)

      // WA standard: untuk larian lorong, sort ikut masa terpantas
      // sebelum assign lorong supaya yang terpantas dapat lorong 4 (tengah)
      const finalisUntukAssign = (!isPadang && !isMass)
        ? [...finalis].sort((a, b) => (a.keputusan ?? 999) - (b.keputusan ?? 999))
        : finalis

      const pesertaAssigned = isPadang || isMass
        ? assignGiliran(finalis)
        : assignLorong(finalisUntukAssign)

      await setDoc(ref, {
        heatId,
        aceraId:     acara.aceraId,
        kejohananId,
        fasa:        'final',
        noHeat:      1,
        status:      'belum_mula',
        windSpeed:   null,
        isWindLegal: null,
        peserta: pesertaAssigned.map(p => ({
          noBib:         p.noBib,
          noKP:          p.noKP          || '',
          namaAtlet:     p.namaAtlet,
          kodSekolah:    p.kodSekolah,
          namaSekolah:   p.namaSekolah   || '',
          kategoriKod:   p.kategoriKod   || '',
          lorong:        p.lorong        ?? null,
          giliran:       p.giliran       ?? null,
          keputusan:     null,
          status:        'belum',
          cubaan:        [],
          rankDalamHeat: null,
          _dariHeat:     p._heatId       || null,
          _cara:         p._cara         || null,
        })),
        finalisDipilih: finalis.map(p => p.noBib),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      onGenerated()
      onClose()
    } catch (e) {
      setMsg('Ralat: ' + e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800">Jana Heat Final</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {acara.namaAcara} · {CARA_LABEL[cara]} · {bilanganFinal} finalis
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Info kaedah */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
            <p className="font-bold">Kaedah: {CARA_LABEL[cara]}</p>
            {cara === 'hybrid' && (
              <p>Top 1 dari setiap {heatPhaseHeats.length} heat
                {wildcardSlot > 0 ? ` + ${wildcardSlot} wildcard best time` : ''}</p>
            )}
            {cara === 'best_time' && (
              <p>Top {bilanganFinal} masa/jarak terbaik gabungan {heatPhaseHeats.length} heat</p>
            )}
            {cara === 'best_heat' && (
              <p>Top {Math.ceil(bilanganFinal / heatPhaseHeats.length)} dari setiap heat (agihan merata)</p>
            )}
          </div>

          {/* Senarai finalis */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
              {finalis.length} Finalis Dipilih
            </p>

            {finalis.length === 0 ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center">
                <p className="text-sm font-semibold text-red-700">Tiada finalis layak.</p>
                <p className="text-xs text-red-500 mt-1">
                  Pastikan keputusan heat sudah diinput dan status RASMI.
                </p>
              </div>
            ) : (
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#003399] text-white text-[10px]">
                      <th className="px-3 py-2 text-center w-8">#</th>
                      <th className="px-3 py-2 text-left">BIB</th>
                      <th className="px-3 py-2 text-left">Nama</th>
                      <th className="px-3 py-2 text-left">Sekolah</th>
                      <th className="px-3 py-2 text-right">Prestasi</th>
                      <th className="px-3 py-2 text-center">Cara</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalis.map((p, i) => (
                      <tr key={p.noBib}
                        className={`border-t border-gray-50 ${
                          p._cara === 'heat_winner' ? 'bg-yellow-50/60' :
                          p._cara === 'wildcard'    ? 'bg-blue-50/40'   : ''
                        }`}>
                        <td className="px-3 py-2.5 text-center font-bold text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2.5 font-mono font-bold text-[#003399]">{p.noBib}</td>
                        <td className="px-3 py-2.5 font-semibold text-gray-800">{p.namaAtlet}</td>
                        <td className="px-3 py-2.5 text-gray-500 text-[11px]">{sekolahMap[p.kodSekolah] || p.namaSekolah || p.kodSekolah}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-gray-700">
                          {fmtPrestasi(p.keputusan)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {p._cara === 'heat_winner' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full whitespace-nowrap">
                              H{p._noHeat} Winner
                            </span>
                          )}
                          {p._cara === 'wildcard' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                              Wildcard
                            </span>
                          )}
                          {!['heat_winner','wildcard'].includes(p._cara) && (
                            <span className="text-[9px] text-gray-400">H{p._noHeat}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {msg && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{msg}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center gap-2 shrink-0">
          <p className="text-[10px] text-gray-400">
            {isPadang || isMass ? 'Giliran' : 'Lorong'} akan diagihkan semula (WA standard)
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">
              Batal
            </button>
            <button
              onClick={handleSimpan}
              disabled={saving || finalis.length === 0}
              className="px-5 py-2 text-xs font-bold bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
              {saving ? 'Menyimpan…' : `✓ Cipta Final (${finalis.length} peserta)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Jana Heat Individu (dari Status Panel) ───────────────────────────

function QuickJanaModal({ acara, kejohananId, onClose, onDone }) {
  const isPadang = ['padang_lompat','padang_balin'].includes(acara.jenisAcara)
  const isMass   = acara.jenisAcara === 'mass_start'

  const [peserta,       setPeserta]  = useState([])
  const [loadingP,      setLoadingP] = useState(true)
  const [bilanganLorong,setBL]       = useState(acara.bilanganLorong || 8)
  const [caraDraw,      setCaraDraw] = useState('random')
  const [preview,       setPreview]  = useState(null)
  const [saving,        setSaving]   = useState(false)

  useEffect(() => {
    getDocs(collection(db, 'kejohanan', kejohananId, 'pendaftaran'))
      .then(snap => {
        const all = snap.docs.map(d => d.data())
        setPeserta(all.filter(p => (p.acaraIds || []).includes(acara.aceraId)))
      })
      .catch(() => {})
      .finally(() => setLoadingP(false))
  }, [acara.aceraId, kejohananId])

  function buatPreview() {
    const p = [...peserta]
    if (caraDraw === 'random') {
      for (let i = p.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]]
      }
    }
    const fasa = isPadang || isMass ? 'terus_final' : tentukanFasa(p.length, Number(bilanganLorong))
    let heats = []
    if (fasa === 'terus_final' || isPadang || isMass) {
      const assigned = isPadang || isMass ? assignGiliran(p) : assignLorong(p)
      heats = [{ fasa: 'final', noHeat: 1, peserta: assigned }]
    } else {
      heats = bahagikanKeHeat(p, Number(bilanganLorong))
        .map((hp, i) => ({ fasa: 'heat', noHeat: i + 1, peserta: assignLorong(hp) }))
    }
    setPreview({ fasa, heats })
  }

  async function handleSimpan() {
    if (!preview) return
    setSaving(true)
    try {
      // Padam heat lama untuk acara ini sahaja
      const existSnap = await getDocs(collection(db, 'kejohanan', kejohananId, 'acara', acara.aceraId, 'heat'))
      if (!existSnap.empty) {
        const delBatch = writeBatch(db)
        existSnap.docs.forEach(d => delBatch.delete(d.ref))
        await delBatch.commit()
      }
      // Tulis heat baru
      const batch = writeBatch(db)
      for (const h of preview.heats) {
        const heatId = buatHeatId(acara.aceraId, h.fasa, h.noHeat)
        const ref = doc(db, 'kejohanan', kejohananId, 'acara', acara.aceraId, 'heat', heatId)
        batch.set(ref, {
          heatId, aceraId: acara.aceraId, kejohananId,
          fasa: h.fasa, noHeat: h.noHeat, status: 'belum_mula',
          windSpeed: null, isWindLegal: null,
          peserta: h.peserta.map(p => ({
            noBib: p.noBib, noKP: p.noKP || '',
            namaAtlet: p.namaAtlet, kodSekolah: p.kodSekolah,
            kategoriKod: p.kategoriKod || '',
            lorong: p.lorong ?? null, giliran: p.giliran ?? null,
            keputusan: null, status: 'belum', cubaan: [], rankDalamHeat: null,
          })),
          finalisDipilih: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }, { merge: false })
      }
      await batch.commit()
      onDone()
      onClose()
    } catch (e) {
      alert('Ralat: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const fasaLabel = !loadingP && peserta.length > 0 && !isPadang && !isMass
    ? (tentukanFasa(peserta.length, Number(bilanganLorong)) === 'terus_final' ? 'Terus Final'
      : tentukanFasa(peserta.length, Number(bilanganLorong)) === 'heat_final' ? 'Heat → Final'
      : 'Saringan → Heat → Final')
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800">Jana Heat — {acara.namaAcara}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-bold px-2 py-0.5 bg-[#003399]/10 text-[#003399] rounded-full">Kat {katLabel(acara.kategoriKod, kategoriList)}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${acara.jantina==='L'?'bg-blue-100 text-blue-700':'bg-pink-100 text-pink-700'}`}>
                {acara.jantina === 'L' ? 'Lelaki' : 'Perempuan'}
              </span>
              {fasaLabel && (
                <span className="text-[10px] text-gray-400">→ {fasaLabel}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none ml-4">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {loadingP ? (
            <p className="text-xs text-gray-400 text-center py-8">Memuatkan peserta…</p>
          ) : peserta.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
              <p className="text-sm font-semibold text-amber-800">Tiada peserta berdaftar</p>
              <p className="text-xs text-amber-600 mt-1">Daftar atlet dahulu dalam Pendaftaran Atlet.</p>
            </div>
          ) : (
            <>
              {/* Info peserta */}
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
                <p className="text-xs font-bold text-blue-800">{peserta.length} peserta berdaftar</p>
                {fasaLabel && <p className="text-[10px] text-blue-500 mt-0.5">Fasa: {fasaLabel}</p>}
              </div>

              {/* Tetapan — hanya untuk lorong */}
              {!isPadang && !isMass && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Bilangan Lorong</label>
                    <input type="number" min={4} max={10} value={bilanganLorong}
                      onChange={e => { setBL(e.target.value); setPreview(null) }} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Kaedah Draw</label>
                    <select value={caraDraw} onChange={e => { setCaraDraw(e.target.value); setPreview(null) }} className={inputCls}>
                      <option value="random">Random (Loteri)</option>
                      <option value="seeding">Seeding (urutan daftar)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Preview heats */}
              {preview && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{preview.heats.length} Heat dijana</p>
                  {preview.heats.map(h => (
                    <div key={h.noHeat} className="border border-gray-100 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-[#003399] flex items-center justify-between">
                        <span className="text-[10px] font-bold text-white">
                          {FASA_LABEL[h.fasa] || h.fasa} {h.noHeat} — {h.peserta.length} peserta
                        </span>
                        <span className="text-[9px] text-blue-200">{buatHeatId(acara.aceraId, h.fasa, h.noHeat)}</span>
                      </div>
                      <table className="w-full text-[10px]">
                        <tbody>
                          {(isPadang || isMass
                            ? [...h.peserta].sort((a, b) => a.giliran - b.giliran)
                            : [...h.peserta].sort((a, b) => a.lorong - b.lorong)
                          ).map(p => (
                            <tr key={p.noBib} className="border-t border-gray-50">
                              <td className="px-3 py-1 text-center font-black text-[#003399] w-8">
                                {isPadang || isMass ? p.giliran : p.lorong}
                              </td>
                              <td className="px-2 py-1 font-mono text-gray-400">{p.noBib}</td>
                              <td className="px-2 py-1 font-semibold text-gray-800">{p.namaAtlet}</td>
                              <td className="px-2 py-1 text-gray-400">{p.kodSekolah}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loadingP && peserta.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center gap-2 shrink-0">
            <button onClick={buatPreview}
              className="px-4 py-2 text-xs font-bold border border-[#003399] text-[#003399] rounded-lg hover:bg-blue-50 transition-colors">
              {preview ? 'Jana Semula' : 'Preview'}
            </button>
            <div className="flex gap-2">
              <button onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">
                Batal
              </button>
              <button onClick={handleSimpan} disabled={!preview || saving}
                className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50 transition-colors">
                {saving ? 'Menyimpan…' : 'Simpan Start List'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Halaman Utama ────────────────────────────────────────────────────────────

export default function StartList() {
  const { userRole } = useAuth()
  // Hanya superadmin + admin boleh jana/edit heat
  const canEdit = ['superadmin', 'admin'].includes(userRole)

  const [selectedKej, setSelectedKej]    = useState('')
  const [namaKej, setNamaKej]            = useState('')
  const [acaraList, setAcaraList]        = useState([])
  const [selectedAcara, setSelectedAcara]= useState(null)
  const [pesertaList, setPesertaList]    = useState([])  // dari pendaftaran
  const [heatList, setHeatList]          = useState([])  // heat sedia ada
  const [rekodAcara, setRekodAcara]      = useState({ D: null, N: null, K: null })
  const [loading, setLoading]            = useState(false)
  const [modal, setModal]                = useState(null)

  const [filterKat, setFilterKat]        = useState('semua')
  const [filterJenis, setFilterJenis]    = useState('semua')
  const [searchNo, setSearchNo]          = useState('')
  const [heatCountMap, setHeatCountMap]  = useState({})   // aceraId → bilangan heat
  const [heatCountTick, setHeatCountTick] = useState(0)   // trigger refresh
  const [sekolahList, setSekolahList]    = useState([])
  const [kategoriList, setKategoriList]  = useState([])
  const [pesertaCountMap, setPesertaCountMap] = useState({}) // aceraId → bilangan peserta
  const [viewMode, setViewMode]          = useState('acara') // 'acara' | 'status'
  const [quickJanaAcara, setQuickJanaAcara] = useState(null) // acara obj | null
  const [resetingAceraId, setResetingAceraId] = useState(null) // aceraId being reset
  const [resetingAll, setResetingAll]    = useState(false)
  const [resetAllConfirm, setResetAllConfirm] = useState(false)

  const namaSekolahMap = useMemo(() =>
    Object.fromEntries(sekolahList.map(s => [s.kodSekolah, s.namaSekolah || s.kodSekolah])),
    [sekolahList]
  )

  // Fetch sekolah + kategori once
  useEffect(() => {
    getDocs(collection(db, 'sekolah'))
      .then(snap => setSekolahList(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
    getDocs(query(collection(db, 'kategori'), orderBy('urutan')))
      .then(snap => setKategoriList(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  // Fetch kejohanan aktif
  useEffect(() => {
    getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', 'in', ['aktif', 'persediaan'])))
      .then(snap => {
        if (!snap.empty) {
          const d = snap.docs[0]
          setSelectedKej(d.id)
          setNamaKej(d.data().namaKejohanan || '')
        }
      }).catch(() => {})
  }, [])

  // Fetch acara bila kejohanan berubah
  useEffect(() => {
    if (!selectedKej) { setAcaraList([]); setSelectedAcara(null); setPesertaCountMap({}); return }
    getDocs(query(collection(db, 'kejohanan', selectedKej, 'acara'), orderBy('kategoriKod')))
      .then(snap => {
        setAcaraList(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setSelectedAcara(null)
      }).catch(() => {})
  }, [selectedKej])

  // Fetch peserta count semua acara (untuk status panel)
  useEffect(() => {
    if (!selectedKej) { setPesertaCountMap({}); return }
    getDocs(collection(db, 'kejohanan', selectedKej, 'pendaftaran'))
      .then(snap => {
        const map = {}
        snap.docs.forEach(d => {
          const p = d.data()
          ;(p.acaraIds || []).forEach(aid => {
            map[aid] = (map[aid] || 0) + 1
          })
        })
        setPesertaCountMap(map)
      }).catch(() => {})
  }, [selectedKej, heatCountTick])

  // Fetch bilangan heat semua acara (untuk badge dalam senarai)
  useEffect(() => {
    if (!selectedKej || acaraList.length === 0) { setHeatCountMap({}); return }
    let cancelled = false
    Promise.all(
      acaraList.map(a => {
        const aid = a.aceraId || a.id
        return getDocs(collection(db, 'kejohanan', selectedKej, 'acara', aid, 'heat'))
          .then(snap => ({ aceraId: aid, count: snap.size }))
          .catch(() => ({ aceraId: aid, count: 0 }))
      })
    ).then(results => {
      if (cancelled) return
      const map = {}
      results.forEach(r => { map[r.aceraId] = r.count })
      setHeatCountMap(map)
    })
    return () => { cancelled = true }
  }, [selectedKej, acaraList, heatCountTick])

  // Fetch peserta + heat + rekod bila acara berubah
  const fetchAcaraData = useCallback(async () => {
    if (!selectedAcara || !selectedKej) {
      setPesertaList([]); setHeatList([])
      setRekodAcara({ D: null, N: null, K: null })
      return
    }
    setLoading(true)
    try {
      const [pendSnap, heatSnap, rekod] = await Promise.all([
        getDocs(query(collection(db, 'kejohanan', selectedKej, 'pendaftaran'))),
        getDocs(query(collection(db, 'kejohanan', selectedKej, 'acara', selectedAcara.aceraId, 'heat'), orderBy('noHeat'))),
        cariRekodUntukAcara(selectedAcara),
      ])
      const peserta = pendSnap.docs
        .map(d => d.data())
        .filter(p => (p.acaraIds || []).includes(selectedAcara.aceraId))
      setPesertaList(peserta)
      setHeatList(heatSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setRekodAcara(rekod)
      setHeatCountTick(t => t + 1)
    } catch { } finally { setLoading(false) }
  }, [selectedAcara, selectedKej])

  useEffect(() => { fetchAcaraData() }, [fetchAcaraData])

  async function handlePadamSemuaHeat() {
    if (!selectedAcara || !selectedKej) return
    if (!window.confirm('Padam semua heat? Ini akan reset start list acara ini.')) return
    try {
      const batch = writeBatch(db)
      heatList.forEach(h => {
        batch.delete(doc(db, 'kejohanan', selectedKej, 'acara', selectedAcara.aceraId, 'heat', h.heatId))
      })
      await batch.commit()
      setHeatList([])
      setHeatCountTick(t => t + 1) // refresh status panel
    } catch (e) { alert(e.message) }
  }

  // Reset heat untuk satu acara (dari Status panel)
  async function handleResetHeatAcara(acara) {
    if (!selectedKej) return
    const aid = acara.aceraId || acara.id
    setResetingAceraId(aid)
    try {
      const heatSnap = await getDocs(collection(db, 'kejohanan', selectedKej, 'acara', aid, 'heat'))
      if (!heatSnap.empty) {
        const batch = writeBatch(db)
        heatSnap.docs.forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      // Jika acara ini sedang dipapar dalam tab Acara, kosongkan heat list
      if (selectedAcara && (selectedAcara.aceraId || selectedAcara.id) === aid) {
        setHeatList([])
      }
      setHeatCountTick(t => t + 1)
    } catch (e) { alert(e.message) }
    finally { setResetingAceraId(null) }
  }

  // Reset heat SEMUA acara
  async function handleResetSemuaHeat() {
    if (!selectedKej) return
    setResetingAll(true)
    try {
      const acaraAktif = acaraList.filter(a => a.isAktif !== false)
      for (const acara of acaraAktif) {
        const aid = acara.aceraId || acara.id
        const heatSnap = await getDocs(collection(db, 'kejohanan', selectedKej, 'acara', aid, 'heat'))
        if (heatSnap.empty) continue
        const batch = writeBatch(db)
        heatSnap.docs.forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      setHeatList([])
      setHeatCountTick(t => t + 1)
      setResetAllConfirm(false)
    } catch (e) { alert(e.message) }
    finally { setResetingAll(false) }
  }

  // Acara filtered
  const katList = [...new Set(acaraList.map(a => a.kategoriKod))].sort()
  const jenisShort = {lorong:'Lorong',mass_start:'Mass',padang_lompat:'Lompat',padang_balin:'Balin',relay:'Relay'}
  const acaraFiltered = acaraList.filter(a => {
    if (a.isAktif === false) return false
    if (filterKat !== 'semua' && a.kategoriKod !== filterKat) return false
    if (filterJenis !== 'semua' && a.jenisAcara !== filterJenis) return false
    if (searchNo.trim()) {
      const q = searchNo.trim()
      const matchNo   = String(a.noAcara || '').includes(q)
      const matchNama = (a.namaAcara || '').toLowerCase().includes(q.toLowerCase())
      if (!matchNo && !matchNama) return false
    }
    return true
  })

  const isPadang = selectedAcara && ['padang_lompat','padang_balin'].includes(selectedAcara.jenisAcara)
  const isMass   = selectedAcara?.jenisAcara === 'mass_start'

  // ── Derived: Heat → Final gate ────────────────────────────────────────────
  const heatPhaseHeats = heatList.filter(h => h.fasa === 'heat' || h.fasa === 'saringan')
  const finalExists    = heatList.some(h => h.fasa === 'final')
  const allHeatRasmi   = heatPhaseHeats.length > 0 &&
    heatPhaseHeats.every(h => h.statusKeputusan === 'rasmi')
  const canJanaFinal   = canEdit && allHeatRasmi && !finalExists

  return (
    <div className="p-5 max-w-6xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Start List</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {canEdit ? 'Jana heat, assign lorong/giliran, export PDF' : 'Paparan susunan heat dan lorong atlet'}
          </p>
          {namaKej && <p className="text-xs font-semibold text-[#003399] mt-0.5">{namaKej}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!canEdit && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
              <svg className="w-3.5 h-3.5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
              </svg>
              <span className="text-[10px] font-bold text-amber-700">Paparan Sahaja</span>
            </div>
          )}
          {selectedKej && acaraList.length > 0 && (
            <div className="flex rounded-xl border border-gray-200 overflow-hidden">
              <button onClick={() => setViewMode('status')}
                className={`px-3 py-2 text-[10px] font-bold transition-colors ${viewMode==='status'?'bg-[#003399] text-white':'bg-white text-gray-600 hover:bg-gray-50'}`}>
                Status
              </button>
              <button onClick={() => setViewMode('acara')}
                className={`px-3 py-2 text-[10px] font-bold transition-colors border-l border-gray-200 ${viewMode==='acara'?'bg-[#003399] text-white':'bg-white text-gray-600 hover:bg-gray-50'}`}>
                Acara
              </button>
            </div>
          )}
          {canEdit && selectedKej && acaraList.length > 0 && (
            <button
              onClick={() => setModal({ type: 'janaSemua' })}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-[#003399] text-white rounded-xl hover:bg-[#002288] transition-colors shadow-sm">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Jana Semua Heat
            </button>
          )}
        </div>
      </div>

      {selectedKej && viewMode === 'status' && (() => {
        // ── Status Panel ──────────────────────────────────────────────────────
        const acaraAktif = acaraList.filter(a => a.isAktif !== false)
        const totalAcara = acaraAktif.length
        const sudahJana  = acaraAktif.filter(a => (heatCountMap[a.aceraId || a.id] || 0) > 0).length
        const adaPeserta = acaraAktif.filter(a => (pesertaCountMap[a.aceraId || a.id] || 0) > 0).length
        const belumJana  = acaraAktif.filter(a =>
          (pesertaCountMap[a.aceraId || a.id] || 0) > 0 &&
          (heatCountMap[a.aceraId || a.id] || 0) === 0
        ).length

        // Filter by searchNo (shared with acara panel)
        const acaraCarian = searchNo.trim()
          ? acaraAktif.filter(a => {
              const q = searchNo.trim()
              return String(a.noAcara || '').includes(q) ||
                     (a.namaAcara || '').toLowerCase().includes(q.toLowerCase())
            })
          : acaraAktif

        // Group by kategoriKod
        const byKat = {}
        acaraCarian.forEach(a => {
          const k = a.kategoriKod || '?'
          if (!byKat[k]) byKat[k] = []
          byKat[k].push(a)
        })
        const katKeys = Object.keys(byKat).sort()

        function statusBadge(aceraId) {
          const peserta = pesertaCountMap[aceraId] || 0
          const heat    = heatCountMap[aceraId]    || 0
          if (peserta === 0) return <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Kosong</span>
          if (heat === 0)    return <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Belum Jana</span>
          return <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">✓ {heat} Heat</span>
        }

        return (
          <div className="space-y-4">
            {/* Search bar */}
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"/>
              </svg>
              <input
                type="text"
                placeholder="Cari no. acara atau nama… (cth: 101, 200m)"
                value={searchNo}
                onChange={e => setSearchNo(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399]"
              />
              {searchNo && (
                <button onClick={() => setSearchNo('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-lg leading-none">
                  ×
                </button>
              )}
            </div>
            {searchNo.trim() && (
              <p className="text-xs text-[#003399] font-semibold -mt-2">
                {acaraCarian.length} acara ditemui untuk "{searchNo.trim()}"
              </p>
            )}
            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Jumlah Acara',  val: totalAcara, cls: 'bg-white border-gray-100 text-gray-800' },
                { label: 'Ada Peserta',   val: adaPeserta, cls: 'bg-blue-50 border-blue-100 text-blue-800' },
                { label: 'Sudah Jana',    val: sudahJana,  cls: 'bg-green-50 border-green-100 text-green-800' },
                { label: 'Belum Jana',    val: belumJana,  cls: belumJana>0?'bg-amber-50 border-amber-200 text-amber-800':'bg-white border-gray-100 text-gray-400' },
              ].map(c => (
                <div key={c.label} className={`rounded-xl border shadow-sm p-3 text-center ${c.cls}`}>
                  <p className="text-2xl font-black">{c.val}</p>
                  <p className="text-[10px] font-semibold mt-0.5 opacity-70">{c.label}</p>
                </div>
              ))}
            </div>

            {/* Progress bar + Reset Semua */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-700">Kemajuan Jana Start List</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {adaPeserta > 0 ? Math.round(sudahJana/adaPeserta*100) : 0}% siap · {totalAcara - adaPeserta} acara tiada peserta
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="text-xs font-bold text-[#003399]">{sudahJana} / {adaPeserta} acara</p>
                  {canEdit && sudahJana > 0 && (
                    <button
                      onClick={() => setResetAllConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Reset Semua Heat
                    </button>
                  )}
                </div>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div
                  className="bg-[#003399] h-2.5 rounded-full transition-all"
                  style={{ width: adaPeserta > 0 ? `${Math.round(sudahJana/adaPeserta*100)}%` : '0%' }}
                />
              </div>
            </div>

            {/* Table per kategori */}
            {katKeys.map(kat => (
              <div key={kat} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-[#003399] flex items-center gap-2">
                  <span className="text-xs font-black text-white">Kategori {katLabel(kat, kategoriList)}</span>
                  <span className="text-[10px] text-blue-200">{byKat[kat].length} acara</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-50 bg-gray-50">
                      <th className="px-3 py-2 text-left text-[9px] font-bold text-gray-400 uppercase w-10">No</th>
                      <th className="px-3 py-2 text-left text-[9px] font-bold text-gray-400 uppercase">Acara</th>
                      <th className="px-3 py-2 text-center text-[9px] font-bold text-gray-400 uppercase w-8">J</th>
                      <th className="px-3 py-2 text-center text-[9px] font-bold text-gray-400 uppercase w-16">Peserta</th>
                      <th className="px-3 py-2 text-center text-[9px] font-bold text-gray-400 uppercase w-14">Heat</th>
                      <th className="px-3 py-2 text-center text-[9px] font-bold text-gray-400 uppercase w-28">Status</th>
                      <th className="px-3 py-2 w-14"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...byKat[kat]].sort((a,b)=>(a.noAcara||0)-(b.noAcara||0)).map(a => {
                      const aid     = a.aceraId || a.id
                      const peserta = pesertaCountMap[aid] || 0
                      const heat    = heatCountMap[aid]    || 0
                      return (
                        <tr key={aid} className="border-t border-gray-50 hover:bg-blue-50/30 transition-colors">
                          <td className="px-3 py-2.5 font-mono text-gray-400 text-[10px]">{a.noAcara || '—'}</td>
                          <td className="px-3 py-2.5 font-semibold text-gray-800">{a.namaAcara}</td>
                          <td className="px-3 py-2.5 text-center font-black text-[10px]">
                            <span className={a.jantina==='L'?'text-blue-600':'text-pink-600'}>{a.jantina}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold text-gray-700">
                            {peserta > 0 ? peserta : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold text-[#003399]">
                            {heat > 0 ? heat : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">{statusBadge(aid)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Reset heat individu */}
                              {canEdit && heat > 0 && (
                                <button
                                  onClick={() => handleResetHeatAcara(a)}
                                  disabled={resetingAceraId === aid}
                                  title="Padam heat acara ini — PP boleh daftar semula"
                                  className="text-[9px] font-bold px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors">
                                  {resetingAceraId === aid ? '…' : 'Reset'}
                                </button>
                              )}
                              {canEdit && peserta > 0 && (
                                <button
                                  onClick={() => setQuickJanaAcara(a)}
                                  className={`text-[9px] font-bold px-2 py-1 rounded-lg transition-colors ${
                                    heat > 0
                                      ? 'border border-amber-300 text-amber-700 hover:bg-amber-50'
                                      : 'bg-[#003399] text-white hover:bg-[#002288]'
                                  }`}>
                                  {heat > 0 ? 'Jana Semula' : 'Jana Heat'}
                                </button>
                              )}
                              <button
                                onClick={() => { setSelectedAcara(a); setViewMode('acara') }}
                                className="text-[9px] font-bold text-[#003399] hover:underline">
                                Lihat →
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )
      })()}

      {selectedKej && viewMode === 'acara' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Kiri: Senarai Acara ── */}
          <div className="space-y-3">
            {/* Search by no acara */}
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"/>
              </svg>
              <input
                type="text"
                placeholder="Cari no. acara atau nama… (cth: 101)"
                value={searchNo}
                onChange={e => setSearchNo(e.target.value)}
                className="w-full pl-8 pr-8 py-2 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399]"
              />
              {searchNo && (
                <button onClick={() => setSearchNo('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-base leading-none">
                  ×
                </button>
              )}
            </div>
            {/* Filter kat */}
            <div className="flex flex-wrap gap-1.5">
              {['semua', ...katList].map(k => (
                <button key={k} onClick={() => setFilterKat(k)}
                  className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-colors ${filterKat===k?'bg-[#003399] text-white border-[#003399]':'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                  {k==='semua'?'Semua':`Kat ${katLabel(k, kategoriList)}`}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['semua','lorong','mass_start','padang_lompat','padang_balin','relay'].map(j => (
                <button key={j} onClick={() => setFilterJenis(j)}
                  className={`px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-colors ${filterJenis===j?'bg-[#003399] text-white border-[#003399]':'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}>
                  {j==='semua'?'Semua':jenisShort[j]}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              {acaraFiltered.map(a => {
                const isSelected = selectedAcara?.aceraId === a.aceraId
                return (
                  <button key={a.aceraId}
                    onClick={() => setSelectedAcara(a)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                      isSelected ? 'border-[#003399] bg-blue-50 shadow-sm' : 'border-gray-100 bg-white hover:border-gray-300'
                    }`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate">{a.namaAcara}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[9px] font-bold text-[#003399]">{katLabel(a.kategoriKod, kategoriList)}</span>
                          <span className={`text-[9px] font-black ${a.jantina==='L'?'text-blue-600':'text-pink-600'}`}>{a.jantina}</span>
                          <span className="text-[9px] text-gray-400">{jenisShort[a.jenisAcara]}</span>
                        </div>
                      </div>
                      {(() => {
                        const count = heatCountMap[a.aceraId || a.id] ?? 0
                        if (count === 0) return null
                        const hasFinal = isSelected
                          ? heatList.some(h => h.fasa === 'final')
                          : false
                        return (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                            hasFinal
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {hasFinal ? '🏁' : '✓'} {count} heat
                          </span>
                        )
                      })()}
                    </div>
                  </button>
                )
              })}
              {acaraFiltered.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">
                  {searchNo.trim() ? `Tiada acara untuk "${searchNo.trim()}"` : 'Tiada acara.'}
                </p>
              )}
            </div>
          </div>

          {/* ── Kanan: Detail Heat ── */}
          <div className="lg:col-span-2 space-y-3">
            {!selectedAcara ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-16 text-center">
                <p className="text-sm text-gray-400">Pilih acara di sebelah kiri</p>
              </div>
            ) : (
              <>
                {/* Acara header */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-gray-800">{selectedAcara.namaAcara}</h2>
                      <p className="text-[10px] font-mono text-gray-400 mt-0.5">{selectedAcara.aceraId}</p>
                      <div className="flex gap-2 mt-2">
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">{pesertaList.length} peserta berdaftar</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full">{heatList.length} heat</span>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end items-center">
                      {/* View-only badge untuk bukan admin */}
                      {!canEdit && (
                        <span className="text-[10px] font-bold px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg">
                          Paparan Sahaja
                        </span>
                      )}
                      {/* PDF — semua boleh export */}
                      {heatList.length > 0 && (
                        <button
                          onClick={() => exportStartListPDF(selectedAcara, heatList, namaKej, namaSekolahMap, rekodAcara, kategoriList)}
                          className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          PDF
                        </button>
                      )}
                      {/* Jana/Reset — admin sahaja */}
                      {canEdit && heatList.length > 0 && (
                        <button onClick={handlePadamSemuaHeat}
                          className="px-3 py-2 text-[10px] font-bold border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                          Reset
                        </button>
                      )}
                      {canEdit && pesertaList.length > 0 && (
                        <button
                          onClick={() => setModal({ type: 'generate' })}
                          className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          {heatList.length > 0 ? 'Jana Semula' : 'Jana Heat'}
                        </button>
                      )}
                      {/* Butang Jana Final — muncul bila semua heat RASMI & tiada final lagi */}
                      {canJanaFinal && (
                        <button
                          onClick={() => setModal({ type: 'janaFinal' })}
                          className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shadow-sm">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Jana Final
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Rekod Acara ── */}
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                    </svg>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Rekod Acara</p>
                  </div>
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/50">
                        <th className="px-4 py-1.5 text-left font-bold text-gray-400 w-24">Rekod</th>
                        <th className="px-3 py-1.5 text-center font-bold text-gray-400 w-14">Tahun</th>
                        <th className="px-3 py-1.5 text-center font-bold text-gray-400 w-20">Masa/Jarak</th>
                        <th className="px-3 py-1.5 text-left font-bold text-gray-400">Nama</th>
                        <th className="px-3 py-1.5 text-left font-bold text-gray-400">Catatan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { key: 'D', label: 'Daerah',      cls: 'text-gray-600' },
                        { key: 'N', label: 'Negeri',      cls: 'text-indigo-700' },
                        { key: 'K', label: 'Kebangsaan',  cls: 'text-red-700' },
                      ].map(({ key, label, cls }) => {
                        const r = rekodAcara[key]
                        return (
                          <tr key={key} className="border-b border-gray-50 last:border-0">
                            <td className={`px-4 py-2 font-bold ${cls}`}>{label}</td>
                            <td className="px-3 py-2 text-center text-gray-500">{r ? tahunRekod(r.tarikhRekod) : '—'}</td>
                            <td className="px-3 py-2 text-center font-mono font-semibold text-gray-700">{r ? formatPrestasiRekod(r.prestasi, r.unit) : '—'}</td>
                            <td className="px-3 py-2 text-gray-700">{r ? (r.namaAtlet || '—') : '—'}</td>
                            <td className="px-3 py-2 text-gray-400">{r ? lokasiRekod(r) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Banner: Semua heat RASMI — sedia jana Final */}
                {canJanaFinal && (
                  <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-purple-600 text-lg">🏁</span>
                      <div>
                        <p className="text-xs font-bold text-purple-800">Semua Heat RASMI</p>
                        <p className="text-[10px] text-purple-500">
                          {heatPhaseHeats.length} heat selesai · Sedia pilih finalis dan jana heat Final
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setModal({ type: 'janaFinal' })}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shrink-0">
                      Jana Final →
                    </button>
                  </div>
                )}

                {/* Banner: Final sudah wujud */}
                {finalExists && (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
                    <span className="text-green-600">✓</span>
                    <p className="text-xs font-semibold text-green-700">Heat Final sudah dijana.</p>
                  </div>
                )}

                {/* Peserta belum ada heat */}
                {pesertaList.length === 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                    <p className="text-sm font-semibold text-amber-800">Tiada peserta berdaftar untuk acara ini.</p>
                    <p className="text-xs text-amber-600 mt-1">Daftar atlet dahulu dalam modul Pendaftaran Atlet.</p>
                  </div>
                )}

                {/* Loading */}
                {loading && (
                  <div className="py-8 text-center text-sm text-gray-400">Memuatkan…</div>
                )}

                {/* Heat cards */}
                {!loading && heatList.map(heat => {
                  const sortedPeserta = [...(heat.peserta||[])].sort((a,b) =>
                    isPadang||isMass ? a.giliran-b.giliran : a.lorong-b.lorong
                  )
                  return (
                    <div key={heat.heatId} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                      {/* Heat header */}
                      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FasaBadge fasa={heat.fasa} />
                          <span className="text-xs font-bold text-gray-700">{FASA_LABEL[heat.fasa]||heat.fasa} {heat.noHeat}</span>
                          <StatusBadge status={heat.status} />
                          <span className="text-[9px] font-mono text-gray-400">{heat.heatId}</span>
                        </div>
                      {canEdit && (
                        <button
                          onClick={() => setModal({ type: 'editlorong', heat })}
                          className="text-[10px] font-semibold text-[#003399] hover:underline">
                          Edit {isPadang||isMass?'Giliran':'Lorong'}
                        </button>
                      )}
                      </div>

                      {/* Peserta table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-50 bg-white">
                              <th className="px-3 py-2 text-center text-[9px] font-bold text-gray-400 uppercase w-14">{isPadang||isMass?'Gil':'Lorong'}</th>
                              <th className="px-3 py-2 text-left text-[9px] font-bold text-gray-400 uppercase">BIB</th>
                              <th className="px-3 py-2 text-left text-[9px] font-bold text-gray-400 uppercase">Nama Atlet</th>
                              <th className="px-3 py-2 text-left text-[9px] font-bold text-gray-400 uppercase">Sekolah</th>
                              <th className="px-3 py-2 text-center text-[9px] font-bold text-gray-400 uppercase">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedPeserta.map(p => (
                              <tr key={p.noBib} className="border-b border-gray-50 hover:bg-gray-50/50">
                                <td className="px-3 py-2 text-center font-black text-[#003399] text-sm">
                                  {isPadang||isMass ? p.giliran : p.lorong}
                                </td>
                                <td className="px-3 py-2 font-mono font-bold text-gray-700">{p.noBib}</td>
                                <td className="px-3 py-2 font-semibold text-gray-800">{p.namaAtlet}</td>
                                <td className="px-3 py-2 text-gray-500">{namaSekolahMap[p.kodSekolah] || p.namaSekolah || p.kodSekolah}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                    p.status === 'belum' ? 'bg-gray-100 text-gray-400' :
                                    p.status === 'DNS'   ? 'bg-red-100 text-red-600' :
                                    p.status === 'DQ'    ? 'bg-red-100 text-red-700' :
                                    'bg-green-100 text-green-700'
                                  }`}>{p.status === 'belum' ? '—' : p.status}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}

                {/* Empty state */}
                {!loading && heatList.length === 0 && pesertaList.length > 0 && (
                  <div className="bg-white rounded-xl border border-dashed border-gray-300 shadow-sm py-10 text-center">
                    <p className="text-sm text-gray-500 font-semibold">Start List belum dijana.</p>
                    <p className="text-xs text-gray-400 mt-1">Klik "Jana Heat" untuk assign lorong/giliran secara automatik.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Quick Jana Modal — dari Status Panel */}
      {quickJanaAcara && selectedKej && (
        <QuickJanaModal
          acara={quickJanaAcara}
          kejohananId={selectedKej}
          onClose={() => setQuickJanaAcara(null)}
          onDone={() => { setHeatCountTick(t => t + 1); setQuickJanaAcara(null) }}
        />
      )}

      {/* Modals */}
      {modal?.type === 'janaSemua' && selectedKej && (
        <JanaSemuaModal
          kejohananId={selectedKej}
          acaraList={acaraList}
          onClose={() => setModal(null)}
          onDone={fetchAcaraData}
        />
      )}
      {modal?.type === 'generate' && selectedAcara && (
        <GenerateModal
          acara={{ ...selectedAcara, _kejohananId: selectedKej }}
          peserta={pesertaList}
          onClose={() => setModal(null)}
          onGenerated={fetchAcaraData}
          sekolahMap={namaSekolahMap}
        />
      )}
      {modal?.type === 'editlorong' && selectedAcara && (
        <EditLorongModal
          heat={modal.heat}
          acara={selectedAcara}
          kejohananId={selectedKej}
          onClose={() => setModal(null)}
          onSaved={fetchAcaraData}
          sekolahMap={namaSekolahMap}
        />
      )}
      {modal?.type === 'janaFinal' && selectedAcara && (
        <JanaFinalModal
          acara={{ ...selectedAcara, _kejohananId: selectedKej }}
          heatList={heatList}
          kejohananId={selectedKej}
          onClose={() => setModal(null)}
          onGenerated={fetchAcaraData}
          sekolahMap={namaSekolahMap}
        />
      )}

      {/* Modal: Konfirmasi Reset Semua Heat */}
      {resetAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-800">Reset Semua Start List?</h2>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Tindakan ini akan memadamkan <strong>semua heat</strong> bagi semua acara dalam kejohanan ini.
                  Pengurus Pasukan akan boleh mendaftar/edit/buang peserta semula.
                </p>
                <div className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-[10px] text-red-700 font-semibold">
                    {acaraList.filter(a => a.isAktif !== false && (heatCountMap[a.aceraId || a.id] || 0) > 0).length} acara akan di-reset.
                    Tindakan ini tidak boleh dibatalkan.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setResetAllConfirm(false)} disabled={resetingAll}
                className="flex-1 px-3 py-2 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                Batal
              </button>
              <button onClick={handleResetSemuaHeat} disabled={resetingAll}
                className="flex-1 px-3 py-2 text-xs font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {resetingAll ? 'Memproses…' : 'Ya, Reset Semua'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
