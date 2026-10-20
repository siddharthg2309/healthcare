import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  activityLogRecordSchema,
  foodLogRecordSchema,
  goalSchema,
  nutritionSnapshotSchema,
  profileSchema,
  type GoalRecord,
  type Profile,
} from "@healthcare/contracts";

import { apiRequest } from "@/lib/api";

const measurementSchema = z.object({
  id: z.string().uuid(),
  data: z.object({ measuredAt: z.string().datetime({ offset: true }), weightKg: z.number().finite().min(25).max(400) }).strict(),
}).strict();

const daySummarySchema = z.object({
  date: z.string().date(),
  timezone: z.string().min(1),
  foodLogs: z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive(), data: foodLogRecordSchema }).strict()),
  activityLogs: z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive(), data: activityLogRecordSchema }).strict()),
  foodTotals: nutritionSnapshotSchema,
  steps: z.number().int().nonnegative(),
  workoutsCompleted: z.number().int().nonnegative(),
  foodDayComplete: z.boolean(),
}).strict();

export type StoredGoal = GoalRecord & { id: string };
export type Measurement = z.infer<typeof measurementSchema>;
export type DaySummary = z.infer<typeof daySummarySchema>;

type AppState = {
  profile: Profile | null;
  goal: StoredGoal | null;
  goalVersions: StoredGoal[];
  measurements: Measurement[];
  day: DaySummary | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const AppStateContext = createContext<AppState | null>(null);

function asStoredGoal(candidate: unknown): StoredGoal | null {
  if (!candidate || typeof candidate !== "object") return null;
  const { id, ...data } = candidate as Record<string, unknown>;
  if (typeof id !== "string") return null;
  const parsed = goalSchema.safeParse(data);
  return parsed.success ? { ...parsed.data, id } : null;
}

function dateInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<StoredGoal | null>(null);
  const [goalVersions, setGoalVersions] = useState<StoredGoal[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [day, setDay] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [profileResponse, goalsResponse] = await Promise.all([
        apiRequest<{ profile: unknown }>("/v1/me"),
        apiRequest<{ current: unknown; versions: unknown[]; measurements: unknown[] }>("/v1/goals"),
      ]);
      const parsedProfile = profileSchema.safeParse(profileResponse.profile);
      const nextProfile = parsedProfile.success ? parsedProfile.data : null;
      const currentGoal = asStoredGoal(goalsResponse.current);
      const versions = goalsResponse.versions.flatMap((candidate) => {
        const parsed = asStoredGoal(candidate);
        return parsed ? [parsed] : [];
      }).sort((left, right) => left.goalVersion - right.goalVersion);
      const nextMeasurements = goalsResponse.measurements.flatMap((candidate) => {
        const parsed = measurementSchema.safeParse(candidate);
        return parsed.success ? [parsed.data] : [];
      }).sort((left, right) => left.data.measuredAt.localeCompare(right.data.measuredAt));

      setProfile(nextProfile);
      setGoal(currentGoal);
      setGoalVersions(versions);
      setMeasurements(nextMeasurements);
      if (nextProfile) {
        const response = await apiRequest<unknown>(`/v1/days/${dateInTimezone(nextProfile.timezone)}`);
        const parsedDay = daySummarySchema.safeParse(response);
        if (!parsedDay.success) throw new Error("The daily summary response was invalid.");
        setDay(parsedDay.data);
      } else {
        setDay(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the account data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    await loadData();
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return loadData();
    });
    return () => { cancelled = true; };
  }, [loadData]);

  return <AppStateContext.Provider value={{ profile, goal, goalVersions, measurements, day, loading, error, refresh }}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const state = useContext(AppStateContext);
  if (!state) throw new Error("useAppState must be used inside AppStateProvider.");
  return state;
}
