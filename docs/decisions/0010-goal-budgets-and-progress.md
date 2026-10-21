# Decision 0010: Goal budgets and measured progress

Date: 21 October 2026

## Product flow

Goal setup supports a target date, chosen daily intake, or weight tracking without a calorie allowance. Date mode suggests an intake; intake mode suggests a date. A blank intake requests an initial suggestion, which can be edited before acceptance. A manually supplied intake and date can coexist: the accepted schedule and approximate model arrival are shown separately. Gain, loss, and maintenance remain distinct.

The estimate option uses plain Female/Male labels rather than exposing equation names. Everyday movement explicitly excludes workouts. Planned exercise is an optional daily average, initially zero; for example, three 300-kcal sessions per week average 129 kcal/day. It is an assumption entered by the owner, not a verified exercise measurement.

Unsupported estimates explain the necessary change and offer another date/intake where possible, or weight-only tracking. A suggested alternative still needs another preview and explicit acceptance. Clinician-provided targets can be recorded without generating a standard prescription for unsupported profiles. No LLM participates in the numerical calculations.

## Versioned numerical model

`goal-budget-v3` retains the existing Mifflin resting-energy coefficients and activity multipliers. It removes the old fixed 250-kcal adjustment. The new budget snapshot records age, height, weight, equation choice, baseline movement, resting estimate, baseline expenditure, planned exercise, initial deficit, model version, and dates. Legacy goals have no budget and retain their original accepted values.

The initial scenario is `hall_reduced_v1`, an explicitly approximate population response derived from the rule of thumb published in [Hall et al., Lancet 2011](https://pubmed.ncbi.nlm.nih.gov/21872751/): approximately 10 kcal/day per pound eventual change, with about half the response after a year. It is **not the full NIH Body Weight Planner model, a clinically validated implementation, or a personalized physiological prediction**. The [NIDDK research page](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner) describes the full model and its limitations.

For an initial deficit `D`, feedback `k = 22 kcal/day/kg`, and `tau = 365 / ln(2)` days:

```text
weight_change(t) = -D / k * (1 - exp(-t / tau))
required_initial_deficit = -target_change * k / (1 - exp(-days / tau))
days_to_target = -tau * ln(1 + target_change * k / D)
```

An unreachable asymptote, wrong-direction intake, or unsupported horizon produces alternatives instead of a fabricated date. The horizon is 14–730 days. Self/automatic estimates retain the app's limits of 1,200–5,000 kcal/day, 0.45 kg/week loss, and 0.25 kg/week gain; the initial model pace is checked too. These are application limits, not universal clinical recommendations. Standard estimates are unavailable outside ages 19–78, for pregnancy/breastfeeding, clinician-directed diets, or current/target BMI below 18.5. Logging and clinician-supplied dated targets remain available.

First-week/month weight scenarios use the dynamic approximation. Daily, seven-day, and 30-day deficit totals are separately labeled arithmetic holding the initial deficit constant. The 7,700-kcal/kg reference is confined to an explanatory energy-equivalent calculation and never drives the forecast or claims measured fat loss. Intake rounds to whole kcal; stored weights use two decimals. Default macro targets for supported self/automatic budgets use 20/50/30 percent of energy; clinician targets do not receive invented macro targets.

## Daily accounting

`GET /v1/progress/overview` computes account-owned summaries from accepted goal snapshots, food logs, activity records, measurements, and food-day completion markers. It sets the transaction's account context and filters every query by owner. It performs no database mutations or model calls.

Daily baseline expenditure is the accepted non-workout baseline plus `22 * (latest measured weight - accepted starting weight)`, using only weights available on or before that date. If no subsequent measurement exists, it uses the accepted baseline. Net logged exercise is then added once. The accepted food allowance does not increase when exercise is logged. Steps already represented in everyday movement are not added again. Legacy inclusive-activity goals do not get a newly invented daily budget; their owners can explicitly accept an upgraded plan.

Incomplete food days, complete days without food entries, and sessions with missing energy estimates have no deficit total. Unspecified timed Other activities also keep the deficit unknown. Their absence is not treated as zero intake or verified exercise energy. Reported energy out remains an estimate, not a measurement of total expenditure. Weekly totals compare the same eligible days on both sides and are never extrapolated to a full week from a partial log.

Each historical day uses the most recent goal accepted on or before that local day, including the latest version when more than one was accepted that day. Daily summaries are derived on read rather than persisted as a second ledger: editing a source food/activity record updates its affected summary. Accepted goal budgets stay immutable. Historical activity rows without stored energy use the existing response-only estimator; provenance is not rewritten.

## Forecast and graph

The graph shows a solid lime accepted plan, black daily-median weights and a rolling mean of up to three measured days, plus a dashed recent-pace forecast. It provides focused recent/future, 30-day, 90-day, and full-goal ranges, local-date inspection, calorie/activity/completeness details, goal milestones, plan revision markers, and an accepted-version selector. Raw readings remain in measurement history. The full-goal view remains available after the chosen deadline has passed.

Forecast policy `progress-budget-v1` requires six distinct measured days spanning at least fourteen days in the latest 28 days, since the current goal began, with a weigh-in within seven days. It fits a Theil–Sen-style median of pairwise slopes separated by at least seven days. A median residual intercept anchors the fitted weight at the latest measurement. Same-day readings first collapse to their median.

Arrival is shown only when the fitted pace approaches the target within 180 days. Rapid changes above one percent of the latest weight per week suppress arrival estimates. Maintenance, reached-target, stale, insufficient-data, moving-away, and out-of-horizon cases have explicit states. Unsupported profile groups also receive no arrival forecast. A forecast draws at most 90 days ahead. The band uses the 25th/75th percentiles of recent pairwise slopes; bounded date alternatives are shown only if both reach the target within the horizon. **This is variation between recent rates, not a statistical confidence interval or evidence of future accuracy.** It must be interpreted separately from the approximate energy scenario.

Weekly review compares recorded intake/balance with the accepted plan and suggests reviewing date, intake, or activity. It never changes an active plan. No calories-to-weight inference is used to fill missing measurements or to infer an actual maintenance expenditure from incomplete logs. Full physiological-model validation and forecast calibration against real longitudinal data remain future work.

## Acceptance, compatibility, and deployment

Previews use the latest owned measured weight. The server returns a fingerprint of the exact preview; acceptance recalculates under the account lock and rejects a changed profile, weight, or start date until reviewed again. A request hash protects same-ID retries from silently accepting a different request. New versions preserve prior plans, and a plan revision does not create a fictitious new weigh-in. The initial profile weight is still recorded once during initial onboarding.

New budget and request-hash fields live in existing goal JSON; optional fields preserve legacy records. New request modes default to dated planning for older clients, and legacy inclusive activity multipliers never receive a second planned-exercise allowance. No database migration, environment variable, external API, or AI spending is introduced.

Builds, typecheck, tests, browser checks, live API execution, and numerical/runtime validation were not run, following the owner's instruction to finish without checks. Source was reviewed manually. Git's mandatory secret scans still run when committing/pushing. This implementation must not be represented as clinically validated.
