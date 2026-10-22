"use client";

import { useEffect, useRef, useState } from "react";
import { cardioPhotoResponseSchema, type CardioPhotoResponse, type CardioReport } from "@healthcare/contracts";
import { ApiError, postJson } from "@/lib/api";
import { prepareImage } from "@/lib/prepare-image";

export function CardioPhotoImport({ report, disabled, onChange, onReading, onBusyChange }: {
  report: CardioReport | null;
  disabled: boolean;
  onChange: (report: CardioReport | null) => void;
  onReading: (reading: CardioPhotoResponse) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  useEffect(() => () => { generation.current += 1; }, []);

  async function read(file: File) {
    const current = ++generation.current;
    setBusy(true); onBusyChange(true); setError(""); setQuestion(null);
    try {
      const image = await prepareImage(file);
      const response = cardioPhotoResponseSchema.parse(await postJson("/v1/activities/recognize-photo", image));
      if (current !== generation.current) return;
      if (!response.isActivity) throw new Error(response.question ?? "Choose a screenshot of one completed session.");
      setQuestion(response.question ?? (response.confidence === "low" ? "Some readings are unclear. Please check them below." : null));
      onReading(response);
    } catch (caught) {
      if (current !== generation.current) return;
      const messages: Record<string, string> = {
        ai_not_configured: "Photo import isn’t available. You can enter minutes manually.",
        ai_daily_limit_reached: "Today’s AI limit is reached. You can still log manually.",
        ai_rate_limited: "Photo import is busy. Try again shortly.",
        ai_service_busy: "The AI service is busy. Try again in a moment.",
        ai_service_error: "The AI service had an error. Try again shortly.",
        ai_connection_failed: "Couldn’t reach the AI service. You can still log manually.",
        ai_timeout: "Reading took too long. Try another photo or enter minutes.",
        ai_invalid_response: "Couldn’t read this session. Try a clearer image.",
      };
      setError(caught instanceof ApiError ? messages[caught.code] ?? "Couldn’t read the photo. You can still log manually." : caught instanceof Error ? caught.message : "Couldn’t read the photo.");
    } finally {
      if (current === generation.current) { setBusy(false); onBusyChange(false); }
    }
  }

  function pick(file: File | undefined) { if (file && !busy && !disabled) void read(file); }

  return <section className="cardio-photo-import" aria-label="Import a cardio session">
    <div className="cardio-photo-heading"><strong>{report ? "Review readings" : "Strava or treadmill photo"}</strong><small>Optional</small></div>
    <input hidden ref={gallery} type="file" accept="image/*" onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }} />
    <input hidden ref={camera} type="file" accept="image/*" capture="environment" onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }} />
    <div className="cardio-photo-actions">
      <button className="button button-secondary" type="button" disabled={busy || disabled} onClick={() => gallery.current?.click()}>{busy ? "Reading…" : report ? "Replace image" : "Upload screenshot"}</button>
      <button className="button button-secondary" type="button" disabled={busy || disabled} onClick={() => camera.current?.click()}>Take photo</button>
    </div>
    {busy ? <p role="status" className="muted-copy">Reading session details…</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {report ? <>
      {question ? <p className="cardio-photo-question" role="status">{question}</p> : null}
      <div className="form-grid">
        <label className="field"><span>Reported calories · kcal</span><input type="number" min="0" max="20000" step="1" inputMode="numeric" value={report.caloriesKcal ?? ""} placeholder="Not shown" disabled={busy || disabled} onChange={(event) => onChange({ ...report, caloriesKcal: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        <label className="field"><span>Distance · km</span><input type="number" min="0" max="1000" step="any" inputMode="decimal" value={report.distanceKm ?? ""} placeholder="Not shown" disabled={busy || disabled} onChange={(event) => onChange({ ...report, distanceKm: event.target.value === "" ? null : Number(event.target.value) })} /></label>
      </div>
      <label className="field"><span>What does the calorie reading include?</span><select value={report.calorieBasis} disabled={busy || disabled} onChange={(event) => onChange({ ...report, calorieBasis: event.target.value as CardioReport["calorieBasis"] })}><option value="unknown">Not sure / not labelled</option><option value="active">Active calories</option><option value="total">Total calories, including rest</option></select></label>
      <p className="cardio-photo-caption">{report.caloriesKcal === null || report.calorieBasis === "unknown" ? "Using the app estimate until the calorie reading is clear." : report.calorieBasis === "total" ? "Resting calories are deducted before adding to progress." : "Using your reviewed active-calorie reading."}</p>
      <button type="button" className="text-button" disabled={busy || disabled} onClick={() => { onChange(null); setQuestion(null); }}>Remove imported readings</button>
    </> : null}
    <details className="activity-note-details"><summary>About photo imports</summary><p className="muted-copy">Check the minutes, activity type, and readings before saving. Device calories are estimates. The configured AI provider reads the image; the app keeps the reviewed readings, not the image.</p></details>
  </section>;
}
