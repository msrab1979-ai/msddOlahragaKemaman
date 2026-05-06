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
 * CATATAN TEKNIKAL:
 * Sumber 2 & 3 menggunakan sessionStorage sahaja (tiada Firebase Auth).
 * Firestore rules perlu dikemaskini untuk menyokong model ini (atau guna
 * Firebase Auth anonymous sign-in sebagai proksi — di luar skop task ini).
 */

import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
} from 'firebase/auth'
import {
  collection, doc, getDoc, getDocs,
  query, where,
} from 'firebase/firestore'
import { auth, db } from './config'

// ─── Session keys ─────────────────────────────────────────────────────────────

export const SESSION_USER_KEY    = 'koam_user'    // pencatat / urusetia / admin / pengurus_teknik
export const SESSION_SEKOLAH_KEY = 'koam_sekolah' // pengurus_pasukan

// ─── 1. Superadmin — Firebase Auth ───────────────────────────────────────────

/**
 * Login superadmin via Firebase Auth (email + password).
 * onAuthStateChanged dalam AuthContext akan handle state update.
 */
export async function loginSuperadmin(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
}

// ─── 2. Pencatat / Urusetia / Admin / Pengurus Teknik — Firestore users ───────

/**
 * Login pengguna dari jadual `users` menggunakan kodAkses + PIN.
 * Saves identity to sessionStorage SESSION_USER_KEY.
 * Redirect selepas login: /dashboard
 */
export async function loginPencatat(kodAkses, pin) {
  const kod = kodAkses.trim().toUpperCase()

  // Query Firestore — cari mana-mana user dengan kodAkses ini
  const snap = await getDocs(query(
    collection(db, 'users'),
    where('kodAkses', '==', kod),
  ))

  if (snap.empty) {
    throw Object.assign(
      new Error('Kod Akses tidak dijumpai.'),
      { code: 'auth/user-not-found' }
    )
  }

  const userDoc = snap.docs[0]
  const data    = userDoc.data()

  if (String(data.pin) !== String(pin.trim())) {
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

  const sessionData = {
    uid:        userDoc.id,
    nama:       data.nama        || '',
    email:      data.email       || '',
    role:       data.role,
    kodSekolah: data.kodSekolah  || '',
    kodAkses:   data.kodAkses    || kod,
    isProxy:    false,
  }

  sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(sessionData))
  return sessionData
}

// ─── 3. Pengurus Pasukan — Firestore sekolah ──────────────────────────────────

/**
 * Login pengurus pasukan dari jadual `sekolah` menggunakan kodSekolah + PIN.
 * Saves identity to sessionStorage SESSION_SEKOLAH_KEY.
 * Redirect selepas login: /dashboard
 */
export async function loginPengurus(kodSekolah, pin) {
  const kod = kodSekolah.trim().toUpperCase()

  const sekolahSnap = await getDoc(doc(db, 'sekolah', kod))

  if (!sekolahSnap.exists()) {
    throw Object.assign(
      new Error('Kod Sekolah tidak dijumpai.'),
      { code: 'auth/user-not-found' }
    )
  }

  const sekolah = sekolahSnap.data()

  if (String(sekolah.pin) !== String(pin.trim())) {
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
 * Untuk pengguna Firestore sahaja — emel dihantar tetapi tidak berfungsi
 * (user perlu hubungi admin untuk reset PIN manual).
 */
export async function sendPinReset(email) {
  await sendPasswordResetEmail(auth, email.trim())
}
