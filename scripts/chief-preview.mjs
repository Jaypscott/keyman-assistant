// Local-only preview: serve an explicit frontend allowlist and proxy API calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve(new URL('..',import.meta.url).pathname);
const allowedFiles=new Set(['index.html','app.js','styles.css','manifest.json','sw.js']);
const allowedFolders=['components/','constants/','hooks/','services/','types/','assets/','public/'];
const port=Number(process.env.CHIEF_PREVIEW_PORT||4173);
const api=`http://127.0.0.1:${process.env.AUTH_PORT||3001}`;
createServer(async(req,res)=>{
 try{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
  if(path.startsWith('api/')){
   const chunks=[];for await(const c of req)chunks.push(c);
   const response=await fetch(`${api}/${path}`,{method:req.method,headers:{'content-type':'application/json',...(req.headers.authorization?{authorization:req.headers.authorization}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(await response.text());return;
  }
  if(path==='sw.js'){
   res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});
   res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('keyman-shift-planner-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));");return;
  }
  if(path==='config.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(`window.KEYMAN_CONFIG={authApiBase:location.origin,privacyPolicyUrl:location.origin+'/privacy'};`);return;}
  if(path.includes('..')||path.split('/').some(s=>s.startsWith('.'))||(!allowedFiles.has(path)&&!allowedFolders.some(f=>path.startsWith(f)))){res.writeHead(404);res.end();return;}
  const content=await readFile(resolve(root,path));
  const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(content);
 }catch{res.writeHead(502);res.end('Preview unavailable. Check that the local API is running.');}
}).listen(port,'127.0.0.1',()=>console.log(`Chief preview: http://127.0.0.1:${port}`));
