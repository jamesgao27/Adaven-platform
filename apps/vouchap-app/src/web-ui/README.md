# Web UI

Web 端 UI 目录。与移动端共用 `../shared-logic`（API、收据解析等）。

- **运行 Web**：在项目根目录执行 `npm run web`（即 `expo start --web`），Expo 会使用 react-native-web 渲染同一套 app（`../mobile-ui/app`）。
- 后续可在此目录增加 Web 专属页面或入口，通过 `@/lib` 引用 shared-logic。
