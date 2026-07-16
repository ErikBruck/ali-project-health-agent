"use client";

import { Plus, Trash2, X } from "lucide-react";
import type { Project, ProjectTask, TeamMember } from "@/lib/types";

type Props = {
  project: Project;
  onChange: (project: Project) => void;
  onClose: () => void;
};

const numberValue = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;
const nonNegative = (value: string) => Math.max(0, numberValue(value));
const allocationValue = (value: string) => Math.min(200, nonNegative(value));

export function EditorPanel({ project, onChange, onClose }: Props) {
  const patchProject = (patch: Partial<Project>) => onChange({ ...project, ...patch, updatedAt: new Date().toISOString() });
  const patchTask = (id: string, patch: Partial<ProjectTask>) =>
    patchProject({ tasks: project.tasks.map((task) => task.id === id ? { ...task, ...patch } : task) });
  const patchMember = (id: string, patch: Partial<TeamMember>) =>
    patchProject({ team: project.team.map((member) => member.id === id ? { ...member, ...patch } : member) });

  const addTask = () => patchProject({
    tasks: [...project.tasks, {
      id: crypto.randomUUID(),
      title: "New task",
      owner: "",
      status: "not-started",
      dueDate: project.deadline,
      estimatedHours: 8,
      loggedHours: 0,
      critical: false,
      blocker: ""
    }]
  });

  const addMember = () => patchProject({
    team: [...project.team, { id: crypto.randomUUID(), name: "New team member", role: "Role", allocation: 80 }]
  });

  return (
    <aside className="editor-panel" aria-label="Project data editor">
      <div className="editor-head">
        <div><span>Live data editor</span><h2>Edit project inputs</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close editor"><X size={18} /></button>
      </div>

      <div className="editor-scroll">
        <section className="form-section">
          <div className="form-title"><strong>Project</strong><span>Changes save automatically</span></div>
          <div className="form-grid two">
            <label><span>Name</span><input value={project.name} onChange={(event) => patchProject({ name: event.target.value })} /></label>
            <label><span>Client</span><input value={project.client} onChange={(event) => patchProject({ client: event.target.value })} /></label>
            <label><span>Owner</span><input value={project.owner} onChange={(event) => patchProject({ owner: event.target.value })} /></label>
            <label><span>Currency</span><select value={project.currency} onChange={(event) => patchProject({ currency: event.target.value as Project["currency"] })}><option>EUR</option><option>USD</option><option>GBP</option></select></label>
            <label><span>Start date</span><input type="date" value={project.startDate} onChange={(event) => patchProject({ startDate: event.target.value })} /></label>
            <label><span>Deadline</span><input type="date" value={project.deadline} onChange={(event) => patchProject({ deadline: event.target.value })} /></label>
          </div>
        </section>

        <section className="form-section">
          <div className="form-title"><strong>Financials & progress</strong><span>Try changing spent or progress</span></div>
          <div className="form-grid two">
            <label><span>Budget</span><input type="number" min="0" value={project.budget} onChange={(event) => patchProject({ budget: nonNegative(event.target.value) })} /></label>
            <label><span>Spent</span><input type="number" min="0" value={project.spent} onChange={(event) => patchProject({ spent: nonNegative(event.target.value) })} /></label>
          </div>
          <label className="range-label"><span><b>Actual progress</b><strong>{project.progress}%</strong></span><input type="range" min="0" max="100" value={project.progress} onChange={(event) => patchProject({ progress: numberValue(event.target.value) })} /></label>
          <label className="range-label"><span><b>Planned progress</b><strong>{project.plannedProgress}%</strong></span><input type="range" min="0" max="100" value={project.plannedProgress} onChange={(event) => patchProject({ plannedProgress: numberValue(event.target.value) })} /></label>
          <label className="range-label"><span><b>Quality confidence</b><strong>{project.qualityScore}/100</strong></span><input type="range" min="0" max="100" value={project.qualityScore} onChange={(event) => patchProject({ qualityScore: numberValue(event.target.value) })} /></label>
        </section>

        <section className="form-section">
          <div className="form-title"><strong>Tasks</strong><button onClick={addTask}><Plus size={14} /> Add task</button></div>
          <div className="editor-list">
            {project.tasks.length === 0 && <p className="empty-editor">No tasks yet. Add one to test schedule and blocker risks.</p>}
            {project.tasks.map((task, index) => (
              <article className="edit-card" key={task.id}>
                <div className="edit-card-head"><strong>Task {index + 1}</strong><button onClick={() => patchProject({ tasks: project.tasks.filter((item) => item.id !== task.id) })} aria-label={`Delete ${task.title}`}><Trash2 size={14} /></button></div>
                <label><span>Task title</span><input value={task.title} onChange={(event) => patchTask(task.id, { title: event.target.value })} /></label>
                <div className="form-grid two compact">
                  <label><span>Owner</span><input value={task.owner} onChange={(event) => patchTask(task.id, { owner: event.target.value })} /></label>
                  <label><span>Status</span><select value={task.status} onChange={(event) => patchTask(task.id, { status: event.target.value as ProjectTask["status"] })}><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="blocked">Blocked</option><option value="deferred">Deferred</option><option value="done">Done</option></select></label>
                  <label><span>Due date</span><input type="date" value={task.dueDate} onChange={(event) => patchTask(task.id, { dueDate: event.target.value })} /></label>
                  <label className="checkbox-label"><input type="checkbox" checked={task.critical} onChange={(event) => patchTask(task.id, { critical: event.target.checked })} /><span>Critical path</span></label>
                  <label><span>Estimated hours</span><input type="number" min="0" value={task.estimatedHours} onChange={(event) => patchTask(task.id, { estimatedHours: nonNegative(event.target.value) })} /></label>
                  <label><span>Logged hours</span><input type="number" min="0" value={task.loggedHours} onChange={(event) => patchTask(task.id, { loggedHours: nonNegative(event.target.value) })} /></label>
                </div>
                {task.status === "blocked" && <label><span>Blocker reason</span><input value={task.blocker} onChange={(event) => patchTask(task.id, { blocker: event.target.value })} placeholder="What is preventing progress?" /></label>}
              </article>
            ))}
          </div>
        </section>

        <section className="form-section">
          <div className="form-title"><strong>Team capacity</strong><button onClick={addMember}><Plus size={14} /> Add person</button></div>
          <div className="editor-list">
            {project.team.length === 0 && <p className="empty-editor">No team members yet. Add one to test capacity risks.</p>}
            {project.team.map((member) => (
              <article className="edit-card member-card" key={member.id}>
                <div className="member-fields">
                  <label><span>Name</span><input value={member.name} onChange={(event) => patchMember(member.id, { name: event.target.value })} /></label>
                  <label><span>Role</span><input value={member.role} onChange={(event) => patchMember(member.id, { role: event.target.value })} /></label>
                  <label><span>Allocation</span><input type="number" min="0" max="200" value={member.allocation} onChange={(event) => patchMember(member.id, { allocation: allocationValue(event.target.value) })} /></label>
                  <button onClick={() => patchProject({ team: project.team.filter((item) => item.id !== member.id) })} aria-label={`Delete ${member.name}`}><Trash2 size={14} /></button>
                </div>
                <div className="allocation-track"><span style={{ width: `${Math.min(100, member.allocation)}%` }} className={member.allocation > 100 ? "over" : ""} /></div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
