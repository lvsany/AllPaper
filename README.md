# AllPaper

面向个人计算机科研的本地优先桌面工作台：收集/阅读论文、段落译文、论文笔记、点子与预实验、以及中英双栏写作。

## 运行

要求 macOS 13+、Node.js 20+。

```bash
npm install
npm run dev
```

首次启动选择一个资料库目录。应用会创建 `papers/`、`projects/`、`.index/` 等目录；资料库不应选在本仓库中。

构建与打包：

```bash
npm run build
npm test
npm run package:mac
npm run package:dmg
```

未签名 macOS 应用位于 `release/mac-arm64/AllPaper.app`。本机 Gatekeeper 可能要求用户在 Finder 中右键“打开”。

## API Key 与离线模式

设置页选择 Anthropic 或 OpenAI 兼容接口并填写 Key 后点击“保存设置”。Key 通过 Electron `safeStorage` 加密，保存在应用数据目录，不写入资料库。默认 Mock 模式不需要 Key，并且录制的学术搜索结果、阅读译文、写作译文可离线使用。

真实学术源仅在搜索页勾选“同时查询在线公开接口”时调用。真实接口尚未做验收验证。

## 目录结构

```text
electron/                 Electron 主进程与安全 preload
src/core/                 可单测的 citekey、去重、正文、锚点、写作、LaTeX 逻辑
src/main/                 文件、SQLite、论文、项目、AI/学术适配器
src/renderer/             React 工作区界面
fixtures/                 离线 BibTeX 录制样例
```

资料库采用 PRD 规定的开放布局：每篇论文保存元数据、结构化正文、译文缓存、批注与笔记；项目保存项目设置、点子、预实验和草稿。

## 实现决策

- 默认离线 Mock；网络检索是显式可选项，因此无 API Key/网络时主要流程仍可演示与测试。
- 结构化阅读正文优先取 arXiv HTML，其次 ar5iv，最后 PDF 文本；正文均归一为段落数组。
- 未配置真实翻译服务时，Mock 会保留公式/引用标记并产出明确标识的离线译文，避免冒充真实模型输出。
- 论文笔记采用普通 Markdown，片段引用为 `[@citekey#anchor]`；锚点保存原文与上下文并在内容替换后重新匹配。
- macOS 打包显式关闭签名，满足“可打包、不要求签名”。
- 资料库备份使用 macOS 自带 `ditto` 创建 ZIP；Mock 用量以字符数折算 token，费用固定为 $0，真实提供商暂未返回计费数据。

## 未完成项与已知问题

- 真实 arXiv ID 一键下载 PDF/HTML、真实 PDF 20 篇识别率和复杂公式/图表保真度尚未验证。
- 字符级划词、PDF 区域截图、引用悬停卡、真正的左右分屏/光标插入和锚点回跳闪烁尚未完成。
- 全文/语义检索的 UI、真实向量模型、论文问答/速览、可编辑术语表与提示词页尚未完成。
- 点子扩展/新颖性联网报告、项目资源约束、预实验逐节再生成、故事线和树状大纲仍是基础实现；预实验使用离线模板，不应被当成真实文献推理。
- 写作器完成了段落对齐、增量 Mock 翻译、英文锁定和 `.tex` + 仅含实际引用的 `.bib` 导出；尚未实现段落差异选择、术语一致性检测与图表占位。
- `npm run package:mac` 已生成未签名 `.app`，`npm run package:dmg` 已生成 Apple Silicon DMG；Intel 架构交叉打包及 E2E Playwright 冒烟未验证。
