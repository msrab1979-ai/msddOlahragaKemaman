import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PasswordInput from '../components/ui/PasswordInput'

// ─── Constants ────────────────────────────────────────────────────────────────

const TAB_DUA_ROLES = [
  { value: 'admin',            label: 'Admin Sekolah' },
  { value: 'pencatat',         label: 'Pencatat' },
  { value: 'urusetia',         label: 'Urusetia' },
  { value: 'pengurus_pasukan', label: 'Pengurus Pasukan' },
]

const inputCls =
  'w-full px-3.5 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none ' +
  'focus:border-[#003399] focus:ring-2 focus:ring-[#003399]/15 bg-gray-50 transition-shadow'

// ─── Error helper ─────────────────────────────────────────────────────────────

function authErrMsg(code) {
  if (
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential'
  ) return 'E-mel / Kod Akses atau kata laluan / PIN tidak sah.'
  if (code === 'auth/too-many-requests')
    return 'Terlalu banyak percubaan. Sila cuba sebentar lagi.'
  if (code === 'auth/user-disabled')
    return 'Akaun ini telah dinyahaktifkan. Hubungi pentadbir.'
  return 'Ralat sistem. Sila hubungi pentadbir.'
}

// ─── ErrorBox ─────────────────────────────────────────────────────────────────

function ErrorBox({ msg }) {
  return (
    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
      <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      {msg}
    </div>
  )
}

// ─── Tab 1 — E-mel + Kata Laluan ─────────────────────────────────────────────

function TabSatu({ onSuccess }) {
  const { loginSuperadmin } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await loginSuperadmin(email, password)
      onSuccess()
    } catch (err) {
      setError(authErrMsg(err.code))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <ErrorBox msg={error} />}

      <div>
        <label className="block text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-widest">
          Alamat E-mel
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="contoh@pendidikan.gov.my"
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-widest">
          Kata Laluan
        </label>
        <PasswordInput
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className={inputCls}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#003399] hover:bg-[#002277] active:scale-[0.98] disabled:bg-gray-300 text-white font-bold py-3.5 px-4 rounded-xl text-sm transition-all shadow-sm"
      >
        {loading ? 'Sedang log masuk…' : 'LOG MASUK'}
      </button>

      <p className="text-[10px] text-gray-400 text-center">
        Untuk: Superadmin &amp; Pengurus Teknik sahaja
      </p>
    </form>
  )
}

// ─── Tab 2 — Kod Akses + PIN ──────────────────────────────────────────────────

function TabDua({ onSuccess }) {
  const { loginPencatat, loginPengurus } = useAuth()
  const [role, setRole] = useState('admin')
  const [kodAkses, setKodAkses] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isPengurusPasukan = role === 'pengurus_pasukan'
  const kodLabel = isPengurusPasukan ? 'Kod Sekolah' : 'Kod Akses'
  const kodPlaceholder = isPengurusPasukan ? 'cth: TBB2024' : 'cth: ADMIN-TBB'

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!kodAkses.trim()) return setError(`${kodLabel} diperlukan.`)
    if (!/^\d{6}$/.test(pin)) return setError('PIN mesti tepat 6 digit angka.')
    setLoading(true)
    try {
      // pengurus_pasukan → cari dalam sekolah, lain-lain → cari dalam users
      if (isPengurusPasukan) await loginPengurus(kodAkses.trim(), pin)
      else await loginPencatat(kodAkses.trim(), pin)
      onSuccess()
    } catch (err) {
      setError(authErrMsg(err.code))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <ErrorBox msg={error} />}

      <div>
        <label className="block text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-widest">
          Peranan
        </label>
        <select
          value={role}
          onChange={e => { setRole(e.target.value); setError('') }}
          className={inputCls}
        >
          {TAB_DUA_ROLES.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-widest">
          {kodLabel}
        </label>
        <input
          type="text"
          value={kodAkses}
          onChange={e => setKodAkses(e.target.value.toUpperCase())}
          required
          autoCapitalize="characters"
          placeholder={kodPlaceholder}
          className={inputCls + ' font-mono tracking-wider'}
        />
        {isPengurusPasukan && (
          <p className="text-[10px] text-gray-400 mt-1.5">
            Gunakan kod sekolah yang diberikan oleh pentadbir.
          </p>
        )}
      </div>

      <div>
        <label className="block text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-widest">
          PIN (6 Digit)
        </label>
        <PasswordInput
          isPin
          inputMode="numeric"
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
          placeholder="••••••"
          maxLength={6}
        />
        <p className="text-[10px] text-gray-400 mt-1.5">
          PIN 6 digit diberikan oleh pentadbir sistem.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#003399] hover:bg-[#002277] active:scale-[0.98] disabled:bg-gray-300 text-white font-bold py-3.5 px-4 rounded-xl text-sm transition-all shadow-sm"
      >
        {loading ? 'Mengesahkan…' : 'LOG MASUK'}
      </button>

      <p className="text-[10px] text-gray-400 text-center">
        Untuk: Admin Sekolah, Pencatat, Urusetia &amp; Pengurus Pasukan
      </p>
    </form>
  )
}

// ─── Tab Pill ─────────────────────────────────────────────────────────────────

function TabPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg text-xs font-bold transition-all ${
        active
          ? 'bg-white text-[#003399] shadow-sm'
          : 'text-gray-400 hover:text-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Main Login ───────────────────────────────────────────────────────────────

export default function Login() {
  const navigate = useNavigate()
  const [tab, setTab] = useState(1)

  function handleSuccess() {
    navigate('/dashboard')
  }

  return (
    <div className="min-h-screen bg-[#003399] flex flex-col">

      {/* ── Header ── */}
      <header className="px-5 pt-5 pb-0 flex items-center gap-3">
        <div className="w-10 h-10 bg-white/15 border border-white/20 rounded-full flex items-center justify-center text-white text-[9px] font-black shrink-0">
          KPM
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] text-white/40 leading-tight truncate">
            Kementerian Pendidikan Malaysia
          </p>
          <p className="text-xs font-bold text-white leading-tight truncate">
            MSSD Kemaman
          </p>
        </div>
        <div className="w-10 h-10 bg-white/15 border border-white/20 rounded-full flex items-center justify-center text-white text-[9px] font-black shrink-0">
          MSN
        </div>
      </header>

      {/* ── Branding ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 min-h-[200px]">
        <div className="w-20 h-20 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mb-5 shadow-lg">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
        </div>

        <h1 className="text-3xl font-black text-white tracking-wider">KOAM</h1>
        <p className="text-sm text-white/60 mt-1 tracking-wide">Kejohanan Olahraga Antara Murid</p>
        <p className="text-xs text-white/35 mt-0.5">Daerah Kemaman</p>

        {/* Colour accent bar */}
        <div className="mt-8 h-0.5 w-16 bg-gradient-to-r from-red-400 via-yellow-400 to-red-400 rounded-full" />
      </div>

      {/* ── Sheet ── */}
      <div className="bg-white rounded-t-[2rem] px-6 pt-6 pb-safe-bottom shadow-2xl">
        {/* Drag indicator */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-7" />

        {/* Tab pills */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-6 gap-1">
          <TabPill active={tab === 1} onClick={() => setTab(1)}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            E-mel
          </TabPill>
          <TabPill active={tab === 2} onClick={() => setTab(2)}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Kod Akses
          </TabPill>
        </div>

        {/* Role subtitle */}
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-5">
          {tab === 1 ? 'Log Masuk — Pentadbir' : 'Log Masuk — Peserta Sistem'}
        </p>

        {/* Form */}
        <div className="max-w-sm mx-auto">
          {tab === 1
            ? <TabSatu onSuccess={handleSuccess} />
            : <TabDua onSuccess={handleSuccess} />
          }
        </div>

        <p className="text-center text-[10px] text-gray-300 mt-6 pb-4">
          Sistem untuk kegunaan rasmi sahaja · Semua aktiviti dipantau
        </p>
      </div>
    </div>
  )
}
