"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { exerciseProgressResponseSchema, goalSchema, profileSchema, type ExerciseProgressResponse, type GoalRecord, type Profile } from "@healthcare/contracts";
import { exerciseCatalog } from "@healthcare/domain";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { ActivityTrackingView, FoodTrackingView, type DaySummary } from "@/components/tracking-views";
import { ApiError, postJson, requestJson } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type Tab = "home" | "food" | "activity" | "progress";
type StoredGoal = GoalRecord & { id: string };
type GoalRevision = { id: string; date: string; goalVersion: number; previousTargetKg: number | null; targetWeightKg: number; targetDate: string };
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
  const [goalVersions, setGoalVersions] = useState<StoredGoal[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);
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
      const parsedGoalVersions = goalData.versions.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object" || !("id" in candidate)) return [];
        const parsed = goalSchema.safeParse(candidate);
        return parsed.success ? [{ ...parsed.data, id: String(candidate.id) }] : [];
      }).sort((left, right) => left.goalVersion - right.goalVersion);
      setGoalVersions(parsedGoalVersions);
      setMeasurements(goalData.measurements.filter((item) => Number.isFinite(item.data?.weightKg) && typeof item.data?.measuredAt === "string"));
      if (parsedProfile.success) {
        const date = dateInTimezone(parsedProfile.data.timezone);
        const summary = await requestJson<DaySummary>(`/v1/days/${date}`);
        setDaySummary(summary);
      } else {
        setDaySummary(null);
      }
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
          {tab === "home" ? <HomeView profile={profile} goal={goal} measurements={measurements} day={daySummary} onProgress={() => setTab("progress")} /> : null}
          {tab === "food" && daySummary ? <FoodTrackingView day={daySummary} onSaved={reloadData} /> : null}
          {tab === "activity" && daySummary ? <ActivityTrackingView day={daySummary} unitSystem={profile.unitSystem} onSaved={reloadData} /> : null}
          {tab === "progress" ? <ProgressView goal={goal} goalVersions={goalVersions} measurements={measurements} timezone={profile.timezone} unitSystem={profile.unitSystem} onMeasurementAdded={reloadData} /> : null}
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

function HomeView({ profile, goal, measurements, day, onProgress }: { profile: Profile; goal: StoredGoal; measurements: Measurement[]; day: DaySummary | null; onProgress: () => void }) {
  const kcal = goal.dailyCaloriesKcal;
  const latest = [...measurements].sort((a, b) => b.data.measuredAt.localeCompare(a.data.measuredAt))[0];
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
          <GoalChart goal={goal} measurements={measurements} timezone={profile.timezone} compact />
          <div className="chart-legend"><span><i className="legend-plan" /> Goal path</span><span><i className="legend-trend" /> 3-weigh-in trend</span><span><i className="legend-actual" /> Your weigh-ins</span></div>
        </article>
        <article className="panel intake-panel">
          <div className="panel-heading"><div><span className="eyebrow">DAILY TARGET</span><h2>Food</h2></div><span className="panel-symbol">◉</span></div>
          <div className="metric-main">{day?.foodTotals.caloriesKcal.toLocaleString("en-IN") ?? "—"}<small> / {kcal?.toLocaleString("en-IN") ?? "—"} kcal</small></div>
          <p className="muted-copy">{day ? day.foodDayComplete ? day.foodLogs.length ? "Food log marked complete" : "Complete day · no food logged" : day.foodLogs.length ? "Food log may be partial · total may be incomplete" : "No food logged · total may be incomplete" : "Today’s food log is unavailable"}</p>
          {kcal ? <div className="intake-progress" role="progressbar" aria-label="Calories logged toward daily target" aria-valuenow={Math.min(100, Math.round((day?.foodTotals.caloriesKcal ?? 0) / kcal * 100))} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.round((day?.foodTotals.caloriesKcal ?? 0) / kcal * 100))}%` }} /></div> : null}
          {goal.macrosGrams ? <div className="macro-mini"><Macro label="Protein" value={goal.macrosGrams.protein} color="green" /><Macro label="Carbs" value={goal.macrosGrams.carbohydrate} color="gold" /><Macro label="Fat" value={goal.macrosGrams.fat} color="blue" /></div> : <p className="note-box">No macros estimated for this manual target.</p>}
        </article>
        <article className="panel movement-panel">
          <div className="panel-heading"><div><span className="eyebrow">TODAY’S MOVEMENT</span><h2>Activity</h2></div><span className="panel-symbol">↗</span></div>
          <div className="metric-main">{day?.steps.toLocaleString("en-IN") ?? "—"}<small> steps today</small></div>
          <p className="muted-copy">{day ? day.activityLogs.length ? `Manual logging · ${day.activityLogs.length} activity entries` : "No activity logged · manual entry" : "Today’s activity is unavailable"}</p>
        </article>
        <article className="panel checkin-panel">
          <div className="panel-heading"><div><span className="eyebrow">LATEST MEASUREMENT</span><h2>Weight</h2></div><span className="panel-symbol">↕</span></div>
          <div className="metric-main">{latest ? latest.data.weightKg.toFixed(1) : goal.startWeightKg.toFixed(1)}<small> kg</small></div>
          <p className="muted-copy">{latest ? `Updated ${formatDate(dateAtTimezone(latest.data.measuredAt, profile.timezone))}` : "Baseline measurement"}</p>
          <button className="inline-link" onClick={onProgress}>Add a weigh-in <span aria-hidden="true">＋</span></button>
        </article>
      </section>
      <div className="privacy-note"><span className="privacy-check">✓</span><span>Your information is stored in your account. Friends using the app cannot see your data.</span></div>
    </>
  );
}

function ProgressView({ goal, goalVersions, measurements, timezone, unitSystem, onMeasurementAdded }: { goal: StoredGoal; goalVersions: StoredGoal[]; measurements: Measurement[]; timezone: string; unitSystem: "metric" | "imperial"; onMeasurementAdded: () => Promise<void> }) {
  const [weight, setWeight] = useState("");
  const [measuredAt, setMeasuredAt] = useState(localDateTimeNow);
  const [range, setRange] = useState<"30d" | "90d" | "all">("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const today = dateInTimezone(timezone);
  const rangeEnd = range === "all" ? goal.targetDate : today < goal.startDate ? goal.startDate : today > goal.targetDate ? goal.targetDate : today;
  const rangeStart = range === "all" ? goal.startDate : maxDate(goal.startDate, addDays(rangeEnd, range === "30d" ? -29 : -89));
  const revisions = goalRevisionAnnotations(goalVersions, timezone, rangeStart, rangeEnd);
  const rangeMeasurements = measurements.filter((item) => {
    const date = dateAtTimezone(item.data.measuredAt, timezone);
    return date >= rangeStart && date <= rangeEnd;
  }).sort((a, b) => a.data.measuredAt.localeCompare(b.data.measuredAt));
  const latest = rangeMeasurements.at(-1);
  const graphSummary = latest
    ? `${progressSummary(goal, latest, timezone)}${smoothedTrend(rangeMeasurements, timezone).length ? "" : " Add weigh-ins on three different days to see the smoothed trend."}`
    : `No weigh-ins recorded from ${formatDate(rangeStart)} to ${formatDate(rangeEnd)}. The dashed line is your target schedule, not a prediction.`;

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
        <div className="progress-chart-toolbar">
          <div className="panel-heading"><div><span className="eyebrow">WEIGHT · KG</span><h2>{goal.startWeightKg.toFixed(1)} <span className="heading-arrow">→</span> {goal.targetWeightKg.toFixed(1)}</h2></div><span className="date-chip">{formatDate(rangeStart)} — {formatDate(rangeEnd)}</span></div>
          <div className="range-switch" role="group" aria-label="Graph date range">
            {[{ value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }, { value: "all", label: "Full goal" }].map((item) => <button key={item.value} type="button" className={range === item.value ? "range-button range-button-active" : "range-button"} aria-pressed={range === item.value} onClick={() => setRange(item.value as typeof range)}>{item.label}</button>)}
          </div>
        </div>
        <GoalChart goal={goal} goalRevisions={revisions} measurements={measurements} timezone={timezone} rangeStart={rangeStart} rangeEnd={rangeEnd} />
        <div className="chart-legend"><span><i className="legend-plan" /> Target path</span><span><i className="legend-trend" /> 3-weigh-in trend</span><span><i className="legend-actual" /> Recorded weigh-ins</span><span><i className="legend-point" /> Measurement</span><span><i className="legend-revision" /> Plan update</span></div>
        {revisions.length ? <div className="chart-revisions" role="list" aria-label="Goal plan updates">{revisions.map((revision) => <p key={revision.id} role="listitem"><strong>Plan v{revision.goalVersion}</strong> updated {formatDate(revision.date)} · target {revision.previousTargetKg === null ? "set to " : `${revision.previousTargetKg.toFixed(1)} → `}{revision.targetWeightKg.toFixed(1)} kg by {formatDate(revision.targetDate)}</p>)}</div> : null}
        <p className="chart-summary" aria-live="polite">{graphSummary}</p>
        <p className="chart-caption">The target line is a schedule, not a prediction. Day-to-day body weight can vary.</p>
      </section>
      <ExerciseProgressPanel unitSystem={unitSystem} />
      <section className="progress-lower-grid">
        <form className="panel weigh-in-form" onSubmit={(event) => void submit(event)}>
          <div className="panel-heading"><div><span className="eyebrow">KEEP THE GRAPH CURRENT</span><h2>Add a weigh-in</h2></div></div>
          <div className="form-grid"><Field label="Weight (kg)" type="number" step="0.1" min="25" max="400" value={weight} onChange={setWeight} /><Field label="Date and time" type="datetime-local" value={measuredAt} onChange={setMeasuredAt} /></div>
          {message ? <p className="form-message" role="status">{message}</p> : null}
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save measurement"}</button>
        </form>
        <section className="panel history-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR RECORDS</span><h2>Recent weigh-ins</h2></div><span className="count-badge">{measurements.length}</span></div>
          {measurements.length ? <div className="measurement-list">{[...measurements].sort((a, b) => b.data.measuredAt.localeCompare(a.data.measuredAt)).slice(0, 8).map((item) => <div className="measurement-row" key={item.id}><span>{formatDate(dateAtTimezone(item.data.measuredAt, timezone))}</span><strong>{item.data.weightKg.toFixed(1)} kg</strong></div>)}</div> : <p className="muted-copy">Your first measurement is saved as the baseline.</p>}
        </section>
      </section>
    </>
  );
}

type ExerciseRange = "30d" | "90d" | "365d";
type ExerciseMetric = "reps" | "load" | "hold";
type LoadedExerciseProgress = { key: string; data?: ExerciseProgressResponse; error?: string };
const poundsPerKilogram = 2.20462262185;

function ExerciseProgressPanel({ unitSystem }: { unitSystem: "metric" | "imperial" }) {
  const firstExercise = exerciseCatalog[0];
  const [exerciseId, setExerciseId] = useState(firstExercise?.id ?? "");
  const [range, setRange] = useState<ExerciseRange>("90d");
  const [metric, setMetric] = useState<ExerciseMetric>(firstExercise?.trackingMode === "time" ? "hold" : "reps");
  const [loaded, setLoaded] = useState<LoadedExerciseProgress | null>(null);
  const requestKey = `${exerciseId}:${range}`;
  const selectedExercise = exerciseCatalog.find((exercise) => exercise.id === exerciseId);

  useEffect(() => {
    if (!exerciseId) return;
    let active = true;
    void requestJson<unknown>(`/v1/exercises/${exerciseId}/progress?range=${range}`, { cache: "no-store" }).then((body) => {
      const parsed = exerciseProgressResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The exercise progress response was invalid.");
      if (active) setLoaded({ key: requestKey, data: parsed.data });
    }).catch((caught: unknown) => {
      if (active) setLoaded({ key: requestKey, error: caught instanceof Error ? caught.message : "Could not load exercise progress." });
    });
    return () => { active = false; };
  }, [exerciseId, range, requestKey]);

  const response = loaded?.key === requestKey ? loaded.data : undefined;
  const loading = Boolean(exerciseId) && loaded?.key !== requestKey;
  const error = loaded?.key === requestKey ? loaded.error : undefined;
  const hasRepHistory = response?.points.some((point) => point.bestSetReps !== null) ?? false;
  const metricOptions: Array<{ value: ExerciseMetric; label: string }> = selectedExercise?.trackingMode === "time"
    ? [{ value: "hold", label: "Longest hold" }, ...(hasRepHistory ? [{ value: "reps" as const, label: "Best set reps" }] : [])]
    : [{ value: "reps", label: "Best set reps" }, { value: "load", label: "Best logged load" }];
  const activeMetric = metricOptions.some((option) => option.value === metric) ? metric : metricOptions[0]?.value ?? "reps";
  const metricData = response?.points.flatMap((point) => {
    const value = exerciseProgressValue(point, activeMetric, unitSystem);
    return value === null ? [] : [{ point, value }];
  }) ?? [];
  const latest = metricData.at(-1);
  const metricLabel = metricOptions.find((option) => option.value === activeMetric)?.label ?? "Performance";

  return <section className="panel exercise-progress-panel">
    <div className="panel-heading"><div><span className="eyebrow">EXERCISE PERFORMANCE</span><h2>Progress by exercise</h2></div><span className="panel-symbol">↗</span></div>
    <p className="muted-copy">Review your logged sets over time. This graph has its own scale and stays separate from body weight.</p>
    <div className="form-grid exercise-progress-controls">
      <label className="field"><span>Exercise</span><select value={exerciseId} onChange={(event) => {
        const nextExercise = exerciseCatalog.find((candidate) => candidate.id === event.target.value);
        setExerciseId(event.target.value);
        setMetric(nextExercise?.trackingMode === "time" ? "hold" : "reps");
      }}>
        {exerciseCatalog.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
      </select></label>
      <div className="field"><span>Date range</span><div className="range-switch" role="group" aria-label="Exercise progress date range">
        {[{ value: "30d", label: "30d" }, { value: "90d", label: "90d" }, { value: "365d", label: "1y" }].map((option) => <button key={option.value} type="button" className={range === option.value ? "range-button range-button-active" : "range-button"} aria-pressed={range === option.value} onClick={() => setRange(option.value as ExerciseRange)}>{option.label}</button>)}
      </div></div>
    </div>
    {response && !error ? <>
      <div className="range-switch exercise-metric-switch" role="group" aria-label="Exercise metric">
        {metricOptions.map((option) => <button key={option.value} type="button" className={activeMetric === option.value ? "range-button range-button-active" : "range-button"} aria-pressed={activeMetric === option.value} onClick={() => setMetric(option.value)}>{option.label}</button>)}
      </div>
      {metricData.length ? <>
        <ExerciseProgressChart response={response} metric={activeMetric} unitSystem={unitSystem} />
        <p className="chart-summary" aria-live="polite">{latest ? `${metricLabel}: ${formatExerciseMetric(latest.value, activeMetric, unitSystem)} on ${formatDate(latest.point.date)}. ${latest.point.sessions} session${latest.point.sessions === 1 ? "" : "s"} across ${latest.point.setCount} set${latest.point.setCount === 1 ? "" : "s"} recorded that day.` : "No values for this metric are recorded in this range."}</p>
      </> : <div className="empty-inline"><strong>No {metricLabel.toLowerCase()} recorded in this range</strong><span>Log this catalog exercise with that value to create a graph.</span></div>}
      <p className="chart-caption">Each point shows the best recorded value for that exercise on a day. It summarizes logged sessions; it does not estimate calories burned.</p>
    </> : loading ? <p className="muted-copy" role="status">Loading exercise progress…</p>
      : error ? <p className="form-error" role="alert">{error}</p>
        : <div className="empty-inline"><strong>Select an exercise</strong><span>Log catalog-linked sets to build its progress line.</span></div>}
  </section>;
}

function exerciseProgressValue(
  point: ExerciseProgressResponse["points"][number],
  metric: ExerciseMetric,
  unitSystem: "metric" | "imperial",
): number | null {
  if (metric === "reps") return point.bestSetReps;
  if (metric === "hold") return point.longestHoldSeconds;
  if (point.bestLoadKg === null) return null;
  return unitSystem === "imperial" ? point.bestLoadKg * poundsPerKilogram : point.bestLoadKg;
}

function formatExerciseMetric(value: number, metric: ExerciseMetric, unitSystem: "metric" | "imperial"): string {
  if (metric === "reps") return `${Math.round(value)} reps`;
  if (metric === "hold") return formatDuration(value);
  return `${value.toFixed(1)} ${unitSystem === "imperial" ? "lb" : "kg"}`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function ExerciseProgressChart({ response, metric, unitSystem }: { response: ExerciseProgressResponse; metric: ExerciseMetric; unitSystem: "metric" | "imperial" }) {
  const values = response.points.flatMap((point) => {
    const value = exerciseProgressValue(point, metric, unitSystem);
    return value === null ? [] : [{ point, value }];
  });
  if (!values.length) return null;
  const width = 720;
  const height = 260;
  const left = 58;
  const right = 20;
  const top = 24;
  const bottom = height - 38;
  const rawLow = Math.min(...values.map((item) => item.value));
  const rawHigh = Math.max(...values.map((item) => item.value));
  const padding = Math.max((rawHigh - rawLow) * 0.2, metric === "load" ? 0.5 : metric === "hold" ? 5 : 1);
  const min = Math.max(0, rawLow - padding);
  const max = Math.max(min + padding * 2, rawHigh + padding);
  const startMs = Date.parse(`${response.rangeStart}T00:00:00Z`);
  const totalMs = Math.max(1, Date.parse(`${response.rangeEnd}T00:00:00Z`) - startMs);
  const xAt = (date: string) => left + Math.max(0, Math.min(1, (Date.parse(`${date}T00:00:00Z`) - startMs) / totalMs)) * (width - left - right);
  const yAt = (value: number) => top + ((max - value) / (max - min)) * (bottom - top);
  const line = values.map((item, index) => `${index ? "L" : "M"} ${xAt(item.point.date)} ${yAt(item.value)}`).join(" ");
  const ticks = Array.from({ length: 4 }, (_, index) => min + ((max - min) * index) / 3);
  const middle = addDays(response.rangeStart, Math.floor((Date.parse(`${response.rangeEnd}T00:00:00Z`) - startMs) / 2 / 86_400_000));
  const labels = [response.rangeStart, middle, response.rangeEnd];
  const unitLabel = metric === "load" ? unitSystem === "imperial" ? "lb" : "kg" : metric === "reps" ? "reps" : "seconds";

  return <div className="exercise-progress-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${response.exercise.name} ${metric === "load" ? "best logged load" : metric === "reps" ? "best set reps" : "longest hold"} over the selected date range, based on ${values.length} days with records.`} preserveAspectRatio="none">
    <text x={left} y="13" className="chart-axis-label">{unitLabel}</text>
    {ticks.map((tick) => <g key={tick}><line x1={left} y1={yAt(tick)} x2={width - right} y2={yAt(tick)} className="chart-gridline" /><text x={left - 8} y={yAt(tick) + 4} textAnchor="end" className="chart-axis-label">{metric === "load" ? tick.toFixed(1) : Math.round(tick)}</text></g>)}
    <path d={line} className="exercise-progress-line" />
    {values.map(({ point, value }) => <circle key={point.date} cx={xAt(point.date)} cy={yAt(value)} r="5" className="exercise-progress-dot"><title>{`${formatDate(point.date)} · ${formatExerciseMetric(value, metric, unitSystem)} · ${point.sessions} sessions · ${point.setCount} sets`}</title></circle>)}
    {labels.map((date, index) => <text key={`${date}-${index}`} x={xAt(date)} y={height - 8} textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"} className="chart-axis-label">{formatShortDate(date)}</text>)}
  </svg></div>;
}

function GoalChart({ goal, goalRevisions = [], measurements, timezone, compact = false, rangeStart = goal.startDate, rangeEnd = goal.targetDate }: { goal: StoredGoal; goalRevisions?: GoalRevision[]; measurements: Measurement[]; timezone: string; compact?: boolean; rangeStart?: string; rangeEnd?: string }) {
  const width = 720;
  const height = compact ? 218 : 340;
  const left = 48;
  const right = 18;
  const top = 18;
  const bottom = height - 34;
  const validMeasurements = measurements.filter((item) => {
    const measuredDate = dateAtTimezone(item.data.measuredAt, timezone);
    return measuredDate >= rangeStart && measuredDate <= rangeEnd;
  }).sort((a, b) => a.data.measuredAt.localeCompare(b.data.measuredAt));
  const trendPoints = smoothedTrend(validMeasurements, timezone);
  const interiorPlanPoints = goal.trajectory.filter((point) => point.date > rangeStart && point.date < rangeEnd);
  const planPoints = [
    { date: rangeStart, targetWeightKg: targetWeightAt(goal, rangeStart) },
    ...interiorPlanPoints,
    ...(rangeEnd > rangeStart ? [{ date: rangeEnd, targetWeightKg: targetWeightAt(goal, rangeEnd) }] : []),
  ];
  const allWeights = [...planPoints.map((point) => point.targetWeightKg), ...validMeasurements.map((item) => item.data.weightKg)];
  const low = Math.min(...allWeights);
  const high = Math.max(...allWeights);
  const padding = Math.max((high - low) * 0.2, 0.4);
  const min = low - padding;
  const max = high + padding;
  const startMs = Date.parse(`${rangeStart}T00:00:00Z`);
  const totalMs = Math.max(1, Date.parse(`${rangeEnd}T00:00:00Z`) - startMs);
  const xAt = (date: string) => left + Math.max(0, Math.min(1, (Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - startMs) / totalMs)) * (width - left - right);
  const yAt = (value: number) => top + ((max - value) / (max - min)) * (bottom - top);
  const planPath = planPoints.map((point, index) => `${index ? "L" : "M"} ${xAt(point.date)} ${yAt(point.targetWeightKg)}`).join(" ");
  const trendPath = trendPoints.map((point, index) => `${index ? "L" : "M"} ${xAt(point.date)} ${yAt(point.weightKg)}`).join(" ");
  const actualPath = validMeasurements.map((item, index) => `${index ? "L" : "M"} ${xAt(dateAtTimezone(item.data.measuredAt, timezone))} ${yAt(item.data.weightKg)}`).join(" ");
  const ticks = Array.from({ length: 4 }, (_, index) => min + ((max - min) * index) / 3);
  const midDate = addDays(rangeStart, Math.round((Date.parse(`${rangeEnd}T00:00:00Z`) - startMs) / 2 / 86_400_000));
  const labelDates = [rangeStart, midDate, rangeEnd];
  const showTargetMarker = goal.targetDate >= rangeStart && goal.targetDate <= rangeEnd;
  return (
    <div className={compact ? "goal-chart goal-chart-compact" : "goal-chart"}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Weight graph from ${formatDate(rangeStart)} to ${formatDate(rangeEnd)}. The target path runs from ${goal.startWeightKg} to ${goal.targetWeightKg} kilograms. ${validMeasurements.length} weigh-ins and ${goalRevisions.length} plan updates are recorded in this range. The smoothed trend is a rolling average of up to the last three weigh-in days.`} preserveAspectRatio="none">
        {ticks.map((tick) => <g key={tick}><line x1={left} y1={yAt(tick)} x2={width - right} y2={yAt(tick)} className="chart-gridline" /><text x={left - 8} y={yAt(tick) + 4} textAnchor="end" className="chart-axis-label">{tick.toFixed(1)}</text></g>)}
        {goalRevisions.map((revision) => <line key={revision.id} x1={xAt(revision.date)} y1={top} x2={xAt(revision.date)} y2={bottom} className="chart-revision-marker"><title>{`Goal plan updated to version ${revision.goalVersion} on ${formatDate(revision.date)}`}</title></line>)}
        {showTargetMarker ? <line x1={xAt(goal.targetDate)} y1={top} x2={xAt(goal.targetDate)} y2={bottom} className="chart-goal-marker" /> : null}
        <path d={planPath} className="chart-plan-path" />
        {trendPath ? <path d={trendPath} className="chart-trend-path" /> : null}
        {actualPath ? <path d={actualPath} className="chart-actual-path" /> : null}
        {validMeasurements.map((item) => <circle key={item.id} cx={xAt(dateAtTimezone(item.data.measuredAt, timezone))} cy={yAt(item.data.weightKg)} r={compact ? 4.5 : 6} className="chart-actual-dot"><title>{`${item.data.weightKg.toFixed(1)} kg on ${formatDate(dateAtTimezone(item.data.measuredAt, timezone))}`}</title></circle>)}
        {trendPoints.map((point) => <circle key={`trend-${point.date}`} cx={xAt(point.date)} cy={yAt(point.weightKg)} r="3" className="chart-trend-dot"><title>{`Average across up to three weigh-in days: ${point.weightKg.toFixed(1)} kg on ${formatDate(point.date)}`}</title></circle>)}
        {showTargetMarker ? <circle cx={xAt(goal.targetDate)} cy={yAt(goal.targetWeightKg)} r="5" className="chart-target-dot"><title>{`Target weight ${goal.targetWeightKg.toFixed(1)} kg by ${formatDate(goal.targetDate)}`}</title></circle> : null}
        {labelDates.map((date, index) => <text key={`${date}-${index}`} x={xAt(date)} y={height - 7} textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"} className="chart-axis-label">{compact ? formatShortDate(date) : formatDate(date)}</text>)}
      </svg>
    </div>
  );
}

function smoothedTrend(measurements: Measurement[], timezone: string): Array<{ date: string; weightKg: number }> {
  const daily = new Map<string, { total: number; count: number }>();
  for (const item of measurements) {
    const date = dateAtTimezone(item.data.measuredAt, timezone);
    const aggregate = daily.get(date) ?? { total: 0, count: 0 };
    aggregate.total += item.data.weightKg;
    aggregate.count += 1;
    daily.set(date, aggregate);
  }

  const days = [...daily.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (days.length < 3) return [];
  return days.map(([date], index) => {
    const window = days.slice(Math.max(0, index - 2), index + 1);
    const mean = window.reduce((total, [, values]) => total + values.total / values.count, 0) / window.length;
    return { date, weightKg: mean };
  });
}

function goalRevisionAnnotations(versions: StoredGoal[], timezone: string, rangeStart: string, rangeEnd: string): GoalRevision[] {
  const byVersion = new Map(versions.map((version) => [version.goalVersion, version]));
  return versions
    .filter((version) => version.goalVersion > 1)
    .map((version) => ({
      id: version.id,
      date: dateAtTimezone(version.acceptedAt, timezone),
      goalVersion: version.goalVersion,
      previousTargetKg: byVersion.get(version.goalVersion - 1)?.targetWeightKg ?? null,
      targetWeightKg: version.targetWeightKg,
      targetDate: version.targetDate,
    }))
    .filter((revision) => revision.date >= rangeStart && revision.date <= rangeEnd)
    .sort((left, right) => left.date.localeCompare(right.date) || left.goalVersion - right.goalVersion);
}

function targetWeightAt(goal: StoredGoal, date: string): number {
  const points = goal.trajectory;
  const before = [...points].reverse().find((point) => point.date <= date);
  const after = points.find((point) => point.date >= date);
  if (!before) return points[0]?.targetWeightKg ?? goal.startWeightKg;
  if (!after || after.date === before.date) return before.targetWeightKg;
  const elapsed = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${before.date}T00:00:00Z`);
  const span = Date.parse(`${after.date}T00:00:00Z`) - Date.parse(`${before.date}T00:00:00Z`);
  const fraction = span > 0 ? elapsed / span : 0;
  return before.targetWeightKg + (after.targetWeightKg - before.targetWeightKg) * fraction;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function maxDate(left: string, right: string): string {
  return left > right ? left : right;
}

function progressSummary(goal: StoredGoal, latest: Measurement, timezone: string): string {
  const date = dateAtTimezone(latest.data.measuredAt, timezone);
  if (date < goal.startDate || date > goal.targetDate) {
    return `Latest weigh-in: ${latest.data.weightKg.toFixed(1)} kg on ${formatDate(date)}. This measurement is outside the current goal timeline.`;
  }
  const target = targetWeightAt(goal, date);
  const difference = latest.data.weightKg - target;
  const relation = Math.abs(difference) < 0.05
    ? "on the target path"
    : `${Math.abs(difference).toFixed(1)} kg ${difference < 0 ? "below" : "above"} the target path`;
  return `Latest weigh-in: ${latest.data.weightKg.toFixed(1)} kg on ${formatDate(date)}; target path that day: ${target.toFixed(1)} kg (${relation}).`;
}

function Macro({ label, value, color }: { label: string; value: number; color: string }) {
  return <div className="macro-row"><span><i className={`macro-dot macro-${color}`} />{label}</span><strong>{value} g</strong></div>;
}

function dayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatShortDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(date);
}

function dateInTimezone(timezone: string): string {
  return dateAtTimezone(new Date().toISOString(), timezone);
}

function dateAtTimezone(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const partValue = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${partValue("year")}-${partValue("month")}-${partValue("day")}`;
}

function localDateTimeNow(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
