/**
 * migrate-kategoriKod.mjs
 *
 * R6 FIX: Betulkan kategoriKod dalam semua pendaftaran docs.
 * kiraKategori lama tidak tapis jantina → semua atlet dapat kategori urutan-1.
 * Script ini kira semula dan update docs yang salah.
 *
 * Jalankan: node scripts/migrate-kategoriKod.mjs
 */

import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            'AIzaSyDLgrBGDgzuwlCw61R3_XzQH_B9XFNGHzA',
  authDomain:        'mssdkemaman-olahraga.firebaseapp.com',
  projectId:         'mssdkemaman-olahraga',
  storageBucket:     'mssdkemaman-olahraga.firebasestorage.app',
  messagingSenderId: '1021868021960',
  appId:             '1:1021868021960:web:f761065d822d025f59edfd',
}

const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)

// ─── kiraKategori BETUL (sama dengan fix dalam PendaftaranSetup.jsx) ──────────
function kiraKategori(tarikhLahir, jantina, tahunKejohanan, kategoriList = []) {
  if (!tarikhLahir || !tahunKejohanan) return null
  const tahunLahir = new Date(tarikhLahir).getFullYear()
  const umur = tahunKejohanan - tahunLahir

  if (kategoriList.length > 0) {
    const filtered = kategoriList.filter(k => {
      const label = (k.label || '').toUpperCase()
      if (label.includes('OPEN')) return false
      if (jantina === 'L' && !label.startsWith('L')) return false
      if (jantina === 'P' && !label.startsWith('P')) return false
      return true
    })
    const candidates = filtered.filter(k => umur >= (k.umurMin || 0) && umur <= k.umurHad)
    if (candidates.length === 0) return null
    candidates.sort((a, b) => a.umurHad - b.umurHad)
    return candidates[0].kod
  }
  return null
}

async function main() {
  console.log('=== Migrate kategoriKod ===\n')

  // 1. Load kategori list
  const katSnap = await getDocs(collection(db, 'kategori'))
  const kategoriList = katSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`Kategori loaded: ${kategoriList.length}`)
  kategoriList.forEach(k => console.log(`  ${k.kod} — ${k.label} (umur ${k.umurMin||0}-${k.umurHad})`))
  console.log()

  // 2. Load semua kejohanan
  const kejSnap = await getDocs(collection(db, 'kejohanan'))
  let totalChecked = 0, totalUpdated = 0, totalSkipped = 0

  for (const kejDoc of kejSnap.docs) {
    const kejId = kejDoc.id
    const kej   = kejDoc.data()
    const tahunKej = kej.tarikhMula
      ? new Date(kej.tarikhMula.toDate?.() || kej.tarikhMula).getFullYear()
      : new Date().getFullYear()

    console.log(`\nKejohanan: ${kej.namaKejohanan || kejId} (tahun ${tahunKej})`)

    // 3. Load pendaftaran untuk kejohanan ini
    const pendSnap = await getDocs(collection(db, 'kejohanan', kejId, 'pendaftaran'))
    console.log(`  Pendaftaran: ${pendSnap.size} atlet`)

    for (const pendDoc of pendSnap.docs) {
      const pend = pendDoc.data()
      totalChecked++

      if (!pend.tarikhLahir || !pend.jantina) {
        console.log(`  [SKIP] ${pend.namaAtlet || pendDoc.id} — tiada tarikhLahir/jantina`)
        totalSkipped++
        continue
      }

      const betul = kiraKategori(pend.tarikhLahir, pend.jantina, tahunKej, kategoriList)
      const lama  = pend.kategoriKod

      if (betul === lama) continue // ok, tiada perubahan

      console.log(`  [FIX] ${pend.namaAtlet} (${pend.jantina}, ${pend.tarikhLahir}): ${lama || 'null'} → ${betul || 'null'}`)
      await updateDoc(
        doc(db, 'kejohanan', kejId, 'pendaftaran', pendDoc.id),
        { kategoriKod: betul, updatedAt: serverTimestamp() }
      )
      totalUpdated++
    }
  }

  console.log('\n=== Selesai ===')
  console.log(`Diperiksa : ${totalChecked}`)
  console.log(`Dikemaskini: ${totalUpdated}`)
  console.log(`Dilangkau : ${totalSkipped}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
