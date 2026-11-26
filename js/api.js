// Veri katmanı: Supabase (PostgREST + Storage) veya demo (localStorage).
// Giriş yok: yazma işlemleri cihaz anahtarı (edit token) ve isteğe bağlı davet koduyla yapılır.

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

function randomToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
function uuid() { return crypto.randomUUID(); }

// ---- Cihaz kimliği: bu cihazda oluşturulan kayıtları düzenleme yetkisi
export const identity = {
  token() {
    let t = LS.get("st_token", null);
    if (!t) { t = randomToken(); LS.set("st_token", t); }
    return t;
  },
  mine(kind) { return new Set(LS.get("st_mine_" + kind, [])); },
  addMine(kind, id) { const s = identity.mine(kind); s.add(id); LS.set("st_mine_" + kind, [...s]); },
  removeMine(kind, id) { const s = identity.mine(kind); s.delete(id); LS.set("st_mine_" + kind, [...s]); },
  code() { return LS.get("st_code", ""); },
  setCode(c) { LS.set("st_code", c); },
  admin() { return LS.get("st_admin", ""); },
  setAdmin(c) { LS.set("st_admin", c); },
  profile() { return LS.get("st_profile", { first: "", last: "" }); },
  setProfile(p) { LS.set("st_profile", p); },
};

const ERRORS = {
  DAVET_KODU_HATALI: "Davet kodu hatalı.",
  COK_FAZLA_ISTEK: "Çok fazla istek geldi, bir dakika sonra tekrar deneyin.",
  YETKISIZ: "Bu kaydı düzenleme yetkiniz yok (başka cihazdan eklenmiş olabilir).",
  GECERSIZ_ANAHTAR: "Cihaz anahtarı geçersiz, sayfayı yenileyin.",
  KONTENJAN_DOLU: "Bu çekimin kontenjanı dolu.",
  ZATEN_KATILIYOR: "Bu isimle zaten katılım kaydı var.",
  FOTOGRAF_LIMITI: "Bir yere en fazla 5 fotoğraf eklenebilir.",
  YER_YOK: "Bu yer artık yok.",
};
function friendly(msg) {
  for (const k of Object.keys(ERRORS)) if (msg && msg.includes(k)) return new Error(ERRORS[k]);
  if (msg && /check constraint|violates/.test(msg)) return new Error("Girilen bilgiler geçerli değil, alanları kontrol edin.");
  return new Error(msg || "Bilinmeyen hata");
}

const cfg = window.APP_CONFIG || {};
const params = new URLSearchParams(location.search);
export const isDemo = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || params.get("demo") === "1";

// ======================================================= Supabase
const remote = {
  headers(extra = {}) {
    return { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY, ...extra };
  },
  async request(path, opts = {}) {
    const res = await fetch(cfg.SUPABASE_URL + path, { cache: "no-store", ...opts, headers: this.headers(opts.headers) });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) throw friendly((body && (body.message || body.error)) || String(text));
    return body;
  },
  rpc(name, args) {
    return this.request("/rest/v1/rpc/" + name, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args),
    });
  },
  ext: false, // yeni alanlar (saat, buluşma yeri, pratik bilgi, yorumlar) veritabanında var mı?
  async init() {
    // schema.sql güncel çalıştırılmadıysa yeni özellikler gizlenir, uygulama eskisi gibi çalışır.
    this.ext = await this.request("/rest/v1/places?select=meet_time&limit=1").then(() => true, () => false);
    try { return { codeRequired: !!(await this.rpc("code_required", {})) }; } catch { return { codeRequired: false }; }
  },
  checkCode: (code) => remote.rpc("check_code", { p_code: code }),
  checkAdmin: (code) => remote.rpc("check_admin", { p_admin: code }),
  listPlaces() {
    const sel = "id,name,category,lat,lng,district,address,planned_date,notes,status,max_attendees,author_name,created_at," +
      (this.ext ? "meet_time,meet_point,info,place_comments(id,author_name,body,created_at)," : "") +
      "place_photos(id,path),attendees(id,first_name,last_name,created_at)";
    return this.request("/rest/v1/places?select=" + encodeURIComponent(sel) + "&order=planned_date.asc.nullslast,created_at.asc");
  },
  async addPlace(d, code) {
    const id = await this.rpc("add_place", {
      p_code: code || null, p_token: identity.token(), p_name: d.name, p_category: d.category,
      p_lat: d.lat, p_lng: d.lng, p_district: d.district || null, p_address: d.address || null,
      p_planned_date: d.planned_date, p_notes: d.notes || null, p_author: d.author,
      p_max_attendees: d.max_attendees || null, ...this.extArgs(d),
    });
    identity.addMine("places", id);
    return id;
  },
  extArgs(d) {
    return this.ext ? { p_meet_time: d.meet_time || null, p_meet_point: d.meet_point || null, p_info: d.info || null } : {};
  },
  updatePlace(id, d) {
    return this.rpc("update_place", {
      p_token: identity.token(), p_id: id, p_name: d.name, p_category: d.category,
      p_district: d.district || null, p_address: d.address || null, p_planned_date: d.planned_date,
      p_notes: d.notes || null, p_status: d.status, p_max_attendees: d.max_attendees || null,
      p_lat: d.lat ?? null, p_lng: d.lng ?? null, p_admin: identity.admin() || null, ...this.extArgs(d),
    });
  },
  async addComment(placeId, author, body, code) {
    const id = await this.rpc("add_comment", {
      p_code: code || null, p_token: identity.token(), p_place_id: placeId, p_author: author, p_body: body,
    });
    identity.addMine("comments", id);
    return id;
  },
  async deleteComment(id) {
    await this.rpc("delete_comment", { p_token: identity.token(), p_id: id, p_admin: identity.admin() || null });
    identity.removeMine("comments", id);
  },
  async photoPaths(filter) {
    const rows = await this.request("/rest/v1/place_photos?select=path&" + filter);
    return rows.map((r) => r.path);
  },
  // Veritabanı kaydı silindikten sonra dosyalar yetim kalır; yetim dosyaları Storage API ile sileriz (en iyi çaba).
  async removeFiles(paths) {
    if (!paths.length) return;
    try {
      await this.request("/storage/v1/object/place-photos", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }),
      });
    } catch (e) { console.warn("Dosya temizliği başarısız:", e.message); }
  },
  async deletePlace(id) {
    const paths = await this.photoPaths("place_id=eq." + id).catch(() => []);
    await this.rpc("delete_place", { p_token: identity.token(), p_id: id, p_admin: identity.admin() || null });
    identity.removeMine("places", id);
    await this.removeFiles(paths);
  },
  async addPhoto(placeId, blob) {
    const path = `${placeId}/${uuid()}.jpg`;
    await this.request(`/storage/v1/object/place-photos/${path}`, {
      method: "POST", headers: { "Content-Type": blob.type || "image/jpeg", "x-upsert": "false" }, body: blob,
    });
    await this.rpc("add_photo", { p_token: identity.token(), p_place_id: placeId, p_path: path, p_admin: identity.admin() || null });
  },
  async deletePhoto(photoId) {
    const paths = await this.photoPaths("id=eq." + photoId).catch(() => []);
    await this.rpc("delete_photo", { p_token: identity.token(), p_photo_id: photoId, p_admin: identity.admin() || null });
    await this.removeFiles(paths);
  },
  async addAttendee(placeId, first, last, code) {
    const id = await this.rpc("add_attendee", {
      p_code: code || null, p_token: identity.token(), p_place_id: placeId, p_first: first, p_last: last,
    });
    identity.addMine("attendees", id);
    return id;
  },
  async removeAttendee(id) {
    await this.rpc("remove_attendee", { p_token: identity.token(), p_id: id, p_admin: identity.admin() || null });
    identity.removeMine("attendees", id);
  },
  photoUrl: (path) => `${cfg.SUPABASE_URL}/storage/v1/object/public/place-photos/${path}`,
};

// ======================================================= Demo (localStorage)
const demo = {
  ext: true,
  db() { return { comments: [], ...LS.get("st_demo_db", { places: [], photos: [], attendees: [] }) }; },
  save(db) {
    try { LS.set("st_demo_db", db); } catch { throw new Error("Demo depolama dolu (fotoğraf çok büyük)."); }
  },
  async init() { return { codeRequired: false }; },
  async checkCode() { return true; },
  async checkAdmin() { return false; },
  async listPlaces() {
    const db = this.db();
    return db.places.map((p) => ({
      ...p,
      place_photos: db.photos.filter((x) => x.place_id === p.id),
      attendees: db.attendees.filter((x) => x.place_id === p.id),
      place_comments: db.comments.filter((x) => x.place_id === p.id),
    })).sort((a, b) => a.planned_date.localeCompare(b.planned_date));
  },
  async addPlace(d) {
    const db = this.db(); const id = uuid();
    db.places.push({
      id, name: d.name.trim(), category: d.category, lat: d.lat, lng: d.lng, district: d.district || null,
      address: d.address || null, planned_date: d.planned_date, notes: d.notes || null, status: "onerildi",
      max_attendees: d.max_attendees || null, author_name: d.author.trim(), created_at: new Date().toISOString(),
      meet_time: d.meet_time || null, meet_point: d.meet_point || null, info: d.info || null,
    });
    this.save(db); identity.addMine("places", id); return id;
  },
  async updatePlace(id, d) {
    const db = this.db(); const p = db.places.find((x) => x.id === id);
    if (!p) throw friendly("YER_YOK");
    Object.assign(p, {
      name: d.name.trim(), category: d.category, district: d.district || null, address: d.address || null,
      planned_date: d.planned_date || null, notes: d.notes || null, status: d.status, max_attendees: d.max_attendees || null,
      lat: d.lat ?? p.lat, lng: d.lng ?? p.lng,
      meet_time: d.meet_time || null, meet_point: d.meet_point || null, info: d.info || null,
    });
    this.save(db);
  },
  async addComment(placeId, author, body) {
    const db = this.db();
    if (!db.places.some((x) => x.id === placeId)) throw friendly("YER_YOK");
    const id = uuid();
    db.comments.push({ id, place_id: placeId, author_name: author.trim(), body: body.trim(), created_at: new Date().toISOString() });
    this.save(db); identity.addMine("comments", id); return id;
  },
  async deleteComment(id) {
    const db = this.db(); db.comments = db.comments.filter((x) => x.id !== id);
    this.save(db); identity.removeMine("comments", id);
  },
  async deletePlace(id) {
    const db = this.db();
    db.places = db.places.filter((x) => x.id !== id);
    db.photos = db.photos.filter((x) => x.place_id !== id);
    db.attendees = db.attendees.filter((x) => x.place_id !== id);
    db.comments = db.comments.filter((x) => x.place_id !== id);
    this.save(db); identity.removeMine("places", id);
  },
  async addPhoto(placeId, blob) {
    const db = this.db();
    if (db.photos.filter((x) => x.place_id === placeId).length >= 5) throw friendly("FOTOGRAF_LIMITI");
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    db.photos.push({ id: uuid(), place_id: placeId, path: dataUrl });
    this.save(db);
  },
  async deletePhoto(photoId) { const db = this.db(); db.photos = db.photos.filter((x) => x.id !== photoId); this.save(db); },
  async addAttendee(placeId, first, last) {
    const db = this.db(); const p = db.places.find((x) => x.id === placeId);
    if (!p) throw friendly("YER_YOK");
    const mine = db.attendees.filter((x) => x.place_id === placeId);
    if (p.max_attendees && mine.length >= p.max_attendees) throw friendly("KONTENJAN_DOLU");
    const key = (first + " " + last).trim().toLowerCase();
    if (mine.some((x) => (x.first_name + " " + x.last_name).toLowerCase() === key)) throw friendly("ZATEN_KATILIYOR");
    const id = uuid();
    db.attendees.push({ id, place_id: placeId, first_name: first.trim(), last_name: last.trim(), created_at: new Date().toISOString() });
    this.save(db); identity.addMine("attendees", id); return id;
  },
  async removeAttendee(id) {
    const db = this.db(); db.attendees = db.attendees.filter((x) => x.id !== id);
    this.save(db); identity.removeMine("attendees", id);
  },
  photoUrl: (path) => path,
};

const impl = isDemo ? demo : remote;
export const api = {
  init: () => impl.init(),
  get ext() { return impl.ext; },
  addComment: (pid, author, body, code) => impl.addComment(pid, author, body, code),
  deleteComment: (id) => impl.deleteComment(id),
  checkCode: (c) => impl.checkCode(c),
  checkAdmin: (c) => impl.checkAdmin(c),
  listPlaces: () => impl.listPlaces(),
  addPlace: (d, code) => impl.addPlace(d, code),
  updatePlace: (id, d) => impl.updatePlace(id, d),
  deletePlace: (id) => impl.deletePlace(id),
  addPhoto: (id, blob) => impl.addPhoto(id, blob),
  deletePhoto: (id) => impl.deletePhoto(id),
  addAttendee: (pid, f, l, code) => impl.addAttendee(pid, f, l, code),
  removeAttendee: (id) => impl.removeAttendee(id),
  photoUrl: (p) => impl.photoUrl(p),
};

// ---- Fotoğraf küçültme (1600 px, JPEG)
export async function resizeImage(file, maxSide = isDemo ? 640 : 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) throw new Error("Bu fotoğraf okunamadı: " + file.name);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Küçültme başarısız"))), "image/jpeg", quality));
}

// ---- Adres arama (Nominatim, Ankara çevresi)
export async function searchAddress(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=tr&countrycodes=tr" +
    "&viewbox=32.3,40.2,33.3,39.5&bounded=0&q=" + encodeURIComponent(q.toLowerCase().includes("ankara") ? q : q + " Ankara");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Adres araması başarısız");
  return (await res.json()).map((r) => ({ name: r.display_name, lat: parseFloat(r.lat), lng: parseFloat(r.lon) }));
}
