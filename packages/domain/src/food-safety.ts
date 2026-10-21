export const foodDietaryTags = [
  "vegetarian",
  "vegan",
  "pescatarian",
  "gluten_free",
  "dairy_free",
] as const;

export const foodAllergenTags = [
  "celery",
  "crustaceans",
  "eggs",
  "fish",
  "gluten_cereals",
  "lupin",
  "milk",
  "molluscs",
  "mustard",
  "peanuts",
  "sesame",
  "soybeans",
  "sulphites",
  "tree_nuts",
] as const;

export type FoodDietaryTag = (typeof foodDietaryTags)[number];
export type FoodAllergenTag = (typeof foodAllergenTags)[number];

export interface FoodSafetyMetadata {
  dietaryTags: readonly FoodDietaryTag[];
  containsAllergens: readonly FoodAllergenTag[];
  mayContainAllergens: readonly FoodAllergenTag[];
}

export interface FoodSafetyRequirements {
  dietaryTags: FoodDietaryTag[];
  avoidAllergens: FoodAllergenTag[];
  unsupportedRestrictions: string[];
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsPhrase(value: string, phrase: string): boolean {
  return (" " + normalize(value) + " ").includes(" " + phrase + " ");
}

const dietaryAliases: Record<FoodDietaryTag, string[]> = {
  vegetarian: ["vegetarian", "veg", "lacto ovo vegetarian", "ovo lacto vegetarian"],
  vegan: ["vegan"],
  pescatarian: ["pescatarian"],
  gluten_free: ["gluten free", "glutenfree", "celiac safe"],
  dairy_free: ["dairy free", "dairyfree", "non dairy"],
};

const allergenAliases: Record<FoodAllergenTag, string[]> = {
  celery: ["celery"],
  crustaceans: ["crustacean", "crustaceans", "shrimp", "prawn", "crab", "lobster", "crayfish"],
  eggs: ["egg", "eggs"],
  fish: ["fish"],
  gluten_cereals: ["gluten", "wheat", "barley", "rye", "gluten cereals", "gluten cereal"],
  lupin: ["lupin", "lupine"],
  milk: ["milk", "dairy", "lactose", "casein", "whey"],
  molluscs: ["mollusc", "molluscs", "mollusk", "mollusks", "clam", "mussel", "oyster", "squid", "octopus"],
  mustard: ["mustard"],
  peanuts: ["peanut", "peanuts", "groundnut", "groundnuts"],
  sesame: ["sesame", "tahini"],
  soybeans: ["soy", "soya", "soybean", "soybeans"],
  sulphites: ["sulphite", "sulphites", "sulfite", "sulfites", "sulfur dioxide", "sulphur dioxide"],
  tree_nuts: ["tree nut", "tree nuts", "almond", "cashew", "walnut", "pistachio", "hazelnut", "pecan", "macadamia", "brazil nut"],
};

const groupedAllergenAliases: Array<{ tags: FoodAllergenTag[]; aliases: string[] }> = [
  { tags: ["crustaceans", "molluscs", "fish"], aliases: ["seafood"] },
  { tags: ["crustaceans", "molluscs"], aliases: ["shellfish"] },
  { tags: ["peanuts", "tree_nuts"], aliases: ["nuts"] },
];

const noRestrictionStatements = new Set([
  "none",
  "no restrictions",
  "no dietary restrictions",
  "no known restrictions",
  "no allergies",
  "no known allergies",
  "no food allergies",
  "no food restrictions",
]);

export function deriveFoodSafetyRequirements(
  dietaryPreferences: readonly string[],
  restrictions: readonly string[],
): FoodSafetyRequirements {
  const dietaryTags = new Set<FoodDietaryTag>();
  for (const preference of dietaryPreferences) {
    const normalizedPreference = normalize(preference);
    if (/\b(?:not|non)\s+(?:strictly\s+)?(?:vegetarian|veg|vegan|pescatarian|gluten free|glutenfree|celiac safe|dairy free|dairyfree|non dairy)\b/.test(normalizedPreference)) {
      continue;
    }
    for (const tag of foodDietaryTags) {
      if (dietaryAliases[tag].some((alias) => containsPhrase(preference, alias))) dietaryTags.add(tag);
    }
  }

  const avoidAllergens = new Set<FoodAllergenTag>();
  const unsupportedRestrictions: string[] = [];
  for (const restriction of restrictions) {
    if (noRestrictionStatements.has(normalize(restriction))) continue;
    const matches = new Set<FoodAllergenTag>();
    for (const tag of foodAllergenTags) {
      if (allergenAliases[tag].some((alias) => containsPhrase(restriction, alias))) matches.add(tag);
    }
    for (const group of groupedAllergenAliases) {
      if (group.aliases.some((alias) => containsPhrase(restriction, alias))) {
        for (const tag of group.tags) matches.add(tag);
      }
    }
    if (matches.size === 0) unsupportedRestrictions.push(restriction);
    else for (const tag of matches) avoidAllergens.add(tag);
  }

  return {
    dietaryTags: [...dietaryTags].sort(),
    avoidAllergens: [...avoidAllergens].sort(),
    unsupportedRestrictions,
  };
}

export function isFoodAllowedByReviewedMetadata(
  metadata: FoodSafetyMetadata | null,
  requirements: Pick<FoodSafetyRequirements, "dietaryTags" | "avoidAllergens">,
): boolean {
  if (!metadata) return requirements.dietaryTags.length === 0 && requirements.avoidAllergens.length === 0;

  const availableDietaryTags = new Set(metadata.dietaryTags);
  const listedAllergens = new Set([...metadata.containsAllergens, ...metadata.mayContainAllergens]);
  if (availableDietaryTags.has("vegan") && ["crustaceans", "eggs", "fish", "milk", "molluscs"].some((tag) => listedAllergens.has(tag as FoodAllergenTag))) {
    return false;
  }
  if (availableDietaryTags.has("vegetarian") && ["crustaceans", "fish", "molluscs"].some((tag) => listedAllergens.has(tag as FoodAllergenTag))) {
    return false;
  }
  if (availableDietaryTags.has("gluten_free") && listedAllergens.has("gluten_cereals")) return false;
  if (availableDietaryTags.has("dairy_free") && listedAllergens.has("milk")) return false;
  const dietaryAllowed = requirements.dietaryTags.every((required) => {
    if (availableDietaryTags.has(required)) return true;
    if (required === "vegetarian") return availableDietaryTags.has("vegan");
    if (required === "pescatarian") return availableDietaryTags.has("vegetarian") || availableDietaryTags.has("vegan");
    return false;
  });

  return dietaryAllowed && requirements.avoidAllergens.every((allergen) => !listedAllergens.has(allergen));
}

export function validateFoodSafetyTagList<T extends string>(value: string, allowed: readonly T[]): T[] {
  const normalized = normalize(value);
  if (normalized === "none" || normalized === "no" || normalized === "") return [];
  const values = value.split(",").map((part) => part.trim()).filter(Boolean);
  const canonical = values.map((item) => normalize(item).replace(/ /g, "_"));
  const unknown = canonical.filter((item) => !allowed.includes(item as T));
  if (unknown.length) throw new Error("Unsupported food safety tags: " + unknown.join(", ") + ".");
  return [...new Set(canonical as T[])].sort();
}
