"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bot, ChevronDown, Copy, Download, FileJson, GitBranch, Pencil, Plus, RefreshCcw, Sparkles, Trash2, Upload } from "lucide-react";
import { AliPanel } from "@/components/ali/AliPanel";
import { Dashboard } from "@/components/Dashboard";
import { EditorPanel } from "@/components/EditorPanel";
import { analyzeProject } from "@/lib/analyze";
import { createBlankProject, sampleProjects } from "@/lib/sample-data";
import { normalizeProjects } from "@/lib/project-data";
import type { Project } from "@/lib/types";

const STORAGE_KEY = "project-health-agent.projects.v1";

export default function Home() {
  const [projects, setProjects] = useState<Project[]>(sampleProjects);
  const [selectedId, setSelectedId] = useState(sampleProjects[0].id);
  const [editorOpen, setEditorOpen] = useState(false);
  const [aliOpen, setAliOpen] = useState(true);
  const [agentEpoch, setAgentEpoch] = useState(0);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const project = projects.find((item) => item.id === selectedId) ?? projects[0];
  const analysis = useMemo(() => analyzeProject(project), [project]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = normalizeProjects(JSON.parse(saved) as unknown);
        if (parsed.length > 0) {
          // Loading browser persistence is an intentional external-system sync.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setProjects(parsed);
          setSelectedId(parsed[0].id);
        }
      }
    } catch { /* Invalid local data falls back to the sample. */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects, hydrated]);

  const updateProject = (next: Project) => setProjects((items) => items.map((item) => item.id === next.id ? next : item));

  const addProject = () => {
    const next = createBlankProject();
    setProjects((items) => [...items, next]);
    setSelectedId(next.id);
    setEditorOpen(true);
    setProjectMenuOpen(false);
  };

  const duplicateProject = () => {
    const duplicate: Project = JSON.parse(JSON.stringify(project));
    duplicate.id = crypto.randomUUID();
    duplicate.name = `${project.name} copy`;
    duplicate.updatedAt = new Date().toISOString();
    duplicate.tasks = duplicate.tasks.map((task) => ({ ...task, id: crypto.randomUUID() }));
    duplicate.team = duplicate.team.map((member) => ({ ...member, id: crypto.randomUUID() }));
    setProjects((items) => [...items, duplicate]);
    setSelectedId(duplicate.id);
  };

  const deleteProject = () => {
    if (projects.length === 1) return;
    const remaining = projects.filter((item) => item.id !== project.id);
    setProjects(remaining);
    setSelectedId(remaining[0].id);
  };

  const resetDemo = () => {
    const fresh = JSON.parse(JSON.stringify(sampleProjects)) as Project[];
    setProjects(fresh);
    setSelectedId(fresh[0].id);
    localStorage.removeItem("ali.agent.sessions.v2");
    localStorage.removeItem("ali.agent.sessions.v3");
    setAgentEpoch((value) => value + 1);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(projects, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ali-project-health-data.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file?: File) => {
    if (!file) return;
    try {
      const importedAt = new Date().toISOString();
      const parsed = normalizeProjects(JSON.parse(await file.text()) as unknown).map((item) => ({ ...item, updatedAt: importedAt }));
      if (parsed.length === 0) throw new Error("Expected at least one valid project");
      setProjects(parsed);
      setSelectedId(parsed[0].id);
    } catch (error) {
      window.alert(error instanceof Error ? `Import failed: ${error.message}` : "Import failed");
    }
  };

  return (
    <main className={`app-shell ${editorOpen ? "with-editor" : ""} ${aliOpen ? "with-ali" : ""}`}>
      <header className="topbar">
        <div className="brand"><span><Sparkles size={22} /></span><div><h1>Ali</h1><p>Agentic project health workspace</p></div></div>
        <div className="project-switcher">
          <button onClick={() => setProjectMenuOpen((value) => !value)}><span><small>Current project</small><strong>{project.name}</strong></span><ChevronDown size={17} /></button>
          {projectMenuOpen && <div className="project-menu">
            {projects.map((item) => <button key={item.id} onClick={() => { setSelectedId(item.id); setProjectMenuOpen(false); }} className={item.id === project.id ? "selected" : ""}><span><strong>{item.name}</strong><small>{item.client}</small></span><em>{analyzeProject(item).score}</em></button>)}
            <button className="new-project" onClick={addProject}><Plus size={15} /> New project</button>
          </div>}
        </div>
        <div className="top-actions">
          <button className="secondary-button" onClick={() => setEditorOpen((value) => !value)}><Pencil size={15} /> {editorOpen ? "Close editor" : "Edit data"}</button>
          <button className="primary-button" onClick={() => setAliOpen((value) => !value)}><Bot size={16} />{aliOpen ? "Close Ali" : "Ask Ali"}</button>
        </div>
      </header>

      <div className="utilitybar">
        <div><span className={`live-dot ${hydrated ? "" : "loading"}`} /> Live analysis <small>Every edit recalculates the result</small></div>
        <div className="utility-actions">
          <button onClick={duplicateProject}><Copy size={14} /> Duplicate</button>
          <button onClick={exportData}><Download size={14} /> Export JSON</button>
          <button onClick={() => importRef.current?.click()}><Upload size={14} /> Import</button>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={(event) => void importData(event.target.files?.[0])} />
          <button onClick={resetDemo}><RefreshCcw size={14} /> Reset demo</button>
          <button className="danger-action" onClick={deleteProject} disabled={projects.length === 1}><Trash2 size={14} /> Delete</button>
        </div>
      </div>

      <div className="workspace">
        {editorOpen && <EditorPanel project={project} onChange={updateProject} onClose={() => setEditorOpen(false)} />}
        <Dashboard project={project} analysis={analysis} />
        <AliPanel key={`${project.id}:${agentEpoch}`} project={project} open={aliOpen} onToggle={() => setAliOpen((value) => !value)} onProjectChange={updateProject} />
      </div>

      <footer><div><Activity size={14} /> Dashboard and Ali use the current editable project data</div><div><FileJson size={14} /> Local persistence enabled <span>·</span> <GitBranch size={14} /> Approval-gated actions</div></footer>
    </main>
  );
}
