/**
 * The project note is edited in one place at a time. Other parts of the app
 * (the reader's excerpt button, quick capture, the assistant) append to it
 * through this module: straight into the open editor if there is one,
 * otherwise to the file via the main process.
 */
type Inserter = (markdown: string) => void;
const editors = new Map<string, Inserter>();

export function registerNoteEditor(projectId: string, insert: Inserter): () => void {
  editors.set(projectId, insert);
  return () => { if (editors.get(projectId) === insert) editors.delete(projectId); };
}

export async function appendToNote(projectId: string, markdown: string): Promise<void> {
  const insert = editors.get(projectId);
  if (insert) insert(markdown);
  else await window.allPaper.projects.appendNote(projectId, markdown);
}
