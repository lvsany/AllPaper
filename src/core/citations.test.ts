import {expect,it} from 'vitest';import {parseCitations,validateCitations} from './citations';
it('parses paper page and anchor citations',()=>{expect(parseCitations('[@wang2025, p.5] [@li2024#p2]')).toEqual([{key:'wang2025',page:'5',raw:'[@wang2025, p.5]'},{key:'li2024',anchor:'p2',raw:'[@li2024#p2]'}]);expect(validateCitations('[@known] [@unknown]',['known']).invalid).toHaveLength(1);});
