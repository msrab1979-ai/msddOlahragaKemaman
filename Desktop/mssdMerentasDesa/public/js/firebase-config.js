import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
const firebaseConfig = {
  apiKey: "AIzaSyDcyYZaaLJbUcSGbKqv0eZ_EMb0Mimv6Gk",
  authDomain: "mssdkemaman-merentasdesa.firebaseapp.com",
  projectId: "mssdkemaman-merentasdesa",
  storageBucket: "mssdkemaman-merentasdesa.firebasestorage.app",
  messagingSenderId: "997720090390",
  appId: "1:997720090390:web:60ee0a3b984002f9959237"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
