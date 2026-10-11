import type { Paragraph } from '../shared/types';
export type RawContentSource = 'arxiv-html' | 'ar5iv' | 'pdf';
const allowed = new Set(['h1','h2','h3','h4','p','li','pre','code','math','figure','figcaption','table','caption','aside','ol','ul']);
function strip(value:string){return value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function esc(value:string){return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
export function normalizeHtmlContent(html:string,paperId:string,source:Exclude<RawContentSource,'pdf'>):{source:RawContentSource;paragraphs:Paragraph[]}{
  const paragraphs:Paragraph[]=[]; const re=/<(h[1-4]|p|li|pre|figure|figcaption|table|caption|aside)[^>]*>([\s\S]*?)<\/\1>/gi; let m:RegExpExecArray|null; let section:string[]=[];
  while((m=re.exec(html))){const tag=m[1].toLowerCase();if(!allowed.has(tag))continue;const text=strip(m[2]);if(!text)continue;let type:Paragraph['type']='paragraph';if(/^h/.test(tag)){type='heading';const level=Number(tag[1]);section=section.slice(0,level-1);section[level-1]=text;section=section.slice(0,level);}else if(tag==='li')type='list';else if(tag==='pre')type='code';else if(tag==='figure')type='figure';else if(tag==='table')type='table';else if(tag==='figcaption'||tag==='caption')type='caption';else if(tag==='aside')type='footnote';paragraphs.push({id:`${paperId}-p${paragraphs.length}`,paperId,order:paragraphs.length,type,html:esc(text),text,sectionPath:[...section]});}
  return {source,paragraphs};
}
export function normalizePdfText(pages:string[],paperId:string):{source:'pdf';paragraphs:Paragraph[]}{const paragraphs:Paragraph[]=[];for(let page=0;page<pages.length;page++){for(const text of pages[page].split(/\n{2,}|(?<=[.!?。])\s+(?=[A-Z])/).map(x=>x.replace(/\s+/g,' ').trim()).filter(x=>x.length>8)){const type:Paragraph['type']=/^\d+(\.\d+)*\s+[A-Z]/.test(text)?'heading':'paragraph';paragraphs.push({id:`${paperId}-p${paragraphs.length}`,paperId,order:paragraphs.length,type,html:esc(text),text,sectionPath:[],page:page+1});}}return {source:'pdf',paragraphs};}
export function chooseContentSource(available:Partial<Record<RawContentSource,string>>):RawContentSource|undefined{return available['arxiv-html']?'arxiv-html':available.ar5iv?'ar5iv':available.pdf?'pdf':undefined;}
