/**
 * ManualPendaftaran.jsx — /dashboard/manual
 *
 * Panduan pendaftaran atlet untuk Pengurus Pasukan.
 * Data had acara & had peserta dibaca LIVE dari Firestore supaya
 * sentiasa terkini apabila admin ubah tetapan.
 *
 * Roles: pengurus_pasukan (+ superadmin, admin untuk semak)
 */

import { useState, useEffect } from 'react'
import {
  collection, getDocs, getDoc, doc, query, where,
  orderBy,
} from 'firebase/firestore'
import { db } from '../../firebase/config'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SeksyenHdr({ nombor, tajuk, sub }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="w-8 h-8 rounded-full bg-[#003399] text-white text-sm font-black flex items-center justify-center shrink-0 mt-0.5">
        {nombor}
      </div>
      <div>
        <h2 className="text-sm font-bold text-[#003399]">{tajuk}</h2>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function Langkah({ bil, teks, nota }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="w-6 h-6 rounded-full bg-blue-100 text-[#003399] text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
        {bil}
      </span>
      <div>
        <p className="text-xs text-gray-700">{teks}</p>
        {nota && (
          <p className="text-[10px] text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1.5 border border-amber-100">
            ⚠ {nota}
          </p>
        )}
      </div>
    </div>
  )
}

function AmaranKotak({ children }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-3">
      <span className="text-base shrink-0 mt-0.5">🚫</span>
      <div className="text-[11px] text-red-700 leading-relaxed">{children}</div>
    </div>
  )
}

function InfoKotak({ icon = 'ℹ️', children }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex gap-3">
      <span className="text-base shrink-0 mt-0.5">{icon}</span>
      <div className="text-[11px] text-blue-800 leading-relaxed">{children}</div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManualPendaftaran() {
  const [loading,      setLoading]      = useState(true)
  const [kategoriList, setKategoriList] = useState([])
  const [acaraList,    setAcaraList]    = useState([])
  const [namaKej,      setNamaKej]      = useState('')
  const [tahunKej,     setTahunKej]     = useState(new Date().getFullYear())
  const [err,          setErr]          = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        // Kejohanan aktif — untuk nama & tahun
        const kejSnap = await getDocs(query(
          collection(db, 'kejohanan'),
          where('statusKejohanan', '==', 'aktif')
        ))
        let kejId = null
        if (!kejSnap.empty) {
          const kd = kejSnap.docs[0].data()
          kejId = kejSnap.docs[0].id
          setNamaKej(kd.namaKejohanan || '')
          if (kd.tarikhMula) {
            const t = kd.tarikhMula?.toDate?.() || new Date(kd.tarikhMula)
            setTahunKej(t.getFullYear())
          }
        }

        // Kategori — had acara individu & beregu (live)
        const katSnap = await getDocs(query(
          collection(db, 'kategori'),
          orderBy('umurHad')
        ))
        setKategoriList(katSnap.docs.map(d => ({ id: d.id, ...d.data() })))

        // Acara — had atlet per sekolah (live), dari kejohanan aktif
        if (kejId) {
          const acaraSnap = await getDocs(query(
            collection(db, 'kejohanan', kejId, 'acara'),
            orderBy('noAcara')
          ))
          setAcaraList(acaraSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        }
      } catch (e) {
        console.warn('[ManualPendaftaran] load error:', e.message)
        setErr('Gagal memuatkan data. Sila muat semula halaman.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-gray-400 text-sm">
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Memuatkan panduan…
      </div>
    )
  }

  // Kumpul acara mengikut jenisAcara untuk paparan had
  const acaraIndividu = acaraList.filter(a => !a.isRelay && a.jenisAcara !== 'relay')
  const acaraRelay    = acaraList.filter(a =>  a.isRelay || a.jenisAcara === 'relay')

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

      {/* ── Header ── */}
      <div className="bg-[#003399] rounded-2xl px-5 py-5 text-white">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
          Panduan Rasmi
        </p>
        <h1 className="text-base font-black leading-snug">Pendaftaran Atlet</h1>
        <p className="text-[11px] text-white/60 mt-1">
          Untuk Pengurus Pasukan
          {namaKej ? ` — ${namaKej}` : ''}
        </p>

        {/* Badge kemaskini */}
        <div className="mt-3 inline-flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] text-white/80">Data terkini dari sistem</span>
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
          {err}
        </div>
      )}

      {/* ════════════════════════════════════════════════
          SEKSYEN 1 — CARA MENDAFTAR MURID (ATLET)
      ════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <SeksyenHdr
          nombor="1"
          tajuk="Cara Mendaftar Murid (Atlet)"
          sub="Daftar profil murid sebagai atlet dalam sistem"
        />

        <div className="space-y-0 mb-4">
          <Langkah bil="1" teks='Pergi ke menu "Pendaftaran Atlet" di bar sisi.' />
          <Langkah bil="2" teks='Pilih tab "Atlet Saya" (tab pertama).' />
          <Langkah bil="3" teks='Klik butang "+ Tambah Atlet".' />
          <Langkah
            bil="4"
            teks="Isi maklumat atlet: No. Kad Pengenalan (12 digit), nama penuh, tarikh lahir, jantina."
            nota="No. Kad Pengenalan adalah wajib dan mesti tepat. Ia digunakan sebagai nombor unik atlet dalam sistem."
          />
          <Langkah
            bil="5"
            teks="Masukkan No. Dada (BIB) untuk atlet. Sistem akan cadangkan nombor seterusnya secara automatik."
          />
          <Langkah bil="6" teks='Klik "Simpan". Profil atlet akan disimpan dalam sistem.' />
        </div>

        <InfoKotak icon="📋">
          <strong>Kategori dikira automatik.</strong> Sistem akan kira kategori (A, B, C, D, E atau PPKI) berdasarkan
          tarikh lahir dan tahun kejohanan ({tahunKej}). Anda tidak perlu pilih kategori secara manual.
        </InfoKotak>
      </div>

      {/* ════════════════════════════════════════════════
          SEKSYEN 2 — CARA DAFTAR ACARA
      ════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <SeksyenHdr
          nombor="2"
          tajuk="Cara Mendaftar Atlet ke Acara"
          sub="Daftarkan atlet anda ke acara dalam kejohanan"
        />

        <div className="space-y-0 mb-4">
          <Langkah bil="1" teks='Pergi ke menu "Pendaftaran Atlet" di bar sisi.' />
          <Langkah bil="2" teks='Pilih tab "Daftar Acara".' />
          <Langkah bil="3" teks="Pilih kejohanan dari senarai (jika ada lebih dari satu)." />
          <Langkah bil="4" teks="Cari atlet anda — taip nama atau No. BIB dalam kotak carian." />
          <Langkah bil="5" teks='Klik nama atlet, kemudian klik "Daftar ke Acara".' />
          <Langkah
            bil="6"
            teks="Pilih acara yang bersesuaian dengan kategori dan jantina atlet."
            nota="Sistem hanya akan tunjukkan acara yang layak untuk atlet tersebut berdasarkan kategori dan jantina."
          />
          <Langkah
            bil="7"
            teks='Klik "Daftar". Pendaftaran akan disimpan dan No. BIB akan dikunci.'
          />
        </div>

        <InfoKotak icon="📅">
          <strong>Konflik jadual.</strong> Sistem akan semak secara automatik jika masa acara bertindih.
          Jika dua acara berlangsung pada masa yang sama, sistem akan beri <strong>amaran sahaja</strong> —
          pendaftaran masih boleh diteruskan.
        </InfoKotak>
      </div>

      {/* ════════════════════════════════════════════════
          SEKSYEN 3 — ANALISA PENDAFTARAN
      ════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <SeksyenHdr
          nombor="3"
          tajuk='Tab "Analisa Pendaftaran"'
          sub="Semak status pendaftaran atlet anda bagi setiap acara"
        />

        <div className="space-y-0 mb-4">
          <Langkah bil="1" teks='Pergi ke menu "Pendaftaran Atlet" di bar sisi.' />
          <Langkah bil="2" teks='Klik tab "Analisa".' />
          <Langkah
            bil="3"
            teks="Jadual akan tunjukkan semua acara yang berkenaan dengan kategori sekolah anda, dikumpulkan mengikut kategori."
          />
        </div>

        {/* Penjelasan status */}
        <div className="rounded-xl border border-gray-200 overflow-hidden mb-4">
          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
            <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wide">Status dalam Jadual Analisa</p>
          </div>
          <div className="divide-y divide-gray-100">
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 mt-0.5">
                ✓ Daftar
              </span>
              <p className="text-[11px] text-gray-600">
                Sekolah anda <strong>sudah mendaftarkan atlet</strong> ke acara ini. Catatan "Cukup kuota" bermaksud bilangan atlet masih dalam had yang ditetapkan.
              </p>
            </div>
            <div className="px-4 py-3 flex items-start gap-3">
              <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 mt-0.5">
                ✗ Belum
              </span>
              <p className="text-[11px] text-gray-600">
                Tiada atlet dari sekolah anda yang didaftarkan ke acara ini. Pergi ke tab <strong>"Daftar Acara"</strong> untuk mendaftar.
              </p>
            </div>
          </div>
        </div>

        <InfoKotak icon="📋">
          Jadual ini <strong>automatik dikemaskini</strong> mengikut pendaftaran semasa.
          Gunakan tab ini untuk semak sama ada semua acara yang disasarkan sudah didaftarkan sebelum tarikh tutup.
        </InfoKotak>
      </div>

      {/* ════════════════════════════════════════════════
          SEKSYEN 4 — PENGESAHAN PENDAFTARAN
      ════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <SeksyenHdr
          nombor="4"
          tajuk='Tab "Pengesahan Pendaftaran"'
          sub='Sahkan dan kunci pendaftaran sekolah anda — langkah akhir sebelum kejohanan'
        />

        {/* Warna tab */}
        <div className="rounded-xl border border-gray-200 overflow-hidden mb-4">
          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
            <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wide">Warna Tab Pengesahan Pendaftaran</p>
          </div>
          <div className="divide-y divide-gray-100">
            <div className="px-4 py-3 flex items-center gap-3">
              <span className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-blue-50 text-[#003399] shrink-0 border border-blue-200">
                Biru ●
              </span>
              <p className="text-[11px] text-gray-600">
                <strong>Bersedia.</strong> Start list telah dijana oleh penganjur. Anda boleh semak senarai giliran (heat) pasukan anda, kemudian klik "Sahkan &amp; Kunci".
              </p>
            </div>
            <div className="px-4 py-3 flex items-center gap-3">
              <span className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-gray-100 text-gray-400 shrink-0 border border-gray-200">
                Kelabu
              </span>
              <p className="text-[11px] text-gray-600">
                <strong>Belum bersedia.</strong> Penganjur belum jana start list. Tiada tindakan diperlukan — sila tunggu notifikasi dari penganjur.
              </p>
            </div>
            <div className="px-4 py-3 flex items-center gap-3">
              <span className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-green-50 text-green-700 shrink-0 border border-green-200">
                Hijau ✓
              </span>
              <p className="text-[11px] text-gray-600">
                <strong>Dikunci.</strong> Anda telah mengesahkan. Pendaftaran dikunci — hubungi penganjur untuk sebarang perubahan.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-0 mb-4">
          <Langkah bil="1" teks='Tunggu tab "Pengesahan Pendaftaran" bertukar warna BIRU.' nota="Tab berwarna kelabu bermaksud start list belum tersedia. Tiada tindakan perlu." />
          <Langkah bil="2" teks='Klik tab "Pengesahan Pendaftaran" dan semak senarai giliran (heat) atlet anda.' />
          <Langkah bil="3" teks='Pastikan semua maklumat (nama atlet, no. BIB, giliran) adalah betul.' />
          <Langkah
            bil="4"
            teks='Klik butang "Sahkan & Kunci".'
            nota="AMARAN: Tindakan ini akan mengunci pendaftaran. Tiada perubahan boleh dibuat melalui sistem selepas pengesahan."
          />
        </div>

        <AmaranKotak>
          Pengesahan adalah <strong>tidak boleh dibatalkan</strong> melalui sistem. Setelah disahkan,
          hubungi terus penganjur kejohanan untuk sebarang pembetulan.
        </AmaranKotak>
      </div>

      {/* ════════════════════════════════════════════════
          SEKSYEN 5 — PERATURAN NO. DADA (BIB)
      ════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <SeksyenHdr
          nombor="5"
          tajuk="Peraturan No. Dada (BIB)"
          sub="No. dada adalah identiti fizikal atlet di padang"
        />

        <AmaranKotak>
          <strong>Setiap atlet dalam sekolah anda MESTI mempunyai No. Dada yang berbeza.</strong>{' '}
          Dua atlet dari sekolah yang sama tidak boleh berkongsi no. dada yang sama.
          Sistem akan sekat pendaftaran jika nombor yang sama digunakan semula.
        </AmaranKotak>

        <div className="mt-4 space-y-2">
          <div className="flex items-start gap-2.5 text-xs text-gray-600">
            <span className="text-green-500 font-bold shrink-0 mt-0.5">✓</span>
            <span>No. dada boleh sama antara <strong>sekolah yang berbeza</strong> — contoh: SK A guna BIB001 dan SK B guna BIB001 adalah dibenarkan.</span>
          </div>
          <div className="flex items-start gap-2.5 text-xs text-gray-600">
            <span className="text-red-500 font-bold shrink-0 mt-0.5">✗</span>
            <span>No. dada <strong>TIDAK BOLEH</strong> sama dalam sekolah yang sama — contoh: dua atlet dari SK A menggunakan BIB001 adalah <strong>tidak dibenarkan</strong>.</span>
          </div>
          <div className="flex items-start gap-2.5 text-xs text-gray-600">
            <span className="text-blue-500 font-bold shrink-0 mt-0.5">ℹ</span>
            <span>Sistem akan cadangkan nombor seterusnya secara automatik semasa tambah atlet baru.</span>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════
          SEKSYEN 6 — HAD ACARA PER INDIVIDU (LIVE)
      ════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <SeksyenHdr
          nombor="6"
          tajuk="Had Acara Per Individu"
          sub="Bilangan acara maksimum yang boleh disertai oleh seorang atlet"
        />

        <InfoKotak icon="🔄">
          Had ini ditetapkan oleh penganjur dan boleh berubah. Data di bawah adalah
          <strong> terkini dari sistem</strong> pada masa ini.
        </InfoKotak>

        {kategoriList.length === 0 ? (
          <p className="text-xs text-gray-400 mt-4 text-center py-4">
            Tiada data kategori. Hubungi pentadbir.
          </p>
        ) : (
          <div className="mt-4 rounded-xl border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="grid bg-[#003399] text-white text-[10px] font-bold uppercase tracking-wider"
              style={{ gridTemplateColumns: '1fr 80px 80px 80px' }}>
              <div className="px-4 py-2.5">Kategori</div>
              <div className="px-2 py-2.5 text-center">Umur</div>
              <div className="px-2 py-2.5 text-center">Individu</div>
              <div className="px-2 py-2.5 text-center">Beregu</div>
            </div>

            {kategoriList.map((kat, i) => {
              const isOdd = i % 2 === 1
              const isPPKI = kat.id === 'PPKI'
              return (
                <div
                  key={kat.id}
                  className={`grid border-t border-gray-100 ${isOdd ? 'bg-gray-50/60' : 'bg-white'}`}
                  style={{ gridTemplateColumns: '1fr 80px 80px 80px' }}
                >
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-gray-800">
                      {kat.nama || `Kategori ${kat.id}`}
                      <span className={`ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        isPPKI
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>Kat {kat.id}</span>
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {isPPKI
                        ? 'Pendidikan Khas'
                        : `Lahir ${kat.umurMin != null && kat.umurHad != null
                            ? `${tahunKej - kat.umurHad}–${tahunKej - kat.umurMin}`
                            : '—'
                          }`
                      }
                    </p>
                  </div>
                  <div className="px-2 py-3 flex items-center justify-center">
                    <span className="text-[10px] text-gray-500">
                      {kat.umurMin != null && kat.umurHad != null
                        ? `${kat.umurMin}–${kat.umurHad} thn`
                        : isPPKI ? 'Khas' : '—'
                      }
                    </span>
                  </div>
                  <div className="px-2 py-3 flex items-center justify-center">
                    <span className="text-sm font-black text-[#003399]">
                      {kat.hadAcaraIndividu ?? 3}
                    </span>
                    <span className="text-[9px] text-gray-400 ml-0.5">acara</span>
                  </div>
                  <div className="px-2 py-3 flex items-center justify-center">
                    <span className="text-sm font-black text-emerald-600">
                      {kat.hadAcaraBeregu ?? 2}
                    </span>
                    <span className="text-[9px] text-gray-400 ml-0.5">acara</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[10px] text-gray-400 mt-3">
          * Beregu termasuk acara relay dan acara berpasukan.
          Sistem akan sekat pendaftaran jika had dicapai.
        </p>
      </div>

      {/* ════════════════════════════════════════════════
          SEKSYEN 7 — HAD PESERTA PER ACARA (LIVE)
      ════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <SeksyenHdr
          nombor="7"
          tajuk="Had Peserta Per Acara"
          sub="Bilangan atlet maksimum dari sekolah anda bagi setiap acara"
        />

        <InfoKotak icon="🔄">
          Had ini ditetapkan secara individu bagi setiap acara dan boleh berubah.
          Data di bawah adalah <strong>terkini dari sistem</strong>.
        </InfoKotak>

        {acaraList.length === 0 ? (
          <div className="mt-4 bg-gray-50 rounded-xl py-8 text-center">
            <p className="text-2xl mb-2">📋</p>
            <p className="text-xs text-gray-400">
              Tiada acara ditemui.{' '}
              {!namaKej && 'Tiada kejohanan aktif.'}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {/* Acara Individu */}
            {acaraIndividu.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 px-1">
                  Acara Individu ({acaraIndividu.length} acara)
                </p>
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="grid bg-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-wider"
                    style={{ gridTemplateColumns: '40px 1fr 60px 60px 50px' }}>
                    <div className="px-2 py-2 text-center">No.</div>
                    <div className="px-3 py-2">Nama Acara</div>
                    <div className="px-2 py-2 text-center">Kat</div>
                    <div className="px-2 py-2 text-center">Jan</div>
                    <div className="px-2 py-2 text-center">Had</div>
                  </div>
                  {acaraIndividu.map((a, i) => (
                    <div
                      key={a.id}
                      className={`grid border-t border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'}`}
                      style={{ gridTemplateColumns: '40px 1fr 60px 60px 50px' }}
                    >
                      <div className="px-2 py-2.5 flex items-center justify-center">
                        <span className="text-[10px] font-mono text-gray-400">{a.noAcara || '—'}</span>
                      </div>
                      <div className="px-3 py-2.5 flex items-center">
                        <span className="text-[11px] text-gray-700">{a.namaAcara || '—'}</span>
                      </div>
                      <div className="px-2 py-2.5 flex items-center justify-center">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          a.kategoriKod === 'PPKI'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>{a.kategoriKod || '—'}</span>
                      </div>
                      <div className="px-2 py-2.5 flex items-center justify-center">
                        <span className={`text-[10px] font-semibold ${
                          a.jantina === 'L' ? 'text-blue-600' : 'text-rose-500'
                        }`}>
                          {a.jantina === 'L' ? 'Lelaki' : a.jantina === 'P' ? 'Perempuan' : '—'}
                        </span>
                      </div>
                      <div className="px-2 py-2.5 flex items-center justify-center">
                        <span className="text-sm font-black text-[#003399]">
                          {a.hadAtletPerSekolah ?? 2}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Acara Relay */}
            {acaraRelay.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 px-1">
                  Acara Relay / Beregu ({acaraRelay.length} acara)
                </p>
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="grid bg-gray-100 text-[10px] font-bold text-gray-500 uppercase tracking-wider"
                    style={{ gridTemplateColumns: '40px 1fr 60px 60px 70px' }}>
                    <div className="px-2 py-2 text-center">No.</div>
                    <div className="px-3 py-2">Nama Acara</div>
                    <div className="px-2 py-2 text-center">Kat</div>
                    <div className="px-2 py-2 text-center">Jan</div>
                    <div className="px-2 py-2 text-center">Ahli Pasukan</div>
                  </div>
                  {acaraRelay.map((a, i) => (
                    <div
                      key={a.id}
                      className={`grid border-t border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'}`}
                      style={{ gridTemplateColumns: '40px 1fr 60px 60px 70px' }}
                    >
                      <div className="px-2 py-2.5 flex items-center justify-center">
                        <span className="text-[10px] font-mono text-gray-400">{a.noAcara || '—'}</span>
                      </div>
                      <div className="px-3 py-2.5 flex items-center">
                        <span className="text-[11px] text-gray-700">{a.namaAcara || '—'}</span>
                      </div>
                      <div className="px-2 py-2.5 flex items-center justify-center">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          a.kategoriKod === 'PPKI'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>{a.kategoriKod || '—'}</span>
                      </div>
                      <div className="px-2 py-2.5 flex items-center justify-center">
                        <span className={`text-[10px] font-semibold ${
                          a.jantina === 'L' ? 'text-blue-600' : 'text-rose-500'
                        }`}>
                          {a.jantina === 'L' ? 'Lelaki' : a.jantina === 'P' ? 'Perempuan' : '—'}
                        </span>
                      </div>
                      <div className="px-2 py-2.5 flex items-center justify-center">
                        <span className="text-sm font-black text-emerald-600">
                          {a.hadAtletPerSekolah ?? 6}
                        </span>
                        <span className="text-[9px] text-gray-400 ml-0.5">ahli</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════
          FOOTER — Bantuan
      ════════════════════════════════════════════════ */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-4 text-center">
        <p className="text-xs font-semibold text-gray-600 mb-1">Perlukan Bantuan?</p>
        <p className="text-[11px] text-gray-400">
          Hubungi penganjur atau pentadbir sistem untuk sebarang pertanyaan mengenai pendaftaran.
        </p>
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-gray-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          Data dikemaskini secara langsung dari Sistem KOAM
        </div>
      </div>

    </div>
  )
}
