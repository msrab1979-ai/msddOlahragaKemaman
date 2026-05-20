/**
 * SekolahSetup — /dashboard/sekolah
 * Pengurusan sekolah: tambah, edit, aktif/nyahaktif, reset PIN, import Excel, export PDF, seed dummy
 */

import { useState, useEffect } from 'react'
import {
  collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, deleteField,
  serverTimestamp, query, orderBy, writeBatch, where, limit,
} from 'firebase/firestore'
// Firebase Auth tidak digunakan lagi untuk sekolah — login via Firestore PIN check
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import PasswordInput from '../../components/ui/PasswordInput'
import { hashPin } from '../../utils/hashPin'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Constants ────────────────────────────────────────────────────────────────

const KATEGORI_LIST_FALLBACK = ['SR', 'SM', 'PPKI']
const KATEGORI_SAH = ['SR', 'SM', 'PPKI']
const NEGERI_LIST   = ['Terengganu', 'Kelantan', 'Pahang', 'Johor', 'Selangor',
  'Perak', 'Kedah', 'Perlis', 'Pulau Pinang', 'Negeri Sembilan',
  'Melaka', 'Sabah', 'Sarawak', 'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya']

const BIB_FORMAT_OPTIONS = [
  { value: 1, label: '1',   example: '1, 2, 3…'     },
  { value: 2, label: '01',  example: '01, 02, 03…'   },
  { value: 3, label: '001', example: '001, 002, 003…' },
]

// Jana contoh BIB: prefix + nombor dengan padding
function previewBib(prefix, mula, format) {
  if (!prefix) return '—'
  const p = (prefix || '').toUpperCase()
  const start = Number(mula) || 1
  const nums = [start, start + 1, start + 2]
  return nums.map(n => p + String(n).padStart(Number(format) || 3, '0')).join(', ') + '…'
}

const EMPTY_FORM = {
  kodSekolah: '', namaSekolah: '', kategori: 'SR', negeri: 'Terengganu',
  daerah: 'Kemaman', email: '', bibPrefix: '', bibMula: 1, bibFormat: 3, pin: '', isAktif: true,
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] ' +
  'bg-gray-50 transition-colors'

// ─── Import: validate satu baris ─────────────────────────────────────────────

// Normalise semua kunci header — cover case mismatch (pin/PIN/Pin)
function normaliseRow(r) {
  const out = {}
  for (const [k, v] of Object.entries(r)) {
    out[k.trim().toLowerCase()] = v
  }
  // Peta nama alternatif → nama standard
  const MAP = {
    kodsekolah:  'kodSekolah',
    namasekolah: 'namaSekolah',
    bibprefix:   'bibPrefix',
    bibmula:     'bibMula',
    bibformat:   'bibFormat',
  }
  const norm = {}
  for (const [k, v] of Object.entries(out)) {
    norm[MAP[k] || k] = v
  }
  return norm
}

// Normalise pin — cover Excel strip leading zero (012345 → 12345)
function normalisePin(raw) {
  if (raw === null || raw === undefined || raw === '') return ''
  const s = String(raw).trim()
  // Pad balik ke 6 digit jika nombor (Excel strip leading zero)
  if (/^\d{1,6}$/.test(s)) return s.padStart(6, '0')
  return s
}

function validateImportRowSekolah(r) {
  const errors   = []
  const warnings = []

  const kod    = r.kodSekolah?.toString().trim()
  const nama   = r.namaSekolah?.toString().trim()
  const kat    = r.kategori?.toString().trim()
  const prefix = r.bibPrefix?.toString().trim()
  const pin    = normalisePin(r.pin)

  if (!kod)   errors.push('kodSekolah kosong')
  if (!nama)  errors.push('namaSekolah kosong')
  if (!kat || !KATEGORI_SAH.includes(kat.toUpperCase()))
              errors.push('kategori mesti SR / SM / PPKI')
  if (!prefix) errors.push('bibPrefix kosong')
  else if (prefix.length > 5) errors.push('bibPrefix mesti ≤ 5 aksara')

  // bibFormat mesti 1, 2, atau 3 — bukan string seperti "001"
  const bf = r.bibFormat !== undefined && r.bibFormat !== ''
    ? Number(r.bibFormat) : null
  if (bf !== null && ![1, 2, 3].includes(bf))
    errors.push('bibFormat mesti 1, 2, atau 3 (bukan "001")')

  if (errors.length === 0) {
    if (!pin || !/^\d{6}$/.test(pin)) warnings.push('pin bukan 6 digit — akan guna 000000')
    if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email?.toString().trim()))
      warnings.push('format email tidak sah')
    if (!r.daerah?.toString().trim()) warnings.push('daerah kosong')
  }

  return {
    errors,
    warnings,
    status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok',
    _pin: pin,  // simpan pin yang dah dinormalise untuk guna masa import
  }
}

// ─── Template download ────────────────────────────────────────────────────────

function downloadTemplateSekolah() {
  const wb = XLSX.utils.book_new()

  // Sheet 1: SEKOLAH — headers + 3 contoh
  const headers = [
    'kodSekolah', 'namaSekolah', 'kategori', 'negeri', 'daerah',
    'email', 'bibPrefix', 'bibMula', 'bibFormat', 'pin',
  ]
  const examples = [
    ['KMN-SR-001', 'SK Sultan Ismail', 'SR', 'Terengganu', 'Kemaman', 'sk@moe.edu.my', 'SSI', 1, 3, '123456'],
    ['KMN-SM-001', 'SMK Kemaman', 'SM', 'Terengganu', 'Kemaman', '', 'MKM', 1, 3, '234567'],
    ['KMN-PPKI-001', 'SK (PPKI) Kemaman', 'PPKI', 'Terengganu', 'Kemaman', '', 'PPK', 1, 3, '345678'],
  ]
  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...examples])

  // Format kolum pin sebagai TEXT — elak Excel strip leading zero (012345 → 12345)
  const pinCol = 'J'
  for (let row = 2; row <= examples.length + 1; row++) {
    const cell = `${pinCol}${row}`
    if (ws1[cell]) ws1[cell].t = 's'  // force string type
  }
  // Set format untuk seluruh kolum pin supaya input user pun jadi text
  if (!ws1['!cols']) ws1['!cols'] = []
  ws1['!cols'][9] = { wch: 8, z: '@' }  // @ = text format dalam Excel
  ws1['!cols'] = [
    {wch:16},{wch:28},{wch:8},{wch:14},{wch:12},
    {wch:24},{wch:10},{wch:10},{wch:10},{wch:8},
  ]
  XLSX.utils.book_append_sheet(wb, ws1, 'SEKOLAH')

  // Sheet 2: RUJUKAN
  const rujukan = [
    ['KOLUM',      'NILAI SAH',           'NOTA'],
    ['kodSekolah', 'Teks unik',           'Huruf besar, tanpa ruang. Cth: KMN-SR-001'],
    ['namaSekolah','Teks',                'Nama penuh sekolah'],
    ['kategori',   'SR, SM, PPKI',        'SR = Sekolah Rendah, SM = Menengah, PPKI = Pendidikan Khas'],
    ['negeri',     'Nama negeri',         'Cth: Terengganu, Kelantan, Pahang'],
    ['daerah',     'Nama daerah',         'Cth: Kemaman'],
    ['email',      'Format emel atau kosong','Cth: sekolah@moe.edu.my'],
    ['bibPrefix',  'Teks ≤ 5 aksara',    'Huruf besar sahaja. Cth: SSI, MKM, PPK'],
    ['bibMula',    'Nombor (default: 1)', 'Nombor BIB permulaan'],
    ['bibFormat',  '1, 2, atau 3 (NOMBOR)',  '1=tiada pad (1,2,3), 2=2digit (01,02), 3=3digit (001,002). JANGAN isi "001" — isi nombor 1/2/3 sahaja'],
    ['pin',        '6 digit angka (TEXT)',  '⚠ Kolum ini FORMAT TEXT. Jangan tukar ke nombor. PIN bermula 0 contoh: 012345 mesti kekal sebagai teks'],
    ['','',''],
    ['NOTA PENTING','',''],
    ['Kolum wajib: kodSekolah, namaSekolah, kategori, bibPrefix','',''],
    ['pin tidak 6 digit: akan diguna 000000 (boleh reset kemudian via butang Reset PIN)','',''],
    ['kodSekolah duplikasi: rekod akan DIKEMASKINI (createdAt asal kekal)','',''],
    ['Header Excel tidak case-sensitive: PIN / pin / Pin semuanya OK','',''],
  ]
  const ws2 = XLSX.utils.aoa_to_sheet(rujukan)
  ws2['!cols'] = [{wch:16},{wch:22},{wch:52}]
  XLSX.utils.book_append_sheet(wb, ws2, 'RUJUKAN')

  XLSX.writeFile(wb, 'template_sekolah_koam.xlsx')
}

// ─── Modal: Import Sekolah ────────────────────────────────────────────────────

function ImportSekolahModal({ onClose, onDone }) {
  const [step,   setStep]   = useState('idle')   // idle | preview | importing | done
  const [rows,   setRows]   = useState([])
  const [result, setResult] = useState(null)
  const [err,    setErr]    = useState('')

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setErr('')
    try {
      const buffer = await file.arrayBuffer()
      const wb  = XLSX.read(buffer, { type: 'array' })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
      if (raw.length === 0) { setErr('Fail kosong atau format salah.'); return }

      const parsed = raw.map((r, i) => {
        const norm = normaliseRow(r)
        return { data: norm, idx: i + 2, ...validateImportRowSekolah(norm) }
      })
      setRows(parsed)
      setStep('preview')
    } catch (ex) {
      setErr('Gagal baca fail: ' + ex.message)
    }
  }

  async function handleImport(includeWarns) {
    const toImport = rows.filter(r => r.status === 'ok' || (includeWarns && r.status === 'warn'))
    if (toImport.length === 0) { setErr('Tiada rekod untuk diimport.'); return }
    setStep('importing')

    let success = 0, failed = 0
    const CHUNK = 500

    try {
      for (let i = 0; i < toImport.length; i += CHUNK) {
        const chunk = toImport.slice(i, i + CHUNK)

        // R7: hash semua PIN dahulu (async) sebelum batch
        const chunkWithHash = await Promise.all(chunk.map(async ({ data: r, _pin }) => {
          const pinSah = _pin && /^\d{6}$/.test(_pin) ? _pin : '000000'
          const ph     = await hashPin(pinSah)
          return { r, pinHash: ph }
        }))

        const batch = writeBatch(db)

        chunkWithHash.forEach(({ r, pinHash: ph }) => {
          const kod = r.kodSekolah.toString().trim().toUpperCase()
          const bf  = [1, 2, 3].includes(Number(r.bibFormat)) ? Number(r.bibFormat) : 3

          batch.set(doc(db, 'sekolah', kod), {
            kodSekolah:  kod,
            namaSekolah: r.namaSekolah.toString().trim(),
            kategori:    r.kategori.toString().trim().toUpperCase(),
            negeri:      r.negeri?.toString().trim() || 'Terengganu',
            daerah:      r.daerah?.toString().trim() || '',
            email:       r.email?.toString().trim() || '',
            bibPrefix:   r.bibPrefix.toString().trim().toUpperCase(),
            bibMula:     Number(r.bibMula) || 1,
            bibFormat:   bf,
            pinHash:     ph,   // R7: simpan hash, bukan plain text
            isAktif:     true,
            updatedAt:   serverTimestamp(),
            // createdAt TIDAK disertakan — merge kekal nilai asal bagi sekolah sedia ada
          }, { merge: true })
        })

        try {
          await batch.commit()
          success += chunk.length
        } catch {
          failed += chunk.length
        }
      }

      setResult({ success, failed })
      setStep('done')
    } catch (ex) {
      setErr('Gagal import: ' + ex.message)
      setStep('preview')
    }
  }

  const okCount   = rows.filter(r => r.status === 'ok').length
  const warnCount = rows.filter(r => r.status === 'warn').length
  const errCount  = rows.filter(r => r.status === 'error').length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4">
      <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-[#003399] text-white px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/50 uppercase tracking-widest">Import Excel / CSV</p>
            <p className="text-sm font-bold">Import Sekolah ke Sistem</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {err && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>
          )}

          {/* Step: idle */}
          {step === 'idle' && (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center space-y-3">
              <p className="text-3xl">📂</p>
              <p className="text-sm font-semibold text-gray-700">Pilih fail Excel (.xlsx) atau CSV (.csv)</p>
              <p className="text-xs text-gray-400">
                Gunakan template yang disediakan untuk elak ralat format.<br />
                Sheet pertama dalam fail akan dibaca sebagai data sekolah.
              </p>
              <label className="inline-block mt-2 px-6 py-2.5 bg-[#003399] hover:bg-[#002277] text-white text-xs font-bold rounded-lg cursor-pointer transition-colors">
                Pilih Fail
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
              </label>
            </div>
          )}

          {/* Step: preview */}
          {step === 'preview' && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-3 text-center">
                  <p className="text-2xl font-black text-green-700">{okCount}</p>
                  <p className="text-[10px] text-green-600 font-bold uppercase tracking-wide mt-0.5">OK — Sedia Import</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 text-center">
                  <p className="text-2xl font-black text-amber-600">{warnCount}</p>
                  <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wide mt-0.5">Amaran (boleh import)</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-3 text-center">
                  <p className="text-2xl font-black text-red-600">{errCount}</p>
                  <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide mt-0.5">Error — akan skip</p>
                </div>
              </div>

              {/* Preview table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                      <tr className="text-[10px] text-gray-400 uppercase tracking-wide">
                        <th className="px-3 py-2 text-left w-12">Baris</th>
                        <th className="px-3 py-2 text-left">Kod</th>
                        <th className="px-3 py-2 text-left">Nama Sekolah</th>
                        <th className="px-2 py-2 text-center w-14">Kat.</th>
                        <th className="px-2 py-2 text-center w-16">Prefix</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.idx} className={`border-b border-gray-50 ${
                          r.status === 'error' ? 'bg-red-50' :
                          r.status === 'warn'  ? 'bg-amber-50' : ''
                        }`}>
                          <td className="px-3 py-2 text-gray-400 font-mono text-[10px]">{r.idx}</td>
                          <td className="px-3 py-2 font-mono text-gray-700">{r.data.kodSekolah || '—'}</td>
                          <td className="px-3 py-2 font-semibold text-gray-800">{r.data.namaSekolah || '—'}</td>
                          <td className="px-2 py-2 text-center font-mono">{r.data.kategori || '—'}</td>
                          <td className="px-2 py-2 text-center font-mono font-bold text-[#003399]">{r.data.bibPrefix || '—'}</td>
                          <td className="px-3 py-2">
                            {r.status === 'ok' && (
                              <span className="text-green-600 font-semibold text-[10px]">✓ OK</span>
                            )}
                            {r.status === 'warn' && (
                              <span className="text-amber-600 font-semibold text-[10px]" title={r.warnings.join(', ')}>
                                ⚠ {r.warnings[0]}
                              </span>
                            )}
                            {r.status === 'error' && (
                              <span className="text-red-600 font-semibold text-[10px]" title={r.errors.join(', ')}>
                                ✗ {r.errors[0]}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={() => handleImport(true)}
                  disabled={okCount + warnCount === 0}
                  className="flex-1 py-2.5 bg-[#003399] hover:bg-[#002277] disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  Import Semua ({okCount + warnCount} sekolah)
                </button>
                {errCount > 0 && okCount > 0 && (
                  <button
                    onClick={() => handleImport(false)}
                    className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg transition-colors"
                  >
                    Import OK Sahaja ({okCount} sekolah)
                  </button>
                )}
                <button onClick={() => { setStep('idle'); setRows([]) }}
                  className="px-4 py-2.5 border border-gray-200 text-xs text-gray-500 rounded-lg hover:bg-gray-50">
                  Pilih Semula
                </button>
              </div>
            </>
          )}

          {/* Step: importing */}
          {step === 'importing' && (
            <div className="py-14 text-center space-y-3">
              <div className="w-10 h-10 border-2 border-[#003399] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-gray-500">Mengimport sekolah ke Firestore…</p>
              <p className="text-xs text-gray-400">Sila tunggu, jangan tutup tetingkap ini.</p>
            </div>
          )}

          {/* Step: done */}
          {step === 'done' && result && (
            <div className="py-10 text-center space-y-4">
              <p className="text-4xl">✅</p>
              <p className="text-sm font-bold text-gray-800">Import Selesai!</p>
              <div className="flex justify-center gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-3">
                  <p className="text-2xl font-black text-green-700">{result.success}</p>
                  <p className="text-[10px] text-green-600 font-semibold">Sekolah Berjaya</p>
                </div>
                {result.failed > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-6 py-3">
                    <p className="text-2xl font-black text-red-600">{result.failed}</p>
                    <p className="text-[10px] text-red-600 font-semibold">Gagal</p>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mx-auto max-w-xs">
                Sekolah dengan pin "000000" — sila reset PIN melalui butang Reset PIN.
              </p>
              <button onClick={onDone}
                className="px-8 py-2.5 bg-[#003399] hover:bg-[#002277] text-white text-xs font-bold rounded-lg transition-colors">
                Tutup & Muat Semula
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────

const KATEG_CLS = {
  SR:   'bg-blue-100 text-blue-700',
  SM:   'bg-green-100 text-green-700',
  PPKI: 'bg-purple-100 text-purple-700',
}
const KategBadge = ({ k }) => {
  const cls = KATEG_CLS[k] || 'bg-gray-100 text-gray-600'
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{k}</span>
}

const StatusBadge = ({ aktif }) => (
  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
    aktif ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
  }`}>{aktif ? 'Aktif' : 'Nyahaktif'}</span>
)

// ─── FormField ────────────────────────────────────────────────────────────────

const FormField = ({ label, required, hint, children }) => (
  <div>
    <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
    {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
  </div>
)

// ─── Modal Tambah / Edit ──────────────────────────────────────────────────────

function SekolahModal({ initial, onClose, onSaved, jenisList = KATEGORI_LIST_FALLBACK }) {
  const isEdit  = !!initial
  const [form,  setForm]  = useState(initial ?? EMPTY_FORM)
  const [busy,  setBusy]  = useState(false)
  const [err,   setErr]   = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')

    if (!form.kodSekolah.trim())  return setErr('Kod Sekolah diperlukan.')
    if (!form.namaSekolah.trim()) return setErr('Nama Sekolah diperlukan.')
    if (!form.bibPrefix.trim())   return setErr('Bib Prefix diperlukan.')
    if (!isEdit && !/^\d{6}$/.test(form.pin)) return setErr('PIN mesti 6 digit angka.')
    if (isEdit && form.pin && !/^\d{6}$/.test(form.pin)) return setErr('PIN mesti tepat 6 digit angka.')

    const kodBaru    = form.kodSekolah.trim().toUpperCase()
    const kodLama    = initial?.kodSekolah
    const kodBerubah = isEdit && kodBaru !== kodLama

    setBusy(true)
    try {
      // Semak kod baru tidak bertindih
      if (!isEdit || kodBerubah) {
        const snap = await getDoc(doc(db, 'sekolah', kodBaru))
        if (snap.exists()) {
          setErr(`Kod "${kodBaru}" sudah digunakan. Sila guna kod lain.`)
          setBusy(false)
          return
        }
      }

      // Semak bibPrefix unik seluruh sistem — elak noBib clash antara mana-mana sekolah
      const prefixBaru   = form.bibPrefix.trim().toUpperCase()
      const prefixBerubah = isEdit ? prefixBaru !== (initial?.bibPrefix || '').toUpperCase() : true
      if (prefixBerubah) {
        const prefixSnap = await getDocs(query(
          collection(db, 'sekolah'),
          where('bibPrefix', '==', prefixBaru)
        ))
        const clash = prefixSnap.docs.find(d => d.id !== kodBaru && d.id !== kodLama)
        if (clash) {
          setErr(`BIB Prefix "${prefixBaru}" sudah digunakan oleh ${clash.data().namaSekolah} (${clash.id}) [${clash.data().kategori}]. Prefix mesti unik antara semua sekolah.`)
          setBusy(false)
          return
        }
      }

      // Block perubahan kodSekolah jika ada atlet berdaftar — elak orphan records
      if (kodBerubah) {
        const atletSnap = await getDocs(query(collection(db, 'atlet'), where('kodSekolah', '==', kodLama), limit(1)))
        if (!atletSnap.empty) {
          setErr(`Kod sekolah tidak boleh diubah — terdapat atlet yang menggunakan kod "${kodLama}". Sila hubungi pentadbir sistem.`)
          setBusy(false)
          return
        }
      }

      if (!isEdit) {
        // ── TAMBAH BARU — hash PIN sebelum simpan ────────────────────────────
        const ph = await hashPin(form.pin)
        await setDoc(doc(db, 'sekolah', kodBaru), {
          kodSekolah:  kodBaru,
          namaSekolah: form.namaSekolah.trim(),
          kategori:    form.kategori,
          negeri:      form.negeri,
          daerah:      form.daerah.trim(),
          email:       form.email.trim(),
          bibPrefix:   form.bibPrefix.trim().toUpperCase(),
          bibMula:     Number(form.bibMula) || 1,
          bibFormat:   Number(form.bibFormat) || 3,
          pinHash:     ph,    // R7: simpan hash sahaja
          isAktif:     true,
          createdAt:   serverTimestamp(),
        })

      } else if (kodBerubah) {
        // ── EDIT + KOD BERUBAH — pindah dokumen, hash PIN baru jika ada ─────
        const dataLama = (await getDoc(doc(db, 'sekolah', kodLama))).data()
        // Guna pinHash baru jika PIN diubah, kekal pinHash lama jika tidak
        const pinHashAktif = form.pin
          ? await hashPin(form.pin)
          : (dataLama?.pinHash || null)

        const { pin: _drop, ...dataLamaBersih } = dataLama || {}  // buang plain pin lama
        const batch = writeBatch(db)
        batch.set(doc(db, 'sekolah', kodBaru), {
          ...dataLamaBersih,
          kodSekolah:  kodBaru,
          namaSekolah: form.namaSekolah.trim(),
          kategori:    form.kategori,
          negeri:      form.negeri,
          daerah:      form.daerah.trim(),
          email:       form.email.trim(),
          bibPrefix:   form.bibPrefix.trim().toUpperCase(),
          bibMula:     Number(form.bibMula) || 1,
          bibFormat:   Number(form.bibFormat) || 3,
          pinHash:     pinHashAktif,  // R7: hash sahaja
          updatedAt:   serverTimestamp(),
        })
        batch.delete(doc(db, 'sekolah', kodLama))
        await batch.commit()

      } else {
        // ── EDIT BIASA — kemaskini medan + PIN jika berubah ─────────────────
        const updateData = {
          namaSekolah: form.namaSekolah.trim(),
          kategori:    form.kategori,
          negeri:      form.negeri,
          daerah:      form.daerah.trim(),
          email:       form.email.trim(),
          bibPrefix:   form.bibPrefix.trim().toUpperCase(),
          bibMula:     Number(form.bibMula) || 1,
          bibFormat:   Number(form.bibFormat) || 3,
          updatedAt:   serverTimestamp(),
        }
        // PIN berubah — hash dan simpan, buang plain pin lama
        if (form.pin) {
          updateData.pinHash = await hashPin(form.pin)
          updateData.pin     = deleteField()
        }
        await updateDoc(doc(db, 'sekolah', kodLama), updateData)
      }

      onSaved()
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-800">
            {isEdit ? `Edit — ${initial.namaSekolah}` : 'Tambah Sekolah Baru'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 rounded-lg">
              {err}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Kod Sekolah" required
              hint={isEdit ? 'Tukar kod akan kemaskini rekod sekolah & pengguna.' : undefined}>
              <input className={inputCls + ' font-mono uppercase'}
                value={form.kodSekolah}
                onChange={e => set('kodSekolah', e.target.value.toUpperCase().replace(/\s/g, ''))}
                placeholder="KMN-SR-001"
                maxLength={20}
              />
            </FormField>

            <FormField label="Kategori" required>
              <select className={inputCls} value={form.kategori} onChange={e => set('kategori', e.target.value)}>
                {jenisList.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </FormField>
          </div>

          <FormField label="Nama Sekolah" required>
            <input className={inputCls}
              value={form.namaSekolah}
              onChange={e => set('namaSekolah', e.target.value)}
              placeholder="cth: SK Sultan Ismail"
              maxLength={80}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Negeri" required>
              <select className={inputCls} value={form.negeri} onChange={e => set('negeri', e.target.value)}>
                {NEGERI_LIST.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </FormField>

            <FormField label="Daerah" required>
              <input className={inputCls}
                value={form.daerah}
                onChange={e => set('daerah', e.target.value)}
                placeholder="cth: Kemaman"
                maxLength={40}
              />
            </FormField>
          </div>

          <FormField label="Emel Sekolah">
            <input className={inputCls} type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="cth: sk@moe.edu.my"
            />
          </FormField>

          {/* ── BIB Settings ── */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50/50">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Tetapan BIB</p>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Prefix BIB" required hint="cth: SSI, MKT, MCB">
                <input className={inputCls + ' font-mono uppercase bg-white'}
                  value={form.bibPrefix}
                  onChange={e => set('bibPrefix', e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 5))}
                  placeholder="SSI"
                  maxLength={5}
                />
              </FormField>

              <FormField label="Nombor Mula" hint="BIB pertama">
                <input className={inputCls + ' font-mono bg-white'} type="number" min={1} max={9999}
                  value={form.bibMula}
                  onChange={e => set('bibMula', e.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Format Nombor BIB">
              <div className="flex gap-2">
                {BIB_FORMAT_OPTIONS.map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => set('bibFormat', opt.value)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-mono font-bold transition-colors ${
                      Number(form.bibFormat) === opt.value
                        ? 'bg-[#003399] border-[#003399] text-white'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-[#003399]'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Format: &nbsp;<span className="font-mono text-gray-500">{BIB_FORMAT_OPTIONS.find(o => o.value === Number(form.bibFormat))?.example}</span>
              </p>
            </FormField>

            {/* Preview */}
            {form.bibPrefix && (
              <div className="bg-white border border-[#003399]/20 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide">Pratonton BIB</p>
                <p className="font-mono text-sm font-bold text-[#003399]">
                  {previewBib(form.bibPrefix, form.bibMula, form.bibFormat)}
                </p>
              </div>
            )}
          </div>

          <FormField
            label={isEdit ? 'PIN Login (Tukar PIN)' : 'PIN Login (6 Digit)'}
            required={!isEdit}
            hint={isEdit ? 'Kosongkan jika tidak mahu tukar PIN.' : 'Pengurus pasukan guna PIN ini untuk log masuk.'}>
            <div className="flex gap-2">
              <div className="flex-1">
                <PasswordInput
                  isPin
                  inputMode="numeric"
                  value={form.pin}
                  onChange={e => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={isEdit ? '(kosong = kekal sama)' : '••••••'}
                  maxLength={6}
                />
              </div>
              <button
                type="button"
                onClick={() => set('pin', String(Math.floor(100000 + Math.random() * 900000)))}
                className="shrink-0 px-3 py-2 text-[10px] font-bold border border-[#003399]/30 text-[#003399] bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap"
                title="Jana PIN rawak 6 digit">
                <svg className="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Jana PIN
              </button>
            </div>
          </FormField>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              Batal
            </button>
            <button type="submit" disabled={busy}
              className="flex-1 px-4 py-2.5 bg-[#003399] hover:bg-[#002277] disabled:bg-gray-300 text-white text-sm font-semibold rounded-lg transition-colors">
              {busy ? 'Menyimpan…' : (isEdit ? 'Simpan Perubahan' : 'Tambah Sekolah')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Modal Reset PIN ──────────────────────────────────────────────────────────

function ResetPinModal({ sekolah, onClose, onSaved }) {
  const [pin,  setPin]  = useState('')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!/^\d{6}$/.test(pin)) return setErr('PIN mesti tepat 6 digit angka.')
    setBusy(true)
    setErr('')
    try {
      const ph = await hashPin(pin)
      await updateDoc(doc(db, 'sekolah', sekolah.kodSekolah), {
        pinHash:   ph,
        pin:       deleteField(),   // buang plain text jika ada
        updatedAt: serverTimestamp(),
      })
      onSaved()
      onClose()
    } catch (e) {
      setErr(`Gagal reset PIN: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-800">Reset PIN — {sekolah.namaSekolah}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 rounded-lg">{err}</div>}
          <FormField label="PIN Baru (6 Digit)" required>
            <PasswordInput
              isPin
              inputMode="numeric"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              maxLength={6}
            />
          </FormField>
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Selepas reset, pengurus pasukan perlu guna PIN baru ini untuk log masuk.
            PIN disimpan secara selamat (hashed) — tiada sesiapa boleh lihat PIN asal.
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              Batal
            </button>
            <button type="submit" disabled={busy}
              className="flex-1 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-semibold rounded-lg transition-colors">
              {busy ? 'Memproses…' : 'Reset PIN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ msg, onYes, onNo, danger }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <p className="text-sm text-gray-700">{msg}</p>
        <div className="flex gap-3">
          <button onClick={onNo}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Batal
          </button>
          <button onClick={onYes}
            className={`flex-1 px-4 py-2.5 text-white text-sm font-semibold rounded-lg transition-colors ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#003399] hover:bg-[#002277]'}`}>
            Teruskan
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── BIB Bulk Panel ───────────────────────────────────────────────────────────

function BibBulkPanel({ list, onUpdated }) {
  const [open,   setOpen]   = useState(false)
  const [format, setFormat] = useState(3)
  const [mula,   setMula]   = useState(1)
  const [busy,   setBusy]   = useState(false)
  const [done,   setDone]   = useState(false)

  async function handleApply() {
    if (!confirm(`Kemaskini format BIB untuk semua ${list.length} sekolah?`)) return
    setBusy(true)
    try {
      const batch = writeBatch(db)
      list.forEach(s => {
        batch.update(doc(db, 'sekolah', s.kodSekolah), {
          bibFormat:  Number(format),
          bibMula:    Number(mula),
          updatedAt:  serverTimestamp(),
        })
      })
      await batch.commit()
      setDone(true)
      onUpdated()
    } catch (err) {
      alert(`Ralat: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-dashed border-blue-300 rounded-lg bg-blue-50/30">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-blue-200 text-blue-800 font-bold px-2 py-0.5 rounded uppercase tracking-wider">
            Bulk
          </span>
          <span className="text-xs font-semibold text-blue-800">
            Tetapan BIB — Kemaskini Semua Sekolah
          </span>
        </div>
        <svg className={`w-4 h-4 text-blue-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-[11px] text-blue-700">
            Set format nombor BIB dan nombor mula yang sama untuk <strong>semua {list.length} sekolah</strong> serentak.
            Prefix BIB setiap sekolah kekal tidak berubah.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Format */}
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Format Nombor</p>
              <div className="flex gap-2">
                {BIB_FORMAT_OPTIONS.map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => { setFormat(opt.value); setDone(false) }}
                    className={`flex-1 py-2 rounded-lg border text-sm font-mono font-bold transition-colors ${
                      format === opt.value
                        ? 'bg-[#003399] border-[#003399] text-white'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-[#003399]'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                {BIB_FORMAT_OPTIONS.find(o => o.value === format)?.example}
              </p>
            </div>

            {/* Nombor Mula */}
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Nombor Mula (semua sekolah)</p>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399]"
                type="number" min={1} max={9999}
                value={mula}
                onChange={e => { setMula(e.target.value); setDone(false) }}
              />
            </div>
          </div>

          {/* Preview contoh */}
          {list.slice(0, 3).map(s => (
            <div key={s.kodSekolah} className="flex items-center justify-between text-xs bg-white border border-gray-100 rounded px-3 py-1.5">
              <span className="text-gray-500">{s.namaSekolah}</span>
              <span className="font-mono font-bold text-[#003399]">
                {previewBib(s.bibPrefix, mula, format)}
              </span>
            </div>
          ))}
          {list.length > 3 && (
            <p className="text-[10px] text-gray-400 text-center">+ {list.length - 3} sekolah lagi</p>
          )}

          {done && (
            <p className="text-xs text-green-700 font-semibold bg-green-50 border border-green-200 rounded px-3 py-2">
              ✓ Berjaya dikemaskini untuk semua {list.length} sekolah.
            </p>
          )}

          <button onClick={handleApply} disabled={busy || list.length === 0}
            className="px-4 py-2 bg-[#003399] hover:bg-[#002277] disabled:bg-gray-300 text-white text-xs font-bold rounded-lg transition-colors">
            {busy ? 'Mengemaskini…' : `Kemaskini Semua ${list.length} Sekolah`}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── SekolahSetup (Main) ──────────────────────────────────────────────────────

export default function SekolahSetup() {
  const { userRole } = useAuth()
  const isSuperAdmin = userRole === 'superadmin'

  const [list,    setList]    = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [katFil,  setKatFil]  = useState('SEMUA')
  const [jenisList, setJenisList] = useState(KATEGORI_LIST_FALLBACK)

  // Modals
  const [modal,      setModal]      = useState(null)  // 'tambah' | 'edit' | 'resetPin' | 'toggleAktif' | 'padam'
  const [selected,   setSelected]   = useState(null)
  const [deleting,   setDeleting]   = useState(false)
  const [showImport, setShowImport] = useState(false)

  // ── Fetch ──
  async function fetchList() {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'sekolah'), orderBy('kodSekolah')))
      setList(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch { setList([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchList() }, [])

  // Load jenis institusi dari kategori collection
  useEffect(() => {
    getDocs(query(collection(db, 'kategori'), orderBy('urutan')))
      .then(snap => {
        const jenis = [...new Set(snap.docs.map(d => d.data().jenisSekolah).filter(Boolean))]
        if (jenis.length > 0) setJenisList(jenis)
      }).catch(() => {})
  }, [])

  // ── Bypass Deadline (global) ──
  async function doToggleBypass(s) {
    await updateDoc(doc(db, 'sekolah', s.kodSekolah), {
      bypassDeadline: !s.bypassDeadline,
      updatedAt: serverTimestamp(),
    })
    fetchList()
  }

  // ── Bypass Pengesahan ──
  async function doToggleBypassPengesahan(s) {
    await updateDoc(doc(db, 'sekolah', s.kodSekolah), {
      bypassPengesahan: !s.bypassPengesahan,
      updatedAt: serverTimestamp(),
    })
    fetchList()
  }

  // ── Bypass Per Acara ──
  const [bypassAcaraModal, setBypassAcaraModal] = useState(null) // { sekolah }
  const [acaraHeat, setAcaraHeat] = useState([])       // { aceraId, namaAcara, heatDijanaAt }
  const [bypassAcaraLoading, setBypassAcaraLoading] = useState(false)
  const [bypassSaving, setBypassSaving] = useState(false)

  async function openBypassAcaraModal(s) {
    setBypassAcaraModal({ sekolah: s })
    setBypassAcaraLoading(true)
    try {
      // Cari kejohanan aktif
      const kejSnap = await getDocs(query(collection(db, 'kejohanan'),
        where('statusKejohanan', 'in', ['aktif', 'persediaan'])))
      if (kejSnap.empty) { setAcaraHeat([]); return }
      const kejId = kejSnap.docs[0].id
      // Ambil semua acara yang ada heatDijanaAt
      const acaraSnap = await getDocs(collection(db, 'kejohanan', kejId, 'acara'))
      const list = acaraSnap.docs
        .map(d => ({ aceraId: d.id, ...d.data() }))
        .filter(a => a.heatDijanaAt)
        .sort((a, b) => (a.namaAcara || '').localeCompare(b.namaAcara || ''))
      setAcaraHeat(list)
    } catch { setAcaraHeat([]) }
    finally { setBypassAcaraLoading(false) }
  }

  async function doToggleBypassAcara(sekolah, aceraId) {
    setBypassSaving(true)
    const field = `pendaftaranBukaAcara.${aceraId}`
    const bukaMap = sekolah.pendaftaranBukaAcara || {}
    try {
      if (bukaMap[aceraId]) {
        // Tutup bypass untuk acara ini
        await updateDoc(doc(db, 'sekolah', sekolah.kodSekolah), {
          [field]: deleteField(),
          updatedAt: serverTimestamp(),
        })
      } else {
        // Buka bypass untuk acara ini
        await updateDoc(doc(db, 'sekolah', sekolah.kodSekolah), {
          [field]: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
      await fetchList()
      // Refresh sekolah dalam modal
      const updated = await getDoc(doc(db, 'sekolah', sekolah.kodSekolah))
      if (updated.exists()) {
        setBypassAcaraModal({ sekolah: { id: updated.id, ...updated.data() } })
      }
    } catch (e) { alert('Ralat: ' + e.message) }
    finally { setBypassSaving(false) }
  }

  // ── Toggle Aktif ──
  async function doToggleAktif() {
    if (!selected) return
    await updateDoc(doc(db, 'sekolah', selected.kodSekolah), {
      isAktif: !selected.isAktif, updatedAt: serverTimestamp(),
    })
    setModal(null)
    fetchList()
  }

  // ── Padam Sekolah ──
  async function doPadam() {
    if (!selected) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'sekolah', selected.kodSekolah))
      setModal(null)
      setSelected(null)
      fetchList()
    } catch (e) {
      alert('Gagal padam: ' + e.message)
    } finally {
      setDeleting(false)
    }
  }

  // ── Export PDF ──
  function exportPDF() {
    const pdf  = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const rows = filtered.map((s, i) => [
      i + 1, s.kodSekolah, s.namaSekolah, s.email || '—', s.kategori, s.daerah,
      s.bibPrefix, s.pin, s.isAktif ? 'Aktif' : 'Nyahaktif',
    ])

    pdf.setFontSize(14)
    pdf.text('Senarai Sekolah — KOAM Daerah Kemaman', 14, 15)
    pdf.setFontSize(8)
    pdf.text(`Dicetak: ${new Date().toLocaleString('ms-MY')}`, 14, 22)

    autoTable(pdf, {
      head: [['#', 'Kod', 'Nama Sekolah', 'E-mel', 'Kat', 'Daerah', 'Bib', 'PIN', 'Status']],
      body: rows,
      startY: 27,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [0, 51, 153] },
      alternateRowStyles: { fillColor: [245, 247, 255] },
    })

    pdf.save('sekolah_koam.pdf')
  }

  // ── Filter ──
  const filtered = list.filter(s => {
    const matchKat  = katFil === 'SEMUA' || s.kategori === katFil
    const q         = search.toLowerCase()
    const matchSrch = !q || s.namaSekolah?.toLowerCase().includes(q)
      || s.kodSekolah?.toLowerCase().includes(q)
      || s.daerah?.toLowerCase().includes(q)
    return matchKat && matchSrch
  })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-800">Setup Sekolah</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {list.length} sekolah berdaftar ·{' '}
            {list.filter(s => s.isAktif).length} aktif
          </p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => setModal('tambah')}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#003399] hover:bg-[#002277] text-white text-sm font-semibold rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Tambah Sekolah
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] w-56"
          placeholder="Cari nama / kod / daerah…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          {['SEMUA', ...jenisList].map(k => (
            <button key={k} onClick={() => setKatFil(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                katFil === k
                  ? 'bg-[#003399] text-white border-[#003399]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}>{k}</button>
          ))}
        </div>

        <div className="flex gap-2 ml-auto">
          {/* Export PDF */}
          <button onClick={exportPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            PDF
          </button>

          {/* Download Template */}
          <button onClick={downloadTemplateSekolah}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 hover:border-gray-400 bg-white text-gray-600 hover:text-gray-800 text-xs font-semibold rounded-lg transition-colors"
            title="Muat turun template Excel">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Template
          </button>

          {/* Import */}
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-green-300 hover:border-green-400 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-semibold rounded-lg transition-colors"
            title="Import sekolah dari Excel/CSV">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400">Memuatkan…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            {list.length === 0 ? 'Tiada sekolah berdaftar.' : 'Tiada hasil carian.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#003399] text-white">
                  <th className="px-4 py-3 text-left text-xs font-semibold">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Kod</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Nama Sekolah</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">E-mel</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Kat</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Daerah</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Bib</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">PIN</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={s.kodSekolah}
                    className={`border-t border-gray-100 ${i % 2 === 1 ? 'bg-blue-50/30' : ''}`}>
                    <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-700">{s.kodSekolah}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-800">{s.namaSekolah}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {s.email || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3"><KategBadge k={s.kategori} /></td>
                    <td className="px-4 py-3 text-xs text-gray-600">{s.daerah}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-bold text-gray-700">{s.bibPrefix}</span>
                      <span className="text-[10px] text-gray-400 ml-1">+{s.bibMula}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-500">{s.pin}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge aktif={s.isAktif} />
                        {s.bypassDeadline && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">BYPASS TARIKH</span>
                        )}
                        {s.bypassPengesahan && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">BYPASS SAHKAN</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 justify-end">
                        {isSuperAdmin && (
                          <>
                            <button onClick={() => { setSelected(s); setModal('edit') }}
                              className="px-2.5 py-1.5 text-[10px] font-semibold border border-gray-200 rounded text-gray-600 hover:bg-gray-50 transition-colors">
                              Edit
                            </button>
                            <button onClick={() => { setSelected(s); setModal('resetPin') }}
                              className="px-2.5 py-1.5 text-[10px] font-semibold border border-orange-200 rounded text-orange-600 hover:bg-orange-50 transition-colors">
                              Reset PIN
                            </button>
                            <button onClick={() => doToggleBypass(s)}
                              className={`px-2.5 py-1.5 text-[10px] font-semibold border rounded transition-colors ${
                                s.bypassDeadline
                                  ? 'border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100'
                                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                              }`}
                              title={s.bypassDeadline ? 'Bypass tarikh tamat aktif — klik untuk matikan' : 'Buka semula (tarikh tamat)'}>
                              {s.bypassDeadline ? '✓ Bypass Tarikh' : 'Bypass Tarikh'}
                            </button>
                            <button onClick={() => doToggleBypassPengesahan(s)}
                              className={`px-2.5 py-1.5 text-[10px] font-semibold border rounded transition-colors ${
                                s.bypassPengesahan
                                  ? 'border-orange-400 text-orange-700 bg-orange-50 hover:bg-orange-100'
                                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                              }`}
                              title={s.bypassPengesahan ? 'Bypass pengesahan aktif — klik untuk kunci semula' : 'Buka semula (pengesahan disahkan)'}>
                              {s.bypassPengesahan ? '✓ Bypass Sahkan' : 'Bypass Sahkan'}
                            </button>
                            <button onClick={() => openBypassAcaraModal(s)}
                              className={`px-2.5 py-1.5 text-[10px] font-semibold border rounded transition-colors ${
                                s.pendaftaranBukaAcara && Object.keys(s.pendaftaranBukaAcara).length > 0
                                  ? 'border-green-400 text-green-700 bg-green-50 hover:bg-green-100'
                                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                              }`}
                              title="Urus buka semula pendaftaran per acara (selepas heat dijana)">
                              {s.pendaftaranBukaAcara && Object.keys(s.pendaftaranBukaAcara).length > 0
                                ? `Buka Acara (${Object.keys(s.pendaftaranBukaAcara).length})`
                                : 'Buka Acara'}
                            </button>
                            <button onClick={() => { setSelected(s); setModal('toggleAktif') }}
                              className={`px-2.5 py-1.5 text-[10px] font-semibold border rounded transition-colors ${
                                s.isAktif
                                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                                  : 'border-green-200 text-green-600 hover:bg-green-50'
                              }`}>
                              {s.isAktif ? 'Nyahaktif' : 'Aktifkan'}
                            </button>
                            <button onClick={() => { setSelected(s); setModal('padam') }}
                              className="px-2.5 py-1.5 text-[10px] font-semibold border border-red-300 rounded text-red-700 bg-red-50 hover:bg-red-100 transition-colors">
                              Padam
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── BIB Bulk Update ── */}
      {isSuperAdmin && <BibBulkPanel list={list} onUpdated={fetchList} />}

      {/* Import Modal */}
      {showImport && (
        <ImportSekolahModal
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); fetchList() }}
        />
      )}

      {/* Modals */}
      {modal === 'tambah' && (
        <SekolahModal onClose={() => setModal(null)} onSaved={fetchList} jenisList={jenisList} />
      )}
      {modal === 'edit' && selected && (
        <SekolahModal initial={selected} onClose={() => { setModal(null); setSelected(null) }} onSaved={fetchList} jenisList={jenisList} />
      )}
      {modal === 'resetPin' && selected && (
        <ResetPinModal sekolah={selected} onClose={() => { setModal(null); setSelected(null) }} onSaved={fetchList} />
      )}
      {modal === 'toggleAktif' && selected && (
        <ConfirmDialog
          msg={selected.isAktif
            ? `Nyahaktifkan ${selected.namaSekolah}? Pengurus pasukan tidak boleh log masuk.`
            : `Aktifkan semula ${selected.namaSekolah}?`}
          danger={selected.isAktif}
          onYes={doToggleAktif}
          onNo={() => { setModal(null); setSelected(null) }}
        />
      )}
      {modal === 'padam' && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-sm font-bold text-gray-800 mb-1">Padam Sekolah?</h3>
              <p className="text-xs text-gray-500">Rekod sekolah ini akan dipadam secara kekal.</p>
              <p className="text-xs font-bold text-gray-800 mt-2">{selected.namaSekolah}</p>
              <p className="text-[10px] font-mono text-gray-400">{selected.kodSekolah}</p>
              <p className="text-[10px] text-red-600 mt-2 bg-red-50 border border-red-200 rounded px-2 py-1">
                Nota: Data atlet yang berkaitan tidak turut dipadam.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setModal(null); setSelected(null) }}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-50">
                Batal
              </button>
              <button onClick={doPadam} disabled={deleting}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors">
                {deleting ? 'Memadam…' : 'Ya, Padam'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Buka Acara Per Acara ── */}
      {bypassAcaraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-800">Buka Semula Pendaftaran</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{bypassAcaraModal.sekolah.namaSekolah}</p>
              </div>
              <button onClick={() => setBypassAcaraModal(null)}
                className="text-gray-400 hover:text-gray-600 p-1">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {bypassAcaraLoading ? (
                <div className="flex items-center justify-center py-10 gap-2">
                  <div className="w-5 h-5 border-2 border-[#003399] border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-gray-400">Memuatkan acara…</p>
                </div>
              ) : acaraHeat.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">
                  Tiada acara yang heat sudah dijana.
                </div>
              ) : (
                acaraHeat.map(a => {
                  const bukaMap = bypassAcaraModal.sekolah.pendaftaranBukaAcara || {}
                  const bukaAt  = bukaMap[a.aceraId]
                  const tBuka   = bukaAt?.toMillis?.() ?? 0
                  const tJana   = a.heatDijanaAt?.toMillis?.() ?? 0
                  const aktif   = bukaAt && tBuka > tJana
                  return (
                    <div key={a.aceraId}
                      className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-gray-100 bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-800 truncate">{a.namaAcara}</p>
                        <p className="text-[10px] text-gray-400">
                          Kat {a.kategoriKod} · {a.jantina === 'L' ? 'Lelaki' : 'Perempuan'}
                        </p>
                        {aktif && (
                          <p className="text-[9px] text-green-600 font-bold mt-0.5">Bypass aktif</p>
                        )}
                        {bukaAt && !aktif && (
                          <p className="text-[9px] text-amber-600 font-bold mt-0.5">Expired — heat dijana semula</p>
                        )}
                      </div>
                      <button
                        disabled={bypassSaving}
                        onClick={() => doToggleBypassAcara(bypassAcaraModal.sekolah, a.aceraId)}
                        className={`ml-3 px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-colors shrink-0 ${
                          aktif
                            ? 'bg-green-500 text-white border-green-500 hover:bg-green-600'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-[#003399] hover:text-[#003399]'
                        }`}>
                        {aktif ? 'Buka ✓' : 'Buka'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-100 shrink-0 space-y-2">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <svg className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <div>
                  <p className="text-[10px] font-bold text-amber-700">Perlu Jana Heat Semula</p>
                  <p className="text-[9px] text-amber-600 mt-0.5 leading-relaxed">
                    Selepas PP siap tukar atlet, pergi <strong>StartList → Status Panel → klik acara</strong> dan jana heat semula untuk acara berkenaan. Tanpa ini, start list masih tunjuk atlet lama.
                  </p>
                </div>
              </div>
              <p className="text-[9px] text-gray-400 text-center">
                Bypass auto tamat bila admin jana heat semula untuk acara tersebut.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
