import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { readFile } from "node:fs/promises";
import { and, eq, inArray, ne } from "drizzle-orm";
import { catalogFoods, catalogFoodPortions, catalogFoodSafetyReviews } from "@healthcare/database/schema";
import { db, pool } from "@healthcare/database";
import { foodAllergenTags, foodDietaryTags, validateFoodSafetyTagList } from "@healthcare/domain";

const allowedDataTypes = ["Foundation", "SR Legacy", "Survey (FNDDS)"] as const;
const allowedCategories = ["ingredient", "prepared_meal", "snack", "beverage", "restaurant", "other"] as const;
type AllowedDataType = (typeof allowedDataTypes)[number];
type AllowedCategory = (typeof allowedCategories)[number];
const fnddsSource = "USDA FoodData Central (Survey (FNDDS))";
const fnddsCategoryOverrides: Partial<Record<number, AllowedCategory>> = {
  2707427: "prepared_meal",
  2707429: "snack",
  2707431: "prepared_meal",
  2707432: "prepared_meal",
  2707613: "prepared_meal",
  2707713: "prepared_meal",
  2707714: "prepared_meal",
  2707715: "prepared_meal",
  2708730: "snack",
  2709128: "prepared_meal",
  2709129: "prepared_meal",
  2709130: "snack",
  2710066: "snack",
};

type FnddsFood = {
  dataType?: string;
  description?: string;
  fdcId?: number;
  foodNutrients?: Array<{ nutrient?: { id?: number }; amount?: number }>;
  foodPortions?: Array<{ portionDescription?: string; modifier?: string; gramWeight?: number }>;
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
};

const fnddsAliases: Record<number, string[]> = {
  2707429: ["papad", "papadum", "pappad", "papar"],
  2705686: ["phirni", "firni"],
  2705700: ["burfi", "barfi"],
  2705740: ["paneer", "paneer cheese"],
  2706437: ["chicken curry"],
  2706438: ["chicken curry with rice"],
  2706460: ["fish curry"],
  2706461: ["fish curry with rice"],
  2706490: ["meat biryani"],
  2706538: ["chicken biryani", "chicken biriyani"],
  2707427: ["dal", "daal", "dahl"],
  2707430: ["sambar", "sambhar", "saambar"],
  2707431: ["lentil curry", "dal curry", "daal curry"],
  2707432: ["lentil curry with rice", "dal rice", "daal rice"],
  2707613: ["naan", "nan bread"],
  2707713: ["roti", "chapati", "chapatti", "chappatti", "phulka"],
  2707714: ["puri", "poori"],
  2707715: ["paratha", "parantha"],
  2708346: ["idli", "idly"],
  2708347: ["dosa", "dosai", "thosai", "dosha", "plain dosa"],
  2708730: ["samosa"],
  2708985: ["vegetable biryani", "veg biryani", "vegetable biriyani"],
  2709128: ["uppuma", "uppumavu", "uppittu"],
  2709129: ["dosa with filling", "dosai with filling", "masala dosa", "masala dosai"],
  2709130: ["vadai", "medu vada", "medhu vadai"],
  2709309: ["tamarind chutney", "imli chutney", "sweet tamarind chutney"],
  2709631: ["palak paneer"],
  2709632: ["chana saag", "channa saag", "chana shaag", "channa shaag"],
  2710066: ["pakora", "pakoda", "bhajiya"],
  2710067: ["vegetable curry", "mixed vegetable curry"],
  2710068: ["vegetable curry with rice", "mixed vegetable curry with rice"],
  2710351: ["ladoo", "laddu", "besan ladoo", "besan laddu"],
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

function categoryForFnddsFood(food: FnddsFood): AllowedCategory {
  const override = food.fdcId === undefined ? undefined : fnddsCategoryOverrides[food.fdcId];
  if (override) return override;
  const category = food.wweiaFoodCategory?.wweiaFoodCategoryDescription?.toLocaleLowerCase() ?? "";
  const name = food.description?.toLocaleLowerCase() ?? "";
  const label = `${category} ${name}`;
  if (/\b(?:beverages?|drinks?|coffee|tea|water|juice|smoothies?|liquor|wine|beer|cocktails?|milk shakes?)\b/.test(label)) {
    return "beverage";
  }
  if (/\b(?:snacks?|chips?|cookies?|brownies?|cand(?:y|ies)|desserts?|ice cream|puddings?|pastr(?:y|ies)|cakes?|pies?|doughnuts?|popcorn|crackers?|pretzels?|cereal bars?|nuts and seeds|jams?, syrups?|toppings?)\b/.test(label)) {
    return "snack";
  }
  if (/\b(?:mixed dish(?:es)?|sandwich(?:es)?|pizzas?|burgers?|tacos?|burritos?|soups?|salads?|curr(?:y|ies)|biryanis?|pastas?|noodles?|meals?|dumplings?|sushi|fried rice|pancakes?|waffles?|stir-fry|potato mixtures?|vegetable dishes?)\b/.test(label)) {
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
  const portionSeeds = new Map<number, Array<{ label: string; grams: number }>>();
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
    const portions = new Map<string, { label: string; grams: number }>();
    for (const portion of food.foodPortions ?? []) {
      const label = portion.portionDescription?.trim() || portion.modifier?.trim() || "";
      const grams = Number.isFinite(portion.gramWeight) ? Math.round(portion.gramWeight!) : 0;
      if (!label || label.length > 80 || grams < 1 || grams > 5000) continue;
      portions.set(label.toLocaleLowerCase(), { label, grams });
    }
    if (portions.size) portionSeeds.set(food.fdcId, [...portions.values()]);
  }

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    const portionCount = [...portionSeeds.values()].reduce((total, portions) => total + portions.length, 0);
    console.log(`USDA FNDDS rows: ${surveyFoods.length}; importable generic foods: ${rows.length}; default portions: ${portionCount}; skipped for missing or unsafe macros: ${skippedMissingOrInvalid}.`);
    console.log("Dry run only. No database rows were written.");
    return;
  }

  const imported = await db.transaction(async (tx) => {
    let count = 0;
    const batchSize = 250;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const saved = await tx.insert(catalogFoods).values(rows.slice(offset, offset + batchSize))
        .onConflictDoNothing({ target: [catalogFoods.source, catalogFoods.externalSourceId] })
        .returning({ id: catalogFoods.id });
      count += saved.length;
    }
    let categoryUpdatedCount = 0;
    for (const [fdcId, category] of Object.entries(fnddsCategoryOverrides)) {
      if (!category) continue;
      const updated = await tx.update(catalogFoods).set({ category, updatedAt: new Date() })
        .where(and(
          eq(catalogFoods.source, fnddsSource),
          eq(catalogFoods.externalSourceId, fdcId),
          ne(catalogFoods.category, category),
        ))
        .returning({ id: catalogFoods.id });
      categoryUpdatedCount += updated.length;
    }
    const foodRows = portionSeeds.size ? await tx.select({ id: catalogFoods.id, externalSourceId: catalogFoods.externalSourceId })
      .from(catalogFoods).where(eq(catalogFoods.source, fnddsSource)) : [];
    const idByFdcId = new Map(foodRows.filter((food) => food.externalSourceId !== null)
      .map((food) => [food.externalSourceId!, food.id]));
    const portionRows = [...portionSeeds.entries()].flatMap(([fdcId, portions]) => {
      const foodId = idByFdcId.get(String(fdcId));
      return foodId ? portions.map((portion) => ({
        foodId, label: portion.label, grams: portion.grams, sourceNote: "USDA FoodData Central FNDDS portion weight",
      })) : [];
    });
    let portionCount = 0;
    for (let offset = 0; offset < portionRows.length; offset += batchSize) {
      const saved = await tx.insert(catalogFoodPortions).values(portionRows.slice(offset, offset + batchSize))
        .onConflictDoNothing().returning({ id: catalogFoodPortions.id });
      portionCount += saved.length;
    }
    return { count, portionCount, categoryUpdatedCount };
  });

  console.log(`USDA FNDDS rows: ${surveyFoods.length}; valid foods: ${rows.length}; default portions: ${imported.portionCount}; skipped for missing or unsafe macros: ${skippedMissingOrInvalid}.`);
  console.log(`${imported.count} foods added; ${imported.categoryUpdatedCount} existing source-category labels synchronized; ${rows.length - imported.count} records were already present.`);
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
  const singleId = option("food-id");
  const list = option("food-ids");
  if ((singleId && list) || (!singleId && !list)) {
    throw new Error('Usage: npm run catalog:publish -- --food-id <catalog-uuid> or --food-ids "<uuid>,<uuid>"');
  }
  const rawIds = (list ?? singleId ?? "").split(",").map((value) => value.trim());
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!rawIds.length || rawIds.length > 50 || rawIds.some((id) => !uuidPattern.test(id))) {
    throw new Error("Provide 1–50 unique catalog UUIDs. Nothing was changed.");
  }
  const ids = rawIds.map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new Error("Provide 1–50 unique catalog UUIDs. Nothing was changed.");

  const rows = await db.select({
    id: catalogFoods.id,
    name: catalogFoods.name,
    category: catalogFoods.category,
    calories: catalogFoods.caloriesKcalPer100g,
    protein: catalogFoods.proteinGPer100g,
    carbohydrates: catalogFoods.carbohydrateGPer100g,
    fat: catalogFoods.fatGPer100g,
    source: catalogFoods.source,
    externalSourceId: catalogFoods.externalSourceId,
    active: catalogFoods.active,
    reviewed: catalogFoods.reviewed,
  }).from(catalogFoods).where(inArray(catalogFoods.id, ids));
  const rowsById = new Map(rows.map((food) => [food.id, food]));
  const foods = ids.map((id) => rowsById.get(id)).filter((food) => food !== undefined);
  if (foods.length !== ids.length) throw new Error("One or more catalog foods were not found. Nothing was changed.");
  if (foods.some((food) => food.reviewed)) throw new Error("One or more selected foods are already reviewed. Nothing was changed.");
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Catalog nutrition review requires an interactive terminal. Nothing was changed.");
  }

  console.log(`Check all ${foods.length} catalog record(s) before approving them for shared use:`);
  for (const food of foods) {
    console.log(`\n${food.name} (${food.category})`);
    console.log(`Source: ${food.source}${food.externalSourceId ? `, source record ${food.externalSourceId}` : ""}`);
    console.log(`Per 100 g: ${food.calories} kcal; protein ${food.protein} g; carbohydrate ${food.carbohydrates} g; fat ${food.fat} g.`);
    console.log(`Current state: ${food.active ? "active and searchable" : "unpublished draft"}.`);
  }
  console.log("Reviewed foods become available for general meal planning. Dietary/allergen filters still require separate safety metadata.");

  const expectedConfirmation = foods.length === 1 ? "REVIEW" : `REVIEW ${foods.length}`;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let confirmation: string;
  try {
    confirmation = await terminal.question(`Type ${expectedConfirmation} after checking all displayed descriptions, source records, and macros: `);
  } finally {
    terminal.close();
  }
  if (confirmation.trim() !== expectedConfirmation) {
    console.log("No catalog changes were made.");
    return;
  }

  const reviewedFoods = await db.transaction(async (tx) => {
    const reviewed: Array<{ id: string; name: string }> = [];
    for (const food of foods) {
      const [updated] = await tx.update(catalogFoods).set({ active: true, reviewed: true, updatedAt: new Date() }).where(and(
        eq(catalogFoods.id, food.id),
        eq(catalogFoods.reviewed, false),
        eq(catalogFoods.active, food.active),
        eq(catalogFoods.name, food.name),
        eq(catalogFoods.category, food.category),
        eq(catalogFoods.caloriesKcalPer100g, food.calories),
        eq(catalogFoods.proteinGPer100g, food.protein),
        eq(catalogFoods.carbohydrateGPer100g, food.carbohydrates),
        eq(catalogFoods.fatGPer100g, food.fat),
        eq(catalogFoods.source, food.source),
      )).returning({ id: catalogFoods.id, name: catalogFoods.name });
      if (!updated) throw new Error(`Catalog food changed during review (${food.name}). The batch was rolled back.`);
      reviewed.push(updated);
    }
    return reviewed;
  });
  console.log(`${reviewedFoods.length} reviewed catalog food(s) are active and searchable.`);
}

async function reviewFoodSafety() {
  const id = option("food-id");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Usage: npm run catalog:safety:review -- --food-id <catalog-uuid> --dietary-tags vegetarian,vegan --contains-allergens milk --may-contain-allergens none --source-note SOURCE_NOTE");
  }
  const rawDietary = option("dietary-tags");
  const rawContains = option("contains-allergens");
  const rawMayContain = option("may-contain-allergens");
  const sourceNote = option("source-note")?.trim();
  if (rawDietary === undefined || rawContains === undefined || rawMayContain === undefined || !sourceNote || sourceNote.length > 200) {
    throw new Error("Provide all three tag options (use none for an empty list) and a --source-note of 1–200 characters.");
  }
  const dietaryTags = validateFoodSafetyTagList(rawDietary, foodDietaryTags);
  const containsAllergens = validateFoodSafetyTagList(rawContains, foodAllergenTags);
  const mayContainAllergens = validateFoodSafetyTagList(rawMayContain, foodAllergenTags);
  const overlap = containsAllergens.filter((tag) => mayContainAllergens.includes(tag));
  if (overlap.length) throw new Error("A tag cannot be both contains and may-contain: " + overlap.join(", ") + ".");
  const [food] = await db.select({ id: catalogFoods.id, name: catalogFoods.name, active: catalogFoods.active, reviewed: catalogFoods.reviewed })
    .from(catalogFoods).where(eq(catalogFoods.id, id)).limit(1);
  if (!food || !food.active || !food.reviewed) {
    throw new Error("Publish and nutrition-review this catalog food before adding dietary/allergen metadata.");
  }
  await db.insert(catalogFoodSafetyReviews).values({
    foodId: food.id, dietaryTags, containsAllergens, mayContainAllergens, sourceNote, reviewedAt: new Date(),
  }).onConflictDoUpdate({
    target: catalogFoodSafetyReviews.foodId,
    set: { dietaryTags, containsAllergens, mayContainAllergens, sourceNote, reviewedAt: new Date() },
  });
  console.log(`Reviewed food-safety metadata saved for ${food.name} (${food.id}).`);
  console.log(`Dietary tags: ${dietaryTags.length ? dietaryTags.join(", ") : "none"}; contains: ${containsAllergens.length ? containsAllergens.join(", ") : "none"}; may contain: ${mayContainAllergens.length ? mayContainAllergens.join(", ") : "none"}.`);
  console.log("This is a catalog filter, not a guarantee of allergy safety or cross-contamination control. Check current labels and recipes.");
}

async function main() {
  const action = process.argv[2];
  if (action === "seed-fndds") return await seedFndds();
  if (action === "search") return await searchFoods();
  if (action === "import") return await importFood();
  if (action === "publish") return await publishFood();
  if (action === "aliases") return await updateAliases();
  if (action === "safety-review") return await reviewFoodSafety();
  throw new Error("Use one of: catalog:search, catalog:import, catalog:publish, catalog:aliases, catalog:safety:review.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Catalog operation failed.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
