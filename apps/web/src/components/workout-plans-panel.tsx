"use client";

import { useEffect, useMemo, useState } from "react";
import {
  workoutPlanDataSchema,
  workoutPlansResponseSchema,
  type WorkoutPlanData,
  type WorkoutPlanSession,
  type WorkoutPlanVersion,
} from "@healthcare/contracts";
import { exerciseCatalog, findExerciseById, isExerciseAvailable, workoutTemplates } from "@healthcare/domain";
import { ApiError, postJson, requestJson } from "@/lib/api";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const poundsPerKilogram = 2.20462262185;

function workoutSuggestionError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      workout_planning_not_configured: "Workout planning is unavailable.",
      ai_daily_limit_reached: "You have reached the shared AI limit for the last 24 hours. Manual logging and workout templates still work; try again later.",
      profile_or_accepted_goal_required: "Finish your profile and accept a goal before requesting a workout plan.",
      workout_planning_not_available_for_this_profile: "AI workout suggestions are unavailable for this profile. Use a reviewed template instead.",
      workout_movement_review_required: "AI suggestions are paused because you listed a movement limitation. Use a reviewed template for now.",
      workout_days_required: "Add at least one workout day to your profile first.",
      workout_exercise_coverage_insufficient: "Add the equipment you have to your profile, or start from a reviewed template.",
      workout_plan_provider_unavailable: "The model could not be reached. Your existing plan is unchanged; try again later.",
      workout_plan_generation_failed: "A safe draft could not be generated. Your existing plan is unchanged; try a template or retry.",
      workout_plan_invalid: "The model could not produce a safe routine within your constraints. Try again or start from a template.",
    };
    return messages[error.code] ?? error.message;
  }
  return error instanceof Error ? error.message : "Could not generate a workout suggestion.";
}

type Props = {
  unitSystem: "metric" | "imperial";
  equipment: string[];
  gymWorkoutDays: number;
  homeWorkoutDays: number;
  onStartSession: (plan: WorkoutPlanVersion, session: WorkoutPlanSession) => void;
};

function templateData(templateId: string, location: "gym" | "home"): WorkoutPlanData | null {
  const template = workoutTemplates.find((item) => item.id === templateId);
  if (!template) return null;
  const preferredDays = template.sessions.length === 2 ? [1, 4] : template.sessions.length === 3 ? [1, 3, 5] : [1, 3, 5, 0, 2, 4, 6];
  return {
    name: template.name,
    focus: template.summary,
    sessions: template.sessions.map((session, index) => ({
      weekday: preferredDays[index] ?? index,
      location,
      label: session.label,
      estimatedMinutes: session.estimatedMinutes,
      exercises: session.exercises.flatMap((target) => {
        const exercise = findExerciseById(target.exerciseId);
        if (!exercise) return [];
        const range = target.repRange ?? target.durationSecondsRange ?? [8, 12];
        return [{
          exerciseId: exercise.id,
          sets: target.sets,
          trackingMode: exercise.trackingMode,
          targetMin: range[0],
          targetMax: range[1],
          restSeconds: target.restSeconds,
          targetLoadKg: null,
        }];
      }),
    })),
  };
}

function toTemplateExercise(exerciseId: string) {
  const exercise = findExerciseById(exerciseId) ?? exerciseCatalog[0];
  return {
    exerciseId: exercise.id,
    sets: 3,
    trackingMode: exercise.trackingMode,
    targetMin: exercise.trackingMode === "time" ? 20 : 8,
    targetMax: exercise.trackingMode === "time" ? 40 : 12,
    restSeconds: exercise.typicalRestSeconds,
    targetLoadKg: null,
  } as WorkoutPlanData["sessions"][number]["exercises"][number];
}

export function WorkoutPlansPanel({ unitSystem, equipment, gymWorkoutDays, homeWorkoutDays, onStartSession }: Props) {
  const [plans, setPlans] = useState<WorkoutPlanVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [templateId, setTemplateId] = useState(workoutTemplates[0]?.id ?? "");
  const [editingPlan, setEditingPlan] = useState<WorkoutPlanVersion | null>(null);
  const [data, setData] = useState<WorkoutPlanData | null>(null);
  const [dirty, setDirty] = useState(false);
  const availableExercises = useMemo(() => exerciseCatalog.filter((exercise) => isExerciseAvailable(exercise, equipment)), [equipment]);
  const hasDraft = plans.some((plan) => plan.status === "draft");

  async function loadPlans() {
    const response = await requestJson<unknown>("/v1/workout-plans", { cache: "no-store" });
    const parsed = workoutPlansResponseSchema.safeParse(response);
    if (!parsed.success) throw new Error("The saved workout plans could not be read.");
    setPlans(parsed.data.plans);
  }

  useEffect(() => {
    let active = true;
    requestJson<unknown>("/v1/workout-plans", { cache: "no-store" }).then((response) => {
      const parsed = workoutPlansResponseSchema.safeParse(response);
      if (!parsed.success) throw new Error("The saved workout plans could not be read.");
      if (active) setPlans(parsed.data.plans);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Could not load workout plans.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, WorkoutPlanVersion[]>();
    for (const plan of plans) {
      const versions = grouped.get(plan.groupId) ?? [];
      versions.push(plan);
      grouped.set(plan.groupId, versions);
    }
    return [...grouped.entries()].map(([groupId, versions]) => ({
      groupId,
      versions: versions.sort((a, b) => b.version - a.version),
      active: versions.find((plan) => plan.status === "active"),
      draft: versions.find((plan) => plan.status === "draft"),
    })).sort((a, b) => {
      const first = a.draft ?? a.active ?? a.versions[0];
      const second = b.draft ?? b.active ?? b.versions[0];
      return (second?.updatedAt ?? "").localeCompare(first?.updatedAt ?? "");
    });
  }, [plans]);

  function updateData(update: (current: WorkoutPlanData) => WorkoutPlanData) {
    setData((current) => current ? update(current) : current);
    setDirty(true);
  }

  function updateSession(sessionIndex: number, update: (session: WorkoutPlanData["sessions"][number]) => WorkoutPlanData["sessions"][number]) {
    updateData((current) => ({ ...current, sessions: current.sessions.map((session, index) => index === sessionIndex ? update(session) : session) }));
  }

  async function refreshPlans() {
    await loadPlans();
  }

  async function createDraft() {
    const draftData = templateData(templateId, homeWorkoutDays > 0 ? "home" : "gym");
    if (!draftData) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await postJson<{ plan: WorkoutPlanVersion }>("/v1/workout-plans", {
        planId: globalThis.crypto.randomUUID(),
        groupId: globalThis.crypto.randomUUID(),
        source: "template",
        data: draftData,
      });
      setPlans((current) => [response.plan, ...current]);
      setEditingPlan(response.plan);
      setData(response.plan.data);
      setDirty(false);
      setNotice("Template added as a draft. Review the days and targets before activating it.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the draft plan.");
    } finally {
      setBusy(false);
    }
  }

  async function createSuggestedDraft() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await postJson<{ status: string; plan: WorkoutPlanVersion | null }>("/v1/plans/workout/runs", {
        idempotencyKey: globalThis.crypto.randomUUID(),
      });
      if (response.status !== "pending_review" || !response.plan) {
        throw new Error("The workout suggestion did not return a reviewable draft. Try again or start from a template.");
      }
      setPlans((current) => [response.plan!, ...current]);
      setEditingPlan(response.plan);
      setData(response.plan.data);
      setDirty(false);
      setNotice("Suggested routine created as a draft. Review its days and exercises before activating it.");
    } catch (caught) {
      setError(workoutSuggestionError(caught));
    } finally {
      setBusy(false);
    }
  }

  function editDraft(plan: WorkoutPlanVersion) {
    setEditingPlan(plan);
    setData(plan.data);
    setDirty(false);
    setError("");
    setNotice("");
  }

  async function revisePlan(plan: WorkoutPlanVersion) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await postJson<{ plan: WorkoutPlanVersion }>(`/v1/workout-plans/${plan.id}/revise`, {});
      setPlans((current) => [response.plan, ...current]);
      editDraft(response.plan);
      setNotice(`Version ${response.plan.version} is a draft. Save edits, then activate it when ready.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start a plan revision.");
      await refreshPlans().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!editingPlan || !data) return;
    const parsed = workoutPlanDataSchema.safeParse(data);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the plan fields and try again.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await requestJson<{ plan: WorkoutPlanVersion }>(`/v1/workout-plans/${editingPlan.id}`, {
        method: "PATCH",
        body: JSON.stringify({ baseEditVersion: editingPlan.editVersion, data: parsed.data }),
      });
      setPlans((current) => current.map((plan) => plan.id === response.plan.id ? response.plan : plan));
      setEditingPlan(response.plan);
      setData(response.plan.data);
      setDirty(false);
      setNotice("Draft saved. Activate it when you are ready to use this weekly plan.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the draft plan.");
      await refreshPlans().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function approvePlan(plan: WorkoutPlanVersion) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await postJson<{ plan: WorkoutPlanVersion }>(`/v1/workout-plans/${plan.id}/approve`, { baseEditVersion: plan.editVersion });
      setPlans((current) => current.map((item) => item.groupId === response.plan.groupId && item.status === "active"
        ? { ...item, status: "superseded" as const }
        : item.id === response.plan.id ? response.plan : item));
      setEditingPlan(null);
      setData(null);
      setDirty(false);
      setNotice(`Version ${response.plan.version} is active. Starting a planned session opens a blank activity log.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not activate the plan.");
      await refreshPlans().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function rejectPlan(plan: WorkoutPlanVersion) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await postJson(`/v1/workout-plans/${plan.id}/reject`, { baseEditVersion: plan.editVersion });
      setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, status: "archived" as const } : item));
      if (editingPlan?.id === plan.id) {
        setEditingPlan(null);
        setData(null);
        setDirty(false);
      }
      setNotice("Suggested workout draft rejected. It was not added to your activity log.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reject the draft.");
      await refreshPlans().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const parsedData = data ? workoutPlanDataSchema.safeParse(data) : null;
  const locationDaysExceeded = editingPlan?.source === "ai" && data !== null && (
    data.sessions.filter((session) => session.location === "gym").length > gymWorkoutDays
    || data.sessions.filter((session) => session.location === "home").length > homeWorkoutDays
  );
  const unavailableHomeEquipment = editingPlan?.source === "ai" && data !== null && data.sessions.some((session) =>
    session.location === "home" && session.exercises.some((target) => {
      const exercise = findExerciseById(target.exerciseId);
      return !exercise || !isExerciseAvailable(exercise, equipment);
    })
  );

  return <section className="panel workout-plans-panel">
    <div className="panel-heading"><div><span className="eyebrow">WEEKLY ROUTINE</span><h2>Workout plans</h2></div><span className="panel-symbol">▦</span></div>
    <div className="workout-plan-create-row">
      <label className="field"><span>Start from a template</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
        {workoutTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select></label>
      <div className="workout-plan-actions">
        <button type="button" className="button button-secondary" onClick={() => void createDraft()} disabled={busy || !templateId || hasDraft}>Create template draft</button>
        <button type="button" className="button button-primary" onClick={() => void createSuggestedDraft()} disabled={busy || hasDraft || !availableExercises.length}>{busy ? "Generating…" : "Suggest with AI"}</button>
      </div>
    </div>

    {loading ? <p className="muted-copy" role="status">Loading workout plans…</p> : groups.length ? <div className="workout-plan-list">{groups.map(({ groupId, versions, active, draft }) => {
      const current = draft ?? active ?? versions[0];
      if (!current) return null;
      return <article className="workout-plan-card" key={groupId}>
        <div className="workout-plan-title-row"><div><span className={`plan-status plan-status-${current.status}`}>{current.status}</span><h3>{current.data.name}</h3><p>Version {current.version} · {current.data.sessions.length} days each week · {current.data.focus}</p></div></div>
        {active ? <div className="workout-plan-session-list">{active.data.sessions.slice().sort((a, b) => a.weekday - b.weekday).map((session, index) => <div className="workout-plan-session" key={`${active.id}-${index}`}>
          <div><strong>{weekdays[session.weekday]} · {session.label}</strong><small>{session.location === "gym" ? "Gym" : "Home"} · {session.estimatedMinutes} min · {session.exercises.length} exercises</small></div>
          <button type="button" className="text-button" onClick={() => onStartSession(active, session)}>Log session</button>
        </div>)}</div> : null}
        {draft ? <div className="workout-plan-actions">
          <button type="button" className="button button-secondary" onClick={() => editDraft(draft)} disabled={busy}>Edit draft</button>
          {draft.source === "ai" ? <button type="button" className="button button-secondary" onClick={() => void rejectPlan(draft)} disabled={busy}>Reject suggestion</button> : null}
          <button type="button" className="button button-primary" onClick={() => void approvePlan(draft)} disabled={busy || (editingPlan?.id === draft.id && dirty)}>Activate plan</button>
        </div> : active ? <div className="workout-plan-actions"><button type="button" className="button button-secondary" onClick={() => void revisePlan(active)} disabled={busy}>Create revision</button></div> : null}
        {versions.length > 1 ? <details className="plan-history"><summary>Version history ({versions.length})</summary><ul>{versions.map((version) => <li key={version.id}>Version {version.version} · {version.status} · updated {new Date(version.updatedAt).toLocaleDateString()}</li>)}</ul></details> : null}
      </article>;
    })}</div> : <p className="muted-copy">No workout plan yet.</p>}

    {editingPlan && data ? <div className="workout-plan-editor">
      <div className="panel-heading"><div><span className="eyebrow">DRAFT · VERSION {editingPlan.version}</span><h3>Edit weekly plan</h3></div><button type="button" className="quiet-button" onClick={() => { setEditingPlan(null); setData(null); setDirty(false); }}>Close</button></div>
      <label className="field"><span>Plan name</span><input maxLength={80} value={data.name} onChange={(event) => updateData((current) => ({ ...current, name: event.target.value }))} /></label>
      <label className="field"><span>Focus</span><input maxLength={180} value={data.focus} onChange={(event) => updateData((current) => ({ ...current, focus: event.target.value }))} /></label>
      <div className="workout-plan-editor-sessions">{data.sessions.map((session, sessionIndex) => {
        const locationExercises = session.location === "gym" ? [...exerciseCatalog] : availableExercises;
        return <article className="workout-plan-edit-session" key={sessionIndex}>
        <div className="workout-exercise-heading"><strong>Session {sessionIndex + 1}</strong>{data.sessions.length > 1 ? <button type="button" className="quiet-button entry-delete" onClick={() => updateData((current) => ({ ...current, sessions: current.sessions.filter((_, index) => index !== sessionIndex) }))}>Remove session</button> : null}</div>
        <div className="form-grid">
          <label className="field"><span>Day</span><select value={session.weekday} onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, weekday: Number(event.target.value) }))}>{weekdays.map((weekday, dayIndex) => <option key={weekday} value={dayIndex} disabled={data.sessions.some((other, sessionPosition) => sessionPosition !== sessionIndex && other.weekday === dayIndex)}>{weekday}</option>)}</select></label>
          <label className="field"><span>Location</span><select value={session.location} onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, location: event.target.value as "gym" | "home" }))}><option value="gym" disabled={gymWorkoutDays === 0}>Gym</option><option value="home" disabled={homeWorkoutDays === 0}>Home</option></select></label>
          <label className="field"><span>Session name</span><input maxLength={80} value={session.label} onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, label: event.target.value }))} /></label>
          <label className="field"><span>Minutes</span><input type="number" min="5" max="240" value={session.estimatedMinutes} onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, estimatedMinutes: Number(event.target.value) }))} /></label>
        </div>
        <div className="workout-plan-edit-exercises">{session.exercises.map((target, exerciseIndex) => {
          const exercise = findExerciseById(target.exerciseId);
          const existingExerciseAvailable = editingPlan.source !== "ai" || locationExercises.some((item) => item.id === target.exerciseId);
          return <div className="workout-plan-edit-exercise" key={`${sessionIndex}-${exerciseIndex}`}>
            <div className="workout-exercise-heading"><strong>{exercise?.name ?? target.exerciseId}</strong>{session.exercises.length > 1 ? <button type="button" className="quiet-button entry-delete" onClick={() => updateSession(sessionIndex, (current) => ({ ...current, exercises: current.exercises.filter((_, index) => index !== exerciseIndex) }))}>Remove</button> : null}</div>
            <label className="field"><span>Exercise</span><select value={target.exerciseId} onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, exercises: current.exercises.map((item, index) => index === exerciseIndex ? toTemplateExercise(event.target.value) : item) }))}>{(editingPlan.source === "ai" ? locationExercises : exerciseCatalog).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{!existingExerciseAvailable ? <option value={target.exerciseId}>{exercise?.name ?? target.exerciseId} · unavailable here</option> : null}</select></label>
            <div className="form-grid">
              <label className="field"><span>Sets</span><input type="number" min="1" max="20" value={target.sets} onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, exercises: current.exercises.map((item, index) => index === exerciseIndex ? { ...item, sets: Number(event.target.value) } : item) }))} /></label>
              <label className="field"><span>{target.trackingMode === "time" ? "Hold min (sec)" : "Reps min"}</span><input type="number" min="1" max={target.trackingMode === "time" ? 7200 : 200} value={target.targetMin} onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, exercises: current.exercises.map((item, index) => index === exerciseIndex ? { ...item, targetMin: Number(event.target.value) } : item) }))} /></label>
              <label className="field"><span>{target.trackingMode === "time" ? "Hold max (sec)" : "Reps max"}</span><input type="number" min="1" max={target.trackingMode === "time" ? 7200 : 200} value={target.targetMax} onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, exercises: current.exercises.map((item, index) => index === exerciseIndex ? { ...item, targetMax: Number(event.target.value) } : item) }))} /></label>
              <label className="field"><span>Rest (sec)</span><input type="number" min="0" max="900" value={target.restSeconds} onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, exercises: current.exercises.map((item, index) => index === exerciseIndex ? { ...item, restSeconds: Number(event.target.value) } : item) }))} /></label>
              {target.trackingMode === "reps" ? <label className="field"><span>Target load ({unitSystem === "imperial" ? "lb" : "kg"})</span><input type="number" min="0" max={unitSystem === "imperial" ? 2204 : 1000} step="0.5" value={target.targetLoadKg === null ? "" : (unitSystem === "imperial" ? target.targetLoadKg * poundsPerKilogram : target.targetLoadKg).toFixed(1)} placeholder="Optional" onChange={(event) => updateSession(sessionIndex, (current) => ({ ...current, exercises: current.exercises.map((item, index) => {
                if (index !== exerciseIndex) return item;
                const value = event.target.value.trim() ? Number(event.target.value) : null;
                return { ...item, targetLoadKg: value === null ? null : unitSystem === "imperial" ? value / poundsPerKilogram : value };
              }) }))} /></label> : null}
            </div>
          </div>;
        })}</div>
        <button type="button" className="text-button" disabled={session.exercises.length >= 20 || (editingPlan.source === "ai" && locationExercises.length === 0)} onClick={() => updateSession(sessionIndex, (current) => ({ ...current, exercises: [...current.exercises, toTemplateExercise((editingPlan.source === "ai" ? locationExercises : exerciseCatalog)[0]?.id ?? "bodyweight-squat")] }))}>＋ Add exercise</button>
      </article>;
      })}</div>
      <button type="button" className="button button-secondary" disabled={data.sessions.length >= 7} onClick={() => {
        const occupied = new Set(data.sessions.map((session) => session.weekday));
        const nextDay = weekdays.findIndex((_, index) => !occupied.has(index));
        if (nextDay < 0) return;
        updateData((current) => ({ ...current, sessions: [...current.sessions, { weekday: nextDay, location: homeWorkoutDays > 0 ? "home" : "gym", label: "New session", estimatedMinutes: 30, exercises: [toTemplateExercise(exerciseCatalog[0]?.id ?? "bodyweight-squat")] }] }));
      }}>＋ Add session</button>
      {locationDaysExceeded ? <p className="field-note">This draft exceeds your selected gym or home day count. Change a session location before activating it.</p> : null}
      {unavailableHomeEquipment ? <p className="field-note">A home session uses equipment you did not select. Replace that exercise or move the session to the gym.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="workout-plan-actions"><button type="button" className="button button-secondary" disabled={busy || !dirty} onClick={() => void saveDraft()}>{busy ? "Saving…" : "Save draft"}</button>{editingPlan.source === "ai" ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void rejectPlan(editingPlan)}>Reject suggestion</button> : null}<button type="button" className="button button-primary" disabled={busy || dirty || !parsedData?.success || parsedData.success && !parsedData.data.sessions.length || locationDaysExceeded || unavailableHomeEquipment} onClick={() => void approvePlan(editingPlan)}>Activate plan</button></div>
      <p className="field-note">{dirty ? "Save your changes before activation." : "Your plan is ready to activate."}</p>
    </div> : null}
    {error && !editingPlan ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="form-message" role="status">{notice}</p> : null}
  </section>;
}
