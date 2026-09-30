// Week Planner frontend entrypoint.
//
// The core defines the custom elements, while the service modules patch their
// prototypes. Stage those definitions until every service has been installed
// so Home Assistant cannot upgrade a panel/card and start initialization with
// only half of the runtime available.

const registry = window.customElements;
const originalDefine = registry.define.bind(registry);
const originalGet = registry.get.bind(registry);
const staged = new Map();

registry.define = (name, constructor, options) => {
  if (name.startsWith("week-planner-")) {
    staged.set(name, { constructor, options });
    return;
  }
  return originalDefine(name, constructor, options);
};

registry.get = (name) => staged.get(name)?.constructor || originalGet(name);

try {
  await import("./week-planner-core.js");
  await import("./services/scroll-integration.js");
  await import("./services/source-health-integration.js");
  await import("./services/data-manager-integration.js");
} finally {
  registry.define = originalDefine;
  registry.get = originalGet;
}

for (const [name, { constructor, options }] of staged) {
  if (!originalGet(name)) originalDefine(name, constructor, options);
}

window.weekPlannerFrontendVersion = "0.5.3-dev.26";

if (Array.isArray(window.customCards)) {
  const card = window.customCards.find((item) => item.type === "week-planner-card");
  if (card) card.description = "Week Planner dashboard card · frontend v0.5.3-dev.26";
}