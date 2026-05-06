import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import {
  doc, getDoc, setDoc, serverTimestamp,
  collection, query, where, getCountFromServer,
} from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import {
  loginSuperadmin as _loginSuperadmin,
  loginPencatat   as _loginPencatat,
  loginPengurus   as _loginPengurus,
  logoutAll,
  sendPinReset,
  SESSION_USER_KEY,
  SESSION_SEKOLAH_KEY,
} from '../firebase/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,       setUser]       = useState(null)
  const [userRole,   setUserRole]   = useState(null)
  const [userData,   setUserData]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
    // ── Semak sessionStorage dahulu (pencatat / pengurus) — synchronous ───────
    const rawUser = sessionStorage.getItem(SESSION_USER_KEY)
    if (rawUser) {
      try {
        const u = JSON.parse(rawUser)
        setUser({ uid: u.uid, email: u.email || '' })
        setUserData(u)
        setUserRole(u.role)
        setNeedsSetup(false)
        setLoading(false)
        return // Tidak perlu Firebase listener
      } catch { sessionStorage.removeItem(SESSION_USER_KEY) }
    }

    const rawSekolah = sessionStorage.getItem(SESSION_SEKOLAH_KEY)
    if (rawSekolah) {
      try {
        const s = JSON.parse(rawSekolah)
        const uid = `sekolah_${s.kodSekolah}`
        setUser({ uid, email: s.email || '' })
        setUserData({
          ...s,
          uid,
          nama:  `Pengurus Pasukan — ${s.namaSekolah}`,
          role:  'pengurus_pasukan',
        })
        setUserRole('pengurus_pasukan')
        setNeedsSetup(false)
        setLoading(false)
        return // Tidak perlu Firebase listener
      } catch { sessionStorage.removeItem(SESSION_SEKOLAH_KEY) }
    }

    // ── Firebase Auth — superadmin sahaja ─────────────────────────────────────
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (userDoc.exists()) {
          const data = userDoc.data()
          setUserData(data)
          setUserRole(data.role || null)
          setNeedsSetup(!data.role)
        } else {
          setNeedsSetup(true)
        }
        setUser(firebaseUser)
      } else {
        setUser(null)
        setUserRole(null)
        setUserData(null)
        setNeedsSetup(false)
      }
      setLoading(false)
    })

    return unsubscribe
  }, [])

  // ─── Login: Superadmin — Firebase Auth ───────────────────────────────────────

  async function loginSuperadmin(email, password) {
    const cred = await _loginSuperadmin(email, password)
    // Set user + role serentak — elak DashboardLayout render dengan nav kosong
    // kerana onAuthStateChanged lambat (perlu fetch Firestore)
    setUser(cred.user)
    try {
      const userDoc = await getDoc(doc(db, 'users', cred.user.uid))
      if (userDoc.exists()) {
        const data = userDoc.data()
        setUserData(data)
        setUserRole(data.role || null)
        setNeedsSetup(!data.role)
      } else {
        setNeedsSetup(true)
      }
    } catch { /* onAuthStateChanged akan cuba semula */ }
    return cred
  }

  // ─── Login: Pencatat / Urusetia / Admin / Pengurus Teknik — Firestore users ──

  async function loginPencatat(kodAkses, pin) {
    const data = await _loginPencatat(kodAkses, pin)
    setUser({ uid: data.uid, email: data.email || '' })
    setUserData(data)
    setUserRole(data.role)
    setNeedsSetup(false)
    return data
  }

  // ─── Login: Pengurus Pasukan — Firestore sekolah ──────────────────────────────

  async function loginPengurus(kodSekolah, pin) {
    const data = await _loginPengurus(kodSekolah, pin)
    const uid  = `sekolah_${data.kodSekolah}`
    setUser({ uid, email: data.email || '' })
    setUserData({ ...data, uid, nama: `Pengurus Pasukan — ${data.namaSekolah}` })
    setUserRole('pengurus_pasukan')
    setNeedsSetup(false)
    return data
  }

  // ─── Logout — kosongkan semua sesi ───────────────────────────────────────────

  async function logout() {
    await logoutAll()
    setUser(null)
    setUserRole(null)
    setUserData(null)
    setNeedsSetup(false)
  }

  // ─── Claim superadmin (first run) ─────────────────────────────────────────────

  async function claimSuperadmin(nama) {
    if (!user) throw new Error('Tiada sesi aktif.')
    const snap = await getCountFromServer(
      query(collection(db, 'users'), where('role', '==', 'superadmin'))
    )
    if (snap.data().count > 0) throw new Error('Superadmin sudah wujud.')
    const docData = {
      uid: user.uid, nama: nama || user.email, email: user.email,
      role: 'superadmin', isAktif: true,
      createdAt: serverTimestamp(), createdBy: 'first_run',
    }
    await setDoc(doc(db, 'users', user.uid), docData, { merge: true })
    setUserData(docData)
    setUserRole('superadmin')
    setNeedsSetup(false)
  }

  function hasRole(...roles) {
    return roles.includes(userRole)
  }

  // Backward-compat aliases (komponen lain mungkin guna nama lama)
  const login             = loginSuperadmin
  const loginWithKodAkses = loginPengurus

  return (
    <AuthContext.Provider value={{
      user, userRole, userData, loading, needsSetup,
      login, loginSuperadmin, loginPencatat, loginPengurus,
      loginWithKodAkses,
      logout, hasRole, claimSuperadmin, sendPinReset,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth mesti digunakan dalam AuthProvider')
  return context
}
