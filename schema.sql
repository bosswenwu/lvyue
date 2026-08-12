-- ============================================================
-- 履约云 · Supabase 建表脚本
-- 用法：Supabase 后台 → SQL Editor → 新建查询 → 全部粘贴 → Run
-- ============================================================

create table if not exists contracts (
  id text primary key,
  contract_no text not null,
  order_no text, purchase_org text, project text, purchaser text,
  contract_name text, supplier_name text,
  total_amount numeric default 0, currency text default 'CNY',
  sign_date date, contract_delivery_date date, promised_delivery_date date,
  packing_list_date date, shipment_notice_date date, required_arrival_date date,
  logistics_owner text, pay_condition_text text, delivery_address text, remark text,
  is_void int default 0,
  created_at timestamptz default now()
);
create unique index if not exists contracts_no_uk on contracts(contract_no);
create index if not exists contracts_sup_ix on contracts(supplier_name);

create table if not exists materials (
  id text primary key,
  contract_id text references contracts(id) on delete cascade,
  line_no text, material_code text, material_name text, spec text, unit text,
  plan_qty numeric default 0, price_tax_in numeric default 0,
  amount_tax_in numeric default 0, brand text, info_code text
);
create index if not exists materials_c_ix on materials(contract_id);

create table if not exists arrivals (
  id text primary key,
  contract_id text references contracts(id) on delete cascade,
  material_id text,
  date date, qty numeric, amount numeric default 0,
  no text, remark text, by text,
  created_at timestamptz default now()
);
create index if not exists arrivals_c_ix on arrivals(contract_id);

create table if not exists invoices (
  id text primary key,
  contract_id text references contracts(id) on delete cascade,
  date date, amount numeric default 0, no text, remark text, by text,
  created_at timestamptz default now()
);
create index if not exists invoices_c_ix on invoices(contract_id);

create table if not exists payments (
  id text primary key,
  contract_id text references contracts(id) on delete cascade,
  plan_id text,
  date date, amount numeric default 0, no text, remark text, by text,
  created_at timestamptz default now()
);
create index if not exists payments_c_ix on payments(contract_id);

create table if not exists payplans (
  id text primary key,
  contract_id text references contracts(id) on delete cascade,
  name text, ratio numeric, amount numeric default 0,
  due_date date, paid int default 0, paid_date date
);
create index if not exists payplans_c_ix on payplans(contract_id);

create table if not exists attachments (
  id text primary key,
  contract_id text references contracts(id) on delete cascade,
  name text, size bigint, type text, by text, at text,
  created_at timestamptz default now()
);
create index if not exists attachments_c_ix on attachments(contract_id);

create table if not exists audit (
  id text primary key,
  contract_id text,
  at text, who text, what text,
  created_at timestamptz default now()
);
create index if not exists audit_c_ix on audit(contract_id);

-- ============================================================
-- 行级安全：只有登录用户能读写（公司内部系统，不区分部门）
-- 若以后要按采购组织隔离，把 using 条件换成对应判断即可
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['contracts','materials','arrivals','invoices','payments','payplans','attachments','audit']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists p_all on %I', t);
    execute format('create policy p_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ============================================================
-- 附件存储桶
-- ============================================================
insert into storage.buckets (id, name, public)
values ('attachments','attachments', false)
on conflict (id) do nothing;

drop policy if exists att_rw on storage.objects;
create policy att_rw on storage.objects for all to authenticated
  using (bucket_id = 'attachments') with check (bucket_id = 'attachments');
