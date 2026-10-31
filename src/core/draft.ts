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

/** Joins `block` onto the end of `previous` (Backspace at the start of a block). Returns the merged block and the caret position. */
export function mergeBlocks(previous:DraftBlock,block:DraftBlock):{block:DraftBlock;caret:number}{const joined=previous.zhText+block.zhText;return {block:updateChinese(previous,joined),caret:previous.zhText.length};}
/** Splits a block at `caret` (Enter in the middle of a block). */
export function splitBlock(block:DraftBlock,caret:number,newId:string):[DraftBlock,DraftBlock]{const before=block.zhText.slice(0,caret);const after=block.zhText.slice(caret);const first=updateChinese(block,before);const second:DraftBlock={id:newId,order:block.order+1,type:block.type==='heading'?'paragraph':block.type,zhText:'',enText:'',zhHash:hash(''),locked:false,status:'synced'};return [first,updateChinese(second,after)];}
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
 * Pastes several paragraphs into `block` at the selection: the text before the selection keeps the first
 * paragraph, each further paragraph becomes its own block, and the text after the selection follows the last one.
 * Returns undefined for a single paragraph so the normal paste happens.
 */
export function pasteParagraphs(block:DraftBlock,start:number,end:number,paragraphs:string[],makeId:()=>string):{blocks:DraftBlock[];caret:number}|undefined{if(paragraphs.length<2)return undefined;const before=block.zhText.slice(0,start);const after=block.zhText.slice(end);const fresh=(text:string):DraftBlock=>applyMarkdownShortcut(updateChinese({id:makeId(),order:block.order,type:'paragraph',zhText:'',enText:'',zhHash:hash(''),locked:false,status:'synced'},text));const first=applyMarkdownShortcut(updateChinese(block,before+paragraphs[0]));const middle=paragraphs.slice(1,-1).map(fresh);const lastText=paragraphs[paragraphs.length-1];const last=fresh(lastText+after);const caret=last.zhText.length-after.length;return {blocks:[first,...middle,last],caret};}
