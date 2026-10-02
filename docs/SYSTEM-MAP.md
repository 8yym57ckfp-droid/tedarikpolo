# SafePays — güncel sistem haritası

Bu belge çalışma ağacındaki mevcut uygulamayı özetler. Sayfalar ve API'ler gerçek sunucu kayıtlarını kullanır; yeni hesap, örnek bakiye veya örnek işlem oluşturulmaz.

## Veri akışı

Üye arayüzü → sunucu API'si → PostgreSQL → yönetici incelemesi → bakiye defteri ve audit kaydı.

Üretimde PostgreSQL zorunludur. Yerel geliştirmede `DATABASE_URL` yoksa `server/data/db.json` kullanılır; bu dosya dağıtım için kalıcı depolama değildir.

## Kalıcı kayıtlar

- Üyeler, oturumlar, yatırım/çekim talepleri ve bakiye defteri
- Yönetici tarafından tanımlanan yatırım cüzdanları ve bekleyen yatırım niyetleri
- Destek biletleri ve mesajları
- Yayınlanan haber/etkinlik içerikleri, bakım ve kur ayarları
- Yönetici kararları, güvenlik olayları ve audit kayıtları

## Yönetici

Bu sürüm yalnızca ortam değişkenleriyle tanımlanmış tek Super Admin hesabı kullanır. Giriş e-posta, parola ve zorunlu TOTP kodunu sunucuda doğrular. Tarayıcıda saklanan rol bilgisi tek başına yönetici erişimi sağlamaz. Ekip hesapları ve rol bazlı çok kullanıcılı yönetim etkin değildir.

## Para akışının sınırları

- Yatırım adresi sunucudaki etkin adres havuzundan atanır. Üye zincir işlem kimliğini girer; yönetici yatırımı haricen inceler ve onaylarsa bakiye defteri güncellenir.
- Çekim onayı öncesinde transfer yönetici tarafından dış cüzdandan gönderilir. Transferin zincir işlem kimliği kayda girilir ve bakiye defteri aynı kararda güncellenir.
- Uygulama zincir gezgini üzerinden ödeme doğrulamaz, özel anahtar saklamaz veya zincire otomatik ödeme göndermez.
- Bonus/komisyon hesaplaması ve ödemesi, e-posta/SMS gönderimi, OAuth ve çok kullanıcılı ekip rolleri bağlı değildir; arayüz bunların çalıştığını iddia etmez.

## Temel ekranlar

- Üye paneli: bakiye, işlemler, cüzdanlar, destek, referans kayıtları ve yayınlanan içerik
- Yönetici paneli: işlem kuyruğu, cüzdan adresleri, kullanıcı/KYC incelemesi, destek, içerik, kur/bakım ayarları ve audit
- Eski `owner` ve ekip sayfaları, çalışan tek yönetici akışına yönlendirilir veya kaldırılmış özellikleri açıklayan sayfalara gider.
