/**
 * hashPin.js — Hash PIN menggunakan PBKDF2 (Web Crypto API)
 *
 * Kenapa PBKDF2:
 *  - 10,000 iterasi → ~150ms pada mobile → brute-force offline ~1M PIN = ~41 jam
 *  - Lebih baik dari SHA-256 biasa (tanpa iterasi) yang boleh dibrute dalam saat
 *  - Combine dengan rate limiting (R-NEW-3) → perlindungan dua lapisan
 *
 * Salt tetap (bukan per-user) kerana tiada cara selamat simpan salt per-user
 * tanpa Firebase Auth. Masih jauh lebih baik dari plain text.
 */

const SALT = 'MSSDKEMAMAN_OLAHRAGA_KOAM_v1'
const ITERATIONS = 10000

/**
 * Hash PIN menggunakan PBKDF2-SHA256.
 * @param {string} pin — PIN plain text (6 digit)
 * @returns {Promise<string>} — hex string 64 char
 */
export async function hashPin(pin) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(pin)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name:       'PBKDF2',
      salt:       enc.encode(SALT),
      iterations: ITERATIONS,
      hash:       'SHA-256',
    },
    keyMaterial,
    256
  )
  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
