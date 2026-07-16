import { analyzeProject } from "@/lib/analyze";
import type { Project, ProjectTask, TeamMember } from "@/lib/types";
import { executeAgentTool, taskStatusFromText } from "./tools";
import { emptyAgentConversationState } from "./types";
import type { AgentClarification, AgentConversationState, AgentEvidence, AgentGoal, AgentProposal, AgentRequest, AgentResponse, AgentToolTrace, ProposalAction, ToolName } from "./types";

type LocalContext = { request: AgentRequest; trace: AgentToolTrace[]; evidence: AgentEvidence[]; proposals: AgentProposal[]; state: AgentConversationState; fallbackReason?: string };
const uniqueEvidence = (items: AgentEvidence[]) => items.filter((item, index) => items.findIndex((candidate) => candidate.label === item.label && candidate.value === item.value) === index).slice(0, 10);
const money = (value: number, project: Project) => new Intl.NumberFormat("en-GB", { style: "currency", currency: project.currency, maximumFractionDigits: 0 }).format(value);
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9%\s-]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (value: string) => normalize(value).split(" ").filter((token) => token.length > 3 && !["task", "mark", "change", "status", "project", "please", "completed", "complete", "blocked", "unblock", "assign", "defer", "restore"].includes(token)).map((token) => token.slice(0, 5));
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

function call(context: LocalContext, tool: ToolName, args: Record<string, unknown> = {}) {
  if (context.trace.length >= 8) throw new Error("The local agent reached its safe eight-tool limit.");
  const result = executeAgentTool(tool, args, context.request.project, context.request.currentDate, [...context.proposals, ...(context.request.pendingProposal ? [context.request.pendingProposal] : [])]);
  context.trace.push({ tool, arguments: args, summary: result.summary, result: result.output });
  context.evidence.push(...result.evidence);
  if (result.proposal) context.proposals.push(result.proposal);
  return result;
}

function response(context: LocalContext, message: string, proposal: AgentProposal | null = null, clarification: AgentResponse["clarification"] = null): AgentResponse {
  const fallback = context.fallbackReason && !message.includes("Model mode failed") ? ` Model mode failed, so the local agent completed this run safely (${context.fallbackReason}).` : "";
  const findings = uniqueEvidence([...context.state.investigationFindings, ...context.evidence]);
  const plan = proposal ? { id: crypto.randomUUID(), title: proposal.title, summary: proposal.reason, proposalId: proposal.id, changeIds: proposal.changes.map((change) => change.id), createdAt: new Date().toISOString() } : clarification ? null : context.state.pendingPlan;
  const agentState: AgentConversationState = {
    ...context.state,
    phase: clarification ? "NEEDS_CLARIFICATION" : proposal ? "AWAITING_CONFIRMATION" : context.state.phase === "ERROR" ? "ERROR" : "IDLE",
    investigationFindings: findings,
    pendingClarification: clarification,
    pendingPlan: plan,
    pendingApprovalProposal: proposal,
    toolTraces: [...context.state.toolTraces, ...context.trace].slice(-40),
    error: context.state.phase === "ERROR" ? context.state.error : null
  };
  return { mode: "local", message: message + fallback, toolTrace: context.trace, evidence: uniqueEvidence(context.evidence), proposal, clarification, agentState, ...(context.fallbackReason ? { fallbackReason: context.fallbackReason } : {}) };
}

function memberCandidates(project: Project, message: string): TeamMember[] {
  const text = normalize(message);
  return project.team.filter((member) => { const full = normalize(member.name); const first = full.split(" ")[0]; return text.includes(full) || (first.length > 2 && new RegExp(`\\b${first}\\b`).test(text)); });
}

function taskCandidates(project: Project, message: string): ProjectTask[] {
  const exactId = project.tasks.filter((task) => new RegExp(`\\b${task.id.toLowerCase()}\\b`).test(normalize(message)));
  if (exactId.length) return exactId;
  const messageTokens = tokens(message);
  const scored = project.tasks.map((task) => ({ task, score: tokens(task.title).filter((token) => messageTokens.some((candidate) => candidate === token || candidate.startsWith(token.slice(0, 4)) || token.startsWith(candidate.slice(0, 4)))).length + (normalize(message).includes(normalize(task.title)) ? 10 : 0) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  return scored.filter((item) => item.score === scored[0].score).map((item) => item.task);
}

const clarify = (question: string, items: Array<{ id: string; label: string }>, allowMultiple = false): NonNullable<AgentResponse["clarification"]> => ({ id: crypto.randomUUID(), question, options: items.slice(0, 8), allowMultiple });
const goal = (text: string, intent: string, context: Record<string, string> = {}): AgentGoal => ({ text, intent, context, createdAt: new Date().toISOString() });
function addDays(dateValue: string, days: number) { const base = validDate(dateValue) ? dateValue : new Date().toISOString().slice(0, 10); const date = new Date(`${base}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function nextWeekday(nowIso: string, weekday: number) { const date = new Date(nowIso); const delta = (weekday - date.getUTCDay() + 7) % 7 || 7; date.setUTCDate(date.getUTCDate() + delta); return date.toISOString().slice(0, 10); }
function requestedDate(raw: string, currentDate: string, baseDate?: string) { const explicit = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]; if (explicit) return explicit; const lower = raw.toLowerCase(); if (/\btomorrow\b/.test(lower)) return addDays(currentDate.slice(0, 10), 1); if (/\bfriday\b/.test(lower)) return nextWeekday(currentDate, 5); const weeks = lower.match(/(\d+)\s*weeks?/); const days = lower.match(/(\d+)\s*days?/); if (weeks) return addDays(baseDate ?? currentDate.slice(0, 10), Number(weeks[1]) * 7); if (days) return addDays(baseDate ?? currentDate.slice(0, 10), Number(days[1])); if (/\b(one|a) week\b/.test(lower)) return addDays(baseDate ?? currentDate.slice(0, 10), 7); return null; }
function riskTool(category: string): ToolName { return category === "budget" ? "analyze_budget" : category === "capacity" ? "analyze_capacity" : category === "quality" ? "analyze_quality" : category === "schedule" || category === "delivery" ? "analyze_schedule" : "get_health_findings"; }

function contextualMessage(request: AgentRequest) {
  const normalized = normalize(request.message);
  if (/^(try |use |actually use )?(the )?(first|second)( option| one)?$/.test(normalized)) {
    const index = /second/.test(normalized) ? 1 : 0;
    const clarification = [...request.history].reverse().find((item) => item.role === "assistant" && item.clarification?.options.length)?.clarification;
    const prior = [...request.history].reverse().find((item) => item.role === "user")?.text;
    const option = clarification?.options[index];
    if (prior && option) return `${prior}. Clarification: ${option.label}`;
  }
  if (!/^(do that|fix it|try the first option|use the first option|the first one|use the second option|actually use the second option)$/.test(normalized)) return request.message;
  const lastAssistant = [...request.history].reverse().find((item) => item.role === "assistant")?.text ?? "";
  if (!lastAssistant) return request.message;
  if (/budget|overrun|cost/i.test(lastAssistant)) return "Reforecast the budget based on that finding";
  if (/capacity|allocation|overload/i.test(lastAssistant)) return "Reduce the highest overloaded team member to 100%";
  if (/blocker|blocked/i.test(lastAssistant)) return "Resolve the highest priority blocker";
  if (/overdue|schedule|deadline/i.test(lastAssistant)) return "Create a recovery plan for that schedule finding";
  return request.message;
}

function recoveryPlan(context: LocalContext) {
  const project = context.request.project; const analysis = analyzeProject(project, new Date(context.request.currentDate));
  call(context, "get_project_overview"); call(context, "analyze_budget"); call(context, "analyze_schedule"); call(context, "analyze_capacity"); call(context, "analyze_quality"); call(context, "get_health_findings");
  const changes: Array<{ actionType: ProposalAction; entityId: string; field: string; value: string; reason: string; expectedImpact: string }> = [];
  const overloaded = [...project.team].filter((member) => member.allocation > 100).sort((a, b) => b.allocation - a.allocation)[0];
  if (overloaded) changes.push({ actionType: "allocation_change", entityId: overloaded.id, field: "allocation", value: "100", reason: `${overloaded.name} is at ${overloaded.allocation}%.`, expectedImpact: "Removes the largest recorded overload." });
  const now = new Date(context.request.currentDate); const overdue = project.tasks.filter((task) => !["done", "deferred"].includes(task.status) && validDate(task.dueDate) && new Date(`${task.dueDate}T23:59:59Z`) < now).sort((a, b) => Number(b.critical) - Number(a.critical))[0];
  if (overdue && changes.length < 3) changes.push({ actionType: "task_update", entityId: overdue.id, field: "dueDate", value: addDays(context.request.currentDate.slice(0, 10), 7), reason: `${overdue.title} is overdue from ${overdue.dueDate}.`, expectedImpact: "Creates a recovery date; it does not complete the work." });
  if (analysis.metrics.budgetVariance > 8 && project.progress > 0 && changes.length < 3) { const forecast = Math.ceil(project.spent / (project.progress / 100) / 100) * 100; changes.push({ actionType: "budget_change", entityId: project.id, field: "budget", value: String(forecast), reason: `Current burn projects a ${analysis.metrics.budgetVariance}% variance.`, expectedImpact: "Reforecasts approved budget; it does not reduce actual cost." }); }
  if (analysis.metrics.scheduleGap >= 5 && changes.length < 3 && validDate(project.deadline)) changes.push({ actionType: "deadline_change", entityId: project.id, field: "deadline", value: addDays(project.deadline, 7), reason: `Actual progress is ${analysis.metrics.scheduleGap}pp behind plan.`, expectedImpact: "Adds planning contingency, not a guaranteed fix." });
  if (!changes.length) return response(context, "I inspected every major dimension but do not have enough evidence for a safe data change. Update the missing project facts and ask me to reassess.");
  const created = call(context, "propose_recovery_plan", { title: "Prioritised recovery plan", reason: `Targets ${analysis.risks.slice(0, 3).map((risk) => risk.title).join(", ")}.`, changes }); const proposal = created.proposal; if (!proposal) throw new Error("Recovery proposal was not created."); call(context, "simulate_changes", { proposalId: proposal.id });
  const simulation = proposal.simulation; return response(context, `I inspected all major dimensions and created ${proposal.changes.length} approval-gated interventions. ${simulation.afterScore === null ? simulation.caveat : `The temporary forecast is ${simulation.beforeScore} → ${simulation.afterScore} (${simulation.scoreDelta && simulation.scoreDelta > 0 ? "+" : ""}${simulation.scoreDelta ?? 0}).`} This is not a guarantee.`, proposal);
}

function selectedClarificationOptions(message: string, clarification: AgentClarification) {
  const text = normalize(message);
  const ordinal = text.match(/\b(first|second|third|fourth|fifth|sixth)\b/)?.[1];
  const ordinalIndex = ordinal ? ["first", "second", "third", "fourth", "fifth", "sixth"].indexOf(ordinal) : -1;
  if (ordinalIndex >= 0 && clarification.options[ordinalIndex]) return [clarification.options[ordinalIndex]];
  const matches = clarification.options.filter((option) => {
    const label = normalize(option.label); const optionId = normalize(option.id);
    return text === label || text === optionId || text.includes(label) || (text.length > 3 && label.includes(text)) || (optionId.length > 2 && new RegExp(`\\b${optionId}\\b`).test(text));
  });
  return clarification.allowMultiple ? matches : matches.slice(0, 1);
}

function planBudgetAndCapacity(context: LocalContext) {
  const project = context.request.project;
  const budget = call(context, "analyze_budget"); call(context, "analyze_capacity");
  const changes: Array<{ actionType: ProposalAction; entityId: string; field: string; value: string; reason: string; expectedImpact: string }> = [];
  const forecast = budget.output.projectedFinalCost;
  if (typeof forecast === "number" && forecast > project.budget) changes.push({ actionType: "budget_change", entityId: project.id, field: "budget", value: String(Math.ceil(forecast / 100) * 100), reason: `Current burn projects ${money(forecast, project)} final cost.`, expectedImpact: "Reforecasts the approved budget; it does not reduce actual cost." });
  const overloaded = [...project.team].filter((member) => member.allocation > 100).sort((a, b) => b.allocation - a.allocation)[0];
  if (overloaded) changes.push({ actionType: "allocation_change", entityId: overloaded.id, field: "allocation", value: "100", reason: `${overloaded.name} is recorded at ${overloaded.allocation}%.`, expectedImpact: "Removes the largest recorded allocation overload." });
  if (!changes.length) return response(context, "I inspected budget and capacity, but neither contains a data-supported change I can safely propose. Which other area should I investigate?", null, clarify("Which area should I investigate instead?", [{ id: "schedule", label: "Schedule and blockers" }, { id: "quality", label: "Quality and delivery" }]));
  const created = call(context, "propose_recovery_plan", { title: "Budget and capacity recovery plan", reason: "Combines the two selected recovery areas using current budget and allocation evidence.", changes }); const proposal = created.proposal; if (!proposal) throw new Error("Combined plan was not created."); call(context, "simulate_changes", { proposalId: proposal.id });
  return response(context, `I built a ${proposal.changes.length}-change budget and capacity plan. Review the forecast and each before/after value; no project data has changed yet.`, proposal);
}

function planBudgetChoice(context: LocalContext, optionId: string) {
  const project = context.request.project;
  if (optionId === "reforecast") {
    const budget = call(context, "analyze_budget"); const forecast = budget.output.projectedFinalCost;
    if (typeof forecast !== "number") return response(context, "I cannot reforecast until actual progress is available. What actual progress should I record?", null, clarify("Choose or enter actual progress.", [{ id: "25", label: "25%" }, { id: "50", label: "50%" }, { id: "75", label: "75%" }]));
    const created = call(context, "propose_budget_change", { budget: Math.ceil(forecast / 100) * 100, reason: `Reforecast from ${money(project.spent, project)} spent at ${project.progress}% progress.` }); if (created.proposal) call(context, "simulate_changes", { proposalId: created.proposal.id });
    return response(context, "I prepared the reforecast option. It aligns the approved budget with projected cost; it does not reduce cost.", created.proposal);
  }
  if (optionId === "reduce-scope") {
    call(context, "analyze_budget"); call(context, "list_tasks", { filter: "incomplete", assignee: null });
    const tasks = [...project.tasks].filter((task) => !task.critical && !["done", "deferred"].includes(task.status)).sort((a, b) => (b.estimatedHours - b.loggedHours) - (a.estimatedHours - a.loggedHours)).slice(0, 3);
    if (!tasks.length) return response(context, "There is no active non-critical task I can safely propose deferring. Reforecast the budget or validate estimates instead?", null, clarify("Choose another budget approach.", [{ id: "reforecast", label: "Reforecast budget" }, { id: "validate-estimate", label: "Validate remaining estimates" }]));
    const changes = tasks.map((task) => ({ actionType: "task_update" as const, entityId: task.id, field: "status", value: "deferred", reason: `${task.title} is non-critical with ${Math.max(0, task.estimatedHours - task.loggedHours)} estimated hours remaining.`, expectedImpact: "Removes selected work from active scope; it is not counted as completed." }));
    const created = call(context, "propose_recovery_plan", { title: "Reduce non-critical scope", reason: "Defer the largest active non-critical tasks to reduce remaining delivery scope.", changes }); const proposal = created.proposal; if (!proposal) throw new Error("Scope plan was not created."); call(context, "simulate_changes", { proposalId: proposal.id });
    return response(context, `I identified ${tasks.length} specific non-critical task${tasks.length === 1 ? "" : "s"} to defer. The forecast uses recorded remaining hours and does not claim a monetary saving without cost-rate data.`, proposal);
  }
  const owners = project.team.map((member) => ({ id: member.id, label: `${member.name} · ${member.role}` }));
  if (owners.length < 1) return response(context, "Estimate validation needs an owner, but this project has no team data. Add an owner and ask me to continue.");
  context.state = { ...context.state, currentUserGoal: goal(context.state.currentUserGoal?.text ?? "Validate budget estimates", "estimate_validation_owner"), phase: "NEEDS_CLARIFICATION" };
  return response(context, "Who should own the estimate-validation checklist?", null, clarify("Select an existing project team member.", owners));
}

function planTaskTransfer(context: LocalContext, taskId: string) {
  const project = context.request.project; const sourceId = context.state.currentUserGoal?.context.sourceId; const targetId = context.state.currentUserGoal?.context.targetId;
  const source = project.team.find((member) => member.id === sourceId); const target = project.team.find((member) => member.id === targetId); const task = project.tasks.find((item) => item.id === taskId);
  if (!source || !target || !task || task.owner !== source.name) throw new Error("The selected task or team member changed. Ask Ali to investigate the transfer again.");
  call(context, "inspect_task", { taskId }); call(context, "analyze_capacity");
  const available = Math.max(0, 100 - target.allocation); const desired = Math.max(0, source.allocation - 100) || Math.min(10, source.allocation); const amount = Math.min(available, desired);
  if (amount <= 0) return response(context, `${target.name} has no recorded capacity for a safe transfer. Add capacity, reduce scope, or choose another person; I will not invent availability.`, null, clarify("What should I investigate next?", [{ id: "reduce-scope", label: "Reduce non-critical scope" }, { id: "capacity", label: "Review other available people" }]));
  const reason = `Transfer ${task.title} from ${source.name} to ${target.name} and move ${amount}% recorded allocation using current capacity data.`;
  const changes = [
    { actionType: "task_update", entityId: task.id, field: "owner", value: target.name, reason, expectedImpact: "Moves accountability to the selected existing team member." },
    { actionType: "allocation_change", entityId: source.id, field: "allocation", value: String(source.allocation - amount), reason, expectedImpact: "Reduces the source member's recorded workload." },
    { actionType: "allocation_change", entityId: target.id, field: "allocation", value: String(target.allocation + amount), reason, expectedImpact: "Adds only recorded available capacity to the destination member." }
  ];
  const created = call(context, "propose_recovery_plan", { title: `Move ${task.title} to ${target.name}`, reason, changes }); const proposal = created.proposal; if (!proposal) throw new Error("Transfer plan was not created."); call(context, "simulate_changes", { proposalId: proposal.id });
  return response(context, "I prepared a combined ownership and allocation plan based on the selected task and recorded capacity. Nothing has changed yet.", proposal);
}

function continueConversation(context: LocalContext, message: string): AgentResponse | null {
  const pending = context.state.pendingClarification;
  if (context.state.phase !== "NEEDS_CLARIFICATION" || !pending || !context.state.currentUserGoal) return null;
  const currentGoal = context.state.currentUserGoal;
  const selected = selectedClarificationOptions(message, pending);
  if (!selected.length) return response(context, `I still need your answer to continue: ${pending.question}`, null, pending);
  context.state = { ...context.state, phase: "PLANNING", pendingClarification: null, selectedOptions: [...context.state.selectedOptions, ...selected.map((option) => ({ clarificationId: pending.id, optionId: option.id, label: option.label }))] };
  const intent = currentGoal.intent; const choice = selected[0].id;
  if (intent === "fix_project_area") return choice === "budget-capacity" ? planBudgetAndCapacity(context) : recoveryPlan(context);
  if (intent === "budget_strategy") return planBudgetChoice(context, choice);
  if (intent === "task_transfer") return planTaskTransfer(context, choice);
  if (intent === "estimate_validation_owner") {
    const member = context.request.project.team.find((item) => item.id === choice); if (!member) throw new Error("The selected checklist owner no longer exists.");
    context.state = { ...context.state, phase: "NEEDS_CLARIFICATION", currentUserGoal: goal(currentGoal.text, "estimate_validation_due", { ownerId: member.id }) };
    const tomorrow = addDays(context.request.currentDate.slice(0, 10), 1); const nextWeek = addDays(context.request.currentDate.slice(0, 10), 7);
    return response(context, `When should ${member.name}'s validation checklist be due?`, null, clarify("Select a checklist due date.", [{ id: tomorrow, label: `${tomorrow} · tomorrow` }, { id: nextWeek, label: `${nextWeek} · one week` }]));
  }
  if (intent === "estimate_validation_due") {
    const member = context.request.project.team.find((item) => item.id === currentGoal.context.ownerId); if (!member || !validDate(choice)) throw new Error("The checklist owner or due date is no longer valid.");
    call(context, "analyze_budget"); const items = ["Validate remaining task estimates", "Confirm scope and assumptions", "Review forecast with project owner"].map((title) => ({ title, owner: member.name, dueDate: choice, estimatedHours: 2, critical: false }));
    const created = call(context, "propose_checklist", { title: "Estimate-validation checklist", reason: "Improve forecast evidence before committing to a revised budget plan.", items }); if (created.proposal) call(context, "simulate_changes", { proposalId: created.proposal.id });
    return response(context, "I prepared the validation checklist with the owner and due date you selected. Review it before approval.", created.proposal);
  }
  return null;
}

export function runLocalAgent(request: AgentRequest, fallbackReason?: string): AgentResponse {
  const effective = contextualMessage(request); const state = structuredClone(request.agentState ?? emptyAgentConversationState()); const context: LocalContext = { request: { ...request, message: effective, agentState: state }, trace: [], evidence: [], proposals: [], state, fallbackReason }; const project = request.project; const message = normalize(effective); const analysis = analyzeProject(project, new Date(request.currentDate)); const fallback = fallbackReason ? ` Model mode failed, so the local agent completed this run safely (${fallbackReason}).` : "";
  try {
    const continued = continueConversation(context, effective); if (continued) return continued;
    if (context.state.phase === "AWAITING_CONFIRMATION" && context.state.pendingApprovalProposal && /^(do that|yes|go ahead|approve it|approve plan)$/.test(message)) {
      return response(context, "The pending plan is the unambiguous action in context. It still requires the application’s explicit approval control before any project data changes.", context.state.pendingApprovalProposal);
    }
    if (context.state.phase === "AWAITING_CONFIRMATION" && /\b(modify|change the plan|revise)\b/.test(message)) {
      context.state = { ...context.state, phase: "IDLE", pendingPlan: null, pendingApprovalProposal: null, currentUserGoal: goal(effective, "modify_plan") };
      return response(context, "I set the pending plan aside. Tell me the exact task, person, value, or date you want changed, and I will investigate and build a revised proposal.");
    }
    if (/^(do that|fix it|the first option|the second option|actually do the second option)$/.test(message) && !context.state.pendingClarification && !context.state.pendingApprovalProposal) {
      context.state = { ...context.state, currentUserGoal: goal(effective, "unclear_reference") };
      return response(context, "What does that refer to? I do not have an unambiguous pending choice or plan.", null, clarify("Choose what you want me to do.", [{ id: "top-risk", label: "Investigate the current top risk" }, { id: "recovery-plan", label: "Create a recovery plan" }]));
    }
    if (/\b(fix this project|fix the project|help me fix this|make this project healthy)\b/.test(message)) {
      context.state = { ...context.state, phase: "INVESTIGATING", currentUserGoal: goal(effective, "fix_project_area"), selectedOptions: [], pendingPlan: null, pendingApprovalProposal: null };
      call(context, "get_project_overview"); call(context, "get_health_findings");
      return response(context, "I found several possible recovery directions. Which area should I tackle first?", null, clarify("Which area should the recovery plan tackle?", [{ id: "budget-capacity", label: "Budget and capacity" }, { id: "schedule-blockers", label: "Schedule and blockers" }, { id: "quality-delivery", label: "Quality and delivery" }]));
    }
    if (/\b(fix|resolve|address)\b.*\b(budget|overrun|cost)\b|\bbudget issue\b/.test(message) && !/\b(reforecast|scope|estimate|budget to|budget at)\b/.test(message)) {
      context.state = { ...context.state, phase: "INVESTIGATING", currentUserGoal: goal(effective, "budget_strategy"), selectedOptions: [], pendingPlan: null, pendingApprovalProposal: null };
      call(context, "analyze_budget");
      return response(context, "There are three materially different budget responses. Which one should I plan?", null, clarify("Reforecast budget, reduce scope, or validate estimates?", [{ id: "reforecast", label: "Reforecast budget" }, { id: "reduce-scope", label: "Reduce scope" }, { id: "validate-estimate", label: "Validate remaining estimates" }]));
    }
    if (/\bmove work from\b/.test(message)) {
      const transfer = effective.match(/move work from\s+(.+?)\s+to\s+(.+)$/i); const sources = transfer ? memberCandidates(project, transfer[1]) : []; const targets = transfer ? memberCandidates(project, transfer[2]) : [];
      if (sources.length !== 1 || targets.length !== 1 || sources[0].id === targets[0].id) return response(context, "Which exact source and destination team members should I use?", null, clarify("Select a person, then restate the transfer with both exact names.", project.team.map((member) => ({ id: member.id, label: `${member.name} · ${member.role} · ${member.allocation}%` }))));
      context.state = { ...context.state, phase: "INVESTIGATING", currentUserGoal: goal(effective, "task_transfer", { sourceId: sources[0].id, targetId: targets[0].id }), selectedOptions: [], pendingPlan: null, pendingApprovalProposal: null };
      call(context, "analyze_capacity"); const listed = call(context, "list_tasks", { filter: "incomplete", assignee: sources[0].name }); const candidates = (listed.output.tasks as ProjectTask[]).filter((task) => task.owner === sources[0].name);
      if (!candidates.length) return response(context, `${sources[0].name} has no active task recorded for transfer. I cannot invent work to move.`);
      if (candidates.length === 1) return planTaskTransfer(context, candidates[0].id);
      return response(context, `I found ${candidates.length} active tasks owned by ${sources[0].name}. Which task should move to ${targets[0].name}?`, null, clarify("Select the task to transfer.", candidates.map((task) => ({ id: task.id, label: `${task.title} · ${task.status} · ${task.estimatedHours}h` }))));
    }
    context.state = { ...context.state, phase: "INVESTIGATING", currentUserGoal: goal(effective, "natural_request"), investigationFindings: [], selectedOptions: [], pendingClarification: null, pendingPlan: null, pendingApprovalProposal: null, error: null };
    if (/\b(what can you do|help|capabilities|supported commands)\b/.test(message)) return response(context, "I can investigate project health; reforecast budget or progress; create, update, defer, restore, reassign, or delete tasks through approval; adjust or rebalance allocations; move dates; build checklists and recovery plans; reject proposals; verify applied changes; and undo the latest safe Ali action.");
    if (/\b(reassess|briefing|health briefing|recovery plan|recovery sequence|turnaround plan)\b/.test(message) && /recovery|turnaround/.test(message)) return recoveryPlan(context);

    if (/\b(reforecast|update approved budget|fix the budget|budget issue|overrun)\b/.test(message) && /\b(fix|reforecast|update|do|about)\b/.test(message)) {
      const result = call(context, "analyze_budget"); const explicitBudget = effective.match(/(?:budget|approved budget)\s+(?:to|at)\s*[€$£]?\s*(\d+(?:\.\d+)?)\s*(k)?/i); const forecast = explicitBudget ? Number(explicitBudget[1]) * (explicitBudget[2] ? 1000 : 1) : result.output.projectedFinalCost;
      if (typeof forecast !== "number") return response(context, "I cannot reforecast safely because actual progress is 0% or missing. What revised actual progress should I use?", null, clarify("What revised actual progress should I use?", [{ id: "25", label: "25%" }, { id: "50", label: "50%" }, { id: "75", label: "75%" }]));
      const created = call(context, "propose_budget_change", { budget: Math.ceil(forecast / 100) * 100, reason: `Reforecast from ${money(project.spent, project)} spent at ${project.progress}% actual progress.` });
      return response(context, `I projected the final cost at ${money(forecast, project)} and prepared a budget reforecast. This aligns the approved budget with the forecast; it does not reduce actual cost.${fallback}`, created.proposal);
    }

    if (/\b(actual progress|progress to|record revised progress|set progress)\b/.test(message)) {
      const percent = effective.match(/(\d+(?:\.\d+)?)\s*%/); if (!percent) return response(context, "What revised actual progress percentage should I record?", null, clarify("Choose or enter revised actual progress.", [{ id: "25", label: "25%" }, { id: "50", label: "50%" }, { id: "75", label: "75%" }]));
      call(context, "get_project_overview"); const created = call(context, "propose_project_update", { field: "progress", value: percent[1], reason: `User supplied revised actual progress (${project.progress}% → ${percent[1]}%).` }); return response(context, "I prepared a progress correction for approval. No data has changed yet.", created.proposal);
    }

    if (/\b(estimate validation|estimate-validation|validation checklist|estimate checklist)\b/.test(message)) {
      const members = memberCandidates(project, effective); if (members.length !== 1) return response(context, "Who should own the estimate-validation checklist? I need an existing team member.", null, clarify("Select the checklist owner.", project.team.map((member) => ({ id: member.id, label: `${member.name} · ${member.role}` }))));
      const dueDate = requestedDate(effective, request.currentDate); if (!dueDate) return response(context, "What due date should the checklist tasks use?", null, clarify("Choose or enter a due date.", [{ id: addDays(request.currentDate.slice(0, 10), 1), label: `${addDays(request.currentDate.slice(0, 10), 1)} · tomorrow` }, { id: addDays(request.currentDate.slice(0, 10), 7), label: `${addDays(request.currentDate.slice(0, 10), 7)} · one week` }]));
      call(context, "analyze_budget"); const items = ["Validate remaining task estimates", "Confirm scope and assumptions", "Review forecast with project owner"].map((title) => ({ title, owner: members[0].name, dueDate, estimatedHours: 2, critical: false })); const created = call(context, "propose_checklist", { title: "Estimate-validation checklist", reason: "Improve forecast evidence before committing to a revised plan.", items }); return response(context, "I prepared three explicit validation tasks. Creating them requires approval; their score effect is not meaningfully predictable.", created.proposal);
    }

    if (/\b(defer|cut scope|restore deferred|restore scope)\b/.test(message)) {
      const restoring = /restore/.test(message); const eligible = restoring ? project.tasks.filter((task) => task.status === "deferred") : project.tasks.filter((task) => !task.critical && !["done", "deferred"].includes(task.status)); const matches = taskCandidates({ ...project, tasks: eligible }, effective);
      const candidates = matches.length ? matches : eligible;
      if (candidates.length !== 1) return response(context, candidates.length ? `Which ${restoring ? "deferred" : "non-critical"} task should I ${restoring ? "restore" : "defer"}?` : `There are no ${restoring ? "deferred" : "active non-critical"} tasks I can change safely.`, null, candidates.length ? clarify("Select the exact task.", candidates.map((task) => ({ id: task.id, label: `${task.title} · ${task.status}` }))) : null);
      const task = candidates[0]; call(context, "inspect_task", { taskId: task.id }); const status = restoring ? "not-started" : "deferred"; const created = call(context, "propose_task_update", { taskId: task.id, field: "status", value: status, reason: restoring ? "Restore previously deferred scope to the active backlog." : "Defer selected non-critical scope; this does not count as completed work." }); return response(context, `I prepared an approval-gated ${restoring ? "scope restoration" : "scope deferral"}.`, created.proposal);
    }

    if (/\b(create|add)\b.*\b(task|follow-up)\b/.test(message)) {
      const members = memberCandidates(project, effective); if (members.length !== 1) return response(context, "Who should own the new task? I will not invent a person.", null, clarify("Choose an existing project team member.", project.team.map((member) => ({ id: member.id, label: `${member.name} · ${member.role}` }))));
      const dueDate = requestedDate(effective, request.currentDate); if (!dueDate) return response(context, "What due date should the new task have?", null, clarify("Choose or enter a due date.", [{ id: addDays(request.currentDate.slice(0, 10), 1), label: `${addDays(request.currentDate.slice(0, 10), 1)} · tomorrow` }, { id: addDays(request.currentDate.slice(0, 10), 7), label: `${addDays(request.currentDate.slice(0, 10), 7)} · one week` }]));
      const title = effective.match(/(?:task|follow-up)\s+(?:for|to)\s+(.+?)(?:\s+(?:tomorrow|by|due|assigned|owner)|$)/i)?.[1]?.trim() ?? "Follow-up action"; const estimate = Number(effective.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?/i)?.[1] ?? 8);
      const created = call(context, "propose_task_create", { title, owner: members[0].name, dueDate, estimatedHours: estimate, critical: /critical/.test(message), reason: "User requested an explicit follow-up task." }); return response(context, `I prepared a new task with explicit owner, due date, and estimate. It will only exist after approval.`, created.proposal);
    }

    if (/\bdelete\b.*\btask\b/.test(message)) {
      const matches = taskCandidates(project, effective); if (matches.length !== 1) return response(context, "Which exact task should be deleted? Consider deferring it if the work may return.", null, clarify("Select the exact task.", project.tasks.map((task) => ({ id: task.id, label: `${task.title} · ${task.status}` })))); const task = matches[0]; call(context, "inspect_task", { taskId: task.id }); const created = call(context, "propose_task_delete", { taskId: task.id, reason: "User explicitly requested permanent task deletion." }); return response(context, "I prepared a prominent deletion proposal. Nothing has been removed yet.", created.proposal);
    }

    if (/\b(estimate|estimated hours)\b/.test(message) && /\b(set|add|update|correct|change|record)\b/.test(message)) {
      const tasks = taskCandidates(project, effective); if (tasks.length !== 1) return response(context, "Which exact task estimate should I update?", null, clarify("Select the task.", project.tasks.map((task) => ({ id: task.id, label: `${task.title} · ${task.estimatedHours}h estimated` }))));
      const hours = effective.match(/(\d+(?:\.\d+)?)\s*(?:h|hours?)\b/i)?.[1] ?? effective.match(/estimate(?:d hours)?\s+(?:to|at)\s+(\d+(?:\.\d+)?)/i)?.[1];
      if (!hours) return response(context, `What non-negative estimate should I record for ${tasks[0].title}?`, null, clarify("Choose or enter estimated hours.", [{ id: "4", label: "4 hours" }, { id: "8", label: "8 hours" }, { id: "16", label: "16 hours" }]));
      call(context, "inspect_task", { taskId: tasks[0].id }); const created = call(context, "propose_task_update", { taskId: tasks[0].id, field: "estimatedHours", value: hours, blocker: null, reason: `User supplied a revised estimate (${tasks[0].estimatedHours}h → ${hours}h).` }); return response(context, "I prepared an estimate correction for approval. No task data has changed yet.", created.proposal);
    }

    if (/\b(assign|reassign|change owner)\b/.test(message) || /\b(set|add)\b.*\bowner\b/.test(message)) {
      const tasks = taskCandidates(project, effective); const members = memberCandidates(project, effective); if (tasks.length !== 1) return response(context, "Which exact task should be reassigned?", null, clarify("Select the task.", project.tasks.map((task) => ({ id: task.id, label: task.title })))); if (members.length !== 1) return response(context, "Which existing team member should own it?", null, clarify("Select the new owner.", project.team.map((member) => ({ id: member.id, label: `${member.name} · ${member.role}` })))); call(context, "inspect_task", { taskId: tasks[0].id }); call(context, "analyze_capacity"); const created = call(context, "propose_task_update", { taskId: tasks[0].id, field: "owner", value: members[0].name, reason: `Reassign to existing team member ${members[0].name} after checking recorded capacity.` }); return response(context, "I checked the task and team data and prepared a reassignment proposal.", created.proposal);
    }

    if (/\bmove work from\b|\brebalance\b/.test(message)) {
      const members = memberCandidates(project, effective); if (members.length !== 2) return response(context, "Which two existing team members should participate in the rebalance?", null, clarify("Select or name two team members.", project.team.map((member) => ({ id: member.id, label: `${member.name} · ${member.allocation}%` })))); call(context, "analyze_capacity"); const from = members[0]; const to = members[1]; const amount = Math.max(0, from.allocation - 100) || 10; if (to.allocation + amount > 100) return response(context, `${to.name} has only ${Math.max(0, 100 - to.allocation)}% recorded capacity, which is not enough for a safe ${amount}% transfer. Consider adding capacity or reducing scope; I will not invent availability.`); const created = call(context, "propose_allocation_rebalance", { fromMemberId: from.id, fromAllocation: from.allocation - amount, toMemberId: to.id, toAllocation: to.allocation + amount, reason: `Move ${amount}% recorded allocation from ${from.name} to ${to.name}.` }); return response(context, "I used only recorded capacity and prepared a two-person rebalance proposal.", created.proposal);
    }

    if (/\b(allocation|allocated|capacity|set\s+\w+\s+to)\b/.test(message) && /\b(change|reduce|set|lower|increase)\b/.test(message)) {
      let members = memberCandidates(project, effective); if (!members.length && /highest overloaded/.test(message)) members = [...project.team].filter((member) => member.allocation > 100).sort((a, b) => b.allocation - a.allocation).slice(0, 1); if (members.length !== 1) { const options = members.length > 1 ? members : project.team; return response(context, "Whose allocation should I change?", null, clarify("Select the exact team member.", options.map((member) => ({ id: member.id, label: `${member.name} · ${member.allocation}%` })))); } const percent = effective.match(/(\d+(?:\.\d+)?)\s*%/); if (!percent && !/highest overloaded/.test(message)) return response(context, `What allocation should I set for ${members[0].name}?`, null, clarify("Choose or enter an allocation.", [{ id: "95", label: "95%" }, { id: "100", label: "100%" }])); const allocation = percent ? Number(percent[1]) : 100; call(context, "analyze_capacity"); const created = call(context, "propose_allocation_change", { memberId: members[0].id, allocation, reason: `Requested change after checking current capacity (${members[0].allocation}% → ${allocation}%).` }); return response(context, `I prepared an allocation proposal for ${members[0].name}; no data changed yet.`, created.proposal);
    }

    const projectDeadlineIntent = /\b(project deadline|delivery date|move the deadline|deadline by|deadline forward|deadline back)\b/.test(message);
    if (projectDeadlineIntent) { call(context, "analyze_schedule"); const deadline = requestedDate(effective, request.currentDate, project.deadline); if (!deadline) return response(context, "What valid new project deadline should I propose?", null, clarify("Choose or enter a deadline.", validDate(project.deadline) ? [{ id: addDays(project.deadline, 7), label: `${addDays(project.deadline, 7)} · +1 week` }, { id: addDays(project.deadline, 14), label: `${addDays(project.deadline, 14)} · +2 weeks` }] : [])); const conflicts = project.tasks.filter((task) => !["done", "deferred"].includes(task.status) && validDate(task.dueDate) && task.dueDate > deadline); const created = call(context, "propose_deadline_change", { deadline, reason: `Planning decision after inspecting the ${analysis.metrics.scheduleGap}pp schedule gap.${conflicts.length ? ` ${conflicts.length} active task due dates would fall after the new deadline.` : ""}` }); return response(context, `I prepared a project deadline proposal. ${conflicts.length ? `Conflict: ${conflicts.map((task) => task.title).join(", ")} would be due after the new deadline. ` : ""}Moving the date does not fix underlying work by itself.`, created.proposal); }

    if (/\b(push|move|change|set|add)\b.*\b(task|qa|design|approval|integration|catalogue|tracking|due date)\b/.test(message) && /\b(friday|tomorrow|due|date|week|20\d{2})\b/.test(message)) { const tasks = taskCandidates(project, effective); if (tasks.length !== 1) return response(context, "Which exact task date should I change?", null, clarify("Select the task.", project.tasks.map((task) => ({ id: task.id, label: `${task.title} · ${task.dueDate || "due date missing"}` })))); const dueDate = requestedDate(effective, request.currentDate, tasks[0].dueDate); if (!dueDate) return response(context, "What valid due date should I use?"); call(context, "inspect_task", { taskId: tasks[0].id }); call(context, "analyze_schedule"); const outsideProject = validDate(project.deadline) && dueDate > project.deadline; const created = call(context, "propose_task_update", { taskId: tasks[0].id, field: "dueDate", value: dueDate, blocker: null, reason: `Requested date change after inspecting task and schedule conflicts.${outsideProject ? " The new task date is after the project deadline." : ""}` }); return response(context, `I prepared a task-date proposal.${outsideProject ? " Conflict: this date falls after the current project deadline." : ""}`, created.proposal); }

    const taskAction = /\b(mark|set|change|unmark|unblock|block|update|resolve|defer|restore)\b/.test(message) && /\b(done|complete|completed|blocked|unblocked|in progress|not started|deferred|blocker|critical|non-critical)\b/.test(message);
    if (taskAction) { const matches = taskCandidates(project, effective); if (matches.length !== 1) return response(context, "Which exact task should I update?", null, clarify("Select the exact task.", project.tasks.map((task) => ({ id: task.id, label: `${task.title} · ${task.status}` })))); const task = matches[0]; call(context, "inspect_task", { taskId: task.id }); if (/critical|non-critical/.test(message)) { const critical = !/non-critical|not critical/.test(message); const created = call(context, "propose_task_update", { taskId: task.id, field: "critical", value: String(critical), blocker: null, reason: "User requested a critical-path correction." }); return response(context, "I prepared a critical-path flag proposal.", created.proposal); } const status = /resolve|unblock|unblocked/.test(message) ? "in-progress" : /restore/.test(message) ? "not-started" : taskStatusFromText(effective.match(/\b(not started|in progress|blocked|deferred|completed|complete|done)\b/)?.[1] ?? ""); if (!status) return response(context, `What status should I set for ${task.title}?`, null, clarify("Choose the status.", ["not-started", "in-progress", "blocked", "deferred", "done"].map((value) => ({ id: value, label: value })))); const blocker = status === "blocked" ? effective.match(/\bbecause\s+(.+)$/i)?.[1]?.trim() ?? "" : null; if (status === "blocked" && !blocker) return response(context, `Why is ${task.title} blocked? I need the blocker evidence before proposing the status change.`); const created = call(context, "propose_task_update", { taskId: task.id, field: "status", value: status, blocker, reason: `Requested status update after inspecting the live task (${task.status} → ${status}).` }); return response(context, `I prepared a status proposal for ${task.title}. Resolving a blocker records it as in progress, not completed.`, created.proposal); }

    if (/\b(critical tasks|critical work)\b/.test(message)) { const result = call(context, "list_tasks", { filter: "critical", assignee: null }); const tasks = result.output.tasks as ProjectTask[]; return response(context, tasks.length ? `Critical tasks: ${tasks.map((task) => `${task.title} (${task.status})`).join("; ")}.` : "No tasks are marked critical."); }
    if (/\boverdue\b/.test(message)) { const result = call(context, "list_tasks", { filter: "overdue", assignee: null }); const tasks = result.output.tasks as ProjectTask[]; return response(context, tasks.length ? `${tasks.length} overdue tasks: ${tasks.map((task) => `${task.title} (${task.dueDate})`).join("; ")}.` : "No active tasks with valid dates are overdue."); }
    if (/\b(blocker|blocked)\b/.test(message)) { const result = call(context, "list_tasks", { filter: "blocked", assignee: null }); const tasks = result.output.tasks as ProjectTask[]; if (tasks[0]) call(context, "inspect_task", { taskId: tasks[0].id }); return response(context, tasks.length ? `${tasks.length} blocked tasks. Highest priority: ${tasks[0].title}${tasks[0].critical ? " on the critical path" : ""} — ${tasks[0].blocker || "blocker reason missing"}.` : "No task is marked blocked."); }
    if (/\b(budget|cost|spend|overrun|burn)\b/.test(message)) { const result = call(context, "analyze_budget"); const projected = result.output.projectedFinalCost; return response(context, typeof projected === "number" ? `Current burn projects ${money(projected, project)} final cost against ${money(project.budget, project)} approved budget. This is a forecast, not a guarantee.${fallback}` : `I cannot calculate a reliable final-cost forecast until actual progress is above 0%.${fallback}`); }
    if (/\b(schedule|deadline|late|behind|timeline)\b/.test(message)) { const result = call(context, "analyze_schedule"); return response(context, `${project.progress}% actual versus ${project.plannedProgress}% planned, with ${analysis.metrics.overdueTasks} overdue tasks. ${result.output.evidenceSufficient ? "The recorded deadline is valid." : "The project deadline is missing or invalid, so evidence is insufficient."}${fallback}`); }
    if (/\b(capacity|overload|overloaded|who is overloaded|allocation)\b/.test(message)) { call(context, "analyze_capacity"); const overloaded = project.team.filter((member) => member.allocation > 100); return response(context, overloaded.length ? `Overloaded: ${overloaded.map((member) => `${member.name} at ${member.allocation}%`).join(", ")}.` : project.team.length ? "No recorded allocation exceeds 100%." : "There is no team data, so I cannot assess capacity."); }
    if (/\b(quality|defect|readiness)\b/.test(message)) { call(context, "analyze_quality"); return response(context, `Quality confidence is ${project.qualityScore}/100. ${project.qualityScore < 65 ? "This is below the health threshold." : "Blocked and overrun tasks still matter even when the quality score is above threshold."}`); }
    if (/\b(fix first|first priority|biggest risk|highest.priority|most important|what should i fix)\b/.test(message)) { call(context, "get_health_findings"); const top = analysis.risks[0]; call(context, riskTool(top.category)); return response(context, `Prioritise ${top.title.toLowerCase()}: ${top.summary} ${top.recommendation}`); }
    if (/\b(why|at risk|health score|what is wrong|explain.*risk|risk)\b/.test(message)) { call(context, "get_project_overview"); call(context, "get_health_findings"); for (const risk of analysis.risks.slice(0, 3)) { const tool = riskTool(risk.category); if (!context.trace.some((item) => item.tool === tool)) call(context, tool); } return response(context, `${project.name} is ${analysis.status} at ${analysis.score}/100 because ${analysis.risks.slice(0, 3).map((risk) => `${risk.title.toLowerCase()} — ${risk.summary}`).join("; ")}.`); }
    if (/\b(reassess|briefing|what changed)\b/.test(message)) { call(context, "get_project_overview"); call(context, "get_health_findings"); const lastChange = /what changed/.test(message) ? [...request.history].reverse().find((item) => item.role === "assistant" && /applied and verified|undone|restored/i.test(item.text))?.text : null; return response(context, `${lastChange ? `${lastChange} ` : ""}${project.name} is now ${analysis.status} at ${analysis.score}/100. Leading finding: ${analysis.risks[0].title} — ${analysis.risks[0].summary}`); }
    if (/^(do that|fix it|go ahead|yes|approve it|reject it|no reject it|undo|undo that)$/.test(message)) return response(context, "I need an active proposal or undo entry for that control command. Use the visible Approve, Reject, or Undo control, or tell me which finding you want changed.");
    call(context, "get_project_overview"); call(context, "get_health_findings"); return response(context, `${project.name} is ${analysis.status} at ${analysis.score}/100. I did not detect a safe action request, so I only inspected the project. Ask what to fix, name an exact task/person, or ask for a recovery plan.`);
  } catch (error) { const detail = error instanceof Error ? error.message : "invalid request"; context.state = { ...context.state, phase: "ERROR", error: detail }; return response(context, `I could not complete that safely: ${detail}. No project data changed. Tell me whether to reassess, choose another option, or cancel the plan.`); }
}
