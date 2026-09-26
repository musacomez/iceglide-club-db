// Backend'deki src/lib/password.ts ile BİREBİR aynı formatta hash üretir:
// pbkdf2$<iterasyon>$<saltBase64>$<hashBase64>
//
// Kullanım:
//   node hash-password.mjs "YeniGuvenliSifreniz123!"

const encoder = new TextEncoder();

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2$100000$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

const newPassword = process.argv[2];
if (!newPassword) {
  console.error('Kullanım: node hash-password.mjs "YeniSifreniz"');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error('Uyarı: parola çok kısa, en az 8-10+ karakter ve karışık içerik önerilir.');
}

const hash = await hashPassword(newPassword);
console.log('\nYeni password_hash değeri:\n');
console.log(hash);
console.log('\nBunu bir sonraki adımdaki SQL komutuna yapıştır (ADMIN_EMAIL_BURAYA kısmını kendi admin e-postanla değiştir):\n');
console.log(`UPDATE users SET password_hash = '${hash}' WHERE email = 'ADMIN_EMAIL_BURAYA';`);
