import { useNavigate } from 'react-router-dom'

export default function Maintenance({ mesej }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-[#003399] flex flex-col items-center justify-center px-6">

      <div className="text-center">
        <div className="w-20 h-20 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center mx-auto mb-6 shadow-lg">
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
          </svg>
        </div>

        <h1 className="text-2xl font-black text-white tracking-wide">Sistem Dalam Penyelenggaraan</h1>
        <p className="text-white/60 mt-3 text-sm max-w-sm mx-auto leading-relaxed">
          {mesej || 'Sistem sedang dalam penyelenggaraan. Sila cuba sebentar lagi.'}
        </p>

        <div className="mt-8 h-0.5 w-16 bg-gradient-to-r from-red-400 via-yellow-400 to-red-400 rounded-full mx-auto" />

        <p className="text-white/25 text-[10px] mt-8 uppercase tracking-widest">
          Majlis Sukan Sekolah Daerah Kemaman
        </p>
      </div>

      <button
        onClick={() => navigate('/login')}
        className="absolute bottom-6 text-white/20 hover:text-white/50 text-[10px] transition-colors tracking-widest uppercase">
        Log Masuk Admin
      </button>
    </div>
  )
}
