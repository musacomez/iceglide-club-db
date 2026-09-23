# IceGlide Club DB

IceGlide Artistik Buz Pateni Kulübü için yeni backend projesi.

Bu proje:
- Cloudflare Workers
- TypeScript
- itty-router
- Cloudflare D1

üzerinde çalışır.

Tek bir kulüp için tasarlanmıştır ve IceGlide'ın web, mobil ve ileride masaüstü istemcilerinin kullanacağı merkezi API katmanını oluşturur.

> Bu proje eski 800+ satırlık `worker.js` yapısını kullanmaz. Yeni backend mimarisi olarak hazırlanmıştır.

---

## Mimari

```text
Next.js / Web
      │
      ▼
Cloudflare Worker
      │
      ▼
itty-router
      │
      ├── Authentication
      ├── Authorization
      ├── Validation
      ├── Services
      │
      ▼
Cloudflare D1
```

İlerleyen aşamalarda React Native / Expo, Tauri Desktop ve Cloudflare R2 Document Storage aynı backend üzerinden bağlanacaktır.

---

## Cloudflare

### Worker
```text
iceglide-club-db
```

### D1 Database
```text
iceglide-club-db
```

### D1 Binding
```text
DB
```

Worker ile D1 arasındaki bağlantı `wrangler.jsonc` üzerinden yapılır.

---

## Proje Yapısı

```text
iceglide-club-db/
├── package.json
├── wrangler.jsonc
├── tsconfig.json
├── README.md
├── .gitignore
├── .dev.vars.example
└── src/
    ├── index.ts
    ├── types/
    │   └── env.ts
    ├── lib/
    │   ├── response.ts
    │   ├── cors.ts
    │   ├── password.ts
    │   └── token.ts
    ├── middleware/
    │   └── auth.ts
    ├── routes/
    │   ├── auth.ts
    │   ├── health.ts
    │   ├── dashboard.ts
    │   ├── students.ts
    │   ├── lessons.ts
    │   ├── attendance.ts
    │   ├── packages.ts
    │   ├── payments.ts
    │   └── me.ts
    └── services/
        └── attendance.service.ts
```

---

## API

### System
```text
GET  /
GET  /api/health
```

### Authentication
```text
POST /api/auth/login
GET  /api/me
```

### Dashboard
```text
GET /api/dashboard/summary
```

### Students
```text
GET /api/students
GET /api/students/:id
```

### Lessons
```text
GET /api/lessons
GET /api/lessons/:id
GET /api/lessons/:id/attendance
```

### Attendance
```text
POST /api/attendance
```

### Packages
```text
GET /api/packages/student/:studentId
```

### Payments
```text
GET /api/payments/student/:studentId
```

---

## Authentication

API Bearer token tabanlı authentication kullanır.

Token imzalama için `AUTH_SECRET` Cloudflare Worker Secret olarak tanımlanmalıdır.

Örnek:

```text
Authorization: Bearer <token>
```

Mevcut test kullanıcılarının bazı `password_hash` değerleri gerçek PBKDF2 hash değildir. Gerçek login testi için gerçek bir parola hash'i kullanılmalıdır.

---

## Attendance ve Paket Tüketimi

`POST /api/attendance` attendance kaydı ile paket tüketimini birlikte yönetir.

İş akışı:

1. Dersin mevcut olup olmadığını kontrol eder.
2. Öğrencinin derse kayıtlı olduğunu kontrol eder.
3. Attendance kaydını oluşturur veya günceller.
4. Attendance `present` veya `late` olduğunda uygun aktif paketi bulur.
5. Paket hakkından `-1` tüketim oluşturur.
6. Paket kalan ders sayısını azaltır.
7. `package_transactions` kaydı oluşturur.
8. Attendance daha sonra tüketim gerektirmeyen bir duruma dönerse `correction` işlemiyle hakkı geri verir.
9. İşlemi `audit_logs` içerisine kaydeder.

---

## Veri Modeli

Sistem operasyonel ve finansal kayıtları ayrı tutar.

```text
payments
    ↓
Alınan para / ödeme kayıtları

ledger_transactions
    ↓
Finansal hareketler

packages
    ↓
Öğrencinin paket / hak durumu

package_transactions
    ↓
Paket hakkının hareketleri

attendances
    ↓
Öğrencinin derse katılım durumu
```

Ders üyeliği:

```text
lesson_instances
        ↓
lesson_students
        ↓
students
```

`lesson_instances` doğrudan `student_id` taşımaz.

---

## Tasarım İlkeleri

### Tek Kulüp

Sistem tek bir IceGlide kulübü için tasarlanmıştır.

Multi-tenant yapı bulunmaz.

### Tarihçe

Finansal, paket, attendance ve operasyonel geçmiş mümkün olduğunca korunur.

### Server-Side Authorization

Yetki kontrolleri yalnızca frontend üzerinde yapılmaz.

API tarafında kullanıcı rolü ve erişim yetkileri kontrol edilmelidir.

Temel roller:

```text
admin
instructor
student
parent
```

---

## Geliştirme Durumu

Mevcut temel alanlar:

- Authentication
- Dashboard
- Students
- Lessons
- Attendance
- Packages
- Payments
- Current user

İlerleyen geliştirmelerde:

- Finance write operations
- Private lesson requests
- Instructor management
- Parents
- Development tracking
- Competitions & Events
- Messages
- Notifications
- Announcements
- Documents
- Cloudflare R2 integration

eklenecektir.

Yeni özellikler doğrudan `index.ts` içerisinde büyütülmek yerine uygun `routes`, `services`, `middleware`, `lib` ve `types` katmanlarına eklenmelidir.

---

## Deployment

GitHub repository:
```text
musacomez/iceglide-club-db
```

Production branch:
```text
main
```

Cloudflare Worker:
```text
iceglide-club-db
```

Cloudflare D1:
```text
iceglide-club-db
```

Cloudflare Workers Builds yapılandırması:

```text
Build command:  None
Deploy command: npx wrangler deploy
Root directory: /
```

GitHub'ın `main` branch'ine yeni bir commit gönderildiğinde Cloudflare Workers Builds yeni deployment başlatabilir.

---

## Önemli

Bu repository IceGlide'ın yeni backend mimarisidir.

Eski 800+ satırlık `worker.js` tabanlı backend kullanılmaz.

Mevcut Cloudflare D1 veritabanı korunur ve yeni Worker `DB` binding'i üzerinden bu veritabanına bağlanır.

Frontend, mobil uygulama ve gelecekteki masaüstü uygulaması aynı API mimarisini kullanacaktır.
