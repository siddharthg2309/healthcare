"use client";

import { useEffect, useState } from "react";
import type { FoodPreferences } from "@healthcare/contracts";
import { shiftGoalDate } from "@healthcare/domain";
import { requestJson } from "@/lib/api";
import { FoodTrackingView, type DaySummary } from "./tracking-views";
import { DayCheckInForm } from "./weekly-accountability";

export function FoodDayView({ day, initialDate, foodPreferences, onSaved }: { day: DaySummary; initialDate?: string; foodPreferences: FoodPreferences; onSaved: () => Promise<void> }) {
  const [date, setDate] = useState(initialDate ?? day.date);
  const [history, setHistory] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(date !== day.date), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    if (date === day.date) return;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void requestJson<DaySummary>(`/v1/days/${date}`).then((value) => { if (active) setHistory(value); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load this food log."); }).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [date, day.date, revision]);
  const selectedDay = date === day.date ? day : !loading && history?.date === date ? history : null;
  async function reload() { await onSaved(); if (date !== day.date) setRevision((value) => value + 1); }
  return <><div className="food-date-toolbar"><label className="field"><span>Food log date</span><input type="date" min={shiftGoalDate(day.date, -730)} max={day.date} value={date} onChange={(event) => { if (!event.target.value) return; setDate(event.target.value); setError(""); setLoading(event.target.value !== day.date); }} /></label>{date !== day.date ? <button type="button" className="text-button" onClick={() => { setDate(day.date); setLoading(false); setError(""); }}>Today</button> : null}</div>
    {error ? <div role="alert"><p className="form-error">{error}</p><button type="button" className="text-button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div> : !selectedDay ? <p className="muted-copy" role="status">Loading food log…</p> : <><FoodTrackingView key={date} day={selectedDay} foodPreferences={foodPreferences} onSaved={reload} /><details className="panel food-check-in-details"><summary>Day label, rest & notes</summary><DayCheckInForm key={`${date}-${selectedDay.checkInVersion ?? 0}`} date={date} checkIn={selectedDay.checkIn ?? { dayType: "regular", note: "", plannedRest: false }} version={selectedDay.checkInVersion ?? 0} onSaved={reload} /></details></>}
  </>;
}
