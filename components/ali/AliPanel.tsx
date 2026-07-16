"use client";

import { Activity, ChevronDown, Eraser, History, LoaderCircle, PanelRightClose, PanelRightOpen, RefreshCcw, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { analyzeProject } from "@/lib/analyze";
import { buildProposalExecution, compareProjectHealth, isProposalStale, undoProposal } from "@/lib/agent/proposals";
import { emptyAgentConversationState } from "@/lib/agent/types";
import type { AgentActivity, AgentMode, AgentProposal, AgentResponse, AliProjectSession, ConversationMessage } from "@/lib/agent/types";
import type { Project } from "@/lib/types";
import { ChatMessage } from "./ChatMessage";
import { SuggestedPrompts } from "./SuggestedPrompts";

const STORAGE_KEY = "ali.agent.sessions.v3";
const LEGACY_STORAGE_KEY = "ali.agent.sessions.v2";

const emptySession = (): AliProjectSession => ({ messages: [], activity: [], undoStack: [], agentState: emptyAgentConversationState() });
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const subscribeMode = () => () => undefined;
const browserMode = (): AgentMode => document.body.dataset.aliMode === "model" ? "model" : "local";
const serverMode = (): AgentMode => "local";
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const stateOf = (session: AliProjectSession) => session.agentState ?? emptyAgentConversationState();

function openingMessage(project: Project): ConversationMessage {
  const analysis = analyzeProject(project);
  const top = analysis.risks[0];
  return {
    id: id(), role: "assistant", createdAt: now(), mode: "local",
    text: `I'm Ali. ${project.name} is ${analysis.status} at ${analysis.score}/100. The most important current signal is ${top.title.toLowerCase()}: ${top.summary} Ask “What should I fix first?” to investigate it.`
  };
}

function requestForProposal(messages: ConversationMessage[], proposalId: string) {
  const proposalIndex = messages.findIndex((message) => message.proposal?.id === proposalId);
  for (let index = proposalIndex; index >= 0; index -= 1) if (messages[index].role === "user") return messages[index].text;
  return "Approve Ali proposal";
}

function changeLabel(proposal: AgentProposal) {
  return proposal.changes.map((change) => `${change.entityName}: ${change.field} ${String(change.oldValue)} → ${String(change.newValue)}`);
}

export function AliPanel({ project, open, onToggle, onProjectChange }: { project: Project; open: boolean; onToggle: () => void; onProjectChange: (project: Project) => void }) {
  const [session, setSession] = useState<AliProjectSession>(emptySession);
  const [sessionReady, setSessionReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [composer, setComposer] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [needsReassess, setNeedsReassess] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const manualTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observedUpdatedAt = useRef(project.updatedAt);
  const lastAppliedUpdatedAt = useRef<string | null>(null);
  const handledProposalIds = useRef(new Set<string>());
  const runningRef = useRef(false);
  const projectRef = useRef(project);

  const analysis = useMemo(() => analyzeProject(project), [project]);
  const configuredMode = useSyncExternalStore(subscribeMode, browserMode, serverMode);
  const mode = configuredMode;
  const agentState = stateOf(session);
  const pendingProposal = agentState.pendingApprovalProposal ?? [...session.messages].reverse().find((message) => message.proposal?.status === "pending" && (message.proposalStatus === "pending" || message.proposalStatus === "partially-approved"))?.proposal ?? null;
  const latestUndo = session.undoStack[session.undoStack.length - 1];
  const canUndo = Boolean(latestUndo && latestUndo.projectId === project.id && latestUndo.appliedProjectUpdatedAt === project.updatedAt);

  useEffect(() => { projectRef.current = project; }, [project]);

  useEffect(() => {
    const activeProject = projectRef.current;
    try {
      const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      const all = stored ? JSON.parse(stored) as Record<string, AliProjectSession> : {};
      const saved = all[activeProject.id];
      // Local browser persistence intentionally hydrates the selected project's agent state.
      setSession(saved && Array.isArray(saved.messages) ? { messages: saved.messages, activity: Array.isArray(saved.activity) ? saved.activity : [], undoStack: Array.isArray(saved.undoStack) ? saved.undoStack : [], agentState: saved.agentState && typeof saved.agentState === "object" ? saved.agentState : emptyAgentConversationState() } : { ...emptySession(), messages: [openingMessage(activeProject)] });
    } catch {
      setSession({ ...emptySession(), messages: [openingMessage(activeProject)] });
    }
    observedUpdatedAt.current = activeProject.updatedAt;
    lastAppliedUpdatedAt.current = null;
    setSessionReady(true);
    setError("");
    setComposer("");
    setNeedsReassess(false);
    if (manualTimer.current) clearTimeout(manualTimer.current);
  }, [project.id]); // Project identity, not its editable fields, selects the persisted conversation.

  useEffect(() => {
    if (!sessionReady) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const all = stored ? JSON.parse(stored) as Record<string, AliProjectSession> : {};
      all[project.id] = session;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch { /* Conversation persistence is best effort and never blocks project editing. */ }
  }, [project.id, session, sessionReady]);

  useEffect(() => {
    if (!sessionReady || observedUpdatedAt.current === project.updatedAt) return;
    observedUpdatedAt.current = project.updatedAt;
    if (lastAppliedUpdatedAt.current === project.updatedAt) {
      lastAppliedUpdatedAt.current = null;
      return;
    }
    if (manualTimer.current) clearTimeout(manualTimer.current);
    manualTimer.current = setTimeout(() => {
      setSession((current) => {
        const last = current.messages[current.messages.length - 1];
        const messages = current.messages.map((message): ConversationMessage => message.proposal?.status === "pending" ? { ...message, proposal: { ...message.proposal, status: "stale" }, proposalStatus: "stale" } : message);
        const nextState = { ...stateOf(current), phase: "IDLE" as const, pendingPlan: null, pendingApprovalProposal: null, pendingClarification: null };
        if (last?.role === "system" && last.text.startsWith("Project data changed")) return { ...current, messages, agentState: nextState };
        return { ...current, agentState: nextState, messages: [...messages, { id: id(), role: "system", text: "Project data changed. Existing proposals are stale. Reassess before approving a change.", createdAt: now() }] };
      });
      setNeedsReassess(true);
    }, 1200);
    return () => { if (manualTimer.current) clearTimeout(manualTimer.current); };
  }, [project.updatedAt, sessionReady]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [session.messages, running, open]);

  const sendMessage = async (raw?: string) => {
    const text = (raw ?? composer).trim();
    if (!text || runningRef.current) return;
    const control = text.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    const recordControl = () => setSession((current) => ({ ...current, messages: [...current.messages, { id: id(), role: "user", text, createdAt: now() }] }));
    if (/^(undo|undo that|undo it)$/.test(control) && session.undoStack.length) { recordControl(); undo(); return; }
    if (/^(no reject it|reject it|reject|no)$/.test(control) && pendingProposal) { recordControl(); reject(pendingProposal); return; }
    if (/^(approve it|approve|yes|go ahead|do that)$/.test(control) && pendingProposal) { recordControl(); approve(pendingProposal); return; }
    const userMessage: ConversationMessage = { id: id(), role: "user", text, createdAt: now() };
    const history = session.messages.slice(-10).map((message) => ({ role: message.role, text: message.text, clarification: message.clarification }));
    setSession((current) => ({ ...current, agentState: { ...stateOf(current), phase: stateOf(current).phase === "NEEDS_CLARIFICATION" ? "PLANNING" : "INVESTIGATING", error: null }, messages: [...current.messages, userMessage] }));
    setComposer("");
    setError("");
    runningRef.current = true;
    setRunning(true);
    try {
      const response = await fetch("/api/agent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, message: text, history, currentDate: new Date().toISOString(), pendingProposal, agentState })
      });
      const payload = await response.json() as AgentResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Agent request failed (${response.status})`);
      const assistant: ConversationMessage = { id: id(), role: "assistant", text: payload.message, createdAt: now(), mode: payload.mode, toolTrace: payload.toolTrace, evidence: payload.evidence, proposal: payload.proposal, proposalStatus: payload.proposal ? "pending" : undefined, clarification: payload.clarification };
      const activity: AgentActivity = { id: id(), createdAt: now(), userRequest: text, selectedTools: payload.toolTrace.map((item) => item.tool), proposalId: payload.proposal?.id ?? null, status: payload.proposal ? "proposed" : "answered", appliedChanges: [], beforeScore: null, afterScore: null, mode: payload.mode };
      setSession((current) => ({ ...current, agentState: payload.agentState ?? stateOf(current), messages: [...current.messages, assistant], activity: [activity, ...current.activity].slice(0, 100) }));
      if (/reassess/i.test(text)) setNeedsReassess(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Ali could not complete the request.";
      setError(message);
      setSession((current) => ({ ...current, agentState: { ...stateOf(current), phase: "ERROR", error: message }, messages: [...current.messages, { id: id(), role: "assistant", text: `I couldn't complete that run: ${message}. No project data was changed.`, createdAt: now(), mode }], activity: [{ id: id(), createdAt: now(), userRequest: text, selectedTools: [], proposalId: null, status: "failed", appliedChanges: [], beforeScore: null, afterScore: null, mode }, ...current.activity] }));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const approve = async (proposal: AgentProposal) => {
    if (handledProposalIds.current.has(proposal.id)) { setError("This proposal has already been handled."); return; }
    if (isProposalStale(project, proposal)) { setError("Project data changed after this proposal was created. Ask Ali to reassess before approving it."); setNeedsReassess(true); return; }
    try {
      handledProposalIds.current.add(proposal.id);
      runningRef.current = true; setRunning(true);
      setSession((current) => ({ ...current, agentState: { ...stateOf(current), phase: "EXECUTING", error: null }, messages: [...current.messages, { id: id(), role: "assistant", text: "Plan approved. I’m applying each validated change now.", createdAt: now(), mode }] }));
      await nextPaint();
      const execution = buildProposalExecution(project, proposal);
      for (const step of execution.steps) {
        lastAppliedUpdatedAt.current = step.project.updatedAt; observedUpdatedAt.current = step.project.updatedAt; projectRef.current = step.project;
        onProjectChange(step.project);
        setSession((current) => ({ ...current, messages: [...current.messages, { id: id(), role: "system", text: step.message, createdAt: now() }] }));
        await nextPaint();
      }
      setSession((current) => ({ ...current, agentState: { ...stateOf(current), phase: "VERIFYING" }, messages: [...current.messages, { id: id(), role: "system", text: "Recalculating project health from the updated project…", createdAt: now() }] }));
      await nextPaint();
      const comparison = execution.comparison;
      setError("");
      setSession((current) => {
        const messages = current.messages.map((message): ConversationMessage => {
          if (message.proposal?.id !== proposal.id) return message;
          return { ...message, proposal: { ...proposal, status: "approved" }, proposalStatus: "approved" };
        });
        const nextQuestion = comparison.risksRemaining.length ? `Would you like me to investigate ${comparison.risksRemaining[0].toLowerCase()} next?` : "Would you like a fresh project-health briefing?";
        const confirmation: ConversationMessage = { id: id(), role: "assistant", createdAt: now(), mode, text: `Plan applied and verified. Health moved from ${comparison.previousScore} to ${comparison.newScore} (${comparison.scoreDelta >= 0 ? "+" : ""}${comparison.scoreDelta}). ${comparison.risksRemoved.length ? `Resolved signals: ${comparison.risksRemoved.join(", ")}.` : "No deterministic risk disappeared yet."} ${comparison.risksRemaining.length ? `Remaining: ${comparison.risksRemaining.join(", ")}.` : "No previous risks remain."} ${nextQuestion}`, verification: comparison };
        const activity: AgentActivity = { id: id(), createdAt: now(), userRequest: requestForProposal(current.messages, proposal.id), selectedTools: [], proposalId: proposal.id, status: "approved", appliedChanges: changeLabel(proposal), beforeScore: comparison.previousScore, afterScore: comparison.newScore, mode };
        return { messages: [...messages, confirmation], activity: [activity, ...current.activity], undoStack: [...current.undoStack, execution.undoEntry].slice(-20), agentState: { ...stateOf(current), phase: "IDLE", pendingClarification: null, pendingPlan: null, pendingApprovalProposal: null, lastAppliedProposal: { ...proposal, status: "approved" }, error: null } };
      });
    } catch (caught) {
      handledProposalIds.current.delete(proposal.id); const detail = caught instanceof Error ? caught.message : "The proposal could not be applied safely."; setError(detail);
      setSession((current) => ({ ...current, agentState: { ...stateOf(current), phase: "ERROR", error: detail }, messages: [...current.messages, { id: id(), role: "assistant", text: `I stopped execution safely: ${detail} Tell me whether to reassess, modify, or reject the plan.`, createdAt: now(), mode }] }));
    } finally { runningRef.current = false; setRunning(false); }
  };

  const reject = (proposal: AgentProposal) => {
    if (handledProposalIds.current.has(proposal.id) || proposal.status !== "pending") { setError("This proposal has already been handled."); return; }
    handledProposalIds.current.add(proposal.id);
    setSession((current) => ({
      ...current,
      messages: [...current.messages.map((message): ConversationMessage => message.proposal?.id === proposal.id ? { ...message, proposal: { ...message.proposal, status: "rejected" }, proposalStatus: "rejected" } : message), { id: id(), role: "assistant", text: "Proposal rejected. No project data was changed.", createdAt: now(), mode }],
      activity: [{ id: id(), createdAt: now(), userRequest: requestForProposal(current.messages, proposal.id), selectedTools: [], proposalId: proposal.id, status: "rejected", appliedChanges: [], beforeScore: analysis.score, afterScore: analysis.score, mode }, ...current.activity],
      agentState: { ...stateOf(current), phase: "IDLE", pendingPlan: null, pendingApprovalProposal: null, pendingClarification: null, error: null }
    }));
  };

  const undo = () => {
    const entry = session.undoStack[session.undoStack.length - 1];
    if (!entry) return;
    try {
      const snapshot = undoProposal(project, entry);
      const comparison = compareProjectHealth(project, snapshot);
      lastAppliedUpdatedAt.current = snapshot.updatedAt;
      observedUpdatedAt.current = snapshot.updatedAt;
      onProjectChange(snapshot);
      setSession((current) => ({ ...current, undoStack: current.undoStack.slice(0, -1), agentState: { ...stateOf(current), phase: "IDLE", lastAppliedProposal: null, pendingPlan: null, pendingApprovalProposal: null, error: null }, messages: [...current.messages.map((message): ConversationMessage => message.proposal?.id === entry.proposalId ? { ...message, proposal: message.proposal ? { ...message.proposal, status: "undone" } : null, proposalStatus: "undone" } : message), { id: id(), role: "assistant", text: `Last Ali change undone. The exact previous project snapshot was restored; health returned from ${comparison.previousScore} to ${comparison.newScore}. The restored project is now the active context.`, createdAt: now(), mode, verification: comparison }], activity: [{ id: id(), createdAt: now(), userRequest: "Undo last Ali change", selectedTools: [], proposalId: entry.proposalId, status: "undone", appliedChanges: ["Restored exact previous project snapshot"], beforeScore: comparison.previousScore, afterScore: comparison.newScore, mode }, ...current.activity] }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Undo could not be applied safely."); }
  };

  const clearConversation = () => setSession((current) => ({ ...current, messages: [openingMessage(project)], agentState: emptyAgentConversationState() }));
  const clarify = (option: { id: string; label: string }) => void sendMessage(option.id);
  const modify = () => void sendMessage("Modify plan");

  return <>
    {!open && <button className="ali-fab" onClick={onToggle}><span className="ali-mark"><Sparkles size={15} /></span><span><strong>Ask Ali</strong><small>{mode === "model" ? "AI agent" : "Local demo agent"}</small></span><PanelRightOpen size={17} /></button>}
    <aside className={`ali-panel ${open ? "open" : "closed"}`} aria-label="Ali project agent">
      <header className="ali-header">
        <div className="ali-mark"><Sparkles size={17} /></div>
        <div><h2>Ali</h2><span><i className={running ? "running" : ""} /> {running ? "Investigating" : "Ready"}</span></div>
        <em>{mode === "model" ? "AI agent" : "Local demo agent"}</em>
        <button onClick={onToggle} aria-label="Close Ali"><PanelRightClose size={18} /></button>
      </header>

      <div className="ali-context"><span>{project.name}</span><strong>{analysis.score}/100 · {analysis.status}</strong><em>{agentState.phase.replaceAll("_", " ").toLowerCase()}</em></div>

      <div className="ali-conversation" ref={scrollRef}>
        {session.messages.map((message) => <ChatMessage key={message.id} message={message.proposal && isProposalStale(project, message.proposal) ? { ...message, proposalStatus: "stale" } : message} onApprove={approve} onReject={reject} onModify={modify} onClarification={clarify} />)}
        {running && <div className="ali-running"><LoaderCircle className="spin" size={15} /><span>{agentState.phase === "EXECUTING" ? "Applying validated project changes…" : agentState.phase === "VERIFYING" ? "Recalculating and verifying project health…" : "Choosing tools and checking current data…"}</span></div>}
      </div>

      <SuggestedPrompts onSelect={(prompt) => void sendMessage(prompt)} disabled={running} />

      {error && <div className="ali-error"><X size={13} /> {error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={12} /></button></div>}

      <div className="ali-composer">
        <textarea value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Ask Ali about this project…" rows={2} disabled={running} />
        <button onClick={() => void sendMessage()} disabled={running || !composer.trim()} aria-label="Send message"><Send size={16} /></button>
        <small>Enter to send · Shift+Enter for a new line</small>
      </div>

      <div className="ali-controls">
        <button onClick={undo} disabled={!canUndo} title={session.undoStack.length && !canUndo ? "Project changed after Ali's action; undo is disabled to protect newer edits." : undefined}><RotateCcw size={13} /> Undo last Ali change</button>
        <button onClick={clearConversation}><Eraser size={13} /> Clear conversation</button>
      </div>
      {needsReassess && <button className="ali-reassess" onClick={() => void sendMessage("Reassess now")} disabled={running}><RefreshCcw size={13} /> Reassess project</button>}

      <section className="ali-activity">
        <button onClick={() => setActivityOpen((value) => !value)}><span><Activity size={13} /> Ali activity <em>{session.activity.length}</em></span><ChevronDown size={13} className={activityOpen ? "open" : ""} /></button>
        {activityOpen && <div>{session.activity.length === 0 ? <p>No activity yet.</p> : session.activity.slice(0, 20).map((item) => <article key={item.id}>
          <span className={`activity-status ${item.status}`}><History size={11} /> {item.status}</span><time>{new Date(item.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
          <strong>{item.userRequest}</strong>
          <small>{item.selectedTools.length ? `${item.selectedTools.join(" → ")}` : item.appliedChanges.join(" · ") || "No tools selected"}</small>
          {item.beforeScore !== null && <em>{item.beforeScore} → {item.afterScore} · {item.mode}</em>}
        </article>)}</div>}
      </section>
    </aside>
  </>;
}
