export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: '结论' },
  { id: 'red', label: '质疑' },
  { id: 'green', label: '可借鉴' },
  { id: 'blue', label: '方法' }
] as const;

export const colorLabel = (id: string) => HIGHLIGHT_COLORS.find((c) => c.id === id)?.label ?? id;
