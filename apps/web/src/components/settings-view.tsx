"use client";

import { useEffect, useState } from "react";
import { reminderPreferencesResponseSchema, type ReminderPreferences } from "@healthcare/contracts";
import { ApiError, postJson, putJson, requestJson } from "@/lib/api";

const labels: Record<ReminderPreferences["rules"][number]["kind"], string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  workout: "Workout",
  weigh_in: "Weigh-in",
};

type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  calendarName: string | null;
  lastSyncedAt: string | null;
  linkedEvents: number;
};

export function SettingsView() {
  const [preferences, setPreferences] = useState<ReminderPreferences | null>(null);
  const [draft, setDraft] = useState<ReminderPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [calendar, setCalendar] = useState<GoogleCalendarStatus | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState("");
  const [calendarError, setCalendarError] = useState("");

  useEffect(() => {
    let active = true;
    void requestJson<unknown>("/v1/reminders").then((value) => {
      const parsed = reminderPreferencesResponseSchema.safeParse(value);
      if (!parsed.success) throw new Error("Reminder settings could not be read.");
      if (active) {
        setPreferences(parsed.data);
        setDraft(parsed.data);
      }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Could not load reminder settings.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    void loadCalendarStatus();
    const timer = window.setTimeout(() => {
      const status = new URLSearchParams(window.location.search).get("calendar");
      if (status === "connected") setCalendarMessage("Google Calendar connected. Sync approved workouts when you are ready.");
      else if (status === "not_configured") setCalendarError("Calendar setup is not complete on the server yet.");
      else if (status === "authorization_cancelled") setCalendarError("Google Calendar access was cancelled.");
      else if (status === "refresh_token_missing") setCalendarError("Google did not return offline access. Reconnect and approve the requested access.");
      else if (status === "authorization_failed") setCalendarError("Google Calendar could not be connected. Check the OAuth setup and try again.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function loadCalendarStatus() {
    try {
      const value = await requestJson<GoogleCalendarStatus>("/v1/connections/google");
      setCalendar(value);
    } catch {
      setCalendarError("Could not load Google Calendar connection status.");
    }
  }

  function updateRule(kind: ReminderPreferences["rules"][number]["kind"], patch: Partial<ReminderPreferences["rules"][number]>) {
    setDraft((current) => current ? {
      ...current,
      rules: current.rules.map((rule) => rule.kind === kind ? { ...rule, ...patch } : rule),
    } : current);
  }

  async function save(next: ReminderPreferences | null = draft) {
    if (!next) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const saved = await putJson<unknown>("/v1/reminders", {
        browserNotificationsEnabled: next.browserNotificationsEnabled,
        rules: next.rules,
      });
      const parsed = reminderPreferencesResponseSchema.safeParse(saved);
      if (!parsed.success) throw new Error("The server returned invalid reminder settings.");
      setPreferences(parsed.data);
      setDraft(parsed.data);
      setMessage("Reminder settings saved.");
    } catch (caught) {
      const friendly = caught instanceof ApiError && caught.status === 401
        ? "Your session expired. Sign in again to continue."
        : caught instanceof Error ? caught.message : "Could not save reminder settings.";
      setError(friendly);
    } finally {
      setBusy(false);
    }
  }

  async function enableNotifications() {
    setMessage("");
    setError("");
    if (!("Notification" in window)) {
      setError("This browser does not support notifications. Reminder times remain visible here.");
      return;
    }
    let permission = Notification.permission;
    try {
      if (permission === "default") permission = await Notification.requestPermission();
    } catch {
      setError("The browser could not enable notifications. You can still keep reminders visible in the app.");
      return;
    }
    if (permission !== "granted") {
      setError("Notifications are blocked in this browser. You can still keep reminders visible in the app.");
      return;
    }
    if (!draft) return;
    const next = { ...draft, browserNotificationsEnabled: true };
    setDraft(next);
    await save(next);
  }

  async function syncCalendar() {
    setCalendarBusy(true);
    setCalendarError("");
    setCalendarMessage("");
    try {
      const result = await postJson<{ scheduled: number; removed: number; horizonDays: number }>("/v1/connections/google/sync", {});
      setCalendarMessage(`${result.scheduled} workout events synced for the next ${result.horizonDays} days${result.removed ? `; ${result.removed} outdated future events removed` : ""}.`);
      await loadCalendarStatus();
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : "";
      setCalendarError(code === "google_calendar_not_connected"
        ? "Connect Google Calendar first."
        : code === "google_calendar_not_configured"
          ? "Calendar setup is not complete on the server yet."
          : code === "active_workout_plan_invalid"
            ? "The approved workout plan needs review before it can sync."
            : "Calendar sync failed. Try again or reconnect Google Calendar.");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function disconnectCalendar() {
    if (!window.confirm("Disconnect Google Calendar? Goal Health will stop syncing. Events already created remain in your Google Calendar.")) return;
    setCalendarBusy(true);
    setCalendarError("");
    setCalendarMessage("");
    try {
      const result = await postJson<{ remoteRevoked: boolean }>("/v1/connections/google/disconnect", {});
      setCalendar((current) => current ? { ...current, connected: false, calendarName: null, lastSyncedAt: null, linkedEvents: 0 } : current);
      setCalendarMessage(result.remoteRevoked
        ? "Disconnected. Existing events remain in your Google Calendar."
        : "Disconnected locally. Google could not confirm token revocation; existing events remain in your calendar.");
    } catch {
      setCalendarError("Could not disconnect Google Calendar. Try again.");
    } finally {
      setCalendarBusy(false);
    }
  }

  const dirty = JSON.stringify(preferences) !== JSON.stringify(draft);

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">YOUR PREFERENCES</span><h1>Settings</h1><p>Choose reminder times for your local time zone.</p></div>
      </div>
      <section className="panel settings-panel" aria-labelledby="reminder-settings-title">
        <div className="panel-heading">
          <div><span className="eyebrow">REMINDERS</span><h2 id="reminder-settings-title">Daily check-ins</h2></div>
          <span className="panel-symbol" aria-hidden="true">◷</span>
        </div>
        {loading ? <p className="muted-copy">Loading preferences…</p> : null}
        {error && !draft ? <p className="form-error" role="alert">{error}</p> : null}
        {draft ? <>
          <p className="muted-copy settings-timezone">Times use <strong>{draft.timezone}</strong>. Notifications can appear while Goal Health is open. The browser may delay them when the app is in the background.</p>
          <div className="reminder-list">
            {draft.rules.map((rule) => <label className="reminder-row" key={rule.kind}>
              <span className="reminder-toggle"><input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.kind, { enabled: event.target.checked })} /><span><strong>{labels[rule.kind]}</strong><small>{rule.enabled ? "Reminder on" : "Reminder off"}</small></span></span>
              <input aria-label={`${labels[rule.kind]} reminder time`} type="time" value={rule.localTime} onChange={(event) => updateRule(rule.kind, { localTime: event.target.value })} />
            </label>)}
          </div>
          <div className="reminder-notification-option">
            <div><strong>Browser notifications</strong><p>Show a simple reminder when the app is open and the selected time arrives.</p></div>
            {draft.browserNotificationsEnabled
              ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => { const next = { ...draft, browserNotificationsEnabled: false }; setDraft(next); void save(next); }}>Turn off</button>
              : <button className="button button-secondary" type="button" disabled={busy} onClick={() => void enableNotifications()}>Enable</button>}
          </div>
          {error && draft ? <p className="form-error" role="alert">{error}</p> : null}
          {message ? <p className="form-message" role="status">{message}</p> : null}
          <div className="settings-actions">
            <button className="button button-primary" type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save reminders"}</button>
          </div>
        </> : null}
      </section>
      <section className="panel settings-calendar-panel">
        <div className="panel-heading"><div><span className="eyebrow">OPTIONAL CONNECTION</span><h2>Google Calendar</h2></div><span className="panel-symbol" aria-hidden="true">▦</span></div>
        <p className="muted-copy">Sync approved workouts to a separate Goal Health calendar. Events use your workout reminder time and include a 30-minute popup reminder.</p>
        {calendar?.connected ? <>
          <div className="calendar-connection-status"><strong>{calendar.calendarName}</strong><span>{calendar.lastSyncedAt ? `Last synced ${new Date(calendar.lastSyncedAt).toLocaleString()}` : "Connected · not synced yet"}</span><span>{calendar.linkedEvents} linked events</span></div>
          <div className="calendar-actions"><button className="button button-primary" type="button" disabled={calendarBusy} onClick={() => void syncCalendar()}>{calendarBusy ? "Syncing…" : "Sync approved workouts"}</button><button className="text-button" type="button" disabled={calendarBusy} onClick={() => void disconnectCalendar()}>Disconnect</button></div>
        </> : <>
          {calendar && !calendar.configured ? <p className="note-box">The app owner needs to add the Google OAuth values and token encryption key to the server environment before this can connect.</p> : null}
          {calendar?.configured
            ? <form action="/v1/connections/google/start" method="get"><button className="button button-secondary" type="submit">Connect Google Calendar</button></form>
            : <button className="button button-secondary" type="button" disabled>Connect Google Calendar</button>}
        </>}
        {calendarError ? <p className="form-error" role="alert">{calendarError}</p> : null}
        {calendarMessage ? <p className="form-message" role="status">{calendarMessage}</p> : null}
      </section>
    </>
  );
}

export function ReminderNotificationRunner({ userId }: { userId: string }) {
  useEffect(() => {
    let preferences: ReminderPreferences | null = null;
    let disposed = false;
    const firedInThisPage = new Set<string>();

    async function load() {
      try {
        const value = await requestJson<unknown>("/v1/reminders");
        const parsed = reminderPreferencesResponseSchema.safeParse(value);
        preferences = parsed.success ? parsed.data : null;
      } catch {
        preferences = null;
      }
    }

    async function check() {
      if (disposed || !preferences?.browserNotificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
      let parts: Intl.DateTimeFormatPart[];
      try {
        parts = new Intl.DateTimeFormat("en-US", {
          timeZone: preferences.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date());
      } catch {
        return;
      }
      const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
      const date = `${value("year")}-${value("month")}-${value("day")}`;
      const minute = `${value("hour")}:${value("minute")}`;
      for (const rule of preferences.rules) {
        if (!rule.enabled || rule.localTime !== minute) continue;
        const key = `goal-health:reminder:${userId}:${rule.kind}:${date}`;
        if (firedInThisPage.has(key)) continue;
        let stored = false;
        try {
          if (localStorage.getItem(key)) continue;
          localStorage.setItem(key, "sent");
          stored = true;
        } catch {
          // Keep this page session deduplicated if browser storage is unavailable.
        }
        firedInThisPage.add(key);
        try {
          const registration = await navigator.serviceWorker?.ready;
          if (!registration) throw new Error("service_worker_unavailable");
          await registration.showNotification("Goal Health reminder", {
            body: reminderNotificationCopy(rule.kind),
            tag: `${rule.kind}-${date}`,
            data: { url: "/" },
          });
        } catch {
          firedInThisPage.delete(key);
          if (stored) {
            try { localStorage.removeItem(key); } catch { /* Ignore unavailable local storage. */ }
          }
        }
      }
    }

    void load().then(() => void check());
    const timer = window.setInterval(() => void check(), 30_000);
    const refresh = window.setInterval(() => void load(), 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load().then(() => void check()); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);
  return null;
}

function reminderNotificationCopy(kind: ReminderPreferences["rules"][number]["kind"]): string {
  if (kind === "breakfast" || kind === "lunch" || kind === "dinner") return "If you have eaten, add it to today’s food log.";
  if (kind === "workout") return "Check your activity plan when it suits you.";
  return "Add a weigh-in if you planned one for today.";
}
