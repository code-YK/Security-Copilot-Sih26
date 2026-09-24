import type { Verdict } from "@/types";

/** The agent's five SIH26106 verdict classes collapse onto the extension's three badge/toast levels. */
export function toSeverity(label: Verdict["label"]): "dangerous" | "suspicious" | "safe" | "inconclusive" {
  switch (label) {
    case "phishing":
    case "fraud-related":
    case "impersonated":
    case "dangerous":
      return "dangerous";
    case "legitimate":
    case "safe":
      return "safe";
    case "inconclusive":
      return "inconclusive";
    default:
      return "suspicious";
  }
}
