"use client";

import { ArrowRight, Check, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { AgentProposal, ConversationMessage, ProposalValue } from "@/lib/agent/types";

const value = (input: ProposalValue) => input === null ? "None" : typeof input === "boolean" ? (input ? "Yes" : "No") : typeof input === "object" ? input.title : String(input);

export function ProposalCard({ proposal, status = "pending", onApprove, onReject, onModify }: {
  proposal: AgentProposal;
  status?: ConversationMessage["proposalStatus"];
  onApprove: (proposal: AgentProposal, changeId?: string) => void;
  onReject: (proposal: AgentProposal) => void;
  onModify: (proposal: AgentProposal) => void;
}) {
  const effectiveStatus = status ?? proposal.status;
  const actionable = proposal.status === "pending" && (effectiveStatus === "pending" || effectiveStatus === "partially-approved");
  const impact = proposal.simulation;
  return <section className={`ali-proposal ${effectiveStatus} ${proposal.changes.some((change) => change.actionType === "task_delete") ? "destructive" : ""}`}>
    <div className="ali-proposal-head"><span><ShieldCheck size={15} /> Approval required</span>{proposal.reversible && <small><RotateCcw size={11} /> Reversible</small>}</div>
    <h4>{proposal.title}</h4>
    <p>{proposal.reason}</p>
    <div className="ali-change-list">
      {proposal.changes.map((change) => <article key={change.id}>
        <div><strong>{change.entityName}</strong><small>{change.field.replace(/([A-Z])/g, " $1")}</small></div>
        <div className="ali-before-after"><span>{value(change.oldValue)}</span><ArrowRight size={13} /><strong>{value(change.newValue)}</strong></div>
        <p>{change.reason}</p>
        {change.evidence.length > 0 && <small className="ali-change-evidence">Evidence: {change.evidence.join(" · ")}</small>}
      </article>)}
    </div>
    <div className="ali-impact"><span>Forecast health impact</span>{impact.afterScore === null ? <strong>Not scoreable</strong> : <strong>{impact.beforeScore} <ArrowRight size={12} /> {impact.afterScore} <em>{impact.scoreDelta !== null && impact.scoreDelta >= 0 ? "+" : ""}{impact.scoreDelta}</em></strong>}<small>{impact.caveat}</small></div>
    {actionable ? <div className="ali-proposal-actions">
      <button className="reject" onClick={() => onReject(proposal)}><X size={14} /> Reject</button>
      <button className="modify" onClick={() => onModify(proposal)}>Modify plan</button>
      <button className="approve" onClick={() => onApprove(proposal)}><Check size={14} /> Approve plan</button>
    </div> : <div className={`ali-proposal-state ${effectiveStatus}`}><Check size={13} /> {effectiveStatus === "rejected" ? "Rejected · no data changed" : effectiveStatus === "stale" ? "Stale · reassess before approval" : effectiveStatus === "undone" ? "Undone · previous snapshot restored" : "Approved and applied"}</div>}
  </section>;
}
