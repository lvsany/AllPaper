import type { Paragraph } from '../shared/types';

export interface GlossaryEntry { en: string; zh?: string; keep: boolean }

/** One entry per line: `English = 中文`, or `English = =` / `English = 保留` to keep the English. */
export function parseGlossary(text: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([^=#]+?)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const zh = match[2];
    const keep = zh === '' || zh === '=' || zh === '保留' || zh === '不译';
    entries.push({ en: match[1], zh: keep ? undefined : zh, keep });
  }
  return entries;
}

export const DEFAULT_GLOSSARY = [
  'agent = 智能体', 'multi-agent system = 多智能体系统', 'swarm intelligence = 群体智能', 'swarm = 群体',
  'orchestration = 编排', 'benchmark = 基准', 'baseline = 基线', 'ablation = 消融实验', 'pull request = 拉取请求',
  'issue = 议题', 'commit = 提交', 'repository = 代码仓库', 'prompt = 提示词', 'hallucination = 幻觉',
  'fine-tuning = 微调', 'LLM = 大语言模型', 'in-context learning = 上下文学习', 'token = 保留'
].join('\n');

export function glossaryPrompt(entries: GlossaryEntry[]): string {
  if (!entries.length) return '';
  const lines = entries.map((e) => e.keep ? `- ${e.en}：保留英文，不翻译` : `- ${e.en} → ${e.zh}`);
  return `\n术语表（必须遵循）：\n${lines.join('\n')}`;
}

export function translationSystem(entries: GlossaryEntry[]): string {
  return [
    '你是计算机科学论文的专业翻译。把用户给出的英文论文片段翻译成流畅、准确、符合中文学术写作习惯的简体中文。',
    '规则：',
    '1. 只输出译文本身，不要解释，不要添加引号、前缀或标题。',
    '2. 形如 ⟦1⟧ 的占位符代表公式、引用、图表编号或代码，必须原样保留在译文中语义对应的位置，数量不增不减，不得翻译或改写。',
    '3. 人名、模型名、数据集名、框架名、代码标识符和缩写保持英文。',
    '4. 不常见的专业术语在本段首次出现时，在中文后用括号保留英文，如“多智能体系统（multi-agent system）”。',
    '5. 忠实原文，不增删信息，不做总结。',
    glossaryPrompt(entries)
  ].join('\n');
}

export function translationUser(masked: string, sectionPath: string[]): string {
  const where = sectionPath.length ? `（所在章节：${sectionPath.join(' > ')}）\n` : '';
  return `${where}${masked}`;
}

export interface WritingStyle { spelling?: 'US' | 'UK'; firstPerson?: boolean; venue?: string }

export function writingSystem(entries: GlossaryEntry[], style: WritingStyle = {}): string {
  return [
    '你是计算机科学论文的英文写作助手。把用户的中文段落改写为符合英文论文写作习惯的学术英语，而不是逐字直译。',
    '规则：',
    '1. 只输出英文译文本身，不要解释或添加引号。',
    '2. 原样保留 LaTeX 公式（$...$）、引用标记（如 [@key]）、代码、以及 \\ref{...} 一类交叉引用。',
    '3. 保持与前后文一致的术语、指代和时态。',
    `4. 使用${style.spelling === 'UK' ? '英式' : '美式'}拼写；${style.firstPerson === false ? '避免第一人称' : '可以使用第一人称 we'}。`,
    style.venue ? `5. 目标发表渠道：${style.venue}。` : '',
    glossaryPrompt(entries)
  ].filter(Boolean).join('\n');
}

const CONTEXT_TYPES = new Set<Paragraph['type']>(['title', 'heading', 'paragraph', 'list', 'caption', 'footnote', 'table', 'formula']);

export interface PaperContext { title: string; citekey: string; abstract?: string; paragraphs: Paragraph[] }

/** Numbered excerpt of the paper; the numbers are what the model cites as [P12]. */
export function paperContext(paper: PaperContext, maxChars = 120_000): { text: string; truncated: boolean } {
  const lines: string[] = [];
  let used = 0;
  let truncated = false;
  for (const p of paper.paragraphs) {
    if (!CONTEXT_TYPES.has(p.type) || !p.text) continue;
    const line = `[P${p.order}] ${p.type === 'heading' ? '## ' : ''}${p.text}`;
    if (used + line.length > maxChars) { truncated = true; break; }
    lines.push(line);
    used += line.length + 1;
  }
  return { text: lines.join('\n'), truncated };
}

export function assistantSystem(args: { paper?: PaperContext; projectName?: string; projectNote?: string; selection?: string; mode?: 'chat' | 'explain' | 'ideas' | 'pilot' }): string {
  const parts = [
    '你是一位研究群体智能与群体软件工程的科研助手，用中文回答（专有名词、模型名保留英文）。回答要具体、简洁，不要空话。',
    '凡是基于论文内容的陈述，必须在句末用 [P编号] 标注出处，编号取自下方论文正文的段落标签，可以并列如 [P12][P15]；只标注确实支持该陈述的段落。',
    '论文中找不到依据的内容，明确写“（推测）”；不要编造论文中不存在的实验、数据、结论或参考文献。'
  ];
  if (args.paper) {
    const ctx = paperContext(args.paper);
    parts.push(`\n当前论文：${args.paper.title}（引用键 ${args.paper.citekey}）`);
    if (args.paper.abstract) parts.push(`摘要：${args.paper.abstract}`);
    parts.push(`\n论文正文${ctx.truncated ? '（过长，已截断）' : ''}：\n${ctx.text}`);
  }
  if (args.projectNote?.trim()) parts.push(`\n用户的项目「${args.projectName ?? ''}」笔记（用户自己的想法，可作为背景；不是论文内容，不要用 [P] 引用它）：\n${args.projectNote.slice(0, 20_000)}`);
  if (args.selection?.trim()) parts.push(`\n用户当前选中的文字：\n${args.selection}`);
  if (args.mode === 'explain') parts.push('\n任务：用通俗的中文解释选中的内容，必要时说明它在全文中的作用。');
  if (args.mode === 'pilot') parts.push(`\n任务：${PILOT_TASK}`);
  if (args.mode === 'ideas') parts.push('\n任务：根据用户笔记和论文，扩展用户的研究点子：动机（现有工作的什么缺口，引用具体论文）、核心假设、大致方法、预期贡献；论文中没有依据的写“（推测）”。');
  return parts.join('\n');
}

export const PILOT_TASK = [
  '为用户笔记中的研究点子设计一个一到两周内能做完、结果能明确说明“继续还是放弃”的最小预实验方案。按以下 13 节输出（Markdown 二级标题）：',
  '1 要验证的假设（一句可证伪的陈述）；2 最小实验（最便宜的否定性实验，刻意砍掉了什么）；3 自变量/因变量/控制变量；4 任务与数据（基准、子集规模、抽样、出处）；',
  '5 系统配置（多智能体：角色数量、拓扑、协议、底座模型、终止条件）；6 基线（多智能体必须含同一底座模型的单智能体基线，并说明等预算比较）；',
  '7 评测指标；8 随机性控制（重复次数、温度/种子、如何报告）；9 实施步骤与耗时；10 花费估算（列出“任务数×重复×token×单价”的算式）；',
  '11 判定标准（继续/放弃/不确定各是什么结果）；12 风险与混淆因素；13 完整实验的展望。',
  '凡来自文献的基准、基线、指标要标注出处；没有出处的写“模型建议，未在文献库中找到出处”。'
].join('');

/** `[P12]`, `[P12, P15]` and `[P12][P15]` all yield 12 and 15. */
export function extractParagraphRefs(text: string): number[] {
  const refs = new Set<number>();
  for (const match of text.matchAll(/\[(P\d+(?:\s*[,，、]\s*P\d+)*)\]/g)) {
    for (const part of match[1].matchAll(/P(\d+)/g)) refs.add(Number(part[1]));
  }
  return [...refs];
}

export interface AnswerSegment { kind: 'text' | 'ref' | 'unverified'; text: string; order?: number }

/** Splits an answer into text and citation chips; citations to paragraphs that do not exist are marked unverified (A2). */
export function segmentAnswer(text: string, paragraphCount: number): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[(P\d+(?:\s*[,，、]\s*P\d+)*)\]/g)) {
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
    for (const part of match[1].matchAll(/P(\d+)/g)) {
      const order = Number(part[1]);
      segments.push(order < paragraphCount ? { kind: 'ref', text: `P${order}`, order } : { kind: 'unverified', text: '未能核实' });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/** Rewrites [P12] markers in an answer as note citations `[@key#P12]`; unknown paragraphs become plain text. */
export function answerToNoteMarkdown(text: string, citekey: string | undefined, paragraphCount: number): string {
  return text.replace(/\[(P\d+(?:\s*[,，、]\s*P\d+)*)\]/g, (_whole, group: string) =>
    [...group.matchAll(/P(\d+)/g)].map((m) => {
      const order = Number(m[1]);
      return citekey && order < paragraphCount ? `[@${citekey}#P${order}]` : '';
    }).join(''));
}
