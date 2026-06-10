import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase/config'
import { AuthProvider, useAuth } from './context/AuthContext'
import DashboardLayout from './components/layout/DashboardLayout'
import Home from './pages/Home'
import Login from './pages/Login'
import Maintenance from './pages/Maintenance'
import Dashboard from './pages/Dashboard'
import UserManagement from './pages/admin/UserManagement'
import KejohananSetup from './pages/admin/KejohananSetup'
import SekolahSetup from './pages/admin/SekolahSetup'
import KategoriSetup from './pages/admin/KategoriSetup'
import TetapanHome from './pages/admin/TetapanHome'
import AcaraSetup from './pages/admin/AcaraSetup'
import PendaftaranSetup from './pages/admin/PendaftaranSetup'
import StartList from './pages/admin/StartList'
import InputKeputusanAdmin from './pages/admin/InputKeputusan'
import InputKeputusanPencatat from './pages/pencatat/InputKeputusan'
import CetakanHadiah from './pages/pencatat/CetakanHadiah'
import Olahragawan from './pages/admin/Olahragawan'
import Rekod from './pages/admin/Rekod'
import CetakAcara from './pages/admin/CetakAcara'
import BukuKejohanan from './pages/admin/BukuKejohanan'
import CetakKeputusan from './pages/admin/CetakKeputusan'
import ResetSistem from './pages/admin/ResetSistem'
import Backup from './pages/admin/Backup'
import ManualPendaftaran from './pages/admin/ManualPendaftaran'
import AnalisisPendaftaran from './pages/admin/AnalisisPendaftaran'
import ESijil from './pages/admin/ESijil'
import SijilPengurus from './pages/admin/SijilPengurus'
import HealthCheck from './pages/admin/HealthCheck'

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/" replace />
  return children
}

function SistemTutupGuard({ children }) {
  const { userRole, loading: authLoading } = useAuth()
  const location = useLocation()
  const [sistemTutup, setSistemTutup] = useState(false)
  const [mesejTutup,  setMesejTutup]  = useState('')
  const [flagLoaded,  setFlagLoaded]  = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'tetapan', 'home'))
      .then(snap => {
        if (snap.exists()) {
          setSistemTutup(snap.data().sistemTutup || false)
          setMesejTutup(snap.data().mesejTutup   || '')
        }
      })
      .catch(() => {})
      .finally(() => setFlagLoaded(true))
  }, [])

  if (!flagLoaded || authLoading) return null

  // Sistem buka — akses biasa
  if (!sistemTutup) return children

  // Sistem tutup — admin & superadmin kekal boleh akses
  if (userRole === 'superadmin' || userRole === 'admin') return children

  // Sistem tutup — /login sentiasa boleh akses (untuk admin login)
  if (location.pathname === '/login') return children

  // Semua pengguna lain → halaman maintenance
  return <Maintenance mesej={mesejTutup} />
}

function InputKeputusanRoute() {
  const { userRole, loading } = useAuth()
  if (loading) return null
  if (userRole === 'pencatat') return <InputKeputusanPencatat />
  return <InputKeputusanAdmin />
}

// Placeholder untuk modul yang belum siap
function ComingSoon({ title }) {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="bg-white border border-gray-200 rounded shadow-sm p-8 text-center">
        <p className="text-3xl mb-3">🚧</p>
        <h2 className="text-base font-bold text-gray-700 mb-1">{title}</h2>
        <p className="text-sm text-gray-400">Modul ini sedang dalam pembangunan.</p>
      </div>
    </div>
  )
}

function AppRoutes() {
  return (
    <SistemTutupGuard>
      <Routes>
      {/* Home — login awam (3 cards + gear modal) */}
      <Route path="/" element={<Home />} />

      {/* /login — Login page (superadmin + sistem tutup admin access) */}
      <Route path="/login" element={<Login />} />

      {/* Dashboard — protected */}
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <DashboardLayout><Dashboard /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/kejohanan" element={
        <ProtectedRoute>
          <DashboardLayout><KejohananSetup /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/sekolah" element={
        <ProtectedRoute>
          <DashboardLayout><SekolahSetup /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/kategori" element={
        <ProtectedRoute>
          <DashboardLayout><KategoriSetup /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/acara" element={
        <ProtectedRoute>
          <DashboardLayout><AcaraSetup /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/jadual" element={<Navigate to="/dashboard/acara" replace />} />
      <Route path="/dashboard/pendaftaran" element={
        <ProtectedRoute>
          <DashboardLayout><PendaftaranSetup /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/startlist" element={
        <ProtectedRoute>
          <DashboardLayout><StartList /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/keputusan" element={
        <ProtectedRoute>
          <DashboardLayout><InputKeputusanRoute /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/cetakanhadiah" element={
        <ProtectedRoute>
          <DashboardLayout><CetakanHadiah /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/rekod" element={
        <ProtectedRoute>
          <DashboardLayout><Rekod /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/olahragawan" element={
        <ProtectedRoute>
          <DashboardLayout><Olahragawan /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/cetak" element={
        <ProtectedRoute>
          <DashboardLayout><CetakAcara /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/buku" element={
        <ProtectedRoute>
          <DashboardLayout><BukuKejohanan /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/cetakkeputusan" element={
        <ProtectedRoute>
          <DashboardLayout><CetakKeputusan /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/reset" element={
        <ProtectedRoute>
          <DashboardLayout><ResetSistem /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/backup" element={
        <ProtectedRoute>
          <DashboardLayout><Backup /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/manual" element={
        <ProtectedRoute>
          <DashboardLayout><ManualPendaftaran /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/analisis" element={
        <ProtectedRoute>
          <DashboardLayout><AnalisisPendaftaran /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/esijil" element={
        <ProtectedRoute>
          <DashboardLayout><ESijil /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/sijilsaya" element={
        <ProtectedRoute>
          <DashboardLayout><SijilPengurus /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/healthcheck" element={
        <ProtectedRoute>
          <DashboardLayout><HealthCheck /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/laporan" element={
        <ProtectedRoute>
          <DashboardLayout><ComingSoon title="Laporan & PDF" /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/pengguna" element={
        <ProtectedRoute>
          <DashboardLayout><UserManagement /></DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/dashboard/tetapan" element={
        <ProtectedRoute>
          <DashboardLayout><TetapanHome /></DashboardLayout>
        </ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SistemTutupGuard>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
