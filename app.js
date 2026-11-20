'use strict';
{
/* ================= utilità ================= */
const pad=n=>String(n).padStart(2,'0');
const grp=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
const eur=c=>{c=Math.round(c||0);const neg=c<0;c=Math.abs(c);return (neg?'−':'')+grp(Math.floor(c/100))+','+pad(c%100)+' €'};
const eur0=c=>{c=Math.round((c||0)/100);return (c<0?'−':'')+grp(Math.abs(c))+' €'};
const todayStr=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const curYm=()=>todayStr().slice(0,7);
const addM=(ym,n)=>{let [y,m]=ym.split('-').map(Number);m+=n;while(m>12){m-=12;y++}while(m<1){m+=12;y--}return y+'-'+pad(m)};
const dim=ym=>{const [y,m]=ym.split('-').map(Number);return new Date(y,m,0).getDate()};
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const mLabel=(ym,short)=>{const [y,m]=ym.split('-').map(Number);return cap(new Date(y,m-1,1).toLocaleDateString('it-IT',short?{month:'short'}:{month:'long',year:'numeric'}))};
const dLabel=d=>{const t=todayStr();if(d===t)return 'Oggi';const y=new Date();y.setDate(y.getDate()-1);const ys=y.getFullYear()+'-'+pad(y.getMonth()+1)+'-'+pad(y.getDate());if(d===ys)return 'Ieri';const [a,b,c]=d.split('-').map(Number);return cap(new Date(a,b-1,c).toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'short'}))};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const clone=o=>JSON.parse(JSON.stringify(o));
const parseEur=s=>{s=String(s??'').trim().replace(/[\s€]/g,'');if(!s)return 0;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');const n=Number(s);return isFinite(n)&&n>=0?Math.round(n*100):NaN};
const toIn=c=>c?(c/100).toFixed(2).replace('.',','):'';
const pct=(a,b)=>b?Math.round(a/b*100):0;
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const COLORS=['#8a9a78','#c27a55','#d4a35a','#6f8f8a','#a9798f','#5f7f9a','#b9895f','#7d7a5c','#c9a3a0','#59606b','#9a6b4f','#4f6b4a'];
const NEEDS=['spesa','casa','trasporti','salute','abbonamenti'];
const GIRO='__giro';
const KINDS={conto:'Conto corrente',contanti:'Contanti',carta:'Carta di debito/prepagata',credito:'Carta di credito',risparmio:'Conto risparmio',altro:'Altro'};
const kindOf=a=>a.kind||({contanti:'contanti',carta:'carta',conto:'conto'}[a.id])||'altro';
const parseSigned=x=>{x=String(x??'').trim();const neg=/^[-−]/.test(x);const v=parseEur(x.replace(/^[-−]\s*/,''));return isNaN(v)?NaN:(neg?-v:v)};
const eurS=c=>(c>0?'+':'')+eur(c);
const DEF={v:2,emergency:0,
  accounts:[{id:'carta',name:'Carta'},{id:'contanti',name:'Contanti'},{id:'conto',name:'Conto'}],
  cats:[['spesa','Spesa alimentare'],['casa','Casa e bollette'],['trasporti','Trasporti'],['ristoranti','Ristoranti e bar'],['shopping','Shopping'],['salute','Salute'],['svago','Svago'],['abbonamenti','Abbonamenti'],['regali','Regali'],['altro','Altro']].map(([id,name],i)=>({id,name,type:'exp',budget:0,color:COLORS[i],need:NEEDS.includes(id)}))
   .concat([['stipendio','Stipendio'],['extra','Entrate extra'],['rimborsi','Rimborsi']].map(([id,name],i)=>({id,name,type:'inc',budget:0,color:COLORS[(i+3)%12]}))),
  recurring:[],goals:[]};

/* ================= stato ================= */
const CFG=window.BUDGET_CONFIG||{};
const sb=window.supabase&&CFG.url?window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
const S={phase:'boot',view:'oggi',ym:curYm(),uid:null,settings:null,tx:new Map(),byM:{},loadedFrom:null,q:'',fcat:'',auth:{mode:'login',msg:'',err:''},enroll:null};
const main=document.getElementById('main'),ov=document.getElementById('ov'),sheet=document.getElementById('sheet');

/* ================= dati ================= */
const cats=t=>(S.settings?.cats||[]).filter(c=>!t||c.type===t);
const catById=id=>id===GIRO?{id:GIRO,name:'Giroconto',color:'#8b8f84',type:'giro',budget:0}:(S.settings?.cats||[]).find(c=>c.id===id)||{name:'Senza categoria',color:'#999',type:'exp',budget:0};
const accById=id=>(S.settings?.accounts||[]).find(a=>a.id===id);
const isGiro=t=>t.cat===GIRO;
const gidOf=t=>isGiro(t)&&/^g-.+-[oi]$/.test(t.id)?t.id.slice(2,-2):null;
function giroPair(t){const g=gidOf(t);if(!g)return [t];return [S.tx.get('g-'+g+'-o'),S.tx.get('g-'+g+'-i')].filter(Boolean)}
const shown=t=>!(isGiro(t)&&gidOf(t)&&t.id.endsWith('-i'));
/* saldo = saldo allineato + movimenti registrati dopo l'allineamento */
function balanceOf(a){if(!a||!a.since)return null;let b=a.initial||0;
  for(const t of S.tx.values()){if(t.acc!==a.id)continue;if(t.date<a.since)continue;if(t.date===a.since&&(t.ts||0)<=(a.sinceTs||0))continue;b+=t.type==='inc'?t.amount:-t.amount}return b}
function balances(){const list=(S.settings?.accounts||[]).map(a=>({a,b:balanceOf(a)}));const known=list.filter(x=>x.b!==null&&x.a.incl!==false);
  return {list,total:known.reduce((s,x)=>s+x.b,0),any:known.length>0,liquid:known.filter(x=>kindOf(x.a)!=='credito').reduce((s,x)=>s+x.b,0)}}
function monthForecast(total){const ym=curYm(),D=dim(ym),day=Number(todayStr().slice(8)),st=stats(ym),tb=totBudget();
  const pend=(S.settings.recurring||[]).filter(r=>(r.start||'0000-00')<=ym&&Math.min(r.day,D)>day);
  const recInc=pend.filter(r=>r.type==='inc').reduce((s,r)=>s+r.amount,0),recExp=pend.filter(r=>r.type!=='inc').reduce((s,r)=>s+r.amount,0);
  const varSp=st.exp-st.recExp,varLeft=day>=3?Math.round(varSp/day*(D-day)):0;
  const out=tb?Math.max(Math.max(0,tb-st.exp),recExp):recExp+varLeft;return {value:total+recInc-out,recInc,out}}
const accName=id=>(S.settings?.accounts||[]).find(a=>a.id===id)?.name||'—';
const totBudget=()=>cats('exp').reduce((s,c)=>s+(c.budget||0),0);
function reindex(){const m={};for(const t of S.tx.values()){const k=t.date.slice(0,7);(m[k]=m[k]||[]).push(t)}S.byM=m}
function stats(ym){const tx=S.byM[ym]||[];let inc=0,exp=0,avoid=0,need=0,want=0,recExp=0;const byCat={},byAcc={};
  for(const t of tx){if(isGiro(t))continue;if(t.type==='inc'){inc+=t.amount;continue}
    exp+=t.amount;byCat[t.cat]=(byCat[t.cat]||0)+t.amount;byAcc[t.acc]=(byAcc[t.acc]||0)+t.amount;
    if(t.avoid)avoid+=t.amount;if(t.rec)recExp+=t.amount;if(catById(t.cat).need)need+=t.amount;else want+=t.amount}
  return {ym,tx,inc,exp,avoid,need,want,recExp,byCat,byAcc}}
function completeMonths(n){const out=[];const first=S.firstYm||curYm();for(let i=1;i<=12&&out.length<n;i++){const ym=addM(curYm(),-i);if(ym<first)break;const st=stats(ym);if(st.tx.length)out.push(st)}return out}
const avg=(arr,f)=>arr.length?Math.round(arr.reduce((s,x)=>s+f(x),0)/arr.length):null;
const monthsTo=dl=>{if(!dl)return null;const [a,b]=curYm().split('-').map(Number),[c,d]=dl.split('-').map(Number);return Math.max(1,(c-a)*12+(d-b)+1)};
const goalQuota=g=>{const n=monthsTo(g.deadline);const left=Math.max(0,g.target-g.saved);return n?Math.ceil(left/n):0};
const fromRow=r=>({id:r.id,date:r.date,amount:Number(r.amount_cents),type:r.type,cat:r.cat,acc:r.acc,note:r.note||'',avoid:!!r.avoid,rec:r.rec||null,ts:Date.parse(r.created_at)||0});
const toRow=t=>({user_id:S.uid,id:t.id,date:t.date,amount_cents:t.amount,type:t.type,cat:t.cat,acc:t.acc,note:t.note||'',avoid:!!t.avoid,rec:t.rec||null});

function dbFail(error,what){console.warn(what,error);
  if(error&&(error.code==='42501'||error.code==='PGRST301'||/JWT|aal|permission/i.test(error.message||''))){toast('Sessione scaduta: accedi di nuovo');route();return}
  toast('Non salvato ('+what+'). Controlla la connessione e riprova.')}

async function fetchRange(fromDate,toDate){let all=[],from=0;
  for(;;){let q=sb.from('transactions').select('*').eq('user_id',S.uid).gte('date',fromDate).order('date',{ascending:false}).order('id',{ascending:true}).range(from,from+999);
    if(toDate)q=q.lt('date',toDate);const {data,error}=await q;if(error)throw error;all=all.concat(data);if(data.length<1000)break;from+=1000}
  return all.map(fromRow)}
async function loadAll(){
  const {data:st,error:e1}=await sb.from('settings').select('data').eq('user_id',S.uid).maybeSingle();if(e1)throw e1;
  if(!st){S.settings=clone(DEF);const {error}=await sb.from('settings').upsert({user_id:S.uid,data:S.settings},{onConflict:'user_id',ignoreDuplicates:true});if(error)throw error;const {data:again}=await sb.from('settings').select('data').eq('user_id',S.uid).maybeSingle();if(again)S.settings=normSettings(again.data)}
  else S.settings=normSettings(st.data);
  let from=addM(curYm(),-12);for(const a of S.settings.accounts)if(a.since&&a.since.slice(0,7)<from)from=a.since.slice(0,7);const rows=await fetchRange(from+'-01');
  S.tx=new Map(rows.map(t=>[t.id,t]));S.loadedFrom=from;reindex();
  const {data:first}=await sb.from('transactions').select('date').eq('user_id',S.uid).order('date',{ascending:true}).limit(1);
  S.firstYm=first&&first[0]?first[0].date.slice(0,7):curYm();
  await runRecurring()}
async function ensureMonth(ym){if(!S.loadedFrom||ym>=S.loadedFrom)return;
  const from=addM(ym,-5);try{const rows=await fetchRange(from+'-01',S.loadedFrom+'-01');for(const t of rows)S.tx.set(t.id,t);S.loadedFrom=from;reindex();draw()}catch(e){dbFail(e,'caricamento')}}
function normSettings(d){d=d||{};const s={...clone(DEF),...d};s.accounts=d.accounts||clone(DEF.accounts);s.cats=(d.cats||clone(DEF.cats)).map(c=>c.type==='exp'&&c.need===undefined?{...c,need:NEEDS.includes(c.id)}:c);s.recurring=d.recurring||[];s.goals=d.goals||[];s.emergency=d.emergency||0;return s}

let sq=Promise.resolve();
function mutateSettings(fn){if(!S.settings)return;const before=clone(S.settings);fn(S.settings);draw();
  const body=clone(S.settings);sq=sq.then(async()=>{const {error}=await sb.from('settings').upsert({user_id:S.uid,data:body,updated_at:new Date().toISOString()});if(error){S.settings=before;draw();dbFail(error,'impostazioni')}});return sq}
async function upsertTx(t,prev){S.tx.set(t.id,t);reindex();draw();
  const {error}=await sb.from('transactions').upsert(toRow(t));if(error){if(prev)S.tx.set(prev.id,prev);else S.tx.delete(t.id);reindex();draw();dbFail(error,'movimento');return false}return true}
async function deleteTx(t){S.tx.delete(t.id);reindex();draw();
  const {error}=await sb.from('transactions').delete().eq('user_id',S.uid).eq('id',t.id);if(error){S.tx.set(t.id,t);reindex();draw();dbFail(error,'eliminazione');return false}return true}

async function runRecurring(){const cur=curYm(),today=Number(todayStr().slice(8));let n=0;
  // controlla il mese corrente e i 2 precedenti: se l'app non viene aperta per settimane, nessuna voce va persa
  for(let back=2;back>=0;back--){const ym=addM(cur,-back),D=dim(ym);
    const due=(S.settings.recurring||[]).filter(r=>(r.start||'0000-00')<=ym&&(back>0||Math.min(r.day,D)<=today));if(!due.length)continue;
    const {data:runs,error}=await sb.from('recurring_runs').select('rec_id').eq('user_id',S.uid).eq('ym',ym);if(error){console.warn(error);return}
    const done=new Set((runs||[]).map(r=>r.rec_id));
    for(const r of due){if(done.has(r.id))continue;
      const {error:e}=await sb.from('recurring_runs').insert({user_id:S.uid,rec_id:r.id,ym});
      if(e){if(e.code!=='23505')console.warn(e);continue}
      const t={id:'r-'+r.id+'-'+ym,date:ym+'-'+pad(Math.min(r.day,D)),amount:r.amount,type:r.type,cat:r.cat,acc:r.acc,note:r.desc,avoid:false,rec:r.id,ts:Date.now()};
      const {error:e2}=await sb.from('transactions').upsert(toRow(t));
      if(e2){await sb.from('recurring_runs').delete().eq('user_id',S.uid).eq('rec_id',r.id).eq('ym',ym);console.warn(e2)}else{S.tx.set(t.id,t);n++}}}
  if(n){reindex();draw();toast(n===1?'Registrata 1 voce ricorrente':'Registrate '+n+' voci ricorrenti')}}

/* ================= accesso e 2FA ================= */
async function route(){
  if(!sb){S.phase='error';S.auth.err='Libreria di accesso non caricata. Ricarica la pagina.';draw();return}
  const {data:{session}}=await sb.auth.getSession();
  if(!session){S.phase='login';S.uid=null;draw();return}
  S.uid=session.user.id;S.email=session.user.email;
  const {data:aal,error}=await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if(error){S.phase='login';draw();return}
  if(aal.currentLevel==='aal2'&&S.recovery){S.phase='recovery';draw();return}
  if(aal.currentLevel==='aal2'){if(S.phase!=='app'){S.phase='loading';draw();try{await loadAll();S.phase='app'}catch(e){console.warn(e);S.phase='login';S.auth.err='Impossibile caricare i dati: '+(e.message||'errore');await sb.auth.signOut()}}draw();return}
  if(aal.nextLevel==='aal2'){S.phase='mfa';draw();setTimeout(()=>document.getElementById('code')?.focus(),60);return}
  S.phase='enroll';draw();startEnroll()}
async function startEnroll(){S.enroll=null;draw();
  const {data:f}=await sb.auth.mfa.listFactors();
  for(const x of (f?.all||[]))if(x.status!=='verified')await sb.auth.mfa.unenroll({factorId:x.id});
  const {data,error}=await sb.auth.mfa.enroll({factorType:'totp',friendlyName:'Telefono '+todayStr()+' '+nid().slice(-4)});
  if(error){S.auth.err=error.message;draw();return}
  S.enroll={id:data.id,qr:data.totp.qr_code,secret:data.totp.secret,uri:data.totp.uri};draw()}
const brand=`<div class="brand"><img src="icon.svg" alt=""><b>Budget</b></div>`;
function authView(){const a=S.auth;
  if(S.phase==='boot'||S.phase==='loading')return `<div class="auth">${brand}<p>${S.phase==='loading'?'Carico i tuoi dati…':'Avvio…'}</p></div>`;
  if(S.phase==='error')return `<div class="auth">${brand}<h1>Qualcosa non va</h1><p>${esc(a.err)}</p></div>`;
  if(S.phase==='recovery')return `<div class="auth">${brand}<h1>Nuova password</h1><p>Scegli una password di almeno 12 caratteri.</p>
    <form id="fRecover"><label class="field">Nuova password<input id="pw" type="password" autocomplete="new-password" minlength="12" required></label><p class="err">${esc(a.err)}</p><button class="btn pri full">Salva password</button></form></div>`;
  if(S.phase==='mfa')return `<div class="auth">${brand}<h1>Codice di verifica</h1><p>Apri l'app di autenticazione e inserisci il codice a 6 cifre di "Budget".</p>
    <form id="fMfa"><input id="code" class="field code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-label="Codice a 6 cifre" style="border-radius:14px;border:1px solid var(--line);background:var(--soft);color:var(--ink);width:100%">
    <p class="err">${esc(a.err)}</p><button class="btn pri full">Verifica</button></form><button class="lnk" data-auth="logout">Esci e usa un altro account</button></div>`;
  if(S.phase==='enroll'){const e=S.enroll;return `<div class="auth">${brand}<h1>Attiva il secondo fattore</h1>
    <ol class="steps"><li>Installa un'app di autenticazione (Google Authenticator, Microsoft Authenticator, 1Password…).</li><li>Aggiungi un account scansionando il codice QR, oppure copia la chiave.</li><li>Inserisci qui il codice a 6 cifre che compare.</li></ol>
    ${e?`<img class="qr" src="${esc(e.qr)}" alt="Codice QR per l'app di autenticazione"><p class="note" style="margin:12px 0 6px">Chiave manuale:</p><div class="secret">${esc(e.secret)}</div>
    <div class="btns" style="margin:10px 0 16px"><button class="btn sm" data-auth="copysecret">Copia chiave</button><a class="btn sm" href="${esc(e.uri)}" style="text-decoration:none;display:inline-flex;align-items:center">Apri nell'app</a></div>
    <form id="fEnroll"><input id="code" class="field code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-label="Codice a 6 cifre" style="border-radius:14px;border:1px solid var(--line);background:var(--soft);color:var(--ink);width:100%"><p class="err">${esc(a.err)}</p><button class="btn pri full">Attiva e accedi</button></form>`:'<p>Preparo il codice…</p>'}
    <button class="lnk" data-auth="logout">Esci</button></div>`}
  const reg=a.mode==='signup',fg=a.mode==='forgot';
  return `<div class="auth">${brand}<h1>${reg?'Crea il tuo account':fg?'Recupera la password':'Bentornato'}</h1>
   <p>${reg?'Un solo account: dopo la creazione le registrazioni si chiudono. Servirà anche un codice dal telefono.':fg?'Ti mandiamo un link per scegliere una nuova password.':'Accedi con email, password e codice dal telefono.'}</p>
   <form id="fLogin"><label class="field">Email<input id="em" type="email" autocomplete="username" required value="${esc(a.email||'')}"></label>
   ${fg?'':`<label class="field">Password<input id="pw" type="password" autocomplete="${reg?'new-password':'current-password'}" ${reg?'minlength="12"':''} required></label>`}
   ${a.msg?`<p class="note" style="color:var(--good)">${esc(a.msg)}</p>`:''}<p class="err">${esc(a.err)}</p>
   <button class="btn pri full">${reg?'Crea account':fg?'Invia il link':'Accedi'}</button></form>
   ${a.mode==='login'?'<button class="lnk" data-auth="forgot">Password dimenticata?</button><button class="lnk" data-auth="signup">Primo accesso? Crea l\'account</button>':'<button class="lnk" data-auth="login">Torna all\'accesso</button>'}</div>`}
const redirect=()=>location.origin+location.pathname;
async function onAuthSubmit(id){const a=S.auth;a.err='';a.msg='';const btn=main.querySelector('form button');if(btn)btn.disabled=true;
  try{
  if(id==='fLogin'){const email=document.getElementById('em').value.trim();a.email=email;
    if(a.mode==='forgot'){const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:redirect()});if(error)throw error;a.msg='Se l\'email è corretta, riceverai un link a breve.'}
    else if(a.mode==='signup'){const pw=document.getElementById('pw').value;if(pw.length<12)throw new Error('La password deve avere almeno 12 caratteri.');
      const {data,error}=await sb.auth.signUp({email,password:pw,options:{emailRedirectTo:redirect()}});if(error)throw error;
      if(data.session){await route();return}a.mode='login';a.msg='Ti ho inviato una email di conferma: aprila, poi torna qui e accedi.'}
    else{const pw=document.getElementById('pw').value;const {error}=await sb.auth.signInWithPassword({email,password:pw});if(error)throw error;touch();await route();return}}
  else if(id==='fMfa'||id==='fEnroll'){const code=document.getElementById('code').value.replace(/\D/g,'');
    let factorId;if(id==='fEnroll')factorId=S.enroll.id;else{const {data}=await sb.auth.mfa.listFactors();factorId=(data.totp||[]).find(f=>f.status==='verified')?.id}
    if(!factorId)throw new Error('Nessun dispositivo configurato.');
    const {error}=await sb.auth.mfa.challengeAndVerify({factorId,code});if(error)throw error;S.enroll=null;await route();return}
  else if(id==='fRecover'){const pw=document.getElementById('pw').value;if(pw.length<12)throw new Error('Almeno 12 caratteri.');const {error}=await sb.auth.updateUser({password:pw});if(error)throw error;S.recovery=false;toast('Password aggiornata');S.phase='boot';await route();return}
  }catch(e){a.err=authErr(e)}
  draw()}
function authErr(e){const m=(e&&e.message)||'';
  if(/Invalid login/i.test(m))return 'Email o password non corretti.';
  if(/Email not confirmed/i.test(m))return 'Conferma prima l\'email dal link che ti è arrivato.';
  if(/Registrazioni chiuse|Database error saving new user/i.test(m))return 'Registrazioni chiuse: esiste già un account.';
  if(/Invalid TOTP|invalid.*code|expired/i.test(m))return 'Codice non valido o scaduto: riprova con quello nuovo.';
  if(/rate limit|too many/i.test(m))return 'Troppi tentativi: attendi qualche minuto.';
  return m||'Errore imprevisto.'}

/* ================= viste ================= */
function draw(){
  const app=S.phase==='app';
  document.getElementById('nav').hidden=!app;document.getElementById('fab').hidden=!app;
  if(!app){main.innerHTML=authView();return}
  const a=document.activeElement;if(a&&main.contains(a)&&/INPUT|SELECT/.test(a.tagName)){if(!a.dataset.wait){a.dataset.wait='1';a.addEventListener('blur',()=>{delete a.dataset.wait;draw()},{once:true})}return}
  main.innerHTML=V[S.view]();
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.go===S.view));
}
const monthNav=k=>`<header class="top"><button class="ib" data-act="prev" aria-label="Mese precedente">‹</button><h1><span class="kick">${k}</span>${mLabel(S.ym)}</h1><button class="ib" data-act="next" aria-label="Mese successivo" ${S.ym>=curYm()?'disabled':''}>›</button></header>`;
const initials=s=>esc((s||'?').trim().slice(0,2));
function txRow(t,signed){const c=catById(t.cat);const inc=t.type==='inc';
  if(isGiro(t)){const p=giroPair(t),o=p.find(x=>x.type==='exp'),i=p.find(x=>x.type==='inc');
    const route=o&&i?esc(accName(o.acc))+' → '+esc(accName(i.acc)):(inc?'verso ':'da ')+esc(accName(t.acc));
    return `<button class="tx" data-act="edit" data-id="${esc(t.id)}"><span class="ic" style="background:${c.color}">⇄</span>
    <span><span class="t1">${esc(t.note||'Giroconto')}</span><span class="t2">${route}</span></span>
    <span class="am num">${signed?(inc?'+':'−'):'⇄ '}${eur(t.amount)}</span></button>`}
  return `<button class="tx" data-act="edit" data-id="${esc(t.id)}"><span class="ic" style="background:${c.color}">${initials(c.name)}</span>
  <span><span class="t1">${esc(t.note||c.name)}</span><span class="t2">${esc(t.note?c.name+' · ':'')}${esc(accName(t.acc))}${t.rec?'<span class="tag">ricorrente</span>':''}${t.avoid?'<span class="tag">evitabile</span>':''}</span></span>
  <span class="am num ${inc?'inc':''}">${inc?'+':'−'}${eur(t.amount)}</span></button>`}
function balancesPanel(){const B=balances();const isCur=S.ym===curYm();
  if(!B.list.some(x=>x.b!==null))return `<section class="panel"><h2>Saldi dei conti</h2><p style="margin:0 0 12px;font-size:15px">Inserisci il saldo reale di ogni conto: da lì l'app lo aggiorna a ogni spesa, entrata o giroconto.</p><div class="btns">${B.list.map(({a})=>`<button class="btn sm" data-act="form" data-k="acc" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join('')}</div></section>`;
  const fc=isCur?monthForecast(B.total):null;
  return `<section class="panel"><h2>Saldi dei conti <small>oggi</small></h2>
   <p style="margin:0;font:600 30px/1.1 Fraunces,Georgia,serif;${B.total<0?'color:var(--bad)':''}" class="num">${eur(B.total)}</p>
   <p class="note" style="margin:2px 0 10px">Totale dei conti inclusi${fc?` · previsione a fine mese <b class="num" style="${fc.value<0?'color:var(--bad)':'color:var(--ink)'}">${eur(fc.value)}</b>`:''}</p>
   ${B.list.map(({a,b})=>`<button class="tx" data-act="acct" data-id="${esc(a.id)}"><span class="ic" style="background:var(--olive)">${initials(a.name)}</span><span><span class="t1">${esc(a.name)}</span><span class="t2">${esc(KINDS[kindOf(a)])}${a.incl===false?' · escluso dal totale':''}</span></span><span class="am num" style="${b!==null&&b<0&&kindOf(a)!=='credito'?'color:var(--bad)':''}">${b===null?'<span class="tag">imposta saldo</span>':eur(b)}</span></button>`).join('')}
   ${fc?'<p class="note">La previsione considera le voci ricorrenti ancora da registrare e il budget rimasto del mese.</p>':''}</section>`}
function barCls(sp,b){const p=b?sp/b:0;return b&&p>=1?'over':b&&p>=.8?'warn':''}
function donut(st){const parts=cats('exp').map(c=>({c,v:st.byCat[c.id]||0})).filter(x=>x.v).sort((a,b)=>b.v-a.v);
  if(!parts.length)return '<p class="empty">Nessuna uscita in questo mese.</p>';
  const R=60,C=2*Math.PI*R;let off=0;const segs=parts.map(({c,v})=>{const L=v/st.exp*C;const s=`<circle r="${R}" cx="75" cy="75" fill="none" stroke="${c.color}" stroke-width="20" stroke-dasharray="${Math.max(0,L-2).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;off+=L;return s}).join('');
  const top=parts.slice(0,6),rest=parts.slice(6).reduce((s,x)=>s+x.v,0);
  return `<div class="donutwrap"><div class="donut"><svg viewBox="0 0 150 150"><circle r="${R}" cx="75" cy="75" fill="none" stroke="var(--soft)" stroke-width="20"/>${segs}</svg><div class="c"><b class="num">${eur0(st.exp)}</b><span>uscite</span></div></div>
   <div class="leg">${top.map(({c,v})=>`<div><span class="dot" style="background:${c.color}"></span><span>${esc(c.name)}</span><em class="num">${pct(v,st.exp)}%</em></div>`).join('')}${rest?`<div><span class="dot" style="background:var(--muted)"></span><span>Altre</span><em class="num">${pct(rest,st.exp)}%</em></div>`:''}</div></div>`}

const V={
oggi(){const st=stats(S.ym),isCur=S.ym===curYm(),tb=totBudget(),D=dim(S.ym),day=isCur?Number(todayStr().slice(8)):D;
  const left=tb-st.exp,daysLeft=D-day+1;let hero;
  if(!tb)hero=`<section class="hero"><p class="lbl">Speso questo mese</p><p class="big num">${eur(st.exp)}</p><p class="sub">Dai un tetto alle categorie per sapere ogni giorno quanto puoi ancora spendere.</p><button class="cta" data-go="budget">Imposta i tetti</button></section>`;
  else{const rc=Math.min(st.recExp,tb),per=isCur?Math.max(0,left)/daysLeft:0,exp=rc+(tb-rc)*day/D,diff=exp-st.exp,p=st.exp/tb*100;
    const sub=isCur?(left<0?`Hai superato il budget del mese di ${eur(-left)}.`:`Restano ${eur(left)} per ${daysLeft} ${daysLeft===1?'giorno':'giorni'}. ${diff>=0?`Sei ${eur(diff)} sotto il ritmo previsto.`:`Sei ${eur(-diff)} sopra il ritmo previsto.`}`):(left<0?'Budget superato a fine mese.':'Avanzato a fine mese.');
    hero=`<section class="hero"><p class="lbl">${isCur?'Puoi spendere oggi':(left<0?'Sforamento':'Budget non speso')}</p><p class="big num">${isCur?eur(Math.floor(per)):eur(left)}</p><p class="sub">${sub}</p>
    <div class="meter" role="img" aria-label="Speso ${p.toFixed(0)}% del tetto"><div class="fill ${p>100?'over':''}" style="width:${Math.min(100,p).toFixed(1)}%"></div>${isCur?`<div class="pace" style="left:${Math.min(100,exp/tb*100).toFixed(1)}%"></div>`:''}</div>
    <div class="meterlbl"><span class="num">Speso ${eur(st.exp)}</span><span class="num">Tetto ${eur(tb)}</span></div></section>`}
  const saved=st.inc-st.exp,rate=st.inc?pct(saved,st.inc):null;
  const alerts=cats('exp').filter(c=>c.budget&&(st.byCat[c.id]||0)>=c.budget*.8).map(c=>{const sp=st.byCat[c.id]||0,o=sp>=c.budget;
    return `<div class="alert ${o?'red':''}"><span><b>${esc(c.name)}</b>: ${o?`tetto superato di <span class="num">${eur(sp-c.budget)}</span>.`:`usato il ${pct(sp,c.budget)}% del tetto, restano <span class="num">${eur(c.budget-sp)}</span>.`}</span></div>`}).join('');
  const recent=[...st.tx].filter(shown).sort((a,b)=>b.date.localeCompare(a.date)||b.ts-a.ts).slice(0,5);
  const rows=cats('exp').map(c=>({c,sp:st.byCat[c.id]||0})).filter(x=>x.c.budget).sort((a,b)=>b.sp/b.c.budget-a.sp/a.c.budget).map(({c,sp})=>`<div class="row"><div class="nm"><span class="dot" style="background:${c.color}"></span><span>${esc(c.name)}</span></div><div class="vl num">${eur(sp)} <small>/ ${eur(c.budget)}</small></div><div class="bar"><div class="${barCls(sp,c.budget)}" style="width:${Math.min(100,sp/c.budget*100).toFixed(1)}%"></div></div></div>`).join('');
  return monthNav('Panoramica')+hero+`<section class="kpis"><div class="kpi" style="--c:var(--good)"><span>Entrate</span><b class="num">${eur0(st.inc)}</b></div><div class="kpi" style="--c:var(--clay)"><span>Uscite</span><b class="num">${eur0(st.exp)}</b></div><div class="kpi" style="--c:var(--sage)"><span>Risparmio</span><b class="num" style="${saved<0?'color:var(--bad)':''}">${eur0(saved)}</b><i>${rate===null?'—':rate+'% entrate'}</i></div></section>`
   +alerts+balancesPanel()+`<section class="panel"><h2>Dove vanno i soldi</h2>${donut(st)}</section>`
   +(rows?`<section class="panel"><h2>Tetti <small>speso / tetto</small></h2>${rows}</section>`:'')
   +`<section class="panel"><h2>Ultimi movimenti <button class="btn sm" data-go="movimenti">Tutti</button></h2>${recent.length?recent.map(txRow).join(''):'<p class="empty">Ancora nulla. Tocca + per registrare la prima spesa.</p>'}</section>`},

movimenti(){return monthNav('Movimenti')+`<div class="search"><input id="q" type="search" placeholder="Cerca nota, categoria, conto" value="${esc(S.q)}" autocomplete="off"><select id="fcat" aria-label="Filtro"><option value="">Tutto</option><optgroup label="Conti">${S.settings.accounts.map(a=>`<option value="a:${a.id}" ${S.fcat==='a:'+a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</optgroup><optgroup label="Categorie">${cats().map(c=>`<option value="c:${c.id}" ${S.fcat==='c:'+c.id?'selected':''}>${esc(c.name)}</option>`).join('')}<option value="c:${GIRO}" ${S.fcat==='c:'+GIRO?'selected':''}>Giroconti</option></optgroup></select></div><div id="list">${listHtml()}</div>`},

budget(){const st=stats(S.ym),tb=totBudget(),cm=completeMonths(3);const recInc=S.settings.recurring.filter(r=>r.type==='inc').reduce((s,r)=>s+r.amount,0);
  const curInc=stats(curYm()).inc,ai=avg(cm,x=>x.inc)||0,incP=recInc||curInc||ai,src=recInc?'ricorrenti':curInc?'incassate questo mese':'media 3 mesi';
  const gq=S.settings.goals.reduce((s,g)=>s+goalQuota(g),0),free=incP-tb-gq;
  const rows=cats('exp').map(c=>{const sp=st.byCat[c.id]||0,b=c.budget||0,a=cm.length?avg(cm,x=>x.byCat[c.id]||0):null;
    return `<div class="row"><div class="nm"><span class="dot" style="background:${c.color}"></span><span>${esc(c.name)}</span></div>
    <input class="binput num" inputmode="decimal" data-bud="${c.id}" value="${toIn(b)}" placeholder="0,00" aria-label="Tetto ${esc(c.name)}">
    <div style="grid-column:1/-1;font-size:13px;color:var(--muted);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span class="num">Speso ${eur(sp)}${b?` · ${pct(sp,b)}%`:''} · ${c.need?'essenziale':'discrezionale'}</span>${a?`<button class="btn sm" style="min-height:30px;padding:2px 10px" data-act="useavg" data-cat="${c.id}" data-v="${a}">Media ${eur0(a)}</button>`:''}</div>
    ${b?`<div class="bar"><div class="${barCls(sp,b)}" style="width:${Math.min(100,sp/b*100).toFixed(1)}%"></div></div>`:''}</div>`}).join('');
  return monthNav('Budget')+`<section class="panel"><h2>Il piano del mese</h2><table class="sumtable"><tr><td>Entrate previste <small style="color:var(--muted)">(${src})</small></td><td class="num">${eur(incP)}</td></tr>
    <tr><td>Tetti di spesa</td><td class="num">−${eur(tb)}</td></tr><tr><td>Quote obiettivi</td><td class="num">−${eur(gq)}</td></tr>
    <tr class="tot"><td>Non assegnato</td><td class="num" style="${free<0?'color:var(--bad)':''}">${eur(free)}</td></tr></table>
    <p class="note">${free<0?'Stai pianificando più di quanto entra: abbassa qualche tetto o allunga un obiettivo.':incP?'Ogni euro non assegnato tende a sparire: destinalo a un obiettivo o al fondo emergenza.':'Aggiungi lo stipendio tra le voci ricorrenti per avere le entrate previste.'}</p></section>
    <section class="panel"><h2>Tetti per categoria <small>al mese</small></h2>${rows}<p class="note">Lascia vuoto per nessun tetto. Essenziale/discrezionale si cambia in Risparmio → Categorie.</p></section>`},

consulente(){return monthNav('Consulente')+advisorView()},

altro(){const s=S.settings,g=s.goals,r=s.recurring,recExp=r.filter(x=>x.type!=='inc'),annual=recExp.reduce((a,x)=>a+x.amount*12,0);
  return `<header class="top"><h1 style="text-align:left"><span class="kick">Risparmio e impostazioni</span>Il tuo piano</h1></header>
  <section class="panel"><h2>Fondo emergenza <button class="btn sm" data-act="form" data-k="emer">Aggiorna</button></h2><p style="margin:0;font:600 26px Fraunces,Georgia,serif" class="num">${eur(s.emergency)}</p><p class="note">Soldi liquidi da parte solo per imprevisti (conto separato). Il consulente lo confronta con le tue spese essenziali.</p></section>
  <section class="panel"><h2>Obiettivi <button class="btn sm" data-act="form" data-k="goal">+ Nuovo</button></h2>
   ${g.length?g.map(x=>{const p=x.target?Math.min(1,x.saved/x.target):0,q=goalQuota(x),n=monthsTo(x.deadline);
     return `<div class="goal"><div class="gh"><span>${esc(x.name)}</span><span class="num">${eur0(x.saved)} / ${eur0(x.target)}</span></div>
     <p>${x.saved>=x.target?'Obiettivo raggiunto.':n?`Metti da parte <b class="num">${eur(q)}</b> al mese per ${n} ${n===1?'mese':'mesi'}.`:'Nessuna scadenza.'}</p>
     <div class="bar" style="margin-bottom:10px"><div style="width:${(p*100).toFixed(1)}%;background:var(--good)"></div></div>
     <div class="btns"><button class="btn sm pri" data-act="form" data-k="contrib" data-id="${x.id}">+ Versa</button><button class="btn sm" data-act="form" data-k="goal" data-id="${x.id}">Modifica</button></div></div>`}).join(''):'<p class="empty">Dai un nome e una cifra a quello per cui risparmi: l\'app calcola la quota mensile.</p>'}</section>
  <section class="panel"><h2>Voci ricorrenti <button class="btn sm" data-act="form" data-k="rec">+ Nuova</button></h2>
   ${r.length?[...r].sort((a,b)=>b.amount-a.amount).map(x=>`<button class="tx" data-act="form" data-k="rec" data-id="${x.id}"><span class="ic" style="background:${catById(x.cat).color}">${initials(x.desc)}</span><span><span class="t1">${esc(x.desc)}</span><span class="t2">Giorno ${x.day} · ${esc(catById(x.cat).name)} · ${esc(accName(x.acc))}</span></span><span class="am num ${x.type==='inc'?'inc':''}">${x.type==='inc'?'+':''}${eur(x.amount)}${x.type!=='inc'?`<span class="t2" style="font-weight:500">${eur0(x.amount*12)}/anno</span>`:''}</span></button>`).join('')
   +(recExp.length?`<p class="note">Le uscite ricorrenti costano <b class="num">${eur(annual)}</b> l'anno.</p>`:''):'<p class="empty">Affitto, bollette, abbonamenti, stipendio: inseriti una volta, registrati da soli ogni mese.</p>'}</section>
  <section class="panel"><h2>Conti e metodi <button class="btn sm" data-act="form" data-k="acc">+ Nuovo</button></h2>
   ${s.accounts.map(a=>{const b=balanceOf(a);return `<button class="tx" data-act="form" data-k="acc" data-id="${a.id}"><span class="ic" style="background:var(--olive)">${initials(a.name)}</span><span><span class="t1">${esc(a.name)}</span><span class="t2">${esc(KINDS[kindOf(a)])}${a.since?' · allineato il '+esc(dLabel(a.since).toLowerCase()):''}</span></span><span class="am num">${b===null?'<span class="tag">imposta saldo</span>':eur(b)}</span></button>`}).join('')}<p class="note">Solo nomi generici: mai IBAN o numeri di carta. Ogni tanto confronta il saldo con la banca e correggilo qui: l'app riparte da quel valore.</p></section>
  <section class="panel"><h2>Categorie <button class="btn sm" data-act="form" data-k="cat">+ Nuova</button></h2>
   <p class="note" style="margin:0 0 6px">Uscite</p><div class="chips">${cats('exp').map(c=>`<button class="chip" data-act="form" data-k="cat" data-id="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</button>`).join('')}</div>
   <p class="note" style="margin:12px 0 6px">Entrate</p><div class="chips">${cats('inc').map(c=>`<button class="chip" data-act="form" data-k="cat" data-id="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</button>`).join('')}</div></section>
  <section class="panel"><h2>Dati</h2><div class="btns"><button class="btn" data-act="export">Esporta CSV</button><label class="btn" style="display:inline-flex;align-items:center">Importa CSV<input type="file" id="imp" accept=".csv,text/csv" hidden></label></div>
   <p class="note">Esporta una volta al mese come copia di sicurezza. L'import accetta il CSV della versione precedente dell'app.</p></section>
  <section class="panel"><h2>Sicurezza</h2><p style="margin:0 0 10px;font-size:15px">Accesso: <b>${esc(S.email||'')}</b> con codice dal telefono.</p>
   <div class="btns"><button class="btn" data-act="factors">Dispositivi 2FA</button><button class="btn del" data-act="logout">Esci</button><button class="btn del" data-act="logoutall">Esci da tutti i dispositivi</button></div>
   <p class="note" style="margin:14px 0 6px">Blocco automatico dopo inattività (su questo dispositivo):</p><div class="chips">${[["1","1 ora"],["8","8 ore"],["24","24 ore"],["168","7 giorni"]].map(([h,l])=>`<button class="chip ${lockH()===Number(h)?'on':''}" data-act="lockset" data-v="${h}">${l}</button>`).join('')}</div>
   <p class="note">Aggiungi un secondo dispositivo (es. tablet o gestore password): se perdi il telefono resti comunque in grado di entrare.</p></section>`}
};

function listHtml(){const q=S.q.trim().toLowerCase();const all=S.byM[S.ym]||[];
  const fa=S.fcat.startsWith('a:')?S.fcat.slice(2):null,fc=S.fcat.startsWith('c:')?S.fcat.slice(2):null;
  const tx=all.filter(t=>(fa?t.acc===fa:shown(t))&&(!fc||t.cat===fc)&&(!q||(t.note||'').toLowerCase().includes(q)||catById(t.cat).name.toLowerCase().includes(q)||accName(t.acc).toLowerCase().includes(q)));
  const acc=fa?accById(fa):null,bal=acc?balanceOf(acc):null;
  const head=acc?`<section class="panel" style="padding:14px 18px"><span class="note" style="margin:0">Saldo attuale · ${esc(acc.name)}</span><p style="margin:2px 0 0;font:600 26px Fraunces,Georgia,serif" class="num">${bal===null?'—':eur(bal)}</p>${bal===null?'<button class="btn sm" data-act="acct" data-id="'+esc(acc.id)+'" style="margin-top:8px">Imposta saldo</button>':''}</section>`:'';
  if(!tx.length)return head+`<p class="empty">${all.length?'Nessun movimento corrisponde al filtro.':'Nessun movimento in '+mLabel(S.ym).toLowerCase()+'.'}</p>`;
  tx.sort((a,b)=>b.date.localeCompare(a.date)||b.ts-a.ts);
  const tot=tx.reduce((s,t)=>s+(isGiro(t)&&!fa?0:(t.type==='inc'?t.amount:-t.amount)),0);const g={};for(const t of tx)(g[t.date]=g[t.date]||[]).push(t);
  return head+`<p class="note" style="margin:0 6px">${tx.length} movimenti · ${fa?'variazione nel mese':'saldo'} <b class="num">${eurS(tot)}</b></p>`+Object.keys(g).map(d=>{const day=g[d].reduce((s,t)=>s+(t.type==='inc'||(isGiro(t)&&!fa)?0:t.amount),0);
    return `<div class="day"><span>${dLabel(d)}</span><span class="num">${day?'−'+eur(day):''}</span></div><div class="panel" style="padding:4px 16px">${g[d].map(t=>txRow(t,!!fa)).join('')}</div>`}).join('')}

/* ================= consulente finanziario ================= */
function analyze(){
  const cur=stats(curYm()),cm=completeMonths(3),cm6=completeMonths(6),D=dim(curYm()),day=Number(todayStr().slice(8));
  const partial=!cm.length;let base=cm;
  if(partial){const f=day>=3?D/day:1;const e2=cur.recExp+(cur.exp-cur.recExp)*f,r=cur.exp?e2/cur.exp:1;base=[{...cur,exp:Math.round(e2),need:Math.round(cur.need*r),want:Math.round(cur.want*r),avoid:Math.round(cur.avoid*f)}]}
  const inc=avg(base,x=>x.inc)||0,exp=avg(base,x=>x.exp)||0,need=avg(base,x=>x.need)||0,want=avg(base,x=>x.want)||0,avoidM=avg(base,x=>x.avoid)||0;
  const recExp=S.settings.recurring.filter(r=>r.type!=='inc').reduce((s,r)=>s+r.amount,0);
  const recInc=S.settings.recurring.filter(r=>r.type==='inc').reduce((s,r)=>s+r.amount,0);
  const income=inc||recInc,saving=income-exp,rate=income?saving/income:null;
  const essential=Math.max(need,S.settings.recurring.filter(r=>r.type!=='inc'&&catById(r.cat).need).reduce((s,r)=>s+r.amount,0));
  const emer=S.settings.emergency||0,emMonths=essential?emer/essential:null;
  const tb=totBudget(),goals=S.settings.goals,gq=goals.reduce((s,g)=>s+goalQuota(g),0);
  const comp=[];let score=0;
  // 1. tasso di risparmio (25)
  let p1=rate===null?0:rate>=.2?25:rate>=.1?16:rate>=0?7:0;comp.push({n:'Tasso di risparmio',v:rate===null?'—':Math.round(rate*100)+'%',p:p1,m:25});score+=p1;
  // 2. fondo emergenza (25)
  let p2=emMonths===null?0:emMonths>=6?25:emMonths>=3?19:emMonths>=1?9:emMonths>0?3:0;comp.push({n:'Fondo emergenza',v:emMonths===null?'—':emMonths.toFixed(1)+' mesi',p:p2,m:25});score+=p2;
  // 3. rispetto dei tetti (20)
  const ref=cm[0]||cur;const bc=cats('exp').filter(c=>c.budget);const ok=bc.filter(c=>(ref.byCat[c.id]||0)<=c.budget).length;
  let p3=bc.length?Math.round(20*ok/bc.length):0;comp.push({n:'Tetti rispettati',v:bc.length?ok+'/'+bc.length:'—',p:p3,m:20});score+=p3;
  // 4. costi fissi (15)
  const fixed=income?recExp/income:null;let p4=fixed===null?0:fixed<=.5?15:fixed<=.65?8:2;comp.push({n:'Costi fissi su entrate',v:fixed===null?'—':Math.round(fixed*100)+'%',p:p4,m:15});score+=p4;
  // 5. spese evitabili (15)
  const av=exp?avoidM/exp:0;let p5=exp?(av<=.05?15:av<=.1?9:3):0;comp.push({n:'Spese evitabili',v:exp?Math.round(av*100)+'%':'—',p:p5,m:15});score+=p5;

  const I=[];const add=(sev,title,why,action,impact)=>I.push({sev,title,why,action,impact:impact||0});
  if(!income)add('alta','Mancano le entrate','Senza entrate registrate non posso calcolare risparmio, sostenibilità dei costi né obiettivi.','Registra lo stipendio come <b>voce ricorrente</b> (Risparmio → Voci ricorrenti).');
  if(!tb)add('alta','Nessun tetto di spesa','Un budget senza limiti è solo un registro: non ti avvisa prima di sforare.',`Imposta i tetti nella scheda Budget${cm.length?' partendo dalla media degli ultimi mesi, poi riducili del 5–10% sulle categorie discrezionali':''}.`);
  // proiezione del mese
  if(day>=5&&cur.exp){const varSp=cur.exp-cur.recExp,proj=Math.round(cur.recExp+varSp/day*D);
    if(tb&&proj>tb)add('alta','A questo ritmo sfori il budget del mese',`Proiezione a fine mese: <b>${eur0(proj)}</b> contro un tetto di ${eur0(tb)}.`,`Per rientrare puoi spendere al massimo <b>${eur(Math.max(0,tb-cur.exp)/(D-day+1))}</b> al giorno da qui a fine mese.`,(proj-tb)*12);
    for(const c of cats('exp')){const sp=cur.byCat[c.id]||0;if(!c.budget||!sp)continue;const rec=cur.tx.filter(t=>t.cat===c.id&&t.rec&&t.type!=='inc').reduce((s,t)=>s+t.amount,0);const pr=Math.round(rec+(sp-rec)/day*D);
      if(pr>c.budget*1.1&&pr-c.budget>2000&&sp<c.budget)add('media',`${esc(c.name)}: sforamento in arrivo`,`Hai speso ${eur0(sp)} su ${eur0(c.budget)}; al ritmo attuale chiudi a circa ${eur0(pr)}.`,`Rallenta ora: restano <b>${eur(c.budget-sp)}</b> per ${D-day+1} giorni.`,(pr-c.budget)*12)}}
  // tasso di risparmio
  if(income&&rate!==null){if(rate<0)add('alta','Spendi più di quanto guadagni',`In media escono ${eur0(exp)} al mese contro ${eur0(income)} di entrate: stai erodendo i risparmi di ${eur0(-saving)} al mese.`,`Taglia prima le categorie discrezionali (${eur0(want)}/mese). Obiettivo minimo: tornare in pari, poi al 10%.`,-saving*12);
    else if(rate<.2){const gap=Math.round(.2*income-saving);add(rate<.1?'alta':'media',`Risparmi il ${Math.round(rate*100)}% delle entrate`,'La regola di riferimento è mettere da parte almeno il 20% di ciò che entra.',`Ti mancano <b>${eur0(gap)}</b> al mese per arrivare al 20%. Imposta un bonifico automatico il giorno dello stipendio: risparmia prima, spendi quello che resta.`,gap*12)}
    else add('ok',`Ottimo tasso di risparmio: ${Math.round(rate*100)}%`,`Metti da parte in media ${eur0(saving)} al mese.`,'Assicurati che il risparmio abbia una destinazione: fondo emergenza fino a 6 mesi, poi obiettivi.')}
  // fondo emergenza
  if(essential){if(emMonths<3){const target=essential*3,gap=target-emer,m=Math.ceil(gap/Math.max(1,Math.min(saving>0?saving:gap/12,gap)));
      add(emMonths<1?'alta':'media','Fondo emergenza insufficiente',`Copre ${emMonths.toFixed(1)} mesi di spese essenziali (${eur0(essential)}/mese). Il minimo prudente è 3 mesi: ${eur0(target)}.`,`Mancano <b>${eur0(gap)}</b>. ${saving>0?`Con il risparmio attuale servono circa ${Math.min(m,99)} mesi; destina qui la priorità prima di altri obiettivi.`:'Prima riporta il risparmio in positivo.'}`)}
    else if(emMonths<6)add('info','Fondo emergenza ok, non ancora pieno',`Copre ${emMonths.toFixed(1)} mesi. L'ideale per un lavoratore dipendente è 3–6 mesi.`,`Puoi portarlo a 6 mesi (${eur0(essential*6)}) o dirottare parte del risparmio sugli obiettivi.`);
    else add('ok','Fondo emergenza solido',`Copre ${emMonths.toFixed(1)} mesi di spese essenziali.`,'Oltre i 6 mesi la liquidità rende poco: valuta con un consulente abilitato come impiegare l\'eccedenza.')}
  else if(!emer)add('media','Imposta il fondo emergenza','Serve a non indebitarti per un imprevisto (auto, salute, lavoro).','Indica quanto hai già da parte in Risparmio → Fondo emergenza.');
  // 50/30/20
  if(income&&exp){const n=need/income,w=want/income;
    if(w>.3)add('media','Spesa discrezionale sopra il 30%',`Le spese non essenziali valgono il ${Math.round(w*100)}% delle entrate (riferimento 50/30/20: max 30%).`,`Riducile di <b>${eur0(want-.3*income)}</b> al mese.`,(want-.3*income)*12);
    if(n>.5)add('media','Spese essenziali oltre il 50%',`Casa, spesa, trasporti e simili assorbono il ${Math.round(n*100)}% delle entrate.`,'Qui si agisce su contratti: rinegozia luce/gas/telefono, assicurazioni, abbonamenti. Un risparmio sui fissi vale ogni mese.')}
  // anomalie per categoria
  if(cm.length>=2&&day>=10){for(const c of cats('exp')){const a=avg(cm,x=>x.byCat[c.id]||0);const sp=cur.byCat[c.id]||0;const pr=Math.round(sp/day*D);
      if(a&&pr>a*1.3&&pr-a>3000)add('media',`${esc(c.name)} in crescita`,`Proiezione del mese ${eur0(pr)} contro una media di ${eur0(a)} (+${pct(pr-a,a)}%).`,'Controlla i movimenti di questa categoria: è un evento una tantum o una nuova abitudine?',(pr-a)*12)}}
  // abbonamenti
  const subs=S.settings.recurring.filter(r=>r.type!=='inc'&&r.cat==='abbonamenti');const subTot=subs.reduce((s,r)=>s+r.amount,0);
  if(subTot)add(income&&subTot/income>.05?'media':'info','Revisione abbonamenti',`${subs.length} abbonamenti per ${eur(subTot)} al mese, cioè <b>${eur0(subTot*12)}</b> l'anno.`,'Disdici quelli che non hai usato nell\'ultimo mese; alterna i servizi streaming invece di tenerli tutti.',0);
  // evitabili
  if(avoidM)add(av>.1?'media':'info','Spese evitabili',`In media ${eur0(avoidM)} al mese che tu stesso consideri evitabili: in un anno sono <b>${eur0(avoidM*12)}</b>.`,'Applica la regola delle 48 ore: per acquisti non essenziali sopra 30 € aspetta due giorni prima di comprare.',avoidM*12);
  // obiettivi
  if(goals.length&&income){if(gq>Math.max(0,saving))add('alta','Obiettivi non sostenibili',`Le quote mensili degli obiettivi (${eur0(gq)}) superano il risparmio medio (${eur0(Math.max(0,saving))}).`,'Allunga una scadenza o riduci una cifra: un piano che non si può rispettare viene abbandonato.');
    else if(saving>0)add('ok','Obiettivi coperti',`Le quote (${eur0(gq)}/mese) stanno nel risparmio medio (${eur0(saving)}/mese).`,`Resta un margine di ${eur0(saving-gq)}/mese da assegnare.`)}
  else if(income&&saving>0&&!goals.length)add('info','Dai un nome al risparmio','Il risparmio senza scopo tende a essere speso.','Crea un obiettivo (vacanza, auto, anticipo casa) con scadenza: l\'app calcola la quota mensile.');
  const B=balances();
  for(const {a,b} of B.list){if(b===null||a.incl===false)continue;
    if(b<0&&kindOf(a)!=='credito')add('alta',`${esc(a.name)} in rosso`,`Il saldo è ${eur(b)}: sugli scoperti la banca applica interessi e commissioni.`,'Copri subito lo scoperto con un giroconto da un altro conto e rimanda le spese non essenziali.');
    if(b<0&&kindOf(a)==='credito'&&income&&-b>income*.3)add('media',`Debito su ${esc(a.name)}`,`Hai ${eur(-b)} da saldare, oltre il 30% delle entrate mensili.`,'Verifica che l\'addebito sia a saldo e non rateale: le carte revolving costano spesso oltre il 15% annuo.')}
  if(B.any){const fc=monthForecast(B.total);
    if(fc.value<0)add('alta','Rischio di chiudere il mese in negativo',`Saldo attuale ${eur0(B.total)}; considerando ricorrenti e budget rimasto, a fine mese arrivi a circa ${eur0(fc.value)}.`,'Riduci le spese discrezionali o sposta una spesa al mese prossimo.');
    if(essential&&B.liquid<essential)add('alta','Liquidità sotto un mese di spese essenziali',`Sui conti hai ${eur0(B.liquid)} contro ${eur0(essential)} di spese essenziali al mese.`,'Prima di ogni altro obiettivo, ricostruisci almeno un mese di cuscinetto.');
    else if(essential&&!emer&&B.liquid>essential*4)add('info','Hai liquidità ferma',`Sui conti ci sono ${eur0(B.liquid)}, circa ${(B.liquid/essential).toFixed(1)} mesi di spese essenziali.`,`Separa ${eur0(essential*3)} come fondo emergenza (Risparmio → Fondo emergenza) e dai una destinazione al resto.`)}
  const order={alta:0,media:1,info:2,ok:3};I.sort((a,b)=>order[a.sev]-order[b.sev]||b.impact-a.impact);
  const proj12=saving*12;
  return {score:Math.round(score),comp,I,income,exp,need,want,saving,rate,partial,cm6,emMonths,proj12,avoidM}}

function advisorView(){const A=analyze();const sc=A.score;const R=54,C=2*Math.PI*R;const col=sc>=75?'var(--good)':sc>=50?'var(--warn)':'var(--bad)';
  const verdict=sc>=75?'Situazione solida':sc>=50?'Buona base, margini di miglioramento':sc>=30?'Da sistemare':'Situazione fragile';
  const ms=[];for(let i=5;i>=0;i--)ms.push(stats(addM(S.ym,-i)));const mx=Math.max(1,...ms.map(d=>Math.max(d.inc,d.exp)));
  const lbl={alta:'Priorità',media:'Attenzione',info:'Spunto',ok:'Bene'};
  const split=A.income?[{v:A.need,c:'var(--sage)',n:'Essenziali'},{v:A.want,c:'var(--clay)',n:'Discrezionali'},{v:Math.max(0,A.saving),c:'var(--blush)',n:'Risparmio'}]:null;
  return `<section class="panel"><h2>Salute finanziaria <small>${A.partial?'mese in corso, proiettato a fine mese':'media ultimi '+Math.min(3,completeMonths(3).length)+' mesi'}</small></h2>
   <div class="score"><div class="ring"><svg viewBox="0 0 132 132"><circle r="${R}" cx="66" cy="66" fill="none" stroke="var(--soft)" stroke-width="14"/><circle r="${R}" cx="66" cy="66" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(C*sc/100).toFixed(2)} ${C.toFixed(2)}"/></svg><div class="c"><b class="num">${sc}</b><span>su 100</span></div></div>
   <div><p style="margin:0 0 8px;font-weight:800">${verdict}</p><div class="comp">${A.comp.map(c=>`<div><span>${c.n}</span><span class="num">${c.v}</span><div class="bar"><div style="width:${(c.p/c.m*100).toFixed(0)}%;background:${c.p/c.m>=.75?'var(--good)':c.p/c.m>=.4?'var(--warn)':'var(--bad)'}"></div></div></div>`).join('')}</div></div></div></section>
  <section class="panel"><h2>Piano d'azione <small>in ordine di importanza</small></h2>${A.I.length?A.I.map(x=>`<div class="ins"><div class="h"><span class="pill ${x.sev}">${lbl[x.sev]}</span><span>${x.title}</span></div><p>${x.why}</p><div class="act">${x.action}${x.impact>0?`<br><span style="color:var(--muted);font-size:13px">Impatto stimato: ${eur0(x.impact)} l'anno</span>`:''}</div></div>`).join(''):'<p class="empty">Registra qualche settimana di movimenti per ricevere indicazioni.</p>'}</section>
  ${split?`<section class="panel"><h2>Regola 50/30/20 <small>sulle entrate medie</small></h2><div class="split">${split.map(s=>`<div style="width:${Math.min(100,pct(s.v,A.income))}%;background:${s.c}"></div>`).join('')}</div>
   <table class="sumtable">${split.map((s,i)=>`<tr><td><span class="dot" style="display:inline-block;background:${s.c};margin-right:8px"></span>${s.n} <small style="color:var(--muted)">obiettivo ${['≤50%','≤30%','≥20%'][i]}</small></td><td class="num">${eur0(s.v)} · ${pct(s.v,A.income)}%</td></tr>`).join('')}</table></section>`:''}
  <section class="panel"><h2>Proiezione</h2><p style="margin:0;font-size:15px">${A.saving>0?`Mantenendo il ritmo attuale, tra 12 mesi avrai messo da parte circa <b class="num">${eur0(A.proj12)}</b>.`:A.income?`Al ritmo attuale in 12 mesi perderesti circa <b class="num">${eur0(-A.proj12)}</b> di risparmi.`:'Servono le entrate per una proiezione.'}</p></section>
  <section class="panel"><h2>Entrate e uscite <small>6 mesi</small></h2><div class="chart">${ms.map(d=>`<div class="col ${d.ym===S.ym?'cur':''}"><div class="bars"><div class="bi" style="height:${(d.inc/mx*100).toFixed(1)}%"></div><div class="be" style="height:${(d.exp/mx*100).toFixed(1)}%"></div></div><div class="ml">${mLabel(d.ym,true)}</div></div>`).join('')}</div>
   <div class="legend"><span><i style="background:var(--blush)"></i>Entrate</span><span><i style="background:var(--sage)"></i>Uscite</span></div>
   <table class="sumtable" style="margin-top:12px">${ms.slice().reverse().map(d=>{const s=d.inc-d.exp;return `<tr><td>${mLabel(d.ym,true)} ${d.ym.slice(0,4)}</td><td class="num">${d.tx.length?`<span style="${s<0?'color:var(--bad)':''}">${eur(s)}</span> <small style="color:var(--muted)">${d.inc?pct(s,d.inc)+'%':''}</small>`:'<span style="color:var(--muted)">nessun dato</span>'}</td></tr>`}).join('')}</table></section>
  <section class="panel"><h2>Categorie vs mese prima</h2>${(()=>{const a=ms[5],b=ms[4];const r=cats('exp').map(c=>({c,x:a.byCat[c.id]||0,y:b.byCat[c.id]||0})).filter(o=>o.x||o.y).sort((p,q)=>(q.x-q.y)-(p.x-p.y));
    return r.length?r.map(({c,x,y})=>{const d=x-y;return `<div class="row"><div class="nm"><span class="dot" style="background:${c.color}"></span><span>${esc(c.name)}</span></div><div class="vl num">${eur(x)} <span class="delta ${d>0?'up':d<0?'dn':''}">${d>0?'▲':d<0?'▼':'='} ${d?eur(Math.abs(d)):''}</span></div></div>`}).join(''):'<p class="empty">Nessun dato da confrontare.</p>'})()}</section>
  <p class="note" style="padding:0 6px">Indicazioni automatiche basate su regole di pianificazione diffuse (risparmio ≥20%, fondo emergenza 3–6 mesi di spese essenziali, 50/30/20). Non sono consulenza finanziaria regolamentata né consigli di investimento.</p>`}

/* ================= inserimento rapido ================= */
let E=null,F=null;
function usage(){const n={};for(const t of S.tx.values())n[t.cat]=(n[t.cat]||0)+1;return n}
function openEntry(t){
  if(t&&isGiro(t)){const p=giroPair(t),o=p.find(x=>x.type==='exp'),i=p.find(x=>x.type==='inc');
    E={mode:'edit',id:gidOf(t)||t.id,type:'giro',buf:toIn(t.amount).replace(/,00$/,''),cat:null,acc:o?.acc||S.settings.accounts[0]?.id,to:i?.acc||S.settings.accounts[1]?.id,date:t.date,note:t.note||'',avoid:false,ts:t.ts,prevRows:p,more:false}}
  else if(t)E={mode:'edit',id:t.id,type:t.type,buf:toIn(t.amount).replace(/,00$/,''),cat:t.cat,acc:t.acc,date:t.date,note:t.note||'',avoid:!!t.avoid,rec:t.rec,ts:t.ts,prev:t,prevRows:[t],more:false};
  else{const lastAcc=ls.get('lastAcc');E={mode:'new',type:'exp',buf:'',cat:null,acc:S.settings.accounts.some(a=>a.id===lastAcc)?lastAcc:S.settings.accounts[0]?.id,date:S.ym===curYm()?todayStr():S.ym+'-01',note:'',avoid:false,more:false,prevRows:[]};E.to=S.settings.accounts.find(a=>a.id!==E.acc)?.id}
  F=null;drawEntry();ov.classList.add('open');document.body.style.overflow='hidden'}
function fmtBuf(b){if(!b)return '0';let [i,d]=b.split(',');i=grp(Number(i||0));return d!==undefined?i+','+d:i}
function drawEntry(){const u=usage();const list=cats(E.type).slice().sort((a,b)=>(u[b.id]||0)-(u[a.id]||0));const G=E.type==='giro';
  const accChips=(sel,ev)=>`<div class="chips">${S.settings.accounts.map(a=>`<button class="chip ${sel===a.id?'on':''}" data-e="${ev}" data-v="${a.id}">${esc(a.name)}</button>`).join('')}</div>`;
  sheet.innerHTML=`<div class="shead"><div class="seg"><button class="${E.type==='exp'?'on':''}" data-e="type" data-v="exp">Uscita</button><button class="${E.type==='inc'?'on':''}" data-e="type" data-v="inc">Entrata</button><button class="${G?'on':''}" data-e="type" data-v="giro">Giroconto</button></div>
    <div class="btns">${E.mode==='edit'?'<button class="btn sm del" data-e="del">Elimina</button>':''}<button class="ib" data-e="close" aria-label="Chiudi">×</button></div></div>
  <div class="amount num ${E.buf?'':'ph'}" id="amt" aria-live="polite">€ ${fmtBuf(E.buf)}</div>
  ${G?`<p class="note" style="margin:0">Da</p>${accChips(E.acc,'acc')}<p class="note" style="margin:0">A</p>${accChips(E.to,'to')}<p class="note" style="margin:0">Es. prelievo al bancomat (Conto → Contanti), ricarica della prepagata, versamento sul conto risparmio. Non conta come spesa.</p>`:`<div class="chips">${list.map(c=>`<button class="chip ${E.cat===c.id?'on':''}" data-e="cat" data-v="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</button>`).join('')}</div>`}
  <button class="more" data-e="more"><span>${G?'':esc(accName(E.acc))+' · '}${dLabel(E.date)}${E.note?' · '+esc(E.note):''}${E.avoid?' · evitabile':''}</span><span>${E.more?'▴':'▾'}</span></button>
  <div class="extra ${E.more?'open':''}">${G?'':accChips(E.acc,'acc')}
   <div class="grid2"><label class="field">Data<input type="date" id="edate" value="${E.date}" max="${todayStr()}"></label><label class="field">Nota<input id="enote" maxlength="60" value="${esc(E.note)}" placeholder="es. Esselunga"></label></div>
   ${E.type==='exp'?`<label class="check"><input type="checkbox" id="eavoid" ${E.avoid?'checked':''}>Spesa evitabile (potevo farne a meno)</label>`:''}</div>
  <div class="pad">${['1','2','3','4','5','6','7','8','9',',','0','⌫'].map(k=>`<button data-k="${k}" aria-label="${k==='⌫'?'Cancella':k}">${k}</button>`).join('')}</div>
  <button class="save" data-e="save">${E.mode==='edit'?'Salva modifiche':'Registra'}</button>`}
function key(k){let b=E.buf;if(k==='⌫')b=b.slice(0,-1);else if(k===','){if(!b.includes(','))b=(b||'0')+','}
  else{const [i,d]=b.split(',');if(d!==undefined){if(d.length>=2)return}else if((i||'').length>=7)return;b=b==='0'?k:b+k}
  E.buf=b;const el=document.getElementById('amt');el.textContent='€ '+fmtBuf(b);el.classList.toggle('ph',!b)}
function keepExtra(){const ne=document.getElementById('enote'),de=document.getElementById('edate'),ae=document.getElementById('eavoid');if(ne)E.note=ne.value;if(de&&de.value)E.date=de.value;if(ae)E.avoid=ae.checked}
function closeSheet(){ov.classList.remove('open');document.body.style.overflow='';E=null;F=null}
async function saveRows(rows,prevRows){const keep=new Set(rows.map(r=>r.id));const stale=(prevRows||[]).filter(p=>!keep.has(p.id));
  for(const p of prevRows||[])S.tx.delete(p.id);for(const r of rows)S.tx.set(r.id,r);reindex();draw();
  const undo=()=>{for(const r of rows)S.tx.delete(r.id);for(const p of prevRows||[])S.tx.set(p.id,p);reindex();draw()};
  if(rows.length){const {error}=await sb.from('transactions').upsert(rows.map(toRow));if(error){undo();dbFail(error,'movimento');return false}}
  if(stale.length){const {error}=await sb.from('transactions').delete().eq('user_id',S.uid).in('id',stale.map(p=>p.id));if(error){undo();dbFail(error,'movimento');return false}}
  return true}
function saveEntry(){keepExtra();const amount=parseEur(E.buf);
  if(!amount){toast('Inserisci un importo');return}
  if(E.date>todayStr()){toast('La data non può essere nel futuro');return}
  const prevRows=E.prevRows||[],mode=E.mode;
  if(E.type==='giro'){if(!E.acc||!E.to||E.acc===E.to){toast('Scegli due conti diversi');return}
    const gid=mode==='edit'&&prevRows.length&&gidOf(prevRows[0])?gidOf(prevRows[0]):nid(),ts=mode==='edit'?(E.ts||Date.now()):Date.now(),note=E.note.trim();
    const rows=[{id:'g-'+gid+'-o',date:E.date,amount,type:'exp',cat:GIRO,acc:E.acc,note,avoid:false,rec:null,ts},{id:'g-'+gid+'-i',date:E.date,amount,type:'inc',cat:GIRO,acc:E.to,note,avoid:false,rec:null,ts}];
    const msg='Giroconto '+eur(amount)+': '+accName(E.acc)+' → '+accName(E.to);closeSheet();saveRows(rows,prevRows).then(ok=>{if(ok)toast(msg)});return}
  if(!E.cat){toast('Scegli una categoria');return}
  const prev=E.prev&&!isGiro(E.prev)?E.prev:null;
  const t={id:prev?prev.id:nid(),date:E.date,amount,type:E.type,cat:E.cat,acc:E.acc,note:E.note.trim(),avoid:E.type==='exp'&&E.avoid,rec:E.rec||null,ts:mode==='edit'?(E.ts||Date.now()):Date.now()};
  ls.set('lastAcc',E.acc);closeSheet();
  const c=catById(t.cat),ym=t.date.slice(0,7);let msg=(mode==='edit'?'Modificata: ':'Registrata: ')+eur(amount)+' · '+c.name;
  if(t.type==='exp'&&c.budget&&ym===curYm()){const sp=(stats(ym).byCat[c.id]||0)-(prev&&prev.cat===c.id&&prev.date.slice(0,7)===ym?prev.amount:0)+amount;if(sp>=c.budget)msg+=' — tetto superato';else if(sp>=c.budget*.8)msg+=' — '+pct(sp,c.budget)+'% del tetto'}
  saveRows([t],prevRows).then(ok=>{if(ok)toast(msg)})}
function delEntry(){const rows=E.prevRows||[];closeSheet();if(!rows.length)return;
  saveRows([],rows).then(ok=>{if(ok)toast(rows.length>1?'Giroconto eliminato':'Movimento eliminato',()=>saveRows(rows,[]))})}

/* ================= moduli ================= */
const fld=(id,label,attrs)=>`<label class="field">${label}<input id="${id}" ${attrs}></label>`;
const v=id=>document.getElementById(id)?.value??'';
function openForm(k,id){const s=S.settings;F={k,id};E=null;let h='',title='',canDel=!!id;
  if(k==='goal'){const g=s.goals.find(x=>x.id===id)||{name:'',target:0,saved:0,deadline:''};title=id?'Modifica obiettivo':'Nuovo obiettivo';
    h=fld('f1','Nome',`value="${esc(g.name)}" maxlength="40" placeholder="es. Vacanza estate"`)+`<div class="grid2">${fld('f2','Cifra da raggiungere (€)',`inputmode="decimal" value="${toIn(g.target)}"`)}${fld('f3','Già da parte (€)',`inputmode="decimal" value="${toIn(g.saved)}"`)}</div>`+fld('f4','Entro (mese)',`type="month" value="${g.deadline}" min="${curYm()}"`)}
  else if(k==='contrib'){const g=s.goals.find(x=>x.id===id);title='Versa su "'+esc(g.name)+'"';canDel=false;h=fld('f1','Importo (€)','inputmode="decimal" placeholder="0,00"')+'<p class="note">Registra i soldi che sposti davvero sul conto risparmio.</p>'}
  else if(k==='emer'){title='Fondo emergenza';canDel=false;h=fld('f1','Quanto hai da parte per gli imprevisti (€)',`inputmode="decimal" value="${toIn(s.emergency)}"`)}
  else if(k==='rec'){const r=s.recurring.find(x=>x.id===id)||{desc:'',amount:0,cat:'',acc:s.accounts[0]?.id,day:1};title=id?'Modifica voce ricorrente':'Nuova voce ricorrente';
    const opt=t=>cats(t).map(c=>`<option value="${c.id}" ${r.cat===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
    h=fld('f1','Descrizione',`value="${esc(r.desc)}" maxlength="40" placeholder="es. Affitto, Netflix, Stipendio"`)+`<div class="grid2">${fld('f2','Importo mensile (€)',`inputmode="decimal" value="${toIn(r.amount)}"`)}${fld('f3','Giorno del mese',`type="number" min="1" max="31" inputmode="numeric" value="${r.day}"`)}</div>
     <div class="grid2"><label class="field">Categoria<select id="f4"><optgroup label="Uscite">${opt('exp')}</optgroup><optgroup label="Entrate">${opt('inc')}</optgroup></select></label><label class="field">Conto<select id="f5">${s.accounts.map(a=>`<option value="${a.id}" ${r.acc===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label></div>`
     +(id?'':'<label class="check"><input type="checkbox" id="f6" checked>Registra già questo mese, se il giorno è passato</label>')}
  else if(k==='acc'){const a=s.accounts.find(x=>x.id===id)||{name:'',kind:'conto',incl:true};const b=balanceOf(a);title=id?'Conto: '+esc(a.name):'Nuovo conto';
    h=fld('f1','Nome',`value="${esc(a.name)}" maxlength="24" placeholder="es. Conto principale"`)
     +`<label class="field">Tipo<select id="f2">${Object.entries(KINDS).map(([k2,l])=>`<option value="${k2}" ${kindOf(a)===k2?'selected':''}>${l}</option>`).join('')}</select></label>`
     +fld('f3','Saldo reale adesso (€)',`inputmode="text" autocomplete="off" placeholder="${b===null?'es. 1.250,40':toIn(Math.abs(b))}" value="${b===null?'':(b<0?'-':'')+toIn(Math.abs(b))}"`)
     +`<p class="note" style="margin:-4px 0 0">${b===null?'Copialo dall\'app della banca. Per la carta di credito usa un valore negativo (es. -320,00) se hai speso.':'Modificalo solo se non coincide con la banca: l\'app riparte da questo valore e conta solo i movimenti successivi.'}</p>`
     +`<label class="check"><input type="checkbox" id="f4" ${a.incl!==false?'checked':''}>Includi nel totale dei saldi</label>`}
  else if(k==='cat'){const c=s.cats.find(x=>x.id===id)||{name:'',type:'exp',need:false};title=id?'Modifica categoria':'Nuova categoria';
    h=fld('f1','Nome',`value="${esc(c.name)}" maxlength="24"`)+(id?'':'<label class="field">Tipo<select id="f2"><option value="exp">Uscita</option><option value="inc">Entrata</option></select></label>')
     +(c.type==='exp'?`<label class="check"><input type="checkbox" id="f3" ${c.need?'checked':''}>Spesa essenziale (non rinunciabile: casa, cibo, salute…)</label>`:'')}
  sheet.innerHTML=`<div class="shead"><h2 style="margin:0">${title}</h2><button class="ib" data-e="close" aria-label="Chiudi">×</button></div>${h}
   <div class="btns" style="justify-content:space-between">${canDel?'<button class="btn del" data-e="fdel">Elimina</button>':'<span></span>'}<button class="btn pri" data-e="fsave">Salva</button></div>`;
  ov.classList.add('open');document.body.style.overflow='hidden'}
async function saveForm(){const {k,id}=F;
  if(k==='goal'){const name=v('f1').trim(),target=parseEur(v('f2')),saved=parseEur(v('f3'))||0,deadline=v('f4');
    if(!name||!target||isNaN(target)){toast('Servono nome e cifra');return}
    mutateSettings(s=>{const g={id:id||nid(),name,target,saved:isNaN(saved)?0:saved,deadline};const i=s.goals.findIndex(x=>x.id===g.id);if(i>=0)s.goals[i]=g;else s.goals.push(g)})}
  else if(k==='contrib'){const a=parseEur(v('f1'));if(!a||isNaN(a)){toast('Inserisci un importo');return}mutateSettings(s=>{const g=s.goals.find(x=>x.id===id);if(g)g.saved+=a});toast('Versati '+eur(a))}
  else if(k==='emer'){const a=parseEur(v('f1'));if(isNaN(a)){toast('Importo non valido');return}mutateSettings(s=>{s.emergency=a})}
  else if(k==='rec'){const desc=v('f1').trim(),amount=parseEur(v('f2')),day=Math.min(31,Math.max(1,parseInt(v('f3'))||1)),cat=v('f4'),acc=v('f5');
    if(!desc||!amount||isNaN(amount)){toast('Servono descrizione e importo');return}
    const type=catById(cat).type,now=!id&&document.getElementById('f6')?.checked;
    closeSheet();await mutateSettings(s=>{const old=s.recurring.find(x=>x.id===id);const r={id:id||nid(),desc,amount,day,cat,acc,type,start:old?old.start:(now?curYm():addM(curYm(),1))};
      const i=s.recurring.findIndex(x=>x.id===r.id);if(i>=0)s.recurring[i]=r;else s.recurring.push(r)});
    runRecurring();return}
  else if(k==='acc'){const name=v('f1').trim();if(!name){toast('Serve un nome');return}const kind=v('f2')||'conto',incl=!!document.getElementById('f4')?.checked,raw=v('f3').trim();
    let val=null;if(raw!==''){val=parseSigned(raw);if(isNaN(val)){toast('Saldo non valido: usa es. 1.250,40 o -320,00');return}}
    const cur=id?balanceOf(accById(id)):null;
    mutateSettings(s=>{let a=id?s.accounts.find(x=>x.id===id):null;if(!a){a={id:nid()};s.accounts.push(a)}a.name=name;a.kind=kind;a.incl=incl;
      if(val!==null&&val!==cur){a.initial=val;a.since=todayStr();a.sinceTs=Date.now()}});
    if(val!==null&&val!==cur)toast('Saldo di '+name+' impostato a '+eur(val))}
  else if(k==='cat'){const name=v('f1').trim();if(!name){toast('Serve un nome');return}const need=!!document.getElementById('f3')?.checked;
    mutateSettings(s=>{if(id){const c=s.cats.find(x=>x.id===id);c.name=name;if(c.type==='exp')c.need=need}else{const type=v('f2')||'exp';s.cats.push({id:nid(),name,type,budget:0,need:type==='exp'&&need,color:COLORS[s.cats.length%COLORS.length]})}})}
  closeSheet()}
function delForm(){const {k,id}=F;const s=S.settings;
  if(k==='acc'&&s.accounts.length<2){toast('Serve almeno un conto');return}
  if(k==='cat'){const c=s.cats.find(x=>x.id===id);if(cats(c.type).length<2){toast('Serve almeno una categoria di questo tipo');return}}
  const key={goal:'goals',rec:'recurring',acc:'accounts',cat:'cats'}[k];const item=clone(s[key].find(x=>x.id===id));const idx=s[key].findIndex(x=>x.id===id);
  mutateSettings(st=>{st[key]=st[key].filter(x=>x.id!==id)});closeSheet();
  toast('Eliminato',()=>mutateSettings(st=>{if(!st[key].some(x=>x.id===id))st[key].splice(idx,0,item)}))}
async function openFactors(){E=null;F={k:'factors'};sheet.innerHTML='<p>Carico…</p>';ov.classList.add('open');
  const {data}=await sb.auth.mfa.listFactors();const fs=(data?.totp||[]).filter(f=>f.status==='verified');
  sheet.innerHTML=`<div class="shead"><h2 style="margin:0">Dispositivi 2FA</h2><button class="ib" data-e="close" aria-label="Chiudi">×</button></div>
   ${fs.map(f=>`<div class="row"><div class="nm"><span>${esc(f.friendly_name||'Dispositivo')}</span></div><div class="vl">${fs.length>1?`<button class="btn sm del" data-e="unenroll" data-v="${f.id}">Rimuovi</button>`:'<small>unico</small>'}</div></div>`).join('')}
   <div id="enr"></div><button class="btn pri" data-e="addfactor">+ Aggiungi dispositivo</button>`}
async function addFactor(){const box=document.getElementById('enr');const {data,error}=await sb.auth.mfa.enroll({factorType:'totp',friendlyName:'Dispositivo '+todayStr()+' '+nid().slice(-4)});
  if(error){toast(authErr(error));return}F.enroll=data.id;
  box.innerHTML=`<img class="qr" src="${esc(data.totp.qr_code)}" alt="Codice QR"><div class="secret" style="margin:10px 0">${esc(data.totp.secret)}</div>${fld('fcode','Codice a 6 cifre dal nuovo dispositivo','inputmode="numeric" maxlength="6"')}<button class="btn pri" style="margin-top:10px" data-e="verifyfactor">Conferma</button>`}

/* ================= CSV ================= */
async function exportCsv(){toast('Preparo il file…');let all;try{all=await fetchRange('1900-01-01')}catch(e){dbFail(e,'export');return}
  all.sort((a,b)=>a.date.localeCompare(b.date));
  const safe=x=>/^[=+\-@\t\r]/.test(x)?"'"+x:x;
  const rows=[['Data','Tipo','Categoria','Conto','Importo','Nota','Evitabile','Ricorrente']];
  for(const t of all)rows.push([t.date,isGiro(t)?(t.type==='inc'?'Giroconto entrata':'Giroconto uscita'):t.type==='inc'?'Entrata':'Uscita',safe(catById(t.cat).name),safe(accName(t.acc)),(t.type==='inc'?'':'-')+(t.amount/100).toFixed(2).replace('.',','),safe(t.note||''),t.avoid?'sì':'',t.rec?'sì':'']);
  const csv='\ufeff'+rows.map(r=>r.map(x=>/[";\n\r]/.test(x)?'"'+String(x).replace(/"/g,'""')+'"':x).join(';')).join('\r\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='budget-'+todayStr()+'.csv';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
  toast('Esportati '+all.length+' movimenti')}
function parseCsv(text){text=text.replace(/^﻿/,'');const out=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=ch}
    else if(ch==='"')q=true;else if(ch===';'){row.push(f);f=''}else if(ch==='\n'){row.push(f.replace(/\r$/,''));out.push(row);row=[];f=''}else f+=ch}
  if(f||row.length){row.push(f);out.push(row)}return out}
async function importCsv(file){const rows=parseCsv(await file.text());if(rows.length<2){toast('File vuoto o non riconosciuto');return}
  const h=rows[0].map(x=>x.trim().toLowerCase());const ix=n=>h.indexOf(n);if(ix('data')<0||ix('importo')<0){toast('Intestazioni non riconosciute');return}
  const byName={};for(const c of S.settings.cats)byName[c.name.toLowerCase()+'|'+c.type]=c.id;const accBy={};for(const a of S.settings.accounts)accBy[a.name.toLowerCase()]=a.id;
  const newCats=[],newAcc=[],list=[],seen={};
  for(const r of rows.slice(1)){if(!r[ix('data')])continue;const date=r[ix('data')].trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    const type=/entrata/i.test(r[ix('tipo')]||'')?'inc':'exp';const amount=Math.abs(parseEur((r[ix('importo')]||'').replace('-','')));if(!amount)continue;
    const cn=(r[ix('categoria')]||'Altro').trim();let cat=/^giroconto/i.test(r[ix('tipo')]||'')||cn.toLowerCase()==='giroconto'?GIRO:byName[cn.toLowerCase()+'|'+type];
    if(!cat){cat=nid();byName[cn.toLowerCase()+'|'+type]=cat;newCats.push({id:cat,name:cn.slice(0,24),type,budget:0,need:false,color:COLORS[(S.settings.cats.length+newCats.length)%12]})}
    const an=(r[ix('conto')]||'Conto').trim();let acc=accBy[an.toLowerCase()];if(!acc){acc=nid();accBy[an.toLowerCase()]=acc;newAcc.push({id:acc,name:an.slice(0,24)})}
    const note=(r[ix('nota')]||'').replace(/^'(?=[=+\-@])/,'').slice(0,200);const id='imp-'+date+'-'+amount+'-'+type+'-'+cat.slice(0,8)+'-'+note.slice(0,10).replace(/[^a-z0-9]/gi,'');
    const k=seen[id]=(seen[id]||0)+1;list.push({id:(id.slice(0,74)+'-'+k),date,amount,type,cat,acc,note,avoid:/s[iì]/i.test(r[ix('evitabile')]||''),rec:null,ts:Date.now()})}
  if(!list.length){toast('Nessun movimento valido');return}
  if(newCats.length||newAcc.length)await mutateSettings(s=>{s.cats.push(...newCats);s.accounts.push(...newAcc)});
  const {error}=await sb.from('transactions').upsert(list.map(toRow));if(error){dbFail(error,'import');return}
  for(const t of list)S.tx.set(t.id,t);const mn=list.reduce((m,t)=>t.date<m?t.date:m,'9999');if(mn.slice(0,7)<(S.firstYm||'9999'))S.firstYm=mn.slice(0,7);if(S.loadedFrom&&mn.slice(0,7)<S.loadedFrom)S.loadedFrom=mn.slice(0,7);reindex();draw();toast('Importati '+list.length+' movimenti')}

/* ================= toast ================= */
let tt=0;function toast(msg,undo){const el=document.getElementById('toast'),b=document.getElementById('tact');document.getElementById('tmsg').textContent=msg;
  b.hidden=!undo;b.onclick=undo?()=>{undo();el.classList.remove('open')}:null;el.classList.add('open');clearTimeout(tt);tt=setTimeout(()=>el.classList.remove('open'),undo?6000:3200)}

/* ================= eventi ================= */
function go(view){if(!V[view])return;S.view=view;if(location.hash.slice(1)!==view)history.replaceState(null,'','#'+view);draw();window.scrollTo(0,0)}
document.addEventListener('submit',e=>{e.preventDefault();if(main.contains(e.target))onAuthSubmit(e.target.id)});
document.addEventListener('click',e=>{
  const au=e.target.closest('[data-auth]');
  if(au){const k=au.dataset.auth;if(k==='logout'){logout('local');return}
    if(k==='copysecret'){navigator.clipboard?.writeText(S.enroll.secret).then(()=>toast('Chiave copiata'),()=>{});return}
    S.auth.mode=k;S.auth.err='';S.auth.msg='';draw();return}
  const g=e.target.closest('[data-go]');if(g&&!sheet.contains(g)){go(g.dataset.go);return}
  const a=e.target.closest('[data-act]');
  if(a&&main.contains(a)){const act=a.dataset.act;
    if(act==='prev'){S.ym=addM(S.ym,-1);ensureMonth(addM(S.ym,-5));draw()}
    else if(act==='next'&&S.ym<curYm()){S.ym=addM(S.ym,1);draw()}
    else if(act==='edit'){const t=S.tx.get(a.dataset.id);if(t)openEntry(t)}
    else if(act==='useavg'){const id=a.dataset.cat,val=Number(a.dataset.v);mutateSettings(s=>{s.cats.find(c=>c.id===id).budget=Math.round(val/500)*500||val})}
    else if(act==='form')openForm(a.dataset.k,a.dataset.id);
    else if(act==='acct'){const ac=accById(a.dataset.id);if(ac&&ac.since){S.fcat='a:'+ac.id;S.q='';go('movimenti')}else openForm('acc',a.dataset.id)}
    else if(act==='export')exportCsv();
    else if(act==='factors')openFactors();
    else if(act==='logout')logout('local');
    else if(act==='logoutall')logout('global');
    else if(act==='lockset'){ls.set('lockH',a.dataset.v);draw();toast('Blocco automatico aggiornato')}
    return}
  if(sheet.contains(e.target)){const k=e.target.closest('.pad [data-k]');if(k&&E){key(k.dataset.k);return}
    const b=e.target.closest('[data-e]');if(!b)return;const ev=b.dataset.e;
    if(ev==='close'){closeSheet();return}
    if(ev==='fsave'){saveForm();return}if(ev==='fdel'){delForm();return}
    if(ev==='addfactor'){addFactor();return}
    if(ev==='verifyfactor'){sb.auth.mfa.challengeAndVerify({factorId:F.enroll,code:v('fcode').replace(/\D/g,'')}).then(({error})=>{if(error)toast(authErr(error));else{toast('Dispositivo aggiunto');openFactors()}});return}
    if(ev==='unenroll'){sb.auth.mfa.unenroll({factorId:b.dataset.v}).then(({error})=>{if(error)toast(authErr(error));else{toast('Dispositivo rimosso');openFactors()}});return}
    if(!E)return;
    if(ev==='type'){keepExtra();E.type=b.dataset.v;if(E.cat&&catById(E.cat).type!==E.type)E.cat=null;if(E.type==='giro'&&(!E.to||E.to===E.acc))E.to=S.settings.accounts.find(a=>a.id!==E.acc)?.id;drawEntry()}
    else if(ev==='cat'){keepExtra();E.cat=b.dataset.v;drawEntry()}
    else if(ev==='acc'){keepExtra();E.acc=b.dataset.v;drawEntry()}
    else if(ev==='to'){keepExtra();E.to=b.dataset.v;drawEntry()}
    else if(ev==='more'){keepExtra();E.more=!E.more;drawEntry()}
    else if(ev==='save')saveEntry();else if(ev==='del')delEntry()}
});
ov.addEventListener('click',e=>{if(e.target===ov)closeSheet()});
document.getElementById('fab').addEventListener('click',()=>openEntry());
document.addEventListener('keydown',e=>{if(!ov.classList.contains('open'))return;if(e.key==='Escape'){closeSheet();return}
  if(E&&!/INPUT|SELECT/.test(document.activeElement?.tagName||'')){if(/^[0-9]$/.test(e.key))key(e.key);else if(e.key===','||e.key==='.')key(',');else if(e.key==='Backspace')key('⌫');else if(e.key==='Enter')saveEntry()}});
main.addEventListener('input',e=>{if(e.target.id==='q'){S.q=e.target.value;document.getElementById('list').innerHTML=listHtml()}
  if(e.target.id==='code'&&e.target.value.replace(/\D/g,'').length===6)e.target.form?.requestSubmit()});
main.addEventListener('change',e=>{const t=e.target;
  if(t.id==='fcat'){S.fcat=t.value;draw();return;document.getElementById('list').innerHTML=listHtml()}
  else if(t.id==='imp'&&t.files[0]){importCsv(t.files[0]);t.value=''}
  else if(t.dataset.bud){const val=parseEur(t.value);if(isNaN(val)){toast('Importo non valido');t.value='';return}const id=t.dataset.bud;
    if((catById(id).budget||0)!==val)mutateSettings(s=>{s.cats.find(c=>c.id===id).budget=val})}});
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(V[h]&&h!==S.view){S.view=h;draw()}});
{const h=location.hash.slice(1);if(V[h])S.view=h}
// ricarica i dati quando torni sull'app (altri dispositivi)
let lastSync=Date.now();
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState!=='visible'||S.phase!=='app')return;if(await idleCheck())return;if(Date.now()-lastSync<60000)return;lastSync=Date.now();
  try{await route();const from=S.loadedFrom;const rows=await fetchRange(from+'-01');S.tx=new Map(rows.map(t=>[t.id,t]));const {data:st}=await sb.from('settings').select('data').eq('user_id',S.uid).maybeSingle();if(st)S.settings=normSettings(st.data);reindex();await runRecurring();draw()}catch(e){console.warn(e)}});

/* ================= blocco automatico ================= */
function lockH(){const v=Number(ls.get('lockH'));return [1,8,24,168].includes(v)?v:24}
function touch(){ls.set('lastActive',String(Date.now()))}
async function logout(scope,msg){try{await sb.auth.signOut({scope})}catch(e){}S.phase='login';S.tx=new Map();S.settings=null;S.auth.err=msg||'';S.auth.msg='';closeSheet();draw()}
async function idleCheck(){const last=Number(ls.get('lastActive'))||0;
  if(last&&Date.now()-last>lockH()*3600e3){const {data:{session}}=await sb.auth.getSession();if(session){await logout('local','Sessione chiusa per inattività: accedi di nuovo.');return true}}
  touch();return false}
['pointerdown','keydown'].forEach(ev=>document.addEventListener(ev,()=>{if(S.phase==='app')touch()},{passive:true}));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&S.phase==='app')touch()});

/* ================= avvio ================= */
if(sb){sb.auth.onAuthStateChange((ev)=>{
  if(ev==='PASSWORD_RECOVERY'){S.recovery=true;touch();S.phase='boot';route()}
  else if(ev==='SIGNED_OUT'){S.phase='login';S.tx=new Map();S.settings=null;draw()}});}
draw();(async()=>{const fromLink=/access_token|type=recovery|[?&]code=/.test(location.hash+location.search);if(sb&&!fromLink)await idleCheck();else touch();route()})();
}
