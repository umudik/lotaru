import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mermaidRenderSource, mermaidSourceFromBody } from "./mermaid-source.js";

describe("mermaidSourceFromBody", () => {
  it("returns empty for blank bodies", () => {
    assert.equal(mermaidSourceFromBody(""), "");
    assert.equal(mermaidSourceFromBody("   \n\t  "), "");
  });

  it("unwraps the first mermaid fence", () => {
    const body = ["Intro", "", "```mermaid", "flowchart LR", "  A --> B", "```", "tail"].join("\n");
    assert.equal(mermaidSourceFromBody(body), "flowchart LR\n  A --> B");
  });

  it("unwraps unlabeled fences when they hold a graph", () => {
    const body = ["```", "sequenceDiagram", "  Alice->>Bob: hi", "```"].join("\n");
    assert.equal(mermaidSourceFromBody(body), "sequenceDiagram\n  Alice->>Bob: hi");
  });

  it("keeps raw mermaid when there is no fence", () => {
    const body = "flowchart TB\n  start --> stop";
    assert.equal(mermaidSourceFromBody(body), body);
  });
});

describe("mermaidRenderSource", () => {
  it("returns empty for blank source", () => {
    assert.equal(mermaidRenderSource(""), "");
    assert.equal(mermaidRenderSource("   \n"), "");
  });

  it("pins base theme so mermaid 12 does not keep redux-color", () => {
    const rendered = mermaidRenderSource("flowchart TD\n  A --> B");
    assert.equal(rendered.startsWith("---\nconfig:\n  theme: base\n  look: neo\n"), true);
    assert.equal(rendered.includes("primaryColor: '#1c1d2a'"), true);
    assert.equal(rendered.endsWith("flowchart TD\n  A --> B"), true);
  });

  it("leaves source that already has frontmatter", () => {
    const body = "---\nconfig:\n  theme: forest\n---\nflowchart LR\n  A --> B";
    assert.equal(mermaidRenderSource(body), body);
  });
});
