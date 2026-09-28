# V195 — Daily Finance Rollover

- Günlük yatırım/çekim/net/komisyon sayaçları karar tarihi (`decidedAt`) üzerinden hesaplanır.
- Yeni takvim gününde günlük sayaçlar otomatik olarak 0'dan başlar; eski gün işlemleri silinmez.
- Günlük ekip özetleri `safepays_daily_finance_v1` altında tarih + ekip anahtarıyla arşivlenir.
- İşlem geçmişi geçmiş günlerin detaylarını korur.
- Kasa bakiyesi ve SafePays Alacaklı günlük sayaç değildir; mevcut finansal durum olarak korunur.
- Ekip Genel Bakış ve Super Admin Finans Dashboard günlük özetleri kullanır.
- Beklenen Yatırımlar üst istatistikleri mevcut günün karar verilen işlemlerini gösterir; bekleyen işlemler yalnızca adet olarak görünür.
