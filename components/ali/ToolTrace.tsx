"use client";

import { CheckCircle2, ChevronDown, Wrench } from "lucide-react";
import { useState } from "react";
import type { AgentToolTrace } from "@/lib/agent/types";

export function ToolTrace({ trace }: { trace: AgentToolTrace[] }) {
  const [open, setOpen] = useState(false);
  if (!trace.length) return null;
  return <div className="ali-trace">
    <button onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span><Wrench size={12} /> {trace.length} tool{trace.length === 1 ? "" : "s"} used</span><ChevronDown size={13} className={open ? "open" : ""} />
    </button>
    {open && <div className="ali-trace-list">{trace.map((item, index) => <div key={`${item.tool}-${index}`}>
      <CheckCircle2 size={12} /><span><code>{item.tool}</code><small>{item.summary}</small><details><summary>Inputs and result</summary><pre>{JSON.stringify({ arguments: item.arguments, result: item.result }, null, 2)}</pre></details></span>
    </div>)}</div>}
  </div>;
}
