/**
 * Blackwater Relay — browser boot (T22).
 *
 * Wires the headless-safe game core to browser-only execution projections:
 * Three.js renderer/scene, the composed 3dviz world kits, the accepted img2threejs
 * field-transceiver, the committed Blender-derived service drone (GLB + baked
 * hover_cycle), Quarks VFX, the Tone AudioBackend (locked until a real user gesture —
 * REQ-AUDIO-001), and the DOM/CSS HUD. NOTHING here is semantic authority: every
 * projection syncs one-way from Koota (REQ-RUNTIME-001).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  AudioSystem,
  DomHudRenderer,
  HudModel,
  RenderProjectionManager,
  Transform,
  createTerrainRenderProjection,
} from "@gauntlet/runtime";
import { QuarksVfxProjection, defineBurstEffect } from "@gauntlet/adapters/src/vfx/quarks/index";
import { createFieldTransceiver } from "../assets/field-transceiver";
import { SERVICE_DRONE_ASSET, assertServiceDroneDerivativeConsumable, parseGlbContainer } from "../assets/service-drone";
import { buildComposedWorld } from "../world/kits";
import { bootGameCore, type GameCore } from "./build";
import { GAME_TITLE, LAYOUT, observabilityMode, semanticFixtureVariant } from "./config";
import { IDS } from "./state";

// ---------------------------------------------------------------------------
// Mesh builders (pure render projections)
// ---------------------------------------------------------------------------

function material(color: number, roughness = 0.8, metalness = 0.15): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function buildRoverMesh(): THREE.Group {
  const g = new THREE.Group();
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 3.2), material(0xb65c34, 0.6, 0.3));
  chassis.position.y = -0.1;
  g.add(chassis);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.4), material(0x8f4626, 0.7, 0.2));
  cabin.position.set(0, 0.8, -0.3);
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 10);
  const wheelMat = material(0x22252a, 0.95, 0.05);
  for (const [x, z] of [[-1.15, 1.05], [1.15, 1.05], [-1.15, -1.05], [1.15, -1.05]] as const) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, -0.45, z);
    g.add(w);
  }
  return g;
}

function buildGateMesh(): THREE.Group {
  const g = new THREE.Group();
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4.0, 6.0), material(0x7a6a4f, 0.85, 0.2));
  g.add(door);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 6.1), material(0xd8b13a, 0.6, 0.3));
  stripe.position.y = 1.2;
  g.add(stripe);
  return g;
}

function buildCellMesh(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.3, 10), material(0x35b8a0, 0.4, 0.6));
  shell.name = "power-cell-shell";
  g.add(shell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 8), material(0xe8d24a, 0.4, 0.5));
  cap.position.y = 0.8;
  g.add(cap);
  return g;
}

function buildBeaconMesh(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 8), material(0x9aa3ad, 0.5, 0.6));
  pole.position.y = 0.8;
  g.add(pole);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffb14d, emissive: 0xff8c1a, emissiveIntensity: 1.4, roughness: 0.4 })
  );
  lamp.position.y = 1.8;
  lamp.name = "beacon-lamp";
  g.add(lamp);
  return g;
}

function buildStormDuskSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x2b3a67) },
      mid: { value: new THREE.Color(0xc96b3f) },
      bottom: { value: new THREE.Color(0x1c2733) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      void main() {
        float h = normalize(vPos).y;
        vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.75, h))
                           : mix(bottom, mid, smoothstep(-0.35, 0.12, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), material);
  mesh.name = "skybox-storm-dusk";
  return mesh;
}

// ---------------------------------------------------------------------------
// Drone GLB consumption (committed Blender-derived asset; zero Blender presence)
// ---------------------------------------------------------------------------

async function loadServiceDrone(): Promise<{ object: THREE.Object3D; mixer: THREE.AnimationMixer }> {
  const response = await fetch(SERVICE_DRONE_ASSET.glbPath);
  if (!response.ok) {
    throw new Error(`service-drone GLB fetch failed: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Container-level validation of the accepted derivative (typed errors on damage).
  assertServiceDroneDerivativeConsumable(parseGlbContainer(bytes));

  const loader = new GLTFLoader();
  const sliced = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await loader.parseAsync(sliced, "");
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const clip = THREE.AnimationClip.findByName(gltf.animations, SERVICE_DRONE_ASSET.animationClip);
  if (clip) {
    mixer.clipAction(clip).play();
  }
  return { object: gltf.scene, mixer };
}

/** Pure-data synthesis specs (no sample content; see ToneAudioBackend contract). */
const SOUND_REGISTRY = {
  "bw.cell.pickup": { kind: "synth" as const, note: "E5", duration: "8n", oscillator: { type: "triangle" as const } },
  "bw.cell.delivered": { kind: "synth" as const, note: "A4", duration: "4n", oscillator: { type: "sine" as const } },
  "bw.gate.raising": { kind: "synth" as const, note: "C3", duration: "2n", oscillator: { type: "sawtooth" as const } },
  "bw.beacon.mounting": { kind: "synth" as const, note: "A5", duration: "2n", oscillator: { type: "sine" as const } },
};

// ---------------------------------------------------------------------------
// Browser game boot
// ---------------------------------------------------------------------------

export interface BrowserGame {
  core: GameCore;
  dispose: () => void;
}

export async function bootBrowserGame(): Promise<BrowserGame> {
  const bootStartedAt = performance.now();
  const status = document.getElementById("boot-status");
  const setStatus = (text: string) => {
    if (status) status.textContent = text;
  };
  setStatus(`booting ${GAME_TITLE}…`);

  // ---- Renderer / scene / atmosphere (projections only) --------------------
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: false });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x35455e, 90, 340);
  scene.add(buildStormDuskSky());

  scene.add(new THREE.HemisphereLight(0x8fa3c7, 0x2c3626, 0.85));
  const sun = new THREE.DirectionalLight(0xff9e5e, 1.35);
  sun.position.set(-120, 60, 40);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);

  // ---- Load the committed drone derivative BEFORE the surface mounts -------
  setStatus("loading accepted assets…");
  const drone = await loadServiceDrone();

  // ---- Tone audio backend (browser-only module; locked until user gesture) -
  // The backend starts locked/suspended; the game never bypasses autoplay policy
  // (REQ-AUDIO-001). A real user gesture can call window.__bwAudioUnlock().
  let audio: AudioSystem | null = null;
  try {
    const { ToneAudioBackend } = await import("@gauntlet/adapters/src/audio/tone/tone-backend");
    const toneBackend = new ToneAudioBackend({ sounds: SOUND_REGISTRY });
    audio = new AudioSystem(toneBackend);
    (window as unknown as Record<string, unknown>).__bwAudioUnlock = () => toneBackend.unlock();
  } catch {
    audio = null; // degraded audio must never block the game (REQ-SAFE-007)
  }

  // ---- Game core (mounts the observability surface when fully ready) -------
  setStatus("building world (physics + navigation)…");
  const fixture = semanticFixtureVariant();
  const core = await bootGameCore({
    mode: observabilityMode(),
    fixtureCorruptGate: fixture === "corrupt-gate",
  });
  const ctx = core.context;
  const sample = ctx.sample;

  // ---- Canonical terrain render projection ---------------------------------
  const terrain = createTerrainRenderProjection(ctx.heightfield);
  terrain.mesh.material = new THREE.MeshStandardMaterial({ color: 0x4a6a52, roughness: 0.95, metalness: 0.05 });
  scene.add(terrain.mesh);

  // ---- Composed 3dviz world (accepted kit records) --------------------------
  const world = buildComposedWorld(sample);
  scene.add(world.group);

  // ---- Entity render projections (one-way Koota -> Object3D) ---------------
  const projections = new RenderProjectionManager();

  const roverMesh = buildRoverMesh();
  scene.add(roverMesh);
  projections.bind(IDS.rover, "render-rover", roverMesh);

  const gateMesh = buildGateMesh();
  scene.add(gateMesh);
  projections.bind(IDS.gate, "render-gate", gateMesh);

  const cellMesh = buildCellMesh();
  scene.add(cellMesh);
  projections.bind(IDS.cell, "render-cell", cellMesh);

  const transceiverMesh = createFieldTransceiver();
  scene.add(transceiverMesh);
  projections.bind(IDS.transceiver, "render-transceiver", transceiverMesh);

  scene.add(drone.object);
  projections.bind(IDS.drone, "render-drone", drone.object);

  const beaconMesh = buildBeaconMesh();
  scene.add(beaconMesh);
  projections.bind(IDS.beacon, "render-beacon", beaconMesh);

  // ---- VFX projection (Quarks) ---------------------------------------------
  const vfx = new QuarksVfxProjection({ scene });
  vfx.defineEffect("bw.gate-burst", defineBurstEffect({
    particleCount: 42, duration: 0.9, startLife: 0.9, startSpeed: 7, startSize: 0.5, color: [0.35, 0.85, 1.0],
  }));
  vfx.defineEffect("bw.beacon-burst", defineBurstEffect({
    particleCount: 64, duration: 1.4, startLife: 1.3, startSpeed: 9, startSize: 0.65, color: [1.0, 0.72, 0.25],
  }));

  // ---- HUD (DOM/CSS projection of the pure-data HudModel) ------------------
  const hudModel = new HudModel({ messageTtlMs: 3200 });
  const hudRoot = document.getElementById("hud");
  const hud = hudRoot ? new DomHudRenderer(hudModel, hudRoot) : null;
  hudModel.showMessage("BLACKWATER RELAY — restore the relay link");

  // ---- Observability wiring: renderer probe + stats seam -------------------
  const gl = renderer.getContext();
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  core.bridge.setRendererProbe(() => ({
    identity: {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      gl_version: gl.getParameter(gl.VERSION),
      title: GAME_TITLE,
    },
    capabilities: { max_texture_size: gl.getParameter(gl.MAX_TEXTURE_SIZE) },
  }));

  const frameSamples: number[] = [];
  core.bridge.setRendererStats(() => {
    const avg = frameSamples.length > 0
      ? frameSamples.reduce((s, v) => s + v, 0) / frameSamples.length
      : 0;
    // frame_time_samples_ms is a numeric array by contract (perf.ts reads it with
    // Array.isArray); the runtime seam's Record<string, number> shape is satisfied
    // for the scalar metrics and cast for the sample array.
    return {
      fps_avg: avg > 0 ? 1000 / avg : 0,
      frame_time_samples_ms: [...frameSamples],
      draw_calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      textures: renderer.info.memory.textures,
      resources: renderer.info.memory.geometries,
      readiness_ms: Number.isNaN(readyAt) ? 0 : Math.max(0, Math.round(readyAt - bootStartedAt)),
    } as unknown as Record<string, number>;
  });

  // ---- Semantic-event drain (VFX / audio / HUD are one-way consumers) ------
  let lastEventKey = "";
  function drainEvents(): void {
    for (const event of ctx.events) {
      const key = `${event.name}:${event.tick}`;
      if (key === lastEventKey) continue;
      lastEventKey = key;
      switch (event.name) {
        case "cell.picked":
          hudModel.showMessage("POWER CELL ACQUIRED — deliver it to the transceiver");
          hudModel.addScore(25);
          audio?.emitSound({ soundEvent: "bw.cell.pickup" });
          break;
        case "cell.delivered":
          hudModel.showMessage("TRANSCEIVER POWERED — the relay gate is opening");
          hudModel.addScore(75);
          audio?.emitSound({ soundEvent: "bw.cell.delivered" });
          break;
        case "gate.raising":
          audio?.emitSound({ soundEvent: "bw.gate.raising" });
          vfx.spawnEffect({
            effectId: "bw.gate-burst",
            entityId: IDS.gate,
            position: [LAYOUT.relay_gate.x, event.position[1] + 1, LAYOUT.relay_gate.z],
          });
          break;
        case "beacon.mounting":
          hudModel.showMessage("BEACON MOUNTED — relay link restored");
          hudModel.addScore(150);
          audio?.emitSound({ soundEvent: "bw.beacon.mounting" });
          vfx.spawnEffect({ effectId: "bw.beacon-burst", entityId: IDS.beacon, position: ctx.beaconMount });
          break;
        case "patrol.rerouted":
          break;
      }
    }
    ctx.events.length = 0;
  }

  // ---- Camera controller (render-cadence projection) ------------------------
  const lookTarget = new THREE.Vector3();
  function readTransform(id: string): { position: [number, number, number]; rotation: [number, number, number, number] } | null {
    const entity = ctx.kernel.gameWorld.getEntity(id);
    const t = entity?.get(Transform);
    return t ? { position: t.position, rotation: t.rotation } : null;
  }

  function updateCamera(dt: number): void {
    const roverT = readTransform(IDS.rover);
    const droneT = readTransform(IDS.drone);
    const scenario = ctx.scenarioId;
    const lerp = Math.min(1, dt * 2.2);

    if (scenario === "performance-flythrough") {
      const t = performance.now() * 0.00012;
      const cx = Math.sin(t) * 55;
      const cz = Math.cos(t) * 55;
      camera.position.lerp(new THREE.Vector3(cx * 1.8, sample(cx, cz) + 26 + Math.sin(t * 2.3) * 6, cz * 1.8), Math.min(1, dt * 2));
      lookTarget.set(cx, sample(cx, cz) + 4, cz);
      camera.lookAt(lookTarget);
    } else if (scenario === "patrol-obstacle" && droneT) {
      const [x, y, z] = droneT.position;
      camera.position.lerp(new THREE.Vector3(x + 14, y + 9, z + 14), Math.min(1, dt * 1.6));
      lookTarget.set(x, y, z);
      camera.lookAt(lookTarget);
    } else if (roverT) {
      const [x, y, z] = roverT.position;
      const [, ry, , rw] = roverT.rotation;
      const yaw = 2 * Math.atan2(ry, rw);
      camera.position.lerp(
        new THREE.Vector3(x - Math.sin(yaw) * 13, y + 7.5, z - Math.cos(yaw) * 13),
        lerp
      );
      lookTarget.set(x, y + 1.5, z);
      camera.lookAt(lookTarget);
    } else {
      camera.position.lerp(new THREE.Vector3(0, sample(0, 0) + 24, 40), Math.min(1, dt));
      lookTarget.set(0, sample(0, 0), 0);
      camera.lookAt(lookTarget);
    }

    core.viewState.position = [camera.position.x, camera.position.y, camera.position.z];
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    core.viewState.target = [
      camera.position.x + dir.x * 10,
      camera.position.y + dir.y * 10,
      camera.position.z + dir.z * 10,
    ];
  }

  // ---- Corrupt-gate render fixture (TEETH-T22-003) --------------------------
  let gateVisualY: number | null = null;
  function applyCorruptGateOverride(): void {
    if (!ctx.fixtureCorruptGate || ctx.gatePhase === "closed") return;
    // Visible animation preserved: the gate projection animates open even though the
    // authoritative Koota transform stays closed (semantic transition corrupted).
    if (gateVisualY === null) gateVisualY = gateMesh.position.y;
    gateVisualY += (ctx.gateOpenY - gateVisualY) * 0.12;
    gateMesh.position.y = gateVisualY;
  }

  // ---- Render loop (client cadence; simulation stays fixed-tick) -----------
  let readyAt = Number.NaN;
  let lastLoop = performance.now();
  core.kernel.scheduler.start();

  function loop(): void {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dtSeconds = Math.min(0.25, (now - lastLoop) / 1000);
    frameSamples.push(dtSeconds * 1000);
    if (frameSamples.length > 120) frameSamples.shift();
    lastLoop = now;

    if (core.kernel.scheduler.isRunning()) {
      core.kernel.scheduler.advance(dtSeconds);
    }
    if (Number.isNaN(readyAt) && core.kernel.barrier.isReady()) {
      readyAt = now;
    }

    drainEvents();
    projections.syncFromState(ctx.kernel.gameWorld);
    vfx.syncFromState(ctx.kernel.gameWorld);
    vfx.update(dtSeconds);
    drone.mixer.update(dtSeconds);
    applyCorruptGateOverride();
    updateCamera(dtSeconds);
    hud?.render();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  if (status) status.remove();

  return {
    core,
    dispose: () => {
      core.dispose();
      renderer.dispose();
    },
  };
}
