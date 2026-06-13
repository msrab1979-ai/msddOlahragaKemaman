/**
 * MuatTurunSijil — /dashboard/muaturunsijil
 * Superadmin / Admin: muat turun e-sijil
 *   Tab 1 — By Sekolah: pilih sekolah → ZIP semua atlet sekolah itu
 *   Tab 2 — Semua Atlet: jana ZIP semua atlet seluruh kejohanan
 */

import { useState, useEffect } from 'react'
import {
  collection, getDocs, doc, getDoc, query, where, orderBy,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { janaSijilPDF, namaFail } from '../../utils/sijilUtils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner({ size = 'w-5 h-5' }) {
  return (
    <svg className={`${size} animate-spin text-[#003399]`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MuatTurunSijil() {
  const [tab, setTab] = useState('sekolah')  // 'sekolah' | 'semua'

  // Shared state
  const [sijilCfg, setSijilCfg] = useState(null)
  const [kejohanan, setKejohanan] = useState(null)
  const [loadingInit, setLoadingInit] = useState(true)
  const [errInit, setErrInit] = useState('')

  // Tab 1 — by sekolah
  const [sekolahList, setSekolahList] = useState([])
  const [pilihan, setPilihan] = useState('')
  const [cariSkl, setCariSkl] = useState('')
  const [atletSkl, setAtletSkl] = useState([])
  const [loadingSkl, setLoadingSkl] = useState(false)
  const [zippingSkl, setZippingSkl] = useState(false)

  // Tab 2 — semua atlet
  const [progSemua, setProgSemua] = useState(null)  // null | { done, total }
  const [zippingSemua, setZippingSemua] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    setLoadingInit(true); setErrInit('')
    try {
      // Tetapan sijil
      const sijilSnap = await getDoc(doc(db, 'tetapan', 'sijil'))
      if (!sijilSnap.exists() || !sijilSnap.data().templateImg) {
        setErrInit('Tetapan sijil belum dikonfigurasi. Pergi ke Setup E-Sijil dahulu.')
        setLoadingInit(false)
        return
      }
      setSijilCfg(sijilSnap.data())

      // Kejohanan aktif
      const kejSnap = await getDocs(
        query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif'))
      )
      if (kejSnap.empty) {
        setErrInit('Tiada kejohanan aktif pada masa ini.')
        setLoadingInit(false)
        return
      }
      const kej = { id: kejSnap.docs[0].id, ...kejSnap.docs[0].data() }
      setKejohanan(kej)

      // Senarai sekolah aktif
      const sklSnap = await getDocs(collection(db, 'sekolah'))
      const skl = sklSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.isAktif !== false)
        .sort((a, b) => (a.namaSekolah || a.id).localeCompare(b.namaSekolah || b.id))
      setSekolahList(skl)
    } catch (e) {
      setErrInit('Ralat: ' + e.message)
    }
    setLoadingInit(false)
  }

  // ─── Tab 1: load atlet apabila sekolah dipilih ──────────────────────────────

  useEffect(() => {
    if (!pilihan || !kejohanan) { setAtletSkl([]); return }
    loadAtletSekolah(pilihan)
  }, [pilihan, kejohanan])

  async function loadAtletSekolah(kodSekolah) {
    setLoadingSkl(true)
    try {
      const atletSnap = await getDocs(
        query(collection(db, 'atlet'), where('kodSekolah', '==', kodSekolah))
      )
      const pendSnap = await getDocs(
        query(collection(db, 'kejohanan', kejohanan.id, 'pendaftaran'), where('kodSekolah', '==', kodSekolah))
      )
      const bibMap = {}
      pendSnap.docs.forEach(d => { bibMap[d.id] = d.data().noBib || '' })

      const list = atletSnap.docs.map(d => ({
        noKP:  d.id,
        nama:  d.data().nama || d.id,
        noBib: bibMap[d.id] || '',
      })).sort((a, b) => a.nama.localeCompare(b.nama))

      setAtletSkl(list)
    } catch (e) {
      setAtletSkl([])
    }
    setLoadingSkl(false)
  }

  // ─── Tab 1: ZIP sekolah ──────────────────────────────────────────────────────

  async function muatTurunSekolah() {
    if (!sijilCfg || atletSkl.length === 0 || !pilihan) return
    setZippingSkl(true)
    try {
      const sklInfo = sekolahList.find(s => s.id === pilihan)
      const namaSekolah = (sklInfo?.namaSekolah || pilihan).replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').toUpperCase()
      const zip = new JSZip()
      for (const atlet of atletSkl) {
        const pdf = janaSijilPDF(atlet.nama, sijilCfg)
        zip.file(namaFail(atlet.nama, atlet.noBib), pdf.output('blob'))
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const nama = `SIJIL_${namaSekolah}_${(kejohanan?.namaKejohanan || kejohanan?.tahun || '').replace(/[^a-zA-Z0-9]/g, '_')}.zip`
      saveAs(content, nama)
    } catch (e) {
      alert('Ralat menjana ZIP: ' + e.message)
    }
    setZippingSkl(false)
  }

  // ─── Tab 2: ZIP semua atlet ──────────────────────────────────────────────────

  async function muatTurunSemua() {
    if (!sijilCfg || !kejohanan) return
    setZippingSemua(true)
    setProgSemua({ done: 0, total: 0 })
    try {
      const atletSnap = await getDocs(collection(db, 'atlet'))
      const atletAll = atletSnap.docs.map(d => ({ noKP: d.id, nama: d.data().nama || d.id }))

      // Ambil bibMap dari pendaftaran
      const pendSnap = await getDocs(collection(db, 'kejohanan', kejohanan.id, 'pendaftaran'))
      const bibMap = {}
      pendSnap.docs.forEach(d => { bibMap[d.id] = d.data().noBib || '' })

      const total = atletAll.length
      setProgSemua({ done: 0, total })

      const zip = new JSZip()
      let done = 0
      for (const atlet of atletAll) {
        const pdf = janaSijilPDF(atlet.nama, sijilCfg)
        zip.file(namaFail(atlet.nama, bibMap[atlet.noKP] || ''), pdf.output('blob'))
        done++
        setProgSemua({ done, total })
      }

      const content = await zip.generateAsync({ type: 'blob' })
      const nama = `SIJIL_SEMUA_${(kejohanan?.namaKejohanan || kejohanan?.tahun || 'KEJ').replace(/[^a-zA-Z0-9]/g, '_')}.zip`
      saveAs(content, nama)
    } catch (e) {
      alert('Ralat menjana ZIP: ' + e.message)
    }
    setZippingSemua(false)
    setProgSemua(null)
  }

  // ─── Sekolah dropdown filter ─────────────────────────────────────────────────

  const filteredSkl = cariSkl.trim()
    ? sekolahList.filter(s =>
        (s.namaSekolah || s.id).toLowerCase().includes(cariSkl.toLowerCase()) ||
        s.id.toLowerCase().includes(cariSkl.toLowerCase())
      )
    : sekolahList

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (loadingInit) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <Spinner size="w-8 h-8" />
          <p className="text-xs text-gray-500 mt-2">Memuatkan...</p>
        </div>
      </div>
    )
  }

  if (errInit) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-amber-800 mb-1">Tidak dapat memuatkan</p>
          <p className="text-xs text-amber-700">{errInit}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-base font-bold text-gray-800">Muat Turun Sijil</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {sijilCfg?.namaKejohanan || kejohanan?.namaKejohanan || '—'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-lg w-fit">
        {[
          { key: 'sekolah', label: 'Mengikut Sekolah' },
          { key: 'semua',   label: 'Semua Atlet' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              tab === t.key
                ? 'bg-white text-[#003399] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab 1: By Sekolah ─────────────────────────────────────────────────── */}
      {tab === 'sekolah' && (
        <div className="space-y-4">
          {/* Cari sekolah */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="block text-xs font-semibold text-gray-700 mb-2">Pilih Sekolah</label>
            <input
              type="text"
              value={cariSkl}
              onChange={e => { setCariSkl(e.target.value); setPilihan('') }}
              placeholder="Taip nama atau kod sekolah..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#003399]/30 mb-2"
            />
            {filteredSkl.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                {filteredSkl.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setPilihan(s.id); setCariSkl(s.namaSekolah || s.id) }}
                    className={`w-full text-left px-3 py-2.5 text-xs border-b border-gray-100 last:border-0 transition-colors ${
                      pilihan === s.id
                        ? 'bg-blue-50 text-[#003399] font-semibold'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    {s.namaSekolah || s.id}
                  </button>
                ))}
              </div>
            )}
            {cariSkl && filteredSkl.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-3">Tiada sekolah dijumpai</p>
            )}
          </div>

          {/* Senarai atlet + butang download */}
          {pilihan && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-gray-700">{cariSkl}</p>
                  {loadingSkl
                    ? <p className="text-[10px] text-gray-400 mt-0.5">Memuatkan atlet...</p>
                    : <p className="text-[10px] text-gray-400 mt-0.5">{atletSkl.length} atlet</p>
                  }
                </div>
                {!loadingSkl && atletSkl.length > 0 && (
                  <button
                    onClick={muatTurunSekolah}
                    disabled={zippingSkl}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#003399] text-white rounded-lg text-xs font-semibold hover:bg-[#002288] transition-colors disabled:opacity-50"
                  >
                    {zippingSkl ? <Spinner size="w-3.5 h-3.5" /> : '📦'}
                    {zippingSkl ? 'Menjana...' : 'Muat Turun ZIP'}
                  </button>
                )}
              </div>

              {loadingSkl ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner />
                </div>
              ) : atletSkl.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-xs text-gray-400">Tiada atlet berdaftar untuk sekolah ini</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                  {atletSkl.map((a, i) => (
                    <div key={a.noKP} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-[10px] text-gray-300 w-5 text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{a.nama}</p>
                        {a.noBib && (
                          <span className="text-[10px] font-mono text-gray-400">{a.noBib}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab 2: Semua Atlet ────────────────────────────────────────────────── */}
      {tab === 'semua' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-[#003399] rounded-xl flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-800">Muat Turun Semua Atlet</p>
              <p className="text-xs text-gray-500 mt-1">
                Jana satu fail ZIP mengandungi sijil PDF untuk <strong>semua atlet</strong> yang berdaftar dalam kejohanan ini.
              </p>
              <p className="text-[11px] text-amber-600 mt-2 bg-amber-50 rounded-lg px-3 py-2">
                Proses ini mungkin mengambil masa beberapa minit bergantung kepada bilangan atlet.
              </p>
            </div>
          </div>

          {/* Progress bar */}
          {progSemua && (
            <div className="mt-4">
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span>Menjana sijil...</span>
                <span>{progSemua.done} / {progSemua.total}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-[#003399] h-2 rounded-full transition-all duration-200"
                  style={{ width: progSemua.total > 0 ? `${(progSemua.done / progSemua.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )}

          <button
            onClick={muatTurunSemua}
            disabled={zippingSemua}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#003399] text-white rounded-xl text-sm font-semibold hover:bg-[#002288] transition-colors disabled:opacity-50"
          >
            {zippingSemua ? <Spinner size="w-4 h-4" /> : '📦'}
            {zippingSemua ? 'Sedang menjana ZIP...' : 'Jana & Muat Turun ZIP Semua Atlet'}
          </button>
        </div>
      )}
    </div>
  )
}
