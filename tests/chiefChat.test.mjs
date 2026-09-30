import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChiefChat } from '../services/chief/chiefChat.mjs';
const tick = () => new Promise(r => setTimeout(r, 0));
function setup(t, request) {
 const dom=new JSDOM('<body><button id="origin">Open</button><div id="host"></div></body>',{url:'http://localhost'});
 const win=dom.window;win.confirm=()=>true;
 const visibility=[];
 const chat=createChiefChat({host:win.document.querySelector('#host'),request,getContext:()=>({names:['Alex']}),onReview:()=>{},onVisibility:v=>visibility.push(v),win});
 t.after(()=>{chat.clear();dom.window.close();});
 return {chat,win,doc:win.document,visibility};
}
const empty = () => ({id:'conversation-one',messages:[],drafts:[],status:'idle',error:''});
test('chat preserves unsent text and focus, reopens history, then clears cached state on signout',async t=>{
 const {chat,doc,win,visibility}=setup(t,async()=>empty());
 doc.querySelector('#origin').focus();chat.open();await tick();
 const input=doc.querySelector('textarea');input.value='Unsaved message';input.dispatchEvent(new win.Event('input'));
 chat.close();assert.equal(doc.activeElement.id,'origin');chat.open();await tick();assert.equal(input.value,'Unsaved message');
 chat.clear();assert.equal(input.value,'');assert.equal(doc.querySelector('.chief-overlay').hidden,true);assert.deepEqual(visibility,[true,false,true,false]);
});
test('failed send retries with the same message ID and never renders model HTML',async t=>{
 let calls=0;const ids=[];
 const {chat,doc,win}=setup(t,async(path,options)=>{
  if(!options)return empty();
  ids.push(options.body.messageId);if(++calls===1)throw new Error('Offline');
  return {conversation:{...empty(),messages:[{id:'reply',role:'assistant',text:'<img src=x onerror=alert(1)>',createdAt:0}]}};
 });
 chat.open();await tick();const input=doc.querySelector('textarea');input.value='Plan';input.dispatchEvent(new win.Event('input'));
 doc.querySelector('form').dispatchEvent(new win.Event('submit',{cancelable:true}));await tick();
 assert.equal(doc.querySelector('.chief-status button').textContent,'Try again');doc.querySelector('.chief-status button').click();await tick();
 assert.equal(ids[0],ids[1]);assert.equal(doc.querySelector('.chief-messages img'),null);
});
test('a late network response cannot restore another account’s conversation after clear',async t=>{
 let resolve;const {chat,doc}=setup(t,()=>new Promise(r=>resolve=r));chat.open();chat.clear();
 resolve({...empty(),messages:[{id:'m',role:'assistant',text:'private',createdAt:0}]});await tick();
 assert.equal(doc.querySelector('.chief-messages').textContent,'');
});
