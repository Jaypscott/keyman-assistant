import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createPasswordResetDraft, remainingResetSeconds, validatePasswordReset } from '../services/auth/passwordResetState.mjs';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function harness(t) {
  const dom = new JSDOM('<main id="app"></main>', {url:'http://localhost',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window;
  Object.assign(w,{createPasswordResetDraft,remainingResetSeconds,validatePasswordReset,AbortController});
  w.eval(`
    const app=document.querySelector('#app');
    const state={authView:'forgot-email',authBusy:false,authMessage:'',authMessageType:'error',passwordResetEmail:'',passwordResetDevelopmentCode:'',passwordResetDraft:createPasswordResetDraft()};
    const AUTH_API_BASE='http://local-test';
    const getAuthToken=()=>'';
    const escapeText=(text)=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const escapeAttr=escapeText;
    function renderAuth(){if(state.authView.startsWith('forgot'))renderPasswordReset();else app.innerHTML='<h1>Sign in</h1>';}
    ${source.slice(source.indexOf('let passwordResetTimer;'),source.indexOf('async function handleAuthSubmit('))}
    ${source.slice(source.indexOf('async function authRequest('),source.indexOf('async function initializeAuth('))}
    window.testApi={state,renderAuth,handlePasswordResetEmail,handlePasswordResetSubmit,requestPasswordResetCode,updatePasswordResetCountdown,returnToSignIn,authRequest};
  `);
  w.fetch=async()=>new Response(JSON.stringify({ok:true,retryAfterSeconds:60,expiresInSeconds:900}));
  const api=w.testApi;
  const fill=(id,value)=>{const el=w.document.getElementById(id);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
  return {w,api,fill,submit:{preventDefault(){}}};
}

test('reset screen preserves fields across validation, delivery errors and resends, then clears on exit',async(t)=>{
  const {w,api,fill,submit}=harness(t);
  api.renderAuth();fill('passwordResetEmail','person@example.com');await api.handlePasswordResetEmail(submit);
  assert.equal(api.state.authView,'forgot-password');
  assert.equal(w.document.querySelector('#resendResetCode').disabled,true);
  fill('passwordResetCode','123456');fill('newPassword','valid-password');fill('confirmNewPassword','mismatch');
  await api.handlePasswordResetSubmit(submit);
  assert.equal(w.document.querySelector('#newPassword').value,'valid-password');
  assert.equal(w.document.querySelector('#passwordResetCode').value,'123456');
  assert.equal(w.document.querySelector('#confirmNewPassword').getAttribute('aria-invalid'),'true');
  assert.equal(w.document.activeElement.id,'confirmNewPassword');
  w.document.querySelector('#toggleResetPassword').click();
  assert.equal(w.document.querySelector('#newPassword').type,'text');
  assert.equal(w.document.querySelector('#toggleResetPassword').getAttribute('aria-pressed'),'true');
  fill('confirmNewPassword','valid-password');
  w.fetch=async()=>new Response(JSON.stringify({error:'Check the code.',code:'INVALID_RESET_CODE'}),{status:400});
  await api.handlePasswordResetSubmit(submit);
  assert.equal(w.document.querySelector('#newPassword').value,'valid-password');
  assert.equal(w.document.querySelector('#passwordResetCode').value,'123456');
  assert.equal(w.document.querySelector('#passwordResetCode').getAttribute('aria-invalid'),'true');
  api.state.passwordResetDraft.retryAt=Date.now()-1;api.updatePasswordResetCountdown();
  assert.equal(w.document.querySelector('#resendResetCode').disabled,false);
  w.fetch=async()=>{throw new Error('offline')};
  await api.requestPasswordResetCode(api.state.passwordResetEmail);
  assert.equal(w.document.querySelector('#newPassword').value,'valid-password');
  assert.equal(w.document.querySelector('#passwordResetCode').value,'123456');
  assert.match(w.document.querySelector('[role="status"]').textContent,/connection/);
  let finish;
  w.fetch=()=>new Promise(resolve=>{finish=resolve});
  const resend=api.requestPasswordResetCode(api.state.passwordResetEmail);
  assert.equal(w.document.querySelector('#resendResetCode').textContent,'Resending code…');
  assert.equal(w.document.querySelector('.primary-btn').textContent,'Update password');
  finish(new Response(JSON.stringify({ok:true,retryAfterSeconds:60,expiresInSeconds:900})));
  await resend;
  assert.equal(w.document.querySelector('#newPassword').value,'valid-password');
  assert.equal(w.document.querySelector('#passwordResetCode').value,'');
  assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
  w.document.querySelector('#changeResetEmail').click();
  assert.equal(api.state.passwordResetDraft.password,'');assert.equal(api.state.authView,'forgot-email');
  assert.equal(w.document.querySelector('#passwordResetEmail').value,'person@example.com');
  api.returnToSignIn();assert.equal(api.state.passwordResetEmail,'');
});

test('successful reset clears drafts and prefills sign-in email',async(t)=>{
  const {w,api,fill,submit}=harness(t);
  api.state.passwordResetEmail='person@example.com';api.state.authView='forgot-password';api.renderAuth();
  fill('passwordResetCode','123456');fill('newPassword','valid-password');fill('confirmNewPassword','valid-password');
  await api.handlePasswordResetSubmit(submit);
  assert.equal(api.state.authView,'signin');assert.equal(api.state.authEmail,'person@example.com');
  assert.equal(api.state.passwordResetDraft.password,'');assert.match(api.state.authMessage,/Password updated/);
});

test('stalled reset requests time out and keep entries available for retry',async(t)=>{
  const {w,api,fill,submit}=harness(t);
  api.state.passwordResetEmail='person@example.com';api.state.authView='forgot-password';api.renderAuth();
  fill('passwordResetCode','123456');fill('newPassword','valid-password');fill('confirmNewPassword','valid-password');
  const nativeTimeout=w.setTimeout.bind(w);
  w.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,ms===15000?5:ms,...args);
  w.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('abort'))));
  await api.handlePasswordResetSubmit(submit);
  assert.equal(api.state.authBusy,false);assert.match(api.state.authMessage,/took too long/);
  assert.equal(w.document.querySelector('#newPassword').value,'valid-password');
  assert.equal(w.document.querySelector('#passwordResetCode').value,'123456');
});
