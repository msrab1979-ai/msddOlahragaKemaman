/**
 * migrate-pin-hash.mjs
 *
 * R7 FIX: Hash semua PIN sekolah (dan users) yang masih plain text.
 * Selepas migration: field `pin` dipadam, `pinHash` disimpan.
 *
 * Jalankan: node scripts/migrate-pin-hash.mjs
 */

import { initializeApp } from 'firebase/app'
import { getFirestore, collection, getDocs, doc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import { createHash, pbkdf2 } from 'crypto'
import { promisify } from 'util'

const pbkdf2Async = promisify(pbkdf2)

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

// Hash PIN menggunakan Node.js crypto (PBKDF2-SHA256, sama dengan browser)
async function hashPin(pin) {
  const SALT       = 'MSSDKEMAMAN_OLAHRAGA_KOAM_v1'
  const ITERATIONS = 10000
  const key = await pbkdf2Async(String(pin), SALT, ITERATIONS, 32, 'sha256')
  return key.toString('hex')
}

async function migrateCollection(collName, pinField = 'pin') {
  console.log(`\n── ${collName} ──`)
  const snap = await getDocs(collection(db, collName))
  let migrated = 0, alreadyDone = 0, skipped = 0

  for (const d of snap.docs) {
    const data = d.data()

    if (data.pinHash && !data[pinField]) {
      alreadyDone++
      continue // sudah migrate
    }

    if (!data[pinField]) {
      console.log(`  [SKIP] ${d.id} — tiada field '${pinField}'`)
      skipped++
      continue
    }

    const ph = await hashPin(data[pinField])
    await updateDoc(doc(db, collName, d.id), {
      pinHash:         ph,
      [pinField]:      deleteField(),
      updatedAt:       serverTimestamp(),
    })
    console.log(`  [OK] ${d.id} — pin hashed`)
    migrated++
  }

  console.log(`  Selesai: ${migrated} migrate, ${alreadyDone} dah ok, ${skipped} langkau`)
  return migrated
}

async function main() {
  console.log('=== Migrate PIN Hash ===\n')

  const s = await migrateCollection('sekolah')
  const u = await migrateCollection('users')

  console.log(`\n=== Jumlah: ${s + u} rekod di-hash ===`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
