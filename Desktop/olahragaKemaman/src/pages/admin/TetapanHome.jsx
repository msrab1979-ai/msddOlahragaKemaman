/**
 * TetapanHome — /dashboard/tetapan
 * Konfigurasi halaman awam (/): logo, nama, warna, pengumuman
 * Logo disimpan ke Firebase Storage → URL disimpan di Firestore tetapan/home
 */

import { useState, useEffect, useRef } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const TETAPAN_DEFAULTS = {
  // Header
  namaAgensi:           'Kementerian Pendidikan Malaysia',
  namaSistem:           'SISTEM KOAM',
  logoKiriBase64:       '',
  logoKananBase64:      '',
  logoKiriTeks:         'KPM',
  logoKananTeks:        'MSN',
  // Hero
  namaOrganisasi:       'Majlis Sukan Sekolah Daerah Kemaman',
  tajukUtama:           'Kejohanan Olahraga',
  tajukKecil:           'Antara Murid',
  warnaTema:            '#003399',
  warnaHero:            '#001a66',
  // Logos kejohanan & penganjur (base64)
  logoKejohananBase64:  '',
  logoPenganjurBase64:  '',
  namaPenganjur:        '',
  // Pengumuman
  pengumuman:           '',
  isPengumumanAktif:    false,
  // Medal Tally
  bilanganKedudukan:    5,   // berapa kedudukan DIREKOD dalam sistem (ke-1 hingga ke-n)
  showMedalHome:        true, // tunjuk bahagian kedudukan pingat di laman awam
  medalHomeKedudukan:   3,   // berapa kedudukan DIPAPAR di Home (3/4/5)
  medalHomeGroupJenis:  'pisah', // 'pisah' = SR/SM/PPKI berasingan | 'gabung' = satu jadual
  // Jadual Acara
  showJadual:           true,
  // Pautan Kumpulan
  linkWasap:            '',
  linkTelegram:         '',
  // Dokumen Muat Turun (selepas login)
  dokumenMuatTurun:     [], // [{ nama, url }]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-[#003399]/25 focus:border-[#003399] ' +
  'bg-gray-50 transition-colors'

function SectionTitle({ title, desc }) {
  return (
    <div className="border-b border-gray-100 pb-2 mb-5">
      <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">{title}</p>
      {desc && <p className="text-[11px] text-gray-400 mt-0.5">{desc}</p>}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

// ─── Logo Uploader (base64) ───────────────────────────────────────────────────

function LogoUploader({ label, desc, value, onChange, maxKB = 500 }) {
  const ref = useRef()

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > maxKB * 1024) {
      alert(`Saiz fail melebihi ${maxKB}KB. Sila kecilkan imej terlebih dahulu.`)
      return
    }
    const reader = new FileReader()
    reader.onload = ev => onChange(ev.target.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-bold text-gray-700">{label}</p>
        {desc && <p className="text-[11px] text-gray-400 mt-0.5">{desc}</p>}
      </div>

      <div
        onClick={() => ref.current?.click()}
        className={`cursor-pointer border-2 border-dashed rounded-xl transition-all p-5 flex flex-col items-center gap-3 text-center
          ${value ? 'border-[#003399]/40 bg-blue-50/20 hover:bg-blue-50/40'
                  : 'border-gray-300 bg-gray-50 hover:border-[#003399] hover:bg-blue-50/20'}`}
      >
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
          className="hidden" onChange={handleFile} />

        {value ? (
          <>
            <img src={value} alt="logo" className="max-h-20 max-w-[150px] object-contain rounded" />
            <p className="text-[11px] text-[#003399] font-semibold">✓ Logo dimuatkan · Klik untuk tukar</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600">Klik untuk muat naik</p>
              <p className="text-[10px] text-gray-400 mt-0.5">PNG · JPG · SVG · WebP · Maks {maxKB}KB</p>
            </div>
          </>
        )}
      </div>

      {value && (
        <button type="button" onClick={() => onChange('')}
          className="text-[11px] text-red-400 hover:text-red-600 font-medium transition-colors">
          × Buang logo
        </button>
      )}
    </div>
  )
}

// ─── Header Logo Uploader (base64 kecil) ─────────────────────────────────────

function HeaderLogoUploader({ label, value, teks, onChangeLogo, onChangeTeks }) {
  const ref = useRef()

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 300 * 1024) {
      alert('Logo header melebihi 300KB. Gunakan imej kecil (icon).')
      return
    }
    const reader = new FileReader()
    reader.onload = ev => onChangeLogo(ev.target.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-3">
      <div
        onClick={() => ref.current?.click()}
        className="cursor-pointer border-2 border-dashed border-gray-200 hover:border-[#003399] rounded-xl p-3 flex items-center gap-3 transition-all hover:bg-blue-50/20"
      >
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
          {value
            ? <img src={value} alt="logo" className="w-full h-full object-contain" />
            : <span className="text-xs font-black text-gray-300">{teks || '?'}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-600">{label}</p>
          <p className="text-[10px] text-gray-400">{value ? 'Klik untuk tukar' : 'Klik untuk muat naik'} · Maks 300KB</p>
        </div>
        {value && (
          <button type="button" onClick={e => { e.stopPropagation(); onChangeLogo('') }}
            className="text-[10px] text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">
            × Buang
          </button>
        )}
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 font-semibold mb-1 uppercase tracking-wide">
          Teks gantian jika tiada logo
        </label>
        <input className={inputCls} value={teks} onChange={e => onChangeTeks(e.target.value)}
          placeholder="cth: KPM" maxLength={5} />
      </div>
    </div>
  )
}

// ─── Preview ──────────────────────────────────────────────────────────────────

function HomePreview({ cfg }) {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      {/* Header */}
      <div style={{ backgroundColor: cfg.warnaTema }} className="px-3 py-2 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0 overflow-hidden">
          {cfg.logoKiriBase64
            ? <img src={cfg.logoKiriBase64} className="w-full h-full object-contain" alt="" />
            : <span className="font-black text-[7px]" style={{ color: cfg.warnaTema }}>{cfg.logoKiriTeks}</span>}
        </div>
        <div className="flex-1 text-center">
          <p className="text-white/40 text-[7px] uppercase tracking-widest leading-none">{cfg.namaAgensi}</p>
          <p className="text-white font-black text-[9px] tracking-widest mt-0.5">{cfg.namaSistem}</p>
        </div>
        <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0 overflow-hidden">
          {cfg.logoKananBase64
            ? <img src={cfg.logoKananBase64} className="w-full h-full object-contain" alt="" />
            : <span className="font-black text-[7px]" style={{ color: cfg.warnaTema }}>{cfg.logoKananTeks}</span>}
        </div>
      </div>

      {/* Stripe */}
      <div className="h-[2px] bg-gradient-to-r from-[#cc0001] via-[#ffda00] to-[#cc0001]" />

      {/* Hero */}
      <div style={{ backgroundColor: cfg.warnaHero }} className="py-5 px-4 text-center space-y-2">
        {cfg.logoPenganjurBase64 && (
          <img src={cfg.logoPenganjurBase64} alt="penganjur" className="h-6 mx-auto object-contain opacity-80" />
        )}
        {cfg.logoKejohananBase64 && (
          <img src={cfg.logoKejohananBase64} alt="kejohanan" className="h-12 mx-auto object-contain" />
        )}
        <p className="text-white/30 text-[7px] uppercase tracking-widest">{cfg.namaOrganisasi}</p>
        <p className="text-white font-black text-sm leading-tight">{cfg.tajukUtama}</p>
        <p className="text-white/60 text-[10px]">{cfg.tajukKecil}</p>
        {cfg.namaPenganjur && (
          <p className="text-white/40 text-[9px]">{cfg.namaPenganjur}</p>
        )}
      </div>

      {/* Pengumuman */}
      {cfg.isPengumumanAktif && cfg.pengumuman && (
        <div className="bg-yellow-50 border-t border-yellow-200 px-3 py-1.5">
          <p className="text-[9px] text-yellow-800">📢 {cfg.pengumuman}</p>
        </div>
      )}

      {/* Login tiles */}
      <div className="bg-white py-3 px-3 flex justify-center gap-2">
        {['Pengurus Pasukan', 'Urusetia', 'Pencatat'].map(r => (
          <div key={r} className="border border-gray-200 rounded px-2 py-1.5 text-[7px] text-gray-500 text-center w-16 leading-tight">{r}</div>
        ))}
      </div>
    </div>
  )
}

// ─── TetapanHome (Main) ───────────────────────────────────────────────────────

export default function TetapanHome() {
  const { user } = useAuth()
  const [cfg,     setCfg]     = useState(TETAPAN_DEFAULTS)
  const [busy,    setBusy]    = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDoc(doc(db, 'tetapan', 'home'))
      .then(snap => { if (snap.exists()) setCfg({ ...TETAPAN_DEFAULTS, ...snap.data() }) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function set(k, v) { setCfg(prev => ({ ...prev, [k]: v })); setSaved(false) }

  async function handleSave(e) {
    e.preventDefault()
    setBusy(true); setSaved(false)
    try {
      await setDoc(doc(db, 'tetapan', 'home'), {
        ...cfg, updatedAt: serverTimestamp(), updatedBy: user?.uid || '',
      })
      setSaved(true)
    } catch (err) { alert(`Gagal simpan: ${err.message}`) }
    finally { setBusy(false) }
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Memuatkan…</div>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-800">Tetapan Halaman Utama</h1>
        <p className="text-xs text-gray-500 mt-0.5">Ubah logo, nama, warna dan paparan halaman login awam (/)</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">

        {/* ── Form ── */}
        <form onSubmit={handleSave} className="space-y-5">

          {/* 1. Logo Kejohanan & Penganjur */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <SectionTitle title="Logo Kejohanan & Penganjur"
              desc="Dipapar dalam bahagian hero — nampak menonjol di halaman utama" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <LogoUploader
                label="Logo Kejohanan"
                desc="Dipapar besar di tengah hero halaman utama"
                value={cfg.logoKejohananBase64}
                onChange={v => set('logoKejohananBase64', v)}
                maxKB={500}
              />
              <LogoUploader
                label="Logo Penganjur"
                desc="Dipapar kecil di atas logo kejohanan"
                value={cfg.logoPenganjurBase64}
                onChange={v => set('logoPenganjurBase64', v)}
                maxKB={300}
              />
            </div>

            <div className="mt-4">
              <Field label="Nama Penganjur" hint="Dipapar kecil di bawah tajuk kejohanan">
                <input className={inputCls} value={cfg.namaPenganjur}
                  onChange={e => set('namaPenganjur', e.target.value)}
                  placeholder="cth: Majlis Sukan Sekolah Daerah Kemaman" />
              </Field>
            </div>
          </div>

          {/* 2. Header */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <SectionTitle title="Header Bar"
              desc="Bar biru di atas — nama sistem dan logo kiri/kanan" />

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Nama Agensi">
                  <input className={inputCls} value={cfg.namaAgensi}
                    onChange={e => set('namaAgensi', e.target.value)}
                    placeholder="cth: Kementerian Pendidikan Malaysia" />
                </Field>
                <Field label="Nama Sistem">
                  <input className={inputCls} value={cfg.namaSistem}
                    onChange={e => set('namaSistem', e.target.value)}
                    placeholder="cth: SISTEM KOAM" maxLength={30} />
                </Field>
              </div>

              <Field label="Warna Tema">
                <div className="flex gap-2 items-center">
                  <input type="color" value={cfg.warnaTema}
                    onChange={e => set('warnaTema', e.target.value)}
                    className="h-9 w-14 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white" />
                  <input className={inputCls} value={cfg.warnaTema}
                    onChange={e => set('warnaTema', e.target.value)}
                    placeholder="#003399" maxLength={7} />
                </div>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1 border-t border-gray-100">
                <HeaderLogoUploader
                  label="Logo Kiri Header"
                  value={cfg.logoKiriBase64}
                  teks={cfg.logoKiriTeks}
                  onChangeLogo={v => set('logoKiriBase64', v)}
                  onChangeTeks={v => set('logoKiriTeks', v)}
                />
                <HeaderLogoUploader
                  label="Logo Kanan Header"
                  value={cfg.logoKananBase64}
                  teks={cfg.logoKananTeks}
                  onChangeLogo={v => set('logoKananBase64', v)}
                  onChangeTeks={v => set('logoKananTeks', v)}
                />
              </div>
            </div>
          </div>

          {/* 3. Hero */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <SectionTitle title="Teks Hero"
              desc="Digunakan jika tiada kejohanan aktif. Bila kejohanan aktif, nama kejohanan auto-gantikan tajuk." />

            <div className="p-3 mb-4 bg-blue-50 border border-blue-200 rounded-lg flex gap-2 items-start">
              <svg className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[11px] text-blue-700 leading-relaxed">
                Bila kejohanan <strong>Aktif</strong> dalam Pengurusan Kejohanan, nama + tarikh + lokasi
                kejohanan akan <strong>menggantikan</strong> teks di bawah secara automatik.
              </p>
            </div>

            <div className="space-y-3">
              <Field label="Nama Organisasi (teks kecil)">
                <input className={inputCls} value={cfg.namaOrganisasi}
                  onChange={e => set('namaOrganisasi', e.target.value)}
                  placeholder="cth: Majlis Sukan Sekolah Daerah Kemaman" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tajuk Utama">
                  <input className={inputCls} value={cfg.tajukUtama}
                    onChange={e => set('tajukUtama', e.target.value)}
                    placeholder="cth: Kejohanan Olahraga" maxLength={50} />
                </Field>
                <Field label="Tajuk Kecil">
                  <input className={inputCls} value={cfg.tajukKecil}
                    onChange={e => set('tajukKecil', e.target.value)}
                    placeholder="cth: Antara Murid" maxLength={50} />
                </Field>
              </div>
              <Field label="Warna Latar Hero">
                <div className="flex gap-2 items-center">
                  <input type="color" value={cfg.warnaHero}
                    onChange={e => set('warnaHero', e.target.value)}
                    className="h-9 w-14 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white" />
                  <input className={inputCls} value={cfg.warnaHero}
                    onChange={e => set('warnaHero', e.target.value)}
                    placeholder="#001a66" maxLength={7} />
                </div>
              </Field>
            </div>
          </div>

          {/* 4. Medal Tally */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <SectionTitle title="Kedudukan Pingat (Laman Awam)"
              desc="Tetapan paparan medal standing di halaman awam" />
            <div className="space-y-4">
              {/* Toggle show/hide */}
              <label className="flex items-center gap-3 cursor-pointer"
                onClick={() => set('showMedalHome', !cfg.showMedalHome)}>
                <div className={`relative w-10 h-5 rounded-full transition-colors ${cfg.showMedalHome ? 'bg-[#003399]' : 'bg-gray-200'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${cfg.showMedalHome ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-sm text-gray-600">
                  {cfg.showMedalHome ? 'Kedudukan pingat dipapar di laman awam' : 'Kedudukan pingat disembunyikan'}
                </span>
              </label>

              {cfg.showMedalHome !== false && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-1">
                  <Field label="Papar sehingga kedudukan ke-"
                    hint="3 = emas/perak/gangsa sahaja. 4 atau 5 = tambah tempat tambahan (optional).">
                    <select className={inputCls}
                      value={cfg.medalHomeKedudukan ?? 3}
                      onChange={e => set('medalHomeKedudukan', Number(e.target.value))}>
                      <option value={3}>3 — Emas / Perak / Gangsa sahaja</option>
                      <option value={4}>4 — Tambah tempat ke-4</option>
                      <option value={5}>5 — Tambah tempat ke-5</option>
                    </select>
                  </Field>
                  <Field label="Kumpulkan mengikut jenis sekolah"
                    hint="Pisah = SR dan SM dalam kumpulan berasingan. Gabung = satu jadual keseluruhan.">
                    <select className={inputCls}
                      value={cfg.medalHomeGroupJenis ?? 'pisah'}
                      onChange={e => set('medalHomeGroupJenis', e.target.value)}>
                      <option value="pisah">SR / SM / PPKI berasingan</option>
                      <option value="gabung">Semua dalam satu jadual</option>
                    </select>
                  </Field>
                </div>
              )}

              <Field label="Bilangan kedudukan yang DIREKOD dalam sistem"
                hint="Ini mempengaruhi medal_tally_kat dan mata olahragawan. Pastikan ≥ nilai papar di atas.">
                <input
                  type="number" min={1} max={10}
                  className={inputCls}
                  value={cfg.bilanganKedudukan ?? 5}
                  onChange={e => set('bilanganKedudukan', Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                />
              </Field>
            </div>
          </div>

          {/* 5. Jadual Acara */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <SectionTitle title="Jadual Acara" desc="Kawal paparan jadual acara di halaman awam (/)" />
            <label className="flex items-center gap-3 cursor-pointer"
              onClick={() => set('showJadual', !cfg.showJadual)}>
              <div className={`relative w-10 h-5 rounded-full transition-colors ${cfg.showJadual ? 'bg-[#003399]' : 'bg-gray-200'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${cfg.showJadual ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-gray-600">
                {cfg.showJadual ? 'Jadual Acara dipapar di halaman awam' : 'Jadual Acara disembunyikan'}
              </span>
            </label>
          </div>

          {/* 6. Pengumuman */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <SectionTitle title="Pengumuman" desc="Banner mesej khas di bawah hero" />
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer"
                onClick={() => set('isPengumumanAktif', !cfg.isPengumumanAktif)}>
                <div className={`relative w-10 h-5 rounded-full transition-colors ${cfg.isPengumumanAktif ? 'bg-[#003399]' : 'bg-gray-200'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${cfg.isPengumumanAktif ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-sm text-gray-600">
                  {cfg.isPengumumanAktif ? 'Pengumuman aktif' : 'Pengumuman tidak aktif'}
                </span>
              </label>
              <Field label="Teks Pengumuman">
                <textarea className={inputCls + ' resize-none'} rows={3}
                  value={cfg.pengumuman} onChange={e => set('pengumuman', e.target.value)}
                  placeholder="cth: Pendaftaran atlet dibuka sehingga 15 April 2026." />
              </Field>
            </div>
          </div>

          {/* 7. Pautan Kumpulan */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <SectionTitle title="Pautan Kumpulan"
              desc="Butang WhatsApp / Telegram dipapar di halaman utama sebelum login" />
            <div className="space-y-3">
              <Field label="Pautan WhatsApp" hint="Kosongkan jika tidak mahu papar butang WhatsApp">
                <input className={inputCls} value={cfg.linkWasap || ''}
                  onChange={e => set('linkWasap', e.target.value)}
                  placeholder="https://chat.whatsapp.com/..." />
              </Field>
              <Field label="Pautan Telegram" hint="Kosongkan jika tidak mahu papar butang Telegram">
                <input className={inputCls} value={cfg.linkTelegram || ''}
                  onChange={e => set('linkTelegram', e.target.value)}
                  placeholder="https://t.me/..." />
              </Field>
            </div>
          </div>

          {/* 8. Dokumen Muat Turun */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <SectionTitle title="Dokumen Muat Turun"
              desc="Dipapar sebagai butang di Dashboard selepas login. Boleh tambah berapa banyak pautan." />
            <div className="space-y-2 mb-3">
              {(cfg.dokumenMuatTurun || []).map((dok, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input className={inputCls} value={dok.nama}
                    onChange={e => {
                      const arr = [...(cfg.dokumenMuatTurun || [])]
                      arr[i] = { ...arr[i], nama: e.target.value }
                      set('dokumenMuatTurun', arr)
                    }}
                    placeholder="Nama dokumen (cth: Peraturan Pertandingan)" />
                  <input className={inputCls} value={dok.url}
                    onChange={e => {
                      const arr = [...(cfg.dokumenMuatTurun || [])]
                      arr[i] = { ...arr[i], url: e.target.value }
                      set('dokumenMuatTurun', arr)
                    }}
                    placeholder="URL pautan" />
                  <button type="button"
                    onClick={() => set('dokumenMuatTurun', (cfg.dokumenMuatTurun || []).filter((_, j) => j !== i))}
                    className="shrink-0 text-red-400 hover:text-red-600 px-2 py-1 text-lg leading-none transition-colors">
                    ×
                  </button>
                </div>
              ))}
              {(cfg.dokumenMuatTurun || []).length === 0 && (
                <p className="text-[11px] text-gray-400 italic">Tiada dokumen lagi. Klik tambah di bawah.</p>
              )}
            </div>
            <button type="button"
              onClick={() => set('dokumenMuatTurun', [...(cfg.dokumenMuatTurun || []), { nama: '', url: '' }])}
              className="text-xs font-semibold text-[#003399] hover:underline flex items-center gap-1">
              + Tambah Dokumen
            </button>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy}
              className="px-6 py-2.5 bg-[#003399] hover:bg-[#002277] disabled:bg-gray-300 text-white text-sm font-bold rounded-lg transition-colors">
              {busy ? 'Menyimpan…' : 'Simpan Tetapan'}
            </button>
            <button type="button" onClick={() => { if (confirm('Reset semua ke nilai asal?')) { setCfg(TETAPAN_DEFAULTS); setSaved(false) } }}
              className="px-4 py-2.5 border border-gray-200 text-sm text-gray-500 rounded-lg hover:bg-gray-50 transition-colors">
              Reset
            </button>
            {saved && <span className="text-xs text-green-600 font-semibold">✓ Tersimpan</span>}
          </div>
        </form>

        {/* ── Preview ── */}
        <div className="lg:sticky lg:top-6 space-y-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pratonton</p>
          <HomePreview cfg={cfg} />
          <p className="text-[10px] text-gray-400 leading-relaxed">
            Perubahan nampak di <strong>/</strong> selepas disimpan. Tiada perlu deploy semula.
          </p>
        </div>
      </div>
    </div>
  )
}
