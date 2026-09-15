import * as fs from "node:fs";
import * as path from "node:path";

export interface CreateGameOptions {
  name?: string;
  templateDir?: string;
}

export interface CreateGameResult {
  project_name: string;
  path: string;
  files: string[];
}

/**
 * Finds the default templates/game directory.
 */
function findDefaultTemplateDir(): string {
  // Check relative to this module in both development and built layouts
  const candidates = [
    path.resolve(__dirname, "../../../templates/game"),
    path.resolve(__dirname, "../../templates/game"),
    path.resolve(process.cwd(), "templates/game"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }

  throw new Error("Game project template directory not found in candidates: " + candidates.join(", "));
}

/**
 * Recursively copies a directory and returns list of created relative file paths.
 */
function copyDirectoryRecursive(src: string, dest: string, baseDest: string): string[] {
  const created: string[] = [];
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      created.push(...copyDirectoryRecursive(srcPath, destPath, baseDest));
    } else {
      fs.copyFileSync(srcPath, destPath);
      created.push(path.relative(baseDest, destPath));
    }
  }
  return created;
}

/**
 * Creates an independent game project from the studio game template.
 * Conforms to REQ-GOAL-007, REQ-OUT-001, REQ-REPO-002.
 */
export function createGameProject(targetPath: string, options?: CreateGameOptions): CreateGameResult {
  const resolvedTarget = path.resolve(process.cwd(), targetPath);
  const projectName = options?.name || path.basename(resolvedTarget);
  const templateDir = options?.templateDir ? path.resolve(process.cwd(), options.templateDir) : findDefaultTemplateDir();

  if (fs.existsSync(resolvedTarget) && fs.readdirSync(resolvedTarget).length > 0) {
    // If target exists and not empty, check if it's already a game project or error
    const pkg = path.join(resolvedTarget, "package.json");
    if (fs.existsSync(pkg)) {
      // Overwrite/update safely
    }
  } else {
    fs.mkdirSync(resolvedTarget, { recursive: true });
  }

  // 1. Copy all template files
  const files = copyDirectoryRecursive(templateDir, resolvedTarget, resolvedTarget);

  // 2. Customize package.json
  const pkgPath = path.join(resolvedTarget, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    pkg.name = projectName;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  }

  // 3. Customize .agents/specs/game.spec.yaml
  const specPath = path.join(resolvedTarget, ".agents/specs/game.spec.yaml");
  if (fs.existsSync(specPath)) {
    let content = fs.readFileSync(specPath, "utf-8");
    content = content.replace(/game_id:\s*"[^"]*"/, `game_id: "${projectName}"`);
    content = content.replace(/title:\s*"[^"]*"/, `title: "${projectName} Specification"`);
    fs.writeFileSync(specPath, content, "utf-8");
  }

  // 4. Customize .agents/CURRENT_STATUS.yml
  const statusPath = path.join(resolvedTarget, ".agents/CURRENT_STATUS.yml");
  if (fs.existsSync(statusPath)) {
    let content = fs.readFileSync(statusPath, "utf-8");
    content = content.replace(/game_id:\s*"[^"]*"/, `game_id: "${projectName}"`);
    fs.writeFileSync(statusPath, content, "utf-8");
  }

  return {
    project_name: projectName,
    path: resolvedTarget,
    files,
  };
}
