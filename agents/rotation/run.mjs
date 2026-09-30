import OpenAI from 'openai';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createToolbox, checkRequest, toolDefinitions } from './tools.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const instructions = await readFile(new URL('./instructions.md', import.meta.url), 'utf8');

export async function runAgent(client, input, { toolbox = createToolbox(), save = async () => {}, timeoutMs = 180_000 } = {}) {
  const state = { sessionId: null, turnId: null, status: 'starting', text: '', drafts: [], calls: [], toolErrors: [], commands: [], cleanup: 'not_created' };
  const outputs = new Map(), results = new Map();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let events;
  const persist = async () => {
    state.drafts = [...toolbox.drafts.values()]; state.calls = [...toolbox.calls];
    await save(state);
  };
  try {
    events = await client.beta.agents.sessions.create({
      agent: { model: process.env.OPENAI_AGENT_MODEL || 'gpt-6-astra', instructions, tools: toolDefinitions },
      environment: { type: 'openai_hosted' }, input, stream: true,
    }, { signal: controller.signal });
    for await (const event of events) {
      state.sessionId ||= event.session?.id || event.session_id;
      if (event.turn && event.turn.subagent_id == null) state.turnId ||= event.turn.id;
      if (event.type === 'agent.session.created') { state.cleanup = 'pending'; await persist(); }
      if (event.type === 'agent.session.turn.in_progress') state.status = 'in_progress';
      if (event.type === 'agent.session.turn.item.done' && event.item?.type === 'command_execution') state.commands.push(event.item);
      if (event.type === 'agent.session.requires_action') {
        for (const action of event.session.required_actions ?? []) {
          if (action.type !== 'function_call') throw new Error(`Unhandled action: ${action.type}`);
          state.turnId ||= action.turn_id;
          const key = `${action.turn_id}:${action.call_id}`;
          if (!results.has(key)) {
            if (results.size >= 12) throw new Error('Tool-call limit reached.');
            let outcome;
            try {
              const output = toolbox.execute(action.name, action.arguments);
              outcome = { success: true, output: JSON.stringify(output) };
            } catch (error) {
              outcome = { success: false, error: error.message };
              state.toolErrors.push({ name: action.name, error: error.message });
            }
            results.set(key, outcome);
          }
          await persist();
          await client.beta.agents.sessions.events.create(state.sessionId, { events: [{
            type: 'agent.session.input.tool_result', turn_id: action.turn_id, call_id: action.call_id, ...results.get(key),
          }] }, { signal: controller.signal });
        }
      }
      if (event.type === 'agent.session.turn.output_text.done') outputs.set(`${event.item_id}:${event.content_index}`, event.text);
      if (event.type === 'error' || ['agent.session.failed', 'agent.session.environment.failed'].includes(event.type)) throw new Error(`Agent lifecycle failed: ${event.type}`);
      if (event.turn?.subagent_id == null && ['agent.session.turn.failed', 'agent.session.turn.cancelled'].includes(event.type)) throw new Error(`${event.type}: ${event.turn?.error?.message || ''}`);
      if (event.type === 'agent.session.turn.completed' && event.turn.subagent_id == null && event.turn.id === state.turnId) {
        state.status = 'completed'; break;
      }
    }
    if (state.status !== 'completed') throw new Error('Stream ended before completion; do not automatically resubmit the request.');
    if (!outputs.size) {
      const turn = await client.beta.agents.sessions.turns.retrieve(state.turnId, { session_id: state.sessionId });
      if (turn.status !== 'completed') throw new Error(`Turn status: ${turn.status}`);
      for await (const item of client.beta.agents.sessions.items.list(state.sessionId, { order: 'asc' })) {
        if (item.turn_id === state.turnId && item.role === 'assistant') {
          for (const part of item.content ?? []) if (part.type === 'output_text') outputs.set(`${item.id}:${outputs.size}`, part.text);
        }
      }
    }
    state.text = [...outputs.values()].join('\n');
    if (!state.text) throw new Error('Completed turn has no retrievable assistant text.');
    await persist();
    return state;
  } catch (error) {
    state.status = 'failed';
    // Do not serialize SDK error objects: they can contain request headers.
    state.error = error.status ? `OpenAI HTTP ${error.status}; code=${error.code || 'unknown'}` : error.message;
    throw Object.assign(new Error(state.error), { state });
  } finally {
    clearTimeout(timer);
    events?.controller.abort();
    if (state.sessionId) {
      try {
        await client.beta.agents.sessions.delete(state.sessionId);
        state.cleanup = 'deleted';
      } catch (cleanupError) {
        state.cleanup = 'retained; inspect and delete this session before retrying';
        if (cleanupError.status === 409) {
          try {
            await client.beta.agents.sessions.events.create(state.sessionId, { events: [{ type: 'agent.session.input.cancel' }] });
            await new Promise(resolve => setTimeout(resolve, 1000));
            await client.beta.agents.sessions.delete(state.sessionId);
            state.cleanup = 'deleted';
          } catch { /* Preserve the session ID if setup or cancellation has not settled. */ }
        }
      }
    }
    await persist();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const promptIndex = args.indexOf('--prompt');
  const request = JSON.parse(await readFile(new URL('./example.json', import.meta.url), 'utf8'));
  const toolbox = createToolbox();
  const outputDir = join(root, 'data', 'rotation-agent', `${Date.now()}`);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const save = state => writeFile(join(outputDir, 'result.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  if (offline) {
    checkRequest(request);
    toolbox.execute('get_rotation_context');
    const draft = toolbox.execute('draft_rotation', request);
    const validation = toolbox.execute('validate_rotation', { draftId: draft.id });
    await save({ mode: 'offline-tools-only', calls: toolbox.calls, drafts: [...toolbox.drafts.values()] });
    if (!validation.valid) throw new Error('Offline validation failed.');
    console.log(`Offline tool workflow passed; ${draft.rows.length} rotations.\nResult: ${join(outputDir, 'result.json')}`);
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    try { process.loadEnvFile(join(root, '.env.local')); } catch { throw new Error('No configured OPENAI_API_KEY.'); }
  }
  const client = new OpenAI({ maxRetries: 0, timeout: 30_000 });
  const input = promptIndex >= 0 ? args[promptIndex + 1] : `Create and validate a draft for this confirmed request: ${JSON.stringify(request)}. All names are synthetic test data. Also verify the hosted sandbox by writing and reading /workspace/rotation-health.txt containing rotation-ok.`;
  if (!input) throw new Error('--prompt requires text.');
  try {
    const result = await runAgent(client, input, { toolbox, save });
    if (promptIndex < 0) {
      assert.ok(result.drafts.length, 'Live workflow did not produce a draft.');
      for (const draft of result.drafts) {
        assert.deepEqual(draft.request, request, 'The agent changed the confirmed request.');
        assert.equal(draft.validation?.valid, true, 'Draft was not validated.');
      }
      assert.ok(result.commands.some(c => c.exit_code === 0 && c.command.includes('rotation-health.txt') && c.output?.includes('rotation-ok')), 'Hosted command success was not verified.');
    }
    console.log(`${result.text}\n\nSession: ${result.sessionId}\nCleanup: ${result.cleanup}\nResult: ${join(outputDir, 'result.json')}`);
  } catch (error) {
    console.error(`Agent run failed: ${error.message}\nResult: ${join(outputDir, 'result.json')}`);
    if (error.state?.sessionId) console.error(`Session: ${error.state.sessionId}; ${error.state.cleanup}`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
