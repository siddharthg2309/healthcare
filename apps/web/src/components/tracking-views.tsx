"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  data: {
    activityType: "steps" | "walk" | "cardio" | "strength" | "other";
    occurredAt: string;
    durationMinutes: number | null;
    steps: number | null;
    notes: string | null;
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

type Props = { day: DaySummary; onSaved: () => Promise<void> };

const meals = ["breakfast", "lunch", "dinner", "snack"] as const;
const categories = ["ingredient", "prepared_meal", "snack", "beverage", "restaurant", "other"] as const;

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

export function ActivityTrackingView({ day, onSaved }: Props) {
  const [activityType, setActivityType] = useState<ActivityLog["data"]["activityType"]>("steps");
  const [occurredAt, setOccurredAt] = useState(dateTimeLocalNow);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [steps, setSteps] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await postJson("/v1/activity-logs", {
        activityId: globalThis.crypto.randomUUID(),
        activityType,
        occurredAt: new Date(occurredAt).toISOString(),
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
        steps: steps ? Number(steps) : null,
        notes: notes.trim() || null,
      });
      setDurationMinutes("");
      setSteps("");
      setNotes("");
      setMessage("Activity saved.");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this activity.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">ACTIVITY TRACKING</span><h1>Record your movement</h1><p>Enter steps or a workout. Health Connect is not available in this web app.</p></div><span className="date-chip">{day.date}</span></div>
    <section className="tracking-grid">
      <form className="panel activity-entry-panel" onSubmit={(event) => void submit(event)}>
        <div className="panel-heading"><div><span className="eyebrow">ADD AN ENTRY</span><h2>Today’s activity</h2></div><span className="panel-symbol">↗</span></div>
        <div className="form-grid">
          <label className="field"><span>Activity</span><select value={activityType} onChange={(event) => setActivityType(event.target.value as ActivityLog["data"]["activityType"])}><option value="steps">Steps</option><option value="walk">Walk</option><option value="cardio">Cardio</option><option value="strength">Strength workout</option><option value="other">Other</option></select></label>
          <label className="field"><span>Date and time</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label>
          <label className="field"><span>Duration (minutes)</span><input type="number" min="1" max="1440" step="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} placeholder="Optional" /></label>
          <label className="field"><span>Steps</span><input type="number" min="0" max="200000" step="1" value={steps} onChange={(event) => setSteps(event.target.value)} placeholder={activityType === "steps" ? "Required for step entry" : "Optional"} required={activityType === "steps"} /></label>
        </div>
        <label className="field"><span>Notes</span><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Optional details" /></label>
        <p className="source-note">This release records steps and duration. It does not estimate calories burned.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {message ? <p className="form-message" role="status">{message}</p> : null}
        <button className="button button-primary" disabled={busy || (activityType === "steps" ? !steps : !durationMinutes && !steps)}>{busy ? "Saving…" : "Save activity"}</button>
      </form>
      <section className="panel daily-log-panel">
        <div className="panel-heading"><div><span className="eyebrow">TODAY · {day.date}</span><h2>Movement log</h2></div><span className="count-badge">{day.activityLogs.length}</span></div>
        <div className="daily-calorie-total"><strong>{formatNumber(day.steps)}</strong><span>manual steps logged</span></div>
        <p className="muted-copy">{day.workoutsCompleted} walking/cardio/strength entries logged.</p>
        {day.activityLogs.length ? <div className="daily-entry-list">{[...day.activityLogs].reverse().map((item) => <div className="daily-entry" key={item.id}>
          <span className="meal-badge">↗</span>
          <span className="daily-entry-main"><strong>{item.data.activityType === "steps" ? "Step count" : item.data.activityType[0].toUpperCase() + item.data.activityType.slice(1)}</strong><small>{formatClock(item.data.occurredAt)}{item.data.durationMinutes ? ` · ${item.data.durationMinutes} min` : ""}{item.data.notes ? ` · ${item.data.notes}` : ""}</small></span>
          {item.data.steps !== null ? <strong>{formatNumber(item.data.steps)}<small> steps</small></strong> : null}
        </div>)}</div> : <div className="empty-inline"><strong>No activity logged yet</strong><span>Log steps or a workout when you’re ready.</span></div>}
      </section>
    </section>
  </>;
}
