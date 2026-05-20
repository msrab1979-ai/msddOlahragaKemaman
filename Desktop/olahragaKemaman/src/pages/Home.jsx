import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, onSnapshot, updateDoc, deleteField, serverTimestamp, collection, query, where, getDocs, orderBy } from 'firebase/firestore'
import { selectFinalists as _selectFinalists } from '../utils/finalistUtils'
import { cariRekodUntukAcara, formatPrestasiRekod, tahunRekod } from '../utils/rekodUtils'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import PasswordInput from '../components/ui/PasswordInput'
import { hashPin } from '../utils/hashPin'
import { TETAPAN_DEFAULTS } from './admin/TetapanHome'

// ─── Roles ────────────────────────────────────────────────────────────────────

const ROLES = [
  {
    id: 'pengurus_pasukan', label: 'Pengurus Pasukan', desc: 'Daftar & urus atlet sekolah',
    kodLabel: 'Kod Sekolah', placeholder: 'cth: KMN-SR-001',
    iconBg: 'bg-blue-500',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
  {
    id: 'urusetia', label: 'Urusetia', desc: 'Pengurusan jadual & rekod',
    kodLabel: 'Kod Akses', placeholder: 'cth: URU-2024',
    iconBg: 'bg-amber-500',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
      </svg>
    ),
  },
  {
    id: 'pencatat', label: 'Pencatat', desc: 'Input keputusan acara live',
    kodLabel: 'Kod Pencatat', placeholder: 'cth: CATAT01',
    iconBg: 'bg-emerald-500',
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    ),
  },
]

const JENIS_LABEL = {
  lorong:        'Larian Lorong',
  mass_start:    'Mass Start',
  padang_lompat: 'Padang Lompat',
  padang_balin:  'Padang Balin',
  relay:         'Relay',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errMsg(code) {
  if (['auth/user-not-found','auth/wrong-password','auth/invalid-credential'].includes(code))
    return 'Kod atau PIN tidak sah.'
  if (code === 'auth/too-many-requests') return 'Terlalu banyak percubaan. Cuba sebentar lagi.'
  if (code === 'auth/user-disabled') return 'Akaun dinyahaktifkan.'
  return 'Ralat sistem. Hubungi pentadbir.'
}

function fmtMasa(val) {
  if (!val && val !== 0) return '—'
  const n = Number(val)
  if (isNaN(n) || n === 0) return '—'
  const m = Math.floor(n / 60)
  const s = (n % 60).toFixed(2).padStart(5, '0')
  return m > 0 ? `${m}:${s}` : `${n.toFixed(2)}s`
}

function fmtJarak(val) {
  if (!val && val !== 0) return '—'
  const n = Number(val)
  if (isNaN(n) || n === 0) return '—'
  return `${n.toFixed(2)} m`
}

function formatTarikh(mula, tamat) {
  const opt = { day: 'numeric', month: 'long', year: 'numeric' }
  const dMula = new Date(mula + 'T00:00:00')
  if (!tamat || tamat === mula) return dMula.toLocaleDateString('ms-MY', opt)
  const dTamat = new Date(tamat + 'T00:00:00')
  if (dMula.getFullYear() === dTamat.getFullYear() && dMula.getMonth() === dTamat.getMonth())
    return `${dMula.getDate()} – ${dTamat.toLocaleDateString('ms-MY', opt)}`
  return `${dMula.toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' })} – ${dTamat.toLocaleDateString('ms-MY', opt)}`
}

function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ms-MY', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ─── LupaPinModal ─────────────────────────────────────────────────────────────

function genPin6() {
  // Jana PIN 6 digit rawak (100000–999999)
  return String(Math.floor(100000 + Math.random() * 900000))
}

function LupaPinModal({ onClose }) {
  const [kodSekolah, setKodSekolah] = useState('')
  const [email,      setEmail]      = useState('')
  const [newPin,     setNewPin]     = useState(null)  // null = belum reset, string = PIN baru
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!kodSekolah.trim()) return setError('Sila masukkan Kod Sekolah.')
    if (!email.trim())      return setError('Sila masukkan E-mel Sekolah.')
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'sekolah', kodSekolah.trim().toUpperCase()))
      if (!snap.exists()) {
        setError('Kod Sekolah tidak dijumpai dalam sistem.')
        return
      }
      const data = snap.data()
      if ((data.email || '').toLowerCase().trim() !== email.toLowerCase().trim()) {
        setError('E-mel tidak sepadan dengan rekod sekolah ini.')
        return
      }
      // Jana PIN baru, hash & simpan — PIN lama digantikan
      const pin6   = genPin6()
      const ph     = await hashPin(pin6)
      await updateDoc(doc(db, 'sekolah', kodSekolah.trim().toUpperCase()), {
        pinHash:   ph,
        pin:       deleteField(),   // buang plain text jika ada
        updatedAt: serverTimestamp(),
      })
      setNewPin(pin6)
    } catch {
      setError('Ralat sistem. Cuba sebentar lagi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full max-w-xs rounded-xl shadow-2xl overflow-hidden">
        <div className="bg-[#003399] px-5 py-4 flex items-center justify-between">
          <p className="text-sm font-bold text-white">Lupa PIN</p>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          {newPin !== null ? (
            <div className="text-center py-2 space-y-3">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <p className="text-xs font-semibold text-gray-700">PIN baru untuk sekolah anda:</p>
              <p className="text-3xl font-black tracking-[0.3em] text-[#003399] font-mono bg-blue-50 rounded-xl py-4 border border-blue-100">
                {newPin}
              </p>
              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Catat PIN ini sekarang. Ia <strong>tidak akan dipaparkan semula</strong> selepas ditutup.
              </p>
              <button onClick={onClose}
                className="w-full bg-[#003399] text-white font-bold py-2.5 rounded-lg text-xs">
                SAYA SUDAH CATAT — TUTUP
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <p className="text-xs text-gray-500">
                Masukkan Kod Sekolah dan E-mel untuk <strong>jana PIN baru</strong>.
                PIN lama tidak lagi boleh digunakan selepas ini.
              </p>
              {error && (
                <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
              )}
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  Kod Sekolah
                </label>
                <input type="text" value={kodSekolah}
                  onChange={e => { setKodSekolah(e.target.value.toUpperCase()); setError('') }}
                  required autoFocus placeholder="cth: KMN-SR-001"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                  E-mel Sekolah
                </label>
                <input type="email" value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  required placeholder="sk@moe.edu.my"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-[#003399] hover:bg-[#002277] disabled:bg-gray-300 text-white font-bold py-2.5 rounded-lg text-xs tracking-widest transition-colors">
                {loading ? 'MENYEMAK…' : 'TUNJUK PIN'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── LoginForm ────────────────────────────────────────────────────────────────

function LoginForm({ role, onCancel, cfg }) {
  const { loginPencatat, loginPengurus } = useAuth()
  const navigate = useNavigate()
  const [kod, setKod] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [lupaPinModal, setLupaPinModal] = useState(false)
  const isPengurus = role.id === 'pengurus_pasukan'

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!kod.trim()) return setError(`${role.kodLabel} diperlukan.`)
    if (!/^\d{6}$/.test(pin)) return setError('PIN mesti 6 digit.')
    setLoading(true)
    try {
      if (isPengurus) await loginPengurus(kod.trim(), pin)
      else await loginPencatat(kod.trim(), pin)
      navigate('/dashboard')
    } catch (err) {
      setError(errMsg(err.code))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="mt-6 max-w-sm mx-auto">
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden">
          <div className="bg-[#003399] px-5 py-3 flex items-center justify-between">
            <p className="text-xs font-bold text-white tracking-wide uppercase">{role.label}</p>
            <button type="button" onClick={onCancel} className="text-white/50 hover:text-white text-sm leading-none transition-colors">✕</button>
          </div>
          <div className="p-5 space-y-4">
            {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{role.kodLabel}</label>
              <input type="text" value={kod}
                onChange={e => { setKod(e.target.value.toUpperCase()); setError('') }}
                placeholder={role.placeholder} autoFocus
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50 tracking-wider" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">PIN — 6 Digit</label>
              <PasswordInput isPin inputMode="numeric" value={pin}
                onChange={e => { setPin(e.target.value.replace(/\D/g,'').slice(0,6)); setError('') }}
                placeholder="• • • • • •" maxLength={6} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-[#003399] hover:bg-[#002277] disabled:bg-gray-300 text-white font-bold py-2.5 rounded-lg text-xs tracking-widest transition-colors">
              {loading ? 'MENGESAH…' : 'LOG MASUK'}
            </button>
            <p className="text-center">
              <button type="button" onClick={() => setLupaPinModal(true)}
                className="text-[10px] text-gray-400 hover:text-[#003399] underline transition-colors">
                Lupa PIN?
              </button>
            </p>


          </div>
        </form>
      </div>
      {lupaPinModal && <LupaPinModal onClose={() => setLupaPinModal(false)} />}
    </>
  )
}

// ─── AdminModal ───────────────────────────────────────────────────────────────

function AdminModal({ onClose }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(errMsg(err.code))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full max-w-xs rounded-xl shadow-2xl overflow-hidden">
        <div className="bg-[#003399] px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[9px] text-white/40 uppercase tracking-widest">Sistem KOAM</p>
            <p className="text-sm font-bold text-white mt-0.5">Log Masuk Pentadbir</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">E-mel</label>
            <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError('') }}
              required autoFocus autoComplete="email" placeholder="pentadbir@moe.gov.my"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Kata Laluan</label>
            <PasswordInput value={password} onChange={e => { setPassword(e.target.value); setError('') }}
              required autoComplete="current-password" placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-[#003399] hover:bg-[#002277] disabled:bg-gray-300 text-white font-bold py-2.5 rounded-lg text-xs tracking-widest transition-colors">
            {loading ? 'MENGESAH…' : 'LOG MASUK'}
          </button>
          <p className="text-center text-[10px] text-gray-400 pt-1">Superadmin &amp; Pengurus Teknik sahaja</p>
        </form>
      </div>
    </div>
  )
}

// ─── RekodModal ───────────────────────────────────────────────────────────────

const PERINGKAT_LABEL_M = { D: 'Daerah', N: 'Negeri', K: 'Kebangsaan' }

// Mesti sama dengan rekodKeyStr() dalam postRasmiUtils.js
function rekodKeyHome(namaAcara, jantina, kategoriKod, peringkat) {
  return [namaAcara, jantina, kategoriKod, peringkat]
    .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

function RekodModal({ peserta, acara, onClose }) {
  const [data,    setData]    = useState(null)  // { tuntutan, rekodAsal }
  const [loading, setLoading] = useState(true)

  const peringkat   = peserta.pecahRekod
  const isPadangM   = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
  const unitM       = isPadangM ? 'm' : 's'

  function fmtP(val) {
    if (val == null || val === '') return '—'
    const n = Number(val); if (isNaN(n) || n === 0) return '—'
    if (unitM === 's') {
      if (n >= 60) { const m = Math.floor(n/60); return `${m}:${(n%60).toFixed(2).padStart(5,'0')}` }
      return n.toFixed(2) + 's'
    }
    return n.toFixed(2) + 'm'
  }

  useEffect(() => {
    const rekodNama = acara.namaAcaraPendek || acara.namaAcara
    const rKey = rekodKeyHome(rekodNama, acara.jantina, acara.kategoriKod, peringkat)
    Promise.all([
      getDoc(doc(db, 'rekod', rKey + '_tuntutan')),
      getDoc(doc(db, 'rekod', rKey)),
    ]).then(([tSnap, aSnap]) => {
      setData({
        tuntutan:  tSnap.exists()  ? tSnap.data()  : null,
        rekodAsal: aSnap.exists()  ? aSnap.data()  : null,
      })
    }).catch(() => setData(null)).finally(() => setLoading(false))
  }, []) // eslint-disable-line

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const t = data?.tuntutan
  const r = data?.rekodAsal

  // Rekod lama: jika tuntutan wujud → ambil prestasiLama dari tuntutan (null = rekod pertama)
  //             jika tiada tuntutan tapi ada rekodAsal → rekodAsal itu sendiri adalah rekod lama (rujukan)
  const prestasiLama = t != null
    ? (t.prestasiLama ?? null)
    : (r ? Number(r.prestasi) : null)
  const tahunLama = t != null
    ? (t.tahunLama ?? (r ? String(r.tarikhRekod || '').slice(0, 4) : null))
    : (r ? String(r.tarikhRekod || '').slice(0, 4) : null)
  const namaLama  = t != null
    ? (t.namaLama  ?? (prestasiLama == null ? null : r?.namaAtlet ?? null))
    : (r?.namaAtlet ?? null)
  const lokasiLama = t != null
    ? (t.lokasiLama ?? (prestasiLama == null ? null : (r?.namaSekolah ?? r?.namaDaerah ?? r?.namaNegeri ?? null)))
    : (r?.namaSekolah ?? r?.namaDaerah ?? r?.namaNegeri ?? null)

  // Auto-approve: rekod dari postRasmi sentiasa dianggap sah
  const prestasiStatus = 'aktif'
  const delta = (() => {
    if (!t?.prestasi || !prestasiLama) return null
    const diff = Math.abs(Number(t.prestasi) - prestasiLama)
    return isPadangM ? `+${diff.toFixed(2)}m` : `-${diff.toFixed(2)}s`
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full max-w-xs rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-[#003399] px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[9px] text-white/50 uppercase tracking-widest">
              RBK — Rekod Baru Kejohanan
            </p>
            <p className="text-sm font-black text-white leading-tight">{acara.namaAcara || '—'}</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 py-4">
              <div className="w-4 h-4 border-2 border-[#003399] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Memuatkan…</p>
            </div>
          ) : !data ? (
            <p className="text-xs text-gray-400 py-4 text-center">Data rekod tidak dijumpai.</p>
          ) : (
            <>
              {/* Rekod Baru */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-[9px] font-bold text-amber-500 uppercase tracking-widest mb-1">Rekod Baru</p>
                <p className="text-2xl font-black text-amber-700 font-mono">{fmtP(t?.prestasi ?? peserta.keputusan)}</p>
                <p className="text-xs font-semibold text-gray-800 mt-1">{t?.namaAtlet || peserta.namaAtlet || '—'}</p>
                <p className="text-[10px] text-gray-500">{t?.namaSekolah || peserta.namaSekolah || peserta.kodSekolah || '—'}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-300 text-amber-700">
                    {PERINGKAT_LABEL_M[peringkat] || peringkat}
                  </span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                    prestasiStatus === 'aktif'
                      ? 'border-green-300 text-green-700 bg-green-50'
                      : 'border-orange-300 text-orange-700 bg-orange-50'
                  }`}>
                    {prestasiStatus === 'aktif' ? '✓ Disahkan' : '⏳ Menunggu'}
                  </span>
                  {delta && <span className="text-[9px] font-bold text-green-600">{delta}</span>}
                </div>
              </div>

              {/* Rekod Lama */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                  {prestasiLama ? 'Rekod Lama' : 'Tiada Rekod Sebelum Ini'}
                </p>
                {prestasiLama ? (
                  <>
                    <p className="text-xl font-black text-gray-600 font-mono">{fmtP(prestasiLama)}</p>
                    {tahunLama && <p className="text-[10px] text-gray-400">Tahun: {tahunLama}</p>}
                    {namaLama  && <p className="text-xs text-gray-600 mt-0.5">{namaLama}</p>}
                    {lokasiLama && <p className="text-[10px] text-gray-400">{lokasiLama}</p>}
                  </>
                ) : (
                  <p className="text-xs text-gray-400 italic">Rekod pertama untuk acara ini.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── KeputusanExpanded ────────────────────────────────────────────────────────

function KeputusanExpanded({ heats, acara, sekolahMap, isLoading, finalSetup, rekodDNK }) {
  const [rekodModal, setRekodModal] = useState(null) // peserta yang badge diklik

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="w-4 h-4 border-2 border-[#003399] border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-gray-400">Memuatkan keputusan…</p>
      </div>
    )
  }
  if (!heats || heats.length === 0) {
    return <p className="px-4 py-4 text-xs text-gray-400 italic">Tiada keputusan untuk acara ini.</p>
  }

  const isPadang = ['padang_lompat', 'padang_balin'].includes(acara.jenisAcara)
  const isRelay  = acara.jenisAcara === 'relay'

  // Semak sama ada acara ini adalah saringan (bukan final/akhir)
  const isSaringanAcara = (() => {
    const p = (acara.peringkat  || '').toLowerCase()
    const n = (acara.namaAcara  || '').toLowerCase()
    return p.includes('saringan') || n.includes('saringan')
  })()

  // Tunjuk heat yang ada keputusan ('diterima' = baru, 'tidak_rasmi'/'rasmi' = data lama)
  const heatsWithResult = heats.filter(h =>
    ['diterima','tidak_rasmi','rasmi'].includes(h.statusKeputusan)
  )
  if (heatsWithResult.length === 0) {
    return null
  }

  // Pisah heat final vs saringan
  const FASA_FINAL = ['final', 'terus_final']
  const finalHeats    = heatsWithResult.filter(h => FASA_FINAL.includes(h.fasa) || h.peringkat === 'final')
  const saringanHeats = heatsWithResult.filter(h => !FASA_FINAL.includes(h.fasa) && h.peringkat !== 'final')

  // Jika final heat ada keputusan → tunjuk final. Kalau tiada → tunjuk saringan.
  const showingFinal   = finalHeats.length > 0
  const displayHeats   = showingFinal ? finalHeats : heatsWithResult

  // Kolum Catatan + label FINAL hanya bila tunjuk saringan (belum ada final)
  // Relay: tunjuk catatan bila ada saringan heat (fasa='heat') walaupun isSaringanAcara=false
  const showCatatanCol = (isSaringanAcara || (isRelay && saringanHeats.length > 0)) && !showingFinal

  // Status paparan
  const statusPapar  = displayHeats.some(h => h.statusKeputusan === 'rasmi') ? 'rasmi' : 'tidak_rasmi'
  const isRasmiPapar = statusPapar === 'rasmi'

  // Countdown bantahan — ambil countdownTamat terlambat dari heat tidak_rasmi
  const countdownInfo = (() => {
    if (isRasmiPapar) return null
    const toMs = ts => {
      if (!ts) return null
      if (typeof ts === 'number') return ts
      if (ts.toDate) return ts.toDate().getTime()
      if (ts.seconds) return ts.seconds * 1000
      return null
    }
    let latest = null
    displayHeats.forEach(h => {
      if (h.statusKeputusan !== 'tidak_rasmi') return
      const ms = toMs(h.countdownTamat)
      if (ms && (!latest || ms > latest)) latest = ms
    })
    if (!latest) return null
    const jamMenit = new Date(latest).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' })
    return { expired: Date.now() > latest, jamMenit }
  })()

  const allPeserta = []
  displayHeats.forEach(heat => {
    ;(heat.peserta || []).forEach(p => {
      allPeserta.push({ ...p, _peringkat: heat.peringkat })
    })
  })

  allPeserta.sort((a, b) => {
    const ar = a.kedudukan || a.rankDalamHeat
    const br = b.kedudukan || b.rankDalamHeat
    if (ar && br) return ar - br
    if (ar) return -1
    if (br) return 1
    const av = Number(a.keputusan) || 0, bv = Number(b.keputusan) || 0
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    return isPadang ? bv - av : av - bv
  })

  // finalistBibs / finalistQMap: hanya kira bila papar saringan (tiada final lagi)
  // Relay: guna kodSekolah sebagai key
  const _finalistRaw = showCatatanCol ? _selectFinalists(heats, acara, finalSetup) : []
  const finalistBibs = new Set(_finalistRaw.map(f => isRelay ? f.kodSekolah : f.noBib))
  const finalistQMap = new Map(_finalistRaw.map(f => [
    isRelay ? f.kodSekolah : f.noBib,
    f.qualifyType || 'q',
  ]))

  // Label top-bar
  // isTerusFinal = showingFinal tapi tiada saringan heat sebelumnya (1 heat terus ke final)
  const isTerusFinal = showingFinal && saringanHeats.length === 0
  const heatLabel = showingFinal
    ? (isTerusFinal ? 'Terus Final' : 'Final')
    : saringanHeats.length > 1
      ? `${saringanHeats.length} Heat Saringan`
      : saringanHeats.length === 1
        ? 'Saringan'
        : heatsWithResult.length > 1 ? `${heatsWithResult.length} Heat` : 'Heat'

  // Helper: render satu jadual untuk satu heat
  function renderHeatTable(heat, heatPeserta, labelOverride) {
    // fasa='final' = JanaFinal heat atau terus_final heat; kedua-dua adalah final
    const isFinalHeat = heat.peringkat === 'final' || heat.fasa === 'final' || heat.fasa === 'terus_final'
    const label = labelOverride || (isFinalHeat ? 'Final' : `Heat ${heat.noHeat}`)
    const labelCls = isFinalHeat
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-white text-gray-500 border-gray-200'

    return (
      <div key={heat.heatId} className="border-b border-gray-100 last:border-b-0">
        {/* Sub-header heat */}
        <div className="px-3 py-1.5 flex items-center gap-2 bg-gray-50/60 border-b border-gray-100">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${labelCls}`}>
            {label}
          </span>
          {isFinalHeat && (
            <span className="text-[9px] font-black tracking-widest uppercase text-teal-600">Keputusan</span>
          )}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50/30">
              <th className="px-2 py-1.5 text-center w-7">#</th>
              {!isRelay && <th className="px-1.5 py-1.5 text-center w-9">BIB</th>}
              <th className="px-2 py-1.5 text-left">{isRelay ? 'Pasukan' : 'Nama Atlet'}</th>
              {!isRelay && <th className="hidden sm:table-cell px-3 py-1.5 text-left">Sekolah</th>}
              <th className="px-2 py-1.5 text-right">{isPadang ? 'Jarak' : 'Masa'}</th>
              {showCatatanCol && <th className="px-1.5 py-1.5 text-center w-8">Q</th>}
            </tr>
          </thead>
          <tbody>
            {heatPeserta.map((p, idx) => {
              const flagged     = ['DNS', 'DNF', 'DQ'].includes(p.status)
              const namaSkl     = (p.kodSekolah && (sekolahMap[p.kodSekolah] || p.kodSekolah)) || p.kodSekolah || '—'
              const kddk        = p.kedudukan || p.rankDalamHeat
              const isSementara = !p.kedudukan && !!p.rankDalamHeat
              const hasil       = isPadang ? fmtJarak(p.keputusan) : fmtMasa(p.keputusan)
              const medal       = isFinalHeat && (kddk === 1 ? '🥇' : kddk === 2 ? '🥈' : kddk === 3 ? '🥉' : null)
              // Relay: semak kelayakan guna kodSekolah; individu: guna noBib
              const layakFinal  = showCatatanCol && !flagged && finalistBibs.has(isRelay ? p.kodSekolah : p.noBib)

              return (
                <tr key={idx} className={`border-t border-gray-50 ${
                  layakFinal ? 'bg-blue-50/30' :
                  flagged    ? 'bg-red-50/30' :
                  kddk === 1 ? 'bg-amber-50/40' :
                  idx % 2 === 1 ? 'bg-gray-50/20' : ''
                }`}>
                  <td className="px-2 py-2 text-center">
                    {medal
                      ? <span className={`text-sm ${isSementara ? 'opacity-50' : ''}`}>{medal}</span>
                      : <span className="text-[10px] text-gray-400 font-bold">{kddk || (idx + 1)}</span>
                    }
                  </td>
                  {!isRelay && (
                    <td className="px-1.5 py-2 text-center font-mono text-gray-500 text-[11px]">{p.noBib || '—'}</td>
                  )}
                  <td className="px-2 py-2">
                    {isRelay
                      ? <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-gray-800">{namaSkl}</p>
                          {p.pecahRekod && (
                            <button
                              onClick={e => { e.stopPropagation(); setRekodModal(p) }}
                              className="shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-400 hover:bg-amber-500 text-white tracking-wide transition-colors"
                              title="Klik untuk lihat rekod dipecahkan"
                            >
                              RBK
                            </button>
                          )}
                          {p.samaiRekod && (
                            <span
                              className="shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded bg-teal-500 text-white tracking-wide"
                              title="Menyamai Rekod Kejohanan Lepas"
                            >
                              MRKL
                            </span>
                          )}
                        </div>
                      : <div>
                          <div className="flex items-center gap-1.5">
                          <p className={`font-semibold ${flagged ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                            {p.namaAtlet || '—'}
                            {flagged && <span className="ml-1 no-underline text-red-500 font-bold"> {p.status}</span>}
                          </p>
                          {p.pecahRekod && (
                            <button
                              onClick={e => { e.stopPropagation(); setRekodModal(p) }}
                              className="shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-400 hover:bg-amber-500 text-white tracking-wide transition-colors"
                              title="Klik untuk lihat rekod dipecahkan"
                            >
                              RBK
                            </button>
                          )}
                          {p.samaiRekod && (
                            <span
                              className="shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded bg-teal-500 text-white tracking-wide"
                              title="Menyamai Rekod Kejohanan Lepas"
                            >
                              MRKL
                            </span>
                          )}
                          </div>
                          {/* Sekolah — visible on mobile only (hidden on sm+) */}
                          <p className="sm:hidden text-[9px] text-gray-400 mt-0.5 truncate">{namaSkl}</p>
                        </div>
                    }
                  </td>
                  {!isRelay && (
                    <td className="hidden sm:table-cell px-3 py-2 text-gray-500 text-[11px] max-w-[120px] truncate">{namaSkl}</td>
                  )}
                  <td className={`px-2 py-2 text-right font-mono font-bold text-[11px] ${flagged ? 'text-red-400' : 'text-gray-800'}`}>
                    {flagged ? p.status : (hasil || '—')}
                  </td>
                  {showCatatanCol && (
                    <td className="px-1.5 py-2 text-center">
                      {layakFinal && (() => {
                        const qt = finalistQMap.get(isRelay ? p.kodSekolah : p.noBib) || 'q'
                        return (
                          <span className={`inline-block text-[9px] font-black px-1.5 py-0.5 rounded text-white tracking-wide ${qt === 'Q' ? 'bg-green-600' : 'bg-sky-500'}`}>
                            {qt}
                          </span>
                        )
                      })()}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // Render: kalau final → satu jadual. Kalau saringan → pecah by heat.
  const renderContent = () => {
    if (showingFinal) {
      // Final heat — satu jadual sahaja
      const finalHeat = finalHeats[0]
      const peserta   = [...(finalHeat?.peserta || [])]
        .sort((a, b) => {
          const ar = a.kedudukan || a.rankDalamHeat, br = b.kedudukan || b.rankDalamHeat
          if (ar && br) return ar - br
          if (ar) return -1; if (br) return 1
          const av = Number(a.keputusan)||0, bv = Number(b.keputusan)||0
          return isPadang ? bv - av : av - bv
        })
      return renderHeatTable(finalHeat, peserta, isTerusFinal ? 'Terus Final' : 'Final')
    }

    // Saringan — satu jadual per heat
    return displayHeats
      .sort((a, b) => (a.noHeat || 0) - (b.noHeat || 0))
      .map(heat => {
        const peserta = [...(heat.peserta || [])]
          .sort((a, b) => {
            const ar = a.rankDalamHeat, br = b.rankDalamHeat
            if (ar && br) return ar - br
            if (ar) return -1; if (br) return 1
            const av = Number(a.keputusan)||0, bv = Number(b.keputusan)||0
            return isPadang ? bv - av : av - bv
          })
        return renderHeatTable(heat, peserta)
      })
  }

  return (
    <div className="overflow-x-auto">
      {/* Top label bar */}
      <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/60">
        <span className="text-[9px] font-bold text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded">
          {heatLabel}
        </span>
        <span className="text-[9px] font-black tracking-widest uppercase text-teal-600">
          Keputusan
        </span>
      </div>
      {renderContent()}

      {/* ── Rekod Daerah / Negeri / Kebangsaan ── */}
      {rekodDNK && (rekodDNK.D || rekodDNK.N || rekodDNK.K) && (() => {
        const LABEL = { D: 'Daerah', N: 'Negeri', K: 'Kebangsaan' }
        const rows  = ['D', 'N', 'K'].map(p => ({ p, r: rekodDNK[p] })).filter(x => x.r)
        if (!rows.length) return null
        return (
          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/40">
            <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Rekod</p>
            <div className="space-y-1">
              {rows.map(({ p, r }) => (
                <div key={p} className="flex items-center gap-2 text-[10px] min-w-0">
                  <span className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 leading-none">
                    {LABEL[p]}
                  </span>
                  <span className="font-mono font-bold text-[#003399]">
                    {formatPrestasiRekod(r.prestasi, r.unit)}
                  </span>
                  <span className="text-gray-600 truncate">
                    {r.namaAtlet || r.namaSekolah || '—'}
                  </span>
                  <span className="shrink-0 text-gray-400 text-[9px]">
                    {tahunRekod(r.tarikhRekod)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {rekodModal && (
        <RekodModal
          peserta={rekodModal}
          acara={acara}
          onClose={() => setRekodModal(null)}
        />
      )}
    </div>
  )
}

// ─── AcaraTableRow ────────────────────────────────────────────────────────────

function AcaraTableRow({ item, isExpanded, onToggle, heats, isLoading, sekolahMap, finalSetup, rekodDNK }) {
  const { acara, masaMula } = item
  const noAcara  = acara.noAcara || acara.id || acara.acaraId || '—'
  const status   = acara.statusAcara || 'akan_datang'
  const peringkatRaw = (acara.peringkat || '').toLowerCase()
  const namaRaw      = (acara.namaAcara  || '').toLowerCase()
  const peringkatLabel = (() => {
    if (peringkatRaw.includes('saringan') || namaRaw.includes('saringan')) return 'Saringan'
    if (peringkatRaw.includes('akhir') || namaRaw.includes('akhir'))       return 'Akhir'
    if (peringkatRaw.includes('final') || namaRaw.includes('final'))       return 'Final'
    if (peringkatRaw.includes('separuh'))                                   return 'S/Akhir'
    return peringkat || '—'
  })()
  const peringkat = acara.peringkat || ''

  const hasResult = ['ada_keputusan','rasmi','tidak_rasmi'].includes(status)
  let catatanText = '—'
  let catatanCls  = 'text-gray-300'
  if (hasResult) {
    catatanText = 'KEPUTUSAN'
    catatanCls  = 'text-teal-600 font-bold text-[10px] cursor-pointer hover:underline'
  }

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer hover:bg-blue-50/40 transition-colors border-b border-gray-100 group"
      >
        <td className="hidden sm:table-cell px-2 py-2.5 text-center font-mono font-black text-[#003399] text-xs">{noAcara}</td>
        <td className="px-2 py-2.5 text-center font-mono font-bold text-gray-700 text-xs">{masaMula || '—'}</td>
        <td className="px-3 py-2.5 text-left text-xs">
          <p className="font-semibold text-gray-800 leading-snug">{acara.namaAcara || acara.namaAcaraPendek || '—'}</p>
          <p className="sm:hidden text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
            <span className="font-mono text-[#003399]">{noAcara}</span>
            {hasResult && <span className="text-teal-600 font-bold">· KEPUTUSAN</span>}
          </p>
        </td>
        <td className="px-2 py-2.5 text-center text-gray-600 text-xs">{acara.kelas || '—'}</td>
        <td className="hidden sm:table-cell px-2 py-2.5 text-center text-xs">
          <span className={`font-semibold ${
            peringkatLabel === 'Saringan' ? 'text-blue-500' :
            peringkatLabel === 'Akhir' || peringkatLabel === 'Final' ? 'text-green-600' :
            peringkatLabel === 'S/Akhir' ? 'text-purple-500' : 'text-gray-400'
          }`}>{peringkatLabel}</span>
        </td>
        <td className={`hidden sm:table-cell px-3 py-2.5 text-left ${catatanCls}`}>{catatanText}</td>
        <td className="px-2 py-2.5 text-center w-7">
          <svg className={`w-3.5 h-3.5 text-gray-300 group-hover:text-gray-400 transition-transform duration-150 inline-block ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} className="bg-gray-50 border-b border-gray-200 p-0">
            <KeputusanExpanded
              heats={heats}
              acara={acara}
              sekolahMap={sekolahMap}
              isLoading={isLoading}
              finalSetup={finalSetup}
              rekodDNK={rekodDNK}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Home ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // Config
  const [cfg,          setCfg]          = useState(TETAPAN_DEFAULTS)
  const [kejohanan,    setKejohanan]    = useState(null)
  const [kejohananId,  setKejohananId]  = useState(null)
  const [sekolahMap,     setSekolahMap]     = useState({}) // kodSekolah → namaSekolah

  // UI
  const [selected,    setSelected]    = useState(null)
  const [adminModal,  setAdminModal]  = useState(false)
  const [printingPdf, setPrintingPdf] = useState(false)

  // Jadual
  const [jadualByDay,    setJadualByDay]    = useState({})
  const [jadualDays,     setJadualDays]     = useState([])
  const [expandedDays,   setExpandedDays]   = useState(new Set()) // accordion hari
  const [jadualLoading,  setJadualLoading]  = useState(false)
  const [expandedAcara,  setExpandedAcara]  = useState(new Set())
  const [heatCache,      setHeatCache]      = useState({}) // aceraKey → heats[]
  const [heatLoading,    setHeatLoading]    = useState(new Set())
  const [rekodCache,     setRekodCache]     = useState({}) // aceraKey → { D, N, K }

  // Tab Keputusan
  const [activeTab,      setActiveTab]      = useState('jadual')
  const [filterKombo,    setFilterKombo]    = useState('semua') // 'semua' | 'L_A' | 'P_B' ...
  const [kategoriMap,    setKategoriMap]    = useState({})      // kod → { umurHad, nama }
  const [jenisMap,       setJenisMap]       = useState({})      // jenisSekolah → { warna, nama }

  // Medal Standing
  const [medalTally,          setMedalTally]          = useState([])
  const [medalLoading,        setMedalLoading]        = useState(false)
  const [expandedMedalGroups, setExpandedMedalGroups] = useState(new Set()) // default tutup
  const [expandedKatRows,     setExpandedKatRows]     = useState(new Set()) // sekolah expand kategori

  // Rekod Baru
  const [rekodBaru,    setRekodBaru]    = useState([]) // rekod dari kejohanan semasa
  const [rekodLoading, setRekodLoading] = useState(false)

  // Rekod Kejohanan (all-time, tab baru)
  const [rekodAll,           setRekodAll]           = useState([])
  const [rekodAllLoading,    setRekodAllLoading]    = useState(false)
  const [rekodAllLoaded,     setRekodAllLoaded]     = useState(false)
  const [activePeringkatRekod, setActivePeringkatRekod] = useState('D')
  const [activeKatRekod,     setActiveKatRekod]     = useState('')

  // Finalist setup (tetapan/finalSetup)
  const [finalSetup,   setFinalSetup]   = useState(null)

  // Redirect if logged in
  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  // Config — real-time listener supaya Home auto-update bila TetapanHome disimpan
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'tetapan', 'home'), s => {
      if (s.exists()) setCfg({ ...TETAPAN_DEFAULTS, ...s.data() })
    })
    return () => unsub()
  }, [])

  // Load finalSetup + sekolah + kategori sekali sahaja
  useEffect(() => {
    getDoc(doc(db, 'tetapan', 'finalSetup'))
      .then(s => { if (s.exists()) setFinalSetup(s.data()) })
      .catch(() => {})
      .catch(() => {})
    // Kategori collection — doc ID = kod (A, B, C, D, E, PPKI)
    getDocs(collection(db, 'kategori'))
      .then(snap => {
        const map = {}
        const jMap = {}
        snap.forEach(d => {
          const data = d.data()
          map[d.id] = { umurHad: data.umurHad, nama: data.nama || d.id, jenisSekolah: data.jenisSekolah || 'SR' }
          // Build jenisMap: jenisSekolah → { warna, nama }
          if (data.jenisSekolah) {
            if (!jMap[data.jenisSekolah]) {
              jMap[data.jenisSekolah] = { warna: data.warna || '#6b7280', nama: data.jenisSekolah }
            }
          }
        })
        setKategoriMap(map)
        setJenisMap(jMap)
      })
      .catch(() => {})
    getDocs(collection(db, 'sekolah')).then(snap => {
      const map = {}
      snap.forEach(d => {
        const s = d.data()
        if (s.kodSekolah) {
          map[s.kodSekolah] = s.namaSekolah || s.kodSekolah
        }
      })
      setSekolahMap(map)
    }).catch(() => {})
    loadJadualData()
  }, []) // eslint-disable-line

  async function loadJadualData() {
    setJadualLoading(true)
    try {
      // ── Langkah 1: Muatkan jadual_acara (SEMUA, tanpa filter kejohananId) ──
      const jadualSnap = await getDocs(collection(db, 'jadual_acara'))

      // Bina map: aceraKey → jadual info, kira kejohananId paling banyak
      const jadualMap   = {}  // aceraKey → { masaMula, lokasi, tarikhAcara, kejId }
      const kejIdCount  = {}  // kejohananId → count
      jadualSnap.docs.forEach(d => {
        const j = d.data()
        if (j.statusJadual === 'batal' || !j.tarikhAcara) return
        const key = j.aceraId || j.acaraId
        if (!key) return
        jadualMap[key] = { masaMula: j.masaMula, lokasi: j.lokasi, tarikhAcara: j.tarikhAcara, kejId: j.kejohananId }
        if (j.kejohananId) kejIdCount[j.kejohananId] = (kejIdCount[j.kejohananId] || 0) + 1
      })

      // Pilih kejohananId yang paling banyak dalam jadual_acara
      const bestKejId = Object.keys(kejIdCount).sort((a, b) => kejIdCount[b] - kejIdCount[a])[0] || null

      // ── Langkah 2: Muatkan acara subcollection (untuk jenisAcara, kelas dll) ──
      let acaraDetails = {}  // aceraId → acara data
      if (bestKejId) {
        try {
          const acaraSnap = await getDocs(collection(db, 'kejohanan', bestKejId, 'acara'))
          acaraSnap.docs.forEach(d => { acaraDetails[d.id] = { acaraId: d.id, _kejId: bestKejId, ...d.data() } })
        } catch {}
      }

      // Juga muatkan dari kejohanan aktif/persediaan (fallback jika seed key berbeza)
      try {
        const kejSnap = await getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', 'in', ['aktif', 'persediaan'])))
        if (!kejSnap.empty) {
          const kej = kejSnap.docs.find(d => d.data().statusKejohanan === 'aktif') || kejSnap.docs[0]
          setKejohanan(kej.data())
          if (!bestKejId) setKejohananId(kej.id)
          if (bestKejId !== kej.id) {
            // Cuba juga load acara dari kejohanan aktif jika berbeza dari seed
            const altSnap = await getDocs(collection(db, 'kejohanan', kej.id, 'acara'))
            altSnap.docs.forEach(d => {
              if (!acaraDetails[d.id]) acaraDetails[d.id] = { acaraId: d.id, _kejId: kej.id, ...d.data() }
            })
          }
        }
      } catch {}

      if (bestKejId) {
        setKejohananId(bestKejId)
        loadMedalTally(bestKejId)
        loadRekodBaru(bestKejId)
      }

      // ── Langkah 3: Bina senarai item ──
      const seen   = new Set()
      const items  = []

      // Dari jadual_acara (sumber utama)
      Object.entries(jadualMap).forEach(([key, jd]) => {
        if (seen.has(key)) return
        seen.add(key)
        const acara = acaraDetails[key] || {
          acaraId: key, noAcara: key,
          namaAcara: '', namaAcaraPendek: '',
          jenisAcara: 'lorong', _kejId: jd.kejId,
        }
        items.push({ acara, masaMula: jd.masaMula || '', lokasi: jd.lokasi || '', tarikhAcara: jd.tarikhAcara })
      })

      // Dari acara subcollection (ada tarikhAcara embedded, tidak ada dalam jadual_acara)
      Object.values(acaraDetails).forEach(acara => {
        const key = acara.acaraId || acara.noAcara
        if (seen.has(key) || !acara.tarikhAcara) return
        seen.add(key)
        items.push({ acara, masaMula: acara.masa || '', lokasi: acara.lokasi || '', tarikhAcara: acara.tarikhAcara })
      })

      // ── Langkah 4: Kumpul mengikut tarikh & sort ──
      const byDay = {}
      items.forEach(item => {
        if (!item.tarikhAcara) return
        if (!byDay[item.tarikhAcara]) byDay[item.tarikhAcara] = []
        byDay[item.tarikhAcara].push(item)
      })
      Object.keys(byDay).forEach(date => {
        byDay[date].sort((a, b) => {
          const at = a.masaMula || '99:99', bt = b.masaMula || '99:99'
          if (at !== bt) return at.localeCompare(bt)
          return (Number(a.acara.noAcara) || 999) - (Number(b.acara.noAcara) || 999)
        })
      })

      const days = Object.keys(byDay).sort()
      setJadualByDay(byDay)
      setJadualDays(days)
      // Accordion default TUTUP — user klik untuk buka (dot biru tanda hari ini kekal)
      setExpandedDays(new Set())
    } catch (e) {
      console.error('loadJadualData:', e)
    } finally {
      setJadualLoading(false)
    }
  }

  async function loadMedalTally(kejId) {
    if (!kejId) return
    setMedalLoading(true)
    try {
      // 1. Load sekolah collection → nama + kategori (field: 'kategori' = SR/SM/PPKI)
      const sklSnap = await getDocs(collection(db, 'sekolah'))
      const sklInfo = {} // kodSekolah → { namaSekolah, jenisSekolah }
      sklSnap.docs.forEach(d => {
        const s = d.data()
        if (s.kodSekolah) sklInfo[s.kodSekolah] = {
          namaSekolah:  s.namaSekolah || s.kodSekolah,
          jenisSekolah: s.kategori || s.jenisSekolah || 'Lain-lain', // SekolahSetup guna 'kategori'
        }
      })

      // 2. Load medal_tally
      const tallySnap = await getDocs(query(collection(db, 'medal_tally'), where('kejohananId', '==', kejId)))
      const tallyMap = {}
      tallySnap.docs.forEach(d => { tallyMap[d.data().kodSekolah] = { id: d.id, ...d.data() } })

      // 3. Bina senarai sekolah dari collection('sekolah') terus — bukan pendaftaran
      //    Sekolah aktif terus muncul dalam tally walaupun tiada atlet daftar lagi
      const sekolahSet = {}
      Object.entries(sklInfo).forEach(([kod, info]) => {
        sekolahSet[kod] = {
          kodSekolah:   kod,
          namaSekolah:  info.namaSekolah,
          jenisSekolah: info.jenisSekolah,
        }
      })

      // 4. Gabung: semua sekolah + medal data (0 jika tiada medal lagi)
      const merged = Object.values(sekolahSet).map(s => ({
        emas: 0, perak: 0, gangsa: 0, tempat4: 0, tempat5: 0,
        ...s,
        ...(tallyMap[s.kodSekolah] || {}),
        // pastikan nama & jenis dari sekolah collection (lebih tepat)
        namaSekolah:  s.namaSekolah,
        jenisSekolah: s.jenisSekolah,
        kejohananId:  kejId,
      }))

      // 5. Sekolah dalam medal_tally tapi tiada dalam pendaftaran
      tallySnap.docs.forEach(d => {
        const data = d.data()
        if (!sekolahSet[data.kodSekolah]) {
          const info = sklInfo[data.kodSekolah] || {}
          merged.push({
            id: d.id, ...data,
            namaSekolah:  info.namaSekolah  || data.namaSekolah || data.kodSekolah,
            jenisSekolah: info.jenisSekolah || 'Lain-lain',
          })
        }
      })

      setMedalTally(merged)
    } catch { } finally { setMedalLoading(false) }
  }

  function buildKatDetailFromTally(kodSekolah) {
    // Baca terus dari medalTally state — data sudah ada, tiada query baru
    const tallyRow = medalTally.find(r => r.kodSekolah === kodSekolah)
    if (!tallyRow) return {}

    // Step 1: bina grp dari kat_ fields seperti biasa
    // Field format: kat_{kategoriKod}_{jantina}_{pingat}
    const grp = {}
    Object.entries(tallyRow).forEach(([key, val]) => {
      if (!key.startsWith('kat_') || typeof val !== 'number' || val === 0) return
      const parts = key.split('_') // ['kat', kategoriKod, jantina, pingat]
      if (parts.length < 4) return
      const kat    = parts[1]
      const jan    = parts[2]
      const pingat = parts[3]
      const grpKey = `${jan}_${kat}`
      if (!grp[grpKey]) grp[grpKey] = { kategoriKod: kat, jantina: jan, emas: 0, perak: 0, gangsa: 0, tempat4: 0, tempat5: 0 }
      if (pingat in grp[grpKey]) grp[grpKey][pingat] += val
    })

    // Step 2: scan contrib_ fields — kenalpasti relay entries
    // Relay: isRelay===true (data baru) ATAU noKP===null (data lama)
    // Pindah medal relay dari bucket individu ke bucket RELAY
    Object.entries(tallyRow).forEach(([key, val]) => {
      if (!key.startsWith('contrib_') || typeof val !== 'object' || !val || !val.pingat) return
      const isRelayEntry = val.isRelay === true || (val.isRelay === undefined && val.noKP === null)
      if (!isRelayEntry) return

      const kat    = val.kategoriKod || ''
      const jan    = val.jantina     || ''
      const pingat = val.pingat
      const srcKey = `${jan}_${kat}`
      const dstKey = `${jan}_RELAY`

      // Tolak 1 dari bucket individu (jika ada)
      if (grp[srcKey] && pingat in grp[srcKey]) {
        grp[srcKey][pingat] = Math.max(0, grp[srcKey][pingat] - 1)
      }
      // Tambah ke bucket RELAY
      if (!grp[dstKey]) grp[dstKey] = { kategoriKod: 'RELAY', jantina: jan, emas: 0, perak: 0, gangsa: 0, tempat4: 0, tempat5: 0 }
      if (pingat in grp[dstKey]) grp[dstKey][pingat] += 1
    })

    return grp
  }

  async function loadRekodBaru(kejId) {
    if (!kejId) return
    setRekodLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'rekod'), where('kejohananId', '==', kejId)))
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        // Hanya rekod utama (bukan salinan _tuntutan) supaya tiada duplikat
        .filter(r => (r.statusRekod === 'aktif' || r.statusRekod === 'tuntutan') && !r.rekodAsal)
        .sort((a, b) => (b.tarikhRekod || '').localeCompare(a.tarikhRekod || ''))
      setRekodBaru(list)
    } catch { } finally { setRekodLoading(false) }
  }

  async function loadRekodAll() {
    if (rekodAllLoaded) return
    setRekodAllLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'rekod'), where('statusRekod', '==', 'aktif')))
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r => !r.rekodAsal)
        .sort((a, b) => (a.acara || '').localeCompare(b.acara || ''))
      setRekodAll(list)
      setRekodAllLoaded(true)
      // Set default sub-tab to first groupKey (jantina_kategoriKod)
      const firstGroup = list
        .map(r => {
          const j = r.jantina?.trim().toUpperCase() || ''
          const k = r.kategoriKod?.trim().toUpperCase() || ''
          return j && k ? `${j}_${k}` : null
        })
        .find(Boolean)
      if (firstGroup && !activeKatRekod) setActiveKatRekod(firstGroup)
    } catch { } finally { setRekodAllLoading(false) }
  }

  async function loadHeatsForAcara(acara) {
    const aceraKey = acara.noAcara || acara.aceraId || acara.acaraId
    if (heatCache[aceraKey] !== undefined || heatLoading.has(aceraKey)) return
    setHeatLoading(prev => new Set([...prev, aceraKey]))
    const kId = acara._kejId || kejohananId
    if (!kId) {
      setHeatCache(prev => ({ ...prev, [aceraKey]: [] }))
      setHeatLoading(prev => { const n = new Set(prev); n.delete(aceraKey); return n })
      return
    }
    try {
      const [snap, rekod] = await Promise.all([
        getDocs(collection(db, 'kejohanan', kId, 'acara', aceraKey, 'heat')),
        cariRekodUntukAcara(acara).catch(() => ({ D: null, N: null, K: null })),
      ])
      const heats = snap.docs
        .map(d => ({ heatId: d.id, ...d.data() }))
        .sort((a, b) => (a.noHeat ?? 0) - (b.noHeat ?? 0))
      setHeatCache(prev => ({ ...prev, [aceraKey]: heats }))
      setRekodCache(prev => ({ ...prev, [aceraKey]: rekod }))
    } catch {
      setHeatCache(prev => ({ ...prev, [aceraKey]: [] }))
    } finally {
      setHeatLoading(prev => { const n = new Set(prev); n.delete(aceraKey); return n })
    }
  }

  function toggleAcara(acara) {
    const id = acara.acaraId || acara.noAcara
    setExpandedAcara(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        loadHeatsForAcara(acara)
      }
      return next
    })
  }

  const isToday    = d => d === new Date().toISOString().slice(0, 10)
  const activeRole = ROLES.find(r => r.id === selected)

  // ── Keputusan items (hoisted for print + display) ──────────────────────────
  const _allJadualItems = jadualDays.flatMap(d => jadualByDay[d] || [])
  const _kepAllItems = _allJadualItems
    .filter(item => {
      const s = item.acara.statusAcara
      return s === 'rasmi' || s === 'tidak_rasmi' || s === 'ada_keputusan'
    })
    .sort((a, b) => {
      if (a.tarikhAcara !== b.tarikhAcara) return (a.tarikhAcara || '').localeCompare(b.tarikhAcara || '')
      return (Number(a.acara.noAcara) || 0) - (Number(b.acara.noAcara) || 0)
    })
  const _kepFiltered = _kepAllItems.filter(item =>
    filterKombo === 'semua' || `${item.acara.jantina}_${item.acara.kategoriKod}` === filterKombo
  )

  // ── PDF: Jadual ───────────────────────────────────────────────────────────
  async function cetakJadualPDF() {
    if (!jadualDays.length) return
    setPrintingPdf(true)
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ])
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const namaKej = kejohanan?.namaKejohanan || 'Kejohanan Olahraga'
      const tarikhKej = kejohanan
        ? formatTarikh(kejohanan.tarikhMula, kejohanan.tarikhTamat)
        : ''

      // Title
      doc.setFontSize(15)
      doc.setFont(undefined, 'bold')
      doc.setTextColor(0, 51, 153)
      doc.text('JADUAL ACARA', 148, 14, { align: 'center' })
      doc.setFontSize(10)
      doc.setTextColor(30, 30, 30)
      doc.text(namaKej.toUpperCase(), 148, 21, { align: 'center' })
      if (tarikhKej) {
        doc.setFontSize(8)
        doc.setTextColor(120)
        doc.text(tarikhKej, 148, 27, { align: 'center' })
      }
      doc.setFontSize(7)
      doc.setTextColor(180)
      doc.text(`Dicetak: ${new Date().toLocaleString('ms-MY')}`, 14, 202)
      doc.setTextColor(0)

      let startY = 32
      let isFirst = true

      for (const date of jadualDays) {
        const items = jadualByDay[date] || []
        if (items.length === 0) continue

        if (!isFirst) {
          doc.addPage()
          startY = 14
        }
        isFirst = false

        // Day header
        autoTable(doc, {
          startY,
          head: [[{
            content: formatDayLabel(date).toUpperCase() + `  (${items.length} acara)`,
            colSpan: 7,
            styles: { halign: 'left', fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold', fontSize: 10 },
          }]],
          body: [],
          margin: { left: 14, right: 14 },
          styles: { cellPadding: { top: 4, bottom: 4, left: 5, right: 5 } },
          theme: 'plain',
        })

        autoTable(doc, {
          startY: doc.lastAutoTable.finalY,
          head: [['No', 'Masa', 'Nama Acara', 'Kelas', 'J', 'Peringkat', 'Lokasi']],
          body: items.map(item => [
            item.acara.noAcara || '—',
            item.masaMula || '—',
            item.acara.namaAcara || item.acara.namaAcaraPendek || '—',
            item.acara.kategoriKod || '—',
            item.acara.jantina || '—',
            item.acara.peringkat === 'saringan' ? 'Saringan'
              : item.acara.parentAcaraId ? 'Final'
              : item.acara.peringkat === 'akhir' ? 'Terus Final' : '—',
            item.lokasi || '—',
          ]),
          margin: { left: 14, right: 14 },
          headStyles: { fillColor: [230, 236, 255], textColor: [0, 51, 153], fontStyle: 'bold', fontSize: 8.5 },
          styles: { fontSize: 9, cellPadding: 2.5 },
          alternateRowStyles: { fillColor: [248, 250, 255] },
          columnStyles: {
            0: { cellWidth: 12, halign: 'center' },
            1: { cellWidth: 18, halign: 'center' },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 14, halign: 'center' },
            4: { cellWidth: 10, halign: 'center' },
            5: { cellWidth: 27, halign: 'center' },
            6: { cellWidth: 42 },
          },
        })
      }

      const safeName = namaKej.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 30)
      doc.save(`jadual-${safeName}.pdf`)
    } catch (e) {
      alert('Ralat menjana PDF: ' + e.message)
    } finally {
      setPrintingPdf(false)
    }
  }

  // ── PDF: Keputusan ────────────────────────────────────────────────────────
  async function cetakKeputusanPDF(items) {
    if (!items.length) return
    setPrintingPdf(true)
    try {
      // Load heats for any not yet in cache
      const localCache = { ...heatCache }
      const toFetch = items.filter(item => {
        const k = item.acara.noAcara || item.acara.aceraId || item.acara.acaraId
        return localCache[k] === undefined
      })
      if (toFetch.length > 0) {
        const results = await Promise.all(toFetch.map(async item => {
          const aceraKey = item.acara.noAcara || item.acara.aceraId || item.acara.acaraId
          const kId = item.acara._kejId || kejohananId
          if (!kId) return [aceraKey, []]
          try {
            const snap = await getDocs(collection(db, 'kejohanan', kId, 'acara', aceraKey, 'heat'))
            const heats = snap.docs.map(d => ({ heatId: d.id, ...d.data() }))
              .sort((a, b) => (a.noHeat ?? 0) - (b.noHeat ?? 0))
            return [aceraKey, heats]
          } catch { return [aceraKey, []] }
        }))
        results.forEach(([k, v]) => { localCache[k] = v })
        setHeatCache(prev => ({ ...prev, ...localCache }))
      }

      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ])
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const namaKej = kejohanan?.namaKejohanan || 'Kejohanan Olahraga'

      // Title page header
      doc.setFontSize(15)
      doc.setFont(undefined, 'bold')
      doc.setTextColor(0, 51, 153)
      doc.text('KEPUTUSAN ACARA', 105, 14, { align: 'center' })
      doc.setFontSize(10)
      doc.setTextColor(30, 30, 30)
      doc.text(namaKej.toUpperCase(), 105, 21, { align: 'center' })
      doc.setFontSize(7)
      doc.setTextColor(180)
      doc.text(`Dicetak: ${new Date().toLocaleString('ms-MY')}`, 14, 27)
      doc.setTextColor(0)

      const FASA_FINAL = ['final', 'terus_final']
      let isFirstAcara = true

      for (const item of items) {
        const aceraKey = item.acara.noAcara || item.acara.aceraId || item.acara.acaraId
        const heats = localCache[aceraKey] || []
        const isPadang = ['padang_lompat', 'padang_balin'].includes(item.acara.jenisAcara)
        const isRelay  = item.acara.jenisAcara === 'relay'

        const heatsWithResult = heats.filter(h =>
          ['rasmi', 'tidak_rasmi', 'diterima'].includes(h.statusKeputusan)
        )
        if (heatsWithResult.length === 0) continue

        const finalHeats   = heatsWithResult.filter(h =>
          FASA_FINAL.includes(h.fasa) || h.peringkat === 'final' || heats.length === 1
        )
        const displayHeats = finalHeats.length > 0 ? finalHeats : heatsWithResult
        const isRasmi      = displayHeats.some(h => h.statusKeputusan === 'rasmi')

        const allPeserta = []
        displayHeats.forEach(heat => {
          ;(heat.peserta || []).forEach(p => { allPeserta.push({ ...p }) })
        })
        allPeserta.sort((a, b) => {
          const ar = a.kedudukan || a.rankDalamHeat
          const br = b.kedudukan || b.rankDalamHeat
          if (ar && br) return ar - br
          if (ar) return -1
          if (br) return 1
          const av = Number(a.keputusan) || 0, bv = Number(b.keputusan) || 0
          if (!av && !bv) return 0
          if (!av) return 1
          if (!bv) return -1
          return isPadang ? bv - av : av - bv
        })
        if (allPeserta.length === 0) continue

        const startY = isFirstAcara ? 32 : undefined
        isFirstAcara = false

        const jantinaLabel = item.acara.jantina === 'L' ? 'Lelaki' : 'Perempuan'
        const statusLabel  = isRasmi ? '✓ RASMI' : '⏳ SEMENTARA'
        const acaraHdr = `${item.acara.noAcara || ''} | ${item.acara.namaAcara || '—'}  —  Kat ${item.acara.kategoriKod || '?'} ${jantinaLabel}  |  ${statusLabel}`

        const colLabel = isPadang ? 'Jarak' : 'Masa'
        const headCols = isRelay
          ? ['#', 'Pasukan / Sekolah', colLabel]
          : ['#', 'BIB', 'Nama Atlet', 'Sekolah', colLabel]

        const body = allPeserta.map((p, idx) => {
          const kddk  = p.kedudukan || p.rankDalamHeat || (idx + 1)
          const namaSkl = (p.kodSekolah && (sekolahMap[p.kodSekolah] || p.kodSekolah)) || p.kodSekolah || '—'
          const hasil = isPadang ? fmtJarak(p.keputusan) : fmtMasa(p.keputusan)
          const flagged = ['DNS', 'DNF', 'DQ'].includes(p.status)
          if (isRelay) return [kddk, namaSkl, flagged ? p.status : (hasil || '—')]
          return [kddk, p.noBib || '—', p.namaAtlet || '—', namaSkl, flagged ? p.status : (hasil || '—')]
        })

        const colCount = isRelay ? 3 : 5
        autoTable(doc, {
          startY,
          head: [
            [{ content: acaraHdr, colSpan: colCount, styles: {
              halign: 'left',
              fillColor: isRasmi ? [0, 100, 60] : [160, 100, 0],
              textColor: 255,
              fontStyle: 'bold',
              fontSize: 8.5,
            }}],
            headCols,
          ],
          body,
          margin: { left: 14, right: 14 },
          headStyles: { fillColor: [230, 236, 255], textColor: [0, 51, 153], fontStyle: 'bold', fontSize: 8 },
          styles: { fontSize: 9, cellPadding: 2.5 },
          alternateRowStyles: { fillColor: [248, 250, 255] },
          columnStyles: {
            0: { cellWidth: 10, halign: 'center' },
            ...(isRelay ? {} : { 1: { cellWidth: 18, halign: 'center' } }),
          },
        })
      }

      if (isFirstAcara) {
        // No acara had results — nothing generated
        alert('Tiada keputusan untuk dicetak.')
        return
      }

      const safeName = namaKej.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 30)
      doc.save(`keputusan-${safeName}.pdf`)
    } catch (e) {
      alert('Ralat menjana PDF: ' + e.message)
    } finally {
      setPrintingPdf(false)
    }
  }

  function toggleDay(date) {
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Header ── */}
      <header style={{ backgroundColor: cfg.warnaTema }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* Logo kiri */}
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
            {cfg.logoKiriBase64
              ? <img src={cfg.logoKiriBase64} className="w-full h-full object-contain" alt="logo" />
              : <span className="font-black text-[9px]" style={{ color: cfg.warnaTema }}>{cfg.logoKiriTeks}</span>}
          </div>

          {/* Tajuk tengah */}
          <div className="flex-1 text-center min-w-0">
            <p className="text-[9px] text-white/40 uppercase tracking-[0.2em] truncate">{cfg.namaAgensi}</p>
            <p className="text-sm font-black text-white tracking-[0.12em] mt-0.5 truncate">{cfg.namaSistem}</p>
          </div>

          {/* Logo kanan */}
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
            {cfg.logoKananBase64
              ? <img src={cfg.logoKananBase64} className="w-full h-full object-contain" alt="logo" />
              : <span className="font-black text-[9px]" style={{ color: cfg.warnaTema }}>{cfg.logoKananTeks}</span>}
          </div>

          {/* Admin — gear icon, dalam flex row supaya tidak tertindih logo pada mobile */}
          <button
            onClick={() => setAdminModal(true)}
            title="Pentadbir"
            aria-label="Log masuk pentadbir"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/35 hover:text-white/80 transition-all duration-200 shrink-0 active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Jalur */}
      <div className="h-[3px] bg-gradient-to-r from-[#cc0001] via-[#ffda00] to-[#cc0001]" />

      {/* ── Hero ── */}
      <section className="py-8 px-5 text-center" style={{ backgroundColor: cfg.warnaHero }}>
        {cfg.logoPenganjurBase64 && (
          <div className="flex justify-center mb-3">
            <img src={cfg.logoPenganjurBase64} alt="penganjur" className="h-9 object-contain opacity-90" />
          </div>
        )}
        {cfg.logoKejohananBase64 && (
          <div className="flex justify-center mb-4">
            <img src={cfg.logoKejohananBase64} alt="kejohanan" className="h-20 sm:h-28 object-contain drop-shadow-lg" />
          </div>
        )}
        <p className="text-[10px] text-white/30 uppercase tracking-[0.25em] mb-2">{cfg.namaOrganisasi}</p>

        <div className="space-y-2">
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-wide leading-tight px-2">
            {cfg.tajukUtama}
          </h1>
          {cfg.tajukKecil && !kejohanan && (
            <p className="text-xl font-light text-white/60">{cfg.tajukKecil}</p>
          )}
          {kejohanan && (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
              {kejohanan.tarikhMula && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/80 text-xs">
                  📅 {formatTarikh(kejohanan.tarikhMula, kejohanan.tarikhTamat)}
                </span>
              )}
              {kejohanan.lokasi && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white/80 text-xs">
                  📍 {kejohanan.lokasi}
                </span>
              )}
            </div>
          )}
          {cfg.namaPenganjur && <p className="text-[10px] text-white/30 mt-1">{cfg.namaPenganjur}</p>}
        </div>

        <div className="flex items-center justify-center gap-3 mt-5">
          <div className="h-px w-16 bg-white/15" />
          <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
          <div className="h-px w-16 bg-white/15" />
        </div>
      </section>

      {/* ── Pengumuman ── */}
      {cfg.isPengumumanAktif && cfg.pengumuman && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-5 py-3 text-center">
          <p className="text-xs text-yellow-800 font-medium">📢 {cfg.pengumuman}</p>
        </div>
      )}

      {/* ── Role Selector ── */}
      <section className="py-8 px-5 bg-white border-b border-gray-100">
        <div className="max-w-xl mx-auto">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-5 text-center">Log Masuk</p>
          <div className="grid grid-cols-3 gap-3">
            {ROLES.map(role => {
              const isActive = selected === role.id
              return (
                <button key={role.id}
                  onClick={() => setSelected(prev => prev === role.id ? null : role.id)}
                  className={`flex flex-col items-center gap-2.5 py-5 px-3 rounded-2xl border-2 transition-all duration-200 ${
                    isActive
                      ? 'border-transparent bg-[#003399] text-white shadow-lg shadow-[#003399]/20 scale-[1.02]'
                      : 'border-gray-100 bg-white text-gray-500 hover:border-gray-200 hover:shadow-sm'
                  }`}>
                  <span className={`w-12 h-12 rounded-xl flex items-center justify-center text-white ${
                    isActive ? 'bg-white/20' : role.iconBg + ' shadow-sm'
                  }`}>
                    {role.icon}
                  </span>
                  <div className="text-center">
                    <p className={`text-[10px] font-bold tracking-wide uppercase ${isActive ? 'text-white' : 'text-gray-700'}`}>
                      {role.label}
                    </p>
                    <p className={`text-[9px] mt-0.5 ${isActive ? 'text-white/70' : 'text-gray-400'}`}>{role.desc}</p>
                  </div>
                </button>
              )
            })}
          </div>
          {activeRole && <LoginForm role={activeRole} onCancel={() => setSelected(null)} cfg={cfg} />}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          JADUAL & KEPUTUSAN — Pusat Maklumat Awam
      ═══════════════════════════════════════════════════════ */}
      {cfg.showJadual !== false && (
        <section className="flex-1 py-6 px-3 bg-gray-50">
          <div className="max-w-4xl mx-auto">

            {/* Section header + Tab toggle */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Program Kejohanan</p>
                <h2 className="text-base font-black text-gray-800 leading-tight">Jadual &amp; Keputusan</h2>
              </div>
              <div className="flex items-center gap-2">
                {/* Cetak PDF — Jadual */}
                {activeTab === 'jadual' && jadualDays.length > 0 && !jadualLoading && (
                  <button onClick={cetakJadualPDF} disabled={printingPdf}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-[#003399] bg-white border border-[#003399]/25 rounded-xl hover:bg-blue-50 transition-all disabled:opacity-50 shadow-sm"
                    title="Cetak Jadual sebagai PDF">
                    {printingPdf ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Menjana…
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Cetak PDF
                      </>
                    )}
                  </button>
                )}
                {/* Cetak PDF — Keputusan */}
                {activeTab === 'keputusan' && _kepFiltered.length > 0 && !jadualLoading && (
                  <button onClick={() => cetakKeputusanPDF(_kepFiltered)} disabled={printingPdf}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold text-[#003399] bg-white border border-[#003399]/25 rounded-xl hover:bg-blue-50 transition-all disabled:opacity-50 shadow-sm"
                    title="Cetak Keputusan sebagai PDF">
                    {printingPdf ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Menjana…
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Cetak PDF
                        {filterKombo !== 'semua' && (
                          <span className="opacity-60">({_kepFiltered.length})</span>
                        )}
                      </>
                    )}
                  </button>
                )}
                {/* Refresh */}
                <button onClick={loadJadualData} disabled={jadualLoading}
                  className="p-2 text-gray-400 hover:text-[#003399] hover:bg-white rounded-xl transition-all disabled:opacity-50"
                  title="Muat semula">
                  <svg className={`w-4 h-4 ${jadualLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tab Pills */}
            <div className="flex gap-1.5 mb-4 bg-gray-100 p-1 rounded-xl w-fit">
              {[
                { id: 'jadual',    label: 'Jadual' },
                { id: 'keputusan', label: 'Keputusan' },
                { id: 'rekod',     label: 'Rekod Kejohanan' },
              ].map(t => (
                <button key={t.id} onClick={() => {
                  setActiveTab(t.id)
                  if (t.id === 'rekod') loadRekodAll()
                }}
                  className={`px-5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeTab === t.id
                      ? 'bg-[#003399] text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Tab: Jadual ── */}
            {activeTab === 'jadual' && (
              jadualLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-8 h-8 border-[3px] border-[#003399] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-gray-400">Memuatkan jadual…</p>
                </div>
              ) : jadualDays.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 py-12 text-center shadow-sm">
                  <p className="text-3xl mb-3">📋</p>
                  <p className="text-sm font-semibold text-gray-500">Tiada jadual ditetapkan.</p>
                  <p className="text-xs text-gray-400 mt-1">Hubungi Admin untuk set jadual acara.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {jadualDays.map(date => {
                    const isOpen    = expandedDays.has(date)
                    const items     = jadualByDay[date] || []
                    const todayDate = isToday(date)
                    return (
                      <div key={date} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                        <button
                          onClick={() => toggleDay(date)}
                          className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${
                            isOpen ? 'bg-[#003399]' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {todayDate && !isOpen && (
                              <span className="w-2 h-2 rounded-full bg-[#003399] shrink-0" />
                            )}
                            <div className="text-left">
                              <p className={`text-xs font-black ${isOpen ? 'text-white' : todayDate ? 'text-[#003399]' : 'text-gray-800'}`}>
                                {formatDayLabel(date)}
                                {todayDate && (
                                  <span className={`ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isOpen ? 'bg-white/20 text-white' : 'bg-[#003399]/10 text-[#003399]'}`}>
                                    HARI INI
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[10px] font-semibold ${isOpen ? 'text-blue-200' : 'text-gray-400'}`}>
                              {items.length} acara
                            </span>
                            <svg
                              className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180 text-white' : 'text-gray-400'}`}
                              fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>
                        {isOpen && (
                          <div className="overflow-x-auto border-t border-gray-100">
                            <table className="w-full">
                              <thead>
                                <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-200">
                                  <th className="hidden sm:table-cell px-2 py-2 text-center w-10">No</th>
                                  <th className="px-2 py-2 text-center w-12">Masa</th>
                                  <th className="px-3 py-2 text-left">Nama Acara</th>
                                  <th className="px-2 py-2 text-center w-14">Kelas</th>
                                  <th className="hidden sm:table-cell px-2 py-2 text-center w-20">Peringkat</th>
                                  <th className="hidden sm:table-cell px-3 py-2 text-left">Catatan</th>
                                  <th className="w-7" />
                                </tr>
                              </thead>
                              <tbody>
                                {items.map((item, i) => {
                                  const aceraKey = item.acara.noAcara || item.acara.aceraId || item.acara.acaraId
                                  const rowKey   = aceraKey + '_' + i
                                  const expKey   = item.acara.acaraId || aceraKey
                                  return (
                                    <AcaraTableRow
                                      key={rowKey}
                                      item={item}
                                      isExpanded={expandedAcara.has(expKey)}
                                      onToggle={() => toggleAcara(item.acara)}
                                      heats={heatCache[aceraKey]}
                                      isLoading={heatLoading.has(aceraKey)}
                                      sekolahMap={sekolahMap}
                                      finalSetup={finalSetup}
                                      rekodDNK={rekodCache[aceraKey]}
                                    />
                                  )
                                })}
                              </tbody>
                            </table>
                            <p className="text-center text-[10px] text-gray-300 py-2 border-t border-gray-50">
                              {items.length} acara · Klik baris untuk lihat keputusan
                            </p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            )}

            {/* ── Tab: Keputusan ── */}
            {activeTab === 'keputusan' && (() => {
              // Use hoisted _kepAllItems and _kepFiltered (computed before return)
              const keputusanItems = _kepAllItems
              const filtered = _kepFiltered

              // ── Bina senarai filter kombo (jantina+kategori) dari data sebenar ──
              function komboKey(j, k) { return `${j}_${k}` }
              function komboLabel(j, k) {
                if (k === 'PPKI') return `PPKI-${j}`
                const umur = kategoriMap[k]?.umurHad
                return umur ? `${j}${umur}` : `${j}-${k}`
              }

              const seenKombo = new Set()
              keputusanItems.forEach(item => {
                const j = item.acara.jantina, k = item.acara.kategoriKod
                if (j && k) seenKombo.add(komboKey(j, k))
              })

              const komboList = [...seenKombo].sort((a, b) => {
                const [ja, ka] = a.split('_')
                const [jb, kb] = b.split('_')
                if (ka === 'PPKI' && kb !== 'PPKI') return 1
                if (kb === 'PPKI' && ka !== 'PPKI') return -1
                const ua = kategoriMap[ka]?.umurHad ?? 99
                const ub = kategoriMap[kb]?.umurHad ?? 99
                if (ua !== ub) return ua - ub
                return ja.localeCompare(jb)
              })

              function komboCls(key, active) {
                const j = key.split('_')[0]
                const k = key.split('_')[1]
                if (!active) return 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                if (k === 'PPKI') return 'bg-purple-600 text-white border-purple-600'
                if (j === 'L')    return 'bg-blue-600 text-white border-blue-600'
                return 'bg-rose-500 text-white border-rose-500'
              }

              return (
                <div>
                  {/* Filter Kombo — 1 baris, bergantian L-P */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <button
                      onClick={() => setFilterKombo('semua')}
                      className={`px-3 py-1 text-[10px] font-bold rounded-lg border transition-colors ${
                        filterKombo === 'semua'
                          ? 'bg-gray-700 text-white border-gray-700'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                      }`}>
                      Semua
                    </button>
                    {komboList.map(key => (
                      <button key={key}
                        onClick={() => setFilterKombo(prev => prev === key ? 'semua' : key)}
                        className={`px-3 py-1 text-[10px] font-bold rounded-lg border transition-colors ${komboCls(key, filterKombo === key)}`}>
                        {komboLabel(...key.split('_'))}
                      </button>
                    ))}
                  </div>

                  {/* Senarai keputusan */}
                  {jadualLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <div className="w-8 h-8 border-[3px] border-[#003399] border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-gray-400">Memuatkan…</p>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-100 py-12 text-center shadow-sm">
                      <p className="text-3xl mb-3">🏁</p>
                      <p className="text-sm font-semibold text-gray-500">
                        {keputusanItems.length === 0 ? 'Tiada keputusan tersedia.' : 'Tiada keputusan untuk pilihan ini.'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {keputusanItems.length === 0 ? 'Keputusan akan dipapar selepas acara selesai.' : 'Cuba tukar penapis kategori atau jantina.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filtered.map((item, i) => {
                        const aceraKey = item.acara.noAcara || item.acara.aceraId || item.acara.acaraId
                        const expKey   = item.acara.acaraId || aceraKey
                        const isExp    = expandedAcara.has(expKey)
                        return (
                          <div key={aceraKey + '_kep_' + i} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                            <button
                              onClick={() => toggleAcara(item.acara)}
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/60 transition-colors text-left"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-gray-800 truncate">
                                  {item.acara.namaAcara || item.acara.namaAcaraPendek || '—'}
                                </p>
                                <p className="text-[10px] text-gray-400 mt-0.5">
                                  {item.acara.kelas || '—'} · {formatDayLabel(item.tarikhAcara)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                {(() => {
                                  const isSar = item.acara.peringkat === 'saringan'
                                  const isFin = !isSar && item.acara.parentAcaraId
                                  if (isSar) return (
                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                                      Saringan
                                    </span>
                                  )
                                  if (isFin) return (
                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">
                                      Final
                                    </span>
                                  )
                                  return null
                                })()}
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                                  KEPUTUSAN
                                </span>
                                <svg
                                  className={`w-3.5 h-3.5 text-gray-300 transition-transform duration-150 ${isExp ? 'rotate-180' : ''}`}
                                  fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                              </div>
                            </button>
                            {isExp && (
                              <div className="border-t border-gray-100">
                                <KeputusanExpanded
                                  heats={heatCache[aceraKey]}
                                  acara={item.acara}
                                  sekolahMap={sekolahMap}
                                  isLoading={heatLoading.has(aceraKey)}
                                  finalSetup={finalSetup}
                                  rekodDNK={rekodCache[aceraKey]}
                                />
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <p className="text-center text-[10px] text-gray-300 py-2">
                        {filtered.length} keputusan · Klik untuk lihat keputusan
                      </p>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ── Tab: Rekod Kejohanan ── */}
            {activeTab === 'rekod' && (() => {
              const PERINGKAT_LIST = [
                { id: 'D', label: 'Daerah' },
                { id: 'N', label: 'Negeri' },
                { id: 'K', label: 'Kebangsaan' },
              ]
              const LOKASI_LABEL = { D: 'Sekolah', N: 'Daerah', K: 'Negeri' }

              // Rekod untuk peringkat aktif sahaja
              const rekodByPeringkat = rekodAll.filter(r =>
                r.peringkat?.trim().toUpperCase() === activePeringkatRekod
              )

              // Group key = jantina_kategoriKod, tapis ikut peringkat aktif
              const groupKeys = [...new Set(
                rekodByPeringkat.map(r => {
                  const j = r.jantina?.trim().toUpperCase() || ''
                  const k = r.kategoriKod?.trim().toUpperCase() || ''
                  return j && k ? `${j}_${k}` : null
                }).filter(Boolean)
              )].sort((a, b) => {
                const [, ka] = a.split('_')
                const [, kb] = b.split('_')
                const ua = kategoriMap[ka]?.umurHad ?? 99
                const ub = kategoriMap[kb]?.umurHad ?? 99
                if (ua !== ub) return ua - ub
                return a.localeCompare(b)
              })

              const activeKat = (groupKeys.includes(activeKatRekod) ? activeKatRekod : groupKeys[0]) || ''
              const [activeJ, activeK] = activeKat.split('_')
              const rows = rekodByPeringkat
                .filter(r =>
                  r.jantina?.trim().toUpperCase() === activeJ &&
                  r.kategoriKod?.trim().toUpperCase() === activeK
                )
                .sort((a, b) => (a.namaAcara || '').localeCompare(b.namaAcara || ''))

              const lokasiHeader = LOKASI_LABEL[activePeringkatRekod] || 'Lokasi'

              return (
                <div>
                  {rekodAllLoading ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <div className="w-8 h-8 border-[3px] border-[#003399] border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-gray-400">Memuatkan rekod…</p>
                    </div>
                  ) : (
                    <>
                      {/* Filter 1 — Peringkat */}
                      <div className="flex gap-1.5 mb-3 bg-gray-100 p-1 rounded-xl w-fit">
                        {PERINGKAT_LIST.map(p => (
                          <button key={p.id}
                            onClick={() => {
                              setActivePeringkatRekod(p.id)
                              setActiveKatRekod('')
                            }}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              activePeringkatRekod === p.id
                                ? 'bg-[#003399] text-white shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                            }`}>
                            {p.label}
                          </button>
                        ))}
                      </div>

                      {/* Filter 2 — Kategori (L12/P12) */}
                      {groupKeys.length > 0 && (
                        <div className="flex gap-1.5 mb-3 flex-wrap">
                          {groupKeys.map(gk => {
                            const [j, k] = gk.split('_')
                            const umur = kategoriMap[k]?.umurHad
                            const label = umur ? `${j}${umur}` : `${j}${k}`
                            return (
                              <button key={gk}
                                onClick={() => setActiveKatRekod(gk)}
                                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all border ${
                                  activeKat === gk
                                    ? 'bg-[#003399] text-white border-[#003399]'
                                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                                }`}>
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {/* Rekod table */}
                      {rows.length > 0 && (
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                          <table className="w-full text-xs min-w-[320px]">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-100">
                                <th className="hidden sm:table-cell text-left px-3 py-2 font-semibold text-gray-500 w-6">#</th>
                                <th className="text-left px-3 py-2 font-semibold text-gray-500">Acara</th>
                                <th className="text-left px-3 py-2 font-semibold text-gray-500">Catatan</th>
                                <th className="text-left px-3 py-2 font-semibold text-gray-500">Nama Atlet</th>
                                <th className="hidden sm:table-cell text-left px-3 py-2 font-semibold text-gray-500">{lokasiHeader}</th>
                                <th className="text-left px-2 py-2 font-semibold text-gray-500">Thn</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r, i) => {
                                const lokasi = r.peringkat === 'D'
                                  ? (r.namaSekolah || r.kodSekolah || '—')
                                  : r.peringkat === 'N'
                                    ? (r.namaDaerah || '—')
                                    : (r.namaNegeri || '—')
                                return (
                                  <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                    <td className="hidden sm:table-cell px-3 py-2 text-gray-300">{i + 1}</td>
                                    <td className="px-3 py-2 font-medium text-gray-700 max-w-[100px] sm:max-w-none">
                                      <p className="truncate">{r.namaAcara || '—'}</p>
                                    </td>
                                    <td className="px-3 py-2 font-black text-[#003399] whitespace-nowrap">{formatPrestasiRekod(r.prestasi, r.unit)}</td>
                                    <td className="px-3 py-2 text-gray-700 max-w-[90px] sm:max-w-none">
                                      <p className="truncate">{r.namaAtlet || '—'}</p>
                                      <p className="sm:hidden text-[9px] text-gray-400 truncate">{lokasi}</p>
                                    </td>
                                    <td className="hidden sm:table-cell px-3 py-2 text-gray-500">{lokasi}</td>
                                    <td className="px-2 py-2 text-gray-400 text-[11px] whitespace-nowrap">{tahunRekod(r.tarikhRekod)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })()}
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════
          KEDUDUKAN PINGAT — Always Show
      ═══════════════════════════════════════════════════════ */}
      {cfg.showMedalHome !== false && (() => {
        const kdMax   = cfg.medalHomeKedudukan ?? 3
        const isPisah = (cfg.medalHomeGroupJenis ?? 'pisah') === 'pisah'

        // Dinamik — susun ikut urutan dari jenisMap, jenis baru ke belakang
        const allJenisInMap = Object.keys(jenisMap)
        const getJenisHdr = (jenis) => {
          const warna = jenisMap[jenis]?.warna || '#6b7280'
          return { open: '', closed: '', warna }
        }
        const RANK_STYLE = {
          1: { row: 'bg-yellow-50/60 border-l-4 border-l-yellow-400', badge: 'bg-yellow-400 text-white' },
          2: { row: 'bg-gray-50/60  border-l-4 border-l-gray-300',   badge: 'bg-gray-300  text-white' },
          3: { row: 'bg-orange-50/60 border-l-4 border-l-orange-300', badge: 'bg-orange-300 text-white' },
        }
        const extraCols = kdMax >= 5
          ? [{ key: 'tempat4', label: '4' }, { key: 'tempat5', label: '5' }]
          : kdMax >= 4 ? [{ key: 'tempat4', label: '4' }] : []
        const showJumlahCol = kejohanan?.showJumlahMedalTally ?? false

        // Olympic sort per kumpulan — E→P→G→T4→T5→nama abjad
        function sortAndRank(rows) {
          const s = [...rows].sort((a, b) => {
            if ((b.emas||0)    !== (a.emas||0))    return (b.emas||0)    - (a.emas||0)
            if ((b.perak||0)   !== (a.perak||0))   return (b.perak||0)   - (a.perak||0)
            if ((b.gangsa||0)  !== (a.gangsa||0))  return (b.gangsa||0)  - (a.gangsa||0)
            if ((b.tempat4||0) !== (a.tempat4||0)) return (b.tempat4||0) - (a.tempat4||0)
            if ((b.tempat5||0) !== (a.tempat5||0)) return (b.tempat5||0) - (a.tempat5||0)
            return (a.namaSekolah||'').localeCompare(b.namaSekolah||'', 'ms')
          })
          return s.map((item, i, arr) => {
            if (i === 0) return { ...item, rank: 1 }
            const prev = arr[i - 1]
            const tie = ['emas','perak','gangsa','tempat4','tempat5'].every(k => (item[k]||0) === (prev[k]||0))
            return { ...item, rank: tie ? arr[i-1].rank : i + 1 }
          })
        }

        // Bina kumpulan dinamik — susun ikut urutan jenisMap, yang tiada dalam map ke belakang
        const allJenis = [...new Set(medalTally.map(r => r.jenisSekolah || 'Lain-lain'))]
        const jenisKeys = isPisah
          ? [...allJenisInMap.filter(j => allJenis.includes(j)), ...allJenis.filter(j => !allJenisInMap.includes(j)).sort()]
          : ['Semua']
        const groups = isPisah
          ? jenisKeys.reduce((acc, j) => { acc[j] = sortAndRank(medalTally.filter(r => (r.jenisSekolah||'Lain-lain') === j)); return acc }, {})
          : { Semua: sortAndRank(medalTally) }

        return (
          <section className="py-6 px-3 bg-gray-50 border-t border-gray-100">
            <div className="max-w-4xl mx-auto">

              {/* Header — sama gaya Jadual & Keputusan */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Penjuaian</p>
                  <h2 className="text-base font-black text-gray-800 leading-tight">Kedudukan Pingat</h2>
                </div>
                <button onClick={() => loadMedalTally(kejohananId)} disabled={medalLoading}
                  className="p-2 text-gray-400 hover:text-[#003399] hover:bg-white rounded-xl transition-all disabled:opacity-50"
                  title="Muat semula">
                  <svg className={`w-4 h-4 ${medalLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              {medalLoading ? (
                <div className="flex items-center justify-center py-12 gap-3">
                  <div className="w-6 h-6 border-2 border-[#003399] border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-gray-400">Memuatkan kedudukan…</p>
                </div>
              ) : medalTally.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-100 py-12 text-center shadow-sm">
                  <p className="text-3xl mb-3">🏆</p>
                  <p className="text-sm font-semibold text-gray-500">Tiada sekolah berdaftar.</p>
                  <p className="text-xs text-gray-400 mt-1">Senarai akan dipapar setelah pendaftaran dibuka.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {jenisKeys.map(jenis => {
                    const rows = groups[jenis] || []
                    if (rows.length === 0) return null
                    const hdr      = getJenisHdr(jenis)
                    const label    = isPisah ? (jenisMap[jenis]?.nama || jenis) : 'Kedudukan Pingat'
                    const isOpen   = expandedMedalGroups.has(jenis)
                    const hasAnyMedal = rows.some(r => (r.emas||0) + (r.perak||0) + (r.gangsa||0) > 0)
                    const top3     = rows.filter(r => r.rank <= 3)

                    return (
                      <div key={jenis} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                        {/* Accordion header — klik untuk buka/tutup */}
                        <button
                          onClick={() => setExpandedMedalGroups(prev => {
                            const next = new Set(prev)
                            if (next.has(jenis)) next.delete(jenis)
                            else next.add(jenis)
                            return next
                          })}
                          className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:opacity-90"
                          style={isOpen ? { backgroundColor: hdr.warna } : {}}
                        >
                          <div className="flex items-center gap-2.5">
                            {!isOpen && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hdr.warna }} />}
                            <div className="text-left">
                              <p className="text-xs font-black" style={{ color: isOpen ? '#fff' : hdr.warna }}>{label}</p>
                              {!isOpen && (
                                <p className="text-[9px] text-gray-400 mt-0.5">
                                  {rows.length} sekolah
                                  {hasAnyMedal && top3.length > 0 && (
                                    <span className="ml-1.5">
                                      · {top3[0]?.namaSekolah?.split(' ').slice(0,2).join(' ')} {top3[0]?.emas > 0 ? `🥇${top3[0].emas}` : ''}
                                    </span>
                                  )}
                                  {!hasAnyMedal && <span className="ml-1 text-gray-300">· Belum ada pingat</span>}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isOpen && <span className="text-[10px] font-semibold text-white/70">{rows.length} sekolah</span>}
                            <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180 text-white' : 'text-gray-400'}`}
                              fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>

                        {/* Table — hanya papar bila open */}
                        {isOpen && <div className="overflow-x-auto border-t border-gray-100">
                          <table className="w-full">
                            <thead>
                              <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-200">
                                <th className="hidden sm:table-cell px-3 py-2.5 text-center w-10">No.</th>
                                <th className="px-2 sm:px-3 py-2.5 text-left">Nama Sekolah</th>
                                <th className="px-1 sm:px-2 py-2.5 text-center w-8 sm:w-10" title="Emas">
                                  <span className="inline-block w-3.5 h-3.5 rounded-full bg-yellow-400 border border-yellow-500" />
                                </th>
                                <th className="px-1 sm:px-2 py-2.5 text-center w-8 sm:w-10" title="Perak">
                                  <span className="inline-block w-3.5 h-3.5 rounded-full bg-gray-300 border border-gray-400" />
                                </th>
                                <th className="px-1 sm:px-2 py-2.5 text-center w-8 sm:w-10" title="Gangsa">
                                  <span className="inline-block w-3.5 h-3.5 rounded-full bg-orange-300 border border-orange-400" />
                                </th>
                                {extraCols.map(c => (
                                  <th key={c.key} className="px-1 sm:px-2 py-2.5 text-center w-7 sm:w-8 text-gray-300 font-bold">{c.label}</th>
                                ))}
                                {showJumlahCol && <th className="px-2 sm:px-3 py-2.5 text-center w-10 sm:w-12">Jum</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((t, i) => {
                                const rs       = RANK_STYLE[t.rank] || {}
                                const isTop3   = t.rank <= 3
                                const jumlah   = (t.emas||0) + (t.perak||0) + (t.gangsa||0)
                                const isKatExp = expandedKatRows.has(t.kodSekolah)
                                const detail   = isKatExp ? { rows: buildKatDetailFromTally(t.kodSekolah) } : null
                                const totalCols = 5 + extraCols.length + (showJumlahCol ? 1 : 0) // No+Nama+E+P+G+extra+Jum

                                // Kategori × jantina — ikut jenisSekolah sekolah ini sahaja
                                // Deduplicate: pelbagai kod dengan umurHad sama → satu row sahaja
                                const katKombos = (() => {
                                  // Kumpul semua kod milik jenisSekolah ini, sorted by umurHad
                                  const filtered = Object.entries(kategoriMap)
                                    .filter(([, info]) => info.jenisSekolah === (t.jenisSekolah || 'SR'))
                                    .sort((a, b) => (a[1].umurHad ?? 99) - (b[1].umurHad ?? 99))
                                  // Deduplicate by umurHad: satu label per umur per jantina
                                  // Simpan list of kods untuk matching dalam detail rows
                                  const seen = new Set()
                                  const out = []
                                  filtered.forEach(([kod, info]) => {
                                    const umur  = info.umurHad || kod
                                    ;['L', 'P'].forEach(j => {
                                      const dedupeKey = `${j}_${umur}`
                                      if (!seen.has(dedupeKey)) {
                                        seen.add(dedupeKey)
                                        out.push({ umur, j, label: `${j}${umur}` })
                                      }
                                    })
                                  })
                                  return out
                                })()

                                return (
                                  <>
                                  <tr key={t.id || i} className={`border-b border-gray-50 ${rs.row || 'hover:bg-gray-50/50'}`}>
                                    <td className="hidden sm:table-cell px-3 py-3 text-center">
                                      {isTop3
                                        ? <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-black ${rs.badge}`}>{t.rank}</span>
                                        : <span className="text-[10px] font-bold text-gray-400">{t.rank}</span>
                                      }
                                    </td>
                                    <td className="px-2 sm:px-3 py-3">
                                      {/* Klik nama → expand kategori */}
                                      <button
                                        className="text-left w-full"
                                        onClick={() => {
                                          setExpandedKatRows(prev => {
                                            const next = new Set(prev)
                                            if (next.has(t.kodSekolah)) { next.delete(t.kodSekolah) }
                                            else { next.add(t.kodSekolah) }
                                            return next
                                          })
                                        }}
                                      >
                                        <p className={`font-semibold text-xs leading-tight ${isTop3 ? 'text-gray-800' : 'text-gray-600'} flex items-center gap-1`}>
                                          <span className="sm:hidden inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-black shrink-0 mr-0.5 ${rs.badge || 'text-gray-400'}">{t.rank}</span>
                                          <span className="truncate max-w-[120px] sm:max-w-none">{t.namaSekolah || t.kodSekolah}</span>
                                          <svg className={`w-3 h-3 shrink-0 transition-transform text-gray-400 ${isKatExp ? 'rotate-180' : ''}`}
                                            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </p>
                                        <p className="text-[9px] text-gray-300 font-mono mt-0.5">{t.kodSekolah}</p>
                                      </button>
                                    </td>
                                    {/* Medal counts */}
                                    {[
                                      { v: t.emas,   cls: 'text-yellow-600' },
                                      { v: t.perak,  cls: 'text-gray-500'   },
                                      { v: t.gangsa, cls: 'text-orange-600' },
                                    ].map((m, mi) => (
                                      <td key={mi} className="px-1 sm:px-2 py-3 text-center">
                                        <span className={`text-sm font-black ${(m.v||0) > 0 ? m.cls : 'text-gray-200'}`}>
                                          {m.v || 0}
                                        </span>
                                      </td>
                                    ))}
                                    {extraCols.map(c => (
                                      <td key={c.key} className="px-1 sm:px-2 py-3 text-center text-xs font-bold text-gray-400">
                                        {t[c.key] || 0}
                                      </td>
                                    ))}
                                    {showJumlahCol && (
                                      <td className="px-2 sm:px-3 py-3 text-center">
                                        <span className={`text-xs font-black ${jumlah > 0 ? 'text-gray-700' : 'text-gray-200'}`}>{jumlah}</span>
                                      </td>
                                    )}
                                  </tr>
                                  {/* ── Expand: breakdown by kategori ── */}
                                  {isKatExp && (
                                    <tr key={`kat_${t.kodSekolah}`} className="bg-blue-50/40 border-b border-blue-100">
                                      <td colSpan={totalCols} className="px-4 py-3">
                                        {(
                                          <div className="overflow-x-auto">
                                            <table className="w-full text-[10px]">
                                              <thead>
                                                <tr className="text-gray-400 font-bold uppercase tracking-wide border-b border-blue-100">
                                                  <th className="py-1.5 pr-3 text-left w-16">Kat</th>
                                                  <th className="py-1.5 px-2 text-center">
                                                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400 border border-yellow-500" />
                                                  </th>
                                                  <th className="py-1.5 px-2 text-center">
                                                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300 border border-gray-400" />
                                                  </th>
                                                  <th className="py-1.5 px-2 text-center">
                                                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-300 border border-orange-400" />
                                                  </th>
                                                  {extraCols.map(c => (
                                                    <th key={c.key} className="py-1.5 px-2 text-center text-gray-300">{c.label}</th>
                                                  ))}
                                                  {showJumlahCol && <th className="py-1.5 pl-2 text-center text-gray-400">Jum</th>}
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {katKombos.map(({ umur, j, label }) => {
                                                  // Cari semua kods dalam kategoriMap dengan umurHad sama + jenisSekolah sama
                                                  // Sum medals dari semua kods berkenaan
                                                  const matchingKods = Object.entries(kategoriMap)
                                                    .filter(([, info]) =>
                                                      (info.umurHad || info.kod) === umur &&
                                                      info.jenisSekolah === (t.jenisSekolah || 'SR')
                                                    )
                                                    .map(([k]) => k)
                                                  const sumField = field => matchingKods.reduce((s, k) => s + (detail?.rows?.[`${j}_${k}`]?.[field] || 0), 0)
                                                  const emas  = sumField('emas')
                                                  const perak = sumField('perak')
                                                  const gsa   = sumField('gangsa')
                                                  const t4    = sumField('tempat4')
                                                  const t5    = sumField('tempat5')
                                                  const jum   = emas + perak + gsa
                                                  const ada   = jum > 0 || t4 > 0 || t5 > 0
                                                  return (
                                                    <tr key={`${j}_${umur}`} className={`border-b border-blue-50/50 ${ada ? '' : 'opacity-40'}`}>
                                                      <td className="py-1 pr-3 font-bold text-gray-600">{label}</td>
                                                      <td className="py-1 px-2 text-center">
                                                        <span className={`font-black ${emas > 0 ? 'text-yellow-600' : 'text-gray-200'}`}>{emas}</span>
                                                      </td>
                                                      <td className="py-1 px-2 text-center">
                                                        <span className={`font-black ${perak > 0 ? 'text-gray-500' : 'text-gray-200'}`}>{perak}</span>
                                                      </td>
                                                      <td className="py-1 px-2 text-center">
                                                        <span className={`font-black ${gsa > 0 ? 'text-orange-500' : 'text-gray-200'}`}>{gsa}</span>
                                                      </td>
                                                      {extraCols.map(c => {
                                                        const v = c.key === 'tempat4' ? t4 : t5
                                                        return (
                                                          <td key={c.key} className="py-1 px-2 text-center">
                                                            <span className={`font-bold ${v > 0 ? 'text-gray-500' : 'text-gray-200'}`}>{v}</span>
                                                          </td>
                                                        )
                                                      })}
                                                      {showJumlahCol && (
                                                        <td className="py-1 pl-2 text-center">
                                                          <span className={`font-black ${jum > 0 ? 'text-gray-600' : 'text-gray-200'}`}>{jum}</span>
                                                        </td>
                                                      )}
                                                    </tr>
                                                  )
                                                })}
                                                {/* ── Relay rows (RELAY key) ── */}
                                                {['L', 'P'].map(j => {
                                                  const row  = detail?.rows?.[`${j}_RELAY`]
                                                  if (!row) return null
                                                  const emas = row.emas   || 0
                                                  const perak= row.perak  || 0
                                                  const gsa  = row.gangsa || 0
                                                  const t4   = row.tempat4 || 0
                                                  const t5   = row.tempat5 || 0
                                                  const jum  = emas + perak + gsa
                                                  if (jum + t4 + t5 === 0) return null
                                                  return (
                                                    <tr key={`relay_${j}`} className="border-b border-blue-50/50 border-t-2 border-t-blue-200">
                                                      <td className="py-1 pr-3 font-bold text-[#003399]">Relay {j}</td>
                                                      <td className="py-1 px-2 text-center">
                                                        <span className={`font-black ${emas > 0 ? 'text-yellow-600' : 'text-gray-200'}`}>{emas}</span>
                                                      </td>
                                                      <td className="py-1 px-2 text-center">
                                                        <span className={`font-black ${perak > 0 ? 'text-gray-500' : 'text-gray-200'}`}>{perak}</span>
                                                      </td>
                                                      <td className="py-1 px-2 text-center">
                                                        <span className={`font-black ${gsa > 0 ? 'text-orange-500' : 'text-gray-200'}`}>{gsa}</span>
                                                      </td>
                                                      {extraCols.map(c => {
                                                        const v = c.key === 'tempat4' ? t4 : t5
                                                        return (
                                                          <td key={c.key} className="py-1 px-2 text-center">
                                                            <span className={`font-bold ${v > 0 ? 'text-gray-500' : 'text-gray-200'}`}>{v}</span>
                                                          </td>
                                                        )
                                                      })}
                                                      {showJumlahCol && (
                                                        <td className="py-1 pl-2 text-center">
                                                          <span className={`font-black ${jum > 0 ? 'text-[#003399]' : 'text-gray-200'}`}>{jum}</span>
                                                        </td>
                                                      )}
                                                    </tr>
                                                  )
                                                })}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  )}
                                  </>
                                )
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gray-50 border-t-2 border-gray-200">
                                <td className="hidden sm:table-cell" />
                                <td className="px-2 sm:px-3 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wide">{rows.length} sekolah</td>
                                <td className="px-1 sm:px-2 py-2 text-center text-xs font-black text-yellow-600">{rows.reduce((s,t)=>s+(t.emas||0),0)}</td>
                                <td className="px-1 sm:px-2 py-2 text-center text-xs font-black text-gray-500">{rows.reduce((s,t)=>s+(t.perak||0),0)}</td>
                                <td className="px-1 sm:px-2 py-2 text-center text-xs font-black text-orange-600">{rows.reduce((s,t)=>s+(t.gangsa||0),0)}</td>
                                {extraCols.map(c => (
                                  <td key={c.key} className="px-1 sm:px-2 py-2 text-center text-xs font-bold text-gray-400">{rows.reduce((s,t)=>s+(t[c.key]||0),0)}</td>
                                ))}
                                <td className="px-2 sm:px-3 py-2 text-center text-xs font-black text-gray-600">{rows.reduce((s,t)=>s+(t.emas||0)+(t.perak||0)+(t.gangsa||0),0)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                        }
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        )
      })()}


      {/* ── Footer ── */}
      <footer className="border-t border-gray-100 py-4 px-5 bg-white">
        <p className="text-center text-[10px] text-gray-300">
          © {new Date().getFullYear()} Majlis Sukan Sekolah Daerah Kemaman · Hak Cipta Terpelihara
        </p>
      </footer>

      {adminModal && <AdminModal onClose={() => setAdminModal(false)} />}
    </div>
  )
}
