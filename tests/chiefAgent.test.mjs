import test from 'node:test';
import assert from 'node:assert/strict';
import { runChiefTurn } from '../server/chiefAgent.mjs';
import { readFile } from 'node:fs/promises';
const fixture=JSON.parse(await readFile(new URL('../agents/rotation/example.json',import.meta.url)));
const textItem={id:'m',role:'assistant',phase:'final_answer',turn_id:'new-turn',content:[{type:'output_text',text:'Draft ready'}]};
const complete={type:'agent.session.turn.completed',turn:{id:'new-turn',subagent_id:null}};
const action=(name,args,id)=>({type:'agent.session.requires_action',session:{id:'session',required_actions:[{type:'function_call',turn_id:'new-turn',call_id:id,name,arguments:args}]}});
function clientFor(events,{status='idle',items=[textItem],turnStatus='completed'}={}) {
 const calls=[];
 const stream=()=>({[Symbol.asyncIterator]:()=>events()[Symbol.asyncIterator](),controller:{abort(){}}});
 const client={beta:{agents:{sessions:{
  create:async()=>{calls.push('create');return stream();},
  events:{stream:async()=>{calls.push('subscribe');return stream();},create:async(id,input)=>calls.push(input.events[0])},
  retrieve:async()=>({status,required_actions:[]}),
  turns:{retrieve:async()=>({status:turnStatus}),list:()=>({async *[Symbol.asyncIterator](){yield {id:'new-turn',subagent_id:null};}})},
  items:{list:()=>({async *[Symbol.asyncIterator](){yield* items;}})},
 }}}};return {client,calls};
}
const doc=()=>({sessionId:null,lastTurnId:null,drafts:[],results:{},run:{input:'Hello',turnId:null,priorDraftIds:[]}});
test('new turn saves tool results before acknowledging them and returns a validated draft card',async()=>{
 const d=doc();let saved={};
 const fake=clientFor(async function*(){
  yield {type:'agent.session.created',session:{id:'session'}};
  yield action('draft_rotation',fixture,'draft');
  const id=saved.drafts[0].id;yield action('validate_rotation',{draftId:id},'validate');yield complete;
 });
 const send=fake.client.beta.agents.sessions.events.create;
 fake.client.beta.agents.sessions.events.create=async(id,input)=>{assert.ok(saved.results[`new-turn:${input.events[0].call_id}`]);await send(id,input);};
 const result=await runChiefTurn({client:fake.client,document:d,checkpoint:async p=>Object.assign(saved,p)});
 assert.equal(result.draftIds.length,1);assert.equal(saved.drafts[0].validation.valid,true);
});
test('follow-up subscribes before submitting user input to the same session',async()=>{
 const d=doc();d.sessionId='session';d.lastTurnId='old-turn';
 const fake=clientFor(async function*(){yield complete;});
 const result=await runChiefTurn({client:fake.client,document:d,checkpoint:async()=>{}});
 assert.equal(fake.calls[0],'subscribe');assert.equal(fake.calls[1].type,'agent.session.input.message');assert.equal(result.turnId,'new-turn');
});
test('recovery retrieves completed output without resubmitting and preserves draft cards created before disconnect',async()=>{
 const d=doc();d.sessionId='session';d.lastTurnId='old-turn';d.run.turnId='new-turn';
 d.drafts=[{id:'saved-draft',validation:{valid:true}}];
 const fake=clientFor(async function*(){});
 const result=await runChiefTurn({client:fake.client,document:d,resume:true,checkpoint:async()=>{}});
 assert.deepEqual(fake.calls,['subscribe']);assert.deepEqual(result.draftIds,['saved-draft']);
});
test('stream closure does not count as completion',async()=>{
 const fake=clientFor(async function*(){});
 await assert.rejects(runChiefTurn({client:fake.client,document:doc(),checkpoint:async()=>{}}),/before the request finished/);
});

test('private roster metadata is never returned through saved draft tool results',async()=>{
 const d=doc();d.drafts=[{id:'private-draft',rosterId:'private-roster',volunteerContacts:[{name:'Alex',phone:'9045550199'}],request:fixture,rows:[]}];
 const fake=clientFor(async function*(){yield {type:'agent.session.created',session:{id:'session'}};yield action('validate_rotation',{draftId:'private-draft'},'check');yield complete;});
 await runChiefTurn({client:fake.client,document:d,checkpoint:async p=>{assert.ok(!JSON.stringify(p.drafts).includes('9045550199'));}});
 assert.ok(!JSON.stringify(fake.calls).includes('9045550199'));
});

test('structured screenshot actions persist before ack and prohibit drafting before review',async()=>{
 const d=doc();d.attachments=[{id:'screenshot-one',messageId:'message-one',state:'attached'}];let saved={};
 const fake=clientFor(async function*(){
  yield {type:'agent.session.created',session:{id:'session'}};
  yield action('request_roster_extraction',{attachmentId:'screenshot-one',action:'ask_permission'},'ask');
  assert.equal(saved.attachments[0].state,'awaiting_permission');
  yield action('request_roster_extraction',{attachmentId:'screenshot-one',action:'analyze'},'analyze');
  assert.equal(saved.attachments[0].state,'requested');
  yield action('draft_rotation',fixture,'premature-draft');yield complete;
 });
 const send=fake.client.beta.agents.sessions.events.create;
 fake.client.beta.agents.sessions.events.create=async(id,input)=>{assert.ok(saved.results[`new-turn:${input.events[0].call_id}`]);await send(id,input);};
 await runChiefTurn({client:fake.client,document:d,checkpoint:async p=>Object.assign(saved,structuredClone(p))});
 assert.equal(saved.results['new-turn:premature-draft'].success,false);assert.equal(saved.drafts.length,0);
});
test('declining screenshot cancels request and unknown attachment cannot be analyzed',async()=>{
 const d=doc();d.attachments=[{id:'screenshot-one',state:'awaiting_permission'}];let saved;
 const fake=clientFor(async function*(){yield {type:'agent.session.created',session:{id:'session'}};yield action('request_roster_extraction',{attachmentId:'other',action:'analyze'},'bad');yield action('request_roster_extraction',{attachmentId:'screenshot-one',action:'decline'},'no');yield complete;});
 await runChiefTurn({client:fake.client,document:d,checkpoint:async p=>saved=structuredClone(p)});
 assert.equal(saved.results['new-turn:bad'].success,false);assert.equal(saved.attachments[0].state,'cancelled');
});
