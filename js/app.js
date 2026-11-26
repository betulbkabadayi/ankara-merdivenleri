import { api, identity, isDemo, resizeImage, searchAddress, DEFAULT_CATS } from "./api.js?v=18";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STATUS = { onerildi: "Önerildi", cekildi: "Çekildi", iptal: "İptal" };
const ANKARA = { lat: 39.9208, lng: 32.8541 };
const BOUNDS = { latMin: 39.0, latMax: 40.8, lngMin: 31.0, lngMax: 34.0 };
const MAX_PHOTOS = 5;

const state = { places: [], cats: DEFAULT_CATS.map((c) => ({ ...c })), codeRequired: false, cat: "", q: "", status: "aktif", when: "", mine: false, mineP: false, view: "list", detailId: null, bulk: false, sel: new Set() };

// ------------------------------------------------------------------ kategoriler (düzenlenebilir, iki seviyeli)
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
const catById = (id) => state.cats.find((c) => c.id === id);
const catRoots = () => state.cats.filter((c) => !c.parent_id);
const catChildren = (id) => state.cats.filter((c) => c.parent_id === id);
function catLabel(id) {
  const c = catById(id);
  if (!c) return "Kategorisiz";
  const p = c.parent_id && catById(c.parent_id);
  return p ? `${p.name} › ${c.name}` : c.name;
}
const catColor = (id) => { const c = catById(id); return safeColor(c?.color) || safeColor(catById(c?.parent_id)?.color) || "#6b7280"; };
// Seçili kategori bir ana kategoriyse altkategorilerindeki yerler de dahil edilir.
const inCat = (p, sel) => !sel || p.category === sel || catById(p.category)?.parent_id === sel;
const canEditCat = (c) => isAdmin() || identity.mine("categories").has(c.id);

// ------------------------------------------------------------------ yardımcılar
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (s) => !s ? "Tarih belirlenmedi" : new Date(s + "T00:00:00").toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = (s) => !s ? "Tarih belirlenmedi" : new Date(s + "T00:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
const isAdmin = () => !!identity.admin();
const canEdit = (p) => isAdmin() || identity.mine("places").has(p.id);
const byDate = (a, b) => (a.planned_date || "9999").localeCompare(b.planned_date || "9999");
const fullName = (a) => `${a.first_name} ${a.last_name}`;
const inBounds = (lat, lng) => lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lng >= BOUNDS.lngMin && lng <= BOUNDS.lngMax;
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
const daysUntil = (s) => Math.round((new Date(s + "T00:00:00") - new Date(todayStr() + "T00:00:00")) / 864e5);
const fmtStamp = (s) => new Date(s).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dirUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
const shareUrl = (p) => location.origin + location.pathname + "#yer=" + p.id;
const profileName = () => { const p = identity.profile(); return p.author || [p.first, p.last].filter(Boolean).join(" "); };

// ---- Takvim (.ics / Google Takvim) ve paylaşma
// Türkiye yıl boyu UTC+3 olduğundan saatli etkinlikler UTC'ye sabit farkla çevrilir.
function eventTimes(p) {
  const [y, m, d] = p.planned_date.split("-").map(Number);
  if (p.meet_time) {
    const [hh, mm] = hhmm(p.meet_time).split(":").map(Number);
    const fmt = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const start = Date.UTC(y, m - 1, d, hh - 3, mm);
    return { allDay: false, start: fmt(start), end: fmt(start + 2 * 3600e3) };
  }
  return { allDay: true, start: p.planned_date.replace(/-/g, ""), end: new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, "") };
}
function eventInfo(p) {
  const loc = [p.name, p.address, p.district].filter(Boolean).join(", ");
  const details = [p.meet_point && "Buluşma: " + p.meet_point, p.info, p.notes, "Yol tarifi: " + dirUrl(p), "Detay: " + shareUrl(p)].filter(Boolean).join("\n");
  return { title: "Merdiven çekimi: " + p.name, loc, details };
}
function googleCalUrl(p) {
  const t = eventTimes(p), e = eventInfo(p);
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(e.title) +
    `&dates=${t.start}/${t.end}&details=` + encodeURIComponent(e.details) + "&location=" + encodeURIComponent(e.loc);
}
function downloadIcs(p) {
  const t = eventTimes(p), e = eventInfo(p);
  const x = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const when = t.allDay ? [`DTSTART;VALUE=DATE:${t.start}`, `DTEND;VALUE=DATE:${t.end}`] : [`DTSTART:${t.start}`, `DTEND:${t.end}`];
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ankara Merdivenleri//TR", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${p.id}@ankara-merdivenleri`, `DTSTAMP:${stamp}`, ...when, `SUMMARY:${x(e.title)}`, `LOCATION:${x(e.loc)}`,
    `GEO:${p.lat};${p.lng}`, `DESCRIPTION:${x(e.details)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = "ankara-merdivenleri.ics"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function sharePlace(p) {
  const url = shareUrl(p);
  const text = `${p.name} · ${fmtShort(p.planned_date)}${p.meet_time ? " " + hhmm(p.meet_time) : ""}`;
  if (navigator.share) {
    try { await navigator.share({ title: p.name, text, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(text + "\n" + url); toast("Bağlantı kopyalandı"); }
  catch { toast("Bağlantı kopyalanamadı: " + url, true); }
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (isError ? " error" : ""); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), isError ? 5000 : 2800);
}
function showError(el, msg) {
  el.textContent = msg; el.hidden = false;
  // Hata, form uzun olduğunda kaydırmadan görünsün
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function hideError(el) { el.hidden = true; el.textContent = ""; }

// İki aşamalı onay (tarayıcı confirm() yerine)
function armed(btn, label, run) {
  if (btn.dataset.armed) { clearTimeout(+btn.dataset.armed); delete btn.dataset.armed; btn.textContent = btn.dataset.label; run(); return; }
  btn.dataset.label = btn.textContent; btn.textContent = label;
  btn.dataset.armed = setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn.dataset.label; }, 4000);
}

// ------------------------------------------------------------------ ana harita
let map, markerLayer, mapNeedsFit = false;
function initMap() {
  map = L.map("map", { zoomControl: true }).setView([ANKARA.lat, ANKARA.lng], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  new ResizeObserver(() => {
    map.invalidateSize();
    // Harita gizliyken (mobilde Takvim sekmesi) sığdırma yapılamaz; görünür olunca yapılır.
    if (mapNeedsFit && $("#map").clientWidth > 0) { mapNeedsFit = false; render(true); }
  }).observe($("#map"));
}
// cls "cat" ise pin kategorinin rengiyle çizilir; "cekildi"/"iptal" durum renkleri kategoriden önceliklidir.
const pinIcon = (cls, color) => L.divIcon({
  className: "pin-wrap", html: `<div class="pin ${cls}"${cls === "cat" && safeColor(color) ? ` style="background:${safeColor(color)}"` : ""}></div>`,
  iconSize: [26, 26], iconAnchor: [13, 30],
});
const pinClass = (p) => (p.status === "cekildi" ? "cekildi" : p.status === "iptal" ? "iptal" : "cat");

// ------------------------------------------------------------------ filtre + çizim
function filtered() {
  const q = state.q.trim().toLocaleLowerCase("tr");
  const mine = identity.mine("attendees");
  const myPlaces = identity.mine("places");
  const today = todayStr();
  return state.places.filter((p) => {
    if (state.mineP && !myPlaces.has(p.id)) return false;
    if (!inCat(p, state.cat)) return false;
    if (state.status === "aktif") { if (p.status === "iptal") return false; }
    else if (state.status && p.status !== state.status) return false;
    const isPast = !!p.planned_date && p.planned_date < today;
    if (state.when === "upcoming" && isPast) return false;
    if (state.when === "past" && !isPast) return false;
    if (state.mine && !p.attendees.some((a) => mine.has(a.id))) return false;
    if (q) {
      const hay = [p.name, p.district, p.address, p.author_name, ...p.attendees.map(fullName)].join(" ").toLocaleLowerCase("tr");
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function updateFilterBadge() {
  const n = (state.status !== "aktif" ? 1 : 0) + (state.when ? 1 : 0) + (state.mine ? 1 : 0) + (state.mineP ? 1 : 0);
  $("#btn-filters").textContent = n ? `Filtre (${n})` : "Filtre";
}

function render(fit = false) {
  updateFilterBadge();
  const list = filtered();
  renderMap(list, fit);
  renderList(list);
}

function renderMap(list, fit) {
  markerLayer.clearLayers();
  for (const p of list) {
    L.marker([p.lat, p.lng], { icon: pinIcon(pinClass(p), catColor(p.category)), title: p.name, keyboard: true })
      .on("click", () => openDetail(p.id)).addTo(markerLayer);
  }
  if (fit && list.length && $("#map").clientWidth === 0) mapNeedsFit = true;
  else if (fit && list.length) {
    map.fitBounds(L.latLngBounds(list.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15 });
  }
}

function cardHtml(p) {
  const mine = identity.mine("places").has(p.id);
  const n = p.attendees.length;
  const cap = p.max_attendees ? `${n}/${p.max_attendees}` : String(n);
  const dd = p.planned_date && p.status === "onerildi" ? daysUntil(p.planned_date) : -1;
  const soon = dd >= 0 && dd <= 7 ? (dd === 0 ? "Bugün" : dd === 1 ? "Yarın" : `${dd} gün sonra`) : "";
  const sel = state.bulk && state.sel.has(p.id);
  return `<button class="card ${p.status === "iptal" ? "iptal" : ""} ${sel ? "selected" : ""}" style="border-left-color:${catColor(p.category)}" data-id="${esc(p.id)}">
    <div class="t">${state.bulk ? `<span class="selbox" aria-hidden="true">${sel ? "☑" : "☐"}</span>` : ""}${esc(p.name)}</div>
    <div class="m">
      ${soon ? `<span class="badge soon">${esc(soon)}</span>` : ""}
      ${p.meet_time ? `<span>🕙 ${esc(hhmm(p.meet_time))}</span>` : ""}
      <span>${esc(catLabel(p.category))}${p.district ? " · " + esc(p.district) : ""}</span>
      <span>👥 ${esc(cap)} katılımcı</span>
      <span>${esc(p.author_name)}</span>
      ${p.status !== "onerildi" ? `<span class="badge ${esc(p.status)}">${esc(STATUS[p.status])}</span>` : ""}
      ${mine ? `<span class="badge mine">Eklediğim</span>` : ""}
    </div></button>`;
}

function renderList(list) {
  $("#count").textContent = `${list.length} yer` + (state.places.length !== list.length ? ` (toplam ${state.places.length})` : "");
  const box = $("#list");
  if (!list.length) {
    box.innerHTML = `<div class="empty">${state.places.length ? "Filtreye uyan yer yok." : "Henüz yer eklenmemiş. İlk öneriyi sen ekle!"}</div>`;
    return;
  }
  const today = todayStr();
  const upcoming = list.filter((p) => p.planned_date && p.planned_date >= today).sort(byDate);
  const undated = list.filter((p) => !p.planned_date);
  const past = list.filter((p) => p.planned_date && p.planned_date < today).sort((a, b) => byDate(b, a));
  // Aynı güne 2+ yer varsa Google Maps'te çok duraklı rota bağlantısı (saate göre sıralı)
  const routeLink = (ps) => {
    const stops = ps.filter((p) => p.status !== "iptal").sort((a, b) => hhmm(a.meet_time || "99:99").localeCompare(hhmm(b.meet_time || "99:99")));
    if (stops.length < 2 || stops.length > 9) return "";
    return ` <a class="route" href="https://www.google.com/maps/dir/${stops.map((p) => p.lat + "," + p.lng).join("/")}" target="_blank" rel="noopener">Rotayı aç</a>`;
  };
  const group = (items, cls, route = false) => {
    const by = new Map();
    for (const p of items) { if (!by.has(p.planned_date)) by.set(p.planned_date, []); by.get(p.planned_date).push(p); }
    return [...by].map(([d, ps]) => `<h3 class="group-title ${cls}">${esc(fmtDate(d))}${route ? routeLink(ps) : ""}</h3>${ps.map(cardHtml).join("")}`).join("");
  };
  const thisWeek = upcoming.filter((p) => daysUntil(p.planned_date) <= 6), later = upcoming.filter((p) => daysUntil(p.planned_date) > 6);
  box.innerHTML = (thisWeek.length ? `<h3 class="week-title">Bu hafta</h3>` + group(thisWeek, "", true) : "") +
    (thisWeek.length && later.length ? `<h3 class="week-title later">Daha sonra</h3>` : "") + group(later, "", true) +
    (undated.length ? `<h3 class="group-title">Tarihi belirlenmemiş</h3>${undated.map(cardHtml).join("")}` : "") +
    (past.length ? `<h3 class="group-title past">— Geçmiş —</h3>` + group(past, "past") : "");
}

// ------------------------------------------------------------------ veri yükleme
let lastSig = "", lastCatSig = "";
async function reload(fit = false, quiet = false) {
  try {
    const [places, cats] = await Promise.all([api.listPlaces(), api.listCategories().catch(() => state.cats)]);
    const sig = JSON.stringify([places, cats]);
    hideError($("#error-banner"));
    // Arka plan yenilemesinde veri değişmediyse yeniden çizme (kaydırma/odak bozulmasın)
    if (quiet && sig === lastSig) return;
    lastSig = sig; state.places = places;
    const cs = JSON.stringify(cats);
    if (cs !== lastCatSig) {
      lastCatSig = cs; state.cats = cats;
      if (state.cat && !catById(state.cat)) state.cat = "";
      renderCatChips();
      if ($("#dlg-place").open) fillCategorySelect();
    }
  } catch (e) {
    if (!quiet) showError($("#error-banner"), "Veriler yüklenemedi: " + e.message);
    return;
  }
  render(fit);
  if (state.detailId && $("#dlg-detail").open) renderDetail(state.detailId);
}

// ------------------------------------------------------------------ davet kodu
let codeResolve = null;
function askCode() {
  return new Promise((resolve) => {
    codeResolve = resolve;
    const f = $("#form-code"); f.reset(); hideError($("#code-error"));
    $("#dlg-code").showModal();
  });
}
async function ensureCode() {
  if (!state.codeRequired) return "";
  const saved = identity.code();
  if (saved && (await api.checkCode(saved))) return saved;
  return askCode();
}

// ------------------------------------------------------------------ yer ekle / düzenle
let pickMap, pickMarker, pick = null, pendingFiles = [], editingId = null, dupAck = "";

// Yinelenen kayıt uyarısı: 100 m içinde ya da (2 km içinde ve) benzer adlı kayıt
const norm = (s) => String(s || "").toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]+/g, " ").trim();
function distM(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function findDuplicates(d) {
  const n = norm(d.name);
  return state.places.map((p) => ({ p, m: distM(d, p) })).filter(({ p, m }) => {
    if (m <= 100) return true;
    const pn = norm(p.name);
    return m <= 2000 && n.length >= 4 && pn.length >= 4 && (pn === n || pn.includes(n) || n.includes(pn));
  }).sort((a, b) => a.m - b.m);
}

function setPick(lat, lng, zoom) {
  pick = { lat, lng };
  if (!pickMarker) {
    pickMarker = L.marker([lat, lng], { draggable: true, icon: pinIcon("dis") }).addTo(pickMap);
    pickMarker.on("dragend", () => { const ll = pickMarker.getLatLng(); setPick(ll.lat, ll.lng); });
  } else pickMarker.setLatLng([lat, lng]);
  $("#loc-status").textContent = `İşaretlendi: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (zoom) pickMap.setView([lat, lng], zoom);
}

function ensurePickMap() {
  if (pickMap) return;
  pickMap = L.map("pick-map").setView([ANKARA.lat, ANKARA.lng], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(pickMap);
  pickMap.on("click", (e) => setPick(e.latlng.lat, e.latlng.lng));
}

function renderPreviews() {
  const box = $("#photo-previews");
  box.innerHTML = "";
  pendingFiles.forEach((f, i) => {
    const d = document.createElement("div"); d.className = "thumb";
    const img = document.createElement("img"); img.src = URL.createObjectURL(f); img.alt = f.name;
    const b = document.createElement("button"); b.type = "button"; b.textContent = "×"; b.setAttribute("aria-label", "Fotoğrafı kaldır");
    b.onclick = () => { pendingFiles.splice(i, 1); renderPreviews(); };
    d.append(img, b); box.append(d);
  });
}

function openPlaceForm(place = null) {
  const f = $("#form-place");
  fillCategorySelect(); f.reset(); hideError($("#place-error")); pendingFiles = []; renderPreviews(); pick = null; editingId = place ? place.id : null; dupAck = "";
  $("#place-title").textContent = place ? "Yeri Düzenle" : "Yer Ekle";
  $("#place-submit").textContent = place ? "Güncelle" : "Kaydet";
  $("#loc-block").hidden = false;
  $$(".ext-only", f).forEach((el) => (el.hidden = !api.ext));
  $("#photo-wrap").hidden = !!place; $("#photo-previews").hidden = !!place; $("#photo-consent-wrap").hidden = !!place;  $("#status-wrap").hidden = !place;
  f.author.closest("label").hidden = !!place;
  $("#addr-results").hidden = true;
  if (place) {
    f.name.value = place.name; f.category.value = place.category; f.planned_date.value = place.planned_date || "";
    f.district.value = place.district || ""; f.address.value = place.address || ""; f.notes.value = place.notes || "";
    f.max_attendees.value = place.max_attendees || ""; f.status.value = place.status;
    f.meet_time.value = hhmm(place.meet_time); f.meet_point.value = place.meet_point || ""; f.info.value = place.info || "";
  } else {
    const p = identity.profile();
    f.author.value = p.author || [p.first, p.last].filter(Boolean).join(" ");
  }
  $("#dlg-place").showModal();
  ensurePickMap();
  if (pickMarker) { pickMap.removeLayer(pickMarker); pickMarker = null; }
  if (place) setPick(place.lat, place.lng); else $("#loc-status").textContent = "Haritaya dokunarak işaretleyin";
  setTimeout(() => {
    pickMap.invalidateSize();
    pickMap.setView(place ? [place.lat, place.lng] : [ANKARA.lat, ANKARA.lng], place ? 16 : 11);
  }, 60);
}

function placeFormData(f) {
  const max = f.max_attendees.value.trim();
  return {
    name: f.name.value.trim(), category: f.category.value, planned_date: f.planned_date.value || null,
    district: f.district.value.trim(), address: f.address.value.trim(), notes: f.notes.value.trim(),
    author: f.author.value.trim(), status: f.status.value || "onerildi", max_attendees: max ? parseInt(max, 10) : null,
    lat: pick?.lat, lng: pick?.lng,
    meet_time: f.meet_time.value || null, meet_point: f.meet_point.value.trim(), info: f.info.value.trim(),
  };
}

function validatePlace(d, isEdit) {
  if (d.name.length < 2) return "Mekan adı en az 2 karakter olmalı.";
  if (!catById(d.category)) return "Kategori seçin.";
  if (d.planned_date ? !/^\d{4}-\d{2}-\d{2}$/.test(d.planned_date) : !isEdit) return "Önerilen çekim tarihini seçin.";
  if (pick == null || !inBounds(d.lat, d.lng)) return pick == null ? "Haritada konumu işaretleyin." : "Konum Ankara çevresinde olmalı.";
  if (!isEdit && d.author.length < 2) return "Adınızı yazın.";
  if (d.max_attendees != null && !(d.max_attendees >= 1 && d.max_attendees <= 100)) return "Kontenjan 1-100 arasında olmalı.";
  return null;
}

async function submitPlace(e) {
  e.preventDefault();
  const f = e.target;
  if (f.website.value) return; // honeypot
  const errBox = $("#place-error"); hideError(errBox);
  const d = placeFormData(f);
  const bad = validatePlace(d, !!editingId);
  if (bad) return showError(errBox, bad);
  if (!editingId && pendingFiles.length && !f.consent.checked) return showError(errBox, "Fotoğraf eklemek için sergide gösterilmesine izin vermeniz gerekiyor. Kutuyu işaretleyin ya da fotoğrafları kaldırın.");
  if (!editingId) {
    const dups = findDuplicates(d), sig = dups.map((x) => x.p.id).join(",");
    if (dups.length && dupAck !== sig) {
      dupAck = sig; const x = dups[0];
      return showError(errBox, `Yakınlarda benzer bir kayıt var: "${x.p.name}" (${Math.round(x.m)} m, ${fmtShort(x.p.planned_date)}). Yine de yeni kayıt eklemek için tekrar Kaydet'e basın.`);
    }
  }
  const btn = $("#place-submit"); btn.disabled = true;
  try {
    if (editingId) {
      await api.updatePlace(editingId, d);
      $("#dlg-place").close(); toast("Kayıt güncellendi");
      await reload();
      return;
    }
    const code = await ensureCode();
    if (code === null) { btn.disabled = false; return; }
    btn.textContent = "Kaydediliyor…";
    let id;
    try { id = await api.addPlace(d, code); }
    catch (err) { if (/Davet kodu/.test(err.message)) identity.setCode(""); throw err; }
    identity.setProfile({ ...identity.profile(), author: d.author });
    let failed = 0;
    for (let i = 0; i < pendingFiles.length; i++) {
      btn.textContent = `Fotoğraf ${i + 1}/${pendingFiles.length}…`;
      try {
        await api.addPhoto(id, await resizeImage(pendingFiles[i]), { photographer: d.author });
      } catch (err) { failed++; console.warn(err); }
    }
    $("#dlg-place").close();
    toast(failed ? `Yer eklendi, ${failed} fotoğraf yüklenemedi.` : "Yer eklendi, teşekkürler!", !!failed);
    await reload();
    map.setView([d.lat, d.lng], 15);
  } catch (err) {
    showError(errBox, err.message);
  } finally {
    btn.disabled = false; btn.textContent = editingId ? "Güncelle" : "Kaydet";
  }
}

// ------------------------------------------------------------------ detay
function renderDetail(id) {
  const p = state.places.find((x) => x.id === id);
  const box = $("#detail");
  if (!p) { $("#dlg-detail").close(); return; }
  const mineP = canEdit(p);
  const myAtt = identity.mine("attendees");
  const n = p.attendees.length;
  const full = p.max_attendees && n >= p.max_attendees;
  const joined = p.attendees.some((a) => myAtt.has(a.id)); // bu cihazdan zaten katılım var
  const photos = p.place_photos.map((ph) => {
    const url = api.photoUrl(ph.path);
    const img = `<img src="${esc(url)}" alt="${esc(p.name)} fotoğrafı" title="${esc(ph.photographer && !hideNames() ? "Fotoğraf: " + ph.photographer : "")}" data-zoom="${esc(url)}" loading="lazy">`;
    return `<div class="thumb">${img}
      ${mineP ? `<button type="button" data-act="del-photo" data-id="${esc(ph.id)}" aria-label="Fotoğrafı sil">×</button>` : ""}</div>`;
  }).join("");
  const people = p.attendees.map((a) =>
    `<li class="${myAtt.has(a.id) ? "me" : ""}">${esc(fullName(a))}${(myAtt.has(a.id) || isAdmin()) ? `<button type="button" data-act="leave" data-id="${esc(a.id)}" title="Katılımdan vazgeç" aria-label="Katılımdan vazgeç">×</button>` : ""}</li>`).join("");
  const dir = dirUrl(p);
  const meet = [hhmm(p.meet_time), p.meet_point].filter(Boolean).join(" · ");
  const draft = { body: $("#comment-body")?.value || "", name: $("#comment-name")?.value, consent: !!$("#photo-consent")?.checked };
  const myCom = identity.mine("comments");
  const comments = (p.place_comments || []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const commentsHtml = !api.ext ? "" : `
      <div class="section-title">Yorumlar (${comments.length})</div>
      ${comments.length ? `<ul class="comments">${comments.map((c) => `<li><div class="ch"><b>${esc(c.author_name)}</b> <span class="muted">${esc(fmtStamp(c.created_at))}</span>${(isAdmin() || myCom.has(c.id)) ? `<button type="button" data-act="del-comment" data-id="${esc(c.id)}" aria-label="Yorumu sil">×</button>` : ""}</div><div>${esc(c.body).replace(/\n/g, "<br>")}</div></li>`).join("")}</ul>` : `<p class="muted">Henüz yorum yok.</p>`}
      <div class="comment-form">
        <input id="comment-name" maxlength="60" placeholder="Adınız" aria-label="Adınız" value="${esc(draft.name ?? profileName())}">
        <textarea id="comment-body" rows="2" maxlength="500" placeholder="Yorum yaz…" aria-label="Yorum">${esc(draft.body)}</textarea>
        <button type="button" class="btn ghost" data-act="add-comment">Yorum gönder</button>
      </div>`;
  box.innerHTML = `
    <header class="dlg-head"><h2>${esc(p.name)}</h2><button type="button" class="x" data-close aria-label="Kapat">×</button></header>
    <div class="dlg-body">
      <div><span class="badge ${esc(p.status)}">${esc(STATUS[p.status])}</span></div>
      ${photos ? `<div class="gallery">${photos}</div>` : ""}
      <dl class="kv">
        <dt>Kategori</dt><dd>${esc(catLabel(p.category))}</dd>
        <dt>Çekim tarihi</dt><dd>${esc(fmtDate(p.planned_date))}</dd>
        ${p.district ? `<dt>İlçe</dt><dd>${esc(p.district)}</dd>` : ""}
        ${meet ? `<dt>Buluşma</dt><dd>${esc(meet)}</dd>` : ""}
        ${p.address ? `<dt>Adres / tarif</dt><dd>${esc(p.address)}</dd>` : ""}
        ${p.info ? `<dt>Pratik bilgi</dt><dd>${esc(p.info).replace(/\n/g, "<br>")}</dd>` : ""}
        ${p.notes ? `<dt>Not</dt><dd>${esc(p.notes).replace(/\n/g, "<br>")}</dd>` : ""}
        <dt>Ekleyen</dt><dd>${esc(p.author_name)}</dd>
        <dt>Konum</dt><dd><a href="${esc(dir)}" target="_blank" rel="noopener">Yol tarifi al</a> · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</dd>
      </dl>
      <div class="quick">
        <button type="button" class="btn ghost" data-act="share">Paylaş</button>
        ${p.planned_date ? `<button type="button" class="btn ghost" data-act="ics">Takvime ekle</button>
        <a class="btn ghost" href="${esc(googleCalUrl(p))}" target="_blank" rel="noopener">Google Takvim</a>` : ""}
      </div>
      <div class="section-title">Katılacaklar (${n}${p.max_attendees ? "/" + p.max_attendees : ""})</div>
      ${n ? `<ul class="people">${people}</ul>` : `<p class="muted">Henüz kimse katılmadı.</p>`}
      ${mineP && p.place_photos.length < MAX_PHOTOS ? `<label class="check consent"><input id="photo-consent" type="checkbox" ${draft.consent ? "checked" : ""}> Fotoğraflarımın sergide ve sergi oylamasında gösterilmesine izin veriyorum <small class="muted">(zorunlu)</small></label>
        <label>Fotoğraf ekle <small class="muted">(en fazla ${MAX_PHOTOS})</small><input type="file" accept="image/*" multiple data-act="add-photos"></label>` : ""}
      ${commentsHtml}
      ${mineP ? "" : `<p class="muted"><small>Düzenleme ve silme yalnızca kaydı ekleyen cihazdan veya yönetici modundan yapılabilir.</small></p>`}
      <p id="detail-error" class="form-error" role="alert" hidden></p>
    </div>
    <footer class="dlg-foot">
      ${mineP ? `<button type="button" class="btn danger" data-act="del-place">Sil</button><button type="button" class="btn ghost" data-act="edit">Düzenle</button>` : ""}
      ${joined
        ? `<button type="button" class="btn ghost" data-act="leave-mine">Katılmayacağım</button>`
        : `<button type="button" class="btn primary" data-act="join" ${full || p.status === "iptal" ? "disabled" : ""}>${full ? "Kontenjan dolu" : "Katılacağım"}</button>`}
    </footer>`;
}

function openDetail(id) {
  state.detailId = id; renderDetail(id);
  const d = $("#dlg-detail"); if (!d.open) d.showModal();
  history.replaceState(null, "", "#yer=" + id);
}

async function onDetailClick(e) {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const id = state.detailId, act = el.dataset.act, err = $("#detail-error");
  const place = state.places.find((p) => p.id === id);
  try {
    if (act === "join") openRsvp(place);
    else if (act === "share") sharePlace(place);
    else if (act === "ics") downloadIcs(place);
    else if (act === "add-comment") {
      const body = $("#comment-body").value.trim(), name = $("#comment-name").value.trim();
      if (!body) return showError(err, "Yorum yazın.");
      if (name.length < 2) return showError(err, "Adınızı yazın.");
      el.disabled = true;
      try {
        const code = await ensureCode();
        if (code === null) return;
        try { await api.addComment(id, name, body, code); }
        catch (x) { if (/Davet kodu/.test(x.message)) identity.setCode(""); throw x; }
        identity.setProfile({ ...identity.profile(), author: name });
        $("#comment-body").value = "";
        toast("Yorum eklendi"); await reload();
      } finally { el.disabled = false; }
    }
    else if (act === "del-comment") armed(el, "Sil?", async () => {
      try { await api.deleteComment(el.dataset.id); await reload(); } catch (x) { showError($("#detail-error"), x.message); }
    });
    else if (act === "edit") { $("#dlg-detail").close(); openPlaceForm(place); }
    else if (act === "del-place") armed(el, "Emin misiniz? Tekrar dokunun", async () => {
      try { await api.deletePlace(id); $("#dlg-detail").close(); toast("Yer silindi"); await reload(); } catch (x) { showError($("#detail-error"), x.message); }
    });
    else if (act === "leave-mine") armed(el, "Emin misiniz? Tekrar dokunun", async () => {
      try {
        const mine = identity.mine("attendees");
        for (const a of place.attendees.filter((x) => mine.has(x.id))) await api.removeAttendee(a.id);
        toast("Katılım kaldırıldı"); await reload();
      } catch (x) { showError($("#detail-error"), x.message); }
    });
    else if (act === "leave") { await api.removeAttendee(el.dataset.id); toast("Katılım kaldırıldı"); await reload(); }
    else if (act === "del-photo") armed(el, "?", async () => {
      try { await api.deletePhoto(el.dataset.id); await reload(); } catch (x) { showError($("#detail-error"), x.message); }
    });
  } catch (x) { showError(err, x.message); }
}

async function onDetailChange(e) {
  if (e.target.dataset.act !== "add-photos") return;
  if (!$("#photo-consent")?.checked) { e.target.value = ""; return showError($("#detail-error"), "Fotoğraf eklemek için sergide gösterilmesine izin vermeniz gerekiyor. Önce kutuyu işaretleyin."); }
  const id = state.detailId, p = state.places.find((x) => x.id === id);
  const files = [...e.target.files].slice(0, MAX_PHOTOS - p.place_photos.length);
  const meta = { photographer: profileName() }; // fotoğraf, yükleyenin adıyla kaydedilir
  let failed = 0;
  for (const f of files) { try { await api.addPhoto(id, await resizeImage(f), meta); } catch (x) { failed++; showError($("#detail-error"), x.message); } }
  await reload();
  if (!failed) toast("Fotoğraf eklendi");
}

// ------------------------------------------------------------------ katılım (RSVP)
let rsvpPlace = null;
function openRsvp(place) {
  rsvpPlace = place;
  const f = $("#form-rsvp"); f.reset(); hideError($("#rsvp-error"));
  const p = identity.profile(); f.first.value = p.first || ""; f.last.value = p.last || "";
  $("#rsvp-place").textContent = `${place.name} · ${fmtShort(place.planned_date)}`;
  $("#dlg-rsvp").showModal();
}
async function submitRsvp(e) {
  e.preventDefault();
  const f = e.target, errBox = $("#rsvp-error"); hideError(errBox);
  if (f.website.value) return;
  const first = f.first.value.trim(), last = f.last.value.trim();
  if (!first || !last) return showError(errBox, "Ad ve soyad zorunlu.");
  const btn = $("#rsvp-submit"); btn.disabled = true;
  try {
    const code = await ensureCode();
    if (code === null) return;
    try { await api.addAttendee(rsvpPlace.id, first, last, code); }
    catch (err) { if (/Davet kodu/.test(err.message)) identity.setCode(""); throw err; }
    identity.setProfile({ ...identity.profile(), first, last });
    $("#dlg-rsvp").close(); toast("Katılımın kaydedildi, görüşürüz!");
    await reload();
  } catch (err) { showError(errBox, err.message); }
  finally { btn.disabled = false; }
}

// ------------------------------------------------------------------ yönetici modu
// ---- Toplu işlem (yalnızca yönetici): seçilen kayıtları sil / durumunu değiştir
function updateBulkUi() {
  const on = isAdmin() && state.bulk;
  $("#bulk-bar").hidden = !on;
  $("#btn-bulk").textContent = on ? "Toplu işlemi kapat" : "Toplu işlem";
  $("#bulk-count").textContent = `${state.sel.size} seçili`;
}
function setBulk(on) { state.bulk = on && isAdmin(); state.sel.clear(); updateBulkUi(); render(); }
function toggleSel(id) {
  if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id);
  const card = $(`.card[data-id="${id}"]`), on = state.sel.has(id);
  if (card) { card.classList.toggle("selected", on); const b = card.querySelector(".selbox"); if (b) b.textContent = on ? "☑" : "☐"; }
  updateBulkUi();
}
async function bulkRun(fn, doneMsg) {
  if (!state.sel.size) return toast("Önce kayıt seçin.", true);
  let ok = 0, fail = 0;
  for (const id of [...state.sel]) {
    const p = state.places.find((x) => x.id === id);
    if (!p) continue;
    try { await fn(p); ok++; } catch (e) { fail++; console.warn(e); }
  }
  state.sel.clear(); updateBulkUi();
  toast(fail ? `${ok} kayıt işlendi, ${fail} kayıt başarısız.` : `${ok} kayıt ${doneMsg}.`, !!fail);
  await reload();
}
const bulkStatus = (status) => bulkRun((p) => api.updatePlace(p.id, {
  name: p.name, category: p.category, district: p.district, address: p.address, planned_date: p.planned_date,
  notes: p.notes, status, max_attendees: p.max_attendees, lat: p.lat, lng: p.lng,
  meet_time: p.meet_time, meet_point: p.meet_point, info: p.info,
}), "güncellendi");

function updateAdminUi() {
  if (!isAdmin()) { state.bulk = false; state.sel.clear(); }
  updateBulkUi(); updateExpoUi();
  $("#admin-banner").hidden = !isAdmin();
  $("#btn-admin").textContent = isAdmin() ? "Yönetici modundan çık" : "Yönetici girişi";
}
function onAdminClick() {
  if (isAdmin()) { api.adminLogout().catch(() => {}); identity.setAdmin(""); updateAdminUi(); render(); toast("Yönetici modundan çıkıldı"); return; }
  const f = $("#form-admin"); f.reset(); hideError($("#admin-error")); $("#dlg-admin").showModal();
}
async function submitAdmin(e) {
  e.preventDefault();
  const code = e.target.code.value.trim(), err = $("#admin-error");
  if (!code) return showError(err, "Kodu girin.");
  let token;
  try {
    token = await api.adminLogin(code); // kod yalnızca burada doğrulanır; geri dönen rastgele oturum anahtarı saklanır
    if (!token) return showError(err, "Yönetici kodu hatalı.");
  } catch (x) { return showError(err, x.message); }
  identity.setAdmin(token); $("#dlg-admin").close(); updateAdminUi(); render(); toast("Yönetici modu açık");
}

// ------------------------------------------------------------------ CSV
// ------------------------------------------------------------------ kategori filtresi, seçimi ve yönetimi
function renderCatChips() {
  const box = $("#cat-chips"); if (!box) return;
  const active = state.cat, ac = catById(active), activeRoot = ac ? ac.parent_id || ac.id : "";
  const chip = (c, sub) => `<button type="button" class="chip${sub ? " sub" : ""}${active === c.id ? " active" : ""}" data-cat="${esc(c.id)}"><i class="dot" style="background:${catColor(c.id)}"></i>${esc(c.name)}</button>`;
  box.innerHTML = `<button type="button" class="chip${active ? "" : " active"}" data-cat="">Tümü</button>` +
    catRoots().map((r) => chip(r, false) + (r.id === activeRoot ? catChildren(r.id).map((s) => chip(s, true)).join("") : "")).join("");
}

// Yer formundaki kategori listesi: ana kategoriler ve altlarında "Ana › Alt" biçiminde altkategoriler
function fillCategorySelect(selected) {
  const sel = $("#form-place").category;
  const keep = selected ?? sel.value;
  const opts = [];
  for (const r of catRoots()) opts.push(r, ...catChildren(r.id));
  sel.innerHTML = `<option value="">Seçin…</option>` + opts.map((c) => `<option value="${esc(c.id)}">${esc(catLabel(c.id))}</option>`).join("");
  sel.value = keep && catById(keep) ? keep : "";
}

const PALETTE = ["#d9641e", "#2563c9", "#1f8a4c", "#a855f7", "#e11d48", "#0891b2", "#ca8a04", "#6b7280"];
let catEdit = null; // formdaki taslak: { id|null, name, parent, color, children:Set }
const newCatDraft = () => ({ id: null, name: "", parent: "", color: PALETTE[state.cats.length % PALETTE.length], children: new Set() });

function openCats() {
  if (!api.catExt) return toast("Kategori düzenleme henüz etkin değil (schema.sql güncellenmeli).", true);
  catEdit = newCatDraft(); renderCats(); $("#dlg-cats").showModal();
}

function renderCats() {
  const d = catEdit, editing = !!d.id;
  const hasKids = editing && catChildren(d.id).length > 0;
  const parents = catRoots().filter((r) => r.id !== d.id);
  // Bu kategorinin altına alınabilecek adaylar: altı boş ana kategoriler ve zaten bunun altındakiler
  const cands = state.cats.filter((c) => c.id !== d.id && ((!c.parent_id && !catChildren(c.id).length) || c.parent_id === d.id));
  const used = (id) => state.places.filter((p) => p.category === id).length;
  const row = (c, sub) => `<li class="cat-row${sub ? " sub" : ""}"><i class="dot" style="background:${catColor(c.id)}"></i><span class="nm">${esc(c.name)}</span><span class="muted">${used(c.id)} yer</span>${canEditCat(c)
    ? `<button type="button" class="btn ghost small" data-act="cat-edit" data-id="${esc(c.id)}">Düzenle</button><button type="button" class="btn danger small" data-act="cat-del" data-id="${esc(c.id)}">Sil</button>` : ""}</li>`;
  $("#cats").innerHTML = `
    <header class="dlg-head"><h2>Kategoriler</h2><button type="button" class="x" data-close aria-label="Kapat">×</button></header>
    <div class="dlg-body">
      <div class="section-title">${editing ? "Kategoriyi düzenle" : "Yeni kategori ekle"}</div>
      <label>Ad <input id="cat-name" maxlength="40" value="${esc(d.name)}" placeholder="Örn. Tarihi yapılar" autocomplete="off"></label>
      <div class="row">
        <label>Üst kategori <select id="cat-parent" ${hasKids ? "disabled" : ""}><option value="">— Ana kategori —</option>${parents.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select></label>
        <label>Renk <input id="cat-color" type="color" value="${esc(safeColor(d.color) || "#6b7280")}"></label>
      </div>
      ${hasKids ? `<p class="muted"><small>Altkategorisi olduğu için ana kategori olarak kalır. Başka bir kategorinin altına almak için önce altkategorilerini taşıyın.</small></p>` : ""}
      ${!d.parent && cands.length ? `<div><div class="label">Altına alınacaklar <small class="muted">(işaretlediğiniz kategoriler bunun altkategorisi olur)</small></div>
        <div class="cat-kids">${cands.map((c) => `<label class="check"><input type="checkbox" data-kid="${esc(c.id)}" ${d.children.has(c.id) ? "checked" : ""} ${canEditCat(c) ? "" : "disabled"}> ${esc(c.name)}</label>`).join("")}</div></div>` : ""}
      <p id="cat-error" class="form-error" role="alert" hidden></p>
      <div class="quick">
        <button type="button" class="btn primary" data-act="cat-save">${editing ? "Güncelle" : "Ekle"}</button>
        ${editing ? `<button type="button" class="btn ghost" data-act="cat-cancel">Vazgeç</button>` : ""}
      </div>
      <div class="section-title">Mevcut kategoriler</div>
      <ul class="cat-list">${catRoots().map((r) => row(r, false) + catChildren(r.id).map((s) => row(s, true)).join("")).join("")}</ul>
      <p class="muted"><small>Kendi eklediğiniz kategorileri düzenleyip silebilirsiniz; yönetici hepsini düzenler. İçinde yer olan kategori silinemez.</small></p>
    </div>`;
  $("#cat-parent").value = d.parent;
}

async function refreshCats() {
  state.cats = await api.listCategories();
  lastCatSig = JSON.stringify(state.cats);
  if (state.cat && !catById(state.cat)) state.cat = "";
  renderCatChips();
  if ($("#dlg-place").open) fillCategorySelect();
  render();
  if ($("#dlg-cats").open) renderCats();
}

async function saveCat() {
  const d = catEdit, err = $("#cat-error"); hideError(err);
  const name = d.name.trim();
  if (name.length < 2) return showError(err, "Kategori adı en az 2 karakter olmalı.");
  const color = safeColor(d.color) || null;
  let id = d.id;
  if (id) await api.updateCategory(id, { name, parent_id: d.parent || null, color });
  else {
    const code = await ensureCode(); if (code === null) return;
    try { id = await api.addCategory({ name, parent_id: d.parent || null, color }, code); }
    catch (x) { if (/Davet kodu/.test(x.message)) identity.setCode(""); throw x; }
  }
  if (!d.parent) { // ana kategori: işaretlenenleri altına al, işareti kaldırılanları ana kategoriye döndür
    for (const c of state.cats) {
      if (c.id === id) continue;
      const want = d.children.has(c.id), is = c.parent_id === id;
      if (want !== is) await api.updateCategory(c.id, { name: c.name, parent_id: want ? id : null, color: c.color });
    }
  }
  catEdit = newCatDraft();
  await refreshCats();
  toast(d.id ? "Kategori güncellendi" : "Kategori eklendi");
}

async function onCatsClick(e) {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  try {
    if (act === "cat-edit") {
      const c = catById(id);
      catEdit = { id, name: c.name, parent: c.parent_id || "", color: safeColor(c.color) || catColor(id), children: new Set(catChildren(id).map((x) => x.id)) };
      renderCats(); $("#cats .dlg-body").scrollTop = 0;
    } else if (act === "cat-cancel") { catEdit = newCatDraft(); renderCats(); }
    else if (act === "cat-save") await saveCat();
    else if (act === "cat-del") armed(el, "Emin misiniz?", async () => {
      try { await api.deleteCategory(id); if (catEdit.id === id) catEdit = newCatDraft(); await refreshCats(); toast("Kategori silindi"); }
      catch (x) { showError($("#cat-error"), x.message); }
    });
  } catch (x) { showError($("#cat-error"), x.message); }
}

// ------------------------------------------------------------------ fotoğraf önizleme (aynı sayfada)
let lbList = [], lbIdx = 0;
function showLb() {
  const x = lbList[lbIdx], multi = lbList.length > 1;
  $("#lightbox-img").src = x.src; $("#lightbox-img").alt = x.alt;
  $("#lb-count").textContent = multi ? `${lbIdx + 1} / ${lbList.length}` : "";
  $("#lb-prev").hidden = !multi; $("#lb-next").hidden = !multi;
}
function lbStep(d) { lbIdx = (lbIdx + d + lbList.length) % lbList.length; showLb(); }
function openLightbox(img) {
  const scope = img.closest(".gallery, .expo-grid") || img.parentElement;
  lbList = [...scope.querySelectorAll("img[data-zoom]")].map((i) => ({ src: i.dataset.zoom, alt: i.alt }));
  lbIdx = Math.max(0, lbList.findIndex((x) => x.src === img.dataset.zoom));
  showLb(); $("#dlg-lightbox").showModal();
}

// ------------------------------------------------------------------ sergi seçkisi + gizli oylama
// Oy veren kimse saklanmaz. Oy sayılarını yönetici her zaman, diğerleri yalnızca oylama kapalıyken görür.
const expo = { filter: "all", open: false, limit: 10, mine: new Set(), counts: {} };
// Oylama sürerken fotoğrafı çeken kişinin adı ve tahmin ettirebilecek yer bilgisi gizlenir (yönetici hariç).
const hideNames = () => expo.open && !isAdmin();
// Sergi butonu: yönetici her zaman görür; diğerleri yalnızca oylama açıkken.
const updateExpoUi = () => { $("#btn-expo").hidden = !(api.ext2 && (isAdmin() || expo.open)); };
// Kendi eklediği yerin fotoğrafları oylamada kişiye gösterilmez (yönetici hariç).
const expoPhotos = () => {
  const mine = identity.mine("places");
  return state.places.filter((p) => isAdmin() || !mine.has(p.id)).flatMap((p) => p.place_photos.map((ph) => ({ ...ph, place: p })));
};
const seedOf = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

async function openExpo() {
  if (!api.ext2) return toast("Sergi özellikleri henüz etkin değil (schema.sql güncellenmeli).", true);
  $("#expo").innerHTML = `<header class="dlg-head"><h2>Sergi seçkisi</h2><button type="button" class="x" data-close aria-label="Kapat">×</button></header><div class="dlg-body"><p class="muted">Yükleniyor…</p></div>`;
  $("#dlg-expo").showModal();
  await refreshExpo();
}
async function refreshExpo() {
  await reload(false, true);
  const [info, mine, counts] = await Promise.all([api.votingInfo(), api.myVotes(), api.voteCounts()]);
  expo.open = info.open; expo.limit = info.limit; expo.mine = new Set(mine); expo.counts = counts;
  updateExpoUi();
  renderExpo();
}
function renderExpo() {
  const showCounts = isAdmin() || !expo.open;
  const votes = (x) => expo.counts[x.id] || 0;
  const F = expo.filter;
  const list = expoPhotos().filter((x) => F === "all" ? true : F === "aday" ? x.exhibit === "aday" : F === "secildi" ? x.exhibit === "secildi" : expo.mine.has(x.id));
  // Oylama sürerken sıra cihaza özgü rastgele (ilk/son sıra avantajını ve yer/kişi gruplamasını önler)
  if (hideNames()) list.sort((a, b) => seedOf(identity.token() + a.id) - seedOf(identity.token() + b.id));
  else if (showCounts) list.sort((a, b) => votes(b) - votes(a));
  const left = expo.limit - expo.mine.size;
  const chip = (k, label) => `<button type="button" class="chip ${F === k ? "active" : ""}" data-f="${k}">${label}</button>`;
  const card = (x) => {
    const url = api.photoUrl(x.path), img = `<img src="${esc(url)}" alt="${hideNames() ? "Sergi fotoğrafı" : esc(x.place.name)}" data-zoom="${esc(url)}" loading="lazy">`;
    const voted = expo.mine.has(x.id);
    return `<div class="ph ${esc(x.exhibit || "")}">
      ${img}
      ${hideNames() ? "" : `<div class="cap"><b>${esc(x.photographer || "Çeken belirtilmemiş")}</b>
        <span class="muted">${esc(x.place.name)}${x.place.district ? " · " + esc(x.place.district) : ""}</span>
        ${x.exhibit === "secildi" ? `<span class="badge cekildi">Sergide</span>` : (x.exhibit === "aday" && isAdmin() ? `<span class="badge mine">Aday</span>` : "")}
      </div>`}
      <div class="acts">
        ${expo.open ? `<button type="button" class="btn ghost ${voted ? "on" : ""}" data-act="vote" data-id="${esc(x.id)}">${voted ? "♥ Oyumu geri al" : "♡ Oy ver"}</button>` : ""}
        ${isAdmin() ? ["aday", "secildi"].map((v) => `<button type="button" class="btn ghost flag ${x.exhibit === v ? "on" : ""}" data-act="flag" data-id="${esc(x.id)}" data-v="${v}">${v === "aday" ? "Aday" : "Seçildi"}</button>`).join("") : ""}
        ${showCounts ? `<span class="votes">${votes(x)} oy</span>` : ""}
      </div></div>`;
  };
  $("#expo").innerHTML = `
    <header class="dlg-head"><h2>Sergi seçkisi</h2><button type="button" class="x" data-close aria-label="Kapat">×</button></header>
    <div class="dlg-body">
      <div class="expo-bar">
        <div class="grow">${expo.open
          ? `<b>Oylama açık</b> · kalan oy: ${left}/${expo.limit}<br><span class="muted">Beğendiğiniz fotoğraflara oy verin; hepsine oy vermeniz gerekmez. Oyunuz gizlidir, kimin oy verdiği kaydedilmez.</span>`
          : `<b>Oylama kapalı</b><br><span class="muted">Sonuçlar aşağıda görünür.</span>`}</div>
        ${isAdmin() ? `<label class="limit">Oy hakkı <input id="expo-limit" type="number" min="1" max="100" value="${expo.limit}"></label>
          <button type="button" class="btn ghost" data-act="set-limit">Kaydet</button>
          <button type="button" class="btn ghost" data-act="toggle-voting">${expo.open ? "Oylamayı kapat" : "Oylamayı aç"}</button>
          <button type="button" class="btn ghost" data-act="expo-csv">Seçilenleri CSV indir</button>` : ""}
      </div>
      <div class="chips">${chip("all", "Hepsi")}${chip("mine", "Oy verdiklerim")}${chip("secildi", "Sergide")}${isAdmin() ? chip("aday", "Adaylar") : ""}</div>
      ${list.length ? `<div class="expo-grid">${list.map(card).join("")}</div>`
        : `<p class="muted">${expoPhotos().length ? "Bu filtreye uyan fotoğraf yok." : "Henüz fotoğraf yok."}</p>`}
    </div>`;
}
async function onExpoClick(e) {
  const el = e.target.closest("[data-act],[data-f]"); if (!el) return;
  if (el.dataset.f) { expo.filter = el.dataset.f; return renderExpo(); }
  const act = el.dataset.act, id = el.dataset.id;
  try {
    if (act === "vote") {
      const on = !expo.mine.has(id);
      const code = on ? await ensureCode() : "";
      if (code === null) return;
      try { await api.vote(id, on, code); } catch (x) { if (/Davet kodu/.test(x.message)) identity.setCode(""); throw x; }
      if (on) expo.mine.add(id); else expo.mine.delete(id);
      renderExpo(); toast(on ? "Oyunuz kaydedildi" : "Oyunuz geri alındı");
    } else if (act === "flag") {
      const cur = expoPhotos().find((x) => x.id === id)?.exhibit;
      await api.setExhibit(id, cur === el.dataset.v ? null : el.dataset.v); await refreshExpo();
    } else if (act === "set-limit") {
      const n = parseInt($("#expo-limit").value, 10);
      if (!(n >= 1 && n <= 100)) return toast("Oy hakkı 1-100 arasında olmalı.", true);
      await api.setVoteLimit(n); await refreshExpo(); toast("Oy hakkı güncellendi");
    } else if (act === "toggle-voting") {
      await api.setVoting(!expo.open); await refreshExpo(); toast(expo.open ? "Oylama açıldı" : "Oylama kapatıldı");
    } else if (act === "expo-csv") exportExpoCsv();
  } catch (x) { toast(x.message, true); }
}
function exportExpoCsv() {
  const chosen = expoPhotos().filter((x) => x.exhibit === "secildi").sort((a, b) => (expo.counts[b.id] || 0) - (expo.counts[a.id] || 0));
  if (!chosen.length) return toast("Henüz “Seçildi” işaretli fotoğraf yok.", true);
  const safe = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const head = ["Fotoğrafı çeken", "Yer", "İlçe", "Çekim tarihi", "Oy", "Fotoğraf adresi"];
  const rows = chosen.map((x) => [x.photographer || "", x.place.name, x.place.district || "", x.place.planned_date || "", expo.counts[x.id] ?? "", isDemo ? "" : api.photoUrl(x.path)]);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + [head, ...rows].map((r) => r.map(safe).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `sergi-secimi-${todayStr()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Tüm veriyi (filtreden bağımsız; katılımcı, yorum ve fotoğraf adresleri dahil) JSON yedeği olarak indirir
function exportJson() {
  const data = {
    exported_at: new Date().toISOString(),
    places: state.places.map((p) => ({ ...p, place_photos: p.place_photos.map((ph) => (isDemo ? ph : { ...ph, url: api.photoUrl(ph.path) })) })),
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `ankara-merdivenleri-yedek-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv() {
  const safe = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const head = ["Tarih", "Saat", "Yer", "Kategori", "İlçe", "Durum", "Ekleyen", "Katılımcı sayısı", "Katılımcılar", "Enlem", "Boylam", "Yol tarifi"];
  const rows = filtered().sort(byDate).map((p) => [
    p.planned_date || "", hhmm(p.meet_time), p.name, catLabel(p.category), p.district, STATUS[p.status], p.author_name, p.attendees.length,
    p.attendees.map(fullName).join("; "), p.lat, p.lng, dirUrl(p),
  ]);
  const csv = "﻿" + [head, ...rows].map((r) => r.map(safe).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `ankara-merdivenleri-${todayStr()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

// ------------------------------------------------------------------ olaylar
function setView(v) {
  state.view = v; $(".layout").dataset.view = v;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
  if (v === "map") setTimeout(() => map.invalidateSize(), 50);
}

function bind() {
  $("#btn-add").onclick = () => openPlaceForm();
  $("#btn-csv").onclick = exportCsv;
  $("#btn-json").onclick = exportJson;
  $("#btn-expo").onclick = openExpo;
  // Fotoğrafa dokununca aynı sayfada büyük önizleme (yeni sekme açılmaz)
  document.addEventListener("click", (e) => { const i = e.target.closest("img[data-zoom]"); if (i) openLightbox(i); });
  const lb = $("#dlg-lightbox");
  $("#lb-prev").onclick = () => lbStep(-1);
  $("#lb-next").onclick = () => lbStep(1);
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.id === "lb-stage") lb.close(); });
  lb.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") lbStep(-1); else if (e.key === "ArrowRight") lbStep(1); });
  lb.addEventListener("close", () => { $("#lightbox-img").removeAttribute("src"); });
  $("#expo").addEventListener("click", onExpoClick);
  $("#btn-bulk").onclick = () => setBulk(!state.bulk);
  $("#b-all").onclick = () => { filtered().forEach((p) => state.sel.add(p.id)); updateBulkUi(); render(); };
  $("#b-past").onclick = () => {
    const today = todayStr();
    state.places.filter((p) => p.status === "cekildi" && p.planned_date && p.planned_date < today).forEach((p) => state.sel.add(p.id));
    updateBulkUi(); render();
  };
  $("#b-clear").onclick = () => { state.sel.clear(); updateBulkUi(); render(); };
  $("#b-done").onclick = () => bulkStatus("cekildi");
  $("#b-cancel").onclick = () => bulkStatus("iptal");
  $("#b-del").onclick = (e) => {
    if (!state.sel.size) return toast("Önce kayıt seçin.", true);
    armed(e.currentTarget, `Emin misiniz? ${state.sel.size} kayıt silinecek`, () => bulkRun((p) => api.deletePlace(p.id), "silindi"));
  };
  $("#f-mine-places").onchange = (e) => { state.mineP = e.target.checked; render(true); };
  $("#btn-filters").onclick = () => {
    const open = $(".toolbar").classList.toggle("open");
    $("#btn-filters").setAttribute("aria-expanded", String(open));
  };
  $("#btn-admin").onclick = onAdminClick;
  $("#form-admin").addEventListener("submit", submitAdmin);
  $("#cat-chips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    state.cat = c.dataset.cat; renderCatChips(); render(true);
  });
  $("#btn-cats").onclick = openCats;
  $("#btn-cats-admin").onclick = openCats;
  $("#cats").addEventListener("click", onCatsClick);
  $("#cats").addEventListener("input", (e) => {
    if (!catEdit) return;
    if (e.target.id === "cat-name") catEdit.name = e.target.value;
    else if (e.target.id === "cat-color") catEdit.color = e.target.value;
  });
  $("#cats").addEventListener("change", (e) => {
    if (!catEdit) return;
    if (e.target.id === "cat-parent") { catEdit.parent = e.target.value; renderCats(); }
    else if (e.target.dataset.kid) { if (e.target.checked) catEdit.children.add(e.target.dataset.kid); else catEdit.children.delete(e.target.dataset.kid); }
  });
  $("#f-search").oninput = (e) => { state.q = e.target.value; render(); };
  $("#f-status").onchange = (e) => { state.status = e.target.value; render(true); };
  $("#f-when").onchange = (e) => { state.when = e.target.value; render(true); };
  $("#f-mine").onchange = (e) => { state.mine = e.target.checked; render(true); };
  $$(".tab").forEach((t) => (t.onclick = () => setView(t.dataset.view)));
  $("#list").onclick = (e) => {
    const c = e.target.closest(".card"); if (!c) return;
    if (state.bulk) toggleSel(c.dataset.id); else openDetail(c.dataset.id);
  };

  $$("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) d.close(); else if (e.target === d && d.id === "dlg-detail") d.close(); });
  });
  $("#dlg-detail").addEventListener("close", () => { state.detailId = null; history.replaceState(null, "", location.pathname + location.search); });
  $("#dlg-code").addEventListener("close", () => { if (codeResolve) { const r = codeResolve; codeResolve = null; r(null); } });

  $("#detail").addEventListener("click", onDetailClick);
  $("#detail").addEventListener("change", onDetailChange);
  $("#form-place").addEventListener("submit", submitPlace);
  $("#form-rsvp").addEventListener("submit", submitRsvp);

  $("#form-code").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = e.target.code.value.trim(); const err = $("#code-error");
    if (!code) return showError(err, "Kodu girin.");
    if (await api.checkCode(code)) {
      identity.setCode(code);
      const r = codeResolve; codeResolve = null; $("#dlg-code").close(); if (r) r(code);
    } else showError(err, "Davet kodu hatalı.");
  });

  $("#photo-input").addEventListener("change", (e) => {
    const room = MAX_PHOTOS - pendingFiles.length;
    pendingFiles.push(...[...e.target.files].filter((f) => f.type.startsWith("image/")).slice(0, room));
    e.target.value = ""; renderPreviews();
  });

  const doSearch = async () => {
    const q = $("#addr-q").value.trim(), ul = $("#addr-results"); if (!q) return;
    ul.hidden = false; ul.innerHTML = `<li class="muted">Aranıyor…</li>`;
    try {
      const res = await searchAddress(q);
      ul.innerHTML = res.length ? "" : `<li class="muted">Sonuç bulunamadı.</li>`;
      for (const r of res) {
        const li = document.createElement("li"); li.tabIndex = 0; li.textContent = r.name;
        const choose = () => {
          ul.hidden = true;
          if (!inBounds(r.lat, r.lng)) return toast("Bu konum Ankara çevresinde değil.", true);
          setPick(r.lat, r.lng, 17);
          const f = $("#form-place"); if (!f.address.value) f.address.value = r.name.split(",").slice(0, 3).join(",").trim();
        };
        li.onclick = choose; li.onkeydown = (ev) => { if (ev.key === "Enter") choose(); };
        ul.append(li);
      }
    } catch (x) { ul.innerHTML = `<li class="muted">${esc(x.message)}</li>`; }
  };
  $("#btn-addr").onclick = doSearch;
  $("#addr-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
  $("#btn-geo").onclick = () => {
    if (!navigator.geolocation) return toast("Tarayıcı konum desteklemiyor.", true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (!inBounds(lat, lng)) return toast("Konumunuz Ankara çevresinde görünmüyor.", true);
        setPick(lat, lng, 18);
      },
      () => toast("Konum alınamadı, haritaya dokunarak işaretleyin.", true), { enableHighAccuracy: true, timeout: 10000 });
  };

  // Otomatik yenileme: form pencereleri (yazarken) ve seçili fotoğraf varken durur; sayfa görünürken 10 sn'de bir.
  // Detay penceresi açıkken de yenilenir; böylece yeni katılımcılar anında görünür.
  const busy = () => $$("dialog[open]").some((d) => d.id !== "dlg-detail") || !!$("#detail input[type=file]")?.files?.length || !!$("#comment-body")?.value;
  const refresh = () => {
    if (document.hidden) return;
    // Sergi butonu, oylama açılıp kapanınca yönetici dışındakilere görünür/gizlenir
    if (api.ext2) api.votingInfo().then((vi) => { if (vi.open !== expo.open) { expo.open = vi.open; updateExpoUi(); } expo.limit = vi.limit; });
    if (!busy()) reload(false, true);
  };
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  setInterval(refresh, 10000);
}

// ------------------------------------------------------------------ başlangıç
(async function main() {
  $("#demo-banner").hidden = !isDemo;
  updateAdminUi();
  initMap(); bind();
  const info = await api.init(); state.codeRequired = info.codeRequired;
  if (api.ext2) { const vi = await api.votingInfo(); expo.open = vi.open; expo.limit = vi.limit; }
  updateExpoUi();
  if (isAdmin() && !(await api.checkAdmin(identity.admin()).catch(() => true))) { identity.setAdmin(""); updateAdminUi(); }
  await reload(true);
  const m = location.hash.match(/^#yer=([0-9a-f-]{36})$/i);
  if (m && state.places.some((p) => p.id === m[1])) openDetail(m[1]);
})();
