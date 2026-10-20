import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { catalogFoods } from "@healthcare/database/schema";
import { db, pool } from "@healthcare/database";

const allowedDataTypes = ["Foundation", "SR Legacy", "Survey (FNDDS)"] as const;
const allowedCategories = ["ingredient", "prepared_meal", "snack", "beverage", "restaurant", "other"] as const;
type AllowedDataType = (typeof allowedDataTypes)[number];

type SearchFood = {
  fdcId: number;
  description: string;
  dataType: string;
  foodCategory?: string;
};

type FoodDetail = {
  fdcId: number;
  description: string;
  dataType: string;
  foodCategory?: { description?: string };
  foodNutrients?: Array<{
    amount?: number;
    value?: number;
    nutrientNumber?: string;
    unitName?: string;
    nutrient?: { number?: string; unitName?: string };
  }>;
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requireApiKey(): string {
  const key = process.env.USDA_API_KEY?.trim();
  if (!key) throw new Error("USDA_API_KEY is missing. Add it to the ignored root .env before running the catalog search/import command.");
  return key;
}

async function fdcRequest<T>(path: string, apiKey: string, query?: URLSearchParams): Promise<T> {
  const params = new URLSearchParams(query);
  params.set("api_key", apiKey);
  let response: Response;
  try {
    response = await fetch(`https://api.nal.usda.gov/fdc/v1/${path}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("FoodData Central request could not complete. Network details and the API key are hidden.");
  }
  if (!response.ok) throw new Error(`FoodData Central request failed with HTTP ${response.status}. The API key is not shown.`);
  return await response.json() as T;
}

async function searchFoods() {
  const query = option("query")?.trim();
  if (!query || query.length > 80) throw new Error('Usage: npm run catalog:search -- --query "cooked lentils"');
  const params = new URLSearchParams({ query, pageSize: "12", dataType: allowedDataTypes.join(",") });
  const result = await fdcRequest<{ foods?: SearchFood[] }>("foods/search", requireApiKey(), params);
  const foods = (result.foods ?? []).filter((food) => allowedDataTypes.includes(food.dataType as AllowedDataType));
  if (!foods.length) {
    console.log("No generic FoodData Central matches were returned. Try another search or add the item as a personal food in the app.");
    return;
  }
  console.log("Choose a matching item by FDC ID; check the description and data type before importing:");
  for (const food of foods) {
    console.log(`${food.fdcId}\t${food.dataType}\t${food.description}\t${food.foodCategory ?? ""}`);
  }
}

function categoryOption(): (typeof allowedCategories)[number] {
  const category = option("category") ?? "ingredient";
  if (!allowedCategories.includes(category as (typeof allowedCategories)[number])) {
    throw new Error(`Category must be one of: ${allowedCategories.join(", ")}.`);
  }
  return category as (typeof allowedCategories)[number];
}

function aliasValues(canonicalName: string): string[] {
  const raw = option("aliases");
  if (!raw) return [];
  const aliases = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (aliases.length > 20 || aliases.some((value) => value.length > 80)) {
    throw new Error("Provide up to 20 catalog aliases, each no longer than 80 characters.");
  }
  const seen = new Set([canonicalName.toLocaleLowerCase()]);
  return aliases.filter((alias) => {
    const key = alias.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nutrientValues(food: FoodDetail) {
  const values = new Map<string, number>();
  for (const entry of food.foodNutrients ?? []) {
    const number = entry.nutrient?.number ?? entry.nutrientNumber;
    const amount = entry.amount ?? entry.value;
    if (number && amount !== undefined && Number.isFinite(amount)) values.set(number, amount);
  }
  const nutrition = {
    calories: values.get("1008"),
    protein: values.get("1003"),
    carbs: values.get("1005"),
    fat: values.get("1004"),
  };
  if (Object.values(nutrition).some((value) => value === undefined)) {
    throw new Error("This FDC entry is missing one or more required nutrients (energy, protein, carbohydrate, fat); it was not imported.");
  }
  const complete = nutrition as Record<keyof typeof nutrition, number>;
  if (complete.calories < 0 || complete.calories > 1000 || [complete.protein, complete.carbs, complete.fat].some((value) => value < 0 || value > 100)) {
    throw new Error("The FDC nutrient values are outside the app's per-100-g safety bounds; it was not imported.");
  }
  return complete;
}

async function importFood() {
  const rawId = option("fdc-id");
  const fdcId = Number(rawId);
  if (!rawId || !Number.isSafeInteger(fdcId) || fdcId <= 0) {
    throw new Error('Usage: npm run catalog:import -- --fdc-id 123456 --category ingredient');
  }
  const apiKey = requireApiKey();
  const food = await fdcRequest<FoodDetail>(`food/${fdcId}`, apiKey);
  if (!allowedDataTypes.includes(food.dataType as AllowedDataType)) {
    throw new Error(`Refusing data type "${food.dataType}". Only generic Foundation, SR Legacy, and Survey foods are allowed.`);
  }
  const nutrition = nutrientValues(food);
  const displayName = option("name")?.trim() || food.description.trim();
  if (!displayName || displayName.length > 120) throw new Error("Display name must contain 1–120 characters.");
  const aliases = aliasValues(displayName);
  const category = categoryOption();
  const source = `USDA FoodData Central (${food.dataType})`;

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: catalogFoods.id, active: catalogFoods.active }).from(catalogFoods).where(and(
      eq(catalogFoods.source, source),
      eq(catalogFoods.externalSourceId, String(fdcId)),
    )).limit(1);
    if (existing) return { status: "existing" as const, ...existing };
    const [saved] = await tx.insert(catalogFoods).values({
      id: randomUUID(),
      name: displayName,
      aliases,
      category,
      caloriesKcalPer100g: String(nutrition.calories),
      proteinGPer100g: String(nutrition.protein),
      carbohydrateGPer100g: String(nutrition.carbs),
      fatGPer100g: String(nutrition.fat),
      source,
      externalSourceId: String(fdcId),
      active: false,
      reviewed: false,
      updatedAt: new Date(),
    }).returning({ id: catalogFoods.id });
    if (!saved) throw new Error("Catalog draft could not be saved.");
    return { status: "draft" as const, id: saved.id, active: false };
  });

  console.log(`${result.status === "draft" ? "Imported as an unpublished draft" : result.active ? "This source item is already published" : "This source item is already waiting for review"}.`);
  console.log(`Catalog ID: ${result.id}`);
  console.log(`Name: ${displayName}`);
  console.log(`Source: ${source}, FDC ID ${fdcId}`);
  console.log(`Per 100 g: ${nutrition.calories} kcal; protein ${nutrition.protein} g; carbohydrate ${nutrition.carbs} g; fat ${nutrition.fat} g.`);
  if (result.status === "draft") console.log(`After reviewing these values, publish with: npm run catalog:publish -- --food-id ${result.id}`);
}

async function updateAliases() {
  const id = option("food-id");
  if (option("aliases") === undefined) {
    throw new Error('Provide --aliases "alias one, alias two". Use an empty value to clear aliases.');
  }
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Usage: npm run catalog:aliases -- --food-id <catalog-uuid> --aliases "dosai, thosai"');
  }
  const [food] = await db.select({ id: catalogFoods.id, name: catalogFoods.name })
    .from(catalogFoods).where(eq(catalogFoods.id, id)).limit(1);
  if (!food) throw new Error("Catalog food not found. No aliases were changed.");
  const aliases = aliasValues(food.name);
  await db.update(catalogFoods).set({ aliases, updatedAt: new Date() }).where(eq(catalogFoods.id, id));
  console.log(`Search aliases updated for ${food.name}: ${aliases.length ? aliases.join(", ") : "none"}.`);
}

async function publishFood() {
  const id = option("food-id");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Usage: npm run catalog:publish -- --food-id <catalog-uuid>");
  }
  const [published] = await db.update(catalogFoods).set({ active: true, reviewed: true, updatedAt: new Date() }).where(and(
    eq(catalogFoods.id, id),
    eq(catalogFoods.active, false),
  )).returning({ id: catalogFoods.id, name: catalogFoods.name });
  if (!published) throw new Error("Unpublished catalog draft not found. Nothing was changed.");
  console.log(`Reviewed catalog entry published: ${published.name} (${published.id}).`);
}

async function main() {
  const action = process.argv[2];
  if (action === "search") return await searchFoods();
  if (action === "import") return await importFood();
  if (action === "publish") return await publishFood();
  if (action === "aliases") return await updateAliases();
  throw new Error("Use one of: catalog:search, catalog:import, catalog:publish, catalog:aliases.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Catalog operation failed.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
