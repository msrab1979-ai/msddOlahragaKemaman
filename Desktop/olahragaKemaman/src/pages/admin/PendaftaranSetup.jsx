/**
 * PendaftaranSetup — /dashboard/pendaftaran
 *
 * Dua tab:
 *  Tab 1 — Urus Atlet    : CRUD master atlet (noKP sebagai PK)
 *  Tab 2 — Daftar Acara  : Daftar atlet ke acara dalam sebuah kejohanan
 *
 * Ciri pendaftaran:
 *  - Auto kira kategoriKod dari tarikhLahir + tahun kejohanan (standard MSSM)
 *  - Semak had atlet per sekolah per acara
 *  - Semak konflik jadual (masa bertindih)
 *  - Auto assign noBib (prefix sekolah + nombor berturutan)
 *  - Relay: register pasukan (4 utama + 2 ganti)
 *
 * Data:
 *  atlet/{noKP}
 *  kejohanan/{id}/pendaftaran/{noKP}   — noBib, acaraIds[], isRelay
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy, where, getDoc, writeBatch, getCountFromServer,
  runTransaction,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { validasiPendaftaran } from '../../utils/validasiPendaftaran'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

// ─── Konstanta ────────────────────────────────────────────────────────────────

const NEGERI_LIST = [
  'Terengganu','Kelantan','Pahang','Johor','Selangor','Perak','Kedah','Perlis',
  'Pulau Pinang','Negeri Sembilan','Melaka','Sabah','Sarawak',
  'W.P. Kuala Lumpur','W.P. Labuan','W.P. Putrajaya',
]

const JANTINA_OPTIONS = [{ value:'L', label:'Lelaki' }, { value:'P', label:'Perempuan' }]

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] bg-gray-50'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Kira kategori MSSM dari tahun lahir, jantina, dan tahun kejohanan.
 * Gunakan label prefix (L/P) untuk tapis jantina — elak atlet L dapat kategori P.
 * Pilih kategori paling spesifik (umurHad terkecil) supaya atlet 10 tahun dapat
 * kategori L10 bukan L12 walaupun kedua-dua merangkumi umur 10.
 * Kategori OPEN (ada 'OPEN' dalam label) diabaikan — dikendalikan secara berasingan.
 */
function kiraKategori(tarikhLahir, jantina, tahunKejohanan, kategoriList = []) {
  if (!tarikhLahir || !tahunKejohanan) return null
  const tahunLahir = new Date(tarikhLahir).getFullYear()
  const umur = tahunKejohanan - tahunLahir
  if (kategoriList.length > 0) {
    const filtered = kategoriList.filter(k => {
      // Guna label → nama → kod sebagai fallback untuk kesan jantina
      const checkStr = (k.label || k.nama || k.kod || k.id || '').toUpperCase()
      if (checkStr.includes('OPEN')) return false     // OPEN: handle berasingan
      if (jantina === 'L' && !checkStr.startsWith('L')) return false
      if (jantina === 'P' && !checkStr.startsWith('P')) return false
      return true
    })
    const candidates = filtered.filter(k => umur >= (k.umurMin || 0) && umur <= k.umurHad)
    if (candidates.length === 0) return null
    // Utamakan format baru (L10, L15 dll) berbanding format lama (A-H)
    // kemudian paling spesifik (umurHad terkecil)
    candidates.sort((a, b) => {
      const aNew = !/^[A-H]$/.test(a.kod)
      const bNew = !/^[A-H]$/.test(b.kod)
      if (aNew !== bNew) return aNew ? -1 : 1
      return a.umurHad - b.umurHad
    })
    return candidates[0].kod
  }
  // kategoriList kosong (belum load) — jangan return kod salah format lama
  return null
}

/**
 * Jana noBib baru — guna prefix sekolah + nombor tertinggi+1
 * Format: prefix + nombor dengan padding (bibFormat digit)
 */
function janaNoBib(prefix, bibFormat, senaraiNoBibSedia) {
  const p = (prefix || 'BIB').toUpperCase()
  const fmt = Number(bibFormat) || 3
  // Cari nombor tertinggi dalam senarai sedia ada untuk prefix ini
  let maks = 0
  senaraiNoBibSedia.forEach(nb => {
    if (nb.startsWith(p)) {
      const num = parseInt(nb.slice(p.length), 10)
      if (!isNaN(num) && num > maks) maks = num
    }
  })
  return p + String(maks + 1).padStart(fmt, '0')
}

function timeToMin(t) {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function cekKonflikJadual(aceraIdBaru, jadualAcara, acaraIdsSediaAda) {
  const jadualBaru = jadualAcara.find(j => j.aceraId === aceraIdBaru)
  if (!jadualBaru || !jadualBaru.tarikhAcara) return []
  const startA = timeToMin(jadualBaru.masaMula)
  const endA   = startA + (jadualBaru.masaJangka || 60)
  return acaraIdsSediaAda.filter(aceraId => {
    const j = jadualAcara.find(jj => jj.aceraId === aceraId)
    if (!j || j.tarikhAcara !== jadualBaru.tarikhAcara) return false
    if (j.statusJadual === 'batal') return false
    const startB = timeToMin(j.masaMula)
    const endB   = startB + (j.masaJangka || 60)
    return startA < endB && endA > startB
  })
}

// ─── Sub-Components ───────────────────────────────────────────────────────────

const FormField = ({ label, hint, required, children }) => (
  <div>
    <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wide">
      {label}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
    {children}
    {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
  </div>
)

const KAT_UMUR_LABEL = {A:'B10',B:'B12',C:'B14',D:'B16',E:'B18',PPKI:'PPKI'}
const KAT_UMUR_FULL  = {A:'Bawah 10 Tahun',B:'Bawah 12 Tahun',C:'Bawah 14 Tahun',D:'Bawah 16 Tahun',E:'Bawah 18 Tahun',PPKI:'PPKI'}

function KategoriBadge({ kat, full = false, firestoreLabel }) {
  const colors = {A:'bg-blue-100 text-blue-700',B:'bg-cyan-100 text-cyan-700',C:'bg-green-100 text-green-700',D:'bg-yellow-100 text-yellow-700',E:'bg-orange-100 text-orange-700',PPKI:'bg-purple-100 text-purple-700'}
  // Format lama: huruf tunggal A-H atau PPKI → "Kat C (B14)"
  // Format baru: L10, L12, OPEN-SK-L, dll → tunjuk label terus
  const isOldFormat = /^[A-H]$/.test(kat) || kat === 'PPKI'
  let label
  if (isOldFormat) {
    const displayLabel = firestoreLabel || KAT_UMUR_LABEL[kat] || kat
    const displayFull  = firestoreLabel || KAT_UMUR_FULL[kat] || kat
    label = full ? `Kat ${kat} — ${displayFull}` : `Kat ${kat} (${displayLabel})`
  } else {
    // Format baru — tunjuk firestoreLabel atau kod terus (L10, P12, OPEN-SK-L...)
    label = firestoreLabel || kat
  }
  return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${colors[kat]||'bg-gray-100 text-gray-500'}`}>{kat ? label : '?'}</span>
}

function JantinaBadge({ j }) {
  return <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${j==='L'?'bg-blue-100 text-blue-700':'bg-pink-100 text-pink-700'}`}>{j}</span>
}

// Dropdown inline untuk tukar kategori atlet — simpan ke Firestore
// Gate: hanya tunjuk kategori yang jantina & umur atlet layak (dari KategoriSetup)
// Jika kategori bertukar & atlet ada pendaftaran acara → padam rekod pendaftaran lama
function KatDropdown({ noKP, value, kategoriList, disabled, onSaved,
                       jantina, tarikhLahir, tahunKej, kejohananId, pRec }) {
  const [saving, setSaving] = useState(false)

  async function handleChange(e) {
    const newKat = e.target.value
    if (newKat === (value || '')) return
    setSaving(true)
    try {
      // ── GATE: semak pendaftaran aktif sebelum benarkan tukar kategori ────────
      if (kejohananId) {
        const pendSnap = await getDoc(doc(db, 'kejohanan', kejohananId, 'pendaftaran', noKP))
        if (pendSnap.exists()) {
          const acaraIds = pendSnap.data().acaraIds || []
          if (acaraIds.length > 0) {
            // Semak setiap acara — adakah OPEN (isTerbuka) atau tidak
            const acaraSnaps = await Promise.all(
              acaraIds.map(id => getDoc(doc(db, 'kejohanan', kejohananId, 'acara', id)))
            )
            // Kumpul acara BUKAN OPEN
            const bukanOpen = acaraSnaps.filter(s => {
              if (!s.exists()) return false
              const katId = s.data().kategoriId || s.data().kategoriKod || ''
              const katObj = kategoriList.find(k => (k.id === katId) || (k.kod === katId))
              return !katObj?.isTerbuka
            })
            if (bukanOpen.length > 0) {
              const namaAcara = bukanOpen
                .map(s => s.data().namaAcara || s.data().nama || s.id)
                .join(', ')
              alert(
                `Tidak boleh tukar kategori.\n\n` +
                `Atlet ini sudah mendaftar acara: ${namaAcara}.\n\n` +
                `Buang pendaftaran acara dahulu, kemudian tukar kategori.`
              )
              setSaving(false)
              return
            }
            // Hanya ada acara OPEN — buang pendaftaran keseluruhan tidak perlu,
            // acara OPEN kekal. Tukar kategori dibenar.
          }
        }
      }
      // ── Tukar kategori ────────────────────────────────────────────────────────
      await updateDoc(doc(db, 'atlet', noKP), {
        kategoriKod: newKat || null,
        updatedAt: serverTimestamp(),
      })
      // Tiada acara bukan-OPEN — pendaftaran tidak perlu dibuang
      onSaved(newKat)
    } catch (err) {
      alert('Gagal kemaskini kategori: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // Tapis: hanya kategori yang jantina & umur atlet layak (refer KategoriSetup)
  const umurAtlet = (tahunKej && tarikhLahir)
    ? tahunKej - new Date(tarikhLahir).getFullYear()
    : null

  const valid = [...(kategoriList || [])].filter(k => {
    const label = (k.label || '').toUpperCase()
    if (jantina === 'L' && !label.startsWith('L')) return false
    if (jantina === 'P' && !label.startsWith('P')) return false
    if (umurAtlet !== null) {
      const min = k.umurMin ?? 0
      const max = k.umurHad ?? 99
      if (umurAtlet < min || umurAtlet > max) return false
    }
    return true
  }).sort((a, b) => (a.kod || a.id || '').localeCompare(b.kod || b.id || ''))

  return (
    <select
      value={value || ''}
      onChange={handleChange}
      disabled={disabled || saving}
      className={`text-[9px] font-bold border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[#003399]/30 transition-colors ${
        value
          ? 'border-[#003399]/30 bg-blue-50 text-[#003399]'
          : 'border-red-200 bg-red-50 text-red-500'
      } ${saving ? 'opacity-50' : ''}`}
    >
      <option value="">— pilih —</option>
      {valid.map(k => {
        const kod = k.kod || k.id
        const lbl = k.label || k.nama || kod
        return <option key={kod} value={kod}>{kod} — {lbl}</option>
      })}
    </select>
  )
}

// ─── Modal: Tambah / Edit Atlet ───────────────────────────────────────────────

function AtletModal({ mode, initial, sekolahList, isAdmin, kodSekolahAdmin, sekolahData, existingBibs, onClose, onSaved }) {
  const isEdit = mode === 'edit'

  // BIB helpers — ikut tetapan sekolah
  const bibPrefix = (sekolahData?.bibPrefix || '').toUpperCase()
  const bibFormat = Number(sekolahData?.bibFormat) || 3

  // Auto-kira BIB seterusnya dari senarai BIB sedia ada
  function nextBibNum() {
    if (!bibPrefix) return ''
    let maks = (Number(sekolahData?.bibMula) || 1) - 1
    ;(existingBibs || []).forEach(nb => {
      if (nb?.startsWith(bibPrefix)) {
        const n = parseInt(nb.slice(bibPrefix.length), 10)
        if (!isNaN(n) && n > maks) maks = n
      }
    })
    return String(maks + 1)
  }

  const [form, setForm] = useState(initial || {
    noKP: '', nama: '', jantina: 'L', tarikhLahir: '',
    kodSekolah: kodSekolahAdmin || '',
    kategoriSekolah: sekolahData?.kategori || 'SM',
    negeri:          sekolahData?.negeri   || 'Terengganu',
    daerah:          sekolahData?.daerah   || '',
    noBib: isAdmin && bibPrefix ? bibPrefix + nextBibNum().padStart(bibFormat, '0') : '',
    isAktif: true,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  // Nombor sahaja (tanpa prefix) untuk input BIB
  const bibNumStr = form.noBib?.startsWith(bibPrefix) ? form.noBib.slice(bibPrefix.length) : ''

  // Auto-format NoKP + auto-kesan tarikh lahir + auto-kesan jantina
  function handleNoKPChange(raw) {
    const digits = raw.replace(/\D/g, '').slice(0, 12)
    // Format: YYMMDD-BB-XXXX
    let fmt = digits
    if (digits.length > 6) fmt = digits.slice(0,6) + '-' + digits.slice(6)
    if (digits.length > 8) fmt = digits.slice(0,6) + '-' + digits.slice(6,8) + '-' + digits.slice(8)

    // Auto-kesan tarikh lahir dari 6 digit pertama
    let tarikhLahir = form.tarikhLahir
    if (digits.length >= 6) {
      const yy = parseInt(digits.slice(0,2), 10)
      const mm = parseInt(digits.slice(2,4), 10)
      const dd = parseInt(digits.slice(4,6), 10)
      const currentYY = new Date().getFullYear() % 100
      const year = (yy <= currentYY ? 2000 : 1900) + yy
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        tarikhLahir = `${year}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
      }
    }
    // Auto-detect jantina dari digit terakhir No. KP (ganjil=Lelaki, genap=Perempuan)
    let jantina = form.jantina
    if (digits.length === 12) {
      jantina = parseInt(digits[11], 10) % 2 === 1 ? 'L' : 'P'
    }
    setForm(f => ({ ...f, noKP: fmt, tarikhLahir, jantina }))
  }

  const set = (k, v) => setForm(f => {
    const updated = { ...f, [k]: v }
    if (k === 'kodSekolah' && !isAdmin) {
      const s = sekolahList.find(x => x.kodSekolah === v)
      if (s) {
        updated.kategoriSekolah = s.kategori || updated.kategoriSekolah
        updated.negeri          = s.negeri   || updated.negeri
        updated.daerah          = s.daerah   || updated.daerah
      }
    }
    return updated
  })

  function setBibNum(numStr) {
    const digits = numStr.replace(/\D/g, '')
    const full   = bibPrefix && digits ? bibPrefix + digits.padStart(bibFormat, '0') : digits
    set('noBib', full)
  }

  async function handleSave() {
    setErr('')
    if (!form.noKP.trim())   return setErr('No. Kad Pengenalan wajib diisi.')
    if (!form.nama.trim())   return setErr('Nama atlet wajib diisi.')
    if (!form.tarikhLahir)   return setErr('Tarikh lahir wajib diisi.')
    if (!form.kodSekolah)    return setErr('Pilih sekolah.')
    if (!form.noBib?.trim()) return setErr('No. BIB wajib diisi.')

    // Format NoKP: 12 digit → xxx-xx-xxxx
    const noKP = form.noKP.trim().replace(/-/g, '')
    if (!/^\d{12}$/.test(noKP)) return setErr('Format No. K/P tidak sah. Gunakan 12 digit.')
    const finalNoKP = `${noKP.slice(0,6)}-${noKP.slice(6,8)}-${noKP.slice(8)}`

    const finalBib = form.noBib.trim().toUpperCase()

    // Semak julat nombor mengikut bibFormat (dinamik dari tetapan sekolah)
    if (isAdmin && bibPrefix && bibNumStr) {
      const maxBibAdmin = Math.pow(10, bibFormat) - 1
      const numInt = parseInt(bibNumStr, 10)
      if (isNaN(numInt) || numInt < 1 || numInt > maxBibAdmin) {
        return setErr(`No. BIB melebihi format ${bibFormat} digit. Julat sah: 1–${maxBibAdmin}.`)
      }
    }

    // Semak BIB unik client-side (dari existingBibs yang dihantar dari TabAtlet)
    const bibDuplikat = (existingBibs || []).filter(b => b === finalBib)
    const isSameBib   = isEdit && initial?.noBib === finalBib
    if (bibDuplikat.length > 0 && !isSameBib) {
      return setErr(`No. BIB "${finalBib}" sudah digunakan oleh atlet lain dalam sekolah ini.`)
    }

    setSaving(true)
    try {
      // Semak BIB unik LIVE dari Firestore — tangkap race condition jika dua admin tambah serentak
      if (!isSameBib) {
        const bibSnap = await getDocs(query(
          collection(db, 'atlet'),
          where('kodSekolah', '==', form.kodSekolah),
          where('noBib', '==', finalBib)
        ))
        const clash = bibSnap.docs.find(d => d.id !== finalNoKP)
        if (clash) {
          setSaving(false)
          return setErr(`No. BIB "${finalBib}" sudah digunakan oleh atlet lain dalam sekolah ini (semakan live).`)
        }
      }

      if (!isEdit) {
        const exists = await getDoc(doc(db, 'atlet', finalNoKP))
        if (exists.exists()) return setErr(`Atlet ${finalNoKP} sudah wujud.`)
      }

      const payload = {
        noKP: finalNoKP, nama: form.nama.trim(),
        jantina: form.jantina, tarikhLahir: form.tarikhLahir,
        warganegara: 'MY',
        noBib: finalBib,
        kodSekolah: form.kodSekolah,
        kategoriSekolah: form.kategoriSekolah,
        negeri: form.negeri, daerah: form.daerah || '',
        isAktif: !!form.isAktif,
        updatedAt: serverTimestamp(),
      }
      if (!isEdit) payload.createdAt = serverTimestamp()
      await setDoc(doc(db, 'atlet', finalNoKP), payload, { merge: isEdit })
      onSaved(); onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[94vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-bold text-gray-800">{isEdit ? 'Edit Atlet' : 'Tambah Atlet'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* No. BIB */}
          {(() => {
            const maxBibAdmin = Math.pow(10, bibFormat) - 1
            const contohAdmin = bibPrefix
              ? `${bibPrefix}${String(sekolahData?.bibMula || 1).padStart(bibFormat, '0')}`
              : 'SSI001'
            const hintAdmin = isAdmin && bibPrefix
              ? `Prefix: ${bibPrefix} | ${bibFormat} digit | Julat: 1–${maxBibAdmin} (cth: ${contohAdmin})`
              : `cth: ${contohAdmin}`
            return (
              <FormField label="No. BIB" required hint={hintAdmin}>
                {isAdmin && bibPrefix ? (
                  <div className="flex">
                    <span className="inline-flex items-center px-3 py-2 rounded-l-lg border border-r-0 border-gray-200 bg-gray-100 text-xs font-mono font-bold text-gray-600 select-none">
                      {bibPrefix}
                    </span>
                    <input
                      type="number" min={1} max={maxBibAdmin}
                      value={bibNumStr}
                      onChange={e => setBibNum(e.target.value)}
                      placeholder={String(sekolahData?.bibMula || 1)}
                      className={inputCls + ' rounded-l-none font-mono'}
                    />
                  </div>
                ) : (
                  <input value={form.noBib || ''} onChange={e => set('noBib', e.target.value.toUpperCase())}
                    placeholder={contohAdmin} className={inputCls + ' font-mono'} />
                )}
              </FormField>
            )
          })()}

          {/* No. Kad Pengenalan — auto-format + auto-kesan tarikh lahir */}
          <FormField label="No. Kad Pengenalan" required
            hint="Taip 12 digit — sempang ditambah automatik. Tarikh lahir akan dikesan sendiri.">
            <input
              value={form.noKP}
              onChange={e => handleNoKPChange(e.target.value)}
              placeholder="990101145678"
              className={inputCls + ' font-mono tracking-wider'}
              disabled={isEdit}
              maxLength={14}
            />
          </FormField>

          <FormField label="Nama Penuh" required>
            <input value={form.nama} onChange={e => set('nama', e.target.value)}
              placeholder="Nama seperti dalam kad pengenalan" className={inputCls} />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Jantina" required>
              <div className="flex gap-2 h-[38px]">
                {JANTINA_OPTIONS.map(o => (
                  <button key={o.value} type="button" onClick={() => set('jantina', o.value)}
                    className={`flex-1 rounded-lg text-xs font-bold border transition-colors ${
                      form.jantina===o.value
                        ? o.value==='L'?'bg-blue-600 text-white border-blue-600':'bg-pink-500 text-white border-pink-500'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                    }`}>{o.label}</button>
                ))}
              </div>
            </FormField>
            <FormField label="Tarikh Lahir" required
              hint={form.tarikhLahir && form.noKP.replace(/-/g,'').length >= 6 ? 'Auto dari No. KP' : undefined}>
              <input type="date" value={form.tarikhLahir} onChange={e => set('tarikhLahir', e.target.value)}
                className={inputCls} />
            </FormField>
          </div>

          {/* Sekolah — hanya untuk non-admin; isAdmin auto dari profil */}
          {!isAdmin && (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Sekolah" required>
                <select value={form.kodSekolah} onChange={e => set('kodSekolah', e.target.value)} className={inputCls}>
                  <option value="">— Pilih Sekolah —</option>
                  {sekolahList.map(s => <option key={s.id} value={s.kodSekolah}>{s.kodSekolah} — {s.namaSekolah}</option>)}
                </select>
              </FormField>
              <FormField label="Jenis Sekolah" required>
                <select value={form.kategoriSekolah} onChange={e => set('kategoriSekolah', e.target.value)} className={inputCls}>
                  {['SR','SM','PPKI'].map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </FormField>
            </div>
          )}

          {/* Negeri/Daerah — hanya untuk non-admin; isAdmin auto dari data sekolah */}
          {!isAdmin && (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Negeri">
                <select value={form.negeri} onChange={e => set('negeri', e.target.value)} className={inputCls}>
                  {NEGERI_LIST.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </FormField>
              <FormField label="Daerah">
                <input value={form.daerah} onChange={e => set('daerah', e.target.value)}
                  placeholder="Kemaman" className={inputCls} />
              </FormField>
            </div>
          )}

          <label className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer">
            <span className="text-xs font-semibold text-gray-700">Aktif</span>
            <button type="button" onClick={() => set('isAktif', !form.isAktif)}
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${form.isAktif?'bg-[#003399]':'bg-gray-300'}`}>
              <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                style={{ transform: form.isAktif?'translateX(18px)':'translateX(2px)' }} />
            </button>
          </label>

          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Batal</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50">
            {saving?'Menyimpan…':isEdit?'Kemaskini':'Tambah Atlet'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Daftar Atlet ke Acara ─────────────────────────────────────────────

function DaftarModal({ acara, kejohanan, atletSekolah, pendaftaranList, jadualList, kategoriList, onClose, onSaved }) {
  const [selected, setSelected]   = useState([]) // noKP[]
  const [saving, setSaving]       = useState(false)
  const [validating, setValidating] = useState(false)
  const [err, setErr]             = useState('')
  const [errGate, setErrGate]     = useState('') // gate mana yang gagal
  const [warn, setWarn]           = useState('') // amaran konflik jadual (tidak sekat)

  const tahunKej  = kejohanan?.tarikhMula
    ? new Date(kejohanan.tarikhMula?.toDate?.() || kejohanan.tarikhMula).getFullYear()
    : new Date().getFullYear()

  // Atlet yang sudah daftar acara ini
  const sudahDaftar = pendaftaranList
    .filter(p => p.acaraIds?.includes(acara.aceraId))
    .map(p => p.noKP)

  // Bilangan atlet semasa dalam acara ini (semua sekolah)
  const bilanganAtletDlmAcara = sudahDaftar.length

  // Atlet layak: jantina match + kategori match + belum daftar
  // Kategori OPEN: semak julat umur sahaja (isTerbuka=true)
  // Kategori biasa: utamakan kategoriKod tersimpan, fallback kiraKategori
  const _modalKatObj = kategoriList.find(k => (k.kod || k.id) === acara.kategoriKod)
  const atletLayak = atletSekolah.filter(a => {
    if (a.isAktif === false) return false
    if (a.jantina !== acara.jantina) return false
    if (sudahDaftar.includes(a.noKP)) return false
    if (_modalKatObj?.isTerbuka) {
      const tLahir = a.tarikhLahir ? parseInt(a.tarikhLahir.substring(0, 4)) : 0
      if (!tLahir) return false
      const umur = tahunKej - tLahir
      return umur >= (_modalKatObj.umurMin ? Number(_modalKatObj.umurMin) : 0) &&
             umur <= (_modalKatObj.umurHad ? Number(_modalKatObj.umurHad) : 99)
    }
    // Utamakan kiraKategori (format baru) — atlet lama tersimpan kod lama (D→L15)
    const katKira = kiraKategori(a.tarikhLahir, a.jantina, tahunKej, kategoriList)
    const kat = katKira || a.kategoriKod
    return kat === acara.kategoriKod
  })
  const hadAcara = (() => {
    if (acara.jenisAcara === 'relay' && _modalKatObj) {
      const saizPasukan = Number(_modalKatObj.saizPasukan) || 4
      const hadPasukan  = acara.jantina === 'P'
        ? (Number(_modalKatObj.hadPasukanP) || 1)
        : (Number(_modalKatObj.hadPasukanL) || 1)
      return saizPasukan * hadPasukan
    }
    return acara.hadAtletPerSekolah || 2
  })()
  const sekolahSudah = pendaftaranList
    .filter(p => p.acaraIds?.includes(acara.aceraId) && p.kodSekolah === (atletSekolah[0]?.kodSekolah))
    .length
  const slotSekolahBaki = hadAcara - sekolahSudah

  function toggleSelect(noKP) {
    setSelected(s => s.includes(noKP) ? s.filter(x => x !== noKP) : [...s, noKP])
  }

  async function handleSave() {
    setErr('')
    setErrGate('')
    setWarn('')
    if (selected.length === 0) return setErr('Pilih sekurang-kurangnya seorang atlet.')

    const kejohananId = kejohanan.id

    // ── Validasi semua gate (baca live dari Firestore) ────────────────────────
    setValidating(true)
    let jadualWarning = ''
    try {
      for (const noKP of selected) {
        const atlet = atletSekolah.find(a => a.noKP === noKP)
        if (!atlet) continue

        const hasil = await validasiPendaftaran({
          noKP,
          tarikhLahir:     atlet.tarikhLahir,
          kodSekolah:      atlet.kodSekolah,
          kejohananId,
          aceraId:         acara.aceraId,
          kategoriId:      acara.kategoriKod,
          jenisAcara:      acara.jenisAcara,
          tahunKejohanan:  tahunKej,
        })

        if (!hasil.valid) {
          const namaAtlet = atlet.nama || noKP
          setErr(`${namaAtlet} — ${hasil.mesej}`)
          setErrGate(hasil.gate)
          return
        }
        if (hasil.warning && !jadualWarning) jadualWarning = `${atlet.nama || noKP} — ${hasil.warning}`
      }
    } catch (e) {
      setErr('Ralat semasa validasi: ' + e.message)
      return
    } finally {
      setValidating(false)
    }
    if (jadualWarning) setWarn(jadualWarning)
    // ─────────────────────────────────────────────────────────────────────────

    setSaving(true)
    try {
      const kejohananId = kejohanan.id

      // Dapatkan sekolah info untuk BIB — baca LIVE untuk dapat prefix terkini
      const [sekolahSnap, bibSnap] = await Promise.all([
        getDoc(doc(db, 'sekolah', atletSekolah[0]?.kodSekolah || '')),
        getDocs(collection(db, 'kejohanan', kejohananId, 'pendaftaran')),
      ])
      const sekolahDataLive = sekolahSnap.exists() ? sekolahSnap.data() : {}
      const bibPrefix  = sekolahDataLive.bibPrefix || atletSekolah[0]?.kodSekolah || 'BIB'
      const bibFormat  = sekolahDataLive.bibFormat || 3

      // Kumpul semua noBib sedia ada (dari pendaftaran data field) — untuk semak duplikat
      // Gabung: pendaftaran noBib fields + atlet.noBib (supaya counter tidak clash dengan Tab 1)
      const noBibDariPend = bibSnap.docs.map(d => d.data().noBib).filter(Boolean)
      const noBibDariAtlet = atletSekolah.map(a => a.noBib).filter(Boolean)
      const senaraiNoBib = [...new Set([...noBibDariPend, ...noBibDariAtlet])]

      // Semak live pendaftaran untuk noKP (bukan dari cache pendaftaranList)
      const pendLiveSnap = await getDocs(
        query(collection(db, 'kejohanan', kejohananId, 'pendaftaran'))
      )
      const pendLiveByKP = {}
      pendLiveSnap.docs.forEach(d => {
        const p = d.data()
        if (p.noKP) pendLiveByKP[p.noKP] = { ...p }
      })

      // Pisah: atlet yang sudah ada pendaftaran (update) vs baharu (perlu noBib)
      const toUpdate  = [] // { noKP, pRec }
      const toCreate  = [] // { atlet }

      for (const noKP of selected) {
        const atlet = atletSekolah.find(a => a.noKP === noKP)
        if (!atlet) continue
        const pRec = pendLiveByKP[noKP]
        if (pRec) toUpdate.push({ noKP, pRec })
        else       toCreate.push({ atlet })
      }

      // Update atlet yang sudah ada pendaftaran (selamat, guna noKP sedia ada sebagai doc ID)
      for (const { pRec } of toUpdate) {
        const acaraIds = [...new Set([...(pRec.acaraIds || []), acara.aceraId])]
        await updateDoc(doc(db, 'kejohanan', kejohananId, 'pendaftaran', pRec.noKP), {
          acaraIds,
          updatedAt: serverTimestamp(),
        })
      }

      // Assign noBib untuk atlet baharu via Firestore Transaction — selamat dari race condition
      if (toCreate.length > 0) {
        const kodSekolahCounter = atletSekolah[0]?.kodSekolah || sekolahDataLive.kodSekolah || bibPrefix
        const counterRef = doc(db, 'pendaftaran_counter', `${kejohananId}_${kodSekolahCounter}`)
        await runTransaction(db, async (transaction) => {
          const counterSnap = await transaction.get(counterRef)
          // Mulakan counter dari nilai tertinggi antara: counter doc vs senarai sedia ada
          let lastNum = counterSnap.exists() ? (counterSnap.data().lastBibNum || 0) : 0
          senaraiNoBib.forEach(nb => {
            if (nb.startsWith(bibPrefix)) {
              const n = parseInt(nb.slice(bibPrefix.length), 10)
              if (!isNaN(n) && n > lastNum) lastNum = n
            }
          })

          for (const { atlet } of toCreate) {
            lastNum++
            const noBib = bibPrefix + String(lastNum).padStart(bibFormat, '0')
            transaction.set(doc(db, 'kejohanan', kejohananId, 'pendaftaran', atlet.noKP), {
              noBib,
              noKP:        atlet.noKP,
              namaAtlet:   atlet.nama,
              jantina:     atlet.jantina,
              tarikhLahir: atlet.tarikhLahir,
              kodSekolah:  atlet.kodSekolah,
              namaSekolah: sekolahDataLive.namaSekolah || atlet.kodSekolah,
              kategoriKod: kiraKategori(atlet.tarikhLahir, atlet.jantina, tahunKej, kategoriList),
              acaraIds:    [acara.aceraId],
              isAktif:     true,
              isRelay:     false,
              createdAt:   serverTimestamp(),
              updatedAt:   serverTimestamp(),
            })
          }

          // Simpan lastBibNum terkini supaya transaction seterusnya mulakan dari sini
          transaction.set(counterRef, {
            lastBibNum:  lastNum,
            bibPrefix,
            kodSekolah:  kodSekolahCounter,
            kejohananId,
            updatedAt:   serverTimestamp(),
          })
        })
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-800">Daftar ke Acara</h2>
              <p className="text-xs text-gray-500 mt-0.5 font-semibold">{acara.namaAcara} — Kat {acara.kategoriKod} {acara.jantina==='L'?'Lelaki':'Perempuan'}</p>
              <p className="text-[9px] font-mono text-gray-400 mt-0.5">{acara.aceraId}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
              slotSekolahBaki > 0
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {slotSekolahBaki > 0
                ? `${sekolahSudah}/${hadAcara} slot`
                : `${sekolahSudah}/${hadAcara} PENUH`}
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
              Semua peserta: {bilanganAtletDlmAcara}
            </span>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-3">
          {slotSekolahBaki <= 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-red-600 font-semibold">Had pendaftaran sekolah ini penuh.</p>
              <p className="text-xs text-gray-400 mt-1">Maks {hadAcara} atlet dari sekolah ini untuk acara ini.</p>
            </div>
          ) : atletLayak.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-500">Tiada atlet yang layak.</p>
              <p className="text-xs text-gray-400 mt-1">Semak: jantina, kategori (umur), dan sama ada sudah didaftarkan.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold mb-2">Pilih Atlet ({atletLayak.length} layak)</p>
              {atletLayak.map(a => {
                const katKira = kiraKategori(a.tarikhLahir, a.jantina, tahunKej, kategoriList)
                const kat = katKira || a.kategoriKod
                const katObj = kategoriList.find(k => (k.kod || k.id) === kat)
                const isSelected = selected.includes(a.noKP)
                // Semak jika memilih ini akan melebihi had
                const willExceed = !isSelected && selected.length >= slotSekolahBaki
                return (
                  <button key={a.noKP} type="button"
                    onClick={() => !willExceed && toggleSelect(a.noKP)}
                    disabled={willExceed}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-[#003399] bg-blue-50'
                        : willExceed
                          ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                          : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${isSelected?'border-[#003399] bg-[#003399]':'border-gray-300'}`}>
                        {isSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="text-xs font-bold text-gray-800 truncate">{a.nama}</p>
                        <p className="text-[9px] text-gray-400 font-mono">{a.noKP}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <KategoriBadge kat={kat} firestoreLabel={katObj?.label || katObj?.nama || undefined} />
                      <JantinaBadge j={a.jantina} />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <div className="px-5 py-2 bg-blue-50 border-t border-blue-100 shrink-0">
            <p className="text-xs font-semibold text-[#003399]">{selected.length} atlet dipilih</p>
          </div>
        )}

        {err && (
          <div className="mx-5 mb-2 bg-red-50 border border-red-200 rounded-lg overflow-hidden">
            {errGate && (
              <div className="px-3 py-1 bg-red-100 border-b border-red-200 flex items-center gap-1.5">
                <span className="text-[9px] font-black text-red-600 font-mono">{errGate}</span>
                <span className="text-[9px] text-red-500">Gagal</span>
              </div>
            )}
            <p className="text-red-700 text-xs px-3 py-2">{err}</p>
          </div>
        )}

        {warn && !err && (
          <div className="mx-5 mb-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
            <p className="text-amber-800 text-xs">{warn}</p>
          </div>
        )}

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Batal</button>
          <button onClick={handleSave} disabled={saving || validating || selected.length === 0 || slotSekolahBaki <= 0}
            className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50 flex items-center gap-2">
            {validating ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Menyemak…
              </>
            ) : saving ? 'Mendaftar…' : `Daftar ${selected.length} Atlet`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Buang Atlet dari Acara ────────────────────────────────────────────

function BuangDaftarModal({ atlet, acara, pRec, kejohananId, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)

  async function handleBuang() {
    setSaving(true)
    try {
      const acaraBaru = (pRec.acaraIds || []).filter(id => id !== acara.aceraId)
      if (acaraBaru.length === 0) {
        // Tiada lagi acara — padam rekod pendaftaran
        await deleteDoc(doc(db, 'kejohanan', kejohananId, 'pendaftaran', pRec.noKP))
      } else {
        await updateDoc(doc(db, 'kejohanan', kejohananId, 'pendaftaran', pRec.noKP), {
          acaraIds: acaraBaru,
          updatedAt: serverTimestamp(),
        })
      }
      onSaved(); onClose()
    } catch (e) { alert(e.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 text-center">
        <div className="w-11 h-11 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
          </svg>
        </div>
        <h3 className="text-sm font-bold text-gray-800 mb-1">Buang Pendaftaran?</h3>
        <p className="text-xs text-gray-500 mb-4">
          Buang <strong>{atlet?.namaAtlet}</strong> dari <strong>{acara.namaAcara}</strong>?
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Batal</button>
          <button onClick={handleBuang} disabled={saving}
            className="flex-1 py-2 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
            {saving ? 'Membuang…' : 'Buang'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── Modal: Import Atlet dari Excel/CSV ──────────────────────────────────────

/**
 * Nama kolum yang diiktiraf dalam fail Excel/CSV.
 * Tidak case-sensitive. Boleh guna alias Melayu atau Inggeris.
 */
const COL_ALIAS = {
  noKP: ['nokp','no kp','no. kp','no kad pengenalan','ic','ic number','icno','no. k/p','nokp (12 digit)'],
  nama: ['nama','name','nama penuh','full name','namapenuh'],
  noBib: ['nobib','no bib','no. bib','bib','nombor bib','bib number','no badan','no. badan'],
}

function findCol(headers, field) {
  const aliases = COL_ALIAS[field]
  return headers.find(h => aliases.includes(h.toLowerCase().trim().replace(/\s+/g,' ')))
}

function formatNoKP(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 12)
  if (digits.length < 12) return null
  return `${digits.slice(0,6)}-${digits.slice(6,8)}-${digits.slice(8)}`
}

function autoTarikhLahir(noKP12) {
  // noKP12 = 12 digits (YYMMDD...)
  const yy = parseInt(noKP12.slice(0,2), 10)
  const mm = parseInt(noKP12.slice(2,4), 10)
  const dd = parseInt(noKP12.slice(4,6), 10)
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const curYY = new Date().getFullYear() % 100
  const year  = (yy <= curYY ? 2000 : 1900) + yy
  return `${year}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
}

function autoJantina(noKP12) {
  // Digit terakhir No. KP: ganjil = Lelaki, genap = Perempuan
  const lastDigit = parseInt(noKP12.slice(11), 10)
  return lastDigit % 2 === 0 ? 'P' : 'L'
}

function downloadTemplateAtlet(bibPrefix = '', bibFormat = 3) {
  const wb  = XLSX.utils.book_new()
  const p   = bibPrefix || 'XXX'
  const fmt = n => p + String(n).padStart(bibFormat, '0')
  const headers = ['noKP (12 digit)', 'nama', 'noBib']
  const examples = [
    ['120115-12-0001', 'Ahmad bin Ali',     fmt(1)],
    ['130220-14-0002', 'Siti binti Bakar',  fmt(2)],
    ['140305-16-0003', 'Raju a/l Muthu',    fmt(3)],
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples])
  ws['!cols'] = [{ wch:20 }, { wch:35 }, { wch:12 }]
  XLSX.utils.book_append_sheet(wb, ws, 'ATLET')

  // Sheet 2: Panduan
  const panduan = [
    ['PANDUAN PENGISIAN TEMPLAT ATLET KOAM'],
    [''],
    ['Kolum', 'Wajib', 'Penerangan'],
    ['noKP (12 digit)', 'Ya', 'No. Kad Pengenalan — 12 digit (boleh ada sempang atau tidak)'],
    ['nama',            'Ya', 'Nama penuh atlet seperti dalam kad pengenalan'],
    ['noBib',           'Ya', `No. Badan atlet — contoh: ${fmt(1)}, ${fmt(2)}, ${fmt(3)}`],
    [''],
    ['AUTO-DETECT dari No. KP (tidak perlu isi):','',''],
    ['Jantina',      '(auto)', 'Digit terakhir No. KP — ganjil = Lelaki, genap = Perempuan'],
    ['Tarikh Lahir', '(auto)', '6 digit pertama No. KP (YYMMDD) → auto tukar ke YYYY-MM-DD'],
    [''],
    ['CONTOH No. KP:','',''],
    ['120115-12-0001','→ Tarikh Lahir: 2012-01-15, Jantina: Lelaki (digit terakhir 1 = ganjil)',''],
    ['130220-14-0002','→ Tarikh Lahir: 2013-02-20, Jantina: Perempuan (digit terakhir 2 = genap)',''],
    [''],
    ['NOTA:','Baris pertama adalah HEADER — jangan padam atau ubah.',''],
    ['','Fail boleh disimpan semula sebagai .xlsx atau .csv.',''],
  ]
  const ws2 = XLSX.utils.aoa_to_sheet(panduan)
  ws2['!cols'] = [{ wch:22 }, { wch:65 }, { wch:5 }]
  XLSX.utils.book_append_sheet(wb, ws2, 'PANDUAN')

  XLSX.writeFile(wb, 'template_atlet_koam.xlsx')
}

// ─── TukarAtletModal ─────────────────────────────────────────────────────────

function TukarAtletModal({ pRec, aceraId, acaraObj, atletSekolah, pendaftaranList, myPendaftaran, acaraList, kategoriList, kategoriHadMap, tahunKej, onClose, onConfirm }) {
  const [pilihanNoKP, setPilihanNoKP] = useState('')
  const [saving, setSaving]           = useState(false)

  const katObj      = kategoriList.find(k => k.kod === acaraObj.kategoriKod)
  const isRelay     = acaraObj.jenisAcara === 'relay'
  const hadIndividu = kategoriHadMap?.[acaraObj.kategoriKod]?.hadIndividu ?? 3
  const hadBeregu   = kategoriHadMap?.[acaraObj.kategoriKod]?.hadBeregu   ?? 2

  const sudahDaftar = pendaftaranList
    .filter(p => (p.acaraIds || []).includes(aceraId))
    .map(p => p.noKP)

  // Kira bilangan acara (individu atau relay) dalam kategori ini untuk satu atlet
  function bilanganDalamKat(noKP, jenisRelay) {
    const pend = myPendaftaran.find(p => p.noKP === noKP)
    if (!pend) return 0
    return (pend.acaraIds || []).filter(id => {
      const ac = acaraList.find(a => (a.aceraId || a.id) === id)
      return ac && ac.kategoriKod === acaraObj.kategoriKod &&
        (jenisRelay ? ac.jenisAcara === 'relay' : ac.jenisAcara !== 'relay')
    }).length
  }

  const calonGanti = atletSekolah.filter(a => {
    if (a.noKP === pRec.noKP) return false
    if (a.isAktif === false) return false
    if (a.jantina !== acaraObj.jantina) return false
    if (sudahDaftar.includes(a.noKP)) return false
    // Semak had kuota acara
    if (isRelay) {
      if (bilanganDalamKat(a.noKP, true) >= hadBeregu) return false
    } else {
      if (bilanganDalamKat(a.noKP, false) >= hadIndividu) return false
    }
    // Semak kelayakan kategori
    if (katObj?.isTerbuka) {
      const tLahir = a.tarikhLahir ? parseInt(a.tarikhLahir.substring(0, 4)) : 0
      if (!tLahir) return false
      const umur = tahunKej - tLahir
      return umur >= (katObj.umurMin ? Number(katObj.umurMin) : 0) && umur <= (katObj.umurHad ? Number(katObj.umurHad) : 99)
    }
    // Utamakan kiraKategori (format baru) — atlet lama tersimpan kod lama (D→L15)
    const katKira = kiraKategori(a.tarikhLahir, a.jantina, tahunKej, kategoriList)
    const kat = katKira || a.kategoriKod
    return kat === acaraObj.kategoriKod
  })

  async function doTukar() {
    if (!pilihanNoKP) return
    setSaving(true)
    await onConfirm(pilihanNoKP)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">Tukar Atlet</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs">
          <p className="text-[10px] text-gray-400 mb-0.5">Acara</p>
          <p className="font-bold text-gray-800">{acaraObj.namaAcara}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
          <p className="text-[10px] text-amber-500 mb-0.5">Atlet semasa (akan dibuang)</p>
          <p className="font-bold text-amber-800">{pRec.namaAtlet}</p>
        </div>
        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide">
            Gantikan dengan
          </label>
          {calonGanti.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">Tiada atlet lain yang layak untuk acara ini.</p>
          ) : (
            <select value={pilihanNoKP} onChange={e => setPilihanNoKP(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#003399]/25">
              <option value="">— Pilih atlet ganti —</option>
              {calonGanti.map(a => (
                <option key={a.noKP} value={a.noKP}>
                  {a.noBib ? `[${a.noBib}] ` : ''}{a.nama}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 px-3 py-2 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Batal
          </button>
          <button onClick={doTukar} disabled={!pilihanNoKP || saving || calonGanti.length === 0}
            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Menyimpan…' : 'Tukar Atlet'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ImportAtletModal({ sekolahData, existingBibs, onClose, onSaved }) {
  const [rows,    setRows]    = useState([])
  const [saving,  setSaving]  = useState(false)
  const [fileErr, setFileErr] = useState('')
  const [done,    setDone]    = useState(false)
  const [saveInfo, setSaveInfo] = useState({ ok: 0, skip: 0 })

  const bibPrefix = (sekolahData?.bibPrefix || '').toUpperCase()
  const bibFormat = Number(sekolahData?.bibFormat) || 3
  const bibMula   = Number(sekolahData?.bibMula)   || 1

  function computeNextBibNum(existingSet) {
    let maks = bibMula - 1
    existingSet.forEach(nb => {
      if (nb?.startsWith(bibPrefix)) {
        const n = parseInt(nb.slice(bibPrefix.length), 10)
        if (!isNaN(n) && n > maks) maks = n
      }
    })
    return maks + 1
  }

  function makeBib(num) {
    return bibPrefix ? bibPrefix + String(num).padStart(bibFormat, '0') : ''
  }

  function parseFile(file) {
    setFileErr('')
    setRows([])
    setDone(false)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb  = XLSX.read(new Uint8Array(e.target.result), { type: 'array' })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (raw.length === 0) { setFileErr('Fail kosong atau tiada data.'); return }

        const hdrs     = Object.keys(raw[0])
        const colNoKP  = findCol(hdrs, 'noKP')
        const colNama  = findCol(hdrs, 'nama')
        const colNoBib = findCol(hdrs, 'noBib')

        if (!colNoKP || !colNama) {
          setFileErr('Kolum wajib tidak dijumpai. Pastikan header ada: noKP, nama, noBib.')
          return
        }
        if (!colNoBib) {
          setFileErr('Kolum "noBib" tidak dijumpai. Sila gunakan templat yang disediakan.')
          return
        }

        // Kumpul semua BIB sedia ada untuk semak clash
        const bibSet = new Set(existingBibs || [])
        const seenKP  = new Set()
        const seenBib = new Set()

        const parsed = raw.map((r, i) => {
          const errs = []

          // ── noKP ──────────────────────────────────────────────────────────
          const noKPRaw = String(r[colNoKP] || '').trim()
          const digits  = noKPRaw.replace(/\D/g, '')
          const noKP    = formatNoKP(noKPRaw)

          if (!noKPRaw) {
            errs.push('No. K/P kosong')
          } else if (digits.length < 12) {
            errs.push(`No. K/P kurang digit — ada ${digits.length}, perlu 12`)
          } else if (digits.length > 12) {
            errs.push(`No. K/P terlalu panjang — ada ${digits.length} digit`)
          } else if (!noKP) {
            errs.push('No. K/P tidak sah')
          } else if (seenKP.has(noKP)) {
            errs.push('No. K/P berganda dalam fail ini')
          }
          if (noKP) seenKP.add(noKP)

          // ── nama ──────────────────────────────────────────────────────────
          const nama = String(r[colNama] || '').trim()
          if (!nama) errs.push('Nama kosong')

          // ── noBib — wajib diisi oleh guru ─────────────────────────────────
          const noBib = String(r[colNoBib] || '').trim().toUpperCase()
          if (!noBib) {
            errs.push('No. BIB kosong — wajib diisi')
          } else if (bibSet.has(noBib)) {
            errs.push(`No. BIB "${noBib}" sudah digunakan oleh atlet lain`)
          } else if (seenBib.has(noBib)) {
            errs.push(`No. BIB "${noBib}" berganda dalam fail ini`)
          }
          if (noBib && !bibSet.has(noBib)) seenBib.add(noBib)

          // ── jantina — auto-detect dari digit terakhir noKP ────────────────
          const jantina = noKP ? autoJantina(noKP.replace(/-/g,'')) : ''

          // ── tarikhLahir — auto-detect dari 6 digit pertama noKP ───────────
          const tarikhLahir = noKP ? (autoTarikhLahir(noKP.replace(/-/g,'')) || '') : ''
          if (noKP && !tarikhLahir) errs.push('Tarikh lahir tidak dapat dikesan dari No. K/P')

          return { row: i + 2, noKP, noKPRaw, nama, jantina, tarikhLahir, noBib, errs }
        })

        setRows(parsed)
      } catch (ex) {
        setFileErr(`Gagal baca fail: ${ex.message}`)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleSave() {
    const valid = rows.filter(r => r.errs.length === 0)
    if (valid.length === 0) return

    setSaving(true)
    let ok = 0, skip = 0

    try {
      for (const r of valid) {
        // Semak jika noKP sudah wujud — tidak overwrite
        const snap = await getDoc(doc(db, 'atlet', r.noKP))
        if (snap.exists()) { skip++; continue }

        await setDoc(doc(db, 'atlet', r.noKP), {
          noKP:            r.noKP,
          nama:            r.nama,
          jantina:         r.jantina,
          tarikhLahir:     r.tarikhLahir,
          warganegara:     'MY',
          noBib:           r.noBib,
          kodSekolah:      sekolahData?.kodSekolah || '',
          kategoriSekolah: sekolahData?.kategori   || '',
          negeri:          sekolahData?.negeri      || '',
          daerah:          sekolahData?.daerah      || '',
          isAktif:         true,
          createdAt:       serverTimestamp(),
          updatedAt:       serverTimestamp(),
        })
        ok++
      }
      setSaveInfo({ ok, skip })
      setDone(true)
      setTimeout(() => { onSaved(); onClose() }, 2000)
    } catch (e) {
      setFileErr(`Gagal simpan: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const validCount   = rows.filter(r => r.errs.length === 0).length
  const invalidCount = rows.filter(r => r.errs.length  > 0).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-gray-800">Import Atlet dari Excel / CSV</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">
              Muat naik fail Excel (.xlsx) atau CSV (.csv). No. BIB akan ditetapkan secara automatik.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Langkah 1 — Template */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-blue-800">Langkah 1 — Muat turun templat</p>
              <p className="text-[10px] text-blue-600 mt-1">
                <strong>3 kolum wajib</strong>: <strong>noKP</strong>, <strong>nama</strong>, <strong>noBib</strong><br/>
                Jantina &amp; tarikh lahir <strong>auto-detect</strong> dari No. K/P<br/>
                No. BIB <strong>diisi oleh guru</strong> — mengikut senarai badan rasmi
              </p>
            </div>
            <button onClick={() => downloadTemplateAtlet(bibPrefix, bibFormat)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Muat Turun Templat
            </button>
          </div>

          {/* Langkah 2 — Upload */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Langkah 2 — Muat naik fail</p>
            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
              <svg className="w-7 h-7 text-gray-400 mb-1" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs text-gray-500">
                Klik atau seret fail <strong>.xlsx</strong> / <strong>.xls</strong> / <strong>.csv</strong> ke sini
              </span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => e.target.files?.[0] && parseFile(e.target.files[0])} />
            </label>
            {fileErr && (
              <div className="mt-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <svg className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-xs text-red-700 font-semibold">{fileErr}</p>
              </div>
            )}
          </div>

          {/* Langkah 3 — Preview */}
          {rows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                  Langkah 3 — Semak sebelum simpan
                </p>
                <div className="flex gap-2">
                  {validCount > 0 && (
                    <span className="text-[10px] font-bold px-2.5 py-1 bg-green-100 text-green-700 rounded-full">
                      {validCount} sah
                    </span>
                  )}
                  {invalidCount > 0 && (
                    <span className="text-[10px] font-bold px-2.5 py-1 bg-red-100 text-red-700 rounded-full">
                      {invalidCount} ada ralat
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-xs min-w-[640px]">
                    <thead className="sticky top-0 bg-gray-50 z-10 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide w-8">Baris</th>
                        <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">No. Kad Pengenalan</th>
                        <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">Nama Penuh</th>
                        <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide w-20">Jantina</th>
                        <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">Tarikh Lahir</th>
                        <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide">No. BIB</th>
                        <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const isOk = r.errs.length === 0
                        return (
                          <tr key={i} className={`border-b border-gray-50 ${!isOk ? 'bg-red-50' : 'hover:bg-gray-50/50'}`}>
                            <td className="px-3 py-2 text-[9px] font-mono text-gray-400">{r.row}</td>
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-700">
                              {r.noKP || (
                                <span className="text-red-400 italic text-[9px]">{r.noKPRaw || '(kosong)'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-semibold text-gray-800 max-w-[180px] truncate">
                              {r.nama || <span className="text-red-400 italic text-[9px]">(kosong)</span>}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {r.jantina === 'L' ? (
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Lelaki</span>
                              ) : r.jantina === 'P' ? (
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-700">Perempuan</span>
                              ) : (
                                <span className="text-[9px] text-red-400 font-semibold">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-600">
                              {r.tarikhLahir || <span className="text-red-400 italic text-[9px]">—</span>}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {r.noBib ? (
                                <span className="text-[10px] font-black text-[#003399] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                                  {r.noBib}
                                </span>
                              ) : (
                                <span className="text-[9px] text-gray-300">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {isOk ? (
                                <span className="text-[9px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                                  Sah
                                </span>
                              ) : (
                                <div className="space-y-0.5">
                                  {r.errs.map((e, j) => (
                                    <p key={j} className="text-[9px] text-red-600 font-semibold leading-tight">{e}</p>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {invalidCount > 0 && (
                <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <svg className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-[10px] text-amber-800">
                    <strong>{invalidCount} baris ada ralat</strong> dan akan dilangkau.
                    Hanya <strong>{validCount} baris sah</strong> yang akan disimpan.
                    Betulkan fail dan muat naik semula untuk import semua.
                  </p>
                </div>
              )}
            </div>
          )}

          {done && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-xs font-bold text-green-800">Import berjaya!</p>
                <p className="text-[10px] text-green-700 mt-0.5">
                  {saveInfo.ok} atlet disimpan
                  {saveInfo.skip > 0 ? `, ${saveInfo.skip} dilangkau (noKP sudah wujud)` : ''}.
                  Senarai atlet sedang dikemas kini…
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between shrink-0">
          <p className="text-[10px] text-gray-400">
            {bibPrefix
              ? `Prefix BIB sekolah ini: ${bibPrefix} — contoh: ${bibPrefix}${'0'.repeat(bibFormat - 1)}1`
              : 'Tiada bibPrefix — tetapkan dalam SekolahSetup'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">
              Batal
            </button>
            <button onClick={handleSave}
              disabled={saving || validCount === 0 || done}
              className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50 flex items-center gap-2">
              {saving ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Menyimpan…
                </>
              ) : `Simpan ${validCount} Atlet`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tab 2: Pendaftaran ke Acara ──────────────────────────────────────────────

// ─── Analisa Pendaftaran ──────────────────────────────────────────────────────

function AnalisaPendaftaran({ acaraList, pendaftaranList, sekolahList, namaSekolahMap, katDibenar, isSuperadmin, namaKej, kategoriList = [] }) {
  const [view, setView]         = useState('acara') // 'acara' | 'sekolah'
  const [expandedId, setExpandedId] = useState(null)

  // Filter — By Acara
  const [fKat,    setFKat]    = useState('semua')
  const [fJantina, setFJantina] = useState('semua')
  const [fStatus,  setFStatus]  = useState('semua')

  // Filter — By Sekolah
  const [fJenis,   setFJenis]   = useState('semua')
  const [fDaftar,  setFDaftar]  = useState('semua') // 'semua' | 'daftar' | 'belum'

  // ── By Acara ──────────────────────────────────────────────────────────────
  const byAcara = useMemo(() => {
    const acaraTapis = katDibenar
      ? acaraList.filter(a => katDibenar.includes(a.kategoriKod))
      : acaraList
    return acaraTapis
      .filter(a => a.isAktif !== false)
      .map(a => {
        const aceraId = a.aceraId || a.id
        const peserta = pendaftaranList.filter(p => p.acaraIds?.includes(aceraId))
        const bySkl   = {}
        peserta.forEach(p => {
          if (!bySkl[p.kodSekolah]) bySkl[p.kodSekolah] = []
          bySkl[p.kodSekolah].push(p)
        })
        return {
          ...a,
          aceraId,
          pesertaCount: peserta.length,
          sekolahCount: Object.keys(bySkl).length,
          bySkl,
          had: a.hadAtletPerSekolah || 2,
        }
      })
      .sort((a, b) => {
        if (a.kategoriKod < b.kategoriKod) return -1
        if (a.kategoriKod > b.kategoriKod) return 1
        return (a.noAcara || 0) - (b.noAcara || 0)
      })
  }, [acaraList, pendaftaranList, katDibenar])

  // ── By Sekolah ────────────────────────────────────────────────────────────
  const bySekolah = useMemo(() => {
    const sekolahTapis = katDibenar
      ? sekolahList.filter(s => {
          const kats = katsForJenis(s.kategori, kategoriList)
          return kats.some(k => katDibenar.includes(k))
        })
      : sekolahList
    return sekolahTapis.map(s => {
      const pendSkl = pendaftaranList.filter(p => p.kodSekolah === s.kodSekolah)
      const acaraIds = new Set(pendSkl.flatMap(p => p.acaraIds || []))
      const L = pendSkl.filter(p => p.jantina === 'L').length
      const P = pendSkl.filter(p => p.jantina === 'P').length
      return {
        ...s,
        totalAtlet: pendSkl.length,
        totalAcara: acaraIds.size,
        L, P,
        pendSkl,
      }
    }).sort((a, b) => b.totalAtlet - a.totalAtlet)
  }, [sekolahList, pendaftaranList, katDibenar])

  // Senarai unik kategori dalam data (untuk dropdown)
  const katOptions = useMemo(() => [...new Set(byAcara.map(a => a.kategoriKod))].sort(), [byAcara])

  // Tapis byAcara ikut filter
  const byAcaraFiltered = useMemo(() => {
    return byAcara.filter(a => {
      if (fKat !== 'semua' && a.kategoriKod !== fKat) return false
      if (fJantina !== 'semua' && a.jantina !== fJantina) return false
      if (fStatus !== 'semua') {
        const s = (() => {
          const isRelay = a.jenisAcara === 'relay'
          if (a.pesertaCount === 0)                        return 'kosong'
          if (a.pesertaCount < (isRelay ? 2 : 4))         return 'kurang'
          if (a.pesertaCount < (isRelay ? 4 : 8))         return 'sederhana'
          return 'cukup'
        })()
        if (s !== fStatus) return false
      }
      return true
    })
  }, [byAcara, fKat, fJantina, fStatus])

  // Tapis bySekolah ikut filter
  const bySekolahFiltered = useMemo(() => {
    return bySekolah.filter(s => {
      if (fJenis !== 'semua' && s.kategori !== fJenis) return false
      if (fDaftar === 'daftar'  && s.totalAtlet === 0) return false
      if (fDaftar === 'belum'   && s.totalAtlet > 0)   return false
      return true
    })
  }, [bySekolah, fJenis, fDaftar])

  const KAT_COLOR = { A:'bg-blue-100 text-blue-700', B:'bg-cyan-100 text-cyan-700', C:'bg-green-100 text-green-700', D:'bg-yellow-100 text-yellow-700', E:'bg-orange-100 text-orange-700', PPKI:'bg-purple-100 text-purple-700' }

  function statusKuota(peserta, jenisAcara) {
    const isRelay = jenisAcara === 'relay'
    const cukup   = isRelay ? 4 : 8
    const sederhana = isRelay ? 2 : 4
    if (peserta === 0)          return { label:'Kosong',    cls:'bg-gray-100 text-gray-400' }
    if (peserta < sederhana)    return { label:'Kurang',    cls:'bg-red-100 text-red-600' }
    if (peserta < cukup)        return { label:'Sederhana', cls:'bg-yellow-100 text-yellow-700' }
    return                             { label:'Cukup',     cls:'bg-green-100 text-green-700' }
  }

  const tarikhCetak = new Date().toLocaleString('ms-MY', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  // Helper: bina header ringkas untuk PDF analisa
  function pdfHeader(pdf, tajuk, subTajuk) {
    const pageW = pdf.internal.pageSize.getWidth()
    let y = 14
    pdf.setFillColor(0, 51, 153)
    pdf.rect(0, 0, pageW, 10, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold')
    pdf.text(namaKej || 'Kejohanan Olahraga Antara Murid', pageW / 2, 7, { align: 'center' })
    pdf.setTextColor(0, 0, 0)
    pdf.setFontSize(10); pdf.setFont('helvetica', 'bold')
    pdf.text(tajuk, pageW / 2, y + 6, { align: 'center' })
    if (subTajuk) {
      pdf.setFontSize(8); pdf.setFont('helvetica', 'normal')
      pdf.text(subTajuk, pageW / 2, y + 11, { align: 'center' })
    }
    pdf.setDrawColor(0, 51, 153); pdf.setLineWidth(0.5)
    pdf.line(12, y + 14, pageW - 12, y + 14)
    return y + 19
  }

  // ── PDF 1: Borang Pendaftaran per Sekolah ────────────────────────────────────
  function cetakBorangSekolah(s) {
    const pdf   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = pdf.internal.pageSize.getWidth()
    const acaraMap = Object.fromEntries(acaraList.map(a => [a.aceraId || a.id, a]))
    const startY = pdfHeader(pdf, 'BORANG PENDAFTARAN PESERTA', s.namaSekolah || s.kodSekolah)

    const rows = []
    let bil = 1
    s.pendSkl
      .sort((a, b) => (a.jantina || '').localeCompare(b.jantina || '') || (a.noBib || '').localeCompare(b.noBib || ''))
      .forEach(p => {
        const acaraNama = (p.acaraIds || [])
          .map(id => {
            const a = acaraMap[id]
            return a ? (a.namaAcara || id) : id
          })
          .join(', ') || '—'
        rows.push([
          bil++,
          p.noBib || '—',
          p.namaAtlet || '—',
          p.noKP || '—',
          p.jantina || '—',
          p.kategoriKod || '—',
          acaraNama,
        ])
      })

    autoTable(pdf, {
      startY,
      head: [['#', 'No. Badan', 'Nama Penuh', 'No. K/P', 'J', 'Kat', 'Acara Didaftarkan']],
      body: rows,
      styles: { fontSize: 7.5, cellPadding: 1.8 },
      headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { cellWidth: 20, fontStyle: 'bold', halign: 'center' },
        3: { cellWidth: 30, font: 'courier', fontSize: 7 },
        4: { halign: 'center', cellWidth: 8 },
        5: { halign: 'center', cellWidth: 10 },
      },
      margin: { left: 12, right: 12 },
    })

    const fy = (pdf.lastAutoTable?.finalY || startY + 10) + 12
    const L  = s.pendSkl.filter(p => p.jantina === 'L').length
    const P  = s.pendSkl.filter(p => p.jantina === 'P').length
    pdf.setFontSize(8); pdf.setFont('helvetica', 'normal')
    pdf.text(`Dicetak: ${tarikhCetak}`, 12, fy)
    pdf.text(`Jumlah Atlet: ${s.pendSkl.length} (L: ${L}, P: ${P})`, 12, fy + 5)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Tandatangan Guru Pengiring / Pengurus Pasukan:', pageW - 90, fy)
    pdf.setFont('helvetica', 'normal')
    pdf.text('Nama  : ________________________', pageW - 90, fy + 6)
    pdf.text('T/Tangan: ________________________', pageW - 90, fy + 13)
    pdf.text('Cop Sekolah: ________________________', pageW - 90, fy + 20)
    pdf.setDrawColor(0, 51, 153); pdf.setLineWidth(0.3)
    pdf.line(12, fy + 27, pageW - 12, fy + 27)

    pdf.save(`Borang_${s.kodSekolah}_${namaKej || 'Pendaftaran'}.pdf`)
  }

  // ── PDF 2: Laporan Status Semua Sekolah ──────────────────────────────────────
  function cetakLaporanStatus() {
    const pdf    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW  = pdf.internal.pageSize.getWidth()
    const startY = pdfHeader(pdf, 'LAPORAN STATUS PENDAFTARAN', `Sehingga: ${tarikhCetak}`)

    const sekolahTapisAll = bySekolahFiltered
    const rows = sekolahTapisAll.map((s, i) => [
      i + 1,
      s.namaSekolah || s.kodSekolah,
      s.kategori || '—',
      s.L || 0,
      s.P || 0,
      s.totalAtlet || 0,
      s.totalAcara || 0,
      s.totalAtlet > 0 ? 'Sudah Daftar' : 'Belum Daftar',
    ])

    const sudah  = sekolahTapisAll.filter(s => s.totalAtlet > 0).length
    const belum  = sekolahTapisAll.filter(s => s.totalAtlet === 0).length
    const totL   = sekolahTapisAll.reduce((s, x) => s + (x.L || 0), 0)
    const totP   = sekolahTapisAll.reduce((s, x) => s + (x.P || 0), 0)

    autoTable(pdf, {
      startY,
      head: [['#', 'Sekolah', 'Jenis', 'L', 'P', 'Jumlah', 'Acara', 'Status']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        2: { halign: 'center', cellWidth: 14 },
        3: { halign: 'center', cellWidth: 10 },
        4: { halign: 'center', cellWidth: 10 },
        5: { halign: 'center', cellWidth: 14 },
        6: { halign: 'center', cellWidth: 14 },
        7: { halign: 'center', cellWidth: 24 },
      },
      foot: [['', 'JUMLAH', '', totL, totP, totL + totP, '', `${sudah} daftar / ${belum} belum`]],
      footStyles: { fillColor: [230, 235, 255], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 8 },
      margin: { left: 12, right: 12 },
    })

    const fy = (pdf.lastAutoTable?.finalY || startY + 10) + 8
    pdf.setFontSize(8); pdf.setFont('helvetica', 'normal')
    pdf.text(`Dicetak: ${tarikhCetak}`, 12, fy)
    pdf.setFont('helvetica', 'bold')
    pdf.text(`Sekolah Daftar: ${sudah}`, pageW - 80, fy)
    pdf.text(`Belum Daftar: ${belum}`, pageW - 80, fy + 5)
    pdf.save(`LaporanStatus_${namaKej || 'Pendaftaran'}.pdf`)
  }

  // ── PDF 3: Matrix Acara × Sekolah ────────────────────────────────────────────
  function cetakMatrix() {
    // Gunakan data yang sudah ditapis (byAcaraFiltered + bySekolahFiltered)
    const acaraMatrix = byAcaraFiltered.filter(a => a.pesertaCount > 0)
    const sekolahMatrix = bySekolah.filter(s => s.totalAtlet > 0)
    if (acaraMatrix.length === 0 || sekolahMatrix.length === 0) return

    const pdf    = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageW  = pdf.internal.pageSize.getWidth()
    const filterLabel = [
      fKat !== 'semua' ? `Kat ${fKat}` : 'Semua Kat',
      fJantina !== 'semua' ? (fJantina === 'L' ? 'Lelaki' : 'Perempuan') : 'L+P',
    ].join(' — ')
    const startY = pdfHeader(pdf, 'MATRIX PENDAFTARAN', filterLabel)

    // Kolum: Sekolah | Acara1 | Acara2 | ... | Jumlah
    const head = [
      ['Sekolah', ...acaraMatrix.map(a => {
        const singkat = (a.namaAcaraPendek || a.namaAcara || '').replace(/[Ll]arian\s*/i,'').trim()
        return `${a.noAcara || ''}\n${singkat.slice(0, 12)}`
      }), 'Jml'],
    ]

    const body = sekolahMatrix.map(s => {
      const row = [s.namaSekolah || s.kodSekolah]
      acaraMatrix.forEach(a => {
        const n = (a.bySkl[s.kodSekolah] || []).length
        row.push(n > 0 ? n : '')
      })
      const jmlAcara = acaraMatrix.filter(a => (a.bySkl[s.kodSekolah] || []).length > 0).length
      row.push(jmlAcara || '')
      return row
    })

    // Baris jumlah bawah
    const footRow = ['JUMLAH']
    acaraMatrix.forEach(a => footRow.push(a.pesertaCount || ''))
    footRow.push(acaraMatrix.reduce((s, a) => s + (a.pesertaCount || 0), 0))

    const colW = Math.min(14, Math.max(8, (pageW - 60) / (acaraMatrix.length + 1)))
    const colStyles = {}
    acaraMatrix.forEach((_, i) => {
      colStyles[i + 1] = { halign: 'center', cellWidth: colW, fontSize: 7 }
    })
    colStyles[acaraMatrix.length + 1] = { halign: 'center', cellWidth: 12, fontStyle: 'bold' }

    autoTable(pdf, {
      startY,
      head,
      body,
      foot: [footRow],
      styles: { fontSize: 7, cellPadding: 1.5, overflow: 'ellipsize' },
      headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold', fontSize: 6.5, halign: 'center', valign: 'middle' },
      alternateRowStyles: { fillColor: [245, 247, 255] },
      footStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
      columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' }, ...colStyles },
      margin: { left: 10, right: 10 },
    })

    const fy = (pdf.lastAutoTable?.finalY || startY + 10) + 6
    pdf.setFontSize(7); pdf.setFont('helvetica', 'normal')
    pdf.text(`Dicetak: ${tarikhCetak}   |   ${acaraMatrix.length} acara  ×  ${sekolahMatrix.length} sekolah`, 10, fy)
    pdf.save(`Matrix_${filterLabel.replace(/\s/g,'_')}_${namaKej || 'Pendaftaran'}.pdf`)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header + Toggle */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-gray-700">Analisa Pendaftaran</p>
        <div className="flex items-center gap-2 ml-auto">
          {isSuperadmin && view === 'acara' && (
            <button onClick={cetakMatrix}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-[#003399] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Matrix PDF
            </button>
          )}
          {isSuperadmin && view === 'sekolah' && (
            <button onClick={cetakLaporanStatus}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-[#003399] bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Laporan Status
            </button>
          )}
          <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
            {[{k:'acara',l:'By Acara'},{k:'sekolah',l:'By Sekolah'}].map(t => (
              <button key={t.k} onClick={() => { setView(t.k); setExpandedId(null) }}
                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                  view === t.k ? 'bg-white text-[#003399] shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>{t.l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── VIEW: By Acara ── */}
      {view === 'acara' && (
        <div>
          {/* Filter bar */}
          <div className="px-4 py-2.5 border-b border-gray-100 flex flex-wrap gap-2 bg-gray-50/50">
            <select value={fKat} onChange={e => { setFKat(e.target.value); setExpandedId(null) }}
              className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#003399]/30">
              <option value="semua">Semua Kategori</option>
              {katOptions.map(k => <option key={k} value={k}>Kat {k}</option>)}
            </select>
            <select value={fJantina} onChange={e => { setFJantina(e.target.value); setExpandedId(null) }}
              className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#003399]/30">
              <option value="semua">L + P</option>
              <option value="L">Lelaki</option>
              <option value="P">Perempuan</option>
            </select>
            <select value={fStatus} onChange={e => { setFStatus(e.target.value); setExpandedId(null) }}
              className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#003399]/30">
              <option value="semua">Semua Status</option>
              <option value="kosong">Kosong</option>
              <option value="kurang">Kurang</option>
              <option value="sederhana">Sederhana</option>
              <option value="cukup">Cukup</option>
            </select>
            <span className="text-[10px] text-gray-400 self-center ml-auto">{byAcaraFiltered.length} acara</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-2 text-left font-bold text-gray-500">Acara</th>
                <th className="px-3 py-2 text-center font-bold text-gray-500">Kat</th>
                <th className="px-3 py-2 text-center font-bold text-gray-500">J</th>
                <th className="px-3 py-2 text-center font-bold text-gray-500">Peserta</th>
                {isSuperadmin && <th className="px-3 py-2 text-center font-bold text-gray-500">Sekolah</th>}
                <th className="px-3 py-2 text-center font-bold text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {byAcaraFiltered.map(a => (
                <>
                  <tr key={a.aceraId}
                    onClick={() => setExpandedId(expandedId === a.aceraId ? null : a.aceraId)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-3 py-2 font-semibold text-gray-800">
                      <span className="text-[9px] font-mono text-gray-400 mr-1.5">{a.noAcara}</span>
                      {a.namaAcaraPendek || a.namaAcara}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${KAT_COLOR[a.kategoriKod] || 'bg-gray-100 text-gray-500'}`}>
                        {a.kategoriKod}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`font-black text-[10px] ${a.jantina==='L'?'text-blue-600':'text-pink-600'}`}>{a.jantina}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`font-bold ${a.pesertaCount === 0 ? 'text-gray-300' : 'text-gray-800'}`}>
                        {a.pesertaCount}
                      </span>
                    </td>
                    {isSuperadmin && (
                      <td className="px-3 py-2 text-center text-gray-500">{a.sekolahCount}</td>
                    )}
                    <td className="px-3 py-2 text-center">
                      {(() => { const s = statusKuota(a.pesertaCount, a.jenisAcara); return (
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
                      )})()}
                    </td>
                  </tr>
                  {expandedId === a.aceraId && Object.keys(a.bySkl).length > 0 && (
                    <tr key={`${a.aceraId}-exp`}>
                      <td colSpan={isSuperadmin ? 6 : 5} className="px-4 pb-3 pt-1 bg-gray-50/60">
                        <div className="space-y-0.5 pl-2 border-l-2 border-[#003399]/20">
                          {Object.entries(a.bySkl).map(([kod, atlets]) => (
                            <div key={kod} className="flex items-center justify-between text-[10px] py-0.5">
                              <span className="text-gray-700">{namaSekolahMap[kod] || kod}</span>
                              <div className="flex gap-2">
                                <span className="text-blue-600 font-semibold">{atlets.filter(x=>x.jantina==='L').length}L</span>
                                <span className="text-pink-600 font-semibold">{atlets.filter(x=>x.jantina==='P').length}P</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {byAcaraFiltered.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400">Tiada acara sepadan filter.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ── VIEW: By Sekolah ── */}
      {view === 'sekolah' && (
        <div>
          {/* Filter bar */}
          <div className="px-4 py-2.5 border-b border-gray-100 flex flex-wrap gap-2 bg-gray-50/50">
            <select value={fJenis} onChange={e => { setFJenis(e.target.value); setExpandedId(null) }}
              className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#003399]/30">
              <option value="semua">Semua Jenis</option>
              <option value="SR">Sekolah Rendah</option>
              <option value="SM">Sekolah Menengah</option>
              <option value="PPKI">PPKI</option>
            </select>
            <select value={fDaftar} onChange={e => { setFDaftar(e.target.value); setExpandedId(null) }}
              className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#003399]/30">
              <option value="semua">Semua Status</option>
              <option value="daftar">Sudah Daftar</option>
              <option value="belum">Belum Daftar</option>
            </select>
            <span className="text-[10px] text-gray-400 self-center ml-auto">{bySekolahFiltered.length} sekolah</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-2 text-left font-bold text-gray-500">Sekolah</th>
                <th className="px-3 py-2 text-center font-bold text-gray-500">Jenis</th>
                <th className="px-3 py-2 text-center font-bold text-gray-500">L</th>
                <th className="px-3 py-2 text-center font-bold text-gray-500">P</th>
                <th className="px-3 py-2 text-center font-bold text-gray-500">Acara</th>
                <th className="px-3 py-2 text-center font-bold text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {bySekolahFiltered.map(s => (
                <>
                  <tr key={s.kodSekolah}
                    onClick={() => setExpandedId(expandedId === s.kodSekolah ? null : s.kodSekolah)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-3 py-2">
                      <p className="font-semibold text-gray-800">{s.namaSekolah || s.kodSekolah}</p>
                      <p className="text-[9px] text-gray-400 font-mono">{s.kodSekolah}</p>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        s.kategori==='SR'?'bg-sky-100 text-sky-700':s.kategori==='SM'?'bg-emerald-100 text-emerald-700':'bg-purple-100 text-purple-700'
                      }`}>{s.kategori}</span>
                    </td>
                    <td className="px-3 py-2 text-center font-bold text-blue-600">{s.L || 0}</td>
                    <td className="px-3 py-2 text-center font-bold text-pink-600">{s.P || 0}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`font-bold ${s.totalAcara === 0 ? 'text-gray-300' : 'text-gray-800'}`}>
                        {s.totalAcara}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {s.totalAtlet === 0
                        ? <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Belum Daftar</span>
                        : <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Daftar</span>
                      }
                    </td>
                  </tr>
                  {expandedId === s.kodSekolah && s.pendSkl.length > 0 && (
                    <tr key={`${s.kodSekolah}-exp`}>
                      <td colSpan={6} className="px-4 pb-3 pt-1 bg-gray-50/60">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[9px] font-bold text-gray-500">{s.pendSkl.length} atlet didaftarkan</span>
                          {isSuperadmin && (
                            <button onClick={e => { e.stopPropagation(); cetakBorangSekolah(s) }}
                              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold text-[#003399] bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors">
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Cetak Borang
                            </button>
                          )}
                        </div>
                        <div className="space-y-0.5 pl-2 border-l-2 border-[#003399]/20">
                          {s.pendSkl.map(p => (
                            <div key={p.noKP || p.noBib} className="flex items-center justify-between text-[10px] py-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[#003399] text-[9px]">{p.noBib}</span>
                                <span className="text-gray-700">{p.namaAtlet}</span>
                                <span className={`font-black text-[9px] ${p.jantina==='L'?'text-blue-500':'text-pink-500'}`}>{p.jantina}</span>
                              </div>
                              <span className="text-gray-400">{(p.acaraIds||[]).length} acara</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {bySekolahFiltered.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400">Tiada sekolah sepadan filter.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TabAtlet ─────────────────────────────────────────────────────────────────

function TabAtlet({ userRole: userRoleProp, userData: userDataProp, sekolahList }) {
  const { userRole: roleCtx, userData: dataCtx } = useAuth()
  const userRole = roleCtx || userRoleProp
  const userData = dataCtx || userDataProp

  const isAdmin      = userRole === 'admin' || userRole === 'pengurus_pasukan'
  const isSuperadmin = userRole === 'superadmin'
  const isPP         = userRole === 'pengurus_pasukan'
  const kodSekolah   = isAdmin ? userData?.kodSekolah : null
  const sekolahData  = isAdmin ? (sekolahList.find(s => s.kodSekolah === kodSekolah) || null) : null

  const [atletList, setAtletList]   = useState([])
  const [loading, setLoading]       = useState(false)
  const [filterSekolah, setFSek]    = useState(kodSekolah || 'semua')
  const [filterJantina, setFJan]    = useState('semua')
  const [search, setSearch]         = useState('')
  const [modal, setModal]           = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [toast, setToast]           = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting]     = useState(null)
  const [tarikhTamatDaftar, setTarikhTamatDaftar] = useState(null)
  const [countdownStr, setCountdownStr]           = useState('')
  const [kategoriList, setKategoriList]           = useState([])
  const [tahunKej, setTahunKej]                   = useState(null)
  const [activeKejId, setActiveKejId]             = useState(null)

  const namaSekolahMap = useMemo(() =>
    Object.fromEntries(sekolahList.map(s => [s.kodSekolah, s.namaSekolah || s.kodSekolah])),
    [sekolahList]
  )

  const [pendaftaranDibuka, setPendaftaranDibuka] = useState(
    sekolahData?.pendaftaranDibuka !== false
  )
  const [togglingPend, setTogglingPend] = useState(false)

  useEffect(() => {
    getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', 'in', ['aktif', 'persediaan'])))
      .then(snap => {
        if (!snap.empty) {
          setActiveKejId(snap.docs[0].id)
          const kej = snap.docs[0].data()
          setTarikhTamatDaftar(kej.tarikhTamatDaftar || null)
          if (kej.tarikhMula) {
            const thn = new Date(kej.tarikhMula?.toDate?.() || kej.tarikhMula).getFullYear()
            setTahunKej(thn || null)
          }
        }
      }).catch(() => {})
    getDocs(collection(db, 'kategori'))
      .then(snap => setKategoriList(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!isPP || !tarikhTamatDaftar) return
    function tick() {
      const ms = new Date(tarikhTamatDaftar) - new Date()
      if (ms <= 0) { setCountdownStr('TAMAT'); return }
      const s = Math.floor(ms / 1000)
      const m = Math.floor(s / 60)
      const h = Math.floor(m / 60)
      const d = Math.floor(h / 24)
      if (d > 0) {
        setCountdownStr(`${d} hari ${String(h % 24).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`)
      } else {
        setCountdownStr(`${String(h % 24).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isPP, tarikhTamatDaftar])

  function formatDeadlineMY(isoStr) {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    if (isNaN(d)) return isoStr
    return d.toLocaleString('ms-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  }

  const tamatDaftarLepas = isPP && tarikhTamatDaftar && new Date() > new Date(tarikhTamatDaftar)
  const pendaftaranTutup = (isAdmin && pendaftaranDibuka === false) || tamatDaftarLepas

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function handleDelete(a) {
    setConfirmDel(null)
    setDeleting(a.noKP)
    try {
      await deleteDoc(doc(db, 'atlet', a.noKP))
      setAtletList(l => l.filter(x => x.noKP !== a.noKP))
      showToast('Atlet berjaya dipadam.')
    } catch (e) {
      alert(e.message)
    } finally {
      setDeleting(null)
    }
  }

  async function handleTogglePendaftaran() {
    if (!kodSekolah) return
    const newVal = !pendaftaranDibuka
    setTogglingPend(true)
    try {
      await updateDoc(doc(db, 'sekolah', kodSekolah), { pendaftaranDibuka: newVal })
      setPendaftaranDibuka(newVal)
      showToast(newVal ? 'Pendaftaran dibuka.' : 'Pendaftaran ditutup.')
    } catch (e) {
      alert(e.message)
    } finally {
      setTogglingPend(false)
    }
  }

  const fetchAtlet = useCallback(async () => {
    setLoading(true)
    try {
      let q
      if (kodSekolah) {
        q = query(collection(db, 'atlet'), where('kodSekolah', '==', kodSekolah))
      } else {
        q = query(collection(db, 'atlet'))
      }
      const snap = await getDocs(q)
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      data.sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'ms'))
      setAtletList(data)
    } catch (e) {
      console.error('fetchAtlet error:', e)
    } finally {
      setLoading(false)
    }
  }, [kodSekolah])

  useEffect(() => { fetchAtlet() }, [fetchAtlet])

  const filtered = atletList.filter(a => {
    if (!isAdmin && filterSekolah !== 'semua' && a.kodSekolah !== filterSekolah) return false
    if (filterJantina !== 'semua' && a.jantina !== filterJantina) return false
    if (search) {
      const q = search.toLowerCase()
      return a.nama?.toLowerCase().includes(q) || a.noKP?.includes(q)
    }
    return true
  })

  async function handleToggleAktif(a) {
    try {
      await updateDoc(doc(db, 'atlet', a.noKP), { isAktif: !a.isAktif, updatedAt: serverTimestamp() })
      setAtletList(l => l.map(x => x.noKP === a.noKP ? { ...x, isAktif: !x.isAktif } : x))
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari nama / no. KP…"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#003399]/25" />
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[10px] bg-white">
            {['semua','L','P'].map(f => (
              <button key={f} onClick={() => setFJan(f)}
                className={`px-2.5 py-1.5 font-semibold transition-colors ${filterJantina===f?'bg-[#003399] text-white':'text-gray-500 hover:bg-gray-50'}`}>
                {f === 'semua' ? 'L+P' : f}
              </button>
            ))}
          </div>
          {!isAdmin && (
            <select value={filterSekolah} onChange={e => setFSek(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold bg-white focus:outline-none">
              <option value="semua">Semua Sekolah</option>
              {sekolahList.map(s => <option key={s.id} value={s.kodSekolah}>{s.namaSekolah || s.kodSekolah}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {userRole === 'admin' && kodSekolah && (
            <button onClick={handleTogglePendaftaran} disabled={togglingPend}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border transition-colors disabled:opacity-50 ${
                pendaftaranDibuka
                  ? 'border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100'
                  : 'border-green-300 text-green-700 bg-green-50 hover:bg-green-100'
              }`}>
              {pendaftaranDibuka ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 018 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
              )}
              {togglingPend ? 'Mengemaskini…' : pendaftaranDibuka ? 'Tutup Pendaftaran' : 'Buka Pendaftaran'}
            </button>
          )}
          {isAdmin && !pendaftaranTutup && (
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-2 border border-[#003399] text-[#003399] text-xs font-bold rounded-lg hover:bg-blue-50">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import Excel
            </button>
          )}
          <button onClick={() => setModal({ type: 'add' })} disabled={pendaftaranTutup}
            className="flex items-center gap-2 px-4 py-2 bg-[#003399] text-white text-xs font-bold rounded-lg hover:bg-[#002288] disabled:opacity-40 disabled:cursor-not-allowed">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Tambah Atlet
          </button>
        </div>
      </div>

      {/* Banner — pendaftaran tutup */}
      {pendaftaranTutup && (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
          <svg className="w-4 h-4 shrink-0 text-red-500 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div>
            <p className="text-xs font-bold text-red-800">
              {tamatDaftarLepas
                ? `Tempoh Pendaftaran Telah Tamat — ${formatDeadlineMY(tarikhTamatDaftar)}`
                : 'Pendaftaran Ditutup oleh Pentadbir'}
            </p>
            <p className="text-[10px] text-red-600 mt-0.5">
              {tamatDaftarLepas
                ? 'Masa tutup pendaftaran telah lepas. Hubungi pentadbir jika perlu kemaskini.'
                : 'Hanya baca. Hubungi pentadbir untuk membuka semula.'}
            </p>
          </div>
        </div>
      )}

      {/* Notis — tiada deadline */}
      {isPP && !tarikhTamatDaftar && (
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
          <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-gray-500">Tarikh tutup pendaftaran belum ditetapkan. Hubungi pentadbir untuk maklumat lanjut.</p>
        </div>
      )}

      {/* Countdown */}
      {isPP && tarikhTamatDaftar && !tamatDaftarLepas && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          countdownStr.startsWith('0') || (countdownStr.split(' ')[0] === '1' && countdownStr.includes('hari'))
            ? 'bg-red-50 border-red-200 text-red-800'
            : countdownStr.startsWith('1 hari') || countdownStr.startsWith('2 hari') || countdownStr.startsWith('3 hari')
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Masa Tutup Pendaftaran</p>
            <p className="text-xs font-bold">{formatDeadlineMY(tarikhTamatDaftar)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Masa Tinggal</p>
            <p className="text-sm font-black font-mono tracking-wider">{countdownStr}</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { l:'Jumlah', v:filtered.length, c:'text-[#003399]', bg:'bg-blue-50' },
          { l:'Lelaki',  v:filtered.filter(a=>a.jantina==='L').length, c:'text-blue-700', bg:'bg-blue-50' },
          { l:'Perempuan', v:filtered.filter(a=>a.jantina==='P').length, c:'text-pink-700', bg:'bg-pink-50' },
        ].map(s => (
          <div key={s.l} className={`${s.bg} rounded-xl px-3 py-2 text-center`}>
            <p className={`text-xl font-black ${s.c}`}>{s.v}</p>
            <p className="text-[9px] text-gray-500 uppercase tracking-wide">{s.l}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Memuatkan…</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">
            {atletList.length === 0 ? 'Tiada atlet. Tambah atlet baru.' : 'Tiada hasil carian.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">Nama</th>
                  <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide">J</th>
                  <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">Tarikh Lahir</th>
                  <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">Sekolah</th>
                  <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide">Kategori</th>
                  <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide">Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const katAuto = kiraKategori(a.tarikhLahir, a.jantina, tahunKej, kategoriList)
                  const katVal  = a.kategoriKod || katAuto || ''
                  return (
                  <tr key={a.noKP} className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${!a.isAktif?'opacity-50':''}`}>
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-gray-800">{a.nama}</p>
                      <p className="text-[9px] font-mono text-gray-400">{a.noKP}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center"><JantinaBadge j={a.jantina} /></td>
                    <td className="px-3 py-2.5 text-gray-600">{a.tarikhLahir}</td>
                    <td className="px-3 py-2.5 text-gray-600">
                      <span className="font-semibold">{namaSekolahMap[a.kodSekolah] || a.kodSekolah}</span>
                      <span className="text-[9px] ml-1 text-gray-400">{a.kategoriSekolah}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <KatDropdown
                        noKP={a.noKP}
                        value={katVal}
                        kategoriList={kategoriList}
                        disabled={pendaftaranTutup}
                        onSaved={(newKat) => setAtletList(l => l.map(x => x.noKP === a.noKP ? { ...x, kategoriKod: newKat } : x))}
                        jantina={a.jantina}
                        tarikhLahir={a.tarikhLahir}
                        tahunKej={tahunKej}
                        kejohananId={activeKejId}
                        pRec={true}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => handleToggleAktif(a)}>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${a.isAktif?'bg-green-100 text-green-700':'bg-gray-100 text-gray-400'}`}>
                          {a.isAktif?'Aktif':'Nyahaktif'}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-center gap-1">
                        {pendaftaranTutup ? (
                          <span className="text-[9px] font-semibold text-amber-600 px-2 py-0.5 bg-amber-50 rounded-full border border-amber-200">Baca Sahaja</span>
                        ) : (
                          <>
                            <button onClick={() => setModal({ type:'edit', data:a })}
                              className="p-1 text-gray-400 hover:text-[#003399] hover:bg-blue-50 rounded transition-colors"
                              title="Edit">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            <button onClick={() => setConfirmDel(a)}
                              disabled={deleting === a.noKP}
                              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-40"
                              title="Padam">
                              {deleting === a.noKP ? (
                                <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal?.type === 'add' && (
        <AtletModal mode="add" sekolahList={sekolahList} isAdmin={isAdmin}
          kodSekolahAdmin={kodSekolah} sekolahData={sekolahData}
          existingBibs={atletList.map(a => a.noBib).filter(Boolean)}
          onClose={() => setModal(null)}
          onSaved={() => { fetchAtlet(); showToast('Atlet berjaya didaftarkan.') }} />
      )}
      {modal?.type === 'edit' && (
        <AtletModal mode="edit" initial={modal.data} sekolahList={sekolahList} isAdmin={isAdmin}
          kodSekolahAdmin={kodSekolah} sekolahData={sekolahData}
          existingBibs={atletList.map(a => a.noBib).filter(Boolean)}
          onClose={() => setModal(null)}
          onSaved={() => { fetchAtlet(); showToast('Maklumat atlet dikemas kini.') }} />
      )}

      {showImport && (
        <ImportAtletModal
          sekolahData={sekolahData}
          existingBibs={atletList.map(a => a.noBib).filter(Boolean)}
          onClose={() => setShowImport(false)}
          onSaved={() => { fetchAtlet(); showToast('Import atlet berjaya.') }} />
      )}

      {/* Dialog Pengesahan Padam */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-gray-800 mb-1">Padam Atlet?</h3>
            <p className="text-xs text-gray-500 mb-1">Tindakan ini akan memadam rekod atlet secara kekal.</p>
            <p className="text-xs font-bold text-gray-700 mb-4">{confirmDel.nama} — {confirmDel.noKP}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDel(null)}
                className="flex-1 py-2.5 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Batal
              </button>
              <button onClick={() => handleDelete(confirmDel)}
                className="flex-1 py-2.5 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600">
                Ya, Padam
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm font-semibold px-5 py-3 rounded-xl shadow-lg flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  )
}

// ─── TabPendaftaran ────────────────────────────────────────────────────────────

function TabPendaftaran({ userRole: userRoleProp, userData: userDataProp, sekolahList }) {
  const { userRole: roleCtx, userData: dataCtx } = useAuth()
  const userRole = roleCtx || userRoleProp
  const userData = dataCtx || userDataProp

  const isAdmin      = userRole === 'admin' || userRole === 'pengurus_pasukan'
  const isSuperadmin = userRole === 'superadmin'
  const kodSekolah   = isAdmin ? userData?.kodSekolah : null

  // Ambil jenis sekolah dari sekolahList (paling reliable) — fallback ke userData
  const sekolahData     = sekolahList.find(s => s.kodSekolah === kodSekolah)
  const kategoriSekolah = sekolahData?.kategori || userData?.kategori || null // SR | SM | PPKI

  const [kategoriList, setKategoriList] = useState([])

  // Peta jenis sekolah → kategoriKod acara yang dibenarkan (dinamik dari Firestore)
  // Kategori OPEN (isTerbuka=true) dimasukkan dalam SEMUA jenis sekolah
  const KAT_BY_JENIS = kategoriList.length > 0
    ? kategoriList.reduce((acc, k) => {
        if (!k.kod) return acc
        if (k.isTerbuka) {
          // OPEN — relevan untuk semua jenis sekolah
          ;['SR','SM','PPKI'].forEach(j => {
            if (!acc[j]) acc[j] = []
            if (!acc[j].includes(k.kod)) acc[j].push(k.kod)
          })
        } else {
          const jenis = k.jenisSekolah || 'SR'
          if (!acc[jenis]) acc[jenis] = []
          if (!acc[jenis].includes(k.kod)) acc[jenis].push(k.kod)
        }
        return acc
      }, {})
    : {} // kosong semasa load — katDibenar → null → tunjuk semua
  // Hanya tapis jika pengurus_pasukan/admin dengan sekolah — superadmin lihat semua
  const katDibenar = (isAdmin && kodSekolah && kategoriSekolah)
    ? (KAT_BY_JENIS[kategoriSekolah]?.length > 0 ? KAT_BY_JENIS[kategoriSekolah] : null)
    : null

  const isPP = userRole === 'pengurus_pasukan'

  const [selectedKej, setSelectedKej]    = useState('')
  const [namaKej, setNamaKej]            = useState('')
  const [kejohanan, setKejohanan]        = useState(null)
  const [acaraList, setAcaraList]        = useState([])
  const [pendaftaranList, setPendaftaran] = useState([])
  const [jadualList, setJadualList]      = useState([])
  const [atletSekolah, setAtletSekolah]  = useState([])
  const [loading, setLoading]            = useState(false)
  const [fetchErr, setFetchErr]          = useState('')
  const [selectedAcara, setSelectedAcara]= useState(null)
  const [modal, setModal]               = useState(null)
  const [heatDijanaMap, setHeatDijanaMap] = useState({}) // aceraId → bool
  const [countdownStr, setCountdownStr]  = useState('')

  const [filterSekolahDaftar, setFSD]   = useState(kodSekolah || 'semua')
  const [filterKat, setFilterKat]       = useState('semua')
  const [filterJenis, setFilterJenis]   = useState('semua')

  // Fetch kejohanan aktif
  useEffect(() => {
    getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', 'in', ['aktif', 'persediaan'])))
      .then(snap => {
        if (!snap.empty) {
          const d = snap.docs[0]
          setSelectedKej(d.id)
          setNamaKej(d.data().namaKejohanan || '')
        }
      }).catch(() => {})
  }, [])

  const fetchAll = useCallback(async () => {
    if (!selectedKej) { setAcaraList([]); setPendaftaran([]); setAtletSekolah([]); return }
    setLoading(true)
    setFetchErr('')
    try {
      const kejSnap = await getDoc(doc(db, 'kejohanan', selectedKej))
      setKejohanan(kejSnap.exists() ? { id: kejSnap.id, ...kejSnap.data() } : null)

      // atlet query — sort client-side to avoid composite index requirement
      const atletSnap = kodSekolah
        ? await getDocs(query(collection(db, 'atlet'), where('kodSekolah', '==', kodSekolah)))
        : await getDocs(collection(db, 'atlet'))

      const [acaraSnap, pendSnap, jadualSnap, katSnap] = await Promise.all([
        getDocs(query(collection(db, 'kejohanan', selectedKej, 'acara'), orderBy('kategoriKod'))),
        getDocs(query(collection(db, 'kejohanan', selectedKej, 'pendaftaran'))),
        getDocs(query(collection(db, 'jadual_acara'), where('kejohananId','==',selectedKej))),
        getDocs(collection(db, 'kategori')),
      ])
      setAcaraList(acaraSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setPendaftaran(pendSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setJadualList(jadualSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setKategoriList(katSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      const atletData = atletSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      atletData.sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'ms'))
      setAtletSekolah(atletData)
    } catch (e) {
      console.error('fetchAll error:', e)
      setFetchErr(e.message || 'Ralat memuatkan data.')
    } finally { setLoading(false) }
  }, [selectedKej, kodSekolah])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Semak sama ada heat sudah dijana bagi setiap acara
  useEffect(() => {
    if (!selectedKej || acaraList.length === 0) { setHeatDijanaMap({}); return }
    let cancelled = false
    Promise.all(
      acaraList.map(async a => {
        try {
          const snap = await getCountFromServer(
            collection(db, 'kejohanan', selectedKej, 'acara', a.aceraId || a.id, 'heat')
          )
          return [a.aceraId || a.id, snap.data().count > 0]
        } catch { return [a.aceraId || a.id, false] }
      })
    ).then(entries => {
      if (!cancelled) setHeatDijanaMap(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [selectedKej, acaraList])

  const tahunKej = kejohanan?.tarikhMula
    ? new Date(kejohanan.tarikhMula?.toDate?.() || kejohanan.tarikhMula).getFullYear()
    : new Date().getFullYear()

  // Deadline dari kejohanan
  const tarikhTamatDaftar = kejohanan?.tarikhTamatDaftar || null

  // Countdown timer — untuk pengurus pasukan sahaja
  useEffect(() => {
    if (!isPP || !tarikhTamatDaftar) { setCountdownStr(''); return }
    function tick() {
      const ms = new Date(tarikhTamatDaftar) - new Date()
      if (ms <= 0) { setCountdownStr('TAMAT'); return }
      const s = Math.floor(ms / 1000)
      const m = Math.floor(s / 60)
      const h = Math.floor(m / 60)
      const d = Math.floor(h / 24)
      setCountdownStr(d > 0
        ? `${d} hari ${String(h%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
        : `${String(h%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isPP, tarikhTamatDaftar])

  // Pendaftaran tutup bila deadline tamat (untuk PP)
  const tamatDaftarLepas  = isPP && tarikhTamatDaftar && new Date() > new Date(tarikhTamatDaftar)
  const pendaftaranTutup  = tamatDaftarLepas

  function formatDeadlineMY(isoStr) {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    if (isNaN(d)) return isoStr
    return d.toLocaleString('ms-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  }

  // Lookup nama sekolah dari kodSekolah
  const namaSekolahMap = useMemo(() =>
    Object.fromEntries(sekolahList.map(s => [s.kodSekolah, s.namaSekolah || s.kodSekolah])),
    [sekolahList]
  )

  // Label umur per kategori — untuk paparan yang lebih jelas
  const KAT_UMUR = {
    A:    'Bawah 10 Tahun',
    B:    'Bawah 12 Tahun',
    C:    'Bawah 14 Tahun',
    D:    'Bawah 16 Tahun',
    E:    'Bawah 18 Tahun',
    PPKI: 'PPKI',
  }

  // Acara yang ditapis — tapis ikut jenis sekolah dahulu
  const jenisOptions = ['lorong','mass_start','padang_lompat','padang_balin','relay']
  const jenisShort = {lorong:'Lorong',mass_start:'Mass',padang_lompat:'Lompat',padang_balin:'Balin',relay:'Relay'}

  // Hanya tunjuk kategori yang berkaitan dengan jenis sekolah
  // Buang SEMUA acara yang ada parentAcaraId — itu final yang ditentukan sistem
  // Terus Final (tiada parentAcaraId) masih boleh daftar terus
  const acaraIkutSekolah = katDibenar
    ? acaraList.filter(a => katDibenar.includes(a.kategoriKod) && !a.parentAcaraId)
    : acaraList.filter(a => !a.parentAcaraId)

  const katList = [...new Set(acaraIkutSekolah.map(a => a.kategoriKod))].sort()

  const acaraFiltered = acaraIkutSekolah.filter(a => {
    if (a.isAktif === false) return false   // undefined = aktif (acara doc tiada field isAktif)
    if (filterKat !== 'semua' && a.kategoriKod !== filterKat) return false
    if (filterJenis !== 'semua' && a.jenisAcara !== filterJenis) return false
    return true
  })

  // Kiraan peserta per acara (untuk paparan)
  const pesertaByAcara = useMemo(() => {
    const map = {}
    pendaftaranList.forEach(p => {
      (p.acaraIds || []).forEach(id => {
        if (!map[id]) map[id] = []
        map[id].push(p)
      })
    })
    return map
  }, [pendaftaranList])

  // Peserta sekolah semasa per acara
  const pesertaSekolahByAcara = useMemo(() => {
    const map = {}
    const skl = kodSekolah || filterSekolahDaftar
    if (!skl || skl === 'semua') return map
    pendaftaranList.forEach(p => {
      if (p.kodSekolah !== skl) return
      (p.acaraIds || []).forEach(id => {
        if (!map[id]) map[id] = []
        map[id].push(p)
      })
    })
    return map
  }, [pendaftaranList, kodSekolah, filterSekolahDaftar])

  return (
    <div className="space-y-4">
      {namaKej && <p className="text-xs font-semibold text-[#003399]">{namaKej}</p>}

      {selectedKej && (
        <>
          {/* Stats */}
          {(() => {
            const myPendaftaran = isPP ? pendaftaranList.filter(p => p.kodSekolah === kodSekolah) : pendaftaranList
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { l:'Jumlah Acara',  v: acaraList.filter(a=>a.isAktif!==false).length, c:'text-[#003399]', bg:'bg-blue-50' },
                  { l: isPP ? 'Atlet Sekolah' : 'Jumlah Atlet',  v: myPendaftaran.length, c:'text-green-700', bg:'bg-green-50' },
                  { l:'Atlet Lelaki',  v: myPendaftaran.filter(p=>p.jantina==='L').length, c:'text-blue-700', bg:'bg-blue-50' },
                  { l:'Atlet Perempuan',v:myPendaftaran.filter(p=>p.jantina==='P').length, c:'text-pink-700', bg:'bg-pink-50' },
                ].map(s => (
                  <div key={s.l} className={`${s.bg} rounded-xl px-3 py-2.5 text-center`}>
                    <p className={`text-xl font-black ${s.c}`}>{s.v}</p>
                    <p className="text-[9px] text-gray-500 uppercase tracking-wide">{s.l}</p>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Analisa Pendaftaran */}
          {pendaftaranList.length > 0 && (
            <AnalisaPendaftaran
              acaraList={acaraList}
              pendaftaranList={pendaftaranList}
              sekolahList={sekolahList}
              namaSekolahMap={namaSekolahMap}
              katDibenar={katDibenar}
              isSuperadmin={isSuperadmin}
              namaKej={namaKej}
              kategoriList={kategoriList}
            />
          )}


          {/* Banner — pendaftaran tutup (PP + deadline tamat) */}
          {pendaftaranTutup && (
            <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
              <svg className="w-4 h-4 shrink-0 text-red-500 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <div>
                <p className="text-xs font-bold text-red-800">Tempoh Pendaftaran Telah Tamat — {formatDeadlineMY(tarikhTamatDaftar)}</p>
                <p className="text-[10px] text-red-600 mt-0.5">Senarai peserta boleh dilihat. Pendaftaran baru tidak dibenarkan.</p>
              </div>
            </div>
          )}

          {/* Notis — tiada deadline ditetapkan (untuk PP) */}
          {isPP && !tarikhTamatDaftar && (
            <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
              <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-gray-500">Tarikh tutup pendaftaran belum ditetapkan. Hubungi pentadbir untuk maklumat lanjut.</p>
            </div>
          )}

          {/* Countdown — tunjuk bila ada deadline & belum tamat (PP) */}
          {isPP && tarikhTamatDaftar && !tamatDaftarLepas && countdownStr && (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
              countdownStr === 'TAMAT' || countdownStr.startsWith('00:')
                ? 'bg-red-50 border-red-200 text-red-800'
                : countdownStr.startsWith('1 hari') || countdownStr.startsWith('2 hari') || countdownStr.startsWith('3 hari')
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Masa Tutup Pendaftaran Acara</p>
                <p className="text-xs font-bold">{formatDeadlineMY(tarikhTamatDaftar)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Masa Tinggal</p>
                <p className="text-sm font-black font-mono tracking-wider">{countdownStr}</p>
              </div>
            </div>
          )}

          {/* Notis tapis ikut jenis sekolah */}
          {katDibenar && (() => {
            const jenisLabel = { SR:'Sekolah Rendah', SM:'Sekolah Menengah', PPKI:'PPKI' }
            return (
              <div className="px-4 py-3 bg-[#003399]/5 border border-[#003399]/20 rounded-xl space-y-1">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-[#003399]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
                  </svg>
                  <span className="text-[11px] text-[#003399] font-bold">
                    Acara untuk {jenisLabel[kategoriSekolah] || kategoriSekolah} sahaja
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-6">
                  {katDibenar.map(k => (
                    <span key={k} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      {A:'bg-blue-100 text-blue-700',B:'bg-cyan-100 text-cyan-700',C:'bg-green-100 text-green-700',D:'bg-yellow-100 text-yellow-700',E:'bg-orange-100 text-orange-700',PPKI:'bg-purple-100 text-purple-700'}[k] || 'bg-gray-100 text-gray-500'
                    }`}>
                      Kat {k} — {KAT_UMUR_FULL[k] || k}
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Filter */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex flex-wrap rounded-lg border border-gray-200 overflow-hidden text-[10px] bg-white">
              {['semua', ...katList].map(k => (
                <button key={k} onClick={() => setFilterKat(k)}
                  className={`px-2.5 py-1.5 font-bold transition-colors ${filterKat===k?'bg-[#003399] text-white':'text-gray-500 hover:bg-gray-50'}`}>
                  {k === 'semua' ? 'Semua' : `Kat ${k} — ${KAT_UMUR[k] || k}`}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[10px] bg-white">
              {['semua', ...jenisOptions].map(j => (
                <button key={j} onClick={() => setFilterJenis(j)}
                  className={`px-2.5 py-1.5 font-semibold transition-colors ${filterJenis===j?'bg-[#003399] text-white':'text-gray-500 hover:bg-gray-50'}`}>
                  {j === 'semua' ? 'Semua' : jenisShort[j]}
                </button>
              ))}
            </div>
            {!isAdmin && (
              <select value={filterSekolahDaftar} onChange={e => setFSD(e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold bg-white focus:outline-none">
                <option value="semua">Semua Sekolah</option>
                {sekolahList.map(s => <option key={s.id} value={s.kodSekolah}>{s.namaSekolah || s.kodSekolah}</option>)}
              </select>
            )}
          </div>

          {/* Senarai Acara + Peserta */}
          {fetchErr && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 rounded-xl flex items-start gap-2">
              <span className="font-bold shrink-0">Ralat:</span>
              <span className="font-mono break-all">{fetchErr}</span>
            </div>
          )}
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">Memuatkan…</div>
          ) : acaraFiltered.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-10 text-center">
              <p className="text-sm text-gray-400">Tiada acara. Tambah acara dalam Setup Acara dahulu.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {acaraFiltered.map(acara => {
                const peserta    = pesertaByAcara[acara.aceraId] || []
                const pesertaSek   = pesertaSekolahByAcara[acara.aceraId] || []
                const _acaraKatObj = kategoriList.find(k => k.kod === acara.kategoriKod)
                const hadAcara     = (() => {
                  if (acara.jenisAcara === 'relay' && _acaraKatObj) {
                    const saizPasukan = Number(_acaraKatObj.saizPasukan) || 4
                    const hadPasukan  = acara.jantina === 'P'
                      ? (Number(_acaraKatObj.hadPasukanP) || 1)
                      : (Number(_acaraKatObj.hadPasukanL) || 1)
                    return saizPasukan * hadPasukan
                  }
                  return acara.hadAtletPerSekolah || 2
                })()
                const slotBaki     = hadAcara - pesertaSek.length
                const isSelected   = selectedAcara?.aceraId === acara.aceraId
                const heatSudahAda = heatDijanaMap[acara.aceraId] === true

                const jenisBg = {
                  lorong:'border-blue-200 bg-blue-50/50',
                  mass_start:'border-cyan-200 bg-cyan-50/50',
                  padang_lompat:'border-green-200 bg-green-50/50',
                  padang_balin:'border-orange-200 bg-orange-50/50',
                  relay:'border-purple-200 bg-purple-50/50',
                }

                return (
                  <div key={acara.aceraId} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${jenisBg[acara.jenisAcara]||'border-gray-100'}`}>
                    {/* Acara header */}
                    <button className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/70 transition-colors"
                      onClick={() => setSelectedAcara(isSelected ? null : acara)}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-gray-800">{acara.namaAcara}</p>
                            <KategoriBadge kat={acara.kategoriKod} full={!!isAdmin} />
                            <JantinaBadge j={acara.jantina} />
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                              {lorong:'bg-blue-50 border-blue-200 text-blue-700',mass_start:'bg-cyan-50 border-cyan-200 text-cyan-700',padang_lompat:'bg-green-50 border-green-200 text-green-700',padang_balin:'bg-orange-50 border-orange-200 text-orange-700',relay:'bg-purple-50 border-purple-200 text-purple-700'}[acara.jenisAcara]||''
                            }`}>{jenisShort[acara.jenisAcara]}</span>
                            {heatSudahAda && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-indigo-50 border-indigo-300 text-indigo-700 flex items-center gap-0.5">
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                                Heat Dijana
                              </span>
                            )}
                          </div>
                          <p className="text-[9px] font-mono text-gray-400">{acara.aceraId}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-xs font-black text-gray-700">{peserta.length}</p>
                          <p className="text-[9px] text-gray-400">peserta</p>
                        </div>
                        {(isAdmin || filterSekolahDaftar !== 'semua') && (
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${
                            slotBaki > 0
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}>
                            {slotBaki > 0
                              ? `${pesertaSek.length}/${hadAcara} slot`
                              : `${pesertaSek.length}/${hadAcara} PENUH`}
                          </span>
                        )}
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isSelected?'rotate-180':''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {/* Panel peserta — expanded */}
                    {isSelected && (
                      <div className="border-t border-gray-100 bg-white px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Peserta Berdaftar</p>
                          <div className="flex items-center gap-2">
                            {isAdmin && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                slotBaki > 0
                                  ? 'bg-green-50 text-green-700 border-green-200'
                                  : 'bg-red-50 text-red-700 border-red-200'
                              }`}>
                                {slotBaki > 0 ? `${pesertaSek.length}/${hadAcara}` : 'PENUH'}
                              </span>
                            )}
                            <button
                              onClick={() => !heatSudahAda && !pendaftaranTutup && setModal({ type:'daftar', acara })}
                              disabled={heatSudahAda || pendaftaranTutup || (isAdmin && slotBaki <= 0)}
                              title={
                                heatSudahAda ? 'Pendaftaran ditutup — heat sudah dijana'
                                : pendaftaranTutup ? 'Tempoh pendaftaran telah tamat'
                                : isAdmin && slotBaki <= 0 ? `Had ${hadAcara} atlet per sekolah sudah penuh`
                                : ''
                              }
                              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                              {heatSudahAda || pendaftaranTutup
                                ? <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                : <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                              }
                              {heatSudahAda ? 'Heat Dijana' : pendaftaranTutup ? 'Tutup' : 'Daftar Atlet'}
                            </button>
                          </div>
                        </div>

                        {(() => {
                          const pesertaDisplay = isPP ? pesertaSek : peserta
                          return pesertaDisplay.length === 0 ? (
                            <p className="text-xs text-gray-400 py-3 text-center">Tiada peserta lagi.</p>
                          ) : (
                            <div className="space-y-1">
                              {pesertaDisplay.map(p => {
                                const kat = kiraKategori(p.tarikhLahir, p.jantina, tahunKej, kategoriList)
                                // Tunjuk sekolah badge jika superadmin
                                return (
                                  <div key={p.noBib} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-[9px] font-black font-mono text-[#003399] bg-blue-50 px-1.5 py-0.5 rounded">{p.noBib}</span>
                                      <div className="min-w-0">
                                        <p className="text-xs font-semibold text-gray-800 truncate">{p.namaAtlet}</p>
                                        {!isAdmin && <p className="text-[9px] text-gray-400">{namaSekolahMap[p.kodSekolah] || p.kodSekolah}</p>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <KategoriBadge kat={kat} />
                                      <JantinaBadge j={p.jantina} />
                                      {(isAdmin ? p.kodSekolah === kodSekolah : true) && (
                                        <button onClick={() => setModal({ type:'buang', atlet:p, acara })}
                                          className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {modal?.type === 'daftar' && (
        <DaftarModal
          acara={modal.acara}
          kejohanan={kejohanan}
          atletSekolah={atletSekolah.filter(a => !kodSekolah || a.kodSekolah === kodSekolah)}
          pendaftaranList={pendaftaranList}
          jadualList={jadualList}
          kategoriList={kategoriList}
          onClose={() => setModal(null)}
          onSaved={fetchAll}
        />
      )}
      {modal?.type === 'buang' && (
        <BuangDaftarModal
          atlet={modal.atlet}
          acara={modal.acara}
          pRec={modal.atlet}
          kejohananId={selectedKej}
          onClose={() => setModal(null)}
          onSaved={fetchAll}
        />
      )}
    </div>
  )
}

// ─── PP: Modal Tambah / Edit Atlet ───────────────────────────────────────────

function PPAtletModal({ mode, initial, sekolahData, existingBibs, myPendaftaran, kejohananId, tahunKej, kategoriList, onClose, onSaved }) {
  const isEdit     = mode === 'edit'
  const bibPrefix  = (sekolahData?.bibPrefix || '').toUpperCase()
  const bibFormat  = Number(sekolahData?.bibFormat) || 3
  const initBibNum = initial?.noBib?.startsWith(bibPrefix) ? initial.noBib.slice(bibPrefix.length) : (initial?.noBib || '')

  const [form, setForm] = useState({
    noKP: initial?.noKP || '', nama: initial?.nama || '',
    jantina: initial?.jantina || 'L', tarikhLahir: initial?.tarikhLahir || '',
  })
  const [bibNum, setBibNum] = useState(initBibNum)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')
  const [warnPending, setWarnPending] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleNoKPChange(raw) {
    const digits = raw.replace(/\D/g, '').slice(0, 12)
    let fmt = digits
    if (digits.length > 6) fmt = digits.slice(0,6) + '-' + digits.slice(6)
    if (digits.length > 8) fmt = digits.slice(0,6) + '-' + digits.slice(6,8) + '-' + digits.slice(8)
    let tarikhLahir = form.tarikhLahir
    if (digits.length >= 6) {
      const yy = parseInt(digits.slice(0,2), 10)
      const mm = parseInt(digits.slice(2,4), 10)
      const dd = parseInt(digits.slice(4,6), 10)
      const curYY = new Date().getFullYear() % 100
      const year  = (yy <= curYY ? 2000 : 1900) + yy
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        tarikhLahir = `${year}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
      }
    }
    // Auto-detect jantina dari digit terakhir No. KP (ganjil=Lelaki, genap=Perempuan)
    let jantina = form.jantina
    if (digits.length === 12) {
      jantina = parseInt(digits[11], 10) % 2 === 1 ? 'L' : 'P'
    }
    setForm(f => ({ ...f, noKP: fmt, tarikhLahir, jantina }))
  }

  const fullNoBib   = bibPrefix && bibNum ? bibPrefix + String(bibNum).padStart(bibFormat, '0') : bibNum
  const kategori    = kiraKategori(form.tarikhLahir, form.jantina, tahunKej, kategoriList)
  const sensitiveChanged = isEdit && (form.jantina !== initial?.jantina || form.tarikhLahir !== initial?.tarikhLahir)
  const atletPend   = myPendaftaran.filter(p => p.noKP === initial?.noKP)
  const acaraCount  = atletPend.flatMap(p => p.acaraIds || []).length

  async function doSave() {
    setErr('')
    if (!form.noKP.trim())   return setErr('No. Kad Pengenalan wajib diisi.')
    if (!form.nama.trim())   return setErr('Nama atlet wajib diisi.')
    if (!form.tarikhLahir)   return setErr('Tarikh lahir wajib diisi.')
    if (!fullNoBib?.trim())  return setErr('Nombor Badan wajib diisi.')
    // Semak julat nombor mengikut bibFormat (dinamik dari tetapan sekolah)
    const maxBibNum = Math.pow(10, bibFormat) - 1
    const bibNumInt = parseInt(bibNum, 10)
    if (bibPrefix && bibNum) {
      if (isNaN(bibNumInt) || bibNumInt < 1 || bibNumInt > maxBibNum) {
        return setErr(`Nombor Badan melebihi format ${bibFormat} digit. Julat sah: 1–${maxBibNum} (cth: ${bibPrefix}${String(1).padStart(bibFormat, '0')} hingga ${bibPrefix}${String(maxBibNum).padStart(bibFormat, '0')})`)
      }
    }
    const noKP = form.noKP.replace(/-/g, '')
    if (!/^\d{12}$/.test(noKP)) return setErr('Format No. K/P tidak sah — 12 digit diperlukan.')
    const finalNoKP = `${noKP.slice(0,6)}-${noKP.slice(6,8)}-${noKP.slice(8)}`
    const finalBib  = fullNoBib.trim().toUpperCase()
    const bibDup    = (existingBibs || []).filter(b => b === finalBib)
    const isSameBib = isEdit && initial?.noBib === finalBib
    if (bibDup.length > 0 && !isSameBib) return setErr(`Nombor Badan "${finalBib}" sudah digunakan.`)
    setSaving(true)
    try {
      if (sensitiveChanged && acaraCount > 0 && kejohananId) {
        const batch = writeBatch(db)
        atletPend.forEach(p => batch.delete(doc(db, 'kejohanan', kejohananId, 'pendaftaran', p.id)))
        await batch.commit()
      }
      if (!isEdit) {
        const ex = await getDoc(doc(db, 'atlet', finalNoKP))
        if (ex.exists()) return setErr(`Atlet ${finalNoKP} sudah wujud.`)
      }
      const payload = {
        noKP: finalNoKP, nama: form.nama.trim(),
        jantina: form.jantina, tarikhLahir: form.tarikhLahir,
        noBib: finalBib,
        kodSekolah:       sekolahData?.kodSekolah || initial?.kodSekolah || '',
        kategoriSekolah:  sekolahData?.kategori   || 'SM',
        negeri:           sekolahData?.negeri      || 'Terengganu',
        daerah:           sekolahData?.daerah      || '',
        warganegara: 'MY', isAktif: true,
        updatedAt: serverTimestamp(),
      }
      if (!isEdit) payload.createdAt = serverTimestamp()
      await setDoc(doc(db, 'atlet', finalNoKP), payload, { merge: isEdit })
      onSaved(); onClose()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  function handleSave() {
    if (isEdit && sensitiveChanged && acaraCount > 0) { setWarnPending(true) } else { doSave() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[94vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-bold text-gray-800">{isEdit ? 'Edit Maklumat Atlet' : 'Tambah Atlet Baru'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Warning confirmation */}
          {warnPending && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-amber-800">Amaran — Maklumat Kritikal Berubah</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                Anda menukar{' '}
                <strong>
                  {[form.jantina !== initial?.jantina && 'Jantina', form.tarikhLahir !== initial?.tarikhLahir && 'Tarikh Lahir'].filter(Boolean).join(' & ')}
                </strong>
                . Perubahan ini akan memadamkan <strong>{acaraCount} pendaftaran acara</strong> bagi atlet ini. Pengurus perlu mendaftar semula.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setWarnPending(false)} disabled={saving}
                  className="flex-1 px-3 py-2 text-xs font-bold border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-100">
                  Batal
                </button>
                <button onClick={doSave} disabled={saving}
                  className="flex-1 px-3 py-2 text-xs font-bold bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                  {saving ? 'Memproses…' : 'Teruskan & Padam Pendaftaran'}
                </button>
              </div>
            </div>
          )}

          {!warnPending && <>
            {/* Nombor Badan */}
            {(() => {
              const maxBibNum  = Math.pow(10, bibFormat) - 1  // 1 digit→9, 2→99, 3→999
              const contoh     = bibPrefix
                ? `${bibPrefix}${String(sekolahData?.bibMula || 1).padStart(bibFormat, '0')}`
                : 'PP001'
              const hintText   = bibPrefix
                ? `Prefix: ${bibPrefix} | Format: ${bibFormat} digit (cth: ${contoh}) | Julat: 1–${maxBibNum}`
                : `Masukkan nombor badan (cth: ${contoh})`
              return (
                <FormField label="Nombor Badan" required hint={hintText}>
                  {bibPrefix ? (
                    <div className="flex">
                      <span className="inline-flex items-center px-3 py-2 rounded-l-lg border border-r-0 border-gray-200 bg-gray-100 text-xs font-mono font-bold text-gray-600 select-none">
                        {bibPrefix}
                      </span>
                      <input type="number" min={1} max={maxBibNum}
                        value={bibNum} onChange={e => setBibNum(e.target.value)}
                        placeholder={String(sekolahData?.bibMula || 1)}
                        className={inputCls + ' rounded-l-none font-mono'} />
                    </div>
                  ) : (
                    <input value={fullNoBib} onChange={e => setBibNum(e.target.value.toUpperCase())}
                      placeholder={contoh} className={inputCls + ' font-mono'} />
                  )}
                  {fullNoBib && (
                    <p className="text-[10px] text-[#003399] font-mono font-bold mt-1">
                      Nombor Badan: <span className="text-sm">{fullNoBib}</span>
                    </p>
                  )}
                </FormField>
              )
            })()}

            {/* No. KP */}
            <FormField label="No. Kad Pengenalan" required hint="Taip 12 digit — sempang & tarikh lahir auto diisi.">
              <input value={form.noKP} onChange={e => handleNoKPChange(e.target.value)}
                placeholder="020101145678" className={inputCls + ' font-mono tracking-wider'}
                disabled={isEdit} maxLength={14} />
            </FormField>

            <FormField label="Nama Penuh" required>
              <input value={form.nama} onChange={e => set('nama', e.target.value)}
                placeholder="Nama seperti dalam kad pengenalan" className={inputCls} />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Jantina" required>
                <div className="flex gap-2 h-[38px]">
                  {[{v:'L',l:'Lelaki'},{v:'P',l:'Perempuan'}].map(o => (
                    <button key={o.v} type="button" onClick={() => set('jantina', o.v)}
                      className={`flex-1 rounded-lg text-xs font-bold border transition-colors ${
                        form.jantina===o.v
                          ? o.v==='L'?'bg-blue-600 text-white border-blue-600':'bg-pink-500 text-white border-pink-500'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                      }`}>{o.l}</button>
                  ))}
                </div>
                {isEdit && form.jantina !== initial?.jantina && (
                  <p className="text-[10px] text-amber-600 mt-1">⚠ Perubahan ini akan padam pendaftaran atlet.</p>
                )}
              </FormField>
              <FormField label="Tarikh Lahir" required>
                <input type="date" value={form.tarikhLahir} onChange={e => set('tarikhLahir', e.target.value)}
                  className={inputCls} />
                {isEdit && form.tarikhLahir !== initial?.tarikhLahir && (
                  <p className="text-[10px] text-amber-600 mt-1">⚠ Perubahan ini akan padam pendaftaran atlet.</p>
                )}
              </FormField>
            </div>

            {form.tarikhLahir && (
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                <span className="text-[10px] text-gray-500">Kategori MSSM:</span>
                {kategori
                  ? <KategoriBadge kat={kategori} firestoreLabel={kategoriList.find(k=>(k.kod||k.id)===kategori)?.label || undefined} />
                  : <span className="text-[10px] text-red-500 font-semibold">Di luar julat kategori</span>}
              </div>
            )}

            {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">{err}</div>}
          </>}
        </div>
        {!warnPending && (
          <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">Batal</button>
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2 text-xs font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50">
              {saving ? 'Menyimpan…' : isEdit ? 'Kemaskini' : 'Tambah Atlet'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PP: Modal Padam Atlet ─────────────────────────────────────────────────────

function PPDeleteAtletModal({ atlet, myPendaftaran, kejohananId, onClose, onSaved }) {
  const atletPend  = myPendaftaran.filter(p => p.noKP === atlet.noKP)
  const acaraCount = atletPend.flatMap(p => p.acaraIds || []).length
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  async function handleDelete() {
    setSaving(true)
    try {
      const batch = writeBatch(db)
      atletPend.forEach(p => batch.delete(doc(db, 'kejohanan', kejohananId, 'pendaftaran', p.id)))
      batch.delete(doc(db, 'atlet', atlet.noKP))
      await batch.commit()
      onSaved(); onClose()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5">
        <h2 className="text-sm font-bold text-gray-800 mb-3">Padam Atlet</h2>
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-xs font-bold text-red-800">{atlet.nama}</p>
          <p className="text-[10px] font-mono text-red-600">{atlet.noKP}</p>
          {acaraCount > 0 && (
            <p className="text-xs text-red-700 mt-2">
              ⚠ Atlet ini mempunyai <strong>{acaraCount} pendaftaran acara</strong>.
              Semua pendaftaran akan dipadam bersama.
            </p>
          )}
          {acaraCount === 0 && (
            <p className="text-xs text-red-700 mt-2">Atlet ini belum mendaftar mana-mana acara.</p>
          )}
        </div>
        {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg mb-3">{err}</div>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving}
            className="flex-1 px-3 py-2 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50">Batal</button>
          <button onClick={handleDelete} disabled={saving}
            className="flex-1 px-3 py-2 text-xs font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
            {saving ? 'Memproses…' : 'Padam Atlet'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PP Pendaftaran View ──────────────────────────────────────────────────────

function PPPendaftaranView({ sekolahList }) {
  const { userData } = useAuth()
  const kodSekolah = userData?.kodSekolah || null
  const sekolahData = sekolahList.find(s => s.kodSekolah === kodSekolah) || null
  const namaSekolah = sekolahData?.namaSekolah || kodSekolah || 'Sekolah Saya'

  const [ppTab, setPpTab] = useState('atlet') // 'atlet' | 'daftar' | 'status' | 'cetak'

  // ── Data state ──────────────────────────────────────────────────────────────
  const [kejohanan, setKejohanan]       = useState(null)
  const [acaraList, setAcaraList]       = useState([])
  const [atletSekolah, setAtletSekolah] = useState([])
  const [pendaftaranList, setPendaftaran]= useState([])
  const [jadualList, setJadualList]     = useState([])
  const [loading, setLoading]           = useState(false)
  const [modal, setModal]               = useState(null)
  const [selectedAcara, setSelectedAcara] = useState(null)
  const [heatDijanaMap, setHeatDijanaMap] = useState({})
  const [filterKat, setFilterKat]       = useState('semua')
  const [filterJenis, setFilterJenis]   = useState('semua')

  // PP Atlet CRUD
  const [atletModal, setAtletModal]     = useState(null) // null | {type:'add'} | {type:'edit',atlet} | {type:'delete',atlet}
  const [showImportPP, setShowImportPP] = useState(false)

  // PP Daftar — dropdown approach
  const [selKat, setSelKat]             = useState('')   // selected kategori
  const [selAcara, setSelAcara]         = useState('')   // selected aceraId
  const [daftarChecked, setDaftarChecked] = useState([]) // noKP[]
  const [daftarSaving, setDaftarSaving] = useState(false)
  const [daftarErr, setDaftarErr]       = useState('')
  const [daftarWarn, setDaftarWarn]     = useState('') // amaran konflik jadual (tidak sekat)
  const [fTabKat, setFTabKat]           = useState('semua') // table filter
  const [fTabAcara, setFTabAcara]       = useState('semua') // table filter
  const [tukarModal, setTukarModal]     = useState(null)  // { pRec, aceraId, acaraObj }

  // PP Start List & Pengesahan
  const [pengesahan, setPengesahan]     = useState(null)  // { disahkan, tarikhSahkan, namaSekolah }
  const [mengesah, setMengesah]         = useState(false) // loading sahkan
  const [slFilterKat, setSlFilterKat]   = useState('semua')
  const [slSearch, setSlSearch]         = useState('')
  const [slHeatData, setSlHeatData]     = useState({})   // aceraId → [heat objs]
  const [slHeatLoading, setSlHeatLoading] = useState(false)

  // PP Cetak — logos from tetapan/home
  const [logos, setLogos]               = useState({ kiri: null, kanan: null, kej: null })
  const [logosLoaded, setLogosLoaded]   = useState(false)
  // Had acara per atlet dari kategori collection
  const [kategoriHadMap, setKategoriHadMap] = useState({}) // kat → {hadIndividu, hadBeregu}
  const [kategoriList, setKategoriList]     = useState([]) // senarai penuh kategori dari Firestore

  // Countdown
  const [countdownStr, setCountdownStr] = useState('')

  // ── Fetch kejohanan aktif + data ────────────────────────────────────────────
  useEffect(() => {
    if (!kodSekolah) return
    setLoading(true)
    getDocs(query(collection(db, 'kejohanan'), where('statusKejohanan', 'in', ['aktif', 'persediaan'])))
      .then(async snap => {
        if (snap.empty) { setLoading(false); return }
        const d = snap.docs[0]
        const kej = { id: d.id, ...d.data() }
        setKejohanan(kej)

        const [acaraSnap, pendSnap, atletSnap, jadualSnap] = await Promise.all([
          getDocs(query(collection(db, 'kejohanan', d.id, 'acara'), orderBy('kategoriKod'))),
          getDocs(query(collection(db, 'kejohanan', d.id, 'pendaftaran'))),
          getDocs(query(collection(db, 'atlet'), where('kodSekolah', '==', kodSekolah))),
          getDocs(query(collection(db, 'jadual_acara'), where('kejohananId', '==', d.id))),
        ])
        setAcaraList(acaraSnap.docs.map(x => ({ id: x.id, ...x.data() })))
        setPendaftaran(pendSnap.docs.map(x => ({ id: x.id, ...x.data() })))
        const atlets = atletSnap.docs.map(x => ({ id: x.id, ...x.data() }))
        atlets.sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'ms'))
        setAtletSekolah(atlets)
        setJadualList(jadualSnap.docs.map(x => ({ id: x.id, ...x.data() })))

        // Fetch had acara dari kategori collection (untuk UI checklist + kiraKategori)
        getDocs(collection(db, 'kategori'))
          .then(katSnap => {
            const map = {}
            const list = []
            katSnap.docs.forEach(kd => {
              map[kd.id] = {
                hadIndividu: kd.data().hadAcaraIndividu ?? 3,
                hadBeregu:   kd.data().hadAcaraBeregu   ?? 2,
              }
              list.push({ id: kd.id, ...kd.data() })
            })
            setKategoriHadMap(map)
            setKategoriList(list)
          })
          .catch(() => {})
      })
      .catch(e => console.error('PPPendaftaranView fetchAll:', e))
      .finally(() => setLoading(false))
  }, [kodSekolah])

  // Refresh after save — termasuk kategoriList supaya isTerbuka sentiasa terkini
  const refreshData = useCallback(async () => {
    if (!kejohanan?.id || !kodSekolah) return
    const [pendSnap, atletSnap, katSnap] = await Promise.all([
      getDocs(query(collection(db, 'kejohanan', kejohanan.id, 'pendaftaran'))),
      getDocs(query(collection(db, 'atlet'), where('kodSekolah', '==', kodSekolah))),
      getDocs(collection(db, 'kategori')),
    ])
    setPendaftaran(pendSnap.docs.map(x => ({ id: x.id, ...x.data() })))
    const atlets = atletSnap.docs.map(x => ({ id: x.id, ...x.data() }))
    atlets.sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'ms'))
    setAtletSekolah(atlets)
    // Kemaskini kategoriList dan hadMap
    const map = {}
    const list = []
    katSnap.docs.forEach(kd => {
      map[kd.id] = { hadIndividu: kd.data().hadAcaraIndividu ?? 3, hadBeregu: kd.data().hadAcaraBeregu ?? 2 }
      list.push({ id: kd.id, ...kd.data() })
    })
    setKategoriHadMap(map)
    setKategoriList(list)
  }, [kejohanan, kodSekolah])

  // Load logos from tetapan/home (for Cetak tab)
  useEffect(() => {
    if (logosLoaded) return
    getDoc(doc(db, 'tetapan', 'home'))
      .then(snap => {
        if (snap.exists()) {
          const d = snap.data()
          setLogos({ kiri: d.logoKiriBase64 || null, kanan: d.logoKananBase64 || null, kej: d.logoKejohananBase64 || null })
        }
        setLogosLoaded(true)
      })
      .catch(() => setLogosLoaded(true))
  }, [logosLoaded])

  // ── Daftar Acara inline save ─────────────────────────────────────────────────
  async function handleDaftarSave() {
    setDaftarErr('')
    setDaftarWarn('')
    if (!selAcara) return setDaftarErr('Pilih acara terlebih dahulu.')
    if (daftarChecked.length === 0) return setDaftarErr('Pilih sekurang-kurangnya seorang atlet.')
    const acara = acaraList.find(a => (a.aceraId || a.id) === selAcara)
    if (!acara || !kejohanan) return setDaftarErr('Acara tidak dijumpai.')

    // ── Semak had slot sekolah per acara (cepat, dari cache) ────────────────
    const acaraKatObjSave = kategoriList.find(k => k.kod === acara.kategoriKod)
    const hadAcara = (() => {
      if (acara.jenisAcara === 'relay' && acaraKatObjSave) {
        const saizPasukan = Number(acaraKatObjSave.saizPasukan) || 4
        const hadPasukan  = acara.jantina === 'P'
          ? (Number(acaraKatObjSave.hadPasukanP) || 1)
          : (Number(acaraKatObjSave.hadPasukanL) || 1)
        return saizPasukan * hadPasukan
      }
      return acara.hadAtletPerSekolah || 2
    })()
    const pesertaSek = pesertaSekolahByAcara[selAcara] || []
    if (pesertaSek.length + daftarChecked.length > hadAcara) {
      return setDaftarErr(`Had ${hadAcara} atlet per sekolah penuh. Slot baki: ${hadAcara - pesertaSek.length}.`)
    }

    setDaftarSaving(true)
    let jadualWarning = ''
    try {
      const kejohananId = kejohanan.id

      // ── Validasi penuh (LIVE) — semua 8 gate ──────────────────────────────
      for (const noKP of daftarChecked) {
        const atlet = atletSekolah.find(a => a.noKP === noKP)
        if (!atlet) continue
        const hasil = await validasiPendaftaran({
          noKP,
          tarikhLahir:    atlet.tarikhLahir,
          kodSekolah:     atlet.kodSekolah,
          kejohananId,
          aceraId:        acara.aceraId || acara.id,
          kategoriId:     acara.kategoriKod,
          jenisAcara:     acara.jenisAcara,
          tahunKejohanan: tahunKej,
        })
        if (!hasil.valid) {
          setDaftarErr(`${atlet.nama} — ${hasil.mesej}`)
          return
        }
        if (hasil.warning && !jadualWarning) jadualWarning = `${atlet.nama} — ${hasil.warning}`
      }
      if (jadualWarning) setDaftarWarn(jadualWarning)
      // ─────────────────────────────────────────────────────────────────────

      const pendLiveSnap = await getDocs(collection(db, 'kejohanan', kejohananId, 'pendaftaran'))
      const pendLiveByKP = {}
      pendLiveSnap.docs.forEach(d => {
        const p = d.data()
        if (p.noKP) pendLiveByKP[p.noKP] = { ...p, id: d.id }
      })
      const bibPfx  = sekolahData?.bibPrefix || kodSekolah || 'BIB'
      const bibFmt  = Number(sekolahData?.bibFormat) || 3

      // Pass 1: kemaskini pendaftaran sedia ada (tambah acaraId) — tiada noBib baru
      for (const noKP of daftarChecked) {
        const atlet = atletSekolah.find(a => a.noKP === noKP)
        if (!atlet) continue
        const pRec = pendLiveByKP[noKP]
        if (pRec) {
          const acaraIds = [...new Set([...(pRec.acaraIds || []), acara.aceraId || acara.id])]
          await updateDoc(doc(db, 'kejohanan', kejohananId, 'pendaftaran', pRec.id), {
            acaraIds, updatedAt: serverTimestamp(),
          })
        }
      }

      // Pass 2: atlet baharu — assign noBib via transaction (selamat dari race condition)
      const toCreate = daftarChecked
        .map(noKP => atletSekolah.find(a => a.noKP === noKP))
        .filter(atlet => atlet && !pendLiveByKP[atlet.noKP])

      if (toCreate.length > 0) {
        const counterRef = doc(db, 'pendaftaran_counter', `${kejohananId}_${kodSekolah}`)
        await runTransaction(db, async (transaction) => {
          const counterSnap = await transaction.get(counterRef)
          let lastNum = counterSnap.exists() ? (counterSnap.data().lastBibNum || 0) : 0
          // Semak bib sedia ada — ambil nombor tertinggi sebagai floor
          pendLiveSnap.docs.forEach(d => {
            const nb = d.data().noBib || ''
            if (nb.startsWith(bibPfx)) {
              const n = parseInt(nb.slice(bibPfx.length), 10)
              if (!isNaN(n) && n > lastNum) lastNum = n
            }
          })

          for (const atlet of toCreate) {
            lastNum++
            const noBib = bibPfx + String(lastNum).padStart(bibFmt, '0')
            transaction.set(doc(db, 'kejohanan', kejohananId, 'pendaftaran', atlet.noKP), {
              noBib,
              noKP:        atlet.noKP,
              namaAtlet:   atlet.nama,
              jantina:     atlet.jantina,
              tarikhLahir: atlet.tarikhLahir,
              kodSekolah:  atlet.kodSekolah,
              kategoriKod: kiraKategori(atlet.tarikhLahir, atlet.jantina, tahunKej, kategoriList),
              acaraIds:    [acara.aceraId || acara.id],
              isAktif:     true,
              isRelay:     false,
              createdAt:   serverTimestamp(),
              updatedAt:   serverTimestamp(),
            })
          }
          transaction.set(counterRef, {
            lastBibNum:  lastNum,
            bibPrefix:   bibPfx,
            kodSekolah,
            kejohananId,
            updatedAt:   serverTimestamp(),
          })
        })
      }
      setDaftarChecked([])
      await refreshData()
    } catch (e) { setDaftarErr(e.message) }
    finally { setDaftarSaving(false) }
  }

  // ── Buang pendaftaran from acara ─────────────────────────────────────────────
  async function handleBuangDaftar(pRec, aceraId) {
    if (!kejohanan?.id) return
    try {
      const newIds = (pRec.acaraIds || []).filter(id => id !== aceraId)
      if (newIds.length === 0) {
        await deleteDoc(doc(db, 'kejohanan', kejohanan.id, 'pendaftaran', pRec.id))
      } else {
        await updateDoc(doc(db, 'kejohanan', kejohanan.id, 'pendaftaran', pRec.id), {
          acaraIds: newIds, updatedAt: serverTimestamp(),
        })
      }
      await refreshData()
    } catch (e) { console.error('handleBuangDaftar:', e) }
  }

  // Tukar atlet dalam acara — buang lama, masuk baru dalam satu operasi
  async function handleTukarSimpan(noKPBaru) {
    const { pRec, aceraId } = tukarModal
    if (!kejohanan?.id || !noKPBaru) return
    const atletBaru = atletSekolah.find(a => a.noKP === noKPBaru)
    if (!atletBaru) return
    try {
      // 1. Buang dari atlet lama
      const idsLama = (pRec.acaraIds || []).filter(id => id !== aceraId)
      if (idsLama.length === 0) {
        await deleteDoc(doc(db, 'kejohanan', kejohanan.id, 'pendaftaran', pRec.id))
      } else {
        await updateDoc(doc(db, 'kejohanan', kejohanan.id, 'pendaftaran', pRec.id), {
          acaraIds: idsLama, updatedAt: serverTimestamp(),
        })
      }
      // 2. Daftar atlet baru — cari pendaftaran sedia ada atau buat baru
      const pendRefBaru = doc(db, 'kejohanan', kejohanan.id, 'pendaftaran', noKPBaru)
      const pendSnapBaru = await getDoc(pendRefBaru)
      if (pendSnapBaru.exists()) {
        const idsBaru = [...new Set([...(pendSnapBaru.data().acaraIds || []), aceraId])]
        await updateDoc(pendRefBaru, { acaraIds: idsBaru, updatedAt: serverTimestamp() })
      } else {
        await setDoc(pendRefBaru, {
          noKP:       noKPBaru,
          noBib:      atletBaru.noBib || '',
          namaAtlet:  atletBaru.nama,
          kodSekolah: atletBaru.kodSekolah,
          acaraIds:   [aceraId],
          createdAt:  serverTimestamp(),
          updatedAt:  serverTimestamp(),
        })
      }
      setTukarModal(null)
      await refreshData()
    } catch (e) { alert('Gagal tukar atlet: ' + e.message) }
  }

  // Heat map
  useEffect(() => {
    if (!kejohanan?.id || acaraList.length === 0) { setHeatDijanaMap({}); return }
    let cancelled = false
    Promise.all(
      acaraList.map(async a => {
        try {
          const snap = await getCountFromServer(
            collection(db, 'kejohanan', kejohanan.id, 'acara', a.aceraId || a.id, 'heat')
          )
          return [a.aceraId || a.id, snap.data().count > 0]
        } catch { return [a.aceraId || a.id, false] }
      })
    ).then(entries => { if (!cancelled) setHeatDijanaMap(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [kejohanan, acaraList])

  // Fetch pengesahan sekolah
  useEffect(() => {
    if (!kejohanan?.id || !kodSekolah) { setPengesahan(null); return }
    getDoc(doc(db, 'kejohanan', kejohanan.id, 'pengesahan', kodSekolah))
      .then(ps => setPengesahan(ps.exists() ? ps.data() : null))
      .catch(() => setPengesahan(null))
  }, [kejohanan, kodSekolah])

  // Fetch heat data untuk Start List tab
  useEffect(() => {
    if (ppTab !== 'startlist' || !kejohanan?.id || !kodSekolah) return
    setSlHeatLoading(true)
    const myAcaraIds = new Set(
      pendaftaranList.filter(p => p.kodSekolah === kodSekolah).flatMap(p => p.acaraIds || [])
    )
    const acaraDenganHeat = acaraList.filter(a => {
      const aid = a.aceraId || a.id
      return heatDijanaMap[aid] === true && myAcaraIds.has(aid)
    })
    Promise.all(
      acaraDenganHeat.map(async a => {
        const aid = a.aceraId || a.id
        try {
          const snap = await getDocs(query(collection(db, 'kejohanan', kejohanan.id, 'acara', aid, 'heat'), orderBy('noHeat')))
          return [aid, snap.docs.map(d => ({ id: d.id, ...d.data() }))]
        } catch { return [aid, []] }
      })
    ).then(entries => { setSlHeatData(Object.fromEntries(entries)); setSlHeatLoading(false) })
     .catch(() => setSlHeatLoading(false))
  }, [ppTab, kejohanan, kodSekolah, pendaftaranList, acaraList, heatDijanaMap])

  // Countdown ticker
  const tarikhTamatDaftar = kejohanan?.tarikhTamatDaftar || null
  useEffect(() => {
    if (!tarikhTamatDaftar) { setCountdownStr(''); return }
    function tick() {
      const ms = new Date(tarikhTamatDaftar) - new Date()
      if (ms <= 0) { setCountdownStr('TAMAT'); return }
      const s = Math.floor(ms / 1000)
      const m = Math.floor(s / 60)
      const h = Math.floor(m / 60)
      const d = Math.floor(h / 24)
      setCountdownStr(d > 0
        ? `${d} hari ${String(h % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
        : `${String(h % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tarikhTamatDaftar])

  const tamatDaftarLepas = tarikhTamatDaftar && new Date() > new Date(tarikhTamatDaftar)
  const pendaftaranTutup = !!tamatDaftarLepas

  function formatDeadlineMY(isoStr) {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    if (isNaN(d)) return isoStr
    return d.toLocaleString('ms-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  }

  const tahunKej = kejohanan?.tarikhMula
    ? new Date(kejohanan.tarikhMula?.toDate?.() || kejohanan.tarikhMula).getFullYear()
    : new Date().getFullYear()

  // Jenis sekolah → kategori dibenar (dinamik dari Firestore)
  const kategoriSekolah = sekolahData?.kategori || null
  const KAT_BY_JENIS = kategoriList.length > 0
    ? kategoriList.reduce((acc, k) => {
        if (!k.kod) return acc
        if (k.isTerbuka) {
          ;['SR','SM','PPKI'].forEach(j => {
            if (!acc[j]) acc[j] = []
            if (!acc[j].includes(k.kod)) acc[j].push(k.kod)
          })
        } else {
          const jenis = k.jenisSekolah || 'SR'
          if (!acc[jenis]) acc[jenis] = []
          if (!acc[jenis].includes(k.kod)) acc[jenis].push(k.kod)
        }
        return acc
      }, {})
    : {} // kosong semasa load — katDibenar → null → tunjuk semua
  const katDibenar = kategoriSekolah ? (KAT_BY_JENIS[kategoriSekolah] || null) : null
  const isDikunci  = pengesahan?.disahkan === true

  // Buang SEMUA acara yang ada parentAcaraId — itu final yang ditentukan sistem
  const acaraIkutSekolah = katDibenar
    ? acaraList.filter(a => katDibenar.includes(a.kategoriKod) && !a.parentAcaraId)
    : acaraList.filter(a => !a.parentAcaraId)
  const katList = [...new Set(acaraIkutSekolah.map(a => a.kategoriKod))].sort()
  const jenisOptions = ['lorong', 'mass_start', 'padang_lompat', 'padang_balin', 'relay']
  const jenisShort = { lorong: 'Lorong', mass_start: 'Mass', padang_lompat: 'Lompat', padang_balin: 'Balin', relay: 'Relay' }

  const acaraFiltered = acaraIkutSekolah.filter(a => {
    if (a.isAktif === false) return false
    if (filterKat !== 'semua' && a.kategoriKod !== filterKat) return false
    if (filterJenis !== 'semua' && a.jenisAcara !== filterJenis) return false
    return true
  })

  // Peserta sekolah semasa per acara
  const pesertaSekolahByAcara = useMemo(() => {
    const map = {}
    pendaftaranList.forEach(p => {
      if (p.kodSekolah !== kodSekolah) return
      ;(p.acaraIds || []).forEach(id => {
        if (!map[id]) map[id] = []
        map[id].push(p)
      })
    })
    return map
  }, [pendaftaranList, kodSekolah])

  // My school's pendaftaran only
  const myPendaftaran = useMemo(
    () => pendaftaranList.filter(p => p.kodSekolah === kodSekolah),
    [pendaftaranList, kodSekolah]
  )

  // ── Countdown display ────────────────────────────────────────────────────────
  function renderCountdown() {
    if (!tarikhTamatDaftar) {
      return (
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
          <svg className="w-4 h-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-gray-500">Tarikh tutup pendaftaran belum ditetapkan. Hubungi pentadbir untuk maklumat lanjut.</p>
        </div>
      )
    }
    if (tamatDaftarLepas) {
      return (
        <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
          <svg className="w-4 h-4 shrink-0 text-red-500 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div>
            <p className="text-xs font-bold text-red-800">Tempoh Pendaftaran Telah Tamat — {formatDeadlineMY(tarikhTamatDaftar)}</p>
            <p className="text-[10px] text-red-600 mt-0.5">Pendaftaran baru tidak dibenarkan. Hubungi pentadbir jika perlu kemaskini.</p>
          </div>
        </div>
      )
    }
    const colorCls = countdownStr === 'TAMAT' || countdownStr.startsWith('00:')
      ? 'bg-red-50 border-red-200 text-red-800'
      : countdownStr.startsWith('1 hari') || countdownStr.startsWith('2 hari') || countdownStr.startsWith('3 hari')
        ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-blue-50 border-blue-200 text-blue-800'
    return (
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${colorCls}`}>
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Masa Tutup Pendaftaran</p>
          <p className="text-xs font-bold">{formatDeadlineMY(tarikhTamatDaftar)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Masa Tinggal</p>
          <p className="text-sm font-black font-mono tracking-wider">{countdownStr}</p>
        </div>
      </div>
    )
  }

  const PP_TABS = [
    { k: 'atlet',  l: 'Atlet Saya', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
    { k: 'daftar', l: 'Daftar Acara', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg> },
    { k: 'status', l: 'Status', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
    { k: 'cetak',  l: 'Cetak', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg> },
    { k: 'startlist', l: 'Start List', icon: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg> },
  ]

  // ── Tab: Atlet Saya ──────────────────────────────────────────────────────────
  function renderTabAtlet() {
    const L = atletSekolah.filter(a => a.jantina === 'L').length
    const P = atletSekolah.filter(a => a.jantina === 'P').length
    const existingBibs = atletSekolah.map(a => a.noBib).filter(Boolean)

    return (
      <div className="space-y-4">
        {/* Header row: school info + Add button */}
        <div className="flex items-center gap-3">
          <div className="flex-1 px-4 py-3 bg-[#003399]/5 border border-[#003399]/20 rounded-xl flex items-center gap-3">
            <svg className="w-5 h-5 text-[#003399] shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <div>
              <p className="text-sm font-bold text-[#003399]">{namaSekolah}</p>
              <p className="text-[10px] text-[#003399]/60 font-mono">{kodSekolah}</p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {!pendaftaranTutup && (
              <button
                onClick={() => setShowImportPP(true)}
                className="flex items-center gap-2 px-4 py-2.5 border border-[#003399] text-[#003399] text-xs font-bold rounded-xl hover:bg-blue-50 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import Excel
              </button>
            )}
            <button
              onClick={() => setAtletModal({ type: 'add' })}
              disabled={pendaftaranTutup}
              title={pendaftaranTutup ? 'Tempoh pendaftaran telah tamat' : ''}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#003399] text-white text-xs font-bold rounded-xl hover:bg-[#002288] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Tambah Atlet
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { l: 'Jumlah Atlet',    v: atletSekolah.length,                                          c: 'text-[#003399]', bg: 'bg-blue-50' },
            { l: 'Lelaki',          v: L,                                                             c: 'text-blue-700',  bg: 'bg-blue-50' },
            { l: 'Perempuan',       v: P,                                                             c: 'text-pink-700',  bg: 'bg-pink-50' },
            { l: 'Sudah Daftar',    v: myPendaftaran.length,                                          c: 'text-green-700', bg: 'bg-green-50' },
          ].map(s => (
            <div key={s.l} className={`${s.bg} rounded-xl px-3 py-2.5 text-center`}>
              <p className={`text-xl font-black ${s.c}`}>{s.v}</p>
              <p className="text-[9px] text-gray-500 uppercase tracking-wide">{s.l}</p>
            </div>
          ))}
        </div>

        {/* Athlete table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Memuatkan…</div>
          ) : atletSekolah.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-gray-400">Tiada atlet. Klik <strong>Tambah Atlet</strong> untuk mula.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">#BIB</th>
                    <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">Nama / No.KP</th>
                    <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide">J</th>
                    <th className="px-3 py-2.5 text-left text-[9px] font-bold text-gray-400 uppercase tracking-wide">T.Lahir</th>
                    <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide">Kat</th>
                    <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide">Acara</th>
                    <th className="px-3 py-2.5 text-center text-[9px] font-bold text-gray-400 uppercase tracking-wide">Tindakan</th>
                  </tr>
                </thead>
                <tbody>
                  {atletSekolah.map(a => {
                    const katAuto  = kiraKategori(a.tarikhLahir, a.jantina, tahunKej, kategoriList)
                    const katVal   = a.kategoriKod || katAuto || ''
                    const pRec     = myPendaftaran.find(p => p.noKP === a.noKP)
                    const acaraJml = pRec ? (pRec.acaraIds || []).length : 0
                    return (
                      <tr key={a.noKP} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-3 py-2.5">
                          <span className="text-[9px] font-black font-mono text-[#003399] bg-blue-50 px-1.5 py-0.5 rounded">{a.noBib || '—'}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-bold text-gray-800">{a.nama}</p>
                          <p className="text-[9px] font-mono text-gray-400">{a.noKP}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center"><JantinaBadge j={a.jantina} /></td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{a.tarikhLahir}</td>
                        <td className="px-3 py-2.5 text-center">
                          <KatDropdown
                            noKP={a.noKP}
                            value={katVal}
                            kategoriList={kategoriList}
                            disabled={pendaftaranTutup}
                            onSaved={(newKat) => setAtletSekolah(prev => prev.map(x => x.noKP === a.noKP ? { ...x, kategoriKod: newKat } : x))}
                            jantina={a.jantina}
                            tarikhLahir={a.tarikhLahir}
                            tahunKej={tahunKej}
                            kejohananId={kejohanan?.id}
                            pRec={myPendaftaran.find(p => p.noKP === a.noKP)}
                          />
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {acaraJml > 0
                            ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{acaraJml} acara</span>
                            : <span className="text-[9px] text-gray-300">Belum daftar</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1">
                            {pendaftaranTutup ? (
                              <span className="text-[9px] font-semibold text-amber-600 px-2 py-0.5 bg-amber-50 rounded-full border border-amber-200">Baca Sahaja</span>
                            ) : (
                              <>
                                <button
                                  onClick={() => setAtletModal({ type: 'edit', atlet: a })}
                                  title="Edit"
                                  className="p-1.5 text-gray-400 hover:text-[#003399] hover:bg-blue-50 rounded-lg transition-colors">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => setAtletModal({ type: 'delete', atlet: a })}
                                  title="Padam"
                                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* PP Atlet modals */}
        {atletModal?.type === 'add' && (
          <PPAtletModal mode="add" sekolahData={sekolahData}
            existingBibs={existingBibs} myPendaftaran={myPendaftaran}
            kejohananId={kejohanan?.id} tahunKej={tahunKej} kategoriList={kategoriList}
            onClose={() => setAtletModal(null)} onSaved={refreshData} />
        )}
        {atletModal?.type === 'edit' && (
          <PPAtletModal mode="edit" initial={atletModal.atlet} sekolahData={sekolahData}
            existingBibs={existingBibs.filter(b => b !== atletModal.atlet?.noBib)}
            myPendaftaran={myPendaftaran} kejohananId={kejohanan?.id} tahunKej={tahunKej}
            kategoriList={kategoriList}
            onClose={() => setAtletModal(null)} onSaved={refreshData} />
        )}
        {atletModal?.type === 'delete' && (
          <PPDeleteAtletModal atlet={atletModal.atlet} myPendaftaran={myPendaftaran}
            kejohananId={kejohanan?.id}
            onClose={() => setAtletModal(null)} onSaved={refreshData} />
        )}
      </div>
    )
  }

  // ── Tab: Daftar Acara ────────────────────────────────────────────────────────
  function renderTabDaftar() {
    const katOptions  = katDibenar || katList
    const acaraByKat  = selKat
      ? acaraIkutSekolah.filter(a => a.kategoriKod === selKat && a.isAktif !== false)
      : []
    const acaraObj    = acaraByKat.find(a => (a.aceraId || a.id) === selAcara)
    const heatAdaAcara = acaraObj ? heatDijanaMap[acaraObj.aceraId || acaraObj.id] === true : false

    // Eligible athletes for selected acara
    const sudahDaftarAcara = pendaftaranList
      .filter(p => (p.acaraIds || []).includes(selAcara))
      .map(p => p.noKP)
    const acaraKatObj = acaraObj ? kategoriList.find(k => k.kod === acaraObj.kategoriKod) : null
    const atletLayak = acaraObj
      ? atletSekolah.filter(a => {
          if (a.isAktif === false) return false
          if (a.jantina !== acaraObj.jantina) return false
          // Kategori Terbuka: semak julat umur sahaja, bukan exact match
          if (acaraKatObj?.isTerbuka) {
            const tLahir = a.tarikhLahir ? parseInt(a.tarikhLahir.substring(0, 4)) : 0
            if (!tLahir) return false
            const umur    = tahunKej - tLahir
            const umurMax = acaraKatObj.umurHad ? Number(acaraKatObj.umurHad) : 99
            const umurMin = acaraKatObj.umurMin ? Number(acaraKatObj.umurMin) : 0
            return umur >= umurMin && umur <= umurMax
          }
          // Utamakan kategoriKod yang disimpan (manual override) — jika tiada, kira auto
          const kat = a.kategoriKod || kiraKategori(a.tarikhLahir, a.jantina, tahunKej, kategoriList)
          return kat === acaraObj.kategoriKod
        })
      : []
    // Kira bilangan acara individu atlet dalam kategori ini (dari cache)
    function bilanganAcaraIndividuDalamKat(noKP, kategoriKod) {
      const pRec = myPendaftaran.find(p => p.noKP === noKP)
      if (!pRec) return 0
      return (pRec.acaraIds || []).filter(id => {
        const ac = acaraList.find(a => (a.aceraId || a.id) === id)
        return ac && ac.kategoriKod === kategoriKod && ac.jenisAcara !== 'relay'
      }).length
    }

    // Kira bilangan acara berkumpulan atlet dalam kategori ini (dari cache)
    function bilanganAcaraBerkumpulanDalamKat(noKP, kategoriKod) {
      const pRec = myPendaftaran.find(p => p.noKP === noKP)
      if (!pRec) return 0
      return (pRec.acaraIds || []).filter(id => {
        const ac = acaraList.find(a => (a.aceraId || a.id) === id)
        return ac && ac.kategoriKod === kategoriKod && ac.jenisAcara === 'relay'
      }).length
    }

    const hadIndividuKat = acaraObj
      ? (kategoriHadMap[acaraObj.kategoriKod]?.hadIndividu ?? 3)
      : 3

    const hadBerkumpulanKat = acaraObj
      ? (kategoriHadMap[acaraObj.kategoriKod]?.hadBeregu ?? 2)
      : 2

    const isRelayAcara = acaraObj?.jenisAcara === 'relay'

    // Asingkan: layak boleh daftar vs had penuh
    const atletLayakBelumDaftar = atletLayak.filter(a => {
      if (sudahDaftarAcara.includes(a.noKP)) return false
      if (isRelayAcara) {
        const bilangan = bilanganAcaraBerkumpulanDalamKat(a.noKP, acaraObj.kategoriKod)
        if (bilangan >= hadBerkumpulanKat) return false // had berkumpulan penuh
      } else {
        const bilangan = bilanganAcaraIndividuDalamKat(a.noKP, acaraObj.kategoriKod)
        if (bilangan >= hadIndividuKat) return false // had individu penuh
      }
      return true
    })
    const atletHadPenuh = atletLayak.filter(a => {
      if (sudahDaftarAcara.includes(a.noKP)) return false
      if (isRelayAcara) {
        const bilangan = bilanganAcaraBerkumpulanDalamKat(a.noKP, acaraObj.kategoriKod)
        return bilangan >= hadBerkumpulanKat
      } else {
        const bilangan = bilanganAcaraIndividuDalamKat(a.noKP, acaraObj.kategoriKod)
        return bilangan >= hadIndividuKat
      }
    })
    const pesertaAcara = acaraObj ? (pesertaSekolahByAcara[acaraObj.aceraId || acaraObj.id] || []) : []
    // Relay: had = saizPasukan × hadPasukan (dari kategori) — bukan hadAtletPerSekolah
    const hadAcara = (() => {
      if (!acaraObj) return 2
      if (isRelayAcara && acaraKatObj) {
        const saizPasukan = Number(acaraKatObj.saizPasukan) || 4
        const hadPasukan  = acaraObj.jantina === 'P'
          ? (Number(acaraKatObj.hadPasukanP) || 1)
          : (Number(acaraKatObj.hadPasukanL) || 1)
        return saizPasukan * hadPasukan
      }
      return acaraObj.hadAtletPerSekolah || 2
    })()
    const slotBaki     = hadAcara - pesertaAcara.length

    // Filtered registrations table
    const katTabOptions = [...new Set(acaraIkutSekolah.map(a => a.kategoriKod))].sort()
    const acaraTabByKat = fTabKat !== 'semua'
      ? acaraIkutSekolah.filter(a => a.kategoriKod === fTabKat)
      : acaraIkutSekolah
    const acaraTabOptions = acaraTabByKat

    // Build registration table rows: per-acara, per-peserta
    const daftarRows = []
    acaraIkutSekolah
      .filter(a => a.isAktif !== false)
      .filter(a => fTabKat === 'semua' || a.kategoriKod === fTabKat)
      .filter(a => fTabAcara === 'semua' || (a.aceraId || a.id) === fTabAcara)
      .forEach(a => {
        const aceraId = a.aceraId || a.id
        const peserta = pesertaSekolahByAcara[aceraId] || []
        if (peserta.length > 0) daftarRows.push({ acara: a, peserta })
      })

    return (
      <div className="space-y-5">

        {/* ── Banner Dikunci ── */}
        {isDikunci && (
          <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
            <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div>
              <p className="text-xs font-bold text-red-700">Pendaftaran Dikunci</p>
              <p className="text-[10px] text-red-600 mt-0.5">
                Pendaftaran telah disahkan pada {pengesahan?.tarikhSahkan
                  ? new Date(pengesahan.tarikhSahkan?.toDate?.() || pengesahan.tarikhSahkan).toLocaleString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '—'}.
                Hubungi penganjur untuk sebarang perubahan.
              </p>
            </div>
          </div>
        )}

        {/* ── Bahagian 1: Daftar Acara ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-[#003399] flex items-center gap-2">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <p className="text-xs font-bold text-white uppercase tracking-wide">Daftar Acara</p>
          </div>
          <div className="px-4 py-4 space-y-3">

            {/* Step 1: Pilih Kategori */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                Langkah 1 — Pilih Kategori
              </label>
              <div className="flex flex-wrap gap-2">
                {katOptions.map(k => {
                  const katObj = kategoriList.find(x => x.kod === k)
                  const label  = katObj?.label || katObj?.nama || k
                  return (
                    <button key={k}
                      onClick={() => { setSelKat(k); setSelAcara(''); setDaftarChecked([]); setDaftarErr('') }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                        selKat === k
                          ? 'bg-[#003399] text-white border-[#003399]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-[#003399]/50'
                      }`}>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Step 2: Pilih Acara */}
            {selKat && (
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                  Langkah 2 — Pilih Acara (Kat {selKat})
                </label>
                <select
                  value={selAcara}
                  onChange={e => { setSelAcara(e.target.value); setDaftarChecked([]); setDaftarErr('') }}
                  className={inputCls}>
                  <option value="">— Pilih Acara —</option>
                  {acaraByKat.map(a => {
                    const sid      = a.aceraId || a.id
                    const pSek     = pesertaSekolahByAcara[sid] || []
                    const had      = a.hadAtletPerSekolah || 2
                    const baki     = had - pSek.length
                    const heatAda  = heatDijanaMap[sid] === true
                    const jenis    = a.peringkat === 'saringan' ? '[Saringan]'
                                   : a.peringkat === 'akhir'    ? '[Terus Final]'
                                   : ''
                    return (
                      <option key={sid} value={sid}>
                        {jenis ? `${jenis} ` : ''}{a.namaAcara} ({a.jantina === 'L' ? 'Lelaki' : 'Perempuan'}) — {
                          heatAda ? 'Heat Dijana' : baki > 0 ? `${pSek.length}/${had} slot` : 'PENUH'
                        }
                      </option>
                    )
                  })}
                </select>
              </div>
            )}

            {/* Step 3: Pilih Atlet */}
            {selAcara && acaraObj && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                    Langkah 3 — Pilih Atlet
                  </label>
                  {/* Acara info + slot */}
                  <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                    <span className="text-xs font-bold text-gray-700">{acaraObj.namaAcara}</span>
                    <KategoriBadge kat={acaraObj.kategoriKod} />
                    <JantinaBadge j={acaraObj.jantina} />
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ml-auto ${
                      slotBaki > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {slotBaki > 0 ? `${pesertaAcara.length}/${hadAcara} slot baki` : `${hadAcara}/${hadAcara} PENUH`}
                    </span>
                    {heatAdaAcara && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-300 text-indigo-700">Heat Dijana</span>
                    )}
                  </div>
                </div>

                {heatAdaAcara || pendaftaranTutup ? (
                  <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-semibold">
                    {heatAdaAcara ? 'Heat sudah dijana — pendaftaran untuk acara ini ditutup.' : 'Tempoh pendaftaran telah tamat.'}
                  </div>
                ) : slotBaki <= 0 ? (
                  <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-semibold">
                    Had {hadAcara} atlet sekolah ini sudah penuh.
                  </div>
                ) : atletLayakBelumDaftar.length === 0 && atletHadPenuh.length === 0 ? (
                  <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500 text-center">
                    Tiada atlet yang layak. Semak: jantina, kategori (umur), dan status atlet.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {atletLayakBelumDaftar.length > 0 && (
                      <p className="text-[10px] text-gray-400">
                        {atletLayakBelumDaftar.length} atlet boleh daftar — had: {isRelayAcara ? hadBerkumpulanKat : hadIndividuKat} acara {isRelayAcara ? 'berkumpulan' : 'individu'} per Kat {acaraObj.kategoriKod}
                      </p>
                    )}
                    {atletHadPenuh.length > 0 && (
                      <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-700 font-semibold">
                        ⚠ {atletHadPenuh.length} atlet tidak boleh daftar — had {isRelayAcara ? hadBerkumpulanKat : hadIndividuKat} acara {isRelayAcara ? 'berkumpulan' : 'individu'} Kat {acaraObj.kategoriKod} sudah penuh:
                        <span className="font-normal"> {atletHadPenuh.map(a => a.nama).join(', ')}</span>
                      </div>
                    )}
                    {atletLayakBelumDaftar.map(a => {
                      const checked  = daftarChecked.includes(a.noKP)
                      const disabled = !checked && daftarChecked.length >= slotBaki
                      return (
                        <label key={a.noKP}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                            checked
                              ? 'bg-blue-50 border-blue-300'
                              : disabled
                                ? 'bg-gray-50 border-gray-100 opacity-50 cursor-not-allowed'
                                : 'bg-white border-gray-200 hover:border-[#003399]/40'
                          }`}>
                          <input type="checkbox" checked={checked} disabled={disabled}
                            onChange={() => {
                              if (disabled) return
                              setDaftarChecked(s => checked ? s.filter(x => x !== a.noKP) : [...s, a.noKP])
                            }}
                            className="w-3.5 h-3.5 accent-[#003399]" />
                          <span className="text-[9px] font-black font-mono text-[#003399] bg-blue-50 px-1.5 py-0.5 rounded shrink-0">{a.noBib || '—'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">{a.nama}</p>
                            <p className="text-[9px] font-mono text-gray-400">{a.noKP}</p>
                          </div>
                          <JantinaBadge j={a.jantina} />
                        </label>
                      )
                    })}
                  </div>
                )}

                {daftarErr && (
                  <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{daftarErr}</div>
                )}

                {daftarWarn && !daftarErr && (
                  <div className="px-3 py-2 bg-amber-50 border border-amber-300 text-amber-800 text-xs rounded-lg">{daftarWarn}</div>
                )}

                {!heatAdaAcara && !pendaftaranTutup && !isDikunci && slotBaki > 0 && atletLayakBelumDaftar.length > 0 && (
                  <button
                    onClick={handleDaftarSave}
                    disabled={daftarSaving || daftarChecked.length === 0}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#003399] text-white text-xs font-bold rounded-lg hover:bg-[#002288] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {daftarSaving ? (
                      'Mengesah & Mendaftar…'
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Daftar {daftarChecked.length > 0 ? `${daftarChecked.length} Atlet` : 'Atlet'} ke {acaraObj.namaAcara}
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Bahagian 2: Senarai Pendaftaran ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-bold text-gray-700">Senarai Pendaftaran Semasa</p>
            <div className="flex items-center gap-2">
              {/* Filter Kat */}
              <select value={fTabKat}
                onChange={e => { setFTabKat(e.target.value); setFTabAcara('semua') }}
                className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600">
                <option value="semua">Semua Kat</option>
                {katTabOptions.map(k => <option key={k} value={k}>Kat {k}</option>)}
              </select>
              {/* Filter Acara */}
              <select value={fTabAcara} onChange={e => setFTabAcara(e.target.value)}
                className="text-[10px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600">
                <option value="semua">Semua Acara</option>
                {acaraTabOptions.map(a => (
                  <option key={a.aceraId || a.id} value={a.aceraId || a.id}>{a.namaAcara}</option>
                ))}
              </select>
            </div>
          </div>
          {daftarRows.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">Tiada pendaftaran untuk paparan ini.</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {daftarRows.map(({ acara, peserta }) => {
                const aceraId    = acara.aceraId || acara.id
                const had        = acara.hadAtletPerSekolah || 2
                const heatAda    = heatDijanaMap[aceraId] === true
                return (
                  <div key={aceraId} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-xs font-bold text-gray-800">{acara.namaAcara}</p>
                      <KategoriBadge kat={acara.kategoriKod} />
                      <JantinaBadge j={acara.jantina} />
                      <span className="text-[9px] text-gray-400 ml-auto">{peserta.length}/{had}</span>
                      {heatAda && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-600">Heat Dijana</span>}
                    </div>
                    <div className="space-y-1 pl-2 border-l-2 border-[#003399]/20">
                      {peserta.map((p, idx) => {
                        const pRec = myPendaftaran.find(x => x.noKP === p.noKP)
                        return (
                          <div key={p.noBib || p.noKP} className="flex items-center gap-2 py-1">
                            <span className="text-[9px] text-gray-400 w-4 shrink-0">{idx + 1}</span>
                            <span className="text-[9px] font-black font-mono text-[#003399] bg-blue-50 px-1.5 py-0.5 rounded shrink-0">{p.noBib || '—'}</span>
                            <span className="text-xs font-semibold text-gray-800 flex-1 truncate">{p.namaAtlet}</span>
                            {!heatAda && !pendaftaranTutup && !isDikunci && pRec && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => setTukarModal({ pRec, aceraId, acaraObj: acara })}
                                  title="Tukar atlet"
                                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold bg-amber-400 hover:bg-amber-500 text-white rounded-md transition-colors shadow-sm">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                  </svg>
                                  Tukar
                                </button>
                                <button
                                  onClick={() => handleBuangDaftar(pRec, aceraId)}
                                  title="Buang dari acara ini"
                                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors shadow-sm">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  Buang
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Modal: Tukar Atlet ── */}
        {tukarModal && (
          <TukarAtletModal
            pRec={tukarModal.pRec}
            aceraId={tukarModal.aceraId}
            acaraObj={tukarModal.acaraObj}
            atletSekolah={atletSekolah}
            pendaftaranList={pendaftaranList}
            myPendaftaran={myPendaftaran}
            acaraList={acaraList}
            kategoriList={kategoriList}
            kategoriHadMap={kategoriHadMap}
            tahunKej={tahunKej}
            onClose={() => setTukarModal(null)}
            onConfirm={handleTukarSimpan}
          />
        )}
      </div>
    )
  }

  // ── Tab: Status Pendaftaran ──────────────────────────────────────────────────
  function renderTabStatus() {
    const totalDaftar = myPendaftaran.flatMap(p => p.acaraIds || []).length
    const acaraMap = Object.fromEntries(acaraList.map(a => [a.aceraId || a.id, a]))
    return (
      <div className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: 'Jumlah Atlet',    v: atletSekolah.length,             c: 'text-[#003399]', bg: 'bg-blue-50' },
            { l: 'Atlet Berdaftar', v: myPendaftaran.length,            c: 'text-green-700', bg: 'bg-green-50' },
            { l: 'Jumlah Daftar',   v: totalDaftar,                     c: 'text-indigo-700', bg: 'bg-indigo-50' },
          ].map(s => (
            <div key={s.l} className={`${s.bg} rounded-xl px-3 py-2.5 text-center`}>
              <p className={`text-xl font-black ${s.c}`}>{s.v}</p>
              <p className="text-[9px] text-gray-500 uppercase tracking-wide">{s.l}</p>
            </div>
          ))}
        </div>

        {/* Per-athlete status */}
        <div className="space-y-2">
          {atletSekolah.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 py-10 text-center">
              <p className="text-sm text-gray-400">{loading ? 'Memuatkan…' : 'Tiada atlet.'}</p>
            </div>
          ) : (
            atletSekolah.map(a => {
              const kat = kiraKategori(a.tarikhLahir, a.jantina, tahunKej, kategoriList)
              const pRec = myPendaftaran.find(p => p.noKP === a.noKP)
              const acaraIds = pRec?.acaraIds || []
              return (
                <div key={a.noKP} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[9px] font-black font-mono text-[#003399] bg-blue-50 px-1.5 py-0.5 rounded shrink-0">{a.noBib || '—'}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate">{a.nama}</p>
                        <p className="text-[9px] font-mono text-gray-400">{a.noKP}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {kat && <KategoriBadge kat={kat} />}
                      <JantinaBadge j={a.jantina} />
                      {acaraIds.length > 0
                        ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{acaraIds.length} acara</span>
                        : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">Belum Daftar</span>
                      }
                    </div>
                  </div>
                  {acaraIds.length > 0 && (
                    <div className="mt-2 pl-2 border-l-2 border-[#003399]/20 space-y-0.5">
                      {acaraIds.map(id => {
                        const ac = acaraMap[id]
                        return (
                          <div key={id} className="flex items-center gap-2 text-[10px] text-gray-600">
                            <span className="font-mono text-gray-400 text-[9px]">{id}</span>
                            <span className="font-semibold">{ac?.namaAcara || id}</span>
                            {ac && <KategoriBadge kat={ac.kategoriKod} />}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  // ── Tab: Cetak ───────────────────────────────────────────────────────────────
  function renderTabCetak() {
    const acaraMap       = Object.fromEntries(acaraList.map(a => [a.aceraId || a.id, a]))
    const namaKej        = kejohanan?.namaKejohanan || ''
    const tarikhCetak    = new Date().toLocaleString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const totalDaftar    = myPendaftaran.flatMap(p => p.acaraIds || []).length

    // Detect image format from data URL (readAsDataURL returns JPEG or PNG)
    function imgFmt(b64) {
      if (!b64) return 'PNG'
      if (b64.startsWith('data:image/jpeg') || b64.startsWith('data:image/jpg')) return 'JPEG'
      if (b64.startsWith('data:image/webp')) return 'WEBP'
      return 'PNG'
    }

    // ── Helper: bina header MSSM ─────────────────────────────────────────────
    function buatHeaderMSSM(pdf) {
      const pageW = pdf.internal.pageSize.getWidth()
      let y = 15

      // Logo kiri
      if (logos.kiri) {
        try { pdf.addImage(logos.kiri, imgFmt(logos.kiri), 12, y - 5, 22, 22) } catch {}
      }
      // Logo kanan
      if (logos.kanan) {
        try { pdf.addImage(logos.kanan, imgFmt(logos.kanan), pageW - 34, y - 5, 22, 22) } catch {}
      }
      // Logo kejohanan (tengah atas)
      if (logos.kej) {
        try { pdf.addImage(logos.kej, imgFmt(logos.kej), (pageW - 18) / 2, y - 6, 18, 18) } catch {}
      }

      // Teks header
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11)
      pdf.text(namaKej || 'Kejohanan Olahraga Antara Murid', pageW / 2, y + 10, { align: 'center' })
      pdf.setFontSize(9)
      pdf.setFont('helvetica', 'normal')
      pdf.text('SENARAI PENDAFTARAN PESERTA', pageW / 2, y + 16, { align: 'center' })
      pdf.setFontSize(8)
      pdf.text(namaSekolah, pageW / 2, y + 21, { align: 'center' })

      // Garisan bawah header
      pdf.setDrawColor(0, 51, 153)
      pdf.setLineWidth(0.8)
      pdf.line(12, y + 25, pageW - 12, y + 25)

      return y + 30 // startY for table
    }

    // ── Bahagian A: Cetak By Atlet ───────────────────────────────────────────
    function cetakByAtlet() {
      const pdf  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const startY = buatHeaderMSSM(pdf)

      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold')
      pdf.text('BAHAGIAN A — SENARAI ATLET & ACARA DIDAFTARKAN', 12, startY - 2)

      const rows = []
      let bil = 1
      atletSekolah.forEach(a => {
        const pRec     = myPendaftaran.find(p => p.noKP === a.noKP)
        const acaraIds = pRec?.acaraIds || []
        const kat      = kiraKategori(a.tarikhLahir, a.jantina, tahunKej, kategoriList) || '—'
        const acaraNama = acaraIds.map(id => acaraMap[id]?.namaAcara || id).join(', ') || '—'
        rows.push([
          bil++,
          a.noBib || '—',
          a.nama,
          a.noKP,
          a.jantina,
          kat,
          acaraNama,
        ])
      })

      autoTable(pdf, {
        startY,
        head: [['#', 'Nombor Badan', 'Nama Penuh', 'No. KP', 'J', 'Kat', 'Acara Didaftarkan']],
        body: rows,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 247, 255] },
        columnStyles: {
          0: { halign: 'center', cellWidth: 8 },
          1: { cellWidth: 22, fontStyle: 'bold' },
          3: { cellWidth: 28, font: 'courier' },
          4: { halign: 'center', cellWidth: 8 },
          5: { halign: 'center', cellWidth: 10 },
        },
        margin: { left: 12, right: 12 },
      })

      // Footer tandatangan
      const finalY = pdf.lastAutoTable.finalY + 15
      pdf.setFontSize(8); pdf.setFont('helvetica', 'normal')
      pdf.text(`Dicetak: ${tarikhCetak}`, 12, finalY)
      pdf.text(`Jumlah Atlet: ${atletSekolah.length}   |   Jumlah Pendaftaran: ${totalDaftar}`, 12, finalY + 5)
      pdf.setFont('helvetica', 'bold')
      pdf.text('Disediakan oleh:', pageW - 80, finalY)
      pdf.text('Tandatangan Guru Pengiring:', pageW - 80, finalY + 5)
      pdf.setFont('helvetica', 'normal')
      pdf.text('_________________________', pageW - 80, finalY + 18)
      pdf.text('Cop Sekolah:', pageW - 80, finalY + 22)
      pdf.text('_________________________', pageW - 80, finalY + 32)
      pdf.setDrawColor(0, 51, 153); pdf.setLineWidth(0.3)
      pdf.line(12, finalY + 38, pageW - 12, finalY + 38)

      pdf.save(`PendaftaranAtlet_${kodSekolah}_${Date.now()}.pdf`)
    }

    // ── Bahagian B: Cetak By Acara ───────────────────────────────────────────
    function cetakByAcara() {
      const pdf   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const startY = buatHeaderMSSM(pdf)

      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold')
      pdf.text('BAHAGIAN B — SENARAI PENDAFTARAN MENGIKUT ACARA', 12, startY - 2)

      const rows = []
      let bil = 1
      acaraIkutSekolah
        .filter(a => a.isAktif !== false)
        .sort((a, b) => (a.kategoriKod || '').localeCompare(b.kategoriKod || ''))
        .forEach(a => {
          const aceraId = a.aceraId || a.id
          const peserta = pesertaSekolahByAcara[aceraId] || []
          if (peserta.length === 0) return
          const pesertaNama = peserta.map((p, i) => `${i+1}. ${p.namaAtlet} (${p.noBib || '—'})`).join('\n')
          rows.push([
            bil++,
            aceraId,
            a.namaAcara,
            `Kat ${a.kategoriKod}`,
            a.jantina === 'L' ? 'Lelaki' : 'Perempuan',
            pesertaNama,
          ])
        })

      if (rows.length === 0) {
        pdf.setFontSize(10); pdf.setFont('helvetica', 'normal')
        pdf.text('Tiada pendaftaran untuk sekolah ini.', pageW / 2, startY + 10, { align: 'center' })
      } else {
        autoTable(pdf, {
          startY,
          head: [['#', 'Kod Acara', 'Nama Acara', 'Kategori', 'Jantina', 'Peserta Sekolah']],
          body: rows,
          styles: { fontSize: 8, cellPadding: 2 },
          headStyles: { fillColor: [0, 51, 153], textColor: 255, fontStyle: 'bold', fontSize: 8 },
          alternateRowStyles: { fillColor: [245, 247, 255] },
          columnStyles: {
            0: { halign: 'center', cellWidth: 8 },
            1: { cellWidth: 22, fontStyle: 'bold' },
            3: { halign: 'center', cellWidth: 16 },
            4: { halign: 'center', cellWidth: 16 },
          },
          margin: { left: 12, right: 12 },
        })
      }

      // Footer
      const finalY = (pdf.lastAutoTable?.finalY || startY + 20) + 15
      pdf.setFontSize(8); pdf.setFont('helvetica', 'normal')
      pdf.text(`Dicetak: ${tarikhCetak}`, 12, finalY)
      pdf.text(`Jumlah Acara Didaftarkan: ${rows.length}`, 12, finalY + 5)
      pdf.setFont('helvetica', 'bold')
      pdf.text('Disahkan oleh Guru Pengiring:', pageW - 80, finalY)
      pdf.setFont('helvetica', 'normal')
      pdf.text('_________________________', pageW - 80, finalY + 12)
      pdf.text('Cop Sekolah:', pageW - 80, finalY + 16)
      pdf.text('_________________________', pageW - 80, finalY + 26)
      pdf.setDrawColor(0, 51, 153); pdf.setLineWidth(0.3)
      pdf.line(12, finalY + 32, pageW - 12, finalY + 32)

      pdf.save(`PendaftaranAcara_${kodSekolah}_${Date.now()}.pdf`)
    }

    return (
      <div className="space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { l: 'Sekolah',        v: namaSekolah,            c: 'text-[#003399]',  bg: 'bg-blue-50' },
            { l: 'Jumlah Atlet',   v: atletSekolah.length,    c: 'text-green-700',  bg: 'bg-green-50' },
            { l: 'Atlet Daftar',   v: myPendaftaran.length,   c: 'text-indigo-700', bg: 'bg-indigo-50' },
            { l: 'Jml Pendaftaran',v: totalDaftar,             c: 'text-amber-700',  bg: 'bg-amber-50' },
          ].map(s => (
            <div key={s.l} className={`${s.bg} rounded-xl px-3 py-2.5 text-center`}>
              <p className={`text-sm font-black ${s.c} truncate`}>{s.v}</p>
              <p className="text-[9px] text-gray-500 uppercase tracking-wide">{s.l}</p>
            </div>
          ))}
        </div>

        {/* Print buttons */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 space-y-3">
          <div>
            <p className="text-sm font-bold text-gray-800">Cetak Senarai Pendaftaran</p>
            <p className="text-xs text-gray-400 mt-0.5">Format MSSM dengan logo, tanda tangan guru pengiring, dan cop sekolah.</p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {/* Button A: By Atlet */}
            <button onClick={cetakByAtlet} disabled={atletSekolah.length === 0}
              className="flex items-center gap-3 px-4 py-3 bg-[#003399] text-white rounded-xl hover:bg-[#002288] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <svg className="w-8 h-8 bg-white/20 rounded-lg p-1.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <div className="text-left">
                <p className="text-xs font-black">Cetak By Atlet</p>
                <p className="text-[10px] text-white/70">Bahagian A — No.Badan | Nama | No.KP | Kat | Acara Didaftarkan</p>
              </div>
            </button>

            {/* Button B: By Acara */}
            <button onClick={cetakByAcara} disabled={totalDaftar === 0}
              className="flex items-center gap-3 px-4 py-3 bg-indigo-700 text-white rounded-xl hover:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <svg className="w-8 h-8 bg-white/20 rounded-lg p-1.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <div className="text-left">
                <p className="text-xs font-black">Cetak By Acara</p>
                <p className="text-[10px] text-white/70">Bahagian B — Kod Acara | Nama Acara | Kat | Peserta Sekolah</p>
              </div>
            </button>
          </div>

          {/* Logo status + preview */}
          {!logosLoaded ? (
            <p className="text-[10px] text-gray-400">Memuatkan logo…</p>
          ) : (logos.kiri || logos.kanan || logos.kej) ? (
            <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg space-y-1.5">
              <div className="flex items-center gap-1.5">
                <svg className="w-3 h-3 text-green-600 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-[10px] text-green-700 font-semibold">Logo akan disertakan dalam cetakan</p>
              </div>
              <div className="flex items-center gap-3">
                {logos.kiri && (
                  <div className="text-center">
                    <img src={logos.kiri} alt="Logo Kiri" className="h-8 w-8 object-contain mx-auto border border-green-200 rounded bg-white p-0.5" />
                    <p className="text-[8px] text-green-600 mt-0.5">Kiri</p>
                  </div>
                )}
                {logos.kej && (
                  <div className="text-center">
                    <img src={logos.kej} alt="Logo Kejohanan" className="h-8 w-8 object-contain mx-auto border border-green-200 rounded bg-white p-0.5" />
                    <p className="text-[8px] text-green-600 mt-0.5">Kejohanan</p>
                  </div>
                )}
                {logos.kanan && (
                  <div className="text-center">
                    <img src={logos.kanan} alt="Logo Kanan" className="h-8 w-8 object-contain mx-auto border border-green-200 rounded bg-white p-0.5" />
                    <p className="text-[8px] text-green-600 mt-0.5">Kanan</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[10px] text-amber-700">Logo belum dikonfigurasi. Sila muat naik logo dalam Tetapan → Home.</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Tab: Start List ──────────────────────────────────────────────────────────
  function renderTabStartList() {
    // Acara sekolah ini yang ada heat dijana
    const myAcaraIds = new Set(
      myPendaftaran.flatMap(p => p.acaraIds || [])
    )
    const acaraDenganHeat = acaraList.filter(a => {
      const aid = a.aceraId || a.id
      return heatDijanaMap[aid] === true && myAcaraIds.has(aid) && a.isAktif !== false
    })
    const katSLOptions = [...new Set(acaraDenganHeat.map(a => a.kategoriKod))].sort()

    const acaraSLFiltered = acaraDenganHeat
      .filter(a => slFilterKat === 'semua' || a.kategoriKod === slFilterKat)
      .filter(a => {
        if (!slSearch.trim()) return true
        return (a.namaAcara || '').toLowerCase().includes(slSearch.trim().toLowerCase())
      })
      .sort((a, b) => (a.noAcara || 0) - (b.noAcara || 0))

    async function handleSahkan() {
      if (!kejohanan?.id || !kodSekolah) return
      if (!window.confirm('Sahkan pendaftaran? Tindakan ini akan mengunci pendaftaran. Tiada perubahan boleh dibuat melalui sistem selepas ini.')) return
      setMengesah(true)
      try {
        const data = {
          disahkan: true,
          tarikhSahkan: serverTimestamp(),
          namaSekolah,
          kodSekolah,
        }
        await setDoc(doc(db, 'kejohanan', kejohanan.id, 'pengesahan', kodSekolah), data)
        setPengesahan({ ...data, tarikhSahkan: new Date() })
      } catch (e) { alert('Gagal sahkan: ' + e.message) }
      finally { setMengesah(false) }
    }

    return (
      <div className="space-y-4">

        {/* ── Banner Pengesahan ── */}
        {isDikunci ? (
          <div className="flex items-start gap-3 px-4 py-3.5 bg-green-50 border border-green-200 rounded-xl">
            <svg className="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-xs font-bold text-green-800">Pendaftaran Dikunci</p>
              <p className="text-[10px] text-green-700 mt-0.5">
                Disahkan pada {pengesahan?.tarikhSahkan
                  ? new Date(pengesahan.tarikhSahkan?.toDate?.() || pengesahan.tarikhSahkan).toLocaleString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '—'}.
                Hubungi penganjur untuk sebarang perubahan.
              </p>
            </div>
          </div>
        ) : acaraDenganHeat.length > 0 ? (
          <div className="flex items-start justify-between gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-xs font-bold text-amber-800">Semak Start List Pasukan Anda</p>
                <p className="text-[10px] text-amber-700 mt-0.5">Setelah disahkan, pendaftaran akan dikunci. Tiada perubahan boleh dibuat melalui sistem.</p>
              </div>
            </div>
            <button
              onClick={handleSahkan}
              disabled={mengesah}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold bg-[#003399] text-white rounded-lg hover:bg-[#002288] disabled:opacity-50 transition-colors whitespace-nowrap">
              {mengesah
                ? 'Menyimpan…'
                : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>Sahkan &amp; Kunci</>
              }
            </button>
          </div>
        ) : null}

        {/* ── Tiada start list lagi ── */}
        {acaraDenganHeat.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm py-16 text-center space-y-2">
            <svg className="w-8 h-8 text-gray-200 mx-auto" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-xs font-semibold text-gray-400">Start list belum tersedia</p>
            <p className="text-[10px] text-gray-300">Penganjur belum jana heat untuk acara anda.</p>
          </div>
        ) : (
          <>
            {/* ── Filter & Search ── */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Cari acara… (cth: 100M)"
                  value={slSearch}
                  onChange={e => setSlSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399]"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['semua', ...katSLOptions].map(k => (
                  <button key={k} onClick={() => setSlFilterKat(k)}
                    className={`px-2.5 py-1.5 text-[10px] font-bold rounded-lg border transition-colors ${
                      slFilterKat === k ? 'bg-[#003399] text-white border-[#003399]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}>
                    {k === 'semua' ? 'Semua' : `Kat ${k}`}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Senarai Acara ── */}
            {slHeatLoading ? (
              <div className="py-10 text-center text-xs text-gray-400">Memuatkan start list…</div>
            ) : acaraSLFiltered.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-400">Tiada acara sepadan dengan carian.</div>
            ) : (
              <div className="space-y-3">
                {acaraSLFiltered.map(a => {
                  const aid = a.aceraId || a.id
                  const heats = slHeatData[aid] || []
                  const isPadang = ['padang_lompat', 'padang_balin'].includes(a.jenisAcara)
                  const peringkatBadge = a.peringkat === 'saringan'
                    ? <span className="text-[8px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">Saringan</span>
                    : a.parentAcaraId
                    ? <span className="text-[8px] font-bold px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full">Final</span>
                    : <span className="text-[8px] font-bold px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">Terus Final</span>

                  // Kumpul peserta sekolah dari semua heat
                  const pesertaRows = heats.flatMap(h =>
                    (h.peserta || [])
                      .filter(p => p.kodSekolah === kodSekolah)
                      .map(p => ({ ...p, _heat: h }))
                  )

                  return (
                    <div key={aid} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                      {/* Acara header */}
                      <div className="px-4 py-2.5 bg-[#003399] flex items-center gap-2">
                        <span className="text-[10px] font-black text-white">#{a.noAcara || '—'}</span>
                        <span className="text-xs font-bold text-white">{a.namaAcara}</span>
                        {peringkatBadge}
                        <span className={`ml-auto text-[9px] font-black ${a.jantina === 'L' ? 'text-blue-200' : 'text-pink-200'}`}>
                          {a.jantina === 'L' ? 'LELAKI' : 'PEREMPUAN'}
                        </span>
                      </div>

                      {pesertaRows.length === 0 ? (
                        <div className="px-4 py-3 text-[10px] text-gray-400 italic">Tiada atlet pasukan anda dalam acara ini.</div>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                              <th className="px-3 py-2 text-center font-bold text-gray-500 text-[10px] w-16">{isPadang ? '#' : 'Lorong'}</th>
                              <th className="px-3 py-2 text-left font-bold text-gray-500 text-[10px]">Nama Atlet</th>
                              <th className="px-3 py-2 text-center font-bold text-gray-500 text-[10px] w-20">No. Badan</th>
                              <th className="px-3 py-2 text-center font-bold text-gray-500 text-[10px] w-20">Heat</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {pesertaRows.map((p, idx) => (
                              <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                                <td className="px-3 py-2 text-center">
                                  <span className="font-black text-[#003399] text-sm">
                                    {isPadang ? (p.giliran ?? '—') : (p.lorong ?? '—')}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-semibold text-gray-800">{p.namaAtlet || '—'}</td>
                                <td className="px-3 py-2 text-center font-mono text-gray-600">{p.noBib || '—'}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                                    {p._heat.fasa === 'final' ? 'Final' : p._heat.fasa === 'saringan' ? 'Saringan' : `Heat ${p._heat.noHeat}`}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-gray-900">Pendaftaran Atlet</h1>
        <p className="text-xs text-gray-400 mt-0.5">{namaSekolah} — {kejohanan?.namaKejohanan || 'Tiada kejohanan aktif'}</p>
      </div>

      {/* Countdown — always at top */}
      {renderCountdown()}

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit overflow-x-auto">
        {PP_TABS.map(t => (
          <button key={t.k} onClick={() => setPpTab(t.k)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
              ppTab === t.k ? 'bg-white text-[#003399] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.icon}{t.l}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {ppTab === 'atlet'     && renderTabAtlet()}
      {ppTab === 'daftar'    && renderTabDaftar()}
      {ppTab === 'status'    && renderTabStatus()}
      {ppTab === 'cetak'     && renderTabCetak()}
      {ppTab === 'startlist' && renderTabStartList()}

      {/* Import Excel Modal */}
      {showImportPP && (
        <ImportAtletModal
          sekolahData={sekolahData}
          existingBibs={atletSekolah.map(a => a.noBib).filter(Boolean)}
          onClose={() => setShowImportPP(false)}
          onSaved={() => { refreshData() }} />
      )}

    </div>
  )
}

// ─── Halaman Utama ────────────────────────────────────────────────────────────

export default function PendaftaranSetup() {
  const { userRole, userData } = useAuth()
  const isPP = userRole === 'pengurus_pasukan'
  const [tab, setTab]          = useState('atlet') // 'atlet' | 'daftar'
  const [sekolahList, setSekolahList] = useState([])

  useEffect(() => {
    getDocs(query(collection(db, 'sekolah'), orderBy('namaSekolah')))
      .then(snap => setSekolahList(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
  }, [])

  // PP gets dedicated single-page view
  if (isPP) {
    return (
      <div className="p-5 max-w-6xl mx-auto">
        <PPPendaftaranView sekolahList={sekolahList} />
      </div>
    )
  }

  return (
    <div className="p-5 max-w-6xl mx-auto space-y-4">

      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-gray-900">Pendaftaran Atlet</h1>
        <p className="text-xs text-gray-400 mt-0.5">Urus rekod atlet dan pendaftaran ke acara kejohanan</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {[
          { k:'atlet',  l:'Urus Atlet',     icon:<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
          { k:'daftar', l:'Daftar ke Acara',icon:<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg> },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all ${
              tab === t.k ? 'bg-white text-[#003399] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.icon}{t.l}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'atlet' && (
        <TabAtlet userRole={userRole} userData={userData} sekolahList={sekolahList} />
      )}
      {tab === 'daftar' && (
        <TabPendaftaran userRole={userRole} userData={userData} sekolahList={sekolahList} />
      )}
    </div>
  )
}
