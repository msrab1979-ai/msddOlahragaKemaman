import { useState, useEffect, useCallback } from 'react'
import {
  collection, getDocs, doc, setDoc, updateDoc,
  serverTimestamp, query, orderBy, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'

// ─── Constants ────────────────────────────────────────────────────────────────

const PERINGKAT_OPTIONS = [
  { value: 'daerah',     label: 'Daerah' },
  { value: 'negeri',     label: 'Negeri' },
  { value: 'kebangsaan', label: 'Kebangsaan' },
]

const TEMPO_BANTAHAN = [
  { value: 30,  label: '30 Minit' },
  { value: 60,  label: '1 Jam' },
  { value: 120, label: '2 Jam' },
]

const TIMER_AUTO_RASMI = [
  { value: 10,  label: '10 Minit' },
  { value: 15,  label: '15 Minit' },
  { value: 30,  label: '30 Minit' },
  { value: 60,  label: '1 Jam' },
]

const NEGERI_LIST = [
  'Johor','Kedah','Kelantan','Melaka','Negeri Sembilan',
  'Pahang','Perak','Perlis','Pulau Pinang','Sabah',
  'Sarawak','Selangor','Terengganu',
  'W.P. Kuala Lumpur','W.P. Labuan','W.P. Putrajaya',
]

const STATUS_META = {
  persediaan: { label: 'Persediaan', cls: 'bg-yellow-100 text-yellow-800' },
  aktif:      { label: 'Aktif',       cls: 'bg-green-100 text-green-800' },
  selesai:    { label: 'Selesai',     cls: 'bg-blue-100 text-blue-800' },
  batal:      { label: 'Dibatal',     cls: 'bg-red-100 text-red-800' },
}

const PERINGKAT_META = {
  daerah:     { label: 'Daerah',     cls: 'bg-gray-100 text-gray-700' },
  negeri:     { label: 'Negeri',     cls: 'bg-indigo-100 text-indigo-800' },
  kebangsaan: { label: 'Kebangsaan', cls: 'bg-red-100 text-red-800' },
}

const EMPTY_FORM = {
  namaKejohanan: '',
  tahun: new Date().getFullYear(),
  peringkat: 'daerah',
  tarikhMula: '',
  tarikhTamat: '',
  tarikhTamatDaftar: '', // tarikh tutup pendaftaran atlet
  lokasi: '',
  negeri: 'Terengganu',
  daerah: 'Kemaman',
  tempoBantahan: 60,
  timerAutoRasmi: 15,
  bilanganKedudukan: 3,       // tempat 1,2,3 (emas/perak/gangsa) dapat masuk medal tally
  mataPingat1: 5,             // mata untuk tempat 1
  mataPingat2: 3,             // mata untuk tempat 2
  mataPingat3: 2,             // mata untuk tempat 3
  mataPingat4: 1,             // mata untuk tempat 4
  catatanAdmin: '',
}

function generateKejohananId(tahun) {
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `KOAM-${tahun}-${rand}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full border border-gray-300 rounded px-3 py-2 text-xs text-gray-800 focus:outline-none focus:border-[#003399] focus:ring-1 focus:ring-[#003399] disabled:bg-gray-50 disabled:text-gray-400'

function FormField({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 pb-1 border-b border-gray-100">
      {title}
    </p>
  )
}

function Badge({ meta }) {
  if (!meta) return null
  return (
    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function formatTarikh(str) {
  if (!str) return '—'
  const d = new Date(str + 'T00:00:00')
  return d.toLocaleDateString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Format tarikh+masa Malaysia GMT+8 12-jam
function formatDatetimeMY(isoStr) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  if (isNaN(d)) return '—'
  return d.toLocaleString('ms-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

// Tukar datetime-local value (dalam GMT+8) ke ISO UTC string untuk simpan
function localDTToISO(dtLocalStr) {
  if (!dtLocalStr) return null
  // datetime-local input memberi nilai mengikut zon waktu browser
  // Kita anggap browser Malaysia = GMT+8, jadi ini sudah betul
  return new Date(dtLocalStr).toISOString()
}

// Tukar ISO string ke nilai datetime-local (GMT+8 string tanpa 'Z')
function isoToLocalDT(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (isNaN(d)) return ''
  // Format: YYYY-MM-DDTHH:mm dalam zon waktu Malaysia
  const my = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const p = {}
  my.forEach(({ type, value }) => { p[type] = value })
  const hh = p.hour === '24' ? '00' : p.hour
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`
}

// ─── Modal Form ───────────────────────────────────────────────────────────────

function KejohananModal({ mode, initial, onClose, onSaved }) {
  const { user: currentUser } = useAuth()
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isEdit = mode === 'edit'

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }))
    setError('')
  }

  function validate() {
    if (!form.namaKejohanan.trim()) return 'Nama kejohanan diperlukan.'
    if (!form.tahun || form.tahun < 2000) return 'Tahun tidak sah.'
    if (!form.tarikhMula) return 'Tarikh mula diperlukan.'
    if (!form.tarikhTamat) return 'Tarikh tamat diperlukan.'
    if (form.tarikhTamat < form.tarikhMula) return 'Tarikh tamat mesti selepas tarikh mula.'
    if (!form.lokasi.trim()) return 'Lokasi diperlukan.'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const err = validate()
    if (err) return setError(err)
    setSaving(true)
    try {
      const tarikhTamatDaftarISO = form.tarikhTamatDaftar
        ? localDTToISO(form.tarikhTamatDaftar)
        : null

      // Bina objek mataPingat untuk simpan dalam Firestore
      const mataPingatObj = {
        1: Math.max(0, Number(form.mataPingat1) || 0),
        2: Math.max(0, Number(form.mataPingat2) || 0),
        3: Math.max(0, Number(form.mataPingat3) || 0),
        4: Math.max(0, Number(form.mataPingat4) || 0),
      }

      if (isEdit) {
        await updateDoc(doc(db, 'kejohanan', initial.kejohananId), {
          namaKejohanan:      form.namaKejohanan.trim(),
          tahun:              Number(form.tahun),
          peringkat:          form.peringkat,
          tarikhMula:         form.tarikhMula,
          tarikhTamat:        form.tarikhTamat,
          tarikhTamatDaftar:  tarikhTamatDaftarISO,
          lokasi:             form.lokasi.trim(),
          negeri:             form.negeri,
          daerah:             form.daerah.trim(),
          tempoBantahan:      Number(form.tempoBantahan),
          timerAutoRasmi:     Number(form.timerAutoRasmi) || 15,
          bilanganKedudukan:  Math.min(5, Math.max(1, Number(form.bilanganKedudukan) || 3)),
          mataPingat:         mataPingatObj,
          catatanAdmin:       form.catatanAdmin.trim(),
          updatedAt:          serverTimestamp(),
        })
      } else {
        const id = generateKejohananId(form.tahun)
        await setDoc(doc(db, 'kejohanan', id), {
          kejohananId:        id,
          namaKejohanan:      form.namaKejohanan.trim(),
          tahun:              Number(form.tahun),
          peringkat:          form.peringkat,
          tarikhMula:         form.tarikhMula,
          tarikhTamat:        form.tarikhTamat,
          tarikhTamatDaftar:  tarikhTamatDaftarISO,
          lokasi:             form.lokasi.trim(),
          negeri:             form.negeri,
          daerah:             form.daerah.trim(),
          tempoBantahan:      Number(form.tempoBantahan),
          timerAutoRasmi:     Number(form.timerAutoRasmi) || 15,
          bilanganKedudukan:  Math.min(5, Math.max(1, Number(form.bilanganKedudukan) || 3)),
          mataPingat:         mataPingatObj,
          catatanAdmin:       form.catatanAdmin.trim(),
          statusKejohanan: 'persediaan',
          isAktif:        false,
          createdAt:      serverTimestamp(),
          createdBy:      currentUser.uid,
        })
      }
      onSaved()
    } catch (err) {
      setError(err.message || 'Ralat tidak dijangka.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4">
      <div className="bg-white w-full max-w-lg rounded shadow-xl">
        {/* Header */}
        <div className="bg-[#003399] text-white px-5 py-4 rounded-t flex items-center justify-between">
          <div>
            <p className="text-[10px] opacity-60 uppercase tracking-widest">Sistem KOAM</p>
            <p className="text-sm font-bold">{isEdit ? 'Kemaskini Kejohanan' : 'Daftar Kejohanan Baru'}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Section 1 */}
          <div>
            <SectionHeader title="Maklumat Asas" />
            <div className="space-y-3">
              <FormField label="Nama Kejohanan" required>
                <input
                  className={inputCls}
                  value={form.namaKejohanan}
                  onChange={e => set('namaKejohanan', e.target.value)}
                  placeholder="cth: KOAM Peringkat Daerah Kemaman 2024"
                  autoFocus
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Tahun" required>
                  <input
                    className={inputCls}
                    type="number"
                    min={2000}
                    max={2099}
                    value={form.tahun}
                    onChange={e => set('tahun', e.target.value)}
                  />
                </FormField>
                <FormField label="Peringkat" required>
                  <select
                    className={inputCls}
                    value={form.peringkat}
                    onChange={e => set('peringkat', e.target.value)}
                  >
                    {PERINGKAT_OPTIONS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </FormField>
              </div>
            </div>
          </div>

          {/* Section 2 */}
          <div>
            <SectionHeader title="Tarikh & Lokasi" />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Tarikh Mula" required>
                  <input
                    className={inputCls}
                    type="date"
                    value={form.tarikhMula}
                    onChange={e => set('tarikhMula', e.target.value)}
                  />
                </FormField>
                <FormField label="Tarikh Tamat" required>
                  <input
                    className={inputCls}
                    type="date"
                    value={form.tarikhTamat}
                    min={form.tarikhMula}
                    onChange={e => set('tarikhTamat', e.target.value)}
                  />
                </FormField>
              </div>
              <FormField label="Tarikh &amp; Masa Tutup Pendaftaran" hint="Selepas tarikh/masa ini (GMT+8, 12-jam), pengurus pasukan tidak boleh tambah/edit/padam atlet.">
                <input
                  className={inputCls}
                  type="datetime-local"
                  value={form.tarikhTamatDaftar}
                  onChange={e => set('tarikhTamatDaftar', e.target.value)}
                />
              </FormField>

              <FormField label="Lokasi / Venue" required>
                <input
                  className={inputCls}
                  value={form.lokasi}
                  onChange={e => set('lokasi', e.target.value)}
                  placeholder="cth: Stadium MSS Kemaman, Terengganu"
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Negeri">
                  <select
                    className={inputCls}
                    value={form.negeri}
                    onChange={e => set('negeri', e.target.value)}
                  >
                    <option value="">— Pilih —</option>
                    {NEGERI_LIST.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Daerah">
                  <input
                    className={inputCls}
                    value={form.daerah}
                    onChange={e => set('daerah', e.target.value)}
                    placeholder="cth: Kemaman"
                  />
                </FormField>
              </div>
            </div>
          </div>

          {/* Section 3 */}
          <div>
            <SectionHeader title="Tetapan Sistem" />
            <div className="space-y-3">
              <FormField
                label="Tempoh Bantahan Keputusan"
                hint="Masa yang dibenarkan untuk sekolah hantar bantahan selepas keputusan dipaparkan."
              >
                <select
                  className={inputCls}
                  value={form.tempoBantahan}
                  onChange={e => set('tempoBantahan', e.target.value)}
                >
                  {TEMPO_BANTAHAN.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Timer Auto-Rasmi (Default)"
                hint="Masa selepas pencatat klik HANTAR sebelum keputusan auto jadi Rasmi. Boleh override per acara."
              >
                <select
                  className={inputCls}
                  value={form.timerAutoRasmi}
                  onChange={e => set('timerAutoRasmi', e.target.value)}
                >
                  {TIMER_AUTO_RASMI.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Bilangan Kedudukan Dapat Pingat"
                hint="Bilangan tempat teratas yang direkod dalam medal tally (1=emas sahaja, 3=emas/perak/gangsa, maks 5)."
              >
                <select
                  className={inputCls}
                  value={form.bilanganKedudukan}
                  onChange={e => set('bilanganKedudukan', Number(e.target.value))}
                >
                  {[1,2,3,4,5].map(n => (
                    <option key={n} value={n}>{n} Tempat Teratas</option>
                  ))}
                </select>
              </FormField>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Mata Pingat (Tempat 1–4)
                  <span className="font-normal text-gray-400 ml-1">— mata individu (bukan relay) masuk Olahragawan Terbaik</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1,2,3,4].map(t => (
                    <div key={t}>
                      <label className="block text-[10px] text-gray-400 mb-1 text-center">Tempat {t}</label>
                      <input
                        className={inputCls + ' text-center'}
                        type="number"
                        min={0}
                        max={99}
                        value={form[`mataPingat${t}`]}
                        onChange={e => set(`mataPingat${t}`, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Standard MSSD: 5 – 3 – 2 – 1</p>
              </div>

              <FormField label="Catatan Admin">
                <textarea
                  className={inputCls + ' resize-none'}
                  rows={2}
                  value={form.catatanAdmin}
                  onChange={e => set('catatanAdmin', e.target.value)}
                  placeholder="Nota dalaman (tidak dipapar kepada awam)"
                />
              </FormField>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-semibold bg-[#003399] text-white rounded hover:bg-[#002277] disabled:opacity-60"
            >
              {saving ? 'Menyimpan…' : isEdit ? 'Kemaskini' : 'Daftar Kejohanan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel = 'Ya, Teruskan', danger = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded shadow-xl max-w-sm w-full p-5">
        <p className="text-sm font-semibold text-gray-800 mb-2">Pengesahan Diperlukan</p>
        <p className="text-xs text-gray-600 mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-xs font-semibold rounded text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#003399] hover:bg-[#002277]'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Kejohanan Card ───────────────────────────────────────────────────────────

function KejohananCard({ k, onEdit, onStatusChange }) {
  const status = STATUS_META[k.statusKejohanan] || STATUS_META.persediaan
  const peringkat = PERINGKAT_META[k.peringkat] || PERINGKAT_META.daerah
  const isLocked = k.statusKejohanan === 'selesai' || k.statusKejohanan === 'batal'

  return (
    <div className={`bg-white border rounded shadow-sm overflow-hidden ${k.statusKejohanan === 'aktif' ? 'border-[#003399]' : 'border-gray-200'}`}>
      {/* Card top stripe */}
      <div className={`h-1 ${k.statusKejohanan === 'aktif' ? 'bg-[#003399]' : k.statusKejohanan === 'selesai' ? 'bg-blue-400' : k.statusKejohanan === 'batal' ? 'bg-red-400' : 'bg-yellow-400'}`} />

      <div className="p-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-800 leading-snug">{k.namaKejohanan}</p>
            <p className="text-[10px] text-gray-400 font-mono mt-0.5">{k.kejohananId}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge meta={status} />
            <Badge meta={peringkat} />
          </div>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-600 mb-3">
          <div>
            <span className="text-gray-400">Tarikh: </span>
            {formatTarikh(k.tarikhMula)} – {formatTarikh(k.tarikhTamat)}
          </div>
          <div>
            <span className="text-gray-400">Tahun: </span>
            <span className="font-semibold">{k.tahun}</span>
          </div>
          <div className="col-span-2">
            <span className="text-gray-400">Lokasi: </span>{k.lokasi}
          </div>
          {k.negeri && (
            <div>
              <span className="text-gray-400">Negeri: </span>{k.negeri}
            </div>
          )}
          {k.daerah && (
            <div>
              <span className="text-gray-400">Daerah: </span>{k.daerah}
            </div>
          )}
          <div>
            <span className="text-gray-400">Tempo bantahan: </span>
            {TEMPO_BANTAHAN.find(t => t.value === k.tempoBantahan)?.label || `${k.tempoBantahan} min`}
          </div>
          {k.tarikhTamatDaftar ? (
            <div className="col-span-2">
              <span className="text-gray-400">Tutup daftar: </span>
              <span className="font-semibold text-red-700">{formatDatetimeMY(k.tarikhTamatDaftar)}</span>
            </div>
          ) : (
            <div className="col-span-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
              <svg className="w-3 h-3 shrink-0 text-amber-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <span className="text-[10px] font-semibold text-amber-700">Tarikh tutup pendaftaran belum ditetapkan — pengurus pasukan boleh daftar tanpa had masa.</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-1.5 border-t border-gray-100 pt-3">
          {!isLocked && (
            <button
              onClick={() => onEdit(k)}
              className="px-2.5 py-1 text-[10px] font-semibold border border-gray-300 rounded text-gray-600 hover:bg-gray-100"
            >
              Edit
            </button>
          )}
          {k.statusKejohanan === 'persediaan' && (
            <button
              onClick={() => onStatusChange(k, 'aktif')}
              className="px-2.5 py-1 text-[10px] font-semibold bg-green-100 text-green-700 rounded hover:bg-green-200"
            >
              Aktifkan
            </button>
          )}
          {k.statusKejohanan === 'aktif' && (
            <button
              onClick={() => onStatusChange(k, 'selesai')}
              className="px-2.5 py-1 text-[10px] font-semibold bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              Tamatkan
            </button>
          )}
          {(k.statusKejohanan === 'persediaan' || k.statusKejohanan === 'aktif') && (
            <button
              onClick={() => onStatusChange(k, 'batal')}
              className="px-2.5 py-1 text-[10px] font-semibold bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              Batalkan
            </button>
          )}
          {isLocked && (
            <span className="text-[10px] text-gray-400 italic self-center">
              {k.statusKejohanan === 'selesai' ? 'Kejohanan telah selesai.' : 'Kejohanan telah dibatal.'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KejohananSetup() {
  const [kejohananList, setKejohananList] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)       // null | { mode, data }
  const [confirm, setConfirm] = useState(null)   // null | { k, newStatus }
  const [filterStatus, setFilterStatus] = useState('semua')

  const fetchKejohanan = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'kejohanan'), orderBy('createdAt', 'desc')))
      setKejohananList(snap.docs.map(d => ({ ...d.data() })))
    } catch {
      setKejohananList([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchKejohanan() }, [fetchKejohanan])

  // ── Status change ────────────────────────────────────────────────────────────

  function requestStatusChange(k, newStatus) {
    setConfirm({ k, newStatus })
  }

  async function confirmStatusChange() {
    const { k, newStatus } = confirm
    setConfirm(null)

    try {
      if (newStatus === 'aktif') {
        // Nyahaktifkan semua kejohanan lain dahulu (batch)
        const batch = writeBatch(db)
        kejohananList
          .filter(x => x.statusKejohanan === 'aktif' && x.kejohananId !== k.kejohananId)
          .forEach(x => {
            batch.update(doc(db, 'kejohanan', x.kejohananId), {
              statusKejohanan: 'persediaan',
              isAktif: false,
              updatedAt: serverTimestamp(),
            })
          })
        batch.update(doc(db, 'kejohanan', k.kejohananId), {
          statusKejohanan: 'aktif',
          isAktif: true,
          updatedAt: serverTimestamp(),
        })
        await batch.commit()
      } else {
        await updateDoc(doc(db, 'kejohanan', k.kejohananId), {
          statusKejohanan: newStatus,
          isAktif: false,
          updatedAt: serverTimestamp(),
        })
      }
      await fetchKejohanan()
    } catch (err) {
      console.error(err)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function openEdit(k) {
    const mp = k.mataPingat || {}
    setModal({
      mode: 'edit',
      data: {
        kejohananId:    k.kejohananId,
        namaKejohanan:  k.namaKejohanan || '',
        tahun:          k.tahun || new Date().getFullYear(),
        peringkat:      k.peringkat || 'daerah',
        tarikhMula:         k.tarikhMula || '',
        tarikhTamat:        k.tarikhTamat || '',
        tarikhTamatDaftar:  isoToLocalDT(k.tarikhTamatDaftar),
        lokasi:             k.lokasi || '',
        negeri:         k.negeri || '',
        daerah:         k.daerah || '',
        tempoBantahan:  k.tempoBantahan || 60,
        timerAutoRasmi: k.timerAutoRasmi || 15,
        bilanganKedudukan: k.bilanganKedudukan ?? 3,
        mataPingat1:    mp[1] ?? mp['1'] ?? 5,
        mataPingat2:    mp[2] ?? mp['2'] ?? 3,
        mataPingat3:    mp[3] ?? mp['3'] ?? 2,
        mataPingat4:    mp[4] ?? mp['4'] ?? 1,
        catatanAdmin:   k.catatanAdmin || '',
      },
    })
  }

  const displayed = filterStatus === 'semua'
    ? kejohananList
    : kejohananList.filter(k => k.statusKejohanan === filterStatus)

  const aktifKejohanan = kejohananList.find(k => k.statusKejohanan === 'aktif')

  const confirmMessages = {
    aktif:   aktifKejohanan
      ? `Aktifkan kejohanan ini? "${aktifKejohanan.namaKejohanan}" yang sedang aktif akan ditukar ke status Persediaan.`
      : 'Aktifkan kejohanan ini sebagai kejohanan semasa?',
    selesai: 'Tamatkan kejohanan ini? Status tidak boleh diubah semula selepas ini.',
    batal:   'Batalkan kejohanan ini? Tindakan ini tidak boleh diundur.',
  }

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-800">Pengurusan Kejohanan</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {kejohananList.length} kejohanan didaftar
            {aktifKejohanan && (
              <span className="ml-2 text-green-700 font-semibold">
                · Aktif: {aktifKejohanan.namaKejohanan}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={() => setModal({ mode: 'add', data: { ...EMPTY_FORM } })}
            disabled={!!aktifKejohanan}
            title={aktifKejohanan ? `Tamatkan "${aktifKejohanan.namaKejohanan}" dahulu sebelum daftar kejohanan baru.` : ''}
            className="flex items-center gap-2 px-4 py-2 bg-[#003399] text-white text-xs font-semibold rounded hover:bg-[#002277] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Daftar Kejohanan
          </button>
          {aktifKejohanan && (
            <p className="text-[10px] text-amber-700 font-semibold">
              Tamatkan kejohanan aktif dahulu untuk daftar baru.
            </p>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded shadow-sm px-4 py-3 mb-5 flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 font-medium shrink-0">Status:</span>
        {['semua', 'persediaan', 'aktif', 'selesai', 'batal'].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
              filterStatus === s
                ? 'bg-[#003399] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === 'semua' ? 'Semua' : STATUS_META[s]?.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Memuatkan…
        </div>
      ) : displayed.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded shadow-sm p-10 text-center text-gray-400">
          <p className="text-2xl mb-2">🏟️</p>
          <p className="text-sm font-semibold text-gray-600">
            {kejohananList.length === 0 ? 'Tiada kejohanan berdaftar.' : 'Tiada rekod untuk filter ini.'}
          </p>
          {kejohananList.length === 0 && (
            <p className="text-xs mt-1">Klik "Daftar Kejohanan" untuk mula.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {displayed.map(k => (
            <KejohananCard
              key={k.kejohananId}
              k={k}
              onEdit={openEdit}
              onStatusChange={requestStatusChange}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <KejohananModal
          mode={modal.mode}
          initial={modal.data}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); fetchKejohanan() }}
        />
      )}

      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog
          message={confirmMessages[confirm.newStatus]}
          confirmLabel={
            confirm.newStatus === 'aktif' ? 'Ya, Aktifkan' :
            confirm.newStatus === 'selesai' ? 'Ya, Tamatkan' : 'Ya, Batalkan'
          }
          danger={confirm.newStatus === 'batal'}
          onConfirm={confirmStatusChange}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
