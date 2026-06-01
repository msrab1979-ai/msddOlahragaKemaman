/**
 * auth.js — Helper auth KOAM
 *
 * 3 jenis login:
 * 1. Superadmin     — Firebase Auth (email + password)
 * 2. Pencatat/Urusetia/Admin/Pengurus Teknik
 *                   — Firestore `users` (kodAkses + PIN) → sessionStorage
 * 3. Pengurus Pasukan
 *                   — Firestore `sekolah` (kodSekolah + PIN) → sessionStorage
 *
 * KESELAMATAN:
 * - PIN disimpan sebagai PBKDF2 hash (pinHash) — bukan plain text (R7 fix)
 * - Rate limiting: 5 percubaan gagal → kunci 30 minit (R-NEW-3 fix)
 * - Fallback: jika pinHash tiada, guna pin lama (migration path — akan hilang selepas semua sekolah migrate)
 */

import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
} from 'firebase/auth'
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteField,
  query, where, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { auth, db } from './config'
import { hashPin } from '../utils/hashPin'

// ─── Session keys ─────────────────────────────────────────────────────────────

export const SESSION_USER_KEY    = 'koam_user'    // pencatat / urusetia / admin / pengurus_teknik
export const SESSION_SEKOLAH_KEY = 'koam_sekolah' // pengurus_pasukan

// ─── Tetapan rate limiting ────────────────────────────────────────────────────

const MAX_ATTEMPTS   = 5          // percubaan sebelum dikunci
const LOCK_MINUTES   = 30         // minit kunci selepas MAX_ATTEMPTS
const WINDOW_MINUTES = 15         // tetingkap masa kira percubaan

// ─── Helper: semak & rekod login attempt ─────────────────────────────────────

async function checkRateLimit(attemptKey) {
  const ref  = doc(db, 'login_attempts', attemptKey)
  const snap = await getDoc(ref)

  if (!snap.exists()) return // tiada rekod — boleh teruskan

  const data       = snap.data()
  const now        = Date.now()
  const lockedUntil = data.lockedUntil?.toMillis?.() || 0

  // Semak kunci aktif
  if (lockedUntil > now) {
    const balanMin = Math.ceil((lockedUntil - now) / 60000)
    throw Object.assign(
      new Error(`Akaun dikunci sementara. Cuba semula dalam ${balanMin} minit.`),
      { code: 'auth/too-many-requests' }
    )
  }

  // Kunci luput — reset
  if (lockedUntil > 0 && lockedUntil <= now) {
    await setDoc(ref, { attempts: 0, lockedUntil: null, lastAttempt: serverTimestamp() }, { merge: true })
  }
}

async function recordFailedAttempt(attemptKey) {
  const ref  = doc(db, 'login_attempts', attemptKey)
  const snap = await getDoc(ref)
  const data = snap.exists() ? snap.data() : {}
  const now  = Date.now()

  // Kira percubaan dalam tetingkap WINDOW_MINUTES sahaja
  const lastMs      = data.lastAttempt?.toMillis?.() || 0
  const withinWindow = (now - lastMs) < WINDOW_MINUTES * 60000
  const prevAttempts = withinWindow ? (data.attempts || 0) : 0
  const newAttempts  = prevAttempts + 1

  const update = {
    attempts:    newAttempts,
    lastAttempt: serverTimestamp(),
    lockedUntil: newAttempts >= MAX_ATTEMPTS
      ? Timestamp.fromMillis(now + LOCK_MINUTES * 60000)
      : null,
  }
  await setDoc(ref, update, { merge: true })

  if (newAttempts >= MAX_ATTEMPTS) {
    throw Object.assign(
      new Error(`Terlalu banyak percubaan gagal. Akaun dikunci ${LOCK_MINUTES} minit.`),
      { code: 'auth/too-many-requests' }
    )
  }
}

async function clearAttempts(attemptKey) {
  try {
    const ref = doc(db, 'login_attempts', attemptKey)
    await setDoc(ref, { attempts: 0, lockedUntil: null, lastAttempt: serverTimestamp() }, { merge: true })
  } catch { /* bukan kritikal — biarkan */ }
}

// ─── 1. Superadmin — Firebase Auth (legacy, tidak digunakan lagi) ────────────

export async function loginSuperadmin(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

// ─── 1b. Admin — Firestore users (email + PIN, tanpa Firebase Auth) ──────────

export async function loginAdminByEmail(email, pin) {
  const emailClean = email.trim().toLowerCase()

  const snap = await getDocs(query(
    collection(db, 'users'),
    where('email', '==', emailClean),
    where('role', 'in', ['superadmin', 'admin', 'pengurus_teknik']),
  ))

  if (snap.empty) {
    throw Object.assign(
      new Error('E-mel atau PIN tidak sah.'),
      { code: 'auth/user-not-found' }
    )
  }

  const userDoc = snap.docs[0]
  const data    = userDoc.data()

  if (data.isAktif === false) {
    throw Object.assign(
      new Error('Akaun tidak aktif. Hubungi pentadbir.'),
      { code: 'auth/user-disabled' }
    )
  }

  let pinOk = false
  if (data.pinHash) {
    const inputHash = await hashPin(pin.trim())
    pinOk = inputHash === data.pinHash
  } else if (data.pin) {
    pinOk = String(data.pin) === pin.trim()
    if (pinOk) {
      try {
        const newHash = await hashPin(pin.trim())
        await updateDoc(doc(db, 'users', userDoc.id), {
          pinHash: newHash, pin: deleteField(), updatedAt: serverTimestamp(),
        })
      } catch { /* bukan kritikal */ }
    }
  }

  if (!pinOk) {
    throw Object.assign(
      new Error('E-mel atau PIN tidak sah.'),
      { code: 'auth/wrong-password' }
    )
  }

  const sessionData = {
    uid:       userDoc.id,
    nama:      data.nama      || '',
    email:     data.email     || emailClean,
    role:      data.role,
    kodAkses:  data.kodAkses  || '',
    isProxy:   false,
  }
  sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(sessionData))
  return sessionData
}

// ─── 2. Pencatat / Urusetia / Admin / Pengurus Teknik — Firestore users ───────

/**
 * Login pengguna dari jadual `users` menggunakan kodAkses + PIN.
 * Saves identity to sessionStorage SESSION_USER_KEY.
 */
export async function loginPencatat(kodAkses, pin) {
  const kod        = kodAkses.trim().toUpperCase()
  const attemptKey = `user_${kod}`

  // R-NEW-3: semak rate limit sebelum query
  await checkRateLimit(attemptKey)

  const snap = await getDocs(query(
    collection(db, 'users'),
    where('kodAkses', '==', kod),
  ))

  if (snap.empty) {
    await recordFailedAttempt(attemptKey)
    throw Object.assign(
      new Error('Kod Akses tidak dijumpai.'),
      { code: 'auth/user-not-found' }
    )
  }

  const userDoc = snap.docs[0]
  const data    = userDoc.data()

  // R7: semak pinHash dahulu, fallback ke pin lama (migration path)
  const pinInput = pin.trim()
  let pinOk = false
  if (data.pinHash) {
    const inputHash = await hashPin(pinInput)
    pinOk = inputHash === data.pinHash
  } else {
    // Fallback plain text (sekolah belum migrate)
    pinOk = String(data.pin) === pinInput
    if (pinOk) {
      // Auto-migrate: hash dan simpan, buang plain text
      try {
        const newHash = await hashPin(pinInput)
        await updateDoc(doc(db, 'users', userDoc.id), {
          pinHash: newHash,
          pin:     deleteField(),
          updatedAt: serverTimestamp(),
        })
      } catch { /* bukan kritikal */ }
    }
  }

  if (!pinOk) {
    await recordFailedAttempt(attemptKey)
    throw Object.assign(
      new Error('PIN tidak betul.'),
      { code: 'auth/wrong-password' }
    )
  }

  if (data.isAktif === false) {
    throw Object.assign(
      new Error('Akaun tidak aktif. Hubungi pentadbir.'),
      { code: 'auth/user-disabled' }
    )
  }

  await clearAttempts(attemptKey)

  const sessionData = {
    uid:        userDoc.id,
    nama:       data.nama       || '',
    email:      data.email      || '',
    role:       data.role,
    kodSekolah: data.kodSekolah || '',
    kodAkses:   data.kodAkses   || kod,
    isProxy:    false,
  }

  sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(sessionData))
  return sessionData
}

// ─── 3. Pengurus Pasukan — Firestore sekolah ──────────────────────────────────

/**
 * Login pengurus pasukan dari jadual `sekolah` menggunakan kodSekolah + PIN.
 * Saves identity to sessionStorage SESSION_SEKOLAH_KEY.
 */
export async function loginPengurus(kodSekolah, pin) {
  const kod        = kodSekolah.trim().toUpperCase()
  const attemptKey = `sekolah_${kod}`

  // R-NEW-3: semak rate limit sebelum query
  await checkRateLimit(attemptKey)

  const sekolahSnap = await getDoc(doc(db, 'sekolah', kod))

  if (!sekolahSnap.exists()) {
    await recordFailedAttempt(attemptKey)
    throw Object.assign(
      new Error('Kod Sekolah tidak dijumpai.'),
      { code: 'auth/user-not-found' }
    )
  }

  const sekolah  = sekolahSnap.data()
  const pinInput = pin.trim()
  let pinOk = false

  if (sekolah.pinHash) {
    // R7: guna hash untuk compare
    const inputHash = await hashPin(pinInput)
    pinOk = inputHash === sekolah.pinHash
  } else {
    // Fallback plain text (sekolah belum migrate)
    pinOk = String(sekolah.pin) === pinInput
    if (pinOk) {
      // Auto-migrate: hash dan simpan, buang plain text
      try {
        const newHash = await hashPin(pinInput)
        await updateDoc(doc(db, 'sekolah', kod), {
          pinHash: newHash,
          pin:     deleteField(),
          updatedAt: serverTimestamp(),
        })
      } catch { /* bukan kritikal */ }
    }
  }

  if (!pinOk) {
    await recordFailedAttempt(attemptKey)
    throw Object.assign(
      new Error('PIN tidak betul.'),
      { code: 'auth/wrong-password' }
    )
  }

  if (sekolah.isAktif === false) {
    throw Object.assign(
      new Error('Akaun sekolah tidak aktif.'),
      { code: 'auth/user-disabled' }
    )
  }

  await clearAttempts(attemptKey)

  const sessionData = {
    role:        'pengurus_pasukan',
    kodSekolah:  kod,
    namaSekolah: sekolah.namaSekolah || kod,
    kategori:    sekolah.kategori    || '',
    email:       sekolah.email       || '',
    bibPrefix:   sekolah.bibPrefix   || '',
    negeri:      sekolah.negeri      || '',
    daerah:      sekolah.daerah      || '',
  }

  sessionStorage.setItem(SESSION_SEKOLAH_KEY, JSON.stringify(sessionData))
  return sessionData
}

// ─── Logout — kosongkan semua sesi ────────────────────────────────────────────

export async function logoutAll() {
  sessionStorage.removeItem(SESSION_USER_KEY)
  sessionStorage.removeItem(SESSION_SEKOLAH_KEY)
  try { await firebaseSignOut(auth) } catch { /* abaikan — tiada sesi Firebase */ }
}

// ─── Lupa PIN — Firebase Password Reset ───────────────────────────────────────

/**
 * Hantar emel reset kata laluan via Firebase Auth.
 * Berfungsi hanya jika email ada akaun Firebase Auth (superadmin).
 */
export async function sendPinReset(email) {
  await sendPasswordResetEmail(auth, email.trim())
}
