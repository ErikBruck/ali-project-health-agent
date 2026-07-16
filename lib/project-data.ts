import type { Project, ProjectTask, TaskStatus, TeamMember } from "./types";

const statuses = new Set<TaskStatus>(["not-started", "in-progress", "blocked", "deferred", "done"]);
const currencies = new Set<Project["currency"]>(["EUR", "USD", "GBP"]);
const object = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const identifier = (value: unknown) => text(value).trim() || crypto.randomUUID();

function task(value: unknown): ProjectTask | null {
  const item = object(value); if (!item) return null;
  const status = statuses.has(item.status as TaskStatus) ? item.status as TaskStatus : "not-started";
  return { id: identifier(item.id), title: text(item.title, "Untitled task"), owner: text(item.owner), status, dueDate: text(item.dueDate), estimatedHours: number(item.estimatedHours), loggedHours: number(item.loggedHours), critical: item.critical === true, blocker: text(item.blocker) };
}

function member(value: unknown): TeamMember | null {
  const item = object(value); if (!item) return null;
  return { id: identifier(item.id), name: text(item.name, "Unnamed team member"), role: text(item.role, "Role not set"), allocation: number(item.allocation, 0, 0, 200) };
}

export function normalizeProject(value: unknown): Project | null {
  const item = object(value); if (!item || typeof item.id !== "string" || typeof item.name !== "string") return null;
  const currency = currencies.has(item.currency as Project["currency"]) ? item.currency as Project["currency"] : "EUR";
  const seenTasks = new Set<string>();
  const seenMembers = new Set<string>();
  const tasks = (Array.isArray(item.tasks) ? item.tasks.map(task).filter((entry): entry is ProjectTask => entry !== null) : []).map((entry) => { if (!seenTasks.has(entry.id)) { seenTasks.add(entry.id); return entry; } const next = { ...entry, id: crypto.randomUUID() }; seenTasks.add(next.id); return next; });
  const team = (Array.isArray(item.team) ? item.team.map(member).filter((entry): entry is TeamMember => entry !== null) : []).map((entry) => { if (!seenMembers.has(entry.id)) { seenMembers.add(entry.id); return entry; } const next = { ...entry, id: crypto.randomUUID() }; seenMembers.add(next.id); return next; });
  return {
    id: identifier(item.id), name: text(item.name, "Untitled project"), client: text(item.client), owner: text(item.owner), currency,
    startDate: text(item.startDate), deadline: text(item.deadline), budget: number(item.budget), spent: number(item.spent), progress: number(item.progress, 0, 0, 100), plannedProgress: number(item.plannedProgress, 0, 0, 100), qualityScore: number(item.qualityScore, 0, 0, 100),
    tasks,
    team,
    updatedAt: text(item.updatedAt, new Date().toISOString())
  };
}

export function normalizeProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map(normalizeProject).filter((project): project is Project => project !== null).map((project) => {
    if (!seen.has(project.id)) { seen.add(project.id); return project; }
    const next = { ...project, id: crypto.randomUUID() }; seen.add(next.id); return next;
  });
}
