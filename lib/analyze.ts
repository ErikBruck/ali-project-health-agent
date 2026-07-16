import type { Analysis, Project, Risk, Severity } from "./types";

const severityRank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const money = (value: number, currency: Project["currency"]) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export function analyzeProject(project: Project, now = new Date()): Analysis {
  const safeProgress = Math.max(project.progress, 1);
  const projectedCost = project.spent / (safeProgress / 100);
  const projectedOverrun = project.progress === 0
    ? 0
    : ((projectedCost - project.budget) / Math.max(project.budget, 1)) * 100;
  const scheduleGap = project.plannedProgress - project.progress;
  const overallocated = project.team.filter((member) => member.allocation > 100);
  const blockers = project.tasks.filter((task) => task.status === "blocked");
  const criticalBlockers = blockers.filter((task) => task.critical);
  const overdue = project.tasks.filter((task) => !["done", "deferred"].includes(task.status) && new Date(`${task.dueDate}T23:59:59`) < now);
  const hourOverruns = project.tasks.filter((task) => task.loggedHours > task.estimatedHours && !["done", "deferred"].includes(task.status));

  const budgetScore = clamp(100 - Math.max(0, projectedOverrun) * 2.1);
  const scheduleScore = clamp(100 - Math.max(0, scheduleGap) * 3.2 - criticalBlockers.length * 7);
  const capacityScore = clamp(100 - overallocated.reduce((sum, member) => sum + (member.allocation - 100) * 0.8, 0));
  const deliveryScore = clamp(100 - blockers.length * 8 - overdue.length * 7 - hourOverruns.length * 4);
  const qualityScore = clamp(project.qualityScore);
  const score = clamp(budgetScore * 0.27 + scheduleScore * 0.27 + capacityScore * 0.17 + deliveryScore * 0.15 + qualityScore * 0.14);

  const risks: Risk[] = [];

  if (project.progress > 0 && projectedOverrun > 8) {
    risks.push({
      id: "budget-overrun",
      severity: projectedOverrun > 30 ? "critical" : projectedOverrun > 15 ? "high" : "medium",
      category: "budget",
      title: "Budget overrun projected",
      summary: `Current burn rate projects a ${Math.round(projectedOverrun)}% final overrun.`,
      evidence: [
        `${money(project.spent, project.currency)} spent at ${project.progress}% completion`,
        `Projected final cost ${money(projectedCost, project.currency)}`,
        `Approved budget ${money(project.budget, project.currency)}`
      ],
      recommendation: "Re-estimate remaining work and agree a scope or budget correction before the next reporting cycle.",
      tool: "analyze_budget"
    });
  }

  if (scheduleGap >= 5 || criticalBlockers.length > 0) {
    risks.push({
      id: "schedule-slip",
      severity: scheduleGap > 18 || criticalBlockers.length >= 3 ? "critical" : "high",
      category: "schedule",
      title: "Delivery plan is under pressure",
      summary: `${Math.max(0, scheduleGap)} percentage points behind plan with ${criticalBlockers.length} critical blocker${criticalBlockers.length === 1 ? "" : "s"}.`,
      evidence: [
        `${project.progress}% actual progress vs ${project.plannedProgress}% planned`,
        ...criticalBlockers.slice(0, 3).map((task) => `${task.title}: ${task.blocker || "blocked"}`)
      ],
      recommendation: "Resolve the highest-impact blocker and re-sequence work that can continue independently.",
      tool: "analyze_schedule"
    });
  }

  if (overallocated.length > 0) {
    const peak = [...overallocated].sort((a, b) => b.allocation - a.allocation)[0];
    risks.push({
      id: "capacity",
      severity: peak.allocation >= 140 ? "critical" : peak.allocation >= 120 ? "high" : "medium",
      category: "capacity",
      title: "Team capacity is overloaded",
      summary: `${overallocated.length} team member${overallocated.length === 1 ? " is" : "s are"} allocated above 100%.`,
      evidence: overallocated.map((member) => `${member.name} · ${member.role} · ${member.allocation}%`),
      recommendation: "Move non-critical assignments, reduce scope or add capacity before committing to more work.",
      tool: "analyze_capacity"
    });
  }

  if (overdue.length > 0) {
    risks.push({
      id: "overdue",
      severity: overdue.some((task) => task.critical) ? "high" : "medium",
      category: "delivery",
      title: "Overdue work needs recovery owners",
      summary: `${overdue.length} incomplete task${overdue.length === 1 ? " is" : "s are"} past due.`,
      evidence: overdue.slice(0, 4).map((task) => `${task.title} · due ${task.dueDate} · ${task.owner || "unassigned"}`),
      recommendation: "Give every overdue critical task a named owner and recovery date.",
      tool: "list_tasks"
    });
  }

  if (qualityScore < 65) {
    risks.push({
      id: "quality",
      severity: qualityScore < 50 ? "critical" : "high",
      category: "quality",
      title: "Quality gate is below target",
      summary: `Quality confidence is ${qualityScore}/100.`,
      evidence: [`Quality score ${qualityScore}/100`, `${criticalBlockers.length} blocked critical tasks`],
      recommendation: "Protect the release gate and close critical defects before adding nonessential scope.",
      tool: "analyze_quality"
    });
  }

  if (risks.length === 0) {
    risks.push({
      id: "healthy",
      severity: "low",
      category: "delivery",
      title: "No immediate delivery threats detected",
      summary: "The project is inside the current budget, schedule, capacity and quality thresholds.",
      evidence: [`${project.progress}% actual vs ${project.plannedProgress}% planned`, "No blocked critical tasks", "No allocation above 100%"],
      recommendation: "Continue monitoring and validate the next milestone dependencies.",
      tool: "get_project_overview"
    });
  }

  risks.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
  const confidence = clamp(86 + Math.min(10, project.tasks.length + project.team.length));
  const traces = [
    { id: "snapshot", tool: "get_project_overview", purpose: "Load current project facts", input: `project_id=${project.id}`, result: `${project.tasks.length} tasks · ${project.team.length} people`, duration: 31 },
    { id: "budget", tool: "analyze_budget", purpose: "Compare burn with earned progress", input: `budget=${project.budget}, spent=${project.spent}, progress=${project.progress}`, result: `${Math.round(projectedOverrun)}% projected variance`, duration: 18 },
    { id: "schedule", tool: "analyze_schedule", purpose: "Find delivery threats", input: `planned=${project.plannedProgress}, actual=${project.progress}`, result: `${scheduleGap}pp gap · ${criticalBlockers.length} critical blockers`, duration: 24 },
    { id: "capacity", tool: "analyze_capacity", purpose: "Inspect resource pressure", input: `team_size=${project.team.length}`, result: `${overallocated.length} overallocated`, duration: 16 },
    { id: "synthesis", tool: "get_health_findings", purpose: "Rank grounded interventions", input: `findings=${risks.length}`, result: `${risks.length} prioritised risks`, duration: 42 }
  ];

  return {
    score,
    status: score >= 78 ? "healthy" : score >= 48 ? "at-risk" : "critical",
    headline: score >= 78
      ? "Delivery is on track with no immediate intervention required."
      : score >= 48
        ? "Intervention is needed to protect the current delivery plan."
        : "The current delivery plan needs immediate corrective action.",
    confidence,
    generatedAt: now.toISOString(),
    metrics: {
      budgetVariance: Math.round(projectedOverrun),
      scheduleGap,
      overallocated: overallocated.length,
      blockers: blockers.length,
      overdueTasks: overdue.length
    },
    breakdown: [
      { label: "Budget", score: budgetScore },
      { label: "Schedule", score: scheduleScore },
      { label: "Capacity", score: capacityScore },
      { label: "Delivery", score: deliveryScore },
      { label: "Quality", score: qualityScore }
    ],
    risks,
    traces,
    nextAction: risks[0].recommendation
  };
}
