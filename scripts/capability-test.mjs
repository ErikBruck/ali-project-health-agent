import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
function load(sourcePath) {
  const filename = sourcePath.endsWith(".ts") ? sourcePath : `${sourcePath}.ts`;
  if (cache.has(filename)) return cache.get(filename).exports;
  const loadedModule = { exports: {} }; cache.set(filename, loadedModule);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const localRequire = (specifier) => {
    if (specifier.startsWith("@/")) return load(path.join(root, specifier.slice(2)));
    if (specifier.startsWith(".")) return load(path.resolve(path.dirname(filename), specifier));
    throw new Error(`Unexpected test dependency: ${specifier}`);
  };
  Function("require", "module", "exports", "__filename", "__dirname", output)(localRequire, loadedModule, loadedModule.exports, filename, path.dirname(filename));
  return loadedModule.exports;
}

const { applyProposal, buildProposalExecution, cloneProject, proposalForChanges, undoProposal } = load(path.join(root, "lib/agent/proposals"));
const { runLocalAgent } = load(path.join(root, "lib/agent/local-agent"));
const { emptyAgentConversationState } = load(path.join(root, "lib/agent/types"));
const { normalizeProject } = load(path.join(root, "lib/project-data"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const throws = (fn, pattern, message) => { try { fn(); } catch (error) { if (pattern.test(String(error.message))) return; throw error; } throw new Error(message); };

const project = {
  id: "atlas-test", name: "Atlas Audit", client: "Atlas", owner: "Emma", currency: "EUR", startDate: "2026-05-01", deadline: "2026-09-01",
  budget: 80000, spent: 60000, progress: 50, plannedProgress: 70, qualityScore: 70, updatedAt: "2026-07-16T10:00:00.000Z",
  tasks: [
    { id: "design", title: "Design approval", owner: "Mia Chen", status: "blocked", dueDate: "2026-07-10", estimatedHours: 20, loggedHours: 22, critical: true, blocker: "Client approval missing" },
    { id: "copy", title: "Draft landing page copy", owner: "Leo Martins", status: "in-progress", dueDate: "2026-07-20", estimatedHours: 12, loggedHours: 5, critical: false, blocker: "" }
  ],
  team: [{ id: "mia", name: "Mia Chen", role: "Designer", allocation: 125 }, { id: "leo", name: "Leo Martins", role: "Engineer", allocation: 75 }]
};
const change = (overrides) => ({ id: crypto.randomUUID(), actionType: "project_update", entityType: "project", entityId: project.id, entityName: project.name, field: "budget", oldValue: project.budget, newValue: 120000, reason: "Reforecast from current burn", evidence: ["50% progress at €60k spent"], expectedImpact: "Aligns budget; does not reduce cost", reversible: true, ...overrides });

const original = JSON.stringify(project);
const budgetProposal = proposalForChanges(project, "Reforecast budget", "Current burn projects €120k", [change({ actionType: "budget_change" })], new Date("2026-07-16T12:00:00Z"));
assert(JSON.stringify(project) === original, "Proposal creation or simulation mutated project data");
assert(budgetProposal.projectUpdatedAtAtCreation === project.updatedAt && budgetProposal.simulation.beforeScore !== undefined, "Proposal version/simulation missing");
const budgetApplied = applyProposal(project, budgetProposal, new Date("2026-07-16T12:01:00Z"));
assert(budgetApplied.project.budget === 120000 && project.budget === 80000, "Approval did not change only the returned project budget");
assert(JSON.stringify(undoProposal(budgetApplied.project, budgetApplied.undoEntry)) === original, "Undo did not restore the exact original snapshot");
throws(() => applyProposal(budgetApplied.project, budgetProposal), /changed|stale|created/i, "Duplicate approval was not prevented");

const rejectedSnapshot = cloneProject(project);
assert(JSON.stringify(rejectedSnapshot) === original, "Reject-path baseline changed data without applying");

const deferProposal = proposalForChanges(project, "Defer copy", "Non-critical scope", [change({ actionType: "task_update", entityType: "task", entityId: "copy", entityName: "Draft landing page copy", field: "status", oldValue: "in-progress", newValue: "deferred" })]);
assert(project.tasks[1].status === "in-progress", "Deferral mutated before approval");
assert(applyProposal(project, deferProposal).project.tasks.find((task) => task.id === "copy").status === "deferred", "Deferral approval changed the wrong task or failed");

const followUpTask = { id: "follow-up", title: "Client approval follow-up", owner: "Leo Martins", status: "not-started", dueDate: "2026-07-18", estimatedHours: 4, loggedHours: 0, critical: false, blocker: "" };
const createProposal = proposalForChanges(project, "Create follow-up", "Explicit follow-up", [change({ actionType: "task_create", entityType: "task", entityId: followUpTask.id, entityName: followUpTask.title, field: "__create__", oldValue: null, newValue: followUpTask })]);
const withFollowUp = applyProposal(project, createProposal);
assert(withFollowUp.project.tasks.some((task) => task.id === "follow-up") && !project.tasks.some((task) => task.id === "follow-up"), "Task creation did not remain approval-gated");
const deleteProposal = proposalForChanges(withFollowUp.project, "Delete follow-up", "Explicit deletion", [change({ actionType: "task_delete", entityType: "task", entityId: followUpTask.id, entityName: followUpTask.title, field: "__delete__", oldValue: followUpTask, newValue: null })]);
const deleted = applyProposal(withFollowUp.project, deleteProposal);
assert(!deleted.project.tasks.some((task) => task.id === "follow-up") && undoProposal(deleted.project, deleted.undoEntry).tasks.some((task) => task.id === "follow-up"), "Task deletion or deletion undo failed");

const rebalance = proposalForChanges(project, "Rebalance", "Use recorded capacity", [
  change({ actionType: "allocation_change", entityType: "team_member", entityId: "mia", entityName: "Mia Chen", field: "allocation", oldValue: 125, newValue: 100 }),
  change({ actionType: "allocation_change", entityType: "team_member", entityId: "leo", entityName: "Leo Martins", field: "allocation", oldValue: 75, newValue: 100 })
]);
const rebalanced = applyProposal(project, rebalance).project;
assert(rebalanced.team.find((member) => member.id === "mia").allocation === 100 && rebalanced.team.find((member) => member.id === "leo").allocation === 100, "Rebalance changed incorrect people");

throws(() => proposalForChanges(project, "Bad deadline", "Invalid", [change({ actionType: "deadline_change", field: "deadline", oldValue: project.deadline, newValue: "not-a-date" })]), /date/i, "Invalid deadline was accepted");
throws(() => proposalForChanges(project, "Bad allocation", "Invalid", [change({ actionType: "allocation_change", entityType: "team_member", entityId: "mia", entityName: "Mia Chen", field: "allocation", oldValue: 125, newValue: 250 })]), /allocation/i, "Impossible allocation was accepted");
throws(() => proposalForChanges(project, "Bad owner", "Invalid", [change({ actionType: "task_update", entityType: "task", entityId: "copy", entityName: "Draft landing page copy", field: "owner", oldValue: "Leo Martins", newValue: "Invented Person" })]), /existing project team member/i, "Invented task owner was accepted");
throws(() => proposalForChanges(project, "Bad estimate", "Invalid", [change({ actionType: "task_update", entityType: "task", entityId: "copy", entityName: "Draft landing page copy", field: "estimatedHours", oldValue: 12, newValue: -1 })]), /estimate|negative/i, "Negative task estimate was accepted");
throws(() => proposalForChanges(project, "Bad progress", "Invalid", [change({ field: "progress", oldValue: 50, newValue: 101 })]), /between 0 and 100/i, "Impossible progress was accepted");
throws(() => applyProposal({ ...project, updatedAt: "2026-07-16T13:00:00Z" }, budgetProposal), /changed|reassess/i, "Stale proposal was accepted");
throws(() => undoProposal({ ...budgetApplied.project, updatedAt: "manual-edit" }, budgetApplied.undoEntry), /changed/i, "Undo overwrote a newer manual edit");
throws(() => undoProposal({ ...budgetApplied.project, id: "other" }, budgetApplied.undoEntry), /different project/i, "Undo leaked across projects");

const duplicateNames = { ...project, team: [...project.team, { id: "mia-2", name: "Mia Patel", role: "QA", allocation: 80 }] };
const duplicateResponse = runLocalAgent({ project: duplicateNames, message: "Set Mia to 95%", history: [], currentDate: "2026-07-16T12:00:00Z", pendingProposal: null });
assert(duplicateResponse.clarification?.options.length === 2, `Duplicate names did not trigger clarification: ${JSON.stringify(duplicateResponse)}`);
const estimateResponse = runLocalAgent({ project, message: "Set landing page copy estimate to 16 hours", history: [], currentDate: "2026-07-16T12:00:00Z", pendingProposal: null });
assert(estimateResponse.proposal?.changes[0]?.field === "estimatedHours" && estimateResponse.proposal.changes[0].newValue === 16 && project.tasks[1].estimatedHours === 12, "Task estimate correction was not proposal-gated");
const fallback = runLocalAgent({ project, message: "Why is it at risk?", history: [], currentDate: "2026-07-16T12:00:00Z", pendingProposal: null }, "simulated API timeout");
assert(fallback.mode === "local" && fallback.message.includes("local agent") && fallback.toolTrace.every((entry) => entry.result), "Safe model fallback or real tool results failed");

const imported = normalizeProject({ id: "imported", name: "Imported", tasks: null, team: null, progress: -10, budget: -1 });
assert(imported && imported.tasks.length === 0 && imported.team.length === 0 && imported.progress === 0 && imported.budget === 0, "Malformed import was not normalized safely");
const blank = normalizeProject({ id: "blank", name: "Blank", tasks: [], team: [], budget: 0, spent: 0, progress: 0, plannedProgress: 0, qualityScore: 0, updatedAt: "now" });
assert(blank, "New/empty project normalization failed");

const turn = (message, agentState = emptyAgentConversationState(), activeProject = project, history = []) => runLocalAgent({ project: activeProject, message, history, currentDate: "2026-07-16T12:00:00Z", pendingProposal: agentState.pendingApprovalProposal, agentState });

// A: broad goal → clarification → combined plan → stepwise execution → verification data.
const fixProject = turn("Fix this project");
assert(fixProject.agentState.phase === "NEEDS_CLARIFICATION" && fixProject.clarification?.options.some((option) => option.id === "budget-capacity"), "A: broad recovery goal did not ask which area to tackle");
const combinedPlan = turn("budget-capacity", fixProject.agentState, project, [{ role: "user", text: "Fix this project" }, { role: "assistant", text: fixProject.message, clarification: fixProject.clarification }]);
assert(combinedPlan.agentState.phase === "AWAITING_CONFIRMATION" && combinedPlan.proposal?.changes.some((item) => item.actionType === "budget_change") && combinedPlan.proposal.changes.some((item) => item.actionType === "allocation_change"), "A: selected areas did not become a combined confirmation plan");
const combinedExecution = buildProposalExecution(project, combinedPlan.proposal);
assert(combinedExecution.steps.length === combinedPlan.proposal.changes.length && combinedExecution.steps.every((step) => step.message) && combinedExecution.project.updatedAt !== project.updatedAt, "A: approved plan did not produce real stepwise operations");

// B: budget goal → strategy clarification → concrete non-critical scope plan.
const budgetGoal = turn("Fix the budget issue");
assert(budgetGoal.agentState.phase === "NEEDS_CLARIFICATION" && budgetGoal.clarification?.options.map((option) => option.id).join(",") === "reforecast,reduce-scope,validate-estimate", "B: budget strategy clarification is missing");
const scopePlan = turn("Reduce scope", budgetGoal.agentState);
assert(scopePlan.proposal?.changes.length && scopePlan.proposal.changes.every((item) => item.field === "status" && item.newValue === "deferred") && project.tasks[1].status === "in-progress", "B: reduce-scope answer did not create a non-mutating deferral plan");
const scoped = applyProposal(project, scopePlan.proposal);
assert(scoped.project.tasks.find((task) => task.id === "copy").status === "deferred", "B: approved scope plan did not update real task state");

// C: transfer goal → task clarification → combined owner/allocation proposal.
const transferProject = { ...project, tasks: [...project.tasks, { id: "research", title: "Design research handoff", owner: "Mia Chen", status: "in-progress", dueDate: "2026-07-25", estimatedHours: 10, loggedHours: 2, critical: false, blocker: "" }] };
const transferGoal = turn("Move work from Mia to Leo", emptyAgentConversationState(), transferProject);
assert(transferGoal.agentState.phase === "NEEDS_CLARIFICATION" && transferGoal.clarification?.options.length === 2, "C: multiple transferable tasks did not trigger clarification");
const transferPlan = turn("research", transferGoal.agentState, transferProject);
assert(transferPlan.proposal?.changes.length === 3 && transferPlan.proposal.changes.some((item) => item.field === "owner" && item.entityId === "research") && transferPlan.proposal.changes.filter((item) => item.field === "allocation").length === 2, "C: selected task did not produce owner and allocation changes");
const transferred = applyProposal(transferProject, transferPlan.proposal).project;
assert(transferred.tasks.find((task) => task.id === "research").owner === "Leo Martins" && transferred.team.find((member) => member.id === "mia").allocation === 100 && transferred.team.find((member) => member.id === "leo").allocation === 100, "C: approved transfer did not update the exact task and people");

// D/E: contextual control resolution and exact snapshot restoration.
const contextualApproval = turn("Do that", combinedPlan.agentState);
assert(contextualApproval.proposal?.id === combinedPlan.proposal.id && contextualApproval.agentState.phase === "AWAITING_CONFIRMATION", "D: 'Do that' lost the pending plan context");
const unclearThat = turn("Do that");
assert(unclearThat.agentState.phase === "NEEDS_CLARIFICATION" && unclearThat.clarification, "D: context-free 'Do that' did not ask what it refers to");
assert(JSON.stringify(undoProposal(combinedExecution.project, combinedExecution.undoEntry)) === original, "E: multi-change execution undo did not restore the exact previous snapshot");

console.log("Capability tests passed: state-machine scenarios A–E, proposal versioning, no pre-approval mutation, stepwise apply, exact undo, deferral, task estimates, rebalance, validation, clarification, isolation, fallback, traces, and malformed projects.");
