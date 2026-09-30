import test from 'node:test';import assert from 'node:assert/strict';
import {scanRosterImage,validateReviewedRoster} from '../services/volunteers/rosterImport.mjs';
class Reader {readAsDataURL(){this.result='data:image/png;base64,test';queueMicrotask(()=>this.onload());}}
const file={type:'image/png',size:100};
const options=()=>({FileReaderClass:Reader,plugin:{recognizeRosterImage:async()=>({observations:[{text:'Alex Morgan 9045550101',confidence:.98,bounds:{x:.1,y:.1,width:.8,height:.04}}]})}});
test('shared scanner reads locally and enforces file constraints',async()=>{
 assert.equal((await scanRosterImage(file,options()))[0].name,'Alex Morgan');
 await assert.rejects(scanRosterImage({...file,type:'text/plain'},options()),/image file/);
 await assert.rejects(scanRosterImage({...file,size:21*1024*1024},options()),/20 MB/);
 await assert.rejects(scanRosterImage(file,{}),/installed iPhone/);
 await assert.rejects(scanRosterImage(file,{...options(),plugin:{recognizeRosterImage:async()=>({observations:[]})}}),/No volunteer/);
});
test('scanner cancels native work on timeout and abort; late results cannot complete',async()=>{
 let cancel=0;const plugin={recognizeRosterImage:()=>new Promise(()=>{}),cancelRosterImport:async()=>cancel++};
 await assert.rejects(scanRosterImage(file,{...options(),plugin,scanTimeout:5}),/timed out|too long/);
 const abort=new AbortController();const run=scanRosterImage(file,{...options(),plugin,signal:abort.signal});await new Promise(r=>setTimeout(r,1));abort.abort();await assert.rejects(run,/cancelled/);assert.equal(cancel,2);
});
test('review requires unique names, no embedded phones, and valid optional phone numbers',()=>{
 assert.deepEqual(validateReviewedRoster([{name:' Alex ',phone:''}]),[{name:'Alex',phone:''}]);
 for(const roster of [[{name:'',phone:''}],[{name:'Alex',phone:'bad'}],[{name:'Alex 9045550101',phone:''}],[{name:'Alex',phone:''},{name:'alex',phone:''}]]) assert.throws(()=>validateReviewedRoster(roster));
});
