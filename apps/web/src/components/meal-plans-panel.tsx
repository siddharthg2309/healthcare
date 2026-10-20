"use client";

import { useEffect, useMemo, useState } from "react";
import {
  mealPlanVersionSchema,
  mealPlansResponseSchema,
  type MealPlanVersion,
} from "@healthcare/contracts";
import { ApiError, postJson, requestJson } from "@/lib/api";

const mealLabels: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function mealPlanError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      profile_or_accepted_goal_required: "Finish your profile and accept a goal before creating a meal plan.",
      accepted_calorie_target_required: "Your accepted goal needs a daily calorie target first.",
      meal_planning_not_available_for_this_profile: "Meal planning is not available for this profile. Food logging remains available.",
      meal_plan_food_metadata_required: "Add reviewed food and allergen tags to the catalog before asking for a plan with dietary preferences or restrictions.",
      meal_plan_catalog_coverage_insufficient: "The reviewed catalog needs more foods before it can build a useful week. Add more reviewed entries and try again.",
      meal_planning_not_configured: "Meal planning is not enabled on the server yet. Add the OpenRouter key in Vercel environment settings.",
      meal_plan_provider_unavailable: "The meal planner could not reach the model. Try again in a little while.",
      meal_plan_draft_exists: "Review or reject your current draft before creating another plan.",
      meal_plan_generation_failed: "The plan could not be completed. Your current plan has not changed.",
    };
    return messages[error.code] ?? error.message;
  }
  return error instanceof Error ? error.message : "The meal plan could not be saved.";
}

function dateLabel(value: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat("en-IN", options).format(new Date(`${value}T12:00:00`));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function MealPlansPanel({ startDate }: { startDate: string }) {
  const [plans, setPlans] = useState<MealPlanVersion[]>([]);
  const [draft, setDraft] = useState<MealPlanVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [planStartDate, setPlanStartDate] = useState(startDate);
  const [selectedDate, setSelectedDate] = useState(startDate);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activePlan = useMemo(() => plans.find((plan) => plan.status === "active") ?? null, [plans]);
  const visiblePlan = draft ?? activePlan;
  const selectedDay = visiblePlan?.data.days.find((day) => day.date === selectedDate) ?? visiblePlan?.data.days[0] ?? null;
  const history = plans.filter((plan) => plan.status === "superseded" || plan.status === "archived");

  async function loadPlans() {
    const response = await requestJson<unknown>("/v1/meal-plans", { cache: "no-store" });
    const parsed = mealPlansResponseSchema.safeParse(response);
    if (!parsed.success) throw new Error("Saved meal plans could not be read.");
    const ordered = [...parsed.data.plans].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    setPlans(ordered);
    const pending = ordered.find((plan) => plan.status === "draft") ?? null;
    setDraft(pending);
    setDirty(false);
    if (pending) setSelectedDate(pending.data.days[0]?.date ?? startDate);
    else if (ordered[0]) setSelectedDate(ordered[0].data.days[0]?.date ?? startDate);
  }

  useEffect(() => {
    let mounted = true;
    requestJson<unknown>("/v1/meal-plans", { cache: "no-store" }).then((response) => {
      const parsed = mealPlansResponseSchema.safeParse(response);
      if (!parsed.success) throw new Error("Saved meal plans could not be read.");
      if (!mounted) return;
      const ordered = [...parsed.data.plans].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      setPlans(ordered);
      const pending = ordered.find((plan) => plan.status === "draft") ?? null;
      setDraft(pending);
      if (pending) setSelectedDate(pending.data.days[0]?.date ?? startDate);
      else if (ordered[0]) setSelectedDate(ordered[0].data.days[0]?.date ?? startDate);
    }).catch((caught: unknown) => {
      if (mounted) setError(mealPlanError(caught));
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [startDate]);

  function updateItem(dayIndex: number, mealIndex: number, itemIndex: number, grams: number) {
    setDraft((current) => {
      if (!current) return current;
      const days = current.data.days.map((day, index) => index !== dayIndex ? day : {
        ...day,
        meals: day.meals.map((meal, currentMeal) => currentMeal !== mealIndex ? meal : {
          ...meal,
          items: meal.items.map((item, currentItem) => currentItem !== itemIndex ? item : { ...item, quantityGrams: grams }),
        }),
      });
      return { ...current, data: { ...current.data, days } };
    });
    setDirty(true);
    setNotice("");
  }

  async function generatePlan() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await postJson<{ runId: string; status: string; plan: unknown }>("/v1/plans/meal/runs", {
        idempotencyKey: globalThis.crypto.randomUUID(),
        startDate: planStartDate,
      });
      const parsed = mealPlanVersionSchema.safeParse(response.plan);
      if (response.status !== "pending_review" || !parsed.success) throw new Error("The meal planner returned no reviewable draft.");
      setDraft(parsed.data);
      setSelectedDate(parsed.data.data.days[0]?.date ?? planStartDate);
      await loadPlans();
      setNotice("Draft ready. Review the meals and portions before approving it.");
    } catch (caught) {
      setError(mealPlanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const input = {
        baseEditVersion: draft.editVersion,
        name: draft.data.name,
        startDate: draft.data.startDate,
        days: draft.data.days.map((day) => ({
          date: day.date,
          meals: day.meals.map((meal) => ({
            mealType: meal.mealType,
            note: meal.note,
            items: meal.items.map((item) => ({
              foodId: item.foodId,
              foodSource: item.foodSource,
              quantityGrams: item.quantityGrams,
            })),
          })),
        })),
      };
      const response = await requestJson<{ plan: unknown }>(`/v1/meal-plans/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      const parsed = mealPlanVersionSchema.safeParse(response.plan);
      if (!parsed.success) throw new Error("The saved draft could not be read.");
      setDraft(parsed.data);
      await loadPlans();
      setNotice("Draft saved. Review it again before approval.");
    } catch (caught) {
      setError(mealPlanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (!draft || dirty) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await postJson<{ status: string }>(`/v1/meal-plans/${draft.id}/approve`, {
        baseEditVersion: draft.editVersion,
        decision,
      });
      await loadPlans();
      setNotice(response.status === "completed" ? "Meal plan approved. It is still separate from your food log." : "Draft rejected and archived.");
    } catch (caught) {
      setError(mealPlanError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="panel meal-plans-panel" aria-busy="true"><p className="muted-copy">Loading your meal plans…</p></section>;

  return (
    <section className="meal-plans-panel" aria-labelledby="meal-plans-title">
      <div className="meal-plan-intro">
        <div>
          <span className="eyebrow">A WEEK THAT FITS YOUR TARGET</span>
          <h2 id="meal-plans-title">Meal plan</h2>
          <p>Get a seven-day draft from your food catalog, check portions, and approve it when it looks right.</p>
        </div>
        <span className="meal-plan-mark" aria-hidden="true">7</span>
      </div>

      {!draft && !activePlan ? <div className="panel meal-plan-create">
        <div><strong>Start with a weekly plan</strong><span>It uses your accepted calorie target and reviewed catalog foods.</span></div>
        <label className="field"><span>First day</span><input type="date" value={planStartDate} min={startDate} onChange={(event) => setPlanStartDate(event.target.value)} /></label>
        <button className="button button-primary" type="button" disabled={busy} onClick={() => void generatePlan()}>
          {busy ? "Building your week…" : "Build my week"}
        </button>
      </div> : null}

      {visiblePlan ? <div className="panel meal-plan-card">
        <div className="meal-plan-card-heading">
          <div><span className="eyebrow">{draft ? "DRAFT · NEEDS YOUR REVIEW" : "APPROVED PLAN"}</span><h3>{visiblePlan.data.name}</h3></div>
          <span className={draft ? "plan-status plan-status-draft" : "plan-status plan-status-active"}>{draft ? "Review" : "Active"}</span>
        </div>
        <div className="meal-plan-week-strip" role="tablist" aria-label="Meal plan day">
          {visiblePlan.data.days.map((day, index) => <button
            key={day.date}
            type="button"
            role="tab"
            aria-selected={selectedDay?.date === day.date}
            className={selectedDay?.date === day.date ? "meal-day-tab meal-day-tab-active" : "meal-day-tab"}
            onClick={() => setSelectedDate(day.date)}
          ><small>Day {index + 1}</small><strong>{dateLabel(day.date, { weekday: "short" })}</strong><span>{new Date(`${day.date}T12:00:00`).getDate()}</span></button>)}
        </div>

        {selectedDay ? <div className="meal-plan-day-view">
          <div className="meal-day-summary">
            <div><span className="eyebrow">{dateLabel(selectedDay.date, { weekday: "long", month: "long", day: "numeric" })}</span><strong>{Math.round(selectedDay.totals.caloriesKcal).toLocaleString("en-IN")} <small>/ {visiblePlan.data.dailyCalorieTargetKcal.toLocaleString("en-IN")} kcal</small></strong></div>
            <div className="meal-day-macros"><span>Protein <b>{round(selectedDay.totals.proteinG)}{visiblePlan.data.macroTargetsGrams ? ` / ${round(visiblePlan.data.macroTargetsGrams.proteinG)}` : ""}g</b></span><span>Carbs <b>{round(selectedDay.totals.carbohydrateG)}{visiblePlan.data.macroTargetsGrams ? ` / ${round(visiblePlan.data.macroTargetsGrams.carbohydrateG)}` : ""}g</b></span><span>Fat <b>{round(selectedDay.totals.fatG)}{visiblePlan.data.macroTargetsGrams ? ` / ${round(visiblePlan.data.macroTargetsGrams.fatG)}` : ""}g</b></span></div>
          </div>
          <div className="meal-plan-meals">
            {selectedDay.meals.map((meal, mealIndex) => <article className="meal-plan-meal" key={`${selectedDay.date}:${meal.mealType}:${mealIndex}`}>
              <div className="meal-plan-meal-heading"><span className="meal-badge">{mealLabels[meal.mealType]?.[0]}</span><div><h4>{mealLabels[meal.mealType] ?? meal.mealType}</h4>{meal.note ? <p>{meal.note}</p> : null}</div></div>
              <ul>
                {meal.items.map((item, itemIndex) => <li key={`${item.foodId}:${itemIndex}`}>
                  <span><strong>{item.foodName}</strong><small>{Math.round(item.nutritionTotal.caloriesKcal)} kcal · P {round(item.nutritionTotal.proteinG)} · C {round(item.nutritionTotal.carbohydrateG)} · F {round(item.nutritionTotal.fatG)} g</small></span>
                  {draft ? <label className="meal-plan-grams"><span className="sr-only">{item.foodName} quantity in grams</span><input type="number" min="1" max="1500" step="1" value={item.quantityGrams} onChange={(event) => {
                    const quantity = event.target.value ? Number(event.target.value) : 0;
                    const dayIndex = visiblePlan.data.days.findIndex((day) => day.date === selectedDay.date);
                    updateItem(dayIndex, mealIndex, itemIndex, quantity);
                  }} /><small>g</small></label> : <span className="meal-plan-amount">{Math.round(item.quantityGrams)} g</span>}
                </li>)}
              </ul>
            </article>)}
          </div>
        </div> : null}

        {draft ? <div className="meal-plan-review-note"><span aria-hidden="true">i</span><p>Check each dish and amount. Nutrition comes from saved catalog values. This plan will not be added to your food log.</p></div> : null}
        {draft ? <div className="meal-plan-actions">
          {dirty ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => void saveDraft()}>{busy ? "Saving…" : "Save portion edits"}</button> : null}
          <button className="button button-secondary" type="button" disabled={busy || dirty} onClick={() => void decide("reject")}>Reject draft</button>
          <button className="button button-primary" type="button" disabled={busy || dirty} onClick={() => void decide("approve")}>{busy ? "Saving…" : "Approve plan"}</button>
        </div> : null}
        {dirty ? <p className="field-note">Save your changes to recalculate daily nutrition before approval.</p> : null}
      </div> : null}

      {activePlan && !draft ? <div className="panel meal-plan-create meal-plan-create-compact"><div><strong>Create a revision</strong><span>The approved plan stays active until you approve the new draft.</span></div><label className="field"><span>First day</span><input type="date" value={planStartDate} min={startDate} onChange={(event) => setPlanStartDate(event.target.value)} /></label><button className="button button-primary" type="button" disabled={busy} onClick={() => void generatePlan()}>{busy ? "Building…" : "Create draft"}</button></div> : null}

      {history.length ? <details className="meal-plan-history"><summary>Past meal plans <span>{history.length}</span></summary><div>{history.map((plan) => <article key={plan.id}><strong>{plan.data.name}</strong><span>Version {plan.version} · {plan.status === "archived" ? "Archived" : "Replaced"} · {dateLabel(plan.data.startDate, { month: "short", day: "numeric", year: "numeric" })}</span></article>)}</div></details> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="form-message" role="status">{notice}</p> : null}
      <p className="field-note">General food-planning support only. If your profile has dietary restrictions or saved food preferences, generation stays off until those foods can be filtered using reviewed tags.</p>
    </section>
  );
}
