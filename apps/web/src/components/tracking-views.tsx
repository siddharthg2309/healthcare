"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { WorkoutExercise } from "@healthcare/contracts";
import { exerciseCatalog } from "@healthcare/domain";
import {
  postJson,
  requestJson,
} from "@/lib/api";

export type FoodOption = {
  id: string;
  name: string;
  category: string;
  source: "shared_catalog" | "personal";
  sourceNote: string;
  reviewed: boolean;
  caloriesKcalPer100g: number;
  proteinGPer100g: number;
  carbohydrateGPer100g: number;
  fatGPer100g: number;
};

export type FoodLog = {
  id: string;
  version: number;
  data: {
    foodId: string;
    foodSource: "shared_catalog" | "personal";
    foodName: string;
    category: string;
    occurredAt: string;
    mealType: "breakfast" | "lunch" | "dinner" | "snack";
    quantityGrams: number;
    nutritionPer100g: { caloriesKcal: number; proteinG: number; carbohydrateG: number; fatG: number };
    nutritionTotal: { caloriesKcal: number; proteinG: number; carbohydrateG: number; fatG: number };
  };
};

export type ActivityLog = {
  id: string;
  version: number;
  data: {
    activityType: "steps" | "walk" | "cardio" | "strength" | "other";
    occurredAt: string;
    durationMinutes: number | null;
    steps: number | null;
    notes: string | null;
    workoutTitle?: string;
    exercises?: WorkoutExercise[];
  };
};

export type DaySummary = {
  date: string;
  timezone: string;
  foodLogs: FoodLog[];
  activityLogs: ActivityLog[];
  foodTotals: { caloriesKcal: number; proteinG: number; carbohydrateG: number; fatG: number };
  steps: number;
  workoutsCompleted: number;
  foodDayComplete: boolean;
};

function emptyDaySummary(date: string, timezone: string): DaySummary {
  return {
    date,
    timezone,
    foodLogs: [],
    activityLogs: [],
    foodTotals: { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
    steps: 0,
    workoutsCompleted: 0,
    foodDayComplete: false,
  };
}

type Props = { day: DaySummary; onSaved: () => Promise<void> };

const meals = ["breakfast", "lunch", "dinner", "snack"] as const;
const categories = ["ingredient", "prepared_meal", "snack", "beverage", "restaurant", "other"] as const;
const poundsPerKilogram = 2.20462262185;

function dateTimeLocalNow(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toLocalInput(value: string): string {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function dateTimeForDay(date: string, today: string): string {
  return date === today ? dateTimeLocalNow() : `${date}T12:00`;
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(value);
}

function foodLabel(food: FoodOption): string {
  return food.source === "personal" ? "Your food" : food.reviewed ? "Reviewed catalog" : "Catalog entry";
}

export function FoodTrackingView({ day, onSaved }: Props) {
  const [query, setQuery] = useState("");
  const [foods, setFoods] = useState<FoodOption[]>([]);
  const [selectedFood, setSelectedFood] = useState<FoodOption | null>(null);
  const [quantity, setQuantity] = useState("100");
  const [mealType, setMealType] = useState<(typeof meals)[number]>("lunch");
  const [occurredAt, setOccurredAt] = useState(dateTimeLocalNow);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [message, setMessage] = useState("");
  const [showCustomFood, setShowCustomFood] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void requestJson<{ foods: FoodOption[] }>(`/v1/foods?query=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => setFoods(response.foods))
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError(caught instanceof Error ? caught.message : "Could not search foods.");
        })
        .finally(() => setLoading(false));
    }, query ? 180 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const quantityGrams = Number(quantity);
  const preview = useMemo(() => {
    if (!selectedFood || !Number.isFinite(quantityGrams) || quantityGrams <= 0) return null;
    const factor = quantityGrams / 100;
    return {
      calories: Math.round(selectedFood.caloriesKcalPer100g * factor),
      protein: selectedFood.proteinGPer100g * factor,
      carbs: selectedFood.carbohydrateGPer100g * factor,
      fat: selectedFood.fatGPer100g * factor,
    };
  }, [quantityGrams, selectedFood]);

  async function saveFood(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFood || !preview) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await postJson("/v1/food-logs", {
        logId: globalThis.crypto.randomUUID(),
        foodId: selectedFood.id,
        occurredAt: new Date(occurredAt).toISOString(),
        mealType,
        quantityGrams,
      });
      setMessage("Food entry saved.");
      setSelectedFood(null);
      setQuantity("100");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this food entry.");
    } finally {
      setBusy(false);
    }
  }

  function customFoodCreated(food: FoodOption) {
    setFoods((current) => [food, ...current.filter((item) => item.id !== food.id)]);
    setSelectedFood(food);
    setQuery(food.name);
    setShowCustomFood(false);
    setMessage("Personal food saved. Check the label values before logging.");
  }

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">FOOD TRACKING</span><h1>Log what you ate</h1><p>Choose a food, enter its weight, and review the nutrition before saving.</p></div>
        <span className="date-chip">{day.date}</span>
      </div>
      <section className="tracking-grid">
        <div className="panel food-entry-panel">
          <div className="panel-heading"><div><span className="eyebrow">ADD A FOOD</span><h2>Search your catalog</h2></div><span className="panel-symbol">◉</span></div>
          <label className="field" htmlFor="food-search"><span>Food name</span><input id="food-search" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedFood(null); }} placeholder="Try dosa, rice, paneer…" autoComplete="off" /></label>
          {loading ? <p className="muted-copy">Searching your foods…</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {!loading && foods.length ? <div className="food-results" role="listbox" aria-label="Food search results">
            {foods.map((food) => <button type="button" className={selectedFood?.id === food.id ? "food-result food-result-selected" : "food-result"} key={food.id} onClick={() => { setSelectedFood(food); setMessage(""); }}>
              <span className="food-result-main"><strong>{food.name}</strong><small>{food.category.replaceAll("_", " ")} · {foodLabel(food)}</small></span>
              <span className="food-result-kcal">{formatNumber(food.caloriesKcalPer100g)}<small> kcal / 100 g</small></span>
            </button>)}
          </div> : null}
          {!loading && !foods.length && !error ? <div className="empty-inline"><strong>No match yet</strong><span>Add it as a personal food from its nutrition label or recipe.</span></div> : null}
          <button type="button" className="text-button add-custom-trigger" onClick={() => setShowCustomFood((current) => !current)}>{showCustomFood ? "Close personal food form" : "＋ Add a personal food"}</button>
          {showCustomFood ? <CustomFoodForm onCreated={customFoodCreated} onCancel={() => setShowCustomFood(false)} /> : null}

          {selectedFood ? <form className="selected-food-form" onSubmit={(event) => void saveFood(event)}>
            <div className="selected-food-heading"><div><span className="eyebrow">SELECTED FOOD</span><strong>{selectedFood.name}</strong></div><button type="button" className="quiet-button" onClick={() => setSelectedFood(null)}>Change</button></div>
            <p className="source-note">{selectedFood.reviewed ? "Reviewed" : "Not reviewed"} · {selectedFood.sourceNote}</p>
            <div className="form-grid">
              <label className="field"><span>Quantity (grams)</span><input type="number" min="1" max="5000" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
              <label className="field"><span>Meal</span><select value={mealType} onChange={(event) => setMealType(event.target.value as (typeof meals)[number])}>{meals.map((meal) => <option key={meal} value={meal}>{meal[0].toUpperCase() + meal.slice(1)}</option>)}</select></label>
              <label className="field"><span>Date and time</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label>
            </div>
            {preview ? <div className="nutrition-preview"><strong>{formatNumber(preview.calories)} kcal</strong><span>Protein {formatNumber(preview.protein, 1)} g</span><span>Carbs {formatNumber(preview.carbs, 1)} g</span><span>Fat {formatNumber(preview.fat, 1)} g</span></div> : null}
            {message ? <p className="form-message" role="status">{message}</p> : null}
            <button className="button button-primary" type="submit" disabled={busy || !preview}>{busy ? "Saving…" : "Add to food log"}</button>
          </form> : message ? <p className="form-message" role="status">{message}</p> : null}
          <p className="source-note">Nutrition is calculated from the food’s per-100 g values and the quantity you enter. Household portions can vary.</p>
        </div>

        <DailyFoodPanel day={day} onChanged={onSaved} />
      </section>
    </>
  );
}

function CustomFoodForm({ onCreated, onCancel }: { onCreated: (food: FoodOption) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("prepared_meal");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await postJson<{ food: FoodOption }>("/v1/foods/custom", {
        foodId: globalThis.crypto.randomUUID(),
        name,
        category,
        caloriesKcalPer100g: Number(calories),
        proteinGPer100g: Number(protein),
        carbohydrateGPer100g: Number(carbs),
        fatGPer100g: Number(fat),
        sourceNote,
      });
      onCreated(response.food);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this personal food.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="custom-food-form" onSubmit={(event) => void submit(event)}>
    <div><span className="eyebrow">PERSONAL FOOD</span><h3>Add nutrition per 100 g</h3></div>
    <label className="field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
    <label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number])}>{categories.map((item) => <option value={item} key={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
    <div className="form-grid form-grid-four">
      <label className="field"><span>Calories</span><input type="number" min="0" max="1000" step="0.1" value={calories} onChange={(event) => setCalories(event.target.value)} required /></label>
      <label className="field"><span>Protein (g)</span><input type="number" min="0" max="100" step="0.1" value={protein} onChange={(event) => setProtein(event.target.value)} required /></label>
      <label className="field"><span>Carbs (g)</span><input type="number" min="0" max="100" step="0.1" value={carbs} onChange={(event) => setCarbs(event.target.value)} required /></label>
      <label className="field"><span>Fat (g)</span><input type="number" min="0" max="100" step="0.1" value={fat} onChange={(event) => setFat(event.target.value)} required /></label>
    </div>
    <label className="field"><span>Where did these values come from?</span><input value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={160} placeholder="Package label, recipe, or estimate" required /></label>
    <p className="source-note">Personal foods are visible only in your account and are not marked as reviewed.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="button-row"><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save food"}</button><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function DailyFoodPanel({ day, onChanged }: { day: DaySummary; onChanged: () => Promise<void> }) {
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");

  async function toggleComplete() {
    setStatusBusy(true);
    setStatusError("");
    try {
      await requestJson(`/v1/days/${day.date}/food-status`, {
        method: "PUT",
        body: JSON.stringify({ complete: !day.foodDayComplete }),
      });
      await onChanged();
    } catch (caught) {
      setStatusError(caught instanceof Error ? caught.message : "Could not update this day.");
    } finally {
      setStatusBusy(false);
    }
  }

  return <section className="panel daily-log-panel">
    <div className="panel-heading"><div><span className="eyebrow">TODAY · {day.date}</span><h2>Food log</h2></div><span className="count-badge">{day.foodLogs.length}</span></div>
    <div className="daily-calorie-total"><strong>{formatNumber(day.foodTotals.caloriesKcal)}</strong><span>kcal logged</span></div>
    <div className="daily-macro-grid"><span>Protein<strong>{formatNumber(day.foodTotals.proteinG, 1)} g</strong></span><span>Carbs<strong>{formatNumber(day.foodTotals.carbohydrateG, 1)} g</strong></span><span>Fat<strong>{formatNumber(day.foodTotals.fatG, 1)} g</strong></span></div>
    {day.foodLogs.length ? <div className="daily-entry-list">{[...day.foodLogs].reverse().map((item) => <FoodLogEntry key={`${item.id}:${item.version}`} item={item} onChanged={onChanged} />)}</div> : <div className="empty-inline"><strong>{day.foodDayComplete ? "No food logged today" : "No food logged yet"}</strong><span>{day.foodDayComplete ? "You confirmed this as a complete day with no entries." : "Log a meal, or mark the day complete if you had no food to record."}</span></div>}
    <div className="food-day-status">
      <span className={day.foodDayComplete ? "food-day-status-complete" : "food-day-status-incomplete"}>{day.foodDayComplete ? "Day complete" : "Logs may be partial"}</span>
      <button type="button" className="quiet-button" onClick={() => void toggleComplete()} disabled={statusBusy} aria-pressed={day.foodDayComplete}>{statusBusy ? "Saving…" : day.foodDayComplete ? "Mark incomplete" : "Mark day complete"}</button>
    </div>
    {statusError ? <p className="form-error" role="alert">{statusError}</p> : null}
    <p className="source-note">Totals include only entries you logged. Completion records whether tracking for this day is finished.</p>
  </section>;
}

function FoodLogEntry({ item, onChanged }: { item: FoodLog; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(String(item.data.quantityGrams));
  const [mealType, setMealType] = useState(item.data.mealType);
  const [occurredAt, setOccurredAt] = useState(toLocalInput(item.data.occurredAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestJson(`/v1/food-logs/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          baseVersion: item.version,
          quantityGrams: Number(quantity),
          mealType,
          occurredAt: new Date(occurredAt).toISOString(),
        }),
      });
      setEditing(false);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this food entry.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${item.data.foodName} from this food log?`)) return;
    setBusy(true);
    setError("");
    try {
      await requestJson(`/v1/food-logs/${item.id}`, {
        method: "DELETE",
        body: JSON.stringify({ baseVersion: item.version }),
      });
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this food entry.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="food-log-entry">
    <div className="daily-entry">
      <span className="meal-badge">{item.data.mealType.slice(0, 1).toUpperCase()}</span>
      <span className="daily-entry-main"><strong>{item.data.foodName}</strong><small>{item.data.mealType} · {formatNumber(item.data.quantityGrams)} g · {formatClock(item.data.occurredAt)}</small></span>
      <strong>{formatNumber(item.data.nutritionTotal.caloriesKcal)}<small> kcal</small></strong>
      <div className="entry-actions"><button type="button" className="quiet-button" onClick={() => { setError(""); setEditing((current) => !current); }} disabled={busy}>{editing ? "Close" : "Edit"}</button><button type="button" className="quiet-button entry-delete" onClick={() => void remove()} disabled={busy}>Delete</button></div>
    </div>
    {editing ? <form className="food-log-edit" onSubmit={(event) => void save(event)}>
      <div className="form-grid">
        <label className="field"><span>Quantity (grams)</span><input type="number" min="1" max="5000" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
        <label className="field"><span>Meal</span><select value={mealType} onChange={(event) => setMealType(event.target.value as (typeof meals)[number])}>{meals.map((meal) => <option key={meal} value={meal}>{meal[0].toUpperCase() + meal.slice(1)}</option>)}</select></label>
        <label className="field"><span>Date and time</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-secondary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
    </form> : error ? <p className="form-error entry-error" role="alert">{error}</p> : null}
  </div>;
}

type ExerciseDraft = { exerciseId: string | null; exerciseName: string; sets: Array<{ reps: string; loadKg: string }> };

function emptyExercise(): ExerciseDraft {
  return { exerciseId: null, exerciseName: "", sets: [{ reps: "", loadKg: "" }] };
}

export function ActivityTrackingView({ day, unitSystem, onSaved }: Props & { unitSystem: "metric" | "imperial" }) {
  const [viewDate, setViewDate] = useState(day.date);
  const [loadedHistoryDay, setLoadedHistoryDay] = useState<DaySummary>(day);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [activityType, setActivityType] = useState<ActivityLog["data"]["activityType"]>("steps");
  const [occurredAt, setOccurredAt] = useState(dateTimeLocalNow);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [steps, setSteps] = useState("");
  const [notes, setNotes] = useState("");
  const [workoutTitle, setWorkoutTitle] = useState("");
  const [exercises, setExercises] = useState<ExerciseDraft[]>([emptyExercise()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const historyRequestId = useRef(0);

  async function selectHistoryDay(date: string) {
    setViewDate(date);
    setHistoryError("");
    const requestId = ++historyRequestId.current;
    if (date === day.date) {
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    try {
      const summary = await requestJson<DaySummary>(`/v1/days/${date}`);
      if (requestId === historyRequestId.current) setLoadedHistoryDay(summary);
    } catch (caught) {
      if (requestId === historyRequestId.current) setHistoryError(caught instanceof Error ? caught.message : "Could not load this day.");
    } finally {
      if (requestId === historyRequestId.current) setHistoryLoading(false);
    }
  }

  const viewDay = viewDate === day.date
    ? day
    : loadedHistoryDay.date === viewDate
      ? loadedHistoryDay
      : emptyDaySummary(viewDate, day.timezone);

  const workoutIsReady = workoutTitle.trim().length > 0 && exercises.length > 0 && exercises.every((exercise) =>
    exercise.exerciseName.trim().length > 0 && exercise.sets.length > 0 && exercise.sets.every((set) => {
      const reps = Number(set.reps);
      const load = set.loadKg.trim() ? Number(set.loadKg) : null;
      const loadKg = load === null ? null : unitSystem === "imperial" ? load / poundsPerKilogram : load;
      return Number.isInteger(reps) && reps >= 1 && reps <= 200 && (loadKg === null || (Number.isFinite(loadKg) && loadKg >= 0 && loadKg <= 1000));
    }),
  );
  const totalSets = exercises.reduce((total, exercise) => total + exercise.sets.length, 0);

  function updateExercise(index: number, update: (exercise: ExerciseDraft) => ExerciseDraft) {
    setExercises((current) => current.map((exercise, exerciseIndex) => exerciseIndex === index ? update(exercise) : exercise));
  }

  function resetForm() {
    setEditingId(null);
    setEditingVersion(null);
    setActivityType("steps");
    setOccurredAt(dateTimeForDay(viewDate, day.date));
    setDurationMinutes("");
    setSteps("");
    setNotes("");
    setWorkoutTitle("");
    setExercises([emptyExercise()]);
  }

  function beginEdit(item: ActivityLog) {
    setEditingId(item.id);
    setEditingVersion(item.version);
    setActivityType(item.data.activityType);
    setOccurredAt(toLocalInput(item.data.occurredAt));
    setDurationMinutes(item.data.durationMinutes === null ? "" : String(item.data.durationMinutes));
    setSteps(item.data.steps === null ? "" : String(item.data.steps));
    setNotes(item.data.notes ?? "");
    setWorkoutTitle(item.data.workoutTitle ?? "Strength session");
    setExercises(item.data.exercises?.map((exercise) => ({
      exerciseId: exercise.exerciseId ?? null,
      exerciseName: exercise.exerciseName,
      sets: exercise.sets.map((set) => ({
        reps: String(set.reps),
        loadKg: set.loadKg === null ? "" : String(unitSystem === "imperial" ? set.loadKg * poundsPerKilogram : set.loadKg),
      })),
    })) ?? [emptyExercise()]);
    setMessage("");
    setError("");
  }

  async function removeActivity(item: ActivityLog) {
    const name = item.data.workoutTitle ?? item.data.activityType;
    if (!window.confirm(`Delete ${name} from this activity log?`)) return;
    setDeletingId(item.id);
    setError("");
    try {
      await requestJson(`/v1/activity-logs/${item.id}`, {
        method: "DELETE",
        body: JSON.stringify({ baseVersion: item.version }),
      });
      if (editingId === item.id) resetForm();
      await onSaved();
      if (viewDate !== day.date) await selectHistoryDay(viewDate);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this activity.");
    } finally {
      setDeletingId(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = {
        activityType,
        occurredAt: new Date(occurredAt).toISOString(),
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
        steps: activityType === "strength" ? null : steps ? Number(steps) : null,
        notes: notes.trim() || null,
        ...(activityType === "strength" ? {
          workoutTitle: workoutTitle.trim(),
          exercises: exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.exerciseName.trim(),
            sets: exercise.sets.map((set) => {
              const load = set.loadKg.trim() ? Number(set.loadKg) : null;
              return { reps: Number(set.reps), loadKg: load === null ? null : unitSystem === "imperial" ? load / poundsPerKilogram : load };
            }),
          })),
        } : {}),
      };
      if (editingId && editingVersion !== null) {
        await requestJson(`/v1/activity-logs/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({ baseVersion: editingVersion, ...data }),
        });
        resetForm();
        setMessage("Activity updated.");
      } else {
        await postJson("/v1/activity-logs", { activityId: globalThis.crypto.randomUUID(), ...data });
        setDurationMinutes("");
        setSteps("");
        setNotes("");
        if (activityType === "strength") {
          setWorkoutTitle("");
          setExercises([emptyExercise()]);
        }
        setMessage(activityType === "strength" ? "Workout saved." : "Activity saved.");
      }
      await onSaved();
      if (viewDate !== day.date) await selectHistoryDay(viewDate);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this activity.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">ACTIVITY TRACKING</span><h1>Record your movement</h1><p>Enter steps or a workout. Health Connect is not available in this web app.</p></div><span className="date-chip">{viewDate}</span></div>
    <section className="tracking-grid">
      <form className="panel activity-entry-panel" onSubmit={(event) => void submit(event)}>
        <div className="panel-heading"><div><span className="eyebrow">{editingId ? "EDIT ENTRY" : "ADD AN ENTRY"}</span><h2>{editingId ? "Edit activity" : viewDate === day.date ? "Today’s activity" : "Activity for this day"}</h2></div><span className="panel-symbol">↗</span></div>
        <div className="form-grid">
          <label className="field"><span>Activity</span><select value={activityType} onChange={(event) => setActivityType(event.target.value as ActivityLog["data"]["activityType"])}><option value="steps">Steps</option><option value="walk">Walk</option><option value="cardio">Cardio</option><option value="strength">Strength session</option><option value="other">Other</option></select></label>
          <label className="field"><span>Date and time</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label>
        </div>
        {activityType === "strength" ? <>
          <label className="field"><span>Workout name</span><input value={workoutTitle} onChange={(event) => setWorkoutTitle(event.target.value)} maxLength={100} placeholder="e.g. Upper body" required /></label>
          <label className="field"><span>Duration (minutes · optional)</span><input type="number" min="1" max="1440" step="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} placeholder="How long you trained" /></label>
          <div className="workout-exercise-builder">
            {exercises.map((exercise, exerciseIndex) => {
              const catalogExercise = exercise.exerciseId ? exerciseCatalog.find((candidate) => candidate.id === exercise.exerciseId) : undefined;
              return <article className="workout-exercise-card" key={exerciseIndex}>
              <div className="workout-exercise-heading"><strong>Exercise {exerciseIndex + 1}</strong>{exercises.length > 1 ? <button type="button" className="quiet-button entry-delete" onClick={() => setExercises((current) => current.filter((_, index) => index !== exerciseIndex))}>Remove</button> : null}</div>
              <label className="field"><span>Exercise</span><input list="exercise-library" value={exercise.exerciseName} onChange={(event) => {
                const value = event.target.value;
                const match = exerciseCatalog.find((candidate) => candidate.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
                updateExercise(exerciseIndex, (current) => ({ ...current, exerciseId: match?.id ?? null, exerciseName: match?.name ?? value }));
              }} maxLength={100} placeholder="Search or enter an exercise" required /></label>
              {catalogExercise ? <p className="source-note">{catalogExercise.movementPattern} · {catalogExercise.primaryMuscles.join(", ")} · {catalogExercise.equipment.length ? catalogExercise.equipment.join(", ") : "no added equipment"}</p> : null}
              <div className="workout-set-list">{exercise.sets.map((set, setIndex) => <div className="workout-set-row" key={setIndex}>
                <span className="set-number">Set {setIndex + 1}</span>
                <label className="field"><span>Reps</span><input type="number" min="1" max="200" step="1" value={set.reps} onChange={(event) => updateExercise(exerciseIndex, (current) => ({ ...current, sets: current.sets.map((item, index) => index === setIndex ? { ...item, reps: event.target.value } : item) }))} required /></label>
                <label className="field"><span>Load ({unitSystem === "imperial" ? "lb" : "kg"})</span><input type="number" min="0" max={unitSystem === "imperial" ? 2204.62 : 1000} step="0.5" value={set.loadKg} onChange={(event) => updateExercise(exerciseIndex, (current) => ({ ...current, sets: current.sets.map((item, index) => index === setIndex ? { ...item, loadKg: event.target.value } : item) }))} placeholder="Bodyweight or none" /></label>
                {exercise.sets.length > 1 ? <button type="button" className="quiet-button entry-delete" onClick={() => updateExercise(exerciseIndex, (current) => ({ ...current, sets: current.sets.filter((_, index) => index !== setIndex) }))}>Remove set</button> : null}
              </div>)}</div>
              <button type="button" className="text-button" disabled={exercise.sets.length >= 20 || totalSets >= 100} onClick={() => updateExercise(exerciseIndex, (current) => ({ ...current, sets: [...current.sets, { reps: "", loadKg: "" }] }))}>＋ Add set</button>
              </article>;
            })}
            <datalist id="exercise-library">{exerciseCatalog.map((exercise) => <option key={exercise.id} value={exercise.name} />)}</datalist>
            <button type="button" className="button button-secondary" disabled={exercises.length >= 20 || totalSets >= 100} onClick={() => setExercises((current) => [...current, emptyExercise()])}>＋ Add exercise</button>
          </div>
        </> : <div className="form-grid">
          <label className="field"><span>Duration (minutes)</span><input type="number" min="1" max="1440" step="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} placeholder="Optional" /></label>
          <label className="field"><span>Steps</span><input type="number" min="0" max="200000" step="1" value={steps} onChange={(event) => setSteps(event.target.value)} placeholder={activityType === "steps" ? "Required for step entry" : "Optional"} required={activityType === "steps"} /></label>
        </div>}
        <label className="field"><span>Notes</span><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Optional details" /></label>
        <p className="source-note">{activityType === "strength" ? "Strength sessions save each exercise, set, rep count, and optional load. Calories burned are not estimated." : "Steps and duration are entered manually. Calories burned are not estimated."}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {message ? <p className="form-message" role="status">{message}</p> : null}
        <div className="activity-form-actions">
          <button className="button button-primary" disabled={busy || (activityType === "strength" ? !workoutIsReady : activityType === "steps" ? !steps : !durationMinutes && !steps)}>{busy ? "Saving…" : editingId ? "Save changes" : activityType === "strength" ? "Save workout" : "Save activity"}</button>
          {editingId ? <button type="button" className="button button-secondary" onClick={resetForm} disabled={busy}>Cancel edit</button> : null}
        </div>
      </form>
      <section className="panel daily-log-panel">
        <div className="panel-heading"><div><span className="eyebrow">MOVEMENT · {viewDate}</span><h2>Activity history</h2></div><span className="count-badge">{viewDay.activityLogs.length}</span></div>
        <label className="field"><span>Choose a day</span><input type="date" value={viewDate} max={day.date} onChange={(event) => {
          const nextDate = event.target.value;
          if (!nextDate) return;
          void selectHistoryDay(nextDate);
          setError("");
          setMessage("");
          if (editingId) resetForm();
          setOccurredAt(dateTimeForDay(nextDate, day.date));
        }} /></label>
        <div className="daily-calorie-total"><strong>{formatNumber(viewDay.steps)}</strong><span>manual steps logged</span></div>
        <p className="muted-copy">{viewDay.workoutsCompleted} walk, cardio, or strength sessions logged.</p>
        {historyError ? <p className="form-error" role="alert">{historyError}</p> : null}
        {historyLoading ? <p className="muted-copy" role="status">Loading activity history…</p> : viewDay.activityLogs.length ? <div className="daily-entry-list">{[...viewDay.activityLogs].reverse().map((item) => {
          const title = item.data.workoutTitle ?? (item.data.activityType === "steps" ? "Step count" : item.data.activityType[0].toUpperCase() + item.data.activityType.slice(1));
          const exerciseDetails = item.data.exercises?.map((exercise) => `${exercise.exerciseName} (${exercise.sets.map((set) => `${set.reps} reps${set.loadKg === null ? "" : ` @ ${formatNumber(unitSystem === "imperial" ? set.loadKg * poundsPerKilogram : set.loadKg, 1)} ${unitSystem === "imperial" ? "lb" : "kg"}`}`).join(", ")})`).join(" · ");
          return <div className="daily-entry" key={item.id}>
            <span className="meal-badge">↗</span>
            <span className="daily-entry-main"><strong>{title}</strong><small>{formatClock(item.data.occurredAt)}{item.data.durationMinutes ? ` · ${item.data.durationMinutes} min` : ""}{exerciseDetails ? ` · ${exerciseDetails}` : ""}{item.data.notes ? ` · ${item.data.notes}` : ""}</small></span>
            {item.data.steps !== null ? <strong>{formatNumber(item.data.steps)}<small> steps</small></strong> : null}
            <div className="entry-actions">
              <button type="button" className="quiet-button" onClick={() => editingId === item.id ? resetForm() : beginEdit(item)} disabled={busy || deletingId !== null}>{editingId === item.id ? "Editing" : "Edit"}</button>
              <button type="button" className="quiet-button entry-delete" onClick={() => void removeActivity(item)} disabled={busy || deletingId !== null}>{deletingId === item.id ? "Deleting…" : "Delete"}</button>
            </div>
          </div>;
        })}</div> : <div className="empty-inline"><strong>No activity logged on this day</strong><span>Choose another date or add an entry for this day.</span></div>}
      </section>
    </section>
  </>;
}
