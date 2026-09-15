import type { RuntimeReadiness } from "@gauntlet/contracts";

export type RuntimeMode = "client" | "headless" | "local-authoritative";

export type SubsystemId = "physics" | "navigation" | "rendering" | "audio" | "network" | string;

export type SubsystemState = "uninitialized" | "booting" | "ready" | "failed";

export interface SubsystemDescriptor {
  id: SubsystemId;
  required: boolean;
  state: SubsystemState;
  error?: string;
  bootDurationMs?: number;
}

export interface SimulationTick {
  tick: number;
  time: number;
  dt: number;
}

export interface RuntimeDiagnostics {
  mode: RuntimeMode;
  state: "created" | "booting" | "ready" | "failed";
  tick: number;
  simulation_time: number;
  subsystems: Record<SubsystemId, SubsystemDescriptor>;
  fps?: number;
}

export type SimulationStepHandler = (tick: SimulationTick) => void;
