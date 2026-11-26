# Ankara Merdivenleri

Ankara'daki dış ve iç mekan merdivenlerini birlikte keşfetmek ve fotoğraflamak için ekip uygulaması.
Statik site (GitHub Pages) + Supabase (Postgres + Storage). Giriş yok.

## Özellikler
- Yer önerisi: ad, kategori (dış/iç mekan), haritada konum, önerilen çekim tarihi (zorunlu); ilçe, adres, not, kontenjan, fotoğraf (isteğe bağlı, en fazla 5)
- Herkes herkesin eklediği yerleri harita ve takvim görünümünde görür
- Buluşma saati/noktası ve pratik bilgiler (ücret, çalışma saati, izin…), her yerin altında yorumlar
- Detayda **Paylaş**, **Takvime ekle** (.ics ve Google Takvim); listede "Bu hafta" grubu, aynı güne düşen yerler için "Rotayı aç"
- **Katılacağım**: ad + soyad ile çekime katılım, katılımcı listesi, vazgeçme
- Filtre: kategori, durum, tarih, arama, "Katıldıklarım", "Eklediklerim"; CSV dışa aktarma ve tüm veriyi JSON yedek olarak indirme (Yedek)
- Yeni yer eklerken yakında/benzer adlı kayıt varsa uyarı
- Yönetici modunda **Toplu işlem**: seçilen kayıtları toplu sil / "Çekildi" / "İptal" yap
- **Sergi** (yönetici modunda; oylama açılınca herkese görünür): gizli oylama (oy veren kaydedilmez, oy hakkını yönetici belirler, kişi kendi yerinin fotoğrafına oy veremez, oylama sürerken çeken kişi ve yer gizli, sıra rastgele), yönetici oylamayı açıp kapatır, Aday/Seçildi işaretler ve seçilenleri CSV indirir. Oy sayılarını yönetici her zaman, diğerleri oylama kapanınca görür
- Düzenleme/silme yalnızca kaydı ekleyen cihazdan (cihaz anahtarı)
- İsteğe bağlı ortak davet kodu (bot ve istenmeyen ekleme koruması)
- Mobil öncelikli, Türkçe arayüz

## Kurulum (Supabase)
1. [supabase.com](https://supabase.com) üzerinde yeni bir proje oluşturun.
2. SQL Editor'de `supabase/schema.sql` dosyasını çalıştırın (tekrar çalıştırılabilir). Mevcut bir kurulumda saat/buluşma/pratik bilgi ve yorum özellikleri için dosyayı **yeniden çalıştırın**; çalıştırılana kadar bu alanlar gizli kalır, uygulama eskisi gibi çalışır.
3. İsteğe bağlı davet kodu: `schema.sql` sonundaki örnek `insert` komutunu kendi kodunuzla çalıştırın.
4. `js/config.js` içine **Project URL** ve **anon public** anahtarını yazın (Settings → API). Anon anahtarı herkese açık olacak şekilde tasarlanmıştır; yetkiyi veritabanı kuralları sağlar.
5. Repoyu GitHub Pages ile yayınlayın (Settings → Pages → `main` / root).

`config.js` boşsa uygulama **demo modunda** çalışır; veriler yalnızca o tarayıcıda saklanır. `?demo=1` ile de zorlanabilir.

## Güvenlik modeli
- Tablolara anon yalnızca belirli sütunları **okuyabilir** (`edit_token_hash` hiçbir zaman okunamaz).
- Tüm yazma işlemleri `SECURITY DEFINER` fonksiyonlardan geçer: alan doğrulama, Ankara sınırları, hız sınırı, davet kodu, fotoğraf limiti.
- Cihaz anahtarı tarayıcıda (`localStorage`) tutulur, veritabanında yalnızca SHA-256 özeti saklanır. Anahtarı kaybeden kullanıcı kaydını düzenleyemez; yönetici Supabase panelinden düzenler/siler.
- Fotoğraf deposu: 5 MB, yalnızca JPEG/PNG/WebP; yükleme mevcut bir yerin klasörüne yapılabilir.

## Yönetim
- Kayıt silmek/düzenlemek: Supabase → Table Editor.
- Davet kodunu değiştirmek: `schema.sql` sonundaki `insert ... on conflict` komutu. Kaldırmak için: `delete from public.app_settings where key = 'invite_code_hash';`
- Supabase ücretsiz projeleri 1 hafta hareketsizlikte duraklar; sitenin düzenli açılması yeterlidir (`.github/workflows/keepalive.yml` haftalık ping atar).

## Yerel çalıştırma
```
python3 -m http.server 8000   # sonra http://localhost:8000/?demo=1
```
