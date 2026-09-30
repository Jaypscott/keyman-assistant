import test from 'node:test';
import assert from 'node:assert/strict';
import {createChiefStore} from '../server/chiefStore.mjs';
// Exercise the PostgreSQL adapter contract separately from the local JSON store.
function database() {
 const records=new Map(),queries=[];
 const db={release(){queries.push('release');},async query(sql,args){
  queries.push(sql);
  if(sql.startsWith('INSERT')){if(!records.has(args[0]))records.set(args[0],JSON.parse(args[1]));return {rows:[]};}
  if(sql.startsWith('SELECT'))return {rows:records.has(args[0])?[{document:structuredClone(records.get(args[0]))}]:[]};
  if(sql.startsWith('UPDATE'))records.set(args[0],JSON.parse(args[1]));
  if(sql.startsWith('DELETE'))records.delete(args[0]);
  return {rows:[]};
 }};
 return {records,queries,pool:{query:db.query.bind(db),connect:async()=>db}};
}
test('Postgres adapter locks rows, stores independent documents, commits and deletes',async()=>{
 const {pool,queries}=database();let prepared=0;
 const store=createChiefStore({pool,ensurePostgres:async()=>prepared++});
 await store.mutate('a',d=>{d.messages.push({text:'hello'});return d;});
 await store.mutate('b',d=>d);
 assert.equal((await store.read('a')).messages[0].text,'hello');assert.equal((await store.read('b')).messages.length,0);
 assert.ok(queries.some(q=>q.includes('FOR UPDATE')));assert.ok(queries.includes('COMMIT'));assert.ok(prepared>0);
 await store.mutate('a',()=>null);assert.equal(await store.read('a'),null);
});
test('Postgres adapter rolls back and releases connections when a mutation rejects',async()=>{
 const {pool,queries}=database();const store=createChiefStore({pool});
 await assert.rejects(store.mutate('a',()=>{throw new Error('conflict');}));
 assert.equal(queries.at(-2),'ROLLBACK');assert.equal(queries.at(-1),'release');
});
