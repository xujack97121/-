const assert = require("node:assert/strict");
const { expandedDataDashboardBounds, fitWindowBounds } = require("../../backend/platform/data-dashboard-window.cjs");

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

assert.deepEqual(
  expandedDataDashboardBounds({ x: 10, y: 20, width: 1350, height: 860 }, workArea),
  { x: 10, y: 20, width: 1830, height: 860 },
  "the dashboard should grow into available space on the right",
);
assert.deepEqual(
  expandedDataDashboardBounds({ x: 500, y: 20, width: 1350, height: 860 }, workArea),
  { x: 90, y: 20, width: 1830, height: 860 },
  "the window should move left when the right edge has insufficient room",
);
assert.deepEqual(
  expandedDataDashboardBounds({ x: 0, y: 0, width: 1600, height: 1200 }, workArea),
  { x: 0, y: 0, width: 1920, height: 1040 },
  "expanded bounds must remain inside the display work area",
);
assert.deepEqual(
  fitWindowBounds({ x: -200, y: -50, width: 1200, height: 800 }, workArea),
  { x: 0, y: 0, width: 1200, height: 800 },
  "restored bounds should be clamped to the active display",
);

console.log("data dashboard window bounds: passed");
