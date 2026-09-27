import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createPasswordResetDraft, remainingResetSeconds, validatePasswordReset } from '../services/auth/passwordResetState.mjs';

test('reset validation preserves draft and countdown uses elapsed wall time', () => {
  const draft = {...createPasswordResetDraft(), code:'123456', password:'a-password', confirmation:'different'};
  assert.deepEqual(validatePasswordReset(draft), {confirmation:'Passwords do not match.'});
  assert.equal(draft.password, 'a-password');
  assert.equal(remainingResetSeconds(61000, 1000), 60);
  assert.equal(remainingResetSeconds(61000, 61001), 0);
  assert.equal(createPasswordResetDraft().password, '');
});

for (const storage of ['json', ...(process.env.KEYMAN_TEST_DATABASE_URL ? ['postgres'] : [])]) {
  test(`${storage}: reset delivery, concurrent attempts, single use, and recovery`, async (t) => {
    const savedEnv = {...process.env};
    const dir = await mkdtemp(join(tmpdir(), 'keyman-recovery-'));
    const dataFile = join(dir,'auth.json');
    const originalFetch = globalThis.fetch;
    const OriginalPool = pg.Pool;
    const pools = [];
    pg.Pool = class extends OriginalPool { constructor(options) {super(options); pools.push(this);} };
    process.env.AUTH_DATA_FILE = dataFile;
    process.env.DATABASE_URL = storage === 'postgres' ? process.env.KEYMAN_TEST_DATABASE_URL : '';
    process.env.NODE_ENV = 'production';
    process.env.PASSWORD_RESET_SECRET = 'isolated-test-reset-secret';
    process.env.RESEND_API_KEY = 'isolated-test-key';
    process.env.PASSWORD_RESET_FROM_EMAIL = 'test@example.com';
    const sent = [];
    let delivery = 'success';
    let finishDelayed;
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.resend.com/emails') {
        const message = JSON.parse(options.body);
        sent.push(message.text.match(/code is (\d{6})/)[1]);
        if (delivery === 'delay') return new Promise((resolve) => {finishDelayed=()=>resolve(new Response('',{status:503}));});
        return new Response('', {status: delivery === 'success' ? 200 : 503});
      }
      return originalFetch(url, options);
    };
    const {server} = await import(`../server.mjs?recovery=${storage}`);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async()=>{
      globalThis.fetch=originalFetch; pg.Pool=OriginalPool;
      await new Promise(resolve=>server.close(resolve));
      await Promise.all(pools.map(pool=>pool.end()));
      for(const key of Object.keys(process.env)) if(!(key in savedEnv)) delete process.env[key];
      Object.assign(process.env,savedEnv); await rm(dir,{recursive:true,force:true});
    });
    const request = async(path,body)=>{
      const result=await originalFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      return {status:result.status, data:await result.json()};
    };
    const email=`reset-${storage}-${Date.now()}@example.com`;
    const registration=await request('/api/auth/register',{email,password:'old-password'});
    assert.equal(registration.status,201);
    const userId=registration.data.user.id;
    const issue=()=>request('/api/auth/password-reset/request',{email});
    const reset=(code)=>request('/api/auth/password-reset',{email,code,newPassword:'new-password'});
    const mutate=async(changes)=>{
      if(storage==='postgres') {
        if(changes.requestedAt!==undefined) await pools[0].query('UPDATE password_reset_tokens SET requested_at=$1 WHERE user_id=$2',[changes.requestedAt,userId]);
        if(changes.expiresAt!==undefined) await pools[0].query('UPDATE password_reset_tokens SET expires_at=$1 WHERE user_id=$2',[changes.expiresAt,userId]);
      } else {
        const db=JSON.parse(await readFile(dataFile,'utf8')); Object.assign(db.passwordResets[userId],changes);await writeFile(dataFile,JSON.stringify(db));
      }
    };
    const receipts=await Promise.all([issue(),issue(),issue()]);
    assert.ok(receipts.every(x=>x.status===200)); assert.equal(sent.length,1);
    assert.equal(receipts[0].data.retryAfterSeconds,60);assert.equal(receipts[0].data.expiresInSeconds,900);
    assert.ok(receipts.every(x=>!('developmentCode' in x.data)));
    const unknown=await request('/api/auth/password-reset/request',{email:'unknown@example.com'});
    assert.deepEqual(unknown.data,receipts[0].data);
    const wrong=sent.at(-1)==='000000'?'111111':'000000';
    const failures=await Promise.all(Array.from({length:5},()=>reset(wrong)));
    assert.ok(failures.every(x=>x.status===400));
    assert.equal((await reset(sent.at(-1))).status,400,'five failures lock the code');
    await issue(); const expired=sent.at(-1); await mutate({expiresAt:Date.now()-1});
    assert.equal((await reset(expired)).status,400);
    await issue(); const oldCode=sent.at(-1); await mutate({requestedAt:Date.now()-61000});
    await issue(); assert.equal((await reset(oldCode)).status,400,'resent code replaces old code');
    const outcomes=await Promise.all([reset(sent.at(-1)),reset(sent.at(-1))]);
    assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,400]);
    assert.equal((await request('/api/auth/login',{email,password:'old-password'})).status,401);
    assert.equal((await request('/api/auth/login',{email,password:'new-password'})).status,200);
    const session=await originalFetch(base+'/api/auth/me',{headers:{Authorization:`Bearer ${registration.data.token}`}});
    assert.equal(session.status,401);
    const missing=await request('/api/auth/password-reset',{email:'unknown@example.com',code:'123456',newPassword:'new-password'});
    assert.equal(missing.status,400);assert.equal(missing.data.code,'INVALID_RESET_CODE');
    delivery='failure';assert.equal((await issue()).status,503);
    delivery='success';assert.equal((await issue()).status,200,'delivery failure allows immediate retry');
    await mutate({requestedAt:Date.now()-61000});
    delivery='delay';const pending=issue();
    while(!finishDelayed) await new Promise(resolve=>setTimeout(resolve,5));
    await mutate({requestedAt:Date.now()-61000});delivery='success';await issue();const newest=sent.at(-1);
    finishDelayed();assert.equal((await pending).status,503);
    assert.equal((await reset(newest)).status,200,'late delivery failure cannot delete a newer reset');
  });
}

test('production configuration failure is identical for known and unknown accounts', async(t)=>{
  const old={...process.env};process.env.NODE_ENV='production';process.env.RESEND_API_KEY='';process.env.PASSWORD_RESET_FROM_EMAIL='';process.env.DATABASE_URL='';
  const {server}=await import('../server.mjs?unconfigured-reset');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));for(const key of Object.keys(process.env)) if(!(key in old)) delete process.env[key];Object.assign(process.env,old)});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const email of ['known@example.com','unknown@example.com']) {
    const result=await fetch(base+'/api/auth/password-reset/request',{method:'POST',body:JSON.stringify({email})});
    assert.equal(result.status,503);assert.equal((await result.json()).code,'PASSWORD_RESET_UNAVAILABLE');
  }
});
