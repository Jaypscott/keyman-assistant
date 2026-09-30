import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChiefStore } from '../server/chiefStore.mjs';
import { createChiefService } from '../server/chiefService.mjs';
import { createToolbox } from '../agents/rotation/tools.mjs';
import { chiefDraftState } from '../services/chief/chiefDraft.mjs';
const fixture=JSON.parse(await readFile(new URL('../agents/rotation/example.json',import.meta.url)));
test('rosters sync privately, retries deduplicate, and old drafts retain contact versions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'chief-roster-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=createChiefStore({file:join(dir,'chat.json')}); const inputs=[];
 const runner=async({document,checkpoint})=>{
  inputs.push(document.run.input);
  assert.ok(!document.run.input.includes('555'));assert.ok(!document.run.input.includes('data:image'));
  const box=createToolbox({savedDrafts:document.drafts.map(({rosterId,...d})=>d)});
  const draft=box.execute('draft_rotation',fixture);box.execute('validate_rotation',{draftId:draft.id});
  await checkpoint({drafts:[...box.drafts.values()]});return {text:'Ready',draftIds:[draft.id],turnId:'t'};
 };
 const svc=createChiefService({store,getClient:()=>({}),runner});const c=await svc.get('a');
 const roster=fixture.names.map((name,i)=>({name,phone:`904555010${i}`}));
 const body={conversationId:c.id,messageId:'roster-msg-1',text:'Use these volunteers',roster,context:{names:['stale']}};
 await svc.send('a',body);await svc.waitForIdle('a');await svc.send('a',body);assert.equal(inputs.length,1);
 await assert.rejects(svc.send('a',{...body,roster:roster.map(c=>({...c,phone:'9045550199'}))}),{status:409});
 const first=await svc.get('a'); assert.equal(first.rosters.length,1);assert.ok(!inputs[0].includes('stale'));
 const oldId=first.drafts[0].id;
 await svc.send('a',{...body,messageId:'roster-msg-2',roster:roster.map(c=>({...c,phone:'9045550199'}))});await svc.waitForIdle('a');
 await svc.send('a',{...body,messageId:'roster-msg-3',roster:undefined});await svc.waitForIdle('a');
 const saved=await createChiefService({store,getClient:()=>({}),runner}).get('a');
 assert.equal(saved.rosters.length,2);assert.deepEqual(saved.drafts.find(d=>d.id===oldId).volunteerContacts,first.drafts[0].volunteerContacts);
 assert.equal(chiefDraftState(saved.drafts.at(-1)).volunteerContacts[0].phone,'(904) 555-0199');
 assert.equal((await svc.get('b')).rosters.length,0);
 await assert.rejects(svc.send('a',{...body,messageId:'bad-roster',roster:[{name:'Alex',phone:''},{name:'alex',phone:''}]}),{status:400});
 await assert.rejects(svc.send('a',{...body,messageId:'too-many',roster:Array.from({length:9},(_,i)=>({name:`Person ${i}`,phone:''}))}),{status:400});
 await svc.reset('a',c.id);assert.equal((await svc.get('a')).rosters.length,0);
});

test('deferred screenshots enforce permission, completion ownership and idempotency without AI contact leakage',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'chief-shot-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=createChiefStore({file:join(dir,'chat.json')});const inputs=[];
 const svc=createChiefService({store,getClient:()=>({}),runner:async({document})=>{inputs.push(document.run.input);return {text:'Continue',draftIds:[],turnId:'turn'};}});
 const c=await svc.get('owner');const body={conversationId:c.id,messageId:'image-msg-1',text:'',attachment:{id:'screenshot-1',kind:'roster_screenshot'}};
 await svc.send('owner',body);await svc.waitForIdle('owner');
 const op={conversationId:c.id,messageId:body.messageId,attachmentId:'screenshot-1',operationId:'operation-1',action:'complete',roster:[{name:'Alex Morgan',phone:'9045550101'},{name:'Blair Jones',phone:'9045550102'}]};
 await assert.rejects(svc.completeAttachment('owner',op),{status:409});
 await assert.rejects(svc.completeAttachment('other',op),{status:409});
 await assert.rejects(svc.completeAttachment('owner',{...op,messageId:'different-message'}),{status:400});
 await svc.completeAttachment('owner',{...op,operationId:'authorize-1',action:'analyze',roster:undefined});
 await svc.completeAttachment('owner',op);await svc.waitForIdle('owner');
 await svc.completeAttachment('owner',op);await svc.send('owner',body);assert.equal(inputs.length,2);
 assert.ok(inputs.every(i=>!i.includes('555')&&!i.includes('data:image')&&!i.includes('blob:')));
 const saved=await createChiefService({store,getClient:()=>({})}).get('owner');assert.equal(saved.attachments[0].state,'completed');assert.equal(saved.rosters[0].contacts[0].phone,'(904) 555-0101');
 await assert.rejects(svc.completeAttachment('owner',{...op,roster:[{name:'Different',phone:''}]}),{status:409});
 await assert.rejects(svc.send('owner',{...body,messageId:'image-msg-2',attachment:{...body.attachment,dataUrl:'data:image/png;base64,private'}}),{status:400});
 assert.equal((await svc.get('other')).attachments.length,0);
 await svc.reset('owner',c.id);await assert.rejects(svc.completeAttachment('owner',op),{status:409});assert.equal((await svc.get('owner')).attachments.length,0);
});

test('legacy session upgrade retains history and drafts while installing screenshot tools once',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'chief-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=createChiefStore({file:join(dir,'chat.json')});let cleaned=0,runs=0;
 const initial=await store.mutate('a',d=>{d.sessionId='legacy-session';d.messages=[{id:'old-message',role:'user',text:'My shift is at Jax Fishing Pier.'}];return d;});
 const svc=createChiefService({store,getClient:()=>({}),cleanup:async(_,id)=>{assert.equal(id,'legacy-session');cleaned++;},runner:async({document,checkpoint})=>{
  runs++;assert.equal(document.agentVersion,2);assert.match(document.run.input,/Jax Fishing Pier/);assert.equal(document.sessionId,null);
  await checkpoint({sessionId:'new-session',agentVersion:2});return {text:'May I read this roster?',draftIds:[],turnId:'new-turn'};
 }});
 await svc.send('a',{conversationId:initial.id,messageId:'new-image-message',text:'',attachment:{id:'new-screenshot',kind:'roster_screenshot'}});await svc.waitForIdle('a');
 const doc=await store.read('a');assert.equal(cleaned,1);assert.equal(runs,1);assert.equal(doc.sessionId,'new-session');assert.equal(doc.messages[0].id,'old-message');assert.equal(doc.run,null);
});
