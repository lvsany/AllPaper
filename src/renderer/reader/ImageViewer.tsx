import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, X } from 'lucide-react';

export interface ViewerImage { src: string; alt: string; caption?: string }

const MIN = 0.2;
const MAX = 8;

/** Full-window image viewer: wheel or +/- to zoom (around the cursor), drag to pan, ←/→ between figures, Esc to close. */
export function ImageViewer({ images, start, onClose }: { images: ViewerImage[]; start: number; onClose(): void }) {
  const [index, setIndex] = useState(start);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | undefined>(undefined);
  const image = images[index];

  const reset = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);
  const go = useCallback((delta: number) => { setIndex((i) => (i + delta + images.length) % images.length); reset(); }, [images.length, reset]);

  /** Zooms keeping the image point under (cx, cy) — relative to the stage centre — in place. */
  const zoomAt = useCallback((factor: number, cx = 0, cy = 0) => {
    setScale((current) => {
      const next = Math.min(MAX, Math.max(MIN, current * factor));
      setOffset((o) => ({ x: cx - ((cx - o.x) * next) / current, y: cy - ((cy - o.y) * next) / current }));
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft' && images.length > 1) go(-1);
      else if (event.key === 'ArrowRight' && images.length > 1) go(1);
      else if (event.key === '+' || event.key === '=') zoomAt(1.25);
      else if (event.key === '-') zoomAt(0.8);
      else if (event.key === '0') reset();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, images.length, onClose, reset, zoomAt]);

  const centreOf = (event: { clientX: number; clientY: number }) => {
    const box = stage.current!.getBoundingClientRect();
    return { cx: event.clientX - box.left - box.width / 2, cy: event.clientY - box.top - box.height / 2 };
  };

  return (
    <div className="viewer" role="dialog" aria-label="查看图片">
      <div className="viewer-bar">
        <span className="viewer-count">{images.length > 1 ? `${index + 1} / ${images.length}` : ''}</span>
        <button title="缩小（-）" onClick={() => zoomAt(0.8)}><Minus size={16} /></button>
        <button className="viewer-zoom" title="恢复适合窗口（0）" onClick={reset}>{Math.round(scale * 100)}%</button>
        <button title="放大（+）" onClick={() => zoomAt(1.25)}><Plus size={16} /></button>
        <button title="原始尺寸" onClick={() => {
          const img = stage.current?.querySelector('img');
          if (img && img.naturalWidth) { setOffset({ x: 0, y: 0 }); setScale(Math.min(MAX, img.naturalWidth / img.getBoundingClientRect().width * scale)); }
        }}><Maximize2 size={15} /></button>
        <button title="关闭（Esc）" onClick={onClose}><X size={18} /></button>
      </div>
      <div
        ref={stage} className={`viewer-stage${scale > 1 ? ' pannable' : ''}`}
        onWheel={(event) => { const { cx, cy } = centreOf(event); zoomAt(Math.exp(-event.deltaY * 0.0015), cx, cy); }}
        onMouseDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y, moved: false }; }}
        onMouseMove={(event) => {
          const d = drag.current;
          if (!d) return;
          if (Math.abs(event.clientX - d.x) + Math.abs(event.clientY - d.y) > 3) d.moved = true;
          setOffset({ x: d.ox + event.clientX - d.x, y: d.oy + event.clientY - d.y });
        }}
        onMouseUp={(event) => {
          const d = drag.current;
          drag.current = undefined;
          if (d && !d.moved && event.target === stage.current) onClose(); // click on the dark backdrop
        }}
        onMouseLeave={() => { drag.current = undefined; }}
        onDoubleClick={(event) => { if (scale > 1.05) reset(); else { const { cx, cy } = centreOf(event); zoomAt(2.5, cx, cy); } }}
      >
        <img
          src={image.src} alt={image.alt} draggable={false}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        />
      </div>
      {images.length > 1 && <>
        <button className="viewer-nav prev" title="上一张（←）" onClick={() => go(-1)}><ChevronLeft size={26} /></button>
        <button className="viewer-nav next" title="下一张（→）" onClick={() => go(1)}><ChevronRight size={26} /></button>
      </>}
      {image.caption && <div className="viewer-caption">{image.caption}</div>}
    </div>
  );
}
