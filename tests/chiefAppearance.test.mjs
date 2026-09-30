import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
const tokens=s=>Object.fromEntries([...s.matchAll(/--([\w-]+): (#[\da-f]{6});/g)].map(m=>[m[1],m[2]]));
const light=tokens(css.slice(0,css.indexOf('\n}')));
const dark={...light,...tokens(css.split('@media (prefers-color-scheme: dark)')[1].split('\n  }')[0])};
const luminance=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
for(const [name,palette] of [['light',light],['dark',dark]])test(`Chief text and outgoing bubbles meet contrast requirements in ${name} mode`,()=>{
 for(const [fg,bg] of [['on-accent','accent-fill'],['ink','panel-soft'],['muted','panel'],['teal','mint']]){
  const a=luminance(palette[fg]),b=luminance(palette[bg]);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${fg}/${bg}`);
 }
});
