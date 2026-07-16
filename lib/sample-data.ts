import type { Project } from "./types";

export const sampleProjects: Project[] = [
  {
    id: "atlas",
    name: "Atlas Website Redesign",
    client: "Atlas & Co.",
    owner: "Emma Reynolds",
    currency: "EUR",
    startDate: "2026-05-18",
    deadline: "2026-08-29",
    budget: 80000,
    spent: 55700,
    progress: 58,
    plannedProgress: 69,
    qualityScore: 74,
    updatedAt: "2026-07-15T10:00:00.000Z",
    tasks: [
      { id: "a1", title: "Approve responsive design system", owner: "Mia Chen", status: "blocked", dueDate: "2026-07-10", estimatedHours: 42, loggedHours: 51, critical: true, blocker: "Client feedback is overdue" },
      { id: "a2", title: "Complete checkout integration", owner: "Leo Martins", status: "blocked", dueDate: "2026-07-18", estimatedHours: 64, loggedHours: 38, critical: true, blocker: "Payment API credentials missing" },
      { id: "a3", title: "Migrate product catalogue", owner: "Noah Williams", status: "in-progress", dueDate: "2026-07-24", estimatedHours: 70, loggedHours: 59, critical: true, blocker: "" },
      { id: "a4", title: "Prepare analytics tracking plan", owner: "Sofia Costa", status: "blocked", dueDate: "2026-07-17", estimatedHours: 20, loggedHours: 8, critical: false, blocker: "Final event taxonomy missing" }
    ],
    team: [
      { id: "m1", name: "Mia Chen", role: "Product designer", allocation: 126 },
      { id: "m2", name: "Leo Martins", role: "Frontend engineer", allocation: 118 },
      { id: "m3", name: "Noah Williams", role: "Backend engineer", allocation: 92 },
      { id: "m4", name: "Sofia Costa", role: "Project analyst", allocation: 84 }
    ]
  }
];

export function createBlankProject(): Project {
  const id = crypto.randomUUID();
  const today = new Date();
  const deadline = new Date(today);
  deadline.setDate(deadline.getDate() + 60);
  return {
    id,
    name: "Untitled project",
    client: "New client",
    owner: "Project owner",
    currency: "EUR",
    startDate: today.toISOString().slice(0, 10),
    deadline: deadline.toISOString().slice(0, 10),
    budget: 50000,
    spent: 0,
    progress: 0,
    plannedProgress: 0,
    qualityScore: 85,
    tasks: [],
    team: [],
    updatedAt: new Date().toISOString()
  };
}
