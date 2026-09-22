const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const yaml = require("js-yaml");
const directory = path.resolve(process.argv[2] || "release");
const version = require("../package.json").version;
const metadata = yaml.load(fs.readFileSync(path.join(directory, "latest.yml"), "utf8"));
assert.equal(metadata.version, version);
assert.ok(Array.isArray(metadata.files) && metadata.files.length > 0);
for (const entry of metadata.files) {
  assert.equal(entry.url, `xiaohongshu-multi-account-${version}-x64.exe`);
  const file = path.join(directory, entry.url);
  const content = fs.readFileSync(file);
  assert.equal(entry.size, content.length);
  const hash = createHash("sha512").update(content).digest("base64");
  assert.equal(entry.sha512, hash, "Update manifest must match the exact installer");
  if (metadata.path === entry.url) assert.equal(metadata.sha512, hash);
  assert.ok(fs.statSync(`${file}.blockmap`).size > 0);
}
console.log(`Update manifest, installer SHA-512 and blockmap v${version}: passed`);
