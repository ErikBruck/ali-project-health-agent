import { runLocalAgent } from "@/lib/agent/local-agent";
import { runModelAgent } from "@/lib/agent/model-agent";
import { validateProposal } from "@/lib/agent/proposals";
import { isToolName } from "@/lib/agent/tools";
import { emptyAgentConversationState } from "@/lib/agent/types";
import type { AgentClarification, AgentConversationState, AgentProposal, AgentRequest } from "@/lib/agent/types";
import type { Project } from "@/lib/types";
import { normalizeProject } from "@/lib/project-data";

function isProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.updatedAt === "string" && Array.isArray(item.tasks) && Array.isArray(item.team) && typeof item.budget === "number" && typeof item.progress === "number";
}

function parseClarification(value: unknown): AgentClarification | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const options = Array.isArray(raw.options) ? raw.options.flatMap((option) => {
    if (typeof option !== "object" || option === null || Array.isArray(option)) return [];
    const candidate = option as Record<string, unknown>;
    return typeof candidate.id === "string" && typeof candidate.label === "string" ? [{ id: candidate.id, label: candidate.label }] : [];
  }).slice(0, 8) : [];
  return typeof raw.question === "string" && options.length ? { id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(), question: raw.question, options, allowMultiple: raw.allowMultiple === true } : null;
}

function parseHistoryEntry(value: unknown): AgentRequest["history"][number] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if ((item.role !== "user" && item.role !== "assistant" && item.role !== "system") || typeof item.text !== "string") return null;
  const clarification = parseClarification(item.clarification) ?? undefined;
  return { role: item.role, text: item.text.slice(0, 4_000), clarification };
}

function parseAgentState(value: unknown, project: Project, pendingProposal: AgentProposal | null): AgentConversationState {
  const base = emptyAgentConversationState();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...base, pendingApprovalProposal: pendingProposal };
  const item = value as Record<string, unknown>; const phases = new Set(["IDLE", "INVESTIGATING", "NEEDS_CLARIFICATION", "PLANNING", "AWAITING_CONFIRMATION", "EXECUTING", "VERIFYING", "ERROR"]);
  const goalValue = typeof item.currentUserGoal === "object" && item.currentUserGoal !== null && !Array.isArray(item.currentUserGoal) ? item.currentUserGoal as Record<string, unknown> : null;
  const goalContext = goalValue && typeof goalValue.context === "object" && goalValue.context !== null && !Array.isArray(goalValue.context) ? Object.fromEntries(Object.entries(goalValue.context as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  const currentUserGoal = goalValue && typeof goalValue.text === "string" && typeof goalValue.intent === "string" ? { text: goalValue.text, intent: goalValue.intent, context: goalContext, createdAt: typeof goalValue.createdAt === "string" ? goalValue.createdAt : new Date().toISOString() } : null;
  const selectedOptions = Array.isArray(item.selectedOptions) ? item.selectedOptions.flatMap((value) => { if (typeof value !== "object" || value === null || Array.isArray(value)) return []; const option = value as Record<string, unknown>; return typeof option.clarificationId === "string" && typeof option.optionId === "string" && typeof option.label === "string" ? [{ clarificationId: option.clarificationId, optionId: option.optionId, label: option.label }] : []; }).slice(-20) : [];
  const findings = Array.isArray(item.investigationFindings) ? item.investigationFindings.flatMap((value) => { if (typeof value !== "object" || value === null || Array.isArray(value)) return []; const finding = value as Record<string, unknown>; return typeof finding.label === "string" && typeof finding.value === "string" && typeof finding.source === "string" ? [{ label: finding.label, value: finding.value, source: finding.source }] : []; }).slice(-20) : [];
  const planValue = typeof item.pendingPlan === "object" && item.pendingPlan !== null && !Array.isArray(item.pendingPlan) ? item.pendingPlan as Record<string, unknown> : null;
  const pendingPlan = planValue && typeof planValue.id === "string" && typeof planValue.title === "string" && typeof planValue.summary === "string" && typeof planValue.proposalId === "string" && Array.isArray(planValue.changeIds) && planValue.changeIds.every((id) => typeof id === "string") ? { id: planValue.id, title: planValue.title, summary: planValue.summary, proposalId: planValue.proposalId, changeIds: planValue.changeIds as string[], createdAt: typeof planValue.createdAt === "string" ? planValue.createdAt : new Date().toISOString() } : null;
  const toolTraces = Array.isArray(item.toolTraces) ? item.toolTraces.flatMap((value) => { if (typeof value !== "object" || value === null || Array.isArray(value)) return []; const trace = value as Record<string, unknown>; if (typeof trace.tool !== "string" || !isToolName(trace.tool) || typeof trace.summary !== "string") return []; const argumentsValue = typeof trace.arguments === "object" && trace.arguments !== null && !Array.isArray(trace.arguments) ? trace.arguments as Record<string, unknown> : {}; const result = typeof trace.result === "object" && trace.result !== null && !Array.isArray(trace.result) ? trace.result as Record<string, unknown> : {}; return [{ tool: trace.tool, arguments: argumentsValue, summary: trace.summary, result }]; }).slice(-40) : [];
  const lastApplied = typeof item.lastAppliedProposal === "object" && item.lastAppliedProposal !== null && (item.lastAppliedProposal as AgentProposal).projectId === project.id ? item.lastAppliedProposal as AgentProposal : null;
  return { ...base, phase: typeof item.phase === "string" && phases.has(item.phase) ? item.phase as AgentConversationState["phase"] : base.phase, currentUserGoal, investigationFindings: findings, pendingClarification: parseClarification(item.pendingClarification), selectedOptions, pendingPlan, pendingApprovalProposal: pendingProposal, lastAppliedProposal: lastApplied, toolTraces, error: typeof item.error === "string" ? item.error : null };
}

function parseRequest(value: unknown): AgentRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!isProject(item.project) || typeof item.message !== "string" || !item.message.trim() || item.message.length > 4_000 || typeof item.currentDate !== "string") return null;
  const project = normalizeProject(item.project);
  if (!project) return null;
  const history = Array.isArray(item.history) ? item.history.flatMap((entry) => { const parsed = parseHistoryEntry(entry); return parsed ? [parsed] : []; }).slice(-12) : [];
  let pendingProposal: AgentProposal | null = null;
  if (typeof item.pendingProposal === "object" && item.pendingProposal !== null) {
    try {
      const candidate = item.pendingProposal as AgentProposal;
      if (validateProposal(project, candidate).valid) pendingProposal = candidate;
    } catch { /* Malformed or stale client proposal context is ignored. */ }
  }
  const agentState = parseAgentState(item.agentState, project, pendingProposal);
  return { project, message: item.message.trim(), currentDate: item.currentDate, history, pendingProposal, agentState };
}

export async function POST(request: Request) {
  const payload = parseRequest(await request.json().catch(() => null));
  if (!payload) return Response.json({ error: "A valid project, message, history, and current date are required." }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) return Response.json(runLocalAgent(payload));

  try {
    return Response.json(await runModelAgent(payload, apiKey, model));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown model error";
    return Response.json(runLocalAgent(payload, reason));
  }
}
