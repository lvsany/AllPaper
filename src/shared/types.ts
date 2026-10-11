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

export interface DesktopApi {
  settings: { get(): Promise<Settings>; save(input: Partial<Settings> & { apiKey?: string }): Promise<Settings>; chooseLibrary(): Promise<string | undefined> };
  library: { status(): Promise<LibraryStatus>; rebuildIndex(): Promise<void>; openPath(path: string): Promise<void> };
  window: { toggleAi(): Promise<void> };
}

declare global { interface Window { allPaper: DesktopApi } }
