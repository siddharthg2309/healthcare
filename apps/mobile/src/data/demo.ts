export type ProgressDay = {
  day: string;
  actual: number | null;
  trend: number | null;
  plan: number;
};

export const progressWeek: ProgressDay[] = [
  { day: "Mon", actual: 79.9, trend: 79.9, plan: 80.0 },
  { day: "Tue", actual: 79.7, trend: 79.8, plan: 79.9 },
  { day: "Wed", actual: null, trend: null, plan: 79.8 },
  { day: "Thu", actual: 79.6, trend: 79.7, plan: 79.7 },
  { day: "Fri", actual: 79.5, trend: 79.6, plan: 79.6 },
  { day: "Sat", actual: null, trend: 79.6, plan: 79.5 },
  { day: "Sun", actual: 79.4, trend: 79.5, plan: 79.4 },
];

export const demoMeals = [
  { name: "Idli & sambar", detail: "Breakfast · 2 idli, 1 bowl", kcal: 328, mark: "B", tint: "#FFF2DB" },
  { name: "Paneer rice bowl", detail: "Lunch · 1 serving", kcal: 612, mark: "L", tint: "#E6F0E1" },
  { name: "Banana & curd", detail: "Snack · 1 banana, 150 g", kcal: 226, mark: "S", tint: "#F7F0DC" },
];

export const dailyNutrition = {
  eaten: 1166,
  target: 2050,
  protein: 62,
  proteinTarget: 115,
  carbs: 148,
  carbsTarget: 235,
  fat: 36,
  fatTarget: 68,
};

export const dailyMovement = {
  steps: 6420,
  stepTarget: 8000,
  activeMinutes: 36,
  workout: "Full body strength",
  workoutDuration: "42 min",
};

export function formatToday() {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}
