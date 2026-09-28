V156 — İçerik Merkezi Etkinlik sekmesi kesin düzeltme

- Etkinlik sekmesini yakalayan document-level capture handler kaldırıldı; bu handler stopPropagation ile gerçek tab click handlerını engelliyordu.
- Haber/Etkinlik sekmeleri doğrudan onclick ile bağlandı ve type=button yapıldı.
- Etkinlik sekmesine basınca kind gerçekten event olarak ayarlanıyor; böylece kaydedilen içerik kind=event oluyor.
- events.html V60 deposundan event kayıtlarını göstermeye devam ediyor.
- Önceki sürümlerde yanlışlıkla news olarak kaydedilmiş içerikler otomatik tahmin edilmez; yeni kayıtlar doğru türde oluşturulur.
