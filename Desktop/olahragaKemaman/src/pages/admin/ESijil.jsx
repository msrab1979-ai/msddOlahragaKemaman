/**
 * ESijil — /dashboard/esijil
 * Admin: muat naik template PNG, seret teks ke kedudukan, simpan ke tetapan/sijil
 */

import { useState, useEffect, useRef } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import jsPDF from 'jspdf'

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELDS = [
  { key: 'nama',      label: 'Nama Atlet',        color: '#2563eb', dummy: 'AHMAD BIN ABU BAKAR' },
  { key: 'kejohanan', label: 'Nama Kejohanan',     color: '#16a34a' },
  { key: 'tarikh',    label: 'Tarikh Kejohanan',   color: '#dc2626' },
]

const DEFAULT_STYLE = { size: 24, warna: '#000000', bold: true, align: 'center' }
const DEFAULT_POS   = {
  nama:      { x: 50, y: 55 },
  kejohanan: { x: 50, y: 65 },
  tarikh:    { x: 50, y: 72 },
}

const inputCls = 'border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none ' +
  'focus:ring-1 focus:ring-[#003399] focus:border-[#003399] bg-white'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function kompresGambar(dataUrl) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1400
      let w = img.width, h = img.height
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.src = dataUrl
  })
}

function SectionTitle({ n, title, desc }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <span className="w-6 h-6 rounded-full bg-[#003399] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </span>
      <div>
        <p className="text-xs font-bold text-gray-800">{title}</p>
        {desc && <p className="text-[11px] text-gray-400 mt-0.5">{desc}</p>}
      </div>
    </div>
  )
}

function StylePanel({ label, style, onChange }) {
  function set(k, v) { onChange({ ...style, [k]: v }) }
  return (
    <div className="border border-gray-100 rounded-lg p-3 bg-gray-50">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2.5">{label}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <p className="text-[10px] text-gray-500 mb-1">Saiz Font (pt)</p>
          <input type="number" min="8" max="80" value={style.size}
            onChange={e => set('size', +e.target.value)}
            className={inputCls + ' w-full'} />
        </div>
        <div>
          <p className="text-[10px] text-gray-500 mb-1">Warna</p>
          <input type="color" value={style.warna}
            onChange={e => set('warna', e.target.value)}
            className="w-full h-[30px] rounded border border-gray-200 cursor-pointer" />
        </div>
        <div>
          <p className="text-[10px] text-gray-500 mb-1">Penjajaran</p>
          <select value={style.align} onChange={e => set('align', e.target.value)}
            className={inputCls + ' w-full'}>
            <option value="left">Kiri</option>
            <option value="center">Tengah</option>
            <option value="right">Kanan</option>
          </select>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 mb-1">Tebal</p>
          <button
            onClick={() => set('bold', !style.bold)}
            className={`w-full py-1.5 rounded text-xs font-bold border transition-colors ${
              style.bold
                ? 'bg-[#003399] text-white border-[#003399]'
                : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            {style.bold ? 'Ya' : 'Tidak'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── DraggableLabel ────────────────────────────────────────────────────────────

function DraggableLabel({ fieldCfg, pos, style, sampleText, containerRef, onPosChange }) {
  const [dragging, setDragging] = useState(false)
  const start = useRef(null)

  function onMouseDown(e) {
    e.preventDefault()
    const cont = containerRef.current
    if (!cont) return
    const rect = cont.getBoundingClientRect()
    start.current = {
      mx: e.clientX, my: e.clientY,
      sx: pos.x,     sy: pos.y,
      rw: rect.width, rh: rect.height,
    }
    setDragging(true)
  }

  // Touch support
  function onTouchStart(e) {
    const t = e.touches[0]
    const cont = containerRef.current
    if (!cont) return
    const rect = cont.getBoundingClientRect()
    start.current = {
      mx: t.clientX, my: t.clientY,
      sx: pos.x,     sy: pos.y,
      rw: rect.width, rh: rect.height,
    }
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging) return

    function move(clientX, clientY) {
      if (!start.current) return
      const { mx, my, sx, sy, rw, rh } = start.current
      const nx = Math.max(0, Math.min(100, sx + (clientX - mx) / rw * 100))
      const ny = Math.max(0, Math.min(100, sy + (clientY - my) / rh * 100))
      onPosChange({ x: +nx.toFixed(2), y: +ny.toFixed(2) })
    }

    function onMouseMove(e) { move(e.clientX, e.clientY) }
    function onTouchMove(e) { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY) }
    function onUp() { setDragging(false) }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [dragging])

  // Scale font: PDF A4 portrait ≈ 595pt wide, preview ≈ 320px → scale ~0.45
  const previewSize = Math.max(8, (style.size || 24) * 0.45)
  const translateX  = style.align === 'center' ? '-50%'
                    : style.align === 'right'  ? '-100%' : '0%'

  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      style={{
        position:   'absolute',
        left:       `${pos.x}%`,
        top:        `${pos.y}%`,
        transform:  `translateX(${translateX}) translateY(-50%)`,
        cursor:     dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        fontSize:   `${previewSize}px`,
        fontWeight: style.bold ? 'bold' : 'normal',
        color:      style.warna || '#000000',
        textAlign:  style.align || 'center',
        whiteSpace: 'nowrap',
        background: 'rgba(255,255,255,0.78)',
        border:     `2px solid ${fieldCfg.color}`,
        borderRadius: '3px',
        padding:    '1px 6px',
        boxShadow:  dragging
          ? `0 4px 16px rgba(0,0,0,0.25), 0 0 0 3px ${fieldCfg.color}40`
          : '0 1px 4px rgba(0,0,0,0.18)',
        zIndex:     dragging ? 20 : 10,
        transition: dragging ? 'none' : 'box-shadow 0.15s',
      }}
    >
      {sampleText}
      {/* Drag handle dot */}
      <span style={{
        position: 'absolute', top: -5, right: -5,
        width: 10, height: 10, borderRadius: '50%',
        background: fieldCfg.color, border: '2px solid white',
      }} />
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ESijil() {
  const [template, setTemplate]           = useState(null)
  const [namaKejohanan, setNamaKejohanan] = useState('')
  const [tarikhKejohanan, setTarikh]      = useState('')
  const [positions, setPositions]         = useState({ ...DEFAULT_POS })
  const [styleNama, setStyleNama]         = useState({ ...DEFAULT_STYLE })
  const [styleKej, setStyleKej]           = useState({ ...DEFAULT_STYLE, size: 16 })
  const [styleTarikh, setStyleTarikh]     = useState({ ...DEFAULT_STYLE, size: 14 })
  const [saving, setSaving]               = useState(false)
  const [msg, setMsg]                     = useState('')
  const [uploading, setUploading]         = useState(false)
  const containerRef                      = useRef(null)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'tetapan', 'sijil'))
        if (!snap.exists()) return
        const d = snap.data()
        if (d.templateImg)      setTemplate(d.templateImg)
        if (d.namaKejohanan)    setNamaKejohanan(d.namaKejohanan)
        if (d.tarikhKejohanan)  setTarikh(d.tarikhKejohanan)
        if (d.posNama || d.posKejohanan || d.posTarikh)
          setPositions({
            nama:      d.posNama      || DEFAULT_POS.nama,
            kejohanan: d.posKejohanan || DEFAULT_POS.kejohanan,
            tarikh:    d.posTarikh    || DEFAULT_POS.tarikh,
          })
        if (d.styleNama)      setStyleNama({ ...DEFAULT_STYLE, ...d.styleNama })
        if (d.styleKejohanan) setStyleKej({ ...DEFAULT_STYLE, size: 16, ...d.styleKejohanan })
        if (d.styleTarikh)    setStyleTarikh({ ...DEFAULT_STYLE, size: 14, ...d.styleTarikh })
      } catch {}
    }
    load()
  }, [])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async ev => {
      const compressed = await kompresGambar(ev.target.result)
      setTemplate(compressed)
      setPositions({ ...DEFAULT_POS })
      setUploading(false)
    }
    reader.readAsDataURL(file)
  }

  function setPos(key, val) {
    setPositions(prev => ({ ...prev, [key]: val }))
  }

  async function handleSave() {
    if (!template) { setMsg('Sila muat naik template dahulu.'); return }
    setSaving(true); setMsg('')
    try {
      await setDoc(doc(db, 'tetapan', 'sijil'), {
        templateImg:      template,
        namaKejohanan,
        tarikhKejohanan,
        posNama:          positions.nama,
        posKejohanan:     positions.kejohanan,
        posTarikh:        positions.tarikh,
        styleNama,
        styleKejohanan:   styleKej,
        styleTarikh,
        updatedAt:        serverTimestamp(),
      })
      setMsg('Tetapan berjaya disimpan.')
    } catch (err) {
      setMsg('Ralat: ' + err.message)
    }
    setSaving(false)
  }

  function handlePreview() {
    if (!template) { setMsg('Sila muat naik template dahulu.'); return }
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210, H = 297
    pdf.addImage(template, 'JPEG', 0, 0, W, H)

    function lukis(teks, pos, style) {
      if (!pos || !teks) return
      pdf.setFontSize(style.size || 24)
      pdf.setTextColor(style.warna || '#000000')
      pdf.setFont('helvetica', style.bold ? 'bold' : 'normal')
      pdf.text(teks, pos.x * W / 100, pos.y * H / 100, { align: style.align || 'center' })
    }

    lukis('AHMAD BIN ABU BAKAR', positions.nama, styleNama)
    lukis(namaKejohanan || 'Nama Kejohanan Belum Ditetapkan', positions.kejohanan, styleKej)
    lukis(tarikhKejohanan || '15 Jun 2025', positions.tarikh, styleTarikh)
    pdf.output('dataurlnewwindow')
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-base font-bold text-gray-800">E-Sijil Penyertaan</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Tetapkan template sijil dan kedudukan teks. Pengurus pasukan boleh muat turun sijil atlet selepas ini.
        </p>
      </div>

      <div className="space-y-5">

        {/* ── 1: Upload Template ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <SectionTitle n="1" title="Muat Naik Template Sijil"
            desc="Format PNG / JPG. Reka bentuk di Canva, export PNG, muat naik di sini." />
          <div className="flex items-center gap-3">
            <label className="cursor-pointer">
              <div className="flex items-center gap-2 px-4 py-2 bg-[#003399] text-white rounded-lg text-xs font-semibold hover:bg-[#002288] transition-colors">
                {uploading
                  ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                }
                {uploading ? 'Memproses...' : template ? 'Tukar Template' : 'Muat Naik Template'}
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
            {template && (
              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                Template dimuat naik
              </span>
            )}
          </div>
        </div>

        {/* ── 2: Teks Tetap ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <SectionTitle n="2" title="Teks Nama Kejohanan &amp; Tarikh"
            desc="Teks ini sama untuk semua sijil. Taip tepat seperti yang dikehendaki." />
          <div className="space-y-3 max-w-xl">
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Nama Kejohanan</p>
              <input
                type="text"
                value={namaKejohanan}
                onChange={e => setNamaKejohanan(e.target.value)}
                placeholder="Contoh: Kejohanan Olahraga Antara Murid MSSD Kemaman 2025"
                className={inputCls + ' w-full'}
              />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Tarikh Kejohanan</p>
              <input
                type="text"
                value={tarikhKejohanan}
                onChange={e => setTarikh(e.target.value)}
                placeholder="Contoh: 15 Jun 2025 atau 15 - 17 Jun 2025"
                className={inputCls + ' w-full'}
              />
            </div>
          </div>
        </div>

        {/* ── 3: Drag & Drop Kedudukan ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <SectionTitle n="3" title="Tetapkan Kedudukan Teks"
            desc="Seret teks pada template ke kedudukan yang dikehendaki. Teks biru = Nama Atlet. Teks hijau = Nama Kejohanan." />

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mb-3">
            {FIELDS.map(f => (
              <div key={f.key} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm border-2" style={{ borderColor: f.color, background: f.color + '20' }} />
                <span className="text-[11px] text-gray-600 font-medium">{f.label}</span>
                <span className="text-[10px] text-gray-400">
                  — seret label atas template
                </span>
              </div>
            ))}
          </div>

          {template ? (
            <div
              ref={containerRef}
              className="relative inline-block w-full max-w-xs select-none"
              style={{ touchAction: 'none' }}
            >
              <img
                src={template}
                alt="Template Sijil"
                className="w-full rounded-lg border-2 border-gray-200 block"
                draggable={false}
              />

              {/* Draggable: Nama Atlet */}
              <DraggableLabel
                fieldCfg={FIELDS[0]}
                pos={positions.nama}
                style={styleNama}
                sampleText={FIELDS[0].dummy}
                containerRef={containerRef}
                onPosChange={val => setPos('nama', val)}
              />

              {/* Draggable: Nama Kejohanan */}
              <DraggableLabel
                fieldCfg={FIELDS[1]}
                pos={positions.kejohanan}
                style={styleKej}
                sampleText={namaKejohanan || FIELDS[1].label}
                containerRef={containerRef}
                onPosChange={val => setPos('kejohanan', val)}
              />

              {/* Draggable: Tarikh Kejohanan */}
              <DraggableLabel
                fieldCfg={FIELDS[2]}
                pos={positions.tarikh}
                style={styleTarikh}
                sampleText={tarikhKejohanan || FIELDS[2].label}
                containerRef={containerRef}
                onPosChange={val => setPos('tarikh', val)}
              />
            </div>
          ) : (
            <div className="w-full max-w-xs aspect-[210/297] bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center">
              <p className="text-xs text-gray-400">Muat naik template dahulu</p>
            </div>
          )}

          {/* Koordinat semasa */}
          {template && (
            <div className="mt-3 flex flex-wrap gap-3">
              {FIELDS.map(f => (
                <div key={f.key} className="text-[10px] text-gray-400">
                  <span className="font-semibold" style={{ color: f.color }}>{f.label}:</span>{' '}
                  x={positions[f.key]?.x.toFixed(1)}%, y={positions[f.key]?.y.toFixed(1)}%
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 4: Gaya Teks ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <SectionTitle n="4" title="Gaya Teks"
            desc="Saiz, warna dan penjajaran teks. Perubahan akan kelihatan pada label dalam preview di atas." />
          <div className="space-y-3">
            <StylePanel label="Nama Atlet"        style={styleNama}   onChange={setStyleNama}   />
            <StylePanel label="Nama Kejohanan"    style={styleKej}    onChange={setStyleKej}    />
            <StylePanel label="Tarikh Kejohanan"  style={styleTarikh} onChange={setStyleTarikh} />
          </div>
        </div>

        {/* ── 5: Preview & Simpan ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <SectionTitle n="5" title="Preview & Simpan"
            desc="Preview buka PDF dengan data contoh. Guna untuk semak kedudukan tepat sebelum simpan." />
          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={handlePreview}
              disabled={!template}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
              </svg>
              Preview PDF
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !template}
              className="flex items-center gap-2 px-5 py-2 bg-[#003399] text-white rounded-lg text-xs font-semibold hover:bg-[#002288] transition-colors disabled:opacity-50"
            >
              {saving
                ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
              }
              {saving ? 'Menyimpan...' : 'Simpan Tetapan'}
            </button>
            {msg && (
              <span className={`text-xs font-medium ${msg.startsWith('Ralat') ? 'text-red-500' : 'text-green-600'}`}>
                {msg}
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
