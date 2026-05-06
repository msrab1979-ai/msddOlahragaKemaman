import React, { useEffect, useState } from 'react'
import { collection, getCountFromServer, query, where, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../context/AuthContext'

// ─── StatCard ─────────────────────────────────────────────────────────────────

const StatCard = ({ label, value, sub, color, icon }) => (
  <div className="bg-white border border-gray-200 rounded shadow-sm p-4 flex items-start gap-4">
    <div className={`w-10 h-10 rounded flex items-center justify-center shrink-0 ${color}`}>
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-2xl font-bold text-gray-800 leading-none">
        {value === null ? (
          <span className="inline-block w-10 h-6 bg-gray-100 rounded animate-pulse" />
        ) : value}
      </p>
      <p className="text-xs font-semibold text-gray-600 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  </div>
)

const QuickLink = ({ label, path, desc }) => (
  <a
    href={path}
    className="block bg-white border border-gray-200 rounded shadow-sm p-4 hover:border-[#003399] hover:shadow-md transition-all group"
  >
    <p className="text-sm font-semibold text-[#003399] group-hover:underline">{label}</p>
    <p className="text-xs text-gray-500 mt-1">{desc}</p>
  </a>
)

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { userData, userRole } = useAuth()
  const [stats,   setStats]   = useState({ atlet: null, sekolah: null, kejohanan: null, aktif: null })
  const [dokumen,      setDokumen]      = useState([])
  const [linkWasap,    setLinkWasap]    = useState('')
  const [linkTelegram, setLinkTelegram] = useState('')

  useEffect(() => {
    getDoc(doc(db, 'tetapan', 'home'))
      .then(s => {
        if (s.exists()) {
          const d = s.data()
          setDokumen((d.dokumenMuatTurun || []).filter(x => x.nama && x.url))
          setLinkWasap(d.linkWasap || '')
          setLinkTelegram(d.linkTelegram || '')
        }
      })
      .catch(() => {})
  }, [])

  async function fetchStats() {
    try {
      const [atletSnap, sekolahSnap, kejohananSnap] = await Promise.all([
        getCountFromServer(collection(db, 'atlet')),
        getCountFromServer(collection(db, 'sekolah')),
        getCountFromServer(collection(db, 'kejohanan')),
      ])
      const aktifSnap = await getCountFromServer(
        query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif'))
      )
      setStats({
        atlet:     atletSnap.data().count,
        sekolah:   sekolahSnap.data().count,
        kejohanan: kejohananSnap.data().count,
        aktif:     aktifSnap.data().count,
      })
    } catch {
      setStats({ atlet: 0, sekolah: 0, kejohanan: 0, aktif: 0 })
    }
  }

  useEffect(() => { fetchStats() }, [])

const isSuperAdmin = userRole === 'superadmin'

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Page title */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-800">
          Selamat Datang, {userData?.nama || 'Pengguna'}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Sistem Statistik Pengurusan Kejohanan Olahraga Antara Murid (KOAM)
        </p>
      </div>

      {/* Dokumen Muat Turun + Pautan Kumpulan — Pengurus Pasukan */}
      {(dokumen.length > 0 || (userRole === 'pengurus_pasukan' && (linkWasap || linkTelegram))) && (
        <div className="mb-6 space-y-3">

          {/* Dokumen */}
          {dokumen.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Dokumen Muat Turun</p>
              <div className="flex flex-wrap gap-2">
                {dokumen.map((d, i) => (
                  <a key={i} href={d.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-[#003399] hover:border-[#003399] hover:shadow-sm transition-all">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    {d.nama}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Pautan Kumpulan — Pengurus Pasukan sahaja */}
          {userRole === 'pengurus_pasukan' && (linkWasap || linkTelegram) && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Pautan Kumpulan</p>
              <div className="flex flex-wrap gap-2">
                {linkWasap && (
                  <a href={linkWasap} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs font-semibold transition-colors">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Kumpulan WhatsApp
                  </a>
                )}
                {linkTelegram && (
                  <a href={linkTelegram} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-semibold transition-colors">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                    </svg>
                    Kumpulan Telegram
                  </a>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Jumlah Atlet"
          value={stats.atlet}
          sub="Berdaftar dalam sistem"
          color="bg-blue-100 text-blue-700"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <StatCard
          label="Jumlah Sekolah"
          value={stats.sekolah}
          sub="Sekolah berdaftar"
          color="bg-green-100 text-green-700"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          }
        />
        <StatCard
          label="Kejohanan"
          value={stats.kejohanan}
          sub="Semua kejohanan"
          color="bg-yellow-100 text-yellow-700"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          }
        />
        <StatCard
          label="Aktif Sekarang"
          value={stats.aktif}
          sub="Kejohanan sedang berjalan"
          color="bg-red-100 text-red-700"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
      </div>

      {/* Quick actions — superadmin */}
      {isSuperAdmin && (
        <div className="mb-8">
          <h2 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide">
            Tindakan Pantas
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <QuickLink label="Buat Kejohanan Baru"   path="/dashboard/kejohanan" desc="Setup kejohanan, tarikh, dan lokasi" />
            <QuickLink label="Setup Sekolah"          path="/dashboard/sekolah"   desc="Tambah, edit, reset PIN sekolah" />
            <QuickLink label="Urus Pengguna"          path="/dashboard/pengguna"  desc="Tambah admin, pencatat, pengurus teknik" />
            <QuickLink label="Setup Acara"            path="/dashboard/acara"     desc="Konfigurasikan acara dan lorong" />
            <QuickLink label="Semak Rekod"            path="/dashboard/rekod"     desc="Rekod daerah, negeri, kebangsaan" />
            <QuickLink label="Medal Tally"            path="/dashboard/medal"     desc="Kedudukan semasa sekolah" />
            <QuickLink label="Log Audit"              path="/dashboard/audit"     desc="Semak semua perubahan data" />
          </div>
        </div>
      )}

    </div>
  )
}
