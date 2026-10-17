'use strict';
const $ = id => document.getElementById(id);
const audio = $('audio');
const STORE = 'patrol84-reader-v1';
const AUDIO_CACHE = 'patrol84-audio-v1';
const speeds = [.75,1,1.15,1.25,1.5,1.75,2];
let data, selected = 1, current = -1, onlySaved = false, pendingSeek = null;
let lastWrite = 0, noticeTimer, storageFailed = false, offlineBusy = false;
let state = {time:0,speed:1,selected:1,bookmarks:[],updated:0};
const clock = t => {
  t = Math.max(0,Math.floor(Number(t)||0));
  return t >= 3600 ? `${Math.floor(t/3600)}:${String(Math.floor(t%3600/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}` : `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
};
function notify(message, duration=4000) {
  clearTimeout(noticeTimer); $('notice').textContent=message; $('notice').hidden=false;
  noticeTimer=setTimeout(()=>$('notice').hidden=true,duration);
}
function cleanState(value) {
  if (!value || typeof value !== 'object') throw new Error('备份格式不正确');
  const time=Number(value.time),speed=Number(value.speed),n=Number(value.selected);
  if (!Number.isFinite(time)||time<0||time>data.duration+1||!speeds.includes(speed)||!Number.isInteger(n)||n<1||n>84||!Array.isArray(value.bookmarks)||value.bookmarks.length>84||!value.bookmarks.every(n=>Number.isInteger(n)&&n>=1&&n<=84)) throw new Error('备份内容不完整或超出范围');
  return {time:Math.min(time,data.duration),speed,selected:n,bookmarks:[...new Set(value.bookmarks)],updated:Number(value.updated)||Date.now()};
}
function save(force=false) {
  if (!force && Date.now()-lastWrite<1500) return;
  // Do not replace a restored position with zero while metadata is loading.
  state.time=pendingSeek===null?audio.currentTime:pendingSeek;
  state.speed=audio.playbackRate; state.selected=selected; state.updated=Date.now();
  try {localStorage.setItem(STORE,JSON.stringify(state)); $('progress-saved').textContent='进度已保存';}
  catch {if(!storageFailed){storageFailed=true;$('storage-note').textContent='浏览器暂不允许本地保存。可导出进度备份，或下载音频和文字稿。';$('progress-saved').textContent='本地保存不可用';}}
  lastWrite=Date.now();
}
function questionAt(time) {
  let n=1; for(const q of data.questions){if(time+0.02>=q.start)n=q.n;else break;}return n;
}
function route() {
  const params=new URLSearchParams(location.hash.slice(1)); const n=Number(params.get('q'));
  return Number.isInteger(n)&&n>=1&&n<=84?n:null;
}
function setHash(n) {if(route()!==n)history.replaceState(null,'',`#q=${n}`);}
function splitBody(body) {
  const sentences=body.match(/[^。！？]+[。！？]?/g)||[body];
  const paragraphs=[];let paragraph='';
  for(const sentence of sentences){if(paragraph.length>=90){paragraphs.push(paragraph);paragraph='';}paragraph+=sentence;}
  if(paragraph)paragraphs.push(paragraph);
  return paragraphs;
}
function renderArticle(n) {
  selected=n; const q=data.questions[n-1];const chapter=data.chapters[q.chapter-1];
  $('chapter-label').textContent=chapter.title;
  $('question-number').textContent=`Q${String(n).padStart(3,'0')} / 084`;
  $('question-title').textContent=q.title;
  $('question-key').textContent=q.key;
  $('question-duration').textContent=`${clock(q.start)} 起 · ${clock(q.duration)}`;
  $('transcript').replaceChildren(...splitBody(q.body).map(text=>{const p=document.createElement('p');p.textContent=text;return p;}));
  const saved=state.bookmarks.includes(n);
  $('bookmark').textContent=saved?'★ 已收藏':'☆ 收藏本题';$('bookmark').setAttribute('aria-pressed',saved);
  $('previous').disabled=n===1;$('next').disabled=n===84;
  document.title=`${q.title} · 巡检84问`;
  for(const row of $('question-list').querySelectorAll('.question-row'))row.classList.toggle('active',+row.dataset.n===n);
}
function renderList() {
  const term=$('search').value.trim().toLowerCase(), chapter=$('chapter-filter').value;
  const numeric=/^\d+$/.test(term);const rows=data.questions.filter(q=>(chapter==='all'||q.chapter===+chapter)&&(!onlySaved||state.bookmarks.includes(q.n))&&(!term||(numeric?q.n===+term:(q.title+' '+q.body).toLowerCase().includes(term))));
  $('result-count').textContent=`${rows.length}题`;$('saved-count').textContent=state.bookmarks.length;
  const fragment=document.createDocumentFragment();let group=-1;
  for(const q of rows){
    if(q.chapter!==group){group=q.chapter;const label=document.createElement('p');label.className='group-label';label.textContent=data.chapters[group-1].title;fragment.append(label);}
    const row=document.createElement('div');row.className='question-row';row.dataset.n=q.n;row.classList.toggle('active',q.n===selected);row.classList.toggle('listening',q.n===current);
    const select=document.createElement('button');select.className='question-select';select.setAttribute('aria-label',`播放第${q.n}题：${q.title}`);
    const number=document.createElement('span');number.className='number';number.textContent=String(q.n).padStart(2,'0');
    const title=document.createElement('span');title.textContent=q.title;select.append(number,title);
    if(state.bookmarks.includes(q.n)){const star=document.createElement('span');star.className='star';star.textContent='★';star.setAttribute('aria-label','已收藏');select.append(star);}
    select.onclick=()=>choose(q.n,true);
    const play=document.createElement('button');play.className='question-play';play.textContent='▶';play.setAttribute('aria-label',`从${clock(q.start)}播放第${q.n}题`);play.onclick=()=>choose(q.n,true);
    row.append(select,play);fragment.append(row);
  }
  if(!rows.length){const p=document.createElement('p');p.className='empty';p.textContent=onlySaved?'还没有符合条件的收藏。可在正文上方收藏题目。':'没有找到对应题目，可换一个关键词。';fragment.append(p);}
  $('question-list').replaceChildren(fragment);
}
function seek(time, play=false) {
  time=Math.max(0,Math.min(data.duration,Number(time)||0));
  if(audio.readyState===0)pendingSeek=time;else {pendingSeek=null;audio.currentTime=time;}
  if(play)audio.play().catch(error=>{if(error.name!=='AbortError')notify('暂时无法播放，请重试或使用“下载音频”。');});
  updatePosition(time);save(true);
}
function choose(n,play=false) {
  renderArticle(n);setHash(n);
  if(play){seek(data.questions[n-1].start,true);$('resume-banner').hidden=true;}
  if(matchMedia('(max-width:660px)').matches){$('directory').classList.remove('open');$('menu-toggle').setAttribute('aria-expanded','false');$('reader').scrollIntoView({block:'start'});}
}
function updatePosition(time=audio.currentTime) {
  $('current-time').textContent=clock(time);$('seek').value=time;
  const n=questionAt(time);
  if(n!==current){current=n;const q=data.questions[n-1];$('now-playing').textContent=`Q${String(n).padStart(3,'0')} · ${q.title}`;
    for(const row of $('question-list').querySelectorAll('.question-row'))row.classList.toggle('listening',+row.dataset.n===n);
    if(!audio.paused){renderArticle(n);setHash(n);}
    if('mediaSession' in navigator&&typeof MediaMetadata!=='undefined')navigator.mediaSession.metadata=new MediaMetadata({title:q.title,artist:'巡检84问 · 知识直讲',album:data.chapters[q.chapter-1].title});
  }
}
function updateResume() {
  const show=state.time>10&&state.time<data.duration-3;
  $('resume-banner').hidden=!show;
  if(show)$('resume-text').textContent=`上次听到 Q${String(questionAt(state.time)).padStart(3,'0')} · ${clock(state.time)}`;
}
async function offlineStatus() {
  if(!('caches' in window)||!('serviceWorker' in navigator)||!isSecureContext){$('offline').disabled=true;$('offline').textContent='此浏览器请用下载音频';return;}
  const cache=await caches.open(AUDIO_CACHE);const response=await cache.match(new URL(data.audio,location.href).href);
  $('offline').textContent=response?'已离线保存 · 点击移除':`保存离线音频 · ${(data.audioBytes/1048576).toFixed(1)} MB`;
  $('offline').dataset.saved=response?'yes':'no';
}
async function toggleOffline() {
  if(offlineBusy)return;offlineBusy=true;$('offline').disabled=true;
  const url=new URL(data.audio,location.href).href;
  try {
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error("离线功能未就绪")),12000))]);const cache=await caches.open(AUDIO_CACHE);
    if($('offline').dataset.saved==='yes'){await cache.delete(url);notify('已移除离线音频，进度和收藏仍保留。');}
    else {
      $('offline').textContent='正在保存音频…';
      const response=await fetch(url,{cache:'reload'});if(!response.ok||response.status!==200)throw new Error('音频下载失败');
      if(response.body){const reader=response.body.getReader();const chunks=[];let received=0;
        while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.length;$('offline').textContent=`正在保存 ${Math.min(100,Math.floor(received/data.audioBytes*100))}%`;}
        if(received!==data.audioBytes)throw new Error('音频下载不完整');
        const headers=new Headers(response.headers);headers.set('Content-Length',String(received));
        await cache.put(url,new Response(new Blob(chunks,{type:'audio/mpeg'}),{status:200,headers}));
      }else await cache.put(url,response);
      notify('已保存音频与网页，可在此浏览器离线收听。');
    }
  }catch(error){notify('离线保存未完成，请检查网络或浏览器存储空间；仍可下载音频。',7000);}
  finally {offlineBusy=false;$('offline').disabled=false;await offlineStatus().catch(()=>{});}
}
function backup() {
  save(true);const blob=new Blob([JSON.stringify({app:'patrol84',version:1,edition:data.version,state},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`巡检84问-进度备份-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function init() {
  const response=await fetch('./content.json');if(!response.ok)throw new Error('题目数据载入失败');data=await response.json();
  try {const stored=localStorage.getItem(STORE);if(stored)state=cleanState(JSON.parse(stored));}catch{}
  for(let i=0;i<data.chapters.length;i++){const option=document.createElement('option');option.value=i+1;option.textContent=data.chapters[i].title;$('chapter-filter').append(option);}
  $('duration-label').textContent=`${clock(data.duration)} · 单人讲解`;$('total-time').textContent=clock(data.duration);$('seek').max=data.duration;
  $('download-audio').href=data.audio;$('speed').value=String(state.speed);audio.playbackRate=state.speed;
  const n=route();selected=n||state.selected;renderArticle(selected);renderList();updateResume();
  pendingSeek=n?data.questions[n-1].start:state.time;updatePosition(pendingSeek);
  audio.addEventListener('loadedmetadata',()=>{if(pendingSeek!==null){audio.currentTime=pendingSeek;pendingSeek=null;}audio.playbackRate=state.speed;});
  audio.addEventListener('timeupdate',()=>{updatePosition();save();});
  audio.addEventListener('play',()=>{$('play').textContent='Ⅱ';$('play').setAttribute('aria-label','暂停');$('resume-banner').hidden=true;updatePosition();});
  audio.addEventListener('pause',()=>{$('play').textContent='▶';$('play').setAttribute('aria-label','播放');save(true);});
  audio.addEventListener('error',()=>notify('音频未能载入，请检查网络，或下载后使用本地播放器。',7000));
  audio.src=data.audio;
  $('play').onclick=()=>audio.paused?audio.play().catch(()=>notify('请重试播放或下载音频。')):audio.pause();
  $('play-question').onclick=()=>seek(data.questions[selected-1].start,true);
  $('previous').onclick=()=>choose(Math.max(1,selected-1),true);$('next').onclick=()=>choose(Math.min(84,selected+1),true);
  $('rewind').onclick=()=>seek((pendingSeek??audio.currentTime)-15);$('forward').onclick=()=>seek((pendingSeek??audio.currentTime)+15);
  $('seek').oninput=e=>seek(+e.target.value);$('speed').onchange=e=>{audio.playbackRate=+e.target.value;save(true);};
  $('now-playing').onclick=()=>{renderArticle(current>0?current:1);setHash(selected);$('reader').scrollIntoView({block:'start'});};
  $('resume').onclick=()=>{const time=state.time;choose(questionAt(time));seek(time,true);};
  $('search').oninput=renderList;$('chapter-filter').onchange=renderList;
  $('filter-all').onclick=()=>filter(false);$('filter-saved').onclick=()=>filter(true);
  function filter(saved){onlySaved=saved;for(const [id,on] of [['filter-all',!saved],['filter-saved',saved]]){$(id).classList.toggle('selected',on);$(id).setAttribute('aria-pressed',on);}renderList();}
  $('bookmark').onclick=()=>{state.bookmarks=state.bookmarks.includes(selected)?state.bookmarks.filter(n=>n!==selected):[...state.bookmarks,selected];renderArticle(selected);renderList();save(true);};
  $('copy-link').onclick=async()=>{const url=new URL(location.href);url.hash=`q=${selected}`;try{await navigator.clipboard.writeText(url.href);notify('已复制本题链接。');}catch{notify('可复制浏览器地址栏中的本题链接。');}};
  $('menu-toggle').onclick=()=>{const open=$('directory').classList.toggle('open');$('menu-toggle').setAttribute('aria-expanded',open);if(open)$('directory').scrollIntoView({block:'start'});};
  $('offline').onclick=toggleOffline;$('export-progress').onclick=backup;
  $('import-progress').onclick=()=>$('import-file').click();
  $('import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>100000)throw new Error();const backup=JSON.parse(await file.text());if(backup.app!=='patrol84'||backup.version!==1)throw new Error();const imported=cleanState(backup.state);audio.pause();state=imported;audio.playbackRate=state.speed;$('speed').value=String(state.speed);renderArticle(state.selected);setHash(selected);renderList();seek(state.time);updateResume();notify('已导入进度和收藏，点击播放继续。');}catch{notify('无法导入：请选用本页面导出的有效进度备份。');}e.target.value='';};
  window.addEventListener('hashchange',()=>{const n=route();if(n){renderArticle(n);seek(data.questions[n-1].start);}});
  window.addEventListener('pagehide',()=>save(true));document.addEventListener('visibilitychange',()=>{if(document.hidden)save(true);});
  if('mediaSession' in navigator){for(const [name,handler] of Object.entries({play:()=>audio.play(),pause:()=>audio.pause(),seekbackward:()=>seek(audio.currentTime-15),seekforward:()=>seek(audio.currentTime+15),previoustrack:()=>choose(Math.max(1,current-1),true),nexttrack:()=>choose(Math.min(84,current+1),true),seekto:details=>seek(details.seekTime)})){try{navigator.mediaSession.setActionHandler(name,handler);}catch{}}}
  if('serviceWorker' in navigator&&isSecureContext){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
  await offlineStatus().catch(()=>{$('offline').disabled=true;});
}
init().catch(error=>{$('transcript').replaceChildren();const p=document.createElement('p');p.textContent='题目数据载入失败，请刷新页面重试。也可下载文字稿阅读。';$('transcript').append(p);notify('页面未完整载入，请检查网络后刷新。',8000);});
