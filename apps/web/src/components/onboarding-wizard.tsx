"use client";

import { useState, type FormEvent } from "react";
import { acceptGoalRequestSchema, goalProposalRequestSchema, profileSchema, type GoalRecord, type GoalProposalRequest, type Profile } from "@healthcare/contracts";
import { ApiError, postJson, putJson } from "@/lib/api";

type ProposalResponse =
  | { status: "ready"; goal: Omit<GoalRecord, "goalVersion" | "acceptedAt">; notes: string[] }
  | { status: "manual_required"; reasons: string[] };

type Draft = {
  displayName: string;
  ageYears: string;
  heightCm: string;
  currentWeightKg: string;
  unitSystem: "metric" | "imperial";
  energyEquation: Profile["energyEquation"];
  activityLevel: Profile["activityLevel"];
  timezone: string;
  dietaryPreferences: string;
  restrictions: string;
  equipment: string;
  availableWorkoutDays: string;
  trainingExperience: Profile["trainingExperience"];
  preferredWorkoutMinutes: string;
  movementLimitations: string;
  pregnancyOrBreastfeeding: boolean;
  clinicianDirectedDiet: boolean;
  direction: GoalProposalRequest["direction"];
  targetWeightKg: string;
  targetDate: string;
  manualDailyCalories: string;
  manualTargetSource: GoalProposalRequest["manualTargetSource"];
};

function dateInWeeks(weeks: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function splitList(value: string, max: number): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && Array.isArray(error.details.reasons)) {
    return (error.details.reasons as string[]).join(" ");
  }
  return error instanceof Error ? error.message : "Please check your details and try again.";
}

export function OnboardingWizard({
  initialName,
  onComplete,
}: {
  initialName: string;
  onComplete: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    displayName: initialName,
    ageYears: "",
    heightCm: "",
    currentWeightKg: "",
    unitSystem: "metric",
    energyEquation: "not_provided",
    activityLevel: "light",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    dietaryPreferences: "",
    restrictions: "",
    equipment: "",
    availableWorkoutDays: "3",
    trainingExperience: "beginner",
    preferredWorkoutMinutes: "45",
    movementLimitations: "",
    pregnancyOrBreastfeeding: false,
    clinicianDirectedDiet: false,
    direction: "lose",
    targetWeightKg: "",
    targetDate: dateInWeeks(12),
    manualDailyCalories: "",
    manualTargetSource: null,
  }));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [step, setStep] = useState<"profile" | "goal" | "review">("profile");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [acceptanceIds, setAcceptanceIds] = useState<{ goalId: string; measurementId: string } | null>(null);

  function update<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function saveProfileAndContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsed = profileSchema.safeParse({
      displayName: draft.displayName,
      ageYears: Number(draft.ageYears),
      heightCm: Number(draft.heightCm),
      currentWeightKg: Number(draft.currentWeightKg),
      unitSystem: draft.unitSystem,
      energyEquation: draft.energyEquation,
      activityLevel: draft.activityLevel,
      timezone: draft.timezone,
      dietaryPreferences: splitList(draft.dietaryPreferences, 30),
      restrictions: splitList(draft.restrictions, 50),
      equipment: splitList(draft.equipment, 50),
      availableWorkoutDays: Number(draft.availableWorkoutDays),
      trainingExperience: draft.trainingExperience,
      preferredWorkoutMinutes: Number(draft.preferredWorkoutMinutes),
      movementLimitations: splitList(draft.movementLimitations, 20),
      pregnancyOrBreastfeeding: draft.pregnancyOrBreastfeeding,
      clinicianDirectedDiet: draft.clinicianDirectedDiet,
    });
    if (!parsed.success) {
      setError("Enter a name, age, height, weight, and workout days within the shown ranges.");
      return;
    }
    setProfile(parsed.data);
    setStep("goal");
  }

  function createGoalRequest(): GoalProposalRequest | null {
    const parsed = goalProposalRequestSchema.safeParse({
      direction: draft.direction,
      targetWeightKg: Number(draft.targetWeightKg),
      targetDate: draft.targetDate,
      manualDailyCalories: draft.manualDailyCalories.trim() ? Number(draft.manualDailyCalories) : null,
      manualTargetSource: draft.manualDailyCalories.trim() ? draft.manualTargetSource : null,
    });
    if (!parsed.success) {
      setError("Enter a valid target weight and date. Manual calorie targets need a source.");
      return null;
    }
    return parsed.data;
  }

  async function makeProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!profile) return;
    const request = createGoalRequest();
    if (!request) return;
    setBusy(true);
    try {
      await putJson("/v1/me", profile);
      const nextProposal = await postJson<ProposalResponse>("/v1/goals/proposal", request);
      setProposal(nextProposal);
      setAcceptanceIds(null);
      setAcknowledged(false);
      setStep("review");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function acceptProposal() {
    setError("");
    if (!profile || proposal?.status !== "ready" || !acknowledged) return;
    const request = createGoalRequest();
    if (!request) return;
    const ids = acceptanceIds ?? {
      goalId: globalThis.crypto.randomUUID(),
      measurementId: globalThis.crypto.randomUUID(),
    };
    setAcceptanceIds(ids);
    const parsed = acceptGoalRequestSchema.safeParse({ ...ids, request, accepted: true });
    if (!parsed.success) {
      setError("Review the goal details and try again.");
      return;
    }
    setBusy(true);
    try {
      await postJson("/v1/goals/accept", parsed.data);
      onComplete();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="onboarding-shell" aria-labelledby="onboarding-title">
      <div className="onboarding-heading">
        <span className="eyebrow">YOUR STARTING POINT</span>
        <h1 id="onboarding-title">{step === "profile" ? "Build your profile" : step === "goal" ? "Choose your goal" : "Review your plan"}</h1>
        <p>Set a baseline first. You can update your profile and goal later.</p>
      </div>

      <div className="step-track" aria-label={`Step ${step === "profile" ? 1 : step === "goal" ? 2 : 3} of 3`}>
        {["profile", "goal", "review"].map((item, index) => (
          <span key={item} className={step === item ? "step-dot step-dot-active" : index < ["profile", "goal", "review"].indexOf(step) ? "step-dot step-dot-done" : "step-dot"} />
        ))}
      </div>

      {step === "profile" ? (
        <form className="form-card" onSubmit={saveProfileAndContinue}>
          <div className="form-section">
            <h2>About you</h2>
            <div className="form-grid">
              <Field label="Display name" value={draft.displayName} onChange={(value) => update("displayName", value)} autoComplete="name" />
              <Field label="Age" type="number" value={draft.ageYears} onChange={(value) => update("ageYears", value)} min="13" max="110" />
              <Field label="Height (cm)" type="number" value={draft.heightCm} onChange={(value) => update("heightCm", value)} min="80" max="250" />
              <Field label="Current weight (kg)" type="number" value={draft.currentWeightKg} onChange={(value) => update("currentWeightKg", value)} min="25" max="400" step="0.1" />
              <SelectField label="Preferred display units" value={draft.unitSystem} onChange={(value) => update("unitSystem", value as Draft["unitSystem"])} options={[["metric", "Metric"], ["imperial", "Imperial"]]} />
              <Field label="Time zone" value={draft.timezone} onChange={(value) => update("timezone", value)} />
            </div>
            <p className="field-note">Measurements are entered in centimetres and kilograms. Your unit preference applies to app displays.</p>
          </div>

          <div className="form-section">
            <h2>Daily routine</h2>
            <div className="form-grid">
              <SelectField label="Usual activity" value={draft.activityLevel} onChange={(value) => update("activityLevel", value as Draft["activityLevel"])} options={[
                ["sedentary", "Mostly sitting"], ["light", "Light activity"], ["moderate", "Moderately active"], ["active", "Active most days"], ["very_active", "Very active"],
              ]} />
              <Field label="Workout days per week" type="number" value={draft.availableWorkoutDays} onChange={(value) => update("availableWorkoutDays", value)} min="0" max="7" />
              <SelectField label="Strength-training experience" value={draft.trainingExperience} onChange={(value) => update("trainingExperience", value as Draft["trainingExperience"])} options={[["beginner", "New or returning"], ["intermediate", "Some experience"], ["advanced", "Experienced"]]} />
              <Field label="Preferred workout length (minutes)" type="number" value={draft.preferredWorkoutMinutes} onChange={(value) => update("preferredWorkoutMinutes", value)} min="10" max="180" />
              <Field label="Equipment you have" value={draft.equipment} onChange={(value) => update("equipment", value)} placeholder="Dumbbells, bands" />
              <Field label="Movements you need to avoid" value={draft.movementLimitations} onChange={(value) => update("movementLimitations", value)} placeholder="Optional; comma-separated" />
              <Field label="Food preferences" value={draft.dietaryPreferences} onChange={(value) => update("dietaryPreferences", value)} placeholder="Vegetarian, South Indian" />
              <Field label="Allergies or foods to avoid" value={draft.restrictions} onChange={(value) => update("restrictions", value)} placeholder="Peanuts, shellfish" />
            </div>
            <p className="field-note">Workout suggestions use your experience, available equipment, and preferred session length. If you list a movement limitation, use a reviewed template until that limitation can be safely reviewed.</p>
          </div>

          <div className="form-section">
            <h2>Calorie estimate</h2>
            <p className="field-note">Choose an energy equation only if you’re comfortable. The choice is explicit and is not inferred from gender identity.</p>
            <SelectField label="Equation input" value={draft.energyEquation} onChange={(value) => update("energyEquation", value as Draft["energyEquation"])} options={[
              ["not_provided", "I prefer not to choose"], ["mifflin_female", "Mifflin–St Jeor · female coefficient"], ["mifflin_male", "Mifflin–St Jeor · male coefficient"], ["manual", "I will enter a target manually"],
            ]} />
            <Toggle label="Pregnant or breastfeeding" checked={draft.pregnancyOrBreastfeeding} onChange={(value) => update("pregnancyOrBreastfeeding", value)} />
            <Toggle label="Following a clinician-directed diet" checked={draft.clinicianDirectedDiet} onChange={(value) => update("clinicianDirectedDiet", value)} />
          </div>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button-primary button-wide" type="submit">Continue to goal <span aria-hidden="true">→</span></button>
        </form>
      ) : null}

      {step === "goal" ? (
        <form className="form-card" onSubmit={(event) => void makeProposal(event)}>
          <div className="form-section">
            <h2>What do you want to work toward?</h2>
            <div className="segmented" role="group" aria-label="Goal direction">
              {(["lose", "maintain", "gain"] as const).map((direction) => (
                <button key={direction} type="button" aria-pressed={draft.direction === direction} className={draft.direction === direction ? "segment segment-selected" : "segment"} onClick={() => update("direction", direction)}>
                  {direction === "lose" ? "Lose" : direction === "gain" ? "Gain" : "Maintain"}
                </button>
              ))}
            </div>
            <div className="form-grid">
              <Field label="Target weight (kg)" type="number" value={draft.targetWeightKg} onChange={(value) => update("targetWeightKg", value)} min="25" max="400" step="0.1" />
              <Field label="Target date" type="date" value={draft.targetDate} onChange={(value) => update("targetDate", value)} />
            </div>
          </div>

          <div className="form-section">
            <h2>Optional manual calorie target</h2>
            <Field label="Daily calories (kcal)" type="number" value={draft.manualDailyCalories} onChange={(value) => {
              update("manualDailyCalories", value);
              if (value && !draft.manualTargetSource) update("manualTargetSource", "self");
              if (!value) update("manualTargetSource", null);
            }} min="800" max="5000" />
            {draft.manualDailyCalories ? (
              <SelectField label="Target source" value={draft.manualTargetSource ?? "self"} onChange={(value) => update("manualTargetSource", value as Draft["manualTargetSource"])} options={[["self", "Entered by me"], ["clinician", "Provided by a clinician"]]} />
            ) : <p className="field-note">Leave this blank for an automatic estimate when your profile is eligible.</p>}
          </div>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="button-row">
            <button className="button button-secondary" type="button" onClick={() => setStep("profile")}>Back</button>
            <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Calculating…" : "Review plan"}</button>
          </div>
        </form>
      ) : null}

      {step === "review" && proposal ? (
        <div className="form-card">
          {proposal.status === "ready" ? (
            <>
              <div className="goal-review-hero">
                <span className="eyebrow">YOUR TARGET PATH</span>
                <strong>{proposal.goal.startWeightKg.toFixed(1)} <span>→</span> {proposal.goal.targetWeightKg.toFixed(1)} kg</strong>
                <span>{proposal.goal.startDate} to {proposal.goal.targetDate}</span>
              </div>
              <div className="review-grid">
                <div className="review-stat"><span>Daily calories</span><strong>{proposal.goal.dailyCaloriesKcal?.toLocaleString("en-IN") ?? "Not set"}</strong><small>{proposal.goal.calculationMode === "automatic_estimate" ? "Estimated target" : "Manual target"}</small></div>
                {proposal.goal.macrosGrams ? (
                  <>
                    <div className="review-stat"><span>Protein</span><strong>{proposal.goal.macrosGrams.protein} g</strong><small>Daily starter target</small></div>
                    <div className="review-stat"><span>Carbohydrate</span><strong>{proposal.goal.macrosGrams.carbohydrate} g</strong><small>Daily starter target</small></div>
                    <div className="review-stat"><span>Fat</span><strong>{proposal.goal.macrosGrams.fat} g</strong><small>Daily starter target</small></div>
                  </>
                ) : null}
              </div>
              <div className="rationale-list">
                {proposal.goal.rationale.map((item) => <p key={item}>{item}</p>)}
                {proposal.notes.map((item) => <p key={item}>{item}</p>)}
              </div>
            </>
          ) : (
            <div className="manual-review">
              <span className="eyebrow">MANUAL REVIEW NEEDED</span>
              <h2>No automatic calorie plan for this profile</h2>
              {proposal.reasons.map((reason) => <p key={reason}>{reason}</p>)}
              <p>You can still use food and activity tracking. Add a suitable manual target or revise your profile and goal.</p>
            </div>
          )}

          <label className="acknowledgment">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>I reviewed this estimate. I understand it is for general tracking and is not medical advice.</span>
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="button-row">
            <button className="button button-secondary" type="button" onClick={() => setStep("goal")}>Edit goal</button>
            <button className="button button-primary" type="button" disabled={busy || proposal.status !== "ready" || !acknowledged} onClick={() => void acceptProposal()}>
              {busy ? "Saving…" : "Accept goal"}
            </button>
          </div>
          <button className="text-button" type="button" onClick={() => setStep("profile")}>Edit profile</button>
        </div>
      ) : null}
    </section>
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
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} {...inputProps} />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
