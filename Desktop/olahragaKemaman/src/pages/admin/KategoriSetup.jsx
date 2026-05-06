/**
 * KategoriSetup — /dashboard/kategori
 *
 * Standard MSSD / MSSM Malaysia — 4 lapisan had penyertaan:
 *
 *  1. KUOTA ATLET PER SEKOLAH
 *     └─ Bilangan atlet (L/P) yang boleh didaftarkan sesebuah sekolah
 *        untuk kategori ini. Cth: maks 15L + 15P.
 *
 *  2. HAD ACARA INDIVIDU PER ATLET
 *     └─ Seorang atlet boleh sertai maks X acara individu (lari, lontar, lompat).
 *        Standard MSSM = 3 acara. Boleh ubah mengikut kategori.
 *
 *  3. HAD ACARA BEREGU / RELAY PER ATLET
 *     └─ Seorang atlet boleh sertai maks X acara berkumpulan (4x100m, 4x400m).
 *        Biasanya 2 atau tiada had.
 *
 *  4. KUOTA PASUKAN BERKUMPULAN PER SEKOLAH
 *     └─ Satu sekolah boleh hantar maks 1 pasukan per acara berkumpulan (L/P).
 *        Standard MSSM = 1 pasukan. Setiap pasukan = saizPasukan atlet.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy, writeBatch, getDoc,
} from 'firebase/firestore'
import { db } from '../../firebase/config'

const JENIS_DEFAULTS = ['SR', 'SM', 'PPKI']

const JENIS_BADGE_COLORS = {
  SR:   'bg-blue-100 text-blue-700',
  SM:   'bg-green-100 text-green-700',
  PPKI: 'bg-purple-100 text-purple-700',
}

const EMPTY_FORM = {
  kod: '', label: '', nama: '', jenisSekolah: 'SR',
  umurHad: '', umurMin: '',
  hadAtletL: 15, hadAtletP: 15,
  hadAcaraIndividu: 3, hadAcaraBeregu: 2,
  hadPasukanL: 1, hadPasukanP: 1, saizPasukan: 4,
  warna: '#1d4ed8', urutan: 99,
  catatan: '', isAktif: true,
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tahunLahirLabel(umurHad, umurMin, tahun) {
  if (!umurHad) return '—'
  const t = tahun || new Date().getFullYear()
  const tMax = t - umurHad      // born this year or later
  const tMin = umurMin ? t - umurMin : null
  return tMin ? `Lahir ${tMax} – ${tMin}` : `Lahir ≥ ${tMax}`
}

const FormField = ({ label, hint, children, required }) => (
  <div>
    <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
    {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
  </div>
)

// Kumpul 2 input bersebelahan dengan label di tengah
const DualField = ({ labelL, labelP, valL, valP, onL, onP, suffix = '', hint }) => (
  <div>
    {hint && <p className="text-[10px] text-gray-400 mb-1">{hint}</p>}
    <div className="flex gap-2">
      <div className="flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-4 h-4 rounded-full bg-blue-100 text-[8px] font-black text-blue-700 flex items-center justify-center">L</span>
          <span className="text-[10px] text-gray-500">{labelL}</span>
        </div>
        <div className="relative">
          <input type="number" min={0} value={valL} onChange={e => onL(e.target.value)}
            className={inputCls + ' pr-10'} />
          {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">{suffix}</span>}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-4 h-4 rounded-full bg-pink-100 text-[8px] font-black text-pink-700 flex items-center justify-center">P</span>
          <span className="text-[10px] text-gray-500">{labelP}</span>
        </div>
        <div className="relative">
          <input type="number" min={0} value={valP} onChange={e => onP(e.target.value)}
            className={inputCls + ' pr-10'} />
          {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">{suffix}</span>}
        </div>
      </div>
    </div>
  </div>
)

// ─── InfoRow dalam kad ────────────────────────────────────────────────────────

function InfoRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] text-gray-400 uppercase tracking-wide font-bold leading-none mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  )
}

// ─── KategoriCard ──────────────────────────────────────────────────────────────

function KategoriCard({ k, tahun, onEdit, onDelete, onToggle }) {
  const tLabel = tahunLahirLabel(k.umurHad, k.umurMin, tahun)

  const IconCal = <svg className="w-3 h-3 text-orange-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
  const IconPpl = <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
  const IconRun = <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
  const IconTeam = <svg className="w-3 h-3 text-purple-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${!k.isAktif ? 'opacity-55' : ''}`}>
      {/* Jalur warna atas */}
      <div className="h-1.5" style={{ backgroundColor: k.warna }} />

      <div className="p-4">
        {/* Header kad */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-sm shrink-0"
              style={{ backgroundColor: k.warna }}>
              {k.kod}
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800 leading-tight">{k.nama}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  JENIS_BADGE_COLORS[k.jenisSekolah] || 'bg-gray-100 text-gray-600'
                }`}>{k.jenisSekolah}</span>
                {k.umurHad && (
                  <span className="text-[9px] font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                    Bawah {k.umurHad} Thn
                  </span>
                )}
                {!k.isAktif && <span className="text-[9px] text-gray-400">• Tidak Aktif</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <button onClick={() => onEdit(k)} title="Edit"
              className="p-1.5 text-gray-300 hover:text-[#003399] hover:bg-blue-50 rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button onClick={() => onDelete(k)} title="Padam"
              className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tahun lahir */}
        <div className="bg-indigo-50 rounded-lg px-3 py-2 mb-3">
          <p className="text-[9px] text-indigo-400 font-bold uppercase tracking-wide mb-0.5">Kelayakan Tahun {tahun}</p>
          <p className="text-xs font-bold text-indigo-700">{tLabel}</p>
        </div>

        {/* 4 blok had — grid 2×2 */}
        <div className="grid grid-cols-2 gap-2 mb-3">

          {/* Blok 1: Kuota atlet per sekolah */}
          <div className="bg-blue-50 rounded-lg p-2.5 col-span-2">
            <InfoRow icon={IconPpl} label="Kuota Atlet Per Sekolah">
              <div className="flex gap-3 mt-1">
                <div className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-blue-200 text-[8px] font-black text-blue-800 flex items-center justify-center">L</span>
                  <span className="text-sm font-black text-blue-900">{k.hadAtletL ?? '—'}</span>
                  <span className="text-[9px] text-blue-400">atlet</span>
                </div>
                <div className="w-px bg-blue-200" />
                <div className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-pink-200 text-[8px] font-black text-pink-800 flex items-center justify-center">P</span>
                  <span className="text-sm font-black text-pink-900">{k.hadAtletP ?? '—'}</span>
                  <span className="text-[9px] text-pink-400">atlet</span>
                </div>
              </div>
            </InfoRow>
          </div>

          {/* Blok 2: Had acara individu */}
          <div className="bg-green-50 rounded-lg p-2.5">
            <InfoRow icon={IconRun} label="Acara Individu">
              <p className="text-lg font-black text-green-800 leading-none mt-0.5">
                {k.hadAcaraIndividu ?? '—'}
              </p>
              <p className="text-[9px] text-green-500">acara / atlet</p>
            </InfoRow>
          </div>

          {/* Blok 3: Had acara berkumpulan */}
          <div className="bg-purple-50 rounded-lg p-2.5">
            <InfoRow icon={IconTeam} label="Acara Berkumpulan">
              <p className="text-lg font-black text-purple-800 leading-none mt-0.5">
                {k.hadAcaraBeregu ?? '—'}
              </p>
              <p className="text-[9px] text-purple-500">berkumpulan / atlet</p>
            </InfoRow>
          </div>

          {/* Blok 4: Kuota pasukan berkumpulan */}
          <div className="bg-orange-50 rounded-lg p-2.5 col-span-2">
            <InfoRow icon={IconCal} label="Pasukan Berkumpulan Per Sekolah">
              <div className="flex gap-3 mt-1 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-blue-200 text-[8px] font-black text-blue-800 flex items-center justify-center">L</span>
                  <span className="text-sm font-black text-orange-900">{k.hadPasukanL ?? 1}</span>
                  <span className="text-[9px] text-orange-400">pasukan</span>
                </div>
                <div className="w-px bg-orange-200" />
                <div className="flex items-center gap-1">
                  <span className="w-4 h-4 rounded-full bg-pink-200 text-[8px] font-black text-pink-800 flex items-center justify-center">P</span>
                  <span className="text-sm font-black text-orange-900">{k.hadPasukanP ?? 1}</span>
                  <span className="text-[9px] text-orange-400">pasukan</span>
                </div>
                <div className="w-px bg-orange-200" />
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-orange-500 font-semibold">{k.saizPasukan ?? 4} atlet/pasukan</span>
                </div>
              </div>
            </InfoRow>
          </div>
        </div>

        {/* Catatan */}
        {k.catatan && (
          <p className="text-[10px] text-gray-400 italic mb-3">{k.catatan}</p>
        )}

        {/* Toggle aktif */}
        <div className="flex items-center justify-between pt-2.5 border-t border-gray-50">
          <span className="text-[10px] text-gray-400">{k.isAktif ? 'Aktif dalam kejohanan ini' : 'Tidak aktif'}</span>
          <button onClick={() => onToggle(k)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${k.isAktif ? 'bg-[#003399]' : 'bg-gray-300'}`}>
            <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
              style={{ transform: k.isAktif ? 'translateX(18px)' : 'translateX(2px)' }} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── KategoriModal ────────────────────────────────────────────────────────────

function KategoriModal({ mode, initial, onClose, onSaved, allKod, tahun, jenisValues = [] }) {
  const isEdit = mode === 'edit'
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const previewTahun = tahunLahirLabel(form.umurHad, form.umurMin, tahun)

  async function handleSave() {
    setErr('')
    const kodBersih = form.kod.trim().toUpperCase().replace(/\s/g, '')
    if (!kodBersih) return setErr('Kod kategori wajib diisi.')
    if (!form.nama.trim()) return setErr('Nama kategori wajib diisi.')
    if (!isEdit && allKod.includes(kodBersih)) return setErr(`Kod "${kodBersih}" sudah wujud.`)

    setSaving(true)
    try {
      const payload = {
        kod: kodBersih, label: form.label.trim(), nama: form.nama.trim(),
        jenisSekolah: form.jenisSekolah,
        umurHad:  form.umurHad  === '' ? null : Number(form.umurHad),
        umurMin:  form.umurMin  === '' ? null : Number(form.umurMin),
        hadAtletL: Number(form.hadAtletL) || 0,
        hadAtletP: Number(form.hadAtletP) || 0,
        hadAcaraIndividu: Number(form.hadAcaraIndividu) || 3,
        hadAcaraBeregu:   Number(form.hadAcaraBeregu)   || 2,
        hadPasukanL:  Number(form.hadPasukanL)  || 1,
        hadPasukanP:  Number(form.hadPasukanP)  || 1,
        saizPasukan:  Number(form.saizPasukan)  || 4,
        warna: form.warna || '#1d4ed8',
        urutan: Number(form.urutan) || 99,
        catatan: form.catatan || '',
        isAktif: form.isAktif,
        updatedAt: serverTimestamp(),
      }

      if (!isEdit) {
        payload.createdAt = serverTimestamp()
        await setDoc(doc(db, 'kategori', kodBersih), payload)
      } else {
        const oldKod = initial.kod
        if (kodBersih !== oldKod) {
          const chk = await getDoc(doc(db, 'kategori', kodBersih))
          if (chk.exists()) { setErr(`Kod "${kodBersih}" sudah wujud.`); setSaving(false); return }
          await setDoc(doc(db, 'kategori', kodBersih), { ...payload, createdAt: initial.createdAt || serverTimestamp() })
          await deleteDoc(doc(db, 'kategori', oldKod))
        } else {
          await updateDoc(doc(db, 'kategori', kodBersih), payload)
        }
      }
      onSaved(); onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[94vh] flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800">{isEdit ? 'Edit Kategori' : 'Tambah Kategori'}</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">Standard MSSD / MSSM Malaysia</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {/* Body — scroll */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {/* ── BAHAGIAN 1: Maklumat Asas ── */}
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3 pb-1 border-b border-gray-100">
              1 — Maklumat Asas
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <FormField label="Kod" required hint={isEdit ? 'Kod tidak boleh ditukar selepas dicipta.' : 'Tanpa ruang. Cth: A, B, C'}>
                  <input value={form.kod}
                    onChange={e => !isEdit && set('kod', e.target.value.replace(/\s/g, '').toUpperCase())}
                    placeholder="A" className={inputCls + (isEdit ? ' bg-gray-100 text-gray-400 cursor-not-allowed' : '')}
                    maxLength={8} readOnly={isEdit} />
                </FormField>
                <FormField label="Label Paparan" hint="Ganti kod dalam paparan. Cth: L12, P15">
                  <input value={form.label}
                    onChange={e => set('label', e.target.value.replace(/\s/g, '').toUpperCase())}
                    placeholder="L12" className={inputCls}
                    maxLength={10} />
                </FormField>
                <FormField label="Urutan">
                  <input type="number" min={1} value={form.urutan}
                    onChange={e => set('urutan', e.target.value)} className={inputCls} />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Nama Kategori" required>
                  <input value={form.nama} onChange={e => set('nama', e.target.value)}
                    placeholder="Kategori A" className={inputCls} />
                </FormField>
                <FormField label="Warna Label">
                  <input type="color" value={form.warna} onChange={e => set('warna', e.target.value)}
                    className="w-full h-[38px] rounded-lg cursor-pointer border border-gray-200" />
                </FormField>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
                  Jenis Institusi<span className="text-red-500 ml-0.5">*</span>
                </label>
                {/* Cadangan cepat — klik untuk pilih */}
                <p className="text-[10px] text-gray-400 mb-1.5">Klik untuk pilih, atau taip nilai baharu di bawah:</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[...new Set([...JENIS_DEFAULTS, ...jenisValues])].map(j => (
                    <button
                      key={j}
                      type="button"
                      onClick={() => set('jenisSekolah', j)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                        form.jenisSekolah === j
                          ? 'bg-[#003399] text-white border-[#003399]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-[#003399]/50 hover:text-[#003399]'
                      }`}
                    >
                      {j}
                    </button>
                  ))}
                </div>
                {/* Free-text input — untuk nilai baharu */}
                <input
                  type="text"
                  value={form.jenisSekolah}
                  onChange={e => set('jenisSekolah', e.target.value)}
                  placeholder="cth: Universiti, Kolej, SMKA, Teknik..."
                  className={inputCls}
                  autoComplete="off"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Nilai semasa: <span className="font-bold text-gray-700">{form.jenisSekolah || '—'}</span>
                </p>
              </div>
            </div>
          </div>

          {/* ── BAHAGIAN 2: Had Umur & Kelayakan ── */}
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3 pb-1 border-b border-gray-100">
              2 — Had Umur & Kelayakan
            </p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Umur Min" hint="Tahun. Kosong = tiada had bawah">
                <input type="number" min={1} max={25} value={form.umurMin}
                  onChange={e => set('umurMin', e.target.value)} placeholder="9" className={inputCls} />
              </FormField>
              <FormField label='Umur Had ("Bawah X Thn")' required>
                <input type="number" min={1} max={25} value={form.umurHad}
                  onChange={e => set('umurHad', e.target.value)} placeholder="10" className={inputCls} />
              </FormField>
            </div>
            {form.umurHad && (
              <div className="mt-2 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-[9px] text-indigo-400 font-bold">KELAYAKAN TAHUN {tahun}</p>
                  <p className="text-xs font-bold text-indigo-700">{previewTahun}</p>
                </div>
              </div>
            )}
          </div>

          {/* ── BAHAGIAN 3: Kuota Atlet Per Sekolah ── */}
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 pb-1 border-b border-gray-100">
              3 — Kuota Atlet Per Sekolah
            </p>
            <p className="text-[10px] text-gray-400 mb-3">
              Jumlah atlet (L/P) yang boleh didaftarkan oleh sesebuah sekolah untuk kategori ini.
              Digunakan semasa pendaftaran untuk menyemak had.
            </p>
            <DualField
              labelL="Lelaki" labelP="Perempuan"
              valL={form.hadAtletL} valP={form.hadAtletP}
              onL={v => set('hadAtletL', v)} onP={v => set('hadAtletP', v)}
              suffix="atlet"
            />
          </div>

          {/* ── BAHAGIAN 4: Had Acara Per Atlet ── */}
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 pb-1 border-b border-gray-100">
              4 — Had Acara Per Atlet
            </p>
            <p className="text-[10px] text-gray-400 mb-3">
              Maks acara yang boleh disertai oleh <strong>seorang atlet</strong> dalam kategori ini.
              Standard MSSM: individu = 3, berkumpulan = 2.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Acara Individu" hint="Lari pecut, lompat, lontar, dsb.">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  <input type="number" min={0} value={form.hadAcaraIndividu}
                    onChange={e => set('hadAcaraIndividu', e.target.value)}
                    className={inputCls + ' pl-8'} />
                </div>
              </FormField>
              <FormField label="Acara Berkumpulan / Relay" hint="4×100m, 4×400m, dsb.">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <input type="number" min={0} value={form.hadAcaraBeregu}
                    onChange={e => set('hadAcaraBeregu', e.target.value)}
                    className={inputCls + ' pl-8'} />
                </div>
              </FormField>
            </div>
          </div>

          {/* ── BAHAGIAN 5: Pasukan Berkumpulan Per Sekolah ── */}
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 pb-1 border-b border-gray-100">
              5 — Pasukan Berkumpulan Per Sekolah
            </p>
            <p className="text-[10px] text-gray-400 mb-3">
              Berapa pasukan relay boleh dihantar per sekolah bagi setiap acara berkumpulan.
              Standard = 1 pasukan. Saiz pasukan biasanya 4 atlet (4×100m / 4×400m).
            </p>
            <div className="space-y-3">
              <DualField
                labelL="Pasukan Lelaki" labelP="Pasukan Perempuan"
                valL={form.hadPasukanL} valP={form.hadPasukanP}
                onL={v => set('hadPasukanL', v)} onP={v => set('hadPasukanP', v)}
                suffix="pskmn"
              />
              <FormField label="Saiz Pasukan (atlet per pasukan)" hint="4 untuk 4×100m / 4×400m">
                <input type="number" min={2} max={8} value={form.saizPasukan}
                  onChange={e => set('saizPasukan', e.target.value)} className={inputCls} />
              </FormField>
            </div>
          </div>

          {/* ── BAHAGIAN 6: Catatan & Status ── */}
          <div>
            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3 pb-1 border-b border-gray-100">
              6 — Catatan & Status
            </p>
            <div className="space-y-3">
              <FormField label="Catatan">
                <input value={form.catatan} onChange={e => set('catatan', e.target.value)}
                  placeholder="Cth: Bawah 12 Tahun — Sekolah Rendah"
                  className={inputCls} />
              </FormField>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <p className="text-xs font-semibold text-gray-700">Aktif dalam Kejohanan</p>
                  <p className="text-[10px] text-gray-400">Kategori tidak aktif tidak akan tersenarai semasa pendaftaran acara</p>
                </div>
                <button type="button" onClick={() => set('isAktif', !form.isAktif)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.isAktif ? 'bg-[#003399]' : 'bg-gray-300'}`}>
                  <span className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                    style={{ transform: form.isAktif ? 'translateX(22px)' : 'translateX(2px)' }} />
                </button>
              </div>
            </div>
          </div>

          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">{err}</div>}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Batal
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] transition-colors disabled:opacity-50">
            {saving ? 'Menyimpan…' : isEdit ? 'Kemaskini' : 'Tambah Kategori'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── DeleteModal ──────────────────────────────────────────────────────────────

function DeleteModal({ kategori, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'kategori', kategori.kod))
      onDeleted(); onClose()
    } catch (e) { alert('Ralat: ' + e.message); setDeleting(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 text-center">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-sm font-bold text-gray-800 mb-1">Padam Kategori?</h3>
        <p className="text-xs text-gray-500 mb-4">
          Anda akan memadam <strong>{kategori.nama}</strong> ({kategori.kod}). Tindakan ini tidak boleh diundur.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Batal</button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex-1 py-2 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
            {deleting ? 'Memadamkan…' : 'Padam'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── TetapanFinal ─────────────────────────────────────────────────────────────

const JENIS_ACARA_TABS = [
  { key: 'larian', label: 'Larian', hint: 'Larian lorong & mass start' },
  { key: 'relay',  label: 'Relay',  hint: 'Acara berkumpulan 4×100m, 4×400m' },
  { key: 'padang', label: 'Padang', hint: 'Lompat & balin/lempar' },
]

const numCls = 'w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50'

function TetapanFinal({ kategoriList }) {
  const [subTab,   setSubTab]   = useState('larian')
  const [setup,    setSetup]    = useState({ larian: {}, relay: {}, padang: {} })
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [dirty,    setDirty]    = useState(false)

  // Load dari Firestore
  const fetchSetup = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'tetapan', 'finalSetup'))
      if (snap.exists()) {
        const d = snap.data()
        setSetup({
          larian: d.larian || {},
          relay:  d.relay  || {},
          padang: d.padang || {},
        })
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchSetup() }, [fetchSetup])

  // Helper ubah nilai
  function setVal(jenis, kod, field, val) {
    setSetup(prev => ({
      ...prev,
      [jenis]: {
        ...prev[jenis],
        [kod]: {
          ...(prev[jenis]?.[kod] || {}),
          [field]: val === '' ? '' : Number(val),
        },
      },
    }))
    setDirty(true)
    setSaved(false)
  }

  function getVal(jenis, kod, field, def) {
    const v = setup[jenis]?.[kod]?.[field]
    return v === undefined ? def : v
  }

  // Simpan
  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      // Normalise — tukar string kosong ke 0
      const normalise = (obj) => {
        const out = {}
        Object.entries(obj).forEach(([kod, vals]) => {
          out[kod] = {}
          Object.entries(vals).forEach(([k, v]) => {
            out[kod][k] = v === '' ? 0 : Number(v) || 0
          })
        })
        return out
      }
      await setDoc(doc(db, 'tetapan', 'finalSetup'), {
        larian:    normalise(setup.larian),
        relay:     normalise(setup.relay),
        padang:    normalise(setup.padang),
        updatedAt: serverTimestamp(),
      })
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      alert('Ralat simpan: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">Memuatkan tetapan…</div>

  const kods = kategoriList.map(k => k.kod).filter(Boolean)

  return (
    <div className="space-y-4">

      {/* Info */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 space-y-1">
        <p className="font-bold">Tetapan ini menentukan cara atlet dipilih untuk perlawanan final</p>
        <p className="text-[11px] text-blue-500">
          Best Heat = tempat untuk pemenang heat terpantas ·
          Best Time = tempat dari masa terbaik keseluruhan ·
          Total = Best Heat + Best Time (auto-kira)
        </p>
      </div>

      {/* Sub-tab: Larian / Relay / Padang */}
      <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs bg-white w-fit shadow-sm">
        {JENIS_ACARA_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`px-5 py-2 font-semibold transition-colors border-r border-gray-200 last:border-r-0 ${
              subTab === t.key ? 'bg-[#003399] text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Hint jenis */}
      <p className="text-[11px] text-gray-400">
        {JENIS_ACARA_TABS.find(t => t.key === subTab)?.hint}
      </p>

      {/* Table Larian & Relay */}
      {(subTab === 'larian' || subTab === 'relay') && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Kategori</th>
                <th className="px-4 py-3 text-center">
                  Best Heat
                  <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">pemenang heat terpantas</p>
                </th>
                <th className="px-4 py-3 text-center">
                  Best Time
                  <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">masa terbaik keseluruhan</p>
                </th>
                <th className="px-4 py-3 text-center">
                  Total
                  <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">masuk final (auto)</p>
                </th>
              </tr>
            </thead>
            <tbody>
              {kods.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-xs">Tiada kategori. Tambah kategori dahulu.</td></tr>
              )}
              {kods.map((kod, i) => {
                const kat       = kategoriList.find(k => k.kod === kod)
                const bestHeat  = getVal(subTab, kod, 'bestHeat', 0)
                const bestTime  = getVal(subTab, kod, 'bestTime', 8)
                const total     = (Number(bestHeat) || 0) + (Number(bestTime) || 0)
                const isErr     = Number(bestHeat) < 0 || Number(bestTime) < 0
                return (
                  <tr key={kod} className={`border-b border-gray-50 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-black shrink-0"
                          style={{ backgroundColor: kat?.warna || '#6366f1' }}>
                          {kod}
                        </span>
                        <div>
                          <p className="font-semibold text-gray-700">{kat?.label || kod}</p>
                          <p className="text-[9px] text-gray-400">{kat?.nama || ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="number" min={0} max={99}
                        value={bestHeat}
                        onChange={e => setVal(subTab, kod, 'bestHeat', e.target.value)}
                        className={numCls + (isErr ? ' border-red-300' : '')}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="number" min={0} max={99}
                        value={bestTime}
                        onChange={e => setVal(subTab, kod, 'bestTime', e.target.value)}
                        className={numCls + (isErr ? ' border-red-300' : '')}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-black text-base ${total === 0 ? 'text-gray-300' : 'text-[#003399]'}`}>
                        {total}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Table Padang */}
      {subTab === 'padang' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700">
            ⚠️ Padang tiada konsep heat — semua peserta bertanding dalam 1 sesi. Pilihan ke final = jarak/ketinggian terbaik sahaja.
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Kategori</th>
                <th className="px-4 py-3 text-center">
                  Total Final
                  <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">berapa masuk peringkat akhir</p>
                </th>
                <th className="px-4 py-3 text-center">
                  Cubaan Awal
                  <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">semua peserta</p>
                </th>
                <th className="px-4 py-3 text-center">
                  Cubaan Akhir
                  <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">top N sahaja</p>
                </th>
              </tr>
            </thead>
            <tbody>
              {kods.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-xs">Tiada kategori. Tambah kategori dahulu.</td></tr>
              )}
              {kods.map((kod, i) => {
                const kat        = kategoriList.find(k => k.kod === kod)
                const total      = getVal('padang', kod, 'total',       8)
                const cubaanAwal = getVal('padang', kod, 'cubaanAwal',  3)
                const cubaanAkhr = getVal('padang', kod, 'cubaanAkhir', 3)
                return (
                  <tr key={kod} className={`border-b border-gray-50 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-black shrink-0"
                          style={{ backgroundColor: kat?.warna || '#6366f1' }}>
                          {kod}
                        </span>
                        <div>
                          <p className="font-semibold text-gray-700">{kat?.label || kod}</p>
                          <p className="text-[9px] text-gray-400">{kat?.nama || ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input type="number" min={1} max={99} value={total}
                        onChange={e => setVal('padang', kod, 'total', e.target.value)}
                        className={numCls} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input type="number" min={1} max={10} value={cubaanAwal}
                        onChange={e => setVal('padang', kod, 'cubaanAwal', e.target.value)}
                        className={numCls} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input type="number" min={1} max={10} value={cubaanAkhr}
                        onChange={e => setVal('padang', kod, 'cubaanAkhir', e.target.value)}
                        className={numCls} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Panduan */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-[10px] text-gray-500 space-y-1.5">
        <p className="font-bold text-gray-600 text-xs mb-2">Panduan</p>
        <p><span className="font-bold text-gray-700">Best Heat</span> — Ambil pemenang heat mengikut masa terpantas. Contoh: Best Heat=4 → ambil 4 pemenang heat terpantas.</p>
        <p><span className="font-bold text-gray-700">Best Time</span> — Baki tempat diisi dari atlet dengan masa terbaik yang belum dipilih.</p>
        <p><span className="font-bold text-gray-700">Total</span> — Dikira automatik (Best Heat + Best Time). Ini bilangan atlet yang berlari dalam final.</p>
        <p><span className="font-bold text-gray-700">Cubaan Awal</span> — Semua peserta padang dapat N cubaan pada peringkat pertama.</p>
        <p><span className="font-bold text-gray-700">Cubaan Akhir</span> — Hanya top N peserta terbaik yang dapat cubaan tambahan.</p>
      </div>

      {/* Simpan */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {dirty && <p className="text-[11px] text-amber-600 font-semibold">Terdapat perubahan belum disimpan</p>}
        {saved && <p className="text-[11px] text-green-600 font-semibold">✓ Tetapan disimpan</p>}
        <button onClick={handleSave} disabled={saving || !dirty}
          className="px-6 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-40 transition-colors">
          {saving ? 'Menyimpan…' : 'Simpan Tetapan'}
        </button>
      </div>
    </div>
  )
}

// ─── Halaman Utama ────────────────────────────────────────────────────────────

export default function KategoriSetup() {
  const [list, setList]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)
  const [delTarget, setDelTarget] = useState(null)
  const [filterJenis, setFilterJenis] = useState('semua')
  const [activeTab, setActiveTab] = useState('kategori')
  const tahun = new Date().getFullYear()

  async function fetchList() {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'kategori'), orderBy('urutan')))
      setList(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch { setList([]) } finally { setLoading(false) }
  }

  useEffect(() => { fetchList() }, [])

  async function toggleAktif(k) {
    try {
      await updateDoc(doc(db, 'kategori', k.kod), { isAktif: !k.isAktif, updatedAt: serverTimestamp() })
      setList(l => l.map(x => x.kod === k.kod ? { ...x, isAktif: !x.isAktif } : x))
    } catch (e) { alert('Ralat: ' + e.message) }
  }

  const allKod = list.map(k => k.kod)
  const filtered = filterJenis === 'semua' ? list : list.filter(k => k.jenisSekolah === filterJenis)

  // Derive unique jenis values from loaded data + always include defaults
  const jenisValues = [
    ...new Set([
      ...JENIS_DEFAULTS,
      ...list.map(k => k.jenisSekolah).filter(Boolean),
    ])
  ].sort()

  const JENIS_LABELS = {
    SR:   'Sekolah Rendah (SR)',
    SM:   'Sekolah Menengah (SM)',
    PPKI: 'Program Pendidikan Khas (PPKI)',
  }
  const JENIS_BARS = {
    SR:   'bg-blue-600',
    SM:   'bg-green-600',
    PPKI: 'bg-purple-600',
  }

  // Groups derived dynamically
  const groups = jenisValues.map(j => ({
    jenis: j,
    label: JENIS_LABELS[j] || j,
    sub:   '',
    bar:   JENIS_BARS[j] || 'bg-gray-400',
  }))

  const cardProps = {
    tahun,
    onEdit:   k => setModal({ mode: 'edit', data: k }),
    onDelete: setDelTarget,
    onToggle: toggleAktif,
  }

  return (
    <div className="p-5 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Setup Kategori</h1>
          <p className="text-xs text-gray-400 mt-0.5">Standard MSSD / MSSM — had umur, kuota atlet, had acara & pasukan berkumpulan</p>
        </div>
        {activeTab === 'kategori' && (
          <button onClick={() => setModal({ mode: 'add' })}
            className="flex items-center gap-2 px-4 py-2 bg-[#003399] text-white text-xs font-bold rounded-lg hover:bg-[#002288] shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Tambah Kategori
          </button>
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs bg-white w-fit shadow-sm">
        {[
          { key: 'kategori', label: 'Senarai Kategori' },
          { key: 'final',    label: 'Tetapan Final' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-5 py-2.5 font-semibold transition-colors border-r border-gray-200 last:border-r-0 ${
              activeTab === t.key ? 'bg-[#003399] text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Tetapan Final */}
      {activeTab === 'final' && (
        <TetapanFinal kategoriList={list} />
      )}

      {/* Tab: Senarai Kategori — sembunyikan jika tab lain aktif */}
      {activeTab !== 'kategori' ? null : (<>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-blue-50 rounded-xl px-4 py-3 text-center">
          <p className="text-2xl font-black text-[#003399]">{list.length}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">Jumlah</p>
        </div>
        {jenisValues.map(j => (
          <div key={j} className="bg-gray-50 rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-black text-gray-700">{list.filter(k => k.jenisSekolah === j).length}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">{j}</p>
          </div>
        ))}
      </div>

      {/* Filter — dynamic from loaded data */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 overflow-hidden text-xs bg-white w-fit shadow-sm">
        {['semua', ...jenisValues].map(f => (
          <button key={f} onClick={() => setFilterJenis(f)}
            className={`px-4 py-2 font-semibold transition-colors ${filterJenis === f ? 'bg-[#003399] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
            {f === 'semua' ? 'Semua' : f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Memuatkan…</div>
      ) : list.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm font-semibold text-gray-500 mb-1">Tiada kategori</p>
          <p className="text-xs text-gray-400">Tambah baharu atau gunakan seed standard MSSM di bawah.</p>
        </div>
      ) : (
        <div className="space-y-7">
          {groups.map(g => {
            const items = filtered.filter(k => k.jenisSekolah === g.jenis)
            if (items.length === 0) return null
            return (
              <div key={g.jenis}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2 h-5 rounded-sm ${g.bar}`} />
                  <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest">{g.label}</h2>
                  {g.sub && <span className="text-[10px] text-gray-400">— {g.sub}</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map(k => <KategoriCard key={k.id} k={k} {...cardProps} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {modal?.mode === 'add' && (
        <KategoriModal mode="add" initial={{ ...EMPTY_FORM, urutan: list.length + 1 }}
          onClose={() => setModal(null)} onSaved={fetchList}
          allKod={allKod} tahun={tahun} jenisValues={jenisValues} />
      )}
      {modal?.mode === 'edit' && (
        <KategoriModal mode="edit" initial={modal.data}
          onClose={() => setModal(null)} onSaved={fetchList}
          allKod={allKod.filter(k => k !== modal.data?.kod)} tahun={tahun} jenisValues={jenisValues} />
      )}
      {delTarget && (
        <DeleteModal kategori={delTarget} onClose={() => setDelTarget(null)} onDeleted={fetchList} />
      )}
      </>)}
    </div>
  )
}
