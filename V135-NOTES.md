# V135 — Şifre Sıfırlama Akışı
- Login sayfasındaki “Şifremi Unuttum” artık demo bildirim yerine gerçek bir iki adımlı demo sıfırlama akışı açar.
- Kullanıcı e-posta/telefonunu girer, hesap bulunursa güvenlik kodu + yeni şifre ekranına geçer.
- Demo kodu: 123456.
- Yeni şifre en az 8 karakterdir.
- Kayıtlı demo kullanıcıların şifresi ilgili localStorage kayıtlarında güncellenir.
- test@safepays.local için reset sonrası yeni şifre geçerli olur.
- Safepays özel modal kullanılır; native alert kullanılmaz.
- Static Netlify/demo ortamında gerçek e-posta gönderimi yapılmaz; üretimde backend üzerinden tek kullanımlık token/e-posta akışı bağlanmalıdır.
