import { useState, KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";

// Lightweight intent router — maps natural-language goals to existing workflows.
// No new functionality, just a faster way to reach what already exists.
const INTENTS: { match: RegExp; path: string; label: string }[] = [
  { match: /(grant|fund|funding|capital|money)/i, path: "/funding", label: "Find funding" },
  { match: /(customer|lead|prospect|outreach|sales)/i, path: "/prospects", label: "Get customers" },
  { match: /(distribut|channel|community|where to post|reach)/i, path: "/distribution", label: "Find distribution" },
  { match: /(audience|persona|icp|who)/i, path: "/audience", label: "Understand audience" },
  { match: /(campaign|launch|series)/i, path: "/orchestrator", label: "Launch a campaign" },
  { match: /(book|launch.*book|promote.*book)/i, path: "/create", label: "Promote a book" },
  { match: /(revenue|sales|money in|earn)/i, path: "/revenue", label: "Grow revenue" },
  { match: /(report|brief|weekly|summary)/i, path: "/weekly-reports", label: "Executive briefs" },
  { match: /(perform|analytic|metric)/i, path: "/analytics", label: "See performance" },
  { match: /(post|content|write|tweet|linkedin)/i, path: "/create", label: "Create a post" },
];

const SUGGESTIONS = ["Get customers", "Promote a book", "Launch a campaign", "Find grants", "Grow revenue"];

export function CommandBar() {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const navigate = useNavigate();

  const route = (q: string) => {
    const hit = INTENTS.find((i) => i.match.test(q));
    navigate(hit ? hit.path : "/create");
    setValue("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim()) route(value.trim());
  };

  return (
    <div className="relative w-full max-w-xl">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 shadow-sm focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="What would you like to achieve?"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {value && (
          <button onClick={() => route(value.trim())} className="text-primary hover:text-primary/80">
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
      {focused && !value && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-lg border border-border bg-popover p-2 shadow-lg">
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Try</p>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onMouseDown={() => route(s)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              {s}
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
