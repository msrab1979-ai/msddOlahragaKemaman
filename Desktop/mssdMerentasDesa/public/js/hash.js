import { db } from './firebase-config.js'
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'

async function sha256(text) {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function hashNoKP(noKP) {
  const clean = noKP.replace(/-/g, '').trim()
  return await sha256(clean)
}

export function maskNoKP(noKP) {
  const parts = noKP.split('-')
  if (parts.length === 3) {
    return `${parts[0]}-**-****`
  }
  const clean = noKP.replace(/-/g, '').trim()
  if (clean.length >= 6) {
    return `${clean.substring(0, 6)}-**-****`
  }
  return '******-**-****'
}

export async function verifyNoKP(noKP, storedHash) {
  const hash = await hashNoKP(noKP)
  return hash === storedHash
}

export async function isDuplicateAtlet(noKP, kategoriId, atletIdEdit = null) {
  const hash = await hashNoKP(noKP)
  const q = query(
    collection(db, 'atlet'),
    where('noKPHash', '==', hash),
    where('kategoriId', '==', kategoriId),
    where('aktif', '==', true)
  )
  const snap = await getDocs(q)
  const conflict = snap.docs.filter(d => d.id !== atletIdEdit)
  return conflict.length > 0
}
