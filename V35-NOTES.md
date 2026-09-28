# Safepays v35

- Yatırım ve çekim talepleri tekrarlı oluşturulabilir; her başarılı gönderim ayrı DP-/WD- işlem ID'si alır.
- Her form gönderiminde benzersiz requestKey üretilir; çift tıklama aynı isteği çoğaltmaz.
- Yatırım TX hash'i blockchain tarafında tekilleştirilir; aynı gerçek TX'nin ikinci kez yatırılması engellenir.
- Çekim formunda gerçek demo bakiye backend'den gösterilir.
- İşlem geçmişi artık `/api/transactions` üzerinden gerçek kullanıcı işlemlerini listeler.
- Demo ERC20/TRC20 örnek adresleri düzeltildi.
- Manuel admin onayı korunur; otomatik yatırım onayı yoktur.
