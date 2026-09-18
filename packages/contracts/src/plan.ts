import { z } from "zod";
import { ActionIntent } from "./action.js";

export const PlannedStep = z.object({
  ordinal: z.number().int().min(0),
  intent: ActionIntent,
  rationale: z.string().max(500),
});
export type PlannedStep = z.infer<typeof PlannedStep>;

export const Plan = z.object({
  summary: z.string().max(500),
  steps: z.array(PlannedStep).max(20),
});
export type Plan = z.infer<typeof Plan>;
