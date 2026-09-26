const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const root = path.join(__dirname, "../..");
const workflow = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"));
assert.deepEqual(workflow.on.push.branches, ["main"]);
assert.equal(workflow.concurrency["cancel-in-progress"], false);
const jobs = workflow.jobs;
for (const platform of ["windows", "macos"]) {
  assert.ok(jobs[platform].steps.some((step) => step.run === "npm run test:electron-navigation"));
  assert.ok(jobs[platform].steps.some((step) => step.run === "npm run test:electron-update-check"));
}
assert.match(jobs.windows.steps.map((step) => step.run || "").join("\n"), /verify-update-assets/);
const assets = jobs.windows.steps.find((step) => step.uses?.startsWith("actions/upload-artifact")).with.path;
assert.match(assets, /latest\.yml/);
assert.match(assets, /blockmap/);
const publish = jobs.release.steps.at(-1).run;
assert.match(publish, /--draft/);
assert.match(publish, /--draft=false --latest/);
assert.match(publish, /TAG_SHA/);
assert.deepEqual(jobs.release.needs, ["prepare", "windows", "macos"]);
const main = fs.readFileSync(path.join(root, "backend/main.cjs"), "utf8");
assert.match(main, /assertIdleForUpdate\(\);[\s\S]*showMessageBox/);
assert.match(main, /assertIdleForUpdate\(\);[\s\S]*flushStorageData/);
assert.match(main, /releaseRedirectImpl: \(\) => requestReleaseRedirect\(net\)/);
console.log("Automatic release workflow and update install guards: passed");
