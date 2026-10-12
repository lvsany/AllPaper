export type AiProviderKind = 'anthropic' | 'openai-compatible';

export interface Settings {
  libraryPath?: string;
  aiProvider: AiProviderKind;
  aiBaseUrl?: string;
  aiModelTranslation: string;
  aiModelWriting: string;
  aiModelReasoning: string;
  /** Estimated price in USD per million tokens, used for the usage page only. */
  priceInPerMTok: number;
  priceOutPerMTok: number;
  monthlyBudget: number;
  glossary: string;
  translationStyle: 'muted' | 'border' | 'background';
  translationDelayMs: number;
  /** Computed by the main process; never persisted. */
  apiKeyConfigured: boolean;
  aiConfigured: boolean;
  aiMock: boolean;
}

export const defaultSettings: Settings = {
  aiProvider: 'anthropic',
  aiModelTranslation: 'claude-haiku-5-5',
  aiModelWriting: 'claude-sonnet-5-5',
  aiModelReasoning: 'claude-opus-5-5',
  priceInPerMTok: 0,
  priceOutPerMTok: 0,
  monthlyBudget: 0,
  glossary: '',
  translationStyle: 'border',
  translationDelayMs: 1500,
  apiKeyConfigured: false,
  aiConfigured: false,
  aiMock: false
};

export interface LibraryStatus {
  configured: boolean;
  root?: string;
  paperCount: number;
  indexHealthy: boolean;
}
export interface UsageSummary { month: string; byTask: Record<string, { calls: number; inputTokens: number; outputTokens: number; estimatedCost: number }>; }

export type ReadStatus = 'unread' | 'reading' | 'read' | 'deep-read';
export type ContentSource = 'arxiv-html' | 'ar5iv' | 'pdf' | 'none';
export interface Author { given?: string; family: string; }
export interface Paper {
  id: string; citekey: string; title: string; authors: Author[]; year?: number; venue?: string;
  doi?: string; arxivId?: string; arxivCategories: string[]; abstract?: string; abstractZh?: string;
  url?: string; pdfPath?: string; contentSource: ContentSource; tags: string[]; collections: string[];
  projects: string[]; readStatus: ReadStatus; starred: boolean; lastPosition?: string; addedAt: string;
}
export type ParagraphType = 'title' | 'authors' | 'heading' | 'paragraph' | 'list' | 'formula' | 'figure' | 'table' | 'caption' | 'footnote' | 'references' | 'code';
export interface Paragraph {
  id: string; paperId: string; order: number; type: ParagraphType;
  /** Sanitized HTML of the block, ready to render (math stays MathML). */
  html: string;
  /** Plain text; inline math is written as `$tex$`. Used for search, AI context and anchors. */
  text: string;
  sectionPath: string[]; page?: number;
  /** Heading depth, or list nesting depth for list items. */
  level?: number;
  /** Text sent to the translator: math, citations and refs are replaced by `⟦n⟧` placeholders. */
  masked?: string;
  /** Placeholder id -> original HTML, restored in the translated text. */
  slots?: Record<string, string>;
  /** Other element ids (e.g. the LaTeXML `ltx_para` div) that in-document links may point to. */
  aliases?: string[];
}
export interface PaperBundle {
  paper: Paper; paragraphs: Paragraph[];
  /** URL prefix (custom protocol) that `assets/...` image paths in the HTML are relative to. */
  assetBase: string;
  pdfUrl?: string;
}
export interface Annotation {
  id: string; paperId: string; view: 'reader' | 'pdf'; color: string;
  quotedText: string; prefix: string; suffix: string;
  paragraphId?: string; offsets?: [number, number]; page?: number;
  comment?: string; createdAt: string;
}
export type NewAnnotation = Pick<Annotation, 'color' | 'quotedText' | 'prefix' | 'suffix' | 'paragraphId' | 'offsets' | 'comment'>;

export type AssistantMode = 'chat' | 'explain' | 'ideas' | 'pilot';
export interface AssistantRequest {
  requestId: string;
  mode: AssistantMode;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  paperId?: string;
  projectId?: string;
  selection?: string;
}
export interface TranslateResult { translations: Record<string, string>; failed: string[]; error?: string }
export interface AiStatus { configured: boolean; provider: AiProviderKind; mock: boolean }
export interface ImportResult { paper: Paper; warnings: string[]; }

export interface MemoItem {
  id: string;
  /** `text` is a plain memo; `secret` has a value (API key…) kept outside the library, encrypted. */
  kind: 'text' | 'secret';
  title: string;
  content: string;
  tags: string[];
  updatedAt: string;
  hasSecret?: boolean;
}
/** `secret` undefined keeps the stored value; an empty string clears it. */
export type MemoInput = Omit<MemoItem, 'updatedAt' | 'hasSecret'> & { secret?: string };

export interface DesktopApi {
  settings: {
    get(): Promise<Settings>;
    save(input: Partial<Settings> & { apiKey?: string }): Promise<Settings>;
    chooseLibrary(): Promise<string | undefined>;
  };
  library: {
    status(): Promise<LibraryStatus>; rebuildIndex(): Promise<void>; backup(): Promise<string | undefined>;
    openPath(path: string): Promise<void>; openExternal(url: string): Promise<void>;
    fullText(query: string): Promise<Array<{ id: string; title: string; excerpt: string }>>;
  };
  papers: {
    list(): Promise<Paper[]>;
    get(id: string): Promise<PaperBundle | undefined>;
    importPdf(): Promise<ImportResult | undefined>;
    importBibtex(): Promise<ImportResult[] | undefined>;
    importDroppedPdf(path: string): Promise<ImportResult | undefined>;
    importArxiv(input: string): Promise<ImportResult>;
    importSearchRecord(record: import('../core/deduplicate').SearchPaper): Promise<ImportResult>;
    update(id: string, patch: Partial<Paper>): Promise<Paper>;
    changeCitekey(id: string, citekey: string): Promise<Paper>;
    exportBibtex(ids?: string[]): Promise<string | undefined>;
    translations(id: string): Promise<Record<string, string>>;
    translate(id: string, paragraphIds?: string[], force?: boolean): Promise<TranslateResult>;
    onTranslation(listener: (event: { paperId: string; paragraphId: string; zh: string }) => void): () => void;
    annotations(id: string): Promise<Annotation[]>;
    addAnnotation(id: string, input: NewAnnotation): Promise<Annotation>;
    updateAnnotation(id: string, annotationId: string, patch: Partial<Pick<Annotation, 'color' | 'comment'>>): Promise<Annotation>;
    deleteAnnotation(id: string, annotationId: string): Promise<void>;
    pathForFile(file: File): string;
  };
  search: { query(query: string, online?: boolean): Promise<{ results: import('../core/deduplicate').SearchPaper[]; queries: string[]; errors: string[] }> };
  projects: {
    list(): Promise<import('./projects').Project[]>;
    create(name: string): Promise<import('./projects').Project>;
    note(id: string): Promise<string>;
    saveNote(id: string, markdown: string): Promise<void>;
    appendNote(id: string, markdown: string): Promise<void>;
    draft(id: string): Promise<import('./projects').DraftDocument>;
    saveDraft(id: string, draft: import('./projects').DraftDocument): Promise<import('./projects').DraftDocument>;
    exportLatex(id: string): Promise<string | undefined>;
  };
  ai: {
    status(): Promise<AiStatus>;
    test(): Promise<{ ok: boolean; message: string }>;
    ask(request: Omit<AssistantRequest, 'requestId'>, onDelta: (text: string) => void): { promise: Promise<string>; cancel(): void };
    translateText(text: string): Promise<string>;
    translateWriting(text: string, context?: { before?: string; after?: string; section?: string; neighbourEnglish?: string }): Promise<string>;
  };
  schedule: {
    list(): Promise<import('../core/schedule').ScheduleEvent[]>;
    save(events: import('../core/schedule').ScheduleEvent[]): Promise<import('../core/schedule').ScheduleEvent[]>;
  };
  memos: {
    list(): Promise<MemoItem[]>;
    save(input: MemoInput): Promise<MemoItem>;
    remove(id: string): Promise<void>;
    reveal(id: string): Promise<string>;
    /** Copies the secret in the main process and clears the clipboard again after 30 s. */
    copySecret(id: string): Promise<void>;
  };
  usage: { get(): Promise<UsageSummary> };
  events: { on(channel: 'shortcut:quick-idea' | 'shortcut:command', listener: () => void): () => void };
}

declare global { interface Window { allPaper: DesktopApi } }
