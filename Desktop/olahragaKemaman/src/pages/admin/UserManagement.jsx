import { useState, useEffect, useCallback } from 'react'
import {
  collection, getDocs, doc, addDoc, updateDoc, deleteDoc, deleteField, setDoc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import PasswordInput from '../../components/ui/PasswordInput'
import { hashPin } from '../../utils/hashPin'

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES = [
  { value: 'pencatat',        label: 'Pencatat',         badge: 'bg-purple-100 text-purple-800' },
  { value: 'urusetia',        label: 'Urusetia',          badge: 'bg-teal-100 text-teal-800'   },
  { value: 'pengurus_teknik', label: 'Pengurus Teknik',   badge: 'bg-orange-100 text-orange-800' },
  { value: 'admin',           label: 'Admin',             badge: 'bg-blue-100 text-blue-800'   },
]

const ROLE_LABEL = Object.fromEntries(ROLES.map(r => [r.value, r.label]))
const ROLE_BADGE = Object.fromEntries(ROLES.map(r => [r.value, r.badge]))

function genPin() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

const inputCls = 'w-full border border-gray-300 rounded px-3 py-2 text-xs text-gray-800 focus:outline-none focus:border-[#003399] focus:ring-1 focus:ring-[#003399]'

const EMPTY_FORM = { nama: '', email: '', kodAkses: '', pin: '', role: 'pencatat' }

// ─── Sub-components ───────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  return (
    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[role] || 'bg-gray-100 text-gray-600'}`}>
      {ROLE_LABEL[role] || role}
    </span>
  )
}

function StatusBadge({ isAktif }) {
  return isAktif !== false ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      Aktif
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      Tidak Aktif
    </span>
  )
}

// ─── Modal Tambah / Edit ──────────────────────────────────────────────────────

function UserModal({ mode, initial, onClose, onSaved }) {
  const { userData } = useAuth()
  const [form,   setForm]   = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const isEdit = mode === 'edit'

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }))
    setError('')
  }

  function validate() {
    if (!form.nama.trim())    return 'Nama penuh diperlukan.'
    if (!form.kodAkses.trim()) return 'Kod Akses diperlukan.'
    if (!/^[A-Z0-9\-]+$/.test(form.kodAkses.trim()))
      return 'Kod Akses hanya huruf besar, nombor dan (-) sahaja.'
    if (!isEdit && !/^\d{6}$/.test(form.pin))
      return 'PIN mesti tepat 6 digit angka.'
    if (isEdit && form.pin && !/^\d{6}$/.test(form.pin))
      return 'PIN baru mesti tepat 6 digit angka.'
    if (!form.role) return 'Peranan diperlukan.'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const err = validate()
    if (err) return setError(err)
    setSaving(true)
    try {
      if (isEdit) {
        const updateData = {
          nama:      form.nama.trim(),
          email:     form.email.trim().toLowerCase(),
          kodAkses:  form.kodAkses.trim().toUpperCase(),
          role:      form.role,
          updatedAt: serverTimestamp(),
          updatedBy: userData?.uid || '',
        }
        if (form.pin) {
          const ph = await hashPin(form.pin)
          updateData.pinHash = ph
          updateData.pin     = deleteField()
        }
        await updateDoc(doc(db, 'users', initial.uid), updateData)
      } else {
        const ph = await hashPin(form.pin)
        await addDoc(collection(db, 'users'), {
          nama:      form.nama.trim(),
          email:     form.email.trim().toLowerCase(),
          kodAkses:  form.kodAkses.trim().toUpperCase(),
          pinHash:   ph,
          role:      form.role,
          isAktif:   true,
          createdAt: serverTimestamp(),
          createdBy: userData?.uid || '',
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
      <div className="bg-white w-full max-w-md rounded shadow-xl">
        {/* Header */}
        <div className="bg-[#003399] text-white px-5 py-4 rounded-t flex items-center justify-between">
          <p className="text-sm font-bold">{isEdit ? 'Kemaskini Pengguna' : 'Tambah Pengguna Baru'}</p>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Nama */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Nama Penuh <span className="text-red-500">*</span></label>
            <input className={inputCls} value={form.nama}
              onChange={e => set('nama', e.target.value)}
              placeholder="cth: Ahmad bin Ismail" autoFocus />
          </div>

          {/* E-mel (optional) */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">E-mel (pilihan)</label>
            <input className={inputCls} type="email" value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="cth: ahmad@email.com" />
          </div>

          {/* Peranan */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Peranan <span className="text-red-500">*</span></label>
            <select className={inputCls} value={form.role}
              onChange={e => set('role', e.target.value)} disabled={isEdit}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {isEdit && <p className="text-[10px] text-gray-400 mt-1">Peranan tidak boleh diubah.</p>}
          </div>

          {/* Kod Akses */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Kod Akses <span className="text-red-500">*</span></label>
            <input className={inputCls + ' font-mono tracking-wider'} value={form.kodAkses}
              onChange={e => set('kodAkses', e.target.value.toUpperCase().replace(/[^A-Z0-9\-]/g, ''))}
              placeholder="cth: CATAT01" disabled={isEdit} maxLength={20} />
            {isEdit
              ? <p className="text-[10px] text-gray-400 mt-1">Kod Akses tidak boleh diubah.</p>
              : <p className="text-[10px] text-gray-400 mt-1">Huruf besar, nombor & (-) sahaja. Mesti unik.</p>}
          </div>

          {/* PIN */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {isEdit ? 'PIN Baru (kosong = tidak berubah)' : 'PIN (6 Digit)'} {!isEdit && <span className="text-red-500">*</span>}
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <PasswordInput isPin inputMode="numeric"
                  value={form.pin}
                  onChange={e => set('pin', e.target.value.replace(/\D/g,'').slice(0,6))}
                  placeholder={isEdit ? '•••••• (kosong = tidak berubah)' : '••••••'}
                  maxLength={6} />
              </div>
              <button type="button"
                onClick={() => set('pin', genPin())}
                className="px-3 py-2 text-[10px] font-semibold bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-700 whitespace-nowrap">
                Jana PIN
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50">
              Batal
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2 text-xs font-semibold bg-[#003399] text-white rounded hover:bg-[#002277] disabled:opacity-60">
              {saving ? 'Menyimpan…' : isEdit ? 'Kemaskini' : 'Cipta Akaun'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Export PDF ───────────────────────────────────────────────────────────────

async function exportPDF(users) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(13)
  doc.text('Senarai Pengguna Sistem KOAM', 14, 14)
  doc.setFontSize(9)
  doc.text(`Dijana: ${new Date().toLocaleDateString('ms-MY')}`, 14, 21)

  autoTable(doc, {
    startY: 26,
    head: [['#', 'Nama', 'Kod Akses', 'PIN', 'E-mel', 'Peranan', 'Status']],
    body: users.map((u, i) => [
      i + 1,
      u.nama || '—',
      u.kodAkses || '—',
      u.pin || '—',
      u.email || '—',
      ROLE_LABEL[u.role] || u.role || '—',
      u.isAktif === false ? 'Tidak Aktif' : 'Aktif',
    ]),
    styles:     { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 255] },
  })

  doc.save('pengguna-koam.pdf')
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UserManagement() {
  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [modal,      setModal]      = useState(null)
  const [filterRole, setFilterRole] = useState('semua')
  const [search,     setSearch]     = useState('')
  const [toggling,      setToggling]      = useState(null)
  const [deleting,      setDeleting]      = useState(null)
  const [confirmDel,    setConfirmDel]    = useState(null)
  const [resetPin,      setResetPin]      = useState(null) // { uid, nama, newPin }
  const [resettingAttempt, setResettingAttempt] = useState(null)

  const { userData: currentUser } = useAuth()

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')))
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() })))
    } catch {
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function toggleAktif(u) {
    setToggling(u.uid)
    try {
      const next = u.isAktif === false
      await updateDoc(doc(db, 'users', u.uid), { isAktif: next, updatedAt: serverTimestamp() })
      setUsers(prev => prev.map(x => x.uid === u.uid ? { ...x, isAktif: next } : x))
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete(u) {
    setConfirmDel(null)
    setDeleting(u.uid)
    try {
      await deleteDoc(doc(db, 'users', u.uid))
      setUsers(prev => prev.filter(x => x.uid !== u.uid))
    } finally {
      setDeleting(null)
    }
  }

  function openResetPin(u) {
    setResetPin({ uid: u.uid, nama: u.nama, newPin: genPin() })
  }

  async function resetCubaan(u) {
    setResettingAttempt(u.uid)
    try {
      await setDoc(doc(db, 'login_attempts', `user_${u.kodAkses}`), {
        attempts: 0, lockedUntil: null, lastAttempt: serverTimestamp(),
      })
    } finally {
      setResettingAttempt(null)
    }
  }

  async function confirmResetPin() {
    if (!resetPin) return
    const ph = await hashPin(resetPin.newPin)
    await updateDoc(doc(db, 'users', resetPin.uid), {
      pinHash:   ph,
      pin:       deleteField(),   // buang plain text jika ada
      updatedAt: serverTimestamp(),
    })
    setUsers(prev => prev.map(x => x.uid === resetPin.uid ? { ...x, pinHash: ph, pin: undefined } : x))
    setResetPin(null)
  }

  function openEdit(u) {
    setModal({
      mode: 'edit',
      data: {
        uid:      u.uid,
        nama:     u.nama     || '',
        email:    u.email    || '',
        kodAkses: u.kodAkses || '',
        pin:      '',   // kosong — pengguna isi sendiri jika mahu tukar
        role:     u.role     || 'pencatat',
      },
    })
  }

  const displayed = users.filter(u => {
    const matchRole   = filterRole === 'semua' || u.role === filterRole
    const q           = search.toLowerCase()
    const matchSearch = !q ||
      (u.nama     || '').toLowerCase().includes(q) ||
      (u.email    || '').toLowerCase().includes(q) ||
      (u.kodAkses || '').toLowerCase().includes(q)
    return matchRole && matchSearch
  })

  const totalAktif = users.filter(u => u.isAktif !== false).length

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-bold text-gray-800">Pengurusan Pengguna</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {users.length} pengguna terdaftar &mdash; {totalAktif} aktif
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportPDF(displayed)}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 text-xs font-semibold rounded hover:bg-gray-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export PDF
          </button>
          <button
            onClick={() => setModal({ mode: 'add', data: { ...EMPTY_FORM } })}
            className="flex items-center gap-2 px-4 py-2 bg-[#003399] text-white text-xs font-semibold rounded hover:bg-[#002277] shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Tambah Pengguna
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded shadow-sm px-4 py-3 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center flex-wrap gap-1.5 text-xs">
          <span className="text-gray-500 font-medium shrink-0">Peranan:</span>
          {['semua', ...ROLES.map(r => r.value)].map(r => (
            <button key={r} onClick={() => setFilterRole(r)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                filterRole === r
                  ? 'bg-[#003399] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {r === 'semua' ? 'Semua' : ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <input
            className="border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-[#003399] w-52"
            placeholder="Cari nama / e-mel / kod akses…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#003399] text-white text-left">
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Nama</th>
                <th className="px-4 py-3 font-semibold">Kod Akses</th>
                <th className="px-4 py-3 font-semibold">PIN</th>
                <th className="px-4 py-3 font-semibold">E-mel</th>
                <th className="px-4 py-3 font-semibold">Peranan</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-center">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Memuatkan…
                    </div>
                  </td>
                </tr>
              ) : displayed.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    {users.length === 0 ? 'Tiada pengguna berdaftar.' : 'Tiada rekod sepadan.'}
                  </td>
                </tr>
              ) : displayed.map((u, i) => (
                <tr key={u.uid}
                  className={`border-t border-gray-100 ${u.isAktif === false ? 'opacity-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-[#003399]/10 text-[#003399] flex items-center justify-center text-[10px] font-bold shrink-0">
                        {(u.nama || '?').charAt(0).toUpperCase()}
                      </div>
                      <p className="font-semibold text-gray-800">{u.nama || '—'}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-indigo-600 font-semibold">{u.kodAkses || '—'}</td>
                  <td className="px-4 py-3 font-mono font-bold text-gray-700">{u.pin || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-4 py-3"><StatusBadge isAktif={u.isAktif} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <button onClick={() => openEdit(u)}
                        className="px-2 py-1 text-[10px] font-semibold border border-gray-300 rounded text-gray-600 hover:bg-gray-100">
                        Edit
                      </button>
                      <button onClick={() => openResetPin(u)}
                        className="px-2 py-1 text-[10px] font-semibold border border-amber-300 rounded text-amber-700 hover:bg-amber-50">
                        Reset PIN
                      </button>
                      <button onClick={() => resetCubaan(u)} disabled={resettingAttempt === u.uid}
                        title="Buka kunci akaun yang disekat selepas terlalu banyak percubaan"
                        className="px-2 py-1 text-[10px] font-semibold border border-sky-300 rounded text-sky-700 hover:bg-sky-50 disabled:opacity-50">
                        {resettingAttempt === u.uid ? '…' : 'Buka Kunci'}
                      </button>
                      <button onClick={() => toggleAktif(u)} disabled={toggling === u.uid}
                        className={`px-2 py-1 text-[10px] font-semibold rounded disabled:opacity-50 ${
                          u.isAktif === false
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-red-100 text-red-700 hover:bg-red-200'
                        }`}>
                        {toggling === u.uid ? '…' : u.isAktif === false ? 'Aktifkan' : 'Nyahaktif'}
                      </button>
                      {u.uid !== currentUser?.uid && (
                        <button onClick={() => setConfirmDel(u)} disabled={deleting === u.uid}
                          className="px-2 py-1 text-[10px] font-semibold rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                          {deleting === u.uid ? '…' : 'Padam'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && displayed.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-2 bg-gray-50 text-[10px] text-gray-400">
            Menunjukkan {displayed.length} daripada {users.length} pengguna
          </div>
        )}
      </div>

      {/* Modal Tambah/Edit */}
      {modal && (
        <UserModal
          mode={modal.mode}
          initial={modal.data}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); fetchUsers() }}
        />
      )}

      {/* Confirm Padam */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <p className="text-sm font-bold text-gray-800">Padam Pengguna?</p>
            <p className="text-xs text-gray-600">
              <span className="font-semibold">{confirmDel.nama}</span> ({ROLE_LABEL[confirmDel.role] || confirmDel.role})
              akan dipadamkan daripada sistem. Tindakan ini tidak boleh dibatalkan.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDel(null)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Batal
              </button>
              <button onClick={() => handleDelete(confirmDel)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg">
                Ya, Padam
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset PIN Confirm */}
      {resetPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <p className="text-sm font-bold text-gray-800">Reset PIN</p>
            <p className="text-xs text-gray-600">
              PIN baru untuk <span className="font-semibold">{resetPin.nama}</span>:
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-center">
              <p className="font-mono text-2xl font-black text-amber-700 tracking-[0.3em]">{resetPin.newPin}</p>
              <p className="text-[10px] text-amber-600 mt-1">Catat PIN ini sebelum mengesahkan.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setResetPin(null)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Batal
              </button>
              <button onClick={confirmResetPin}
                className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg">
                Sahkan Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
