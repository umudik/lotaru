import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authedGitCloneUrl,
  azureRepoOwnerParts,
  parseAzureDevopsSecret,
  parseBitbucketSecret,
  publicGitCloneUrl,
} from "./git-providers.js";

describe("git providers", () => {
  it("parses azure organization and PAT from a space-separated secret", () => {
    const fromName = parseAzureDevopsSecret("fabrikam azdopat123456");
    const fromUrl = parseAzureDevopsSecret("https://dev.azure.com/fabrikam azdopat123456");
    const missingOrg = parseAzureDevopsSecret("azdopat123456");
    const badHost = parseAzureDevopsSecret("https://example.com/fabrikam azdopat123456");
    assert.equal(fromName.length, 1);
    assert.equal(fromName[0]?.organization, "fabrikam");
    assert.equal(fromName[0]?.token, "azdopat123456");
    assert.equal(fromUrl.length, 1);
    assert.equal(fromUrl[0]?.organization, "fabrikam");
    assert.equal(missingOrg.length, 0);
    assert.equal(badHost.length, 0);
  });

  it("builds azure and bitbucket clone urls from owner and repo", () => {
    const azureOwner = azureRepoOwnerParts("fabrikam/Fabrikam Fiber");
    assert.equal(azureOwner.length, 1);
    assert.equal(azureOwner[0]?.project, "Fabrikam Fiber");
    const azurePublic = publicGitCloneUrl("azuredevops", "fabrikam/Fabrikam Fiber", "platform");
    const azureAuthed = authedGitCloneUrl("azuredevops", "p@ss", "fabrikam/Fabrikam Fiber", "platform");
    const bitbucketPublic = publicGitCloneUrl("bitbucket", "acme", "platform");
    const bitbucketAuthed = authedGitCloneUrl("bitbucket", "bbtoken", "acme", "platform");
    const brokenAzure = publicGitCloneUrl("azuredevops", "fabrikam", "platform");
    assert.equal(azurePublic, "https://dev.azure.com/fabrikam/Fabrikam%20Fiber/_git/platform");
    assert.equal(
      azureAuthed,
      "https://fabrikam:p%40ss@dev.azure.com/fabrikam/Fabrikam%20Fiber/_git/platform",
    );
    assert.equal(bitbucketPublic, "https://bitbucket.org/acme/platform.git");
    assert.equal(bitbucketAuthed, "https://x-token-auth:bbtoken@bitbucket.org/acme/platform.git");
    assert.equal(brokenAzure, "");
  });

  it("parses bitbucket workspace tokens and username app passwords", () => {
    const bearer = parseBitbucketSecret("workspacetoken12");
    const basic = parseBitbucketSecret("alice app-password-1");
    const empty = parseBitbucketSecret("   ");
    assert.equal(bearer.length, 1);
    assert.equal(bearer[0]?.username, "x-token-auth");
    assert.equal(bearer[0]?.token, "workspacetoken12");
    assert.equal(basic.length, 1);
    assert.equal(basic[0]?.username, "alice");
    assert.equal(basic[0]?.token, "app-password-1");
    assert.equal(empty.length, 0);
  });
});
