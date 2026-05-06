/**
 * JadualSetup — /dashboard/jadual
 *
 * Feature:
 *  1. Semak Padanan — cek acara dalam AcaraSetup vs JadualSetup
 *  2. Bilangan Heat  — kolum heat count actual per acara
 *  3. Smart Renumber — bila tukar hari, No Acara auto-renumber (1xx→2xx)
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  collection, getDocs, doc, setDoc, deleteDoc, updateDoc, getDoc,
  serverTimestamp, query, orderBy, where, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
// ─── Konstanta ────────────────────────────────────────────────────────────────

// Padam semua acara + jadual_acara bagi sesebuah kejohanan
async function deleteAllAcara(kejohananId, onLog = console.log) {
  if (!kejohananId) return
  onLog(`⚠️ Padam SEMUA acara + jadual untuk kejohanan: ${kejohananId}`)
  const BATCH = 400
  const acaraSnap = await getDocs(collection(db, 'kejohanan', kejohananId, 'acara'))
  let b = writeBatch(db), n = 0
  for (const d of acaraSnap.docs) {
    b.delete(d.ref); n++
    if (n % BATCH === 0) { await b.commit(); b = writeBatch(db) }
  }
  if (n % BATCH !== 0) await b.commit()
  const jSnap = await getDocs(query(collection(db, 'jadual_acara'), where('kejohananId', '==', kejohananId)))
  let jb = writeBatch(db), jn = 0
  for (const d of jSnap.docs) {
    jb.delete(d.ref); jn++
    if (jn % BATCH === 0) { await jb.commit(); jb = writeBatch(db) }
  }
  if (jn % BATCH !== 0) await jb.commit()
  onLog(`🗑️ Padam ${n} acara + ${jn} jadual_acara`)
}

const STATUS_ACARA = {
  tidak_rasmi:    { label: 'Tidak Rasmi',   cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  rasmi:          { label: 'Rasmi',          cls: 'bg-green-100 text-green-700 border-green-300' },
  dalam_bantahan: { label: 'Dalam Bantahan', cls: 'bg-red-100 text-red-700 border-red-300' },
}

const JENIS_DOT = {
  lorong:        'bg-blue-400',
  mass_start:    'bg-cyan-400',
  padang_lompat: 'bg-green-400',
  padang_balin:  'bg-orange-400',
  relay:         'bg-purple-400',
}

const LOKASI_OPTIONS = [
  'Trek Utama', 'Trek B',
  'Padang A', 'Padang B', 'Padang C', 'Padang D',
  'Padang Tengah', 'Lain-lain',
]

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMasa(masa) {
  if (!masa) return '—'
  const [h, m] = masa.split(':')
  const hr = parseInt(h)
  const ampm = hr >= 12 ? 'ptg' : 'pagi'
  const hr12 = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr
  return `${hr12}:${m} ${ampm}`
}

function formatTarikh(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ms-MY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// Bina acaraMap dengan index berbilang kunci untuk cover variasi seed lama/baru
function buildAcaraMap(acaraSnap) {
  const map = {}
  acaraSnap.docs.forEach(d => {
    const data = d.data()
    map[d.id] = data
    if (data.aceraId) map[data.aceraId] = data
    if (data.noAcara) map[data.noAcara] = data
    if (data.acaraId) map[data.acaraId] = data
  })
  return map
}

function getJoinKey(jadual) {
  return jadual.aceraId || jadual.acaraId || null
}

// ─── Komponen kecil ───────────────────────────────────────────────────────────

function StatusBadge({ statusAcara }) {
  const cfg = STATUS_ACARA[statusAcara]
  if (!cfg) return null
  return (
    <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

function HeatBadge({ count, hasFinal, loading }) {
  if (loading) return <span className="text-[10px] text-gray-300 font-mono">…</span>
  if (count === 0) return <span className="text-[10px] text-gray-300">—</span>
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
      hasFinal ? 'bg-purple-100 text-purple-700' : 'bg-blue-50 text-blue-700'
    }`}>
      {hasFinal ? '⭐' : '🔥'} {count}
    </span>
  )
}

// ─── Panel Semak Padanan ──────────────────────────────────────────────────────

function PadananPanel({ data, onClose, onTetapkan }) {
  if (!data) return null
  const { missing, orphan } = data
  const allOk = missing.length === 0 && orphan.length === 0

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className={`px-4 py-3 flex items-center justify-between border-b ${
        allOk ? 'bg-green-50 border-green-100' : 'bg-amber-50 border-amber-100'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-base">{allOk ? '✅' : '⚠️'}</span>
          <div>
            <p className={`text-xs font-black ${allOk ? 'text-green-800' : 'text-amber-800'}`}>
              Semak Padanan — AcaraSetup ↔ JadualSetup
            </p>
            <p className={`text-[10px] mt-0.5 ${allOk ? 'text-green-600' : 'text-amber-600'}`}>
              {allOk
                ? 'Semua acara telah dijadualkan dengan betul'
                : `${missing.length} acara tiada jadual · ${orphan.length} jadual tiada dalam AcaraSetup`}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
      </div>

      {allOk ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-green-700 font-semibold">Tiada masalah padanan ditemui.</p>
          <p className="text-[11px] text-gray-400 mt-1">Bilangan acara dalam AcaraSetup dan JadualSetup adalah sama.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">

          {/* Tiada Jadual */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
              <p className="text-[10px] font-black text-red-700 uppercase tracking-wide">
                Tiada Jadual ({missing.length})
              </p>
            </div>
            {missing.length === 0
              ? <p className="text-[11px] text-green-600 font-semibold py-1">✓ Semua acara telah dijadualkan</p>
              : <div className="space-y-0.5 max-h-52 overflow-y-auto pr-1">
                  {missing.map((a, i) => {
                    const key = a.noAcara || a.aceraId || a._docId
                    return (
                      <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-[11px] font-black font-mono text-[#003399] w-8 shrink-0">{key}</span>
                        <span className="text-[11px] text-gray-700 flex-1 min-w-0 truncate">
                          {a.namaAcaraPendek || a.namaAcara}
                          <span className="text-gray-400 ml-1">{a.kelas}</span>
                        </span>
                        <button
                          onClick={() => onTetapkan(a)}
                          className="shrink-0 text-[9px] font-bold text-white bg-[#003399] hover:bg-[#002288] px-2 py-0.5 rounded transition-colors"
                        >
                          + Jadual
                        </button>
                      </div>
                    )
                  })}
                </div>
            }
          </div>

          {/* Jadual Yatim */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
              <p className="text-[10px] font-black text-orange-700 uppercase tracking-wide">
                Jadual Tanpa Acara ({orphan.length})
              </p>
            </div>
            {orphan.length === 0
              ? <p className="text-[11px] text-green-600 font-semibold py-1">✓ Semua jadual sah</p>
              : <div className="space-y-0.5 max-h-52 overflow-y-auto pr-1">
                  {orphan.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-0">
                      <span className="text-[11px] font-black font-mono text-orange-600 w-8 shrink-0">{r.noAcara}</span>
                      <span className="text-[11px] text-gray-700 flex-1 min-w-0 truncate">
                        {r.namaAcaraPendek}
                        <span className="text-gray-400 ml-1">{r.kelas}</span>
                      </span>
                      <span className="text-[9px] text-orange-500 font-semibold shrink-0 bg-orange-50 px-1.5 py-0.5 rounded">
                        Yatim
                      </span>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Modal Tetapkan Jadual ────────────────────────────────────────────────────

function TetapkanModal({ kejohananId, acaraList, prefillAcara, onClose, onSaved }) {
  const [form, setForm] = useState({
    aceraId:     prefillAcara ? String(prefillAcara.noAcara || prefillAcara.aceraId || prefillAcara._docId || '') : '',
    tarikhAcara: '',
    masaMula:    '08:00',
    lokasi:      LOKASI_OPTIONS[0],
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const selectedAcara = acaraList.find(a => String(a.aceraId || a.noAcara || a.id) === form.aceraId)

  async function handleSave() {
    setErr('')
    if (!form.aceraId)     return setErr('Pilih acara.')
    if (!form.tarikhAcara) return setErr('Tarikh wajib diisi.')
    if (!form.masaMula)    return setErr('Masa wajib diisi.')

    const noAcara = form.aceraId
    const docId   = `${kejohananId}-${noAcara}`
    setSaving(true)
    try {
      await setDoc(doc(db, 'jadual_acara', docId), {
        jadualId:    docId,
        aceraId:     noAcara,
        acaraId:     noAcara,
        noAcara:     noAcara,
        kejohananId,
        tarikhAcara: form.tarikhAcara,
        masaMula:    form.masaMula,
        lokasi:      form.lokasi,
        namaAcara:   selectedAcara
          ? `${selectedAcara.namaAcaraPendek || selectedAcara.namaAcara} ${selectedAcara.kelas || ''}`.trim()
          : '',
        statusJadual: 'aktif',
        hari:         selectedAcara?.hari || null,
        sesi:         selectedAcara?.sesi || null,
        createdAt:    serverTimestamp(),
        updatedAt:    serverTimestamp(),
      }, { merge: true })
      onSaved()
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-800">Tetapkan Jadual</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              Acara <span className="text-red-400">*</span>
            </label>
            <select value={form.aceraId} onChange={e => set('aceraId', e.target.value)} className={inputCls}>
              <option value="">— Pilih Acara —</option>
              {acaraList
                .sort((a, b) => Number(a.aceraId || a.noAcara || 0) - Number(b.aceraId || b.noAcara || 0))
                .map(a => {
                  const key = a.aceraId || a.noAcara || a.id
                  return (
                    <option key={key} value={key}>
                      [{key}] {a.namaAcaraPendek || a.namaAcara} {a.kelas || ''}
                    </option>
                  )
                })}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Tarikh <span className="text-red-400">*</span>
              </label>
              <input type="date" value={form.tarikhAcara} onChange={e => set('tarikhAcara', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Masa Mula <span className="text-red-400">*</span>
              </label>
              <input type="time" value={form.masaMula} onChange={e => set('masaMula', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Lokasi</label>
            <select value={form.lokasi} onChange={e => set('lokasi', e.target.value)} className={inputCls}>
              {LOKASI_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Batal</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50">
            {saving ? 'Menyimpan…' : 'Tetapkan'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Tukar Hari (Bundle) ────────────────────────────────────────────────

function formatTarikhPanjang(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function TukarHariModal({ hari, tarikhAsal, rowsInHari, kejohananId, onClose, onSaved }) {
  const [tarikhBaru, setTarikhBaru] = useState(tarikhAsal || '')
  const [saving, setSaving]         = useState(false)
  const [progress, setProgress]     = useState(0)
  const [err, setErr]               = useState('')

  const jumlah = rowsInHari.length

  async function handleSave() {
    setErr('')
    if (!tarikhBaru) return setErr('Tarikh wajib diisi.')
    if (tarikhBaru === tarikhAsal) return setErr('Tarikh sama dengan asal. Tiada perubahan.')
    setSaving(true)
    setProgress(0)
    try {
      let done = 0
      for (const row of rowsInHari) {
        await updateDoc(doc(db, 'jadual_acara', row.jadualId), {
          tarikhAcara: tarikhBaru,
          updatedAt:   serverTimestamp(),
        })
        // Sync ke acara subcollection supaya AcaraSetup & JadualSetup sentiasa selari
        try {
          await updateDoc(
            doc(db, 'kejohanan', kejohananId, 'acara', String(row.noAcara)),
            { tarikhAcara: tarikhBaru, updatedAt: serverTimestamp() }
          )
        } catch { /* acara doc mungkin tiada — abaikan */ }
        done++
        setProgress(done)
      }
      onSaved()
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 bg-[#003399] rounded-t-xl flex items-center justify-between">
          <div>
            <h2 className="text-sm font-black text-white">Tukar Tarikh — Hari {hari}</h2>
            <p className="text-[10px] text-blue-200 mt-0.5">{jumlah} acara akan dikemaskini</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Tarikh Asal</p>
              <p className="text-xs font-bold text-gray-700">{formatTarikhPanjang(tarikhAsal)}</p>
              <p className="text-[10px] font-mono text-gray-400 mt-0.5">{tarikhAsal || '—'}</p>
            </div>
            <div className={`rounded-xl p-3 border ${tarikhBaru && tarikhBaru !== tarikhAsal ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-1">Tarikh Baru</p>
              <p className={`text-xs font-bold ${tarikhBaru && tarikhBaru !== tarikhAsal ? 'text-[#003399]' : 'text-gray-400'}`}>
                {tarikhBaru ? formatTarikhPanjang(tarikhBaru) : 'Belum dipilih'}
              </p>
              <p className="text-[10px] font-mono text-gray-400 mt-0.5">{tarikhBaru || '—'}</p>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              Pilih Tarikh Baru <span className="text-red-400">*</span>
            </label>
            <input type="date" value={tarikhBaru}
              onChange={e => { setTarikhBaru(e.target.value); setErr('') }}
              className={inputCls} autoFocus />
          </div>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
              Acara yang akan dikemaskini ({jumlah})
            </p>
            <div className="max-h-36 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
              {rowsInHari.map((r, i) => (
                <div key={r.jadualId || i} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="text-[10px] font-black text-[#003399] font-mono w-8">{r.noAcara}</span>
                  <span className="text-[10px] font-semibold text-gray-700 flex-1">{r.namaAcaraPendek}</span>
                  <span className="text-[9px] text-gray-400">{r.masaMula}</span>
                </div>
              ))}
            </div>
          </div>
          {saving && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] text-gray-500">Mengemas kini…</p>
                <p className="text-[10px] font-mono text-[#003399]">{progress}/{jumlah}</p>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div className="bg-[#003399] h-1.5 rounded-full transition-all"
                  style={{ width: `${jumlah > 0 ? (progress / jumlah) * 100 : 0}%` }} />
              </div>
            </div>
          )}
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">
            Batal
          </button>
          <button onClick={handleSave} disabled={saving || !tarikhBaru}
            className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50">
            {saving ? `Menyimpan ${progress}/${jumlah}…` : `Kemaskini ${jumlah} Acara`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Edit Jadual — dengan Smart Renumber ────────────────────────────────

function EditModal({ row, onClose, onSaved, allRows, kejId }) {
  const [form, setForm] = useState({
    tarikhAcara: row.tarikhAcara || '',
    masaMula:    row.masaMula    || '08:00',
    lokasi:      row.lokasi      || LOKASI_OPTIONS[0],
  })
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState('')
  const [renumber, setRenumber]   = useState(false)
  const [heatCount, setHeatCount] = useState(null) // null = loading

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // date → hari mapping (dari semua rows)
  const dateToHari = useMemo(() => {
    const m = {}
    allRows.forEach(r => { if (r.tarikhAcara && r.hari) m[r.tarikhAcara] = Number(r.hari) })
    return m
  }, [allRows])

  const currentHari = Number(row.hari) || dateToHari[row.tarikhAcara] || 0
  const newHari     = dateToHari[form.tarikhAcara] || 0
  const hariChanged = form.tarikhAcara !== row.tarikhAcara && newHari > 0 && newHari !== currentHari
  const dateUnknown = form.tarikhAcara !== row.tarikhAcara && form.tarikhAcara && !dateToHari[form.tarikhAcara]

  // Cadangan No Acara baru berdasarkan hari tujuan
  const proposedNoAcara = useMemo(() => {
    if (!hariChanged || !newHari) return null
    const targetRows = allRows.filter(r => Number(r.hari) === newHari && r.jadualId !== row.jadualId)
    const used = new Set(targetRows.map(r => Number(r.noAcara)).filter(Boolean))
    const base = newHari * 100
    let next = base + 1
    while (used.has(next)) next++
    return String(next)
  }, [hariChanged, newHari, allRows, row.jadualId])

  // Load bilangan heat untuk acara ini
  useEffect(() => {
    if (!kejId || !row.noAcara || row.noAcara === '—') { setHeatCount(0); return }
    getDocs(collection(db, 'kejohanan', kejId, 'acara', String(row.noAcara), 'heat'))
      .then(snap => setHeatCount(snap.size))
      .catch(() => setHeatCount(0))
  }, [row.noAcara, kejId])

  // Reset renumber bila hari tak berubah
  useEffect(() => { if (!hariChanged) setRenumber(false) }, [hariChanged])

  async function handleSave() {
    setErr('')
    if (!form.tarikhAcara) return setErr('Tarikh wajib diisi.')
    if (!form.masaMula)    return setErr('Masa wajib diisi.')
    setSaving(true)
    try {
      if (renumber && hariChanged && proposedNoAcara) {
        // ── Smart Renumber ──────────────────────────────────────────────────
        const newJadualId = `${kejId}-${proposedNoAcara}`

        // 1. Baca data jadual lama
        const oldSnap = await getDoc(doc(db, 'jadual_acara', row.jadualId))
        const oldData = oldSnap.exists() ? oldSnap.data() : {}

        // 2. Cipta jadual baru dengan No Acara baru
        await setDoc(doc(db, 'jadual_acara', newJadualId), {
          ...oldData,
          jadualId:    newJadualId,
          noAcara:     proposedNoAcara,
          aceraId:     proposedNoAcara,
          acaraId:     proposedNoAcara,
          tarikhAcara: form.tarikhAcara,
          masaMula:    form.masaMula,
          lokasi:      form.lokasi,
          hari:        newHari,
          updatedAt:   serverTimestamp(),
        })

        // 3. Padam jadual lama
        await deleteDoc(doc(db, 'jadual_acara', row.jadualId))

        // 4. Kemaskini field noAcara + jadual dalam acara subcollection
        try {
          await updateDoc(
            doc(db, 'kejohanan', kejId, 'acara', String(row.noAcara)),
            {
              noAcara:     proposedNoAcara,
              tarikhAcara: form.tarikhAcara,
              masa:        form.masaMula,
              lokasi:      form.lokasi,
              updatedAt:   serverTimestamp(),
            }
          )
        } catch { /* acara doc mungkin tiada — bukan masalah kritikal */ }

      } else {
        // ── Update biasa ────────────────────────────────────────────────────
        const updates = {
          tarikhAcara: form.tarikhAcara,
          masaMula:    form.masaMula,
          lokasi:      form.lokasi,
          updatedAt:   serverTimestamp(),
        }
        // Kemaskini hari jika tarikh bertukar ke hari yang dikenali
        if (form.tarikhAcara !== row.tarikhAcara && newHari) updates.hari = newHari
        await updateDoc(doc(db, 'jadual_acara', row.jadualId), updates)

        // Sync ke acara subcollection supaya AcaraSetup & JadualSetup sentiasa selari
        try {
          const acaraUpdates = {
            tarikhAcara: form.tarikhAcara,
            masa:        form.masaMula,
            lokasi:      form.lokasi,
            updatedAt:   serverTimestamp(),
          }
          if (form.tarikhAcara !== row.tarikhAcara && newHari) acaraUpdates.hari = newHari
          await updateDoc(
            doc(db, 'kejohanan', kejId, 'acara', String(row.noAcara)),
            acaraUpdates
          )
        } catch { /* acara doc mungkin tiada — abaikan */ }
      }

      onSaved()
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-800">Edit Jadual</h2>
            <p className="text-[10px] font-mono text-[#003399] mt-0.5">{row.jadualId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {/* Info acara */}
        <div className="px-5 pt-4 pb-2">
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 flex items-center gap-3">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-[#003399]/10 flex items-center justify-center">
              <span className="text-sm font-black text-[#003399] font-mono">{row.noAcara}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-gray-800 truncate">{row.namaAcaraPendek}</p>
              <p className="text-[10px] text-gray-500">{row.kelas} · {row.peringkat}</p>
            </div>
            {heatCount !== null && heatCount > 0 && (
              <span className="shrink-0 text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                🔥 {heatCount} Heat
              </span>
            )}
          </div>
        </div>

        <div className="px-5 py-3 space-y-3">
          {/* Tarikh + Masa */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Tarikh <span className="text-red-400">*</span>
              </label>
              <input type="date" value={form.tarikhAcara}
                onChange={e => { set('tarikhAcara', e.target.value); setErr('') }}
                className={inputCls} />
              {/* Indicator perubahan hari */}
              {form.tarikhAcara && currentHari > 0 && (
                <p className="text-[10px] mt-1">
                  {hariChanged
                    ? <span className="text-amber-600 font-semibold">Hari {currentHari} → Hari {newHari}</span>
                    : newHari > 0
                    ? <span className="text-gray-400">Hari {newHari}</span>
                    : dateUnknown
                    ? <span className="text-orange-500">Tarikh baru (hari tidak dikesan)</span>
                    : null
                  }
                </p>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Masa Mula <span className="text-red-400">*</span>
              </label>
              <input type="time" value={form.masaMula}
                onChange={e => set('masaMula', e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Lokasi */}
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5">Lokasi</label>
            <select value={form.lokasi} onChange={e => set('lokasi', e.target.value)} className={inputCls}>
              {LOKASI_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          {/* Smart Renumber — hanya bila hari berubah */}
          {hariChanged && proposedNoAcara && (
            <div className={`rounded-xl border p-3 transition-colors ${
              renumber ? 'bg-[#003399]/5 border-[#003399]/30' : 'bg-amber-50 border-amber-200'
            }`}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={renumber}
                  onChange={e => setRenumber(e.target.checked)}
                  className="mt-0.5 accent-[#003399] w-4 h-4"
                />
                <div className="flex-1">
                  <p className={`text-[11px] font-bold ${renumber ? 'text-[#003399]' : 'text-amber-800'}`}>
                    Renumber No Acara: {row.noAcara} → {proposedNoAcara}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                    No Acara <strong>{row.noAcara}</strong> akan bertukar kepada <strong>{proposedNoAcara}</strong>
                    {' '}mengikut format Hari {newHari} (slot seterusnya tersedia).
                  </p>
                  {heatCount !== null && heatCount > 0 && (
                    <p className="text-[10px] text-red-600 font-semibold mt-1">
                      ⚠️ Ada {heatCount} heat — keputusan sedia ada kekal dilinkkan kepada No {row.noAcara} (tidak terjejas).
                    </p>
                  )}
                </div>
              </label>
            </div>
          )}

          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">
            Batal
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50">
            {saving
              ? 'Menyimpan…'
              : renumber
              ? `Simpan & Renumber → ${proposedNoAcara}`
              : 'Kemaskini'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal Padam Satu Jadual ──────────────────────────────────────────────────

function PadamSatuModal({ row, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'jadual_acara', row.jadualId))
      onDeleted()
      onClose()
    } catch (e) {
      alert('Ralat: ' + e.message)
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 text-center">
        <div className="w-11 h-11 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </div>
        <h3 className="text-sm font-bold text-gray-800 mb-1">Padam Jadual?</h3>
        <p className="text-[11px] font-mono text-gray-400 mb-1">{row.jadualId}</p>
        <p className="text-xs text-gray-500 mb-4">
          Jadual untuk <strong>{row.namaAcaraPendek} {row.kelas}</strong> akan dipadam.<br />
          Data acara dalam sistem masih kekal.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Batal
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex-1 py-2 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
            {deleting ? 'Memadamkan…' : 'Padam'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Halaman Utama ────────────────────────────────────────────────────────────

export default function JadualSetup() {
  const [selectedKej,   setSelectedKej]   = useState('')
  const [namaKej,       setNamaKej]       = useState('')
  const [rows,          setRows]          = useState([])
  const [acaraList,     setAcaraList]     = useState([])
  const [loading,       setLoading]       = useState(false)
  const [filterHari,    setFilterHari]    = useState('semua')
  const [carian,        setCarian]        = useState('')
  const [showJadual,    setShowJadual]    = useState(true)
  const [savingToggle,  setSavingToggle]  = useState(false)
  const [modal,         setModal]         = useState(null)
  const [padamLog,      setPadamLog]      = useState([])
  const [padamRunning,  setPadamRunning]  = useState(false)
  const [padamDone,     setPadamDone]     = useState(false)

  // Feature baru
  const [heatCountMap,  setHeatCountMap]  = useState({}) // noAcara → { count, hasFinal }
  const [loadingHeat,   setLoadingHeat]   = useState(false)
  const [padananData,   setPadananData]   = useState(null) // { missing, orphan }
  const [showPadanan,   setShowPadanan]   = useState(false)

  // ── Load kejohanan aktif + showJadual ─────────────────────────────────────
  useEffect(() => {
    getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', 'in', ['aktif', 'persediaan'])))
      .then(snap => {
        if (!snap.empty) {
          const d = snap.docs[0]
          setSelectedKej(d.id)
          setNamaKej(d.data().namaKejohanan || '')
        }
      }).catch(console.error)

    getDoc(doc(db, 'tetapan', 'home'))
      .then(s => { if (s.exists()) setShowJadual(s.data().showJadual ?? true) })
      .catch(console.error)
  }, [])

  // ── Toggle show/hide jadual di Home ───────────────────────────────────────
  async function toggleShowJadual() {
    const next = !showJadual
    setSavingToggle(true)
    try {
      await setDoc(doc(db, 'tetapan', 'home'), { showJadual: next }, { merge: true })
      setShowJadual(next)
    } catch (e) {
      console.error(e)
    } finally {
      setSavingToggle(false)
    }
  }

  // ── Load bilangan heat (parallel, non-blocking) ───────────────────────────
  async function loadHeatCounts(acaraRows, kejId) {
    if (!kejId || acaraRows.length === 0) return
    setLoadingHeat(true)
    try {
      const results = await Promise.all(
        acaraRows.map(r => {
          const key = String(r.noAcara)
          if (!key || key === '—') return Promise.resolve({ key, count: 0, hasFinal: false })
          return getDocs(collection(db, 'kejohanan', kejId, 'acara', key, 'heat'))
            .then(snap => ({
              key,
              count:    snap.size,
              hasFinal: snap.docs.some(d => d.data().peringkat === 'final'),
            }))
            .catch(() => ({ key, count: 0, hasFinal: false }))
        })
      )
      const map = {}
      results.forEach(r => { if (r.key && r.key !== '—') map[r.key] = { count: r.count, hasFinal: r.hasFinal } })
      setHeatCountMap(map)
    } finally {
      setLoadingHeat(false)
    }
  }

  // ── Padam semua ───────────────────────────────────────────────────────────
  async function handlePadamSemua() {
    if (!selectedKej) return
    if (!window.confirm(`⚠️ PADAM SEMUA ACARA?\n\n"${namaKej || selectedKej}"\n\nTermasuk semua acara + jadual_acara.\nTindakan ini TIDAK BOLEH dibatalkan.`)) return
    setPadamLog([]); setPadamDone(false); setPadamRunning(true)
    try {
      await deleteAllAcara(selectedKej, msg => setPadamLog(prev => [...prev, msg]))
      setPadamDone(true)
      fetchData()
    } catch (e) {
      setPadamLog(prev => [...prev, `❌ Ralat: ${e.message}`])
    } finally {
      setPadamRunning(false)
    }
  }

  // ── Fetch + join + padanan + heat counts ──────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!selectedKej) { setRows([]); setAcaraList([]); setPadananData(null); return }
    setLoading(true)
    setHeatCountMap({})
    try {
      const [jadualSnap, acaraSnap] = await Promise.all([
        getDocs(query(collection(db, 'jadual_acara'), where('kejohananId', '==', selectedKej))),
        getDocs(collection(db, 'kejohanan', selectedKej, 'acara')),
      ])

      const acaraMap = buildAcaraMap(acaraSnap)
      setAcaraList(acaraSnap.docs.map(d => ({ id: d.id, ...d.data() })))

      // Join jadual dengan acara
      const joined = jadualSnap.docs.map(d => {
        const jadual  = { jadualId: d.id, ...d.data() }
        const joinKey = getJoinKey(jadual)
        const acara   = (joinKey && acaraMap[joinKey]) || {}
        const noAcara = acara.noAcara || acara.aceraId || jadual.aceraId || jadual.acaraId || '—'
        const namaAcaraPendek = acara.namaAcaraPendek
          || acara.namaAcara?.replace(acara.kelas || '', '').trim()
          || jadual.namaAcara || '—'

        return {
          jadualId:     jadual.jadualId,
          noAcara,
          masaMula:     jadual.masaMula  || acara.masa     || '—',
          namaAcaraPendek,
          kelas:        acara.kelas      || '—',
          peringkat:    acara.peringkat  || '—',
          jenisAcara:   acara.jenisAcara || '',
          statusAcara:  acara.statusAcara || '',
          statusJadual: jadual.statusJadual || 'aktif',
          lokasi:       jadual.lokasi    || acara.lokasi   || '—',
          hari:         jadual.hari      || acara.hari     || 0,
          sesi:         jadual.sesi      || acara.sesi     || 0,
          tarikhAcara:  jadual.tarikhAcara || acara.tarikhAcara || '',
        }
      })

      joined.sort((a, b) => {
        if (a.hari !== b.hari) return a.hari - b.hari
        if (a.masaMula !== b.masaMula) return a.masaMula.localeCompare(b.masaMula)
        return Number(a.noAcara) - Number(b.noAcara)
      })

      setRows(joined)

      // ── Padanan: AcaraSetup ↔ JadualSetup ─────────────────────────────
      const jadualKeys = new Set(jadualSnap.docs.map(d => {
        const j = d.data()
        return String(j.aceraId || j.acaraId || '')
      }))
      const missingFromJadual = acaraSnap.docs
        .map(d => ({ _docId: d.id, ...d.data() }))
        .filter(a => !jadualKeys.has(String(a.aceraId || a.noAcara || a._docId)))
      const orphanInJadual = joined.filter(r => {
        const key = String(r.noAcara)
        return key !== '—' && !acaraSnap.docs.some(d => {
          const a = d.data()
          return String(a.aceraId || a.noAcara || d.id) === key
        })
      })
      setPadananData({ missing: missingFromJadual, orphan: orphanInJadual })

      // ── Load heat counts (parallel, tidak block UI) ─────────────────────
      loadHeatCounts(joined, selectedKej)

    } catch (e) {
      console.error('JadualSetup fetchData:', e)
    } finally {
      setLoading(false)
    }
  }, [selectedKej]) // eslint-disable-line

  useEffect(() => { fetchData() }, [fetchData])

  // ── Filter ────────────────────────────────────────────────────────────────
  const hariList = [...new Set(rows.map(r => r.hari))].filter(Boolean).sort((a, b) => a - b)

  const filtered = rows.filter(r => {
    if (filterHari !== 'semua' && String(r.hari) !== filterHari) return false
    if (carian) {
      const q = carian.toLowerCase()
      return (
        String(r.noAcara).includes(q) ||
        r.namaAcaraPendek?.toLowerCase().includes(q) ||
        r.kelas?.toLowerCase().includes(q) ||
        r.peringkat?.toLowerCase().includes(q) ||
        r.lokasi?.toLowerCase().includes(q)
      )
    }
    return true
  })

  const byHari = filtered.reduce((acc, r) => {
    const k = r.hari || 0
    if (!acc[k]) acc[k] = []
    acc[k].push(r)
    return acc
  }, {})
  const hariKeys = Object.keys(byHari).map(Number).sort((a, b) => a - b)

  // Stats
  const totalRows  = rows.length
  const rasmiCount = rows.filter(r => r.statusAcara === 'rasmi').length
  const draftCount = rows.filter(r => r.statusAcara === 'tidak_rasmi').length
  const belumCount = rows.filter(r => !r.statusAcara || r.statusAcara === 'akan_datang').length
  const missingCount = padananData?.missing?.length || 0

  return (
    <div className="p-5 max-w-6xl mx-auto space-y-4">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Jadual Acara</h1>
          <p className="text-xs text-gray-400 mt-0.5">Senarai acara mengikut jadual kejohanan</p>
          {namaKej && <p className="text-xs font-semibold text-[#003399] mt-0.5">{namaKej}</p>}
        </div>
        <button
          onClick={toggleShowJadual}
          disabled={savingToggle}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all disabled:opacity-50 ${
            showJadual ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                       : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
          }`}
        >
          <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${showJadual ? 'bg-green-500' : 'bg-gray-300'}`}>
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${showJadual ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
          {savingToggle ? 'Menyimpan…' : showJadual ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* ── Banner show/hide ── */}
      {showJadual ? (
        <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
          <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-green-800">Jadual Acara DIPAPAR di Laman Utama</p>
            <p className="text-[11px] text-green-600 mt-0.5">Pelawat boleh melihat jadual acara di halaman awam.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-100 border border-gray-200 rounded-xl">
          <div className="w-8 h-8 rounded-full bg-gray-400 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-600">Jadual Acara DISEMBUNYIKAN</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Jadual tidak dipapar di Laman Utama.</p>
          </div>
        </div>
      )}

      {selectedKej && (
        <>
          {/* ── Stats ── */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { label: 'Jumlah',       val: totalRows,    color: 'text-[#003399]', bg: 'bg-blue-50' },
              { label: 'Rasmi',        val: rasmiCount,   color: 'text-green-700', bg: 'bg-green-50' },
              { label: 'Tidak Rasmi',  val: draftCount,   color: 'text-amber-700', bg: 'bg-amber-50' },
              { label: 'Belum',        val: belumCount,   color: 'text-gray-500',  bg: 'bg-gray-50' },
              {
                label: 'Tiada Jadual',
                val: missingCount,
                color: missingCount > 0 ? 'text-red-600' : 'text-green-600',
                bg:    missingCount > 0 ? 'bg-red-50'    : 'bg-green-50',
                badge: missingCount > 0,
              },
            ].map(s => (
              <div key={s.label}
                className={`${s.bg} rounded-xl px-3 py-3 text-center ${s.badge ? 'cursor-pointer ring-1 ring-red-200 hover:ring-red-300' : ''}`}
                onClick={s.badge ? () => setShowPadanan(p => !p) : undefined}
                title={s.badge ? 'Klik untuk semak padanan' : undefined}
              >
                <p className={`text-2xl font-black ${s.color}`}>{s.val}</p>
                <p className="text-[9px] text-gray-500 uppercase tracking-wide mt-0.5">{s.label}</p>
                {s.badge && <p className="text-[9px] text-red-400 mt-0.5">Klik semak</p>}
              </div>
            ))}
          </div>

          {/* ── Panel Semak Padanan ── */}
          {showPadanan && (
            <PadananPanel
              data={padananData}
              onClose={() => setShowPadanan(false)}
              onTetapkan={a => { setShowPadanan(false); setModal({ type: 'tetapkan', prefillAcara: a }) }}
            />
          )}

          {/* ── Toolbar ── */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Tetapkan Jadual */}
            <button
              onClick={() => setModal('tetapkan')}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#003399] text-white text-xs font-bold rounded-lg hover:bg-[#002288] shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Tetapkan Jadual
            </button>

            {/* Semak Padanan */}
            <button
              onClick={() => setShowPadanan(p => !p)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg border transition-colors ${
                showPadanan
                  ? 'bg-amber-500 text-white border-amber-500'
                  : missingCount > 0
                  ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Semak Padanan
              {missingCount > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                  {missingCount}
                </span>
              )}
            </button>

            {/* Padam Semua */}
            <button
              onClick={handlePadamSemua}
              disabled={padamRunning || rows.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              {padamRunning
                ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
              }
              {padamRunning ? 'Memadamkan…' : 'Padam Semua'}
            </button>

            {/* Log padam */}
            {padamLog.length > 0 && (
              <span className={`text-[10px] font-mono px-2 py-1 rounded ${padamDone ? 'text-green-700 bg-green-50' : 'text-gray-500 bg-gray-100'}`}>
                {padamDone ? '✅ Selesai' : padamLog[padamLog.length - 1]}
              </span>
            )}

            {/* Heat loading indicator */}
            {loadingHeat && (
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Kira heat…
              </span>
            )}

            {/* Carian */}
            <input
              type="text"
              placeholder="Cari acara, kelas, lokasi…"
              value={carian}
              onChange={e => setCarian(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] w-44"
            />

            {/* Filter Hari */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[10px] bg-white">
              <button onClick={() => setFilterHari('semua')}
                className={`px-3 py-1.5 font-semibold transition-colors ${filterHari === 'semua' ? 'bg-[#003399] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                Semua
              </button>
              {hariList.map(h => (
                <button key={h} onClick={() => setFilterHari(String(h))}
                  className={`px-3 py-1.5 font-semibold transition-colors border-l border-gray-200 ${filterHari === String(h) ? 'bg-[#003399] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                  Hari {h}
                </button>
              ))}
            </div>

            <span className="text-[10px] text-gray-400 ml-auto">{filtered.length} acara</span>
          </div>

          {/* ── Jadual by Hari ── */}
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Memuatkan jadual…</div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-16 text-center">
              <p className="text-sm text-gray-400">
                {rows.length === 0 ? 'Tiada jadual. Sila seed data jadual di menu Acara.' : 'Tiada hasil carian.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {hariKeys.map(hari => {
                const entries   = byHari[hari]
                const tarikhStr = entries[0]?.tarikhAcara || ''
                return (
                  <div key={hari} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">

                    {/* Header Hari */}
                    <div className="px-4 py-2.5 bg-[#003399] flex items-center justify-between">
                      <div>
                        <p className="text-xs font-black text-white">Hari {hari}</p>
                        {tarikhStr && <p className="text-[10px] text-blue-200 mt-0.5">{formatTarikh(tarikhStr)}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-blue-200 bg-white/10 px-2 py-0.5 rounded-full">
                          {entries.length} acara
                        </span>
                        <button
                          onClick={() => setModal({ type: 'tukar-hari', hari, tarikhAsal: tarikhStr, rowsInHari: entries })}
                          title="Tukar tarikh semua acara hari ini"
                          className="flex items-center gap-1 px-2 py-1 bg-white/15 hover:bg-white/25 text-white text-[10px] font-semibold rounded-lg transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Tukar Tarikh
                        </button>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50/70 text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                            <th className="px-3 py-2 text-center w-14">No</th>
                            <th className="px-3 py-2 text-left w-20">Masa</th>
                            <th className="px-3 py-2 text-left">Acara</th>
                            <th className="px-3 py-2 text-left w-16">Kelas</th>
                            <th className="px-3 py-2 text-left w-28">Peringkat</th>
                            <th className="px-3 py-2 text-center w-14">Heat</th>
                            <th className="px-3 py-2 text-center w-28">Status</th>
                            <th className="px-3 py-2 text-center w-12">Edit</th>
                            <th className="px-3 py-2 text-center w-12">Padam</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map((r, i) => {
                            const hc = heatCountMap[String(r.noAcara)]
                            return (
                              <tr key={r.jadualId || i}
                                className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${r.statusJadual === 'batal' ? 'opacity-40' : ''}`}>

                                {/* No Acara */}
                                <td className="px-3 py-2.5 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    {r.jenisAcara && (
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${JENIS_DOT[r.jenisAcara] || 'bg-gray-300'}`} />
                                    )}
                                    <span className="font-black text-[#003399] font-mono">{r.noAcara}</span>
                                  </div>
                                </td>

                                {/* Masa */}
                                <td className="px-3 py-2.5">
                                  <span className="font-mono font-semibold text-gray-700">{formatMasa(r.masaMula)}</span>
                                </td>

                                {/* Acara */}
                                <td className="px-3 py-2.5">
                                  <span className="font-semibold text-gray-800">{r.namaAcaraPendek}</span>
                                </td>

                                {/* Kelas */}
                                <td className="px-3 py-2.5">
                                  <span className="font-semibold text-gray-600">{r.kelas}</span>
                                </td>

                                {/* Peringkat */}
                                <td className="px-3 py-2.5">
                                  <span className="text-gray-500">{r.peringkat}</span>
                                </td>

                                {/* Heat count */}
                                <td className="px-3 py-2.5 text-center">
                                  <HeatBadge
                                    count={hc?.count ?? 0}
                                    hasFinal={hc?.hasFinal ?? false}
                                    loading={loadingHeat && hc === undefined}
                                  />
                                </td>

                                {/* Status */}
                                <td className="px-3 py-2.5 text-center">
                                  <StatusBadge statusAcara={r.statusAcara} />
                                </td>

                                {/* Edit */}
                                <td className="px-3 py-2.5 text-center">
                                  <button
                                    onClick={() => setModal({ type: 'edit', row: r })}
                                    title="Edit jadual ini"
                                    className="p-1.5 text-gray-300 hover:text-[#003399] hover:bg-blue-50 rounded transition-colors"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  </button>
                                </td>

                                {/* Padam */}
                                <td className="px-3 py-2.5 text-center">
                                  <button
                                    onClick={() => setModal({ type: 'padam', row: r })}
                                    title="Padam jadual ini"
                                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Modals ── */}
      {(modal === 'tetapkan' || modal?.type === 'tetapkan') && (
        <TetapkanModal
          kejohananId={selectedKej}
          acaraList={acaraList}
          prefillAcara={modal?.prefillAcara || null}
          onClose={() => setModal(null)}
          onSaved={fetchData}
        />
      )}
      {modal?.type === 'tukar-hari' && (
        <TukarHariModal
          hari={modal.hari}
          tarikhAsal={modal.tarikhAsal}
          rowsInHari={modal.rowsInHari}
          kejohananId={selectedKej}
          onClose={() => setModal(null)}
          onSaved={fetchData}
        />
      )}
      {modal?.type === 'edit' && (
        <EditModal
          row={modal.row}
          onClose={() => setModal(null)}
          onSaved={fetchData}
          allRows={rows}
          kejId={selectedKej}
        />
      )}
      {modal?.type === 'padam' && (
        <PadamSatuModal
          row={modal.row}
          onClose={() => setModal(null)}
          onDeleted={fetchData}
        />
      )}
    </div>
  )
}
