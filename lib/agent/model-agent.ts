import { analyzeProject } from "@/lib/analyze";
import { agentToolDefinitions, executeAgentTool, isToolName } from "./tools";
import type { AgentClarification, AgentConversationState, AgentEvidence, AgentProposal, AgentRequest, AgentResponse, AgentToolTrace, ToolName } from "./types";

type ResponseContent = { type?: string; text?: string };
type ResponseItem = {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: ResponseContent[];
  [key: string]: unknown;
};
type OpenAIResponse = { output?: ResponseItem[]; output_text?: string; error?: { message?: string } };

const readTools = new Set<ToolName>(["get_project_overview", "analyze_budget", "analyze_schedule", "analyze_capacity", "list_tasks", "inspect_task", "analyze_quality", "get_health_findings"]);
const proposalTools = new Set<ToolName>(["propose_task_update", "propose_task_create", "propose_task_delete", "propose_allocation_change", "propose_allocation_rebalance", "propose_deadline_change", "propose_budget_change", "propose_project_update", "propose_checklist", "propose_recovery_plan"]);

function textFrom(response: OpenAIResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

async function createResponse(apiKey: string, body: Record<string, unknown>): Promise<OpenAIResponse> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json() as OpenAIResponse;
  if (!response.ok) throw new Error(payload.error?.message ?? `OpenAI request failed (${response.status})`);
  return payload;
}

const uniqueEvidence = (items: AgentEvidence[]) => items.filter((item, index) => items.findIndex((candidate) => candidate.label === item.label && candidate.value === item.value) === index).slice(0, 10);
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();

function resolvedPendingOption(request: AgentRequest) {
  const pending = request.agentState.pendingClarification; if (!pending) return null;
  const text = normalized(request.message); const ordinal = text.match(/\b(first|second|third|fourth|fifth|sixth)\b/)?.[1]; const index = ordinal ? ["first", "second", "third", "fourth", "fifth", "sixth"].indexOf(ordinal) : -1;
  if (index >= 0) return pending.options[index] ?? null;
  return pending.options.find((option) => { const label = normalized(option.label); return text === normalized(option.id) || text.includes(label) || (text.length > 3 && label.includes(text)); }) ?? null;
}

export async function runModelAgent(request: AgentRequest, apiKey: string, model: string): Promise<AgentResponse> {
  const analysis = analyzeProject(request.project, new Date(request.currentDate));
  const trace: AgentToolTrace[] = [];
  const evidence: AgentEvidence[] = [];
  const proposals: AgentProposal[] = request.pendingProposal ? [request.pendingProposal] : [];
  let selectedProposal: AgentProposal | null = null;
  let readCount = 0;
  let toolCallCount = 0;
  let message = "";
  let selectedClarification: AgentClarification | null = null;

  const history = request.history.slice(-8).filter((item) => item.role !== "system").map((item) => ({ role: item.role, content: item.text }));
  const input: Array<Record<string, unknown>> = [
    ...history,
    { role: "user", content: `Current date: ${request.currentDate.slice(0, 10)}\nCurrent project: ${request.project.name} (${request.project.id})\nConversation phase: ${request.agentState.phase}\nCurrent goal: ${request.agentState.currentUserGoal?.text ?? "none"}\nPending clarification: ${request.agentState.pendingClarification?.question ?? "none"}\nPending options: ${request.agentState.pendingClarification?.options.map((option) => `${option.id}=${option.label}`).join("; ") || "none"}\nSelected options: ${request.agentState.selectedOptions.slice(-4).map((option) => option.label).join(", ") || "none"}\nUser request: ${request.message}${request.pendingProposal ? `\nPending proposal ID: ${request.pendingProposal.id}` : ""}` }
  ];

  const instructions = `You are Ali, an evidence-grounded project-health agent. You investigate project data using tools. Do not invent facts. You cannot directly mutate data. For any write, create a structured proposal and wait for explicit user approval. Ask a focused clarification question when the user’s goal or choice is ambiguous. After an approved action, verify the outcome with tools and explain remaining risks.
Treat the supplied conversation phase, current goal, pending clarification, selected options, and recent messages as durable multi-turn context. Resolve “do that”, ordinals, and short answers against that context. Use request_clarification whenever options should be clickable.
For questions, select the fewest relevant read tools. For broad briefings or risk explanations, inspect multiple relevant dimensions. For recovery plans, inspect budget, schedule, capacity, quality, and deterministic findings, rank the risks, propose no more than three interventions, then call simulate_changes.
Never claim a change is applied. Any requested mutation—including task creation/deletion, deferral/restoration, owner/date/status/estimate changes, budget/progress changes, deadline changes, or allocation/rebalance—must first inspect relevant live data and then use a proposal tool. The application owns validation and approval. Use exact stable IDs returned by tools. Never invent a person, date, estimate, availability, or missing fact. Ask one precise clarification question when information or references are ambiguous. Increasing budget does not reduce actual cost; moving a deadline does not resolve underlying work. Simulations are forecasts, never guarantees.
Keep the final answer professional and under 150 words. Explain the most material evidence and what the user can do next.`;

  agentLoop: for (let round = 0; round < 9 && toolCallCount < 8; round += 1) {
    const response = await createResponse(apiKey, { model, instructions, tools: agentToolDefinitions, input, tool_choice: "auto", store: false });
    input.push(...(response.output ?? []).map((item) => item as Record<string, unknown>));
    const calls = (response.output ?? []).filter((item) => item.type === "function_call" && typeof item.name === "string" && typeof item.call_id === "string");
    if (!calls.length) {
      message = textFrom(response);
      break;
    }
    for (const item of calls) {
      if (toolCallCount >= 8) break;
      toolCallCount += 1;
      const nameValue = item.name ?? "";
      const callId = item.call_id ?? "";
      if (!isToolName(nameValue)) {
        input.push({ type: "function_call_output", call_id: callId, output: JSON.stringify({ error: "Unknown tool." }) });
        continue;
      }
      let args: unknown = {};
      try { args = item.arguments ? JSON.parse(item.arguments) as unknown : {}; } catch { args = {}; }
      if (proposalTools.has(nameValue) && readCount === 0) {
        const summary = "Proposal refused until live project evidence is inspected.";
        trace.push({ tool: nameValue, arguments: typeof args === "object" && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {}, summary, result: { error: summary } });
        input.push({ type: "function_call_output", call_id: callId, output: JSON.stringify({ error: summary }) });
        continue;
      }
      try {
        const result = executeAgentTool(nameValue, args, request.project, request.currentDate, proposals);
        if (readTools.has(nameValue)) readCount += 1;
        trace.push({ tool: nameValue, arguments: typeof args === "object" && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {}, summary: result.summary, result: result.output });
        evidence.push(...result.evidence);
        if (result.proposal) {
          proposals.push(result.proposal);
          selectedProposal = result.proposal;
        }
        if (result.clarification) selectedClarification = result.clarification;
        input.push({ type: "function_call_output", call_id: callId, output: JSON.stringify(result.output) });
        if (result.clarification) { message = result.clarification.question; break agentLoop; }
      } catch (error) {
        const summary = error instanceof Error ? error.message : "Tool arguments were invalid.";
        trace.push({ tool: nameValue, arguments: typeof args === "object" && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {}, summary: `Rejected: ${summary}`, result: { error: summary } });
        input.push({ type: "function_call_output", call_id: callId, output: JSON.stringify({ error: summary }) });
      }
    }
  }

  if (!message) {
    message = selectedProposal
      ? `I investigated the current project and prepared “${selectedProposal.title}” for your review. No data has changed. The simulation is directional, so review the evidence and before/after values before approving.`
      : `${request.project.name} is ${analysis.status} at ${analysis.score}/100. I reached the safe tool-call limit; the leading deterministic finding is ${analysis.risks[0]?.title.toLowerCase() ?? "no immediate risk"}.`;
  }

  const findings = uniqueEvidence([...request.agentState.investigationFindings, ...evidence]); const resolvedOption = resolvedPendingOption(request);
  const pendingPlan = selectedProposal ? { id: crypto.randomUUID(), title: selectedProposal.title, summary: selectedProposal.reason, proposalId: selectedProposal.id, changeIds: selectedProposal.changes.map((change) => change.id), createdAt: new Date().toISOString() } : selectedClarification ? null : request.agentState.pendingPlan;
  const agentState: AgentConversationState = {
    ...request.agentState,
    phase: selectedClarification ? "NEEDS_CLARIFICATION" : selectedProposal ? "AWAITING_CONFIRMATION" : "IDLE",
    currentUserGoal: request.agentState.currentUserGoal ?? { text: request.message, intent: "model_request", context: {}, createdAt: new Date().toISOString() },
    investigationFindings: findings,
    pendingClarification: selectedClarification,
    selectedOptions: resolvedOption ? [...request.agentState.selectedOptions, { clarificationId: request.agentState.pendingClarification?.id ?? "unknown", optionId: resolvedOption.id, label: resolvedOption.label }] : request.agentState.selectedOptions,
    pendingPlan,
    pendingApprovalProposal: selectedProposal,
    toolTraces: [...request.agentState.toolTraces, ...trace].slice(-40),
    error: null
  };
  return { mode: "model", message, toolTrace: trace, evidence: uniqueEvidence(evidence), proposal: selectedProposal, clarification: selectedClarification, agentState };
}
