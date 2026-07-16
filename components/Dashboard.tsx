"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, Clock3, Gauge, ListChecks, ShieldCheck, Users } from "lucide-react";
import type { Analysis, Project, Risk } from "@/lib/types";

const severityLabel = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

function RiskCard({ risk, rank }: { risk: Risk; rank: number }) {
  const [open, setOpen] = useState(rank === 1);
  return (
    <article className={`risk-card ${open ? "open" : ""}`}>
      <button onClick={() => setOpen((value) => !value)} className="risk-button">
        <span className={`rank ${risk.severity}`}>{rank}</span>
        <span className="risk-main"><strong>{risk.title}</strong><small>{risk.summary}</small></span>
        <span className={`severity ${risk.severity}`}>{severityLabel[risk.severity]}</span>
        <ChevronRight size={17} className="risk-chevron" />
      </button>
      {open && <div className="risk-detail">
        <div><span>Evidence</span><ul>{risk.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><span>Recommended action</span><p>{risk.recommendation}</p><code>{risk.tool}</code></div>
      </div>}
    </article>
  );
}

export function Dashboard({ project, analysis }: { project: Project; analysis: Analysis }) {
  const [allTrace, setAllTrace] = useState(false);
  const visibleTrace = allTrace ? analysis.traces : analysis.traces.slice(0, 3);
  const tone = analysis.status === "healthy" ? "green" : analysis.status === "critical" ? "red" : "amber";
  const totalLatency = analysis.traces.reduce((sum, trace) => sum + trace.duration, 0);

  return <div className="dashboard">
    <section className="agent-brief">
      <div className="agent-symbol"><ShieldCheck size={18} /></div>
      <div><span>Live deterministic analysis</span><strong>{analysis.headline}</strong><small>Calculated from the current editable project data · ask Ali to investigate or propose a change</small></div>
    </section>

    <section className="metrics-grid">
      <article className={`metric score-card ${tone}`}>
        <div className="metric-title"><Gauge size={17} /> Overall health</div>
        <div className="score-wrap"><strong>{analysis.score}</strong><span>/100</span></div>
        <div className={`status ${analysis.status}`}>{analysis.status === "at-risk" ? "At risk" : analysis.status}</div>
        <p>{analysis.headline}</p>
      </article>
      <article className="metric"><div className="metric-title"><CircleDollarSign size={17} /> Budget</div><strong className="big-value">{analysis.metrics.budgetVariance > 0 ? "+" : ""}{analysis.metrics.budgetVariance}%</strong><span>projected variance</span><div className="microbar"><i style={{ width: `${Math.min(100, Math.max(4, Math.abs(analysis.metrics.budgetVariance) * 2))}%` }} className={analysis.metrics.budgetVariance > 8 ? "bad" : "good"} /></div></article>
      <article className="metric"><div className="metric-title"><Clock3 size={17} /> Schedule</div><strong className="big-value">{analysis.metrics.scheduleGap > 0 ? `${analysis.metrics.scheduleGap}pp behind` : "On plan"}</strong><span>{project.progress}% actual · {project.plannedProgress}% planned</span><div className="microbar"><i style={{ width: `${Math.max(4, project.progress)}%` }} className={analysis.metrics.scheduleGap > 5 ? "warn" : "good"} /></div></article>
      <article className="metric"><div className="metric-title"><Users size={17} /> Capacity</div><strong className="big-value">{analysis.metrics.overallocated}</strong><span>people above 100%</span><div className="microbar"><i style={{ width: `${Math.min(100, analysis.metrics.overallocated * 25)}%` }} className={analysis.metrics.overallocated ? "warn" : "good"} /></div></article>
      <article className="metric"><div className="metric-title"><ListChecks size={17} /> Delivery</div><strong className="big-value">{analysis.metrics.blockers}</strong><span>blockers · {analysis.metrics.overdueTasks} overdue</span><div className="microbar"><i style={{ width: `${Math.min(100, (analysis.metrics.blockers + analysis.metrics.overdueTasks) * 15)}%` }} className={analysis.metrics.blockers ? "bad" : "good"} /></div></article>
    </section>

    <div className="dashboard-grid">
      <section className="panel findings-panel">
        <div className="panel-heading"><div><span>Agent findings</span><h2>Prioritised risks</h2></div><div className="confidence"><CheckCircle2 size={15} /> {analysis.confidence}% confidence</div></div>
        <div className="risk-list">{analysis.risks.map((risk, index) => <RiskCard risk={risk} rank={index + 1} key={risk.id} />)}</div>
      </section>

      <aside className="side-column">
        <section className="panel breakdown"><div className="panel-heading"><div><span>Score model</span><h3>Health breakdown</h3></div></div>{analysis.breakdown.map((item) => <div className="breakdown-row" key={item.label}><div><strong>{item.label}</strong><span>{item.score}/100</span></div><div><i style={{ width: `${item.score}%` }} /></div></div>)}</section>
        <section className="panel next-action"><AlertTriangle size={19} /><span>Recommended next action</span><strong>{analysis.nextAction}</strong></section>
      </aside>
    </div>

    <section className="panel trace-panel">
      <div className="panel-heading"><div><span>Observability</span><h2>Execution trace</h2></div><div className="trace-summary">{analysis.traces.length} steps · {totalLatency}ms</div></div>
      <div className="trace-table"><div className="trace-head"><span>Step</span><span>Tool</span><span>Purpose</span><span>Result</span><span>Time</span></div>{visibleTrace.map((trace, index) => <div className="trace-row" key={trace.id}><span>{index + 1}</span><code>{trace.tool}</code><span>{trace.purpose}</span><strong>{trace.result}</strong><span>{trace.duration}ms</span></div>)}</div>
      <button className="trace-toggle" onClick={() => setAllTrace((value) => !value)}>{allTrace ? "Show compact trace" : "View full execution trace"}<ChevronDown size={15} /></button>
    </section>
  </div>;
}
