# V225 — Bekleyen Yatırımlar UI / Username Fix

- Aksiyon sütunu hizalandı: Onayla, Reddet, İncele, Kopyala aynı ölçü ve grid içinde.
- Otomatik yenileme eski büyük kontrol tasarımı kaldırıldı. Yerine küçük Canlı durum göstergesi + son güncelleme + manuel yenileme ikonu geldi. Arka planda 10 saniyelik yenileme korunuyor.
- Kullanıcı adı çözümleme güçlendirildi; kayıt akışındaki local demo kullanıcıları ve eski USR-* işlemler için güvenli tek-kullanıcı legacy fallback eklendi.
- Demo store getProfile artık kayıtlı kullanıcı listesinden username kurtarıyor.
- Arama kullanıcı adı/ad-soyad üzerinden de çalışıyor.
