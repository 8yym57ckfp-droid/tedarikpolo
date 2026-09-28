# V120 — Events member header fix

- Etkinlikler sayfasındaki sabit VD / 12,480 USDT değerleri kaldırıldı.
- Header artık `safepays_demo_current_user` üzerinden aktif üyenin baş harflerini ve bakiyesini gösteriyor.
- İlk HTML değeri de güvenli varsayılanlara (`SP` / `0.00 USDT`) çekildi; eski demo bilgisi görünmüyor.
- `DOMContentLoaded` ve `pageshow` senkronizasyonu eklendi.
