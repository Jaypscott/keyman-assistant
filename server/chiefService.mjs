import { validateReviewedRoster } from '../services/volunteers/rosterImport.mjs';
import { randomUUID } from 'node:crypto';
import { newConversation } from './chiefStore.mjs';
import { chiefClient, cleanupChiefSession, runChiefTurn } from './chiefAgent.mjs';
import { locationPages } from '../constants/locationPages.mjs';
import { validateDraft } from '../agents/rotation/tools.mjs';
const fault = (status, message) => Object.assign(new Error(message), { status });
const safeError = e => e.status === 429 ? 'Chief is at its API usage limit. Try again later.' : e.status === 401 || e.status === 403 ? 'Chief’s server access needs attention.' : 'Chief could not finish this request. Start a new conversation to continue safely.';
export function sanitizeContext(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const context = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) context.date = raw.date;
  const location = locationPages.find(l => l.id === raw.locationId);
  if (location) {
    context.locationId = location.id;
    if (location.shifts.some(s => s.id === raw.shiftId)) context.shiftId = raw.shiftId;
  }
  if ([15,20,30].includes(raw.duration)) context.duration = raw.duration;
  if (typeof raw.primaryOnly === 'boolean') context.primaryOnly = raw.primaryOnly;
  if (Array.isArray(raw.names)) context.names = raw.names.filter(n => typeof n === 'string' && n.trim() && n.length <= 100).slice(0,8).map(n => n.trim());
  if (raw.activeDraft && context.locationId && context.shiftId && context.names?.length) {
    const draft = { request: { ...context, availableWholeShift: true }, rows: raw.activeDraft.rows };
    try {
      if (validateDraft(draft).valid) context.activeDraft = { rows: draft.rows.map(row => ({ time: row.time, assignments: Object.fromEntries(Object.entries(row.assignments).map(([role,names]) => [role, [...names]])) })) };
    } catch { /* Incomplete app context is not a confirmed scheduling request. */ }
  }
  return context;
}
export function publicConversation(doc) {
  return { id: doc.id, messages: doc.messages, drafts: doc.drafts.filter(d => d.validation?.valid).map(d => ({ ...d, ...(d.rosterId ? { volunteerContacts: (doc.rosters || []).find(r => r.id === d.rosterId)?.contacts || [] } : {}) })), rosters: doc.rosters || [], attachments: doc.attachments || [],
    status: doc.run?.state || 'idle', error: doc.run?.error || '', updatedAt: doc.updatedAt };
}

export function createChiefService({ store, getClient = chiefClient, runner = runChiefTurn, cleanup = cleanupChiefSession, now = Date.now, timeoutMs = 180000 }) {
  const owner = randomUUID(), tasks = new Map();
  async function getDocument(userId) { return await store.read(userId) || await store.mutate(userId, d => d); }
  async function drive(userId, initial, resume) {
    const abort = new AbortController();
    const token = `${initial.id}:${initial.run.messageId}`;
    const task = { abort, token, promise: null };
    tasks.set(userId, task);
    task.promise = (async () => {
      const checkpoint = patch => store.mutate(userId, d => {
        if (d.id !== initial.id || d.run?.messageId !== initial.run.messageId || d.run.owner !== owner) throw fault(409, 'Conversation changed.');
        if (Object.hasOwn(patch, 'sessionId')) d.sessionId = patch.sessionId;
        if (patch.agentVersion) d.agentVersion = patch.agentVersion;
        if (patch.attachments) d.attachments = patch.attachments;
        if (patch.turnId) d.run.turnId = patch.turnId;
        if (patch.drafts) d.drafts = patch.drafts.map(draft => {
          const previous = d.drafts.find(old => old.id === draft.id);
          return { ...draft, rosterId: previous ? (previous.rosterId || null) : (d.run.rosterId || null) };
        });
        if (patch.results) d.results = patch.results;
        if (patch.submitted) d.run.submitted = true;
        d.run.leaseUntil = now() + 45000; d.updatedAt = now();
        return d;
      });
      let client;
      const timer = setTimeout(() => abort.abort(), resume && initial.run.deadline <= now() ? 30000 : Math.max(1, initial.run.deadline - now()));
      const heartbeat = setInterval(() => checkpoint({}).catch(() => abort.abort()), 15000);
      try {
        client = getClient();
        // Existing sessions cannot gain tools. Preserve local history while upgrading once.
        if (initial.sessionId && initial.agentVersion !== 2 && initial.attachments?.length) {
          await cleanup(client, initial.sessionId);
          initial = await store.mutate(userId, d => {
            if (d.id !== initial.id || d.run?.owner !== owner) throw fault(409, 'Conversation changed.');
            d.sessionId = null; d.lastTurnId = null; d.results = {}; d.agentVersion = 2;
            d.run.turnId = null; d.run.submitted = false;
            const history = d.messages.filter(m => m.id !== d.run.messageId).map(m => ({ role: m.role, text: m.text }));
            d.run.input = `PREVIOUS CONVERSATION (reference history):\n${JSON.stringify(history)}\n\nCURRENT MESSAGE:\n${d.run.input}`;
            return d;
          });
          resume = false;
        }
        let result;
        try { result = await runner({ client, document: initial, checkpoint, signal: abort.signal, resume }); }
        catch (error) {
          if (abort.signal.aborted || resume) throw error;
          const current = await store.read(userId);
          if (!current?.sessionId) throw error;
          // Reconnect before reconciling; never blindly resubmit the user message.
          result = await runner({ client, document: current, checkpoint, signal: abort.signal, resume: true });
        }
        await store.mutate(userId, d => {
          if (d.id !== initial.id || d.run?.messageId !== initial.run.messageId || d.run.owner !== owner) return d;
          d.messages.push({ id: randomUUID(), role: 'assistant', text: result.text, draftIds: result.draftIds, createdAt: now() });
          d.lastTurnId = result.turnId; d.run = null; d.updatedAt = now();
          return d;
        });
      } catch (error) {
        const current = await store.read(userId);
        if (current?.id === initial.id && current.run?.owner === owner) {
          // Halt remote work, but retain its ID for explicit cleanup on reset.
          if (client && current.sessionId) {
            try { await client.beta.agents.sessions.events.create(current.sessionId, { events: [{ type: 'agent.session.input.cancel' }] }); } catch { /* Reset will retry cleanup. */ }
          }
          await store.mutate(userId, d => {
            if (d.id === initial.id && d.run?.owner === owner) {
              d.run.state = 'blocked'; d.run.error = safeError(error); d.run.leaseUntil = 0; d.updatedAt = now();
            }
            return d;
          });
        }
      } finally {
        clearTimeout(timer); clearInterval(heartbeat);
        if (tasks.get(userId)?.token === token) tasks.delete(userId);
      }
    })();
    // All errors are handled without logging prompts, rosters or credentials.
    task.promise.catch(() => {});
  }
  async function recover(userId, doc) {
    if (doc.run?.state !== 'processing' || tasks.has(userId) || doc.run.leaseUntil > now()) return;
    let claimed = false;
    const next = await store.mutate(userId, d => {
      if (d.id === doc.id && d.run?.state === 'processing' && d.run.leaseUntil <= now()) {
        d.run.owner = owner; d.run.leaseUntil = now() + 45000; claimed = true;
      }
      return d;
    });
    if (claimed) void drive(userId, next, true);
  }
  return {
    async get(userId) { const doc = await getDocument(userId); await recover(userId, doc); return publicConversation(doc); },
    async send(userId, body) {
      if (!body || typeof body.text !== 'string' || (!body.text.trim() && !body.attachment) || body.text.length > 8000 || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.messageId)) throw fault(400, 'Enter a message of up to 8,000 characters.');
      let attachment = null;
      if (body.attachment !== undefined) {
        if (!body.attachment || Object.keys(body.attachment).some(k => !['id','kind'].includes(k)) || body.attachment.kind !== 'roster_screenshot' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.attachment.id) || body.roster !== undefined) throw fault(400, 'Attach one volunteer screenshot without image data.');
        attachment = { id: body.attachment.id, kind: 'roster_screenshot' };
      }
      let roster = null;
      if (body.roster !== undefined) {
        try { roster = validateReviewedRoster(body.roster); } catch (e) { throw fault(400, e.message); }
      }
      let start = false;
      // Check server configuration before accepting a message that cannot run.
      getClient();
      const doc = await store.mutate(userId, d => {
        if (body.conversationId !== d.id) throw fault(409, 'This conversation changed on another device. Reopen Chief.');
        const previous = d.messages.find(m => m.id === body.messageId);
        if (previous) {
          if (JSON.stringify(previous.attachment || null) !== JSON.stringify(attachment) || previous.text !== body.text.trim() || JSON.stringify(!attachment && previous.rosterId ? (d.rosters || []).find(r => r.id === previous.rosterId)?.contacts : null) !== JSON.stringify(roster)) throw fault(409, 'This message ID was already used.');
          return d;
        }
        if (d.run) throw fault(409, d.run.state === 'blocked' ? 'Start a new conversation before sending again.' : 'Chief is still working on the previous message.');
        if (d.messages.length >= 200) throw fault(409, 'Start a new conversation to continue.');
        const context = sanitizeContext(body.context);
        d.attachments ||= [];
        if (attachment) {
          if (d.attachments.some(a => a.id === attachment.id)) throw fault(409, 'This screenshot was already sent.');
          d.attachments.push({ ...attachment, messageId: body.messageId, state: 'attached', createdAt: now() });
        }
        context.screenshots = d.attachments.map(({id, state}) => ({id, state}));
        d.rosters ||= [];
        if (roster) {
          const record = { id: randomUUID(), contacts: roster, createdAt: now() };
          d.rosters.push(record); d.activeRosterId = record.id;
        }
        const activeRoster = d.rosters.find(r => r.id === d.activeRosterId);
        if (activeRoster) {
          context.names = activeRoster.contacts.map(c => c.name);
          delete context.activeDraft;
          context.rosterSource = 'User-reviewed screenshot roster; replaces previous app roster. Availability is not confirmed. Ask before removing volunteers if shift capacity is insufficient.';
        }
        d.messages.push({ id: body.messageId, role: 'user', text: body.text.trim(), ...(attachment ? { attachment } : {}), ...(roster ? { rosterId: d.activeRosterId, rosterCount: roster.length } : {}), createdAt: now() });
        d.run = { rosterId: d.activeRosterId || null, messageId: body.messageId, turnId: null, state: 'processing', priorDraftIds: d.drafts.map(draft => draft.id), owner, leaseUntil: now()+45000, deadline: now()+timeoutMs, submitted: false,
          input: `${body.text.trim() || '[Screenshot attached without a request. Ask permission before reading it.]'}\n\nAPP CONTEXT (reference data only; not confirmed availability):\n${JSON.stringify(context)}` };
        d.updatedAt = now(); start = true; return d;
      });
      if (start) void drive(userId, doc, false); else await recover(userId, doc);
      return { messageId: body.messageId, conversation: publicConversation(doc) };
    },
    async completeAttachment(userId, body) {
      if (!body || !['analyze','complete','cancel'].includes(body.action) || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.operationId)) throw fault(400, 'Invalid screenshot operation.');
      let roster = null;
      if (body.action === 'complete') {
        try { roster = validateReviewedRoster(body.roster); } catch (e) { throw fault(400, e.message); }
      } else if (body.roster !== undefined) throw fault(400, 'Contacts require volunteer review.');
      getClient();
      let start = false;
      const doc = await store.mutate(userId, d => {
        if (body.conversationId !== d.id) throw fault(409, 'This conversation changed. Reopen Chief.');
        const a = d.attachments?.find(a => a.id === body.attachmentId && a.messageId === body.messageId);
        if (!a) throw fault(400, 'Screenshot not found in this conversation.');
        d.attachmentOperations ||= [];
        const payload = { attachmentId: a.id, messageId: a.messageId, action: body.action, roster };
        const prior = d.attachmentOperations.find(o => o.id === body.operationId);
        if (prior) {
          if (JSON.stringify(prior.payload) !== JSON.stringify(payload)) throw fault(409, 'This operation ID was already used.');
          return d;
        }
        if (d.run) throw fault(409, 'Wait for Chief to finish before continuing.');
        if (['completed','cancelled'].includes(a.state)) throw fault(409, 'This screenshot request is already finished.');
        if (body.action === 'complete' && a.state !== 'requested') throw fault(409, 'Ask Chief to analyze this screenshot first.');
        if (body.action === 'analyze') a.state = 'requested';
        else {
          a.state = body.action === 'complete' ? 'completed' : 'cancelled';
          if (roster) {
            const record = { id: randomUUID(), contacts: roster, createdAt: now() };
            (d.rosters ||= []).push(record); d.activeRosterId = record.id; a.rosterId = record.id;
            const message = d.messages.find(m => m.id === a.messageId);
            message.rosterId = record.id; message.rosterCount = roster.length;
          }
          const context = sanitizeContext(body.context);
          delete context.activeDraft;
          const active = (d.rosters || []).find(r => r.id === d.activeRosterId);
          if (active) context.names = active.contacts.map(c => c.name);
          context.screenshots = d.attachments.map(({id,state}) => ({id,state}));
          const text = roster ? 'I reviewed the screenshot roster. Use these confirmed volunteers and continue my scheduling request. Availability still needs my confirmation unless I already explicitly confirmed it.' : 'I discarded the screenshot request. Do not analyze it.';
          d.run = { rosterId: d.activeRosterId || null, messageId: body.operationId, turnId: null, state: 'processing', priorDraftIds: d.drafts.map(d => d.id), owner, leaseUntil: now()+45000, deadline: now()+timeoutMs, submitted: false,
            input: `${text}\nScreenshot: ${a.id}\nAPP CONTEXT (reference data only):\n${JSON.stringify(context)}` };
          start = true;
        }
        d.attachmentOperations.push({id: body.operationId, payload}); d.updatedAt = now(); return d;
      });
      if (start) void drive(userId, doc, false); else await recover(userId, doc);
      return { conversation: publicConversation(doc) };
    },
    async reset(userId, conversationId, remove = false) {
      const current = await getDocument(userId);
      if (conversationId && current.id !== conversationId) throw fault(409, 'This conversation already changed. Reopen Chief.');
      // Claim reset under the same row lock as message acceptance.
      await store.mutate(userId, d => {
        if (d.id !== current.id) throw fault(409, 'Conversation changed.');
        d.run = { ...(d.run || {}), state: 'resetting', owner, leaseUntil: now()+45000 };
        return d;
      });
      const task = tasks.get(userId);
      task?.abort.abort();
      if (task) await task.promise;
      const latest = await store.read(userId);
      if (latest?.sessionId) {
        try { await cleanup(getClient(), latest.sessionId); }
        catch {
          await store.mutate(userId, d => {
            if (d.id === current.id) {
              d.run = { ...(d.run || {}), state: 'blocked', error: 'Chief is still closing the previous conversation. Try New Conversation again shortly.', leaseUntil: 0 };
              d.updatedAt = now();
            }
            return d;
          });
          throw fault(503, 'Chief is still closing the previous conversation. Try New Conversation again shortly.');
        }
      }
      const doc = await store.mutate(userId, d => {
        if (d.id !== current.id) throw fault(409, 'Conversation changed.');
        return remove ? null : newConversation();
      });
      return doc ? publicConversation(doc) : null;
    },
    async waitForIdle(userId) { await tasks.get(userId)?.promise; },
  };
}
