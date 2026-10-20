export type WorkoutTemplateExercise = {
  exerciseId: string;
  sets: number;
  repRange?: readonly [number, number];
  durationSecondsRange?: readonly [number, number];
  restSeconds: number;
};

export type WorkoutTemplateSession = {
  label: string;
  estimatedMinutes: number;
  exercises: readonly WorkoutTemplateExercise[];
};

export type WorkoutTemplate = {
  id: string;
  name: string;
  level: "beginner" | "general";
  weeklyFrequency: number;
  equipment: readonly string[];
  summary: string;
  sessions: readonly WorkoutTemplateSession[];
};

export const workoutTemplates: readonly WorkoutTemplate[] = [
  {
    id: "bodyweight-full-body-2d-v1",
    name: "Bodyweight · 2 days",
    level: "beginner",
    weeklyFrequency: 2,
    equipment: [],
    summary: "Two short full-body sessions for a week with no workout equipment.",
    sessions: [
      {
        label: "Session A",
        estimatedMinutes: 25,
        exercises: [
          { exerciseId: "bodyweight-squat", sets: 2, repRange: [8, 12], restSeconds: 60 },
          { exerciseId: "wall-push-up", sets: 2, repRange: [8, 12], restSeconds: 60 },
          { exerciseId: "glute-bridge", sets: 2, repRange: [10, 15], restSeconds: 60 },
          { exerciseId: "dead-bug", sets: 2, repRange: [6, 10], restSeconds: 45 },
        ],
      },
      {
        label: "Session B",
        estimatedMinutes: 25,
        exercises: [
          { exerciseId: "reverse-lunge", sets: 2, repRange: [6, 10], restSeconds: 75 },
          { exerciseId: "wall-push-up", sets: 2, repRange: [8, 12], restSeconds: 60 },
          { exerciseId: "prone-y-raise", sets: 2, repRange: [8, 12], restSeconds: 45 },
          { exerciseId: "front-plank", sets: 2, durationSecondsRange: [15, 30], restSeconds: 45 },
        ],
      },
    ],
  },
  {
    id: "dumbbell-full-body-3d-v1",
    name: "Dumbbell full body · 3 days",
    level: "beginner",
    weeklyFrequency: 3,
    equipment: ["dumbbells", "stable support"],
    summary: "Three nonconsecutive full-body sessions using dumbbells and a stable support.",
    sessions: [
      {
        label: "Session A",
        estimatedMinutes: 35,
        exercises: [
          { exerciseId: "goblet-squat", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "dumbbell-floor-press", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "one-arm-dumbbell-row", sets: 3, repRange: [8, 12], restSeconds: 75 },
          { exerciseId: "dead-bug", sets: 2, repRange: [6, 10], restSeconds: 45 },
        ],
      },
      {
        label: "Session B",
        estimatedMinutes: 35,
        exercises: [
          { exerciseId: "dumbbell-romanian-deadlift", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "dumbbell-overhead-press", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "reverse-lunge", sets: 2, repRange: [6, 10], restSeconds: 75 },
          { exerciseId: "side-plank", sets: 2, durationSecondsRange: [15, 30], restSeconds: 45 },
        ],
      },
      {
        label: "Session C",
        estimatedMinutes: 35,
        exercises: [
          { exerciseId: "goblet-squat", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "dumbbell-floor-press", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "bent-over-dumbbell-row", sets: 3, repRange: [8, 12], restSeconds: 75 },
          { exerciseId: "glute-bridge", sets: 2, repRange: [10, 15], restSeconds: 60 },
        ],
      },
    ],
  },
  {
    id: "gym-full-body-3d-v1",
    name: "Gym full body · 3 days",
    level: "general",
    weeklyFrequency: 3,
    equipment: ["barbell", "rack", "bench", "cable or machine"],
    summary: "Three full-body sessions with a mix of free weights and machines.",
    sessions: [
      {
        label: "Session A",
        estimatedMinutes: 45,
        exercises: [
          { exerciseId: "barbell-back-squat", sets: 3, repRange: [6, 10], restSeconds: 150 },
          { exerciseId: "barbell-bench-press", sets: 3, repRange: [6, 10], restSeconds: 150 },
          { exerciseId: "seated-cable-row", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "front-plank", sets: 2, durationSecondsRange: [20, 40], restSeconds: 45 },
        ],
      },
      {
        label: "Session B",
        estimatedMinutes: 45,
        exercises: [
          { exerciseId: "leg-press", sets: 3, repRange: [8, 12], restSeconds: 120 },
          { exerciseId: "lat-pulldown", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "dumbbell-romanian-deadlift", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "dumbbell-overhead-press", sets: 2, repRange: [8, 12], restSeconds: 90 },
        ],
      },
      {
        label: "Session C",
        estimatedMinutes: 45,
        exercises: [
          { exerciseId: "barbell-romanian-deadlift", sets: 3, repRange: [6, 10], restSeconds: 120 },
          { exerciseId: "machine-chest-press", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "seated-cable-row", sets: 3, repRange: [8, 12], restSeconds: 90 },
          { exerciseId: "reverse-crunch", sets: 2, repRange: [8, 12], restSeconds: 45 },
        ],
      },
    ],
  },
];

export function findWorkoutTemplateById(id: string): WorkoutTemplate | undefined {
  return workoutTemplates.find((template) => template.id === id);
}
