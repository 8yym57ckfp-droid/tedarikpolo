# Safepays v136 — Gerçek e-posta ile şifre sıfırlama altyapısı

- Netlify Function: `netlify/functions/password-reset.mjs`
- Endpoint: `/api/password-reset`
- Resend API anahtarı yalnızca Netlify environment variable `RESEND_API_KEY` üzerinden okunur.
- Reset kodu 6 haneli, 10 dakika geçerli, tek kullanımlık ve 5 hatalı deneme ile sınırlıdır.
- Kod ve reset kaydı Netlify Blobs'ta tutulur; hassas API anahtarı frontend'e gönderilmez.
- `@netlify/blobs` dependency eklendi.
- Login ekranındaki demo `123456` sıfırlama kodu kaldırıldı.
- Şifre sıfırlama artık önce gerçek e-posta göndermeyi dener.

## Önemli mevcut mimari sınır
Bu sürüm mevcut Safepays demo kullanıcılarını localStorage'da tuttuğu için şifre değişikliği, mevcut cihazdaki localStorage hesabına uygulanır. Gerçek üretim hesabı, şifre hash'i ve tüm cihazlarda çalışan kalıcı hesap sistemi için kullanıcıların PostgreSQL/Supabase/Neon gibi gerçek bir veritabanına taşınması gerekir.

## Resend test göndericisi
Özel alan adı doğrulanmadığı sürece `onboarding@resend.dev` yalnızca Resend'in test akışında kullanılabilir. Üretimde kullanıcıların gerçek adreslerine gönderim için doğrulanmış bir gönderici alan adı ve `RESEND_FROM_EMAIL` değişkeni kullanılmalıdır.
