create function public.pos_sync_exchange_rate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.value := pg_catalog.jsonb_set(new.value,'{kes_per_usd}',pg_catalog.to_jsonb(new.exchange_rate_kes_to_usd));
  new.updated_at := now();
  if auth.uid() is not null then
    select id into new.updated_by from public.pos_users where auth_user_id=auth.uid() and active;
  end if;
  return new;
end;
$$;
revoke all on function public.pos_sync_exchange_rate() from public,anon,authenticated;

-- The storefront may own a settings table with an unrelated schema.
do $migration$
begin
  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'shop_settings'
      and (column_name, udt_name) in (
        ('key', 'text'), ('value', 'jsonb'),
        ('updated_at', 'timestamptz'), ('updated_by', 'uuid')
      )
  ) <> 4 then
    raise notice 'Skipping POS exchange-rate setup on the storefront shop_settings schema';
    return;
  end if;

  if exists (select 1 from public.shop_settings where key <> 'exchange_rate') then
    raise notice 'Skipping POS exchange-rate setup on a multi-setting shop_settings table';
    return;
  end if;

  alter table public.shop_settings
    add column exchange_rate_kes_to_usd numeric not null default 130;
  alter table public.shop_settings enable row level security;
  drop policy if exists "Anyone can read shop settings" on public.shop_settings;
  create policy "Anyone can read shop settings" on public.shop_settings
    for select to anon, authenticated using (true);
  grant select on table public.shop_settings to anon, authenticated;

  insert into public.shop_settings(key,value) values ('exchange_rate','{"kes_per_usd":130}')
  on conflict (key) do nothing;
  update public.shop_settings
  set exchange_rate_kes_to_usd = (value->>'kes_per_usd')::numeric
  where key='exchange_rate' and value->>'kes_per_usd' is not null;
  alter table public.shop_settings
    add constraint shop_settings_singleton check (key='exchange_rate'),
    add constraint shop_settings_positive_rate check (exchange_rate_kes_to_usd > 0 and exchange_rate_kes_to_usd <= 100000);

  create trigger pos_sync_exchange_rate before insert or update on public.shop_settings
  for each row execute function public.pos_sync_exchange_rate();
  update public.shop_settings set exchange_rate_kes_to_usd=exchange_rate_kes_to_usd;

  drop policy if exists "Anon can save shop settings" on public.shop_settings;
  drop policy if exists "Managers can save shop settings" on public.shop_settings;
  create policy "Managers can update shop settings" on public.shop_settings
  for update to authenticated using (public.pos_is_manager()) with check (public.pos_is_manager());
  revoke insert,update,delete,truncate on public.shop_settings from anon,authenticated;
  grant update(exchange_rate_kes_to_usd) on public.shop_settings to authenticated;
end;
$migration$;
