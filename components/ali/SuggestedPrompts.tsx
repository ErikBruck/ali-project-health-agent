"use client";

const prompts = [
  "Give me a project health briefing",
  "Fix this project",
  "Why is this project at risk?",
  "What should I fix first?",
  "Investigate the budget problem",
  "Fix the budget issue",
  "Find overloaded team members",
  "Help me resolve the biggest blocker",
  "Create a recovery plan",
  "Reforecast the budget",
  "Defer the non-critical work",
  "Move work from Mia to Leo",
  "Create an estimate-validation checklist",
  "Move the deadline forward by one week",
  "Reduce Mia's allocation to 95%",
  "Mark the design approval task as completed",
  "What can Ali do?"
];

export function SuggestedPrompts({ onSelect, disabled }: { onSelect: (prompt: string) => void; disabled: boolean }) {
  return <div className="ali-suggestions" aria-label="Suggested prompts">
    {prompts.map((prompt) => <button key={prompt} onClick={() => onSelect(prompt)} disabled={disabled}>{prompt}</button>)}
  </div>;
}
