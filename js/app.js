import { api, identity, isDemo, resizeImage, searchAddress } from "./api.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CAT = { dis_mekan: "Dış mekan", ic_mekan: "İç mekan" };
const STATUS = { onerildi: "Önerildi", cekildi: "Çekildi", iptal: "İptal" };
const ANKARA = { lat: 39.9208, lng: 32.8541 };
const BOUNDS = { latMin: 39.0, latMax: 40.8, lngMin: 31.0, lngMax: 34.0 };
const MAX_PHOTOS = 5;

const state = { places: [], codeRequired: false, cat: "", q: "", status: "aktif", when: "", mine: false, view: "map", detailId: null };

// ------------------------------------------------------------------ yardımcılar
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (s) => new Date(s + "T00:00:00").toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = (s) => new Date(s + "T00:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
const fullName = (a) => `${a.first_name} ${a.last_name}`;
const inBounds = (lat, lng) => lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lng >= BOUNDS.lngMin && lng <= BOUNDS.lngMax;

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (isError ? " error" : ""); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), isError ? 5000 : 2800);
}
function showError(el, msg) { el.textContent = msg; el.hidden = false; }
function hideError(el) { el.hidden = true; el.textContent = ""; }

// İki aşamalı onay (tarayıcı confirm() yerine)
function armed(btn, label, run) {
  if (btn.dataset.armed) { clearTimeout(+btn.dataset.armed); delete btn.dataset.armed; btn.textContent = btn.dataset.label; run(); return; }
  btn.dataset.label = btn.textContent; btn.textContent = label;
  btn.dataset.armed = setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn.dataset.label; }, 4000);
}

// ------------------------------------------------------------------ ana harita
let map, markerLayer;
function initMap() {
  map = L.map("map", { zoomControl: true }).setView([ANKARA.lat, ANKARA.lng], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  new ResizeObserver(() => map.invalidateSize()).observe($("#map"));
}
const pinIcon = (cls) => L.divIcon({ className: "pin-wrap", html: `<div class="pin ${cls}"></div>`, iconSize: [26, 26], iconAnchor: [13, 30] });
const pinClass = (p) => (p.status === "cekildi" ? "cekildi" : p.status === "iptal" ? "iptal" : p.category === "ic_mekan" ? "ic" : "dis");

// ------------------------------------------------------------------ filtre + çizim
function filtered() {
  const q = state.q.trim().toLocaleLowerCase("tr");
  const mine = identity.mine("attendees");
  const today = todayStr();
  return state.places.filter((p) => {
    if (state.cat && p.category !== state.cat) return false;
    if (state.status === "aktif") { if (p.status === "iptal") return false; }
    else if (state.status && p.status !== state.status) return false;
    if (state.when === "upcoming" && p.planned_date < today) return false;
    if (state.when === "past" && p.planned_date >= today) return false;
    if (state.mine && !p.attendees.some((a) => mine.has(a.id))) return false;
    if (q) {
      const hay = [p.name, p.district, p.address, p.author_name, ...p.attendees.map(fullName)].join(" ").toLocaleLowerCase("tr");
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function render(fit = false) {
  const list = filtered();
  renderMap(list, fit);
  renderList(list);
}

function renderMap(list, fit) {
  markerLayer.clearLayers();
  for (const p of list) {
    L.marker([p.lat, p.lng], { icon: pinIcon(pinClass(p)), title: p.name, keyboard: true })
      .on("click", () => openDetail(p.id)).addTo(markerLayer);
  }
  if (fit && list.length) {
    map.fitBounds(L.latLngBounds(list.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15 });
  }
}

function cardHtml(p) {
  const mine = identity.mine("places").has(p.id);
  const n = p.attendees.length;
  const cap = p.max_attendees ? `${n}/${p.max_attendees}` : String(n);
  return `<button class="card ${p.category === "ic_mekan" ? "ic" : ""} ${p.status === "iptal" ? "iptal" : ""}" data-id="${esc(p.id)}">
    <div class="t">${esc(p.name)}</div>
    <div class="m">
      <span>${esc(CAT[p.category])}${p.district ? " · " + esc(p.district) : ""}</span>
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
  const upcoming = list.filter((p) => p.planned_date >= today).sort((a, b) => a.planned_date.localeCompare(b.planned_date));
  const past = list.filter((p) => p.planned_date < today).sort((a, b) => b.planned_date.localeCompare(a.planned_date));
  const group = (items, cls) => {
    const by = new Map();
    for (const p of items) { if (!by.has(p.planned_date)) by.set(p.planned_date, []); by.get(p.planned_date).push(p); }
    return [...by].map(([d, ps]) => `<h3 class="group-title ${cls}">${esc(fmtDate(d))}</h3>${ps.map(cardHtml).join("")}`).join("");
  };
  box.innerHTML = group(upcoming, "") + (past.length ? `<h3 class="group-title past">— Geçmiş —</h3>` + group(past, "past") : "");
}

// ------------------------------------------------------------------ veri yükleme
async function reload(fit = false) {
  try {
    state.places = await api.listPlaces();
    hideError($("#error-banner"));
  } catch (e) {
    showError($("#error-banner"), "Veriler yüklenemedi: " + e.message);
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
let pickMap, pickMarker, pick = null, pendingFiles = [], editingId = null;

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
  f.reset(); hideError($("#place-error")); pendingFiles = []; renderPreviews(); pick = null; editingId = place ? place.id : null;
  $("#place-title").textContent = place ? "Yeri Düzenle" : "Yer Ekle";
  $("#place-submit").textContent = place ? "Güncelle" : "Kaydet";
  $("#loc-block").hidden = !!place;
  $("#photo-wrap").hidden = !!place; $("#photo-previews").hidden = !!place;
  $("#status-wrap").hidden = !place;
  f.author.closest("label").hidden = !!place;
  $("#addr-results").hidden = true;
  if (place) {
    f.name.value = place.name; f.category.value = place.category; f.planned_date.value = place.planned_date;
    f.district.value = place.district || ""; f.address.value = place.address || ""; f.notes.value = place.notes || "";
    f.max_attendees.value = place.max_attendees || ""; f.status.value = place.status;
  } else {
    const p = identity.profile();
    f.author.value = p.author || [p.first, p.last].filter(Boolean).join(" ");
  }
  $("#dlg-place").showModal();
  if (!place) {
    ensurePickMap();
    if (pickMarker) { pickMap.removeLayer(pickMarker); pickMarker = null; }
    $("#loc-status").textContent = "Haritaya dokunarak işaretleyin";
    setTimeout(() => { pickMap.invalidateSize(); pickMap.setView([ANKARA.lat, ANKARA.lng], 11); }, 60);
  }
}

function placeFormData(f) {
  const max = f.max_attendees.value.trim();
  return {
    name: f.name.value.trim(), category: f.category.value, planned_date: f.planned_date.value,
    district: f.district.value.trim(), address: f.address.value.trim(), notes: f.notes.value.trim(),
    author: f.author.value.trim(), status: f.status.value || "onerildi", max_attendees: max ? parseInt(max, 10) : null,
    lat: pick?.lat, lng: pick?.lng,
  };
}

function validatePlace(d, isEdit) {
  if (d.name.length < 2) return "Mekan adı en az 2 karakter olmalı.";
  if (!CAT[d.category]) return "Kategori seçin (dış mekan / iç mekan).";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.planned_date)) return "Önerilen çekim tarihini seçin.";
  if (!isEdit && (pick == null || !inBounds(d.lat, d.lng))) return pick == null ? "Haritada konumu işaretleyin." : "Konum Ankara çevresinde olmalı.";
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
      try { await api.addPhoto(id, await resizeImage(pendingFiles[i])); } catch (err) { failed++; console.warn(err); }
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
  const mineP = identity.mine("places").has(p.id);
  const myAtt = identity.mine("attendees");
  const n = p.attendees.length;
  const full = p.max_attendees && n >= p.max_attendees;
  const photos = p.place_photos.map((ph) => {
    const url = api.photoUrl(ph.path);
    const img = `<img src="${esc(url)}" alt="${esc(p.name)} fotoğrafı" loading="lazy">`;
    return `<div class="thumb">${isDemo ? img : `<a href="${esc(url)}" target="_blank" rel="noopener">${img}</a>`}
      ${mineP ? `<button type="button" data-act="del-photo" data-id="${esc(ph.id)}" aria-label="Fotoğrafı sil">×</button>` : ""}</div>`;
  }).join("");
  const people = p.attendees.map((a) =>
    `<li class="${myAtt.has(a.id) ? "me" : ""}">${esc(fullName(a))}${myAtt.has(a.id) ? `<button type="button" data-act="leave" data-id="${esc(a.id)}" title="Katılımdan vazgeç" aria-label="Katılımdan vazgeç">×</button>` : ""}</li>`).join("");
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  box.innerHTML = `
    <header class="dlg-head"><h2>${esc(p.name)}</h2><button type="button" class="x" data-close aria-label="Kapat">×</button></header>
    <div class="dlg-body">
      <div><span class="badge ${esc(p.status)}">${esc(STATUS[p.status])}</span></div>
      ${photos ? `<div class="gallery">${photos}</div>` : ""}
      <dl class="kv">
        <dt>Kategori</dt><dd>${esc(CAT[p.category])}</dd>
        <dt>Çekim tarihi</dt><dd>${esc(fmtDate(p.planned_date))}</dd>
        ${p.district ? `<dt>İlçe</dt><dd>${esc(p.district)}</dd>` : ""}
        ${p.address ? `<dt>Adres / tarif</dt><dd>${esc(p.address)}</dd>` : ""}
        ${p.notes ? `<dt>Not</dt><dd>${esc(p.notes).replace(/\n/g, "<br>")}</dd>` : ""}
        <dt>Ekleyen</dt><dd>${esc(p.author_name)}</dd>
        <dt>Konum</dt><dd><a href="${esc(dir)}" target="_blank" rel="noopener">Yol tarifi al</a> · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</dd>
      </dl>
      <div class="section-title">Katılacaklar (${n}${p.max_attendees ? "/" + p.max_attendees : ""})</div>
      ${n ? `<ul class="people">${people}</ul>` : `<p class="muted">Henüz kimse katılmadı.</p>`}
      ${mineP && p.place_photos.length < MAX_PHOTOS ? `<label>Fotoğraf ekle <small class="muted">(en fazla ${MAX_PHOTOS})</small><input type="file" accept="image/*" multiple data-act="add-photos"></label>` : ""}
      <p id="detail-error" class="form-error" role="alert" hidden></p>
    </div>
    <footer class="dlg-foot">
      ${mineP ? `<button type="button" class="btn danger" data-act="del-place">Sil</button><button type="button" class="btn ghost" data-act="edit">Düzenle</button>` : ""}
      <button type="button" class="btn primary" data-act="join" ${full || p.status === "iptal" ? "disabled" : ""}>${full ? "Kontenjan dolu" : "Katılacağım"}</button>
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
    else if (act === "edit") { $("#dlg-detail").close(); openPlaceForm(place); }
    else if (act === "del-place") armed(el, "Emin misiniz? Tekrar dokunun", async () => {
      try { await api.deletePlace(id); $("#dlg-detail").close(); toast("Yer silindi"); await reload(); } catch (x) { showError($("#detail-error"), x.message); }
    });
    else if (act === "leave") { await api.removeAttendee(el.dataset.id); toast("Katılım kaldırıldı"); await reload(); }
    else if (act === "del-photo") armed(el, "?", async () => {
      try { await api.deletePhoto(el.dataset.id); await reload(); } catch (x) { showError($("#detail-error"), x.message); }
    });
  } catch (x) { showError(err, x.message); }
}

async function onDetailChange(e) {
  if (e.target.dataset.act !== "add-photos") return;
  const id = state.detailId, p = state.places.find((x) => x.id === id);
  const files = [...e.target.files].slice(0, MAX_PHOTOS - p.place_photos.length);
  let failed = 0;
  for (const f of files) { try { await api.addPhoto(id, await resizeImage(f)); } catch (x) { failed++; showError($("#detail-error"), x.message); } }
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

// ------------------------------------------------------------------ CSV
function exportCsv() {
  const safe = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const head = ["Tarih", "Yer", "Kategori", "İlçe", "Durum", "Ekleyen", "Katılımcı sayısı", "Katılımcılar", "Enlem", "Boylam", "Yol tarifi"];
  const rows = filtered().sort((a, b) => a.planned_date.localeCompare(b.planned_date)).map((p) => [
    p.planned_date, p.name, CAT[p.category], p.district, STATUS[p.status], p.author_name, p.attendees.length,
    p.attendees.map(fullName).join("; "), p.lat, p.lng, `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`,
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
  $$(".chip").forEach((c) => (c.onclick = () => {
    state.cat = c.dataset.cat; $$(".chip").forEach((x) => x.classList.toggle("active", x === c)); render(true);
  }));
  $("#f-search").oninput = (e) => { state.q = e.target.value; render(); };
  $("#f-status").onchange = (e) => { state.status = e.target.value; render(true); };
  $("#f-when").onchange = (e) => { state.when = e.target.value; render(true); };
  $("#f-mine").onchange = (e) => { state.mine = e.target.checked; render(true); };
  $$(".tab").forEach((t) => (t.onclick = () => setView(t.dataset.view)));
  $("#list").onclick = (e) => { const c = e.target.closest(".card"); if (c) openDetail(c.dataset.id); };

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

  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$$("dialog[open]").length) reload(); });
  setInterval(() => { if (!document.hidden && !$$("dialog[open]").length) reload(); }, 60000);
}

// ------------------------------------------------------------------ başlangıç
(async function main() {
  $("#demo-banner").hidden = !isDemo;
  initMap(); bind();
  const info = await api.init(); state.codeRequired = info.codeRequired;
  await reload(true);
  const m = location.hash.match(/^#yer=([0-9a-f-]{36})$/i);
  if (m && state.places.some((p) => p.id === m[1])) openDetail(m[1]);
})();
