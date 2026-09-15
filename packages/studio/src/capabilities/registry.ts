import { CapabilityDescriptor, validateCapabilityDescriptor } from "@gauntlet/contracts";
import { CAPABILITY_CATALOG } from "./catalog";

export class CapabilityRegistry {
  private capabilities: Map<string, CapabilityDescriptor> = new Map();

  constructor(initialCatalog: CapabilityDescriptor[] = CAPABILITY_CATALOG) {
    for (const cap of initialCatalog) {
      this.register(cap);
    }
  }

  register(cap: CapabilityDescriptor): void {
    validateCapabilityDescriptor(cap);
    this.capabilities.set(cap.id, cap);
  }

  get(id: string): CapabilityDescriptor | undefined {
    return this.capabilities.get(id);
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  list(): CapabilityDescriptor[] {
    return Array.from(this.capabilities.values());
  }
}

export const defaultCapabilityRegistry = new CapabilityRegistry();
