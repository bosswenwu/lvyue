/* ============================================================
   履约云 · 管理员建号（Supabase Edge Function）

   为什么需要它：
   本仓库是公开的，代码里写着 Supabase 地址和 publishable key，而数据表的
   RLS 是「任何登录用户可读写全部数据」。所以 Supabase 的公开注册必须关掉，
   否则任何人都能自己注册一个账号登进来看全部合同和金额。
   关掉之后，前端就没法再用 /auth/v1/signup 建号了——那个接口本来就是给
   公开注册用的。建号需要 service_role 密钥，而 service_role 绝对不能出现
   在前端代码里（那等于把整个数据库的钥匙公开）。
   所以把建号这一步挪到服务端：service_role 只存在于这个函数的环境变量里，
   浏览器永远拿不到。

   这个函数做三件事，缺一不可：
     1. 用调用者自己的 JWT 去问 Supabase「你是谁」——验证令牌真实有效
     2. 用 service_role 查 profiles 表确认这个人确实是管理员且未被停用
     3. 才用 service_role 建号

   第 2 步不能省。Edge Function 默认开启的 JWT 校验只保证「是个已登录用户」，
   任何一个普通成员的令牌都能通过——不自己查一遍角色，等于谁都能建管理员账号。

   角色也不能听前端的：请求体里就算传了 role 也一律忽略，新账号统一是「成员」，
   要升管理员得由已登录的管理员在用户管理页调 set_user_role()（那个函数内部
   同样会校验调用者身份）。

   部署：Supabase 控制台 → Edge Functions → Deploy a new function →
        名字填 admin-create-user → 把本文件内容整个粘进去 → Deploy。
        不需要装 CLI。SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 由平台自动注入，
        不用手工配。
   ============================================================ */

/* 前端在 GitHub Pages 上，跟 Supabase 不同源，必须显式放行跨域，
   而且要处理浏览器先发的 OPTIONS 预检请求，否则真正的 POST 根本发不出去。 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "只接受 POST" }, 405);

  const URL_ = Deno.env.get("SUPABASE_URL");
  const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!URL_ || !SRK) return json({ error: "函数环境变量缺失，请重新部署" }, 500);

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "缺少登录凭证" }, 401);

  /* 1. 用调用者的令牌换出他是谁。令牌伪造或过期在这一步就会被 Supabase 拒掉。 */
  const meRes = await fetch(`${URL_}/auth/v1/user`, {
    headers: { apikey: SRK, Authorization: auth },
  });
  if (!meRes.ok) return json({ error: "登录已过期，请重新登录后再试" }, 401);
  const me = await meRes.json();
  if (!me?.id) return json({ error: "无法确认你的身份" }, 401);

  /* 2. 查 profiles 确认是管理员。这一步是整个函数的安全底线：
        少了它，任何一个普通成员都能拿自己的令牌来建号。 */
  const pRes = await fetch(
    `${URL_}/rest/v1/profiles?id=eq.${encodeURIComponent(me.id)}&select=role,disabled`,
    { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } },
  );
  if (!pRes.ok) return json({ error: "读取权限记录失败，请确认已执行 schema_v2_roles.sql" }, 500);
  const prof = (await pRes.json())?.[0];
  if (!prof) return json({ error: "你还没有权限记录，请联系管理员在 Supabase 后台补上" }, 403);
  if (prof.disabled) return json({ error: "你的账号已被停用" }, 403);
  if (prof.role !== "admin") return json({ error: "只有管理员能新建账号" }, 403);

  /* 3. 校验入参 */
  let body: { email?: string; password?: string; name?: string };
  try { body = await req.json() } catch { return json({ error: "请求格式不对" }, 400) }
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const name = String(body.name || "").trim() || email;
  if (!email.includes("@")) return json({ error: "账号必须是完整邮箱地址" }, 400);
  if (password.length < 8) return json({ error: "密码至少 8 位" }, 400);

  /* 4. 建号。email_confirm=true 直接标记为已确认，对方不用去点确认邮件
        （内部系统本来也不走邮件流程）。
        role 一律不写：新账号由数据库触发器 handle_new_user 统一建成「成员」。 */
  const cRes = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
  });
  const created = await cRes.json().catch(() => ({}));
  if (!cRes.ok) {
    const msg = String(created?.msg || created?.message || created?.error_description || "");
    if (/already|exists|registered|duplicate/i.test(msg))
      return json({ error: "这个邮箱已经建过账号了" }, 409);
    return json({ error: "建号失败：" + (msg || `HTTP ${cRes.status}`) }, 400);
  }
  return json({ id: created.id, email: created.email, name });
});
