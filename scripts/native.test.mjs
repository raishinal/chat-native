import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acquireMedia,
  Lifetime,
  mergeMessages,
  Once,
  recoverPages,
  SignalAssembler,
} from "../src/lib/core.ts";
import { SessionState } from "../src/lib/session-state.ts";
import { redirectSystemPath } from "../src/lib/deep-link.ts";

const user = { id: 1, name: "Member", role: "user", status: "active" };
const message = {
  id: 5,
  conversation_id: 2,
  sender_id: 1,
  client_id: "uuid",
  body: "Hello",
  attachments: [],
  created_at: "2026-01-01T00:00:00Z",
};
function storage(value = null) {
  return {
    value,
    async read() {
      return this.value;
    },
    async write(v) {
      this.value = v;
    },
    async clear() {
      this.value = null;
    },
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test("session restoration validates the stored bearer before exposing an account", async () => {
  const store = storage("bearer");
  const installed = [];
  const state = new SessionState(store, (...args) => installed.push(args));
  const waiting = deferred();
  const restore = state.restore((token) => {
    assert.equal(token, "bearer");
    return waiting.promise;
  });
  await Promise.resolve();
  assert.equal(installed.length, 0);
  waiting.resolve(user);
  await restore;
  assert.deepEqual(installed, [["bearer", user]]);
});
test("revoked tokens and suspended accounts clear secure storage", async () => {
  for (const status of [401, 403]) {
    const store = storage("old");
    let current = "old";
    const state = new SessionState(store, (token) => {
      current = token;
    });
    await assert.rejects(
      state.restore(async () => {
        throw Object.assign(new Error("Blocked"), { status });
      }),
    );
    assert.equal(store.value, null);
    assert.equal(current, "");
  }
});
test("network failures retain the secure token for an explicit retry", async () => {
  const store = storage("bearer");
  const state = new SessionState(store, () =>
    assert.fail("No authenticated account yet"),
  );
  await assert.rejects(
    state.restore(async () => {
      throw new Error("Offline");
    }),
  );
  assert.equal(store.value, "bearer");
});
test("logout during restoration cannot revive the account", async () => {
  const store = storage("old"),
    waiting = deferred(),
    installed = [];
  const state = new SessionState(store, (...args) => installed.push(args));
  const restoring = state.restore(() => waiting.promise);
  await Promise.resolve();
  await state.clear();
  waiting.resolve(user);
  await restoring;
  assert.deepEqual(installed, [["", null]]);
});
test("pending and suspended logins never store tokens", async () => {
  for (const status of ["pending", "suspended"]) {
    const store = storage();
    const state = new SessionState(store, () =>
      assert.fail("Must remain blocked"),
    );
    await assert.rejects(state.login("token", { ...user, status }));
    assert.equal(store.value, null);
  }
});
test("login persists securely before installing session, logout removes it", async () => {
  const store = storage();
  const state = new SessionState(store, (token) => {
    if (token) assert.equal(store.value, token);
  });
  await state.login("fresh", user);
  assert.equal(store.value, "fresh");
  await state.clear();
  assert.equal(store.value, null);
});
test("sender broadcast, API response, and optimistic send merge into one canonical row", () => {
  let rows = mergeMessages([], [{ ...message, id: -1, state: "sending", created_at: "2026-01-01T00:00:05Z" }]);
  rows = mergeMessages(rows, [message]);
  rows = mergeMessages(rows, [
    message,
    { ...message, id: -1, state: "failed" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 5);
  assert.equal(rows[0].state, undefined);
});
test("UUID deduplication remains scoped to the sender", () => {
  assert.equal(
    mergeMessages([message], [{ ...message, id: 6, sender_id: 2 }]).length,
    2,
  );
});

test("late message responses cannot undo an edit or restore a deleted message", () => {
  const edited = {
    ...message,
    body: "Updated",
    edited_at: "2026-01-01T00:01:00Z",
  };
  assert.deepEqual(mergeMessages([edited], [message]), [edited]);
  const deleted = { ...edited, body: null, deleted_at: "2026-01-01T00:02:00Z" };
  assert.deepEqual(mergeMessages([deleted], [edited, message]), [deleted]);
  assert.deepEqual(mergeMessages([message], [edited, deleted]), [deleted]);
});
test("notification alerts deduplicate repeated live delivery", () => {
  const once = new Once();
  assert.equal(once.take("notice:1"), true);
  assert.equal(once.take("notice:1"), false);
  assert.equal(once.take("notice:2"), true);
});
test("reconnect follows every opaque page to bridge a long gap", async () => {
  const paths = [];
  let rows = [];
  await recoverPages(
    "messages?after_id=5",
    async (path) => {
      paths.push(path);
      return path === "messages?after_id=5"
        ? { data: [6, 7], links: { next: "/api/v1/messages?cursor=opaque" } }
        : { data: [8], links: { next: null } };
    },
    (data) => {
      rows.push(...data);
    },
  );
  assert.deepEqual(rows, [6, 7, 8]);
  assert.equal(paths.length, 2);
});
test("reconnect failures propagate and repeated next links cannot loop", async () => {
  await assert.rejects(
    recoverPages(
      "a",
      async () => {
        throw new Error("Offline");
      },
      () => {},
    ),
  );
  let count = 0;
  await recoverPages(
    "a",
    async () => {
      count++;
      return { data: [], links: { next: "a" } };
    },
    () => {},
  );
  assert.equal(count, 1);
});
test("out-of-order and duplicate UTF-8 signal chunks reconstruct once", () => {
  const a = new SignalAssembler(),
    encoded = Buffer.from(JSON.stringify({ sdp: "hello 世界" })).toString(
      "base64",
    );
  const s = {
    call_id: 1,
    type: "offer",
    signal_id: "a",
    total: 2,
    index: 1,
    chunk: encoded.slice(10),
  };
  assert.equal(a.add(s, 0), null);
  const raw = a.add({ ...s, index: 0, chunk: encoded.slice(0, 10) }, 1);
  assert.equal(
    Buffer.from(raw, "base64").toString(),
    JSON.stringify({ sdp: "hello 世界" }),
  );
  assert.equal(a.add(s, 2), null);
  assert.equal(a.add({ ...s, index: 0, chunk: encoded.slice(0, 10) }, 3), null);
});
test("signal groups reject mixed calls and expire incomplete groups", () => {
  const a = new SignalAssembler(),
    s = {
      call_id: 1,
      type: "ice",
      signal_id: "a",
      total: 2,
      index: 0,
      chunk: "ab",
    };
  assert.equal(a.add(s, 0), null);
  assert.equal(a.add({ ...s, call_id: 2, index: 1 }, 1), null);
  assert.equal(a.add({ ...s, index: 1 }, 30001), null);
  assert.equal(a.add({ ...s, total: 1000 }), null);
});
function track() {
  return {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
}
function media(audio = [], video = []) {
  return {
    getTracks: () => [...audio, ...video],
    getAudioTracks: () => audio,
    getVideoTracks: () => video,
    addTrack(t) {
      video.push(t);
    },
  };
}
test("camera denial keeps the separately acquired microphone", async () => {
  const microphone = track(),
    requests = [];
  const result = await acquireMedia(
    true,
    async (c) => {
      requests.push(c);
      if (c.video) throw new Error("Camera denied");
      return media([microphone]);
    },
    () => true,
  );
  assert.deepEqual(requests, [
    { audio: true, video: false },
    { audio: false, video: true },
  ]);
  assert.equal(result.getAudioTracks().length, 1);
  assert.equal(microphone.stopped, false);
});
test("missing microphone blocks a silent call", async () => {
  await assert.rejects(
    acquireMedia(
      false,
      async () => media(),
      () => true,
    ),
    /No microphone/,
  );
  await assert.rejects(
    acquireMedia(
      true,
      async () => {
        throw new Error("Permission denied");
      },
      () => true,
    ),
    /Enable microphone permission/,
  );
});
test("hang-up while microphone permission is pending stops the late track", async () => {
  const life = new Lifetime(),
    gen = life.generation,
    waiting = deferred(),
    mic = track();
  const task = acquireMedia(
    false,
    () => waiting.promise,
    () => life.valid(gen, 1),
  );
  life.stop(1);
  waiting.resolve(media([mic]));
  await assert.rejects(task, /cancelled/);
  assert.equal(mic.stopped, true);
});
test("hang-up during camera allocation releases both captures", async () => {
  const life = new Lifetime(),
    gen = life.generation,
    waiting = deferred(),
    mic = track(),
    cam = track();
  const task = acquireMedia(
    true,
    async (c) => (c.audio ? media([mic]) : waiting.promise),
    () => life.valid(gen, 1),
  );
  await Promise.resolve();
  await Promise.resolve();
  life.stop(1);
  waiting.resolve(media([], [cam]));
  await assert.rejects(task, /cancelled/);
  assert.equal(mic.stopped, true);
  assert.equal(cam.stopped, true);
});
test("late heartbeat and signaling generations cannot reopen ended calls", () => {
  const life = new Lifetime(),
    generation = life.generation;
  assert.equal(life.valid(generation, 1), true);
  life.stop(1);
  assert.equal(life.valid(generation, 1), false);
  assert.equal(life.valid(life.generation, 1), false);
  assert.equal(life.valid(life.generation, 2), true);
});
