"use client";

import { Bot, Database, UserRound } from "lucide-react";
import type { ConversationMessage } from "@/lib/agent/types";
import { ProposalCard } from "./ProposalCard";
import { ToolTrace } from "./ToolTrace";

export function ChatMessage({ message, onApprove, onReject, onModify, onClarification }: {
  message: ConversationMessage;
  onApprove: NonNullable<React.ComponentProps<typeof ProposalCard>["onApprove"]>;
  onReject: NonNullable<React.ComponentProps<typeof ProposalCard>["onReject"]>;
  onModify: NonNullable<React.ComponentProps<typeof ProposalCard>["onModify"]>;
  onClarification: (option: { id: string; label: string }) => void;
}) {
  const system = message.role === "system";
  return <article className={`ali-message ${message.role}`}>
    {!system && <div className="ali-message-avatar">{message.role === "user" ? <UserRound size={13} /> : <Bot size={14} />}</div>}
    <div className="ali-message-body">
      <div className="ali-message-meta"><strong>{system ? "Update" : message.role === "user" ? "You" : "Ali"}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
      <p>{message.text}</p>
      {message.toolTrace && <ToolTrace trace={message.toolTrace} />}
      {message.evidence && message.evidence.length > 0 && <details className="ali-evidence"><summary><Database size={12} /> Evidence · {message.evidence.length}</summary><div>{message.evidence.map((item, index) => <div key={`${item.label}-${index}`}><strong>{item.label}</strong><span>{item.value}</span><small>{item.source}</small></div>)}</div></details>}
      {message.proposal && <ProposalCard proposal={message.proposal} status={message.proposalStatus} onApprove={onApprove} onReject={onReject} onModify={onModify} />}
      {message.verification && <div className="ali-verification"><strong>Verified: {message.verification.previousScore} → {message.verification.newScore}</strong><span>{message.verification.risksRemoved.length ? `Removed: ${message.verification.risksRemoved.join(", ")}` : "No risks disappeared."}</span><span>{message.verification.risksRemaining.length ? `Remaining: ${message.verification.risksRemaining.join(", ")}` : "No prior risks remain."}</span>{message.verification.risksIntroduced.length > 0 && <span>Appeared: {message.verification.risksIntroduced.join(", ")}</span>}</div>}
      {message.role === "assistant" && message.clarification?.options.length ? <div className="ali-clarification-options">{message.clarification.options.map((option) => <button key={option.id} onClick={() => onClarification(option)}>{option.label}</button>)}</div> : null}
    </div>
  </article>;
}
