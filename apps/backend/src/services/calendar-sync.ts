import { and, eq, sql } from "drizzle-orm";
import { db } from "@healthcare/database";
import { calendarEventLinks, googleCalendarConnections, plans, reminderPreferences, userProfiles } from "@healthcare/database/schema";
import { profileSchema, reminderPreferencesRequestSchema, workoutPlanDataSchema } from "@healthcare/contracts";
import {
  decryptGoogleRefreshToken,
  GoogleCalendarError,
  googleCalendarRequest,
  refreshGoogleAccessToken,
  stableGoogleEventId,
} from "./google-calendar.js";

const fallbackWorkoutTime = "18:00";
const syncHorizonDays = 28;
const calendarReminderMinutes = 30;

type WorkoutCalendarEvent = {
  id: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  reminders: { useDefault: false; overrides: Array<{ method: "popup"; minutes: number }> };
};

export async function syncApprovedWorkoutCalendar(userId: string): Promise<{ scheduled: number; removed: number; horizonDays: number }> {
  const data = await db.transaction(async (tx) => {
    await tx.execute(sqlUserContext(userId));
    const [connection] = await tx.select().from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.userId, userId)).limit(1);
    const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    const activePlans = await tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.kind, "workout"), eq(plans.status, "active"),
    ));
    const [preferences] = await tx.select().from(reminderPreferences)
      .where(eq(reminderPreferences.userId, userId)).limit(1);
    const links = await tx.select().from(calendarEventLinks)
      .where(eq(calendarEventLinks.userId, userId));
    return { connection, profile, activePlans, preferences, links };
  });

  if (!data.connection) throw new GoogleCalendarError("google_calendar_not_connected");
  const connection = data.connection;
  const parsedProfile = profileSchema.safeParse(data.profile?.data);
  const timezone = parsedProfile.success ? parsedProfile.data.timezone : "UTC";
  const plansData = data.activePlans.map((plan) => ({ plan, parsed: workoutPlanDataSchema.safeParse(plan.data) }));
  if (plansData.some(({ parsed }) => !parsed.success)) throw new GoogleCalendarError("active_workout_plan_invalid");
  const preferencesData = reminderPreferencesRequestSchema.safeParse(data.preferences?.data);
  const workoutTime = preferencesData.success
    ? preferencesData.data.rules.find((rule) => rule.kind === "workout")?.localTime ?? fallbackWorkoutTime
    : fallbackWorkoutTime;
  const now = new Date();
  const today = localDateInZone(now, timezone);
  const currentTime = localTimeInZone(now, timezone);
  const refreshToken = decryptGoogleRefreshToken(connection.encryptedRefreshToken);
  const accessToken = await refreshGoogleAccessToken(refreshToken);
  const desired = plansData.flatMap(({ plan, parsed }) => parsed.success
    ? buildEvents(userId, plan.id, plan.version, parsed.data, timezone, today, currentTime, workoutTime)
    : []);
  const desiredKeys = new Set(desired.map((event) => event.occurrenceKey));

  for (let offset = 0; offset < desired.length; offset += 4) {
    await Promise.all(desired.slice(offset, offset + 4).map(async ({ occurrenceKey, planId, planVersion, date, event }) => {
      await upsertEvent(accessToken, connection.calendarId, event);
      await db.transaction(async (tx) => {
        await tx.execute(sqlUserContext(userId));
        await tx.insert(calendarEventLinks).values({
          userId,
          occurrenceKey,
          planId,
          planVersion,
          occurrenceDate: date,
          googleEventId: event.id,
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: [calendarEventLinks.userId, calendarEventLinks.occurrenceKey],
          set: { planId, planVersion, occurrenceDate: date, googleEventId: event.id, updatedAt: new Date() },
        });
      });
    }));
  }

  const stale = data.links.filter((link) => link.occurrenceDate >= today && !desiredKeys.has(link.occurrenceKey));
  for (let offset = 0; offset < stale.length; offset += 4) {
    await Promise.all(stale.slice(offset, offset + 4).map(async (link) => {
      try {
        await googleCalendarRequest(accessToken,
          `/calendars/${encodeURIComponent(connection.calendarId)}/events/${encodeURIComponent(link.googleEventId)}`,
          "DELETE");
      } catch (error) {
        if (!(error instanceof GoogleCalendarError) || error.code !== "google_calendar_resource_missing") throw error;
      }
      await db.transaction(async (tx) => {
        await tx.execute(sqlUserContext(userId));
        await tx.delete(calendarEventLinks).where(and(
          eq(calendarEventLinks.userId, userId),
          eq(calendarEventLinks.occurrenceKey, link.occurrenceKey),
        ));
      });
    }));
  }

  await db.transaction(async (tx) => {
    await tx.execute(sqlUserContext(userId));
    await tx.update(googleCalendarConnections).set({ lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(googleCalendarConnections.userId, userId));
  });
  return { scheduled: desired.length, removed: stale.length, horizonDays: syncHorizonDays };
}

function buildEvents(
  userId: string,
  planId: string,
  planVersion: number,
  plan: ReturnType<typeof workoutPlanDataSchema.parse>,
  timezone: string,
  today: string,
  currentTime: string,
  workoutTime: string,
): Array<{ occurrenceKey: string; planId: string; planVersion: number; date: string; event: WorkoutCalendarEvent }> {
  const items: Array<{ occurrenceKey: string; planId: string; planVersion: number; date: string; event: WorkoutCalendarEvent }> = [];
  for (let offset = 0; offset < syncHorizonDays; offset += 1) {
    const date = shiftLocalDate(today, offset);
    if (date === today && workoutTime <= currentTime) continue;
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
    const session = plan.sessions.find((item) => item.weekday === weekday);
    if (!session) continue;
    const end = addMinutes(date, workoutTime, session.estimatedMinutes);
    const occurrenceKey = `${planId}:v${planVersion}:${date}`;
    const id = stableGoogleEventId(`${userId}:${occurrenceKey}`);
    items.push({
      occurrenceKey,
      planId,
      planVersion,
      date,
      event: {
        id,
        summary: `Goal Health · ${session.label}`,
        description: `Approved workout from ${plan.name}. Open Goal Health to record your completed activity.`,
        start: { dateTime: `${date}T${workoutTime}:00`, timeZone: timezone },
        end: { dateTime: `${end.date}T${end.time}:00`, timeZone: timezone },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: calendarReminderMinutes }] },
      },
    });
  }
  return items;
}

async function upsertEvent(accessToken: string, calendarId: string, event: WorkoutCalendarEvent): Promise<void> {
  const eventPath = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`;
  try {
    await googleCalendarRequest(accessToken, eventPath, "PUT", event);
  } catch (error) {
    if (!(error instanceof GoogleCalendarError) || error.code !== "google_calendar_resource_missing") throw error;
    try {
      await googleCalendarRequest(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, "POST", event);
    } catch (createError) {
      if (!(createError instanceof GoogleCalendarError) || createError.code !== "google_calendar_request_failed") throw createError;
      await googleCalendarRequest(accessToken, eventPath, "PUT", event);
    }
  }
}

function localDateInZone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localTimeInZone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const hour = parts.find((item) => item.type === "hour")?.value ?? "00";
  const minute = parts.find((item) => item.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function shiftLocalDate(value: string, days: number): string {
  return new Date(Date.parse(`${value}T12:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));
  const total = hour * 60 + minute + minutes;
  const endDate = shiftLocalDate(date, Math.floor(total / 1440));
  const normalized = total % 1440;
  return { date: endDate, time: `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}` };
}

function sqlUserContext(userId: string) {
  return sql`SELECT set_config('app.user_id', ${userId}, true)`;
}
