import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Annotation, Command, END, interrupt, START, StateGraph } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  aiRuns,
  catalogFoods,
  plans,
  userFoods,
  userProfiles,
  userRecords,
} from "@healthcare/database/schema";
import { db, pool } from "@healthcare/database";
import {
  goalSchema,
  mealPlanDataSchema,
  mealPlanEditRequestSchema,
  mealPlanModelOutputSchema,
  profileSchema,
  type GoalRecord,
} from "@healthcare/contracts";
import { env } from "../env.js";

const PROMPT_VERSION = "meal-plan-v1";
const SCHEMA_VERSION = "meal-plan-data-v1";
const MAX_CANDIDATES = 180;
const MIN_CANDIDATES = 20;

export interface MealFoodCandidate {
  id: string;
  source: "shared_catalog" | "personal";
  name: string;
  category: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  sourceNote: string | null;
}

export interface MealPlanningContext {
  startDate: string;
  timezone: string;
  calorieTargetKcal: number;
  macroTargets: GoalRecord["macrosGrams"];
  dietaryPreferences: string[];
  restrictions: string[];
}

type ModelPlan = ReturnType<typeof mealPlanModelOutputSchema.parse>;
type PlanData = ReturnType<typeof mealPlanDataSchema.parse>;
type MealPlanEditInput = ReturnType<typeof mealPlanEditRequestSchema.parse>;
type ApprovalDecision = { decision: "approve" | "reject"; baseEditVersion: number };
type ModelUsage = { inputTokens: number; outputTokens: number };

export function hashMealPlanningContext(context: MealPlanningContext): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

const mealPlanState = Annotation.Root({
  userId: Annotation<string>(),
  runId: Annotation<string>(),
  idempotencyKey: Annotation<string>(),
  groupId: Annotation<string>(),
  planVersion: Annotation<number>(),
  inputHash: Annotation<string>(),
  context: Annotation<MealPlanningContext>(),
  candidates: Annotation<MealFoodCandidate[]>(),
  modelDraft: Annotation<ModelPlan | null>(),
  normalizedPlan: Annotation<PlanData | null>(),
  validationErrors: Annotation<string[]>(),
  repairCount: Annotation<number>(),
  modelUsage: Annotation<ModelUsage>(),
  planId: Annotation<string | null>(),
  decision: Annotation<ApprovalDecision | null>(),
  terminalStatus: Annotation<string | null>(),
});

type MealPlanGraphState = typeof mealPlanState.State;

const approvalResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "baseEditVersion"],
  properties: {
    decision: { type: "string", enum: ["approve", "reject"] },
    baseEditVersion: { type: "integer", minimum: 1 },
  },
} as const;

const modelOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "days"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    days: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "meals"],
        properties: {
          date: { type: "string", format: "date" },
          meals: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["mealType", "items", "note"],
              properties: {
                mealType: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
                items: {
                  type: "array",
                  minItems: 1,
                  maxItems: 6,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["foodId", "quantityGrams"],
                    properties: {
                      foodId: { type: "string", format: "uuid" },
                      quantityGrams: { type: "number", exclusiveMinimum: 0, maximum: 1500 },
                    },
                  },
                },
                note: { type: ["string", "null"], maxLength: 180 },
              },
            },
          },
        },
      },
    },
  },
} as const;

function roundNutrition(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildPrompt(state: MealPlanGraphState): string {
  const candidateLines = state.candidates.map((food) => ({
    id: food.id,
    name: food.name,
    category: food.category,
    per100g: {
      kcal: food.caloriesKcal,
      proteinG: food.proteinG,
      carbohydrateG: food.carbohydrateG,
      fatG: food.fatG,
    },
    source: food.source,
    sourceNote: food.sourceNote,
  }));
  return JSON.stringify({
    instruction: [
      "Create a practical seven-day food plan for a general adult wellness app.",
      "Use only the exact food IDs provided. Do not invent foods, IDs, nutrition values, or portion conversions.",
      "Quantities are grams and must be realistic edible portions. The server calculates all nutrition totals.",
      "Plan meals in the user's timezone, beginning on startDate. Use 3 main meals when possible and snacks only when useful.",
      "Respect the listed preferences. If the candidate list cannot satisfy the request, return a plan using the closest candidates and explain the limitation in meal notes.",
      "Keep each day's estimated calories within 20 percent of the target. Macro values are guidance, not clinical prescriptions.",
      "Give concise practical notes only. No medical claims or weight-loss promises.",
      state.repairCount > 0
        ? `Repair the prior draft. These exact validation errors must be fixed: ${state.validationErrors.join("; ")}`
        : "",
    ].filter(Boolean).join("\n"),
    context: {
      startDate: state.context.startDate,
      timezone: state.context.timezone,
      dailyCaloriesKcal: state.context.calorieTargetKcal,
      macroTargets: state.context.macroTargets,
      dietaryPreferences: state.context.dietaryPreferences,
      restrictions: state.context.restrictions,
    },
    candidates: candidateLines,
  });
}

async function callMealPlanner(state: MealPlanGraphState): Promise<{
  draft: ModelPlan | null;
  errors: string[];
  usage: ModelUsage;
}> {
  if (!env.OPENROUTER_API_KEY) throw new Error("openrouter_not_configured");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      messages: [
        { role: "system", content: "You create compact, structured meal plans from a supplied catalog. Return only schema-conforming JSON." },
        { role: "user", content: buildPrompt(state) },
      ],
      temperature: 0.25,
      max_tokens: 6000,
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: { name: "weekly_meal_plan", strict: true, schema: modelOutputJsonSchema },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`openrouter_http_${response.status}`);
  const body = await response.json() as {
    choices?: Array<{ finish_reason?: string | null; message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = body.choices?.[0];
  const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const usage = {
    inputTokens: Number.isInteger(body.usage?.prompt_tokens) ? body.usage!.prompt_tokens! : 0,
    outputTokens: Number.isInteger(body.usage?.completion_tokens) ? body.usage!.completion_tokens! : 0,
  };
  if (choice?.finish_reason !== "stop" || !content) {
    return { draft: null, errors: ["structured_output_incomplete"], usage };
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { draft: null, errors: ["structured_output_invalid_json"], usage };
  }
  const parsed = mealPlanModelOutputSchema.safeParse(value);
  return parsed.success
    ? { draft: parsed.data, errors: [], usage }
    : { draft: null, errors: ["structured_output_schema_invalid"], usage };
}

function normalizeDraft(state: MealPlanGraphState): { plan: PlanData | null; errors: string[] } {
  if (!state.modelDraft) return { plan: null, errors: state.validationErrors.length ? state.validationErrors : ["draft_missing"] };
  const byId = new Map(state.candidates.map((food) => [food.id, food]));
  const errors: string[] = [];
  const expectedDates = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.parse(`${state.context.startDate}T00:00:00.000Z`) + index * 86_400_000).toISOString().slice(0, 10));
  if (state.modelDraft.days.some((day, index) => day.date !== expectedDates[index])) errors.push("dates_not_consecutive_from_start_date");

  const days = state.modelDraft.days.map((day) => {
    const meals = day.meals.map((meal) => ({
      mealType: meal.mealType,
      note: meal.note,
      items: meal.items.flatMap((item) => {
        const food = byId.get(item.foodId);
        if (!food) {
          errors.push("food_id_not_in_candidate_catalog");
          return [];
        }
        const multiplier = item.quantityGrams / 100;
        const nutritionPer100g = {
          caloriesKcal: food.caloriesKcal,
          proteinG: food.proteinG,
          carbohydrateG: food.carbohydrateG,
          fatG: food.fatG,
        };
        return [{
          foodId: food.id,
          foodSource: food.source,
          foodName: food.name,
          category: food.category,
          quantityGrams: item.quantityGrams,
          nutritionPer100g,
          nutritionTotal: {
            caloriesKcal: roundNutrition(nutritionPer100g.caloriesKcal * multiplier),
            proteinG: roundNutrition(nutritionPer100g.proteinG * multiplier),
            carbohydrateG: roundNutrition(nutritionPer100g.carbohydrateG * multiplier),
            fatG: roundNutrition(nutritionPer100g.fatG * multiplier),
          },
        }];
      }),
    }));
    const totals = meals.flatMap((meal) => meal.items).reduce((total, item) => ({
      caloriesKcal: roundNutrition(total.caloriesKcal + item.nutritionTotal.caloriesKcal),
      proteinG: roundNutrition(total.proteinG + item.nutritionTotal.proteinG),
      carbohydrateG: roundNutrition(total.carbohydrateG + item.nutritionTotal.carbohydrateG),
      fatG: roundNutrition(total.fatG + item.nutritionTotal.fatG),
    }), { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });
    return { date: day.date, meals, totals };
  });
  if (errors.length) return { plan: null, errors: [...new Set(errors)] };

  const parsed = mealPlanDataSchema.safeParse({
    name: state.modelDraft.name,
    startDate: state.context.startDate,
    dailyCalorieTargetKcal: state.context.calorieTargetKcal,
    macroTargetsGrams: state.context.macroTargets ? {
      proteinG: state.context.macroTargets.protein,
      carbohydrateG: state.context.macroTargets.carbohydrate,
      fatG: state.context.macroTargets.fat,
    } : null,
    days,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message);
    return { plan: null, errors: [...new Set(issues)] };
  }
  return { plan: parsed.data, errors: [] };
}

async function withUserTransaction<T>(userId: string, action: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return action(tx);
  });
}

async function createDraft(state: MealPlanGraphState): Promise<string> {
  const planData = state.normalizedPlan;
  if (!planData) throw new Error("meal_plan_missing_validated_data");
  return withUserTransaction(state.userId, async (tx) => {
    const [existing] = await tx.select().from(plans).where(and(
      eq(plans.userId, state.userId), eq(plans.groupId, state.groupId), eq(plans.kind, "meal"),
    )).orderBy(desc(plans.version)).limit(1);
    if (existing && existing.status !== "draft") throw new Error("meal_plan_draft_conflict");
    let planId = existing?.id;
    let version = existing?.version ?? state.planVersion;
    if (!existing) {
      const [saved] = await tx.insert(plans).values({
        userId: state.userId,
        groupId: state.groupId,
        kind: "meal",
        version,
        editVersion: 1,
        status: "draft",
        source: "ai",
        data: planData,
      }).returning({ id: plans.id, version: plans.version });
      if (!saved) throw new Error("meal_plan_save_failed");
      planId = saved.id;
      version = saved.version;
    }
    if (!planId) throw new Error("meal_plan_save_failed");
    await tx.update(aiRuns).set({
      status: "pending_review",
      resultPlanId: planId,
      inputTokens: state.modelUsage.inputTokens,
      outputTokens: state.modelUsage.outputTokens,
      updatedAt: new Date(),
    }).where(and(eq(aiRuns.userId, state.userId), eq(aiRuns.id, state.runId)));
    return planId;
  });
}

async function completeReview(state: MealPlanGraphState): Promise<Partial<MealPlanGraphState>> {
  const decision = state.decision;
  if (!decision) throw new Error("meal_plan_review_decision_missing");
  const planId = state.planId;
  if (!planId) throw new Error("meal_plan_id_missing");

  const result = await withUserTransaction(state.userId, async (tx) => {
    const [run] = await tx.select().from(aiRuns).where(and(
      eq(aiRuns.userId, state.userId), eq(aiRuns.id, state.runId),
    )).for("update").limit(1);
    const [draft] = await tx.select().from(plans).where(and(
      eq(plans.userId, state.userId), eq(plans.id, planId), eq(plans.kind, "meal"), eq(plans.status, "draft"),
    )).for("update").limit(1);
    if (run?.status === "completed") return { status: "completed" as const };
    if (run?.status === "rejected") return { status: "rejected" as const };
    if (!run || run.status !== "pending_review" || !draft || draft.editVersion !== decision.baseEditVersion) {
      if (run?.status === "pending_review") {
        await tx.update(aiRuns).set({ status: "stale", errorCode: "meal_plan_version_conflict", updatedAt: new Date() }).where(eq(aiRuns.id, run.id));
        if (draft?.status === "draft") await tx.update(plans).set({ status: "archived", updatedAt: new Date() }).where(eq(plans.id, draft.id));
      }
      return { status: "stale" as const };
    }
    if (decision.decision === "reject") {
      await tx.update(plans).set({ status: "archived", updatedAt: new Date() }).where(eq(plans.id, draft.id));
      await tx.update(aiRuns).set({ status: "rejected", updatedAt: new Date() }).where(eq(aiRuns.id, run.id));
      return { status: "rejected" as const };
    }

    const validData = mealPlanDataSchema.safeParse(draft.data);
    if (!validData.success) {
      await tx.update(aiRuns).set({ status: "stale", errorCode: "draft_validation_failed", updatedAt: new Date() }).where(eq(aiRuns.id, run.id));
      await tx.update(plans).set({ status: "archived", updatedAt: new Date() }).where(eq(plans.id, draft.id));
      return { status: "stale" as const };
    }
    const profileRows = await tx.select({ data: userProfiles.data }).from(userProfiles)
      .where(eq(userProfiles.userId, state.userId)).limit(1);
    const goalRows = await tx.select({ data: userRecords.data, updatedAt: userRecords.serverUpdatedAt }).from(userRecords).where(and(
      eq(userRecords.userId, state.userId), eq(userRecords.entity, "goal"), eq(userRecords.deleted, false),
    )).orderBy(desc(userRecords.serverUpdatedAt)).limit(1);
    const profile = profileSchema.safeParse(profileRows[0]?.data);
    const goal = goalSchema.safeParse(goalRows[0]?.data);
    const currentContext = profile.success && goal.success ? makeMealPlanningContext(profile.data, goal.data, state.context.startDate) : null;
    if (!currentContext || hashMealPlanningContext(currentContext) !== state.inputHash) {
      await tx.update(aiRuns).set({ status: "stale", errorCode: "planning_inputs_changed", updatedAt: new Date() }).where(eq(aiRuns.id, run.id));
      await tx.update(plans).set({ status: "archived", updatedAt: new Date() }).where(eq(plans.id, draft.id));
      return { status: "stale" as const };
    }
    const now = new Date();
    await tx.update(plans).set({ status: "superseded", updatedAt: now }).where(and(
      eq(plans.userId, state.userId), eq(plans.kind, "meal"), eq(plans.groupId, draft.groupId), eq(plans.status, "active"),
    ));
    const [approved] = await tx.update(plans).set({
      status: "active",
      approvedAt: now,
      updatedAt: now,
    }).where(and(
      eq(plans.userId, state.userId), eq(plans.id, draft.id), eq(plans.status, "draft"), eq(plans.editVersion, decision.baseEditVersion),
    )).returning({ id: plans.id });
    if (!approved) return { status: "stale" as const };
    await tx.update(aiRuns).set({ status: "completed", updatedAt: now }).where(eq(aiRuns.id, run.id));
    return { status: "completed" as const };
  });
  return { decision, terminalStatus: result.status };
}

function makeMealPlanningContext(profile: ReturnType<typeof profileSchema.parse>, goal: GoalRecord, startDate: string): MealPlanningContext {
  let timezone = profile.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    timezone = "UTC";
  }
  return {
    startDate,
    timezone,
    calorieTargetKcal: goal.dailyCaloriesKcal ?? 0,
    macroTargets: goal.macrosGrams,
    dietaryPreferences: [...profile.dietaryPreferences].sort(),
    restrictions: [...profile.restrictions].sort(),
  };
}

async function markFailed(state: MealPlanGraphState): Promise<Partial<MealPlanGraphState>> {
  await withUserTransaction(state.userId, async (tx) => {
    await tx.update(aiRuns).set({
      status: "failed",
      errorCode: state.validationErrors[0] ?? "meal_plan_invalid",
      inputTokens: state.modelUsage.inputTokens,
      outputTokens: state.modelUsage.outputTokens,
      updatedAt: new Date(),
    }).where(and(eq(aiRuns.userId, state.userId), eq(aiRuns.id, state.runId), eq(aiRuns.status, "running")));
  });
  return { terminalStatus: "failed" };
}

async function applyDecision(state: MealPlanGraphState): Promise<Partial<MealPlanGraphState>> {
  const applied = await completeReview(state);
  return applied;
}

const checkpointer = new PostgresSaver(pool, undefined, { schema: "langgraph" });

const mealPlanGraph = new StateGraph(mealPlanState)
  .addNode("generate", async (state) => {
    const response = await callMealPlanner(state);
    return {
      modelDraft: response.draft,
      validationErrors: response.errors,
      modelUsage: {
        inputTokens: state.modelUsage.inputTokens + response.usage.inputTokens,
        outputTokens: state.modelUsage.outputTokens + response.usage.outputTokens,
      },
    };
  })
  .addNode("validate", async (state) => {
    const normalized = normalizeDraft(state);
    return { normalizedPlan: normalized.plan, validationErrors: normalized.errors };
  })
  .addNode("repair", (state) => ({ repairCount: state.repairCount + 1 }))
  .addNode("saveDraft", async (state) => {
    const planId = await createDraft(state);
    return { planId, terminalStatus: "pending_review" };
  })
  .addNode("review", async (state) => {
    const result = await interrupt<unknown, ApprovalDecision>({
      type: "meal_plan_review",
      planId: state.planId,
      baseEditVersion: 1,
    }, { responseSchema: approvalResponseSchema });
    return { decision: result };
  })
  .addNode("applyDecision", applyDecision)
  .addNode("fail", markFailed)
  .addEdge(START, "generate")
  .addEdge("generate", "validate")
  .addConditionalEdges("validate", (state) => {
    if (state.normalizedPlan) return "saveDraft";
    return state.repairCount < 1 ? "repair" : "fail";
  }, ["saveDraft", "repair", "fail"])
  .addEdge("repair", "generate")
  .addEdge("saveDraft", "review")
  .addEdge("review", "applyDecision")
  .addEdge("applyDecision", END)
  .addEdge("fail", END)
  .compile({ checkpointer });

export interface StartMealPlanInput {
  userId: string;
  runId: string;
  idempotencyKey: string;
  groupId: string;
  planVersion: number;
  inputHash: string;
  context: MealPlanningContext;
  candidates: MealFoodCandidate[];
}

export async function runMealPlan(input: StartMealPlanInput): Promise<MealPlanGraphState> {
  return mealPlanGraph.invoke({
    ...input,
    modelDraft: null,
    normalizedPlan: null,
    validationErrors: [],
    repairCount: 0,
    modelUsage: { inputTokens: 0, outputTokens: 0 },
    planId: null,
    decision: null,
    terminalStatus: null,
  }, { configurable: { thread_id: input.runId } });
}

export async function resumeMealPlan(runId: string, decision: ApprovalDecision): Promise<MealPlanGraphState> {
  const snapshot = await mealPlanGraph.getState({ configurable: { thread_id: runId } });
  if (!snapshot.values || !snapshot.values.userId) throw new Error("meal_plan_checkpoint_not_found");
  return mealPlanGraph.invoke(new Command({ resume: decision }), { configurable: { thread_id: runId } });
}

export async function deleteMealPlanningCheckpoint(runId: string): Promise<void> {
  await checkpointer.deleteThread(runId);
}

export async function buildMealPlanningContext(userId: string, startDate: string): Promise<{
  context: MealPlanningContext;
  candidates: MealFoodCandidate[];
}> {
  return withUserTransaction(userId, async (tx) => {
    const [profileRow] = await tx.select({ data: userProfiles.data }).from(userProfiles)
      .where(eq(userProfiles.userId, userId)).limit(1);
    const [goalRow] = await tx.select({ data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId), eq(userRecords.entity, "goal"), eq(userRecords.deleted, false),
    )).orderBy(desc(userRecords.serverUpdatedAt)).limit(1);
    const profile = profileSchema.safeParse(profileRow?.data);
    const goal = goalSchema.safeParse(goalRow?.data);
    if (!profile.success || !goal.success) throw new Error("profile_or_accepted_goal_required");
    if (profile.data.ageYears < 18 || profile.data.pregnancyOrBreastfeeding || profile.data.clinicianDirectedDiet) {
      throw new Error("meal_planning_not_available_for_this_profile");
    }
    if (!goal.data.dailyCaloriesKcal) throw new Error("accepted_calorie_target_required");
    if (profile.data.restrictions.length || profile.data.dietaryPreferences.length) {
      throw new Error("meal_plan_food_metadata_required");
    }
    const context = makeMealPlanningContext(profile.data, goal.data, startDate);
    const catalog = await tx.select({
      id: catalogFoods.id,
      name: catalogFoods.name,
      category: catalogFoods.category,
      calories: catalogFoods.caloriesKcalPer100g,
      protein: catalogFoods.proteinGPer100g,
      carbohydrate: catalogFoods.carbohydrateGPer100g,
      fat: catalogFoods.fatGPer100g,
    }).from(catalogFoods).where(and(eq(catalogFoods.active, true), eq(catalogFoods.reviewed, true)))
      .orderBy(catalogFoods.name).limit(MAX_CANDIDATES);
    const personal = await tx.select({
      id: userFoods.id,
      name: userFoods.name,
      category: userFoods.category,
      calories: userFoods.caloriesKcalPer100g,
      protein: userFoods.proteinGPer100g,
      carbohydrate: userFoods.carbohydrateGPer100g,
      fat: userFoods.fatGPer100g,
      sourceNote: userFoods.sourceNote,
    }).from(userFoods).where(eq(userFoods.userId, userId)).orderBy(userFoods.name).limit(40);
    const candidates: MealFoodCandidate[] = [
      ...catalog.map((food) => ({
        id: food.id, source: "shared_catalog" as const, name: food.name, category: food.category,
        caloriesKcal: Number(food.calories), proteinG: Number(food.protein), carbohydrateG: Number(food.carbohydrate), fatG: Number(food.fat), sourceNote: null,
      })),
      ...personal.map((food) => ({
        id: food.id, source: "personal" as const, name: food.name, category: food.category,
        caloriesKcal: Number(food.calories), proteinG: Number(food.protein), carbohydrateG: Number(food.carbohydrate), fatG: Number(food.fat), sourceNote: food.sourceNote,
      })),
    ].slice(0, MAX_CANDIDATES);
    if (candidates.length < MIN_CANDIDATES) throw new Error("meal_plan_catalog_coverage_insufficient");
    return { context, candidates };
  });
}

export async function recalculateMealPlanEdit(
  userId: string,
  input: MealPlanEditInput,
  dailyCalorieTargetKcal: number,
  macroTargetsGrams: PlanData["macroTargetsGrams"],
): Promise<PlanData> {
  const requestedIds = [...new Set(input.days.flatMap((day) => day.meals.flatMap((meal) => meal.items.map((item) => item.foodId))))];
  if (!requestedIds.length) throw new Error("meal_plan_foods_required");
  return withUserTransaction(userId, async (tx) => {
    const shared = await tx.select({
      id: catalogFoods.id, name: catalogFoods.name, category: catalogFoods.category,
      calories: catalogFoods.caloriesKcalPer100g, protein: catalogFoods.proteinGPer100g,
      carbohydrate: catalogFoods.carbohydrateGPer100g, fat: catalogFoods.fatGPer100g,
    }).from(catalogFoods).where(and(
      inArray(catalogFoods.id, requestedIds), eq(catalogFoods.active, true), eq(catalogFoods.reviewed, true),
    ));
    const personal = await tx.select({
      id: userFoods.id, name: userFoods.name, category: userFoods.category,
      calories: userFoods.caloriesKcalPer100g, protein: userFoods.proteinGPer100g,
      carbohydrate: userFoods.carbohydrateGPer100g, fat: userFoods.fatGPer100g,
    }).from(userFoods).where(and(inArray(userFoods.id, requestedIds), eq(userFoods.userId, userId)));
    const byKey = new Map<string, MealFoodCandidate>();
    for (const food of shared) byKey.set(`shared_catalog:${food.id}`, {
      id: food.id, source: "shared_catalog", name: food.name, category: food.category,
      caloriesKcal: Number(food.calories), proteinG: Number(food.protein), carbohydrateG: Number(food.carbohydrate), fatG: Number(food.fat), sourceNote: null,
    });
    for (const food of personal) byKey.set(`personal:${food.id}`, {
      id: food.id, source: "personal", name: food.name, category: food.category,
      caloriesKcal: Number(food.calories), proteinG: Number(food.protein), carbohydrateG: Number(food.carbohydrate), fatG: Number(food.fat), sourceNote: null,
    });

    const days = input.days.map((day) => {
      const meals = day.meals.map((meal) => ({
        mealType: meal.mealType,
        note: meal.note,
        items: meal.items.map((item) => {
          const food = byKey.get(`${item.foodSource}:${item.foodId}`);
          if (!food) throw new Error("meal_plan_food_not_available");
          const nutritionPer100g = {
            caloriesKcal: food.caloriesKcal,
            proteinG: food.proteinG,
            carbohydrateG: food.carbohydrateG,
            fatG: food.fatG,
          };
          const multiplier = item.quantityGrams / 100;
          return {
            foodId: food.id,
            foodSource: food.source,
            foodName: food.name,
            category: food.category,
            quantityGrams: item.quantityGrams,
            nutritionPer100g,
            nutritionTotal: {
              caloriesKcal: roundNutrition(nutritionPer100g.caloriesKcal * multiplier),
              proteinG: roundNutrition(nutritionPer100g.proteinG * multiplier),
              carbohydrateG: roundNutrition(nutritionPer100g.carbohydrateG * multiplier),
              fatG: roundNutrition(nutritionPer100g.fatG * multiplier),
            },
          };
        }),
      }));
      const totals = meals.flatMap((meal) => meal.items).reduce((total, item) => ({
        caloriesKcal: roundNutrition(total.caloriesKcal + item.nutritionTotal.caloriesKcal),
        proteinG: roundNutrition(total.proteinG + item.nutritionTotal.proteinG),
        carbohydrateG: roundNutrition(total.carbohydrateG + item.nutritionTotal.carbohydrateG),
        fatG: roundNutrition(total.fatG + item.nutritionTotal.fatG),
      }), { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });
      return { date: day.date, meals, totals };
    });
    const parsed = mealPlanDataSchema.safeParse({
      name: input.name,
      startDate: input.startDate,
      dailyCalorieTargetKcal,
      macroTargetsGrams,
      days,
    });
    if (!parsed.success) throw new Error("meal_plan_edit_invalid");
    return parsed.data;
  });
}

export const mealPlanningVersions = { model: env.AI_MODEL, prompt: PROMPT_VERSION, schema: SCHEMA_VERSION };
