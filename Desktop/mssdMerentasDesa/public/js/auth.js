import { db } from './firebase-config.js'
import {
  collection, query, where, getDocs,
  doc, getDoc, updateDoc, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'

const SESSION_KEY = 'mssd_md_user'

export async function login(email, password) {
  const emailClean = email.trim().toLowerCase()

  const snap = await getDocs(query(
    collection(db, 'users'),
    where('email', '==', emailClean)
  ))

  if (snap.empty) throw new Error('Email tidak dijumpai dalam sistem. Hubungi admin.')

  const userDoc  = snap.docs[0]
  const userData = userDoc.data()

  if (!userData.aktif) throw new Error('Akaun tidak aktif. Hubungi admin.')

  const pwdOk = userData.password === password || userData.pin === password
  if (!pwdOk) throw new Error('Kata laluan salah.')

  const sessionData = {
    uid:   userDoc.id,
    email: userData.email  || emailClean,
    role:  userData.role   || '',
    nama:  userData.nama   || '',
    aktif: true,
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionData))

  updateDoc(doc(db, 'users', userDoc.id), {
    loginAttempts: 0,
    lockedUntil:   null,
    lastLogin:     serverTimestamp(),
  }).catch(() => {})

  addDoc(collection(db, 'auditLog'), {
    action: 'LOGIN', collection: 'users', docId: userDoc.id,
    before: null, after: null, uid: userDoc.id,
    timestamp: serverTimestamp(),
  }).catch(() => {})

  return sessionData
}

export async function logout() {
  const raw = sessionStorage.getItem(SESSION_KEY)
  sessionStorage.removeItem(SESSION_KEY)
  if (raw) {
    try {
      const user = JSON.parse(raw)
      await addDoc(collection(db, 'auditLog'), {
        action: 'LOGOUT', collection: 'users', docId: user.uid,
        before: null, after: null, uid: user.uid,
        timestamp: serverTimestamp(),
      })
    } catch {}
  }
}

export async function getUserData(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

export function onAuth(callback) {
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (raw) {
    try {
      callback(JSON.parse(raw))
    } catch {
      sessionStorage.removeItem(SESSION_KEY)
      callback(null)
    }
  } else {
    callback(null)
  }
}

const SESSION_TIMEOUT = 8 * 60 * 60 * 1000
let sessionTimer

export function startSessionTimer() {
  clearTimeout(sessionTimer)
  sessionTimer = setTimeout(async () => {
    await logout()
    alert('Sesi tamat. Sila log masuk semula.')
    window.location.reload()
  }, SESSION_TIMEOUT)
}

export function attachSessionListeners() {
  document.addEventListener('click',    startSessionTimer)
  document.addEventListener('keypress', startSessionTimer)
}

export async function auditLog(action, col, docId, before, after, uid) {
  try {
    await addDoc(collection(db, 'auditLog'), {
      action, collection: col, docId,
      before: before || null, after: after || null,
      uid, timestamp: serverTimestamp(),
    })
  } catch (_) {}
}
