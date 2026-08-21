# send-invitation-email

使用 **Supabase 已启用的 SMTP 和邮件模板**发送邀请邮件，不依赖任何第三方发信服务。

- **新用户**：通过 Auth `inviteUserByEmail` 发邀请邮件（走 Dashboard → Authentication → SMTP 和 Auth 邮件模板），被邀请人会在 Auth → Users 中显示为 invited。
- **老用户**：本函数不发邮件；邀请已写入 `space_invitations`，由**应用内邀请/通知**处理。若要对老用户发魔法链接，见下文。

---

## 配置（发信给新用户）

### 1. 启用并配置 SMTP（必做）

- Dashboard → **Authentication** → **SMTP Settings**
- **Enable Custom SMTP** 打开，填写：
  - **Sender email**：发件邮箱（需与下面账号一致或为授权发件人）
  - **Sender name**：发件人名称（如 Vouchap）
  - **Host**：SMTP 服务器（如 smtp.qq.com、smtp.gmail.com）
  - **Port**：通常 465（SSL）或 587（TLS）
  - **Username / Password**：邮箱登录账号；Gmail/QQ 等需使用**应用专用密码**，不要用登录密码
- 保存后可用 “Send test email” 自测。

### 2. 配置重定向 URL（必做，否则邀请链接无效或邮件不发）

邀请邮件里的“接受邀请”链接会跳转到你的应用（如 `exp://localhost:8081/invite/xxx` 或 `vouchap://invite/xxx`）。**必须**把这些地址加入白名单，否则 Supabase 可能不发邮件或链接点不开。

- Dashboard → **Authentication** → **URL Configuration**
- 在 **Redirect URLs** 中**新增**（每行一个）：
  - 开发：`exp://localhost:8081/**`
  - 生产（如用 deep link）：`vouchap://**`
  - 若有 Web 版邀请页：`https://你的域名/**`
- **Site URL** 可设为上述之一或你的主站（如 `https://你的域名`），不要用默认 `http://localhost:3000` 除非你确实在本地 Web 做确认页。

### 3. （可选）自定义邀请邮件模板

- Dashboard → **Authentication** → **Email Templates** → **Invite user**
- 可改主题和正文。链接请保留使用 **`{{ .ConfirmationURL }}`**（已包含确认与跳转）；若需在正文里单独写“打开应用”链接，可用 **`{{ .RedirectTo }}`**（即我们传入的 `inviteUrl`）。

### 4. 部署本函数

```bash
cd /Users/macbook/Vouchap/vouchap-app
supabase functions deploy send-invitation-email
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 托管环境注入（与 `verify_jwt = true` 配合使用）。

**安全（必知）**

- 调用必须携带**已登录用户**的 JWT；函数内会校验 `space_invitations`：**inviter_id**、**pending**、**invitee_email** 与请求体一致后才调用 `inviteUserByEmail`。
- 请求体需包含 **`invitationId`**（或由 `inviteUrl` 中 `/invite/{uuid}` 解析）；**`isExistingUser: true`** 时仅短路返回、不发邮件，不校验邀请行。
- 生产环境可在 Secrets 中设置 **`INVITE_EMAIL_ALLOWED_ORIGINS`**（逗号分隔的完整 Origin，如 `https://app.example.com`）；未设置时允许任意 Origin（`*`）。设置后浏览器来源不在列表中的请求会返回 403。

---

## 邀请邮件发不出 / Auth 里没有 invited 用户：排查

按下面顺序检查：

1. **Redirect URLs 是否包含邀请跳转地址**  
   若缺少 `exp://localhost:8081/**` 或 `vouchap://**`，Supabase 可能拒绝发信或链接无效。补全后重试。

2. **SMTP 是否真的启用且能发信**  
   - SMTP Settings 里 **Enable Custom SMTP** 必须打开，且账号/密码/端口正确。  
   - Gmail/QQ 等必须用**应用专用密码**。  
   - 用 “Send test email” 发一封到自己的邮箱，能收到再测邀请。

3. **看 Edge Function 日志**  
   - Dashboard → **Edge Functions** → **send-invitation-email** → **Logs**  
   - 再在应用里触发一次“发送邀请”。  
   - 若出现 `inviteUserByEmail failed: ...`，把错误信息记下（例如 “redirect url not allowed” → 回去补 Redirect URLs）。  
   - 若出现 `inviteUserByEmail ok, email=xxx`，说明接口已成功，用户应在 Auth → Users 里出现为 **Invited**；若仍收不到邮件，多半是 SMTP 或收件箱/垃圾邮件问题。

4. **Auth → Users**  
   邀请成功后，被邀请邮箱会在 **Users** 里有一条，状态为 **Invited**。若没有这条，说明 `inviteUserByEmail` 未成功，以第 1、2、3 步为准排查。

---

## 老用户：应用内邀请 + 可选魔法链接

- **应用内**：邀请已存在 `space_invitations` 中，老用户登录后可在应用内看到待处理邀请并接受，无需额外邮件。
- **若要对老用户发“魔法链接”登录**：
  1. Dashboard → **Authentication** → **Providers** → **Email** 保持启用。
  2. 在登录/找回密码处使用 **Magic Link**：前端调用 `supabase.auth.signInWithOtp({ email })`，Supabase 会使用同一套 SMTP 和 **Magic Link** 模板发邮件，用户点链接即登录，再在应用内处理邀请即可。

---

## 验证

在应用内「创建客户并发送邀请」：

- **新用户**：会收到 Supabase 发出的邀请邮件（使用你配置的 SMTP 和模板），toast 为 “Invitation email sent”，**Auth → Users** 中可见该 invited 用户。
- **老用户**：toast 为 “Invitation created. They can see it in-app.”，邀请在应用内可见。
