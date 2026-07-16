export type TaskStatus = "not-started" | "in-progress" | "blocked" | "deferred" | "done";
export type HealthStatus = "healthy" | "at-risk" | "critical";
export type Severity = "critical" | "high" | "medium" | "low";

export type ProjectTask = {
  id: string;
  title: string;
  owner: string;
  status: TaskStatus;
  dueDate: string;
  estimatedHours: number;
  loggedHours: number;
  critical: boolean;
  blocker: string;
};

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  allocation: number;
};

export type Project = {
  id: string;
  name: string;
  client: string;
  owner: string;
  currency: "EUR" | "USD" | "GBP";
  startDate: string;
  deadline: string;
  budget: number;
  spent: number;
  progress: number;
  plannedProgress: number;
  qualityScore: number;
  tasks: ProjectTask[];
  team: TeamMember[];
  updatedAt: string;
};

export type Risk = {
  id: string;
  severity: Severity;
  category: "budget" | "schedule" | "capacity" | "delivery" | "quality";
  title: string;
  summary: string;
  evidence: string[];
  recommendation: string;
  tool: string;
};

export type TraceStep = {
  id: string;
  tool: string;
  purpose: string;
  input: string;
  result: string;
  duration: number;
};

export type Analysis = {
  score: number;
  status: HealthStatus;
  headline: string;
  confidence: number;
  generatedAt: string;
  metrics: {
    budgetVariance: number;
    scheduleGap: number;
    overallocated: number;
    blockers: number;
    overdueTasks: number;
  };
  breakdown: Array<{ label: string; score: number }>;
  risks: Risk[];
  traces: TraceStep[];
  nextAction: string;
};

export type AgentResult = {
  mode: "model" | "deterministic" | "fallback";
  model: string | null;
  summary: string;
  toolCalls: string[];
  note: string;
};
