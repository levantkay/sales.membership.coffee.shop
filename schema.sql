-- ============================================================
-- BREW & BENEFITS | Coffee Shop Sales + Membership System
-- 4 core entities: members, products, sales, sale_items
-- Target DB: Supabase PostgreSQL
-- ============================================================

create extension if not exists pgcrypto;

-- 1) MEMBERS
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  membership_number varchar(20) unique not null,
  joined_at date not null default current_date,
  status varchar(10) not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now()
);

-- 2) PRODUCTS
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku varchar(30) unique not null,
  name varchar(100) not null,
  category varchar(30) not null,
  price numeric(12,2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3) SALES
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  receipt_no varchar(30) unique not null,
  sold_at timestamptz not null default now(),
  member_id uuid references public.members(id) on delete set null,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  total numeric(12,2) not null check (total >= 0),
  payment_method varchar(20) not null
    check (payment_method in ('CASH','QRIS','DEBIT','EWALLET')),
  created_at timestamptz not null default now()
);

-- 4) SALE ITEMS
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty integer not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);

create index if not exists idx_sales_sold_at on public.sales(sold_at);
create index if not exists idx_sales_member_id on public.sales(member_id);
create index if not exists idx_sale_items_sale_id on public.sale_items(sale_id);

-- Computed membership view. No extra table/entity is created.
-- Tenure-based benefits:
-- < 3 months      => Bronze, 5%
-- 3 to < 6 months => Silver, 10%
-- >= 6 months     => Gold, 15%
create or replace view public.v_membership as
select
  m.id,
  m.membership_number,
  m.joined_at,
  m.status,
  greatest(0, (extract(year from age(current_date, m.joined_at))::int * 12)
      + extract(month from age(current_date, m.joined_at))::int) as tenure_months,
  case
    when age(current_date, m.joined_at) < interval '3 months' then 'BRONZE'
    when age(current_date, m.joined_at) < interval '6 months' then 'SILVER'
    else 'GOLD'
  end as tier,
  case
    when age(current_date, m.joined_at) < interval '3 months' then 5
    when age(current_date, m.joined_at) < interval '6 months' then 10
    else 15
  end as discount_pct
from public.members m;

-- RLS for classroom/demo use. In production, tighten these policies behind login roles.
alter table public.members enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

-- Drop existing demo policies so this script can be re-run safely.
drop policy if exists "demo members read" on public.members;
drop policy if exists "demo members insert" on public.members;
drop policy if exists "demo products read" on public.products;
drop policy if exists "demo products insert" on public.products;
drop policy if exists "demo sales read" on public.sales;
drop policy if exists "demo sales insert" on public.sales;
drop policy if exists "demo sale_items read" on public.sale_items;
drop policy if exists "demo sale_items insert" on public.sale_items;

create policy "demo members read" on public.members for select using (true);
create policy "demo members insert" on public.members for insert with check (true);
create policy "demo products read" on public.products for select using (true);
create policy "demo products insert" on public.products for insert with check (true);
create policy "demo sales read" on public.sales for select using (true);
create policy "demo sales insert" on public.sales for insert with check (true);
create policy "demo sale_items read" on public.sale_items for select using (true);
create policy "demo sale_items insert" on public.sale_items for insert with check (true);

drop policy if exists "demo membership view read" on public.v_membership;
-- Views don't support direct RLS. Access follows the underlying tables.

-- ------------------------------------------------------------
-- SEED DATA (safe to run after first setup; uses conflict guards)
-- ------------------------------------------------------------
insert into public.products (sku, name, category, price)
values
  ('CF-001', 'Cloud Latte', 'Coffee', 28000),
  ('CF-002', 'Brown Sugar Oat', 'Coffee', 32000),
  ('CF-003', 'Americano', 'Coffee', 22000),
  ('CF-004', 'Matcha Cream', 'Non-Coffee', 30000),
  ('FD-001', 'Butter Croissant', 'Pastry', 24000),
  ('FD-002', 'Cinnamon Roll', 'Pastry', 26000)
on conflict (sku) do update set
  name = excluded.name,
  category = excluded.category,
  price = excluded.price;

insert into public.members (membership_number, joined_at, status)
values
  ('BRW-0001', current_date - interval '14 months', 'ACTIVE'),
  ('BRW-0002', current_date - interval '8 months', 'ACTIVE'),
  ('BRW-0003', current_date - interval '5 months', 'ACTIVE'),
  ('BRW-0004', current_date - interval '2 months', 'ACTIVE'),
  ('BRW-0005', current_date - interval '1 month', 'ACTIVE'),
  ('BRW-0006', current_date - interval '9 months', 'INACTIVE')
on conflict (membership_number) do update set
  joined_at = excluded.joined_at,
  status = excluded.status;

-- Example transactions are intentionally omitted because totals and item lines
-- should normally be produced by the POS workflow.
-- Membership billing and status workflow.
-- Run this after schema.sql in the Supabase SQL Editor.

alter table public.members
  add column if not exists paid_through date;

create table if not exists public.membership_settings (
  id smallint primary key default 1 check (id = 1),
  monthly_fee numeric(12,2) not null default 35000 check (monthly_fee >= 0),
  reactivation_fee numeric(12,2) not null default 10000 check (reactivation_fee >= 0),
  updated_at timestamptz not null default now()
);

insert into public.membership_settings (id, monthly_fee, reactivation_fee)
values (1, 35000, 10000)
on conflict (id) do nothing;

create table if not exists public.membership_payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no varchar(30) not null unique,
  member_id uuid not null references public.members(id) on delete restrict,
  payment_type varchar(20) not null check (payment_type in ('NEW', 'RENEWAL', 'REACTIVATION')),
  subscription_fee numeric(12,2) not null check (subscription_fee >= 0),
  reactivation_fee numeric(12,2) not null default 0 check (reactivation_fee >= 0),
  total_amount numeric(12,2) generated always as (subscription_fee + reactivation_fee) stored,
  payment_method varchar(20) not null check (payment_method in ('CASH','QRIS','DEBIT','EWALLET')),
  coverage_start date not null,
  coverage_end date not null,
  paid_at timestamptz not null default now(),
  check (coverage_end >= coverage_start)
);

create index if not exists idx_membership_payments_member_paid_at
  on public.membership_payments(member_id, paid_at desc);

alter table public.membership_settings enable row level security;
alter table public.membership_payments enable row level security;

drop policy if exists "demo membership settings read" on public.membership_settings;
create policy "demo membership settings read" on public.membership_settings
  for select using (true);

drop policy if exists "demo membership payments read" on public.membership_payments;
create policy "demo membership payments read" on public.membership_payments
  for select using (true);

grant select on public.membership_settings, public.membership_payments to anon, authenticated;

create or replace function public._record_membership_payment(
  p_member_id uuid,
  p_payment_type text,
  p_payment_method text,
  p_initial_start date default null
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_monthly_fee numeric(12,2);
  v_reactivation_fee numeric(12,2) := 0;
  v_status text;
  v_paid_through date;
  v_coverage_start date;
  v_coverage_end date;
  v_receipt_no text;
begin
  select m.status, m.paid_through
    into v_status, v_paid_through
  from public.members m
  where m.id = p_member_id
  for update;

  if not found then
    raise exception 'Membership tidak ditemukan.';
  end if;

  if p_payment_type not in ('NEW', 'RENEWAL', 'REACTIVATION') then
    raise exception 'Jenis pembayaran membership tidak valid.';
  end if;

  if p_payment_type = 'RENEWAL' and v_status <> 'ACTIVE' then
    raise exception 'Iuran hanya dapat dibayar untuk member aktif.';
  end if;

  if p_payment_type = 'REACTIVATION' and v_status <> 'INACTIVE' then
    raise exception 'Reaktivasi hanya dapat dilakukan untuk member inactive.';
  end if;

  select s.monthly_fee, s.reactivation_fee
    into v_monthly_fee, v_reactivation_fee
  from public.membership_settings s
  where s.id = 1;

  if not found then
    raise exception 'Pengaturan biaya membership belum tersedia.';
  end if;

  if p_payment_type <> 'REACTIVATION' then
    v_reactivation_fee := 0;
  end if;

  v_coverage_start := coalesce(
    p_initial_start,
    greatest(coalesce(v_paid_through + 1, current_date), current_date)
  );
  v_coverage_end := (v_coverage_start + interval '1 month' - interval '1 day')::date;
  v_receipt_no := 'MBR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  insert into public.membership_payments (
    receipt_no, member_id, payment_type, subscription_fee, reactivation_fee,
    payment_method, coverage_start, coverage_end
  ) values (
    v_receipt_no, p_member_id, p_payment_type, v_monthly_fee, v_reactivation_fee,
    upper(p_payment_method), v_coverage_start, v_coverage_end
  );

  update public.members
  set paid_through = v_coverage_end
  where id = p_member_id;

  return v_coverage_end;
end;
$$;

create or replace function public.register_member(
  p_membership_number text,
  p_joined_at date,
  p_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  insert into public.members (membership_number, joined_at, status)
  values (upper(trim(p_membership_number)), p_joined_at, 'ACTIVE')
  returning id into v_member_id;

  perform public._record_membership_payment(v_member_id, 'NEW', p_payment_method, p_joined_at);
  return v_member_id;
end;
$$;

create or replace function public.change_membership_status(
  p_member_id uuid,
  p_status text,
  p_payment_method text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if upper(p_status) not in ('ACTIVE', 'INACTIVE') then
    raise exception 'Status membership tidak valid.';
  end if;

  select m.status into v_status
  from public.members m
  where m.id = p_member_id
  for update;

  if not found then
    raise exception 'Membership tidak ditemukan.';
  end if;

  if v_status = upper(p_status) then
    return v_status;
  end if;

  if upper(p_status) = 'INACTIVE' then
    update public.members set status = 'INACTIVE' where id = p_member_id;
    return 'INACTIVE';
  end if;

  if coalesce(trim(p_payment_method), '') = '' then
    raise exception 'Metode pembayaran diperlukan untuk reaktivasi.';
  end if;

  perform public._record_membership_payment(p_member_id, 'REACTIVATION', p_payment_method);
  update public.members set status = 'ACTIVE' where id = p_member_id;
  return 'ACTIVE';
end;
$$;

create or replace function public.renew_membership(
  p_member_id uuid,
  p_payment_method text
)
returns date
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._record_membership_payment(p_member_id, 'RENEWAL', p_payment_method);
end;
$$;

revoke all on function public._record_membership_payment(uuid, text, text, date) from public;
revoke all on function public.register_member(text, date, text) from public;
revoke all on function public.change_membership_status(uuid, text, text) from public;
revoke all on function public.renew_membership(uuid, text) from public;

grant execute on function public.register_member(text, date, text) to anon, authenticated;
grant execute on function public.change_membership_status(uuid, text, text) to anon, authenticated;
grant execute on function public.renew_membership(uuid, text) to anon, authenticated;

-- Transaction correction and product availability controls.
-- Run after schema.sql in the Supabase SQL Editor.

create or replace function public.revise_sale(
  p_sale_id uuid,
  p_member_id uuid,
  p_payment_method text,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_product_price numeric(12,2);
  v_unit_price numeric(12,2);
  v_product_active boolean;
  v_subtotal numeric(12,2) := 0;
  v_discount_pct numeric(5,2) := 0;
  v_discount_amount numeric(12,2);
  v_member_joined_at date;
  v_item_count integer := 0;
  v_original_prices jsonb;
begin
  if coalesce(upper(p_payment_method), '') not in ('CASH', 'QRIS', 'DEBIT', 'EWALLET') then
    raise exception 'Metode pembayaran tidak valid.';
  end if;

  if coalesce(jsonb_typeof(p_items), '') <> 'array' then
    raise exception 'Daftar item transaksi tidak valid.';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'Transaksi harus memiliki minimal satu item.';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'Jumlah item transaksi melebihi batas.';
  end if;

  perform 1 from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Transaksi tidak ditemukan.';
  end if;

  if p_member_id is not null then
    select m.joined_at into v_member_joined_at
    from public.members m
    where m.id = p_member_id
      and (m.status = 'ACTIVE' or m.id = (select s.member_id from public.sales s where s.id = p_sale_id));
    if not found then
      raise exception 'Member tidak ditemukan atau tidak aktif.';
    end if;

    v_discount_pct := case
      when age(current_date, v_member_joined_at) < interval '3 months' then 5
      when age(current_date, v_member_joined_at) < interval '6 months' then 10
      else 15
    end;
  end if;

  if exists (
    select item.product_id
    from jsonb_to_recordset(p_items) as item(product_id uuid, qty integer)
    group by item.product_id
    having count(*) > 1
  ) then
    raise exception 'Produk yang sama tidak boleh muncul lebih dari satu kali.';
  end if;

  for v_item in
    select item.product_id, item.qty
    from jsonb_to_recordset(p_items) as item(product_id uuid, qty integer)
  loop
    if v_item.qty is null or v_item.qty < 1 or v_item.qty > 999 then
      raise exception 'Jumlah item harus antara 1 dan 999.';
    end if;

    select p.price, p.is_active into v_product_price, v_product_active
    from public.products p where p.id = v_item.product_id;
    if not found then
      raise exception 'Produk tidak ditemukan.';
    end if;

    if not v_product_active and not exists (
      select 1 from public.sale_items si
      where si.sale_id = p_sale_id and si.product_id = v_item.product_id
    ) then
      raise exception 'Produk non-available tidak dapat ditambahkan ke transaksi.';
    end if;

    select si.unit_price into v_unit_price
    from public.sale_items si
    where si.sale_id = p_sale_id and si.product_id = v_item.product_id;
    if not found then
      v_unit_price := v_product_price;
    end if;

    v_subtotal := v_subtotal + (v_unit_price * v_item.qty);
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 then
    raise exception 'Transaksi harus memiliki minimal satu item.';
  end if;

  v_discount_amount := v_subtotal * v_discount_pct / 100;

  select coalesce(jsonb_object_agg(si.product_id::text, si.unit_price), '{}'::jsonb)
    into v_original_prices
  from public.sale_items si
  where si.sale_id = p_sale_id;

  update public.sales
  set member_id = p_member_id,
      payment_method = upper(p_payment_method),
      subtotal = v_subtotal,
      discount_pct = v_discount_pct,
      discount_amount = v_discount_amount,
      total = v_subtotal - v_discount_amount
  where id = p_sale_id;

  delete from public.sale_items where sale_id = p_sale_id;

  insert into public.sale_items (sale_id, product_id, qty, unit_price, line_total)
  select p_sale_id, item.product_id, item.qty, prices.unit_price,
         prices.unit_price * item.qty
  from jsonb_to_recordset(p_items) as item(product_id uuid, qty integer)
  join public.products p on p.id = item.product_id
  cross join lateral (
    select coalesce((v_original_prices ->> item.product_id::text)::numeric, p.price) as unit_price
  ) as prices;
end;
$$;

create or replace function public.delete_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sales where id = p_sale_id;
  if not found then
    raise exception 'Transaksi tidak ditemukan.';
  end if;
end;
$$;

create or replace function public.set_product_availability(
  p_product_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products set is_active = p_is_active where id = p_product_id;
  if not found then
    raise exception 'Produk tidak ditemukan.';
  end if;
end;
$$;

revoke all on function public.revise_sale(uuid, uuid, text, jsonb) from public;
revoke all on function public.delete_sale(uuid) from public;
revoke all on function public.set_product_availability(uuid, boolean) from public;
grant execute on function public.revise_sale(uuid, uuid, text, jsonb) to anon, authenticated;
grant execute on function public.delete_sale(uuid) to anon, authenticated;
grant execute on function public.set_product_availability(uuid, boolean) to anon, authenticated;
