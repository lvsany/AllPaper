/** One short plain-text line for a note list: markdown syntax and citations stripped. */
export function notePreview(markdown: string, maxChars = 90): string {
  const lines = markdown.split('\n').map((line) => line
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
    .replace(/\[@[^\]]+\]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()).filter(Boolean);
  const text = lines.join(' ');
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/** "刚刚", "5 分钟前", "3 小时前", "昨天", "10-11"… for a last-edited time. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  const d = new Date(then);
  return `${d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()}-`}${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
