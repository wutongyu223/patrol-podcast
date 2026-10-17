'use strict';
const SHELL='patrol84-shell-v1';
const AUDIO='patrol84-audio-v1';
const BASE=new URL('./',self.location.href);
const FILES=['./','index.html','style.css','app.js','content.json','transcript.txt','manifest.webmanifest','assets/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('patrol84-shell-')&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
async function audioResponse(request) {
  const cached=await (await caches.open(AUDIO)).match(request.url);
  if(!cached)return fetch(request);
  const range=request.headers.get('range');if(!range)return cached;
  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match||(!match[1]&&!match[2]))return fetch(request);
  const bytes=await cached.arrayBuffer(),total=bytes.byteLength;
  let start=match[1]?Number(match[1]):Math.max(0,total-Number(match[2]));
  let end=match[1]&&match[2]?Math.min(Number(match[2]),total-1):total-1;
  if(start>=total||end<start)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${total}`}});
  return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Type':'audio/mpeg','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${total}`,'Accept-Ranges':'bytes'}});
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
  if(url.pathname.endsWith('.mp3')){event.respondWith(audioResponse(request));return;}
  event.respondWith(caches.open(SHELL).then(async cache=>{
    // Navigations stay inside this project; no site-wide routing or cross-site cache.
    const cached=await cache.match(request,{ignoreSearch:true});if(cached)return cached;
    try{return await fetch(request);}catch(error){if(request.mode==='navigate')return (await cache.match(new URL('index.html',BASE).href))||Response.error();throw error;}
  }));
});
