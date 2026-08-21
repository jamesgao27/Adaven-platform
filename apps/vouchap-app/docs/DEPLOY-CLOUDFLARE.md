# Cloudflare Pages 部署说明（Web 端）

## 构建配置（必填）

- **Root directory（根目录）**：**必须**填 `vouchap-app`  
  否则会在仓库根目录执行 `npm install` 和构建，根目录没有 `react-native-web`，会报错：`Install react-native-web@^0.21.0`。
- **构建命令**：`npx expo export -p web`
- **构建输出目录**：`dist`

在 Cloudflare：**Pages** → 你的项目 → **Settings** → **Builds & deployments** → **Build configuration** 里设置 **Root directory** = `vouchap-app`。

## 环境变量（重要）

### 1. 必须：Production 构建

- 构建时需为 **production**，否则 AI Inventory 会显示、且部分资源（如图标字体）可能不按生产方式打包。
- 在 Cloudflare Pages → 项目 → **Settings** → **Environment variables** 中：
  - **NODE_ENV** = `production`（若未设置，Cloudflare 在「Production」分支构建时通常会自动设为 production；若发现未设置，请手动添加。）

### 2. AI Inventory（仅 develop 显示）

- **production 构建**下，AI Inventory 入口**默认隐藏**，无需再设 `EXPO_PUBLIC_SHOW_AI_INVENTORY=false`。
- 若希望在 production 也显示 AI Inventory，可设置：**EXPO_PUBLIC_SHOW_AI_INVENTORY** = `true`。

### 3. 图标/资源全部缺失时

若部署后**所有界面图标不显示**，常见原因与处理：

1. **构建未以 production 运行**  
   确保构建环境里 **NODE_ENV=production**（见上方），然后重新构建并部署。

2. **站点部署在子路径（如 `https://xxx.pages.dev/app/`）**  
   需让 JS/CSS/字体等资源从子路径加载。在 Cloudflare 环境变量中增加：
   - **EXPO_PUBLIC_WEB_BASE_PATH** = `/app`（把 `/app` 换成你的实际子路径，如 `/vouchap`，且不要末尾斜杠）
   然后重新构建。`app.config.js` 会据此设置 `experiments.baseUrl`，资源路径会带上前缀。

3. **确认输出目录**  
   Cloudflare 的「Build output directory」必须为 **dist**，否则会找不到 `index.html` 和静态资源。

## 推荐 Cloudflare 配置摘要

| 配置项 | 值 |
|--------|-----|
| Build command | `npx expo export -p web` |
| Build output directory | `dist` |
| Root directory（若 monorepo） | `vouchap-app` |
| NODE_ENV（Production 环境） | `production` |

子路径部署时再增加：

| 配置项 | 值 |
|--------|-----|
| EXPO_PUBLIC_WEB_BASE_PATH | 你的子路径，如 `/app` |

保存后重新构建并部署即可。
