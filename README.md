# SafePays

SafePays; üye hesapları, USDT yatırım/çekim talepleri, destek kayıtları, yönetici içerikleri, audit kayıtları ve bakiye defteri için Node.js tabanlı bir uygulamadır.

## Yerel çalıştırma

1. Node.js kurulu bir ortamda bağımlılıkları yükleyin: `npm install`.
2. Aşağıdaki değişkenleri ortamınıza tanımlayın.
3. Uygulamayı `npm start` ile başlatın.

Owner hesabı için `ADMIN_EMAIL`, `ADMIN_PASSWORD` ve `ADMIN_TOTP_SECRET`; ayrı Admin ekip hesabı için `TEAM_ADMIN_EMAIL`, `TEAM_ADMIN_PASSWORD` ve `TEAM_ADMIN_TOTP_SECRET` zorunludur. İki hesapta e-posta, parola ve TOTP gizli anahtarı birbirinden farklı olmalıdır. Üye girişi `/login.html`, Admin ekip girişi `/admin/login.html`, Owner girişi `/owner/login.html` üzerinden yapılır. Oturum çerezleri ve sunucu API yetkileri portala göre ayrıdır; Admin oturumu Owner sayfalarını veya Owner’a özel API’leri açamaz.

Yerel geliştirmede `DATABASE_URL` verilmediğinde veriler `server/data/db.json` dosyasına yazılır. Bu dosya yalnızca geliştirme içindir; üretim yayınında kalıcı depolama sayılmaz.

## Render dağıtımı

Render web servisi `render.yaml` dosyasını kullanır. Üretim başlangıcı `DATABASE_URL` ve PostgreSQL sürücüsü olmadan durur.

1. Render’da PostgreSQL veritabanı oluşturun.
2. Web servisindeki `DATABASE_URL` değişkenini veritabanı bağlantı adresine bağlayın; `PGSSL=true` kalsın.
3. Owner için `ADMIN_EMAIL`, güçlü `ADMIN_PASSWORD` ve `ADMIN_TOTP_SECRET` değerlerini ayarlayın.
4. Ayrı Admin ekip hesabı için `TEAM_ADMIN_EMAIL`, farklı `TEAM_ADMIN_PASSWORD` ve ayrı `TEAM_ADMIN_TOTP_SECRET` değerlerini ayarlayın. Bunları `Safepays Production` ortam grubuna veya web servisinin gizli değişkenlerine ekleyin.
5. İhtiyaç varsa `ALLOWED_ORIGINS` değerini virgülle ayrılmış, izinli origin adresleriyle ayarlayın.
6. Eski Render örneğinde yalnızca geçici dosya sisteminde bulunan kayıtlar otomatik taşınmaz. Yayından önce kurtarılabilir verileri dışa aktarın; veritabanı şemasını uygulama başlarken günceller.

## Bağlı akışlar

- Üyelik, giriş, bakiye, işlem geçmişi ve bakiye defteri sunucu API’sini kullanır.
- Yönetici cüzdan adresleri, içerik, bakım ayarları, kur, destek biletleri ve audit kayıtları PostgreSQL’e yazılır.
- Üye yatırım başlatınca aktif yönetici adreslerinden biri sunucuda atanır. Üye zincir işlem kimliğini gönderir; yatırım admin tarafından elle incelenir.
- Çekim talebi sunucuya kaydolur. Gönderim uygulama tarafından otomatik yapılmaz: yönetici dış cüzdandan transferi yaptıktan sonra işlem kimliğini girerek talebi onaylar.
- Bekleyen yatırım ve çekim taleplerinde admin, USDT transferini TRON solidified receipt veya Ethereum finalized receipt üzerinden salt okunur olarak kontrol edebilir. Bu kontrol bakiye değiştirmez ve talebi otomatik onaylamaz; son karar adminindir. TRON için `TRONGRID_API_KEY` (düşük hacimde anahtarsız sınırlı erişim de mümkündür), Ethereum için `ETHEREUM_RPC_URL` gerekir.
- Bu sürüm saklama cüzdanı veya otomatik ödeme gönderimi içermez. Çekim transferini yönetici dış cüzdandan yapar ve işlem kimliğini talebi onaylarken kaydeder.
- Şifre sıfırlama e-postası, SMS doğrulama, OAuth girişi, otomatik bonus/komisyon ödemesi ve çok kullanıcılı ekip rolleri sağlayıcı/arka uç bağlantıları olmadığı için etkin değildir. Arayüz bu işlemlerin tamamlandığını iddia etmez.

## Yönetim ekranları

- Bekleyen talepler: `/admin/requests.html`
- Çekim talepleri: `/admin/withdrawal-pool.html` (bekleyen çekim kuyruğuna yönlendirir)
- Cüzdan adresleri: `/admin/wallet-addresses.html`
- Destek: `/admin/support.html`
- Bakiye geçmişi: `/balance-history.html`

## İzole finans test verisi

Owner panelindeki **Finans Test Verisi** ekranı, işlem geçmişi olmayan ve bakiyesi sıfır olan mevcut bir test üyesine 90 günlük sentetik geçmiş oluşturur. Her gün onaylı yatırım ve çekim hareketi bulunur; ayrıca seyrek reddedilmiş talepler ve test edilebilir birer bekleyen yatırım/çekim talebi oluşturulur. Tüm talepler en az 50 USDT'dir. Eklenen üyelerin ad-soyadları sentetik olarak üretilir, e-posta alanları `example.invalid` etki alanını kullanır ve gerçek cüzdan/transfer kimliği eklenmez. Bekleyen sentetik talepleri onaylamak standart bakiye defteri yolunu kullanır, dışarıya transfer göndermez.

Bu özellik varsayılan olarak kapalıdır. Kontrollü bir test ortamında seed ekranını kullanacağınız sırada `SYNTHETIC_FINANCE_SEED_ENABLED=true` ayarını açın. Önce seçilen boş hesap geçerli Owner TOTP kodu ve e-posta/ID onayıyla `is_test_account` olarak işaretlenir ve üretim listeleri/toplamlarından çıkarılır. Ayrı bir onay ve yeni Owner TOTP koduyla 90 günlük veri oluşturulur. İşlem tamamlandıktan sonra ayarı tekrar kapatın. Her kullanıcı, talep ve bakiye defteri satırı `is_synthetic` ve `test_run_id` ile işaretlenir. Owner panelindeki rapor, mutabakat ve özet ekranları `testRunId` bağlantısıyla yalnızca ilgili koşuyu gösterir; varsayılan üretim/Admin toplamları test hesabı ve sentetik kayıtları dışarıda bırakır.

Mevcut uygulamada gerçek komisyon ödeme/dağıtım modeli bulunmadığı için sentetik koşunun raporlarında yalnızca görünürlük testi amacıyla onaylı yatırımların %3'ü raporlama komisyonu olarak hesaplanır; bu tutar bakiyeye, ödeme akışına veya üretim komisyon kayıtlarına yazılmaz.

## Oran sağlayıcıları

Piyasa oranı sağlayıcılarından hiçbiri erişilebilir değilse API oranı hata döndürür; statik/fallback piyasa fiyatı kullanmaz. Böylece geçersiz veya örnek fiyatla işlem teklifi oluşturulmaz.
