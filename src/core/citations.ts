export interface Citation { key:string; page?:string; anchor?:string; raw:string; }
export function parseCitations(markdown:string):Citation[]{return [...markdown.matchAll(/\[@([^\]#,\s]+)(?:#([^\],\s]+))?(?:,\s*p\.\s*([^\]]+))?\]/g)].map(m=>({key:m[1],anchor:m[2],page:m[3],raw:m[0]}));}
export function validateCitations(markdown:string,keys:Iterable<string>):{valid:Citation[];invalid:Citation[]}{const set=new Set(keys);const all=parseCitations(markdown);return {valid:all.filter(x=>set.has(x.key)),invalid:all.filter(x=>!set.has(x.key))};}
