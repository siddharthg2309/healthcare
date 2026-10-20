import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { catalogFoods } from "@healthcare/database/schema";
import { db, pool } from "@healthcare/database";

const allowedDataTypes = ["Foundation", "SR Legacy", "Survey (FNDDS)"] as const;
const allowedCategories = ["ingredient", "prepared_meal", "snack", "beverage", "restaurant", "other"] as const;
type AllowedDataType = (typeof allowedDataTypes)[number];
const fnddsSource = "USDA FoodData Central (Survey (FNDDS))";

type FnddsFood = {
  dataType?: string;
  description?: string;
  fdcId?: number;
  foodNutrients?: Array<{ nutrient?: { id?: number }; amount?: number }>;
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
};

const fnddsAliases: Record<number, string[]> = {
  2705686: ["phirni", "firni"],
  2705700: ["burfi", "barfi"],
  2705740: ["paneer", "paneer cheese"],
  2706437: ["chicken curry"],
  2706438: ["chicken curry with rice"],
  2706460: ["fish curry"],
  2706461: ["fish curry with rice"],
  2706490: ["meat biryani", "mutton biryani"],
  2706538: ["chicken biryani", "chicken biriyani"],
  2707427: ["dal", "daal", "dahl"],
  2707430: ["sambar", "sambhar"],
  2707431: ["lentil curry", "dal curry", "daal curry"],
  2707432: ["lentil curry with rice", "dal rice", "daal rice"],
  2707613: ["naan", "nan bread"],
  2707713: ["roti", "chapati", "chapatti", "chappatti", "phulka"],
  2707714: ["puri", "poori"],
  2707715: ["paratha", "parantha"],
  2708346: ["idli", "idly"],
  2708347: ["dosa", "dosai", "thosai", "plain dosa"],
  2708730: ["samosa"],
  2708985: ["vegetable biryani", "veg biryani", "vegetable biriyani"],
  2709129: ["dosa with filling", "dosai with filling"],
  2709631: ["palak paneer"],
  2710066: ["pakora", "pakoda", "bhajiya"],
  2710067: ["vegetable curry", "mixed vegetable curry"],
  2710068: ["vegetable curry with rice", "mixed vegetable curry with rice"],
};

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

function categoryForFnddsFood(food: FnddsFood): (typeof allowedCategories)[number] {
  const category = food.wweiaFoodCategory?.wweiaFoodCategoryDescription?.toLocaleLowerCase() ?? "";
  const name = food.description?.toLocaleLowerCase() ?? "";
  const label = `${category} ${name}`;
  if (/\b(?:beverages?|drinks?|coffee|tea|water|juice|smoothies?|liquor|wine|beer|cocktails?|milk shakes?)\b/.test(label)) {
    return "beverage";
  }
  if (/\b(?:snacks?|chips?|cookies?|brownies?|cand(?:y|ies)|desserts?|ice cream|puddings?|pastr(?:y|ies)|cakes?|pies?|doughnuts?|popcorn|crackers?|pretzels?|cereal bars?|nuts and seeds|jams?, syrups?|toppings?)\b/.test(label)) {
    return "snack";
  }
  if (/\b(?:mixed dish(?:es)?|sandwich(?:es)?|pizzas?|burgers?|tacos?|burritos?|soups?|salads?|curries?|biryanis?|pastas?|noodles?|meals?|dumplings?|sushi|fried rice|pancakes?|waffles?|stir-fry|potato mixtures?|vegetable dishes?)\b/.test(label)) {
    return "prepared_meal";
  }
  return "ingredient";
}

function fnddsNutrition(food: FnddsFood): { calories: number; protein: number; carbs: number; fat: number } | null {
  const values = new Map<number, number>();
  for (const nutrient of food.foodNutrients ?? []) {
    const id = nutrient.nutrient?.id;
    if (id !== undefined && nutrient.amount !== undefined && Number.isFinite(nutrient.amount)) {
      values.set(id, nutrient.amount);
    }
  }
  const nutrition = {
    calories: values.get(1008),
    protein: values.get(1003),
    carbs: values.get(1005),
    fat: values.get(1004),
  };
  if (Object.values(nutrition).some((value) => value === undefined)) return null;
  const complete = nutrition as Record<keyof typeof nutrition, number>;
  if (complete.calories < 0 || complete.calories > 1000 || [complete.protein, complete.carbs, complete.fat].some((value) => value < 0 || value > 100)) {
    return null;
  }
  return complete;
}

async function seedFndds() {
  const filePath = option("file");
  if (!filePath) {
    throw new Error('Usage: npm run catalog:seed:fndds -- --file /path/to/surveyDownload.json [--dry-run]. Download the USDA FNDDS JSON archive and extract surveyDownload.json first.');
  }

  let source: unknown;
  try {
    source = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    throw new Error("The supplied catalog file could not be read as JSON. No foods were imported.");
  }
  if (!source || typeof source !== "object" || !Array.isArray((source as { SurveyFoods?: unknown }).SurveyFoods)) {
    throw new Error("Expected the USDA FNDDS surveyDownload.json file with a SurveyFoods array. No foods were imported.");
  }

  const surveyFoods = (source as { SurveyFoods: FnddsFood[] }).SurveyFoods;
  if (surveyFoods.length < 1000 || surveyFoods.length > 100_000) {
    throw new Error("The SurveyFoods array size is outside the expected USDA FNDDS bounds. No foods were imported.");
  }

  const rows: Array<typeof catalogFoods.$inferInsert> = [];
  const seenIds = new Set<number>();
  let skippedMissingOrInvalid = 0;
  for (const food of surveyFoods) {
    if (food.dataType !== "Survey (FNDDS)" || !Number.isSafeInteger(food.fdcId) || !food.fdcId || seenIds.has(food.fdcId)) {
      throw new Error("The source file contains an unexpected data type, invalid FDC ID, or duplicate ID. No foods were imported.");
    }
    seenIds.add(food.fdcId);
    const name = food.description?.trim();
    const nutrition = fnddsNutrition(food);
    if (!name || name.length > 240 || !nutrition) {
      skippedMissingOrInvalid += 1;
      continue;
    }
    const aliases = fnddsAliases[food.fdcId] ?? [];
    const normalizedAliases = [...new Map(aliases.map((alias) => [alias.toLocaleLowerCase(), alias])).values()]
      .filter((alias) => alias.toLocaleLowerCase() !== name.toLocaleLowerCase());
    rows.push({
      name,
      aliases: normalizedAliases,
      category: categoryForFnddsFood(food),
      caloriesKcalPer100g: nutrition.calories.toFixed(2),
      proteinGPer100g: nutrition.protein.toFixed(2),
      carbohydrateGPer100g: nutrition.carbs.toFixed(2),
      fatGPer100g: nutrition.fat.toFixed(2),
      source: fnddsSource,
      externalSourceId: String(food.fdcId),
      reviewed: false,
      active: true,
    });
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log(`USDA FNDDS rows: ${surveyFoods.length}; importable generic foods: ${rows.length}; skipped for missing or unsafe macros: ${skippedMissingOrInvalid}.`);
    console.log("Dry run only. No database rows were written.");
    return;
  }

  const inserted = await db.transaction(async (tx) => {
    let count = 0;
    const batchSize = 250;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const saved = await tx.insert(catalogFoods).values(rows.slice(offset, offset + batchSize))
        .onConflictDoNothing({ target: [catalogFoods.source, catalogFoods.externalSourceId] })
        .returning({ id: catalogFoods.id });
      count += saved.length;
    }
    return count;
  });

  console.log(`USDA FNDDS rows: ${surveyFoods.length}; valid foods: ${rows.length}; skipped for missing or unsafe macros: ${skippedMissingOrInvalid}.`);
  console.log(`${inserted} foods added to the shared catalog; ${rows.length - inserted} already existed and were left unchanged.`);
  console.log("Imported foods are available for manual logging and remain marked not reviewed; they are excluded from AI meal-plan candidates until reviewed and published.");
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
  if (action === "seed-fndds") return await seedFndds();
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
