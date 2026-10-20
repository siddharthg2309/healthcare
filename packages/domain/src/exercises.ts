export type ExerciseDefinition = {
  id: string;
  name: string;
  movementPattern: "squat" | "hinge" | "lunge" | "push" | "pull" | "core" | "calf";
  primaryMuscles: string[];
  equipment: string[];
};

export const EXERCISE_CATALOG_VERSION = "starter-v1";

export const exerciseCatalog: readonly ExerciseDefinition[] = [
  { id: "bodyweight-squat", name: "Bodyweight squat", movementPattern: "squat", primaryMuscles: ["quads", "glutes"], equipment: [] },
  { id: "goblet-squat", name: "Goblet squat", movementPattern: "squat", primaryMuscles: ["quads", "glutes"], equipment: ["dumbbell or kettlebell"] },
  { id: "split-squat", name: "Split squat", movementPattern: "lunge", primaryMuscles: ["quads", "glutes"], equipment: [] },
  { id: "reverse-lunge", name: "Reverse lunge", movementPattern: "lunge", primaryMuscles: ["quads", "glutes"], equipment: [] },
  { id: "glute-bridge", name: "Glute bridge", movementPattern: "hinge", primaryMuscles: ["glutes", "hamstrings"], equipment: [] },
  { id: "dumbbell-romanian-deadlift", name: "Dumbbell Romanian deadlift", movementPattern: "hinge", primaryMuscles: ["hamstrings", "glutes"], equipment: ["dumbbells"] },
  { id: "barbell-romanian-deadlift", name: "Barbell Romanian deadlift", movementPattern: "hinge", primaryMuscles: ["hamstrings", "glutes"], equipment: ["barbell"] },
  { id: "standing-calf-raise", name: "Standing calf raise", movementPattern: "calf", primaryMuscles: ["calves"], equipment: [] },
  { id: "push-up", name: "Push-up", movementPattern: "push", primaryMuscles: ["chest", "shoulders", "triceps"], equipment: [] },
  { id: "incline-push-up", name: "Incline push-up", movementPattern: "push", primaryMuscles: ["chest", "shoulders", "triceps"], equipment: ["stable bench or surface"] },
  { id: "dumbbell-floor-press", name: "Dumbbell floor press", movementPattern: "push", primaryMuscles: ["chest", "triceps"], equipment: ["dumbbells"] },
  { id: "dumbbell-bench-press", name: "Dumbbell bench press", movementPattern: "push", primaryMuscles: ["chest", "triceps"], equipment: ["dumbbells", "bench"] },
  { id: "dumbbell-overhead-press", name: "Dumbbell overhead press", movementPattern: "push", primaryMuscles: ["shoulders", "triceps"], equipment: ["dumbbells"] },
  { id: "dumbbell-lateral-raise", name: "Dumbbell lateral raise", movementPattern: "push", primaryMuscles: ["shoulders"], equipment: ["dumbbells"] },
  { id: "dumbbell-triceps-extension", name: "Dumbbell triceps extension", movementPattern: "push", primaryMuscles: ["triceps"], equipment: ["dumbbell"] },
  { id: "one-arm-dumbbell-row", name: "One-arm dumbbell row", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["dumbbell"] },
  { id: "bent-over-dumbbell-row", name: "Bent-over dumbbell row", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["dumbbells"] },
  { id: "resistance-band-row", name: "Resistance band row", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["resistance band"] },
  { id: "dumbbell-biceps-curl", name: "Dumbbell biceps curl", movementPattern: "pull", primaryMuscles: ["biceps"], equipment: ["dumbbells"] },
  { id: "lat-pulldown", name: "Lat pulldown", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["cable machine"] },
  { id: "assisted-pull-up", name: "Assisted pull-up", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["assisted pull-up machine or resistance band"] },
  { id: "dead-bug", name: "Dead bug", movementPattern: "core", primaryMuscles: ["core"], equipment: [] },
  { id: "front-plank", name: "Front plank", movementPattern: "core", primaryMuscles: ["core", "shoulders"], equipment: [] },
  { id: "side-plank", name: "Side plank", movementPattern: "core", primaryMuscles: ["core", "obliques"], equipment: [] },
  { id: "bird-dog", name: "Bird dog", movementPattern: "core", primaryMuscles: ["core", "back"], equipment: [] },
];

const exercisesById = new Map(exerciseCatalog.map((exercise) => [exercise.id, exercise]));

export function findExerciseById(id: string): ExerciseDefinition | undefined {
  return exercisesById.get(id);
}
