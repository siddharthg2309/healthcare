"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  FoodPhotoRecognitionRequest,
  FoodPhotoRecognitionResponse,
  CopyFoodLogsRequest,
  WorkoutExercise,
} from "@healthcare/contracts";
import { exerciseCatalog, findExerciseById, workoutTemplates } from "@healthcare/domain";
import type { WorkoutPlanSession, WorkoutPlanVersion } from "@healthcare/contracts";
import {
  ApiError,
  postJson,
  requestJson,
} from "@/lib/api";
import { MealPlansPanel } from "./meal-plans-panel";
import { WorkoutPlansPanel } from "./workout-plans-panel";

export type FoodOption = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  source: "shared_catalog" | "personal";
  isFavorite: boolean;
  sourceNote: string;
  reviewed: boolean;
  caloriesKcalPer100g: number;
  proteinGPer100g: number;
  carbohydrateGPer100g: number;
  fatGPer100g: number;
  recipe?: {
    yieldGrams: number;
    instructions?: string[];
    ingredients: Array<{
      foodId: string;
      foodSource: "shared_catalog" | "personal";
      foodName: string;
      quantityGrams: number;
      nutritionPer100g: { caloriesKcal: number; proteinG: number; carbohydrateG: number; fatG: number };
    }>;
  } | null;
  recipeVersion?: number | null;
};

type FoodPortion = { id: string; label: string; grams: number };
type PortionState = { key: string | null; portions: FoodPortion[]; loading: boolean; error: string };

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
    portionLabel?: string | null;
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
    plannedSession?: { planId: string; planVersion: number; weekday: number; label: string };
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

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

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

async function prepareFoodPhoto(file: File): Promise<FoodPhotoRecognitionRequest> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 20_000_000) throw new Error("Choose a photo smaller than 20 MB.");

  const bitmap = await createImageBitmap(file);
  try {
    let maxEdge = 1440;
    let quality = 0.82;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the photo.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const compressed = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });
      if (!compressed) throw new Error("This browser could not prepare the photo.");
      if (compressed.size <= 2_500_000) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("This browser could not read the photo."));
          reader.onerror = () => reject(new Error("This browser could not read the photo."));
          reader.readAsDataURL(compressed);
        });
        return { mimeType: "image/jpeg", base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
      }
      maxEdge = Math.round(maxEdge * 0.78);
      quality = Math.max(0.5, quality - 0.1);
    }
  } finally {
    bitmap.close();
  }
  throw new Error("The photo is still too large after compression. Choose another photo.");
}

export function FoodTrackingView({ day, onSaved }: Props) {
  const [foodView, setFoodView] = useState<"log" | "plan">("log");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [foodFilter, setFoodFilter] = useState<"all" | "favorites" | "recent">("all");
  const [searchRevision, setSearchRevision] = useState(0);
  const [foods, setFoods] = useState<FoodOption[]>([]);
  const [selectedFood, setSelectedFood] = useState<FoodOption | null>(null);
  const [selectedPortionId, setSelectedPortionId] = useState<string | null>(null);
  const [portionState, setPortionState] = useState<PortionState>({ key: null, portions: [], loading: false, error: "" });
  const [portionLabel, setPortionLabel] = useState("");
  const [portionBusy, setPortionBusy] = useState(false);
  const [quantity, setQuantity] = useState("100");
  const [mealType, setMealType] = useState<(typeof meals)[number]>("lunch");
  const [occurredAt, setOccurredAt] = useState(dateTimeLocalNow);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState<Record<string, boolean>>({});

  const [message, setMessage] = useState("");
  const [showCustomFood, setShowCustomFood] = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);
  const [recipeToEdit, setRecipeToEdit] = useState<FoodOption | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoResult, setPhotoResult] = useState<FoodPhotoRecognitionResponse | null>(null);
  const selectedFoodId = selectedFood?.id ?? null;
  const selectedFoodSource = selectedFood?.source ?? null;
  const selectedFoodKey = selectedFoodId && selectedFoodSource ? `${selectedFoodSource}:${selectedFoodId}` : null;
  const portions = selectedFoodKey && portionState.key === selectedFoodKey ? portionState.portions : [];
  const portionLoading = Boolean(selectedFoodKey) && portionState.key !== selectedFoodKey;
  const portionError = selectedFoodKey && portionState.key === selectedFoodKey ? portionState.error : "";

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ query });
      if (foodFilter !== "all") params.set("view", foodFilter);
      void requestJson<{ foods: FoodOption[] }>(`/v1/foods?${params.toString()}`, { signal: controller.signal })
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
  }, [foodFilter, query, searchRevision]);

  useEffect(() => {
    if (!selectedFoodId || !selectedFoodSource) return;
    const controller = new AbortController();
    const key = `${selectedFoodSource}:${selectedFoodId}`;
    const update = (portionsForFood: FoodPortion[], error = "") => {
      setPortionState({ key, portions: portionsForFood, loading: false, error });
    };
    void requestJson<{ portions: FoodPortion[] }>(
      `/v1/foods/${encodeURIComponent(selectedFoodId)}/portions?source=${selectedFoodSource}`,
      { signal: controller.signal },
    ).then((response) => update(response.portions)).catch((caught: unknown) => {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      update([], caught instanceof Error ? caught.message : "Could not load saved portions.");
    });
    return () => controller.abort();
  }, [selectedFoodId, selectedFoodSource]);

  async function recognizePhoto(file: File) {
    setPhotoBusy(true);
    setPhotoError("");
    setPhotoResult(null);
    try {
      const image = await prepareFoodPhoto(file);
      const result = await postJson<FoodPhotoRecognitionResponse>("/v1/foods/recognize-photo", image);
      setPhotoResult(result);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "ai_not_configured") {
        setPhotoError("Photo suggestions need the OpenRouter key in the server environment.");
      } else if (caught instanceof ApiError && caught.code === "ai_rate_limited") {
        setPhotoError("The AI service is busy. Try again shortly or search by name.");
      } else {
        setPhotoError(caught instanceof Error ? caught.message : "Could not recognize this photo.");
      }
    } finally {
      setPhotoBusy(false);
    }
  }

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
        portionId: selectedPortionId,
        occurredAt: new Date(occurredAt).toISOString(),
        mealType,
        quantityGrams,
      });
      setMessage("Food entry saved.");
      selectFood(null);
      setQuantity("100");
      setSearchRevision((current) => current + 1);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this food entry.");
    } finally {
      setBusy(false);
    }
  }

  function selectCreatedFood(food: FoodOption, savedMessage: string) {
    setFoods((current) => [food, ...current.filter((item) => item.id !== food.id)]);
    selectFood(food);
    setQuery(food.name);
    setShowCustomFood(false);
    setShowRecipe(false);
    setMessage(savedMessage);
  }

  function customFoodCreated(food: FoodOption) {
    selectCreatedFood(food, "Personal food saved. Check the source values before logging.");
  }

  function recipeCreated(food: FoodOption) {
    selectCreatedFood(food, food.recipeVersion && food.recipeVersion > 1
      ? `Recipe updated as version ${food.recipeVersion}; earlier versions remain available.`
      : "Recipe saved with nutrition calculated from its ingredients and finished weight.");
    setRecipeToEdit(null);
  }

  function selectFood(food: FoodOption | null) {
    setSelectedFood(food);
    setSelectedPortionId(null);
    setPortionLabel("");
  }

  async function toggleFavorite(food: FoodOption) {
    const favorite = !food.isFavorite;
    const key = `${food.source}:${food.id}`;
    setFavoriteError("");
    setFavoriteBusy((current) => ({ ...current, [key]: true }));
    try {
      await requestJson(`/v1/foods/${encodeURIComponent(food.id)}/favorite`, {
        method: "PUT",
        body: JSON.stringify({ foodSource: food.source, favorite }),
      });
      setFoods((current) => current.flatMap((item) => {
        if (item.id !== food.id || item.source !== food.source) return [item];
        return foodFilter === "favorites" && !favorite ? [] : [{ ...item, isFavorite: favorite }];
      }));
      setSelectedFood((current) => current?.id === food.id && current.source === food.source
        ? { ...current, isFavorite: favorite }
        : current);
    } catch (caught) {
      setFavoriteError(caught instanceof Error ? caught.message : "Could not update this favorite.");
    } finally {
      setFavoriteBusy((current) => ({ ...current, [key]: false }));
    }
  }

  async function savePortion() {
    if (!selectedFood) return;
    const foodKey = `${selectedFood.source}:${selectedFood.id}`;
    const grams = Number(quantity);
    if (!portionLabel.trim() || !Number.isInteger(grams) || grams < 1 || grams > 5000) {
      setPortionState((current) => ({
        key: foodKey,
        portions: current.key === foodKey ? current.portions : [],
        loading: false,
        error: "Enter a portion name and a whole-number gram amount from 1 to 5,000.",
      }));
      return;
    }
    setPortionBusy(true);
    try {
      const response = await postJson<{ portion: FoodPortion }>(
        `/v1/foods/${encodeURIComponent(selectedFood.id)}/portions`,
        { foodSource: selectedFood.source, label: portionLabel.trim(), grams },
      );
      setPortionState((current) => ({
        key: foodKey,
        portions: [...(current.key === foodKey ? current.portions : []), response.portion]
          .sort((left, right) => left.label.localeCompare(right.label)),
        loading: false,
        error: "",
      }));
      setSelectedPortionId(response.portion.id);
      setPortionLabel("");
    } catch (caught) {
      setPortionState((current) => ({
        key: foodKey,
        portions: current.key === foodKey ? current.portions : [],
        loading: false,
        error: caught instanceof Error ? caught.message : "Could not save this portion.",
      }));
    } finally {
      setPortionBusy(false);
    }
  }

  async function deletePortion(portion: FoodPortion) {
    if (!selectedFood) return;
    const foodKey = `${selectedFood.source}:${selectedFood.id}`;
    setPortionBusy(true);
    try {
      await requestJson(`/v1/foods/${encodeURIComponent(selectedFood.id)}/portions/${encodeURIComponent(portion.id)}`, { method: "DELETE" });
      setPortionState((current) => ({
        key: foodKey,
        portions: current.key === foodKey ? current.portions.filter((item) => item.id !== portion.id) : [],
        loading: false,
        error: "",
      }));
      if (selectedPortionId === portion.id) setSelectedPortionId(null);
    } catch (caught) {
      setPortionState((current) => ({
        key: foodKey,
        portions: current.key === foodKey ? current.portions : [],
        loading: false,
        error: caught instanceof Error ? caught.message : "Could not remove this portion.",
      }));
    } finally {
      setPortionBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">FOOD TRACKING</span><h1>{foodView === "log" ? "Log what you ate" : "Plan your week"}</h1><p>{foodView === "log" ? "Choose a food, enter its weight, and review the nutrition before saving." : "Build a week around your accepted target, then review it before approval."}</p></div>
        <span className="date-chip">{day.date}</span>
      </div>
      <div className="food-section-switch" role="tablist" aria-label="Food tools">
        <button type="button" role="tab" aria-selected={foodView === "log"} className={foodView === "log" ? "food-section-tab food-section-tab-active" : "food-section-tab"} onClick={() => setFoodView("log")}>Food log</button>
        <button type="button" role="tab" aria-selected={foodView === "plan"} className={foodView === "plan" ? "food-section-tab food-section-tab-active" : "food-section-tab"} onClick={() => setFoodView("plan")}>Meal plan</button>
      </div>
      {foodView === "plan" ? <MealPlansPanel startDate={day.date} /> : null}
      {foodView === "log" ? <section className="tracking-grid">
        <div className="panel food-entry-panel">
          <div className="panel-heading"><div><span className="eyebrow">ADD A FOOD</span><h2>Search your catalog</h2></div><span className="panel-symbol">◉</span></div>
          <label className="field" htmlFor="food-search"><span>Food name</span><input id="food-search" value={query} onChange={(event) => { setQuery(event.target.value); selectFood(null); }} placeholder="Try dosa, rice, paneer…" autoComplete="off" /></label>
          <div className="food-search-filters" role="group" aria-label="Filter food search results">
            {(["all", "favorites", "recent"] as const).map((filter) => <button type="button" key={filter} aria-pressed={foodFilter === filter} className={foodFilter === filter ? "food-filter-active" : ""} onClick={() => setFoodFilter(filter)}>
              {filter === "all" ? "All foods" : filter === "favorites" ? "Favorites" : "Recent"}
            </button>)}
          </div>
          <section className="photo-lookup" aria-labelledby="photo-lookup-title">
            <div className="photo-lookup-copy">
              <strong id="photo-lookup-title">Identify food from a photo</strong>
              <span>Get name suggestions, then choose a catalog entry and enter the amount.</span>
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void recognizePhoto(file);
              }}
            />
            <button
              className="button button-secondary photo-pick-button"
              type="button"
              disabled={photoBusy}
              onClick={() => photoInputRef.current?.click()}
            >
              {photoBusy ? "Checking photo…" : "Take or choose a photo"}
            </button>
            <p className="source-note">The photo is sent to the AI provider for food-name suggestions. It is not added to your food log.</p>
            {photoBusy ? <p className="photo-status" role="status">Looking for visible foods…</p> : null}
            {photoError ? <p className="form-error" role="alert">{photoError}</p> : null}
            {photoResult ? <div className="photo-suggestions" aria-live="polite">
              {photoResult.note ? <p className="source-note">{photoResult.note}</p> : null}
              {photoResult.candidates.length ? photoResult.candidates.map((candidate) => (
                <div className="photo-candidate" key={candidate.name}>
                  <span className="eyebrow">SUGGESTED NAME</span>
                  <div className="photo-candidate-choices">
                    {[candidate.name, ...candidate.alternatives].map((name, index) => (
                      <button
                        type="button"
                        key={name}
                        className={index === 0 ? "photo-candidate-primary" : ""}
                        onClick={() => {
                          setQuery(name);
                          selectFood(null);
                          setMessage("");
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )) : <div className="empty-inline"><strong>No clear food match</strong><span>Search the catalog by name or try another photo.</span></div>}
              <p className="source-note">Photo suggestions do not estimate quantity or nutrition. Confirm the food and amount before saving.</p>
            </div> : null}
          </section>
          {loading ? <p className="muted-copy">Searching your foods…</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {favoriteError ? <p className="form-error" role="alert">{favoriteError}</p> : null}
          {!loading && foods.length ? <div className="food-results" role="list" aria-label="Food search results">
            {foods.map((food) => {
              const key = `${food.source}:${food.id}`;
              const selected = selectedFood?.id === food.id && selectedFood.source === food.source;
              return <div className={selected ? "food-result food-result-selected" : "food-result"} role="listitem" key={key}>
                <button type="button" className="food-result-select" aria-pressed={selected} onClick={() => { selectFood(food); setMessage(""); }}>
                  <span className="food-result-main"><strong>{food.name}</strong><small>{food.category.replaceAll("_", " ")} · {foodLabel(food)}{food.aliases.length ? ` · ${food.aliases.join(", ")}` : ""}</small></span>
                  <span className="food-result-kcal">{formatNumber(food.caloriesKcalPer100g)}<small> kcal / 100 g</small></span>
                </button>
                <button type="button" className="food-favorite-toggle" aria-pressed={food.isFavorite} aria-label={food.isFavorite ? `Remove ${food.name} from favorites` : `Add ${food.name} to favorites`} disabled={favoriteBusy[key]} onClick={() => void toggleFavorite(food)}>
                  {favoriteBusy[key] ? "…" : food.isFavorite ? "★" : "☆"}
                </button>
              </div>;
            })}
          </div> : null}
          {!loading && !foods.length && !error ? <div className="empty-inline"><strong>{foodFilter === "favorites" ? "No favorites match" : foodFilter === "recent" ? "No recent foods match" : "No match yet"}</strong><span>{foodFilter === "favorites" ? "Star foods from All foods to keep them here." : foodFilter === "recent" ? "Foods you log will appear here for quick access." : "Add it as a personal food from its nutrition label or recipe."}</span></div> : null}
          <div className="food-create-actions">
            <button type="button" className="text-button add-custom-trigger" onClick={() => { setShowCustomFood((current) => !current); setShowRecipe(false); }}>{showCustomFood ? "Close personal food form" : "＋ Add a personal food"}</button>
            <button type="button" className="text-button add-custom-trigger" onClick={() => { const next = !showRecipe; setShowRecipe(next); setRecipeToEdit(null); setShowCustomFood(false); }}>{showRecipe ? "Close recipe builder" : "＋ Build a recipe"}</button>
          </div>
          {showCustomFood ? <CustomFoodForm onCreated={customFoodCreated} onCancel={() => setShowCustomFood(false)} /> : null}
          {showRecipe ? <RecipeComposer key={recipeToEdit?.id ?? "new-recipe"} initialRecipe={recipeToEdit ?? undefined} onCreated={recipeCreated} onCancel={() => { setShowRecipe(false); setRecipeToEdit(null); }} /> : null}

          {selectedFood ? <form className="selected-food-form" onSubmit={(event) => void saveFood(event)}>
            <div className="selected-food-heading"><div><span className="eyebrow">SELECTED FOOD</span><strong>{selectedFood.name}</strong></div><button type="button" className="quiet-button" onClick={() => selectFood(null)}>Change</button></div>
            <p className="source-note">{selectedFood.reviewed ? "Reviewed" : "Not reviewed"} · {selectedFood.sourceNote}{selectedFood.aliases.length ? ` · Also called ${selectedFood.aliases.join(", ")}` : ""}</p>
            {selectedFood.recipe ? <details className="recipe-details">
              <summary>Recipe · {selectedFood.recipeVersion ? `version ${selectedFood.recipeVersion} · ` : ""}{selectedFood.recipe.ingredients.length} ingredients · {formatNumber(selectedFood.recipe.yieldGrams)} g finished</summary>
              <ul>{selectedFood.recipe.ingredients.map((ingredient, index) => <li key={`${ingredient.foodSource}:${ingredient.foodId}:${index}`}><span>{ingredient.foodName}</span><strong>{formatNumber(ingredient.quantityGrams)} g</strong></li>)}</ul>
              {selectedFood.recipe.instructions?.length ? <ol className="recipe-instructions">{selectedFood.recipe.instructions.map((instruction, index) => <li key={`${index}:${instruction}`}>{instruction}</li>)}</ol> : <p className="source-note">No cooking instructions saved.</p>}
              <RecipeHistoryPanel key={`${selectedFood.id}:${selectedFood.recipeVersion ?? 1}`} foodId={selectedFood.id} />
              <button type="button" className="button button-secondary recipe-edit-button" onClick={() => { setRecipeToEdit(selectedFood); setShowRecipe(true); setShowCustomFood(false); }}>Edit recipe</button>
            </details> : null}
            <div className="form-grid">
              <label className="field"><span>Quantity (grams)</span><input type="number" min="1" max="5000" step="1" value={quantity} onChange={(event) => { setQuantity(event.target.value); setSelectedPortionId(null); }} required /></label>
              <label className="field"><span>Meal</span><select value={mealType} onChange={(event) => setMealType(event.target.value as (typeof meals)[number])}>{meals.map((meal) => <option key={meal} value={meal}>{meal[0].toUpperCase() + meal.slice(1)}</option>)}</select></label>
              <label className="field"><span>Date and time</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label>
            </div>
            {portions.length ? <div className="food-portion-list" role="group" aria-label="Saved household portions">
              {portions.map((portion) => <div className="food-portion-chip" key={portion.id}>
                <button type="button" aria-pressed={selectedPortionId === portion.id} onClick={() => { setQuantity(String(portion.grams)); setSelectedPortionId(portion.id); }}>{portion.label}<small>{portion.grams} g</small></button>
                <button type="button" className="food-portion-remove" aria-label={`Remove ${portion.label} portion`} disabled={portionBusy} onClick={() => void deletePortion(portion)}>×</button>
              </div>)}
            </div> : null}
            {portionLoading ? <p className="muted-copy">Loading your saved portions…</p> : null}
            <div className="food-portion-save">
              <label className="field"><span>Save this gram amount as a portion</span><input value={portionLabel} onChange={(event) => setPortionLabel(event.target.value)} maxLength={40} placeholder="1 katori, 1 medium roti…" /></label>
              <button type="button" className="button button-secondary" disabled={portionBusy || portions.length >= 20 || !portionLabel.trim()} onClick={() => void savePortion()}>{portionBusy ? "Saving…" : `Save ${quantity || "this amount"} g`}</button>
            </div>
            {portionError ? <p className="form-error" role="alert">{portionError}</p> : null}
            {preview ? <div className="nutrition-preview"><strong>{formatNumber(preview.calories)} kcal</strong><span>Protein {formatNumber(preview.protein, 1)} g</span><span>Carbs {formatNumber(preview.carbs, 1)} g</span><span>Fat {formatNumber(preview.fat, 1)} g</span></div> : null}
            {message ? <p className="form-message" role="status">{message}</p> : null}
            <button className="button button-primary" type="submit" disabled={busy || !preview}>{busy ? "Saving…" : "Add to food log"}</button>
          </form> : message ? <p className="form-message" role="status">{message}</p> : null}
          <p className="source-note">Nutrition is calculated from the food’s per-100 g values and the quantity you enter. Household portions can vary.</p>
        </div>

        <DailyFoodPanel day={day} onChanged={onSaved} />
      </section> : null}
    </>
  );
}

function CustomFoodForm({ onCreated, onCancel }: { onCreated: (food: FoodOption) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
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
        aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
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
    <label className="field"><span>Also called (comma-separated)</span><input value={aliases} onChange={(event) => setAliases(event.target.value)} maxLength={800} placeholder="dosai, thosai" /></label>
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

type RecipeIngredientDraft = { food: FoodOption; quantityGrams: number };

type RecipeHistoryItem = {
  version: number;
  createdAt: string;
  snapshot: {
    name: string;
    caloriesKcalPer100g: number;
    proteinGPer100g: number;
    carbohydrateGPer100g: number;
    fatGPer100g: number;
    recipe: NonNullable<FoodOption["recipe"]>;
  };
};

function RecipeHistoryPanel({ foodId }: { foodId: string }) {
  const [open, setOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<RecipeHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState("");

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (loaded || loadingHistory) return;
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const response = await requestJson<{ versions: RecipeHistoryItem[] }>(`/v1/foods/recipes/${foodId}/versions`);
      setHistory(response.versions);
      setLoaded(true);
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : "Could not load recipe history.");
    } finally {
      setLoadingHistory(false);
    }
  }

  return <div className="recipe-history">
    <button type="button" className="quiet-button" aria-expanded={open} onClick={() => void toggle()}>{open ? "Hide version history" : "View version history"}</button>
    {open ? loadingHistory ? <p className="source-note">Loading saved versions…</p> : historyError ? <p className="form-error" role="alert">{historyError}</p> : <ol>{history.map((item) => <li key={item.version}>
      <strong>Version {item.version} · {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(item.createdAt))}</strong>
      <span>{item.snapshot.name} · {formatNumber(item.snapshot.caloriesKcalPer100g)} kcal / 100 g · {item.snapshot.recipe.ingredients.length} ingredients</span>
    </li>)}</ol> : null}
  </div>;
}

function RecipeComposer({ initialRecipe, onCreated, onCancel }: { initialRecipe?: FoodOption; onCreated: (food: FoodOption) => void; onCancel: () => void }) {
  const [name, setName] = useState(() => initialRecipe?.name ?? "");
  const [aliases, setAliases] = useState(() => initialRecipe?.aliases.join(", ") ?? "");
  const [instructions, setInstructions] = useState(() => initialRecipe?.recipe?.instructions?.join("\n") ?? "");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FoodOption[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [selectedIngredient, setSelectedIngredient] = useState<FoodOption | null>(null);
  const [ingredientGrams, setIngredientGrams] = useState("100");
  const [ingredients, setIngredients] = useState<RecipeIngredientDraft[]>(() => (initialRecipe?.recipe?.ingredients ?? []).map((ingredient) => ({
    food: {
      id: ingredient.foodId,
      name: ingredient.foodName,
      aliases: [],
      category: "ingredient",
      source: ingredient.foodSource,
      isFavorite: false,
      sourceNote: "Saved recipe ingredient",
      reviewed: false,
      caloriesKcalPer100g: ingredient.nutritionPer100g.caloriesKcal,
      proteinGPer100g: ingredient.nutritionPer100g.proteinG,
      carbohydrateGPer100g: ingredient.nutritionPer100g.carbohydrateG,
      fatGPer100g: ingredient.nutritionPer100g.fatG,
    },
    quantityGrams: ingredient.quantityGrams,
  })));
  const [yieldGrams, setYieldGrams] = useState(() => initialRecipe?.recipe ? String(initialRecipe.recipe.yieldGrams) : "");
  const [recipeId, setRecipeId] = useState<string | null>(initialRecipe?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const yieldWeight = Number(yieldGrams);
  const preview = useMemo(() => {
    const ingredientWeight = ingredients.reduce((sum, ingredient) => sum + ingredient.quantityGrams, 0);
    if (ingredients.length < 2 || !Number.isInteger(yieldWeight) || yieldWeight < 1 || yieldWeight > 50000 || yieldWeight > ingredientWeight) return null;
    const totals = ingredients.reduce((sum, ingredient) => ({
      caloriesKcal: sum.caloriesKcal + ingredient.food.caloriesKcalPer100g * ingredient.quantityGrams / 100,
      proteinG: sum.proteinG + ingredient.food.proteinGPer100g * ingredient.quantityGrams / 100,
      carbohydrateG: sum.carbohydrateG + ingredient.food.carbohydrateGPer100g * ingredient.quantityGrams / 100,
      fatG: sum.fatG + ingredient.food.fatGPer100g * ingredient.quantityGrams / 100,
    }), { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });
    return {
      caloriesKcal: totals.caloriesKcal * 100 / yieldWeight,
      proteinG: totals.proteinG * 100 / yieldWeight,
      carbohydrateG: totals.carbohydrateG * 100 / yieldWeight,
      fatG: totals.fatG * 100 / yieldWeight,
    };
  }, [ingredients, yieldWeight]);

  async function search() {
    if (!query.trim()) return;
    setSearchBusy(true);
    setError("");
    try {
      const response = await requestJson<{ foods: FoodOption[] }>(`/v1/foods?${new URLSearchParams({ query: query.trim() }).toString()}`);
      setSearchResults(response.foods);
      if (!response.foods.length) setError("No matching catalog foods. Add the ingredient as a personal food first.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not search ingredients.");
    } finally {
      setSearchBusy(false);
    }
  }

  function addIngredient() {
    const grams = Number(ingredientGrams);
    if (!selectedIngredient || !Number.isInteger(grams) || grams < 1 || grams > 5000) {
      setError("Choose an ingredient and enter a whole-number amount from 1 to 5,000 g.");
      return;
    }
    if (ingredients.length >= 20) {
      setError("A recipe can contain up to 20 ingredient entries.");
      return;
    }
    setIngredients((current) => [...current, { food: selectedIngredient, quantityGrams: grams }]);
    setSelectedIngredient(null);
    setIngredientGrams("100");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || ingredients.length < 2) return;
    setBusy(true);
    setError("");
    try {
      const stableRecipeId = recipeId ?? globalThis.crypto.randomUUID();
      setRecipeId(stableRecipeId);
      const payload = {
        name,
        aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
        yieldGrams: yieldWeight,
        instructions: instructions.split(/\r?\n/).map((instruction) => instruction.trim()).filter(Boolean),
        ingredients: ingredients.map((ingredient) => ({
          foodId: ingredient.food.id,
          foodSource: ingredient.food.source,
          quantityGrams: ingredient.quantityGrams,
        })),
      };
      const response = initialRecipe
        ? await requestJson<{ food: FoodOption }>(`/v1/foods/recipes/${initialRecipe.id}`, {
          method: "PUT",
          body: JSON.stringify({ ...payload, baseVersion: initialRecipe.recipeVersion ?? 1 }),
        })
        : await postJson<{ food: FoodOption }>("/v1/foods/recipes", { ...payload, recipeId: stableRecipeId });
      onCreated(response.food);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this recipe.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="custom-food-form recipe-composer" onSubmit={(event) => void submit(event)}>
    <div><span className="eyebrow">PERSONAL RECIPE</span><h3>{initialRecipe ? `Edit ${initialRecipe.name}` : "Build nutrition from ingredients"}</h3></div>
    <label className="field"><span>Recipe name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
    <label className="field"><span>Also called (comma-separated)</span><input value={aliases} onChange={(event) => setAliases(event.target.value)} maxLength={800} placeholder="home-style, family name" /></label>
    <div className="recipe-ingredient-search">
      <label className="field"><span>Find an ingredient</span><input value={query} onChange={(event) => { setQuery(event.target.value); setSearchResults([]); setSelectedIngredient(null); }} maxLength={80} placeholder="Search rice, oil, onion…" /></label>
      <button type="button" className="button button-secondary" onClick={() => void search()} disabled={searchBusy || !query.trim()}>{searchBusy ? "Searching…" : "Search foods"}</button>
    </div>
    {searchResults.length ? <div className="food-results recipe-candidates" role="list" aria-label="Ingredient search results">
      {searchResults.slice(0, 8).map((food) => <button type="button" className="food-result-select" role="listitem" key={`${food.source}:${food.id}`} onClick={() => { setSelectedIngredient(food); setError(""); }}>
        <span className="food-result-main"><strong>{food.name}</strong><small>{food.source === "shared_catalog" ? food.sourceNote : "Personal food"}{food.reviewed ? " · reviewed" : " · not reviewed"}</small></span>
        <span className="food-result-kcal">{formatNumber(food.caloriesKcalPer100g)}<small> kcal / 100 g</small></span>
      </button>)}
    </div> : null}
    {selectedIngredient ? <div className="recipe-ingredient-add">
      <p className="muted-copy">Selected: <strong>{selectedIngredient.name}</strong></p>
      <label className="field"><span>Amount (grams)</span><input type="number" min="1" max="5000" step="1" value={ingredientGrams} onChange={(event) => setIngredientGrams(event.target.value)} /></label>
      <button type="button" className="button button-secondary" onClick={addIngredient} disabled={ingredients.length >= 20}>Add ingredient</button>
    </div> : null}
    {ingredients.length ? <div className="recipe-ingredient-list" aria-label="Recipe ingredients">
      {ingredients.map((ingredient, index) => <div className="recipe-ingredient-row" key={`${ingredient.food.source}:${ingredient.food.id}:${index}`}>
        <span><strong>{ingredient.food.name}</strong><small>{ingredient.food.source === "shared_catalog" ? ingredient.food.sourceNote : "Personal food"}</small></span>
        <span>{formatNumber(ingredient.quantityGrams)} g</span>
        <button type="button" className="quiet-button entry-delete" aria-label={`Remove ${ingredient.food.name}`} onClick={() => setIngredients((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
      </div>)}
    </div> : null}
    <label className="field"><span>Cooking steps (one per line, optional)</span><textarea rows={4} maxLength={9000} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Add the cooking steps you want to remember…" /></label>
    <label className="field"><span>Finished recipe weight (grams)</span><input type="number" min="1" max="50000" step="1" value={yieldGrams} onChange={(event) => setYieldGrams(event.target.value)} required /></label>
    <p className="source-note">Include added water and oil as ingredients. The finished weight cannot exceed the combined ingredient weight.</p>
    {preview ? <div className="nutrition-preview"><strong>{formatNumber(preview.caloriesKcal)} kcal / 100 g</strong><span>Protein {formatNumber(preview.proteinG, 1)} g</span><span>Carbs {formatNumber(preview.carbohydrateG, 1)} g</span><span>Fat {formatNumber(preview.fatG, 1)} g</span></div> : null}
    <p className="source-note">Nutrition is calculated from the selected foods and the finished recipe weight. Cooking and water loss can change actual values.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="button-row"><button className="button button-primary" disabled={busy || ingredients.length < 2 || !preview}>{busy ? "Saving…" : initialRecipe ? "Save new version" : "Save recipe"}</button><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function DailyFoodPanel({ day, onChanged }: { day: DaySummary; onChanged: () => Promise<void> }) {
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceDateOverride, setCopySourceDateOverride] = useState<string | null>(null);
  const copySourceDate = copySourceDateOverride && copySourceDateOverride <= day.date
    ? copySourceDateOverride
    : shiftDate(day.date, -1);
  const [copyMealType, setCopyMealType] = useState<(typeof meals)[number]>("breakfast");
  const [copySourceResult, setCopySourceResult] = useState<{ date: string; summary: DaySummary | null; error: string }>({ date: "", summary: null, error: "" });
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [pendingCopy, setPendingCopy] = useState<CopyFoodLogsRequest | null>(null);
  const copySourceBusy = copyOpen && copySourceResult.date !== copySourceDate;
  const copySourceDay = copySourceResult.date === copySourceDate ? copySourceResult.summary : null;
  const copyLoadError = copySourceResult.date === copySourceDate ? copySourceResult.error : "";

  useEffect(() => {
    if (!copyOpen || !copySourceDate) return;
    let active = true;
    void requestJson<DaySummary>(`/v1/days/${copySourceDate}`)
      .then((summary) => { if (active) setCopySourceResult({ date: copySourceDate, summary, error: "" }); })
      .catch((caught) => { if (active) setCopySourceResult({ date: copySourceDate, summary: null, error: caught instanceof Error ? caught.message : "Could not load that day's meals." }); });
    return () => { active = false; };
  }, [copyOpen, copySourceDate]);

  const copyEntries = (copySourceDay?.foodLogs ?? []).filter((item) => item.data.mealType === copyMealType);

  async function copyMeal() {
    if (!copyEntries.length || copyEntries.length > 20 || copyBusy) return;
    const retryPayload = pendingCopy
      && pendingCopy.sourceDate === copySourceDate
      && pendingCopy.targetDate === day.date
      && pendingCopy.mealType === copyMealType
      ? pendingCopy
      : null;
    const payload = retryPayload ?? {
      sourceDate: copySourceDate,
      targetDate: day.date,
      mealType: copyMealType,
      entries: copyEntries.map((item) => ({ sourceLogId: item.id, logId: window.crypto.randomUUID() })),
    };
    setPendingCopy(payload);
    setCopyBusy(true);
    setCopyError("");
    try {
      await postJson("/v1/food-logs/copy", payload);
      setPendingCopy(null);
      setCopyOpen(false);
      await onChanged();
    } catch (caught) {
      setCopyError(caught instanceof Error ? caught.message : "Could not copy this meal.");
    } finally {
      setCopyBusy(false);
    }
  }

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
    <div className="copy-meal-tools">
      <button type="button" className="button button-secondary" onClick={() => { setCopyOpen((open) => !open); setCopyError(""); }} aria-expanded={copyOpen}>{copyOpen ? "Close meal copy" : "Copy a previous meal"}</button>
      {copyOpen ? <div className="copy-meal-panel">
        <div className="form-grid">
          <label className="field"><span>Copy from</span><input type="date" required value={copySourceDate} max={day.date} onChange={(event) => { if (event.target.value) { setCopySourceDateOverride(event.target.value); setPendingCopy(null); } }} /></label>
          <label className="field"><span>Meal</span><select value={copyMealType} onChange={(event) => { setCopyMealType(event.target.value as (typeof meals)[number]); setPendingCopy(null); }}>{meals.map((meal) => <option key={meal} value={meal}>{meal[0].toUpperCase() + meal.slice(1)}</option>)}</select></label>
        </div>
        {copySourceBusy ? <p className="source-note">Loading meals…</p> : copyLoadError ? <p className="form-error" role="alert">{copyLoadError}</p> : copySourceDay ? copyEntries.length ? <div className="copy-meal-preview"><span>{copyEntries.length} {copyEntries.length === 1 ? "item" : "items"} · {formatNumber(copyEntries.reduce((sum, item) => sum + item.data.nutritionTotal.caloriesKcal, 0))} kcal</span><ul>{copyEntries.map((item) => <li key={item.id}>{item.data.foodName} · {formatNumber(item.data.quantityGrams)} g</li>)}</ul></div> : <p className="source-note">No {copyMealType} entries on {copySourceDate}.</p> : null}
        {copyEntries.length > 20 ? <p className="form-error" role="alert">This meal has too many items to copy at once.</p> : null}
        {copyError ? <p className="form-error" role="alert">{copyError}</p> : null}
        <button type="button" className="button button-primary" onClick={() => void copyMeal()} disabled={copyBusy || copySourceBusy || !copyEntries.length || copyEntries.length > 20}>{copyBusy ? "Copying…" : `Copy ${copyEntries.length || "meal"} ${copyEntries.length === 1 ? "item" : "items"} to ${day.date}`}</button>
      </div> : null}
    </div>
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
      <span className="daily-entry-main"><strong>{item.data.foodName}</strong><small>{item.data.mealType} · {formatNumber(item.data.quantityGrams)} g{item.data.portionLabel ? ` (${item.data.portionLabel})` : ""} · {formatClock(item.data.occurredAt)}</small></span>
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

type ExerciseDraft = {
  exerciseId: string | null;
  exerciseName: string;
  trackingMode: "reps" | "time";
  sets: Array<{ reps: string; durationSeconds: string; loadKg: string }>;
};

function emptyExercise(): ExerciseDraft {
  return { exerciseId: null, exerciseName: "", trackingMode: "reps", sets: [{ reps: "", durationSeconds: "", loadKg: "" }] };
}

export function ActivityTrackingView({ day, unitSystem, equipment, onSaved }: Props & { unitSystem: "metric" | "imperial"; equipment: string[] }) {
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
  const [plannedSession, setPlannedSession] = useState<ActivityLog["data"]["plannedSession"]>(undefined);
  const [exercises, setExercises] = useState<ExerciseDraft[]>([emptyExercise()]);
  const [templateId, setTemplateId] = useState(workoutTemplates[0]?.id ?? "");
  const [templateSessionIndex, setTemplateSessionIndex] = useState(0);
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
      if (exercise.trackingMode === "time") {
        const seconds = Number(set.durationSeconds);
        return Number.isInteger(seconds) && seconds >= 1 && seconds <= 7200;
      }
      const reps = Number(set.reps);
      const load = set.loadKg.trim() ? Number(set.loadKg) : null;
      const loadKg = load === null ? null : unitSystem === "imperial" ? load / poundsPerKilogram : load;
      return Number.isInteger(reps) && reps >= 1 && reps <= 200 && (loadKg === null || (Number.isFinite(loadKg) && loadKg >= 0 && loadKg <= 1000));
    }),
  );
  const totalSets = exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
  const selectedTemplate = workoutTemplates.find((template) => template.id === templateId) ?? workoutTemplates[0];
  const selectedTemplateSession = selectedTemplate?.sessions[templateSessionIndex] ?? selectedTemplate?.sessions[0];

  function updateExercise(index: number, update: (exercise: ExerciseDraft) => ExerciseDraft) {
    setExercises((current) => current.map((exercise, exerciseIndex) => exerciseIndex === index ? update(exercise) : exercise));
  }

  function applySelectedTemplate() {
    if (!selectedTemplate || !selectedTemplateSession) return;
    setActivityType("strength");
    setPlannedSession(undefined);
    setWorkoutTitle(`${selectedTemplate.name} · ${selectedTemplateSession.label}`);
    setExercises(selectedTemplateSession.exercises.flatMap((target) => {
      const exercise = findExerciseById(target.exerciseId);
      if (!exercise) return [];
      return [{
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        trackingMode: exercise.trackingMode,
        sets: Array.from({ length: target.sets }, () => ({ reps: "", durationSeconds: "", loadKg: "" })),
      }];
    }));
    setMessage("Session loaded. Enter the reps, hold times, and loads you actually complete.");
    setError("");
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
    setPlannedSession(undefined);
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
    setPlannedSession(item.data.plannedSession);
    setExercises(item.data.exercises?.map((exercise) => ({
      exerciseId: exercise.exerciseId ?? null,
      exerciseName: exercise.exerciseName,
      trackingMode: exercise.sets.some((set) => set.durationSeconds !== null && set.durationSeconds !== undefined) ? "time" : "reps",
      sets: exercise.sets.map((set) => ({
        reps: set.reps === null || set.reps === undefined ? "" : String(set.reps),
        durationSeconds: set.durationSeconds === null || set.durationSeconds === undefined ? "" : String(set.durationSeconds),
        loadKg: set.loadKg === null ? "" : String(unitSystem === "imperial" ? set.loadKg * poundsPerKilogram : set.loadKg),
      })),
    })) ?? [emptyExercise()]);
    setMessage("");
    setError("");
  }

  function startPlannedSession(plan: WorkoutPlanVersion, session: WorkoutPlanSession) {
    setEditingId(null);
    setEditingVersion(null);
    setActivityType("strength");
    setOccurredAt(dateTimeForDay(viewDate, day.date));
    setDurationMinutes("");
    setSteps("");
    setNotes("");
    setWorkoutTitle(`${plan.data.name} · ${session.label}`);
    setPlannedSession({ planId: plan.id, planVersion: plan.version, weekday: session.weekday, label: session.label });
    setExercises(session.exercises.flatMap((target) => {
      const exercise = findExerciseById(target.exerciseId);
      if (!exercise) return [];
      return [{
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        trackingMode: exercise.trackingMode,
        sets: Array.from({ length: target.sets }, () => ({ reps: "", durationSeconds: "", loadKg: "" })),
      }];
    }));
    setError("");
    setMessage("Plan targets loaded. Enter what you actually complete; saving links the workout to this plan session.");
    window.requestAnimationFrame(() => document.getElementById("activity-entry-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
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
            return {
              reps: exercise.trackingMode === "reps" ? Number(set.reps) : null,
              durationSeconds: exercise.trackingMode === "time" ? Number(set.durationSeconds) : null,
              loadKg: exercise.trackingMode === "time" || load === null ? null : unitSystem === "imperial" ? load / poundsPerKilogram : load,
            };
            }),
          })),
          ...(plannedSession ? { plannedSession } : {}),
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
    <WorkoutPlansPanel unitSystem={unitSystem} equipment={equipment} onStartSession={startPlannedSession} />
    <section className="tracking-grid">
      <form id="activity-entry-form" className="panel activity-entry-panel" onSubmit={(event) => void submit(event)}>
        <div className="panel-heading"><div><span className="eyebrow">{editingId ? "EDIT ENTRY" : "ADD AN ENTRY"}</span><h2>{editingId ? "Edit activity" : viewDate === day.date ? "Today’s activity" : "Activity for this day"}</h2></div><span className="panel-symbol">↗</span></div>
        <div className="form-grid">
          <label className="field"><span>Activity</span><select value={activityType} onChange={(event) => {
            const next = event.target.value as ActivityLog["data"]["activityType"];
            setActivityType(next);
            if (next !== "strength") setPlannedSession(undefined);
          }}><option value="steps">Steps</option><option value="walk">Walk</option><option value="cardio">Cardio</option><option value="strength">Strength session</option><option value="other">Other</option></select></label>
          <label className="field"><span>Date and time</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></label>
        </div>
        {activityType === "strength" ? <>
          <label className="field"><span>Workout name</span><input value={workoutTitle} onChange={(event) => setWorkoutTitle(event.target.value)} maxLength={100} placeholder="e.g. Upper body" required /></label>
          <label className="field"><span>Duration (minutes · optional)</span><input type="number" min="1" max="1440" step="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} placeholder="How long you trained" /></label>
          {!editingId && selectedTemplate && selectedTemplateSession ? <div className="starter-template-box">
            <div><span className="eyebrow">STARTER SESSION</span><strong>{selectedTemplate.name}</strong><p>{selectedTemplate.summary} About {selectedTemplateSession.estimatedMinutes} minutes · {selectedTemplate.equipment.length ? selectedTemplate.equipment.join(", ") : "no workout equipment"}.</p></div>
            <div className="form-grid">
              <label className="field"><span>Routine</span><select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setTemplateSessionIndex(0); }}>
                {workoutTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select></label>
              <label className="field"><span>Session</span><select value={templateSessionIndex} onChange={(event) => setTemplateSessionIndex(Number(event.target.value))}>
                {selectedTemplate.sessions.map((session, index) => <option key={session.label} value={index}>{session.label}</option>)}
              </select></label>
            </div>
            <ul className="starter-template-list">{selectedTemplateSession.exercises.map((target) => {
              const libraryExercise = findExerciseById(target.exerciseId);
              const range = target.repRange ? `${target.repRange[0]}–${target.repRange[1]} reps` : `${target.durationSecondsRange?.[0]}–${target.durationSecondsRange?.[1]} sec`;
              return <li key={target.exerciseId}><span>{libraryExercise?.name ?? target.exerciseId}</span><small>{target.sets} × {range} · {target.restSeconds}s rest</small></li>;
            })}</ul>
            <button type="button" className="button button-secondary" onClick={applySelectedTemplate}>Load this session</button>
            <p className="field-note">Loading adds blank workout fields. Record what you actually complete; targets are not saved as completed sets.</p>
          </div> : null}
          <div className="workout-exercise-builder">
            {exercises.map((exercise, exerciseIndex) => {
              const catalogExercise = exercise.exerciseId ? exerciseCatalog.find((candidate) => candidate.id === exercise.exerciseId) : undefined;
              const easierAlternative = catalogExercise?.easierAlternativeId ? findExerciseById(catalogExercise.easierAlternativeId) : undefined;
              return <article className="workout-exercise-card" key={exerciseIndex}>
              <div className="workout-exercise-heading"><strong>Exercise {exerciseIndex + 1}</strong>{exercises.length > 1 ? <button type="button" className="quiet-button entry-delete" onClick={() => setExercises((current) => current.filter((_, index) => index !== exerciseIndex))}>Remove</button> : null}</div>
              <label className="field"><span>Exercise</span><input list="exercise-library" value={exercise.exerciseName} onChange={(event) => {
                const value = event.target.value;
                const match = exerciseCatalog.find((candidate) => candidate.name.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
                updateExercise(exerciseIndex, (current) => ({
                  ...current,
                  exerciseId: match?.id ?? null,
                  exerciseName: match?.name ?? value,
                  trackingMode: match?.trackingMode ?? current.trackingMode,
                  sets: match && match.trackingMode !== current.trackingMode
                    ? current.sets.map(() => ({ reps: "", durationSeconds: "", loadKg: "" }))
                    : current.sets,
                }));
              }} maxLength={100} placeholder="Search or enter an exercise" required /></label>
              {catalogExercise ? <div className="exercise-guidance"><p>{catalogExercise.movementPattern} · {catalogExercise.primaryMuscles.join(", ")} · {catalogExercise.equipment.length ? catalogExercise.equipment.join(", ") : "no added equipment"} · typical rest {catalogExercise.typicalRestSeconds}s</p><p>{catalogExercise.techniqueCue}</p>{easierAlternative ? <p>Easier option: {easierAlternative.name}</p> : null}</div> : null}
              <label className="field"><span>Track each set by</span><select value={exercise.trackingMode} onChange={(event) => updateExercise(exerciseIndex, (current) => ({
                ...current,
                trackingMode: event.target.value as ExerciseDraft["trackingMode"],
                sets: current.sets.map(() => ({ reps: "", durationSeconds: "", loadKg: "" })),
              }))}><option value="reps">Reps</option><option value="time">Timed hold</option></select></label>
              <div className="workout-set-list">{exercise.sets.map((set, setIndex) => <div className={`workout-set-row${exercise.trackingMode === "time" ? " workout-set-row-timed" : ""}`} key={setIndex}>
                <span className="set-number">Set {setIndex + 1}</span>
                {exercise.trackingMode === "reps" ? <>
                  <label className="field"><span>Reps</span><input type="number" min="1" max="200" step="1" value={set.reps} onChange={(event) => updateExercise(exerciseIndex, (current) => ({ ...current, sets: current.sets.map((item, index) => index === setIndex ? { ...item, reps: event.target.value } : item) }))} required /></label>
                  <label className="field"><span>Load ({unitSystem === "imperial" ? "lb" : "kg"})</span><input type="number" min="0" max={unitSystem === "imperial" ? 2204.62 : 1000} step="0.5" value={set.loadKg} onChange={(event) => updateExercise(exerciseIndex, (current) => ({ ...current, sets: current.sets.map((item, index) => index === setIndex ? { ...item, loadKg: event.target.value } : item) }))} placeholder="Bodyweight or none" /></label>
                </> : <label className="field"><span>Hold (seconds)</span><input type="number" min="1" max="7200" step="1" value={set.durationSeconds} onChange={(event) => updateExercise(exerciseIndex, (current) => ({ ...current, sets: current.sets.map((item, index) => index === setIndex ? { ...item, durationSeconds: event.target.value } : item) }))} required /></label>}
                {exercise.sets.length > 1 ? <button type="button" className="quiet-button entry-delete" onClick={() => updateExercise(exerciseIndex, (current) => ({ ...current, sets: current.sets.filter((_, index) => index !== setIndex) }))}>Remove set</button> : null}
              </div>)}</div>
              <button type="button" className="text-button" disabled={exercise.sets.length >= 20 || totalSets >= 100} onClick={() => updateExercise(exerciseIndex, (current) => ({ ...current, sets: [...current.sets, { reps: "", durationSeconds: "", loadKg: "" }] }))}>＋ Add set</button>
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
        <p className="source-note">{activityType === "strength" ? "Strength sessions save reps or timed holds, optional load, and your actual session duration. Calories burned are not estimated." : "Steps and duration are entered manually. Calories burned are not estimated."}</p>
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
          const exerciseDetails = item.data.exercises?.map((exercise) => `${exercise.exerciseName} (${exercise.sets.map((set) => {
            if (set.durationSeconds !== null && set.durationSeconds !== undefined) return `${set.durationSeconds} sec`;
            const loadText = set.loadKg === null ? "" : ` @ ${formatNumber(unitSystem === "imperial" ? set.loadKg * poundsPerKilogram : set.loadKg, 1)} ${unitSystem === "imperial" ? "lb" : "kg"}`;
            return `${set.reps ?? 0} reps${loadText}`;
          }).join(", ")})`).join(" · ");
          return <div className="daily-entry" key={item.id}>
            <span className="meal-badge">↗</span>
            <span className="daily-entry-main"><strong>{title}</strong><small>{item.data.plannedSession ? `Plan: ${item.data.plannedSession.label} · ` : ""}{formatClock(item.data.occurredAt)}{item.data.durationMinutes ? ` · ${item.data.durationMinutes} min` : ""}{exerciseDetails ? ` · ${exerciseDetails}` : ""}{item.data.notes ? ` · ${item.data.notes}` : ""}</small></span>
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
