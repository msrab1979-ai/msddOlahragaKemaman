import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_LABEL = {
  superadmin:       'Super Admin',
  admin:            'Admin Sekolah',
  pencatat:         'Pencatat',
  pengurus_teknik:  'Pengurus Teknik',
  urusetia:         'Urusetia',
  pengurus_pasukan: 'Pengurus Pasukan',
  viewer:           'Pemerhati',
}

const NAV_ITEMS = [
  {
    section: 'UTAMA',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: 'home', exact: true,
        roles: ['superadmin', 'admin', 'pencatat', 'pengurus_teknik', 'pengurus_pasukan', 'viewer'] },
    ],
  },
  {
    section: 'PENGURUSAN',
    items: [
      // Superadmin sahaja — setup sistem
      { label: 'Kejohanan',         path: '/dashboard/kejohanan',   icon: 'trophy',    roles: ['superadmin'] },
      { label: 'Sekolah',           path: '/dashboard/sekolah',     icon: 'school',    roles: ['superadmin'] },
      { label: 'Kategori',          path: '/dashboard/kategori',    icon: 'tag',       roles: ['superadmin'] },
      // Superadmin + Admin — setup teknikal
      { label: 'Acara & Jadual',     path: '/dashboard/acara',       icon: 'list',      roles: ['superadmin', 'admin'] },
      // Pendaftaran — admin + pengurus pasukan
      { label: 'Pendaftaran Atlet', path: '/dashboard/pendaftaran', icon: 'userPlus',  roles: ['superadmin', 'admin', 'pengurus_pasukan'] },
      { label: 'Panduan Pendaftaran', path: '/dashboard/manual',   icon: 'book',      roles: ['superadmin', 'admin', 'pengurus_pasukan'] },
      // Start List — admin jana, semua lihat (view-only untuk bukan admin)
      { label: 'Start List',        path: '/dashboard/startlist',   icon: 'startlist', roles: ['superadmin', 'admin', 'pencatat', 'pengurus_teknik', 'urusetia'] },
    ],
  },
  {
    section: 'OPERASI',
    items: [
      // Pencatat — input masa/jarak
      { label: 'Input Keputusan',  path: '/dashboard/keputusan',   icon: 'clipboard',   roles: ['superadmin', 'pencatat'] },
      // Paparan data — semua staff boleh lihat kecuali pengurus_pasukan
      { label: 'Rekod Semasa',     path: '/dashboard/rekod',       icon: 'star',        roles: ['superadmin', 'pengurus_teknik', 'admin', 'pencatat', 'viewer'] },
      { label: 'Olahragawan',      path: '/dashboard/olahragawan', icon: 'award',       roles: ['superadmin', 'admin', 'pengurus_teknik', 'pencatat', 'viewer'] },
      { label: 'Cetak Acara',      path: '/dashboard/cetak',       icon: 'file',        roles: ['superadmin', 'admin', 'pengurus_teknik', 'urusetia', 'pencatat'] },
      { label: 'Buku Kejohanan',   path: '/dashboard/buku',        icon: 'file',        roles: ['superadmin', 'admin', 'pengurus_teknik', 'urusetia'] },
      { label: 'Cetak Keputusan', path: '/dashboard/cetakkeputusan', icon: 'file',     roles: ['superadmin', 'admin', 'pengurus_teknik', 'urusetia'] },
      { label: 'Analisis Pendaftaran', path: '/dashboard/analisis', icon: 'chart',    roles: ['superadmin', 'admin', 'pengurus_teknik'] },
    ],
  },
  {
    section: 'SISTEM',
    items: [
      { label: 'Laporan & PDF',       path: '/dashboard/laporan',  icon: 'file',     roles: ['superadmin', 'admin', 'pengurus_teknik'] },
      { label: 'Pengurusan Pengguna', path: '/dashboard/pengguna', icon: 'users',    roles: ['superadmin'] },
      { label: 'Tetapan Home',        path: '/dashboard/tetapan',  icon: 'settings', roles: ['superadmin'] },
      { label: 'Log Audit',           path: '/dashboard/audit',    icon: 'shield',   roles: ['superadmin'] },
      { label: 'Reset Sistem',        path: '/dashboard/reset',    icon: 'trash',    roles: ['superadmin'] },
    ],
  },
]

// ─── Icons ────────────────────────────────────────────────────────────────────

const Icons = {
  home: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  trophy: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>,
  tag: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>,
  school: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  list: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
  userPlus: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>,
  startlist: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h6" /></svg>,
  clipboard: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
  checkCircle: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  star: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>,
  medal: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="12" cy="14" r="5" /><path strokeLinecap="round" strokeLinejoin="round" d="M8.21 4.368l-3.02 5.232M15.79 4.368l3.02 5.232M12 9V4m0 0H9m3 0h3" /></svg>,
  award: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 0M12 3v10m0 0l-4 4m4-4l4 4M5 21h14" /></svg>,
  calendar: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  file: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  book: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
  users: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  settings: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  shield: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  menu: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>,
  chart: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  trash: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
  logout: <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>,
}

// ─── SidebarContent — komponen berasingan (BUKAN nested dalam render) ─────────

function SidebarContent({ userData, userRole, visibleNav, onLogout, onNavClick }) {
  return (
    <div className="flex flex-col h-full">
      {/* Branding */}
      <div className="px-4 py-4 border-b border-white/10">
        <p className="text-[10px] font-medium tracking-widest text-white/50 uppercase">Sistem KOAM</p>
        <p className="text-sm font-bold text-white leading-tight mt-0.5">Olahraga Antara Murid</p>
        <p className="text-[10px] text-white/40 mt-0.5">mssdkemaman-olahraga</p>
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-white/10 bg-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold text-white shrink-0">
            {(userData?.nama || userData?.email || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              {userData?.nama || userData?.email || '—'}
            </p>
            {userRole ? (
              <span className="inline-block text-[10px] bg-yellow-400 text-yellow-900 font-semibold px-1.5 py-0.5 rounded mt-0.5 leading-none">
                {ROLE_LABEL[userRole] || userRole}
              </span>
            ) : (
              <span className="inline-block text-[10px] bg-red-400 text-white font-semibold px-1.5 py-0.5 rounded mt-0.5 leading-none">
                Role tidak ditetapkan
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {visibleNav.length === 0 ? (
          <div className="px-3 py-4 text-[10px] text-white/40 leading-relaxed">
            Tiada menu tersedia.{'\n'}
            Pastikan dokumen Firestore{'\n'}
            <code className="font-mono">users/{'{uid}'}</code> ada field{'\n'}
            <code className="font-mono">role: "superadmin"</code>
          </div>
        ) : (
          visibleNav.map(section => (
            <div key={section.section} className="mb-3">
              <p className="text-[9px] font-bold tracking-widest text-white/30 px-2 py-1 uppercase">
                {section.section}
              </p>
              {section.items.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.exact}
                  onClick={onNavClick}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium transition-colors mb-0.5 ${
                      isActive
                        ? 'bg-white text-[#003399]'
                        : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  {Icons[item.icon]}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))
        )}
      </nav>

      {/* Logout */}
      <div className="px-2 py-3 border-t border-white/10">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-xs font-medium text-white/60 hover:bg-white/10 hover:text-white transition-colors"
        >
          {Icons.logout}
          Log Keluar
        </button>
      </div>
    </div>
  )
}

// ─── DashboardLayout ──────────────────────────────────────────────────────────

export default function DashboardLayout({ children }) {
  const { userData, userRole, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  // Jika userRole null (dokumen Firestore tiada / role tidak ditetapkan),
  // masih render sidebar dengan visibleNav kosong supaya mesej ralat nampak.
  const visibleNav = NAV_ITEMS
    .map(section => ({
      ...section,
      items: section.items.filter(item =>
        userRole && item.roles.includes(userRole)
      ),
    }))
    .filter(section => section.items.length > 0)

  const sidebarProps = {
    userData,
    userRole,
    visibleNav,
    onLogout: handleLogout,
    onNavClick: () => setSidebarOpen(false),
  }

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-52 bg-[#003399] flex-col shrink-0 shadow-xl">
        <SidebarContent {...sidebarProps} />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative z-50 w-52 bg-[#003399] flex flex-col shadow-xl">
            <SidebarContent {...sidebarProps} />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-1 text-gray-500 hover:text-gray-700"
              onClick={() => setSidebarOpen(true)}
            >
              {Icons.menu}
            </button>
            <div>
              <p className="text-xs text-gray-400 leading-none">Kementerian Pendidikan Malaysia</p>
              <p className="text-sm font-bold text-[#003399] leading-tight">
                Kejohanan Olahraga Antara Murid (KOAM)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-xs font-semibold text-gray-700">{userData?.nama || userData?.email}</p>
              <p className="text-[10px] text-gray-400">{ROLE_LABEL[userRole] || userRole || 'Role tidak ditetapkan'}</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#003399] flex items-center justify-center text-xs font-bold text-white">
              {(userData?.nama || userData?.email || 'U').charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

<main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
