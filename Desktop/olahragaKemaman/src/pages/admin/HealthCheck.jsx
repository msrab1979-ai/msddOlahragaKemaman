/**
 * HealthCheck — /dashboard/healthcheck
 * Semak integriti data sistem KOAM secara on-demand.
 * Laporan sahaja — tiada auto-fix.
 */

import { useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Badge({ type }) {
  if (type === 'ok')   return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">✓ OK</span>
  if (type === 'warn') return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⚠ Amaran</span>
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">✕ Ralat</span>
}

function Section({ title, checks }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-600 uppercase tracking-wider">{title}</p>
      </div>
      <div className="divide-y divide-gray-100">
        {checks.map((c, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <Badge type={c.status} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800">{c.label}</p>
                {c.count != null && c.status !== 'ok' && (
                  <p className="text-[11px] text-gray-500 mt-0.5">{c.count} rekod terjejas</p>
                )}
                {c.details && c.details.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {c.details.slice(0, 10).map((d, j) => (
                      <p key={j} className="text-[10px] font-mono bg-gray-50 rounded px-2 py-1 text-gray-600 break-all">{d}</p>
                    ))}
                    {c.details.length > 10 && (
                      <p className="text-[10px] text-gray-400">...dan {c.details.length - 10} lagi</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HealthCheck() {
  const { userData } = useAuth()
  const [running, setRunning]   = useState(false)
  const [result, setResult]     = useState(null)
  const [progress, setProgress] = useState('')

  async function jalanSemak() {
    setRunning(true)
    setResult(null)
    setProgress('Mencari kejohanan aktif...')

    try {
      // ── 0. Cari kejohanan aktif ──────────────────────────────────────────────
      const kejSnap = await getDocs(
        query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif'))
      )
      if (kejSnap.empty) {
        setResult({ error: 'Tiada kejohanan aktif ditemui.' })
        setRunning(false)
        return
      }
      const kej   = { id: kejSnap.docs[0].id, ...kejSnap.docs[0].data() }
      const kejId = kej.id

      // ── 1. Load data utama ───────────────────────────────────────────────────
      setProgress('Memuatkan data pendaftaran, atlet dan acara...')
      const [pendSnap, atletSnap, acaraSnap] = await Promise.all([
        getDocs(collection(db, 'kejohanan', kejId, 'pendaftaran')),
        getDocs(collection(db, 'atlet')),
        getDocs(collection(db, 'kejohanan', kejId, 'acara')),
      ])

      const pendList  = pendSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      const atletMap  = {}
      atletSnap.docs.forEach(d => { atletMap[d.id] = d.data() })
      const acaraList = acaraSnap.docs.map(d => ({ id: d.id, ...d.data() }))

      // ── BLOK 1: Pendaftaran ──────────────────────────────────────────────────
      setProgress('Menyemak integriti pendaftaran...')

      // C1 — noBib mismatch
      const mismatch = []
      for (const p of pendList) {
        const a = atletMap[p.noKP]
        if (!a) continue
        if (a.noBib && p.noBib && a.noBib !== p.noBib) {
          mismatch.push(`noKP:${p.noKP} | atlet.noBib:${a.noBib} ≠ daftar.noBib:${p.noBib} | ${p.namaAtlet || '—'} (${p.kodSekolah || '—'})`)
        }
      }

      // C2 — noBib duplikat dalam pendaftaran
      const bibCount = {}
      for (const p of pendList) {
        if (!p.noBib) continue
        bibCount[p.noBib] = bibCount[p.noBib] || []
        bibCount[p.noBib].push(`${p.noKP} / ${p.namaAtlet || '—'} / ${p.kodSekolah || '—'}`)
      }
      const dupBib = []
      for (const [bib, list] of Object.entries(bibCount)) {
        if (list.length > 1) {
          dupBib.push(`noBib:${bib} → ${list.join(' | ')}`)
        }
      }

      // C3 — noBib kosong dalam pendaftaran
      const noBibKosong = pendList
        .filter(p => !p.noBib)
        .map(p => `noKP:${p.noKP} | ${p.namaAtlet || '—'} | ${p.kodSekolah || '—'}`)

      // C4 — Rekod tidak lengkap (tiada noKP / namaAtlet / jantina / tarikhLahir)
      const tidakLengkap = pendList
        .filter(p => !p.noKP || !p.namaAtlet || !p.jantina || !p.tarikhLahir)
        .map(p => {
          const hilang = []
          if (!p.noKP)        hilang.push('noKP')
          if (!p.namaAtlet)   hilang.push('namaAtlet')
          if (!p.jantina)     hilang.push('jantina')
          if (!p.tarikhLahir) hilang.push('tarikhLahir')
          return `id:${p.id} | ${p.namaAtlet || '—'} | tiada: ${hilang.join(', ')}`
        })

      // ── BLOK 2: Heat ────────────────────────────────────────────────────────
      setProgress('Menyemak integriti heat...')

      const heatNoBibKosong = []
      const heatNoKPKosong  = []
      const heatLorongDup   = []
      const acaraSatuPeserta = []

      // C8 — Acara dengan 1 peserta dalam pendaftaran
      for (const acara of acaraList) {
        if (acara.jenisAcara === 'relay') continue
        const pesertaAcara = pendList.filter(p =>
          (p.acaraIds || []).includes(acara.id)
        )
        if (pesertaAcara.length === 1) {
          acaraSatuPeserta.push(`#${acara.noAcara || acara.id} ${acara.namaAcara || '—'} (1 peserta: ${pesertaAcara[0].namaAtlet || pesertaAcara[0].noKP})`)
        }
      }

      // C5, C6, C7 — Heat peserta checks
      for (const acara of acaraList) {
        const heatSnap = await getDocs(
          collection(db, 'kejohanan', kejId, 'acara', acara.id, 'heat')
        )
        for (const hDoc of heatSnap.docs) {
          const h = hDoc.data()
          const label = `Acara #${acara.noAcara || acara.id} Heat ${h.noHeat || hDoc.id}`
          const lorongs = []
          for (const p of (h.peserta || [])) {
            // noBib kosong dalam heat
            if (!p.noBib && acara.jenisAcara !== 'relay') {
              heatNoBibKosong.push(`${label} | ${p.namaAtlet || '—'}`)
            }
            // noKP kosong dalam heat
            if (!p.noKP && acara.jenisAcara !== 'relay') {
              heatNoKPKosong.push(`${label} | ${p.namaAtlet || '—'}`)
            }
            // Lorong duplikat
            if (p.lorong != null) {
              if (lorongs.includes(p.lorong)) {
                heatLorongDup.push(`${label} | Lorong ${p.lorong} berganda`)
              } else {
                lorongs.push(p.lorong)
              }
            }
          }
        }
      }

      // ── BLOK 3: Status Lama ──────────────────────────────────────────────────
      setProgress('Menyemak status keputusan...')

      const statusLama = []
      for (const acara of acaraList) {
        const heatSnap = await getDocs(
          collection(db, 'kejohanan', kejId, 'acara', acara.id, 'heat')
        )
        for (const hDoc of heatSnap.docs) {
          const h = hDoc.data()
          if (h.statusKeputusan === 'tidak_rasmi') {
            statusLama.push(`Acara #${acara.noAcara || acara.id} Heat ${h.noHeat || hDoc.id} — status 'tidak_rasmi' (data lama)`)
          }
        }
      }

      // ── Susun keputusan ──────────────────────────────────────────────────────
      setProgress('Menyusun laporan...')

      const blok1 = [
        {
          label: 'noBib pendaftaran sepadan dengan atlet.noBib',
          status: mismatch.length === 0 ? 'ok' : 'error',
          count: mismatch.length,
          details: mismatch,
        },
        {
          label: 'Tiada noBib duplikat dalam pendaftaran',
          status: dupBib.length === 0 ? 'ok' : 'error',
          count: dupBib.length,
          details: dupBib,
        },
        {
          label: 'Tiada noBib kosong dalam pendaftaran',
          status: noBibKosong.length === 0 ? 'ok' : 'warn',
          count: noBibKosong.length,
          details: noBibKosong,
        },
        {
          label: 'Rekod pendaftaran lengkap (noKP, nama, jantina, tarikhLahir)',
          status: tidakLengkap.length === 0 ? 'ok' : 'error',
          count: tidakLengkap.length,
          details: tidakLengkap,
        },
      ]

      const blok2 = [
        {
          label: 'Tiada noBib kosong dalam heat',
          status: heatNoBibKosong.length === 0 ? 'ok' : 'error',
          count: heatNoBibKosong.length,
          details: heatNoBibKosong,
        },
        {
          label: 'Tiada noKP kosong dalam heat',
          status: heatNoKPKosong.length === 0 ? 'ok' : 'error',
          count: heatNoKPKosong.length,
          details: heatNoKPKosong,
        },
        {
          label: 'Tiada lorong berganda dalam heat',
          status: heatLorongDup.length === 0 ? 'ok' : 'error',
          count: heatLorongDup.length,
          details: heatLorongDup,
        },
        {
          label: 'Acara dengan 1 peserta sahaja',
          status: acaraSatuPeserta.length === 0 ? 'ok' : 'warn',
          count: acaraSatuPeserta.length,
          details: acaraSatuPeserta,
        },
      ]

      const blok3 = [
        {
          label: 'Tiada heat dengan status lama (tidak_rasmi)',
          status: statusLama.length === 0 ? 'ok' : 'warn',
          count: statusLama.length,
          details: statusLama,
        },
      ]

      const totalError = [mismatch, dupBib, tidakLengkap, heatNoBibKosong, heatNoKPKosong, heatLorongDup]
        .reduce((sum, arr) => sum + arr.length, 0)
      const totalWarn = [noBibKosong, acaraSatuPeserta, statusLama]
        .reduce((sum, arr) => sum + arr.length, 0)

      setResult({
        kejohanan: kej.namaKejohanan || kejId,
        totalPendaftaran: pendList.length,
        totalAcara: acaraList.length,
        totalError,
        totalWarn,
        blok1,
        blok2,
        blok3,
        masa: new Date().toLocaleTimeString('ms-MY'),
      })
    } catch (e) {
      setResult({ error: 'Ralat semasa semak: ' + e.message })
    }
    setProgress('')
    setRunning(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-gray-800">Semak Kesihatan Sistem</h1>
          <p className="text-xs text-gray-500 mt-0.5">Semak integriti data — pendaftaran, heat, keputusan</p>
        </div>
        <button
          onClick={jalanSemak}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 bg-[#003399] text-white text-xs font-bold rounded-xl hover:bg-[#002288] disabled:opacity-50 transition-colors shrink-0"
        >
          {running ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
            </svg>
          )}
          {running ? 'Menyemak...' : 'Semak Sekarang'}
        </button>
      </div>

      {/* Progress */}
      {running && progress && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <p className="text-xs text-blue-700 font-medium">{progress}</p>
        </div>
      )}

      {/* Error */}
      {result?.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-sm font-medium text-red-700">{result.error}</p>
        </div>
      )}

      {/* Result */}
      {result && !result.error && (
        <>
          {/* Ringkasan */}
          <div className={`rounded-xl border px-4 py-4 ${
            result.totalError > 0 ? 'bg-red-50 border-red-200' :
            result.totalWarn  > 0 ? 'bg-amber-50 border-amber-200' :
            'bg-green-50 border-green-200'
          }`}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">
                {result.totalError > 0 ? '❌' : result.totalWarn > 0 ? '⚠️' : '✅'}
              </span>
              <div>
                <p className={`text-sm font-bold ${
                  result.totalError > 0 ? 'text-red-800' :
                  result.totalWarn  > 0 ? 'text-amber-800' :
                  'text-green-800'
                }`}>
                  {result.totalError > 0
                    ? `${result.totalError} ralat kritikal ditemui`
                    : result.totalWarn > 0
                    ? `Sistem OK — ${result.totalWarn} amaran`
                    : 'Sistem bersih — tiada isu ditemui'}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {result.kejohanan} · {result.totalPendaftaran} pendaftaran · {result.totalAcara} acara · Semak pada {result.masa}
                </p>
              </div>
            </div>
            <div className="flex gap-4 text-[11px]">
              <span className="text-red-700 font-semibold">{result.totalError} Ralat</span>
              <span className="text-amber-700 font-semibold">{result.totalWarn} Amaran</span>
              <span className="text-green-700 font-semibold">
                {result.blok1.filter(c => c.status === 'ok').length +
                 result.blok2.filter(c => c.status === 'ok').length +
                 result.blok3.filter(c => c.status === 'ok').length} Lulus
              </span>
            </div>
          </div>

          {/* Blok 1 */}
          <Section title="Blok 1 — Integriti Pendaftaran" checks={result.blok1} />

          {/* Blok 2 */}
          <Section title="Blok 2 — Integriti Heat" checks={result.blok2} />

          {/* Blok 3 */}
          <Section title="Blok 3 — Status Keputusan" checks={result.blok3} />

          {/* Nota */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-[11px] text-gray-500 leading-relaxed">
              <span className="font-semibold text-gray-600">Cara guna:</span> Jika ada ralat, salin butiran dan hantar kepada Claude untuk disahkan dan dibaiki.
              Health check ini hanya laporan — tiada perubahan data dibuat.
            </p>
          </div>
        </>
      )}

      {/* Idle state */}
      {!result && !running && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-8 text-center">
          <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
          </svg>
          <p className="text-sm font-medium text-gray-400">Tekan "Semak Sekarang" untuk mula</p>
          <p className="text-xs text-gray-300 mt-1">Semak akan mengambil masa 10–30 saat bergantung pada saiz data</p>
        </div>
      )}

    </div>
  )
}
