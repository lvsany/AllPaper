import { assistantSystem, parseGlossary, translationSystem, writingSystem, type WritingStyle } from '../core/prompts';
import type { AssistantMode, AssistantRequest, PaperBundle } from '../shared/types';
import { AiError, type AiProvider, type ChatMessage, type Completion } from './ai';

export interface AssistantDeps {
  provider: AiProvider | undefined;
  models: { translate: string; write: string; reason: string };
  glossary: string;
  loadPaper(id: string): Promise<PaperBundle | undefined>;
  loadProject(id: string): Promise<{ name: string; note: string } | undefined>;
  usage(task: string, completion: Pick<Completion, 'inputTokens' | 'outputTokens'>): void;
}

function require(deps: AssistantDeps): AiProvider {
  if (!deps.provider) throw new AiError('尚未配置模型服务。请在设置中填写 API Key。', 'not-configured');
  return deps.provider;
}

const TASK_LABEL: Record<AssistantMode, string> = { chat: '论文问答', explain: '划词解释', ideas: '点子扩展', pilot: '预实验设计' };

export async function runAssistant(deps: AssistantDeps, request: AssistantRequest, onDelta: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const provider = require(deps);
  const bundle = request.paperId ? await deps.loadPaper(request.paperId) : undefined;
  const project = request.projectId ? await deps.loadProject(request.projectId) : undefined;
  const system = assistantSystem({
    paper: bundle ? { title: bundle.paper.title, citekey: bundle.paper.citekey, abstract: bundle.paper.abstract, paragraphs: bundle.paragraphs } : undefined,
    projectName: project?.name, projectNote: project?.note, selection: request.selection, mode: request.mode
  });
  const model = request.mode === 'ideas' || request.mode === 'pilot' ? deps.models.reason : deps.models.write;
  const messages: ChatMessage[] = request.messages.filter((m) => m.content.trim());
  if (!messages.length || messages.at(-1)!.role !== 'user') throw new AiError('没有可回答的问题', 'bad-request');
  const completion = await provider.complete({ model, system, messages, maxTokens: request.mode === 'pilot' ? 6000 : 3000, signal, onDelta });
  deps.usage(TASK_LABEL[request.mode], completion);
  return completion.text;
}

/** Translates arbitrary selected text (no placeholders involved). */
export async function translateText(deps: AssistantDeps, text: string, onDelta?: (text: string) => void): Promise<string> {
  const provider = require(deps);
  const completion = await provider.complete({
    model: deps.models.translate, system: translationSystem(parseGlossary(deps.glossary)),
    messages: [{ role: 'user', content: text }], maxTokens: Math.min(3000, text.length * 2 + 256), onDelta
  });
  deps.usage('划词翻译', completion);
  return completion.text.trim();
}

export interface WritingContext { before?: string; after?: string; section?: string; neighbourEnglish?: string; style?: WritingStyle }

/** Chinese paragraph -> academic English, with the surrounding text as context. */
export async function translateWriting(deps: AssistantDeps, text: string, context: WritingContext = {}): Promise<string> {
  const provider = require(deps);
  const parts: string[] = [];
  if (context.section) parts.push(`所在章节：${context.section}`);
  if (context.before) parts.push(`上文（中文）：${context.before}`);
  if (context.neighbourEnglish) parts.push(`上一段已有的英文：${context.neighbourEnglish}`);
  if (context.after) parts.push(`下文（中文）：${context.after}`);
  parts.push(`请翻译这一段：\n${text}`);
  const completion = await provider.complete({
    model: deps.models.write, system: writingSystem(parseGlossary(deps.glossary), context.style),
    messages: [{ role: 'user', content: parts.join('\n\n') }], maxTokens: Math.min(4000, text.length * 3 + 256)
  });
  deps.usage('双栏写作翻译', completion);
  return completion.text.trim();
}

/** Rewrites a Chinese or English research description into English keyword queries. */
export async function searchQueries(deps: AssistantDeps, description: string): Promise<string[]> {
  const provider = require(deps);
  const completion = await provider.complete({
    model: deps.models.write,
    system: '你是计算机领域的文献检索助手。把用户的研究描述改写为 2 到 4 条适合 arXiv / Semantic Scholar 的英文关键词检索式，每条 3 到 8 个词，覆盖不同的叫法。只输出 JSON 字符串数组，不要任何其他文字。',
    messages: [{ role: 'user', content: description }], maxTokens: 400
  });
  deps.usage('检索改写', completion);
  const match = completion.text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return (JSON.parse(match[0]) as unknown[]).filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 4);
  } catch { return []; }
}
