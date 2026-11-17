-- Read typed snapshot fields while finalizing captured payments. Keep the
-- frozen server price/name even if the catalogue changes during STK approval.
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
    as x(product_id uuid, color_id uuid, quantity integer, price_at_sale integer, name text, color_name text, barcode text)
  loop
    if v_item.quantity < 1 or v_item.quantity > 1000 then
      raise exception 'invalid_quantity' using errcode = '22023';
    end if;
    select * into v_product from public.products where id = v_item.product_id and (active or v_mpesa);
    if not found then
      raise exception 'product_unavailable' using errcode = 'P0002';
    end if;
    select * into v_color from public.product_colors
      where id = v_item.color_id and product_id = v_product.id;
    if not found then
      raise exception 'color_not_found' using errcode = 'P0002';
    end if;

    if v_mpesa then
      v_unit := v_item.price_at_sale;
      v_product.name := v_item.name;
      v_product.barcode := v_item.barcode;
      v_color.color_name := v_item.color_name;
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

create or replace function public.pos_apply_mpesa_callback(p_id uuid,p_provider_code integer)
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
    update public.pos_mpesa_transactions set status='reconciliation',failure_code='sale_requires_reconciliation:'||sqlstate,updated_at=now() where id=p_id;
    return 'reconciliation';
  end;
  return 'success';
end;
$$;
