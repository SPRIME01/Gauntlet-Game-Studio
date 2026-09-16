/**
 * Deterministic headless Blender CLI invocation (T18).
 *
 * The ONLY way this adapter ever runs Blender:
 *   blender --background --factory-startup --python <script.py> -- <args...>
 *
 * - `--background`      : no GUI, no display dependency;
 * - `--factory-startup` : no user preferences/addons — identical behavior on
 *                         every host, so runs are reproducible;
 * - `--python <script>` : committed, deterministic bpy scripts; no ad-hoc
 *                         injected code, no interactive console.
 *
 * The exact argv is captured for regeneration provenance. No other module in
 * the monorepo may invoke Blender (enforced by tests scanning runtime source).
 */

export interface BlenderInvocationOptions {
  executable: string;
  scriptPath: string;
  /** Trailing args after `--`, forwarded verbatim to the bpy script. */
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface BlenderInvocationRecord {
  argv: string[];
  exit_code: number;
  duration_ms: number;
  /** Tail of stdout (bounded) for evidence; full output goes to the caller. */
  stdout_tail: string;
  stderr_tail: string;
}

export interface BlenderInvocationResult extends BlenderInvocationRecord {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export class BlenderInvocationError extends Error {
  code = "BLENDER_INVOCATION_FAILED";
  record: BlenderInvocationRecord;
  constructor(message: string, record: BlenderInvocationRecord) {
    super(message);
    this.name = "BlenderInvocationError";
    this.record = record;
  }
}

const TAIL_CHARS = 4000;
const DEFAULT_TIMEOUT_MS = 120_000;

function tail(text: string): string {
  return text.length <= TAIL_CHARS ? text : `...${text.slice(text.length - TAIL_CHARS)}`;
}

/** Builds the exact deterministic argv (also used for provenance records). */
export function blenderBackgroundArgv(options: BlenderInvocationOptions): string[] {
  return [
    options.executable,
    "--background",
    "--factory-startup",
    "--python",
    options.scriptPath,
    "--",
    ...options.args,
  ];
}

/** Spawn one deterministic headless Blender run and capture everything. */
export async function runBlenderBackgroundScript(
  options: BlenderInvocationOptions
): Promise<BlenderInvocationResult> {
  const argv = blenderBackgroundArgv(options);
  const started = Date.now();
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const timer = options.timeoutMs
    ? setTimeout(() => {
        proc.kill();
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    : undefined;
  try {
    const [stdout, stderr, exit_code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const record: BlenderInvocationRecord = {
      argv,
      exit_code,
      duration_ms: Date.now() - started,
      stdout_tail: tail(stdout),
      stderr_tail: tail(stderr),
    };
    return { ...record, ok: exit_code === 0, stdout, stderr };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
