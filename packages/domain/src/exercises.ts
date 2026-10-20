export type ExerciseDefinition = {
  id: string;
  name: string;
  movementPattern: "squat" | "hinge" | "lunge" | "push" | "pull" | "core" | "calf";
  primaryMuscles: string[];
  equipment: string[];
  trackingMode: "reps" | "time";
  techniqueCue: string;
  easierAlternativeId?: string;
  typicalRestSeconds: number;
};

export const EXERCISE_CATALOG_VERSION = "starter-v2";

export const exerciseCatalog: readonly ExerciseDefinition[] = [
  { id: "bodyweight-squat", name: "Bodyweight squat", movementPattern: "squat", primaryMuscles: ["quads", "glutes"], equipment: [], trackingMode: "reps", techniqueCue: "Keep your whole foot grounded and use a comfortable depth.", typicalRestSeconds: 60 },
  { id: "box-squat", name: "Box squat", movementPattern: "squat", primaryMuscles: ["quads", "glutes"], equipment: ["stable bench or box"], trackingMode: "reps", techniqueCue: "Reach your hips back to the box, touch lightly, then stand.", easierAlternativeId: "bodyweight-squat", typicalRestSeconds: 60 },
  { id: "goblet-squat", name: "Goblet squat", movementPattern: "squat", primaryMuscles: ["quads", "glutes"], equipment: ["dumbbell or kettlebell"], trackingMode: "reps", techniqueCue: "Hold the weight close and keep your knees in line with your toes.", easierAlternativeId: "bodyweight-squat", typicalRestSeconds: 90 },
  { id: "dumbbell-squat", name: "Dumbbell squat", movementPattern: "squat", primaryMuscles: ["quads", "glutes"], equipment: ["dumbbells"], trackingMode: "reps", techniqueCue: "Hold weights at your sides and keep the movement controlled.", easierAlternativeId: "goblet-squat", typicalRestSeconds: 90 },
  { id: "barbell-back-squat", name: "Barbell back squat", movementPattern: "squat", primaryMuscles: ["quads", "glutes"], equipment: ["barbell", "rack"], trackingMode: "reps", techniqueCue: "Use safeties and a load you can control through your chosen range.", easierAlternativeId: "goblet-squat", typicalRestSeconds: 150 },
  { id: "leg-press", name: "Leg press", movementPattern: "squat", primaryMuscles: ["quads", "glutes"], equipment: ["leg press machine"], trackingMode: "reps", techniqueCue: "Keep your back against the pad and avoid locking your knees.", easierAlternativeId: "bodyweight-squat", typicalRestSeconds: 120 },
  { id: "split-squat", name: "Split squat", movementPattern: "lunge", primaryMuscles: ["quads", "glutes"], equipment: [], trackingMode: "reps", techniqueCue: "Keep a stable stance and lower only as far as comfortable.", easierAlternativeId: "box-squat", typicalRestSeconds: 75 },
  { id: "reverse-lunge", name: "Reverse lunge", movementPattern: "lunge", primaryMuscles: ["quads", "glutes"], equipment: [], trackingMode: "reps", techniqueCue: "Step back under control and keep your front foot planted.", easierAlternativeId: "split-squat", typicalRestSeconds: 75 },
  { id: "walking-lunge", name: "Walking lunge", movementPattern: "lunge", primaryMuscles: ["quads", "glutes"], equipment: [], trackingMode: "reps", techniqueCue: "Take short, steady steps and keep your torso balanced.", easierAlternativeId: "reverse-lunge", typicalRestSeconds: 90 },
  { id: "step-up", name: "Step-up", movementPattern: "lunge", primaryMuscles: ["quads", "glutes"], equipment: ["low stable step"], trackingMode: "reps", techniqueCue: "Use a low step and rise without pushing off hard from the trailing foot.", easierAlternativeId: "split-squat", typicalRestSeconds: 75 },
  { id: "glute-bridge", name: "Glute bridge", movementPattern: "hinge", primaryMuscles: ["glutes", "hamstrings"], equipment: [], trackingMode: "reps", techniqueCue: "Press through your feet and stop when your hips are level.", typicalRestSeconds: 60 },
  { id: "hip-thrust", name: "Hip thrust", movementPattern: "hinge", primaryMuscles: ["glutes", "hamstrings"], equipment: ["stable bench"], trackingMode: "reps", techniqueCue: "Keep your ribs down and finish by squeezing your glutes.", easierAlternativeId: "glute-bridge", typicalRestSeconds: 90 },
  { id: "dumbbell-romanian-deadlift", name: "Dumbbell Romanian deadlift", movementPattern: "hinge", primaryMuscles: ["hamstrings", "glutes"], equipment: ["dumbbells"], trackingMode: "reps", techniqueCue: "Push hips back with a soft knee bend; keep the weights close.", easierAlternativeId: "glute-bridge", typicalRestSeconds: 90 },
  { id: "barbell-romanian-deadlift", name: "Barbell Romanian deadlift", movementPattern: "hinge", primaryMuscles: ["hamstrings", "glutes"], equipment: ["barbell"], trackingMode: "reps", techniqueCue: "Hinge at the hips and stop before your back position changes.", easierAlternativeId: "dumbbell-romanian-deadlift", typicalRestSeconds: 120 },
  { id: "hamstring-curl", name: "Hamstring curl", movementPattern: "hinge", primaryMuscles: ["hamstrings"], equipment: ["hamstring curl machine"], trackingMode: "reps", techniqueCue: "Move smoothly and avoid swinging the weight.", easierAlternativeId: "glute-bridge", typicalRestSeconds: 75 },
  { id: "standing-calf-raise", name: "Standing calf raise", movementPattern: "calf", primaryMuscles: ["calves"], equipment: [], trackingMode: "reps", techniqueCue: "Rise and lower through a comfortable range without bouncing.", typicalRestSeconds: 45 },
  { id: "seated-calf-raise", name: "Seated calf raise", movementPattern: "calf", primaryMuscles: ["calves"], equipment: ["seated calf raise machine"], trackingMode: "reps", techniqueCue: "Pause briefly at the top and lower with control.", easierAlternativeId: "standing-calf-raise", typicalRestSeconds: 45 },
  { id: "wall-push-up", name: "Wall push-up", movementPattern: "push", primaryMuscles: ["chest", "shoulders", "triceps"], equipment: ["wall"], trackingMode: "reps", techniqueCue: "Keep your body aligned and bring your chest toward the wall.", typicalRestSeconds: 60 },
  { id: "incline-push-up", name: "Incline push-up", movementPattern: "push", primaryMuscles: ["chest", "shoulders", "triceps"], equipment: ["stable bench or surface"], trackingMode: "reps", techniqueCue: "Use a stable raised surface and keep your body in one line.", easierAlternativeId: "wall-push-up", typicalRestSeconds: 60 },
  { id: "push-up", name: "Push-up", movementPattern: "push", primaryMuscles: ["chest", "shoulders", "triceps"], equipment: [], trackingMode: "reps", techniqueCue: "Keep your body aligned and lower with control.", easierAlternativeId: "incline-push-up", typicalRestSeconds: 75 },
  { id: "dumbbell-floor-press", name: "Dumbbell floor press", movementPattern: "push", primaryMuscles: ["chest", "triceps"], equipment: ["dumbbells"], trackingMode: "reps", techniqueCue: "Keep wrists stacked over elbows and lower until upper arms touch the floor.", easierAlternativeId: "incline-push-up", typicalRestSeconds: 90 },
  { id: "dumbbell-bench-press", name: "Dumbbell bench press", movementPattern: "push", primaryMuscles: ["chest", "triceps"], equipment: ["dumbbells", "bench"], trackingMode: "reps", techniqueCue: "Lower the weights under control and keep wrists steady.", easierAlternativeId: "dumbbell-floor-press", typicalRestSeconds: 90 },
  { id: "barbell-bench-press", name: "Barbell bench press", movementPattern: "push", primaryMuscles: ["chest", "triceps"], equipment: ["barbell", "bench", "rack"], trackingMode: "reps", techniqueCue: "Use a spotter or safeties and keep both feet supported.", easierAlternativeId: "dumbbell-floor-press", typicalRestSeconds: 150 },
  { id: "machine-chest-press", name: "Machine chest press", movementPattern: "push", primaryMuscles: ["chest", "triceps"], equipment: ["chest press machine"], trackingMode: "reps", techniqueCue: "Set the seat so handles begin near mid-chest; press smoothly.", easierAlternativeId: "wall-push-up", typicalRestSeconds: 90 },
  { id: "dumbbell-overhead-press", name: "Dumbbell overhead press", movementPattern: "push", primaryMuscles: ["shoulders", "triceps"], equipment: ["dumbbells"], trackingMode: "reps", techniqueCue: "Press overhead without leaning back; use a comfortable range.", easierAlternativeId: "wall-push-up", typicalRestSeconds: 90 },
  { id: "barbell-overhead-press", name: "Barbell overhead press", movementPattern: "push", primaryMuscles: ["shoulders", "triceps"], equipment: ["barbell"], trackingMode: "reps", techniqueCue: "Brace gently and keep the bar path controlled over your base.", easierAlternativeId: "dumbbell-overhead-press", typicalRestSeconds: 120 },
  { id: "dumbbell-lateral-raise", name: "Dumbbell lateral raise", movementPattern: "push", primaryMuscles: ["shoulders"], equipment: ["dumbbells"], trackingMode: "reps", techniqueCue: "Use light weights and lift only to a comfortable height.", easierAlternativeId: "wall-push-up", typicalRestSeconds: 60 },
  { id: "dumbbell-triceps-extension", name: "Dumbbell triceps extension", movementPattern: "push", primaryMuscles: ["triceps"], equipment: ["dumbbell"], trackingMode: "reps", techniqueCue: "Keep upper arms steady and move through a comfortable range.", easierAlternativeId: "wall-push-up", typicalRestSeconds: 60 },
  { id: "cable-triceps-pushdown", name: "Cable triceps pushdown", movementPattern: "push", primaryMuscles: ["triceps"], equipment: ["cable machine"], trackingMode: "reps", techniqueCue: "Keep elbows close to your sides and avoid swinging.", easierAlternativeId: "dumbbell-triceps-extension", typicalRestSeconds: 60 },
  { id: "one-arm-dumbbell-row", name: "One-arm dumbbell row", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["dumbbell", "stable support"], trackingMode: "reps", techniqueCue: "Support yourself and pull the weight toward your hip without twisting.", easierAlternativeId: "resistance-band-row", typicalRestSeconds: 75 },
  { id: "bent-over-dumbbell-row", name: "Bent-over dumbbell row", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["dumbbells"], trackingMode: "reps", techniqueCue: "Hinge at the hips and keep your torso steady as you row.", easierAlternativeId: "one-arm-dumbbell-row", typicalRestSeconds: 90 },
  { id: "chest-supported-dumbbell-row", name: "Chest-supported dumbbell row", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["dumbbells", "incline bench"], trackingMode: "reps", techniqueCue: "Keep your chest supported and draw elbows back smoothly.", easierAlternativeId: "resistance-band-row", typicalRestSeconds: 90 },
  { id: "resistance-band-row", name: "Resistance band row", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["resistance band", "secure anchor"], trackingMode: "reps", techniqueCue: "Secure the band first and row without leaning back.", easierAlternativeId: "prone-y-raise", typicalRestSeconds: 60 },
  { id: "prone-y-raise", name: "Prone Y raise", movementPattern: "pull", primaryMuscles: ["upper back", "shoulders"], equipment: [], trackingMode: "reps", techniqueCue: "Lie face down and lift arms gently in a Y shape.", typicalRestSeconds: 45 },
  { id: "seated-cable-row", name: "Seated cable row", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["cable machine"], trackingMode: "reps", techniqueCue: "Sit tall and pull toward your torso without rocking.", easierAlternativeId: "resistance-band-row", typicalRestSeconds: 90 },
  { id: "lat-pulldown", name: "Lat pulldown", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["cable machine"], trackingMode: "reps", techniqueCue: "Pull toward your upper chest while keeping the motion controlled.", easierAlternativeId: "resistance-band-row", typicalRestSeconds: 90 },
  { id: "assisted-pull-up", name: "Assisted pull-up", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["assisted pull-up machine or resistance band"], trackingMode: "reps", techniqueCue: "Use enough assistance to keep each repetition controlled.", easierAlternativeId: "lat-pulldown", typicalRestSeconds: 120 },
  { id: "pull-up", name: "Pull-up", movementPattern: "pull", primaryMuscles: ["back", "biceps"], equipment: ["pull-up bar"], trackingMode: "reps", techniqueCue: "Start from a stable hang and avoid swinging through repetitions.", easierAlternativeId: "assisted-pull-up", typicalRestSeconds: 120 },
  { id: "band-pull-apart", name: "Band pull-apart", movementPattern: "pull", primaryMuscles: ["upper back", "shoulders"], equipment: ["resistance band"], trackingMode: "reps", techniqueCue: "Keep shoulders relaxed and separate the band without arching.", easierAlternativeId: "prone-y-raise", typicalRestSeconds: 45 },
  { id: "dumbbell-biceps-curl", name: "Dumbbell biceps curl", movementPattern: "pull", primaryMuscles: ["biceps"], equipment: ["dumbbells"], trackingMode: "reps", techniqueCue: "Keep elbows near your sides and lower the weights slowly.", easierAlternativeId: "resistance-band-row", typicalRestSeconds: 60 },
  { id: "hammer-curl", name: "Hammer curl", movementPattern: "pull", primaryMuscles: ["biceps", "forearms"], equipment: ["dumbbells"], trackingMode: "reps", techniqueCue: "Keep palms facing inward and avoid using body swing.", easierAlternativeId: "dumbbell-biceps-curl", typicalRestSeconds: 60 },
  { id: "dead-bug", name: "Dead bug", movementPattern: "core", primaryMuscles: ["core"], equipment: [], trackingMode: "reps", techniqueCue: "Move one side at a time and keep your back comfortable against the floor.", typicalRestSeconds: 45 },
  { id: "front-plank", name: "Front plank", movementPattern: "core", primaryMuscles: ["core", "shoulders"], equipment: [], trackingMode: "time", techniqueCue: "Keep a steady line from shoulders to hips; stop before your form changes.", easierAlternativeId: "dead-bug", typicalRestSeconds: 45 },
  { id: "side-plank", name: "Side plank", movementPattern: "core", primaryMuscles: ["core", "obliques"], equipment: [], trackingMode: "time", techniqueCue: "Stack your shoulders and keep your hips lifted only as comfortably as possible.", easierAlternativeId: "dead-bug", typicalRestSeconds: 45 },
  { id: "bird-dog", name: "Bird dog", movementPattern: "core", primaryMuscles: ["core", "back"], equipment: [], trackingMode: "reps", techniqueCue: "Reach opposite arm and leg while keeping your trunk steady.", typicalRestSeconds: 45 },
  { id: "crunch", name: "Crunch", movementPattern: "core", primaryMuscles: ["core"], equipment: [], trackingMode: "reps", techniqueCue: "Lift your shoulders gently and avoid pulling on your neck.", easierAlternativeId: "dead-bug", typicalRestSeconds: 45 },
  { id: "reverse-crunch", name: "Reverse crunch", movementPattern: "core", primaryMuscles: ["core"], equipment: [], trackingMode: "reps", techniqueCue: "Curl your pelvis gently; avoid swinging your legs.", easierAlternativeId: "dead-bug", typicalRestSeconds: 45 },
];

const exercisesById = new Map(exerciseCatalog.map((exercise) => [exercise.id, exercise]));

export function findExerciseById(id: string): ExerciseDefinition | undefined {
  return exercisesById.get(id);
}

const equipmentAliases: Record<string, string[]> = {
  dumbbell: ["dumbbell", "dumbbells", "adjustable dumbbells", "free weights"],
  kettlebell: ["kettlebell", "kettlebells"],
  barbell: ["barbell", "barbells", "olympic bar"],
  rack: ["rack", "squat rack", "power rack"],
  bench: ["bench", "stable bench", "adjustable bench"],
  box: ["box", "plyo box"],
  "resistance band": ["resistance band", "resistance bands", "bands", "band"],
  "cable machine": ["cable machine", "cables", "cable station"],
  "leg press machine": ["leg press machine", "leg press"],
  "hamstring curl machine": ["hamstring curl machine", "hamstring curl"],
  "seated calf raise machine": ["seated calf raise machine", "calf raise machine"],
  "pull-up bar": ["pull-up bar", "pullup bar", "chin-up bar"],
  "assisted pull-up machine": ["assisted pull-up machine", "assisted pullup machine"],
  step: ["step", "stairs", "stable step"],
  wall: ["wall"],
  chair: ["chair", "stable chair"],
  table: ["table", "stable table"],
};

export function canonicalizeEquipment(values: string[]): string[] {
  const text = values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && !/^(no|none|without)\b/.test(value))
    .join(" | ");
  return Object.entries(equipmentAliases)
    .filter(([, aliases]) => aliases.some((alias) => text.includes(alias)))
    .map(([name]) => name)
    .sort();
}

function equipmentRequirementMet(requirement: string, available: Set<string>): boolean {
  return requirement.toLowerCase().split(/\s+or\s+/).some((alternative) => {
    const phrase = alternative.trim();
    if (phrase.includes("stable support") || phrase === "surface") {
      return ["bench", "box", "chair", "table"].some((item) => available.has(item));
    }
    return Object.entries(equipmentAliases).some(([name, aliases]) =>
      available.has(name) && aliases.some((alias) => phrase.includes(alias) || alias.includes(phrase)));
  });
}

export function isExerciseAvailable(exercise: ExerciseDefinition, equipment: string[]): boolean {
  const owned = new Set(equipment);
  return exercise.equipment.every((requirement) => equipmentRequirementMet(requirement, owned));
}
