"use client";

import { useState, type PointerEvent } from "react";
import type { DailyGoalEnergy, GoalRecord, ProgressOverview } from "@healthcare/contracts";
import { getLocalDate, goalDaySpan, plannedWeightAt, shiftGoalDate } from "@healthcare/domain";
import { GoalBudgetDetails, goalDate } from "./goal-planner";

type Measurement = { id: string; data: { measuredAt: string; weightKg: number } };
type Revision = { id: string; date: string; goalVersion: number };
const number = (value: number | null | undefined) => value === null || value === undefined ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
const signedWeight = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
const shortDate = (date: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function GoalProgressSummary({ goal, overview, onEdit, onReload }: { goal: GoalRecord; overview: ProgressOverview | null; onEdit: () => void; onReload: () => void | Promise<void> }) {
  return <section className="panel goal-progress-summary">
    <div className="panel-heading"><div><span className="eyebrow">YOUR ACCEPTED PLAN · V{goal.goalVersion}</span><h2>{overview?.currentWeightKg.toFixed(1) ?? goal.startWeightKg.toFixed(1)} <small>kg now</small></h2></div><button type="button" className="button button-secondary" onClick={onEdit}>Edit plan</button></div>
    {overview ? <>
      <div className="goal-progress-stats"><div><span>{goal.direction === "maintain" ? "Weight change" : goal.direction === "lose" ? "Lost so far" : "Gained so far"}</span><strong>{overview.progressKg.toFixed(1)} <small>kg</small></strong></div><div><span>{goal.direction === "maintain" ? "From target" : "Remaining"}</span><strong>{overview.remainingKg.toFixed(1)} <small>kg</small></strong></div><div><span>Planned first week</span><strong>{signedWeight(overview.plannedWeeklyChangeKg)} <small>kg</small></strong></div><div><span>Recent weekly pace</span><strong>{overview.forecast.weeklyChangeKg === null ? "—" : signedWeight(overview.forecast.weeklyChangeKg)} <small>kg</small></strong></div></div>
      {goal.direction !== "maintain" ? <><div className="goal-completion-track" role="progressbar" aria-label="Measured progress toward target" aria-valuenow={overview.progressPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${overview.progressPercent}%` }} /></div><div className="goal-milestones">{overview.milestones.map((milestone) => <div key={milestone.percent} className={milestone.reached ? "milestone-reached" : ""}><span>{milestone.reached ? "✓ " : ""}{milestone.percent}%</span><strong>{milestone.weightKg.toFixed(1)} kg</strong></div>)}</div></> : null}
      <div className="goal-forecast-summary"><span className="eyebrow">{overview.forecast.status === "ready" ? "AT YOUR RECENT PACE" : "MEASURED TREND"}</span>{overview.forecast.arrivalDate ? <><strong>Around {goalDate(overview.forecast.arrivalDate)}</strong>{overview.forecast.earliestDate && overview.forecast.latestDate ? <span>Recent-rate range · {shortDate(overview.forecast.earliestDate)} – {goalDate(overview.forecast.latestDate)}</span> : <span>Recent rates vary too much for a bounded date range.</span>}</> : <p>{overview.forecast.message}</p>}<details><summary>{overview.forecast.measuredDays} measured days · {overview.forecast.spanDays}-day span</summary><p>{overview.forecast.message}</p><p>Last measured {goalDate(overview.currentWeightDate)}. Forecasts use up to 28 days of weights from this plan, with at least 6 days across 14 days and a weigh-in within the past week. They do not change your accepted intake or date.</p></details></div>
    </> : <div role="status"><p className="muted-copy">Progress details are unavailable.</p><button type="button" className="text-button" onClick={() => void onReload()}>Try again</button></div>}
    <details className="accepted-budget"><summary>My calorie budget</summary><GoalBudgetDetails goal={goal} /></details>
  </section>;
}

export function TodayEnergyPanel({ day, onFood }: { day: DailyGoalEnergy; onFood?: () => void }) {
  const signed = day.deficitCaloriesKcal;
  return <article className="panel today-energy-panel">
    <div className="panel-heading"><div><span className="eyebrow">TODAY · ESTIMATED</span><h2>Energy balance</h2></div></div>
    <div className="energy-equation"><div><strong>{number(day.expenditureCaloriesKcal)}</strong><span>Energy out</span></div><b>−</b><div><strong>{number(day.intakeCaloriesKcal)}</strong><span>Food in</span></div><b>=</b><div><strong>{signed === null ? "—" : number(Math.abs(signed))}</strong><span>{signed !== null && signed < 0 ? "Surplus" : "Deficit"}</span></div></div>
    {!day.foodDayComplete ? <button type="button" className="text-button" onClick={onFood} disabled={!onFood}>Complete today’s food log to see the balance</button> : day.activitiesMissingEnergy ? <p className="muted-copy">Complete the minutes or weight for {day.activitiesMissingEnergy} logged activities.</p> : day.baselineCaloriesKcal === null ? <p className="muted-copy">Edit your plan to add an energy budget.</p> : null}
    <details><summary>Breakdown</summary><dl className="energy-breakdown"><div><dt>Everyday energy · estimated</dt><dd>{number(day.baselineCaloriesKcal)} kcal</dd></div><div><dt>Logged exercise · estimated</dt><dd>{number(day.activityCaloriesKcal)} kcal</dd></div><div><dt>Accepted food allowance</dt><dd>{number(day.targetCaloriesKcal)} kcal</dd></div>{day.energyWeightKg !== null ? <div><dt>Weight used · {day.weightSource === "measurement" ? "measured" : "accepted baseline"}</dt><dd>{day.energyWeightKg.toFixed(1)} kg</dd></div> : null}</dl><p>Only logged exercise is added to the baseline, once. An incomplete activity can make energy out an undercount. Steps already covered by everyday movement are not added again. Food allowance stays unchanged.</p></details>
  </article>;
}

export { WeeklyAccountability as GoalWeeklyReview, DailyAccountability } from "./weekly-accountability";

export function GoalChart({ goal, goalRevisions = [], measurements, timezone, compact = false, rangeStart = goal.startDate, rangeEnd = goal.targetDate, overview }: {
  goal: GoalRecord; goalRevisions?: Revision[]; measurements: Measurement[]; timezone: string; compact?: boolean; rangeStart?: string; rangeEnd?: string; overview?: ProgressOverview | null;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const width = 360, height = compact ? 220 : 310, left = 43, right = 13, top = 18, bottom = height - 34;
  const today = overview?.today ?? getLocalDate(new Date(), timezone);
  const daily = new Map<string, number[]>();
  for (const item of measurements) {
    const date = getLocalDate(new Date(item.data.measuredAt), timezone);
    if (date > today) continue;
    daily.set(date, [...daily.get(date) ?? [], item.data.weightKg]);
  }
  const allDaily = [...daily].map(([date, values]) => { const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2); return { date, weightKg: sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2 }; }).sort((a, b) => a.date.localeCompare(b.date));
  const actual = allDaily.filter((point) => point.date >= rangeStart && point.date <= rangeEnd);
  const trend = allDaily.map((point, i) => { const window = allDaily.slice(Math.max(0, i - 2), i + 1); return { date: point.date, weightKg: window.reduce((sum, item) => sum + item.weightKg, 0) / window.length }; }).filter((point) => point.date >= rangeStart && point.date <= rangeEnd);
  const plan = [{ date: rangeStart, targetWeightKg: plannedWeightAt(goal, rangeStart) }, ...goal.trajectory.filter((point) => point.date > rangeStart && point.date < rangeEnd), { date: rangeEnd, targetWeightKg: plannedWeightAt(goal, rangeEnd) }];
  const forecast = overview?.forecast.points.filter((point) => point.date >= rangeStart && point.date <= rangeEnd) ?? [];
  const showTarget = goal.targetDate >= rangeStart && goal.targetDate <= rangeEnd;
  const weights = [...plan.map((point) => point.targetWeightKg), ...actual.map((point) => point.weightKg), ...trend.map((point) => point.weightKg), ...forecast.flatMap((point) => [point.lowKg, point.highKg]), ...(showTarget ? [goal.targetWeightKg] : [])];
  const low = Math.min(...weights), high = Math.max(...weights), padding = Math.max((high - low) * 0.14, 0.4);
  const min = low - padding, max = high + padding;
  const span = Math.max(1, goalDaySpan(rangeStart, rangeEnd));
  const x = (date: string) => left + Math.max(0, Math.min(1, goalDaySpan(rangeStart, date) / span)) * (width - left - right);
  const y = (weight: number) => top + (max - weight) / (max - min) * (bottom - top);
  const path = (points: Array<{ date: string; weightKg: number }>) => points.map((point, i) => `${i ? "L" : "M"} ${x(point.date)} ${y(point.weightKg)}`).join(" ");
  const band = forecast.length ? `${path(forecast.map((point) => ({ ...point, weightKg: point.lowKg })))} ${[...forecast].reverse().map((point) => `L ${x(point.date)} ${y(point.highKg)}`).join(" ")} Z` : "";
  const activeDate = selectedDate && selectedDate >= rangeStart && selectedDate <= rangeEnd ? selectedDate : null;
  const day = overview?.days.find((point) => point.date === activeDate);
  const measured = actual.find((point) => point.date === activeDate);
  const forecastBefore = activeDate ? [...forecast].reverse().find((point) => point.date <= activeDate) : undefined;
  const forecastAfter = activeDate ? forecast.find((point) => point.date >= activeDate) : undefined;
  const selectedForecastWeight = activeDate && forecastBefore && forecastAfter
    ? forecastBefore.weightKg + (forecastAfter.weightKg - forecastBefore.weightKg) * goalDaySpan(forecastBefore.date, activeDate) / Math.max(1, goalDaySpan(forecastBefore.date, forecastAfter.date)) : null;
  function select(event: PointerEvent<SVGSVGElement>) {
    if (compact) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = (event.clientX - rect.left) / rect.width * width;
    setSelectedDate(shiftGoalDate(rangeStart, Math.round(Math.max(0, Math.min(1, (relative - left) / (width - left - right))) * span)));
  }
  const labels = [rangeStart, shiftGoalDate(rangeStart, Math.floor(span / 2)), rangeEnd];
  return <div className={compact ? "goal-chart goal-chart-compact" : "goal-chart goal-chart-interactive"}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Accepted weight plan in green, measured weights and trend in black, recent-pace forecast dashed with a variation band. Select a date below for details." preserveAspectRatio="none" onPointerDown={select}>
      {Array.from({ length: 4 }, (_, i) => min + (max - min) * i / 3).map((tick) => <g key={tick}><line x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} className="chart-gridline" /><text x={left - 7} y={y(tick) + 4} textAnchor="end" className="chart-axis-label">{tick.toFixed(1)}</text></g>)}
      {band ? <path d={band} className="chart-forecast-band" /> : null}
      {goalRevisions.map((revision) => <line key={revision.id} x1={x(revision.date)} y1={top} x2={x(revision.date)} y2={bottom} className="chart-revision-marker"><title>Plan v{revision.goalVersion} accepted {goalDate(revision.date)}</title></line>)}
      {today >= rangeStart && today <= rangeEnd ? <line x1={x(today)} x2={x(today)} y1={top} y2={bottom} className="chart-today-marker" /> : null}
      <path d={path(plan.map((point) => ({ ...point, weightKg: point.targetWeightKg })))} className="chart-plan-path" />
      <path d={path(trend)} className="chart-trend-path" />
      {forecast.length ? <path d={path(forecast)} className="chart-forecast-path" /> : null}
      {actual.map((point) => <circle key={point.date} cx={x(point.date)} cy={y(point.weightKg)} r={compact ? 4 : 5} className="chart-actual-dot"><title>{goalDate(point.date)} · {point.weightKg.toFixed(1)} kg measured</title></circle>)}
      {showTarget ? <circle cx={x(goal.targetDate)} cy={y(goal.targetWeightKg)} r="5" className="chart-target-dot"><title>{goal.targetWeightKg} kg target</title></circle> : null}
      {activeDate ? <><line x1={x(activeDate)} x2={x(activeDate)} y1={top} y2={bottom} className="chart-selected-marker" /><circle cx={x(activeDate)} cy={y(measured?.weightKg ?? plannedWeightAt(goal, activeDate))} r="6" className="chart-selected-dot" /></> : null}
      {labels.map((date, i) => <text key={`${date}-${i}`} x={x(date)} y={height - 8} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="chart-axis-label">{shortDate(date)}</text>)}
    </svg>
    {!compact ? <div className="goal-chart-inspector"><label className="field"><span>Inspect a day</span><input type="date" min={rangeStart} max={rangeEnd} value={activeDate ?? ""} onChange={(event) => setSelectedDate(event.target.value)} /></label>{activeDate ? <div aria-live="polite" className="chart-day-details"><strong>{goalDate(activeDate)}</strong><div><span>Plan v{goal.goalVersion} path</span><b>{plannedWeightAt(goal, activeDate).toFixed(1)} kg</b></div><div><span>Measured</span><b>{measured ? `${measured.weightKg.toFixed(1)} kg` : "No weigh-in"}</b></div>{selectedForecastWeight !== null ? <div><span>Recent-pace forecast</span><b>{selectedForecastWeight.toFixed(1)} kg</b></div> : null}{day ? <><div><span>Food · {day.foodDayComplete ? "complete" : "incomplete"}</span><b>{number(day.intakeCaloriesKcal)} kcal</b></div><div><span>Exercise · estimated</span><b>{number(day.activityCaloriesKcal)} kcal</b></div><div><span>Energy out · estimated</span><b>{number(day.expenditureCaloriesKcal)} kcal</b></div><div><span>Deficit (+) / surplus (−)</span><b>{number(day.deficitCaloriesKcal)} kcal</b></div><small>Plan v{day.goalVersion ?? "—"}{day.activitiesMissingEnergy ? " · activity details missing" : ""}</small></> : activeDate > today ? <small>Future plan date · no recorded food or activity.</small> : <small>No energy details available.</small>}</div> : null}</div> : null}
  </div>;
}
