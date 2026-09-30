import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChiefStore } from '../server/chiefStore.mjs';
import { createChiefService, sanitizeContext } from '../server/chiefService.mjs';
import { createToolbox } from '../agents/rotation/tools.mjs';
const fixture = JSON.parse(await readFile(new URL('../agents/rotation/example.json', import.meta.url)));
async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chief-test-')); t.after(() => rm(dir,{recursive:true,force:true}));
  const store = createChiefStore({file:join(dir,'chief.json')});
  const service = createChiefService({store,getClient:()=>({}),cleanup:async()=>{},...options});
  return {store,service};
}
const body = (id, n=1) => ({conversationId:id,messageId:`message-${n}`,text:'Plan this shift',context:{}});

test('messages and validated drafts persist per account, deduplicate, and survive a new service instance', async t => {
  let runs=0;
  const runner=async ({checkpoint}) => {
    runs++;
    const box=createToolbox(); const d=box.execute('draft_rotation',fixture); box.execute('validate_rotation',{draftId:d.id});
    await checkpoint({sessionId:'sess_test',turnId:'turn_test',drafts:[...box.drafts.values()],results:{}});
    return {text:'Your draft is ready.',draftIds:[d.id],turnId:'turn_test'};
  };
  const {store,service}=await setup(t,{runner});
  const a=await service.get('alice'); const b=await service.get('bob');
  await service.send('alice',body(a.id)); await service.waitForIdle('alice');
  await service.send('alice',body(a.id));
  assert.equal(runs,1);
  const saved=await service.get('alice'); assert.equal(saved.messages.length,2); assert.equal(saved.drafts[0].validation.valid,true);
  assert.equal((await service.get('bob')).messages.length,0);
  await assert.rejects(service.send('bob',body(a.id)),{status:409});
  const second=createChiefService({store,getClient:()=>({}),runner});
  assert.deepEqual(await second.get('alice'),saved);
  assert.notEqual(a.id,b.id);
});

test('only one active turn is accepted; closing an observer does not stop processing', async t => {
  let release;
  const gate=new Promise(r=>release=r);
  const {service}=await setup(t,{runner:async()=>{await gate;return {text:'Done',draftIds:[],turnId:'t'};}});
  const c=await service.get('a'); await service.send('a',body(c.id));
  await assert.rejects(service.send('a',body(c.id,2)),{status:409});
  release(); await service.waitForIdle('a'); assert.equal((await service.get('a')).status,'idle');
});

test('recovery claims an expired lease and resumes instead of sending again', async t => {
  let resumed=false;
  const {store,service}=await setup(t,{runner:async({resume})=>{resumed=resume;return {text:'Recovered',draftIds:[],turnId:'t'};}});
  await store.mutate('a',d=>{d.sessionId='s';d.run={messageId:'message-1',state:'processing',owner:'old',leaseUntil:0,deadline:Date.now()+5000};return d;});
  await service.get('a'); await service.waitForIdle('a');
  assert.equal(resumed,true); assert.equal((await service.get('a')).messages[0].text,'Recovered');
});

test('reset cleans remote session, replaces history and rejects stale messages; deletion removes account chat', async t => {
  const cleaned=[];
  const {store,service}=await setup(t,{cleanup:async(c,id)=>cleaned.push(id)});
  const old=await service.get('a'); await store.mutate('a',d=>{d.sessionId='s';return d;});
  const fresh=await service.reset('a',old.id); assert.notEqual(old.id,fresh.id); assert.deepEqual(cleaned,['s']);
  await assert.rejects(service.send('a',body(old.id)),{status:409});
  await service.reset('a',fresh.id,true); assert.equal(await store.read('a'),null);
});

test('uncertain failures block resubmission and retain a recoverable session ID', async t => {
  const {store,service}=await setup(t,{runner:async({checkpoint})=>{await checkpoint({sessionId:'s'});throw new Error('network');}});
  const c=await service.get('a'); await service.send('a',body(c.id)); await service.waitForIdle('a');
  assert.equal((await service.get('a')).status,'blocked'); assert.equal((await store.read('a')).sessionId,'s');
  await assert.rejects(service.send('a',body(c.id,2)),{status:409});
});

test('context strips phone numbers and unrelated account data, validates active drafts', () => {
  const box=createToolbox();const draft=box.execute('draft_rotation',fixture);
  const context=sanitizeContext({...fixture,phone:'secret-phone',notes:'private',events:[{}],activeDraft:{rows:draft.rows,phone:'secret'}});
  assert.equal(JSON.stringify(context).includes('secret'),false);assert.equal('notes' in context,false);assert.ok(context.activeDraft);
  assert.equal('availableWholeShift' in context,false);
});

test('failed cleanup persists an actionable error and retains the session for a later reset',async t=>{
 let fail=true;const {store,service}=await setup(t,{cleanup:async()=>{if(fail)throw new Error('offline');}});
 const old=await service.get('a');await store.mutate('a',d=>{d.sessionId='retained';return d;});
 await assert.rejects(service.reset('a',old.id),{status:503});
 const blocked=await service.get('a');assert.equal(blocked.status,'blocked');assert.match(blocked.error,/New Conversation/);
 assert.equal((await store.read('a')).sessionId,'retained');
 fail=false;const fresh=await service.reset('a',old.id);assert.equal(fresh.status,'idle');assert.notEqual(fresh.id,old.id);
});
