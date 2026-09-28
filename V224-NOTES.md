# V224 — Bekleyen Yatırım Hızlı Karar + Tutar Düzeltme

- Bekleyen yatırımlar tablosuna satır içi ✓ Onayla ve × Reddet butonları eklendi.
- Hızlı kararlar da işlemden önce mevcut uyarı/confirm ekranından geçer.
- İncele butonu hızlı kararların arkasına alındı.
- İşlem detayında talep edilen tutar ile gelen/onaylanacak tutar ayrıldı.
- Admin, beklenen 500 USDT yerine gelen 400 USDT gibi farklı bir tutarı girip o tutarla onaylayabilir.
- Tutar değişikliği transaction audit kaydına; önceki/talep edilen tutar, onaylanan tutar, admin ve zaman bilgisiyle yazılır.
- Üye bakiyesi yalnızca onaylanan gerçek/onaylanacak tutar kadar güncellenir.
- İşlem/Audit Logları sayfasına işlem karar kayıtları bölümü eklendi.
- Server API ve PostgreSQL şemasına requested_amount / received_amount alanları eklendi.
- V223'teki bekleyen yatırımlar sayfasındaki JavaScript sözdizimi sorunları da düzeltildi.
