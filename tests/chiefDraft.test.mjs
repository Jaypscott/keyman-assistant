import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createToolbox } from '../agents/rotation/tools.mjs';
import { chiefDraftState, validateChiefSchedule } from '../services/chief/chiefDraft.mjs';
import { chiefMessagesMarkup } from '../components/ChiefChat.mjs';
const request=JSON.parse(await readFile(new URL('../agents/rotation/example.json',import.meta.url)));
function draft(){const b=createToolbox();const d=b.execute('draft_rotation',request);b.execute('validate_rotation',{draftId:d.id});return [...b.drafts.values()][0];}
test('review preserves exact assignments, settings and matching local contacts without mutating the chat draft',()=>{
 const d=draft();const state=chiefDraftState(d,[{name:request.names[0],phone:'5551234567'}]);
 assert.deepEqual(state.schedule,d.rows);assert.equal(state.selectedDate,request.date);assert.equal(state.rotationOrigin,'chief');assert.equal(state.volunteerContacts[0].phone,'5551234567');
 state.schedule[0].assignments.primary[0]='changed';assert.notDeepEqual(state.schedule,d.rows);
 assert.throws(()=>validateChiefSchedule(state.schedule,request.names,state.selectedShift,30,false));
});
test('assistant HTML is inert and draft cards contain only validated structured schedules',()=>{
 const d=draft(); const html=chiefMessagesMarkup({messages:[{id:'m',role:'assistant',text:'<img src=x onerror=alert(1)>',draftIds:[d.id],createdAt:0}],drafts:[d]});
 assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('Review Schedule'));assert.ok(html.includes(d.id));
});
