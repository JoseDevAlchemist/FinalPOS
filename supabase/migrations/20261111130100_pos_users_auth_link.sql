-- Link each POS staff row to a Supabase Auth identity.
-- Run scripts/link-pos-users.mjs afterwards to create the Auth users and
-- populate this column. Null means "not enrolled"; the login route fails closed.

alter table public.pos_users
  add column if not exists auth_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pos_users_auth_user_id_fkey'
      and conrelid = 'public.pos_users'::regclass
  ) then
    alter table public.pos_users
      add constraint pos_users_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users (id)
      on delete set null;
  end if;
end
$$;

create unique index if not exists pos_users_auth_user_id_key
  on public.pos_users (auth_user_id)
  where auth_user_id is not null;

comment on column public.pos_users.auth_user_id is
  'Supabase Auth user for this staff member. Null until enrolled; unique when set.';
