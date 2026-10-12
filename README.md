# AllPaper

面向个人计算机科研的本地优先桌面工作台：搜集论文、像 arxiv.org/html 一样阅读并在每段下方显示译文、把摘录和想法记进项目笔记、用助手问答，以及中英双栏写作。

## 安装（发布版）

从 `release/AllPaper-0.1.1-arm64.dmg` 安装。要求：**Apple Silicon（M1/M2/M3/M4）Mac，macOS 13+**；Intel Mac 和 Windows 不能用。

1. 打开 DMG，把 AllPaper 拖进“应用程序”。
2. 这个包没有经过 Apple 公证，第一次打开会被系统拦截，任选一种方式放行：
   - **macOS 15 及以上**：先双击打开一次（会弹出拦截提示，点“完成”），然后到 **系统设置 → 隐私与安全性**，下滑找到“已阻止使用 AllPaper”，点“仍要打开”。
   - **macOS 13/14**：在“应用程序”里对 AllPaper **右键 → 打开 → 打开**。
   - 或者在终端执行（任何版本都有效）：

     ```bash
     xattr -dr com.apple.quarantine /Applications/AllPaper.app
     ```
3. 首次启动选择一个资料库目录，API Key 可以稍后在设置里填。

校验和见 `release/SHA256SUMS.txt`。版本说明见 [CHANGELOG.md](CHANGELOG.md)。

## 从源码运行

要求 macOS 13+、Node.js 20+。

```bash
npm install
npm run dev
```

首次启动选择一个资料库目录（不要选在本仓库内）。应用会创建 `papers/`、`projects/`、`.index/`。

```bash
npm test             # 单元测试
npm run build        # 类型检查 + 构建
npm run smoke        # 端到端冒烟（需先 build 和联网，见下）
npm run package:mac  # 未签名 .app → release/mac-arm64/AllPaper.app
npm run package:dmg
```

## 怎么用

1. **入库与搜索**：文献库页顶部的搜索框里粘贴 arXiv 链接或编号（如 `2512.07404`、`arxiv.org/abs/…`），自动获取元数据、HTML 正文（arxiv.org/html，没有则 ar5iv）、PDF 和图片。也可拖入 PDF。**导入 BibTeX 时会逐条获取全文**：先看 `eprint`/链接/arXiv DOI，没有就按标题到 arXiv 匹配（要求标题高度一致且第一作者相符，宁缺毋滥），都没有再尝试 DOI 对应的开放获取 PDF；保留 bib 里的引用键和出版信息，已在库中的条目会跳过。找不到全文的会在文献库里选中后点“获取全文”重试，或“选择本地 PDF”；文献库顶部的“补全全文”会对所有缺正文的文献批量重试。同一个搜索框既过滤文献库，也能回车在线检索（arXiv / Semantic Scholar / OpenAlex / DBLP）后直接入库。
2. **阅读**：打开论文即为阅读视图——章节目录、公式（MathML）、图表、参考文献点击弹出信息；译文在每个段落下方，滚动时自动翻译可见区域及其后内容，结果按段缓存。顶部可切换 双语/原文/译文，也可随时切到原版 PDF。
3. **记笔记**：每个项目只有一份笔记。阅读视图右侧栏的“笔记”就是它；选中文字点“摘录”，原文（可带译文）和出处以引用块加进去，点引用胶囊回到原文那一句。笔记里输入 `@` 引用文献库中的论文。
4. **批注**：选中文字可高亮（四色：结论/质疑/可借鉴/方法）、写批注；“批注”标签页按颜色列出，可定位、改色、摘录。
5. **助手**：侧栏“助手”读取当前论文全文（和项目笔记）回答问题；回答里的 `¶n` 是可点击的原文段落出处，指向不存在段落的引用会标“未核实”。“插入笔记”把回答加到项目笔记。
6. **日程**：一个列表：未完成且已过期的在最上面（标红），其后按日期分组；填标题和日期回车添加，可选时间、类型（截止/阅读/实验/会议/其他）、备注，可关联项目。存为资料库里的 `schedule.json`。
7. **备忘录**：一张表（名称 / 值 / 备注），记 API Key 或 skills 名称等。每行右侧的锁表示是否加密：锁定的行（默认）值用系统钥匙串加密，只保存在本机应用数据目录，**不写入资料库**，备份、同步或提交资料库都不会带走它，复制后 30 秒自动清空剪贴板；解锁的行以明文存进 `memos.json`，适合 skills 名称这类不敏感的内容。
8. **快速记点子**：`⌘⇧I`，一句话追加到当前项目的笔记。`⌘K` 搜索文献库全文。

## 模型配置（重要）

翻译、问答、划词解释、写作翻译都需要你自己的 API Key（设置 → 模型服务）：

- **Anthropic**：填 Key 即可；模型名默认 `claude-haiku-5-5`（翻译）、`claude-sonnet-5-5`（问答与写作）、`claude-opus-5-5`（推理），可改。
- **OpenAI 兼容接口**：填接口地址（含 `/v1`）和 Key；本地模型服务可不填 Key。

未配置时，阅读、批注、笔记、全文检索、中文草稿编辑都能用，所有 AI 入口显示“未配置”，**不会**产出任何假译文。Key 经 Electron `safeStorage` 加密保存在应用数据目录，不写入资料库。设置页的“保存并测试连接”会真实发一次请求。

**用量与花费**显示在侧栏左下角：本月 token 总数和花费估算（悬停可看各功能明细，点击进设置）。花费 = 各功能的 token 数 × 你在设置里为三个模型档位（阅读翻译 / 问答与写作 / 推理）填写的输入、输出单价，货币单位可改（默认 `CA$`）；token 数取自接口返回，单价需要你自己填，不含缓存折扣，仅供估算。

> 自动化测试和冒烟脚本使用本地桩服务/`ALLPAPER_AI=mock`，它们验证的是应用的接线（流式、缓存、占位符还原、出处校验），不是真实模型的质量。

## 目录结构

```text
electron/            主进程入口、preload（allpaper:// 协议、IPC）
src/core/            可单测的纯逻辑：arXiv HTML 解析、笔记 Markdown、提示词、锚点、citekey、LaTeX…
src/main/            论文库/项目存储、arXiv 获取、学术检索适配器、模型提供商与助手
src/renderer/        React 界面（reader/ 阅读视图，notes/ 笔记编辑器）
scripts/smoke/       端到端冒烟脚本
```

资料库：

```text
papers/<citekey>-<id>/  meta.json  content.json  translation.zh.json  annotations.json  paper.pdf  assets/
projects/<项目>/        project.json  note.md  drafts/paper-v1/{draft.json,zh.md,en.md}
schedule.json           日程
memos.json              备忘（密钥的值不在这里，见上）
library.bib             自动维护的全库 BibTeX
.index/                 SQLite 全文索引（可删除重建）
```

## 已知限制与未完成项

见 [PROGRESS.md](PROGRESS.md)。要点：

- 尚未用真实的 Anthropic/OpenAI Key 验证过（只对着本地桩服务验证了请求、流式、错误映射）。
- 没有语义/向量检索；全文检索是 FTS（命令面板 `⌘K`）。新颖性检查、预实验的资源约束与逐节再生成、故事线/大纲、术语一致性检测、差异逐处接受、图表占位未做。
- 无 HTML 版本的论文只能由 PDF 文字层生成阅读视图，段落与公式质量有限；PDF 视图不支持高亮。
- Semantic Scholar / DBLP 在高频或受限网络下会被限流或拦截，会如实列出哪个来源不可用。
- 仅 Apple Silicon 未签名包。
