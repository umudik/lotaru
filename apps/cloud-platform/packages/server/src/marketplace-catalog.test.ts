import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MARKETPLACE_CATALOG,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_PACK_FORMAT,
  isBuiltinMarketplaceId,
  marketplaceItemById,
  marketplacePackFromItems,
  parseMarketplacePack,
} from "./marketplace-catalog.js";

describe("marketplace catalog", () => {
  it("ships researched documents, diagrams, scripts, and task packs", () => {
    assert.equal(MARKETPLACE_CATALOG.length >= 100, true);
    const ids = new Set<string>();
    const categories = new Set<string>();
    let documents = 0;
    let diagrams = 0;
    let scripts = 0;
    let tasks = 0;
    for (const item of MARKETPLACE_CATALOG) {
      assert.equal(ids.has(item.id), false);
      ids.add(item.id);
      assert.equal(item.title.trim().length > 0, true);
      assert.equal(item.summary.trim().length > 0, true);
      assert.equal(item.source.trim().length > 0, true);
      assert.equal(item.description.includes(item.source), true);
      categories.add(item.category);
      if (item.kind === "document") {
        documents += 1;
        assert.equal(item.description.includes("Never invent"), true);
        assert.equal(item.description.includes("markdown"), true);
        continue;
      }
      if (item.kind === "diagram") {
        diagrams += 1;
        assert.equal(item.description.includes("Never invent"), true);
        assert.equal(item.description.includes("markdown"), true);
        continue;
      }
      if (item.kind === "script") {
        scripts += 1;
        assert.equal(item.command.trim().length > 0, true);
        assert.equal(item.command.includes("|"), false);
        assert.equal(item.description.includes("Command:"), true);
        continue;
      }
      if (item.kind === "task") {
        tasks += 1;
        assert.equal(item.stageTitle.trim().length > 0, true);
        assert.equal(item.taskNodes.length > 0, true);
        assert.equal(item.description.includes("Stage:"), true);
        continue;
      }
      assert.fail(`unexpected kind ${item.id}`);
    }
    assert.equal(documents >= 80, true);
    assert.equal(diagrams >= 40, true);
    assert.equal(scripts >= 8, true);
    assert.equal(tasks >= 14, true);
    assert.equal(categories.size, MARKETPLACE_CATEGORIES.length);
    assert.equal(marketplaceItemById("doc-adr-madr") !== null, true);
    assert.equal(marketplaceItemById("diag-c4-context") !== null, true);
    assert.equal(marketplaceItemById("script-npm-test") !== null, true);
    assert.equal(marketplaceItemById("script-semgrep") !== null, true);
    assert.equal(marketplaceItemById("script-trivy") !== null, true);
    assert.equal(marketplaceItemById("script-sonar-scanner") !== null, true);
    assert.equal(marketplaceItemById("task-feature") !== null, true);
    assert.equal(marketplaceItemById("task-requirements") !== null, true);
    assert.equal(marketplaceItemById("task-code-review") !== null, true);
    assert.equal(marketplaceItemById("task-ai-change") !== null, true);
    assert.equal(marketplaceItemById("missing-item"), null);
    assert.equal(isBuiltinMarketplaceId("script-npm-test"), true);
    assert.equal(isBuiltinMarketplaceId("import-echo-hello"), false);
  });

  it("round-trips the catalog as a JSON pack and rejects a script without a command", () => {
    const pack = marketplacePackFromItems(MARKETPLACE_CATALOG);
    assert.equal(pack.format, MARKETPLACE_PACK_FORMAT);
    const again = parseMarketplacePack(JSON.parse(JSON.stringify(pack)));
    assert.equal(again.items.length, MARKETPLACE_CATALOG.length);
    assert.throws(() => {
      parseMarketplacePack({
        format: MARKETPLACE_PACK_FORMAT,
        version: 1,
        items: [
          {
            id: "import-broken-script",
            kind: "script",
            category: "quality",
            title: "Broken",
            summary: "Missing command",
            source: "Test",
            description: "no command",
            command: "",
            triggerType: "manual",
            triggerGlob: "",
            triggerBusEvent: "",
            concurrency: "ignore",
            stageTitle: "",
            stageRules: [],
            taskNodes: [],
          },
        ],
      });
    });
  });
});
