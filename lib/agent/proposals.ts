import { analyzeProject } from "@/lib/analyze";
import type { Project, ProjectTask, TaskStatus } from "@/lib/types";
import type { AgentEvidence, AgentProposal, HealthComparison, ProposalChange, ProposalSimulation, ProposalValue, UndoEntry } from "./types";

const projectFields = new Set(["name", "client", "owner", "startDate", "deadline", "budget", "spent", "progress", "plannedProgress", "qualityScore"]);
const taskFields = new Set(["status", "dueDate", "owner", "critical", "blocker", "estimatedHours"]);
const taskStatuses = new Set<TaskStatus>(["not-started", "in-progress", "blocked", "deferred", "done"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const scorableFields = new Set(["budget", "spent", "progress", "plannedProgress", "qualityScore", "status", "dueDate", "estimatedHours", "allocation", "__delete__"]);

const transitions: Record<TaskStatus, Set<TaskStatus>> = {
  "not-started": new Set(["in-progress", "blocked", "deferred", "done"]),
  "in-progress": new Set(["not-started", "blocked", "deferred", "done"]),
  blocked: new Set(["in-progress", "deferred", "done"]),
  deferred: new Set(["not-started", "in-progress"]),
  done: new Set(["in-progress"])
};

const isDate = (value: ProposalValue): value is string => typeof value === "string" && datePattern.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const isFiniteNumber = (value: ProposalValue): value is number => typeof value === "number" && Number.isFinite(value);
const isTask = (value: ProposalValue): value is ProjectTask => typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value && "title" in value;

export function cloneProject(project: Project): Project {
  return structuredClone(project);
}

export function compareProjectHealth(before: Project, after: Project, now = new Date()): HealthComparison {
  const previous = analyzeProject(before, now);
  const next = analyzeProject(after, now);
  const previousIds = new Set(previous.risks.map((risk) => risk.id));
  const nextIds = new Set(next.risks.map((risk) => risk.id));
  return {
    previousScore: previous.score,
    newScore: next.score,
    scoreDelta: next.score - previous.score,
    risksRemoved: previous.risks.filter((risk) => !nextIds.has(risk.id)).map((risk) => risk.title),
    risksRemaining: next.risks.filter((risk) => previousIds.has(risk.id)).map((risk) => risk.title),
    risksIntroduced: next.risks.filter((risk) => !previousIds.has(risk.id)).map((risk) => risk.title)
  };
}

export function isProposalStale(project: Project, proposal: AgentProposal) {
  return proposal.projectId !== project.id || proposal.projectUpdatedAtAtCreation !== project.updatedAt;
}

function validateTask(project: Project, task: ProjectTask) {
  if (!task.id || !task.title.trim()) return "A created task requires a stable ID and title.";
  if (project.tasks.some((item) => item.id === task.id)) return `Task ${task.id} already exists.`;
  if (!task.owner || !project.team.some((member) => member.name === task.owner)) return "A created task owner must be an existing project team member.";
  if (!isDate(task.dueDate)) return "A created task requires a valid due date.";
  if (!taskStatuses.has(task.status)) return "Created task status is invalid.";
  if (!Number.isFinite(task.estimatedHours) || task.estimatedHours < 0 || !Number.isFinite(task.loggedHours) || task.loggedHours < 0) return "Task hours cannot be negative.";
  return null;
}

function validateChange(project: Project, change: ProposalChange): string | null {
  if (!change.id || !change.entityId || !change.entityName || !change.field || !change.reason || !change.entityType) return "Proposal change is missing required context.";
  if (change.actionType === "task_create") {
    if (change.entityType !== "task" || change.field !== "__create__" || change.oldValue !== null || !isTask(change.newValue)) return "Task creation proposal is malformed.";
    return validateTask(project, change.newValue);
  }
  if (change.actionType === "task_delete") {
    const task = project.tasks.find((item) => item.id === change.entityId);
    if (!task) return `Task ${change.entityId} no longer exists.`;
    if (change.entityType !== "task" || change.field !== "__delete__" || change.newValue !== null) return "Task deletion proposal is malformed.";
    return null;
  }
  if (change.actionType === "task_update") {
    const task = project.tasks.find((item) => item.id === change.entityId);
    if (!task) return `Task ${change.entityId} no longer exists.`;
    if (change.entityType !== "task" || !taskFields.has(change.field)) return `Task field ${change.field} cannot be changed by Ali.`;
    if (change.field === "status") {
      if (typeof change.newValue !== "string" || !taskStatuses.has(change.newValue as TaskStatus)) return "Task status is invalid.";
      const next = change.newValue as TaskStatus;
      if (next !== task.status && !transitions[task.status].has(next)) return `Task status cannot move directly from ${task.status} to ${next}.`;
    }
    if (change.field === "dueDate" && !isDate(change.newValue)) return "Task due date is invalid.";
    if (change.field === "critical" && typeof change.newValue !== "boolean") return "Critical must be true or false.";
    if (change.field === "estimatedHours" && (!isFiniteNumber(change.newValue) || change.newValue < 0)) return "Task estimate cannot be negative.";
    if (change.field === "owner" && (typeof change.newValue !== "string" || !project.team.some((member) => member.name === change.newValue))) return "A reassigned task owner must be an existing project team member.";
    if (change.field === "blocker" && typeof change.newValue !== "string") return "Blocker detail must be text.";
  } else if (change.actionType === "allocation_change") {
    if (change.entityType !== "team_member" || !project.team.some((item) => item.id === change.entityId)) return `Team member ${change.entityId} no longer exists.`;
    if (change.field !== "allocation" || !isFiniteNumber(change.newValue) || change.newValue < 0 || change.newValue > 200) return "Allocation must be between 0% and 200%.";
  } else {
    if (change.entityType !== "project" || change.entityId !== project.id) return "Project proposal targets the wrong project.";
    if (!projectFields.has(change.field)) return `Project field ${change.field} cannot be changed by Ali.`;
    if (["startDate", "deadline"].includes(change.field) && !isDate(change.newValue)) return `${change.field} is not a valid date.`;
    if (["budget", "spent"].includes(change.field) && (!isFiniteNumber(change.newValue) || change.newValue < 0)) return `${change.field} cannot be negative.`;
    if (["progress", "plannedProgress", "qualityScore"].includes(change.field) && (!isFiniteNumber(change.newValue) || change.newValue < 0 || change.newValue > 100)) return `${change.field} must be between 0 and 100.`;
    if (["name", "client", "owner"].includes(change.field) && (typeof change.newValue !== "string" || !change.newValue.trim())) return `${change.field} cannot be empty.`;
  }
  return null;
}

export function validateProposal(project: Project, proposal: AgentProposal, options: { requireCurrentVersion?: boolean } = { requireCurrentVersion: true }): { valid: true } | { valid: false; error: string } {
  if (!proposal.id || !proposal.projectId || !proposal.projectUpdatedAtAtCreation || !proposal.title || !proposal.reason || proposal.changes.length === 0 || proposal.changes.length > 12) return { valid: false, error: "Proposal is incomplete or too large." };
  if (proposal.projectId !== project.id) return { valid: false, error: "This proposal belongs to a different project." };
  if (proposal.status !== "pending") return { valid: false, error: `This proposal is already ${proposal.status}.` };
  if (options.requireCurrentVersion !== false && isProposalStale(project, proposal)) return { valid: false, error: "Project data changed after this proposal was created. Ask Ali to reassess before approving it." };
  const ids = new Set<string>();
  for (const change of proposal.changes) {
    if (ids.has(change.id)) return { valid: false, error: "Proposal contains duplicate changes." };
    ids.add(change.id);
    const error = validateChange(project, change);
    if (error) return { valid: false, error };
  }
  for (const change of proposal.changes) {
    if (change.actionType === "task_update" && change.field === "status" && change.newValue === "blocked") {
      const task = project.tasks.find((item) => item.id === change.entityId);
      const blockerChange = proposal.changes.find((item) => item.actionType === "task_update" && item.entityId === change.entityId && item.field === "blocker" && typeof item.newValue === "string" && item.newValue.trim());
      if (!task?.blocker && !blockerChange) return { valid: false, error: "A blocker reason is required before marking a task blocked." };
    }
  }
  return { valid: true };
}

function applyChange(project: Project, change: ProposalChange): Project {
  if (change.actionType === "task_create") return { ...project, tasks: [...project.tasks, cloneProject({ ...project, tasks: [change.newValue as ProjectTask] }).tasks[0]] };
  if (change.actionType === "task_delete") return { ...project, tasks: project.tasks.filter((task) => task.id !== change.entityId) };
  if (change.actionType === "task_update") return { ...project, tasks: project.tasks.map((task): ProjectTask => task.id === change.entityId ? { ...task, [change.field]: change.newValue } as ProjectTask : task) };
  if (change.actionType === "allocation_change") return { ...project, team: project.team.map((member) => member.id === change.entityId ? { ...member, allocation: change.newValue as number } : member) };
  return { ...project, [change.field]: change.newValue } as Project;
}

function applyChanges(project: Project, proposal: AgentProposal, now: Date) {
  let next = cloneProject(project);
  for (const change of proposal.changes) next = applyChange(next, change);
  if (isDate(next.startDate) && isDate(next.deadline) && new Date(`${next.startDate}T12:00:00Z`) > new Date(`${next.deadline}T12:00:00Z`)) throw new Error("The project deadline cannot be before its start date.");
  return { ...next, updatedAt: now.toISOString() };
}

export type ProposalExecutionStep = { changeId: string; message: string; project: Project };

function executionMessage(change: ProposalChange) {
  if (change.actionType === "allocation_change") return `Updating ${change.entityName}'s allocation…`;
  if (change.actionType === "task_create") return `Creating ${change.entityName}…`;
  if (change.actionType === "task_delete") return `Deleting ${change.entityName}…`;
  if (change.actionType === "task_update" && change.field === "owner") return `Updating task assignment for ${change.entityName}…`;
  if (change.actionType === "task_update" && change.field === "status") return `Updating task status for ${change.entityName}…`;
  if (change.actionType === "deadline_change" || change.field === "dueDate") return `Updating the deadline for ${change.entityName}…`;
  if (change.actionType === "budget_change") return "Updating the approved budget…";
  return `Updating ${change.entityName}…`;
}

export function buildProposalExecution(project: Project, proposal: AgentProposal, now = new Date()): { steps: ProposalExecutionStep[]; project: Project; undoEntry: UndoEntry; comparison: HealthComparison } {
  const validation = validateProposal(project, proposal);
  if (!validation.valid) throw new Error(validation.error);
  const snapshot = cloneProject(project); let next = cloneProject(project);
  const steps = proposal.changes.map((change, index) => {
    next = applyChange(next, change);
    next = { ...next, updatedAt: new Date(now.getTime() + index).toISOString() };
    return { changeId: change.id, message: executionMessage(change), project: cloneProject(next) };
  });
  if (isDate(next.startDate) && isDate(next.deadline) && new Date(`${next.startDate}T12:00:00Z`) > new Date(`${next.deadline}T12:00:00Z`)) throw new Error("The project deadline cannot be before its start date.");
  return {
    steps,
    project: next,
    comparison: compareProjectHealth(project, next, now),
    undoEntry: { id: crypto.randomUUID(), proposalId: proposal.id, projectId: project.id, snapshot, appliedProjectUpdatedAt: next.updatedAt, createdAt: now.toISOString() }
  };
}

export function applyProposal(project: Project, proposal: AgentProposal, now = new Date()): { project: Project; undoEntry: UndoEntry; comparison: HealthComparison } {
  const execution = buildProposalExecution(project, proposal, now);
  return { project: execution.project, comparison: execution.comparison, undoEntry: execution.undoEntry };
}

export function undoProposal(project: Project, entry: UndoEntry): Project {
  if (entry.projectId !== project.id) throw new Error("This undo entry belongs to a different project.");
  if (project.updatedAt !== entry.appliedProjectUpdatedAt) throw new Error("Project data changed after Ali applied this proposal. Undo is disabled to avoid erasing newer edits.");
  return cloneProject(entry.snapshot);
}

export function simulateProposal(project: Project, proposal: AgentProposal, now = new Date()): { project: Project; comparison: HealthComparison; simulation: ProposalSimulation } {
  const validation = validateProposal(project, proposal, { requireCurrentVersion: false });
  if (!validation.valid) throw new Error(validation.error);
  const simulated = applyChanges(project, proposal, now);
  const comparison = compareProjectHealth(project, simulated, now);
  const meaningful = proposal.changes.some((change) => scorableFields.has(change.field));
  const deferredHours = proposal.changes.filter((change) => change.actionType === "task_update" && change.field === "status" && change.newValue === "deferred").reduce((sum, change) => { const task = project.tasks.find((item) => item.id === change.entityId); return sum + (task ? Math.max(0, task.estimatedHours - task.loggedHours) : 0); }, 0);
  const scopeCaveat = deferredHours > 0 ? ` Deferral removes about ${deferredHours} estimated remaining hours from active scope; no monetary saving is claimed because the project has no hourly cost rate.` : "";
  return {
    project: simulated,
    comparison,
    simulation: {
      beforeScore: comparison.previousScore,
      afterScore: meaningful ? comparison.newScore : null,
      scoreDelta: meaningful ? comparison.scoreDelta : null,
      risksRemoved: meaningful ? comparison.risksRemoved : [],
      risksRemaining: meaningful ? comparison.risksRemaining : comparison.risksRemaining,
      risksIntroduced: meaningful ? comparison.risksIntroduced : [],
      caveat: (meaningful ? "Forecast from a temporary project copy; improvement is not guaranteed." : "This planning change has no meaningful deterministic score simulation.") + scopeCaveat
    }
  };
}

export function withSimulation(project: Project, proposal: AgentProposal, now = new Date()): AgentProposal {
  return { ...proposal, simulation: simulateProposal(project, proposal, now).simulation };
}

export function proposalForChanges(project: Project, title: string, reason: string, changes: ProposalChange[], now = new Date(), kind: AgentProposal["kind"] = "single_change", evidence: AgentEvidence[] = []): AgentProposal {
  const proposalEvidence = evidence.length ? evidence : changes.flatMap((change) => change.evidence.map((value) => ({ label: change.entityName, value, source: "proposal evidence" })));
  const proposal: AgentProposal = {
    id: crypto.randomUUID(), projectId: project.id, projectUpdatedAtAtCreation: project.updatedAt, title, kind, reason,
    evidence: proposalEvidence, changes, simulation: { beforeScore: analyzeProject(project, now).score, afterScore: null, scoreDelta: null, risksRemoved: [], risksRemaining: [], risksIntroduced: [], caveat: "Not simulated." },
    status: "pending", reversible: changes.every((change) => change.reversible), createdAt: now.toISOString()
  };
  return withSimulation(project, proposal, now);
}
