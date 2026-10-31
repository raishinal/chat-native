// Explicit, opt-in contract check against a running development backend.
// Creates and revokes one token; does not create users, messages, files or calls.
import assert from 'node:assert/strict';
import { Client } from '../src/lib/transport.ts';
const origin = process.env.RELAY_API_ORIGIN;
if (!origin || !process.env.RELAY_TEST_EMAIL || !process.env.RELAY_TEST_PASSWORD) throw new Error('Set RELAY_API_ORIGIN, RELAY_TEST_EMAIL and RELAY_TEST_PASSWORD for a test account.');
const client = new Client(origin);
const login = await client.request('tokens', 'POST', { email: process.env.RELAY_TEST_EMAIL, password: process.env.RELAY_TEST_PASSWORD, device_name: 'Relay contract smoke test' });
client.token = login.token;
try {
  const self = await client.request('me'); assert.equal(self.data.status, 'active'); assert.equal(self.data.id, login.user.id);
  for (const path of ['conversations', 'users', 'notifications', 'calls']) { const page = await client.request(path); assert.ok(Array.isArray(page.data)); }
  if (self.data.role === 'admin') { const result = await client.request('admin/users'); assert.ok(result.metrics); assert.ok(Array.isArray(result.users.data)); }
  console.log('PASS: native bearer login, session, resource pages and role-protected admin contract');
} finally { await client.request('tokens/current', 'DELETE'); }
await assert.rejects(client.request('me'), error => error.status === 401);
console.log('PASS: current token revocation');
