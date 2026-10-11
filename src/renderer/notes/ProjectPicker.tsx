import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useWorkspace } from '../workspace';

/** Project selector with inline creation; the note of the selected project is "the note". */
export function ProjectPicker({ compact = false }: { compact?: boolean }) {
  const { projects, currentProject, selectProject, createProject } = useWorkspace();
  const [creating, setCreating] = useState(!projects.length);
  const [name, setName] = useState('');

  const create = async () => {
    if (!name.trim()) return;
    await createProject(name.trim());
    setName('');
    setCreating(false);
  };

  if (creating || !projects.length) {
    return (
      <div className={`project-picker${compact ? ' compact' : ''}`}>
        <input autoFocus value={name} placeholder={projects.length ? '新项目名称' : '给你的研究项目起个名字，例如：群智软件工程'} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setCreating(false); }} />
        <button className="primary" disabled={!name.trim()} onClick={() => void create()}>创建</button>
        {!!projects.length && <button className="text-button" onClick={() => setCreating(false)}>取消</button>}
      </div>
    );
  }
  return (
    <div className={`project-picker${compact ? ' compact' : ''}`}>
      <select value={currentProject?.id} onChange={(e) => selectProject(e.target.value)}>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <button className="icon-button" title="新建项目" onClick={() => setCreating(true)}><Plus size={15} /></button>
    </div>
  );
}
