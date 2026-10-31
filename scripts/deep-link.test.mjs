import { test } from "node:test";
import assert from "node:assert/strict";
import { redirectSystemPath } from "../src/lib/deep-link.ts";
test("native and website invitation paths preserve the single-use secret", () => {
  for (const path of [
    "chatappnative://invitations/5?token=secret",
    "https://chat.example.test/invitations/5?token=secret",
  ])
    assert.equal(
      redirectSystemPath({ path, initial: true }),
      "/account?invitation=5&token=secret",
    );
});
test("reset paths carry email and token to the native reset form", () => {
  assert.equal(
    redirectSystemPath({
      path: "chatappnative://reset-password/reset123?email=user%40example.com",
      initial: true,
    }),
    "/account?token=reset123&email=user%40example.com",
  );
});
