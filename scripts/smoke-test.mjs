import { spawn } from "node:child_process";

const port = 3100;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, OPENAI_API_KEY: "", OPENAI_MODEL: "" },
});
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function ready() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      if (response.ok) return response;
    } catch { /* Server is still starting. */ }
    await wait(300);
  }
  throw new Error("Server did not become ready");
}

const project = {
  id: "smoke", name: "Live Smoke Project", client: "Test Client", owner: "Test Owner", currency: "EUR",
  startDate: "2026-07-01", deadline: "2026-08-30", budget: 10000, spent: 7000, progress: 50,
  plannedProgress: 65, qualityScore: 72, updatedAt: new Date().toISOString(),
  tasks: [{ id: "task-1", title: "Approve launch design", owner: "Mia Chen", status: "blocked", dueDate: "2026-07-10", estimatedHours: 20, loggedHours: 22, critical: true, blocker: "Approval missing" }, { id: "task-2", title: "Draft launch copy", owner: "Leo Martins", status: "in-progress", dueDate: "2026-07-22", estimatedHours: 12, loggedHours: 4, critical: false, blocker: "" }],
  team: [{ id: "mia-1", name: "Mia Chen", role: "Designer", allocation: 125 }, { id: "leo-1", name: "Leo Martins", role: "Engineer", allocation: 70 }]
};

async function ask(message, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/agent`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: options.project ?? project, message, history: options.history ?? [], currentDate: "2026-07-16T12:00:00.000Z", pendingProposal: options.pendingProposal ?? options.agentState?.pendingApprovalProposal ?? null, agentState: options.agentState })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Agent endpoint failed");
  return payload;
}

try {
  const home = await ready();
  const html = await home.text();
  if (!html.includes("Ali")) throw new Error("Ali workspace did not render");

  const briefing = await ask("Why is this project at risk?");
  if (briefing.mode !== "local" || briefing.toolTrace.length < 2 || briefing.evidence.length === 0 || briefing.toolTrace.some((entry) => !entry.result)) throw new Error("Local investigation did not use real live tools and evidence");

  const broadGoal = await ask("Fix this project");
  if (broadGoal.agentState?.phase !== "NEEDS_CLARIFICATION" || !broadGoal.clarification?.options.some((option) => option.id === "budget-capacity")) throw new Error("Multi-turn broad goal did not enter clarification state");
  const broadPlan = await ask("budget-capacity", { agentState: broadGoal.agentState, history: [{ role: "user", text: "Fix this project" }, { role: "assistant", text: broadGoal.message, clarification: broadGoal.clarification }] });
  if (broadPlan.agentState?.phase !== "AWAITING_CONFIRMATION" || broadPlan.proposal?.changes.length < 2) throw new Error("Clarification answer did not create a combined pending plan");

  const budgetQuestion = await ask("Fix the budget issue");
  if (budgetQuestion.agentState?.phase !== "NEEDS_CLARIFICATION" || budgetQuestion.clarification?.options.length !== 3) throw new Error("Budget fix did not ask for a strategy");
  const budgetScope = await ask("reduce-scope", { agentState: budgetQuestion.agentState });
  if (budgetScope.agentState?.phase !== "AWAITING_CONFIRMATION" || !budgetScope.proposal?.changes.every((change) => change.newValue === "deferred")) throw new Error("Budget scope answer did not create a deferral plan");

  const reforecast = await ask("Reforecast the budget");
  if (!reforecast.proposal || reforecast.proposal.projectId !== project.id || reforecast.proposal.projectUpdatedAtAtCreation !== project.updatedAt || reforecast.proposal.changes[0]?.newValue !== 14000) throw new Error("Budget reforecast was not version-bound and grounded in current burn");

  const allocation = await ask("Reduce Mia's allocation to 95%");
  if (!allocation.proposal || allocation.proposal.changes[0]?.oldValue !== 125 || allocation.proposal.changes[0]?.newValue !== 95) throw new Error("Allocation proposal was not grounded in current project data");

  const rebalance = await ask("Move work from Mia to Leo");
  if (!rebalance.proposal || rebalance.proposal.changes.length !== 3 || !rebalance.proposal.changes.some((change) => change.field === "owner" && change.entityId === "task-1") || rebalance.proposal.changes.filter((change) => change.field === "allocation").length !== 2) throw new Error("Task transfer did not combine exact ownership and allocation changes");

  const taskUpdate = await ask("Mark the design approval task as completed");
  if (!taskUpdate.proposal || taskUpdate.proposal.changes[0]?.entityId !== "task-1" || taskUpdate.proposal.changes[0]?.newValue !== "done") throw new Error("Natural-language task status proposal failed");

  const deferred = await ask("Defer the non-critical work");
  if (!deferred.proposal || deferred.proposal.changes[0]?.entityId !== "task-2" || deferred.proposal.changes[0]?.newValue !== "deferred") throw new Error("Non-critical task deferral proposal failed");

  const followUp = await ask("Create a task for client approval tomorrow assigned to Leo, 4 hours");
  if (!followUp.proposal || followUp.proposal.changes[0]?.actionType !== "task_create" || followUp.proposal.changes[0]?.newValue?.owner !== "Leo Martins") throw new Error("Follow-up task proposal with explicit data failed");

  const checklist = await ask("Create an estimate-validation checklist for Leo due 2026-07-20");
  if (!checklist.proposal || checklist.proposal.kind !== "checklist" || checklist.proposal.changes.length !== 3) throw new Error("Estimate-validation checklist proposal failed");

  const deadline = await ask("Move the deadline forward by one week");
  if (!deadline.proposal || deadline.proposal.changes[0]?.oldValue !== "2026-08-30" || deadline.proposal.changes[0]?.newValue !== "2026-09-06" || project.deadline !== "2026-08-30") throw new Error("Deadline proposal mutated data or calculated the wrong date");

  const plan = await ask("Create a recovery plan");
  if (!plan.proposal || !plan.toolTrace.some((item) => item.tool === "simulate_changes")) throw new Error("Recovery plan did not create and simulate a proposal");

  console.log("Smoke test passed: Ali completed multi-turn clarification/planning flows and created versioned budget, scope, transfer, task, checklist, deadline, and recovery proposals without mutation.");
} finally {
  server.kill("SIGTERM");
}
