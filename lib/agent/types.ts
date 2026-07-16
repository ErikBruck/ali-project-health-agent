import type { Project, ProjectTask, TaskStatus } from "@/lib/types";

export type AgentMode = "model" | "local";
export type AgentPhase = "IDLE" | "INVESTIGATING" | "NEEDS_CLARIFICATION" | "PLANNING" | "AWAITING_CONFIRMATION" | "EXECUTING" | "VERIFYING" | "ERROR";

export type ToolName =
  | "get_project_overview"
  | "analyze_budget"
  | "analyze_schedule"
  | "analyze_capacity"
  | "list_tasks"
  | "inspect_task"
  | "analyze_quality"
  | "get_health_findings"
  | "request_clarification"
  | "simulate_changes"
  | "propose_task_update"
  | "propose_task_create"
  | "propose_task_delete"
  | "propose_allocation_change"
  | "propose_allocation_rebalance"
  | "propose_deadline_change"
  | "propose_budget_change"
  | "propose_project_update"
  | "propose_checklist"
  | "propose_recovery_plan";

export type ProposalAction =
  | "task_update"
  | "task_create"
  | "task_delete"
  | "allocation_change"
  | "deadline_change"
  | "budget_change"
  | "project_update";

export type ProposalEntityType = "project" | "task" | "team_member";
export type ProposalValue = string | number | boolean | ProjectTask | null;
export type ProposalStatus = "pending" | "approved" | "rejected" | "stale" | "undone";

export type ProposalChange = {
  id: string;
  actionType: ProposalAction;
  entityType: ProposalEntityType;
  entityId: string;
  entityName: string;
  field: string;
  oldValue: ProposalValue;
  newValue: ProposalValue;
  reason: string;
  evidence: string[];
  expectedImpact: string;
  reversible: boolean;
};

export type HealthComparison = {
  previousScore: number;
  newScore: number;
  scoreDelta: number;
  risksRemoved: string[];
  risksRemaining: string[];
  risksIntroduced: string[];
};

export type ProposalSimulation = {
  beforeScore: number;
  afterScore: number | null;
  scoreDelta: number | null;
  risksRemoved: string[];
  risksRemaining: string[];
  risksIntroduced: string[];
  caveat: string;
};

export type AgentProposal = {
  id: string;
  projectId: string;
  projectUpdatedAtAtCreation: string;
  title: string;
  kind: "single_change" | "recovery_plan" | "checklist";
  reason: string;
  evidence: AgentEvidence[];
  changes: ProposalChange[];
  simulation: ProposalSimulation;
  status: ProposalStatus;
  reversible: boolean;
  createdAt: string;
};

export type AgentToolTrace = {
  tool: ToolName;
  arguments: Record<string, unknown>;
  summary: string;
  result: Record<string, unknown>;
};

export type AgentEvidence = {
  label: string;
  value: string;
  source: string;
};

export type AgentClarification = {
  id: string;
  question: string;
  options: Array<{ id: string; label: string }>;
  allowMultiple?: boolean;
};

export type AgentGoal = {
  text: string;
  intent: string;
  context: Record<string, string>;
  createdAt: string;
};

export type AgentPlan = {
  id: string;
  title: string;
  summary: string;
  proposalId: string;
  changeIds: string[];
  createdAt: string;
};

export type SelectedAgentOption = {
  clarificationId: string;
  optionId: string;
  label: string;
};

export type AgentConversationState = {
  phase: AgentPhase;
  currentUserGoal: AgentGoal | null;
  investigationFindings: AgentEvidence[];
  pendingClarification: AgentClarification | null;
  selectedOptions: SelectedAgentOption[];
  pendingPlan: AgentPlan | null;
  pendingApprovalProposal: AgentProposal | null;
  lastAppliedProposal: AgentProposal | null;
  toolTraces: AgentToolTrace[];
  error: string | null;
};

export type AgentResponse = {
  mode: AgentMode;
  message: string;
  toolTrace: AgentToolTrace[];
  evidence: AgentEvidence[];
  proposal: AgentProposal | null;
  clarification: AgentClarification | null;
  agentState: AgentConversationState;
  fallbackReason?: string;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  mode?: AgentMode;
  toolTrace?: AgentToolTrace[];
  evidence?: AgentEvidence[];
  proposal?: AgentProposal | null;
  proposalStatus?: ProposalStatus | "partially-approved";
  clarification?: AgentClarification | null;
  verification?: HealthComparison;
};

export type AgentActivity = {
  id: string;
  createdAt: string;
  userRequest: string;
  selectedTools: ToolName[];
  proposalId: string | null;
  status: "answered" | "proposed" | "approved" | "rejected" | "stale" | "undone" | "failed";
  appliedChanges: string[];
  beforeScore: number | null;
  afterScore: number | null;
  mode: AgentMode;
};

export type UndoEntry = {
  id: string;
  proposalId: string;
  projectId: string;
  snapshot: Project;
  appliedProjectUpdatedAt: string;
  createdAt: string;
};

export type AliProjectSession = {
  messages: ConversationMessage[];
  activity: AgentActivity[];
  undoStack: UndoEntry[];
  agentState: AgentConversationState;
};

export type AgentRequest = {
  project: Project;
  message: string;
  history: Array<Pick<ConversationMessage, "role" | "text" | "clarification">>;
  currentDate: string;
  pendingProposal?: AgentProposal | null;
  agentState: AgentConversationState;
};

export type TaskFilter = "all" | "blocked" | "overdue" | "critical" | "incomplete" | "completed" | "deferred";

export type TaskUpdateInput = {
  taskId: string;
  field: "status" | "dueDate" | "owner" | "critical" | "estimatedHours";
  value: TaskStatus | boolean | string | number;
  reason: string;
};

export type ToolExecution = {
  output: Record<string, unknown>;
  summary: string;
  evidence: AgentEvidence[];
  proposal: AgentProposal | null;
  clarification?: AgentClarification | null;
};

export function emptyAgentConversationState(): AgentConversationState {
  return {
    phase: "IDLE",
    currentUserGoal: null,
    investigationFindings: [],
    pendingClarification: null,
    selectedOptions: [],
    pendingPlan: null,
    pendingApprovalProposal: null,
    lastAppliedProposal: null,
    toolTraces: [],
    error: null
  };
}
