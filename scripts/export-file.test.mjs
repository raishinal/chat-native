import test from "node:test";
import assert from "node:assert/strict";
import { exportFile, safeDownloadName } from "../src/lib/export-file.ts";
test("save cancellation never fetches or exports a file", async () => {
  let loaded = false;
  assert.equal(
    await exportFile({
      select: async () => null,
      load: async () => {
        loaded = true;
        return "";
      },
      current: () => true,
      copy: async () => assert.fail(),
    }),
    false,
  );
  assert.equal(loaded, false);
});
test("save selects first, fetches privately, then copies to selected destination", async () => {
  const calls = [];
  assert.equal(
    await exportFile({
      select: async () => {
        calls.push("select");
        return "destination";
      },
      load: async () => {
        calls.push("fetch");
        return "private";
      },
      current: () => true,
      copy: async (from, to) => {
        assert.equal(from, "private");
        assert.equal(to, "destination");
        calls.push("copy");
      },
    }),
    true,
  );
  assert.deepEqual(calls, ["select", "fetch", "copy"]);
});
test("account changes while picker is open block fetching", async () => {
  await assert.rejects(
    exportFile({
      select: async () => "destination",
      current: () => false,
      load: async () => assert.fail(),
      copy: async () => assert.fail(),
    }),
    /Session changed/,
  );
});
test("account changes during fetching block export", async () => {
  let active = true;
  await assert.rejects(
    exportFile({
      select: async () => "destination",
      current: () => active,
      load: async () => {
        active = false;
        return "private";
      },
      copy: async () => assert.fail(),
    }),
    /Session changed/,
  );
});
test("download names cannot contain path separators or control characters", () => {
  assert.equal(safeDownloadName("../a\\b\n.pdf"), "__a_b_.pdf");
  assert.equal(safeDownloadName(" "), "attachment");
  assert.equal(safeDownloadName("holiday.jpg"), "holiday.jpg");
});
