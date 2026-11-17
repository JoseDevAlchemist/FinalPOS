begin;
alter table public.pos_returns add column requested_by uuid references public.pos_users(id) on delete restrict;
create table public.pos_return_pin_attempts (
  cashier_id uuid primary key references public.pos_users(id) on delete cascade,
  failures integer not null default 0 check (failures between 0 and 4),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.pos_return_pin_attempts enable row level security;
revoke all on public.pos_return_pin_attempts from public, anon, authenticated;

-- Only the server can supply the verified cashier identity and raw approval PIN.
-- Failed PINs return normally so the durable lockout update is committed.
create function public.pos_process_return_with_pin(
  p_cashier_id uuid, p_pin text, p_client_uuid uuid, p_sale_id uuid, p_reason text, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_manager public.pos_users%rowtype; v_attempt public.pos_return_pin_attempts%rowtype;
  v_previous_sub text; v_previous_claims text; v_id uuid; v_matches uuid[];
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  perform id from public.pos_users where id=p_cashier_id and active and role in ('cashier','manager') for share;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then return jsonb_build_object('error','invalid_pin'); end if;
  insert into public.pos_return_pin_attempts(cashier_id) values(p_cashier_id) on conflict do nothing;
  select * into v_attempt from public.pos_return_pin_attempts where cashier_id=p_cashier_id for update;
  if v_attempt.locked_until > clock_timestamp() then return jsonb_build_object('error','pin_locked'); end if;
  -- Legacy duplicate PINs must not turn a cashier's PIN into manager approval.
  select array_agg(id) into v_matches from public.pos_users
    where active and pin_hash is not null and extensions.crypt(p_pin,pin_hash)=pin_hash;
  select * into v_manager from public.pos_users
    where id=case when cardinality(v_matches)=1 then v_matches[1] else null end
      and active and role='manager' and extensions.crypt(p_pin,pin_hash)=pin_hash for share;
  if not found then
    update public.pos_return_pin_attempts set
      failures=case when v_attempt.failures=4 then 0 else v_attempt.failures+1 end,
      locked_until=case when v_attempt.failures=4 then clock_timestamp()+interval '30 seconds' else null end,
      updated_at=now() where cashier_id=p_cashier_id;
    return jsonb_build_object('error',case when v_attempt.failures=4 then 'pin_locked' else 'invalid_pin' end);
  end if;
  if v_manager.auth_user_id is null then return jsonb_build_object('error','manager_not_linked'); end if;
  update public.pos_return_pin_attempts set failures=0,locked_until=null,updated_at=now() where cashier_id=p_cashier_id;
  -- The manager identity is scoped to this database call; cashier Auth cookies
  -- never change. The existing atomic RPC still performs its full authorization.
  v_previous_sub := current_setting('request.jwt.claim.sub',true);
  v_previous_claims := current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claim.sub',v_manager.auth_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_set(coalesce(nullif(v_previous_claims,'')::jsonb,'{}'::jsonb),'{sub}',to_jsonb(v_manager.auth_user_id::text))::text,true);
  begin
    v_id := public.pos_process_return(p_client_uuid,p_sale_id,p_reason,p_items);
    if exists(select 1 from public.pos_returns where id=v_id and requested_by is not null and requested_by<>p_cashier_id) then
      raise exception 'idempotency_mismatch' using errcode='22023';
    end if;
    update public.pos_returns set requested_by=p_cashier_id where id=v_id and requested_by is null;
  exception when others then
    perform set_config('request.jwt.claim.sub',coalesce(v_previous_sub,''),true);
    perform set_config('request.jwt.claims',coalesce(v_previous_claims,''),true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub',coalesce(v_previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(v_previous_claims,''),true);
  return jsonb_build_object('return_id',v_id);
end;
$$;
revoke all on function public.pos_process_return_with_pin(uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pos_process_return_with_pin(uuid,text,uuid,uuid,text,jsonb) to service_role;

-- Cashiers may load quantities needed for the approval form, without gaining
-- access to manager refund audit tables or a manager identity.
create function public.pos_staff_return_sale_details(p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sale public.pos_sales%rowtype;
begin
  if not public.pos_is_staff() then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into v_sale from public.pos_sales where id=p_sale_id;
  if not found then raise exception 'sale_not_found' using errcode='P0002'; end if;
  if v_sale.payment_status <> 'paid' then raise exception 'sale_not_paid' using errcode='22023'; end if;
  return jsonb_build_object('id',v_sale.id,'staff_name',v_sale.staff_name,'total',v_sale.total,
    'payment_method',v_sale.payment_method,'created_at',v_sale.created_at,
    'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.pos_returnable_items(p_sale_id) i));
end;
$$;
revoke all on function public.pos_staff_return_sale_details(uuid) from public, anon;
grant execute on function public.pos_staff_return_sale_details(uuid) to authenticated;

commit;
