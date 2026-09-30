import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('Chief HTTP endpoints require auth, isolate accounts, and keep app-data PUTs separate',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'chief-http-'));
 const old=process.env.AUTH_DATA_FILE;process.env.AUTH_DATA_FILE=join(dir,'auth.json');
 const {server}=await import(`../server.mjs?chief=${Date.now()}`);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});if(old===undefined)delete process.env.AUTH_DATA_FILE;else process.env.AUTH_DATA_FILE=old;});
 const base=`http://127.0.0.1:${server.address().port}`;
 const req=async(path,token,method='GET',body)=>{
  const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};
 };
 assert.equal((await req('/api/chief/conversation')).status,401);
 assert.equal((await req('/api/chief/attachments',null,'POST',{})).status,401);
 const a=(await req('/api/auth/register',null,'POST',{email:'chief-a@example.test',password:'test-only-pass'})).data.token;
 const b=(await req('/api/auth/register',null,'POST',{email:'chief-b@example.test',password:'test-only-pass'})).data.token;
 const chatA=await req('/api/chief/conversation',a),chatB=await req('/api/chief/conversation',b);
 assert.equal(chatA.status,200);assert.notEqual(chatA.data.id,chatB.data.id);
 assert.equal((await req('/api/chief/conversation',b,'DELETE',{conversationId:chatA.data.id})).status,409);
 assert.equal((await req('/api/chief/messages',a,'POST',{text:''})).status,400);
 await req('/api/app-data',a,'PUT',{events:[],checks:{},notes:[]});
 assert.equal((await req('/api/chief/conversation',a)).data.id,chatA.data.id);
 const fresh=await req('/api/chief/conversation',a,'DELETE',{conversationId:chatA.data.id});assert.equal(fresh.status,200);assert.notEqual(fresh.data.id,chatA.data.id);
 assert.equal((await req('/api/auth/me',a,'DELETE')).status,200);
 assert.equal((await req('/api/chief/conversation',a)).status,401);
});
