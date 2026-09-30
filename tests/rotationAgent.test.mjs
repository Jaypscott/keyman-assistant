import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createToolbox, checkRequest, validateDraft } from '../agents/rotation/tools.mjs';
import { runAgent } from '../agents/rotation/run.mjs';
const request = JSON.parse(await readFile(new URL('../agents/rotation/example.json', import.meta.url)));

test('complete tool workflow covers six periods with each volunteer assigned once per period', () => {
  const box = createToolbox();
  assert.equal(box.execute('get_rotation_context').locations.length, 3);
  const draft = box.execute('draft_rotation', request);
  const validation = box.execute('validate_rotation', { draftId: draft.id });
  assert.equal(draft.rows.length, 6);
  assert.equal(validation.valid, true);
  for (const row of draft.rows) assert.deepEqual(Object.values(row.assignments).flat().sort(), [...request.names].sort());
  assert.ok([...box.drafts.values()][0].validation.valid);
});

test('rejects invalid dates, duplicate names, excess capacity and unsupported constraints', () => {
  for (const override of [
    { date: '2026-02-30' }, { names: ['Alex', ' alex '] }, { names: ['Alex'] },
    { names: Array.from({ length: 7 }, (_, i) => `Person ${i}`) },
    { availableWholeShift: false }, { duration: 0 }, { duration: '30' },
    { shiftId: 'missing' }, { primaryOnly: 'false' }, { breaks: true },
  ]) assert.throws(() => checkRequest({ ...request, ...override }));
});

test('validator detects corrupted assignments and intervals', () => {
  const box = createToolbox();
  const draft = box.execute('draft_rotation', request);
  draft.rows[0].assignments.primary = ['Unknown', 'Unknown'];
  draft.rows[1].time = 'wrong';
  assert.equal(validateDraft(draft).valid, false);
  assert.equal(box.execute('validate_rotation', { draftId: draft.id }).valid, true, 'returned copies cannot mutate stored drafts');
  assert.throws(() => box.execute('validate_rotation', { draftId: '../anything' }));
  assert.throws(() => box.execute('publish_rotation', {}));
});

test('primary-only and reduced crews preserve coverage and report omitted Secondary', () => {
  for (const primaryOnly of [false, true]) {
    const box = createToolbox();
    const draft = box.execute('draft_rotation', { ...request, primaryOnly, names: request.names.slice(0, 4) });
    const v = validateDraft(draft);
    assert.equal(v.valid, true);
    assert.equal(v.warnings.length, primaryOnly ? 0 : 1);
    assert.ok(draft.rows.every(r => !r.assignments.secondary));
  }
});

function fakeClient(factory) {
  const sent = [], deleted = [];
  const client = { beta: { agents: { sessions: {
    create: async () => ({ [Symbol.asyncIterator]: () => factory()[Symbol.asyncIterator](), controller: { abort() {} } }),
    events: { create: async (id, body) => sent.push({ id, ...body }) },
    delete: async id => deleted.push(id),
  } } } };
  return { client, sent, deleted };
}
const created = { type: 'agent.session.created', session: { id: 'sess_test' } };
const complete = { type: 'agent.session.turn.completed', session_id: 'sess_test', turn: { id: 'turn_test', subagent_id: null } };
const call = (name, args, id) => ({ type: 'agent.session.requires_action', session: { id: 'sess_test', required_actions: [{ type: 'function_call', turn_id: 'turn_test', call_id: id, name, arguments: args }] } });

test('agent event workflow executes tools, correlates results, deduplicates calls and cleans up', async () => {
  const box = createToolbox();
  const fake = fakeClient(async function* () {
    yield created;
    yield call('get_rotation_context', {}, 'context');
    yield call('draft_rotation', request, 'draft');
    yield call('draft_rotation', request, 'draft');
    yield call('validate_rotation', { draftId: [...box.drafts.keys()][0] }, 'validate');
    yield { type: 'agent.session.turn.output_text.done', item_id: 'm1', content_index: 0, text: 'DRAFT ready.' };
    yield complete;
  });
  const result = await runAgent(fake.client, 'test', { toolbox: box });
  assert.equal(result.status, 'completed');
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].validation.valid, true);
  assert.equal(result.cleanup, 'deleted');
  assert.equal(fake.sent[1].events[0].call_id, 'draft');
  assert.equal(fake.sent[1].events[0].turn_id, 'turn_test');
  assert.equal(fake.sent[1].events[0].output, fake.sent[2].events[0].output);
});

test('tool errors return failure rather than claiming a schedule exists', async () => {
  const fake = fakeClient(async function* () {
    yield created;
    yield call('draft_rotation', { ...request, names: [] }, 'bad');
    yield { type: 'agent.session.turn.output_text.done', item_id: 'm1', content_index: 0, text: 'Please provide a roster.' };
    yield complete;
  });
  const result = await runAgent(fake.client, 'test');
  assert.equal(fake.sent[0].events[0].success, false);
  assert.equal(result.drafts.length, 0);
  assert.equal(result.toolErrors.length, 1);
});

test('idle, disconnected, failed and cancelled streams cannot pass as completed', async () => {
  for (const type of ['agent.session.idle', 'agent.session.turn.failed', 'agent.session.turn.cancelled']) {
    const fake = fakeClient(async function* () { yield created; yield { type, turn: { id: 'turn_test', subagent_id: null } }; });
    await assert.rejects(runAgent(fake.client, 'test'));
    assert.deepEqual(fake.deleted, ['sess_test']);
  }
});

test('cleanup cancels active work on conflict and retries deletion once', async () => {
  const fake = fakeClient(async function* () { yield created; });
  let attempts = 0;
  fake.client.beta.agents.sessions.delete = async () => {
    if (++attempts === 1) throw Object.assign(new Error('busy'), { status: 409 });
  };
  await assert.rejects(runAgent(fake.client, 'test'), error => error.state.cleanup === 'deleted');
  assert.equal(attempts, 2);
  assert.equal(fake.sent[0].events[0].type, 'agent.session.input.cancel');
});
