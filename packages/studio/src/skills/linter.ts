import { CapabilityDescriptor } from "@gauntlet/contracts";

export interface SkillLintIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  skill_id: string;
}

export interface SkillLintReport {
  valid: boolean;
  issues: SkillLintIssue[];
}

/**
 * Lints an individual skill/capability descriptor according to REQ-CONFIG-006 and REQ-SKILL-001.
 */
export function lintSkillDescriptor(cap: CapabilityDescriptor): SkillLintIssue[] {
  const issues: SkillLintIssue[] = [];

  // 1. Description Length Contract (REQ-CONFIG-006)
  const len = cap.summary.length;
  if (len > 1024) {
    issues.push({
      severity: "error",
      code: "SKILL_DESCRIPTION_TOO_LONG",
      message: `Skill description exceeds 1024 characters (${len} chars). Must be <= 1024 chars.`,
      skill_id: cap.id,
    });
  } else if (len < 120) {
    issues.push({
      severity: "warning",
      code: "SKILL_DESCRIPTION_BRIEF",
      message: `Skill description is shorter than recommended 120 characters (${len} chars; target 200-400 chars).`,
      skill_id: cap.id,
    });
  } else if (len > 500) {
    issues.push({
      severity: "warning",
      code: "SKILL_DESCRIPTION_LONG",
      message: `Skill description exceeds recommended 500 characters (${len} chars; target 200-400 chars).`,
      skill_id: cap.id,
    });
  }

  // 2. Positive Triggers Contract
  if (!cap.use_when || cap.use_when.length === 0) {
    issues.push({
      severity: "error",
      code: "SKILL_MISSING_TRIGGERS",
      message: "Skill must define at least one positive trigger in use_when.",
      skill_id: cap.id,
    });
  }

  // 3. Negative Affordance Contract (REQ-ROUTE-002, REQ-CONFIG-006)
  if (!cap.do_not_use_when || cap.do_not_use_when.length === 0) {
    issues.push({
      severity: "error",
      code: "SKILL_MISSING_NEGATIVE_AFFORDANCES",
      message: "Skill must define negative affordances in do_not_use_when to prevent routing collisions.",
      skill_id: cap.id,
    });
  }

  return issues;
}

/**
 * Lints a collection of skills to detect routing collisions (REQ-SKILL-002).
 */
export function lintSkillRegistry(skills: CapabilityDescriptor[]): SkillLintReport {
  const allIssues: SkillLintIssue[] = [];

  for (const s of skills) {
    allIssues.push(...lintSkillDescriptor(s));
  }

  // Check for trigger collisions
  const triggerMap = new Map<string, string[]>();
  for (const s of skills) {
    for (const t of s.use_when) {
      const normalized = t.toLowerCase().trim();
      const existing = triggerMap.get(normalized) || [];
      existing.push(s.id);
      triggerMap.set(normalized, existing);
    }
  }

  for (const [trigger, skillIds] of triggerMap.entries()) {
    if (skillIds.length > 1) {
      allIssues.push({
        severity: "warning",
        code: "SKILL_TRIGGER_COLLISION",
        message: `Multiple skills claim identical trigger '${trigger}': [${skillIds.join(", ")}]. Ensure negative affordances disambiguate them.`,
        skill_id: skillIds[0],
      });
    }
  }

  const hasErrors = allIssues.some((i) => i.severity === "error");
  return {
    valid: !hasErrors,
    issues: allIssues,
  };
}
