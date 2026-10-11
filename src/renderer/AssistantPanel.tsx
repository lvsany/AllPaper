import { Fragment, useEffect, useRef, useState, type ReactElement } from 'react';
import { Check, Copy, NotebookPen, RotateCw, Send, Sparkles, Square } from 'lucide-react';
import { answerToNoteMarkdown, segmentAnswer } from '../core/prompts';
import type { AssistantMode } from '../shared/types';
import { useWorkspace } from './workspace';

interface Message { role: 'user' | 'assistant'; content: string; error?: boolean; mode?: AssistantMode }

/** Conversations survive switching tabs/papers within a session. */
const conversations = new Map<string, Message[]>();

export interface QuickAction { label: string; prompt: string; mode?: AssistantMode }

export interface PendingQuestion { id: number; text: string; mode: AssistantMode; selection?: string }

interface Props {
  /** Identifies the conversation, e.g. `paper:<id>` or `project:<id>`. */
  scope: string;
  paperId?: string;
  citekey?: string;
  projectId?: string;
  /** Number of paragraphs of the paper, used to verify [P12] citations. */
  paragraphCount?: number;
  actions: QuickAction[];
  pending?: PendingQuestion;
  onJump?(order: number): void;
  onInsert?(markdown: string): void;
  placeholder?: string;
}

export function AssistantPanel({ scope, paperId, citekey, projectId, paragraphCount = 0, actions, pending, onJump, onInsert, placeholder }: Props) {
  const { ai, openSettings } = useWorkspace();
  const [messages, setMessages] = useState<Message[]>(() => conversations.get(scope) ?? []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const cancel = useRef<(() => void) | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);
  const handled = useRef<number | undefined>(undefined);

  useEffect(() => { setMessages(conversations.get(scope) ?? []); setBusy(false); }, [scope]);
  useEffect(() => { conversations.set(scope, messages); }, [scope, messages]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const ask = async (text: string, mode: AssistantMode = 'chat', selection?: string, history = messages) => {
    if (!text.trim() || busy) return;
    const next: Message[] = [...history, { role: 'user', content: text, mode }];
    setMessages([...next, { role: 'assistant', content: '', mode }]);
    setBusy(true);
    let answer = '';
    const request = window.allPaper.ai.ask(
      { mode, paperId, projectId, selection, messages: next.map(({ role, content }) => ({ role, content })) },
      (delta) => { answer += delta; setMessages([...next, { role: 'assistant', content: answer, mode }]); }
    );
    cancel.current = request.cancel;
    try {
      const final = await request.promise;
      setMessages([...next, { role: 'assistant', content: final || answer, mode }]);
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error);
      setMessages([...next, { role: 'assistant', content: answer ? `${answer}\n\n（${message}）` : message, error: true, mode }]);
    } finally {
      setBusy(false);
      cancel.current = undefined;
    }
  };

  useEffect(() => {
    if (pending && handled.current !== pending.id) {
      handled.current = pending.id;
      void ask(pending.text, pending.mode, pending.selection);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id]);

  const retry = () => {
    const lastUser = [...messages].reverse().findIndex((m) => m.role === 'user');
    if (lastUser < 0) return;
    const index = messages.length - 1 - lastUser;
    void ask(messages[index].content, messages[index].mode ?? 'chat', undefined, messages.slice(0, index));
  };

  if (!ai.configured) {
    return (
      <div className="ai-unset">
        <Sparkles size={26} />
        <h3>尚未配置模型服务</h3>
        <p>论文问答、划词解释、翻译都需要你自己的模型 API Key。没有它，阅读、批注和笔记仍可正常使用。</p>
        <button className="primary" onClick={openSettings}>前往设置</button>
      </div>
    );
  }

  return (
    <div className="assistant">
      <div className="assistant-log">
        {!messages.length && (
          <div className="assistant-hint">
            <p>{placeholder ?? '针对这篇论文提问，回答里的 [¶n] 会定位到原文段落。'}</p>
            <div className="assistant-actions">
              {actions.map((action) => <button key={action.label} className="secondary" disabled={busy} onClick={() => void ask(action.prompt, action.mode)}>{action.label}</button>)}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <article key={index} className={`msg msg-${message.role}${message.error ? ' msg-error' : ''}`}>
            {message.role === 'user'
              ? <p>{message.content}</p>
              : <>
                <AnswerText text={message.content} count={paragraphCount} onJump={onJump} streaming={busy && index === messages.length - 1} />
                {!!message.content && !message.error && !(busy && index === messages.length - 1) && (
                  <MessageActions
                    text={message.content}
                    onInsert={onInsert ? () => onInsert(answerToNoteMarkdown(message.content, citekey, paragraphCount)) : undefined}
                  />
                )}
                {message.error && index === messages.length - 1 && <button className="text-button" onClick={retry}><RotateCw size={12} /> 重试</button>}
              </>}
          </article>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="assistant-input"
        onSubmit={(event) => { event.preventDefault(); const text = input; setInput(''); void ask(text); }}
      >
        <textarea
          value={input} rows={2} placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); const text = input; setInput(''); void ask(text); } }}
        />
        {busy
          ? <button type="button" className="icon-button" title="停止" onClick={() => cancel.current?.()}><Square size={15} /></button>
          : <button type="submit" className="icon-button" title="发送" disabled={!input.trim()}><Send size={15} /></button>}
      </form>
      {!!messages.length && !!actions.length && !busy && (
        <div className="assistant-actions compact">{actions.map((a) => <button key={a.label} className="chip" onClick={() => void ask(a.prompt, a.mode)}>{a.label}</button>)}</div>
      )}
    </div>
  );
}

function MessageActions({ text, onInsert }: { text: string; onInsert?: () => void }) {
  const [done, setDone] = useState<'copy' | 'insert'>();
  const flash = (kind: 'copy' | 'insert') => { setDone(kind); window.setTimeout(() => setDone(undefined), 1400); };
  return (
    <div className="msg-actions">
      {onInsert && <button onClick={() => { onInsert(); flash('insert'); }}>{done === 'insert' ? <Check size={12} /> : <NotebookPen size={12} />} 插入笔记</button>}
      <button onClick={() => { void navigator.clipboard.writeText(text); flash('copy'); }}>{done === 'copy' ? <Check size={12} /> : <Copy size={12} />} 复制</button>
    </div>
  );
}

function Inline({ text, count, onJump }: { text: string; count: number; onJump?(order: number): void }) {
  return (
    <>
      {segmentAnswer(text, count).map((segment, index) => {
        if (segment.kind === 'ref') return <button key={index} className="ref-chip" title={`跳到原文第 ${segment.order} 段`} onClick={() => onJump?.(segment.order!)}>¶{segment.order}</button>;
        if (segment.kind === 'unverified') return <span key={index} className="ref-bad" title="该出处不存在于论文中">未核实</span>;
        return <Fragment key={index}>{emphasis(segment.text)}</Fragment>;
      })}
    </>
  );
}

function emphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function AnswerText({ text, count, onJump, streaming }: { text: string; count: number; onJump?(order: number): void; streaming: boolean }) {
  if (!text) return <p className="msg-wait">{streaming ? '思考中…' : ''}</p>;
  const blocks: ReactElement[] = [];
  const lines = text.split('\n');
  let list: { ordered: boolean; items: string[] } | undefined;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(<Tag key={`l${blocks.length}`}>{list.items.map((item, i) => <li key={i}><Inline text={item} count={count} onJump={onJump} /></li>)}</Tag>);
    list = undefined;
  };
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
    const heading = line.match(/^#{1,4}\s+(.*)/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (heading) blocks.push(<h4 key={`h${blocks.length}`}><Inline text={heading[1]} count={count} onJump={onJump} /></h4>);
    else if (line.trim()) blocks.push(<p key={`p${blocks.length}`}><Inline text={line} count={count} onJump={onJump} /></p>);
  }
  flush();
  return <div className="answer">{blocks}{streaming && <span className="caret" />}</div>;
}
