/**
 * ResetSistem.jsx — /dashboard/reset
 *
 * Reset data kejohanan secara selektif.
 * Admin pilih toggle → preview bilangan rekod → confirm → reset.
 *
 * Roles: superadmin sahaja
 */

import { useState, useEffect, useCallback } from 'react'
import {
  collection, getDocs, getDoc, doc, query, where,
  writeBatch, updateDoc, orderBy,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'

// ─── Konfigurasi Toggle ───────────────────────────────────────────────────────

const TOGGLES = [
  {
    id: 'pendaftaran',
    label: 'Pendaftaran Atlet',
    desc: 'Clear No. BIB semua atlet + padam rekod pendaftaran kejohanan',
    collections: ['atlet (field noBib)', 'kejohanan/.../pendaftaran'],
    level: 'sederhana', // safe | sederhana | bahaya
    icon: '👤',
  },
  {
    id: 'jadual',
    label: 'Jadual Acara',
    desc: 'Padam semua jadual acara (masa, lokasi, tarikh) untuk kejohanan ini',
    collections: ['jadual_acara'],
    level: 'sederhana',
    icon: '📅',
  },
  {
    id: 'keputusan',
    label: 'Keputusan & Heat',
    desc: 'Padam semua heat (termasuk keputusan & start list) + reset status acara + reset pengesahan PP ke Belum Sah',
    collections: ['kejohanan/.../acara/.../heat', 'bantahan', 'kejohanan/.../pengesahan'],
    level: 'bahaya',
    icon: '🏁',
  },
  {
    id: 'rekod_baru',
    label: 'Rekod Pecah Kejohanan',
    desc: 'Padam semua rekod baru yang dipecahkan semasa kejohanan ini (paparan "Rekod Baru" dalam Home)',
    collections: ['rekod (filter kejohananId)'],
    level: 'sederhana',
    icon: '📊',
  },
  {
    id: 'medal',
    label: 'Medal Tally',
    desc: 'Padam semua rekod kiraan pingat sekolah',
    collections: ['medal_tally'],
    level: 'sederhana',
    icon: '🏅',
  },
  {
    id: 'olahragawan',
    label: 'Mata & Pilihan Olahragawan/wati',
    desc: 'Padam mata individu atlet + pilihan Murid Terbaik admin',
    collections: ['mata_olahragawan', 'pilihan_olahragawan'],
    level: 'sederhana',
    icon: '🥇',
  },
  {
    id: 'acara',
    label: 'Setup Acara',
    desc: 'Padam semua setup acara + heat secara cascade (termasuk keputusan)',
    collections: ['kejohanan/.../acara (cascade)'],
    level: 'bahaya',
    icon: '📋',
  },
  {
    id: 'kategori',
    label: 'Kategori',
    desc: 'Padam semua kategori atlet (A, B, C, D, E, PPKI)',
    collections: ['kategori'],
    level: 'bahaya',
    icon: '🏷️',
  },
  {
    id: 'sekolah',
    label: 'Sekolah',
    desc: 'Padam semua rekod sekolah (untuk padam atlet juga, pilih togol Padam Master Atlet)',
    collections: ['sekolah'],
    level: 'bahaya',
    icon: '🏫',
  },
  {
    id: 'atlet',
    label: 'Padam Master Atlet',
    desc: 'Padam SEMUA rekod atlet dari sistem (noKP, nama, noBib). Tidak boleh undur!',
    collections: ['atlet'],
    level: 'bahaya',
    icon: '🗑️',
  },
]

const LEVEL_STYLE = {
  safe:     'bg-green-50  border-green-200  text-green-700',
  sederhana:'bg-amber-50  border-amber-200  text-amber-700',
  bahaya:   'bg-red-50    border-red-200    text-red-700',
}
const LEVEL_LABEL = { safe: 'Selamat', sederhana: 'Sederhana', bahaya: 'Bahaya' }

const PAKEJ = [
  {
    id: 'ringan',
    label: 'Reset Ringan',
    desc: 'BIB + Medal + Olahragawan',
    color: 'bg-green-600 hover:bg-green-700',
    toggles: ['pendaftaran', 'medal', 'olahragawan'],
  },
  {
    id: 'sederhana',
    label: 'Reset Sederhana',
    desc: 'BIB + Jadual + Keputusan + Medal + Olahragawan',
    color: 'bg-amber-500 hover:bg-amber-600',
    toggles: ['pendaftaran', 'jadual', 'keputusan', 'medal', 'olahragawan'],
  },
  {
    id: 'penuh',
    label: 'Reset Penuh',
    desc: 'Semua togol diaktifkan (termasuk sekolah + atlet)',
    color: 'bg-red-600 hover:bg-red-700',
    toggles: ['pendaftaran', 'jadual', 'keputusan', 'medal', 'olahragawan', 'acara', 'kategori', 'sekolah', 'atlet'],
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function batchDelete(refs) {
  if (!refs.length) return
  const SIZE = 400
  for (let i = 0; i < refs.length; i += SIZE) {
    const b = writeBatch(db)
    refs.slice(i, i + SIZE).forEach(r => b.delete(r))
    await b.commit()
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ResetSistem() {
  const { userData } = useAuth()

  const [kejId,    setKejId]    = useState('')
  const [namaKej,  setNamaKej]  = useState('')
  const [loading,  setLoading]  = useState(true)
  const [counts,   setCounts]   = useState({})       // toggleId → count
  const [selected, setSelected] = useState(new Set())
  const [confirm,  setConfirm]  = useState(false)
  const [typed,    setTyped]    = useState('')
  const [resetting,setResetting]= useState(false)
  const [progress, setProgress] = useState([])       // array of { text, done }
  const [done,     setDone]     = useState(false)
  const [msg,      setMsg]      = useState(null)

  // ── Load kejohanan + counts ──────────────────────────────────────────────

  const loadCounts = useCallback(async (kId) => {
    const c = {}
    try {
      // Pendaftaran — atlet dengan noBib + pendaftaran docs
      const [atletSnap, pendSnap] = await Promise.all([
        getDocs(query(collection(db, 'atlet'), where('noBib', '!=', ''))),
        getDocs(collection(db, 'kejohanan', kId, 'pendaftaran')),
      ])
      c.pendaftaran = atletSnap.size + pendSnap.size

      // Jadual
      const jadSnap = await getDocs(
        query(collection(db, 'jadual_acara'), where('kejohananId', '==', kId))
      )
      c.jadual = jadSnap.size

      // Keputusan & Heat — kira semua heat dari semua acara
      const acaraSnap = await getDocs(collection(db, 'kejohanan', kId, 'acara'))
      let heatCount = 0
      await Promise.all(acaraSnap.docs.map(async a => {
        const hSnap = await getDocs(collection(db, 'kejohanan', kId, 'acara', a.id, 'heat'))
        heatCount += hSnap.size
      }))
      const bantSnap = await getDocs(query(collection(db, 'bantahan'), where('kejohananId', '==', kId)))
      c.keputusan = heatCount + bantSnap.size

      // Rekod Baru Kejohanan
      const rekodBaruSnap = await getDocs(query(collection(db, 'rekod'), where('kejohananId', '==', kId)))
      c.rekod_baru = rekodBaruSnap.size

      // Medal
      const medalSnap = await getDocs(query(collection(db, 'medal_tally'), where('kejohananId', '==', kId)))
      c.medal = medalSnap.size

      // Olahragawan
      const [mataSnap, pilSnap] = await Promise.all([
        getDocs(query(collection(db, 'mata_olahragawan'), where('kejohananId', '==', kId))),
        getDocs(query(collection(db, 'pilihan_olahragawan'), where('kejohananId', '==', kId))),
      ])
      c.olahragawan = mataSnap.size + pilSnap.size

      // Acara setup
      c.acara = acaraSnap.size

      // Kategori
      const katSnap = await getDocs(collection(db, 'kategori'))
      c.kategori = katSnap.size

      // Sekolah
      const sekolahSnap = await getDocs(collection(db, 'sekolah'))
      c.sekolah = sekolahSnap.size

      // Atlet (master)
      const atletMasterSnap = await getDocs(collection(db, 'atlet'))
      c.atlet = atletMasterSnap.size

    } catch (e) { console.error('loadCounts:', e) }
    setCounts(c)
  }, [])

  useEffect(() => {
    async function init() {
      setLoading(true)
      try {
        const snap = await getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', '==', 'aktif')))
        if (!snap.empty) {
          const d = snap.docs[0]
          setKejId(d.id)
          setNamaKej(d.data().namaKejohanan || d.id)
          await loadCounts(d.id)
        }
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    init()
  }, [loadCounts])

  // ── Toggle & Pakej ────────────────────────────────────────────────────────

  function toggleItem(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function applyPakej(pakej) {
    setSelected(new Set(pakej.toggles))
  }

  // ── Jumlah rekod yang akan dipadam ────────────────────────────────────────

  const totalDipadam = [...selected].reduce((s, id) => s + (counts[id] || 0), 0)

  // ── Jalankan Reset ────────────────────────────────────────────────────────

  async function handleReset() {
    if (!kejId) return
    setResetting(true)
    setProgress([])
    setDone(false)

    const log = (text, done = false) => {
      setProgress(prev => [...prev, { text, done }])
    }

    try {
      // ── Pendaftaran ──
      if (selected.has('pendaftaran')) {
        log('Memuatkan data atlet…')
        const [atletSnap, pendSnap, counterSnap] = await Promise.all([
          getDocs(query(collection(db, 'atlet'), where('noBib', '!=', ''))),
          getDocs(collection(db, 'kejohanan', kejId, 'pendaftaran')),
          getDocs(query(collection(db, 'pendaftaran_counter'), where('kejohananId', '==', kejId))),
        ])
        // Clear noBib field — batch update
        const SIZE = 400
        const atletDocs = atletSnap.docs
        for (let i = 0; i < atletDocs.length; i += SIZE) {
          const b = writeBatch(db)
          atletDocs.slice(i, i + SIZE).forEach(d => {
            b.update(d.ref, { noBib: '', noBibPrefix: '', updatedAt: new Date() })
          })
          await b.commit()
        }
        // Delete pendaftaran docs + counter (supaya noBib mula semula dari 1)
        await Promise.all([
          batchDelete(pendSnap.docs.map(d => d.ref)),
          batchDelete(counterSnap.docs.map(d => d.ref)),
        ])
        log(`✓ Pendaftaran — ${atletDocs.length} BIB dikosongkan, ${pendSnap.size} rekod dipadam, ${counterSnap.size} counter diset semula`, true)
      }

      // ── Jadual ──
      if (selected.has('jadual')) {
        log('Memadam jadual acara…')
        const snap = await getDocs(query(collection(db, 'jadual_acara'), where('kejohananId', '==', kejId)))
        await batchDelete(snap.docs.map(d => d.ref))
        log(`✓ Jadual — ${snap.size} rekod dipadam`, true)
      }

      // ── Keputusan & Heat ──
      if (selected.has('keputusan')) {
        log('Memadam heat & keputusan…')
        const acaraSnap = await getDocs(collection(db, 'kejohanan', kejId, 'acara'))
        let heatTotal = 0
        await Promise.all(acaraSnap.docs.map(async aDoc => {
          const hSnap = await getDocs(collection(db, 'kejohanan', kejId, 'acara', aDoc.id, 'heat'))
          await batchDelete(hSnap.docs.map(d => d.ref))
          heatTotal += hSnap.size
          // Reset statusAcara
          await updateDoc(aDoc.ref, {
            statusAcara: 'akan_datang',
            updatedAt: new Date(),
          }).catch(() => {})
        }))
        const [bantSnap, pengesahanSnap] = await Promise.all([
          getDocs(query(collection(db, 'bantahan'), where('kejohananId', '==', kejId))),
          getDocs(collection(db, 'kejohanan', kejId, 'pengesahan')),
        ])
        await Promise.all([
          batchDelete(bantSnap.docs.map(d => d.ref)),
          batchDelete(pengesahanSnap.docs.map(d => d.ref)),
        ])
        log(`✓ Keputusan & Heat — ${heatTotal} heat dipadam, ${bantSnap.size} bantahan dipadam, ${pengesahanSnap.size} pengesahan PP diset semula`, true)
      }

      // ── Rekod Baru Kejohanan ──
      if (selected.has('rekod_baru')) {
        log('Memadam rekod pecah kejohanan…')
        const snap = await getDocs(query(collection(db, 'rekod'), where('kejohananId', '==', kejId)))
        await batchDelete(snap.docs.map(d => d.ref))
        log(`✓ Rekod Pecah Kejohanan — ${snap.size} rekod dipadam`, true)
      }

      // ── Medal ──
      if (selected.has('medal')) {
        log('Memadam medal tally…')
        const snap = await getDocs(query(collection(db, 'medal_tally'), where('kejohananId', '==', kejId)))
        await batchDelete(snap.docs.map(d => d.ref))
        log(`✓ Medal Tally — ${snap.size} rekod dipadam`, true)
      }

      // ── Olahragawan ──
      if (selected.has('olahragawan')) {
        log('Memadam mata & pilihan olahragawan…')
        const [mataSnap, pilSnap] = await Promise.all([
          getDocs(query(collection(db, 'mata_olahragawan'), where('kejohananId', '==', kejId))),
          getDocs(query(collection(db, 'pilihan_olahragawan'), where('kejohananId', '==', kejId))),
        ])
        await Promise.all([
          batchDelete(mataSnap.docs.map(d => d.ref)),
          batchDelete(pilSnap.docs.map(d => d.ref)),
        ])
        log(`✓ Olahragawan — ${mataSnap.size + pilSnap.size} rekod dipadam`, true)
      }

      // ── Acara Setup (cascade) ──
      if (selected.has('acara')) {
        log('Memadam setup acara (cascade heat)…')
        const acaraSnap = await getDocs(collection(db, 'kejohanan', kejId, 'acara'))
        let total = acaraSnap.size
        // Delete heats first (subcollection)
        await Promise.all(acaraSnap.docs.map(async aDoc => {
          const hSnap = await getDocs(collection(db, 'kejohanan', kejId, 'acara', aDoc.id, 'heat'))
          await batchDelete(hSnap.docs.map(d => d.ref))
          total += hSnap.size
        }))
        await batchDelete(acaraSnap.docs.map(d => d.ref))
        log(`✓ Acara Setup — ${total} rekod dipadam (cascade)`, true)
      }

      // ── Kategori ──
      if (selected.has('kategori')) {
        log('Memadam kategori…')
        const snap = await getDocs(collection(db, 'kategori'))
        await batchDelete(snap.docs.map(d => d.ref))
        log(`✓ Kategori — ${snap.size} rekod dipadam`, true)
      }

      // ── Sekolah ──
      if (selected.has('sekolah')) {
        log('Memadam sekolah…')
        const snap = await getDocs(collection(db, 'sekolah'))
        await batchDelete(snap.docs.map(d => d.ref))
        log(`✓ Sekolah — ${snap.size} rekod dipadam`, true)
      }

      // ── Padam Master Atlet ──
      if (selected.has('atlet')) {
        log('Memadam semua rekod atlet…')
        const snap = await getDocs(collection(db, 'atlet'))
        await batchDelete(snap.docs.map(d => d.ref))
        log(`✓ Master Atlet — ${snap.size} rekod dipadam`, true)
      }

      // ── Audit log ──
      log('Menyimpan log audit…')
      try {
        const { addDoc, serverTimestamp } = await import('firebase/firestore')
        await addDoc(collection(db, 'log_reset'), {
          kejohananId: kejId,
          namaKejohanan: namaKej,
          toggles: [...selected],
          diResetOleh: userData?.uid || userData?.email || 'unknown',
          diResetPada: serverTimestamp(),
          jumlahDipadam: totalDipadam,
        })
      } catch {}
      log('✓ Log audit disimpan', true)

      setDone(true)
      setMsg({ type: 'ok', text: `Reset selesai. ${totalDipadam} rekod telah dipadam/dikosongkan.` })
      // Refresh counts
      await loadCounts(kejId)
    } catch (e) {
      log(`✗ Ralat: ${e.message}`, true)
      setMsg({ type: 'err', text: 'Reset gagal: ' + e.message })
    } finally {
      setResetting(false)
      setConfirm(false)
      setTyped('')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-400 text-sm">
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
        Memuatkan…
      </div>
    )
  }

  if (!kejId) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <p className="text-2xl mb-2">⚠️</p>
          <p className="text-sm font-bold text-amber-800">Tiada kejohanan aktif.</p>
          <p className="text-xs text-amber-600 mt-1">Reset sistem hanya boleh dilakukan semasa ada kejohanan aktif.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-800">Reset Sistem</h1>
          <p className="text-xs text-gray-500 mt-0.5">Pilih data yang ingin direset untuk kejohanan baru</p>
          <div className="mt-1 inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            <p className="text-[10px] font-bold text-[#003399]">{namaKej}</p>
          </div>
        </div>
      </div>

      {/* Amaran */}
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
        <p className="text-xs font-bold text-red-700 mb-1">⚠ Amaran Penting</p>
        <p className="text-[11px] text-red-600 leading-relaxed">
          Tindakan reset <strong>tidak boleh dibatalkan</strong>. Data yang dipadam akan hilang selama-lamanya.
          Sila pastikan anda telah membuat <strong>backup</strong> atau eksport data penting sebelum teruskan.
        </p>
      </div>

      {/* Pakej pantas */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Pakej Pantas</p>
        <div className="grid grid-cols-3 gap-2">
          {PAKEJ.map(p => (
            <button
              key={p.id}
              onClick={() => applyPakej(p)}
              className={`${p.color} text-white text-xs font-bold rounded-lg px-3 py-2.5 text-left transition-colors`}
            >
              <p>{p.label}</p>
              <p className="text-[9px] font-normal opacity-80 mt-0.5">{p.desc}</p>
            </button>
          ))}
        </div>
        <button
          onClick={() => setSelected(new Set())}
          className="mt-2 text-[10px] text-gray-400 hover:text-gray-600 underline"
        >
          Kosongkan semua pilihan
        </button>
      </div>

      {/* Senarai Toggle */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            Pilih Data untuk Direset
          </p>
        </div>

        <div className="divide-y divide-gray-50">
          {TOGGLES.map(t => {
            const isOn    = selected.has(t.id)
            const count   = counts[t.id] ?? '…'
            const lvlCls  = LEVEL_STYLE[t.level]

            return (
              <div
                key={t.id}
                onClick={() => toggleItem(t.id)}
                className={`flex items-start gap-4 px-4 py-4 cursor-pointer transition-colors ${
                  isOn ? 'bg-red-50/60' : 'hover:bg-gray-50/60'
                }`}
              >
                {/* Toggle switch */}
                <div className={`mt-0.5 w-10 h-5 rounded-full flex items-center px-0.5 transition-colors shrink-0 ${
                  isOn ? 'bg-red-500 justify-end' : 'bg-gray-200 justify-start'
                }`}>
                  <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">{t.icon}</span>
                    <span className={`text-xs font-bold ${isOn ? 'text-red-700' : 'text-gray-800'}`}>
                      {t.label}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${lvlCls}`}>
                      {LEVEL_LABEL[t.level]}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{t.desc}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 font-mono">
                    {t.collections.join(' · ')}
                  </p>
                </div>

                {/* Count */}
                <div className={`text-right shrink-0 ${isOn ? 'text-red-600' : 'text-gray-400'}`}>
                  <p className={`text-lg font-black leading-none ${isOn ? 'text-red-600' : 'text-gray-500'}`}>
                    {count}
                  </p>
                  <p className="text-[9px]">rekod</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Mesej */}
      {msg && (
        <div className={`px-4 py-3 rounded-lg text-xs font-medium border ${
          msg.type === 'ok'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      {/* Progress log (selepas reset) */}
      {progress.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 space-y-1.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Log Reset</p>
          {progress.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              {p.done ? (
                <span className="text-[10px]">{p.text.startsWith('✓') ? '✅' : p.text.startsWith('✗') ? '❌' : '⚙️'}</span>
              ) : (
                <svg className="w-3 h-3 animate-spin text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              )}
              <p className="text-[11px] font-mono text-gray-300">{p.text}</p>
            </div>
          ))}
          {done && (
            <p className="text-[11px] font-bold text-green-400 mt-2 pt-2 border-t border-gray-700">
              ✅ Selesai. Sila buat kejohanan baru melalui Setup Kejohanan.
            </p>
          )}
        </div>
      )}

      {/* Summary + Butang Reset */}
      <div className={`rounded-xl border p-4 ${
        selected.size > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-bold text-gray-700">
              {selected.size} komponen dipilih
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Anggaran {totalDipadam} rekod akan dipadam/dikosongkan
            </p>
          </div>
          {selected.size > 0 && (
            <div className="flex gap-1 flex-wrap justify-end">
              {[...selected].map(id => {
                const t = TOGGLES.find(x => x.id === id)
                return (
                  <span key={id} className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">
                    {t?.icon} {t?.label}
                  </span>
                )
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => { setConfirm(true); setTyped('') }}
          disabled={selected.size === 0 || resetting}
          className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-xs font-bold rounded-lg transition-colors"
        >
          {resetting ? 'Memproses…' : `🗑 Reset ${selected.size} Komponen`}
        </button>
      </div>

      {/* ── Modal Confirm ─────────────────────────────────────────────────── */}
      {confirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">

            <div className="bg-red-600 px-5 py-4">
              <p className="text-sm font-bold text-white">⚠ Pengesahan Reset</p>
              <p className="text-[11px] text-red-100 mt-0.5">
                Tindakan ini tidak boleh dibatalkan
              </p>
            </div>

            <div className="p-5 space-y-4">
              {/* Senarai apa akan dipadam */}
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide mb-1.5">
                  Akan dipadam/dikosongkan:
                </p>
                {[...selected].map(id => {
                  const t = TOGGLES.find(x => x.id === id)
                  return (
                    <div key={id} className="flex items-center justify-between">
                      <span className="text-[11px] text-red-700">{t?.icon} {t?.label}</span>
                      <span className="text-[11px] font-bold text-red-600">{counts[id] || 0} rekod</span>
                    </div>
                  )
                })}
                <div className="border-t border-red-200 mt-2 pt-2 flex justify-between">
                  <span className="text-[11px] font-bold text-red-800">Jumlah</span>
                  <span className="text-[11px] font-bold text-red-800">{totalDipadam} rekod</span>
                </div>
              </div>

              {/* Taip nama kejohanan */}
              <div>
                <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                  Taip nama kejohanan untuk sahkan:
                </label>
                <p className="text-[11px] text-gray-400 font-mono mb-2 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                  {namaKej}
                </p>
                <input
                  type="text"
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  placeholder="Taip nama kejohanan di sini…"
                  autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/25 focus:border-red-400 bg-gray-50"
                />
                {typed && typed !== namaKej && (
                  <p className="text-[10px] text-red-500 mt-1">Nama tidak sepadan.</p>
                )}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
              <button
                onClick={() => { setConfirm(false); setTyped('') }}
                className="flex-1 py-2 border border-gray-200 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={handleReset}
                disabled={typed !== namaKej || resetting}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-xs font-bold rounded-lg transition-colors"
              >
                {resetting ? 'Memproses…' : '🗑 Sahkan Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
