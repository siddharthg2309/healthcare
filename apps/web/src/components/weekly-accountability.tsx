"use client";

import { useRef, useState, type FormEvent } from "react";
import { dailyCheckInRequestSchema, type DailyGoalEnergy, type ProgressOverview } from "@healthcare/contracts";
import { buildWeeklyConsistencyReport, calorieDayComparison, localNoonInstant, mondayOfWeek, shiftGoalDate } from "@healthcare/domain";
import { ApiError, postJson, putJson } from "@/lib/api";
import { goalDate } from "./goal-planner";

const number = (value: number | null | undefined, digits = 0) => value === null || value === undefined ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(value);
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const weekday = (date: string) => new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
function errorText(error: unknown) { return error instanceof ApiError && error.code === "check_in_conflict" ? "This check-in changed elsewhere. Reload before saving." : error instanceof Error ? error.message : "Could not save the check-in."; }

export function DayCheckInForm({ date, checkIn, version, onSaved }: { date: string; checkIn: DailyGoalEnergy["checkIn"]; version: number; onSaved: () => Promise<void> }) {
  const [dayType, setDayType] = useState(checkIn.dayType);
  const [plannedRest, setPlannedRest] = useState(checkIn.plannedRest);
  const [note, setNote] = useState(checkIn.note);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const request = dailyCheckInRequestSchema.safeParse({ dayType, plannedRest, note, baseVersion: version });
    if (!request.success) { setError("Keep your note within 280 characters."); return; }
    setBusy(true); setError(""); setSaved(false);
    try { await putJson(`/v1/days/${date}/check-in`, request.data); setSaved(true); await onSaved(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }
  return <form className="day-check-in-form" onSubmit={(event) => void submit(event)}><fieldset disabled={busy}>
    <label className="field"><span>Day label</span><select value={dayType} onChange={(event) => { setDayType(event.target.value as typeof dayType); setSaved(false); }}><option value="regular">Regular day</option><option value="cheat">Cheat day · my label</option></select></label>
    <label className="toggle-row"><input type="checkbox" checked={plannedRest} onChange={(event) => { setPlannedRest(event.target.checked); setSaved(false); }} /><span>Planned rest day</span></label>
    <label className="field"><span>A note for my weekly review · optional</span><textarea value={note} maxLength={280} rows={2} onChange={(event) => { setNote(event.target.value); setSaved(false); }} placeholder="Birthday dinner, travelling, or how the day felt." /></label>
    <button type="submit" className="button button-secondary">{busy ? "Saving…" : "Save check-in"}</button>
  </fieldset>{error ? <div role="alert"><p className="form-error">{error}</p><button type="button" className="text-button" disabled={busy} onClick={() => void onSaved()}>Reload latest</button></div> : saved ? <p className="form-message" role="status">Check-in saved.</p> : null}</form>;
}

export function DailyAccountability({ overview, onFood, onWeight, onActivity, onWeeklyReview, onSaved }: { overview: ProgressOverview; onFood: () => void; onWeight: () => void; onActivity: () => void; onWeeklyReview: () => void; onSaved: () => Promise<void> }) {
  const day = overview.todayEnergy;
  const report = buildWeeklyConsistencyReport(overview.days, overview.today);
  const moved = day.workoutSessions > 0 || (day.steps ?? 0) > 0 || day.checkIn.plannedRest;
  const checked = Number(day.foodDayComplete) + Number(day.weightKg !== null) + Number(moved);
  const action = !day.foodDayComplete ? onFood : day.weightKg === null ? onWeight : onActivity;
  return <section className="panel daily-accountability"><div className="panel-heading"><div><span className="eyebrow">SHOW UP FOR YOURSELF</span><h2>Today’s check-in</h2></div><span className="count-badge">{checked}/3</span></div>
    <div className="accountability-checks"><button type="button" className={day.foodDayComplete ? "check-done" : ""} onClick={onFood}><b>{day.foodDayComplete ? "✓" : "○"}</b><span>Food log</span></button><button type="button" className={day.weightKg !== null ? "check-done" : ""} onClick={onWeight}><b>{day.weightKg !== null ? "✓" : "○"}</b><span>Weight</span></button><button type="button" className={moved ? "check-done" : ""} onClick={onActivity}><b>{moved ? "✓" : "○"}</b><span>{day.checkIn.plannedRest ? "Rest day" : "Movement"}</span></button></div>
    <div className="logging-streaks"><span><strong>{report.foodStreak}</strong> day food streak</span><span><strong>{report.weightStreak}</strong> day weigh-in streak</span></div>
    {checked < 3 ? <button type="button" className="text-button" onClick={action}>{!day.foodDayComplete ? "Finish today’s food log" : day.weightKg === null ? "Add today’s weigh-in" : "Log movement, or mark a rest day below"}</button> : <p className="check-in-encouragement">Your daily check-ins are up to date.</p>}
    <button type="button" className="text-button" onClick={onWeeklyReview}>Open my weekly review</button>
    <details><summary>{day.checkIn.dayType === "cheat" ? "Cheat day · edit check-in" : "Day label, rest & notes"}</summary><DayCheckInForm key={`${day.date}-${day.checkInVersion}`} date={day.date} checkIn={day.checkIn} version={day.checkInVersion} onSaved={onSaved} /></details>
  </section>;
}

function DailyReviewRow({ day, today, timezone, onSaved, onFood }: { day: DailyGoalEnergy; today: string; timezone: string; onSaved: () => Promise<void>; onFood: (date: string) => void }) {
  const comparison = calorieDayComparison(day);
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pendingWeight = useRef<{ id: string; weight: number; measuredAt: string } | null>(null);
  async function saveWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const value = Number(weight);
    if (!Number.isFinite(value) || value < 25 || value > 400) { setError("Enter a weight between 25 and 400 kg."); return; }
    const request = pendingWeight.current?.weight === value ? pendingWeight.current : { id: crypto.randomUUID(), weight: value, measuredAt: day.date === today ? new Date().toISOString() : localNoonInstant(day.date, timezone) };
    pendingWeight.current = request; setBusy(true); setError("");
    try { await postJson("/v1/measurements", { measurementId: request.id, weightKg: value, measuredAt: request.measuredAt }); setWeight(""); pendingWeight.current = null; await onSaved(); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  async function toggleFoodComplete() {
    if (busy) return; setBusy(true); setError("");
    try { await putJson(`/v1/days/${day.date}/food-status`, { complete: !day.foodDayComplete }); await onSaved(); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  const comparisonLabel = comparison.status === "incomplete" ? "Incomplete log" : comparison.status === "no_target" ? "No calorie target" : comparison.status === "near_plan" ? "Near plan" : comparison.status === "above_plan" ? "Above plan" : "Below plan";
  return <article id={`check-in-${day.date}`} className="consistency-day"><header><div><strong>{weekday(day.date)}{day.date === today ? " · today" : ""}</strong><span>{dateLabel(day.date)}</span></div><div className="day-labels">{day.checkIn.dayType === "cheat" ? <span className="day-tag day-tag-cheat">Cheat day</span> : null}{day.checkIn.plannedRest ? <span className="day-tag">Rest day</span> : null}<span className={`day-tag day-tag-${comparison.status}`}>{comparisonLabel}</span></div></header>
    <div className="consistency-day-main"><div><span>Consumed / target</span><strong>{number(day.intakeCaloriesKcal)} <small>/ {number(day.targetCaloriesKcal)} kcal</small></strong>{comparison.differenceKcal !== null ? <small>{comparison.differenceKcal > 0 ? "+" : ""}{number(comparison.differenceKcal)} kcal vs plan</small> : <small>{day.foodLogCount ? `${day.foodLogCount} foods · totals so far` : "No food logged"}</small>}</div><div><span>Weight{day.weightReadings > 1 ? ` · ${day.weightReadings} readings` : ""}</span><strong>{number(day.weightKg, 1)} <small>kg</small></strong><small>{day.weightKg === null ? "No check-in" : day.weightReadings > 1 ? "Daily median" : "Recorded"}</small></div></div>
    <div className="consistency-day-secondary"><span>P {number(day.proteinG, 1)} g</span><span>C {number(day.carbohydrateG, 1)} g</span><span>F {number(day.fatG, 1)} g</span><span>{day.workoutSessions} sessions</span><span>{number(day.steps)} steps</span><span>{day.activitiesMissingEnergy ? "Exercise energy incomplete" : `${number(day.activityCaloriesKcal)} kcal exercise · est.`}</span></div>
    <div className="daily-balance-line"><span>Estimated deficit (+) / surplus (−)</span><strong>{number(day.deficitCaloriesKcal)} kcal</strong></div>
    {day.checkIn.note ? <p className="check-in-note">{day.checkIn.note}</p> : null}
    <details><summary>Update this day</summary><div className="day-review-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => onFood(day.date)}>{day.foodLogCount ? "Open food log" : "Add food"}</button>{day.foodLogCount > 0 ? <button type="button" className="text-button" disabled={busy} onClick={() => void toggleFoodComplete()}>{day.foodDayComplete ? "Mark incomplete" : "Mark food complete"}</button> : null}</div>
      {day.weightKg === null ? <form onSubmit={(event) => void saveWeight(event)} className="quick-weigh-in"><label className="field"><span>Actual weight for {dateLabel(day.date)} · kg</span><input type="number" inputMode="decimal" min="25" max="400" step="0.1" required value={weight} disabled={busy} onChange={(event) => setWeight(event.target.value)} /></label><button type="submit" className="button button-secondary" disabled={busy}>{busy ? "Saving…" : "Save weigh-in"}</button></form> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}<DayCheckInForm key={`${day.date}-${day.checkInVersion}`} date={day.date} checkIn={day.checkIn} version={day.checkInVersion} onSaved={onSaved} />
    </details>
  </article>;
}

export function WeeklyAccountability({ overview, onEdit, onSaved, onFood }: { overview: ProgressOverview; onEdit: () => void; onSaved: () => Promise<void>; onFood: (date: string) => void }) {
  const currentWeek = mondayOfWeek(overview.today);
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const report = buildWeeklyConsistencyReport(overview.days, overview.today, selectedWeek);
  const earliest = overview.days[0]?.date ?? overview.today;
  const pendingFood = report.rows.find((row) => !row.future && row.tracked && row.day && !row.day.foodDayComplete)?.day;
  const pendingWeight = report.rows.find((row) => !row.future && row.tracked && row.day && row.day.weightKg === null)?.day;
  return <section id="weekly-accountability" className="panel weekly-accountability" aria-labelledby="consistency-review-heading"><div className="panel-heading"><div><span className="eyebrow">YOUR WEEKLY CHECK-IN</span><h2 id="consistency-review-heading">Keep showing up.</h2></div></div>
    <div className="week-review-navigation"><button type="button" className="quiet-button" aria-label="Previous week" disabled={shiftGoalDate(selectedWeek, -1) < earliest} onClick={() => setSelectedWeek(shiftGoalDate(selectedWeek, -7))}>←</button><div><strong>{dateLabel(report.startDate)} – {dateLabel(report.endDate)}</strong><span>{selectedWeek === currentWeek ? "This week · so far" : goalDate(report.startDate).slice(-4)}</span></div><button type="button" className="quiet-button" aria-label="Next week" disabled={selectedWeek >= currentWeek} onClick={() => setSelectedWeek(shiftGoalDate(selectedWeek, 7))}>→</button></div>
    <details className="choose-review-week"><summary>Choose a week</summary><label className="field"><span>Week containing</span><input type="date" min={mondayOfWeek(earliest)} max={overview.today} value={selectedWeek} onChange={(event) => { if (event.target.value) setSelectedWeek(mondayOfWeek(event.target.value)); }} /></label></details>
    {selectedWeek !== currentWeek ? <button type="button" className="text-button" onClick={() => setSelectedWeek(currentWeek)}>Back to this week</button> : null}
    <div className="weekly-showing-up"><div><strong>{report.completeFoodDays}<small>/{report.expectedDays}</small></strong><span>food days complete</span></div><div><strong>{report.weighedDays}<small>/{report.expectedDays}</small></strong><span>weigh-in days</span></div><div><strong>{report.activeDays}</strong><span>movement days</span></div><div><strong>{report.cheatDays}</strong><span>marked cheat days</span></div></div>
    <p className="weekly-coaching-message">{report.message}</p>
    {pendingFood ? <button type="button" className="text-button weekly-next-action" onClick={() => onFood(pendingFood.date)}>Next: finish {dateLabel(pendingFood.date)}’s food log</button> : pendingWeight ? <button type="button" className="text-button weekly-next-action" onClick={() => { const card = document.getElementById(`check-in-${pendingWeight.date}`); const details = card?.querySelector("details"); if (details) details.open = true; card?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Next: check {dateLabel(pendingWeight.date)}’s weight entry</button> : null}
    <div className="week-nutrition-summary"><span>Average intake <strong>{number(report.averageCaloriesKcal)} kcal</strong></span><span>Average protein <strong>{number(report.averageProteinG, 1)} g</strong></span><span>Average weight <strong>{number(report.averageWeightKg, 1)} kg</strong></span><span>Recorded change <strong>{report.recordedWeightChangeKg === null ? "—" : `${report.recordedWeightChangeKg > 0 ? "+" : ""}${number(report.recordedWeightChangeKg, 2)} kg`}</strong></span></div>
    <details className="weekly-energy-comparison"><summary>Energy & plan comparison · {report.energyDays} days</summary><dl className="energy-breakdown"><div><dt>Average estimated deficit</dt><dd>{number(report.averageDeficitKcal)} kcal/day</dd></div><div><dt>Recorded estimated deficit</dt><dd>{number(report.recordedDeficitKcal)} kcal</dd></div><div><dt>Plan for the same days</dt><dd>{number(report.plannedDeficitForRecordedDaysKcal)} kcal</dd></div></dl></details>
    <div className="week-plan-counts"><span>{report.nearPlanDays} near plan</span><span>{report.abovePlanDays} above</span><span>{report.belowPlanDays} below</span><span>{report.restDays} rest days</span></div>
    <div className="consistency-days">{report.rows.map((row) => row.future || !row.tracked || !row.day ? <article className="consistency-empty-day" key={row.date}><strong>{weekday(row.date)} <span>{dateLabel(row.date)}</span></strong><span>{row.future ? "Coming up" : "Before tracking"}</span></article> : <DailyReviewRow key={row.date} day={row.day} today={overview.today} timezone={overview.timezone} onSaved={onSaved} onFood={onFood} />)}</div>
    <details className="week-review-method"><summary>How this review works</summary><p>Calorie and protein averages use complete food days only, including days you mark as cheat days. Near plan means within 10% of your target or 100 kcal, whichever is larger. It is a display tolerance, not a new calorie recommendation. Energy comparisons use only complete food days with sufficient activity data, for the same dates on both sides. Positive balance is an estimated deficit and negative is a surplus. Missing weigh-ins stay blank; recorded change compares the first and last measured days, not estimated fat loss. A cheat-day label never changes your allowance or resets a logging streak.</p><p>Food and weight streaks count logging, not weight loss or eating less. An unfinished today does not break yesterday’s streak. Your review updates from the food, activity, and weight you record.</p></details>
    <button type="button" className="text-button" onClick={onEdit}>Review my goal and daily budget</button>
  </section>;
}
