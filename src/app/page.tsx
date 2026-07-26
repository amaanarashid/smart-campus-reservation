import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/app-shell";
import { CalendarCheck, Sparkles, SlidersHorizontal, MessageCircle } from "lucide-react";

const FEATURES = [
  {
    icon: CalendarCheck,
    title: "Book online, instantly",
    desc: "Discussion rooms, sports courts, meeting rooms and event halls in one place - no queues, no paper forms.",
  },
  {
    icon: Sparkles,
    title: "AI-recommended slots",
    desc: "Tell us your group size and preferred time; the system scores every free slot and explains each suggestion.",
  },
  {
    icon: SlidersHorizontal,
    title: "Rules that fit each facility",
    desc: "Operating hours, duration limits and cancellation policies are configured per facility by administrators.",
  },
  {
    icon: MessageCircle,
    title: "Ask the assistant",
    desc: "A chatbot answers availability and policy questions from live data, any time of day.",
  },
];

const STEPS = [
  ["Sign in", "Use your university account to access the platform."],
  ["Pick a facility", "Browse venues across campus with live availability."],
  ["Accept a suggested slot", "The system recommends the best times for your group."],
  ["Show up", "Approval status and equipment live on your dashboard."],
];

const STATS = [
  ["6", "facility categories"],
  ["3", "role-based dashboards"],
  ["0", "queues at the counter"],
  ["24/7", "assistant availability"],
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="h-1 bg-gradient-to-r from-primary via-primary/70 to-primary" />
      <header className="sticky top-0 z-40 border-b bg-card/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <BrandMark />
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground">
        <div className="pattern-dots absolute inset-0" aria-hidden />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-24 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-medium tracking-wide">
            <Sparkles className="h-3.5 w-3.5" />
            AI-assisted campus reservations
          </span>
          <h1 className="font-display mx-auto max-w-3xl pt-6 text-5xl font-semibold leading-[1.1] sm:text-6xl">
            Campus facilities,
            <br />
            booked in seconds
          </h1>
          <p className="mx-auto max-w-2xl pt-6 text-lg leading-relaxed text-primary-foreground/85">
            One platform for every shared space on campus - with intelligent slot
            recommendations, per-facility booking policies, and a built-in assistant
            that answers from live availability.
          </p>
          <div className="flex items-center justify-center gap-3 pt-9">
            <Button size="lg" variant="secondary" className="shadow-lg" asChild>
              <Link href="/login">Get started</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* stats strip */}
      <section className="border-b bg-card">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 divide-x divide-border px-4 py-8 text-center sm:grid-cols-4">
          {STATS.map(([n, label]) => (
            <div key={label} className="px-2">
              <p className="font-display text-3xl font-semibold text-primary">{n}</p>
              <p className="pt-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-20">
        <h2 className="font-display text-center text-3xl font-semibold">
          Built for students, managers and administrators
        </h2>
        <div className="grid gap-5 pt-10 md:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title}
              className="group rounded-2xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="pt-4 text-lg font-semibold">{f.title}</h3>
              <p className="pt-1.5 leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>

        <h2 className="font-display pt-20 text-center text-3xl font-semibold">How it works</h2>
        <ol className="relative grid gap-8 pt-10 md:grid-cols-4">
          <div className="absolute left-[12%] right-[12%] top-[3.25rem] hidden h-px bg-border md:block" aria-hidden />
          {STEPS.map(([title, desc], i) => (
            <li key={title} className="relative text-center">
              <span className="font-display mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-primary bg-card text-lg font-semibold text-primary shadow-sm">
                {i + 1}
              </span>
              <h3 className="pt-4 font-semibold">{title}</h3>
              <p className="pt-1 text-sm leading-relaxed text-muted-foreground">{desc}</p>
            </li>
          ))}
        </ol>
      </main>

      {/* closing CTA */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground">
        <div className="pattern-dots absolute inset-0" aria-hidden />
        <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-4 py-14 text-center">
          <h2 className="font-display text-3xl font-semibold">Ready to skip the queue?</h2>
          <Button size="lg" variant="secondary" className="shadow-lg" asChild>
            <Link href="/login">Book your first facility</Link>
          </Button>
        </div>
      </section>

      <footer className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row">
          <span>Campus Reserve - Smart Facility Reservation System</span>
          <span>Book campus facilities in seconds</span>
        </div>
      </footer>
    </div>
  );
}
