-- ============================================================
-- 履约云 · 权限校验加固
-- 用法：Supabase 后台 → SQL Editor → 新建查询 → 全部粘贴 → Run
-- 在已经跑过 schema.sql 的库上追加执行，不影响已有数据
-- ============================================================

-- 账号资料表：谁是管理员，由这张表说了算，
-- 不再相信注册时客户端自己在 metadata 里声明的 role。
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'user' check (role in ('user','admin')),
  disabled boolean not null default false,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

drop policy if exists profiles_select_all on profiles;
create policy profiles_select_all on profiles for select to authenticated using (true);
-- 注意：这里故意不开放 insert/update/delete 给客户端直接改——
-- 所有改权限的操作都必须走下面的 set_user_role() 函数，
-- 该函数内部会先检查调用者自己是不是管理员。

create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select coalesce((select role from profiles where id = auth.uid()) = 'admin', false)
$$;

-- 新账号注册时自动建资料行，role 固定给 'user'，
-- 完全不看客户端在 signup 请求里塞的任何 role 字段。
-- 这就是防止「自己给自己封管理员」的关键。
create or replace function handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email), 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 管理员改别人角色/启停用的唯一合法入口，调用者不是管理员会直接报错拒绝
create or replace function set_user_role(target_id uuid, new_role text, new_disabled boolean)
returns void language plpgsql security definer as $$
begin
  if not is_admin() then
    raise exception '只有管理员能修改账号权限';
  end if;
  if new_role not in ('user','admin') then
    raise exception '无效的角色: %', new_role;
  end if;
  update profiles set role = new_role, disabled = new_disabled where id = target_id;
end;
$$;

-- 给所有「跑这段 SQL 之前」就已经存在的账号（不管是后台手动建的，
-- 还是当时用系统「新建账号」建的，比如 vincent）补一条权限记录，
-- 默认都是「成员」，只有 bosswenwu@qq.com 补成管理员。
-- 这段之后新建的账号会自动被上面的触发器覆盖，不需要再跑这一段。
insert into profiles (id, email, name, role)
select id, email, coalesce(raw_user_meta_data->>'name', email),
  case when email = 'bosswenwu@qq.com' then 'admin' else 'user' end
from auth.users
on conflict (id) do update set role = excluded.role;
