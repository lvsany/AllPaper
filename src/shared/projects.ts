import type { DraftBlock } from '../core/draft';
export interface Project {id:string;name:string;createdAt:string;constraints:{budget:number;models:string;timeBudget:string};}
export interface Idea {id:string;title:string;oneLiner:string;motivation:string;hypothesis:string;approach:string;contribution:string;status:'idea'|'researching'|'pilot'|'validated'|'abandoned';relatedPapers:string[];abandonReason?:string;}
export interface Pilot {id:string;ideaId:string;experimentType:string;sections:Record<string,string>;updatedAt:string;}
export interface DraftDocument {id:string;blocks:DraftBlock[];storyline:Record<string,string>;outline:Array<{id:string;title:string;points:string[]}>;}
