/**
 * InputKeputusan — /dashboard/keputusan
 *
 * Flow: Home (Jadual hari ini | Search No.Acara | Accordion kategori)
 *       → Pilih Heat → Input Keputusan → Simpan
 *
 * Model A: Pencatat & Superadmin boleh edit. Admin = baca sahaja.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  collection, getDocs, getDoc, doc, updateDoc, setDoc, deleteField,
  query, orderBy, where, serverTimestamp, Timestamp, onSnapshot, runTransaction, increment,
} from 'firebase/firestore'
import { selectFinalists as _selectFinalists, assignLorong as _assignLorong, getFinalistSetup as _getFinalistSetup } from '../../utils/finalistUtils'
import { runPostRasmi } from '../../utils/postRasmiUtils'
import { cariRekodUntukAcara, formatPrestasiRekod, tahunRekod, rekodKey as buildRekodKey } from '../../utils/rekodUtils'
import {
  buatStartListPDFUnified, assignLorongFinal, detectJenisLorong,
  WA_LORONG_KUMPULAN_DEFAULT, deserializeKumpulan, katLabel as _katLabel,
} from '../../utils/startListPdfUtils'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Constants ────────────────────────────────────────────────────────────────

const inputCls = 'w-full border-2 border-gray-200 rounded-xl px-4 py-3.5 text-base font-mono focus:outline-none focus:border-[#003399] bg-white transition-colors text-center text-gray-800 placeholder-gray-300'

const JENIS_LABEL = {
  lorong:        'Larian Lorong',
  mass_start:    'Mass Start',
  padang_lompat: 'Padang Lompat',
  padang_balin:  'Padang Balin',
  relay:         'Relay',
}

const KAT_ORDER = ['SR', 'SM', 'PPKI']

// Standard athletics lane assignment: rank1→lane4, rank2→lane5, rank3→lane3, ...
const LANE_ORDER = [4, 5, 3, 6, 2, 7, 1, 8]

// ─── Select Finalists ─────────────────────────────────────────────────────────

// selectFinalists + assignLorong diimport dari finalistUtils — guna finalSetup dari state

// ─── Heat status dots ─────────────────────────────────────────────────────────

function HeatDots({ total, rasmi, draf }) {
  if (!total) return <span className="text-[10px] text-gray-300">—</span>
  return (
    <span className="flex gap-0.5 items-center">
      {Array.from({ length: total }, (_, i) => {
        const cls = i < rasmi
          ? 'bg-green-500'
          : i < rasmi + draf
            ? 'bg-amber-400'
            : 'bg-gray-200'
        return <span key={i} className={`w-2 h-2 rounded-full ${cls}`} />
      })}
    </span>
  )
}

// ─── Jadual masa warna ────────────────────────────────────────────────────────

function jadualMasaInfo(masaMula, nowMs) {
  if (!masaMula) return null
  const [h, m] = masaMula.split(':').map(Number)
  const now = new Date(nowMs)
  const startMs = new Date(now).setHours(h, m, 0, 0)
  const diffMin = (startMs - nowMs) / 60000
  if (nowMs > startMs + 90 * 60000) return { label: masaMula, cls: 'text-gray-300' }
  if (nowMs > startMs) return { label: `${masaMula} ● SEDANG`, cls: 'text-orange-500 font-bold animate-pulse' }
  if (diffMin <= 30) return { label: `${masaMula} ↑ ${Math.ceil(diffMin)}min lagi`, cls: 'text-amber-500 font-semibold' }
  return { label: masaMula, cls: 'text-[#003399]' }
}

// ─── Acara card (home screen) ─────────────────────────────────────────────────

function AcaraCard({ acara, masa, nowMs, onClick }) {
  const masaInfo  = masa ? jadualMasaInfo(masa, nowMs || Date.now()) : null
  const selesai   = acara._rasmiHeat || 0
  const draf      = acara._drafHeat  || 0
  const total     = acara._totalHeat || 0
  const allDone   = total > 0 && selesai === total
  const anyDone   = selesai > 0
  const anyDraf   = draf > 0

  const accent = allDone ? 'bg-green-500' : anyDone ? 'bg-green-400' : anyDraf ? 'bg-amber-400' : total > 0 ? 'bg-gray-200' : 'bg-transparent'

  const badge = allDone
    ? { text: `✓ Selesai`, cls: 'bg-green-500 text-white' }
    : anyDone
    ? { text: `✓ ${selesai}/${total} Heat`, cls: 'bg-green-100 text-green-700' }
    : anyDraf
    ? { text: `⏳ ${draf} Draf`, cls: 'bg-amber-100 text-amber-700' }
    : total > 0
    ? { text: `${total} heat · Belum`, cls: 'bg-gray-100 text-gray-400' }
    : null

  return (
    <button onClick={onClick}
      className={`w-full text-left border rounded-2xl shadow-sm hover:shadow-md transition-all active:scale-[0.98] overflow-hidden ${
        allDone ? 'bg-green-50/60 border-green-200' : 'bg-white border-gray-100'
      }`}>
      <div className="flex">
        {/* Left accent bar */}
        <div className={`w-1.5 shrink-0 ${accent}`} />

        <div className="flex-1 px-3.5 py-3">
          <div className="flex items-start gap-3">
            {/* No. Acara */}
            <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5 ${
              allDone ? 'bg-green-100' : 'bg-[#003399]/8'
            }`}>
              {allDone
                ? <span className="text-base text-green-600">✓</span>
                : <span className="text-[11px] font-black text-[#003399]">{acara.noAcara ?? '—'}</span>
              }
            </div>

            {/* Nama + info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`text-sm font-bold leading-tight ${allDone ? 'text-gray-400' : 'text-gray-800'}`}>
                  {acara.namaAcara}
                  {allDone && <span className="ml-1.5 text-[9px] font-black text-green-600 uppercase tracking-wide">Siap</span>}
                </p>
                {badge && !allDone && (
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full leading-none ${badge.cls}`}>
                    {badge.text}
                  </span>
                )}
              </div>
              <p className={`text-[11px] mt-0.5 ${allDone ? 'text-gray-300' : 'text-gray-400'}`}>
                {acara.jantina === 'L' ? 'Lelaki' : acara.jantina === 'P' ? 'Perempuan' : acara.jantina}
                {' · '}{acara.kategoriKod || acara.kategori}
                {' · '}{JENIS_LABEL[acara.jenisAcara] || acara.jenisAcara}
              </p>
              {masaInfo && !allDone && (
                <p className={`text-[10px] mt-0.5 ${masaInfo.cls}`}>{masaInfo.label}</p>
              )}
            </div>

            {/* Heat dots */}
            <div className="shrink-0 pt-1">
              <HeatDots total={total} rasmi={selesai} draf={draf} />
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Acara row (flat table row for home screen) ───────────────────────────────

function AcaraRow({ acara, masa, nowMs, isLast, jenisRound, onClick }) {
  const masaInfo = masa ? jadualMasaInfo(masa, nowMs || Date.now()) : null

  const selesai  = acara._rasmiHeat || 0
  const draf     = acara._drafHeat  || 0
  const total    = acara._totalHeat || 0
  const allDone  = total > 0 && selesai === total
  const anyDone  = selesai > 0

  const borderCls = allDone ? 'border-l-green-500'
    : anyDone ? 'border-l-green-400'
    : draf > 0 ? 'border-l-amber-400'
    : total > 0 ? 'border-l-gray-200'
    : 'border-l-transparent'

  const badge = allDone
    ? { text: '✓ Siap', cls: 'bg-green-500 text-white' }
    : anyDone
    ? { text: `✓ ${selesai}/${total}`, cls: 'bg-green-100 text-green-700' }
    : draf > 0
    ? { text: '⏳ Draf', cls: 'bg-amber-100 text-amber-700' }
    : total > 0
    ? { text: `${total}H Belum`, cls: 'bg-gray-100 text-gray-400' }
    : { text: 'Belum', cls: 'bg-gray-100 text-gray-400' }

  const jenisBadge = jenisRound === 'saringan'
    ? { text: 'Saringan', cls: 'bg-blue-50 text-blue-600 border border-blue-100' }
    : jenisRound === 'final'
    ? { text: 'Final', cls: 'bg-amber-50 text-amber-600 border border-amber-100' }
    : { text: 'Terus Final', cls: 'bg-purple-50 text-purple-500 border border-purple-100' }

  return (
    <button onClick={onClick}
      className={`w-full text-left border-l-4 ${borderCls} ${!isLast ? 'border-b border-gray-50' : ''} ${
        allDone ? 'bg-green-50/40 hover:bg-green-50/60' : 'hover:bg-blue-50/30'
      } active:bg-blue-50/60 transition-colors`}>
      <div className="grid px-3 py-2.5 items-center gap-1.5"
        style={{ gridTemplateColumns: '36px 44px 1fr 58px 64px' }}>

        {/* No. Acara */}
        <div className="flex items-center justify-center">
          {allDone
            ? <span className="text-sm text-green-500 font-black">✓</span>
            : <span className="text-xs font-black text-[#003399]">{acara.noAcara ?? '—'}</span>
          }
        </div>

        {/* Masa */}
        <div className="flex items-center">
          {masaInfo
            ? <span className={`text-[10px] font-semibold leading-tight ${allDone ? 'text-gray-300' : masaInfo.cls}`}>{masaInfo.label}</span>
            : <span className="text-[10px] text-gray-300">—</span>}
        </div>

        {/* Nama + subtitle */}
        <div className="min-w-0">
          <p className={`text-[11px] font-bold leading-tight truncate ${allDone ? 'text-gray-400' : 'text-gray-800'}`}>
            {acara.namaAcara}
          </p>
          <p className="text-[9px] text-gray-400 leading-tight mt-0.5 truncate">
            {acara.jantina === 'L' ? 'Lelaki' : acara.jantina === 'P' ? 'Perempuan' : (acara.jantina || '')}
            {(acara.kategoriKod || acara.kategori) ? ` · ${acara.kategoriKod || acara.kategori}` : ''}
          </p>
        </div>

        {/* Jenis Round badge */}
        <div className="flex items-center justify-center">
          <span className={`text-[8px] font-bold px-1 py-0.5 rounded whitespace-nowrap ${jenisBadge.cls}`}>
            {jenisBadge.text}
          </span>
        </div>

        {/* Status badge */}
        <div className="flex items-center justify-end">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${badge.cls}`}>
            {badge.text}
          </span>
        </div>
      </div>
    </button>
  )
}

// ─── Accordion section ────────────────────────────────────────────────────────

function AccordionSection({ title, count, open, onToggle, children }) {
  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-700">{title}</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white text-gray-400 border border-gray-200">
            {count} acara
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="p-3 space-y-2 bg-white">{children}</div>}
    </div>
  )
}

// ─── Heat Selector ────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  rasmi:          { label: 'Rasmi',    cls: 'bg-green-100 text-green-700' },
  tidak_rasmi:    { label: 'Draf',     cls: 'bg-amber-100 text-amber-700' },
  dalam_bantahan: { label: 'Bantahan', cls: 'bg-red-100 text-red-700' },
}

function HeatSelector({ heats, selectedHeat, onSelect }) {
  if (!heats.length) return (
    <p className="text-xs text-gray-400 text-center py-6">Tiada heat untuk acara ini.</p>
  )
  return (
    <div className="grid grid-cols-2 gap-2">
      {heats.map(h => {
        const badge = STATUS_BADGE[h.statusKeputusan]
        return (
          <button key={h.heatId} onClick={() => onSelect(h)}
            className={`py-3 px-4 rounded-xl border-2 text-left transition-colors ${
              selectedHeat?.heatId === h.heatId
                ? 'border-[#003399] bg-[#003399]/5'
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}>
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <p className="text-sm font-bold text-gray-800">Heat {h.noHeat}</p>
              {badge && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${badge.cls}`}>
                  {badge.label}
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-400 capitalize">
              {h.peringkat || '—'}
            </p>
          </button>
        )
      })}
    </div>
  )
}

// ─── Heat Tab Bar (tukar heat tanpa navigate) ─────────────────────────────────

function HeatTabBar({ heats, selectedHeat, onSelect }) {
  if (!heats || heats.length <= 1) return null
  const hasSaringanHeat = heats.some(h => h.fasa === 'heat')
  return (
    <div className="flex gap-1.5 overflow-x-auto py-0.5">
      {heats.map(h => {
        const isSelected  = selectedHeat?.heatId === h.heatId
        // fasa='final' = sama ada final selepas saringan, atau terus_final (1 heat sahaja)
        const isFinalHeat = h.fasa === 'final'
        const fasaLabel   = isFinalHeat
          ? (hasSaringanHeat ? 'FINAL' : 'TERUS FINAL')
          : `Heat ${h.noHeat}`
        const dotCls = ['rasmi', 'diterima'].includes(h.statusKeputusan)
          ? 'bg-green-400'
          : h.statusKeputusan === 'tidak_rasmi' ? 'bg-amber-400'
          : h.statusKeputusan === 'dalam_bantahan' ? 'bg-red-400'
          : 'bg-gray-300'
        return (
          <button key={h.heatId} onClick={() => onSelect(h)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
              isFinalHeat
                ? isSelected
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-amber-50 border border-amber-300 text-amber-700 hover:border-amber-400'
                : isSelected
                  ? 'bg-[#003399] text-white shadow-sm'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-[#003399]/30 hover:text-[#003399]'
            }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-white/60' : dotCls}`} />
            <span className={isFinalHeat ? 'font-black tracking-wide' : ''}>{fasaLabel}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Input sub-components ─────────────────────────────────────────────────────

// Auto-kira kedudukan dari masa (lorong/relay/mass_start)
function kiraLaranRank(slots, keputusan) {
  const rows = slots.map(slot => {
    const kp = keputusan[slot] || {}
    const flagged = ['DNS', 'DNF', 'DQ'].includes(kp.status)
    const masa = flagged ? null : (Number(kp.keputusan) || null)
    return { slot, masa, flagged }
  })
  const sorted = [...rows].sort((a, b) => {
    if (a.masa !== null && b.masa !== null) return a.masa - b.masa
    if (a.masa !== null) return -1
    if (b.masa !== null) return 1
    return 0
  })
  const rankMap = {}
  let rank = 1
  sorted.forEach((r, i) => {
    if (r.masa === null) { rankMap[r.slot] = null; return }
    if (i > 0 && sorted[i - 1].masa === r.masa) {
      rankMap[r.slot] = rankMap[sorted[i - 1].slot]
    } else {
      rankMap[r.slot] = rank
    }
    rank++
  })
  return rankMap
}

function formatMasa(val) {
  if (!val && val !== 0) return ''
  const n = Number(val)
  if (isNaN(n) || n === 0) return ''
  const m = Math.floor(n / 60)
  const s = (n % 60).toFixed(2).padStart(5, '0')
  return m > 0 ? `${m}:${s}` : `${Number(s).toFixed(2)}`
}

function InputLorong({ heat, acara, keputusan, onChange, onWind, windSpeed, sekolahMap = {}, finalisBibs = new Set(), finalisQMap = new Map() }) {
  const bilLorong   = acara.bilanganLorong || heat.bilanganLorong || 8
  const isWind      = acara.isWindReading || false
  const slots       = Array.from({ length: bilLorong }, (_, i) => i + 1)
  const rankMap     = kiraLaranRank(slots, keputusan)

  return (
    <div className="space-y-3">
      {/* Angin */}
      {isWind && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
          <span className="text-xs font-bold text-blue-700 shrink-0">Angin (m/s)</span>
          <input type="number" step="0.1" min="-9.9" max="9.9"
            value={windSpeed ?? ''}
            onChange={e => onWind(e.target.value)}
            placeholder="+1.2"
            className="flex-1 border border-blue-200 rounded-lg px-3 py-1.5 text-sm font-mono text-center focus:outline-none focus:border-blue-400 bg-white" />
          {windSpeed !== '' && windSpeed !== null && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              Math.abs(Number(windSpeed)) <= 2
                ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {Math.abs(Number(windSpeed)) <= 2 ? 'SAH' : 'TIDAK SAH'}
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="grid bg-[#003399] text-white text-[10px] font-bold uppercase tracking-wider"
          style={{ gridTemplateColumns: '36px 72px 1fr 72px 52px 90px' }}>
          <div className="px-2 py-2.5 text-center">Lrg</div>
          <div className="px-2 py-2.5 text-center">No BIB</div>
          <div className="px-2 py-2.5">Atlet / Sekolah</div>
          <div className="px-2 py-2.5 text-center">Masa (s)</div>
          <div className="px-2 py-2.5 text-center">Kddk</div>
          <div className="px-2 py-2.5 text-center">Catatan</div>
        </div>

        {/* Rows */}
        {slots.map((lorong, idx) => {
          const kp      = keputusan[lorong] || {}
          // Lorong kosong = tiada peserta berdaftar dalam lorong ini
          const isKosong = !kp.namaAtlet && !kp.noBib && !kp.kodSekolah && !kp.keputusan && !kp.status

          if (isKosong) {
            return (
              <div key={lorong} className="grid border-t border-gray-100 bg-gray-50"
                style={{ gridTemplateColumns: '36px 72px 1fr 72px 52px 90px' }}>
                <div className="px-1 py-3 flex items-center justify-center">
                  <span className="text-[10px] font-black text-gray-300">{lorong}</span>
                </div>
                <div className="col-span-5 px-3 flex items-center">
                  <span className="text-[10px] text-gray-300 italic">— Lorong kosong —</span>
                </div>
              </div>
            )
          }

          const rank    = rankMap[lorong]
          const flagged = ['DNS', 'DNF', 'DQ'].includes(kp.status)
          const rowBg  = flagged ? 'bg-red-50' :
                         rank === 1 ? 'bg-yellow-50' :
                         rank === 2 ? 'bg-gray-50' :
                         rank === 3 ? 'bg-orange-50' :
                         idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
          // Kedudukan yg telah dipilih oleh lorong lain — sembunyikan dari dropdown ini
          const usedByOthers = new Set(
            slots.filter(s => s !== lorong)
              .map(s => keputusan[s]?.kedudukan)
              .filter(v => v !== '' && v != null)
          )

          return (
            <div key={lorong}
              className={`grid border-t border-gray-100 ${rowBg}`}
              style={{ gridTemplateColumns: '36px 72px 1fr 72px 52px 90px' }}>

              {/* Lorong */}
              <div className="px-1 py-2 flex items-center justify-center">
                <span className="text-xs font-black text-gray-500">{lorong}</span>
              </div>

              {/* No BIB — read only */}
              <div className="px-1 py-1.5 flex items-center">
                <input type="text"
                  value={kp.noBib || ''}
                  readOnly
                  className="w-full border border-gray-100 rounded-lg px-1.5 py-1.5 text-[11px] font-mono text-center bg-gray-50 text-gray-500 cursor-default select-none" />
              </div>

              {/* Atlet + Sekolah */}
              <div className="px-2 py-1.5 flex flex-col justify-center min-w-0">
                <div className="flex items-center gap-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-700 truncate leading-tight">
                    {kp.namaAtlet || '—'}</p>
                  {kp.noBib && finalisQMap.has(kp.noBib) && (
                    <span className={`shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded leading-none text-white ${finalisQMap.get(kp.noBib) === 'Q' ? 'bg-green-600' : 'bg-sky-500'}`}>
                      {finalisQMap.get(kp.noBib)}
                    </span>
                  )}
                </div>
                <p className="text-[9px] text-gray-400 truncate leading-tight">
                  {(kp.kodSekolah && (sekolahMap[kp.kodSekolah] || kp.kodSekolah)) || ''}
                </p>
              </div>

              {/* Masa */}
              <div className="px-1 py-1.5 flex items-center">
                <input type="number" step="0.01" min="0"
                  value={kp.keputusan ?? ''}
                  onChange={e => onChange(lorong, 'keputusan', e.target.value)}
                  placeholder="0.00"
                  disabled={flagged}
                  className="w-full border border-gray-200 rounded-lg px-1 py-1.5 text-[11px] font-mono text-center focus:outline-none focus:border-[#003399] bg-white disabled:bg-gray-100 disabled:text-gray-300" />
              </div>

              {/* Kedudukan */}
              <div className="px-1 py-1.5 flex items-center justify-center">
                {flagged ? (
                  <span className="text-[10px] font-bold text-red-400">—</span>
                ) : (
                  <select
                    value={kp.kedudukan ?? ''}
                    onChange={e => onChange(lorong, 'kedudukan', e.target.value !== '' ? Number(e.target.value) : '')}
                    className="w-full border border-gray-200 rounded-lg px-0.5 py-1 text-[11px] font-mono text-center focus:outline-none focus:border-[#003399] bg-white"
                  >
                    <option value="">{rank ? `(${rank})` : '—'}</option>
                    {Array.from({ length: bilLorong }, (_, i) => {
                      const val = i + 1
                      if (usedByOthers.has(val) && kp.kedudukan !== val) return null
                      return <option key={val} value={val}>{val}</option>
                    })}
                  </select>
                )}
              </div>

              {/* Catatan DNS/DNF/DQ */}
              <div className="px-1 py-1.5 flex items-center gap-0.5">
                {['DNS', 'DNF', 'DQ'].map(flag => (
                  <button key={flag} type="button"
                    onClick={() => {
                      const newStatus = kp.status === flag ? '' : flag
                      onChange(lorong, 'status', newStatus)
                      if (newStatus) onChange(lorong, 'keputusan', '')
                    }}
                    className={`flex-1 py-1 text-[9px] font-bold rounded transition-colors ${
                      kp.status === flag
                        ? 'bg-red-500 text-white'
                        : 'bg-white border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-400'
                    }`}>
                    {flag}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InputMassStart({ heat, keputusan, onChange, sekolahMap = {}, finalisBibs = new Set(), finalisQMap = new Map() }) {
  const pesertaArr = heat.peserta || []
  const bilAtlet   = pesertaArr.length || 10
  const slots      = Array.from({ length: bilAtlet }, (_, i) => i + 1)

  // Auto-rank dari masa (masa terkecil = rank 1)
  const rankMap = kiraLaranRank(slots, keputusan)

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="grid bg-[#003399] text-white text-[10px] font-bold uppercase tracking-wider"
        style={{ gridTemplateColumns: '36px 68px 1fr 72px 52px 86px' }}>
        <div className="px-2 py-2.5 text-center">Bil</div>
        <div className="px-2 py-2.5 text-center">No BIB</div>
        <div className="px-2 py-2.5">Atlet / Sekolah</div>
        <div className="px-2 py-2.5 text-center">Masa (s)</div>
        <div className="px-2 py-2.5 text-center">Kddk</div>
        <div className="px-2 py-2.5 text-center">Catatan</div>
      </div>

      {slots.map((slot, idx) => {
        const p       = pesertaArr[idx] || {}
        const kp      = keputusan[slot] || {}
        const rank    = rankMap[slot]
        const flagged = ['DNS', 'DNF', 'DQ'].includes(kp.status)
        const usedByOthers = new Set(
          slots.filter(s => s !== slot).map(s => keputusan[s]?.kedudukan).filter(v => v !== '' && v != null)
        )
        const rowBg = flagged ? 'bg-red-50' :
                      rank === 1 ? 'bg-yellow-50' :
                      rank === 2 ? 'bg-gray-50' :
                      rank === 3 ? 'bg-orange-50' :
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'

        return (
          <div key={slot} className={`grid border-t border-gray-100 ${rowBg}`}
            style={{ gridTemplateColumns: '36px 68px 1fr 72px 52px 86px' }}>

            <div className="px-1 py-2 flex items-center justify-center">
              <span className="text-xs font-black text-gray-500">{slot}</span>
            </div>

            <div className="px-1 py-1.5 flex items-center">
              <input type="text"
                value={kp.noBib || ''}
                readOnly
                className="w-full border border-gray-100 rounded-lg px-1.5 py-1.5 text-[11px] font-mono text-center bg-gray-50 text-gray-500 cursor-default select-none" />
            </div>

            <div className="px-2 py-1.5 flex flex-col justify-center min-w-0">
              <div className="flex items-center gap-1 min-w-0">
                <p className="text-[11px] font-semibold text-gray-700 truncate leading-tight">
                  {kp.namaAtlet || p.namaAtlet || '—'}
                </p>
                {(kp.noBib || p.noBib) && finalisQMap.has(kp.noBib || p.noBib) && (
                  <span className={`shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded leading-none text-white ${finalisQMap.get(kp.noBib || p.noBib) === 'Q' ? 'bg-green-600' : 'bg-sky-500'}`}>
                    {finalisQMap.get(kp.noBib || p.noBib)}
                  </span>
                )}
              </div>
              <p className="text-[9px] text-gray-400 truncate leading-tight">
                {(kp.kodSekolah && (sekolahMap[kp.kodSekolah] || kp.kodSekolah)) ||
                 (p.kodSekolah  && (sekolahMap[p.kodSekolah]  || p.kodSekolah)) || ''}
              </p>
            </div>

            <div className="px-1 py-1.5 flex items-center">
              <input type="number" step="0.01" min="0"
                value={kp.keputusan ?? ''}
                onChange={e => onChange(slot, 'keputusan', e.target.value)}
                placeholder="0.00" disabled={flagged}
                className="w-full border border-gray-200 rounded-lg px-1 py-1.5 text-[11px] font-mono text-center focus:outline-none focus:border-[#003399] bg-white disabled:bg-gray-100 disabled:text-gray-300" />
            </div>

            <div className="px-1 py-1.5 flex items-center justify-center">
              {flagged ? (
                <span className="text-[10px] font-bold text-red-400">—</span>
              ) : (
                <select value={kp.kedudukan ?? ''}
                  onChange={e => onChange(slot, 'kedudukan', e.target.value !== '' ? Number(e.target.value) : '')}
                  className="w-full border border-gray-200 rounded-lg px-0.5 py-1 text-[11px] font-mono text-center focus:outline-none focus:border-[#003399] bg-white">
                  <option value="">{rank ? `(${rank})` : '—'}</option>
                  {slots.map(v => {
                    if (usedByOthers.has(v) && kp.kedudukan !== v) return null
                    return <option key={v} value={v}>{v}</option>
                  })}
                </select>
              )}
            </div>

            <div className="px-1 py-1.5 flex items-center gap-0.5">
              {['DNS', 'DNF', 'DQ'].map(flag => (
                <button key={flag} type="button"
                  onClick={() => {
                    const n = kp.status === flag ? '' : flag
                    onChange(slot, 'status', n)
                    if (n) onChange(slot, 'keputusan', '')
                  }}
                  className={`flex-1 py-1 text-[9px] font-bold rounded transition-colors ${
                    kp.status === flag ? 'bg-red-500 text-white' : 'bg-white border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-400'
                  }`}>{flag}</button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Kira rank live dari keputusan padang
function kiraPadangRank(peserta, keputusan) {
  const rows = peserta.map((p, idx) => {
    const key = p.noBib || idx
    const kp  = keputusan[key] || {}
    const flagged = ['DNS', 'DNF', 'DQ'].includes(kp.status)
    const best = flagged ? null : (Number(kp.keputusan) || null)
    return { key, best, flagged, status: kp.status }
  })

  // Sort: best distance desc, flagged last, null last
  const sorted = [...rows].sort((a, b) => {
    if (a.best !== null && b.best !== null) return b.best - a.best
    if (a.best !== null) return -1
    if (b.best !== null) return 1
    return 0
  })

  // Assign rank dengan tie
  const rankMap = {}
  let rank = 1
  sorted.forEach((r, i) => {
    if (r.best === null) { rankMap[r.key] = null; return }
    if (i > 0 && sorted[i - 1].best === r.best) {
      rankMap[r.key] = rankMap[sorted[i - 1].key]
    } else {
      rankMap[r.key] = rank
    }
    rank++
  })
  return rankMap
}

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }

function RankBadge({ rank }) {
  if (rank === null || rank === undefined) return null
  if (rank <= 3) return (
    <span className="text-base leading-none">{RANK_MEDAL[rank]}</span>
  )
  return (
    <span className="text-xs font-black text-gray-500 w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
      {rank}
    </span>
  )
}

function InputPadang({ acara, peserta, keputusan, onChange, sekolahMap = {} }) {
  const rankMap = kiraPadangRank(peserta, keputusan)
  const bilPes  = peserta.length
  const unit    = acara.jenisAcara === 'padang_balin' ? 'm' : 'm'

  // Live leaderboard
  const board = peserta
    .map((p, idx) => {
      const key = p.noBib || idx
      const kp  = keputusan[key] || {}
      return { key, nama: p.namaAtlet || p.noBib || `#${idx+1}`, best: Number(kp.keputusan) || null, status: kp.status, rank: rankMap[key] }
    })
    .filter(r => r.best !== null || ['DNS','DNF','DQ'].includes(r.status))
    .sort((a, b) => {
      if (a.best !== null && b.best !== null) return b.best - a.best
      if (a.best !== null) return -1; return 1
    })

  return (
    <div className="space-y-3">
      {/* Live leaderboard */}
      {board.length > 0 && (
        <div className="bg-[#003399]/5 rounded-xl p-3 border border-[#003399]/10">
          <p className="text-[9px] font-black text-[#003399] uppercase tracking-widest mb-2">Kedudukan Semasa</p>
          <div className="space-y-1.5">
            {board.map(r => (
              <div key={r.key} className="flex items-center gap-2">
                <div className="w-6 flex justify-center shrink-0"><RankBadge rank={r.rank} /></div>
                <span className="text-xs font-semibold text-gray-700 flex-1 truncate">{r.nama}</span>
                <span className="text-xs font-mono font-bold text-gray-800 shrink-0">
                  {r.best ? `${r.best.toFixed(2)} ${unit}` : <span className="text-red-400">{r.status}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Jadual ringkas: No | Atlet/Sekolah | Jarak | Kddk | DQ/DNS */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="grid bg-[#003399] text-white text-[10px] font-bold uppercase tracking-wider"
          style={{ gridTemplateColumns: '40px 1fr 88px 52px 72px' }}>
          <div className="px-2 py-2.5 text-center">No</div>
          <div className="px-2 py-2.5">Atlet / Sekolah</div>
          <div className="px-2 py-2.5 text-center">Jarak ({unit})</div>
          <div className="px-2 py-2.5 text-center">Kddk</div>
          <div className="px-2 py-2.5 text-center">Catatan</div>
        </div>

        {peserta.map((p, idx) => {
          const key     = p.noBib || idx
          const kp      = keputusan[key] || {}
          const rank    = rankMap[key]
          const isDQ    = kp.status === 'DQ'
          const isDNS   = ['DNS', 'DNF'].includes(kp.status)
          const flagged = isDQ || isDNS
          const usedByOthers = new Set(
            peserta.filter((_, i) => i !== idx)
              .map(pp => keputusan[pp.noBib || i]?.kedudukan)
              .filter(v => v !== '' && v != null)
          )
          const rowBg = flagged ? 'bg-red-50' :
                        rank === 1 ? 'bg-yellow-50' :
                        rank === 2 ? 'bg-gray-50' :
                        rank === 3 ? 'bg-orange-50' :
                        idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'

          return (
            <div key={key} className={`grid border-t border-gray-100 ${rowBg}`}
              style={{ gridTemplateColumns: '40px 1fr 88px 52px 72px' }}>

              {/* No / Rank */}
              <div className="px-1 py-2 flex items-center justify-center">
                <div className="w-6 flex justify-center"><RankBadge rank={rank} /></div>
              </div>

              {/* Atlet + Sekolah */}
              <div className="px-2 py-2 flex flex-col justify-center min-w-0">
                <p className="text-xs font-semibold text-gray-800 truncate leading-tight">{p.namaAtlet || `#${idx+1}`}</p>
                <p className="text-[9px] text-gray-400 truncate leading-tight mt-0.5">
                  {p.noBib && <span className="font-mono">{p.noBib} · </span>}
                  {(p.kodSekolah && (sekolahMap[p.kodSekolah] || p.kodSekolah)) || ''}
                </p>
              </div>

              {/* Jarak — satu input sahaja */}
              <div className="px-2 py-1.5 flex items-center">
                <input type="number" step="0.01" min="0"
                  value={kp.keputusan ?? ''}
                  disabled={flagged}
                  onChange={e => onChange(key, 'keputusan', e.target.value)}
                  placeholder="0.00"
                  className="w-full border-2 border-gray-200 rounded-lg px-2 py-2 text-sm font-mono font-bold text-center focus:outline-none focus:border-[#003399] bg-white disabled:bg-gray-100 disabled:text-gray-300 transition-colors" />
              </div>

              {/* Kedudukan */}
              <div className="px-1 py-1.5 flex items-center justify-center">
                {flagged ? (
                  <span className="text-[10px] font-bold text-red-400">—</span>
                ) : (
                  <select value={kp.kedudukan ?? ''}
                    onChange={e => onChange(key, 'kedudukan', e.target.value !== '' ? Number(e.target.value) : '')}
                    className="w-full border border-gray-200 rounded-lg px-0.5 py-1.5 text-[11px] font-mono text-center focus:outline-none focus:border-[#003399] bg-white">
                    <option value="">{rank ? `(${rank})` : '—'}</option>
                    {Array.from({ length: bilPes }, (_, i) => {
                      const v = i + 1
                      if (usedByOthers.has(v) && kp.kedudukan !== v) return null
                      return <option key={v} value={v}>{v}</option>
                    })}
                  </select>
                )}
              </div>

              {/* DQ / DNS */}
              <div className="px-1 py-1.5 flex flex-col items-center gap-0.5">
                {['DQ', 'DNS'].map(flag => (
                  <button key={flag} type="button"
                    onClick={() => onChange(key, 'status', kp.status === flag ? '' : flag)}
                    className={`w-full py-1 text-[9px] font-bold rounded transition-colors ${
                      kp.status === flag ? 'bg-red-500 text-white' : 'bg-white border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-400'
                    }`}>{flag}</button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InputRelay({ heat, acara, keputusan, onChange, sekolahMap = {} }) {
  const bilPasukan = acara.bilPasukan || heat.bilPasukan || acara.bilanganLorong || 8
  const slots      = Array.from({ length: bilPasukan }, (_, i) => i + 1)
  const rankMap    = kiraLaranRank(slots, keputusan)

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="grid bg-[#003399] text-white text-[10px] font-bold uppercase tracking-wider"
        style={{ gridTemplateColumns: '36px 1fr 72px 52px 86px' }}>
        <div className="px-2 py-2.5 text-center">Lrg</div>
        <div className="px-2 py-2.5">Sekolah</div>
        <div className="px-2 py-2.5 text-center">Masa (s)</div>
        <div className="px-2 py-2.5 text-center">Kddk</div>
        <div className="px-2 py-2.5 text-center">Catatan</div>
      </div>

      {slots.map((lorong, idx) => {
        const kp      = keputusan[lorong] || {}
        // Lorong kosong = tiada pasukan berdaftar dalam lorong ini
        const isKosong = !kp.kodSekolah && !kp.keputusan && !kp.status

        if (isKosong) {
          return (
            <div key={lorong} className="grid border-t border-gray-100 bg-gray-50"
              style={{ gridTemplateColumns: '36px 1fr 72px 52px 86px' }}>
              <div className="px-1 py-3 flex items-center justify-center">
                <span className="text-[10px] font-black text-gray-300">{lorong}</span>
              </div>
              <div className="col-span-4 px-3 flex items-center">
                <span className="text-[10px] text-gray-300 italic">— Lorong kosong —</span>
              </div>
            </div>
          )
        }

        const rank    = rankMap[lorong]
        const flagged = ['DNS', 'DNF', 'DQ'].includes(kp.status)
        const usedByOthers = new Set(
          slots.filter(s => s !== lorong).map(s => keputusan[s]?.kedudukan).filter(v => v !== '' && v != null)
        )
        const rowBg = flagged ? 'bg-red-50' :
                      rank === 1 ? 'bg-yellow-50' :
                      rank === 2 ? 'bg-gray-50' :
                      rank === 3 ? 'bg-orange-50' :
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'

        return (
          <div key={lorong} className={`grid border-t border-gray-100 ${rowBg}`}
            style={{ gridTemplateColumns: '36px 1fr 72px 52px 86px' }}>

            <div className="px-1 py-2 flex items-center justify-center">
              <span className="text-xs font-black text-gray-500">{lorong}</span>
            </div>

            {/* Sekolah — input kod, papar nama */}
            <div className="px-2 py-1.5 flex flex-col justify-center min-w-0">
              <input type="text" inputMode="text"
                value={kp.kodSekolah || ''}
                onChange={e => onChange(lorong, 'kodSekolah', e.target.value.toUpperCase())}
                placeholder="Kod Sekolah" disabled={flagged}
                className="w-full border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-[#003399] bg-white disabled:bg-gray-100" />
              {kp.kodSekolah && sekolahMap[kp.kodSekolah] && (
                <p className="text-[9px] text-gray-400 truncate mt-0.5">{sekolahMap[kp.kodSekolah]}</p>
              )}
            </div>

            <div className="px-1 py-1.5 flex items-center">
              <input type="number" step="0.01" min="0"
                value={kp.keputusan ?? ''}
                onChange={e => onChange(lorong, 'keputusan', e.target.value)}
                placeholder="0.00" disabled={flagged}
                className="w-full border border-gray-200 rounded-lg px-1 py-1.5 text-[11px] font-mono text-center focus:outline-none focus:border-[#003399] bg-white disabled:bg-gray-100 disabled:text-gray-300" />
            </div>

            <div className="px-1 py-1.5 flex items-center justify-center">
              {flagged ? (
                <span className="text-[10px] font-bold text-red-400">—</span>
              ) : (
                <select value={kp.kedudukan ?? ''}
                  onChange={e => onChange(lorong, 'kedudukan', e.target.value !== '' ? Number(e.target.value) : '')}
                  className="w-full border border-gray-200 rounded-lg px-0.5 py-1 text-[11px] font-mono text-center focus:outline-none focus:border-[#003399] bg-white">
                  <option value="">{rank ? `(${rank})` : '—'}</option>
                  {slots.map(v => {
                    if (usedByOthers.has(v) && kp.kedudukan !== v) return null
                    return <option key={v} value={v}>{v}</option>
                  })}
                </select>
              )}
            </div>

            <div className="px-1 py-1.5 flex items-center gap-0.5">
              {['DNS', 'DNF', 'DQ'].map(flag => (
                <button key={flag} type="button"
                  onClick={() => {
                    const n = kp.status === flag ? '' : flag
                    onChange(lorong, 'status', n)
                    if (n) onChange(lorong, 'keputusan', '')
                  }}
                  className={`flex-1 py-1 text-[9px] font-bold rounded transition-colors ${
                    kp.status === flag ? 'bg-red-500 text-white' : 'bg-white border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-400'
                  }`}>{flag}</button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Jana Final Panel ─────────────────────────────────────────────────────────

function JanaFinalPanel({ finalists, acara, sekolahMap, onJana, loading, finalSetup, finalDijanaKe }) {
  const isPadang = ['padang_lompat', 'padang_balin'].includes(acara?.jenisAcara)
  const { bestHeat, bestTime } = _getFinalistSetup(acara || {}, finalSetup)

  return (
    <div className={`border rounded-2xl p-4 space-y-3 ${finalDijanaKe ? 'bg-green-50/60 border-green-200' : 'bg-[#003399]/5 border-[#003399]/20'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-xs font-black uppercase tracking-widest ${finalDijanaKe ? 'text-green-700' : 'text-[#003399]'}`}>
            {finalDijanaKe ? `✓ Final Dijana → Acara #${finalDijanaKe}` : 'Semua Heat Rasmi'}
          </p>
          <p className="text-[11px] text-gray-600 mt-0.5 font-semibold">
            {finalists.length} finalis
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">
            <span className="font-semibold text-gray-600">{bestHeat} terbaik/heat</span>
            {bestTime > 0 && <span> + <span className="font-semibold text-gray-600">{bestTime} wildcard masa</span></span>}
            {!isPadang && <span className="text-gray-400"> · Lorong auto</span>}
          </p>
        </div>
        <button onClick={() => onJana(finalists)} disabled={loading}
          className={`shrink-0 px-4 py-2.5 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all active:scale-95 ${
            finalDijanaKe
              ? 'bg-green-600 hover:bg-green-700'
              : 'bg-[#003399] hover:bg-[#002277]'
          }`}>
          {loading ? 'Menjana…' : finalDijanaKe ? '↺ Jana Semula' : 'Jana Final ▶'}
        </button>
      </div>

      {/* Preview table */}
      <div className="rounded-xl border border-[#003399]/15 overflow-hidden">
        <div className="grid bg-[#003399] text-white text-[10px] font-bold uppercase tracking-wider"
          style={{ gridTemplateColumns: '32px 40px 1fr 56px 36px' }}>
          {!isPadang && <div className="px-1.5 py-2 text-center">Lrg</div>}
          {isPadang  && <div className="px-1.5 py-2 text-center">#</div>}
          <div className="px-1.5 py-2 text-center">BIB</div>
          <div className="px-2 py-2">Atlet / Sekolah</div>
          <div className="px-1.5 py-2 text-center">{isPadang ? 'Jarak' : 'Masa'}</div>
          <div className="px-1.5 py-2 text-center">H</div>
        </div>
        {finalists.map((f, idx) => (
          <div key={f.noBib || idx}
            className={`grid border-t border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
            style={{ gridTemplateColumns: '32px 40px 1fr 56px 36px' }}>
            <div className="px-1.5 py-2 flex items-center justify-center">
              <span className="text-xs font-black text-[#003399]">
                {!isPadang ? f.lorong : idx + 1}
              </span>
            </div>
            <div className="px-1.5 py-2 flex items-center justify-center">
              <span className="text-[11px] font-mono text-gray-600">{f.noBib || '—'}</span>
            </div>
            <div className="px-2 py-1.5 flex flex-col justify-center min-w-0">
              <p className="text-[11px] font-semibold text-gray-700 truncate leading-tight">{f.namaAtlet || '—'}</p>
              <p className="text-[9px] text-gray-400 truncate leading-tight">
                {(f.kodSekolah && (sekolahMap[f.kodSekolah] || f.kodSekolah)) || ''}
              </p>
            </div>
            <div className="px-1.5 py-2 flex items-center justify-center">
              <span className="text-[11px] font-mono font-bold text-gray-800">
                {f.keputusan ? f.keputusan.toFixed(2) : '—'}
              </span>
            </div>
            <div className="px-1.5 py-2 flex items-center justify-center">
              <span className="text-[10px] text-gray-400">H{f.noHeat}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// Format jam HH:MM:SS
function fmtJam(d) {
  return d.toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

// Format countdown mm:ss
function fmtCountdown(ms) {
  if (ms <= 0) return '00:00'
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Timestamp Firestore → ms
function tsToMs(ts) {
  if (!ts) return 0
  if (typeof ts.toDate === 'function') return ts.toDate().getTime()
  if (ts.seconds) return ts.seconds * 1000
  return 0
}

export default function InputKeputusan() {
  const { userData } = useAuth()

  // Model A: pencatat + superadmin boleh edit sahaja
  const bolehEdit = userData?.role === 'pencatat' || userData?.role === 'superadmin'

  // Step: 'home' | 'heat' | 'input'
  const [step, setStep] = useState('home')
  const [search, setSearch] = useState('')

  // Live clock — refresh setiap saat
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Data
  const [kejohananId,   setKejohananId]   = useState(null)
  const [kejohananData, setKejohananData] = useState(null)
  const [acaraList,     setAcaraList]     = useState([])
  const [jadualAll,     setJadualAll]     = useState([]) // semua jadual semua hari
  const [selectedHari,  setSelectedHari]  = useState(null)
  const [sekolahMap,    setSekolahMap]    = useState({})
  const [kategoriMap,   setKategoriMap]   = useState({}) // kod → label (L12/P15...)
  const [cetakLoading,      setCetakLoading]      = useState(false)
  const [cetakBilangan,    setCetakBilangan]    = useState(3)
  const [cetakLayakLoading, setCetakLayakLoading] = useState(false)
  const [finalSetup,    setFinalSetup]    = useState(null) // tetapan/finalSetup

  // Rekod panel
  const [acaraRekod,        setAcaraRekod]        = useState(null)   // { D, N, K }
  const [acaraRekodLoading, setAcaraRekodLoading] = useState(false)
  const [acaraRekodConType, setAcaraRekodConType] = useState(null)   // 'kuat'|'lemah'|'tiada'
  const [loading,       setLoading]       = useState(true)

  // Filter tab
  const [filterTab, setFilterTab] = useState('semua')
  const [tanpaJadualOpen, setTanpaJadualOpen] = useState(false)

  // Selection
  const [selectedAcara, setSelectedAcara] = useState(null)
  const [heats,         setHeats]         = useState([])
  const [selectedHeat,  setSelectedHeat]  = useState(null)
  const [heatsLoading,  setHeatsLoading]  = useState(false)

  // Input state
  const [keputusan, setKeputusan] = useState({})
  const [windSpeed, setWindSpeed] = useState('')
  const [peserta,   setPeserta]   = useState([])
  const [saving,          setSaving]          = useState(false)
  const [saved,           setSaved]           = useState(false)
  const [janaFinalLoading, setJanaFinalLoading] = useState(false)

  // ── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const kejSnap = await getDocs(query(
          collection(db, 'kejohanan'),
          where('statusKejohanan', '==', 'aktif')
        ))
        if (kejSnap.empty) { setLoading(false); return }
        const kej = kejSnap.docs[0]
        const kejId = kej.id
        setKejohananId(kejId)
        setKejohananData(kej.data())

        // Load sekolah untuk nama sekolah lookup
        getDocs(collection(db, 'sekolah')).then(snap => {
          const map = {}
          snap.docs.forEach(d => { map[d.id] = d.data().namaSekolah || d.id })
          setSekolahMap(map)
        }).catch(err => console.warn('[InputKeputusan] gagal load sekolah map:', err))

        // Load kategori untuk label (L12/P15...)
        getDocs(collection(db, 'kategori')).then(snap => {
          const map = {}
          snap.docs.forEach(d => { map[d.id] = d.data().label || d.id })
          setKategoriMap(map)
        }).catch(() => {})

        // Load tetapan finalSetup untuk pilih finalis
        getDoc(doc(db, 'tetapan', 'finalSetup')).then(snap => {
          if (snap.exists()) setFinalSetup(snap.data())
        }).catch(() => {})

        // Semua acara — tanpa orderBy untuk elak index error, sort client-side
        const acaraSnap = await getDocs(
          collection(db, 'kejohanan', kejId, 'acara')
        )
        const acaraDocs = acaraSnap.docs
          .map(d => ({ acaraId: d.id, ...d.data() }))
          .sort((a, b) => (a.noAcara ?? 999) - (b.noAcara ?? 999))

        // Heat status per acara (parallel) — guna aceraId (field) bukan acaraId (d.id)
        const counts = await Promise.all(
          acaraDocs.map(async a => {
            const aceraKey = a.aceraId || a.acaraId
            const hSnap = await getDocs(
              collection(db, 'kejohanan', kejId, 'acara', aceraKey, 'heat')
            )
            const rasmi = hSnap.docs.filter(h => ['rasmi','diterima'].includes(h.data().statusKeputusan)).length
            const draf  = hSnap.docs.filter(h => h.data().statusKeputusan === 'tidak_rasmi').length
            return { acaraId: a.acaraId, total: hSnap.size, rasmi, draf }
          })
        )
        const countMap = Object.fromEntries(counts.map(c => [c.acaraId, c]))

        const acaraWithCounts = acaraDocs.map(a => ({
          ...a,
          _totalHeat: countMap[a.acaraId]?.total || 0,
          _rasmiHeat: countMap[a.acaraId]?.rasmi || 0,
          _drafHeat:  countMap[a.acaraId]?.draf  || 0,
        }))
        setAcaraList(acaraWithCounts)

        // Jadual semua hari — load sekaligus, sort client-side
        const jadualSnap = await getDocs(
          collection(db, 'jadual_acara')
        ).catch(() => ({ docs: [] }))

        // acaraMap — index by both aceraId field AND document id
        const acaraMap = {}
        acaraWithCounts.forEach(a => {
          acaraMap[a.acaraId] = a
          if (a.aceraId) acaraMap[a.aceraId] = a
        })

        const allJadual = jadualSnap.docs
          .map(d => ({ ...d.data(), jadualId: d.id }))
          .filter(j => j.statusJadual !== 'batal' && (acaraMap[j.aceraId] || acaraMap[j.acaraId]))
          .map(j => ({ ...j, acara: acaraMap[j.aceraId] || acaraMap[j.acaraId] }))
        setJadualAll(allJadual)

        // Default pilih hari ini, kalau tiada pilih hari pertama
        const today = new Date().toISOString().slice(0, 10)
        const allDates = [...new Set(allJadual.map(j => j.tarikhAcara).filter(Boolean))].sort()
        setSelectedHari(allDates.includes(today) ? today : (allDates[0] || null))
      } catch (e) {
        console.error('load error:', e)
      }
      finally { setLoading(false) }
    }
    load()
  }, [])

  // ── Load heats ─────────────────────────────────────────────────────────────

  const loadHeats = useCallback(async (acara) => {
    if (!kejohananId) return
    setHeatsLoading(true)
    // Guna aceraId (field dalam doc) — sama seperti StartList & admin components
    const aceraKey = acara.aceraId || acara.acaraId
    try {
      const snap = await getDocs(
        collection(db, 'kejohanan', kejohananId, 'acara', aceraKey, 'heat')
      )
      const list = snap.docs
        .map(d => ({ heatId: d.id, ...d.data() }))
        .sort((a, b) => (a.noHeat ?? 0) - (b.noHeat ?? 0))
      setHeats(list)
    } catch (e) {
      console.error('loadHeats error:', aceraKey, e)
      setHeats([])
    }
    finally { setHeatsLoading(false) }
  }, [kejohananId])

  // ── Init keputusan dari peserta[] ──────────────────────────────────────────

  function initKeputusanDariPeserta(acara, heat) {
    const kpMap = {}
    const pesertaArr = heat.peserta || []

    if (acara.jenisAcara === 'lorong' || acara.jenisAcara === 'relay') {
      pesertaArr.forEach(p => {
        if (p.lorong != null) kpMap[p.lorong] = {
          noBib:      p.noBib      || '',
          namaAtlet:  p.namaAtlet  || '',
          kodSekolah: p.kodSekolah || '',
          keputusan:  p.keputusan  != null ? String(p.keputusan) : '',
          kedudukan:  p.kedudukan  != null ? p.kedudukan : '',
          status:     (p.status && p.status !== 'belum') ? p.status : '',
        }
      })
    } else if (acara.jenisAcara === 'mass_start') {
      pesertaArr.forEach((p, i) => {
        const slot = p.giliran ?? (i + 1)
        kpMap[slot] = {
          noBib:     p.noBib     || '',
          namaAtlet: p.namaAtlet || '',
          keputusan: p.keputusan != null ? String(p.keputusan) : '',
          status:    (p.status && p.status !== 'belum') ? p.status : '',
        }
      })
    } else {
      pesertaArr.forEach(p => {
        kpMap[p.noBib] = {
          noBib:     p.noBib     || '',
          namaAtlet: p.namaAtlet || '',
          keputusan: p.keputusan != null ? String(p.keputusan) : '',
          status:    (p.status && p.status !== 'belum') ? p.status : '',
          cubaan: Array.isArray(p.cubaan)
            ? Object.fromEntries((p.cubaan || []).map((v, i) => [i + 1, v != null ? String(v) : '']))
            : {},
        }
      })
    }
    return kpMap
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async function selectAcara(acara) {
    setSelectedAcara(acara)
    setSelectedHeat(null)
    setHeats([])
    setKeputusan({})
    setWindSpeed('')
    setSaved(false)
    setStep('input')
    setHeatsLoading(true)

    if (!kejohananId) { setHeatsLoading(false); return }
    const aceraKey = acara.aceraId || acara.acaraId
    try {
      const snap = await getDocs(
        collection(db, 'kejohanan', kejohananId, 'acara', aceraKey, 'heat')
      )
      const list = snap.docs
        .map(d => ({ heatId: d.id, ...d.data() }))
        .sort((a, b) => (a.noHeat ?? 0) - (b.noHeat ?? 0))
      setHeats(list)
      // Auto-pilih: utamakan heat yang belum selesai, kemudian heat pertama
      const firstPending = list.find(h => !['rasmi', 'diterima'].includes(h.statusKeputusan))
      const toSelect = firstPending || list[0]
      if (toSelect) await selectHeat(toSelect, acara, list)
    } catch (e) {
      console.error('selectAcara error:', e)
      setHeats([])
    } finally {
      setHeatsLoading(false)
    }
  }

  async function selectHeat(heat, _acara = null, _allHeats = null) {
    const acara    = _acara    || selectedAcara
    const allHeats = _allHeats || heats
    let h = heat

    // Auto-rasmi: semak jika timer sudah luput
    // BUG1 FIX: jangan auto-rasmi heat FINAL — biarkan KeputusanRasmi handle (postRasmi perlu jalan)
    const isFinalHeat = ['final', 'terus_final'].includes(h.fasa) || allHeats.length === 1
    if (h.statusKeputusan === 'tidak_rasmi' && h.publishedAt && kejohananId && !isFinalHeat) {
      const timer = acara?.timerAutoRasmi ?? kejohananData?.timerAutoRasmi ?? 15
      const pubMs = tsToMs(h.publishedAt)
      const elapsedMin = pubMs > 0 ? (Date.now() - pubMs) / 60000 : 0
      if (elapsedMin >= timer) {
        try {
          const aceraKey = acara.aceraId || acara.acaraId
          await updateDoc(
            doc(db, 'kejohanan', kejohananId, 'acara', aceraKey, 'heat', h.heatId),
            { statusKeputusan: 'rasmi', autoRasmiAt: serverTimestamp() }
          )
          h = { ...h, statusKeputusan: 'rasmi' }
          const updatedHeats = allHeats.map(x => x.heatId === h.heatId ? { ...x, statusKeputusan: 'rasmi' } : x)
          setHeats(updatedHeats)
          // Update statusAcara
          const finalHeat = updatedHeats.find(x => x.peringkat === 'final' || x.fasa === 'terus_final')
          let newAcaraStatus
          if (finalHeat) {
            newAcaraStatus = finalHeat.statusKeputusan === 'rasmi' ? 'rasmi' : 'tidak_rasmi'
          } else {
            newAcaraStatus = updatedHeats.every(x => x.statusKeputusan === 'rasmi') ? 'rasmi' : 'tidak_rasmi'
          }
          await updateDoc(
            doc(db, 'kejohanan', kejohananId, 'acara', aceraKey),
            { statusAcara: newAcaraStatus }
          ).catch(() => {})
        } catch { /* ignore */ }
      }
    }

    setSelectedHeat(h)
    setSaved(false)
    setWindSpeed(h.windSpeed != null ? String(h.windSpeed) : '')
    setKeputusan(initKeputusanDariPeserta(acara, h))
    setPeserta(h.peserta || [])
    // setStep handled by caller (selectAcara sets 'input', tab click stays in 'input')
  }

  // ── Fix 1: Real-time listener untuk status heat semasa ───────────────────────
  // Dengar perubahan statusKeputusan, bantahanDiterima, countdownTamat sahaja.
  // TIDAK update peserta/keputusan — jangan overwrite input user yang sedang taip.

  const heatListenerRef = useRef(null)

  useEffect(() => {
    // Buang listener lama
    if (heatListenerRef.current) { heatListenerRef.current(); heatListenerRef.current = null }
    if (!kejohananId || !selectedAcara || !selectedHeat?.heatId) return
    const aceraKey = selectedAcara.aceraId || selectedAcara.acaraId
    const hRef = doc(db, 'kejohanan', kejohananId, 'acara', aceraKey, 'heat', selectedHeat.heatId)
    heatListenerRef.current = onSnapshot(hRef, snap => {
      if (!snap.exists()) return
      const d = snap.data()
      // Update status fields sahaja — jangan sentuh peserta/keputusan
      setSelectedHeat(prev => prev ? {
        ...prev,
        statusKeputusan:  d.statusKeputusan  ?? prev.statusKeputusan,
        bantahanDiterima: d.bantahanDiterima ?? false,
        countdownTamat:   d.countdownTamat   ?? prev.countdownTamat,
        publishedAt:      d.publishedAt      ?? prev.publishedAt,
        postRasmiSelesai: d.postRasmiSelesai ?? prev.postRasmiSelesai,
      } : prev)
      // Sync dalam heats list juga
      setHeats(prev => prev.map(h =>
        h.heatId === snap.id
          ? { ...h, statusKeputusan: d.statusKeputusan ?? h.statusKeputusan, bantahanDiterima: d.bantahanDiterima ?? false }
          : h
      ))
    }, () => {}) // silent error — jangan crash bila offline
    return () => { if (heatListenerRef.current) { heatListenerRef.current(); heatListenerRef.current = null } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kejohananId, selectedAcara?.aceraId, selectedHeat?.heatId])

  // ── Fetch rekod bila acara bertukar ────────────────────────────────────────
  useEffect(() => {
    if (!selectedAcara || !kejohananData) {
      setAcaraRekod(null)
      setAcaraRekodConType(null)
      return
    }
    let cancelled = false
    async function fetchRekod() {
      setAcaraRekodLoading(true)
      try {
        const PKOD = { daerah: 'D', negeri: 'N', kebangsaan: 'K' }
        const pKej = PKOD[(kejohananData.peringkat || '').toLowerCase()] || 'D'
        const namaPendek = (selectedAcara.namaAcaraPendek || selectedAcara.namaAcara || '').trim()
        const primaryKey = buildRekodKey(namaPendek, selectedAcara.jantina, selectedAcara.kategoriKod, pKej)
        const [primarySnap, result] = await Promise.all([
          getDoc(doc(db, 'rekod', primaryKey)),
          cariRekodUntukAcara(selectedAcara),
        ])
        if (cancelled) return
        const hasAny = result.D || result.N || result.K
        if (hasAny) {
          setAcaraRekod(result)
          setAcaraRekodConType(primarySnap.exists() ? 'kuat' : 'lemah')
        } else {
          setAcaraRekod({ D: null, N: null, K: null })
          setAcaraRekodConType('tiada')
        }
      } catch (e) {
        if (!cancelled) { setAcaraRekod(null); setAcaraRekodConType(null) }
      } finally {
        if (!cancelled) setAcaraRekodLoading(false)
      }
    }
    fetchRekod()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAcara?.acaraId, kejohananData?.peringkat])

  function goBack() {
    // Refresh acaraList counts dari heats state semasa
    if (selectedAcara && heats.length > 0) {
      const rasmi = heats.filter(h => ['rasmi','diterima'].includes(h.statusKeputusan)).length
      const draf  = heats.filter(h => h.statusKeputusan === 'tidak_rasmi').length
      setAcaraList(prev => prev.map(a =>
        a.acaraId === selectedAcara.acaraId
          ? { ...a, _rasmiHeat: rasmi, _drafHeat: draf, _totalHeat: heats.length }
          : a
      ))
    }
    setStep('home')
    setSelectedAcara(null)
    setSelectedHeat(null)
    setHeats([])
    setKeputusan({})
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleChange(slot, field, value) {
    setKeputusan(prev => ({ ...prev, [slot]: { ...(prev[slot] || {}), [field]: value } }))
    setSaved(false)
  }

  async function handleSave() {
    if (!kejohananId || !selectedAcara || !selectedHeat) return
    if (!bolehEdit) return
    setSaving(true)
    setSaved(false)
    try {
      const aceraKey = selectedAcara.aceraId || selectedAcara.acaraId
      const heatRef = doc(
        db, 'kejohanan', kejohananId,
        'acara', aceraKey,
        'heat', selectedHeat.heatId
      )
      const jenisAcara = selectedAcara.jenisAcara
      const updatedPeserta = (selectedHeat.peserta || []).map((p, i) => {
        let slot
        if (jenisAcara === 'lorong' || jenisAcara === 'relay') slot = p.lorong
        else if (jenisAcara === 'mass_start') slot = p.giliran ?? (i + 1)
        else slot = p.noBib

        const kp  = keputusan[slot] || {}
        const val = kp.keputusan !== '' && kp.keputusan !== undefined
          ? (Number(kp.keputusan) || null) : p.keputusan

        let cubaan = p.cubaan ?? null
        if ((jenisAcara === 'padang_lompat' || jenisAcara === 'padang_balin') && kp.cubaan) {
          const bil = selectedAcara.bilanganCubaan || 6
          cubaan = Array.from({ length: bil }, (_, c) => {
            const v = kp.cubaan[c + 1]
            if (v === '' || v == null) return null
            const n = Number(v)
            return isNaN(n) ? v : n
          })
        }
        // Simpan kedudukan manual jika ada (lorong/relay)
        const kedudukan = (jenisAcara === 'lorong' || jenisAcara === 'relay')
          ? (kp.kedudukan !== '' && kp.kedudukan != null ? kp.kedudukan : (p.kedudukan ?? null))
          : (p.kedudukan ?? null)

        // Auto-set status 'selesai' bila ada keputusan sah & tiada flag DNS/DNF/DQ
        // Ini kritikal — postRasmi() skip peserta yang bukan 'selesai'
        const rawStatus = kp.status || p.status || 'belum'
        const isFlagged = ['DNS', 'DNF', 'DQ'].includes(rawStatus)
        const hasResult = val != null && val !== '' && !isNaN(Number(val)) && Number(val) > 0
        const finalStatus = isFlagged ? rawStatus : hasResult ? 'selesai' : rawStatus

        return { ...p, keputusan: val, kedudukan, status: finalStatus, cubaan, updatedBy: userData?.uid || '' }
      })

      // ── Kira rankDalamHeat ─────────────────────────────────────────────────
      // rankDalamHeat diperlukan oleh KeputusanRasmi.postRasmi() untuk assign mata & medal.
      // Tanpa field ini, postRasmi() skip semua atlet secara senyap.
      const isPadang = ['padang_lompat', 'padang_balin'].includes(jenisAcara)
      const finishers = [...updatedPeserta]
        .filter(p => p.status === 'selesai' && p.keputusan != null)
        .sort((a, b) => isPadang ? b.keputusan - a.keputusan : a.keputusan - b.keputusan)
      // Relay guna lorong sebagai key (noBib tiada dalam relay peserta)
      const rankKey = p => jenisAcara === 'relay' ? p.lorong : p.noBib
      const autoRankMap = new Map()
      finishers.forEach((p, i) => {
        const prevSame = i > 0 && p.keputusan === finishers[i - 1].keputusan
        autoRankMap.set(rankKey(p), prevSame ? autoRankMap.get(rankKey(finishers[i - 1])) : i + 1)
      })
      const pesertaDenganRank = updatedPeserta.map(p => ({
        ...p,
        rankDalamHeat: (p.status === 'selesai' && p.keputusan != null)
          ? (p.kedudukan || autoRankMap.get(rankKey(p)) || null)
          : null,
      }))

      const updates = { peserta: pesertaDenganRank, updatedAt: serverTimestamp() }
      if (selectedAcara.isWindReading && windSpeed !== '') {
        updates.windSpeed = Number(windSpeed) || null
      }
      // TIDAK tukar status — Simpan Draf hanya simpan data sahaja

      await updateDoc(heatRef, updates)

      const curStatus = selectedHeat.statusKeputusan
      setSelectedHeat(prev => ({ ...prev, ...updates, statusKeputusan: curStatus, peserta: pesertaDenganRank }))
      setHeats(prev => prev.map(h =>
        h.heatId === selectedHeat.heatId
          ? { ...h, statusKeputusan: curStatus, peserta: pesertaDenganRank }
          : h
      ))
      setSaved(true)
    } catch (e) {
      alert(`Ralat menyimpan: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── HANTAR: simpan data + publish (tidak_rasmi + publishedAt) ──────────────

  async function handleHantar() {
    if (!kejohananId || !selectedAcara || !selectedHeat || !bolehEdit) return
    setSaving(true); setSaved(false)
    try {
      // 1. Simpan keputusan
      await handleSave()

      const aceraKey = selectedAcara.aceraId || selectedAcara.acaraId
      const heatRef  = doc(db, 'kejohanan', kejohananId, 'acara', aceraKey, 'heat', selectedHeat.heatId)
      const acaraRef = doc(db, 'kejohanan', kejohananId, 'acara', aceraKey)

      // 2. Set status diterima
      await updateDoc(heatRef, {
        statusKeputusan:  'diterima',
        bantahanDiterima: false,
        publishedAt:      serverTimestamp(),
        updatedAt:        serverTimestamp(),
      })
      await updateDoc(acaraRef, { statusAcara: 'ada_keputusan', updatedAt: serverTimestamp() }).catch(() => {})

      // 3. Update UI state
      const patch = { statusKeputusan: 'diterima' }
      setSelectedHeat(prev => ({ ...prev, ...patch }))
      setHeats(prev => prev.map(h => h.heatId === selectedHeat.heatId ? { ...h, ...patch } : h))

      // 4. Kira config untuk postRasmi
      const kej     = kejohananData || {}
      const PKOD    = { daerah: 'D', negeri: 'N', kebangsaan: 'K' }
      const peringkatKej      = PKOD[(kej.peringkat || '').toLowerCase()] || 'D'
      const mp                = kej.mataPingat || {}
      const mataPingat        = {
        1: Number(mp[1] ?? mp['1'] ?? 5), 2: Number(mp[2] ?? mp['2'] ?? 3),
        3: Number(mp[3] ?? mp['3'] ?? 2), 4: Number(mp[4] ?? mp['4'] ?? 1),
      }
      const bilanganKedudukan = kej.bilanganKedudukan ?? 8
      const isRelayAcara      = selectedAcara.isRelay || selectedAcara.jenisAcara === 'relay'
      const isSaringanLocal   = (() => {
        const p = (selectedAcara.peringkat || '').toLowerCase()
        const n = (selectedAcara.namaAcara  || '').toLowerCase()
        return p.includes('saringan') || n.includes('saringan')
      })()
      const fasa            = selectedHeat.fasa
      const grantMedalLocal = !isSaringanLocal && (
        (fasa ? ['final', 'terus_final'].includes(fasa) : false) || heats.length === 1
      )

      // 5. Fetch heat terkini + run postRasmi
      const freshSnap = await getDoc(heatRef)
      if (freshSnap.exists()) {
        const freshHeat = { id: selectedHeat.heatId, ...freshSnap.data() }
        const acaraDoc  = { id: aceraKey, ...selectedAcara }
        try {
          await runPostRasmi(db, freshHeat, acaraDoc, kejohananId, {
            mataPingat, bilanganKedudukan, peringkatKej,
            grantMedal: grantMedalLocal,
            isRelay:    isRelayAcara,
          })
        } catch (postErr) { console.warn('postRasmi:', postErr.message) }
      }

      setSaved(true)
    } catch (e) {
      alert(`Ralat hantar: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Padam Keputusan — undo medal tally + clear result ────────────────────────

  async function handleDelete() {
    if (!window.confirm('Padam keputusan heat ini?\nMedal tally akan dikemaskini semula.')) return
    if (!kejohananId || !selectedAcara || !selectedHeat || !bolehEdit) return
    setSaving(true)
    try {
      const aceraKey = selectedAcara.aceraId || selectedAcara.acaraId
      const heatRef  = doc(db, 'kejohanan', kejohananId, 'acara', aceraKey, 'heat', selectedHeat.heatId)

      // Fetch data semasa
      const heatSnap = await getDoc(heatRef)
      if (!heatSnap.exists()) return
      const heatData = heatSnap.data()

      // Undo medal tally contributions dari heat ini
      for (const p of (heatData.peserta || [])) {
        if (!p.kodSekolah) continue
        const tId        = `${p.kodSekolah}_${kejohananId}`
        // Relay: guna kodSekolah sebagai key unik (noBib/noKP tiada dalam relay peserta)
        const isRelayHeat = selectedAcara?.jenisAcara === 'relay'
        const contribKey = `contrib_${selectedHeat.heatId}_${isRelayHeat ? p.kodSekolah : (p.noKP || p.noBib)}`
        try {
          const tRef  = doc(db, 'medal_tally', tId)
          const tSnap = await getDoc(tRef)
          if (!tSnap.exists()) continue
          const contrib = tSnap.data()[contribKey]
          if (!contrib) continue
          const pingat = contrib.pingat
          await updateDoc(tRef, {
            [contribKey]: deleteField(),
            [pingat]:     increment(-1),
            jumlahPingat: increment(-1),
          })
        } catch { /* ignore */ }
      }

      // Clear keputusan dalam peserta
      const clearedPeserta = (heatData.peserta || []).map(p => ({
        ...p,
        keputusan:     null,
        rankDalamHeat: null,
        kedudukan:     null,
        pecahRekod:    null,
      }))

      await updateDoc(heatRef, {
        peserta:          clearedPeserta,
        statusKeputusan:  'kosong',
        postRasmiSelesai: false,
        updatedAt:        serverTimestamp(),
      })

      // Update statusAcara
      const updatedHeats = heats.map(h =>
        h.heatId === selectedHeat.heatId ? { ...h, statusKeputusan: 'kosong' } : h
      )
      const anyResult = updatedHeats.some(h => ['diterima','tidak_rasmi','rasmi'].includes(h.statusKeputusan))
      await updateDoc(
        doc(db, 'kejohanan', kejohananId, 'acara', aceraKey),
        { statusAcara: anyResult ? 'ada_keputusan' : 'akan_datang', updatedAt: serverTimestamp() }
      ).catch(() => {})

      setSelectedHeat(prev => ({ ...prev, statusKeputusan: 'kosong', peserta: clearedPeserta }))
      setHeats(updatedHeats)
      setKeputusan({})
      setSaved(false)
    } catch (e) {
      alert(`Ralat padam: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Sahkan Rasmi (dari bantahan / manual) ──────────────────────────────────

  async function handleSahkanRasmi() {
    if (!kejohananId || !selectedAcara || !selectedHeat || !bolehEdit) return
    setSaving(true)
    try {
      const aceraKey = selectedAcara.aceraId || selectedAcara.acaraId
      const heatRef  = doc(db, 'kejohanan', kejohananId, 'acara', aceraKey, 'heat', selectedHeat.heatId)
      await updateDoc(heatRef, { statusKeputusan: 'rasmi', rasmiAt: serverTimestamp() })

      // Kira statusAcara baharu berdasarkan semua heats
      const updatedHeats = heats.map(h =>
        h.heatId === selectedHeat.heatId ? { ...h, statusKeputusan: 'rasmi' } : h
      )
      const finalHeat = updatedHeats.find(h => h.fasa === 'final' || h.fasa === 'terus_final')
      let newAcaraStatus
      if (finalHeat) {
        // Ada final → rasmi hanya bila final heat sendiri yang rasmi
        newAcaraStatus = finalHeat.statusKeputusan === 'rasmi' ? 'rasmi' : 'tidak_rasmi'
      } else {
        // Tiada final (direct final) → rasmi bila SEMUA heat rasmi
        newAcaraStatus = updatedHeats.every(h => h.statusKeputusan === 'rasmi') ? 'rasmi' : 'tidak_rasmi'
      }
      try {
        await updateDoc(
          doc(db, 'kejohanan', kejohananId, 'acara', aceraKey),
          { statusAcara: newAcaraStatus }
        )
      } catch { /* ignore */ }

      setSelectedHeat(prev => ({ ...prev, statusKeputusan: 'rasmi' }))
      setHeats(updatedHeats)
    } catch (e) {
      alert(`Ralat: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Hantar Semula (selepas bantahan diedit) ────────────────────────────────

  async function handleHantarSemula() {
    await handleHantar()
  }

  // ── Cetak Start List Final (4 salinan: Juruhebah / Call Room / Teknikal / Fail) ──

  async function handleCetakLayakFinal() {
    if (!selectedAcara || !finalDijanaKe) return
    setCetakLayakLoading(true)
    try {
      // 1. Cari acara final dari acaraList menggunakan noAcara
      const finalAcara = acaraList.find(a => String(a.noAcara) === String(finalDijanaKe))
      if (!finalAcara) throw new Error(`Acara final #${finalDijanaKe} tidak ditemui dalam senarai`)

      // 2. Muatkan tetapan/home + wa_config serentak
      const [homeSnap, waSnap] = await Promise.all([
        getDoc(doc(db, 'tetapan', 'home')).catch(() => null),
        getDoc(doc(db, 'wa_config', kejohananId)).catch(() => null),
      ])
      const homeCfg = homeSnap?.exists() ? homeSnap.data() : {}
      const namaKej = homeCfg?.tajukUtama || kejohananData?.namaKejohanan || 'Kejohanan Olahraga'

      // 3. Parse lorongKumpulan dari wa_config
      let lorongKumpulan = { ...WA_LORONG_KUMPULAN_DEFAULT }
      if (waSnap?.exists() && waSnap.data().lorongKumpulan) {
        const parsed = deserializeKumpulan(waSnap.data().lorongKumpulan)
        if (parsed) lorongKumpulan = { ...WA_LORONG_KUMPULAN_DEFAULT, ...parsed }
      }

      // 4. Pilih finalis dari heats saringan semasa
      const raw = _selectFinalists(heats, selectedAcara, finalSetup)
      const isPadangAcara = ['padang_lompat', 'padang_balin'].includes(finalAcara.jenisAcara)
      const isMassAcara   = finalAcara.jenisAcara === 'mass_start'
      const sortFn = (a, b) => isPadangAcara ? b.keputusan - a.keputusan : a.keputusan - b.keputusan

      // Sort ikut prestasi terbaik sebelum assign lorong
      const finalisSort = [...raw].sort(sortFn)

      // 5. Assign lorong / giliran menggunakan WA
      let finalPeserta
      if (isPadangAcara || isMassAcara) {
        finalPeserta = finalisSort.map((p, i) => ({ ...p, giliran: i + 1 }))
      } else {
        const jenisLorong = detectJenisLorong(finalAcara)
        finalPeserta = assignLorongFinal(finalisSort, jenisLorong, lorongKumpulan)
      }

      // 6. Bina heat object untuk buatStartListPDFUnified
      const finalHeat = {
        heatId:  `final_${finalDijanaKe}`,
        fasa:    'final',
        noHeat:  1,
        peserta: finalPeserta,
      }

      // 7. Cari jadual untuk acara final
      const finalAceraKey = finalAcara.aceraId || finalAcara.acaraId
      const jadualFinal = jadualAll.find(j =>
        j.aceraId === finalAceraKey ||
        (j.acara && j.acara.acaraId === finalAcara.acaraId)
      ) || null

      // 8. Bina kategoriList dari kategoriMap
      const kategoriList = Object.entries(kategoriMap).map(([kod, label]) => ({ kod, label }))

      // 9. Rekod DNK — guna rekod yang sudah dimuatkan untuk acara semasa
      const rekodDNK = acaraRekod || { D: null, N: null, K: null }

      // 10. Jana PDF 4 salinan
      const pdf = buatStartListPDFUnified({
        acara:         { ...finalAcara, noAcara: finalDijanaKe },
        heats:         [finalHeat],
        namaKej,
        jadual:        jadualFinal,
        rekodDNK,
        namaSekolahMap: sekolahMap,
        kategoriList,
        logoKiri:      homeCfg.logoKiriBase64  || null,
        logoKanan:     homeCfg.logoKananBase64 || null,
      })

      const kat      = _katLabel(finalAcara.kategoriKod, kategoriList)
      const safeNama = (finalAcara.namaAcaraPendek || finalAcara.namaAcara || 'final')
        .replace(/[^a-zA-Z0-9]/g, '_')
      pdf.save(`StartList_Final_${safeNama}_${kat}.pdf`)
    } catch (err) {
      console.error('handleCetakLayakFinal error:', err)
      alert('Ralat semasa jana PDF. Sila cuba lagi.')
    } finally {
      setCetakLayakLoading(false)
    }
  }

  // ── Cetak Hasil Final (3 salinan: Juruhebah / Hadiah / Fail) ──────────────

  async function handleCetakHasil() {
    if (!selectedAcara || !selectedHeat) return
    setCetakLoading(true)
    try {
      const isPadangAcara = ['padang_lompat', 'padang_balin'].includes(selectedAcara.jenisAcara)
      const isRelayAcara  = selectedAcara.jenisAcara === 'relay'

      // Fetch rekod + logo config serentak
      const PKOD = { daerah: 'D', negeri: 'N', kebangsaan: 'K' }
      const peringkatKej   = PKOD[(kejohananData?.peringkat || '').toLowerCase()] || 'D'
      const rekodNamaCetak = selectedAcara.namaAcaraPendek || selectedAcara.namaAcara
      const rKey = [rekodNamaCetak, selectedAcara.jantina, selectedAcara.kategoriKod, peringkatKej]
        .join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_')

      const [rSnap, rTuntSnap, cfgSnap] = await Promise.all([
        getDoc(doc(db, 'rekod', rKey)).catch(() => null),
        getDoc(doc(db, 'rekod', rKey + '_tuntutan')).catch(() => null),
        getDoc(doc(db, 'tetapan', 'home')).catch(() => null),
      ])

      let rekodDoc = null
      let isRekodBaru = false
      if (rTuntSnap?.exists() && rTuntSnap.data().kejohananId === kejohananId) {
        rekodDoc = rTuntSnap.data()
        isRekodBaru = true
      } else if (rSnap?.exists() && rSnap.data().statusRekod === 'aktif') {
        rekodDoc = rSnap.data()
        isRekodBaru = false
      }

      const homeCfg = cfgSnap?.exists() ? cfgSnap.data() : {}
      function imgFmt(b64) {
        if (!b64) return 'PNG'
        return (b64.startsWith('data:image/jpeg') || b64.startsWith('data:image/jpg')) ? 'JPEG' : 'PNG'
      }

      // Peserta final — had kepada cetakBilangan (3 atau 5)
      const pesertaFinal = (selectedHeat.peserta || [])
        .filter(p => p.rankDalamHeat && (p.status === 'selesai' || p.keputusan != null))
        .sort((a, b) => a.rankDalamHeat - b.rankDalamHeat)
        .slice(0, cetakBilangan)

      // Q/q map untuk saringan heat
      const isSaringanHeat = !['final', 'terus_final'].includes(selectedHeat?.fasa) && selectedHeat?.peringkat !== 'final'
      const cetakQMap = new Map()
      if (isSaringanHeat && selectedAcara) {
        const raw = _selectFinalists(heats, selectedAcara, finalSetup)
        raw.forEach(f => {
          const key = isRelayAcara ? f.kodSekolah : f.noBib
          if (key) cetakQMap.set(key, f.qualifyType || 'q')
        })
      }

      // Helpers
      function fmtPrestasi(val) {
        if (val == null || val === '') return '—'
        const n = Number(val)
        if (isNaN(n)) return String(val)
        if (isPadangAcara) return `${n.toFixed(2)} m`
        const min = Math.floor(n / 60)
        const sek = (n % 60).toFixed(2).padStart(5, '0')
        return min > 0 ? `${min}:${sek}` : `${Number(sek).toFixed(2)}s`
      }

      function fmtTarikh(t) {
        if (!t) return '—'
        return new Date(t + 'T00:00:00').toLocaleDateString('ms-MY', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        })
      }

      const namaKej  = homeCfg?.tajukUtama || kejohananData?.namaKejohanan || 'Kejohanan Olahraga'
      const katLabel = kategoriMap[selectedAcara.kategoriKod] || selectedAcara.kategoriKod || '—'
      const tarikh   = fmtTarikh(selectedAcara.tarikhAcara)
      const now      = new Date().toLocaleString('ms-MY')

      const SALINAN = [
        { label: 'JURUHEBAH', clr: [0, 51, 153],  tblSize: 13 },
        { label: 'HADIAH',    clr: [0, 120, 50],  tblSize: 10 },
        { label: 'FAIL',      clr: [70, 70, 70],  tblSize: 10 },
      ]

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const M = 15
      const W = pdf.internal.pageSize.getWidth()
      const H = pdf.internal.pageSize.getHeight()
      let isFirst = true

      // ── Header formal (logo + nama kejohanan) — sama untuk semua salinan ──
      function buatHeader(clr) {
        let y = 10
        const logoW = 18, logoH = 18
        if (homeCfg.logoKiriBase64) {
          try { pdf.addImage(homeCfg.logoKiriBase64, imgFmt(homeCfg.logoKiriBase64), M, y, logoW, logoH) } catch {}
        }
        if (homeCfg.logoKananBase64) {
          try { pdf.addImage(homeCfg.logoKananBase64, imgFmt(homeCfg.logoKananBase64), W - M - logoW, y, logoW, logoH) } catch {}
        }
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(11)
        pdf.setTextColor(0, 0, 0)
        pdf.text(namaKej, W / 2, y + 7, { align: 'center' })
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8.5)
        pdf.setTextColor(60, 60, 60)
        pdf.text('KEPUTUSAN RASMI', W / 2, y + 13, { align: 'center' })
        pdf.setFontSize(7.5)
        pdf.setTextColor(120, 120, 120)
        pdf.text(tarikh, W / 2, y + 18.5, { align: 'center' })
        pdf.setDrawColor(...clr)
        pdf.setLineWidth(0.7)
        pdf.line(M, y + 22, W - M, y + 22)
        return y + 28 // y selepas header
      }

      for (const sal of SALINAN) {
        if (!isFirst) pdf.addPage()
        isFirst = false

        let y = buatHeader(sal.clr)

        // ── Label salinan (kanan, bawah header) ──
        const lblW = 36, lblH = 8
        const lblX = W - M - lblW
        pdf.setFillColor(...sal.clr)
        pdf.rect(lblX, y, lblW, lblH, 'F')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        pdf.setTextColor(255, 255, 255)
        pdf.text(sal.label, lblX + lblW / 2, y + 5.5, { align: 'center' })
        pdf.setTextColor(0, 0, 0)
        y += 12

        // ── Garisan nipis ──
        pdf.setDrawColor(200, 200, 200)
        pdf.setLineWidth(0.3)
        pdf.line(M, y, W - M, y)
        y += 6

        // ── Info acara ──
        const col2 = M + 32
        const infoRows = [
          ['No. Acara', String(selectedAcara.noAcara || '—')],
          ['Kategori',  katLabel],
          ['Acara',     selectedAcara.namaAcara || '—'],
        ]
        pdf.setFontSize(9.5)
        infoRows.forEach(([lbl, val]) => {
          pdf.setFont('helvetica', 'normal')
          pdf.setTextColor(110, 110, 110)
          pdf.text(lbl, M, y)
          pdf.text(':', col2 - 4, y)
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(0, 0, 0)
          pdf.text(val, col2, y)
          y += 6.5
        })
        y += 4

        // ── Garisan nipis ──
        pdf.setDrawColor(200, 200, 200)
        pdf.setLineWidth(0.3)
        pdf.line(M, y, W - M, y)
        y += 4

        // ── Jadual keputusan ──
        const MEDAL = { 1: 'EMAS', 2: 'PERAK', 3: 'GANGSA', 4: 'T4', 5: 'T5' }
        const tblHead = isRelayAcara
          ? [['No.', 'Pasukan / Sekolah', 'Ahli Pasukan', 'Masa', 'Status']]
          : [['No.', 'Nama Atlet', 'Sekolah', 'Prestasi', 'Status']]
        const tblBody = pesertaFinal.map(p => {
          const flagged  = ['DNS', 'DNF', 'DQ'].includes(p.status)
          const qType    = !flagged && isSaringanHeat
            ? (cetakQMap.get(isRelayAcara ? p.kodSekolah : p.noBib) || null)
            : null
          const statusLabel = flagged ? p.status : (qType || (MEDAL[p.rankDalamHeat] || ''))
          const prestasi = flagged ? '—' : fmtPrestasi(p.keputusan)
          if (isRelayAcara) {
            const ahli = (p.ahliPasukan || []).map(a => a.namaAtlet || a.noBib || '').filter(Boolean).join(', ')
            return [
              String(p.rankDalamHeat),
              sekolahMap[p.kodSekolah] || p.namaSekolah || p.kodSekolah || '—',
              ahli || '—',
              prestasi,
              statusLabel,
            ]
          }
          return [
            String(p.rankDalamHeat),
            p.namaAtlet || '—',
            sekolahMap[p.kodSekolah] || p.namaSekolah || p.kodSekolah || '—',
            prestasi,
            statusLabel,
          ]
        })
        autoTable(pdf, {
          startY: y,
          head: tblHead,
          body: tblBody,
          styles: {
            fontSize: sal.tblSize,
            cellPadding: sal.tblSize >= 12 ? 3 : 2.5,
            minCellHeight: sal.tblSize >= 12 ? 8 : 7,
            overflow: 'hidden',
          },
          headStyles: {
            fillColor: sal.clr,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: sal.tblSize - 1,
            halign: 'center',
            minCellHeight: 8,
          },
          columnStyles: isRelayAcara ? {
            0: { halign: 'center', cellWidth: 12, fontStyle: 'bold' },
            1: { cellWidth: 50 },
            2: { cellWidth: 'auto' },
            3: { halign: 'center', cellWidth: 26, fontStyle: 'bold', textColor: [0, 51, 153] },
            4: { halign: 'center', cellWidth: 28, fontStyle: 'bold', textColor: [180, 60, 60] },
          } : {
            0: { halign: 'center', cellWidth: 12, fontStyle: 'bold' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 55 },
            3: { halign: 'center', cellWidth: 26, fontStyle: 'bold', textColor: [0, 51, 153] },
            4: { halign: 'center', cellWidth: 28, fontStyle: 'bold', textColor: [180, 60, 60] },
          },
          alternateRowStyles: { fillColor: [248, 248, 252] },
          margin: { left: M, right: M },
          didParseCell: (data) => {
            if (data.section === 'body') {
              const rank = pesertaFinal[data.row.index]?.rankDalamHeat
              if (rank === 1) data.cell.styles.fillColor = [255, 248, 210]
              else if (rank === 2) data.cell.styles.fillColor = [242, 242, 248]
              else if (rank === 3) data.cell.styles.fillColor = [255, 244, 232]
            }
          },
        })

        y = pdf.lastAutoTable.finalY + 5

        // ── Kotak rekod ──
        // Case A: rekod baru dipecah dalam kejohanan ini
        // Case B: rekod semasa dari koleksi (untuk rujukan juruhebah)
        if (rekodDoc) {
          const PLAB = { D: 'Daerah', N: 'Negeri', K: 'Kebangsaan' }
          const pLabel = PLAB[peringkatKej] || peringkatKej
          pdf.setLineWidth(0.3)
          pdf.setFontSize(8)

          if (isRekodBaru) {
            // ── Case A: Rekod baru ──
            const hasLama = rekodDoc.prestasiLama != null
            const boxH   = hasLama ? 18 : 14
            pdf.setFillColor(255, 248, 215)
            pdf.setDrawColor(200, 145, 30)
            pdf.rect(M, y, W - M * 2, boxH, 'FD')

            // Baris 1: rekod baru
            pdf.setFont('helvetica', 'bold')
            pdf.setTextColor(130, 60, 0)
            const newNama = rekodDoc.namaAtlet  || '—'
            const newSkol = rekodDoc.namaSekolah || sekolahMap[rekodDoc.kodSekolah] || ''
            pdf.text(
              '[RBK — REKOD BARU KEJOHANAN]  ' + fmtPrestasi(rekodDoc.prestasi) +
              '  --  ' + newNama + (newSkol ? ' (' + newSkol + ')' : ''),
              M + 3, y + 5.5
            )

            // Baris 2: rekod lama
            pdf.setFont('helvetica', 'normal')
            pdf.setFontSize(7.5)
            pdf.setTextColor(100, 70, 20)
            if (hasLama) {
              const oldP    = fmtPrestasi(rekodDoc.prestasiLama)
              const oldNama = rekodDoc.namaLama   || '—'
              const oldLok  = rekodDoc.lokasiLama || ''
              const oldThn  = rekodDoc.tahunLama  || ''
              pdf.text(
                'Rekod Lama: ' + oldP + '  --  ' + oldNama +
                (oldLok ? ' (' + oldLok + ')' : '') +
                (oldThn ? '  ' + oldThn : ''),
                M + 3, y + 12
              )
            } else {
              pdf.text('Rekod Pertama Ditetapkan', M + 3, y + 12)
            }

            pdf.setTextColor(0, 0, 0)
            y += boxH + 4

          } else {
            // ── Case B: Rekod semasa untuk rujukan ──
            pdf.setFillColor(235, 242, 255)
            pdf.setDrawColor(150, 170, 220)
            pdf.rect(M, y, W - M * 2, 10, 'FD')

            pdf.setFont('helvetica', 'normal')
            pdf.setTextColor(40, 60, 130)
            const rP    = fmtPrestasi(rekodDoc.prestasi)
            const rNama = rekodDoc.namaAtlet  || '—'
            const rSkol = rekodDoc.namaSekolah || sekolahMap[rekodDoc.kodSekolah] || ''
            const rThn  = rekodDoc.tarikhRekod ? String(rekodDoc.tarikhRekod).slice(0, 4) : ''
            pdf.text(
              'Rekod ' + pLabel + ':  ' + rP + '  --  ' + rNama +
              (rSkol ? ' (' + rSkol + ')' : '') + (rThn ? '  ' + rThn : ''),
              M + 3, y + 7
            )

            pdf.setTextColor(0, 0, 0)
            y += 14
          }
        }

        // ── Kotak MRKL — jika ada peserta menyamai rekod ──
        const mrkl = pesertaFinal.find(p => p.samaiRekod)
        if (mrkl) {
          const mrklNama = mrkl.namaAtlet || (sekolahMap[mrkl.kodSekolah] || mrkl.kodSekolah) || '—'
          const mrklSkol = isRelayAcara ? '' : (sekolahMap[mrkl.kodSekolah] || mrkl.kodSekolah || '')
          const mrklPrestasi = fmtPrestasi(mrkl.keputusan)
          pdf.setLineWidth(0.3)
          pdf.setFontSize(8)
          pdf.setFillColor(209, 250, 229)
          pdf.setDrawColor(20, 150, 100)
          pdf.rect(M, y, W - M * 2, 10, 'FD')
          pdf.setFont('helvetica', 'bold')
          pdf.setTextColor(10, 80, 50)
          pdf.text(
            '[MRKL — MENYAMAI REKOD KEJOHANAN LEPAS]  ' + mrklPrestasi +
            '  --  ' + mrklNama + (mrklSkol ? ' (' + mrklSkol + ')' : ''),
            M + 3, y + 7
          )
          pdf.setTextColor(0, 0, 0)
          y += 14
        }

        // ── Footer ──
        const footY = H - 18
        pdf.setDrawColor(...sal.clr)
        pdf.setLineWidth(0.4)
        pdf.line(M, footY, W - M, footY)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(8)
        pdf.setTextColor(80, 80, 80)
        pdf.text('Pegawai Teknikal: _______________________', M, footY + 6)
        pdf.text('Tandatangan: _______________________', W / 2, footY + 6)
        pdf.setFontSize(7)
        pdf.setTextColor(170, 170, 170)
        pdf.text(`Dicetak: ${now}`, M, footY + 12)
        pdf.setTextColor(0, 0, 0)
      }

      pdf.save(`Keputusan_No${selectedAcara.noAcara || 'Acara'}_${katLabel}.pdf`)
    } catch (e) {
      alert('Ralat cetak: ' + e.message)
    } finally {
      setCetakLoading(false)
    }
  }

  // ── Jana Final ─────────────────────────────────────────────────────────────

  async function handleJanaFinal(finalists) {
    if (!kejohananId || !selectedAcara) return
    setJanaFinalLoading(true)
    try {
      const { deleteDoc } = await import('firebase/firestore')
      const _getDocs = getDocs
      const saringanKey = selectedAcara.aceraId || selectedAcara.acaraId

      // Cari linked final acara — acara yang ada parentAcaraId === noAcara saringan
      const linkedFinalAcara = acaraList.find(a =>
        String(a.parentAcaraId) === String(selectedAcara.noAcara)
      )
      const targetAcara    = linkedFinalAcara || selectedAcara
      const targetAceraKey = targetAcara.aceraId || targetAcara.acaraId

      // Padam heat final lama dari TARGET acara (betul)
      const targetHeatSnap = await _getDocs(
        collection(db, 'kejohanan', kejohananId, 'acara', targetAceraKey, 'heat')
      )
      const finalLama = targetHeatSnap.docs.filter(d => d.data().peringkat === 'final')
      for (const lama of finalLama) {
        await deleteDoc(doc(db, 'kejohanan', kejohananId, 'acara', targetAceraKey, 'heat', lama.id))
          .catch(() => {})
      }
      // Padam juga dari saringan acara kalau ada (data lama sebelum fix)
      if (linkedFinalAcara) {
        const saringanFinalLama = heats.filter(h => h.peringkat === 'final')
        for (const lama of saringanFinalLama) {
          await deleteDoc(doc(db, 'kejohanan', kejohananId, 'acara', saringanKey, 'heat', lama.heatId))
            .catch(() => {})
        }
      }

      const newHeatId = `final_${Date.now()}`
      const isPadang  = ['padang_lompat', 'padang_balin'].includes(selectedAcara.jenisAcara)
      const saringanHeatIds = heats.filter(h => h.peringkat !== 'final').map(h => h.heatId)

      const finalPeserta = finalists.map(f => {
        const masaHeat = (f.keputusan != null && !isNaN(f.keputusan)) ? Number(f.keputusan) : null
        return {
          lorong:     (!isPadang && f.lorong != null && !isNaN(f.lorong)) ? Number(f.lorong) : null,
          noBib:      f.noBib      || '',
          namaAtlet:  f.namaAtlet  || '',
          kodSekolah: f.kodSekolah || '',
          noKP:       f.noKP       || null,
          keputusan:  null,
          kedudukan:  null,
          status:     'belum',
          dariHeat:   f.noHeat     ?? null,
          masaHeat,
        }
      })

      // Jana heat final dalam TARGET acara
      await setDoc(
        doc(db, 'kejohanan', kejohananId, 'acara', targetAceraKey, 'heat', newHeatId),
        {
          noHeat:          1,
          peringkat:       'final',
          statusKeputusan: 'belum',
          peserta:         finalPeserta,
          bilanganLorong:  finalists.length,
          createdAt:       serverTimestamp(),
          caraPilih:       selectedAcara.caraPilihFinal || 'hybrid',
          janaFinalDari:   saringanHeatIds,
          dariSaringan:    saringanKey,
        }
      )

      // Mark acara saringan — final dah dijana ke acara mana
      await updateDoc(
        doc(db, 'kejohanan', kejohananId, 'acara', saringanKey),
        { finalDijanaKe: String(targetAcara.noAcara || targetAceraKey) }
      ).catch(() => {})

      // Update local state
      const newFinalDijanaKe = String(targetAcara.noAcara || targetAceraKey)
      setAcaraList(prev => prev.map(a =>
        (a.aceraId || a.acaraId) === saringanKey
          ? { ...a, finalDijanaKe: newFinalDijanaKe }
          : a
      ))
      // Kemaskini selectedAcara supaya butang cetak terus muncul tanpa refresh
      setSelectedAcara(prev =>
        prev && (prev.aceraId || prev.acaraId || prev.id) === saringanKey
          ? { ...prev, finalDijanaKe: newFinalDijanaKe }
          : prev
      )

      if (linkedFinalAcara) {
        // Reload heats saringan (padam final lama)
        await loadHeats(selectedAcara)
        setSaved({ type: 'final', noAcara: String(linkedFinalAcara.noAcara), namaAcara: linkedFinalAcara.namaAcara })
      } else {
        // Tiada linked final acara — heat dalam saringan sendiri
        await loadHeats(selectedAcara)
      }
    } catch (e) {
      alert(`Ralat jana final: ${e.message}`)
    } finally {
      setJanaFinalLoading(false)
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return acaraList.filter(a =>
      (a.noAcara != null && String(a.noAcara).includes(q)) ||
      (a.namaAcara || '').toLowerCase().includes(q)
    )
  }, [search, acaraList])

  // ── Grouped by kategori ────────────────────────────────────────────────────

  const filteredAcaraList = useMemo(() => {
    if (filterTab === 'semua')  return acaraList
    if (filterTab === 'belum')  return acaraList.filter(a => a._drafHeat === 0 && a._rasmiHeat === 0)
    if (filterTab === 'draf')   return acaraList.filter(a => a._drafHeat > 0)
    if (filterTab === 'rasmi')  return acaraList.filter(a => a._rasmiHeat > 0)
    return acaraList
  }, [acaraList, filterTab])

  const acaraByKat = useMemo(() => {
    const groups = {}
    filteredAcaraList.forEach(a => {
      const kat = a.kategoriKod || a.kategori || 'Lain'
      if (!groups[kat]) groups[kat] = []
      groups[kat].push(a)
    })
    return groups
  }, [filteredAcaraList])

  const katKeys = [...KAT_ORDER.filter(k => acaraByKat[k]), ...Object.keys(acaraByKat).filter(k => !KAT_ORDER.includes(k))]

  // Count overall (progress bar)
  const filterCounts = useMemo(() => ({
    semua: acaraList.length,
    belum: acaraList.filter(a => a._drafHeat === 0 && a._rasmiHeat === 0).length,
    draf:  acaraList.filter(a => a._drafHeat > 0).length,
    rasmi: acaraList.filter(a => a._rasmiHeat > 0).length,
  }), [acaraList])

  // Hari tabs
  const hariList = useMemo(() => {
    const dates = [...new Set(jadualAll.map(j => j.tarikhAcara).filter(Boolean))].sort()
    return dates.map((d, i) => ({
      tarikh: d,
      label:  new Date(d + 'T00:00:00').toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' }),
      hariKe: i + 1,
    }))
  }, [jadualAll])

  // Jadual untuk hari terpilih, sort by masa → noAcara
  const jadualHari = useMemo(() => {
    if (!selectedHari) return []
    return jadualAll
      .filter(j => j.tarikhAcara === selectedHari && j.acara)
      .sort((a, b) => {
        const mA = a.masaMula || '99:99'
        const mB = b.masaMula || '99:99'
        if (mA !== mB) return mA.localeCompare(mB)
        return (a.acara?.noAcara ?? 999) - (b.acara?.noAcara ?? 999)
      })
  }, [jadualAll, selectedHari])

  // Acara hari ini terpilih selepas filter tab
  const acaraHariFiltered = useMemo(() => {
    return jadualHari.filter(j => {
      const a = j.acara
      if (filterTab === 'belum') return (a._drafHeat || 0) === 0 && (a._rasmiHeat || 0) === 0
      if (filterTab === 'draf')  return (a._drafHeat || 0) > 0
      if (filterTab === 'rasmi') return (a._rasmiHeat || 0) > 0
      return true
    })
  }, [jadualHari, filterTab])

  // Count filter untuk hari terpilih
  const hariFilterCounts = useMemo(() => {
    const items = jadualHari.map(j => j.acara)
    return {
      semua: items.length,
      belum: items.filter(a => (a._drafHeat || 0) === 0 && (a._rasmiHeat || 0) === 0).length,
      draf:  items.filter(a => (a._drafHeat || 0) > 0).length,
      rasmi: items.filter(a => (a._rasmiHeat || 0) > 0).length,
    }
  }, [jadualHari])

  // Acara tanpa jadual
  const jadualAcaraIds = useMemo(() =>
    new Set(jadualAll.map(j => j.aceraId || j.acaraId)),
  [jadualAll])

  const acaraTanpaJadual = useMemo(() =>
    acaraList.filter(a => !jadualAcaraIds.has(a.aceraId) && !jadualAcaraIds.has(a.acaraId)),
  [acaraList, jadualAcaraIds])

  // Set of noAcara yang menjadi SARINGAN (ada acara lain yg parentAcaraId = noAcara ini)
  const saringanNoAcaraSet = useMemo(() => {
    const s = new Set()
    acaraList.forEach(a => { if (a.parentAcaraId) s.add(String(a.parentAcaraId)) })
    return s
  }, [acaraList])

  function getJenisRound(acara) {
    if (acara.parentAcaraId) return 'final'
    if (saringanNoAcaraSet.has(String(acara.noAcara))) return 'saringan'
    return 'terus'
  }

  // ── Jana Final computations ────────────────────────────────────────────────

  const janaFinalEligible = useMemo(() => {
    if (!selectedAcara || heats.length === 0) return false
    // Hanya acara saringan yang perlu jana final
    const p = (selectedAcara.peringkat || '').toLowerCase()
    const n = (selectedAcara.namaAcara  || '').toLowerCase()
    const isSaringan = p.includes('saringan') || n.includes('saringan')
    if (!isSaringan) return false
    const nonFinal = heats.filter(h => h.peringkat !== 'final')
    if (nonFinal.length === 0) return false
    // Semua heat saringan mesti ada keputusan (rasmi / tidak_rasmi / diterima)
    return nonFinal.every(h => ['rasmi', 'tidak_rasmi', 'diterima'].includes(h.statusKeputusan))
  }, [heats, selectedAcara])

  // Semak jika final sudah dijana ke acara lain
  const finalDijanaKe = selectedAcara?.finalDijanaKe || null

  // Set noBib yang layak final — dari heat final jika ada, atau kira dari saringan results
  const finalisBibs = useMemo(() => {
    const finalHeat = heats.find(h => h.peringkat === 'final')
    if (finalHeat) return new Set((finalHeat.peserta || []).map(p => p.noBib).filter(Boolean))
    if (!selectedAcara) return new Set()
    const raw = _selectFinalists(heats, selectedAcara, finalSetup)
    return new Set(raw.map(f => f.noBib).filter(Boolean))
  }, [heats, selectedAcara, finalSetup])

  // Map noBib/kodSekolah → 'Q' | 'q' — untuk papar label kelayakan
  const finalisQMap = useMemo(() => {
    const finalHeat = heats.find(h => h.peringkat === 'final')
    if (finalHeat) return new Map() // final dah dijana, Q/q tak relevan
    if (!selectedAcara) return new Map()
    const isRelay = selectedAcara.jenisAcara === 'relay'
    const raw = _selectFinalists(heats, selectedAcara, finalSetup)
    const m = new Map()
    raw.forEach(f => {
      const key = isRelay ? f.kodSekolah : f.noBib
      if (key) m.set(key, f.qualifyType || 'q')
    })
    return m
  }, [heats, selectedAcara, finalSetup])

  const janaFinalists = useMemo(() => {
    if (!janaFinalEligible || !selectedAcara) return []
    const raw = _selectFinalists(heats, selectedAcara, finalSetup)
    const isPadang = ['padang_lompat', 'padang_balin'].includes(selectedAcara.jenisAcara)
    return isPadang ? raw : _assignLorong(raw, isPadang)
  }, [janaFinalEligible, heats, selectedAcara, finalSetup])

  // Atlet yang melebihi rekod Daerah (live, semasa keputusan diisi)
  const rekodBeatenBy = useMemo(() => {
    if (!acaraRekod?.D || acaraRekodConType !== 'kuat' || !selectedAcara) return []
    const rekodPrestasi = Number(acaraRekod.D.prestasi)
    if (isNaN(rekodPrestasi) || rekodPrestasi <= 0) return []
    const isPadang = ['padang_lompat', 'padang_balin'].includes(selectedAcara.jenisAcara)
    return Object.values(keputusan)
      .filter(kp => {
        if (!kp.keputusan || kp.status) return false
        const v = Number(kp.keputusan)
        if (isNaN(v) || v <= 0) return false
        return isPadang ? v > rekodPrestasi : v < rekodPrestasi
      })
      .map(kp => kp.namaAtlet || kp.noBib || '?')
  }, [acaraRekod, acaraRekodConType, selectedAcara, keputusan])

  // ── Guards ─────────────────────────────────────────────────────────────────

  // 'diterima' = status baru (flow mudah), 'rasmi'/'tidak_rasmi' = data lama
  const isDiterima         = selectedHeat?.statusKeputusan === 'diterima'
  const isRasmi            = selectedHeat?.statusKeputusan === 'rasmi' || isDiterima
  const isDalamBantahan    = selectedHeat?.statusKeputusan === 'dalam_bantahan'
  const isPublished        = selectedHeat?.statusKeputusan === 'tidak_rasmi'
  const isBantahanDiterima = isPublished && !!selectedHeat?.bantahanDiterima
  const bolehInputSekarang = bolehEdit && !isRasmi

  // Timer auto-rasmi countdown
  const timerMenit = selectedAcara?.timerAutoRasmi ?? kejohananData?.timerAutoRasmi ?? 15
  const pubMs      = tsToMs(selectedHeat?.publishedAt)
  const countdownMs = (isPublished && pubMs)
    ? Math.max(0, timerMenit * 60000 - (now - pubMs))
    : null
  const autoRasmiExpired = countdownMs === 0

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center min-h-64">
      <div className="text-center">
        <svg className="w-8 h-8 animate-spin text-[#003399] mx-auto" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <p className="text-sm text-gray-400 mt-3">Memuatkan…</p>
      </div>
    </div>
  )

  if (!kejohananId) return (
    <div className="p-8 text-center">
      <p className="text-gray-400 text-sm">Tiada kejohanan aktif.</p>
      <p className="text-gray-300 text-xs mt-1">Hubungi Admin untuk aktifkan kejohanan.</p>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full pb-12">

      {/* ── Top Bar ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 px-4 py-3">
          {step !== 'home' && (
            <button onClick={goBack} className="p-2 -ml-2 text-gray-400 hover:text-gray-700 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="flex-1 min-w-0">
            {step === 'home' && <p className="text-sm font-bold text-gray-800">Input Keputusan</p>}
            {step === 'input' && (
              <div>
                <p className="text-sm font-bold text-gray-800 truncate">
                  {selectedAcara?.noAcara ? `No.${selectedAcara.noAcara} · ` : ''}{selectedAcara?.namaAcara}
                </p>
                <p className="text-[10px] text-gray-400">
                  {heatsLoading ? 'Memuatkan…'
                    : selectedHeat
                    ? `Heat ${selectedHeat.noHeat}${selectedHeat.peringkat ? ' · ' + selectedHeat.peringkat : ''}${isRasmi ? ' · 🔒 Rasmi' : isDalamBantahan ? ' · ⚠️ Bantahan' : ''}`
                    : heats.length === 0 ? 'Tiada heat' : 'Pilih heat di bawah'}
                </p>
              </div>
            )}
          </div>
          {/* Live clock */}
          <span className="text-[10px] font-mono text-gray-400 shrink-0">{fmtJam(new Date(now))}</span>
          {/* Top-bar Simpan Draf (shortcut) */}
          {step === 'input' && bolehInputSekarang && !isPublished && (
            <button onClick={handleSave} disabled={saving}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                saved ? 'bg-green-500 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
              }`}>
              {saving ? '…' : saved ? '✓' : 'Draf'}
            </button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          STEP: HOME
      ══════════════════════════════════════════════ */}
      {step === 'home' && (
        <div className="pt-2 space-y-0">

          {/* ── Progress overall ── */}
          {acaraList.length > 0 && (
            <div className="px-4 py-2.5 bg-white border-b border-gray-100">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Progress Keseluruhan</span>
                <span className="text-[10px] font-mono font-bold text-gray-600">
                  {filterCounts.rasmi} / {acaraList.length}
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
                <div className="h-full bg-green-500 transition-all"
                  style={{ width: `${acaraList.length ? filterCounts.rasmi / acaraList.length * 100 : 0}%` }} />
                <div className="h-full bg-amber-400 transition-all"
                  style={{ width: `${acaraList.length ? filterCounts.draf / acaraList.length * 100 : 0}%` }} />
              </div>
              <div className="flex gap-3 mt-1">
                <span className="text-[9px] font-bold text-green-700">✓ {filterCounts.rasmi} Rasmi</span>
                <span className="text-[9px] font-bold text-amber-600">⏳ {filterCounts.draf} Draf</span>
                <span className="text-[9px] text-gray-400">{filterCounts.belum} Belum</span>
              </div>
            </div>
          )}

          {/* ── Search bar ── */}
          <div className="px-4 py-2 bg-white border-b border-gray-100">
            <div className="relative">
              <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-300"
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                className="w-full border border-gray-100 rounded-xl pl-9 pr-9 py-2 text-sm bg-gray-50 focus:outline-none focus:border-[#003399] focus:bg-white transition-colors"
                placeholder="Cari No. Acara atau nama acara…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* ══ SEARCH MODE ══ */}
          {search ? (
            <div className="px-4 pt-3 space-y-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                Hasil Carian — {searchResults.length} acara
              </p>
              {searchResults.length === 0
                ? <p className="text-sm text-gray-400 text-center py-10">Tiada acara dijumpai.</p>
                : searchResults.map(a => (
                  <AcaraRow key={a.acaraId} acara={a} nowMs={now} jenisRound={getJenisRound(a)} onClick={() => selectAcara(a)} />
                ))
              }
            </div>
          ) : (
            <>
              {/* ── Hari Tabs ── */}
              {hariList.length > 0 && (
                <div className="flex gap-0 overflow-x-auto border-b border-gray-100 bg-white">
                  {hariList.map(h => {
                    const isActive = h.tarikh === selectedHari
                    const isToday  = h.tarikh === new Date().toISOString().slice(0, 10)
                    return (
                      <button key={h.tarikh}
                        onClick={() => setSelectedHari(h.tarikh)}
                        className={`shrink-0 flex flex-col items-center px-4 py-2.5 border-b-2 transition-all ${
                          isActive
                            ? 'border-[#003399] text-[#003399] bg-blue-50/50'
                            : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                        }`}>
                        <span className={`text-[9px] font-bold uppercase tracking-wider ${isActive ? 'text-[#003399]' : 'text-gray-400'}`}>
                          Hari {h.hariKe}{isToday ? ' · Hari Ini' : ''}
                        </span>
                        <span className={`text-xs font-black mt-0.5 ${isActive ? 'text-[#003399]' : 'text-gray-500'}`}>
                          {h.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* ── Filter pills (per hari) ── */}
              <div className="flex gap-1.5 overflow-x-auto px-4 py-2 bg-white border-b border-gray-100">
                {[
                  { key: 'semua', label: 'Semua',    act: 'bg-[#003399] text-white',   inact: 'bg-gray-100 text-gray-500' },
                  { key: 'belum', label: 'Belum',    act: 'bg-gray-600 text-white',     inact: 'bg-gray-100 text-gray-500' },
                  { key: 'draf',  label: '⏳ Draf',  act: 'bg-amber-500 text-white',    inact: 'bg-amber-50 text-amber-700' },
                  { key: 'rasmi', label: '✓ Rasmi',  act: 'bg-green-600 text-white',    inact: 'bg-green-50 text-green-700' },
                ].map(t => (
                  <button key={t.key} onClick={() => setFilterTab(t.key)}
                    className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                      filterTab === t.key ? t.act : t.inact
                    }`}>
                    {t.label}
                    <span className={`text-[9px] font-black px-1 py-0.5 rounded-full min-w-[16px] text-center ${
                      filterTab === t.key ? 'bg-white/25 text-white' : 'bg-white text-gray-600 border border-gray-200'
                    }`}>{hariFilterCounts[t.key]}</span>
                  </button>
                ))}
              </div>

              {/* ── Jadual Acara Table ── */}
              <div className="bg-white">
                {/* Table header */}
                <div className="grid px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[9px] font-bold text-gray-400 uppercase tracking-widest"
                  style={{ gridTemplateColumns: '36px 44px 1fr 58px 64px' }}>
                  <div>No.</div>
                  <div>Masa</div>
                  <div>Acara</div>
                  <div className="text-center">Jenis</div>
                  <div className="text-right">Status</div>
                </div>

                {acaraHariFiltered.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-2xl mb-2">
                      {filterTab === 'rasmi' ? '🏆' : filterTab === 'draf' ? '⏳' : '📋'}
                    </p>
                    <p className="text-sm text-gray-400">
                      {filterTab === 'rasmi' ? 'Tiada keputusan rasmi lagi.' :
                       filterTab === 'draf'  ? 'Tiada keputusan draf.' :
                       filterTab === 'belum' ? 'Semua acara sudah ada keputusan!' :
                       selectedHari ? 'Tiada acara dijadualkan hari ini.' : 'Tiada jadual ditemui.'}
                    </p>
                  </div>
                ) : (
                  acaraHariFiltered.map((j, idx) => (
                    <AcaraRow key={j.jadualId || j.acara.acaraId}
                      acara={j.acara} masa={j.masaMula} nowMs={now}
                      jenisRound={getJenisRound(j.acara)}
                      isLast={idx === acaraHariFiltered.length - 1}
                      onClick={() => selectAcara(j.acara)} />
                  ))
                )}
              </div>

              {/* ── Acara Tanpa Jadual ── */}
              {acaraTanpaJadual.length > 0 && (
                <div className="bg-white border-t border-gray-100 mt-2">
                  <button
                    onClick={() => setTanpaJadualOpen(o => !o)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-500">Acara Tanpa Jadual</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">
                        {acaraTanpaJadual.length}
                      </span>
                    </div>
                    <svg className={`w-4 h-4 text-gray-300 transition-transform ${tanpaJadualOpen ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {tanpaJadualOpen && (
                    <div>
                      <div className="grid px-3 py-1.5 bg-gray-50 border-y border-gray-100 text-[9px] font-bold text-gray-400 uppercase tracking-widest"
                        style={{ gridTemplateColumns: '36px 44px 1fr 58px 64px' }}>
                        <div>No.</div>
                        <div>—</div>
                        <div>Acara</div>
                        <div className="text-center">Jenis</div>
                        <div className="text-right">Status</div>
                      </div>
                      {acaraTanpaJadual.map((a, idx) => (
                        <AcaraRow key={a.acaraId} acara={a} nowMs={now}
                          jenisRound={getJenisRound(a)}
                          isLast={idx === acaraTanpaJadual.length - 1}
                          onClick={() => selectAcara(a)} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════
          STEP: INPUT KEPUTUSAN
      ══════════════════════════════════════════════ */}
      {step === 'input' && selectedAcara && (
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">

          {/* ── Acara header + Heat tab bar ── */}
          <div className="bg-[#003399]/5 rounded-2xl p-3.5 border border-[#003399]/10 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-[#003399] uppercase tracking-widest">
                  No.{selectedAcara.noAcara} · {JENIS_LABEL[selectedAcara.jenisAcara] || selectedAcara.jenisAcara}
                </p>
                <p className="text-sm font-black text-gray-800 mt-0.5 leading-snug">{selectedAcara.namaAcara}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {selectedAcara.jantina === 'L' ? 'Lelaki' : selectedAcara.jantina === 'P' ? 'Perempuan' : selectedAcara.jantina}
                  {' · '}{selectedAcara.kategoriKod || selectedAcara.kategori}
                </p>
              </div>
              {selectedHeat && (() => {
                const isFH = selectedHeat.fasa === 'final'
                const hasSar = heats.some(h => h.fasa === 'heat')
                const fasaBadge = isFH ? (hasSar ? 'FINAL' : 'TERUS FINAL') : `Heat ${selectedHeat.noHeat}`
                const sCls = ['rasmi', 'diterima'].includes(selectedHeat.statusKeputusan)
                  ? 'bg-green-100 text-green-700'
                  : selectedHeat.statusKeputusan === 'tidak_rasmi' ? 'bg-amber-100 text-amber-700'
                  : selectedHeat.statusKeputusan === 'dalam_bantahan' ? 'bg-red-100 text-red-700'
                  : isFH ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'
                const sLabel = selectedHeat.statusKeputusan === 'rasmi' ? '✓ Rasmi'
                  : selectedHeat.statusKeputusan === 'diterima' ? '✓ Diterima'
                  : selectedHeat.statusKeputusan === 'tidak_rasmi' ? '⏳ Draf'
                  : selectedHeat.statusKeputusan === 'dalam_bantahan' ? '⚠ Bantahan'
                  : fasaBadge
                return (
                  <div className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold leading-none ${sCls}`}>
                    {sLabel}
                  </div>
                )
              })()}
            </div>
            {/* Heat tabs — papar jika lebih 1 heat */}
            <HeatTabBar heats={heats} selectedHeat={selectedHeat} onSelect={selectHeat} />
          </div>

          {/* ── Loading heat ── */}
          {heatsLoading && (
            <div className="flex items-center justify-center py-10 gap-2">
              <svg className="w-5 h-5 animate-spin text-[#003399]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-sm text-gray-400">Memuatkan heat…</span>
            </div>
          )}

          {/* ── Tiada heat ── */}
          {!heatsLoading && heats.length === 0 && (
            <div className="text-center py-10">
              <p className="text-2xl mb-2">📋</p>
              <p className="text-sm text-gray-400">Tiada heat untuk acara ini.</p>
              <p className="text-xs text-gray-300 mt-1">Sila jana heat melalui Tetapan Acara.</p>
            </div>
          )}

          {/* ── Kandungan utama — papar apabila heat dipilih ── */}
          {!heatsLoading && selectedHeat && (<>

          {/* ── Status Banner ── */}

          {/* Keputusan diterima — tunjuk butang Edit/Padam */}
          {isRasmi && bolehEdit && (
            <div className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-xl px-4 py-3">
              <svg className="w-4 h-4 text-teal-600 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs font-bold text-teal-700 flex-1">Keputusan Diterima</p>
              <button
                onClick={() => {
                  setSelectedHeat(prev => ({ ...prev, statusKeputusan: 'kosong' }))
                  setHeats(prev => prev.map(h => h.heatId === selectedHeat.heatId ? { ...h, statusKeputusan: 'kosong' } : h))
                }}
                className="text-[10px] font-bold px-2.5 py-1 rounded bg-white border border-teal-300 text-teal-700 hover:bg-teal-100 transition-colors"
              >
                ✏ EDIT
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="text-[10px] font-bold px-2.5 py-1 rounded bg-white border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
              >
                🗑 PADAM
              </button>
            </div>
          )}

          {/* Admin — baca sahaja */}
          {!bolehEdit && (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <svg className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0zm-3-9a9 9 0 100 18A9 9 0 0012 3z" />
              </svg>
              <div>
                <p className="text-sm font-bold text-blue-700">Paparan Sahaja</p>
                <p className="text-[11px] text-blue-500 mt-0.5">Hanya Pencatat boleh edit keputusan.</p>
              </div>
            </div>
          )}

          {/* ── Panel Rekod ── */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Rekod Acara</p>
              {acaraRekodLoading ? (
                <span className="text-[10px] text-gray-400 animate-pulse">Memuatkan...</span>
              ) : acaraRekodConType === 'kuat' ? (
                <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Sambungan Kuat</span>
              ) : acaraRekodConType === 'lemah' ? (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Sambungan Lemah</span>
              ) : acaraRekodConType === 'tiada' ? (
                <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">Tiada Rekod</span>
              ) : null}
            </div>

            {acaraRekodLoading ? (
              <div className="h-12 bg-gray-200 rounded-lg animate-pulse" />
            ) : acaraRekodConType === 'tiada' ? (
              <p className="text-[11px] text-gray-400 italic">Tiada rekod berdaftar untuk acara ini.</p>
            ) : acaraRekod ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Daerah', data: acaraRekod.D },
                    { label: 'Negeri', data: acaraRekod.N },
                    { label: 'Kebangsaan', data: acaraRekod.K },
                  ].map(({ label, data }) => (
                    <div key={label} className="bg-white rounded-lg px-2.5 py-2 border border-gray-100">
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
                      {data ? (
                        <>
                          <p className="text-xs font-black text-[#003399]">{formatPrestasiRekod(data.prestasi, data.unit)}</p>
                          <p className="text-[9px] text-gray-600 truncate leading-tight">{data.namaAtlet || '—'}</p>
                          <p className="text-[9px] text-gray-400">{tahunRekod(data.tarikhRekod)}</p>
                        </>
                      ) : (
                        <p className="text-[10px] text-gray-300 italic">—</p>
                      )}
                    </div>
                  ))}
                </div>
                {acaraRekodConType === 'lemah' && (
                  <p className="text-[10px] text-amber-600 leading-tight">
                    Format key lama — perbandingan auto tidak aktif. Baiki di Rekod Kejohanan (Admin).
                  </p>
                )}
              </>
            ) : null}

            {rekodBeatenBy.length > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="text-amber-500 font-black text-sm leading-none mt-0.5">!</span>
                <p className="text-[11px] text-amber-700 font-semibold leading-tight">
                  Melebihi Rekod Daerah: {rekodBeatenBy.join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* ── Input form (locked if rasmi or not pencatat) ── */}
          <div className={!bolehInputSekarang ? 'opacity-50 pointer-events-none select-none' : ''}>
            {selectedAcara.jenisAcara === 'lorong' && (
              <InputLorong heat={selectedHeat} acara={selectedAcara} keputusan={keputusan} finalisBibs={finalisBibs} finalisQMap={finalisQMap}
                onChange={handleChange} onWind={setWindSpeed} windSpeed={windSpeed} sekolahMap={sekolahMap} />
            )}
            {selectedAcara.jenisAcara === 'mass_start' && (
              <InputMassStart heat={selectedHeat} keputusan={keputusan} onChange={handleChange} sekolahMap={sekolahMap} finalisBibs={finalisBibs} finalisQMap={finalisQMap} />
            )}
            {['padang_lompat', 'padang_balin'].includes(selectedAcara.jenisAcara) && (
              <InputPadang acara={selectedAcara} peserta={peserta} keputusan={keputusan}
                onChange={handleChange} sekolahMap={sekolahMap} />
            )}
            {selectedAcara.jenisAcara === 'relay' && (
              <InputRelay heat={selectedHeat} acara={selectedAcara} keputusan={keputusan} onChange={handleChange} sekolahMap={sekolahMap} />
            )}
          </div>

          {/* ── Action Buttons ── */}
          {bolehInputSekarang && (
            <div className="pt-2 pb-6 space-y-3">

              {/* ── BANTAHAN: Sahkan Rasmi + Hantar Semula ── */}
              {isDalamBantahan && (() => {
                const isFinalHeatNow = ['final', 'terus_final'].includes(selectedHeat?.fasa) || heats.length === 1
                return (
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={handleHantarSemula} disabled={saving}
                      className="py-3.5 text-sm font-bold rounded-2xl border-2 border-[#003399] text-[#003399] hover:bg-[#003399]/5 disabled:opacity-50 transition-all">
                      {saving ? '…' : 'Hantar Semula'}
                    </button>
                    {isFinalHeatNow ? (
                      <div className="py-3.5 text-xs font-bold rounded-2xl bg-gray-100 text-gray-500 text-center flex items-center justify-center px-2">
                        Hubungi Admin untuk sahkan final
                      </div>
                    ) : (
                      <button onClick={handleSahkanRasmi} disabled={saving}
                        className="py-3.5 text-sm font-bold rounded-2xl bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-all">
                        {saving ? '…' : 'Sahkan Rasmi'}
                      </button>
                    )}
                  </div>
                )
              })()}

              {/* ── BELUM HANTAR: Simpan Draf + HANTAR ── */}
              {!isDalamBantahan && !isPublished && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={handleSave} disabled={saving}
                      className={`py-3.5 text-sm font-bold rounded-2xl border-2 transition-all ${
                        saved
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      } disabled:opacity-50`}>
                      {saving ? '…' : saved ? '✓ Tersimpan' : 'Simpan Draf'}
                    </button>
                    <button onClick={handleHantar} disabled={saving}
                      className="py-3.5 text-sm font-bold rounded-2xl bg-[#003399] hover:bg-[#002277] text-white disabled:bg-gray-300 transition-all">
                      {saving ? 'Menghantar…' : 'HANTAR ▶'}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 text-center">
                    Draf = simpan lokal · HANTAR = hantar untuk disahkan · auto-Rasmi dalam {timerMenit} min
                  </p>
                </div>
              )}

              {/* ── SUDAH HANTAR (tidak_rasmi): countdown + Simpan sahaja ── */}
              {isPublished && !isDalamBantahan && (
                <div className="space-y-2">
                  {/* Countdown bar */}
                  <div className={`rounded-2xl px-4 py-3 border flex items-center gap-3 ${
                    autoRasmiExpired ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                  }`}>
                    <div className="flex-1">
                      {autoRasmiExpired ? (
                        <p className="text-sm font-bold text-green-800">Menunggu konfirmasi Rasmi…</p>
                      ) : (
                        <>
                          <p className="text-xs font-bold text-amber-800">Auto-Rasmi dalam</p>
                          <p className="text-2xl font-black font-mono text-amber-700 leading-tight">
                            {fmtCountdown(countdownMs)}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[9px] text-amber-600 font-semibold">Timer: {timerMenit} min</p>
                      <p className="text-[9px] text-amber-500">Sudah dihantar</p>
                    </div>
                  </div>
                  <button onClick={handleSave} disabled={saving}
                    className={`w-full py-3 text-sm font-bold rounded-2xl border-2 transition-all ${
                      saved ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    } disabled:opacity-50`}>
                    {saving ? 'Menyimpan…' : saved ? '✓ Data Dikemas Kini' : 'Kemaskini Data'}
                  </button>
                  <p className="text-[10px] text-gray-400 text-center">
                    Keputusan sudah dihantar · kemaskini data tidak akan reset timer
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Cetak Hasil Final ── */}
          {(() => {
            const isFinalHeatType = ['final', 'terus_final'].includes(selectedHeat?.fasa) || heats.length === 1
            const isSaringanAcara = (selectedAcara?.peringkat || '').toLowerCase().includes('saringan')
            const bolehCetak = isRasmi && isFinalHeatType && !isSaringanAcara
            if (!bolehCetak) return null
            return (
              <div className="pb-4">
                <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-green-800">✓ Keputusan Rasmi — Sedia untuk Cetak</p>
                    <div className="flex items-center gap-1 bg-white border border-green-200 rounded-lg p-0.5">
                      {[3, 4, 5].map(n => (
                        <button key={n}
                          onClick={() => setCetakBilangan(n)}
                          className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                            cetakBilangan === n
                              ? 'bg-[#003399] text-white'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}>
                          {n} pemenang
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={handleCetakHasil}
                    disabled={cetakLoading}
                    className="w-full py-3 text-sm font-bold rounded-xl bg-[#003399] hover:bg-[#002277] text-white disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {cetakLoading ? (
                      <span>Menjana PDF…</span>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        <span>Cetak Keputusan (Juruhebah / Hadiah / Fail)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })()}

          {/* ── Jana Final Panel — tunjuk bila semua heat saringan selesai ── */}
          {janaFinalEligible && janaFinalists.length > 0 && (
            <div className="pb-6">
              <JanaFinalPanel
                finalists={janaFinalists}
                acara={selectedAcara}
                sekolahMap={sekolahMap}
                onJana={handleJanaFinal}
                loading={janaFinalLoading}
                finalSetup={finalSetup}
                finalDijanaKe={finalDijanaKe}
              />
            </div>
          )}

          {/* ── Final sudah dijana — makluman ── */}
          {finalDijanaKe && !janaFinalEligible && (
            <div className="pb-6">
              <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                <span className="text-green-500 text-lg">✓</span>
                <div>
                  <p className="text-xs font-black text-green-700">Final Sudah Dijana</p>
                  <p className="text-[11px] text-green-600 mt-0.5">
                    Pergi <span className="font-bold">Acara #{finalDijanaKe}</span> untuk masukkan keputusan final
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Cetak Senarai Layak ke Final ── */}
          {(() => {
            const hasSaringanHeats = heats.some(h =>
              !['final', 'terus_final'].includes(h.fasa) && h.peringkat !== 'final'
            )
            if (!hasSaringanHeats) return null

            // Final belum dijana — tunjuk amaran
            if (janaFinalEligible && !finalDijanaKe) {
              return (
                <div className="pb-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-3">
                    <span className="text-amber-500 text-base mt-0.5">⚠</span>
                    <div>
                      <p className="text-xs font-black text-amber-700">Sila Jana Final Dahulu</p>
                      <p className="text-[11px] text-amber-600 mt-0.5">
                        Jana final terlebih dahulu sebelum cetak senarai layak ke final.
                      </p>
                    </div>
                  </div>
                </div>
              )
            }

            // Final sudah dijana — tunjuk butang cetak
            if (!finalDijanaKe) return null
            return (
              <div className="pb-4">
                <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 space-y-2">
                  <p className="text-xs font-black text-blue-800">Start List Final</p>
                  <p className="text-[11px] text-blue-600">
                    Acara final: <span className="font-bold">#{finalDijanaKe}</span>
                    {' '}— Start List 4 salinan: Juruhebah · Call Room · Teknikal · Fail
                  </p>
                  <button
                    onClick={handleCetakLayakFinal}
                    disabled={cetakLayakLoading}
                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cetakLayakLoading ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                        Jana PDF...
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2"/>
                          <path d="M9 21h6a1 1 0 001-1v-5H8v5a1 1 0 001 1z"/>
                          <path d="M7 7V3h10v4"/>
                        </svg>
                        Cetak Start List Final (4 Salinan)
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })()}

          </>)} {/* end: selectedHeat content */}
        </div>
      )}
    </div>
  )
}
