/**
 * SekolahSetup — /dashboard/sekolah
 * Pengurusan sekolah: tambah, edit, aktif/nyahaktif, reset PIN, import Excel, export PDF, seed dummy
 */

import { useState, useEffect, useRef } from 'react'
import {
  collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy, writeBatch, where, limit,
} from 'firebase/firestore'
// Firebase Auth tidak digunakan lagi untuk sekolah — login via Firestore PIN check
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import PasswordInput from '../../components/ui/PasswordInput'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Constants ────────────────────────────────────────────────────────────────

const KATEGORI_LIST_FALLBACK = ['SR', 'SM', 'PPKI']
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

      // Semak bibPrefix unik dalam sekolah sejenis (SR/SM/PPKI) — elak noBib clash dalam heat
      const prefixBaru   = form.bibPrefix.trim().toUpperCase()
      const prefixBerubah = isEdit ? prefixBaru !== (initial?.bibPrefix || '').toUpperCase() : true
      if (prefixBerubah) {
        const prefixSnap = await getDocs(query(
          collection(db, 'sekolah'),
          where('kategori',  '==', form.kategori),
          where('bibPrefix', '==', prefixBaru)
        ))
        const clash = prefixSnap.docs.find(d => d.id !== kodBaru && d.id !== kodLama)
        if (clash) {
          setErr(`BIB Prefix "${prefixBaru}" sudah digunakan oleh ${clash.data().namaSekolah} (${clash.id}) dalam kategori ${form.kategori}. Sila guna prefix lain.`)
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
        // ── TAMBAH BARU — Firestore sahaja, tiada Firebase Auth ──────────────
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
          pin:         form.pin,
          isAktif:     true,
          createdAt:   serverTimestamp(),
        })

      } else if (kodBerubah) {
        // ── EDIT + KOD BERUBAH — pindah dokumen Firestore sahaja ────────────
        const dataLama = (await getDoc(doc(db, 'sekolah', kodLama))).data()
        const pinAktif = (form.pin && form.pin !== dataLama?.pin) ? form.pin : (dataLama?.pin || '')

        const batch = writeBatch(db)
        batch.set(doc(db, 'sekolah', kodBaru), {
          ...dataLama,
          kodSekolah:  kodBaru,
          namaSekolah: form.namaSekolah.trim(),
          kategori:    form.kategori,
          negeri:      form.negeri,
          daerah:      form.daerah.trim(),
          email:       form.email.trim(),
          bibPrefix:   form.bibPrefix.trim().toUpperCase(),
          bibMula:     Number(form.bibMula) || 1,
          bibFormat:   Number(form.bibFormat) || 3,
          pin:         pinAktif,
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
        // PIN berubah — simpan terus dalam Firestore
        if (form.pin && form.pin !== initial?.pin) {
          updateData.pin = form.pin
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
      // Simpan PIN baru dalam Firestore sahaja — tiada Firebase Auth
      await updateDoc(doc(db, 'sekolah', sekolah.kodSekolah), { pin, updatedAt: serverTimestamp() })
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
          <p className="text-[10px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
            PIN semasa: <strong className="font-mono">{sekolah.pin}</strong>. Selepas reset, pengurus pasukan perlu guna PIN baru.
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
  const [modal,    setModal]    = useState(null)  // 'tambah' | 'edit' | 'resetPin' | 'toggleAktif' | 'padam'
  const [selected, setSelected] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const fileRef = useRef()

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

  // ── Import Excel ──
  function handleImportExcel(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const wb   = XLSX.read(ev.target.result, { type: 'array' })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)

      // Langkah 1: Tulis semua dokumen sekolah ke Firestore
      const validRows = []
      const batch = writeBatch(db)
      for (const r of rows) {
        const kod = String(r.kodSekolah || '').trim().toUpperCase()
        if (!kod) continue
        const pin = String(r.pin || '').trim()
        const nama = String(r.namaSekolah || '')
        batch.set(doc(db, 'sekolah', kod), {
          kodSekolah:  kod,
          namaSekolah: nama,
          kategori:    String(r.kategori || 'SR'),
          negeri:      String(r.negeri || 'Terengganu'),
          daerah:      String(r.daerah || ''),
          email:       String(r.email || ''),
          bibPrefix:   String(r.bibPrefix || '').toUpperCase(),
          bibMula:     Number(r.bibMula) || 1,
          bibFormat:   Number(r.bibFormat) || 3,
          pin,
          isAktif:     true,
          createdAt:   serverTimestamp(),
        }, { merge: true })
        validRows.push({ kod, pin, nama })
      }
      await batch.commit()

      // Login sekolah menggunakan Firestore PIN check — tiada Firebase Auth per sekolah
      alert(`${validRows.length} sekolah diimport ke Firestore.`)
      fetchList()
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
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
          <button onClick={exportPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            PDF
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportExcel} />
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Import Excel
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
                    <td className="px-4 py-3"><StatusBadge aktif={s.isAktif} /></td>
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
    </div>
  )
}
