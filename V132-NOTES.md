# V132 — Sabit banner şablonu ve görsel ölçü doğrulaması

- Owner İçerik Merkezi görsel şablonu 1200 × 675 px (16:9) olarak sabitlendi.
- Farklı ebatta görsel seçildiğinde yayınlanmıyor; kullanıcıya “1200 × 675 px (16:9) olarak ayarlayıp tekrar yükleyin” uyarısı gösteriliyor.
- Native alert yerine form altında Safepays temalı inline hata mesajı kullanılıyor.
- Üye ana sayfa bannerı 16:9 sabit oranlı; görsel `object-fit: cover` ile kartın dışına taşmıyor ve banner yüksekliği görsel nedeniyle büyümüyor.
- Owner önizlemesi de 16:9 sabit şablona bağlandı.
