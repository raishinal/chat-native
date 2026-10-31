import { test } from "node:test";
import assert from "node:assert/strict";
import {
  messageHistoryPath,
  mergeMessages,
  recoverPages,
} from "../src/lib/core.ts";

const message = {
  id: 12,
  conversation_id: 3,
  sender_id: 1,
  client_id: "first",
  body: "Original",
  attachments: [{ id: 4, name: "file.txt" }],
  created_at: "2026-10-31T10:00:00Z",
};

test("history reconciliation includes older loaded messages and ignores local sends", () => {
  assert.equal(
    messageHistoryPath(3, [
      { ...message, id: -1, state: "sending" },
      { ...message, id: -2, state: "failed" },
      { ...message, id: 20, client_id: "latest" },
      message,
    ]),
    "conversations/3/messages?after_id=11",
  );
  assert.equal(
    messageHistoryPath(3, [{ ...message, id: 1 }]),
    "conversations/3/messages?after_id=0",
  );
});

test("rooms without server messages fetch the latest history page", () => {
  assert.equal(messageHistoryPath(3, []), "conversations/3/messages");
  assert.equal(
    messageHistoryPath(3, [{ ...message, id: -1, state: "failed" }]),
    "conversations/3/messages",
  );
});

test("reconnect recovers edits, deleted files and tombstones across cursor pages", async () => {
  const second = { ...message, id: 13, client_id: "second" };
  const third = { ...message, id: 14, client_id: "third" };
  let rows = [message, second, third];
  const paths = [];
  await recoverPages(
    messageHistoryPath(3, rows),
    async (path) => {
      paths.push(path);
      return path === "conversations/3/messages?after_id=11"
        ? {
            data: [
              { ...message, body: "Edited", edited_at: "2026-10-31T11:00:00Z" },
            ],
            links: { next: "/cursor/next" },
          }
        : {
            data: [
              { ...second, attachments: [] },
              {
                ...third,
                body: null,
                attachments: [],
                deleted_at: "2026-10-31T11:01:00Z",
              },
            ],
            links: { next: null },
          };
    },
    (incoming) => {
      rows = mergeMessages(rows, incoming);
    },
  );
  assert.deepEqual(paths, [
    "conversations/3/messages?after_id=11",
    "/cursor/next",
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].body, "Edited");
  assert.equal(rows[0].edited_at, "2026-10-31T11:00:00Z");
  assert.deepEqual(rows[1].attachments, []);
  assert.equal(rows[2].body, null);
  assert.deepEqual(rows[2].attachments, []);
  assert.equal(rows[2].deleted_at, "2026-10-31T11:01:00Z");
});
