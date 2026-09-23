# IceGlide Club DB

Yeni IceGlide backend'i: Cloudflare Workers + TypeScript + itty-router + D1.

Bu repo eski 800+ satırlık `worker.js` kodunu kullanmaz. Mevcut `iceglide-club-db` D1 veritabanına bağlanmak üzere hazırlanmıştır.

## GitHub → Cloudflare

1. Bu klasörün tamamını GitHub'da yeni bir repository'ye yükle.
2. Cloudflare Workers → Create/Import → Git repository ile repository'yi bağla.
3. Cloudflare build sırasında `npm install` ile bağımlılıkları kurar.
4. `wrangler.jsonc` içindeki `REPLACE_WITH_YOUR_D1_DATABASE_ID` değerini mevcut D1 database ID ile değiştir.
5. D1 binding adı `DB` olarak kalmalıdır.
6. GitHub'a push ettikçe Cloudflare Git integration otomatik deployment yapabilir.

## API

- GET  `/`
- GET  `/api/health`
- POST `/api/auth/login`
- GET  `/api/me`
- GET  `/api/dashboard/summary`
- GET  `/api/students`
- GET  `/api/students/:id`
- GET  `/api/lessons`
- GET  `/api/lessons/:id`
- GET  `/api/lessons/:id/attendance`
- POST `/api/attendance`
- GET  `/api/packages/student/:studentId`
- GET  `/api/payments/student/:studentId`

## Auth

Bearer token kullanılır. `AUTH_SECRET` Cloudflare Worker Secret olarak tanımlanmalıdır.

Mevcut test kullanıcılarının `password_hash` değerleri (`hash_123` gibi) gerçek PBKDF2 hash değildir; bu nedenle mevcut test kayıtlarıyla login testi yapmak yerine önce gerçek bir parola hash'i oluşturup users tablosuna yazmak gerekir.

## Attendance

`POST /api/attendance` aşağıdaki iş akışını uygular:

- öğrencinin derse kayıtlı olduğunu kontrol eder
- attendance oluşturur/günceller
- `present` veya `late` durumunda uygun aktif paketten tüketim yapar
- paket bakiyesini azaltır
- package transaction oluşturur
- attendance değişip tüketimden çıkarsa correction ile hakkı geri verir
- audit log oluşturur

Aynı ders/öğrenci için tüketimin iki kez oluşmasını kontrol eder.

## Not

Bu repo backend'in temiz başlangıç ve core operasyon katmanıdır. Finans, özel ders talepleri, gelişim, yarışmalar, mesajlaşma, bildirimler ve R2 doküman yüklemeleri için route/service katmanları aynı mimariyle genişletilecektir.
