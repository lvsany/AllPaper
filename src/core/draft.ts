export type BlockType='heading'|'paragraph'|'list'|'formula'|'figure'|'table'|'code';export type BlockStatus='synced'|'translating'|'locked'|'changed'|'failed'|'pending';
export interface DraftBlock{id:string;order:number;type:BlockType;zhText:string;enText:string;zhHash:string;enSourceHash?:string;locked:boolean;status:BlockStatus;/** Heading depth 1-3; only for type 'heading'. */level?:1|2|3;}
export const hash=(s:string)=>{let h=5381;for(let i=0;i<s.length;i++)h=(h*33)^s.charCodeAt(i);return (h>>>0).toString(36)};
export function updateChinese(block:DraftBlock,text:string):DraftBlock{const zhHash=hash(text);if(block.locked)return {...block,zhText:text,zhHash,status:'changed'};return {...block,zhText:text,zhHash,status:text.trim()?'pending':'synced'};}
export function beginTranslation(block:DraftBlock):DraftBlock{return block.locked?block:{...block,status:'translating'};}
export function receiveTranslation(block:DraftBlock,english:string):DraftBlock{return block.locked?block:{...block,enText:english,enSourceHash:block.zhHash,status:'synced'};}
export function editEnglish(block:DraftBlock,english:string):DraftBlock{return {...block,enText:english,locked:true,status:'locked'};}
export function unlock(block:DraftBlock):DraftBlock{return {...block,locked:false,status:block.zhText? 'pending':'synced'};}
export function blocksNeedingTranslation(blocks:DraftBlock[]):DraftBlock[]{return blocks.filter(x=>!x.locked&&x.zhText.trim()&&x.status==='pending');}
export function failTranslation(block:DraftBlock):DraftBlock{return block.locked?block:{...block,status:'failed'};}

/** Typing `# `, `## ` or `### ` at the start of a paragraph turns it into a heading. */
export function applyMarkdownShortcut(block:DraftBlock):DraftBlock{if(block.type!=='paragraph')return block;const m=block.zhText.match(/^(#{1,3})\s/);if(!m)return block;return updateChinese({...block,type:'heading',level:m[1].length as 1|2|3},block.zhText.slice(m[0].length));}

const CJK=/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;
const ENDS_SENTENCE=/[。！？；：…!?;:”"'’）)】\]]$|\.$/;
const STARTS_BLOCK=/^(#{1,6}\s|[-*+•]\s|\d+[.)、]\s?|[（(]?[一二三四五六七八九十]+[）)、.])/;
const glue=(a:string,b:string)=>CJK.test(a.at(-1)!)||CJK.test(b[0])?'':' ';
/**
 * Pasted text -> paragraphs. Blank lines always separate paragraphs. A single line break also does when the
 * line before ends a sentence, is clearly short (a heading), or the next line starts a list item or heading;
 * otherwise it is a hard wrap (text copied from a PDF) and the lines are joined.
 */
export function splitPastedText(text:string):string[]{const normalized=text.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();if(!normalized)return [];const paragraphs:string[]=[];for(const group of normalized.split(/\n[ \t]*\n+/)){const lines=group.split('\n').map(l=>l.trim()).filter(Boolean);const width=Math.max(...lines.map(l=>l.length));let current='';for(const line of lines){if(!current){current=line;continue;}const wrapped=width>=20&&current.length>=width*0.6&&!ENDS_SENTENCE.test(current)&&!STARTS_BLOCK.test(line);if(wrapped)current+=glue(current,line)+line;else{paragraphs.push(current);current=line;}}if(current)paragraphs.push(current);}return paragraphs;}

/**
 * Blocks whose Chinese has no usable English yet: pending or failed, and also "synced" blocks whose English is
 * empty (earlier versions accepted an empty reply from the model as a translation).
 */
export function needsTranslation(block:DraftBlock):boolean{return !block.locked&&Boolean(block.zhText.trim())&&(block.status==='pending'||block.status==='failed'||(block.status==='synced'&&!block.enText.trim()));}
/** Marks blocks that were saved as translated but have no English as waiting, so they show up and can be translated. */
export function repairEmptyTranslations(blocks:DraftBlock[]):DraftBlock[]{return blocks.map(b=>b.status==='synced'&&needsTranslation(b)?{...b,status:'pending'}:b);}
