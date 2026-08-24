import { z } from "zod";

/**
 * Structured I/O schemas for the 3-agent pipeline.
 * Mirrors openspec/changes/agentflow-demo/specs/agent-pipeline/spec.md.
 */

/** Qualifier Agent: structured requirements extracted from a free-text pre-sales ask. */
export const QualifierOutputSchema = z.object({
	/** Concrete, named AI use cases the ask implies (e.g. "audience segmentation") */
	named_use_cases: z.array(z.string()),
	/** Hard constraints stated in the ask: compliance, residency, stack, SSO, governance, latency */
	partner_constraints: z.array(z.string()),
	/** Measurable criteria that make the POC a success */
	success_criteria: z.array(z.string()),
	/** Explicit failure conditions that should end the POC early */
	exit_criteria: z.array(z.string()),
	/** Underspecified aspects that need clarification before scoping */
	ambiguity_flags: z.array(z.string()),
});

/** Architect Agent: POC plan handed to the HITL gate. */
export const PocPlanSchema = z.object({
	/** What the POC covers (and what is out of scope) */
	scope: z.string(),
	/** Duration and phase split (e.g. "4-week POC: 2 weeks build, 2 weeks test") */
	timeline: z.string(),
	/** Medallion-style zones as "name: description" strings */
	data_zones: z.array(z.string()),
	/** Systems the POC integrates with */
	integrations: z.array(z.string()),
	/** People, allocation, and build/test split */
	resource_estimate: z.string(),
});

/** Architect Agent: outcome of the arch_pattern_lookup MCP call. */
export const PatternMatchSchema = z.object({
	/** pattern_id returned by the tool; "unknown" when the call failed entirely */
	pattern_id: z.string(),
	/** Match confidence: curated patterns >= 0.85, generic fallback < 0.5 */
	confidence: z.number().min(0).max(1),
	/** True when the match is low-confidence (confidence < 0.5) — no diagram renders */
	weak_match: z.boolean(),
});

/** Architect Agent: deployment architecture + POC plan. */
export const ArchitectOutputSchema = z.object({
	/** One-paragraph deployment architecture description */
	architecture_summary: z.string(),
	/** The proposed POC plan */
	poc_plan: PocPlanSchema,
	/** Outcome of the arch_pattern_lookup tool call (flags weak matches for the pipeline) */
	pattern_match: PatternMatchSchema,
	/** Deployment specifics: residency, tenancy, networking, security touchpoints */
	deployment_notes: z.string(),
});

/** Risk Checker: 7-dimension rubric, each dimension scored 1 (failing) to 5 (excellent). */
export const EvalScoresSchema = z.object({
	use_case_clarity: z.number().min(1).max(5),
	success_criteria_specificity: z.number().min(1).max(5),
	exit_criteria_present: z.number().min(1).max(5),
	timeline_realism: z.number().min(1).max(5),
	governance_coverage: z.number().min(1).max(5),
	data_zone_design: z.number().min(1).max(5),
	resource_feasibility: z.number().min(1).max(5),
});

export const RiskSeveritySchema = z.enum(["high", "medium", "low"]);

export const RiskItemSchema = z.object({
	severity: RiskSeveritySchema,
	issue: z.string(),
});

/** Risk Checker: evaluation of the Architect's plan against the rubric. */
export const RiskCheckerOutputSchema = z.object({
	eval_scores: EvalScoresSchema,
	/** Average of the seven rubric scores, to one decimal place (e.g. 3.7) */
	overall_score: z.number().min(1).max(5),
	risks: z.array(RiskItemSchema),
	recommendation: z.string(),
});

export type QualifierOutput = z.infer<typeof QualifierOutputSchema>;
export type PocPlan = z.infer<typeof PocPlanSchema>;
export type PatternMatch = z.infer<typeof PatternMatchSchema>;
export type ArchitectOutput = z.infer<typeof ArchitectOutputSchema>;
export type EvalScores = z.infer<typeof EvalScoresSchema>;
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;
export type RiskItem = z.infer<typeof RiskItemSchema>;
export type RiskCheckerOutput = z.infer<typeof RiskCheckerOutputSchema>;
