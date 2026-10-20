"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { goalSchema, profileSchema, type GoalRecord, type Profile } from "@healthcare/contracts";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { ApiError, postJson, requestJson } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type Tab = "home" | "food" | "activity" | "progress";
type StoredGoal = GoalRecord & { id: string };
type Measurement = { id: string; data: { measuredAt: string; weightKg: number } };
type ProfileResponse = { profile: unknown | null };
type GoalsResponse = { current: (Record<string, unknown> & { id: string }) | null; versions: unknown[]; measurements: Measurement[] };

const tabs: { key: Tab; label: string; glyph: string }[] = [
  { key: "home", label: "Home", glyph: "⌂" },
  { key: "food", label: "Food", glyph: "◉" },
  { key: "activity", label: "Activity", glyph: "↗" },
  { key: "progress", label: "Progress", glyph: "⌁" },
];

function friendlyError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "Your session expired. Sign in again to continue.";
  return error instanceof Error ? error.message : "Could not load your account data.";
}

export function DashboardApp() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [tab, setTab] = useState<Tab>("home");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<StoredGoal | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [loadError, setLoadError] = useState("");

  const reloadData = useCallback(async () => {
    if (!session?.user.id) return;
    setLoadingData(true);
    setLoadError("");
    try {
      const [profileData, goalData] = await Promise.all([
        requestJson<ProfileResponse>("/v1/me"),
        requestJson<GoalsResponse>("/v1/goals"),
      ]);
      const parsedProfile = profileSchema.safeParse(profileData.profile);
      const parsedGoal = goalData.current ? goalSchema.safeParse(goalData.current) : null;
      setProfile(parsedProfile?.success ? parsedProfile.data : null);
      setGoal(parsedGoal?.success && goalData.current ? { ...parsedGoal.data, id: String(goalData.current.id) } : null);
      setMeasurements(goalData.measurements.filter((item) => Number.isFinite(item.data?.weightKg) && typeof item.data?.measuredAt === "string"));
    } catch (error) {
      setLoadError(friendlyError(error));
    } finally {
      setLoadingData(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reloadData(), 0);
    return () => window.clearTimeout(timer);
  }, [reloadData]);

  if (isPending) return <LoadingPage label="Opening your account" />;
  if (!session?.user) return <AuthPage onComplete={() => void refetch()} />;
  if (loadingData) return <LoadingPage label="Loading your health data" />;
  if (loadError) {
    return (
      <main className="center-page">
        <section className="notice-card" role="alert">
          <span className="brand-mark">GH</span>
          <h1>Couldn’t open your account</h1>
          <p>{loadError}</p>
          <button className="button button-primary" onClick={() => void reloadData()}>Try again</button>
        </section>
      </main>
    );
  }
  if (!profile || !goal) {
    return <main className="onboarding-page"><OnboardingWizard initialName={session.user.name ?? ""} onComplete={() => void reloadData()} /></main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand-lockup" href="#home" onClick={() => setTab("home")}>
          <span className="brand-mark">GH</span>
          <span><strong>Goal Health</strong><small>Daily, at your pace</small></span>
        </a>
        <nav className="side-nav">
          {tabs.map((item) => <NavButton key={item.key} tab={item.key} current={tab} label={item.label} glyph={item.glyph} onClick={setTab} />)}
        </nav>
        <div className="sidebar-bottom">
          <div className="account-pill"><span className="avatar">{(profile.displayName[0] ?? "G").toUpperCase()}</span><span><strong>{profile.displayName}</strong><small>Personal space</small></span></div>
          <button className="quiet-button" onClick={async () => { await authClient.signOut(); await refetch(); }}>Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">GH</span><strong>Goal Health</strong></div>
          <div className="topbar-date">{new Intl.DateTimeFormat("en-IN", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</div>
          <div className="topbar-user"><span className="avatar">{(profile.displayName[0] ?? "G").toUpperCase()}</span><span>{profile.displayName}</span><button className="quiet-button desktop-signout" onClick={async () => { await authClient.signOut(); await refetch(); }}>Sign out</button></div>
        </header>

        <div className="content-wrap">
          {tab === "home" ? <HomeView profile={profile} goal={goal} measurements={measurements} onProgress={() => setTab("progress")} /> : null}
          {tab === "food" ? <ComingSoonView eyebrow="FOOD TRACKING" title="Build your food log" description="Search foods, confirm portions, and see calories and macros for each meal." icon="◉" /> : null}
          {tab === "activity" ? <ComingSoonView eyebrow="ACTIVITY" title="Movement that fits your day" description="Log workouts and steps manually. Direct Health Connect sync is not available in this web version." icon="↗" /> : null}
          {tab === "progress" ? <ProgressView goal={goal} measurements={measurements} onMeasurementAdded={reloadData} /> : null}
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {tabs.map((item) => <NavButton key={item.key} tab={item.key} current={tab} label={item.label} glyph={item.glyph} onClick={setTab} />)}
      </nav>
    </div>
  );
}

function NavButton({ tab, current, label, glyph, onClick }: { tab: Tab; current: Tab; label: string; glyph: string; onClick: (tab: Tab) => void }) {
  return (
    <button className={current === tab ? "nav-item nav-item-active" : "nav-item"} aria-current={current === tab ? "page" : undefined} onClick={() => onClick(tab)}>
      <span className="nav-glyph" aria-hidden="true">{glyph}</span><span>{label}</span>
    </button>
  );
}

function AuthPage({ onComplete }: { onComplete: () => void }) {
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = mode === "sign_up"
        ? await authClient.signUp.email(
            { name: name.trim(), email: email.trim(), password },
            { headers: { "x-invitation-code": inviteCode.trim() } },
          )
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError(result.error.message || "Check your details and try again.");
        return;
      }
      onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-marketing">
        <Link className="brand-lockup" href="/"><span className="brand-mark">GH</span><span><strong>Goal Health</strong><small>Daily, at your pace</small></span></Link>
        <div className="auth-hero-copy">
          <span className="eyebrow">A CLEARER VIEW OF PROGRESS</span>
          <h1>Small steps.<br /><em>Visible change.</em></h1>
          <p>Food, movement, and the goal line you chose—together in one calm view.</p>
        </div>
        <div className="auth-graph-preview" aria-hidden="true"><span /><span /><span /><span /><span /><div className="auth-graph-line" /></div>
      </div>
      <section className="auth-card" aria-labelledby="auth-title">
        <span className="eyebrow">PRIVATE BY ACCOUNT</span>
        <h2 id="auth-title">{mode === "sign_up" ? "Create your account" : "Welcome back"}</h2>
        <p>Each invited friend gets a separate, private account.</p>
        <form onSubmit={(event) => void submit(event)} className="auth-form">
          {mode === "sign_up" ? <Field label="Name" value={name} onChange={setName} autoComplete="name" /> : null}
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <Field label="Password" type="password" value={password} onChange={setPassword} minLength={12} autoComplete={mode === "sign_up" ? "new-password" : "current-password"} />
          {mode === "sign_up" ? <Field label="Invitation code" value={inviteCode} onChange={setInviteCode} autoCapitalize="none" /> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "sign_up" ? "Create account" : "Sign in"}</button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === "sign_up" ? "sign_in" : "sign_up"); setError(""); }}>
          {mode === "sign_up" ? "Already have an account? Sign in" : "Have an invitation? Create an account"}
        </button>
        <small className="auth-footnote">Health data is personal. Never use someone else’s account.</small>
      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  ...inputProps
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <label className="field" htmlFor={id}><span>{label}</span><input id={id} value={value} onChange={(event) => onChange(event.target.value)} {...inputProps} /></label>;
}

function LoadingPage({ label }: { label: string }) {
  return <main className="center-page"><div className="loading-mark"><span className="brand-mark">GH</span><p>{label}…</p></div></main>;
}

function HomeView({ profile, goal, measurements, onProgress }: { profile: Profile; goal: StoredGoal; measurements: Measurement[]; onProgress: () => void }) {
  const kcal = goal.dailyCaloriesKcal;
  const latest = [...measurements].sort((a, b) => b.data.measuredAt.localeCompare(a.data.measuredAt))[0];
  const movementDays = Math.min(7, Math.max(0, profile.availableWorkoutDays));
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">TODAY’S OVERVIEW</span><h1>Good {dayGreeting()}, {profile.displayName.split(" ")[0]}.</h1><p>One day at a time. Your plan is here when you need it.</p></div><button className="install-hint" onClick={() => alert("In Chrome, open the menu and choose ‘Add to Home screen’ or ‘Install app’.")}>＋ Add to home screen</button></div>
      <button className="goal-hero" onClick={onProgress}>
        <div className="goal-hero-copy"><span className="eyebrow">YOUR GOAL PATH · VERSION {goal.goalVersion}</span><strong>{goal.startWeightKg.toFixed(1)} <span>→</span> {goal.targetWeightKg.toFixed(1)} <small>kg</small></strong><span>Target date · {formatDate(goal.targetDate)}</span></div>
        <div className="goal-ring"><span>{goal.direction === "lose" ? "−" : goal.direction === "gain" ? "+" : "="}</span><small>{goal.direction}</small></div>
      </button>

      <section className="dashboard-grid">
        <article className="panel progress-panel">
          <div className="panel-heading"><div><span className="eyebrow">THE MAIN THING</span><h2>Your progress</h2></div><button className="inline-link" onClick={onProgress}>View graph <span aria-hidden="true">↗</span></button></div>
          <GoalChart goal={goal} measurements={measurements} compact />
          <div className="chart-legend"><span><i className="legend-plan" /> Goal path</span><span><i className="legend-actual" /> Your weigh-ins</span></div>
        </article>
        <article className="panel intake-panel">
          <div className="panel-heading"><div><span className="eyebrow">DAILY TARGET</span><h2>Food</h2></div><span className="panel-symbol">◉</span></div>
          <div className="metric-main">{kcal?.toLocaleString("en-IN") ?? "—"}<small> kcal</small></div>
          <p className="muted-copy">{kcal ? "Calorie target · estimated" : "Manual target not set"}</p>
          {goal.macrosGrams ? <div className="macro-mini"><Macro label="Protein" value={goal.macrosGrams.protein} color="green" /><Macro label="Carbs" value={goal.macrosGrams.carbohydrate} color="gold" /><Macro label="Fat" value={goal.macrosGrams.fat} color="blue" /></div> : <p className="note-box">No macros estimated for this manual target.</p>}
        </article>
        <article className="panel movement-panel">
          <div className="panel-heading"><div><span className="eyebrow">YOUR WEEK</span><h2>Movement</h2></div><span className="panel-symbol">↗</span></div>
          <div className="metric-main">{movementDays}<small> days available</small></div>
          <p className="muted-copy">We’ll shape activity around the schedule you selected.</p>
          <div className="week-dots">{Array.from({ length: 7 }, (_, index) => <span key={index} className={index < movementDays ? "week-dot week-dot-active" : "week-dot"}>{["M", "T", "W", "T", "F", "S", "S"][index]}</span>)}</div>
        </article>
        <article className="panel checkin-panel">
          <div className="panel-heading"><div><span className="eyebrow">LATEST MEASUREMENT</span><h2>Weight</h2></div><span className="panel-symbol">↕</span></div>
          <div className="metric-main">{latest ? latest.data.weightKg.toFixed(1) : goal.startWeightKg.toFixed(1)}<small> kg</small></div>
          <p className="muted-copy">{latest ? `Updated ${formatDate(latest.data.measuredAt.slice(0, 10))}` : "Baseline measurement"}</p>
          <button className="inline-link" onClick={onProgress}>Add a weigh-in <span aria-hidden="true">＋</span></button>
        </article>
      </section>
      <div className="privacy-note"><span className="privacy-check">✓</span><span>Your information is stored in your account. Friends using the app cannot see your data.</span></div>
    </>
  );
}

function ProgressView({ goal, measurements, onMeasurementAdded }: { goal: StoredGoal; measurements: Measurement[]; onMeasurementAdded: () => Promise<void> }) {
  const [weight, setWeight] = useState("");
  const [measuredAt, setMeasuredAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const weightKg = Number(weight);
    if (!Number.isFinite(weightKg) || weightKg < 25 || weightKg > 400) {
      setMessage("Enter a weight between 25 and 400 kg.");
      return;
    }
    setBusy(true);
    try {
      await postJson("/v1/measurements", {
        measurementId: globalThis.crypto.randomUUID(),
        measuredAt: new Date(measuredAt).toISOString(),
        weightKg,
      });
      setWeight("");
      setMessage("Weigh-in saved.");
      await onMeasurementAdded();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the weigh-in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">ACTUAL VS PLAN</span><h1>Your progress</h1><p>The dashed line is your chosen target path. Dots are measurements you recorded.</p></div></div>
      <section className="panel large-chart-panel">
        <div className="panel-heading"><div><span className="eyebrow">WEIGHT · KG</span><h2>{goal.startWeightKg.toFixed(1)} <span className="heading-arrow">→</span> {goal.targetWeightKg.toFixed(1)}</h2></div><span className="date-chip">{formatDate(goal.startDate)} — {formatDate(goal.targetDate)}</span></div>
        <GoalChart goal={goal} measurements={measurements} />
        <div className="chart-legend"><span><i className="legend-plan" /> Target path</span><span><i className="legend-actual" /> Measured trend</span><span><i className="legend-point" /> Weigh-in</span></div>
        <p className="chart-caption">The target line is a schedule, not a prediction. Changes in actual weight are expected.</p>
      </section>
      <section className="progress-lower-grid">
        <form className="panel weigh-in-form" onSubmit={(event) => void submit(event)}>
          <div className="panel-heading"><div><span className="eyebrow">KEEP THE GRAPH CURRENT</span><h2>Add a weigh-in</h2></div></div>
          <div className="form-grid"><Field label="Weight (kg)" type="number" step="0.1" min="25" max="400" value={weight} onChange={setWeight} /><Field label="Date and time" type="datetime-local" value={measuredAt} onChange={setMeasuredAt} /></div>
          {message ? <p className="form-message" role="status">{message}</p> : null}
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save measurement"}</button>
        </form>
        <section className="panel history-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR RECORDS</span><h2>Recent weigh-ins</h2></div><span className="count-badge">{measurements.length}</span></div>
          {measurements.length ? <div className="measurement-list">{[...measurements].sort((a, b) => b.data.measuredAt.localeCompare(a.data.measuredAt)).slice(0, 8).map((item) => <div className="measurement-row" key={item.id}><span>{formatDate(item.data.measuredAt.slice(0, 10))}</span><strong>{item.data.weightKg.toFixed(1)} kg</strong></div>)}</div> : <p className="muted-copy">Your first measurement is saved as the baseline.</p>}
        </section>
      </section>
    </>
  );
}

function GoalChart({ goal, measurements, compact = false }: { goal: StoredGoal; measurements: Measurement[]; compact?: boolean }) {
  const width = 720;
  const height = compact ? 218 : 340;
  const left = 48;
  const right = 18;
  const top = 18;
  const bottom = height - 34;
  const validMeasurements = measurements.filter((item) => {
    const measuredDate = item.data.measuredAt.slice(0, 10);
    return measuredDate >= goal.startDate && measuredDate <= goal.targetDate;
  }).sort((a, b) => a.data.measuredAt.localeCompare(b.data.measuredAt));
  const allWeights = [...goal.trajectory.map((point) => point.targetWeightKg), ...validMeasurements.map((item) => item.data.weightKg)];
  const low = Math.min(...allWeights);
  const high = Math.max(...allWeights);
  const padding = Math.max((high - low) * 0.2, 0.4);
  const min = low - padding;
  const max = high + padding;
  const startMs = Date.parse(`${goal.startDate}T00:00:00Z`);
  const totalMs = Math.max(1, Date.parse(`${goal.targetDate}T00:00:00Z`) - startMs);
  const xAt = (date: string) => left + Math.max(0, Math.min(1, (Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - startMs) / totalMs)) * (width - left - right);
  const yAt = (value: number) => top + ((max - value) / (max - min)) * (bottom - top);
  const planPath = goal.trajectory.map((point, index) => `${index ? "L" : "M"} ${xAt(point.date)} ${yAt(point.targetWeightKg)}`).join(" ");
  const actualPath = validMeasurements.map((item, index) => `${index ? "L" : "M"} ${xAt(item.data.measuredAt)} ${yAt(item.data.weightKg)}`).join(" ");
  const ticks = Array.from({ length: 4 }, (_, index) => min + ((max - min) * index) / 3);
  const labelDates = [goal.startDate, goal.trajectory[Math.floor(goal.trajectory.length / 2)]?.date ?? goal.targetDate, goal.targetDate];
  return (
    <div className={compact ? "goal-chart goal-chart-compact" : "goal-chart"}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Goal progress graph from ${goal.startWeightKg} kilograms to ${goal.targetWeightKg} kilograms, with ${validMeasurements.length} recorded weigh-ins`} preserveAspectRatio="none">
        {ticks.map((tick) => <g key={tick}><line x1={left} y1={yAt(tick)} x2={width - right} y2={yAt(tick)} className="chart-gridline" /><text x={left - 8} y={yAt(tick) + 4} textAnchor="end" className="chart-axis-label">{tick.toFixed(1)}</text></g>)}
        <path d={planPath} className="chart-plan-path" />
        {actualPath ? <path d={actualPath} className="chart-actual-path" /> : null}
        {validMeasurements.map((item) => <circle key={item.id} cx={xAt(item.data.measuredAt)} cy={yAt(item.data.weightKg)} r={compact ? 4.5 : 6} className="chart-actual-dot"><title>{`${item.data.weightKg.toFixed(1)} kg on ${formatDate(item.data.measuredAt.slice(0, 10))}`}</title></circle>)}
        {labelDates.map((date, index) => <text key={`${date}-${index}`} x={xAt(date)} y={height - 7} textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"} className="chart-axis-label">{compact ? formatShortDate(date) : formatDate(date)}</text>)}
      </svg>
    </div>
  );
}

function Macro({ label, value, color }: { label: string; value: number; color: string }) {
  return <div className="macro-row"><span><i className={`macro-dot macro-${color}`} />{label}</span><strong>{value} g</strong></div>;
}

function ComingSoonView({ eyebrow, title, description, icon }: { eyebrow: string; title: string; description: string; icon: string }) {
  return <section className="feature-empty"><span className="eyebrow">{eyebrow}</span><div className="feature-icon">{icon}</div><h1>{title}</h1><p>{description}</p><span className="phase-chip">In the next implementation phase</span></section>;
}

function dayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatShortDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}
