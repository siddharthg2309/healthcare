"use client";

import { useRef, useState, type FormEvent } from "react";
import { confirmFoodPhotoRequestSchema, foodPhotoRecognitionResponseSchema, photoNutritionSchema, type FoodPhotoRecognitionRequest, type FoodPhotoRecognitionResponse, type FoodLogRecord } from "@healthcare/contracts";
import { ApiError, postJson } from "@/lib/api";
import { prepareImage } from "@/lib/prepare-image";
import { AppIcon } from "./app-icon";

type Nutrition = FoodPhotoRecognitionResponse["items"][number]["nutritionPer100g"];
type ReviewItem = { index: number; included: boolean; name: string; minimum: string; maximum: string; certainty: "sure" | "not_sure"; nutrition: Record<keyof Nutrition, string> };
const nutrientFields: Array<{ key: keyof Nutrition; label: string; unit: string }> = [
  { key: "caloriesKcal", label: "Calories", unit: "kcal" }, { key: "proteinG", label: "Protein", unit: "g" },
  { key: "carbohydrateG", label: "Carbs", unit: "g" }, { key: "fatG", label: "Fat", unit: "g" },
];
const number = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value) : "—";

export function FoodEstimateLogger({ defaultMealType, defaultOccurredAt, unmatchedFoodName, onSaved, onReviewChange }: {
  defaultMealType: FoodLogRecord["mealType"]; defaultOccurredAt: string; unmatchedFoodName?: string | null;
  onSaved: () => Promise<void>; onReviewChange: (open: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pendingSave = useRef<{ fingerprint: string; id: string } | null>(null);
  const [textFoodName, setTextFoodName] = useState<string | null>(null);
  const [image, setImage] = useState<FoodPhotoRecognitionRequest | null>(null);
  const [result, setResult] = useState<FoodPhotoRecognitionResponse | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [context, setContext] = useState("");
  const [answer, setAnswer] = useState("");
  const [refinements, setRefinements] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [mealType, setMealType] = useState(defaultMealType);
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function resetReview() {
    setTextFoodName(null); setContext(""); setImage(null); setResult(null); setItems([]); setAnswer(""); setRefinements(0); setAnswers([]);
    pendingSave.current = null; onReviewChange(false);
  }

  function update(index: number, change: Partial<ReviewItem>) {
    setItems((current) => current.map((item) => item.index === index ? { ...item, ...change } : item));
  }

  async function analyze(photo: FoodPhotoRecognitionRequest | null, details: string, foodName?: string) {
    const response = photo
      ? await postJson<unknown>("/v1/foods/recognize-photo", { ...photo, context: details })
      : await postJson<unknown>("/v1/foods/estimate-text", { foodName: foodName ?? textFoodName ?? "", context: details });
    const parsed = foodPhotoRecognitionResponseSchema.safeParse(response);
    if (!parsed.success) throw new Error("Food estimates are not available in this deployment yet. Refresh after deployment.");
    setResult(parsed.data);
    setItems(parsed.data.items.map((item, index) => ({
      index, included: true, name: item.name, minimum: String(item.minimumGrams), maximum: String(item.maximumGrams), certainty: "not_sure",
      nutrition: { caloriesKcal: String(item.nutritionPer100g.caloriesKcal), proteinG: String(item.nutritionPer100g.proteinG), carbohydrateG: String(item.nutritionPer100g.carbohydrateG), fatG: String(item.nutritionPer100g.fatG) },
    })));
    setAnswer(""); pendingSave.current = null;
    onReviewChange(true);
  }

  function reportError(caught: unknown) {
    const messages: Record<string, string> = {
      ai_not_configured: "Food estimates are unavailable. Try manual entry.",
      ai_authentication_failed: "The AI service needs its connection updated.",
      ai_credits_exhausted: "The AI service has no available credits.",
      ai_access_denied: "The AI service cannot process this image.",
      ai_model_unavailable: "The food model is unavailable.",
      ai_request_rejected: "Try another photo or use manual entry.",
      ai_timeout: "The estimate took too long. Try again.",
      ai_invalid_response: "Could not estimate this food. Add a detail or try again.",
      ai_provider_unavailable: "Couldn’t complete the estimate. Try again in a moment.",
      ai_service_busy: "The AI service is busy. Try again in a moment.",
      ai_service_error: "The AI service had an error. Try again shortly.",
      ai_connection_failed: "Couldn’t reach the AI service. Try again shortly.",
      ai_rate_limited: "Food estimates are busy. Try again shortly.",
      ai_daily_limit_reached: "Today’s AI limit is reached. You can still edit and save an existing estimate.",
      photo_draft_unavailable: "This estimate expired. Generate it again.",
      invalid_food_estimate_request: "Enter a food name and optional portion details.",
      invalid_photo_food_log: "Check the portion range and nutrition values.",
      food_log_id_conflict: "This meal was already saved with different details. Refresh your log.",
    };
    setError(caught instanceof ApiError ? messages[caught.code] ?? "Could not complete this meal." : caught instanceof Error ? caught.message : "Could not complete this meal.");
  }

  async function pick(file: File) {
    const details = context;
    setBusy(true); setError(""); setNotice(""); resetReview(); setContext(details);
    try {
      const photo = await prepareImage(file);
      setImage(photo);
      await analyze(photo, details);
    } catch (caught) { reportError(caught); }
    finally { setBusy(false); }
  }

  function startTextEstimate() {
    if (!unmatchedFoodName || busy || saving) return;
    resetReview(); setTextFoodName(unmatchedFoodName); setContext(""); setError(""); setNotice(""); onReviewChange(true);
  }

  async function estimateText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!textFoodName?.trim() || busy || saving) return;
    setBusy(true); setError(""); setNotice("");
    try { await analyze(null, context, textFoodName); }
    catch (caught) { reportError(caught); }
    finally { setBusy(false); }
  }

  async function refine() {
    if ((!image && !textFoodName) || !answer.trim() || refinements >= 2 || busy || saving) return;
    setBusy(true); setError("");
    const corrections = items.flatMap((item) => {
      const original = result?.items[item.index];
      if (!original || !item.included) return [];
      const nutrition = values.find((value) => value.index === item.index)?.nutritionPer100g;
      const changedNutrition = nutrition && nutrientFields.some(({ key }) => nutrition[key] !== original.nutritionPer100g[key]);
      const changedPortion = Number(item.minimum) !== original.minimumGrams || Number(item.maximum) !== original.maximumGrams || item.certainty === "sure";
      return item.name !== original.name || changedPortion || changedNutrition ? [{
        food: item.name, ...(changedPortion ? { minimumGrams: item.minimum, maximumGrams: item.maximum, certainty: item.certainty } : {}),
        ...(changedNutrition ? { userNutritionPer100g: nutrition } : {}),
      }] : [];
    });
    const details = JSON.stringify({ initialDetails: context, question: result?.question, previousAnswers: answers, answer: answer.trim(), userCorrections: corrections }).slice(0, 4000);
    setRefinements((count) => count + 1);
    try { await analyze(image, details, textFoodName ?? undefined); setAnswers((current) => [...current, `${result?.question ?? "Meal details"}: ${answer.trim()}`]); }
    catch (caught) { reportError(caught); }
    finally { setBusy(false); }
  }

  const values = items.filter((item) => item.included).map((item) => {
    const original = result?.items[item.index];
    const nutrition = Object.fromEntries(nutrientFields.map(({ key }) => [key, item.nutrition[key].trim() ? Number(item.nutrition[key]) : original?.nutritionPer100g[key] ?? 0])) as Nutrition;
    return { index: item.index, name: item.name.trim(), minimumGrams: Number(item.minimum), maximumGrams: Number(item.maximum), certainty: item.certainty, nutritionPer100g: nutrition };
  });
  const valid = values.length > 0 && values.every((item) => item.name && item.name.length <= 100
    && Number.isFinite(item.minimumGrams) && item.minimumGrams >= 1 && item.maximumGrams >= item.minimumGrams && item.maximumGrams <= 5000
    && photoNutritionSchema.safeParse(item.nutritionPer100g).success);
  const totals = values.reduce((total, item) => {
    const grams = Math.round((item.minimumGrams + item.maximumGrams) / 2 * 100) / 100;
    for (const { key } of nutrientFields) total[key] += item.nutritionPer100g[key] * grams / 100;
    return total;
  }, { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });
  const minimumKcal = values.reduce((sum, item) => sum + item.nutritionPer100g.caloriesKcal * item.minimumGrams / 100, 0);
  const maximumKcal = values.reduce((sum, item) => sum + item.nutritionPer100g.caloriesKcal * item.maximumGrams / 100, 0);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!result || !valid || busy || saving) return;
    setSaving(true); setError("");
    try {
      const payload = { draftToken: result.draftToken, mealType, occurredAt: new Date(occurredAt).toISOString(), items: values };
      const fingerprint = JSON.stringify(payload);
      const pending = pendingSave.current?.fingerprint === fingerprint ? pendingSave.current : { fingerprint, id: window.crypto.randomUUID() };
      pendingSave.current = pending;
      const request = confirmFoodPhotoRequestSchema.safeParse({ ...payload, requestId: pending.id });
      if (!request.success) throw new Error("Check the portions, date, and nutrition values.");
      await postJson<{ count: number }>("/v1/food-logs/photo", request.data);
      resetReview(); setNotice("Added to your log and My foods.");
      try { await onSaved(); } catch { setNotice("Food added. Refresh to update your totals."); }
    } catch (caught) { reportError(caught); }
    finally { setSaving(false); }
  }

  return <section className="photo-lookup" aria-label="Estimate and log food">
    {unmatchedFoodName && !result && textFoodName === null ? <button type="button" className="button button-primary text-estimate-trigger" onClick={startTextEstimate} disabled={busy || saving}>Estimate “{unmatchedFoodName}” with AI</button> : null}
    <input ref={input} type="file" accept="image/*" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void pick(file); }} />
    <button className="button button-secondary photo-pick-button" type="button" disabled={busy || saving} onClick={() => input.current?.click()}><AppIcon name="camera" size={20} />{busy ? "Estimating meal…" : result ? "Use another photo" : "Camera or photo"}</button>
    {!result && textFoodName === null ? <details className="photo-context"><summary>Add a detail · optional</summary><label className="field"><span>Food, amount, or recipe</span><textarea value={context} onChange={(event) => setContext(event.target.value)} maxLength={600} placeholder="2 dosas, less oil. Around 300–400 g, not sure." /></label></details> : null}
    {textFoodName !== null && !result ? <form className="text-estimate-setup" onSubmit={(event) => void estimateText(event)}>
      <div className="photo-review-heading"><h3>Estimate food</h3><button type="button" className="quiet-button" disabled={busy || saving} onClick={() => { resetReview(); setError(""); }}>Cancel</button></div>
      <label className="field"><span>Food name</span><input value={textFoodName} required maxLength={100} disabled={busy} onChange={(event) => setTextFoodName(event.target.value)} /></label>
      <label className="field"><span>Amount or recipe · optional</span><textarea value={context} maxLength={600} disabled={busy} onChange={(event) => setContext(event.target.value)} placeholder="One bowl, about 300–400 g, not sure. Extra curd, little oil." /></label>
      <button type="submit" className="button button-primary" disabled={busy || saving || !textFoodName.trim()}>{busy ? "Estimating…" : "Estimate meal"}</button>
    </form> : null}
    {busy ? <p className="photo-status" role="status">Estimating portions and nutrition…</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="form-message" role="status">{notice}</p> : null}
    {result ? <form className="photo-meal-review" onSubmit={(event) => void save(event)}>
      <div className="photo-review-heading"><h3>Review your meal</h3><button type="button" className="quiet-button" disabled={busy || saving} onClick={() => { resetReview(); setError(""); }}>Cancel</button></div>
      {refinements < 2 ? <details className="photo-question" open={Boolean(result.question) || !result.items.length}><summary>{result.question ? "Quick question" : "Refine estimate · optional"}</summary><label className="field"><span>{result.question ?? "Food, portion, or cooking details"}</span><input value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={400} placeholder="Your answer, or “not sure”" disabled={busy || saving} /></label><button type="button" className="text-button" onClick={() => void refine()} disabled={!answer.trim() || busy || saving}>Update estimate</button></details> : null}
      {!result.items.length ? <p className="muted-copy">No food identified. Add a detail, try a photo, or use manual entry.</p> : null}
      <fieldset disabled={busy || saving} className="photo-review-fields">
        {items.map((item) => {
          const value = values.find((candidate) => candidate.index === item.index);
          const grams = value ? Math.round((value.minimumGrams + value.maximumGrams) / 2 * 100) / 100 : 0;
          const calories = value ? value.nutritionPer100g.caloriesKcal * grams / 100 : 0;
          return <article key={item.index} className={`photo-meal-item${item.included ? "" : " photo-meal-item-excluded"}`}>
            <div className="photo-item-heading"><label className="photo-include"><input type="checkbox" checked={item.included} onChange={(event) => update(item.index, { included: event.target.checked })} aria-label={`Include ${item.name}`} /><strong>{result.items[item.index]?.confidence === "low" ? "Rough estimate" : "Estimated"}</strong></label><span>{Number.isFinite(calories) ? number(calories) : "—"} kcal</span></div>
            <fieldset className="photo-item-fields" disabled={!item.included}>
            <label className="field"><span>Food</span><input value={item.name} maxLength={100} onChange={(event) => update(item.index, { name: event.target.value })} /></label>
            <div className="photo-certainty" role="group" aria-label={`Portion certainty for ${item.name}`}>{(["sure", "not_sure"] as const).map((certainty) => <button key={certainty} type="button" aria-pressed={item.certainty === certainty} onClick={() => {
              const midpoint = String(Math.round((Number(item.minimum) + Number(item.maximum)) / 2));
              update(item.index, { certainty, ...(certainty === "sure" && Number.isFinite(Number(midpoint)) ? { minimum: midpoint, maximum: midpoint } : {}) });
            }}>{certainty === "sure" ? "Sure" : "Not sure"}</button>)}</div>
            <div className="form-grid"><label className="field"><span>{item.certainty === "sure" ? "Amount (g)" : "From (g)"}</span><input type="number" min="1" max="5000" step="any" inputMode="decimal" value={item.minimum} onChange={(event) => update(item.index, { minimum: event.target.value, ...(item.certainty === "sure" ? { maximum: event.target.value } : {}) })} /></label>{item.certainty === "not_sure" ? <label className="field"><span>To (g)</span><input type="number" min="1" max="5000" step="any" inputMode="decimal" value={item.maximum} onChange={(event) => update(item.index, { maximum: event.target.value })} /></label> : null}</div>
            {value ? <div className="photo-item-macros"><span>Protein {number(value.nutritionPer100g.proteinG * grams / 100)} g</span><span>Carbs {number(value.nutritionPer100g.carbohydrateG * grams / 100)} g</span><span>Fat {number(value.nutritionPer100g.fatG * grams / 100)} g</span></div> : null}
            <details><summary>Edit nutrition · per 100 g</summary><div className="form-grid">{nutrientFields.map(({ key, label, unit }) => <label key={key} className="field"><span>{label} ({unit})</span><input type="number" min="0" max={key === "caloriesKcal" ? 1000 : 100} step="any" inputMode="decimal" value={item.nutrition[key]} onChange={(event) => update(item.index, { nutrition: { ...item.nutrition, [key]: event.target.value } })} /></label>)}</div></details>
            </fieldset>
          </article>;
        })}
        {items.length ? <><div className="photo-meal-total" aria-live="polite"><span>Estimated meal</span><strong>{valid ? number(totals.caloriesKcal) : "—"} kcal</strong>{valid && Math.round(minimumKcal) !== Math.round(maximumKcal) ? <small>{number(minimumKcal)}–{number(maximumKcal)} kcal range · midpoint logged</small> : null}</div><div className="photo-item-macros"><span>Protein {valid ? number(totals.proteinG) : "—"} g</span><span>Carbs {valid ? number(totals.carbohydrateG) : "—"} g</span><span>Fat {valid ? number(totals.fatG) : "—"} g</span></div><div className="form-grid"><label className="field"><span>Meal</span><select value={mealType} onChange={(event) => setMealType(event.target.value as typeof mealType)}>{["breakfast", "lunch", "dinner", "snack"].map((meal) => <option key={meal} value={meal}>{meal[0]?.toUpperCase()}{meal.slice(1)}</option>)}</select></label><label className="field"><span>Date and time</span><input type="datetime-local" required value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label></div>{!valid ? <p className="form-error">Select a food and check the portion range and macros.</p> : null}<button className="button button-primary" type="submit" disabled={!valid || saving || busy}>{saving ? "Adding…" : "Add to food log"}</button></> : null}
      </fieldset>
    </form> : null}
  </section>;
}
