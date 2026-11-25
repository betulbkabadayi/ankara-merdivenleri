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

drop policy if exists places_read on public.places;
drop policy if exists photos_read on public.place_photos;
drop policy if exists attendees_read on public.attendees;
create policy places_read    on public.places       for select to anon, authenticated using (true);
create policy photos_read    on public.place_photos for select to anon, authenticated using (true);
create policy attendees_read on public.attendees    for select to anon, authenticated using (true);

revoke all on public.app_settings, public.places, public.place_photos, public.attendees from anon, authenticated;

-- edit_token_hash sütunu hiçbir zaman okunamaz.
grant select (id, name, category, lat, lng, district, address, planned_date, notes,
              status, max_attendees, author_name, created_at)
  on public.places to anon, authenticated;
grant select (id, place_id, path, created_at) on public.place_photos to anon, authenticated;
grant select (id, place_id, first_name, last_name, created_at) on public.attendees to anon, authenticated;

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
create or replace function public.add_place(
  p_code text, p_token text,
  p_name text, p_category text, p_lat double precision, p_lng double precision,
  p_district text, p_address text, p_planned_date date, p_notes text,
  p_author text, p_max_attendees integer default null
) returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform public._check_code(p_code);
  perform public._check_token(p_token);
  if (select count(*) from public.places where created_at > now() - interval '1 minute') >= 20 then
    raise exception 'COK_FAZLA_ISTEK';
  end if;
  insert into public.places (name, category, lat, lng, district, address, planned_date, notes,
                             author_name, max_attendees, edit_token_hash)
  values (btrim(p_name), p_category, p_lat, p_lng, nullif(btrim(p_district), ''),
          nullif(btrim(p_address), ''), p_planned_date, nullif(btrim(p_notes), ''),
          btrim(p_author), p_max_attendees, public._hash(p_token))
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
  if (select count(*) from public.attendees where created_at > now() - interval '1 minute') >= 60 then
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
-- Yönetici kodu (app_settings.admin_code_hash) her kaydı düzenleyip silebilir.
create or replace function public._is_admin(p_admin text)
returns boolean language plpgsql security definer
set search_path = public, extensions
as $$
declare v_hash text;
begin
  if p_admin is null or p_admin = '' then return false; end if;
  select value into v_hash from public.app_settings where key = 'admin_code_hash';
  return v_hash is not null and public._hash(p_admin) = v_hash;
end $$;

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

create or replace function public.update_place(
  p_token text, p_id uuid,
  p_name text, p_category text, p_district text, p_address text,
  p_planned_date date, p_notes text, p_status text,
  p_max_attendees integer default null,
  p_lat double precision default null, p_lng double precision default null,
  p_admin text default null
) returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._check_token(p_token);
  update public.places set
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

create or replace function public.add_photo(p_token text, p_place_id uuid, p_path text, p_admin text default null)
returns uuid language plpgsql security definer
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
  insert into public.place_photos (place_id, path) values (p_place_id, p_path) returning id into v_id;
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
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.code_required(), public.check_code(text), public.check_admin(text),
  public.add_place(text, text, text, text, double precision, double precision, text, text, date, text, text, integer),
  public.update_place(text, uuid, text, text, text, text, date, text, text, integer, double precision, double precision, text),
  public.delete_place(text, uuid, text),
  public.add_photo(text, uuid, text, text),
  public.delete_photo(text, uuid, text),
  public.add_attendee(text, text, uuid, text, text),
  public.remove_attendee(text, uuid, text)
to anon, authenticated;

-- ---------------------------------------------------------------- fotoğraf deposu
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-photos', 'place-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880,
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
-- Kodu kaldırmak için:  delete from public.app_settings where key = 'invite_code_hash';
