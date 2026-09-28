# Safepays v39

- Admin İşlem Talepleri sayfasına 30:00 geri sayım eklendi.
- Sayaç renkleri: 30-10 dk yeşil, 10-5 dk sarı, son 5 dk kırmızı.
- 30 dakika dolunca bekleyen işlem `auto-rejected` durumuna geçirilir ve Geçmiş'e taşınır.
- Admin Geçmiş sayfası artık localStorage demo işlemlerini dinamik gösterir.
- Geçmişte onaylanan, reddedilen ve otomatik reddedilen işlemler filtrelenebilir.
- Geçmiş sayfasından İncele ile işlem detayına ve üye bilgilerine gidilebilir.
- Yeni işlem oluşturulduğunda sayaç işlem oluşturulma anından itibaren 30 dakikadan geri sayar.
- Demo/static yapı korunmuştur; gerçek ortak veritabanı değildir.
