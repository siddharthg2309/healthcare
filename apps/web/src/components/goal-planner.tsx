"use client";

import { useRef, useState, type FormEvent } from "react";
import { acceptGoalRequestSchema, goalProposalRequestSchema, type GoalProposalRequest, type GoalRecord, type Profile } from "@healthcare/contracts";
import { getLocalDate, shiftGoalDate, type GoalProposal } from "@healthcare/domain";
import { ApiError, postJson, putJson } from "@/lib/api";

type ReadyGoal = Omit<GoalRecord, "goalVersion" | "acceptedAt">;
const number = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
export function goalDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export function GoalBudgetDetails({ goal, open = false }: { goal: ReadyGoal | GoalRecord; open?: boolean }) {
  const budget = goal.budget;
  if (!budget) return <p className="muted-copy">{goal.calculationMode === "weight_only" ? "Weight tracking · no calorie target" : "Edit this plan to add a detailed calorie budget."}</p>;
  const deficitLabel = budget.initialDailyDeficitKcal >= 0 ? "deficit" : "surplus";
  return <div className="goal-budget">
    <div className="budget-main"><span>Daily intake</span><strong>{number(goal.dailyCaloriesKcal!)} <small>kcal</small></strong><span>Initial {deficitLabel} · {number(Math.abs(budget.initialDailyDeficitKcal))} kcal/day</span></div>
    <div className="budget-grid"><div><span>First 7 days · scenario</span><strong>{Math.abs(budget.sevenDayWeightChangeKg).toFixed(2)} kg</strong></div><div><span>First 30 days · scenario</span><strong>{Math.abs(budget.thirtyDayWeightChangeKg).toFixed(2)} kg</strong></div></div>
    <details className="budget-details" open={open}><summary>Plan details</summary>
      <dl><div><dt>Starting maintenance estimate</dt><dd>{number(budget.maintenanceCaloriesKcal)} kcal/day</dd></div><div><dt>Everyday movement + resting needs</dt><dd>{number(budget.baselineCaloriesKcal)} kcal/day</dd></div><div><dt>Planned exercise · daily average</dt><dd>{number(budget.plannedExerciseKcalPerDay)} kcal</dd></div><div><dt>Initial daily {deficitLabel}</dt><dd>{number(Math.abs(budget.initialDailyDeficitKcal))} kcal</dd></div><div><dt>7 days at that {deficitLabel}</dt><dd>{number(Math.abs(budget.initialWeeklyDeficitKcal))} kcal</dd></div><div><dt>30 days at that {deficitLabel}</dt><dd>{number(Math.abs(budget.initialThirtyDayDeficitKcal))} kcal</dd></div><div><dt>Plan length</dt><dd>{budget.durationDays} days · {(budget.durationDays / 7).toFixed(1)} weeks</dd></div><div><dt>Chosen plan date</dt><dd>{goalDate(goal.targetDate)}</dd></div>{budget.estimatedTargetDate ? <div><dt>Approximate model arrival</dt><dd>{goalDate(budget.estimatedTargetDate)}</dd></div> : null}</dl>
      <p>Calorie totals above hold the initial deficit constant. The weight scenario allows energy needs to change. Around 7,700 kcal/kg is an arithmetic reference, not a reliable scale-weight conversion.</p>
      <p>30-day energy equivalent only: {number(Math.abs(budget.initialThirtyDayDeficitKcal))} ÷ 7,700 ≈ {(Math.abs(budget.initialThirtyDayDeficitKcal) / 7700).toFixed(2)} kg. This is not the predicted weight change.</p>
      <p>This uses the published Hall population approximation, not the full NIH Body Weight Planner. It is not a guaranteed timeline. The graph’s forecast uses your measured trend separately.</p>
      <p>Log workouts once. Their calories do not automatically increase your food allowance.</p>
      <a className="inline-link" href="https://pubmed.ncbi.nlm.nih.gov/21872751/" target="_blank" rel="noreferrer">Calculation source ↗</a>
    </details>
  </div>;
}

export function GoalPlanner({ profile, currentGoal, currentWeightKg, saveProfileBeforePreview = false, onAccepted, onCancel }: {
  profile: Profile; currentGoal?: GoalRecord; currentWeightKg?: number; saveProfileBeforePreview?: boolean;
  onAccepted: () => void | Promise<void>; onCancel?: () => void;
}) {
  const today = getLocalDate(new Date(), profile.timezone);
  const [mode, setMode] = useState<GoalProposalRequest["planningMode"]>("date");
  const [direction, setDirection] = useState<GoalProposalRequest["direction"]>(currentGoal?.direction ?? "lose");
  const weight = currentWeightKg ?? profile.currentWeightKg;
  const [target, setTarget] = useState(String(currentGoal?.targetWeightKg ?? Math.max(25, weight - 2)));
  const [date, setDate] = useState(currentGoal?.targetDate && currentGoal.targetDate > shiftGoalDate(today, 14) ? currentGoal.targetDate : shiftGoalDate(today, 84));
  const [intake, setIntake] = useState("");
  const [source, setSource] = useState<"self" | "clinician">("self");
  const [equation, setEquation] = useState<"mifflin_female" | "mifflin_male" | "not_provided">(currentGoal?.budget?.energyEquation ?? (profile.energyEquation === "manual" ? "not_provided" : profile.energyEquation));
  const [movement, setMovement] = useState<Profile["activityLevel"]>(currentGoal?.budget?.baselineActivityLevel ?? "sedentary");
  const [exercise, setExercise] = useState(String(currentGoal?.budget?.plannedExerciseKcalPerDay ?? 0));
  const [manualDateTarget, setManualDateTarget] = useState(false);
  const [proposal, setProposal] = useState<(GoalProposal & { fingerprint?: string }) | null>(null);
  const [reviewedRequest, setReviewedRequest] = useState<GoalProposalRequest | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const acceptance = useRef<{ goalId: string; measurementId: string } | null>(null);

  function changed(action: () => void) { action(); setProposal(null); setReviewedRequest(null); setAcknowledged(false); acceptance.current = null; setError(""); }
  function showError(reason: unknown) {
    setError(reason instanceof ApiError ? (typeof reason.details.message === "string" ? reason.details.message : Array.isArray(reason.details.reasons) ? reason.details.reasons.join(" ") : reason.message) : reason instanceof Error ? reason.message : "Could not save this plan.");
  }
  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setProposal(null);
    const custom = mode !== "weight_only" && intake.trim() && (mode === "intake" || manualDateTarget);
    const request = goalProposalRequestSchema.safeParse({ planningMode: mode, direction, targetWeightKg: Number(target), targetDate: date,
      baselineActivityLevel: movement, plannedExerciseKcalPerDay: Number(exercise), energyEquation: equation,
      manualDailyCalories: custom ? Number(intake) : null, manualTargetSource: custom ? source : null });
    if (!request.success) { setError("Check the target weight, date, activity, and calorie values."); return; }
    setBusy(true);
    try {
      if (saveProfileBeforePreview) await putJson("/v1/me", profile);
      const response = await postJson<GoalProposal & { fingerprint?: string }>("/v1/goals/proposal", request.data);
      setProposal(response); setReviewedRequest(request.data); setAcknowledged(false); acceptance.current = null;
    } catch (reason) { showError(reason); }
    finally { setBusy(false); }
  }
  async function accept() {
    if (proposal?.status !== "ready" || !reviewedRequest || !acknowledged || busy) return;
    const ids = acceptance.current ?? { goalId: crypto.randomUUID(), measurementId: crypto.randomUUID() };
    acceptance.current = ids;
    const request = acceptGoalRequestSchema.safeParse({ ...ids, request: reviewedRequest, accepted: true, proposalFingerprint: proposal.fingerprint });
    if (!request.success) { setError("Preview the plan again."); return; }
    setBusy(true); setError("");
    try { await postJson("/v1/goals/accept", request.data); await onAccepted(); }
    catch (reason) { showError(reason); }
    finally { setBusy(false); }
  }

  return <section className="panel goal-planner" aria-labelledby="goal-planner-heading">
    <div className="panel-heading"><div><span className="eyebrow">{currentGoal ? "NEW PLAN VERSION" : "YOUR GOAL"}</span><h2 id="goal-planner-heading">Choose your pace</h2></div>{onCancel ? <button type="button" className="quiet-button" disabled={busy} onClick={onCancel}>Close</button> : null}</div>
    <form onSubmit={(event) => void preview(event)}>
      <fieldset disabled={busy} className="goal-planner-fields">
        <div className="segmented" role="group" aria-label="Goal direction">{(["lose", "maintain", "gain"] as const).map((value) => <button key={value} type="button" className={direction === value ? "segment segment-selected" : "segment"} aria-pressed={direction === value} onClick={() => changed(() => { setDirection(value); if (value === "maintain") setTarget(String(weight)); })}>{value === "lose" ? "Lose" : value === "gain" ? "Gain" : "Maintain"}</button>)}</div>
        <label className="field"><span>Target weight · kg <small>Current {weight.toFixed(1)}</small></span><input type="number" inputMode="decimal" min="25" max="400" step="0.1" required value={target} onChange={(event) => changed(() => setTarget(event.target.value))} /></label>
        <label className="field"><span>Plan around</span><select value={mode} onChange={(event) => changed(() => setMode(event.target.value as typeof mode))}><option value="date">My target date</option><option value="intake">My daily intake</option><option value="weight_only">Weight tracking only</option></select></label>
        {mode !== "intake" ? <label className="field"><span>{mode === "weight_only" ? "Review date" : "Target date"}</span><input type="date" required min={shiftGoalDate(today, 14)} max={shiftGoalDate(today, 730)} value={date} onChange={(event) => changed(() => setDate(event.target.value))} /></label> : null}
        {mode !== "weight_only" ? <>
          <label className="field"><span>Calorie estimate</span><select value={equation} onChange={(event) => changed(() => setEquation(event.target.value as typeof equation))}><option value="not_provided">Skip · use a manual target</option><option value="mifflin_female">Female</option><option value="mifflin_male">Male</option></select></label>
          <label className="field"><span>Everyday movement · outside workouts</span><select value={movement} onChange={(event) => changed(() => setMovement(event.target.value as typeof movement))}><option value="sedentary">Mostly sitting</option><option value="light">Some standing and walking</option><option value="moderate">On my feet much of the day</option><option value="active">Physical work most of the day</option><option value="very_active">Heavy physical work</option></select></label>
          <label className="field"><span>Planned exercise · average kcal/day</span><input type="number" min="0" max="1000" step="1" required value={exercise} onChange={(event) => changed(() => setExercise(event.target.value))} /><small>Optional: 3 × 300 kcal/week ≈ 129/day. Leave 0 if unsure.</small></label>
          {mode === "date" ? <label className="toggle-row"><input type="checkbox" checked={manualDateTarget} onChange={(event) => changed(() => setManualDateTarget(event.target.checked))} /><span>Use my own calorie target</span></label> : null}
          {mode === "intake" || manualDateTarget ? <><label className="field"><span>Daily intake · kcal</span><input type="number" inputMode="numeric" min="800" max="5000" value={intake} onChange={(event) => changed(() => setIntake(event.target.value))} placeholder={mode === "intake" ? "Leave blank for a suggestion" : "Enter your target"} required={manualDateTarget} /></label>{intake ? <label className="field"><span>Target source</span><select value={source} onChange={(event) => changed(() => setSource(event.target.value as typeof source))}><option value="self">Chosen by me</option><option value="clinician">Provided by my clinician</option></select></label> : null}</> : null}
        </> : null}
        <button type="submit" className="button button-secondary">{busy ? "Calculating…" : "Preview plan"}</button>
      </fieldset>
    </form>
    {proposal?.status === "ready" ? <div className="goal-proposal-review">
      <div className="goal-review-hero"><span className="eyebrow">REVIEW BEFORE ACCEPTING</span><strong>{proposal.goal.startWeightKg.toFixed(1)} → {proposal.goal.targetWeightKg.toFixed(1)} kg</strong><span>{goalDate(proposal.goal.startDate)} — {goalDate(proposal.goal.targetDate)}</span></div>
      <GoalBudgetDetails goal={proposal.goal} />
      {!proposal.goal.budget && proposal.goal.dailyCaloriesKcal !== null ? <p>Daily intake · {number(proposal.goal.dailyCaloriesKcal)} kcal. No automatic weight forecast is available for this profile.</p> : null}
      {proposal.goal.dailyCaloriesKcal !== null && mode === "date" ? <button type="button" className="text-button" disabled={busy} onClick={() => changed(() => { setMode("intake"); setIntake(String(proposal.goal.dailyCaloriesKcal)); })}>Adjust this intake and recalculate my date</button> : null}
      <label className="acknowledgment"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I reviewed this intake, activity, and timeline.</span></label>
      <button type="button" className="button button-primary button-wide" disabled={!acknowledged || busy} onClick={() => void accept()}>{busy ? "Saving…" : currentGoal ? "Accept new plan" : "Start my plan"}</button>
    </div> : proposal?.status === "manual_required" ? <div className="goal-alternatives" role="status"><h3>Adjust your plan</h3>{proposal.reasons.map((reason) => <p key={reason}>{reason}</p>)}<div className="button-row">{proposal.suggestedTargetDate ? <button className="button button-secondary" type="button" onClick={() => changed(() => { setMode("date"); setDate(proposal.suggestedTargetDate!); setManualDateTarget(false); })}>Try {goalDate(proposal.suggestedTargetDate)}</button> : null}{proposal.suggestedDailyCalories ? <button className="button button-secondary" type="button" onClick={() => changed(() => { setMode("intake"); setIntake(String(proposal.suggestedDailyCalories)); })}>Try {number(proposal.suggestedDailyCalories)} kcal</button> : null}<button className="text-button" type="button" onClick={() => changed(() => { setMode("weight_only"); if (date < shiftGoalDate(today, 14)) setDate(shiftGoalDate(today, 84)); })}>Continue with weight tracking</button></div></div> : proposal?.status === "invalid" ? <p className="form-error">{proposal.reason}</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </section>;
}
