import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createChiefChat} from '../services/chief/chiefChat.mjs';
const tick=()=>new Promise(r=>setTimeout(r,20));
const observations=['Alex Morgan 9045550101','Blair Jones 9045550102'].map((text,i)=>({text,confidence:.98,bounds:{x:.1,y:.1+i*.1,width:.8,height:.04}}));
function setup(t,{plugin={recognizeRosterImage:async()=>({observations})},initialState='awaiting_permission',failMessage=false,failCompletion=false}={}) {
 const dom=new JSDOM('<div id="host"></div>',{url:'http://localhost',pretendToBeVisual:true}),win=dom.window,doc=win.document;
 win.confirm=()=>true;let revokes=0;win.URL.createObjectURL=()=>`blob:local-${Math.random()}`;win.URL.revokeObjectURL=()=>revokes++;
 let conversation={id:'conv-one',messages:[],drafts:[],attachments:[],status:'idle'},posts=[],operations=[];
 const request=async(path,o)=>{
  if(o?.method==='DELETE'){conversation={id:'conv-two',messages:[],drafts:[],attachments:[],status:'idle'};return structuredClone(conversation);}
  if(path==='/api/chief/messages'){
   posts.push(structuredClone(o.body));if(failMessage){failMessage=false;throw new Error('Offline');}
   const b=o.body;conversation.messages.push({id:b.messageId,role:'user',text:b.text,attachment:b.attachment,createdAt:Date.now()});
   if(b.attachment)conversation.attachments.push({...b.attachment,messageId:b.messageId,state:initialState});
   return {conversation:structuredClone(conversation)};
  }
  if(path==='/api/chief/attachments'){
   operations.push(structuredClone(o.body));if(failCompletion){failCompletion=false;throw new Error('Offline');}
   const a=conversation.attachments.find(a=>a.id===o.body.attachmentId);a.state=o.body.action==='analyze'?'requested':o.body.action==='complete'?'completed':'cancelled';
   return {conversation:structuredClone(conversation)};
  }
  return structuredClone(conversation);
 };
 const chat=createChiefChat({host:doc.querySelector('#host'),request,getContext:()=>({}),getRosterPlugin:()=>plugin,onReview:()=>{},onVisibility:()=>{},win});
 t.after(()=>{chat.clear();win.close();});
 return {chat,win,doc,posts,operations,get conversation(){return conversation;},get revokes(){return revokes;}};
}
async function attach({win,doc},file=new win.File(['test'],'roster.png',{type:'image/png'})){
 const f=doc.querySelector('.chief-roster-file');Object.defineProperty(f,'files',{configurable:true,value:[file]});f.dispatchEvent(new win.Event('change'));await tick();
}
async function send(c,text='') {const input=c.doc.querySelector('textarea');input.value=text;input.dispatchEvent(new c.win.Event('input'));c.doc.querySelector('form').dispatchEvent(new c.win.Event('submit',{cancelable:true}));await tick();}
function button(c,text){return [...c.doc.querySelectorAll('button')].find(b=>b.textContent===text);}
test('selection previews without OCR; navigation preserves text and image; unclear send waits for permission',async t=>{
 let scans=0;const c=setup(t,{plugin:{recognizeRosterImage:async()=>{scans++;return {observations};}}});c.chat.open();await tick();
 c.doc.querySelector('textarea').value='Hello';await attach(c);assert.equal(scans,0);assert.ok(c.doc.querySelector('.chief-attachment img'));
 c.chat.close();c.chat.open();await tick();assert.equal(c.doc.querySelector('textarea').value,'Hello');assert.ok(c.doc.querySelector('.chief-attachment img'));
 await send(c,'Hello');assert.equal(scans,0);assert.equal(c.doc.querySelector('.chief-attachment').hidden,true);assert.ok(c.doc.querySelector('.chief-screenshot img'));
 assert.ok(!JSON.stringify(c.posts).includes('blob:'));assert.ok(!JSON.stringify(c.posts).includes('data:image'));
 button(c,'Analyze screenshot').click();await tick();assert.equal(scans,1);assert.equal(c.doc.querySelector('.chief-roster-review').hidden,false);
 const name=c.doc.querySelector('[data-index="0"][data-field="name"]');name.value='Alex Smith';name.dispatchEvent(new c.win.Event('input'));
 c.doc.querySelector('#applyRosterReview').click();await tick();assert.equal(c.operations.at(-1).roster[0].name,'Alex Smith');assert.equal(c.operations.at(-1).roster[0].phone,'(904) 555-0101');assert.equal(c.revokes,1);
});
test('explicit analysis scans once after send, review cancellation retains edits, completion retries same operation',async t=>{
 let scans=0;const c=setup(t,{initialState:'requested',failCompletion:true,plugin:{recognizeRosterImage:async()=>{scans++;return {observations};}}});c.chat.open();await tick();await attach(c);assert.equal(scans,0);
 await send(c,'Use the volunteers in this screenshot');assert.equal(scans,1);
 c.doc.querySelector('#closeRosterReview').click();await tick();assert.equal(c.doc.querySelector('.chief-roster-review').hidden,true);
 c.chat.close();c.chat.open();await tick();assert.equal(scans,1);button(c,'Review volunteers').click();c.doc.querySelector('#applyRosterReview').click();await tick();
 button(c,'Retry saving').click();await tick();assert.deepEqual(c.operations[0],c.operations[1]);assert.equal(c.conversation.attachments[0].state,'completed');
});
test('image-only send has no implied analysis request; message retry preserves attachment ID',async t=>{
 const c=setup(t,{failMessage:true});c.chat.open();await tick();await attach(c);await send(c);c.doc.querySelector('.chief-status button').click();await tick();
 assert.equal(c.posts[0].text,'');assert.deepEqual(c.posts[0],c.posts[1]);assert.equal(c.conversation.attachments[0].state,'awaiting_permission');
});
test('late scan after logout cannot restore image or review; reset clears pending preview',async t=>{
 let finish;const c=setup(t,{initialState:'requested',plugin:{recognizeRosterImage:()=>new Promise(r=>finish=r),cancelRosterImport:async()=>{}}});c.chat.open();await tick();await attach(c);await send(c,'Read this screenshot');c.chat.clear();finish({observations});await tick();
 assert.equal(c.doc.querySelector('.chief-roster-review').hidden,true);assert.equal(c.doc.querySelector('.chief-attachment').hidden,true);assert.equal(c.revokes,1);
 c.chat.open();await tick();await attach(c);c.doc.querySelector('.chief-new').click();await tick();assert.equal(c.doc.querySelector('.chief-attachment').hidden,true);
});
test('browser explains native requirement; invalid file does not replace pending screenshot',async t=>{
 const b=setup(t,{plugin:null});b.chat.open();await tick();b.doc.querySelector('.chief-attach').click();assert.match(b.doc.querySelector('.chief-attachment-notice').textContent,/installed iPhone/);
 const c=setup(t);c.chat.open();await tick();await attach(c);await attach(c,new c.win.File(['text'],'file.txt',{type:'text/plain'}));assert.ok(c.doc.querySelector('.chief-attachment img'));assert.match(c.doc.querySelector('.chief-attachment-notice').textContent,/image smaller/);
 c.doc.querySelector('[aria-label="Remove screenshot"]').click();assert.equal(c.revokes,1);
});
test('missing local image explains reattachment; request does not start OCR on another device',async t=>{
 const c=setup(t);c.conversation.messages.push({id:'message-one',role:'user',text:'Read this',attachment:{id:'image-one',kind:'roster_screenshot'}});c.conversation.attachments.push({id:'image-one',messageId:'message-one',state:'requested'});c.chat.open();await tick();
 assert.match(c.doc.querySelector('.chief-screenshot').textContent,/Reattach this screenshot/);assert.equal(c.doc.querySelector('.chief-roster-review').hidden,true);
});

test('composer preview shares the typing box; replacement, cancelled selection and removal preserve text and focus',async t=>{
 const c=setup(t);c.chat.open();await tick();const input=c.doc.querySelector('textarea');input.value='Keep this message';await attach(c);
 const box=input.closest('.chief-message-box');assert.ok(box.contains(c.doc.querySelector('.chief-attachment img')));
 const first=c.doc.querySelector('.chief-attachment img').src;
 const f=c.doc.querySelector('.chief-roster-file');Object.defineProperty(f,'files',{configurable:true,value:[]});f.dispatchEvent(new c.win.Event('change'));
 assert.equal(c.doc.querySelector('.chief-attachment img').src,first);
 await attach(c);assert.notEqual(c.doc.querySelector('.chief-attachment img').src,first);assert.equal(c.revokes,1);
 const remove=c.doc.querySelector('[aria-label="Remove screenshot"]');remove.focus();input.dispatchEvent(new c.win.Event('input'));assert.equal(c.doc.activeElement,remove);
 remove.click();assert.equal(input.value,'Keep this message');assert.equal(c.doc.activeElement,input);assert.equal(c.doc.querySelector('.chief-attachment').hidden,true);assert.equal(c.revokes,2);
});
