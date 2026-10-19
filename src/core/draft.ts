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
