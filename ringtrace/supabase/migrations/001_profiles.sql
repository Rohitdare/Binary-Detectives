-- =============================================================================
-- SPYNEX — user profiles for Supabase Auth
-- Run in Supabase Dashboard → SQL Editor.
-- Stores name / surname / username / email / work_id and enforces uniqueness.
-- =============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  surname     text not null,
  username    text not null unique,
  email       text not null,
  work_id     text not null unique,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Allow users to read their own full profile
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Allow reading email for username-based login resolution
drop policy if exists "Allow username resolution for login" on public.profiles;
create policy "Allow username resolution for login"
  on public.profiles for select
  using (true);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row from sign-up metadata.
-- Duplicate username or work_id will fail the insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, surname, username, email, work_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'surname', ''),
    lower(new.raw_user_meta_data ->> 'username'),
    lower(new.email),
    upper(new.raw_user_meta_data ->> 'work_id')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
