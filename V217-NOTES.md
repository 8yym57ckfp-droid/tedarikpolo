# SafePays V217 — Üye kullanıcı adı + yeni kimlik sistemi

- Üyelikte Kullanıcı Adı zorunlu.
- Kullanıcı adı 3–20 karakter; harf/rakam/alt çizgi. Büyük-küçük harf normalize edilir.
- Kullanıcı adı kayıt sonrasında değiştirilemez; profil ekranında salt okunur.
- Aynı kullanıcı adı ikinci üyeye verilemez. Demo localStorage ve PostgreSQL tarafında benzersizlik kontrolü vardır.
- Kullanıcı ID: 8 haneli benzersiz rastgele sayı.
- İşlem ID: 10 karakter, büyük harf + rakam karışımı; yeni her işlem için benzersiz.
- İşlem detaylarında ilgili ekip, ödeme yapılan cüzdanın bağlı olduğu ekipten türetilir.
- Canlı destek insan desteğine aktarımında ilgili ekip bağlamı kullanılır.
- Kullanıcı işlem geçmişinde İlgili Ekip alanı gösterilir.
