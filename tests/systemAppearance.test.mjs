import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { watchSystemAppearance } from '../services/appearance/systemAppearance.mjs';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('system changes and resume update surfaces without replacing form nodes, drafts, focus or countdown state', (t) => {
  const dom = new JSDOM('<meta name="theme-color"><div class="phone-shell"><main id="app"><input id="password" type="password"><textarea id="note"></textarea><button id="resend" disabled>Send a new code in 42s</button></main></div>', {runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  const media = new w.EventTarget(); media.matches = false;
  w.matchMedia = () => media;
  w.getComputedStyle = () => ({getPropertyValue: (token) => ({'--panel':media.matches?'#182f2c':'#ffffff','--paper':media.matches?'#102320':'#f6faf8','--mint':media.matches?'#142e28':'#dff3ec'})[token]});
  w.eval(`const shell=document.querySelector('.phone-shell'); const state={authenticated:false,tab:'home',homeView:'shifts'};
    const nativeCalls=[]; function updateNativeStatusBar(color){nativeCalls.push(color);}
    ${source.slice(source.indexOf('function updateShellSurface()'),source.indexOf('function renderAuth()'))}
    window.api={updateShellSurface,state,nativeCalls};`);
  const input = w.document.querySelector('#password'); input.value='in-memory-only';
  const note = w.document.querySelector('#note'); note.value='An unsaved note'; note.focus(); note.setSelectionRange(3,7); note.scrollTop=20;
  const originalMarkup = w.document.querySelector('#app').innerHTML;
  const stop = watchSystemAppearance(w.api.updateShellSurface, {window:w,document:w.document});
  assert.equal(w.api.nativeCalls.at(-1),'#ffffff');
  media.matches=true; media.dispatchEvent(new w.Event('change'));
  assert.equal(w.api.nativeCalls.at(-1),'#182f2c');
  assert.equal(w.document.querySelector('meta').content,'#182f2c');
  assert.equal(w.document.querySelector('#app').innerHTML,originalMarkup);
  assert.equal(w.document.querySelector('#password'),input);
  assert.equal(input.value,'in-memory-only'); assert.equal(note.value,'An unsaved note');
  assert.equal(w.document.activeElement,note); assert.equal(note.selectionStart,3); assert.equal(note.selectionEnd,7); assert.equal(note.scrollTop,20);
  assert.equal(w.document.querySelector('#resend').disabled,true);
  w.api.state.authenticated=true;
  w.api.updateShellSurface(); assert.equal(w.api.nativeCalls.at(-1),'#142e28');
  w.api.state.tab='calendar'; w.api.updateShellSurface(); assert.equal(w.api.nativeCalls.at(-1),'#182f2c');
  w.api.state.tab='profile'; w.api.updateShellSurface(); assert.equal(w.api.nativeCalls.at(-1),'#102320');
  Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'visible'});
  media.matches=false; w.document.dispatchEvent(new w.Event('visibilitychange'));
  assert.equal(w.api.nativeCalls.at(-1),'#f6faf8');
  stop(); const count=w.api.nativeCalls.length;
  media.dispatchEvent(new w.Event('change')); w.document.dispatchEvent(new w.Event('visibilitychange'));
  assert.equal(w.api.nativeCalls.length,count);
});

test('native appearance calls finish in the latest requested theme and recover from bridge errors', async (t) => {
  const dom=new JSDOM('',{runScripts:'outside-only'}); t.after(()=>dom.window.close());
  const w=dom.window; let dark=false; const calls=[];
  w.matchMedia=()=>({matches:dark});
  w.Capacitor={Plugins:{StatusBar:{setOverlaysWebView:async()=>{},setStyle:async(v)=>calls.push(v.style),setBackgroundColor:async(v)=>calls.push(v.color)}}};
  w.eval(`${source.slice(source.indexOf('let statusBarUpdate ='),source.indexOf('if ("serviceWorker" in navigator)'))} window.updateBar=updateNativeStatusBar;`);
  w.updateBar('#ffffff'); dark=true; await w.updateBar('#182f2c');
  assert.deepEqual(calls,['DARK','#182f2c']);
  w.Capacitor.Plugins.StatusBar.setStyle=async()=>{throw new Error('bridge unavailable')};
  await w.updateBar('#182f2c');
  w.Capacitor.Plugins.StatusBar.setStyle=async(v)=>calls.push(v.style);
  dark=false; await w.updateBar('#ffffff'); assert.deepEqual(calls.slice(-2),['LIGHT','#ffffff']);
});

function luminance(hex) {
  const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return c[0]*.2126+c[1]*.7152+c[2]*.0722;
}
function contrast(a,b) { const x=luminance(a), y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
test('dark palette has accessible text, action, field and focus contrast', () => {
  const declarations=css.slice(0,css.indexOf('\n}'))+'\n'+css.split('@media (prefers-color-scheme: dark)')[1].split('\n  }')[0];
  const palette=Object.fromEntries([...declarations.matchAll(/--([\w-]+): (#[\da-f]{6});/g)].map(m=>[m[1],m[2]]));
  for (const bg of ['paper','panel','panel-soft','mint','role-primary','role-secondary','role-informal']) {
    for (const fg of ['ink','muted','teal','teal-dark']) assert.ok(contrast(palette[fg],palette[bg])>=4.5,`${fg} on ${bg}`);
  }
  for(const [fg,bg] of [['on-accent','accent-fill'],['on-danger','danger-fill'],['error','error-surface'],['warning-text','warning-surface'],['placeholder','panel'],['green','panel']]) assert.ok(contrast(palette[fg],palette[bg])>=4.5,`${fg} on ${bg}`);
  for(const fg of ['control-border','line','focus-ring','coral']) assert.ok(contrast(palette[fg],palette.panel)>=3,`${fg} on panel`);
});
