-- ============================================================
-- 履约云 · schema v3
-- 用法：Supabase 后台 → SQL Editor → 新建查询 → 全部粘贴 → Run
-- 在已跑过 schema.sql / schema_v2_roles.sql 的库上追加执行，不影响已有数据
--
-- 本次新增两项能力：
--   1) 用户改名           → set_user_name() 函数
--   2) 合同编辑乐观锁     → contracts.version 列
-- 不跑这段也不会报错：前端检测不到这两样时会自动降级（改名会提示先跑本脚本；
-- 乐观锁会退回普通更新）。跑完刷新页面即生效。
-- ============================================================

-- 1) 改名函数：管理员可改任何人；本人可改自己。函数内部校验，前端隐藏按钮不作数。
create or replace function set_user_name(target_id uuid, new_name text)
returns void language plpgsql security definer as $$
begin
  if not (is_admin() or auth.uid() = target_id) then
    raise exception '没有权限修改该账号姓名';
  end if;
  if coalesce(trim(new_name), '') = '' then
    raise exception '姓名不能为空';
  end if;
  update profiles set name = new_name where id = target_id;
end;
$$;

-- 2) 合同版本号：每次成功保存 +1，用于乐观锁。
--    前端保存时带 version=eq.<加载时的值> 做条件更新，命中不到即说明被人抢先改过。
alter table contracts add column if not exists version int not null default 0;
