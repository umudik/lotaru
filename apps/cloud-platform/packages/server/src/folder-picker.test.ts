import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { folderPickerSpec, parseFolderPickerStdout } from "./folder-picker.js";

describe("folderPickerSpec", () => {
  it("uses PowerShell STA folder dialog on Windows", () => {
    const spec = folderPickerSpec("win32");
    assert.equal(spec.cmd, "powershell");
    assert.equal(spec.args.includes("-STA"), true);
    assert.equal(spec.args.includes("-Command"), true);
  });

  it("uses osascript on macOS", () => {
    const spec = folderPickerSpec("darwin");
    assert.equal(spec.cmd, "osascript");
    assert.equal(spec.args[0], "-e");
  });

  it("uses zenity on linux", () => {
    const spec = folderPickerSpec("linux");
    assert.equal(spec.cmd, "zenity");
    assert.equal(spec.args.includes("--directory"), true);
  });
});

describe("parseFolderPickerStdout", () => {
  it("returns a trimmed path", () => {
    assert.equal(parseFolderPickerStdout("  C:\\code\\app  \n"), "C:\\code\\app");
  });

  it("returns null when the user cancels", () => {
    assert.equal(parseFolderPickerStdout(" \n"), null);
  });
});
