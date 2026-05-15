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
  serverTimestamp, query, orderBy, writeBatch, getDoc, where,
} from 'firebase/firestore'
import { db } from '../../firebase/config'

const JENIS_DEFAULTS = ['SR', 'SM', 'PPKI']


const EMPTY_FORM = {
  kod: '', label: '', nama: '', jenisSekolah: 'SR',
  umurHad: '', umurMin: '',
  isTerbuka: false,
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

// ─── KategoriTable ────────────────────────────────────────────────────────────

function KategoriTable({ items, tahun, onEdit, onDelete, onToggle }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
            <th className="px-3 py-3 text-left w-12">Kod</th>
            <th className="px-3 py-3 text-left">Nama</th>
            <th className="px-3 py-3 text-left">Kelayakan</th>
            <th className="px-3 py-3 text-center">
              Atlet / Sekolah
              <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">L | P</p>
            </th>
            <th className="px-3 py-3 text-center">
              Individu
              <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">acara/atlet</p>
            </th>
            <th className="px-3 py-3 text-center">
              Berkump.
              <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">acara/atlet</p>
            </th>
            <th className="px-3 py-3 text-center">
              Pasukan
              <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">L | P | saiz</p>
            </th>
            <th className="px-3 py-3 text-center w-14">Aktif</th>
            <th className="px-3 py-3 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((k, i) => {
            const tLabel = tahunLahirLabel(k.umurHad, k.umurMin, tahun)
            return (
              <tr key={k.id}
                className={`border-b border-gray-50 last:border-0 transition-colors hover:bg-blue-50/20 ${
                  !k.isAktif ? 'opacity-50' : ''
                } ${i % 2 === 0 ? '' : 'bg-gray-50/40'}`}>

                {/* Kod */}
                <td className="px-3 py-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-black text-sm shadow-sm"
                    style={{ backgroundColor: k.warna }}>
                    {k.label || k.kod}
                  </div>
                </td>

                {/* Nama */}
                <td className="px-3 py-3 min-w-[140px]">
                  <p className="font-semibold text-gray-800 leading-tight">{k.nama}</p>
                  {k.catatan && (
                    <p className="text-[10px] text-gray-400 mt-0.5 italic">{k.catatan}</p>
                  )}
                </td>

                {/* Kelayakan */}
                <td className="px-3 py-3 min-w-[120px]">
                  {k.isTerbuka ? (
                    <div>
                      <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">Terbuka</span>
                      <p className="text-[10px] text-gray-500 mt-1">{tLabel}</p>
                    </div>
                  ) : k.umurHad ? (
                    <div>
                      <p className="text-[10px] font-semibold text-orange-600">Bawah {k.umurHad} Thn</p>
                      <p className="text-[10px] text-gray-400">{tLabel}</p>
                    </div>
                  ) : (
                    <span className="text-[10px] text-gray-400">—</span>
                  )}
                </td>

                {/* Atlet L/P */}
                <td className="px-3 py-3 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <div className="flex items-center gap-0.5">
                      <span className="w-4 h-4 rounded-full bg-blue-100 text-[8px] font-black text-blue-700 flex items-center justify-center">L</span>
                      <span className="font-bold text-gray-700">{k.hadAtletL ?? '—'}</span>
                    </div>
                    <span className="text-gray-300">|</span>
                    <div className="flex items-center gap-0.5">
                      <span className="w-4 h-4 rounded-full bg-pink-100 text-[8px] font-black text-pink-700 flex items-center justify-center">P</span>
                      <span className="font-bold text-gray-700">{k.hadAtletP ?? '—'}</span>
                    </div>
                  </div>
                </td>

                {/* Individu */}
                <td className="px-3 py-3 text-center">
                  <span className="text-base font-black text-green-700">{k.hadAcaraIndividu ?? '—'}</span>
                </td>

                {/* Berkumpulan */}
                <td className="px-3 py-3 text-center">
                  <span className="text-base font-black text-purple-700">{k.hadAcaraBeregu ?? '—'}</span>
                </td>

                {/* Pasukan */}
                <td className="px-3 py-3 text-center">
                  <div className="flex items-center justify-center gap-1 text-[11px] text-gray-600">
                    <span className="w-4 h-4 rounded-full bg-blue-100 text-[8px] font-black text-blue-700 flex items-center justify-center">L</span>
                    <span className="font-semibold">{k.hadPasukanL ?? 1}</span>
                    <span className="text-gray-300">|</span>
                    <span className="w-4 h-4 rounded-full bg-pink-100 text-[8px] font-black text-pink-700 flex items-center justify-center">P</span>
                    <span className="font-semibold">{k.hadPasukanP ?? 1}</span>
                  </div>
                  <p className="text-[9px] text-gray-400 mt-0.5">{k.saizPasukan ?? 4} atlet/pskmn</p>
                </td>

                {/* Aktif toggle */}
                <td className="px-3 py-3 text-center">
                  <button onClick={() => onToggle(k)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${k.isAktif ? 'bg-[#003399]' : 'bg-gray-300'}`}>
                    <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: k.isAktif ? 'translateX(18px)' : 'translateX(2px)' }} />
                  </button>
                </td>

                {/* Tindakan */}
                <td className="px-3 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
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
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
        isTerbuka: form.isTerbuka === true,
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

            {/* Toggle Terbuka */}
            <label className="flex items-start gap-3 px-3 py-3 mb-3 rounded-lg border cursor-pointer transition-colors select-none
              bg-amber-50 border-amber-200 hover:border-amber-400">
              <input type="checkbox" checked={!!form.isTerbuka}
                onChange={e => set('isTerbuka', e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0" />
              <div>
                <p className="text-xs font-bold text-amber-800">Kategori Terbuka</p>
                <p className="text-[10px] text-amber-600 mt-0.5">
                  Atlet dari <strong>pelbagai umur</strong> dalam julat yang ditetapkan boleh menyertai acara ini.
                  Contoh: semua atlet umur 8–12 thn boleh sertai "100m Terbuka L-SR".
                </p>
              </div>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                label={form.isTerbuka ? 'Umur Minimum (Terbuka)' : 'Umur Min'}
                hint={form.isTerbuka ? 'Umur paling muda boleh sertai. Cth: 8' : 'Tahun. Kosong = tiada had bawah'}>
                <input type="number" min={1} max={25} value={form.umurMin}
                  onChange={e => set('umurMin', e.target.value)} placeholder={form.isTerbuka ? '8' : '9'} className={inputCls} />
              </FormField>
              <FormField
                label={form.isTerbuka ? 'Umur Maksimum (Terbuka)' : 'Umur Had ("Bawah X Thn")'}
                required={!form.isTerbuka}
                hint={form.isTerbuka ? 'Umur paling tua boleh sertai. Cth: 12' : undefined}>
                <input type="number" min={1} max={25} value={form.umurHad}
                  onChange={e => set('umurHad', e.target.value)} placeholder={form.isTerbuka ? '12' : '10'} className={inputCls} />
              </FormField>
            </div>
            {form.umurHad && (
              <div className={`mt-2 rounded-lg px-3 py-2 flex items-center gap-2 border ${
                form.isTerbuka
                  ? 'bg-amber-50 border-amber-100'
                  : 'bg-indigo-50 border-indigo-100'
              }`}>
                <svg className={`w-4 h-4 shrink-0 ${form.isTerbuka ? 'text-amber-400' : 'text-indigo-400'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className={`text-[9px] font-bold ${form.isTerbuka ? 'text-amber-400' : 'text-indigo-400'}`}>
                    {form.isTerbuka ? 'JULAT TERBUKA — TAHUN' : 'KELAYAKAN TAHUN'} {tahun}
                  </p>
                  <p className={`text-xs font-bold ${form.isTerbuka ? 'text-amber-700' : 'text-indigo-700'}`}>
                    {form.isTerbuka
                      ? `Umur ${form.umurMin || '?'} – ${form.umurHad} tahun (lahir ${tahun - Number(form.umurHad)} – ${form.umurMin ? tahun - Number(form.umurMin) : '...'})`
                      : previewTahun
                    }
                  </p>
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

const numCls = 'w-14 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50'

function getJenisTab(a) {
  if (a.jenisAcara === 'relay') return 'relay'
  if (a.jenisAcara === 'padang_lompat' || a.jenisAcara === 'padang_balin') return 'padang'
  return 'larian'
}

function TetapanFinal({ kategoriList }) {
  const [subTab,   setSubTab]   = useState('larian')
  const [setup,    setSetup]    = useState({ larian: {}, relay: {}, padang: {} })
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [dirty,    setDirty]    = useState(false)

  // Live acara + heat data
  const [kejId,           setKejId]           = useState(null)
  const [acaraSaringan,   setAcaraSaringan]   = useState([])
  const [heatCountMap,    setHeatCountMap]    = useState({})   // aceraId → bilangan heat
  const [pesertaCountMap, setPesertaCountMap] = useState({})   // aceraId → bilangan atlet
  const [overrides,       setOverrides]       = useState({})   // aceraId → { bestHeat, bestTime }
  const [loadingAcara,    setLoadingAcara]    = useState(false)
  const [expandedKat,     setExpandedKat]     = useState({})

  // ── Load tetapan dari Firestore ──────────────────────────────────────────────
  const fetchSetup = useCallback(async () => {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'tetapan', 'finalSetup'))
      if (snap.exists()) {
        const d = snap.data()
        setSetup({ larian: d.larian || {}, relay: d.relay || {}, padang: d.padang || {} })
        setOverrides(d.overrideByAcara || {})
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchSetup() }, [fetchSetup])

  // ── Fetch kejohanan aktif + acara saringan + heat counts + peserta ───────────
  useEffect(() => {
    async function fetchAcara() {
      setLoadingAcara(true)
      try {
        const kejSnap = await getDocs(query(
          collection(db, 'kejohanan'),
          where('statusKejohanan', 'in', ['aktif', 'persediaan'])
        ))
        if (kejSnap.empty) return
        const kej = kejSnap.docs[0]
        setKejId(kej.id)

        // Semua acara — simpan yang saringan sahaja
        const acaraSnap = await getDocs(collection(db, 'kejohanan', kej.id, 'acara'))
        const saringan = acaraSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(a => a.peringkat === 'saringan' || (!a.peringkat && !a.parentAcaraId))
        setAcaraSaringan(saringan)

        // Bilangan heat per acara — parallel fetch
        const heatResults = await Promise.all(
          saringan.map(a =>
            getDocs(collection(db, 'kejohanan', kej.id, 'acara', a.id, 'heat'))
              .then(s => [a.id, s.size])
          )
        )
        setHeatCountMap(Object.fromEntries(heatResults))

        // Bilangan peserta per acara dari pendaftaran
        const pendSnap = await getDocs(collection(db, 'kejohanan', kej.id, 'pendaftaran'))
        const cMap = {}
        pendSnap.docs.forEach(d => {
          ;(d.data().acaraIds || []).forEach(id => { cMap[id] = (cMap[id] || 0) + 1 })
        })
        setPesertaCountMap(cMap)
      } catch (e) { console.error(e) }
      finally { setLoadingAcara(false) }
    }
    fetchAcara()
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function setVal(jenis, kod, field, val) {
    setSetup(prev => ({
      ...prev,
      [jenis]: { ...prev[jenis], [kod]: { ...(prev[jenis]?.[kod] || {}), [field]: val === '' ? '' : Number(val) } },
    }))
    setDirty(true); setSaved(false)
  }

  function getVal(jenis, kod, field, def) {
    const v = setup[jenis]?.[kod]?.[field]
    return v === undefined ? def : v
  }

  function activateOverride(aceraId, kat) {
    setOverrides(prev => ({
      ...prev,
      [aceraId]: { bestHeat: getVal(subTab, kat, 'bestHeat', 1), bestTime: getVal(subTab, kat, 'bestTime', 3) }
    }))
    setDirty(true)
  }

  function setOverrideVal(aceraId, field, val) {
    setOverrides(prev => ({
      ...prev,
      [aceraId]: { ...(prev[aceraId] || {}), [field]: val === '' ? '' : Number(val) }
    }))
    setDirty(true); setSaved(false)
  }

  function clearOverride(aceraId) {
    setOverrides(prev => { const n = { ...prev }; delete n[aceraId]; return n })
    setDirty(true)
  }

  // ── Simpan ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true); setSaved(false)
    try {
      const normalise = obj => {
        const out = {}
        Object.entries(obj).forEach(([k, vals]) => {
          out[k] = {}
          Object.entries(vals).forEach(([f, v]) => { out[k][f] = v === '' ? 0 : Number(v) || 0 })
        })
        return out
      }
      await setDoc(doc(db, 'tetapan', 'finalSetup'), {
        larian:          normalise(setup.larian),
        relay:           normalise(setup.relay),
        padang:          normalise(setup.padang),
        overrideByAcara: overrides,
        updatedAt:       serverTimestamp(),
      })
      setDirty(false); setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) { alert('Ralat simpan: ' + e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">Memuatkan tetapan…</div>

  const kods = kategoriList.map(k => k.kod).filter(Boolean)

  return (
    <div className="space-y-5">

      {/* Info bar */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 space-y-1">
        <p className="font-bold">Tetapan ini menentukan cara atlet dipilih untuk perlawanan final</p>
        <p className="text-[11px] text-blue-500">
          <strong>Best Heat</strong> = berapa pemenang diambil dari <em>setiap</em> heat ·
          <strong> Best Time</strong> = tempat tambahan dari masa terbaik keseluruhan ·
          <strong> Total</strong> = (bilangan heat × BH) + BT — dikira automatik apabila heat dijana
        </p>
      </div>

      {/* Sub-tab */}
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
      <p className="text-[11px] text-gray-400 -mt-2">{JENIS_ACARA_TABS.find(t => t.key === subTab)?.hint}</p>

      {/* ── SECTION 1: Default by Kategori ────────────────────────────────────── */}
      <div>
        <p className="text-xs font-bold text-gray-600 mb-2">
          Default — berlaku pada semua acara dalam kategori (melainkan ada override)
        </p>

        {/* Larian & Relay table */}
        {(subTab === 'larian' || subTab === 'relay') && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Kategori</th>
                  <th className="px-4 py-3 text-center">
                    Best Heat
                    <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">pemenang per heat</p>
                  </th>
                  <th className="px-4 py-3 text-center">
                    Best Time
                    <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">masa terbaik tambahan</p>
                  </th>
                  <th className="px-4 py-3 text-center">
                    Formula
                    <p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">N heat × BH + BT</p>
                  </th>
                </tr>
              </thead>
              <tbody>
                {kods.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-xs">Tiada kategori.</td></tr>
                )}
                {kods.map((kod, i) => {
                  const kat      = kategoriList.find(k => k.kod === kod)
                  const bestHeat = getVal(subTab, kod, 'bestHeat', 1)
                  const bestTime = getVal(subTab, kod, 'bestTime', 3)
                  const isErr    = Number(bestHeat) < 0 || Number(bestTime) < 0
                  return (
                    <tr key={kod} className={`border-b border-gray-50 last:border-0 ${i%2===0?'':'bg-gray-50/40'}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-black shrink-0"
                            style={{ backgroundColor: kat?.warna || '#6366f1' }}>{kod}</span>
                          <div>
                            <p className="font-semibold text-gray-700">{kat?.label || kod}</p>
                            <p className="text-[9px] text-gray-400">{kat?.nama || ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="number" min={0} max={99} value={bestHeat}
                          onChange={e => setVal(subTab, kod, 'bestHeat', e.target.value)}
                          className={numCls + (isErr ? ' border-red-300' : '')} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input type="number" min={0} max={99} value={bestTime}
                          onChange={e => setVal(subTab, kod, 'bestTime', e.target.value)}
                          className={numCls + (isErr ? ' border-red-300' : '')} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-[11px] text-gray-400 font-mono">
                          N×{Number(bestHeat)||0} + {Number(bestTime)||0}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Padang table */}
        {subTab === 'padang' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700">
              ⚠️ Padang tiada konsep heat — semua peserta bertanding dalam 1 sesi. Pilihan ke final = jarak/ketinggian terbaik sahaja.
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Kategori</th>
                  <th className="px-4 py-3 text-center">Total Final<p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">masuk peringkat akhir</p></th>
                  <th className="px-4 py-3 text-center">Cubaan Awal<p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">semua peserta</p></th>
                  <th className="px-4 py-3 text-center">Cubaan Akhir<p className="text-[9px] font-normal normal-case text-gray-300 mt-0.5">top N sahaja</p></th>
                </tr>
              </thead>
              <tbody>
                {kods.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-xs">Tiada kategori.</td></tr>
                )}
                {kods.map((kod, i) => {
                  const kat        = kategoriList.find(k => k.kod === kod)
                  const total      = getVal('padang', kod, 'total',       8)
                  const cubaanAwal = getVal('padang', kod, 'cubaanAwal',  3)
                  const cubaanAkhr = getVal('padang', kod, 'cubaanAkhir', 3)
                  return (
                    <tr key={kod} className={`border-b border-gray-50 last:border-0 ${i%2===0?'':'bg-gray-50/40'}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-black shrink-0"
                            style={{ backgroundColor: kat?.warna || '#6366f1' }}>{kod}</span>
                          <div>
                            <p className="font-semibold text-gray-700">{kat?.label || kod}</p>
                            <p className="text-[9px] text-gray-400">{kat?.nama || ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center"><input type="number" min={1} max={99} value={total} onChange={e => setVal('padang', kod, 'total', e.target.value)} className={numCls} /></td>
                      <td className="px-4 py-3 text-center"><input type="number" min={1} max={10} value={cubaanAwal} onChange={e => setVal('padang', kod, 'cubaanAwal', e.target.value)} className={numCls} /></td>
                      <td className="px-4 py-3 text-center"><input type="number" min={1} max={10} value={cubaanAkhr} onChange={e => setVal('padang', kod, 'cubaanAkhir', e.target.value)} className={numCls} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── SECTION 2: Semak & Override Per Acara (Larian & Relay sahaja) ─────── */}
      {(subTab === 'larian' || subTab === 'relay') && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-gray-600">Semak Heat & Override Per Acara</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Sistem baca heat yang dijana secara langsung dari Firestore.
                Override hanya perlu jika acara tertentu berbeza dari default kategori.
              </p>
            </div>
            {loadingAcara && (
              <span className="text-[10px] text-[#003399] font-semibold animate-pulse shrink-0">Memuatkan heat…</span>
            )}
          </div>

          {/* Tiada kejohanan aktif */}
          {!kejId && !loadingAcara && (
            <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center">
              <p className="text-xs text-gray-400">Tiada kejohanan aktif atau dalam persediaan.</p>
              <p className="text-[11px] text-gray-300 mt-1">Override per acara tidak tersedia.</p>
            </div>
          )}

          {/* Per kategori — collapsible */}
          {kejId && kods.map(kod => {
            const kat       = kategoriList.find(k => k.kod === kod)
            const acaraKat  = acaraSaringan.filter(a => a.kategoriKod === kod && getJenisTab(a) === subTab)
            if (acaraKat.length === 0) return null
            const isOpen    = expandedKat[kod] !== false  // default terbuka
            const defBH     = getVal(subTab, kod, 'bestHeat', 1)
            const defBT     = getVal(subTab, kod, 'bestTime', 3)
            const ovCount   = acaraKat.filter(a => overrides[a.id]).length

            return (
              <div key={kod} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">

                {/* Kat header */}
                <button
                  onClick={() => setExpandedKat(p => ({ ...p, [kod]: !isOpen }))}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[9px] font-black shrink-0"
                    style={{ backgroundColor: kat?.warna || '#6366f1' }}>{kod}</span>
                  <span className="text-xs font-bold text-gray-700 flex-1">{kat?.label || kod}</span>
                  <span className="text-[10px] text-gray-400 font-mono">default: {defBH}/heat + {defBT}</span>
                  {ovCount > 0 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ml-2">
                      {ovCount} override
                    </span>
                  )}
                  <span className="text-[10px] text-gray-300 ml-2">{acaraKat.length} acara</span>
                  <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ml-1 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 overflow-x-auto">
                    <table className="w-full text-xs min-w-[560px]">
                      <thead>
                        <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                          <th className="px-4 py-2 text-left">Acara</th>
                          <th className="px-3 py-2 text-center">Heat</th>
                          <th className="px-3 py-2 text-center">Atlet</th>
                          <th className="px-3 py-2 text-center">BH /heat</th>
                          <th className="px-3 py-2 text-center">BT</th>
                          <th className="px-3 py-2 text-center">Total Final</th>
                          <th className="px-3 py-2 text-center"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {acaraKat.map((acara, i) => {
                          const heatCount    = heatCountMap[acara.id] ?? null
                          const pesertaCount = pesertaCountMap[acara.id] ?? 0
                          const hasOverride  = !!overrides[acara.id]
                          const effBH = hasOverride ? (overrides[acara.id]?.bestHeat ?? defBH) : defBH
                          const effBT = hasOverride ? (overrides[acara.id]?.bestTime ?? defBT) : defBT
                          const heatReady    = heatCount !== null && heatCount > 0
                          const total        = heatReady ? (heatCount * Number(effBH)) + Number(effBT) : null
                          const warn         = total !== null && pesertaCount > 0 && total >= Math.round(pesertaCount * 0.8)

                          return (
                            <tr key={acara.id}
                              className={`border-b border-gray-50 last:border-0 ${i%2===0?'':'bg-gray-50/30'}`}>

                              {/* Nama acara */}
                              <td className="px-4 py-2.5">
                                <p className="font-semibold text-gray-700 text-[11px] leading-tight">{acara.namaAcara}</p>
                                {hasOverride && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Override</span>
                                )}
                              </td>

                              {/* Heat badge */}
                              <td className="px-3 py-2.5 text-center">
                                {loadingAcara ? (
                                  <span className="text-[10px] text-gray-300">…</span>
                                ) : heatReady ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>
                                    {heatCount}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block"></span>
                                    —
                                  </span>
                                )}
                              </td>

                              {/* Atlet */}
                              <td className="px-3 py-2.5 text-center text-[11px] text-gray-500">
                                {pesertaCount > 0 ? pesertaCount : '—'}
                              </td>

                              {/* BH */}
                              <td className="px-3 py-2.5 text-center">
                                {hasOverride ? (
                                  <input type="number" min={0} max={99}
                                    value={overrides[acara.id]?.bestHeat ?? defBH}
                                    onChange={e => setOverrideVal(acara.id, 'bestHeat', e.target.value)}
                                    className={numCls} />
                                ) : (
                                  <span className="text-[11px] text-gray-400">{defBH}</span>
                                )}
                              </td>

                              {/* BT */}
                              <td className="px-3 py-2.5 text-center">
                                {hasOverride ? (
                                  <input type="number" min={0} max={99}
                                    value={overrides[acara.id]?.bestTime ?? defBT}
                                    onChange={e => setOverrideVal(acara.id, 'bestTime', e.target.value)}
                                    className={numCls} />
                                ) : (
                                  <span className="text-[11px] text-gray-400">{defBT}</span>
                                )}
                              </td>

                              {/* Total Final */}
                              <td className="px-3 py-2.5 text-center">
                                {total !== null ? (
                                  <div>
                                    <span className={`font-black text-sm ${warn ? 'text-amber-500' : 'text-[#003399]'}`}>
                                      {total}
                                    </span>
                                    {warn && (
                                      <p className="text-[9px] text-amber-400 leading-tight mt-0.5">⚠ semak</p>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-gray-300">
                                    {heatReady ? `${heatCount}×${effBH}+${effBT}` : 'belum jana'}
                                  </span>
                                )}
                              </td>

                              {/* Override / Padam override */}
                              <td className="px-3 py-2.5 text-center">
                                {hasOverride ? (
                                  <button onClick={() => clearOverride(acara.id)}
                                    className="text-[10px] font-bold text-red-400 hover:text-red-600 px-2 py-1 hover:bg-red-50 rounded-lg transition-colors">
                                    Padam
                                  </button>
                                ) : (
                                  <button onClick={() => activateOverride(acara.id, kod)}
                                    className="text-[10px] font-bold text-[#003399] hover:text-[#002288] px-2 py-1 hover:bg-blue-50 rounded-lg transition-colors">
                                    Override
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Panduan */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-[10px] text-gray-500 space-y-1.5">
        <p className="font-bold text-gray-600 text-xs mb-2">Panduan</p>
        <p><span className="font-bold text-gray-700">Best Heat (BH)</span> — Berapa pemenang diambil dari <strong>setiap</strong> heat. Contoh: 1 = 1 pemenang per heat. 6 heat → 6 pemenang layak final.</p>
        <p><span className="font-bold text-gray-700">Best Time (BT)</span> — Tempat tambahan dari atlet dengan masa terbaik yang belum dipilih sebagai pemenang heat.</p>
        <p><span className="font-bold text-gray-700">Total Final</span> — Dikira automatik apabila heat dijana: (bilangan heat × BH) + BT.</p>
        <p><span className="font-bold text-gray-700">Override</span> — Tetapan khusus untuk satu acara sahaja. Jika tiada override, sistem guna default kategori di atas.</p>
        <p><span className="font-bold text-gray-700">⚠ Amaran</span> — Muncul jika Total Final ≥ 80% peserta. Bermakna final hampir sama saiz dengan saringan.</p>
        <p><span className="font-bold text-gray-700">Cubaan Awal/Akhir</span> — Untuk acara padang sahaja.</p>
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
                <KategoriTable items={items} tahun={tahun} {...cardProps} />
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
