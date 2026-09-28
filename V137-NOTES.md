# V137

- Ana sayfa ve ortak üye header avatarı artık aktif kullanıcıdan otomatik doldurulur.
- Hardcoded `VD` kaldırıldı; yeni hesaplarda eski Veysi Duman baş harfleri görünmez.
- `syncSafepaysHeaderUser()` DOMContentLoaded sırasında çalışır ve aktif kullanıcının ad-soyad baş harflerini `.avatar-sm` alanlarına yazar.
