const CACHE = 'parigi-v7830-clean';
const SHELL = ['./','./index.html',
  './css/app.css?v=7830','./js/app.js?v=7830','./manifest.webmanifest','./data/trip.json','./data/phrases.json','./data/venues.json','./data/attractions.json'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('parigi-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const r=e.request; if(r.method!=='GET')return;
 const u=new URL(r.url);if(u.origin!==location.origin)return;
 // iOS must fetch icon directly; never let a historical service worker serve a cached icon.
 if(/\.(png|ico|svg)$/i.test(u.pathname))return;
 if(u.pathname.includes('/biglietti/'))return;
 const isData=u.pathname.includes('/data/')&&u.pathname.endsWith('.json');
 if(r.mode==='navigate'||isData){e.respondWith(fetch(r).then(res=>{if(res.ok){const clone=res.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(r,clone)));}return res;}).catch(async()=>await caches.match(r)||(isData?new Response('{"error":"offline"}',{status:503,headers:{'Content-Type':'application/json'}}):await caches.match('./index.html'))));return;}
 e.respondWith(caches.match(r).then(cached=>cached||fetch(r).then(res=>{if(res.ok){const clone=res.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(r,clone)));}return res;})));
});
