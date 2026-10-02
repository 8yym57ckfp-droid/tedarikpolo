# SafePays

SafePays; üye hesapları, USDT yatırım/çekim talepleri, destek kayıtları, yönetici içerikleri, audit kayıtları ve bakiye defteri için Node.js tabanlı bir uygulamadır.

## Yerel çalıştırma

1. Node.js kurulu bir ortamda bağımlılıkları yükleyin: `npm install`.
2. Aşağıdaki değişkenleri ortamınıza tanımlayın.
3. Uygulamayı `npm start` ile başlatın.

Yönetici hesabı için `ADMIN_EMAIL`, `ADMIN_PASSWORD` ve `ADMIN_TOTP_SECRET` zorunludur. 2FA kodu Google Authenticator uyumlu TOTP uygulamasından üretilir. Uygulama varsayılan yönetici parolası veya test hesabı oluşturmaz.

Yerel geliştirmede `DATABASE_URL` verilmediğinde veriler `server/data/db.json` dosyasına yazılır. Bu dosya yalnızca geliştirme içindir; üretim yayınında kalıcı depolama sayılmaz.

## Render dağıtımı

Render web servisi `render.yaml` dosyasını kullanır. Üretim başlangıcı `DATABASE_URL` ve PostgreSQL sürücüsü olmadan durur.

1. Render’da PostgreSQL veritabanı oluşturun.
2. Web servisindeki `DATABASE_URL` değişkenini veritabanı bağlantı adresine bağlayın; `PGSSL=true` kalsın.
3. `ADMIN_EMAIL`, güçlü `ADMIN_PASSWORD` ve güvenli `ADMIN_TOTP_SECRET` değerlerini Render gizli değişkenlerine ekleyin.
4. İhtiyaç varsa `ALLOWED_ORIGINS` değerini virgülle ayrılmış, izinli origin adresleriyle ayarlayın.
5. Eski Render örneğinde yalnızca geçici dosya sisteminde bulunan kayıtlar otomatik taşınmaz. Yayından önce kurtarılabilir verileri dışa aktarın; veritabanı şemasını uygulama başlarken günceller.

## Bağlı akışlar

- Üyelik, giriş, bakiye, işlem geçmişi ve bakiye defteri sunucu API’sini kullanır.
- Yönetici cüzdan adresleri, içerik, bakım ayarları, kur, destek biletleri ve audit kayıtları PostgreSQL’e yazılır.
- Üye yatırım başlatınca aktif yönetici adreslerinden biri sunucuda atanır. Üye zincir işlem kimliğini gönderir; yatırım admin tarafından elle incelenir.
- Çekim talebi sunucuya kaydolur. Gönderim uygulama tarafından otomatik yapılmaz: yönetici dış cüzdandan transferi yaptıktan sonra işlem kimliğini girerek talebi onaylar.
- Bu sürüm blokzincir gezgini üzerinden yatırımı/çekimi otomatik doğrulamaz ve saklama cüzdanı ya da ödeme sağlayıcısı içermez. Gerçek fonları kullanmadan önce seçilen ağa uygun doğrulama/ödeme sağlayıcısı ve gerekli operasyon prosedürü ayrıca kurulmalıdır.
- Şifre sıfırlama e-postası, SMS doğrulama, OAuth girişi, otomatik bonus/komisyon ödemesi ve çok kullanıcılı ekip rolleri sağlayıcı/arka uç bağlantıları olmadığı için etkin değildir. Arayüz bu işlemlerin tamamlandığını iddia etmez.

## Yönetim ekranları

- Bekleyen talepler: `/admin/requests.html`
- Çekim talepleri: `/admin/withdrawal-pool.html` (bekleyen çekim kuyruğuna yönlendirir)
- Cüzdan adresleri: `/admin/wallet-addresses.html`
- Destek: `/admin/support.html`
- Bakiye geçmişi: `/balance-history.html`

## Oran sağlayıcıları

Piyasa oranı sağlayıcılarından hiçbiri erişilebilir değilse API oranı hata döndürür; statik/fallback piyasa fiyatı kullanmaz. Böylece geçersiz veya örnek fiyatla işlem teklifi oluşturulmaz.
