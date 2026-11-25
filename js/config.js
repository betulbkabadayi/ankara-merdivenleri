// Supabase bağlantı bilgileri. anon anahtarı herkese açık olacak şekilde tasarlanmıştır;
// yetkiyi veritabanı kuralları (supabase/schema.sql) sağlar.
// Boş bırakılırsa uygulama "demo modu"nda çalışır (veriler sadece bu tarayıcıda tutulur).
window.APP_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
};
