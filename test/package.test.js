import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("the package exposes the public Gentle Shell extension entry point", async () => {
  assert.equal(packageJson.name, "gentle-shell-pr");
  assert.deepEqual(packageJson.pi.extensions, ["./extensions/pr-sidebar.js"]);
  assert.ok(packageJson.keywords.includes("pi-package"));
  await access(new URL(`../${packageJson.pi.extensions[0]}`, import.meta.url));
});
