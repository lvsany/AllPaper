export type BlockType='heading'|'paragraph'|'list'|'formula'|'figure'|'table'|'code';export type BlockStatus='synced'|'translating'|'locked'|'changed'|'failed'|'pending';
export interface DraftBlock{id:string;order:number;type:BlockType;zhText:string;enText:string;zhHash:string;enSourceHash?:string;locked:boolean;status:BlockStatus;}
export const hash=(s:string)=>{let h=5381;for(let i=0;i<s.length;i++)h=(h*33)^s.charCodeAt(i);return (h>>>0).toString(36)};
export function updateChinese(block:DraftBlock,text:string):DraftBlock{const zhHash=hash(text);if(block.locked)return {...block,zhText:text,zhHash,status:'changed'};return {...block,zhText:text,zhHash,status:text.trim()?'pending':'synced'};}
export function beginTranslation(block:DraftBlock):DraftBlock{return block.locked?block:{...block,status:'translating'};}
export function receiveTranslation(block:DraftBlock,english:string):DraftBlock{return block.locked?block:{...block,enText:english,enSourceHash:block.zhHash,status:'synced'};}
export function editEnglish(block:DraftBlock,english:string):DraftBlock{return {...block,enText:english,locked:true,status:'locked'};}
export function unlock(block:DraftBlock):DraftBlock{return {...block,locked:false,status:block.zhText? 'pending':'synced'};}
export function blocksNeedingTranslation(blocks:DraftBlock[]):DraftBlock[]{return blocks.filter(x=>!x.locked&&x.zhText.trim()&&x.status==='pending');}
