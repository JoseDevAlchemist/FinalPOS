-- Payment drafts are server-priced snapshots, not completed sales or offline queues.
create table public.pos_mpesa_sales (
  id uuid primary key,
  staff_id uuid not null references public.pos_users(id),
  amount integer not null check(amount>0),
  items jsonb not null,
  status text not null default 'pending' check(status in ('pending','completed','cancelled')),
  created_at timestamptz not null default now()
);
create table public.pos_mpesa_transactions (
  id uuid primary key,
  sale_id uuid not null references public.pos_mpesa_sales(id),
  merchant_request_id text,
  checkout_request_id text unique,
  phone_number text not null check(phone_number ~ '^254[17][0-9]{8}$'),
  amount integer not null check(amount>0),
  status text not null default 'initiating' check(status in ('initiating','pending','verified','success','failed','reconciliation','manual_pending')),
  mpesa_receipt_number text unique,
  manual_receipt_number text,
  callback_token_hash text not null,
  callback_checkout_id text,
  callback_merchant_id text,
  callback_result_code integer,
  callback_amount integer,
  callback_phone text,
  callback_receipt text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index pos_mpesa_one_unresolved_attempt on public.pos_mpesa_transactions(sale_id)
  where status in ('initiating','pending','verified','success','reconciliation','manual_pending');
create index pos_mpesa_transactions_sale on public.pos_mpesa_transactions(sale_id,created_at);
alter table public.pos_mpesa_sales enable row level security;
alter table public.pos_mpesa_transactions enable row level security;
revoke all on public.pos_mpesa_sales,public.pos_mpesa_transactions from public,anon,authenticated;
grant select on public.pos_mpesa_sales to authenticated;
grant select(id,sale_id,merchant_request_id,checkout_request_id,amount,status,mpesa_receipt_number,manual_receipt_number,failure_code,created_at,updated_at)
  on public.pos_mpesa_transactions to authenticated;
create policy "Staff read own M-Pesa drafts" on public.pos_mpesa_sales for select to authenticated
  using(public.pos_is_staff() and (staff_id=(select id from public.pos_users where auth_user_id=auth.uid()) or public.pos_is_manager()));
create policy "Staff read own M-Pesa attempts" on public.pos_mpesa_transactions for select to authenticated
  using(exists(select 1 from public.pos_mpesa_sales s where s.id=sale_id));

create function public.pos_prepare_mpesa_sale(p_id uuid,p_total integer,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_staff uuid; v_old public.pos_mpesa_sales%rowtype; v_item record; v_product public.products%rowtype;
  v_color public.product_colors%rowtype; v_total bigint:=0; v_items jsonb:='[]'; v_unit integer;
begin
  select id into v_staff from public.pos_users where auth_user_id=auth.uid() and active for share;
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
  if p_id is null or p_total is null or p_total<=0 or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_cart' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid_cart' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,7117));
  select * into v_old from public.pos_mpesa_sales where id=p_id;
  if found then
    if v_old.staff_id<>v_staff or v_old.amount<>p_total or v_old.status='cancelled'
      or (select jsonb_agg(jsonb_build_object('product_id',x.product_id,'color_id',x.color_id,'quantity',x.quantity,'price_at_sale',x.price_at_sale) order by x.product_id,x.color_id)
        from jsonb_to_recordset(p_items) x(product_id uuid,color_id uuid,quantity integer,price_at_sale integer))
      is distinct from (select jsonb_agg(jsonb_build_object('product_id',x.product_id,'color_id',x.color_id,'quantity',x.quantity,'price_at_sale',x.price_at_sale) order by x.product_id,x.color_id)
        from jsonb_to_recordset(v_old.items) x(product_id uuid,color_id uuid,quantity integer,price_at_sale integer)) then
      raise exception 'idempotency_mismatch' using errcode='22023';
    end if;
    return jsonb_build_object('saleId',v_old.id,'amount',v_old.amount);
  end if;
  if exists(select 1 from jsonb_to_recordset(p_items) x(product_id uuid,color_id uuid,quantity numeric,price_at_sale numeric)
    where x.product_id is null or x.color_id is null or x.quantity is null or x.quantity<>trunc(x.quantity) or x.quantity not between 1 and 1000
      or x.price_at_sale is null or x.price_at_sale<>trunc(x.price_at_sale)) then raise exception 'invalid_cart' using errcode='22023'; end if;
  if (select count(*)<>count(distinct x.color_id) from jsonb_to_recordset(p_items) x(color_id uuid)) then raise exception 'duplicate_color' using errcode='22023'; end if;
  perform id from public.products where id in(select x.product_id from jsonb_to_recordset(p_items) x(product_id uuid)) order by id for update;
  perform id from public.product_colors where id in(select x.color_id from jsonb_to_recordset(p_items) x(color_id uuid)) order by id for update;
  for v_item in select * from jsonb_to_recordset(p_items) x(product_id uuid,color_id uuid,quantity integer,price_at_sale integer) order by product_id,color_id loop
    select * into v_product from public.products where id=v_item.product_id and active;
    if not found then raise exception 'product_unavailable' using errcode='22023'; end if;
    select * into v_color from public.product_colors where id=v_item.color_id and product_id=v_product.id;
    if not found or v_color.stock_quantity<v_item.quantity then raise exception 'insufficient_stock' using errcode='23514'; end if;
    v_unit:=round(v_product.base_price::numeric*(100-v_product.discount_percent)/100)::integer;
    if v_unit<>v_item.price_at_sale then raise exception 'price_mismatch' using errcode='22023'; end if;
    v_total:=v_total+v_unit::bigint*v_item.quantity;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product.id,'color_id',v_color.id,'quantity',v_item.quantity,'price_at_sale',v_unit,'name',v_product.name,'color_name',v_color.color_name,'barcode',v_product.barcode));
  end loop;
  if v_total<>p_total or v_total>2147483647 then raise exception 'total_mismatch' using errcode='22023'; end if;
  insert into public.pos_mpesa_sales(id,staff_id,amount,items) values(p_id,v_staff,p_total,v_items);
  return jsonb_build_object('saleId',p_id,'amount',p_total);
end;
$$;
revoke all on function public.pos_prepare_mpesa_sale(uuid,integer,jsonb) from public,anon;
grant execute on function public.pos_prepare_mpesa_sale(uuid,integer,jsonb) to authenticated;

create function public.pos_begin_mpesa_attempt(p_id uuid,p_sale uuid,p_staff uuid,p_phone text,p_amount integer,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sale public.pos_mpesa_sales%rowtype; v_old public.pos_mpesa_transactions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into v_sale from public.pos_mpesa_sales where id=p_sale for update;
  if not found or v_sale.staff_id<>p_staff or not exists(select 1 from public.pos_users where id=p_staff and active) then raise exception 'not_authorized' using errcode='42501'; end if;
  if v_sale.status<>'pending' or p_amount<>v_sale.amount or p_phone !~ '^254[17][0-9]{8}$' or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_payment' using errcode='22023'; end if;
  select * into v_old from public.pos_mpesa_transactions where id=p_id;
  if found then
    if v_old.sale_id<>p_sale or v_old.phone_number<>p_phone or v_old.amount<>p_amount or v_old.callback_token_hash<>p_token_hash then raise exception 'idempotency_mismatch' using errcode='22023'; end if;
    return jsonb_build_object('dispatch',false,'id',v_old.id,'status',v_old.status,'checkoutRequestId',v_old.checkout_request_id);
  end if;
  if exists(select 1 from public.pos_mpesa_transactions where sale_id=p_sale and status<>'failed') then raise exception 'payment_unresolved' using errcode='22023'; end if;
  insert into public.pos_mpesa_transactions(id,sale_id,phone_number,amount,callback_token_hash) values(p_id,p_sale,p_phone,v_sale.amount,p_token_hash);
  return jsonb_build_object('dispatch',true,'id',p_id,'status','initiating','checkoutRequestId',null);
end;
$$;
revoke all on function public.pos_begin_mpesa_attempt(uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.pos_begin_mpesa_attempt(uuid,uuid,uuid,text,integer,text) to service_role;

create function public.pos_attach_mpesa_request(p_id uuid,p_merchant text,p_checkout text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  if length(coalesce(p_merchant,'')) not between 1 and 150 or length(coalesce(p_checkout,'')) not between 1 and 150 then raise exception 'invalid_provider_ids' using errcode='22023'; end if;
  update public.pos_mpesa_transactions set merchant_request_id=p_merchant,checkout_request_id=p_checkout,
    status=case when status='initiating' then 'pending' else status end,updated_at=now()
    where id=p_id and (checkout_request_id is null or checkout_request_id=p_checkout);
  if not found then raise exception 'attempt_not_found' using errcode='22023'; end if;
end;
$$;
revoke all on function public.pos_attach_mpesa_request(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pos_attach_mpesa_request(uuid,text,text) to service_role;

create function public.pos_store_mpesa_callback(p_id uuid,p_token_hash text,p_checkout text,p_merchant text,p_code integer,p_amount integer,p_phone text,p_receipt text)
returns void language plpgsql security definer set search_path='' as $$
declare v public.pos_mpesa_transactions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into v from public.pos_mpesa_transactions where id=p_id for update;
  if not found or v.callback_token_hash is distinct from p_token_hash then raise exception 'invalid_callback' using errcode='42501'; end if;
  if (v.checkout_request_id is not null and v.checkout_request_id<>p_checkout) or (v.merchant_request_id is not null and v.merchant_request_id<>p_merchant) then raise exception 'callback_mismatch' using errcode='22023'; end if;
  if p_code=0 and (p_amount is distinct from v.amount or p_phone is distinct from v.phone_number or coalesce(p_receipt,'') !~ '^[A-Z0-9]{10}$') then raise exception 'callback_mismatch' using errcode='22023'; end if;
  if v.callback_result_code=0 then
    if p_code<>0 or v.callback_receipt is distinct from p_receipt then raise exception 'callback_conflict' using errcode='22023'; end if;
    return;
  end if;
  update public.pos_mpesa_transactions set callback_checkout_id=p_checkout,callback_merchant_id=p_merchant,
    callback_result_code=p_code,callback_amount=p_amount,callback_phone=p_phone,callback_receipt=p_receipt,updated_at=now() where id=p_id;
end;
$$;
revoke all on function public.pos_store_mpesa_callback(uuid,text,text,text,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.pos_store_mpesa_callback(uuid,text,text,text,integer,integer,text,text) to service_role;

alter table public.pos_sale_audit drop constraint pos_sale_audit_event_check;
alter table public.pos_sale_audit add constraint pos_sale_audit_event_check check(event in ('cash_sale_recorded','mpesa_sale_recorded'));
create or replace function public.pos_record_sale(
  p_client_uuid uuid,
  p_cashier_id uuid,
  p_total_kes integer,
  p_payment_method text,
  p_amount_tendered integer,
  p_items jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.pos_users%rowtype;
  v_sale_id uuid;
  v_product public.products%rowtype;
  v_color public.product_colors%rowtype;
  v_item record;
  v_unit integer;
  v_total bigint := 0;
  v_after integer;
  v_mpesa boolean := p_payment_method = 'mpesa';
  v_draft public.pos_mpesa_sales%rowtype;
begin
  if v_mpesa then
    if auth.role() is distinct from 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
    select * into v_draft from public.pos_mpesa_sales where id=p_client_uuid for update;
    if not found or v_draft.status='cancelled' or v_draft.staff_id is distinct from p_cashier_id
      or v_draft.amount is distinct from p_total_kes or v_draft.items is distinct from p_items
      or not exists(select 1 from public.pos_mpesa_transactions where sale_id=p_client_uuid and status in ('verified','success')) then
      raise exception 'mpesa_not_verified' using errcode='42501';
    end if;
    select * into v_staff from public.pos_users where id=p_cashier_id for share;
  else
    select * into v_staff from public.pos_users where auth_user_id=auth.uid() and active for share;
    if not found or p_cashier_id is distinct from v_staff.id then raise exception 'not_authorized' using errcode='42501'; end if;
  end if;
  if p_client_uuid is null or p_total_kes is null or p_total_kes<0
    or p_payment_method is null or p_payment_method not in ('cash','mpesa')
    or (not v_mpesa and (p_amount_tendered is null or p_amount_tendered<0)) then
    raise exception 'invalid_cash_sale' using errcode='22023';
  end if;

  -- Claim the UUID before touching stock. A concurrent retry waits here for
  -- the first transaction, then returns false without repricing historical data.
  insert into public.pos_sales (
    id, client_uuid, staff_id, staff_name, subtotal, total,
    payment_method, payment_status, cash_tendered, change_due, paid_at
  ) values (
    case when v_mpesa then p_client_uuid else gen_random_uuid() end, p_client_uuid, v_staff.id, v_staff.name, p_total_kes, p_total_kes,
    p_payment_method, 'paid', case when v_mpesa then null else p_amount_tendered end, case when v_mpesa then null else 0 end, now()
  ) on conflict (client_uuid) do nothing returning id into v_sale_id;

  if v_sale_id is null then
    if not exists (select 1 from public.pos_sales
      where client_uuid = p_client_uuid and staff_id = v_staff.id) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    return false;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'cart_empty_or_too_large' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) i
    where jsonb_typeof(i) is distinct from 'object'
      or jsonb_typeof(i->'product_id') is distinct from 'string'
      or jsonb_typeof(i->'color_id') is distinct from 'string'
      or jsonb_typeof(i->'quantity') is distinct from 'number'
      or jsonb_typeof(i->'price_at_sale') is distinct from 'number'
      or (i->>'quantity') !~ '^[0-9]+$'
      or (i->>'price_at_sale') !~ '^[0-9]+$'
  ) then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  -- Consistent lock order prevents two carts with reversed item order from
  -- deadlocking. Product edits cannot change prices during validation.
  perform p.id from public.products p
    where p.id in (select x.product_id from jsonb_to_recordset(p_items)
      as x(product_id uuid)) order by p.id for update;
  perform c.id from public.product_colors c
    where c.id in (select x.color_id from jsonb_to_recordset(p_items)
      as x(color_id uuid)) order by c.id for update;

  for v_item in select * from jsonb_to_recordset(p_items)
    as x(product_id uuid, color_id uuid, quantity integer, price_at_sale integer)
  loop
    if v_item.quantity < 1 or v_item.quantity > 1000 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    select * into v_product from public.products where id = v_item.product_id and active;
    if not found then
      raise exception 'product_unavailable' using errcode = 'P0002';
    end if;
    select * into v_color from public.product_colors
      where id = v_item.color_id and product_id = v_product.id;
    if not found then
      raise exception 'color_not_found' using errcode = 'P0002';
    end if;

    if v_mpesa then
      v_unit := (v_item->>'price_at_sale')::integer;
      v_product.name := v_item->>'name';
      v_product.barcode := v_item->>'barcode';
      v_color.color_name := v_item->>'color_name';
    else
      v_unit := round(v_product.base_price::numeric * (100 - v_product.discount_percent) / 100)::integer;
    end if;
    if v_item.price_at_sale is distinct from v_unit then
      raise exception 'price_mismatch' using errcode = '22023';
    end if;
    v_total := v_total + v_unit::bigint * v_item.quantity;
    if v_total > 2147483647 then
      raise exception 'total_too_large' using errcode = '22023';
    end if;

    update public.product_colors set stock_quantity = stock_quantity - v_item.quantity
      where id = v_color.id and stock_quantity >= v_item.quantity
      returning stock_quantity into v_after;
    if not found then
      raise exception 'insufficient_stock:%', v_product.name using errcode = '23514';
    end if;
    -- The projection trigger decrements products.stock_quantity in this same
    -- transaction. Both stock projections roll back if any later check fails.
    insert into public.stock_movements (
      product_id, color_id, delta, quantity_after, reason, actor_staff_id
    ) values (
      v_product.id, v_color.id, -v_item.quantity, v_after,
      'sale:' || p_client_uuid::text, v_staff.id
    );
    insert into public.pos_sale_items (
      sale_id, product_id, color_id, name, color_name, barcode,
      unit_price, quantity, line_total
    ) values (
      v_sale_id, v_product.id, v_color.id, v_product.name, v_color.color_name,
      v_product.barcode, v_unit, v_item.quantity, v_unit * v_item.quantity
    );
  end loop;

  if p_total_kes is distinct from v_total then
    raise exception 'total_mismatch' using errcode = '22023';
  end if;
  if not v_mpesa and p_amount_tendered < v_total then
    raise exception 'insufficient_cash' using errcode = '22023';
  end if;
  update public.pos_sales set subtotal = v_total, total = v_total,
    change_due = case when v_mpesa then null else p_amount_tendered - v_total end where id = v_sale_id;
  insert into public.pos_sale_audit(sale_id, actor_staff_id, event)
    values (v_sale_id, v_staff.id, case when v_mpesa then 'mpesa_sale_recorded' else 'cash_sale_recorded' end);
  return true;
end;
$$;
grant execute on function public.pos_record_sale(uuid,uuid,integer,text,integer,jsonb) to service_role;

create function public.pos_apply_mpesa_callback(p_id uuid,p_provider_code integer)
returns text language plpgsql security definer set search_path='' as $$
declare v public.pos_mpesa_transactions%rowtype; s public.pos_mpesa_sales%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  select * into s from public.pos_mpesa_sales where id=(select sale_id from public.pos_mpesa_transactions where id=p_id) for update;
  select * into v from public.pos_mpesa_transactions where id=p_id for update;
  if not found then raise exception 'attempt_not_found' using errcode='22023'; end if;
  if v.status='success' then return 'success'; end if;
  if v.checkout_request_id is null or p_provider_code is null then return v.status; end if;
  if p_provider_code<>0 and v.manual_receipt_number is not null then
    update public.pos_mpesa_transactions set status='manual_pending',updated_at=now() where id=p_id;
    return 'manual_pending';
  end if;
  if p_provider_code<>0 and coalesce(v.callback_result_code,-1)<>0 then
    update public.pos_mpesa_transactions set status='failed',failure_code='provider_declined',updated_at=now() where id=p_id;
    return 'failed';
  end if;
  if p_provider_code<>0 or v.callback_result_code is distinct from 0
    or v.callback_checkout_id is distinct from v.checkout_request_id or v.callback_merchant_id is distinct from v.merchant_request_id
    or v.callback_amount is distinct from v.amount or v.callback_phone is distinct from v.phone_number
    or v.callback_receipt is null or s.status='cancelled' or v.status='failed' then
    update public.pos_mpesa_transactions set status='reconciliation',failure_code='confirmation_mismatch',updated_at=now() where id=p_id;
    return 'reconciliation';
  end if;
  -- The verified provider result and callback metadata are persisted before
  -- entering a subtransaction, so an inventory failure never loses payment evidence.
  begin
    update public.pos_mpesa_transactions set status='verified',mpesa_receipt_number=v.callback_receipt,updated_at=now() where id=p_id;
    perform public.pos_record_sale(s.id,s.staff_id,s.amount,'mpesa',null,s.items);
    if not exists(select 1 from public.pos_sales where id=s.id and payment_method='mpesa' and payment_status='paid') then raise exception 'finalization_conflict'; end if;
    update public.pos_sales set mpesa_checkout_request_id=v.checkout_request_id,mpesa_merchant_request_id=v.merchant_request_id,
      mpesa_receipt=v.callback_receipt where id=s.id;
    update public.pos_mpesa_sales set status='completed' where id=s.id;
    update public.pos_mpesa_transactions set status='success',failure_code=null,updated_at=now() where id=p_id;
  exception when others then
    update public.pos_mpesa_transactions set status='reconciliation',failure_code='sale_requires_reconciliation',updated_at=now() where id=p_id;
    return 'reconciliation';
  end;
  return 'success';
end;
$$;
revoke all on function public.pos_apply_mpesa_callback(uuid,integer) from public,anon,authenticated;
grant execute on function public.pos_apply_mpesa_callback(uuid,integer) to service_role;

create function public.pos_mark_mpesa_dispatch(p_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  if p_status not in ('failed','reconciliation') then raise exception 'invalid_status' using errcode='22023'; end if;
  update public.pos_mpesa_transactions set status=p_status,failure_code=case when p_status='failed' then 'request_rejected' else 'dispatch_uncertain' end,updated_at=now()
    where id=p_id and status='initiating';
end;
$$;
revoke all on function public.pos_mark_mpesa_dispatch(uuid,text) from public,anon,authenticated;
grant execute on function public.pos_mark_mpesa_dispatch(uuid,text) to service_role;

create function public.pos_cancel_mpesa_draft(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.pos_mpesa_sales%rowtype;
begin
  select * into s from public.pos_mpesa_sales where id=p_id for update;
  if not found or not exists(select 1 from public.pos_users where id=s.staff_id and auth_user_id=auth.uid() and active) then raise exception 'not_authorized' using errcode='42501'; end if;
  if s.status='completed' or exists(select 1 from public.pos_mpesa_transactions where sale_id=p_id and status<>'failed') then raise exception 'payment_unresolved' using errcode='22023'; end if;
  update public.pos_mpesa_sales set status='cancelled' where id=p_id;
end;
$$;
revoke all on function public.pos_cancel_mpesa_draft(uuid) from public,anon;
grant execute on function public.pos_cancel_mpesa_draft(uuid) to authenticated;

create function public.pos_note_manual_mpesa(p_id uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_code !~ '^[A-Z0-9]{10}$' then raise exception 'invalid_receipt' using errcode='22023'; end if;
  update public.pos_mpesa_transactions t set manual_receipt_number=p_code,status='manual_pending',updated_at=now()
    where id=p_id and status<>'success' and exists(select 1 from public.pos_mpesa_sales s join public.pos_users u on u.id=s.staff_id where s.id=t.sale_id and u.auth_user_id=auth.uid() and u.active);
  if not found then raise exception 'not_authorized' using errcode='42501'; end if;
end;
$$;
revoke all on function public.pos_note_manual_mpesa(uuid,text) from public,anon;
grant execute on function public.pos_note_manual_mpesa(uuid,text) to authenticated;
