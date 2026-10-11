export type AiProviderKind = 'mock' | 'anthropic' | 'openai-compatible';

export interface Settings {
  libraryPath?: string;
  aiProvider: AiProviderKind;
  aiBaseUrl?: string;
  aiModelTranslation: string;
  aiModelWriting: string;
  aiModelReasoning: string;
  monthlyBudget: number;
  translationStyle: 'muted' | 'border' | 'background';
  translationDelayMs: number;
  apiKeyConfigured: boolean;
}

export const defaultSettings: Settings = {
  aiProvider: 'mock',
  aiModelTranslation: 'claude-haiku-5-5',
  aiModelWriting: 'claude-sonnet-5-5',
  aiModelReasoning: 'claude-opus-5-5',
  monthlyBudget: 0,
  translationStyle: 'border',
  translationDelayMs: 1500,
  apiKeyConfigured: false
};

export interface LibraryStatus {
  configured: boolean;
  root?: string;
  paperCount: number;
  indexHealthy: boolean;
}

export type ReadStatus = 'unread' | 'reading' | 'read' | 'deep-read';
export type ContentSource = 'arxiv-html' | 'ar5iv' | 'pdf' | 'none';
export interface Author { given?: string; family: string; }
export interface Paper {
  id: string; citekey: string; title: string; authors: Author[]; year?: number; venue?: string;
  doi?: string; arxivId?: string; arxivCategories: string[]; abstract?: string; abstractZh?: string;
  url?: string; pdfPath?: string; contentSource: ContentSource; tags: string[]; collections: string[];
  projects: string[]; readStatus: ReadStatus; starred: boolean; lastPosition?: string; addedAt: string;
}
export interface Paragraph { id: string; paperId: string; order: number; type: 'heading' | 'paragraph' | 'list' | 'formula' | 'figure' | 'table' | 'caption' | 'footnote' | 'references' | 'code'; html: string; text: string; sectionPath: string[]; page?: number; }
export interface PaperBundle { paper: Paper; paragraphs: Paragraph[]; }
export interface Annotation { id:string; paperId:string; view:'reader'|'pdf'; color:string; quotedText:string; prefix:string; suffix:string; paragraphId?:string; offsets?:[number,number]; page?:number; comment?:string; createdAt:string; }
export interface NoteDocument { paperId:string; markdown:string; }
export interface ImportResult { paper: Paper; warnings: string[]; }

export interface DesktopApi {
  settings: { get(): Promise<Settings>; save(input: Partial<Settings> & { apiKey?: string }): Promise<Settings>; chooseLibrary(): Promise<string | undefined> };
  library: { status(): Promise<LibraryStatus>; rebuildIndex(): Promise<void>; openPath(path: string): Promise<void>; fileUrl(path:string):Promise<string> };
  papers: {
    list(): Promise<Paper[]>; importPdf(): Promise<ImportResult | undefined>; importBibtex(): Promise<ImportResult[] | undefined>;
    update(id: string, patch: Partial<Paper>): Promise<Paper>; changeCitekey(id: string, citekey: string): Promise<Paper>; translations(id:string):Promise<Record<string,string>>; translate(id:string,paragraphIds?:string[]):Promise<Record<string,string>>;
    annotations(id:string):Promise<Annotation[]>; annotate(id:string,paragraphId:string,color:string,comment?:string):Promise<Annotation>; note(id:string):Promise<NoteDocument>; appendAnnotationToNote(id:string,annotationId:string):Promise<NoteDocument>; saveNote(id:string,markdown:string):Promise<NoteDocument>;
    exportBibtex(ids?: string[]): Promise<string | undefined>; get(id: string): Promise<PaperBundle | undefined>;
    importDroppedPdf(path: string): Promise<ImportResult | undefined>; importSearchRecord(record: import('../core/deduplicate').SearchPaper): Promise<ImportResult>; pathForFile(file: File): string;
  };
  search: { query(query: string, online?: boolean): Promise<import('../core/deduplicate').SearchPaper[]> };
  window: { toggleAi(): Promise<void> };
}

declare global { interface Window { allPaper: DesktopApi } }
