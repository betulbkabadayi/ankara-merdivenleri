-- Ankara Merdivenleri — Supabase şeması
-- Supabase panelinde SQL Editor'e yapıştırıp bir kez çalıştırın (tekrar çalıştırılabilir).
--
-- Güvenlik modeli (girişsiz):
--   * Tablolara anon rolü sadece SELECT (belirli sütunlar) yapabilir.
--   * Tüm yazma işlemleri SECURITY DEFINER fonksiyonlardan geçer; doğrulama,
--     davet kodu, hız sınırı ve cihaz anahtarı (edit token) kontrolü orada yapılır.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tablolar
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);

create table if not exists public.places (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 2 and 120),
  category        text not null check (category in ('dis_mekan', 'ic_mekan')),
  lat             double precision not null check (lat between 39.0 and 40.8),
  lng             double precision not null check (lng between 31.0 and 34.0),
  district        text check (char_length(district) <= 60),
  address         text check (char_length(address) <= 200),
  planned_date    date,
  notes           text check (char_length(notes) <= 1000),
  status          text not null default 'onerildi' check (status in ('onerildi', 'cekildi', 'iptal')),
  max_attendees   integer check (max_attendees between 1 and 100),
  author_name     text not null check (char_length(author_name) between 2 and 60),
  edit_token_hash text not null,
  created_at      timestamptz not null default now()
);

create table if not exists public.place_photos (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places(id) on delete cascade,
  path       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.attendees (
  id              uuid primary key default gen_random_uuid(),
  place_id        uuid not null references public.places(id) on delete cascade,
  first_name      text not null check (char_length(first_name) between 1 and 40),
  last_name       text not null check (char_length(last_name) between 1 and 40),
  edit_token_hash text not null,
  created_at      timestamptz not null default now()
);

-- Mevcut kurulumlar için: tarih belirlenmemiş kayıtlara izin ver.
alter table public.places alter column planned_date drop not null;

-- Buluşma saati/yeri ve pratik bilgiler (giriş ücreti, çalışma saati, izin vb.)
alter table public.places add column if not exists meet_time  time;
alter table public.places add column if not exists meet_point text;
alter table public.places add column if not exists info       text;
do $$ begin
  alter table public.places add constraint places_meet_point_len check (char_length(meet_point) <= 120);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.places add constraint places_info_len check (char_length(info) <= 500);
exception when duplicate_object then null; end $$;

-- Yer yorumları
create table if not exists public.place_comments (
  id              uuid primary key default gen_random_uuid(),
  place_id        uuid not null references public.places(id) on delete cascade,
  author_name     text not null check (char_length(author_name) between 2 and 60),
  body            text not null check (char_length(body) between 1 and 500),
  edit_token_hash text not null,
  created_at      timestamptz not null default now()
);
create index if not exists place_comments_place_idx on public.place_comments (place_id, created_at);

-- Sergi: fotoğrafı çeken kişi, sergi izni, yönetici işareti (aday / seçildi)
alter table public.place_photos add column if not exists photographer text;
alter table public.place_photos add column if not exists consent boolean not null default false;
alter table public.place_photos add column if not exists exhibit text;
do $$ begin
  alter table public.place_photos add constraint photos_photographer_len check (char_length(photographer) between 2 and 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.place_photos add constraint photos_exhibit_val check (exhibit in ('aday', 'secildi'));
exception when duplicate_object then null; end $$;

-- Uygulamaya yalnızca sergide yer almak isteyenler katıldığı için ayrı izin kutusu yok:
-- tüm fotoğraflar izinli sayılır (consent sütunu geriye dönük uyumluluk için duruyor).
update public.place_photos set consent = true where not consent;
alter table public.place_photos alter column consent set default true;

-- Gizli oylama: kim oy verdiği saklanmaz. voter_hash cihaz anahtarının AYRI bir özetidir
-- (yer/katılım kayıtlarındaki edit_token_hash ile eşleştirilemez). Tabloya hiçbir rol doğrudan erişemez.
create table if not exists public.photo_votes (
  photo_id   uuid not null references public.place_photos(id) on delete cascade,
  voter_hash text not null,
  created_at timestamptz not null default now(),
  primary key (photo_id, voter_hash)
);

create unique index if not exists attendees_unique_person
  on public.attendees (place_id, lower(first_name), lower(last_name));
create index if not exists place_photos_place_idx on public.place_photos (place_id);
create index if not exists attendees_place_idx on public.attendees (place_id);
create index if not exists places_date_idx on public.places (planned_date);

-- ---------------------------------------------------------------- RLS / yetkiler
alter table public.app_settings enable row level security;
alter table public.places       enable row level security;
alter table public.place_photos enable row level security;
alter table public.attendees    enable row level security;
alter table public.place_comments enable row level security;
alter table public.photo_votes    enable row level security;

drop policy if exists places_read on public.places;
drop policy if exists photos_read on public.place_photos;
drop policy if exists attendees_read on public.attendees;
drop policy if exists comments_read on public.place_comments;
create policy comments_read  on public.place_comments for select to anon, authenticated using (true);
create policy places_read    on public.places       for select to anon, authenticated using (true);
create policy photos_read    on public.place_photos for select to anon, authenticated using (true);
create policy attendees_read on public.attendees    for select to anon, authenticated using (true);

revoke all on public.app_settings, public.places, public.place_photos, public.attendees, public.place_comments, public.photo_votes from anon, authenticated;

-- edit_token_hash sütunu hiçbir zaman okunamaz.
grant select (id, name, category, lat, lng, district, address, planned_date, notes,
              status, max_attendees, author_name, created_at, meet_time, meet_point, info)
  on public.places to anon, authenticated;
grant select (id, place_id, path, created_at, photographer, consent, exhibit) on public.place_photos to anon, authenticated;
grant select (id, place_id, first_name, last_name, created_at) on public.attendees to anon, authenticated;
grant select (id, place_id, author_name, body, created_at) on public.place_comments to anon, authenticated;

-- ---------------------------------------------------------------- yardımcılar
create or replace function public._hash(p_token text)
returns text language sql immutable
set search_path = public, extensions
as $$ select encode(digest(p_token, 'sha256'), 'hex') $$;

-- Davet kodu ayarlanmışsa doğrulanır; ayarlanmamışsa herkese açık.
create or replace function public._check_code(p_code text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_hash text;
begin
  select value into v_hash from public.app_settings where key = 'invite_code_hash';
  if v_hash is null then return; end if;
  if p_code is null or public._hash(p_code) <> v_hash then
    raise exception 'DAVET_KODU_HATALI';
  end if;
end $$;

create or replace function public._check_token(p_token text)
returns void language plpgsql
as $$
begin
  if p_token is null or char_length(p_token) < 16 then
    raise exception 'GECERSIZ_ANAHTAR';
  end if;
end $$;

-- Herkese açık: davet kodu isteniyor mu / doğru mu?
create or replace function public.code_required()
returns boolean language sql security definer
set search_path = public
as $$ select exists (select 1 from public.app_settings where key = 'invite_code_hash') $$;

create or replace function public.check_code(p_code text)
returns boolean language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._check_code(p_code);
  return true;
exception when others then
  return false;
end $$;

-- ---------------------------------------------------------------- yer işlemleri
drop function if exists public.add_place(text, text, text, text, double precision, double precision, text, text, date, text, text, integer);
create or replace function public.add_place(
  p_code text, p_token text,
  p_name text, p_category text, p_lat double precision, p_lng double precision,
  p_district text, p_address text, p_planned_date date, p_notes text,
  p_author text, p_max_attendees integer default null,
  p_meet_time time default null, p_meet_point text default null, p_info text default null
) returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform public._check_code(p_code);
  perform public._check_token(p_token);
  if (select count(*) from public.places where created_at > now() - interval '1 minute') >= 8 then
    raise exception 'COK_FAZLA_ISTEK';
  end if;
  insert into public.places (name, category, lat, lng, district, address, planned_date, notes,
                             author_name, max_attendees, edit_token_hash,
                             meet_time, meet_point, info)
  values (btrim(p_name), p_category, p_lat, p_lng, nullif(btrim(p_district), ''),
          nullif(btrim(p_address), ''), p_planned_date, nullif(btrim(p_notes), ''),
          btrim(p_author), p_max_attendees, public._hash(p_token),
          p_meet_time, nullif(btrim(p_meet_point), ''), nullif(btrim(p_info), ''))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- fotoğraflar
-- ---------------------------------------------------------------- katılım (RSVP)
create or replace function public.add_attendee(
  p_code text, p_token text, p_place_id uuid, p_first text, p_last text
) returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare v_id uuid; v_max integer; v_count integer;
begin
  perform public._check_code(p_code);
  perform public._check_token(p_token);
  if (select count(*) from public.attendees where created_at > now() - interval '1 minute') >= 40 then
    raise exception 'COK_FAZLA_ISTEK';
  end if;
  select max_attendees into v_max from public.places where id = p_place_id;
  if not found then raise exception 'YER_YOK'; end if;
  select count(*) into v_count from public.attendees where place_id = p_place_id;
  if v_max is not null and v_count >= v_max then raise exception 'KONTENJAN_DOLU'; end if;
  insert into public.attendees (place_id, first_name, last_name, edit_token_hash)
  values (p_place_id, btrim(p_first), btrim(p_last), public._hash(p_token))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'ZATEN_KATILIYOR';
end $$;

-- ---------------------------------------------------------------- yönetici kodu ve düzenleme işlemleri
-- Yönetici kodu (app_settings.admin_code_hash) yalnızca admin_login ile doğrulanır; başarılı girişte rastgele,
-- tahmin edilemez bir OTURUM ANAHTARI verilir (30 gün). Diğer tüm işlemler kodu değil bu anahtarı kabul eder.
-- Böylece kod, deneme sınırı olmayan başka bir yoldan kaba kuvvetle denenemez.
create table if not exists public.admin_sessions (
  token_hash text primary key,
  expires_at timestamptz not null
);
create table if not exists public.admin_failures (
  created_at timestamptz not null default now()
);
alter table public.admin_sessions enable row level security;
alter table public.admin_failures enable row level security;
revoke all on public.admin_sessions, public.admin_failures from anon, authenticated;

create or replace function public._is_admin(p_admin text)
returns boolean language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if p_admin is null or p_admin = '' then return false; end if;
  return exists (select 1 from public.admin_sessions
                 where token_hash = public._hash('adm:' || p_admin) and expires_at > now());
end $$;

-- Giriş: 10 dakikada en fazla 10 yanlış deneme (tüm istemciler toplamı); aşılırsa herkese COK_FAZLA_ISTEK.
create or replace function public.admin_login(p_code text)
returns text language plpgsql security definer
set search_path = public, extensions
as $$
declare v_hash text; v_token text;
begin
  if (select count(*) from public.admin_failures where created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'COK_FAZLA_ISTEK';
  end if;
  select value into v_hash from public.app_settings where key = 'admin_code_hash';
  if p_code is null or v_hash is null or public._hash(p_code) <> v_hash then
    insert into public.admin_failures default values;
    delete from public.admin_failures where created_at < now() - interval '1 day';
    return null;  -- hata fırlatılmaz: kayıt geri alınmasın
  end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  delete from public.admin_sessions where expires_at < now();
  insert into public.admin_sessions (token_hash, expires_at) values (public._hash('adm:' || v_token), now() + interval '30 days');
  return v_token;
end $$;

create or replace function public.admin_logout(p_admin text)
returns void language sql security definer
set search_path = public, extensions
as $$ delete from public.admin_sessions where token_hash = public._hash('adm:' || coalesce(p_admin, '')) $$;

create or replace function public.check_admin(p_admin text)
returns boolean language sql security definer
set search_path = public, extensions
as $$ select public._is_admin(p_admin) $$;

-- Eski imzalar (yönetici parametresi eklenmeden önceki sürümler)
drop function if exists public.update_place(text, uuid, text, text, text, text, date, text, text, integer);
drop function if exists public.delete_place(text, uuid);
drop function if exists public.add_photo(text, uuid, text);
drop function if exists public.delete_photo(text, uuid);
drop function if exists public.remove_attendee(text, uuid);
drop function if exists public.update_place(text, uuid, text, text, text, text, date, text, text, integer, double precision, double precision, text);

create or replace function public.update_place(
  p_token text, p_id uuid,
  p_name text, p_category text, p_district text, p_address text,
  p_planned_date date, p_notes text, p_status text,
  p_max_attendees integer default null,
  p_lat double precision default null, p_lng double precision default null,
  p_admin text default null,
  p_meet_time time default null, p_meet_point text default null, p_info text default null
) returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._check_token(p_token);
  update public.places set
    meet_time = p_meet_time, meet_point = nullif(btrim(p_meet_point), ''), info = nullif(btrim(p_info), ''),
    name = btrim(p_name), category = p_category,
    district = nullif(btrim(p_district), ''), address = nullif(btrim(p_address), ''),
    planned_date = p_planned_date, notes = nullif(btrim(p_notes), ''),
    status = p_status, max_attendees = p_max_attendees,
    lat = coalesce(p_lat, lat), lng = coalesce(p_lng, lng)
  where id = p_id and (edit_token_hash = public._hash(p_token) or public._is_admin(p_admin));
  if not found then raise exception 'YETKISIZ'; end if;
end $$;

create or replace function public.delete_place(p_token text, p_id uuid, p_admin text default null)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._check_token(p_token);
  delete from public.places
   where id = p_id and (edit_token_hash = public._hash(p_token) or public._is_admin(p_admin));
  if not found then raise exception 'YETKISIZ'; end if;
end $$;

drop function if exists public.add_photo(text, uuid, text, text);
create or replace function public.add_photo(
  p_token text, p_place_id uuid, p_path text, p_admin text default null,
  p_photographer text default null, p_consent boolean default false
) returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform public._check_token(p_token);
  if not exists (select 1 from public.places
                 where id = p_place_id
                   and (edit_token_hash = public._hash(p_token) or public._is_admin(p_admin))) then
    raise exception 'YETKISIZ';
  end if;
  if p_path not like p_place_id::text || '/%' then raise exception 'GECERSIZ_YOL'; end if;
  if (select count(*) from public.place_photos where place_id = p_place_id) >= 5 then
    raise exception 'FOTOGRAF_LIMITI';
  end if;
  insert into public.place_photos (place_id, path, photographer, consent)
  values (p_place_id, p_path, nullif(btrim(p_photographer), ''), true) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_photo(p_token text, p_photo_id uuid, p_admin text default null)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._check_token(p_token);
  delete from public.place_photos ph using public.places pl
   where ph.id = p_photo_id and pl.id = ph.place_id
     and (pl.edit_token_hash = public._hash(p_token) or public._is_admin(p_admin));
  if not found then raise exception 'YETKISIZ'; end if;
end $$;

create or replace function public.remove_attendee(p_token text, p_id uuid, p_admin text default null)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._check_token(p_token);
  delete from public.attendees
   where id = p_id and (edit_token_hash = public._hash(p_token) or public._is_admin(p_admin));
  if not found then raise exception 'YETKISIZ'; end if;
end $$;

-- ---------------------------------------------------------------- fonksiyon yetkileri
-- ---------------------------------------------------------------- yorumlar
create or replace function public.add_comment(
  p_code text, p_token text, p_place_id uuid, p_author text, p_body text
) returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform public._check_code(p_code);
  perform public._check_token(p_token);
  if (select count(*) from public.place_comments where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'COK_FAZLA_ISTEK';
  end if;
  if not exists (select 1 from public.places where id = p_place_id) then raise exception 'YER_YOK'; end if;
  insert into public.place_comments (place_id, author_name, body, edit_token_hash)
  values (p_place_id, btrim(p_author), btrim(p_body), public._hash(p_token))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_comment(p_token text, p_id uuid, p_admin text default null)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._check_token(p_token);
  delete from public.place_comments
   where id = p_id and (edit_token_hash = public._hash(p_token) or public._is_admin(p_admin));
  if not found then raise exception 'YETKISIZ'; end if;
end $$;

-- ---------------------------------------------------------------- sergi oylaması
-- Oylama varsayılan olarak KAPALI; yönetici açar/kapatır.
create or replace function public._voting_open()
returns boolean language sql security definer
set search_path = public
as $$ select coalesce((select value = 'open' from public.app_settings where key = 'voting_state'), false) $$;

create or replace function public.voting_status()
returns boolean language sql security definer
set search_path = public
as $$ select public._voting_open() $$;

create or replace function public.set_voting(p_admin text, p_open boolean)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._is_admin(p_admin) then raise exception 'YETKISIZ'; end if;
  insert into public.app_settings (key, value) values ('voting_state', case when p_open then 'open' else 'closed' end)
  on conflict (key) do update set value = excluded.value;
end $$;

-- Cihaz başına oy hakkı (varsayılan 10, yönetici değiştirir).
create or replace function public._vote_limit()
returns integer language sql security definer
set search_path = public
as $$ select coalesce((select value::integer from public.app_settings where key = 'vote_limit'), 10) $$;

create or replace function public.voting_info()
returns json language sql security definer
set search_path = public
as $$ select json_build_object('open', public._voting_open(), 'limit', public._vote_limit()) $$;

create or replace function public.set_vote_limit(p_admin text, p_limit integer)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._is_admin(p_admin) then raise exception 'YETKISIZ'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'GECERSIZ_DEGER'; end if;
  insert into public.app_settings (key, value) values ('vote_limit', p_limit::text)
  on conflict (key) do update set value = excluded.value;
end $$;

-- Kişi kendi eklediği yerin fotoğraflarına oy veremez.
create or replace function public.vote_photo(p_code text, p_token text, p_photo_id uuid, p_on boolean)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v text;
begin
  perform public._check_code(p_code);
  perform public._check_token(p_token);
  if not public._voting_open() then raise exception 'OYLAMA_KAPALI'; end if;
  if (select count(*) from public.photo_votes where created_at > now() - interval '1 minute') >= 150 then
    raise exception 'COK_FAZLA_ISTEK';
  end if;
  v := public._hash('oy:' || p_token);
  if p_on then
    if not exists (select 1 from public.place_photos where id = p_photo_id) then raise exception 'FOTOGRAF_YOK'; end if;
    -- Karşılaştırma anlıktır; oy ile kişi arasında hiçbir bağlantı saklanmaz.
    if exists (select 1 from public.place_photos ph join public.places pl on pl.id = ph.place_id
               where ph.id = p_photo_id and pl.edit_token_hash = public._hash(p_token)) then
      raise exception 'KENDI_FOTOGRAF';
    end if;
    if (select count(*) from public.photo_votes where voter_hash = v) >= public._vote_limit()
       and not exists (select 1 from public.photo_votes where photo_id = p_photo_id and voter_hash = v) then
      raise exception 'OY_LIMITI';
    end if;
    insert into public.photo_votes (photo_id, voter_hash) values (p_photo_id, v) on conflict do nothing;
  else
    delete from public.photo_votes where photo_id = p_photo_id and voter_hash = v;
  end if;
end $$;

-- Bu cihazın kendi oyları (başkasının oyu asla döndürülmez).
create or replace function public.my_votes(p_token text)
returns setof uuid language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._check_token(p_token);
  return query select photo_id from public.photo_votes where voter_hash = public._hash('oy:' || p_token);
end $$;

-- Oy sayıları: yönetici her zaman, diğerleri yalnızca oylama kapalıyken görür.
create or replace function public.vote_counts(p_admin text)
returns table (photo_id uuid, votes bigint) language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if public._is_admin(p_admin) or not public._voting_open() then
    return query select v.photo_id, count(*) from public.photo_votes v group by v.photo_id;
  end if;
end $$;

create or replace function public.set_photo_exhibit(p_admin text, p_photo_id uuid, p_status text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._is_admin(p_admin) then raise exception 'YETKISIZ'; end if;
  update public.place_photos set exhibit = nullif(p_status, '') where id = p_photo_id;
  if not found then raise exception 'FOTOGRAF_YOK'; end if;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.code_required(), public.check_code(text), public.check_admin(text),
  public.admin_login(text), public.admin_logout(text),
  public.add_place(text, text, text, text, double precision, double precision, text, text, date, text, text, integer, time, text, text),
  public.update_place(text, uuid, text, text, text, text, date, text, text, integer, double precision, double precision, text, time, text, text),
  public.add_comment(text, text, uuid, text, text),
  public.delete_comment(text, uuid, text),
  public.delete_place(text, uuid, text),
  public.add_photo(text, uuid, text, text, text, boolean),
  public.voting_status(), public.voting_info(), public.set_voting(text, boolean), public.set_vote_limit(text, integer), public.vote_photo(text, text, uuid, boolean),
  public.my_votes(text), public.vote_counts(text), public.set_photo_exhibit(text, uuid, text),
  public.delete_photo(text, uuid, text),
  public.add_attendee(text, text, uuid, text, text),
  public.remove_attendee(text, uuid, text)
to anon, authenticated;

-- ---------------------------------------------------------------- fotoğraf deposu
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-photos', 'place-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "photos_upload" on storage.objects;
create policy "photos_upload" on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'place-photos'
    and exists (select 1 from public.places pl where pl.id::text = (storage.foldername(objects.name))[1])
  );

-- Dosya temizliği Storage API ile yapılır (SQL'den storage.objects silmek yasaktır).
-- Listeleme/silme yalnızca hiçbir kayda bağlı olmayan (yetim) dosyalar için açıktır.
drop policy if exists "photos_list" on storage.objects;
create policy "photos_list" on storage.objects for select to anon, authenticated
  using (bucket_id = 'place-photos');

drop policy if exists "photos_delete_orphans" on storage.objects;
create policy "photos_delete_orphans" on storage.objects for delete to anon, authenticated
  using (
    bucket_id = 'place-photos'
    and not exists (select 1 from public.place_photos ph where ph.path = objects.name)
  );

-- Davet kodunu ayarlamak için (örnek, kendi kodunuzla çalıştırın):
--   insert into public.app_settings (key, value)
--   values ('invite_code_hash', encode(extensions.digest('KODUNUZ', 'sha256'), 'hex'))
--   on conflict (key) do update set value = excluded.value;
-- Yönetici kodu (tüm kayıtları düzenleme/silme):
--   insert into public.app_settings (key, value)
--   values ('admin_code_hash', encode(extensions.digest('YONETICI_KODU', 'sha256'), 'hex'))
--   on conflict (key) do update set value = excluded.value;
-- Yönetici kodunu değiştirdikten sonra açık yönetici oturumlarını kapatmak için:
--   delete from public.admin_sessions;
-- Kodu kaldırmak için:  delete from public.app_settings where key = 'invite_code_hash';
