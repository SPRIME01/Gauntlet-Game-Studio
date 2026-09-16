/**
 * Blender preflight for the dcc.blender.process escalation route (T18).
 *
 * REQ-BLENDER-001/006/007: Blender is an OFFLINE DCC ESCALATION capability.
 * This preflight is exercised only on the regeneration/proof path — normal
 * game build, runtime, and deterministic CI never touch it. Absence of
 * Blender surfaces as a typed, scoped blockage of regeneration while
 * committed accepted derivatives remain fully consumable.
 *
 * Zero GUI dependency: discovery + a `blender --version` probe only. The
 * probed version string is recorded verbatim in provenance (e.g. "5.2.2 LTS").
 */

export const DCC_BLENDER_PROVIDER = "dcc.blender";
export const DCC_BLENDER_PROCESS_CAPABILITY = "dcc.blender.process";

export interface BlenderPreflight {
  available: boolean;
  executable?: string;
  /** Probed version string, recorded verbatim (e.g. "5.2.2 LTS"). */
  version?: string;
  detail: string;
}

export interface BlenderPreflightDeps {
  /** Injectable which() for deterministic tests; defaults to Bun.which. */
  which?: (name: string) => string | null;
  /** Injectable version probe for deterministic tests. */
  probeVersion?: (executable: string) => Promise<{ ok: boolean; firstLine: string }>;
}

/** Parses "Blender 5.2.2 LTS (hash d13f752e3b9c built ...)" into "5.2.2 LTS". */
export function parseBlenderVersionLine(firstLine: string): string | null {
  const withHash = /^Blender\s+(.+?)\s+\(hash/.exec(firstLine.trim());
  if (withHash) return withHash[1];
  const plain = /^Blender\s+(.+)$/.exec(firstLine.trim());
  return plain ? plain[1] : null;
}

async function defaultProbeVersion(executable: string): Promise<{ ok: boolean; firstLine: string }> {
  try {
    const proc = Bun.spawn([executable, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    const firstLine = stdout.split("\n")[0]?.trim() ?? "";
    return { ok: exitCode === 0 && firstLine.length > 0, firstLine };
  } catch {
    return { ok: false, firstLine: "" };
  }
}

/**
 * Discover the Blender executable and probe its version. Never throws:
 * every failure mode is a typed unavailable preflight.
 */
export async function checkBlenderPreflight(deps: BlenderPreflightDeps = {}): Promise<BlenderPreflight> {
  const which = deps.which ?? ((name: string) => Bun.which(name));
  const probe = deps.probeVersion ?? defaultProbeVersion;

  const executable = which("blender");
  if (!executable) {
    return {
      available: false,
      detail:
        "blender executable not found on PATH. Only the dcc.blender.process regeneration/proof job is blocked " +
        "(REQ-BLENDER-007); normal builds, tests, runtime, and CI consume committed accepted derivatives without Blender.",
    };
  }
  const probed = await probe(executable);
  if (!probed.ok) {
    return {
      available: false,
      executable,
      detail: `blender found at ${executable} but the --version probe failed; treating the DCC escalation capability as unavailable (scoped regeneration blockage).`,
    };
  }
  const version = parseBlenderVersionLine(probed.firstLine);
  if (!version) {
    return {
      available: false,
      executable,
      detail: `blender found at ${executable} but its version string '${probed.firstLine}' is unparseable; refusing to run an unidentified DCC build.`,
    };
  }
  return {
    available: true,
    executable,
    version,
    detail: `blender ${version} at ${executable}`,
  };
}
