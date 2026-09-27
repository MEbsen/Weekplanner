// Week Planner frontend entrypoint.
//
// Keep this file intentionally small. The legacy/core implementation is loaded
// first, then feature services patch the shared panel/card runtime. This lets
// Week Planner move functionality out of the former monolithic frontend in
// small, reversible commits.

await import("./week-planner-core.js");
await import("./services/scroll-integration.js");
await import("./services/source-health-integration.js");
await import("./services/data-manager-integration.js");

window.weekPlannerFrontendVersion = "0.5.3-dev.16";

if (Array.isArray(window.customCards)) {
  const card = window.customCards.find((item) => item.type === "week-planner-card");
  if (card) {
    card.description = "Week Planner dashboard card · frontend v0.5.3-dev.16";
  }
}