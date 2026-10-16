const $=s=>document.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const st={
  get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},
  set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))
};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let trip=null, phrases=[], venues={planned:[],tbd:[]}, attrs=[], day=0;
let mainAudio={utterance:null,stop:null,button:null,type:null,progressTimer:null,startedAt:0,pausedAt:0,estimatedMs:0};
let weatherTimer=null;

async function j(url,fallback){
  try{
    const r=await fetch(url,{cache:'no-store'});
    if(!r.ok)throw new Error(url);
    return await r.json();
  }catch{return fallback}
}

async function boot(){
  trip=await j('./data/trip.json',null);
  if(trip && (!Array.isArray(trip.days) || !trip.days.every(d=>Array.isArray(d.stops)))) trip=null;
  if(!trip){
    $('#app').innerHTML='<main style="padding:30px">Errore caricamento viaggio</main>';
    return;
  }
  [phrases,venues,attrs]=await Promise.all([
    j('./data/phrases.json',[]),
    j('./data/venues.json',{planned:[],tbd:[]}),
    j('./data/attractions.json',[])
  ]);
  if(!Array.isArray(phrases)) phrases=[];
  if(!venues || typeof venues!=='object') venues={planned:[],tbd:[]};
  if(!Array.isArray(attrs)) attrs=[];
  day=todayIndex();
  render();
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js?v=7830', {updateViaCache:'none'}).catch(()=>{});
}

function parisNow(){
  return new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/Paris'}));
}
function actualTripDayIndex(){
  const n=parisNow();
  if(n.getFullYear()===2026&&n.getMonth()===10&&n.getDate()>=11&&n.getDate()<=16)return n.getDate()-11;
  return -1;
}
function todayIndex(){
  const live=actualTripDayIndex();
  return live>=0?live:Number(st.get('day',0));
}
function mins(t){
  if(!t||!t.includes(':'))return null;
  const [h,m]=t.split(':').map(Number);
  return h*60+m;
}
function current(){
  const live=actualTripDayIndex();
  const d=trip.days[live>=0?live:day]||trip.days[0];
  if(live<0)return{d,c:d.stops[0],live:false};
  const n=parisNow(),m=n.getHours()*60+n.getMinutes();
  let c=d.stops.find(s=>s.start&&s.end&&m>=mins(s.start)&&m<mins(s.end));
  if(!c)c=d.stops.find(s=>s.start&&mins(s.start)>m)||d.stops.at(-1);
  return{d,c,live:true};
}
function state(d,i){
  const ti=actualTripDayIndex();
  if(ti<0)return'future';
  if(day<ti)return'past';
  if(day>ti)return'future';
  const n=parisNow(),m=n.getHours()*60+n.getMinutes(),s=d.stops[i],a=mins(s.start),b=mins(s.end);
  if(a!==null&&b!==null&&m>=a&&m<b)return'current';
  if(b!==null&&m>=b)return'past';
  return'future';
}
function findStop(id){
  for(const d of trip.days){
    const s=d.stops.find(x=>x.id===id);
    if(s)return s;
  }
  return null;
}
function findAttraction(id){return attrs.find(a=>a.id===id)||null}

function render(){
  $('#app').innerHTML=`${hero()}<main class="content">${dayView(day)}</main>${audioPlayer()}${nav()}`;
  bind();
  weather();
}

function hero(){
  const dow=['DOM','LUN','MAR','MER','GIO','VEN','SAB'];
  return `<header class="hero">
    <div class="hero-top">
      <div class="hero-spacer" aria-hidden="true"></div>
      <div class="brand">PARIGI</div>
      <button class="hero-btn hero-search" id="searchTop" aria-label="Cerca">⌕</button>
    </div>
    <div class="hero-meta"><span>${esc(trip.dates.label)}</span><span>·</span><a href="${trip.hotel.maps}">${esc(trip.hotel.name)} ›</a></div>
    <div class="header-weather" id="weather"><span class="weather-symbol">◌</span><span>Meteo Parigi</span></div>
    <div class="dayrail">${trip.days.map((d,i)=>{
      const dt=new Date(d.date+'T12:00:00');
      return `<button class="${i===day?'active':''}" data-day="${i}">
        <span class="day-dow">${dow[dt.getDay()]}</span><span class="day-num">${d.date.slice(-2)}</span>
      </button>`;
    }).join('')}</div>
    ${liveStrip()}
  </header>`;
}

function liveStrip(){
  const info=current();
  if(!info.live)return'';
  const d=info.d,c=info.c;
  const di=trip.days.indexOf(d);
  const label=c.end?`fino alle ${esc(c.end)}`:'in corso';
  return `<button class="live-strip" id="liveStrip" data-live-day="${di}" data-live-id="${c.id}" type="button">
    <span class="live-dot" aria-hidden="true"></span>
    <strong>${esc(c.title)}</strong>
    <span>${label}</span>
    <b>↑</b>
  </button>`;
}
function paceClass(pace){
  const p=String(pace||'').toLowerCase();
  if(/relaxed|rilassat/.test(p))return'pace-relaxed';
  if(/light|legger|easy|soft/.test(p))return'pace-light';
  if(/balanced|moderate|moderato|medium|medio/.test(p))return'pace-moderate';
  if(/intense|intenso|busy|dense|denso|full/.test(p))return'pace-intense';
  return'pace-neutral';
}

function phaseLabel(stop, idx, stops){
  const hour=Number(String(stop.start||'00').split(':')[0]);
  const phase=hour<12?'Mattina':hour<18?'Pomeriggio':'Sera';
  if(idx===0)return phase;
  const prevHour=Number(String(stops[idx-1].start||'00').split(':')[0]);
  const prevPhase=prevHour<12?'Mattina':prevHour<18?'Pomeriggio':'Sera';
  return phase===prevPhase?'':phase;
}
function dayView(i){
  const d=trip.days[i];
  return `<section class="day">
    <div class="dayhead">
      <div class="dayhead-left">
        <h2>${esc(d.dateLabel)}</h2>
        <p>${esc(d.subtitle||'')}</p>
      </div>
      <span class="pace ${paceClass(d.pace)}">${esc(d.pace||'')}</span>
    </div>
    <div class="day-flow">${d.stops.map((s,idx)=>`${phaseLabel(s,idx,d.stops)?`<div class="day-phase" aria-label="${phaseLabel(s,idx,d.stops)}"><span>${phaseLabel(s,idx,d.stops)}</span></div>`:''}${flowTransport(s)}${flowStop(d,s,idx)}`).join('')}</div>
  </section>`;
}

function flowTransport(s){
  const t=s?.transportBefore;
  if(!t?.options?.length)return'';
  return `<div class="flow-transfer" aria-label="Spostamento verso ${esc(displayTitle(s))}">
    <div class="flow-transfer-time"></div>
    <div class="flow-transfer-rail"><span></span></div>
    <div class="flow-transfer-body">
      <div class="flow-transfer-options">
        ${t.options.slice(0,2).map(o=>{
          const label=`<span class="transport-icon">${esc(o.icon)}</span><strong>${esc(o.shortName||o.name)}</strong><span class="transfer-duration">${esc(o.shortTime||o.time||'')}</span><span class="transfer-price">${esc(o.shortPrice||o.price||'')}</span>`;
          return o.href
            ? `<a class="flow-transfer-option" href="${esc(o.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
            : `<span class="flow-transfer-option">${label}</span>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function hasDetails(s){
  return Boolean(
    (s.editorialIntro&&String(s.editorialIntro).trim()) ||
    (s.summary&&String(s.summary).trim()) ||
    (s.tip&&String(s.tip).trim()) ||
    (Array.isArray(s.highlights)&&s.highlights.some(x=>String(x||'').trim()))
  );
}

function displayTitle(s){
  let t=String(s?.title||'').replace(/^[✈️✈︎]\s*/,'').trim();
  t=t.replace(/^(Colazione|Pranzo|Cena)\s*·\s*/i,'');
  t=t.replace(/^Check-in\s*·\s*/i,'');
  t=t.replace(/^Hotel\s*·\s*/i,'');
  if(/^Rientro in hotel$/i.test(t))return'Hotel Apollinaire';
  if(/^Partenza per Orly/i.test(t))return'Verso Orly';
  return t;
}

function mealLabel(s){
  const t=String(s?.title||'');
  if(/^Colazione/i.test(t))return'COLAZIONE';
  if(/^Pranzo/i.test(t))return'PRANZO';
  if(/^Cena/i.test(t))return'CENA';
  if(s?.kind==='hotel'&&/Rientro/.test(t))return'RIENTRO';
  if(s?.kind==='hotel'&&/Check-in/.test(t))return'CHECK-IN';
  return'';
}

function categoryMark(s){
  if(s.kind==='place')return'<span class="flow-kind" title="Visita">◇</span>';
  if(s.kind==='food')return'<span class="flow-kind" title="Pasto">⌁</span>';
  if(s.kind==='hotel')return'<span class="flow-kind" title="Hotel">⌂</span>';
  if(s.kind==='flight')return'<span class="flow-kind" title="Volo">✈︎</span>';
  if(s.kind==='transfer')return'<span class="flow-kind" title="Trasferimento">⇢</span>';
  return'';
}

function mealChoices(s){
  const recs=(s.kind==='food'&&Array.isArray(s.mealRecommendations))
    ? s.mealRecommendations.filter((r,idx,arr)=>{
        const n=(r?.name||'').trim().toLowerCase();
        return n&&arr.findIndex(x=>(x?.name||'').trim().toLowerCase()===n)===idx;
      }).slice(0,3)
    : [];
  if(!recs.length)return'';
  return `<div class="flow-meals">${recs.map(r=>`<a class="flow-meal" href="${r.tripadvisor}" target="_blank" rel="noopener"><strong>${esc(r.name)}</strong><span>${esc(r.meta||'')}</span></a>`).join('')}</div>`;
}

function flowStop(d,s,i){
  const status=state(d,i);
  const isTerminal=s.kind==='hotel'&&s.title==='Rientro in hotel';
  const isBreak=s.kind==='break';
  const detailContent=hasDetails(s)||Boolean(mealChoices(s));
  const persistentActions=Boolean(s.audioGuide?.text)||Boolean(s.louvreTrail);

  if(isBreak){
    return `<div class="flow-free ${status}" id="${s.id}">
      <div class="flow-free-time">${esc(s.start||'')}</div>
      <div class="flow-free-rail"><span></span></div>
      <div class="flow-free-body"><span>Tempo libero</span><em>${s.end?`${esc(s.start)}–${esc(s.end)}`:''}</em></div>
    </div>`;
  }

  const attraction=findAttraction(s.id);
  const ticketAction=attraction?ticketLinksHTML(attraction,'timeline'):'';
  const bookingHtml=attraction?(bookingBadgeHTML(attraction,'timeline')):'';
  const shortTitle=displayTitle(s);
  const titleHtml=s.officialWebsite
    ? `<a class="flow-title-link" href="${s.officialWebsite}" target="_blank" rel="noopener">${esc(shortTitle)} <span>↗</span></a>`
    : `<span class="flow-title-text">${esc(shortTitle)}</span>`;
  const eyebrow=mealLabel(s);
  const place=s.place&&s.place!==s.title?`<div class="flow-place">${esc(s.place)}</div>`:'';
  const currentLabel=status==='current'
    ? `<div class="flow-now"><span class="live-dot"></span>ADESSO</div>`
    :'';
  const map=s.mapDestination?`https://maps.apple.com/?daddr=${encodeURIComponent(s.mapDestination)}`:(s.coordinates?`https://maps.apple.com/?daddr=${s.coordinates.lat},${s.coordinates.lon}`:'');
  const currentMap=status==='current'&&map?`<a class="flow-map" href="${map}">Apri in Mappe ↗</a>`:'';
  const photo=s.kind==='place'&&s.photo?.src
    ? `<div class="flow-photo"><img src="${s.photo.src}" loading="lazy" decoding="async" alt="${esc(s.photo.caption||shortTitle)}" onerror="this.closest('.flow-photo')?.remove()"></div>`
    :'';
  const actionBar=(persistentActions||detailContent||ticketAction)?`<div class="flow-inline-actions">
      ${s.audioGuide?.text?`<button data-action="audio" data-id="${s.id}" type="button">Audioguida <span>▶</span></button>`:''}
      ${s.louvreTrail?`<button data-action="trail" data-id="${s.id}" type="button">Percorso 3H <span>›</span></button>`:''}
      ${detailContent?`<button class="flow-details-toggle" data-details-toggle="true" type="button">Dettagli <span>⌄</span></button>`:''}
      ${ticketAction}
    </div>`:'';
  const expandBody=detailContent?`<div class="flow-expand">
      ${hasDetails(s)?details(s):''}
      ${mealChoices(s)}
    </div>`:'';

  return `<article class="flow-event ${status} ${isTerminal?'terminal':''}" id="${s.id}">
    <div class="flow-clock"><strong>${esc(s.start||'')}</strong>${s.end?`<span>${esc(s.end)}</span>`:''}</div>
    <div class="flow-rail"><span class="flow-node"></span></div>
    <div class="flow-event-body ${detailContent?'expandable':''}">
      ${currentLabel}
      ${eyebrow?`<div class="flow-eyebrow">${eyebrow}</div>`:''}
      <div class="flow-title-row">
        <div class="flow-title" title="${esc(shortTitle)}">${categoryMark(s)}${titleHtml}</div>
        ${bookingHtml}
      </div>
      ${place}
      ${photo}
      ${actionBar}
      ${currentMap}
      ${expandBody}
      ${isTerminal?`<div class="flow-day-end">Fine giornata</div>`:''}
    </div>
  </article>`;
}

function details(s){
  if(!s)return'';
  const highlights=(s.highlights||[]).length?`<ul>${s.highlights.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'';
  return `<div class="details">
    ${s.editorialIntro?`<p>${esc(s.editorialIntro)}</p>`:''}
    ${highlights}
    ${s.summary?`<p>${esc(s.summary)}</p>`:''}
    ${s.tip?`<div class="tip">${esc(s.tip)}</div>`:''}
  </div>`;
}

function nav(){
  return `<nav class="nav nav-liquid">
    <button class="active" data-nav="today" aria-label="Oggi">
      <svg viewBox="0 0 24 24"><path d="M4.5 11.2 12 5l7.5 6.2v8.3h-5v-5h-5v5h-5z"/></svg><span>Oggi</span>
    </button>
    <button data-nav="wallet" aria-label="Wallet">
      <svg viewBox="0 0 24 24"><path d="M5 6.5h12.5a2 2 0 0 1 2 2V18H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Zm10 4h4.5v4H15a2 2 0 0 1 0-4Z"/></svg><span>Wallet</span>
    </button>
    <button data-nav="phrases" aria-label="Frasi">
      <svg viewBox="0 0 24 24"><path d="M5 5.5h14v9H9.5L5 18.5z"/></svg><span>Frasi</span>
    </button>
    <button data-nav="venues" aria-label="Locali">
      <svg viewBox="0 0 24 24"><path d="M7 4v6M5 4v6M9 4v6M5 10h4M7 10v10M16 4v16M16 4c2 1 3 3.2 3 5.5S18 14 16 15"/></svg><span>Locali</span>
    </button>
    <button data-nav="attractions" aria-label="Attrazioni">
      <svg viewBox="0 0 24 24"><path d="M5 20h14M7 20V9l5-5 5 5v11M10 20v-6h4v6"/></svg><span>Attrazioni</span>
    </button>
  </nav>`;
}

function bind(){
  $$('[data-day]').forEach(b=>b.onclick=()=>{day=Number(b.dataset.day);st.set('day',day);render()});

  $$('[data-action]').forEach(b=>b.onclick=e=>{
    e.preventDefault();
    e.stopPropagation();
    const id=b.dataset.id,a=b.dataset.action,s=findStop(id);
    if(a==='audio')startStopAudio(s);
    if(a==='trail')louvreTrailSheet(s);
  });

  $$('[data-details-toggle]').forEach(btn=>{
    btn.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      const body=btn.closest('.flow-event-body');if(!body)return;
      body.classList.toggle('expanded');
      btn.classList.toggle('active',body.classList.contains('expanded'));
    };
  });

  $$('[data-nav]').forEach(b=>b.onclick=()=>go(b.dataset.nav));
  $('#searchTop').onclick=searchSheet;

  const live=$('#liveStrip');
  if(live)live.onclick=()=>{
    day=Number(live.dataset.liveDay);
    st.set('day',day);
    render();
    setTimeout(()=>document.getElementById(live.dataset.liveId)?.scrollIntoView({behavior:'smooth',block:'center'}),80);
  };

  bindBookingBadges();
}
function go(x){
  if(x==='today'){closePanel();setDockActive('today');window.scrollTo({top:0,behavior:'smooth'});return}
  if(x==='wallet'){closePanel();setDockActive('wallet');location.href='shoebox://';return}
  if(x==='phrases'){setDockActive('phrases');phraseSheet();}
  if(x==='venues'){setDockActive('venues');venueSheet();}
  if(x==='attractions'){setDockActive('attractions');attractions();}
}

/* -------------------- PANELS -------------------- */
function setDockActive(name){document.querySelectorAll('[data-nav]').forEach(b=>{const active=b.dataset.nav===name;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
function closePanel(){
  const root=$('#sheet-root');
  if(root)root.replaceChildren();
  document.body.classList.remove('panel-open');
  setDockActive('today');
}
function panel(title,body,variant='glass'){
  const root=$('#sheet-root');
  if(!root)return;
  root.innerHTML=`<div class="panel-backdrop" id="panelBackdrop">
    <section class="panel-card panel-${variant}" id="panelCard" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="panel-handle" aria-hidden="true"></div>
      <header class="panel-header"><h3>${title}</h3></header>
      <div class="panel-scroll">${body}</div>
    </section>
  </div>`;
  document.body.classList.add('panel-open');
  const backdrop=$('#panelBackdrop'),card=$('#panelCard');
  backdrop.onclick=e=>{if(card&&!card.contains(e.target))closePanel()};
  root.querySelector('.panel-scroll')?.scrollTo(0,0);
}

const sheet=panel;

/* -------------------- BOOKING
/* -------------------- BOOKING -------------------- */
const bookingStateKey='parigi-booking-status-v2';
function bookingStateMap(){
  try{return JSON.parse(localStorage.getItem(bookingStateKey)||'{}')||{}}catch{return{}}
}
function getBookingState(a){
  const saved=bookingStateMap();
  return saved[a.id]||a.bookingStatus||'not_needed';
}
function bookingLabel(state){
  if(state==='booked')return'✓ Prenotato';
  if(state==='to_book')return'Da prenotare';
  return'Libero';
}
function bookingClass(state){
  return state==='booked'?'booked':state==='to_book'?'to-book':'free';
}
function nextBookingState(state){
  if(state==='to_book')return'booked';
  if(state==='booked')return'not_needed';
  return'to_book';
}
function setBookingState(id,state){
  const saved=bookingStateMap();
  saved[id]=state;
  localStorage.setItem(bookingStateKey,JSON.stringify(saved));
}
function bookingBadgeHTML(a,context='page'){
  const state=getBookingState(a);
  return `<button class="booking-chip ${bookingClass(state)} ${context==='timeline'?'booking-chip-timeline':''}" data-booking-id="${a.id}" type="button">${bookingLabel(state)}</button>`;
}
function ticketLinksHTML(a,context='page'){
  if(!a.ticketFiles?.length)return '';
  const file=a.ticketFiles[0];
  return `<a class="ticket-text-link ${context==='timeline'?'ticket-text-link-timeline':''}" href="${esc(file.path)}" target="_blank" rel="noopener" aria-label="Biglietti ${esc(a.name)}">Biglietti <span aria-hidden="true">↗</span></a>`;
}
function bindBookingBadges(){
  $$('[data-booking-id]').forEach(b=>{
    b.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      const a=findAttraction(b.dataset.bookingId);
      if(!a)return;
      const state=nextBookingState(getBookingState(a));
      setBookingState(a.id,state);
      $$(`[data-booking-id="${a.id}"]`).forEach(x=>{
        x.className=`booking-chip ${bookingClass(state)} ${x.classList.contains('booking-chip-timeline')?'booking-chip-timeline':''}`;
        x.textContent=bookingLabel(state);
      });
    };
  });
}

/* -------------------- FRASI / LOCALI / ATTRAZIONI -------------------- */
function phraseSheet(){
  const cats=[...new Set(phrases.map(x=>x.category))];
  panel('Frasi',`<div class="mini-page">${cats.map(c=>`<section class="mini-section">
    <div class="mini-section-label">${esc(c)}</div>
    ${phrases.filter(x=>x.category===c).map(x=>`<div class="mini-row phrase-row">
      <div class="mini-main"><div class="phrase-primary">${esc(x.fr)}</div><div class="mini-secondary">${esc(x.it)}${x.pron?` · ${esc(x.pron)}`:''}</div></div>
      <button class="mini-icon-btn phrase-play" data-say="${encodeURIComponent(x.fr)}" type="button" aria-label="Ascolta ${esc(x.fr)}">▶</button>
    </div>`).join('')}
  </section>`).join('')}</div>`,'opaque');
  setTimeout(()=>$$('[data-say]').forEach(b=>b.onclick=()=>playPhrase(decodeURIComponent(b.dataset.say),b)),0);
}

function venueSheet(){
  const row=v=>{
    const name=v.website?`<a class="mini-name" href="${v.website}" target="_blank" rel="noopener">${esc(v.name)}</a>`:`<div class="mini-name">${esc(v.name)}</div>`;
    return `<div class="mini-row venue-row">
      <div class="mini-main">
        <div class="mini-top">${name}<span class="mini-price">${esc(v.price||'')}</span></div>
        <div class="mini-secondary">${esc(v.day||'')}${v.type?` · ${esc(v.type)}`:''}</div>
        ${(v.strong||[]).length?`<div class="mini-tags">${v.strong.slice(0,3).map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}
      </div>
      ${v.website?`<a class="mini-icon-btn mini-link-btn" href="${esc(v.website)}" target="_blank" rel="noopener noreferrer" aria-label="Sito ufficiale di ${esc(v.name)}" title="Sito ufficiale">🌐</a>`:''}
      ${v.directions?`<a class="mini-icon-btn mini-link-btn" href="${esc(v.directions)}" target="_blank" rel="noopener noreferrer" aria-label="Indicazioni per ${esc(v.name)}" title="Indicazioni">↗</a>`:''}
    </div>`;
  };
  panel('Locali',`<div class="mini-page">${(venues.planned||[]).map(row).join('')}</div>`,'opaque');
}

function attractions(){
  panel('Attrazioni',`<div class="mini-page">${attrs.map(a=>`<div class="mini-row attraction-row">
    <div class="mini-main">
      <div class="mini-top">${a.website?`<a class="mini-name" href="${a.website}" target="_blank" rel="noopener">${esc(a.name)}</a>`:`<div class="mini-name">${esc(a.name)}</div>`}<span class="mini-price">${esc(a.price||'')}</span></div>
      <div class="mini-secondary">${esc(a.day||'')}</div>
      <div class="mini-status-row">${bookingBadgeHTML(a,'page')}${ticketLinksHTML(a,'page')}</div>
    </div>
    ${a.maps?`<a class="mini-icon-btn mini-link-btn" href="${a.maps}" aria-label="Indicazioni per ${esc(a.name)}">↗</a>`:''}
  </div>`).join('')}</div>`,'opaque');
  setTimeout(bindBookingBadges,0);
}

function searchSheet(){
  panel('Cerca',`<div class="search-min">
    <input id="searchInput" type="search" placeholder="Cerca tappa, luogo o giorno…" autocomplete="off">
    <div id="searchResults" class="search-results"></div>
  </div>`);
  const input=$('#searchInput'),results=$('#searchResults');
  const run=()=>{
    const q=input.value.trim().toLowerCase();
    if(!q){results.innerHTML='';return}
    const rows=[];
    trip.days.forEach((d,di)=>d.stops.forEach(s=>{
      const hay=[s.title,s.place,s.timeLabel,d.dateLabel,d.subtitle].join(' ').toLowerCase();
      if(hay.includes(q))rows.push({s,d,di});
    }));
    results.innerHTML=rows.slice(0,20).map(({s,d,di})=>`<button class="mini-row search-row" data-search-day="${di}" data-search-id="${s.id}">
      <div class="mini-main"><div class="mini-name">${esc(s.title)}</div><div class="mini-secondary">${esc(d.dateLabel)} · ${esc(s.start||'')}</div></div><span class="mini-icon-btn">↗</span>
    </button>`).join('')||'<div class="search-empty">Nessun risultato</div>';
    $$('[data-search-id]').forEach(b=>b.onclick=()=>{
      day=Number(b.dataset.searchDay);st.set('day',day);closePanel();render();
      setTimeout(()=>document.getElementById(b.dataset.searchId)?.scrollIntoView({behavior:'smooth',block:'center'}),100);
    });
  };
  input.oninput=run;
  setTimeout(()=>input.focus(),50);
}

/* -------------------- AUDIO MANAGER -------------------- */
function estimateSpeechMs(text,rate=1){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(12000,(words/(155*Math.max(.6,rate)))*60000);
}
function clearProgressTimer(){
  if(mainAudio.progressTimer)clearInterval(mainAudio.progressTimer);
  mainAudio.progressTimer=null;
}
function setAudioProgress(pct){
  const fill=$('#audioProgressFill');
  if(fill)fill.style.width=`${Math.max(0,Math.min(100,pct))}%`;
}
function beginProgress(){
  clearProgressTimer();
  mainAudio.startedAt=Date.now();
  mainAudio.pausedAt=0;
  setAudioProgress(0);
  mainAudio.progressTimer=setInterval(()=>{
    if(!mainAudio.utterance||speechSynthesis.paused)return;
    setAudioProgress(((Date.now()-mainAudio.startedAt)/mainAudio.estimatedMs)*100);
  },250);
}
function resetMainAudioUI(){
  clearProgressTimer();
  if(mainAudio.button){
    mainAudio.button.classList.remove('playing');
    if(mainAudio.button.matches('[data-say]'))mainAudio.button.textContent='▶';
    else if(mainAudio.button.matches('[data-trail-audio]'))mainAudio.button.textContent='▶ Ascolta';
  }
  const root=$('#audio-root');
  if(root)root.innerHTML='';
}
function stopAnyAudio(){
  if('speechSynthesis'in window)speechSynthesis.cancel();
  resetMainAudioUI();
  mainAudio={utterance:null,stop:null,button:null,type:null,progressTimer:null,startedAt:0,pausedAt:0,estimatedMs:0};
}
function speak(text,lang,rate,button,type,title='Audio'){
  stopAnyAudio(); // Frasi interrompono intenzionalmente le audioguide
  if(!('speechSynthesis'in window))return;
  const u=new SpeechSynthesisUtterance(text);
  u.lang=lang;u.rate=rate;
  const voices=speechSynthesis.getVoices();
  u.voice=voices.find(v=>v.lang?.toLowerCase()===lang.toLowerCase())||voices.find(v=>v.lang?.toLowerCase().startsWith(lang.slice(0,2).toLowerCase()))||null;
  mainAudio={utterance:u,button,type,stop:null,progressTimer:null,startedAt:0,pausedAt:0,estimatedMs:estimateSpeechMs(text,rate)};
  if(type!=='phrase')showAudioBar(title,type==='trail'?'Mini-guida':'Audioguida');
  if(button){
    button.classList.add('playing');
    button.textContent=type==='phrase'?'Ⅱ':'Ⅱ Pausa';
  }
  u.onboundary=e=>{
    if(typeof e.charIndex==='number'&&String(text).length)setAudioProgress((e.charIndex/String(text).length)*100);
  };
  const done=()=>{
    if(mainAudio.utterance!==u)return;
    setAudioProgress(100);
    setTimeout(()=>{
      if(mainAudio.utterance===u){
        resetMainAudioUI();
        mainAudio={utterance:null,stop:null,button:null,type:null,progressTimer:null,startedAt:0,pausedAt:0,estimatedMs:0};
      }
    },250);
  };
  u.onend=done;u.onerror=done;
  speechSynthesis.speak(u);
  if(type!=='phrase')beginProgress();
}
function playPhrase(text,btn){speak(text,'fr-FR',.86,btn,'phrase','Frase')}
function playTrailAudio(text,btn){speak(text,'it-IT',.94,btn,'trail','Louvre · mini-guida')}
function startStopAudio(s){if(s?.audioGuide?.text)speak(s.audioGuide.text,'it-IT',.95,null,'guide',s.audioGuide.title||s.title)}

function showAudioBar(title,subtitle){
  $('#audio-root').innerHTML=`<div class="audio-bar" id="audio-bar">
    <div class="audio-copy"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></div>
    <button id="audioPause" type="button" aria-label="Pausa">Ⅱ</button>
    <button id="audioClose" type="button" aria-label="Chiudi audio">×</button>
    <div class="audio-progress"><div class="audio-progress-fill" id="audioProgressFill"></div></div>
  </div>`;
  $('#audioPause').onclick=()=>{
    if(speechSynthesis.paused){
      speechSynthesis.resume();
      if(mainAudio.pausedAt){mainAudio.startedAt+=Date.now()-mainAudio.pausedAt;mainAudio.pausedAt=0}
      $('#audioPause').textContent='Ⅱ';
    }else{
      speechSynthesis.pause();mainAudio.pausedAt=Date.now();$('#audioPause').textContent='▶';
    }
  };
  $('#audioClose').onclick=stopAnyAudio;
}
function audioPlayer(){return '<div id="audio-root"></div>'}

function louvreTrailSheet(s){
  const t=s?.louvreTrail;if(!t)return;
  panel('Louvre · percorso 3H',`<div class="trail-intro"><strong>${esc(t.subtitle||'Percorso essenziale')}</strong><span>${esc(t.note||'')}</span></div>
    <div class="trail-list">${t.stops.map((x,i)=>`<div class="trail-step">
      <div class="trail-index">${esc(x.n)}</div>
      <div class="trail-content">
        <div class="trail-top"><strong>${esc(x.title)}</strong><span>${esc(x.time)}</span></div>
        <div class="trail-where">${esc(x.where)}</div>
        <p>${esc(x.text)}</p>
        <div class="trail-audio-row"><button class="trail-audio" data-trail-audio="${i}" type="button">▶ Ascolta</button><button class="trail-stop" data-trail-stop type="button" aria-label="Interrompi audio">×</button></div>
      </div>
    </div>`).join('')}</div>`);
  setTimeout(()=>{
    $$('[data-trail-audio]').forEach(b=>b.onclick=()=>playTrailAudio(t.stops[Number(b.dataset.trailAudio)].audio,b));
    $$('[data-trail-stop]').forEach(b=>b.onclick=stopAnyAudio);
  },0);
}

/* -------------------- WEATHER -------------------- */
async function weather(){
  const card=$('#weather');
  if(!card)return;
  try{
    const url='https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522&current=temperature_2m,apparent_temperature,weather_code&timezone=Europe%2FParis';
    const d=await fetch(url,{cache:'no-store'}).then(r=>r.json());
    const c=d.current;if(!c)throw new Error();
    let symbol='◌',label='variabile',code=Number(c.weather_code);
    if(code===0){symbol='☀︎';label='sereno'}
    else if(code===1){symbol='◑';label='poco nuvoloso'}
    else if(code===2){symbol='☁︎';label='nuvoloso'}
    else if(code===3){symbol='☁︎';label='coperto'}
    else if(code===45||code===48){symbol='≋';label='nebbia'}
    else if((code>=51&&code<=67)||(code>=80&&code<=82)){symbol='☂︎';label='pioggia'}
    else if((code>=71&&code<=77)||(code>=85&&code<=86)){symbol='❄︎';label='neve'}
    else if(code>=95){symbol='ϟ';label='temporale'}
    card.innerHTML=`<span class="weather-symbol">${symbol}</span><span>${Math.round(c.temperature_2m)}° · ${label} · percepiti ${Math.round(c.apparent_temperature)}°</span>`;
  }catch{
    card.innerHTML='<span class="weather-symbol">◌</span><span>meteo n/d</span>';
  }
}

boot();
