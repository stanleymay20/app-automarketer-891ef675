import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Gauge,
  FileText,
  AppWindow,
  Calendar,
  Rocket,
  Users,
  Target,
  Megaphone,
  Landmark,
  Settings,
  Bell,
  Send,
  LogOut,
  ChevronDown,
  FlaskConical,
  Radar,
  Brain,
  Lightbulb,
  BarChart3,
  DollarSign,
  X,
  Zap,
  Inbox,
  ShieldCheck,
  CalendarClock,
  ScrollText,
} from "lucide-react";
import { useReviewPendingCount } from "@/hooks/useReviewQueue";
import { usePendingProposalsCount } from "@/hooks/useProposals";
import { useUpcomingMeetingsCount } from "@/hooks/useMeetings";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useUserSettings, useUpdateUserSettings } from "@/hooks/useUserSettings";
import logo from "@/assets/logo.png";

type NavItem = { icon: any; label: string; path: string };
type NavSection = { label: string; items: NavItem[] };

// Top-level information architecture — outcomes, not engines.
const SECTIONS: NavSection[] = [
  {
    label: "Growth OS",
    items: [
      { icon: Zap, label: "Today", path: "/today" },
      { icon: Gauge, label: "Home", path: "/dashboard" },
      { icon: Gauge, label: "Reality", path: "/" },
      { icon: DollarSign, label: "Revenue", path: "/revenue" },
      { icon: BarChart3, label: "Performance", path: "/analytics" },
      { icon: FileText, label: "Executive Briefs", path: "/weekly-reports" },
    ],
  },
  {
    label: "Campaigns",
    items: [
      { icon: FileText, label: "Create Post", path: "/create" },
      { icon: AppWindow, label: "Campaigns", path: "/content" },
      { icon: Calendar, label: "Calendar", path: "/calendar" },
      { icon: Rocket, label: "Orchestrator", path: "/orchestrator" },
    ],
  },
  {
    label: "Customers",
    items: [
      { icon: Users, label: "Audience", path: "/audience" },
      { icon: Target, label: "Prospects", path: "/prospects" },
      { icon: ShieldCheck, label: "Review", path: "/review" },
      { icon: CalendarClock, label: "Meetings", path: "/meetings" },
      { icon: ScrollText, label: "Proposals", path: "/proposals" },
      { icon: Inbox, label: "Inbox", path: "/inbox" },
      { icon: Megaphone, label: "Distribution", path: "/distribution" },
    ],
  },
  {
    label: "Funding",
    items: [{ icon: Landmark, label: "Grants", path: "/funding" }],
  },
];

const ADVANCED: NavItem[] = [
  { icon: Radar, label: "Market Intelligence", path: "/market-intelligence" },
  { icon: Brain, label: "Portfolio Intelligence", path: "/content-intelligence" },
  { icon: Lightbulb, label: "Growth Patterns", path: "/intelligence" },
  { icon: AppWindow, label: "Offerings", path: "/apps" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const { signOut } = useAuth();
  const { data: settings } = useUserSettings();
  const updateSettings = useUpdateUserSettings();
  const { data: reviewCount = 0 } = useReviewPendingCount();
  const [advancedOpen, setAdvancedOpen] = useState(
    ADVANCED.some((i) => i.path === location.pathname)
  );

  const handleApprovalModeChange = (checked: boolean) => {
    updateSettings.mutate({ approval_mode: checked, autopilot_mode: !checked });
  };
  const handleAutopilotChange = (checked: boolean) => {
    updateSettings.mutate({ autopilot_mode: checked, approval_mode: !checked });
  };

  const renderItem = (item: NavItem) => {
    const isActive = location.pathname === item.path;
    const showBadge = item.path === "/review" && reviewCount > 0;
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={onClose}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-accent text-primary"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
      >
        <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
        <span className="flex-1">{item.label}</span>
        {showBadge && (
          <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground">
            {reviewCount > 99 ? "99+" : reviewCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 ease-in-out",
        "lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <img src={logo} alt="ScrollMarketer" className="h-9 w-9" />
          <div className="font-display text-lg font-bold leading-tight">
            <span className="text-primary">Scroll</span>
            <span className="text-secondary">Marketer</span>
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent lg:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-4">
        {SECTIONS.map((section) => (
          <div key={section.label} className="space-y-0.5">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {section.label}
            </p>
            {section.items.map(renderItem)}
          </div>
        ))}

        {/* Advanced — hidden by default, no power lost */}
        <div className="space-y-0.5 pt-2 border-t border-sidebar-border">
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <FlaskConical className="h-3 w-3" />
              Advanced
            </span>
            <ChevronDown className={cn("h-3 w-3 transition-transform", advancedOpen && "rotate-180")} />
          </button>
          {advancedOpen && ADVANCED.map(renderItem)}
        </div>

        <div className="space-y-0.5 pt-2 border-t border-sidebar-border">
          {renderItem({ icon: Settings, label: "Settings", path: "/settings" })}
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-2">
        <div className="flex items-center justify-between rounded-lg bg-accent/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium">Approval</span>
          </div>
          <Switch
            checked={settings?.approval_mode ?? true}
            onCheckedChange={handleApprovalModeChange}
            className="data-[state=checked]:bg-info scale-90"
          />
        </div>
        <div className="flex items-center justify-between rounded-lg bg-gradient-to-r from-primary/10 to-secondary/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium">Autopilot</span>
            {settings?.autopilot_mode && (
              <span className="rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-semibold text-success">ON</span>
            )}
          </div>
          <Switch
            checked={settings?.autopilot_mode ?? false}
            onCheckedChange={handleAutopilotChange}
            className="data-[state=checked]:bg-secondary scale-90"
          />
        </div>
        <button
          onClick={() => signOut()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
