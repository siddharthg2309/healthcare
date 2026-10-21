# Decision 0011: Daily check-ins and weekly accountability

Date: 21 October 2026

## Experience

Home has a daily check-in for food completion, a recorded weigh-in, and movement or an explicitly marked rest day. Food and weigh-in streaks count logging rather than weight loss or eating below a calorie target. An unfinished current day does not break yesterday's streak. Cheat-day labels do not reset either streak.

The weekly review uses Monday–Sunday in the account's time zone. It shows all seven dates, including future dates and dates before tracking started without treating them as misses. Owners can move between weeks or choose a date in an older week. Days since tracking began and through today form the weekly coverage denominator. Each tracked day shows consumed calories and that day's accepted target, food completeness, protein/carbs/fat, weight and the number of readings, sessions, recorded steps, estimated exercise energy, an eligible energy balance, a self-chosen day label, planned rest, and an optional note.

The review offers a concrete next action for missing food or weight. Historical food actions open that specific date's log; quantity and photo confirmation forms initialize to the selected date. An unrecorded weigh-in can be entered inline, using an account-local historical noon or the current instant for today's entry. It must be an actual value supplied by the owner. Multiple daily readings retain the existing median policy, not an inferred weight.

The summary includes complete food days, weigh-in days, movement and planned-rest days, self-marked cheat days, daily calorie comparison counts, average calories/protein on complete food days, average measured weight, recorded first-to-last weight change, and energy-versus-plan totals for the same eligible dates. Incomplete food and missing measurements remain unknown. None of these values establishes actual fat loss or causes an automatic calorie adjustment.

## Day labels and comparison

`regular` and `cheat` are owner-controlled labels. The app never infers a cheat day from a food name, a photograph, a calorie overage, or an incomplete log. A separate numerical comparison marks a complete food day near/above/below its accepted calorie target. "Near plan" uses a UI tolerance of 10% of the target or 100 kcal, whichever is larger. It is not a medical recommendation or permission to change the target. Below-target days are not rewarded as superior adherence.

Notes are bounded to 280 trimmed characters, remain private account data, are escaped by React, and are not sent to an LLM. Automated messages are deterministic summaries of logging coverage and next actions. They do not imply human supervision, scheduled notification delivery, or monitoring while the app is closed. Existing reminder capabilities are unchanged.

## Persistence and concurrency

Migration `0020_daily_checkins.sql` adds a JSON `check_in` object and integer `check_in_version` to the existing `food_day_statuses` table. Defaults preserve existing food-completion records. The existing owner policy and forced RLS remain in effect. Account export already includes these rows, and existing account cleanup deletes them with the rest of the owner's day statuses.

`PUT /v1/days/:date/check-in` accepts a day type, planned-rest flag, note, and base version. It requires a session/profile, validates a real local date within the last 730 days through today, sets transaction owner context, filters by owner, and serializes writes for that account/date with an advisory lock. A stale version returns a conflict, with a same-payload immediate retry allowed idempotently. Food-completion updates touch only completion fields; check-in updates touch only metadata fields, so the two operations do not overwrite one another.

`GET /v1/progress/overview?view=checkins` includes the extra daily fields. The parameter-free endpoint keeps the previous strict response shape for already-open PWA versions. `GET /v1/days/:date` includes the day's check-in for the food-date view. The main progress graph and immutable accepted goal budgets retain their numerical policies.

## Deployment and status

The additive migration was generated and applied to the configured Neon database with `npm run db:app:migrate` during implementation; the command completed successfully. Other databases need the normal application migration command before deploying this version. No new environment variables or AI calls are needed.

Builds, typecheck, tests, browser checks, live endpoint verification, and UI verification were not run, following the owner's instruction to finish without checks. Migration execution is an implementation step, not evidence that the runtime/UI paths have been verified. Required Git secret-scanning hooks still run at commit/push time.
