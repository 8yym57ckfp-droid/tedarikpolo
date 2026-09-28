# Safepays v50

- Geçmiş işlemlerde onaylanmış kayıtlar yeniden işleme alınamaz.
- Reddedilen ve 30 dakika sonunda otomatik reddedilen işlemler `↻ Tekrar Panoya Al` ile yeniden Beklenen İşlemler kuyruğuna alınabilir.
- Yeniden açılan işlem yeni 30 dakikalık inceleme süresine girer.
- `reopenCount`, `reopenedAt`, `previousStatus` ve `originalCreatedAt` alanları korunur.
- requests.html içindeki yeniden açma işlemi merkezi `SafepaysDemo.reopen()` fonksiyonunu kullanır.
- Demo/localStorage mimarisi korunmuştur; gerçek üretim ortamında yeniden açma işlemi backend + audit log ile yetkilendirilmelidir.
