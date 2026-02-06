import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Rocket, Sparkles, BarChart3, ArrowRight, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/logo.png";

const features = [
  {
    icon: Sparkles,
    title: "AI-Powered Content",
    description: "Authentic marketing posts tailored to your app's voice and audience.",
  },
  {
    icon: Rocket,
    title: "Full Autopilot",
    description: "Set it and forget it. We create, schedule, and publish automatically.",
  },
  {
    icon: BarChart3,
    title: "Track What Works",
    description: "Simple metrics show if your marketing is driving results.",
  },
];

const plans = [
  {
    name: "Free",
    price: "€0",
    description: "Try it out",
    features: ["1 app", "10 posts/month", "Manual approval"],
    cta: "Start Free",
    highlighted: false,
  },
  {
    name: "Starter",
    price: "€29",
    period: "/mo",
    description: "For indie builders",
    features: ["3 apps", "100 posts/month", "Autopilot ON", "Priority scheduling"],
    cta: "Start Autopilot",
    highlighted: true,
  },
  {
    name: "Pro",
    price: "€79",
    period: "/mo",
    description: "Scale without limits",
    features: ["Unlimited apps", "Unlimited posts", "Autopilot ON", "Priority support"],
    cta: "Go Pro",
    highlighted: false,
  },
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img src={logo} alt="ScrollMarketer" className="h-10 w-10" />
            <span className="font-display text-xl font-bold">
              <span className="text-primary">Scroll</span>
              <span className="text-secondary">Marketer</span>
            </span>
          </div>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Features
            </a>
            <a href="#pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Pricing
            </a>
          </div>

          <Link to={user ? "/dashboard" : "/auth"}>
            <Button>{user ? "Dashboard" : "Start Free"}</Button>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 lg:py-28">
        <div className="max-w-3xl mx-auto text-center animate-fade-in">
          <h1 className="font-display text-4xl font-bold leading-tight text-foreground lg:text-5xl xl:text-6xl">
            Your apps. Their marketing.
            <br />
            <span className="text-primary">Fully automated.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
            ScrollMarketer uses AI to create, schedule, and publish marketing content while you build.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link to={user ? "/dashboard" : "/auth"}>
              <Button size="lg" className="gap-2 bg-success hover:bg-success/90">
                Start Autopilot Free
                <Rocket className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            No credit card required · Set up in 2 minutes
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="border-t border-border/50 bg-card/50 py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-center font-display text-2xl font-bold mb-12 lg:text-3xl">
            Marketing that runs itself
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            {features.map((feature, idx) => (
              <div
                key={feature.title}
                className="group rounded-2xl bg-card p-8 shadow-card transition-all duration-300 hover:shadow-card-hover animate-fade-in"
                style={{ animationDelay: `${idx * 0.1}s` }}
              >
                <div className="mb-4 inline-flex rounded-xl bg-accent p-3">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 font-display text-xl font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-center font-display text-2xl font-bold mb-4 lg:text-3xl">
            Simple, transparent pricing
          </h2>
          <p className="text-center text-muted-foreground mb-12">
            Start free. Upgrade when you need more.
          </p>
          <div className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-6 ${
                  plan.highlighted
                    ? "bg-gradient-to-br from-primary/10 to-secondary/10 border-2 border-primary shadow-lg"
                    : "bg-card border border-border shadow-card"
                }`}
              >
                {plan.highlighted && (
                  <p className="text-xs font-semibold text-primary mb-2">MOST POPULAR</p>
                )}
                <h3 className="font-display text-xl font-bold">{plan.name}</h3>
                <p className="text-sm text-muted-foreground">{plan.description}</p>
                <div className="mt-4 mb-6">
                  <span className="text-3xl font-bold">{plan.price}</span>
                  {plan.period && <span className="text-muted-foreground">{plan.period}</span>}
                </div>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-success" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link to="/auth">
                  <Button
                    className={`w-full ${plan.highlighted ? "bg-primary" : ""}`}
                    variant={plan.highlighted ? "default" : "outline"}
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h2 className="mb-4 font-display text-3xl font-bold text-foreground lg:text-4xl">
          Ready to automate your marketing?
        </h2>
        <p className="mx-auto mb-8 max-w-xl text-muted-foreground">
          Go from sign-up to marketing running in under 5 minutes.
        </p>
        <Link to={user ? "/dashboard" : "/auth"}>
          <Button size="lg" className="gap-2 bg-success hover:bg-success/90">
            Start Autopilot Free
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card/30 py-8">
        <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 md:flex-row">
          <div className="flex items-center gap-2">
            <img src={logo} alt="ScrollMarketer" className="h-8 w-8" />
            <span className="font-display text-lg font-bold">
              <span className="text-primary">Scroll</span>
              <span className="text-secondary">Marketer</span>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">© 2025 ScrollMarketer. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
