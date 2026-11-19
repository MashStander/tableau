-- Tableau: song requests, likes and the DJ link (Nov 2026)
-- Run this once in Supabase: SQL Editor -> New query -> paste everything -> Run.
-- Safe to run again: it only creates or updates what is needed.

-- 1. The list of requests
create table if not exists public.song_requests (
  id bigint generated always as identity primary key,
  slug text not null,                                   -- which guest page the request is for
  title text not null check (char_length(title) between 1 and 120),
  artist text check (char_length(artist) <= 120),
  guest text check (char_length(guest) <= 60),
  created_at timestamptz not null default now()
);
alter table public.song_requests add column if not exists likes integer not null default 0;
alter table public.song_requests add column if not exists played boolean not null default false;
create index if not exists song_requests_slug_idx on public.song_requests (slug, created_at);
alter table public.song_requests enable row level security;

-- 2. Couples: can see and remove the requests for their own guest page only.
--    (The check looks in the couple's own charts, which only they can see.)
drop policy if exists "Couples read their song requests" on public.song_requests;
create policy "Couples read their song requests" on public.song_requests
  for select to authenticated
  using (exists (select 1 from public.charts c where c.data->>'publishSlug' = song_requests.slug));

drop policy if exists "Couples remove their song requests" on public.song_requests;
create policy "Couples remove their song requests" on public.song_requests
  for delete to authenticated
  using (exists (select 1 from public.charts c where c.data->>'publishSlug' = song_requests.slug));

-- Small helper: are song requests switched on for this published guest page?
create or replace function public.songs_setting(p_slug text, p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select (p.data->'info'->'songs'->>p_key) = 'true' from public.published p where p.slug = p_slug), false);
$$;
revoke all on function public.songs_setting(text, text) from public;

-- 3. Guests: ADD a request (only through this function).
--    Only for a published guest page with song requests switched on; stops floods.
create or replace function public.add_song_request(p_slug text, p_title text, p_artist text default '', p_guest text default '')
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  t text := left(btrim(coalesce(p_title, '')), 120);
begin
  if t = '' or not public.songs_setting(p_slug, 'on') then return false; end if;
  if (select count(*) from public.song_requests s where s.slug = p_slug and s.created_at > now() - interval '1 minute') >= 20 then return false; end if;
  if (select count(*) from public.song_requests s where s.slug = p_slug) >= 1000 then return false; end if;
  insert into public.song_requests (slug, title, artist, guest)
  values (p_slug, t,
          nullif(left(btrim(coalesce(p_artist, '')), 120), ''),
          nullif(left(btrim(coalesce(p_guest, '')), 60), ''));
  return true;
end;
$$;

-- 4. Guests: SEE what has been requested (no names), only if the couple switched the list on.
create or replace function public.get_song_list(p_slug text)
returns table (id bigint, title text, artist text, likes integer, played boolean)
language sql stable security definer set search_path = public
as $$
  select s.id, s.title, s.artist, s.likes, s.played
  from public.song_requests s
  where s.slug = p_slug and public.songs_setting(p_slug, 'on') and public.songs_setting(p_slug, 'list')
  order by s.created_at
  limit 500;
$$;

-- 5. Guests: thumbs-up a song on that list.
create or replace function public.like_song(p_slug text, p_id bigint)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.songs_setting(p_slug, 'on') and public.songs_setting(p_slug, 'list')) then return false; end if;
  update public.song_requests set likes = least(likes + 1, 999) where id = p_id and slug = p_slug and not played;
  return found;
end;
$$;

-- 6. The DJ: the private link holds a secret key that only the couple's own chart knows.
create or replace function public.dj_key_ok(p_slug text, p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select char_length(coalesce(p_key, '')) >= 10 and exists (
    select 1 from public.charts c
    where c.data->>'publishSlug' = p_slug and c.data->'eventInfo'->>'songsDjKey' = p_key
  );
$$;
revoke all on function public.dj_key_ok(text, text) from public;

create or replace function public.get_dj_songs(p_slug text, p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.dj_key_ok(p_slug, p_key) then return null; end if;
  return jsonb_build_object(
    'event', (select p.data->>'eventName' from public.published p where p.slug = p_slug),
    'songs', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'artist', s.artist, 'guest', s.guest,
                                                           'likes', s.likes, 'played', s.played, 'created_at', s.created_at) order by s.created_at)
                       from public.song_requests s where s.slug = p_slug), '[]'::jsonb));
end;
$$;

create or replace function public.set_song_played(p_slug text, p_key text, p_ids bigint[], p_played boolean)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.dj_key_ok(p_slug, p_key) then return false; end if;
  update public.song_requests set played = coalesce(p_played, true) where slug = p_slug and id = any(p_ids);
  return true;
end;
$$;

-- Who may use which function
revoke all on function public.add_song_request(text, text, text, text) from public;
revoke all on function public.get_song_list(text) from public;
revoke all on function public.like_song(text, bigint) from public;
revoke all on function public.get_dj_songs(text, text) from public;
revoke all on function public.set_song_played(text, text, bigint[], boolean) from public;
grant execute on function public.add_song_request(text, text, text, text) to anon, authenticated;
grant execute on function public.get_song_list(text) to anon, authenticated;
grant execute on function public.like_song(text, bigint) to anon, authenticated;
grant execute on function public.get_dj_songs(text, text) to anon, authenticated;
grant execute on function public.set_song_played(text, text, bigint[], boolean) to anon, authenticated;
