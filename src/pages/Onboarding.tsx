import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, ArrowLeft, Rocket, Sparkles, Check, Wand2, Loader2 } from "lucide-react";
import logo from "@/assets/logo.png";

const PLATFORMS = [
  { id: "x", label: "X (Twitter)" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
];

const BRAND_TONES = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual & Friendly" },
  { value: "playful", label: "Playful & Fun" },
  { value: "technical", label: "Technical & Detailed" },
  { value: "inspiring", label: "Inspiring & Motivational" },
];

const GOALS = [
  { value: "growth", label: "User Growth" },
  { value: "installs", label: "App Installs" },
  { value: "signups", label: "Signups" },
  { value: "awareness", label: "Brand Awareness" },
  { value: "engagement", label: "Community Engagement" },
];

interface Analyzed {
  name: string;
  description: string;
  target_audience: string;
  brand_tone: string;
  key_themes: string[];
  value_props: string[];
}

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState<Analyzed | null>(null);

  // Form state
  const [appName, setAppName] = useState("");
  const [description, setDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [brandTone, setBrandTone] = useState("professional");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

  const totalSteps = 4;

  const handlePlatformToggle = (platformId: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platformId)
        ? prev.filter((p) => p !== platformId)
        : [...prev, platformId]
    );
  };

  const handleAnalyze = async () => {
    if (!websiteUrl.trim()) {
      toast({ title: "Add a URL first", description: "Paste your website or app URL." });
      return;
    }
    setIsAnalyzing(true);
    setAnalyzed(null);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-website", {
        body: { url: websiteUrl.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = data as Analyzed;
      setAnalyzed(result);
      // Pre-fill (don't overwrite if user already typed name)
      if (!appName && result.name) setAppName(result.name);
      if (!description && result.description) setDescription(result.description);
      if (!targetAudience && result.target_audience) setTargetAudience(result.target_audience);
      if (result.brand_tone) setBrandTone(result.brand_tone);

      toast({ title: "Got it", description: "We've drafted your setup — review on the next steps." });
    } catch (e: any) {
      toast({
        title: "Couldn't analyze that URL",
        description: e.message || "Try again or fill the fields manually.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleComplete = async () => {
    if (!user) return;

    setIsSubmitting(true);
    try {
      // Create the app
      const { error: appError } = await supabase.from("apps").insert({
        user_id: user.id,
        name: appName,
        description,
        target_audience: targetAudience,
        primary_goal: primaryGoal,
        brand_tone: brandTone,
        website_url: websiteUrl || null,
        platforms: selectedPlatforms,
      });

      if (appError) throw appError;

      // Ensure autopilot is ON
      await supabase
        .from("user_settings")
        .update({ autopilot_mode: true, approval_mode: false })
        .eq("user_id", user.id);

      queryClient.invalidateQueries({ queryKey: ["apps"] });
      queryClient.invalidateQueries({ queryKey: ["user_settings"] });

      toast({
        title: "You're all set!",
        description: "ScrollMarketer is now marketing your app automatically.",
      });

      navigate("/dashboard");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return appName.trim().length > 0;
      case 2:
        return description.trim().length > 0 && targetAudience.trim().length > 0;
      case 3:
        return selectedPlatforms.length > 0;
      case 4:
        return true;
      default:
        return false;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center gap-2">
          <img src={logo} alt="ScrollMarketer" className="h-10 w-10" />
          <span className="font-display text-xl font-bold">
            <span className="text-primary">Scroll</span>
            <span className="text-secondary">Marketer</span>
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="container max-w-2xl mx-auto px-4 mb-8">
        <div className="flex gap-2">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
        <p className="text-sm text-muted-foreground text-center mt-2">
          Step {step} of {totalSteps}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 container max-w-xl mx-auto px-4 pb-8">
        <div className="bg-card rounded-2xl p-8 shadow-card">
          {step === 1 && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center">
                <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <Rocket className="h-6 w-6 text-primary" />
                </div>
                <h1 className="font-display text-2xl font-bold mb-2">Let's add your first app</h1>
                <p className="text-muted-foreground">
                  Paste your website — we'll read it and draft your setup
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="websiteUrl">Website or App Store URL</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Input
                      id="websiteUrl"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      placeholder="https://yoursite.com"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAnalyze(); } }}
                    />
                    <Button
                      type="button"
                      onClick={handleAnalyze}
                      disabled={isAnalyzing || !websiteUrl.trim()}
                      className="shrink-0 gap-1.5"
                    >
                      {isAnalyzing ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />Reading…</>
                      ) : (
                        <><Wand2 className="h-4 w-4" />Analyze</>
                      )}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Takes ~15 seconds. We'll pre-fill the next steps so you can launch faster.
                  </p>
                </div>

                {analyzed && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 animate-fade-in">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-primary">Here's what we learned</span>
                    </div>
                    <div className="grid gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Product: </span>
                        <span className="font-medium">{analyzed.name || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">What it does: </span>
                        <span>{analyzed.description || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Who it's for: </span>
                        <span>{analyzed.target_audience || "—"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">Tone:</span>
                        <Badge variant="secondary" className="text-xs capitalize">{analyzed.brand_tone}</Badge>
                      </div>
                      {analyzed.key_themes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {analyzed.key_themes.map((t) => (
                            <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground pt-1 border-t border-primary/10">
                      You can edit any of this on the next steps.
                    </p>
                  </div>
                )}

                <div>
                  <Label htmlFor="appName">App Name *</Label>
                  <Input
                    id="appName"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    placeholder="e.g., My Awesome App"
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center">
                <h1 className="font-display text-2xl font-bold mb-2">Describe your app</h1>
                <p className="text-muted-foreground">
                  {analyzed ? "Review what we drafted — edit anything that's off" : "This helps us create authentic marketing content"}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="description">What does your app do? *</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Briefly describe your app's main features and value..."
                    className="mt-1.5 min-h-24"
                  />
                </div>

                <div>
                  <Label htmlFor="targetAudience">Who is it for? *</Label>
                  <Input
                    id="targetAudience"
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    placeholder="e.g., Indie developers, small business owners..."
                    className="mt-1.5"
                  />
                </div>

                <div>
                  <Label htmlFor="primaryGoal">Primary Marketing Goal</Label>
                  <Select value={primaryGoal} onValueChange={setPrimaryGoal}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Select a goal" />
                    </SelectTrigger>
                    <SelectContent>
                      {GOALS.map((goal) => (
                        <SelectItem key={goal.value} value={goal.value}>
                          {goal.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="brandTone">Brand Tone</Label>
                  <Select value={brandTone} onValueChange={setBrandTone}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BRAND_TONES.map((tone) => (
                        <SelectItem key={tone.value} value={tone.value}>
                          {tone.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center">
                <h1 className="font-display text-2xl font-bold mb-2">Where should we post?</h1>
                <p className="text-muted-foreground">
                  Select the platforms you want to market on
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {PLATFORMS.map((platform) => (
                  <button
                    key={platform.id}
                    type="button"
                    onClick={() => handlePlatformToggle(platform.id)}
                    className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                      selectedPlatforms.includes(platform.id)
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={selectedPlatforms.includes(platform.id)}
                        className="pointer-events-none"
                      />
                      <span className="font-medium">{platform.label}</span>
                    </div>
                  </button>
                ))}
              </div>

              {selectedPlatforms.length > 0 && (
                <p className="text-center text-sm text-muted-foreground">
                  {selectedPlatforms.length} platform{selectedPlatforms.length > 1 ? "s" : ""} selected
                </p>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6 animate-fade-in">
              <div className="text-center">
                <div className="mx-auto w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center mb-4">
                  <Sparkles className="h-6 w-6 text-success" />
                </div>
                <h1 className="font-display text-2xl font-bold mb-2">Ready to launch!</h1>
                <p className="text-muted-foreground">
                  ScrollMarketer will now create, schedule, and publish marketing content for{" "}
                  <span className="font-semibold text-foreground">{appName}</span> automatically.
                </p>
              </div>

              <div className="bg-muted/50 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-success/10 flex items-center justify-center">
                    <Check className="h-4 w-4 text-success" />
                  </div>
                  <span className="text-sm">AI-powered content creation</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-success/10 flex items-center justify-center">
                    <Check className="h-4 w-4 text-success" />
                  </div>
                  <span className="text-sm">Smart scheduling across {selectedPlatforms.length} platforms</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-success/10 flex items-center justify-center">
                    <Check className="h-4 w-4 text-success" />
                  </div>
                  <span className="text-sm">Automatic publishing (Autopilot ON)</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded-full bg-success/10 flex items-center justify-center">
                    <Check className="h-4 w-4 text-success" />
                  </div>
                  <span className="text-sm">Performance tracking & analytics</span>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
            {step > 1 ? (
              <Button variant="ghost" onClick={() => setStep(step - 1)} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            ) : (
              <div />
            )}

            {step < totalSteps ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canProceed()} className="gap-2">
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleComplete} disabled={isSubmitting} className="gap-2 bg-success hover:bg-success/90">
                {isSubmitting ? "Setting up..." : "Start Autopilot"}
                <Rocket className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
