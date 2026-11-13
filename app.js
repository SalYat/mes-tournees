(function(){
"use strict";
/* ============================================================
   Mes Tournées — application web installable (Android / iOS / PC)
   Données partagées via Supabase (base + temps réel + photos).
   ============================================================ */
const CFG=window.MT_CONFIG||{};
const S={sb:null,session:null,canWrite:true,chauffeurs:[],tournees:[],loaded:false,err:null,
  mode:"chauffeur",meId:null,openTour:null,selId:null,scope:"jour",confirm:null,sheet:null,loginSent:false};
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};
S.mode=ls.get("mt_mode")||"chauffeur"; S.meId=ls.get("mt_me");

const MOTIFS=["Client absent","Adresse introuvable","Refusé par le client","Colis endommagé","Accès impossible","Autre"];
const ST_T={a_faire:"À faire",en_cours:"En cours",terminee:"Terminée"};
const ST_A={a_faire:"À faire",livre:"Livré",probleme:"Problème"};
const BUCKET="preuves";

const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const fmtDate=s=>{if(!s)return"";const [y,m,d]=s.split("-");const dt=new Date(+y,+m-1,+d);return s===today()?"Aujourd'hui":dt.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})};
const hhmm=iso=>iso?new Date(iso).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}):"";
const uuid=()=>(crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g,()=>(Math.random()*16|0).toString(16)));
const uid=()=>Math.random().toString(36).slice(2,10);
const initials=n=>(n||"?").split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
const chName=id=>(S.chauffeurs.find(c=>c.id===id)||{}).nom||"Non attribuée";
const tour=id=>S.tournees.find(t=>t.id===id);
const done=a=>a.statut==="livre"||a.statut==="probleme";
const statutOf=arr=>!arr.length?"a_faire":arr.every(done)?"terminee":arr.some(done)?"en_cours":"a_faire";
const counts=arr=>({tot:arr.length,ok:arr.filter(a=>a.statut==="livre").length,ko:arr.filter(a=>a.statut==="probleme").length});
const bar=arr=>{const c=counts(arr);if(!c.tot)return'<div class="bar"></div>';return`<div class="bar" role="img" aria-label="${c.ok} livrés, ${c.ko} problèmes sur ${c.tot}"><i class="b-ok" style="width:${c.ok/c.tot*100}%"></i><i class="b-ko" style="width:${c.ko/c.tot*100}%"></i></div>`};

/* correspondance application <-> colonnes de la base */
const MAP={chauffeurId:"chauffeur_id",debutLe:"debut_le",finLe:"fin_le",creeLe:"cree_le"};
const toDb=o=>{const r={};for(const k in o)r[MAP[k]||k]=o[k];return r};
const fromDb=o=>{const r={};const inv={};for(const k in MAP)inv[MAP[k]]=k;for(const k in o)r[inv[k]||k]=o[k];r.arrets=r.arrets||[];r.chauffeurId=r.chauffeurId||"";return r};

function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2800)}
function errMsg(e){
  if(e&&(e.code==="42501"||/permission|row-level/i.test(e.message||"")))return"Vous n'avez pas le droit de modifier ces données.";
  if(!navigator.onLine)return"Pas de réseau : la modification n'est pas enregistrée. Réessayez dès que le réseau revient.";
  return"Enregistrement impossible pour le moment. Réessayez dans un instant.";}

/* ---------- écritures ---------- */
const queues={};
function writeTour(id,patch){
  const run=async()=>{const {error}=await S.sb.from("tournees").update(toDb(patch)).eq("id",id);if(error)throw error};
  queues[id]=(queues[id]||Promise.resolve()).then(run,run).catch(e=>{toast(errMsg(e));loadAll()});
  return queues[id];
}
function setArrets(t,arrets,extra){
  const patch=Object.assign({arrets,statut:statutOf(arrets)},extra||{});
  if(patch.statut==="terminee"&&!t.finLe)patch.finLe=new Date().toISOString();
  if(patch.statut!=="terminee")patch.finLe=null;
  Object.assign(t,patch);render();
  return writeTour(t.id,patch);
}
const clone=t=>JSON.parse(JSON.stringify(t.arrets||[]));

/* ---------- conserver la saisie entre deux rendus ---------- */
function snapshotForm(){const o={};document.querySelectorAll("#app input[id],#app textarea[id],#app select[id],#sheet input[id],#sheet textarea[id]").forEach(el=>{if(el.type!=="file")o[el.id]=el.value});
  const a=document.activeElement;return{o,focus:a&&a.id,ss:a&&a.selectionStart,se:a&&a.selectionEnd}}
function restoreForm(s){for(const id in s.o){const el=document.getElementById(id);if(el)el.value=s.o[id]}
  if(s.focus){const el=document.getElementById(s.focus);if(el){el.focus();try{if(s.ss!=null)el.setSelectionRange(s.ss,s.se)}catch(e){}}}}

/* ---------- rendu ---------- */
function render(){
  $("#m-ch").setAttribute("aria-pressed",S.mode==="chauffeur");
  $("#m-re").setAttribute("aria-pressed",S.mode==="responsable");
  $("#modes").hidden=!S.session;
  const snap=snapshotForm();
  $("#app").innerHTML=!S.sb?viewSetup():!S.session?viewLogin():S.auth==="newpwd"?viewNewPwd():S.mode==="chauffeur"?viewDriver():viewManager();
  $("#sheet").innerHTML=S.sheet&&S.session?viewSheet():"";
  restoreForm(snap);
}

function viewSetup(){
  return`<div class="login card"><h1>Configuration requise</h1><p>L'application n'est pas encore reliée à sa base de données.</p>
    <p class="muted">Renseignez l'adresse et la clé de votre projet Supabase dans le fichier <b>config.js</b>, puis rechargez la page. Les étapes sont détaillées dans le fichier README du projet.</p></div>`;
}
/* écrans de connexion : login | signup | forgot | sent */
function viewLogin(){
  const m=S.auth||"login";
  if(m==="sent")return`<div class="login card"><h1>Vérifiez vos e-mails</h1><p>${esc(S.loginSent)}</p>
    <button type="button" class="btn primary" data-act="auth" data-v="login">Retour à la connexion</button></div>`;
  const mail=`<div class="field"><label for="lg-mail">Adresse e-mail</label><input type="email" autocomplete="username" id="lg-mail" placeholder="prenom.nom@entreprise.fr" required></div>`;
  const pwd=(id,label,ac)=>`<div class="field"><label for="${id}">${label}</label><input type="password" autocomplete="${ac}" id="${id}" minlength="6" required></div>`;
  if(m==="forgot")return`<form class="login card" data-form="forgot"><h1>Mot de passe oublié</h1>
    <p class="muted" style="margin:0">Entrez votre adresse e-mail : vous recevrez un lien pour choisir un nouveau mot de passe.</p>${mail}
    <button class="btn primary big">Envoyer le lien</button><button type="button" class="btn ghost" data-act="auth" data-v="login">Retour à la connexion</button></form>`;
  if(m==="signup")return`<form class="login card" data-form="signup"><h1>Créer un compte</h1>${mail}
    ${pwd("lg-pwd","Mot de passe (6 caractères minimum)","new-password")}${pwd("lg-pwd2","Confirmez le mot de passe","new-password")}
    <button class="btn primary big">Créer mon compte</button><button type="button" class="btn ghost" data-act="auth" data-v="login">J'ai déjà un compte</button></form>`;
  return`<form class="login card" data-form="login"><h1>Connexion</h1>${mail}${pwd("lg-pwd","Mot de passe","current-password")}
    <button class="btn primary big">Se connecter</button>
    <div class="row" style="justify-content:space-between"><button type="button" class="btn ghost sm" data-act="auth" data-v="forgot">Mot de passe oublié ?</button><button type="button" class="btn ghost sm" data-act="auth" data-v="signup">Créer un compte</button></div></form>`;
}
function viewNewPwd(){
  return`<form class="login card" data-form="newpwd"><h1>Choisir un mot de passe</h1>
    <p class="muted" style="margin:0">Il servira à vous connecter avec votre adresse e-mail, sans lien à ouvrir.</p>
    <div class="field"><label for="np-1">Nouveau mot de passe (6 caractères minimum)</label><input type="password" autocomplete="new-password" id="np-1" minlength="6" required></div>
    <div class="field"><label for="np-2">Confirmez le mot de passe</label><input type="password" autocomplete="new-password" id="np-2" minlength="6" required></div>
    <button class="btn primary big">Enregistrer</button>${S.recovery?"":`<button type="button" class="btn ghost" data-act="auth" data-v="">Annuler</button>`}</form>`;
}
function authErr(e){const m=(e&&e.message)||"";
  if(/invalid login/i.test(m))return"E-mail ou mot de passe incorrect.";
  if(/not confirmed/i.test(m))return"Adresse pas encore confirmée : ouvrez le lien reçu par e-mail à l'inscription.";
  if(/already registered|already exists/i.test(m))return"Un compte existe déjà avec cette adresse : connectez-vous.";
  if(/at least|password should/i.test(m))return"Mot de passe trop court : 6 caractères minimum.";
  if(/same.*password|different from the old/i.test(m))return"Choisissez un mot de passe différent de l'ancien.";
  if(/rate limit|security purposes/i.test(m))return"Trop de tentatives : patientez une minute puis réessayez.";
  return"Opération impossible : "+m;}

function loadingOrError(){
  if(S.err)return`<div class="empty">${esc(S.err)}</div>`;
  if(!S.loaded)return'<div class="empty">Chargement des tournées…</div>';
  return"";
}

/* ===== CHAUFFEUR ===== */
function viewDriver(){
  const w=loadingOrError();if(w)return`<div class="driver">${w}</div>`;
  const me=S.chauffeurs.find(c=>c.id===S.meId);
  if(!me){
    if(!S.chauffeurs.length)return`<div class="driver stack"><div class="hello"><h1>Bonjour</h1></div><div class="empty">Aucun chauffeur enregistré. Le responsable doit d'abord vous ajouter dans l'espace Responsable.</div></div>`;
    return`<div class="driver stack"><div class="hello"><h1>Bonjour, qui êtes-vous ?</h1><p class="muted">Touchez votre nom pour voir vos tournées.</p></div>
      <div class="who">${S.chauffeurs.map(c=>`<button type="button" data-act="me" data-id="${c.id}"><span class="avatar">${esc(initials(c.nom))}</span><span>${esc(c.nom)}</span></button>`).join("")}</div></div>`;
  }
  const t=S.openTour&&tour(S.openTour);
  if(t)return viewDriverTour(t,me);
  const mine=S.tournees.filter(x=>x.chauffeurId===me.id&&x.date>=today()).sort((a,b)=>a.date.localeCompare(b.date));
  const past=S.tournees.filter(x=>x.chauffeurId===me.id&&x.date<today()).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  const card=x=>{const c=counts(x.arrets);const st=x.statut||"a_faire";
    const label=st==="a_faire"?"Démarrer la tournée":st==="en_cours"?"Continuer":"Voir le détail";
    return`<div class="card tourcard"><div class="row" style="justify-content:space-between"><span class="label">${esc(fmtDate(x.date))}</span><span class="pill s-${st}">${ST_T[st]}</span></div>
      <h2>${esc(x.nom)}</h2><div class="row muted num">${c.tot} arrêts · ${c.ok} livrés${c.ko?` · ${c.ko} problème${c.ko>1?"s":""}`:""}</div>${bar(x.arrets)}
      <button type="button" class="btn ${st==="terminee"?"":"primary"} big" data-act="open" data-id="${x.id}">${label}</button></div>`};
  return`<div class="driver stack">
    <div class="row" style="justify-content:space-between"><div class="hello"><h1>Bonjour ${esc(me.nom.split(" ")[0])}</h1></div><button type="button" class="btn ghost sm" data-act="me" data-id="">Changer</button></div>
    ${mine.length?mine.map(card).join(""):'<div class="empty">Pas de tournée prévue pour vous. Revenez plus tard ou appelez votre responsable.</div>'}
    ${past.length?`<details><summary>Tournées précédentes</summary><div class="stack" style="margin-top:10px">${past.map(card).join("")}</div></details>`:""}
    <div class="row" style="justify-content:center"><button type="button" class="btn ghost sm" data-act="auth" data-v="newpwd">Changer mon mot de passe</button><button type="button" class="btn ghost sm" data-act="logout">Se déconnecter</button></div>
  </div>`;
}

function navLinks(adr){const q=encodeURIComponent(adr);
  return`<div class="nav"><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${q}">Google Maps</a><a class="btn" target="_blank" rel="noopener" href="https://waze.com/ul?q=${q}&navigate=yes">Waze</a><a class="btn" target="_blank" rel="noopener" href="https://maps.apple.com/?daddr=${q}">Plans</a></div>`}

function viewDriverTour(t,me){
  const arr=t.arrets;const c=counts(arr);
  const nextIdx=arr.findIndex(a=>!done(a));
  const head=`<div class="row" style="justify-content:space-between"><button type="button" class="btn ghost sm" data-act="close">‹ Mes tournées</button><span class="pill s-${t.statut||"a_faire"}">${ST_T[t.statut||"a_faire"]}</span></div>
    <div><span class="label">${esc(fmtDate(t.date))}</span><h1 style="font-size:30px">${esc(t.nom)}</h1></div>
    <div class="stack" style="gap:6px"><div class="row num" style="justify-content:space-between"><b>${c.ok+c.ko} / ${c.tot} arrêts faits</b><span class="muted">${c.ok} livrés${c.ko?` · ${c.ko} problème${c.ko>1?"s":""}`:""}</span></div>${bar(arr)}</div>`;
  let main="";
  if(!t.debutLe&&nextIdx!==-1){
    main=`<button type="button" class="btn primary big" data-act="start" data-id="${t.id}">Démarrer la tournée</button>`;
  }else if(nextIdx===-1){
    main=`<div class="card done-banner"><svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26" fill="var(--ok)"/><path d="M17 29l7 7 15-16" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2>Tournée terminée</h2><p class="muted">${c.ok} livrés, ${c.ko} problème${c.ko>1?"s":""}. Merci ${esc(me.nom.split(" ")[0])} !</p></div>`;
  }else{
    const a=arr[nextIdx];
    main=`<div class="next"><div class="row"><span class="marker next">${nextIdx+1}</span><span class="label">Prochain arrêt</span></div>
      <div><div class="client">${esc(a.client)}</div><div class="addr">${esc(a.adresse)}</div></div>
      ${a.tel?`<div class="row">Téléphone : <a href="tel:${esc(a.tel.replace(/\s/g,""))}" class="num" style="color:var(--ink);font-weight:700">${esc(a.tel)}</a></div>`:""}
      ${a.note?`<div class="note"><b>À savoir :</b> ${esc(a.note)}</div>`:""}
      ${navLinks(a.adresse)}
      <div class="act"><button type="button" class="btn ok big" data-act="sh-livre" data-id="${a.id}">Livré</button><button type="button" class="btn ko big" data-act="sh-pb" data-id="${a.id}">Problème</button></div></div>`;
  }
  const list=arr.map((a,i)=>`<div class="stop"><span class="marker ${a.statut!=="a_faire"?a.statut:i===nextIdx&&t.debutLe?"next":""}">${i+1}</span>
    <div class="txt"><b>${esc(a.client)}</b><span>${esc(a.adresse)}</span>${done(a)?`<span>${a.statut==="livre"?"Livré":"Problème : "+esc(a.motif||"")} à ${hhmm(a.heure)}</span>`:""}</div>
    ${done(a)?`<button type="button" class="btn ghost sm" data-act="undo" data-id="${a.id}">Annuler</button>`:""}</div>`).join("");
  return`<div class="driver stack">${head}${main}<div class="card"><div class="label" style="margin-bottom:4px">Tous les arrêts</div><div class="stoplist">${list||'<p class="muted">Aucun arrêt dans cette tournée.</p>'}</div></div></div>`;
}

function viewSheet(){
  const sh=S.sheet;const t=tour(S.openTour);const a=t&&t.arrets.find(x=>x.id===sh.stopId);if(!a)return"";
  if(sh.type==="livre")return`<div class="sheet-bg" data-act="sh-close"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t">
    <h2 id="sh-t">Livraison chez ${esc(a.client)}</h2>
    <div class="field"><label for="sh-nom">Remis à (facultatif)</label><input type="text" id="sh-nom" placeholder="Nom de la personne" autocomplete="off"></div>
    <div class="field"><label>Photo de preuve (facultatif)</label>
      ${sh.photo?`<img class="photo-prev" src="${esc(sh.photo)}" alt="Photo de la livraison">`:""}
      <span class="btn filebtn">${sh.uploading?"Envoi de la photo…":sh.photo?"Reprendre la photo":"Prendre une photo"}<input type="file" id="sh-file" accept="image/*" capture="environment" ${sh.uploading?"disabled":""}></span></div>
    <button type="button" class="btn ok big" data-act="do-livre" ${sh.uploading?"disabled":""}>Valider la livraison</button>
    <button type="button" class="btn ghost" data-act="sh-x">Annuler</button></div></div>`;
  return`<div class="sheet-bg" data-act="sh-close"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t">
    <h2 id="sh-t">Que s'est-il passé ?</h2><p class="muted" style="margin:0">${esc(a.client)} — ${esc(a.adresse)}</p>
    <div class="chips">${MOTIFS.map(m=>`<button type="button" data-act="motif" data-v="${esc(m)}" aria-pressed="${sh.motif===m}">${esc(m)}</button>`).join("")}</div>
    <div class="field"><label for="sh-note">Précision (facultatif)</label><textarea id="sh-note" placeholder="Ex. : avis de passage laissé"></textarea></div>
    <button type="button" class="btn ko fill big" data-act="do-pb" ${sh.motif?"":"disabled"}>Enregistrer le problème</button>
    <button type="button" class="btn ghost" data-act="sh-x">Annuler</button></div></div>`;
}

/* ===== RESPONSABLE ===== */
function viewManager(){
  const w=loadingOrError();if(w)return w;
  const d=today();
  const list=S.tournees.filter(t=>S.scope==="jour"?t.date===d:S.scope==="avenir"?t.date>d:t.date<d)
    .sort((a,b)=>S.scope==="passe"?b.date.localeCompare(a.date)||a.nom.localeCompare(b.nom):a.date.localeCompare(b.date)||a.nom.localeCompare(b.nom));
  const todays=S.tournees.filter(t=>t.date===d);const all=todays.flatMap(t=>t.arrets);const c=counts(all);
  if(S.selId&&S.selId!=="__ch"&&!tour(S.selId))S.selId=null;
  const sel=S.selId==="__ch"?null:tour(S.selId);
  return`<div class="kpis">
      <div class="kpi"><span class="label">Tournées du jour</span><b class="num">${todays.length}</b></div>
      <div class="kpi"><span class="label">Arrêts du jour</span><b class="num">${c.tot}</b></div>
      <div class="kpi ok"><span class="label">Livrés</span><b class="num">${c.ok}</b></div>
      <div class="kpi ko"><span class="label">Problèmes</span><b class="num">${c.ko}</b></div></div>
    <div class="mgr">
      <aside class="stack">
        <div class="row"><button type="button" class="btn primary" data-act="new-tour">+ Nouvelle tournée</button><button type="button" class="btn" data-act="sel" data-id="__ch">Chauffeurs</button></div>
        <div class="tabs seg" role="group" aria-label="Période">${[["jour","Aujourd'hui"],["avenir","À venir"],["passe","Historique"]].map(([k,l])=>`<button type="button" data-act="scope" data-v="${k}" aria-pressed="${S.scope===k}">${l}</button>`).join("")}</div>
        <div class="tlist">${list.length?list.map(t=>{const cc=counts(t.arrets);const st=t.statut||"a_faire";return`<button type="button" class="titem" data-act="sel" data-id="${t.id}" aria-current="${S.selId===t.id}">
          <div class="h"><b>${esc(t.nom)}</b><span class="pill s-${st}">${ST_T[st]}</span></div>
          <div class="row muted num" style="font-size:14px;gap:6px"><span>${esc(chName(t.chauffeurId))}</span>·<span>${esc(fmtDate(t.date))}</span>·<span>${cc.ok+cc.ko}/${cc.tot}</span>${cc.ko?`·<span style="color:var(--ko);font-weight:700">${cc.ko} pb</span>`:""}</div>${bar(t.arrets)}</button>`}).join(""):`<div class="empty">${S.scope==="jour"?"Aucune tournée aujourd'hui. Créez-en une avec « Nouvelle tournée ».":"Rien sur cette période."}</div>`}</div>
        ${S.scope==="passe"&&list.length?`<button type="button" class="btn" data-act="export">Exporter l'historique (CSV)</button>`:""}
        <div class="row"><button type="button" class="btn ghost sm" data-act="auth" data-v="newpwd">Changer mon mot de passe</button><button type="button" class="btn ghost sm" data-act="logout">Se déconnecter</button></div>
      </aside>
      <section class="detail">${S.selId==="__ch"?viewDrivers():sel?viewTourDetail(sel):'<div class="empty">Sélectionnez une tournée pour voir ses arrêts et suivre son avancement.</div>'}</section>
    </div>`;
}

function viewDrivers(){
  return`<div class="card stack"><h2 style="font-size:26px">Chauffeurs</h2>
    <div>${S.chauffeurs.map(c=>`<div class="drv"><span class="avatar">${esc(initials(c.nom))}</span><div class="txt"><b>${esc(c.nom)}</b><div class="muted num">${esc(c.tel||"")}</div></div>
      ${S.confirm===("ch:"+c.id)?`<button type="button" class="btn ko fill sm" data-act="del-ch-ok" data-id="${c.id}">Supprimer</button><button type="button" class="btn ghost sm" data-act="cancel">Non</button>`:`<button type="button" class="icon-btn" title="Supprimer ${esc(c.nom)}" aria-label="Supprimer ${esc(c.nom)}" data-act="del-ch" data-id="${c.id}">×</button>`}</div>`).join("")||'<p class="muted">Aucun chauffeur pour l\'instant.</p>'}</div>
    <form class="addgrid" data-form="add-ch" style="grid-template-columns:2fr 1.4fr auto"><input type="text" id="ch-nom" placeholder="Prénom et nom" required aria-label="Prénom et nom"><input type="tel" id="ch-tel" placeholder="06 12 34 56 78" aria-label="Téléphone"><button class="btn primary">Ajouter</button></form>
  </div>`;
}

function viewTourDetail(t){
  const arr=t.arrets;const id=t.id;
  const stops=arr.map((a,i)=>`<div class="mstop"><span class="marker ${a.statut!=="a_faire"?a.statut:""}">${i+1}</span>
    <div class="txt"><b>${esc(a.client)} <span class="pill s-${a.statut}" style="display:inline-flex;margin-left:6px;vertical-align:2px">${ST_A[a.statut]}</span></b><span>${esc(a.adresse)}${a.tel?" · "+esc(a.tel):""}</span>
      ${a.note?`<span>Note : ${esc(a.note)}</span>`:""}
      ${done(a)?`<div class="proof">${a.statut==="livre"?`Livré à ${hhmm(a.heure)}${a.recu?" · remis à "+esc(a.recu):""}`:`${esc(a.motif||"")} à ${hhmm(a.heure)}${a.commentaire?" · "+esc(a.commentaire):""}`}${a.photo?` · <a href="${esc(a.photo)}" target="_blank" rel="noopener">voir la photo</a>`:""}</div>`:""}</div>
    <div class="ctl">${S.confirm===("st:"+a.id)?`<button type="button" class="btn ko fill sm" data-act="del-st-ok" data-id="${a.id}">Retirer</button><button type="button" class="btn ghost sm" data-act="cancel">Non</button>`:
      `<button type="button" class="icon-btn" aria-label="Monter" title="Monter" data-act="up" data-id="${a.id}" ${i===0?"disabled":""}>↑</button><button type="button" class="icon-btn" aria-label="Descendre" title="Descendre" data-act="down" data-id="${a.id}" ${i===arr.length-1?"disabled":""}>↓</button><button type="button" class="icon-btn" aria-label="Retirer l'arrêt" title="Retirer" data-act="del-st" data-id="${a.id}">×</button>`}</div></div>`).join("");
  return`<div class="card stack">
      <div class="row" style="justify-content:space-between"><span class="pill s-${t.statut||"a_faire"}">${ST_T[t.statut||"a_faire"]}</span>
        <span class="muted num" style="font-size:14px">${t.debutLe?"Démarrée à "+hhmm(t.debutLe):"Pas encore démarrée"}${t.finLe?" · terminée à "+hhmm(t.finLe):""}</span></div>
      <div class="grid3">
        <div class="field"><label for="t-nom-${id}">Nom de la tournée</label><input type="text" id="t-nom-${id}" data-edit="nom" data-id="${id}" value="${esc(t.nom)}"></div>
        <div class="field"><label for="t-date-${id}">Date</label><input type="date" id="t-date-${id}" data-edit="date" data-id="${id}" value="${esc(t.date)}"></div>
        <div class="field"><label for="t-ch-${id}">Chauffeur</label><select id="t-ch-${id}" data-edit="chauffeurId" data-id="${id}"><option value="">Non attribuée</option>${S.chauffeurs.map(c=>`<option value="${c.id}" ${c.id===t.chauffeurId?"selected":""}>${esc(c.nom)}</option>`).join("")}</select></div>
      </div>
      ${bar(arr)}
    </div>
    <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:4px"><h2 style="font-size:24px">Arrêts <span class="muted num">(${arr.length})</span></h2><span class="muted" style="font-size:14px">L'ordre ici est l'ordre suivi par le chauffeur</span></div>
      ${stops||'<p class="muted">Aucun arrêt. Ajoutez-en ci-dessous.</p>'}</div>
    <div class="card stack"><h3 style="font-size:20px">Ajouter un arrêt</h3>
      <form class="stack" data-form="add-st" data-id="${id}">
        <div class="addgrid"><input type="text" id="as-client" placeholder="Client" aria-label="Client" required><input type="text" id="as-adr" placeholder="Adresse complète" aria-label="Adresse" required><input type="tel" id="as-tel" placeholder="Téléphone" aria-label="Téléphone"></div>
        <input type="text" id="as-note" placeholder="Note pour le chauffeur (code portail, étage…)" aria-label="Note">
        <div><button class="btn primary">Ajouter l'arrêt</button></div></form>
      <details><summary>Coller une liste depuis Excel</summary>
        <form class="stack" data-form="import" data-id="${id}" style="margin-top:8px">
          <p class="muted" style="margin:0;font-size:14px">Une ligne par arrêt, colonnes dans cet ordre : Client, Adresse, Téléphone, Note. Copiez directement les cellules depuis Excel, ou séparez par des points-virgules.</p>
          <textarea id="imp-${id}" placeholder="Boulangerie Martin;12 rue Nationale, 59000 Lille;03 20 00 00 00;Livrer avant 10h"></textarea>
          <div><button class="btn">Ajouter ces arrêts</button></div></form></details>
    </div>
    <div class="row" style="justify-content:flex-end">${S.confirm===("t:"+id)?`<div class="confirm"><span>Supprimer définitivement « ${esc(t.nom)} » ?</span><button type="button" class="btn ko fill sm" data-act="del-t-ok" data-id="${id}">Supprimer</button><button type="button" class="btn ghost sm" data-act="cancel">Annuler</button></div>`:
      `<button type="button" class="btn ghost" style="color:var(--ko)" data-act="del-t" data-id="${id}">Supprimer la tournée</button>`}</div>`;
}

/* ---------- actions ---------- */
document.addEventListener("click",async e=>{
  const el=e.target.closest("[data-act]");if(!el)return;
  const act=el.dataset.act,id=el.dataset.id,v=el.dataset.v;
  if(act==="sh-close"&&e.target!==el)return;
  const t=S.openTour&&tour(S.openTour);
  switch(act){
    case"mode":S.mode=v;ls.set("mt_mode",v);S.sheet=null;S.confirm=null;break;
    case"me":S.meId=id||null;ls.set("mt_me",id||null);S.openTour=null;break;
    case"open":S.openTour=id;window.scrollTo(0,0);break;
    case"close":S.openTour=null;break;
    case"auth":S.auth=v||null;break;
    case"logout":await S.sb.auth.signOut();return;
    case"start":{const tt=tour(id);if(tt){tt.debutLe=new Date().toISOString();tt.statut="en_cours";render();writeTour(id,{debutLe:tt.debutLe,statut:"en_cours"})}return}
    case"sh-livre":S.sheet={type:"livre",stopId:id};break;
    case"sh-pb":S.sheet={type:"probleme",stopId:id,motif:null};break;
    case"sh-close":case"sh-x":S.sheet=null;break;
    case"motif":S.sheet.motif=v;break;
    case"do-livre":case"do-pb":{if(!t||!S.sheet)return;const arr=clone(t);const a=arr.find(x=>x.id===S.sheet.stopId);if(!a)return;
      a.heure=new Date().toISOString();
      if(act==="do-livre"){a.statut="livre";a.recu=($("#sh-nom")||{}).value||"";a.photo=S.sheet.photo||null;a.motif=null;a.commentaire=null;}
      else{a.statut="probleme";a.motif=S.sheet.motif;a.commentaire=($("#sh-note")||{}).value||"";a.recu=null;}
      S.sheet=null;setArrets(t,arr,t.debutLe?null:{debutLe:new Date().toISOString()});toast(a.statut==="livre"?"Livraison enregistrée":"Problème enregistré");return}
    case"undo":{if(!t)return;const arr=clone(t);const a=arr.find(x=>x.id===id);if(!a)return;Object.assign(a,{statut:"a_faire",heure:null,recu:null,motif:null,commentaire:null,photo:null});setArrets(t,arr);toast("Arrêt remis à faire");return}
    case"scope":S.scope=v;S.selId=null;break;
    case"sel":S.selId=id;S.confirm=null;break;
    case"cancel":S.confirm=null;break;
    case"new-tour":{const nt={id:uuid(),nom:"Nouvelle tournée",date:today(),chauffeurId:"",statut:"a_faire",arrets:[],creeLe:new Date().toISOString()};
      const row=toDb(nt);row.chauffeur_id=null;
      const {error}=await S.sb.from("tournees").insert(row);if(error){toast(errMsg(error));return}
      S.tournees.push(nt);S.scope="jour";S.selId=nt.id;render();setTimeout(()=>{const i=document.getElementById("t-nom-"+nt.id);if(i){i.focus();i.select()}},50);return}
    case"up":case"down":{const tt=tour(S.selId);if(!tt)return;const arr=clone(tt);const i=arr.findIndex(x=>x.id===id);const j=act==="up"?i-1:i+1;if(i<0||j<0||j>=arr.length)return;[arr[i],arr[j]]=[arr[j],arr[i]];setArrets(tt,arr);return}
    case"del-st":S.confirm="st:"+id;break;
    case"del-st-ok":{const tt=tour(S.selId);if(!tt)return;S.confirm=null;setArrets(tt,clone(tt).filter(x=>x.id!==id));return}
    case"del-t":S.confirm="t:"+id;break;
    case"del-t-ok":{S.confirm=null;S.selId=null;S.tournees=S.tournees.filter(x=>x.id!==id);render();
      const {error}=await S.sb.from("tournees").delete().eq("id",id);toast(error?errMsg(error):"Tournée supprimée");if(error)loadAll();return}
    case"del-ch":S.confirm="ch:"+id;break;
    case"del-ch-ok":{S.confirm=null;const {error}=await S.sb.from("chauffeurs").delete().eq("id",id);toast(error?errMsg(error):"Chauffeur supprimé");loadAll();return}
    case"export":exportCsv();return;
  }
  render();
});

document.addEventListener("change",e=>{
  const el=e.target;
  if(el.dataset&&el.dataset.edit){const tt=tour(el.dataset.id);if(!tt)return;const k=el.dataset.edit;let val=el.value;
    if(k==="nom"){val=val.trim()||"Tournée sans nom"}
    if(k==="date"&&!val)return;
    if(tt[k]===val)return;tt[k]=val;
    writeTour(tt.id,{[k]:k==="chauffeurId"&&!val?null:val}).then(()=>toast("Enregistré"));if(k!=="nom")render();return}
  if(el.id==="sh-file"&&el.files&&el.files[0])uploadPhoto(el.files[0]);
});

document.addEventListener("submit",async e=>{
  const f=e.target.closest("form[data-form]");if(!f)return;e.preventDefault();
  const kind=f.dataset.form;
  const back=location.origin+location.pathname;
  if(kind==="login"||kind==="signup"||kind==="forgot"){
    const mail=$("#lg-mail").value.trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(mail)){toast("Adresse e-mail invalide.");return}
    const btn=f.querySelector("button.primary");btn.disabled=true;
    try{
      if(kind==="login"){const {error}=await S.sb.auth.signInWithPassword({email:mail,password:$("#lg-pwd").value});if(error)throw error;S.auth=null;}
      else if(kind==="signup"){const p=$("#lg-pwd").value;if(p!==$("#lg-pwd2").value){toast("Les deux mots de passe ne sont pas identiques.");return}
        const {data,error}=await S.sb.auth.signUp({email:mail,password:p,options:{emailRedirectTo:back}});if(error)throw error;
        if(data&&data.user&&Array.isArray(data.user.identities)&&!data.user.identities.length){toast("Un compte existe déjà avec cette adresse : connectez-vous.");S.auth="login";render();return}
        if(!data.session){S.auth="sent";S.loginSent="Un e-mail de confirmation a été envoyé à "+mail+". Ouvrez le lien une seule fois, ensuite vous vous connecterez avec votre mot de passe.";}
        else S.auth=null;}
      else{const {error}=await S.sb.auth.resetPasswordForEmail(mail,{redirectTo:back});if(error)throw error;
        S.auth="sent";S.loginSent="Si un compte existe pour "+mail+", un lien pour choisir un nouveau mot de passe vient d'être envoyé.";}
      render();
    }catch(err){toast(authErr(err))}finally{if(btn.isConnected)btn.disabled=false}
    return}
  if(kind==="newpwd"){const p=$("#np-1").value;if(p!==$("#np-2").value){toast("Les deux mots de passe ne sont pas identiques.");return}
    const {error}=await S.sb.auth.updateUser({password:p});if(error){toast(authErr(error));return}
    S.auth=null;S.recovery=false;toast("Mot de passe enregistré");render();return}
  if(kind==="add-ch"){const nom=$("#ch-nom").value.trim();if(!nom)return;const tel=$("#ch-tel").value.trim();
    const {error}=await S.sb.from("chauffeurs").insert({id:uuid(),nom,tel});
    if(error){toast(errMsg(error));return}$("#ch-nom").value="";$("#ch-tel").value="";toast(nom+" ajouté");loadAll();return}
  const tt=tour(f.dataset.id);if(!tt)return;
  if(kind==="add-st"){const client=$("#as-client").value.trim(),adresse=$("#as-adr").value.trim();if(!client||!adresse)return;
    const arr=clone(tt);arr.push({id:uid(),client,adresse,tel:$("#as-tel").value.trim(),note:$("#as-note").value.trim(),statut:"a_faire"});
    ["#as-client","#as-adr","#as-tel","#as-note"].forEach(s=>$(s).value="");setArrets(tt,arr);toast("Arrêt ajouté");setTimeout(()=>{const i=$("#as-client");i&&i.focus()},30);return}
  if(kind==="import"){const ta=document.getElementById("imp-"+tt.id);const lines=ta.value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const arr=clone(tt);let n=0;
    lines.forEach(l=>{const p=(l.includes("\t")?l.split("\t"):l.split(";")).map(x=>x.trim());if(p.length<2||!p[0]||!p[1])return;
      if(/^client$/i.test(p[0]))return;arr.push({id:uid(),client:p[0],adresse:p[1],tel:p[2]||"",note:p[3]||"",statut:"a_faire"});n++});
    if(!n){toast("Aucune ligne reconnue : il faut au moins un client et une adresse par ligne.");return}
    ta.value="";setArrets(tt,arr);toast(n+" arrêt"+(n>1?"s":"")+" ajouté"+(n>1?"s":""));}
});

document.addEventListener("keydown",e=>{if(e.key==="Escape"&&S.sheet){S.sheet=null;render()}});

/* ---------- photo de preuve ---------- */
function shrink(file){return new Promise((res,rej)=>{const img=new Image();const url=URL.createObjectURL(file);
  img.onload=()=>{const k=Math.min(1,1200/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);c.toBlob(b=>b?res(b):rej(new Error("photo")),"image/jpeg",.72)};
  img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("photo"))};img.src=url})}
async function uploadPhoto(file){if(!S.sheet)return;S.sheet.uploading=true;render();
  try{const blob=await shrink(file);const path=today()+"/"+uuid()+".jpg";
    const {error}=await S.sb.storage.from(BUCKET).upload(path,blob,{contentType:"image/jpeg"});if(error)throw error;
    const {data}=S.sb.storage.from(BUCKET).getPublicUrl(path);if(S.sheet)S.sheet.photo=data.publicUrl}
  catch(err){toast("La photo n'a pas pu être envoyée. Vous pouvez valider sans photo.")}
  if(S.sheet)S.sheet.uploading=false;render()}

/* ---------- export ---------- */
function exportCsv(){
  const d=today();const rows=[["Date","Tournée","Chauffeur","Ordre","Client","Adresse","Téléphone","Statut","Heure","Remis à","Motif","Précision"]];
  S.tournees.filter(t=>t.date<d).sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>t.arrets.forEach((a,i)=>rows.push([t.date,t.nom,chName(t.chauffeurId),i+1,a.client,a.adresse,a.tel||"",ST_A[a.statut],hhmm(a.heure),a.recu||"",a.motif||"",a.commentaire||""])));
  const csv="﻿"+rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(";")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");
  a.href=url;a.download="historique-tournees-"+d+".csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}

/* ---------- données ---------- */
let loadTimer=null;
async function loadAll(){
  const [ch,tr]=await Promise.all([S.sb.from("chauffeurs").select("*").order("nom"),S.sb.from("tournees").select("*")]);
  if(ch.error||tr.error){S.err=navigator.onLine?"Impossible de charger les données. Vérifiez la configuration Supabase (voir README).":"Pas de réseau. Les tournées s'afficheront dès le retour de la connexion.";render();return}
  S.err=null;S.chauffeurs=ch.data;S.tournees=tr.data.map(fromDb);S.loaded=true;render();
}
const reload=()=>{clearTimeout(loadTimer);loadTimer=setTimeout(loadAll,250)};
let channel=null;
function startData(){
  if(channel)return;
  loadAll();
  channel=S.sb.channel("mt").on("postgres_changes",{event:"*",schema:"public",table:"tournees"},reload)
    .on("postgres_changes",{event:"*",schema:"public",table:"chauffeurs"},reload).subscribe();
}
function stopData(){if(channel){S.sb.removeChannel(channel);channel=null}S.loaded=false;S.chauffeurs=[];S.tournees=[]}
window.addEventListener("online",()=>{if(S.session)loadAll()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&S.session)loadAll()});

/* ---------- démarrage ---------- */
if(CFG.supabaseUrl&&CFG.supabaseAnonKey&&window.supabase){
  S.sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey);
  S.sb.auth.onAuthStateChange((ev,session)=>{S.session=session;
    if(ev==="PASSWORD_RECOVERY"){S.auth="newpwd";S.recovery=true}
    if(session){startData()}else{stopData();if(S.auth==="newpwd")S.auth=null}
    render()});
  S.sb.auth.getSession().then(({data})=>{S.session=data.session;if(S.session)startData();render()});
}
render();
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
