/**
 * Recipe registry — parallel in shape to CapabilityRegistry but for RecipeDescriptors.
 * Registration validates through the shared contracts schema (REQ-RECIPE-002).
 */
import { RecipeDescriptor, validateRecipeDescriptor } from "@gauntlet/contracts";
import { RECIPE_CATALOG } from "./catalog";

export class RecipeRegistry {
  private recipes: Map<string, RecipeDescriptor> = new Map();

  constructor(initialCatalog: RecipeDescriptor[] = RECIPE_CATALOG) {
    for (const recipe of initialCatalog) {
      this.register(recipe);
    }
  }

  register(recipe: RecipeDescriptor): void {
    validateRecipeDescriptor(recipe);
    this.recipes.set(recipe.id, recipe);
  }

  get(id: string): RecipeDescriptor | undefined {
    return this.recipes.get(id);
  }

  has(id: string): boolean {
    return this.recipes.has(id);
  }

  list(): RecipeDescriptor[] {
    return Array.from(this.recipes.values());
  }
}

export const defaultRecipeRegistry = new RecipeRegistry();
