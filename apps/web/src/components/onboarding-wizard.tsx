"use client";

import { useState, type FormEvent } from "react";
import { profileSchema, type Profile } from "@healthcare/contracts";
import { GoalPlanner } from "./goal-planner";

type Draft = {
  displayName: string;
  ageYears: string;
  heightCm: string;
  currentWeightKg: string;
  unitSystem: "metric" | "imperial";
  energyEquation: Profile["energyEquation"];
  activityLevel: Profile["activityLevel"];
  timezone: string;
  foodPattern: Profile["foodPreferences"]["pattern"];
  vegetarianWeekdays: number[];
  dietaryPreferences: string;
  restrictions: string;
  equipment: string[];
  gymEnabled: boolean;
  homeEnabled: boolean;
  gymWorkoutDays: string;
  homeWorkoutDays: string;
  trainingExperience: Profile["trainingExperience"];
  preferredWorkoutMinutes: string;
  movementLimitations: string;
  pregnancyOrBreastfeeding: boolean;
  clinicianDirectedDiet: boolean;
};

function splitList(value: string, max: number): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, max);
}

const weekdayOptions = [
  { value: 1, label: "Monday", shortLabel: "Mon" },
  { value: 2, label: "Tuesday", shortLabel: "Tue" },
  { value: 3, label: "Wednesday", shortLabel: "Wed" },
  { value: 4, label: "Thursday", shortLabel: "Thu" },
  { value: 5, label: "Friday", shortLabel: "Fri" },
  { value: 6, label: "Saturday", shortLabel: "Sat" },
  { value: 0, label: "Sunday", shortLabel: "Sun" },
];

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
    foodPattern: "no_preference",
    vegetarianWeekdays: [],
    dietaryPreferences: "",
    restrictions: "",
    equipment: [],
    gymEnabled: false,
    homeEnabled: true,
    gymWorkoutDays: "2",
    homeWorkoutDays: "3",
    trainingExperience: "beginner",
    preferredWorkoutMinutes: "45",
    movementLimitations: "",
    pregnancyOrBreastfeeding: false,
    clinicianDirectedDiet: false,
  }));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<"profile" | "goal">("profile");
  const [error, setError] = useState("");

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
      foodPreferences: {
        pattern: draft.foodPattern,
        vegetarianWeekdays: draft.foodPattern === "mixed" ? draft.vegetarianWeekdays : [],
      },
      dietaryPreferences: splitList(draft.dietaryPreferences, 30),
      restrictions: splitList(draft.restrictions, 50),
      equipment: draft.homeEnabled ? draft.equipment : [],
      availableWorkoutDays: (draft.gymEnabled ? Number(draft.gymWorkoutDays) : 0) + (draft.homeEnabled ? Number(draft.homeWorkoutDays) : 0),
      gymWorkoutDays: draft.gymEnabled ? Number(draft.gymWorkoutDays) : 0,
      homeWorkoutDays: draft.homeEnabled ? Number(draft.homeWorkoutDays) : 0,
      trainingExperience: draft.trainingExperience,
      preferredWorkoutMinutes: Number(draft.preferredWorkoutMinutes),
      movementLimitations: splitList(draft.movementLimitations, 20),
      pregnancyOrBreastfeeding: draft.pregnancyOrBreastfeeding,
      clinicianDirectedDiet: draft.clinicianDirectedDiet,
    });
    if (!parsed.success) {
      setError(draft.foodPattern === "mixed" && (draft.vegetarianWeekdays.length < 1 || draft.vegetarianWeekdays.length > 6)
        ? "Choose one to six vegetarian weekdays for a mixed food plan."
        : "Check your details and that gym plus home workout days total no more than seven.");
      return;
    }
    setProfile(parsed.data);
    setStep("goal");
  }

  return (
    <section className="onboarding-shell" aria-labelledby="onboarding-title">
      <div className="onboarding-heading">
        <span className="eyebrow">YOUR STARTING POINT</span>
        <h1 id="onboarding-title">{step === "profile" ? "Build your profile" : "Choose your goal"}</h1>
      </div>

      <div className="step-track" aria-label={`Step ${step === "profile" ? 1 : 2} of 2`}>
        {["profile", "goal"].map((item, index) => (
          <span key={item} className={step === item ? "step-dot step-dot-active" : index < ["profile", "goal"].indexOf(step) ? "step-dot step-dot-done" : "step-dot"} />
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
          </div>

          <div className="form-section">
            <h2>Daily routine</h2>
            <div className="form-grid">
              <SelectField label="Usual activity" value={draft.activityLevel} onChange={(value) => update("activityLevel", value as Draft["activityLevel"])} options={[
                ["sedentary", "Mostly sitting"], ["light", "Light activity"], ["moderate", "Moderately active"], ["active", "Active most days"], ["very_active", "Very active"],
              ]} />
              <div className="field availability-field">
                <span>Where do you work out?</span>
                <div className="availability-options">
                  <label className="toggle-row"><input type="checkbox" checked={draft.gymEnabled} onChange={(event) => update("gymEnabled", event.target.checked)} /><span>Gym</span></label>
                  <label className="toggle-row"><input type="checkbox" checked={draft.homeEnabled} onChange={(event) => update("homeEnabled", event.target.checked)} /><span>Home</span></label>
                </div>
              </div>
              {draft.gymEnabled ? <Field label="Gym days per week" type="number" value={draft.gymWorkoutDays} onChange={(value) => update("gymWorkoutDays", value)} min="0" max="7" /> : null}
              {draft.homeEnabled ? <Field label="Home days per week" type="number" value={draft.homeWorkoutDays} onChange={(value) => update("homeWorkoutDays", value)} min="0" max="7" /> : null}
              <p className="field-note availability-note">Up to 7 workout days in total.</p>
              <SelectField label="Strength-training experience" value={draft.trainingExperience} onChange={(value) => update("trainingExperience", value as Draft["trainingExperience"])} options={[["beginner", "New or returning"], ["intermediate", "Some experience"], ["advanced", "Experienced"]]} />
              <Field label="Preferred workout length (minutes)" type="number" value={draft.preferredWorkoutMinutes} onChange={(value) => update("preferredWorkoutMinutes", value)} min="10" max="180" />
              {draft.homeEnabled ? <fieldset className="field home-equipment-field">
                <legend>Equipment available at home</legend>
                <div className="home-equipment-options">
                  {[["dumbbells", "Dumbbells"], ["kettlebell", "Kettlebells"], ["resistance bands", "Resistance bands"], ["bench", "Bench or stable chair"], ["pull-up bar", "Pull-up bar"], ["barbell and rack", "Barbell and rack"]].map(([value, label]) => (
                    <label className="toggle-row" key={value}><input type="checkbox" checked={draft.equipment.includes(value)} onChange={(event) => update("equipment", event.target.checked ? [...draft.equipment, value] : draft.equipment.filter((item) => item !== value))} /><span>{label}</span></label>
                  ))}
                </div>
                <small>If none are selected, home sessions use bodyweight exercises.</small>
              </fieldset> : null}
              <Field label="Movements you need to avoid" value={draft.movementLimitations} onChange={(value) => update("movementLimitations", value)} placeholder="Optional; comma-separated" />
              <fieldset className="field food-pattern-field">
                <legend>Food pattern</legend>
                <div className="food-pattern-options" role="radiogroup" aria-label="Weekly food pattern">
                  {([
                    ["no_preference", "No preference"],
                    ["vegetarian", "Vegetarian"],
                    ["non_vegetarian", "Non-vegetarian"],
                    ["mixed", "Mixed by weekday"],
                  ] as const).map(([value, label]) => (
                    <label className={draft.foodPattern === value ? "food-pattern-choice food-pattern-choice-selected" : "food-pattern-choice"} key={value}>
                      <input type="radio" name="food-pattern" value={value} checked={draft.foodPattern === value} onChange={() => {
                        update("foodPattern", value);
                        if (value !== "mixed") update("vegetarianWeekdays", []);
                      }} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {draft.foodPattern === "mixed" ? (
                  <fieldset className="field vegetarian-days-field">
                    <legend>Which days should be vegetarian?</legend>
                    <div className="vegetarian-day-options">
                      {weekdayOptions.map((day) => (
                        <label className="toggle-row" key={day.value}>
                          <input type="checkbox" checked={draft.vegetarianWeekdays.includes(day.value)} onChange={(event) => update("vegetarianWeekdays", event.target.checked ? [...draft.vegetarianWeekdays, day.value] : draft.vegetarianWeekdays.filter((weekday) => weekday !== day.value))} />
                          <span aria-label={day.label}>{day.shortLabel}</span>
                        </label>
                      ))}
                    </div>
                    <small>Choose 1–6 vegetarian days.</small>
                  </fieldset>
                ) : draft.foodPattern === "vegetarian" ? (
                  <small className="food-pattern-note">Vegetarian every day.</small>
                ) : draft.foodPattern === "non_vegetarian" ? (
                  <small className="food-pattern-note">Meat, fish, and eggs allowed.</small>
                ) : <small className="food-pattern-note">Choose any food.</small>}
              </fieldset>
              <Field label="Cuisine and other preferences" value={draft.dietaryPreferences} onChange={(value) => update("dietaryPreferences", value)} placeholder="South Indian, high protein" />
              <Field label="Allergies or foods to avoid" value={draft.restrictions} onChange={(value) => update("restrictions", value)} placeholder="Peanuts, shellfish" />
            </div>
          </div>

          <div className="form-section">
            <h2>Health considerations</h2>
            <Toggle label="Pregnant or breastfeeding" checked={draft.pregnancyOrBreastfeeding} onChange={(value) => update("pregnancyOrBreastfeeding", value)} />
            <Toggle label="Following a clinician-directed diet" checked={draft.clinicianDirectedDiet} onChange={(value) => update("clinicianDirectedDiet", value)} />
          </div>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button-primary button-wide" type="submit">Continue to goal <span aria-hidden="true">→</span></button>
        </form>
      ) : null}

      {step === "goal" && profile ? <GoalPlanner profile={profile} saveProfileBeforePreview onAccepted={onComplete} onCancel={() => setStep("profile")} /> : null}

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
