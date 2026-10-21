"use client";

import { useEffect, useMemo, useState } from "react";
import {
  mealPlanVersionSchema,
  mealPlansResponseSchema,
  type FoodPreferences,
  type MealPlanVersion,
} from "@healthcare/contracts";
import { isVegetarianOnlyDay } from "@healthcare/domain";
import { ApiError, postJson, requestJson } from "@/lib/api";

const mealLabels: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

type SwapFoodOption = {
  id: string;
  name: string;
  category: string;
  source: "shared_catalog" | "personal";
  reviewed: boolean;
  caloriesKcalPer100g: number;
  proteinGPer100g: number;
  carbohydrateGPer100g: number;
  fatGPer100g: number;
};

type SwapTarget = { dayIndex: number; mealIndex: number; itemIndex: number };
type MealPlanDay = MealPlanVersion["data"]["days"][number];
type MealPlanMeal = MealPlanDay["meals"][number];

function mealPlanError(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      profile_or_accepted_goal_required: "Finish your profile and accept a goal before creating a meal plan.",
      accepted_calorie_target_required: "Your accepted goal needs a daily calorie target first.",
      meal_planning_not_available_for_this_profile: "Meal planning is not available for this profile. Food logging remains available.",
      meal_plan_food_metadata_required: "The catalog needs more reviewed tags for your saved food preferences or restrictions before it can build this plan.",
      meal_plan_food_not_available: "That food no longer matches your saved dietary filters. Choose another reviewed catalog food.",
      meal_plan_vegetarian_day_food_required: "This day is set as vegetarian. Choose a reviewed vegetarian catalog food instead.",
      meal_plan_catalog_coverage_insufficient: "The reviewed catalog needs more foods before it can build a useful week. Add more reviewed entries and try again.",
      meal_plan_edit_invalid: "This change puts a day outside the plan's nutrition range. Try a different food or adjust its portion.",
      meal_plan_version_conflict: "Another session saved a newer draft. Your unsaved edits are still on screen; reload the saved version before continuing.",
      meal_plan_review_stale: "Your goal, profile, or food-safety data changed after this draft was created. The draft was archived; review the refreshed plans and create a new draft if needed.",
      meal_plan_review_not_available: "This draft can no longer be approved. The latest saved plans have been refreshed.",
      meal_planning_not_configured: "Meal planning is unavailable.",
      ai_daily_limit_reached: "You have reached the shared AI limit for the last 24 hours. Manual food and activity logging still work; try again later.",
      meal_plan_provider_unavailable: "The meal planner could not reach the model. Try again in a little while.",
      meal_plan_draft_exists: "Review or reject your current draft before creating another plan.",
      meal_plan_invalid: "The model could not produce a valid meal plan within the nutrition and catalog rules. Try again or edit foods manually.",
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

function nutritionRound(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function recalculateDay(day: MealPlanDay, meals: MealPlanMeal[]): MealPlanDay {
  const updatedMeals = meals.map((meal) => ({
    ...meal,
    items: meal.items.map((item) => {
      const multiplier = item.quantityGrams / 100;
      return {
        ...item,
        nutritionTotal: {
          caloriesKcal: nutritionRound(item.nutritionPer100g.caloriesKcal * multiplier),
          proteinG: nutritionRound(item.nutritionPer100g.proteinG * multiplier),
          carbohydrateG: nutritionRound(item.nutritionPer100g.carbohydrateG * multiplier),
          fatG: nutritionRound(item.nutritionPer100g.fatG * multiplier),
        },
      };
    }),
  }));
  const totals = updatedMeals.flatMap((meal) => meal.items).reduce((sum, item) => ({
    caloriesKcal: sum.caloriesKcal + item.nutritionTotal.caloriesKcal,
    proteinG: sum.proteinG + item.nutritionTotal.proteinG,
    carbohydrateG: sum.carbohydrateG + item.nutritionTotal.carbohydrateG,
    fatG: sum.fatG + item.nutritionTotal.fatG,
  }), { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });
  return {
    ...day,
    meals: updatedMeals,
    totals: {
      caloriesKcal: nutritionRound(totals.caloriesKcal),
      proteinG: nutritionRound(totals.proteinG),
      carbohydrateG: nutritionRound(totals.carbohydrateG),
      fatG: nutritionRound(totals.fatG),
    },
  };
}

export function MealPlansPanel({ startDate, foodPreferences }: { startDate: string; foodPreferences: FoodPreferences }) {
  const [plans, setPlans] = useState<MealPlanVersion[]>([]);
  const [draft, setDraft] = useState<MealPlanVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [planStartDate, setPlanStartDate] = useState(startDate);
  const [selectedDate, setSelectedDate] = useState(startDate);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveVersionConflict, setSaveVersionConflict] = useState(false);
  const [swapTarget, setSwapTarget] = useState<SwapTarget | null>(null);
  const [swapQuery, setSwapQuery] = useState("");
  const [swapResults, setSwapResults] = useState<SwapFoodOption[]>([]);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState("");

  const activePlan = useMemo(() => plans.find((plan) => plan.status === "active") ?? null, [plans]);
  const visiblePlan = draft ?? activePlan;
  const selectedDay = visiblePlan?.data.days.find((day) => day.date === selectedDate) ?? visiblePlan?.data.days[0] ?? null;
  const swapDate = swapTarget ? visiblePlan?.data.days[swapTarget.dayIndex]?.date : undefined;
  const history = plans.filter((plan) => plan.status === "superseded" || plan.status === "archived");
  const availableSwapResults = swapResults.filter((food) => food.source === "personal" || food.reviewed);

  useEffect(() => {
    if (!swapTarget || swapQuery.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSwapBusy(true);
      setSwapError("");
      const query = new URLSearchParams({ query: swapQuery.trim(), purpose: "meal_plan" });
      if (swapDate) query.set("date", swapDate);
      void requestJson<{ foods: SwapFoodOption[] }>(`/v1/foods?${query.toString()}`, { signal: controller.signal })
        .then((response) => {
          if (!controller.signal.aborted) setSwapResults(response.foods);
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError")) return;
          setSwapResults([]);
          setSwapError(caught instanceof Error ? caught.message : "Could not search foods.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSwapBusy(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [swapQuery, swapTarget, swapDate]);

  async function loadPlans() {
    const response = await requestJson<unknown>("/v1/meal-plans", { cache: "no-store" });
    const parsed = mealPlansResponseSchema.safeParse(response);
    if (!parsed.success) throw new Error("Saved meal plans could not be read.");
    const ordered = [...parsed.data.plans].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    setPlans(ordered);
    const pending = ordered.find((plan) => plan.status === "draft") ?? null;
    setDraft(pending);
    setDirty(false);
    setSwapTarget(null);
    setSwapQuery("");
    setSwapResults([]);
    setSwapBusy(false);
    setSwapError("");
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
      const days = current.data.days.map((day, index) => {
        if (index !== dayIndex) return day;
        const meals = day.meals.map((meal, currentMeal) => currentMeal !== mealIndex ? meal : {
          ...meal,
          items: meal.items.map((item, currentItem) => currentItem !== itemIndex ? item : { ...item, quantityGrams: grams }),
        });
        return recalculateDay(day, meals);
      });
      return { ...current, data: { ...current.data, days } };
    });
    setDirty(true);
    setNotice("");
  }

  function swapItem(target: SwapTarget, food: SwapFoodOption) {
    setDraft((current) => {
      if (!current) return current;
      const days = current.data.days.map((day, dayIndex) => {
        if (dayIndex !== target.dayIndex) return day;
        const meals = day.meals.map((meal, mealIndex) => mealIndex !== target.mealIndex ? meal : {
          ...meal,
          items: meal.items.map((item, itemIndex) => itemIndex !== target.itemIndex ? item : {
            ...item,
            foodId: food.id,
            foodSource: food.source,
            foodName: food.name,
            category: food.category,
            nutritionPer100g: {
              caloriesKcal: food.caloriesKcalPer100g,
              proteinG: food.proteinGPer100g,
              carbohydrateG: food.carbohydrateGPer100g,
              fatG: food.fatGPer100g,
            },
          }),
        });
        return recalculateDay(day, meals);
      });
      return { ...current, data: { ...current.data, days } };
    });
    setDirty(true);
    setSwapTarget(null);
    setSwapQuery("");
    setSwapResults([]);
    setSwapBusy(false);
    setSwapError("");
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
    setSaveVersionConflict(false);
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
      if (caught instanceof ApiError && caught.code === "meal_plan_version_conflict") {
        setSaveVersionConflict(true);
        setError("Another session saved a newer version of this draft. Your unsaved edits are still on screen, but they cannot be saved over the newer version.");
      } else {
        setError(mealPlanError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  async function reloadSavedDraft() {
    setBusy(true);
    try {
      await loadPlans();
      setError("");
      setSaveVersionConflict(false);
      setNotice("Loaded the latest saved draft. The unsaved edits from this screen were discarded.");
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
    setSaveVersionConflict(false);
    try {
      const response = await postJson<{ status: string }>(`/v1/meal-plans/${draft.id}/approve`, {
        baseEditVersion: draft.editVersion,
        decision,
      });
      await loadPlans();
      setNotice(response.status === "completed" ? "Meal plan approved. It is still separate from your food log." : "Draft rejected and archived.");
    } catch (caught) {
      if (caught instanceof ApiError && ["meal_plan_review_stale", "meal_plan_review_not_available", "meal_plan_version_conflict"].includes(caught.code)) {
        try {
          await loadPlans();
          setError("");
          setNotice(caught.code === "meal_plan_review_stale"
            ? "Your planning inputs or food-safety data changed. The old draft was archived; the refreshed plan list is shown below."
            : "The draft changed in another session. The latest saved version is loaded; review it again before approving.");
        } catch (refreshError) {
          setError(`${mealPlanError(caught)} ${mealPlanError(refreshError)}`);
        }
      } else {
        setError(mealPlanError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="panel meal-plans-panel" aria-busy="true"><p className="muted-copy">Loading your meal plans…</p></section>;

  return (
    <section className="meal-plans-panel" aria-labelledby="meal-plans-title">
      <div className="meal-plan-intro">
        <div>

          <h2 id="meal-plans-title">Meal plan</h2>
        </div>
        <span className="meal-plan-mark" aria-hidden="true">7</span>
      </div>

      {!draft && !activePlan ? <div className="panel meal-plan-create">
        <div><strong>Start with a weekly plan</strong></div>
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
            <div>
              <span className="eyebrow">{dateLabel(selectedDay.date, { weekday: "long", month: "long", day: "numeric" })}</span>
              {isVegetarianOnlyDay(foodPreferences, selectedDay.date) ? <span className="diet-day-badge">Vegetarian day</span> : null}
              <strong>{Math.round(selectedDay.totals.caloriesKcal).toLocaleString("en-IN")} <small>/ {visiblePlan.data.dailyCalorieTargetKcal.toLocaleString("en-IN")} kcal</small></strong>
            </div>
            <div className="meal-day-macros"><span>Protein <b>{round(selectedDay.totals.proteinG)}{visiblePlan.data.macroTargetsGrams ? ` / ${round(visiblePlan.data.macroTargetsGrams.proteinG)}` : ""}g</b></span><span>Carbs <b>{round(selectedDay.totals.carbohydrateG)}{visiblePlan.data.macroTargetsGrams ? ` / ${round(visiblePlan.data.macroTargetsGrams.carbohydrateG)}` : ""}g</b></span><span>Fat <b>{round(selectedDay.totals.fatG)}{visiblePlan.data.macroTargetsGrams ? ` / ${round(visiblePlan.data.macroTargetsGrams.fatG)}` : ""}g</b></span></div>
          </div>
          <div className="meal-plan-meals">
            {selectedDay.meals.map((meal, mealIndex) => <article className="meal-plan-meal" key={`${selectedDay.date}:${meal.mealType}:${mealIndex}`}>
              <div className="meal-plan-meal-heading"><span className="meal-badge">{mealLabels[meal.mealType]?.[0]}</span><div><h4>{mealLabels[meal.mealType] ?? meal.mealType}</h4>{meal.note ? <p>{meal.note}</p> : null}</div></div>
              <ul>
                {meal.items.map((item, itemIndex) => {
                  const dayIndex = visiblePlan.data.days.findIndex((day) => day.date === selectedDay.date);
                  const target = { dayIndex, mealIndex, itemIndex };
                  const isSwapOpen = swapTarget?.dayIndex === dayIndex && swapTarget.mealIndex === mealIndex && swapTarget.itemIndex === itemIndex;
                  return <li key={`${item.foodId}:${itemIndex}`}>
                    <div className="meal-plan-item-row">
                      <span><strong>{item.foodName}</strong><small>{Math.round(item.nutritionTotal.caloriesKcal)} kcal · P {round(item.nutritionTotal.proteinG)} · C {round(item.nutritionTotal.carbohydrateG)} · F {round(item.nutritionTotal.fatG)} g</small></span>
                      {draft ? <div className="meal-plan-item-controls">
                        <label className="meal-plan-grams"><span className="sr-only">{item.foodName} quantity in grams</span><input type="number" min="1" max="1500" step="1" value={item.quantityGrams} onChange={(event) => {
                          const quantity = event.target.value ? Number(event.target.value) : 0;
                          updateItem(dayIndex, mealIndex, itemIndex, quantity);
                        }} /><small>g</small></label>
                        <button className="meal-plan-swap-button" type="button" aria-expanded={isSwapOpen} onClick={() => {
                          setSwapTarget(isSwapOpen ? null : target);
                          setSwapQuery("");
                          setSwapResults([]);
                          setSwapBusy(false);
                          setSwapError("");
                        }}>{isSwapOpen ? "Close" : "Swap"}</button>
                      </div> : <span className="meal-plan-amount">{Math.round(item.quantityGrams)} g</span>}
                    </div>
                    {isSwapOpen ? <div className="meal-plan-swap-picker">
                      <label><span>Search your food catalog</span><input autoFocus value={swapQuery} maxLength={80} onChange={(event) => {
                        const query = event.target.value;
                        setSwapQuery(query);
                        setSwapResults([]);
                        setSwapBusy(query.trim().length >= 2);
                        setSwapError("");
                      }} placeholder="Try rice, paneer, dosa…" /></label>
                      {swapQuery.trim().length >= 2 && swapBusy ? <small role="status">Searching…</small> : null}
                      {swapQuery.trim().length >= 2 && swapError ? <small className="form-error" role="alert">{swapError}</small> : null}
                      {!swapBusy && swapQuery.trim().length >= 2 && !availableSwapResults.length && !swapError ? <small>No matching reviewed or personal foods. Add it to your catalog first.</small> : null}
                      {availableSwapResults.length ? <ul aria-label="Matching foods">{availableSwapResults.map((food) => <li key={`${food.source}:${food.id}`}>
                        <button type="button" onClick={() => swapItem(target, food)}><span><strong>{food.name}</strong><small>{food.source === "personal" ? "Your food" : "Shared catalog"} · {Math.round(food.caloriesKcalPer100g)} kcal per 100 g</small></span><span aria-hidden="true">↗</span></button>
                      </li>)}</ul> : null}
                    </div> : null}
                  </li>;
                })}
              </ul>
            </article>)}
          </div>
        </div> : null}

        {draft ? <div className="meal-plan-actions">
          {dirty ? <button className="button button-secondary" type="button" disabled={busy || saveVersionConflict} onClick={() => void saveDraft()}>{busy ? "Saving…" : "Save draft edits"}</button> : null}
          <button className="button button-secondary" type="button" disabled={busy || dirty} onClick={() => void decide("reject")}>Reject draft</button>
          <button className="button button-primary" type="button" disabled={busy || dirty} onClick={() => void decide("approve")}>{busy ? "Saving…" : "Approve plan"}</button>
        </div> : null}
        {dirty ? <p className="field-note">Save changes before approving.</p> : null}
      </div> : null}

      {activePlan && !draft ? <div className="panel meal-plan-create meal-plan-create-compact"><div><strong>Create a revision</strong><span>The approved plan stays active until you approve the new draft.</span></div><label className="field"><span>First day</span><input type="date" value={planStartDate} min={startDate} onChange={(event) => setPlanStartDate(event.target.value)} /></label><button className="button button-primary" type="button" disabled={busy} onClick={() => void generatePlan()}>{busy ? "Building…" : "Create draft"}</button></div> : null}

      {history.length ? <details className="meal-plan-history"><summary>Past meal plans <span>{history.length}</span></summary><div>{history.map((plan) => <article key={plan.id}><strong>{plan.data.name}</strong><span>Version {plan.version} · {plan.status === "archived" ? "Archived" : "Replaced"} · {dateLabel(plan.data.startDate, { month: "short", day: "numeric", year: "numeric" })}</span></article>)}</div></details> : null}
      {error ? <div className="meal-plan-error" role="alert"><p>{error}</p>{saveVersionConflict ? <button className="text-button" type="button" disabled={busy} onClick={() => void reloadSavedDraft()}>Discard local edits and reload the saved draft</button> : null}</div> : null}
      {notice ? <p className="form-message" role="status">{notice}</p> : null}
      <details className="settings-info"><summary>Dietary information</summary><p>Check ingredients for allergies. Food labels and preparation can vary.</p></details>
    </section>
  );
}
