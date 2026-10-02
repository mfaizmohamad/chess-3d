const J={k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"},x=i=>J[i]+"︎",Z={q:9,r:5,b:3,n:3,p:1,k:0},O={q:"Queen",r:"Rook",b:"Bishop",n:"Knight"},ee=[["Drag","Orbit camera"],["Shift + drag / right drag","Rotate board"],["Wheel / pinch","Zoom"],["Q / E","Board roll (Z)"],["W / S","Board pitch (X)"],["A / D","Board yaw (Y)"],["Arrow keys","Orbit camera"],["+ / -","Zoom"],["R","Reset view"],["F","Flip to other side"],["V","Top down"],["1 to 5","View presets"],["Space","Auto spin"],["U","Undo"],["N","New game"],["H","Hide / show HUD"]];function c(i,a,v){const g=document.createElement(i);return a&&(g.className=a),v!=null&&(g.innerHTML=v),g}function te({game:i,controls:a,stage:v,quality:g="high"}){const b=document.getElementById("hud");b.innerHTML="";const f=c("aside","col left");f.innerHTML=`
    <section class="card brand">
      <div class="brand-row">
        <div class="logo" aria-hidden="true">${x("n")}</div>
        <div><h1>Chess 3D</h1><p class="sub">Studio edition</p></div>
        <button class="icon-btn" id="btn-hide" title="Hide HUD (H)" aria-label="Hide HUD">&#x2715;</button>
      </div>
      <div class="turn" id="turn"><i class="dot w"></i><div><b id="turn-main">White to move</b><small id="turn-sub">&nbsp;</small></div></div>
    </section>

    <div class="tools" id="tools">
    <section class="card" data-card="view">
      <header><h2>View</h2><span class="chev"></span></header>
      <div class="body">
        <div class="presets" id="presets"></div>
        <div class="row three">
          <button class="btn" id="btn-flip" title="Flip to the other side (F)">Flip</button>
          <button class="btn toggle" id="btn-spin" title="Auto spin (Space)">Spin</button>
          <button class="btn" id="btn-reset" title="Reset view (R)">Reset</button>
        </div>
      </div>
    </section>

    <section class="card" data-card="gimbal">
      <header><h2>Board gimbal</h2><span class="chev"></span></header>
      <div class="body sliders" id="sliders"></div>
    </section>

    <section class="card" data-card="scene">
      <header><h2>Scene</h2><span class="chev"></span></header>
      <div class="body">
        <label class="field"><span>Lighting</span><select id="sel-light"></select></label>
        <label class="field"><span>Quality</span><select id="sel-quality">
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      </div>
    </section>
    </div>`;const L=c("aside","col right");L.innerHTML=`
    <section class="card" data-card="game">
      <header><h2>Game</h2><span class="chev"></span></header>
      <div class="body">
        <div class="row three">
          <button class="btn primary" id="btn-new" title="New game (N)">New game</button>
          <button class="btn" id="btn-undo" title="Undo (U)">Undo</button>
          <button class="btn" id="btn-help" title="Keyboard shortcuts (?)">Keys</button>
        </div>
        <div class="row ai">
          <label class="switch"><input type="checkbox" id="chk-ai"><span class="track"><i></i></span><em>vs computer</em></label>
          <select id="sel-ai-color" title="Your side"><option value="w">Play white</option><option value="b">Play black</option></select>
          <select id="sel-ai-level" title="Strength"><option value="2">Easy ~900</option><option value="3">Normal ~1200</option><option value="4">Hard ~1450</option></select>
        </div>
      </div>
    </section>

    <section class="card grow" data-card="moves">
      <header><h2>Moves</h2><span class="chev"></span></header>
      <div class="body">
        <ol class="moves" id="moves"></ol>
      </div>
    </section>

    <section class="card" data-card="captured">
      <header><h2>Captured</h2><span class="chev"></span></header>
      <div class="body">
        <div class="cap"><span class="who">By white</span><span class="glyphs b" id="cap-b"></span><span class="adv" id="adv-w"></span></div>
        <div class="cap"><span class="who">By black</span><span class="glyphs w" id="cap-w"></span><span class="adv" id="adv-b"></span></div>
      </div>
    </section>`;const h=c("div","help card");h.hidden=!0,h.innerHTML=`<header><h2>Keyboard and mouse</h2></header><dl>${ee.map(([e,s])=>`<dt>${e}</dt><dd>${s}</dd>`).join("")}</dl>`;const y=c("button","show-btn","Show HUD");y.hidden=!0;const B=c("button","drawer-btn","Controls");b.append(f,L,h,y,B);const t=(e,s=b)=>s.querySelector(e),X=()=>window.matchMedia("(max-width: 900px)").matches;b.querySelectorAll(".card[data-card] > header").forEach(e=>{e.addEventListener("click",()=>e.parentElement.classList.toggle("collapsed"))}),X()&&L.querySelectorAll(".card[data-card]").forEach(e=>{e.dataset.card!=="game"&&e.classList.add("collapsed")}),B.addEventListener("click",()=>{t("#tools").style.bottom=`${L.offsetHeight+20}px`,f.classList.toggle("open"),B.classList.toggle("on",f.classList.contains("open"))});const z=t("#presets");for(const e of a.presets){const s=c("button","btn preset",e);s.addEventListener("click",()=>a.setPreset(e)),z.append(s)}t("#btn-flip").addEventListener("click",()=>a.flip()),t("#btn-reset").addEventListener("click",()=>a.reset()),t("#btn-spin").addEventListener("click",()=>a.toggleSpin());const D=t("#sliders"),G=[["x","X","pitch"],["y","Y","yaw"],["z","Z","roll"]],E={};for(const[e,s,d]of G){const n=c("div","slider");n.innerHTML=`<label for="sl-${e}"><b>${s}</b><span>${d}</span></label>
      <input type="range" id="sl-${e}" min="-180" max="180" step="1" value="0">
      <output id="out-${e}">0&deg;</output>`,D.append(n);const o=n.querySelector("input"),k=n.querySelector("output");E[e]={input:o,out:k,sliding:!1},o.addEventListener("pointerdown",()=>{E[e].sliding=!0}),window.addEventListener("pointerup",()=>{E[e].sliding=!1}),o.addEventListener("input",()=>{a.setGimbal(e,+o.value),k.innerHTML=`${o.value}&deg;`}),o.addEventListener("dblclick",()=>{a.setGimbal(e,0)}),o.addEventListener("keydown",S=>S.stopPropagation())}const F=c("button","btn small","Level board");F.addEventListener("click",()=>a.levelBoard()),D.append(F);const $=t("#sel-light"),M=t("#sel-quality"),R=v.lightingPresets||[];for(const e of R)$.append(new Option(e,e));$.parentElement.hidden=!R.length,$.addEventListener("change",()=>v.setLightingPreset?.($.value)),M.value=g,M.addEventListener("change",()=>v.setQuality?.(M.value)),t("#btn-new").addEventListener("click",()=>{i.newGame(),r()}),t("#btn-undo").addEventListener("click",()=>{i.undo(),r()}),t("#btn-help").addEventListener("click",q);const u=t("#chk-ai"),I=t("#sel-ai-color"),W=t("#sel-ai-level");function T(){const e=I.value;i.setVsComputer(u.checked,{color:e==="w"?"b":"w",depth:+W.value}),u.checked&&a.setPreset(e==="w"?"White view":"Black view")}u.addEventListener("change",T),I.addEventListener("change",()=>{u.checked&&T()}),W.addEventListener("change",()=>{u.checked&&T()});function H(e){const s=e??!b.classList.contains("hidden");b.classList.toggle("hidden",s),y.hidden=!s,s&&(h.hidden=!0)}function q(){h.hidden=!h.hidden}t("#btn-hide").addEventListener("click",()=>H(!0)),y.addEventListener("click",()=>H(!1)),a.hooks.undo=()=>{i.undo(),r()},a.hooks.newGame=()=>{i.newGame(),r()},a.hooks.toggleHud=()=>H(),a.hooks.toggleHelp=q,window.addEventListener("keydown",e=>{e.key==="Escape"&&(h.hidden=!0,r(),i.pendingPromotion&&U?.())});const C=t("#moves");let K=null,V=!1;function A(e){const s=e.turn==="w",d=t(".turn .dot");d.className="dot "+e.turn;let n=s?"White to move":"Black to move",o=" ";if(e.over){const l=e.over.winner;n=e.over.reason==="checkmate"?`Checkmate. ${l==="w"?"White":"Black"} wins`:"Draw",o=e.over.reason==="checkmate"?"Game over":e.over.reason}else e.thinking?o="Computer is thinking":e.check?o="Check":e.vsComputer&&(o=e.turn===e.computerColor?"Computer to move":"Your move");t("#turn-main").textContent=n,t("#turn-sub").textContent=o,t(".turn").classList.toggle("check",!!e.check&&!e.over),t(".turn").classList.toggle("think",!!e.thinking);const k=e.moves.join(" ");if(k!==K){K=k,C.innerHTML="";for(let p=0;p<e.moves.length;p+=2){const P=c("li");P.innerHTML=`<span class="n">${p/2+1}.</span><span class="m">${e.moves[p]}</span><span class="m">${e.moves[p+1]||""}</span>`,p+1>=e.moves.length-1&&P.classList.add("latest"),C.append(P)}const l=C.querySelector(".latest");l&&l.scrollIntoView({block:"nearest"}),e.moves.length||C.append(c("li","empty","No moves yet. Click a piece to begin."))}const S=(l,p)=>Z[p]-Z[l];t("#cap-b").innerHTML=[...e.captured.b].sort(S).map(l=>`<i>${x(l)}</i>`).join(""),t("#cap-w").innerHTML=[...e.captured.w].sort(S).map(l=>`<i>${x(l)}</i>`).join(""),t("#adv-w").textContent=e.advantage>0?`+${e.advantage}`:"",t("#adv-b").textContent=e.advantage<0?`+${-e.advantage}`:"",t("#btn-undo").disabled=!e.canUndo,e.check&&!V&&!e.over&&j("Check"),V=e.check,u.checked!==e.vsComputer&&(u.checked=e.vsComputer)}i.on("change",A),A(i.getState());const m=document.getElementById("promo");let U=null;i.on("promotion",({color:e,choose:s})=>{m.innerHTML=`<div class="promo-card"><h3>Promote pawn</h3><div class="promo-row">${["q","r","b","n"].map(n=>`<button data-p="${n}" class="pbtn ${e}" title="${O[n]}"><span>${x(n)}</span><small>${O[n]}</small></button>`).join("")}</div></div>`,m.hidden=!1;const d=n=>{m.hidden=!0,U=null,s(n)};U=()=>d(null),m.querySelectorAll("button").forEach(n=>n.addEventListener("click",()=>d(n.dataset.p))),m.onclick=n=>{n.target===m&&d(null)}});const w=document.getElementById("banner");function r(){w.hidden=!0}i.on("gameover",e=>{const s=e.reason==="checkmate",d=s?"Checkmate":"Draw",n=s?`${e.winner==="w"?"White":"Black"} wins`:e.reason.charAt(0).toUpperCase()+e.reason.slice(1);w.innerHTML=`<div class="banner-card"><small>${e.result}</small><h2>${d}</h2><p>${n}</p>
      <div class="row"><button class="btn primary" id="bn-new">New game</button><button class="btn" id="bn-view">Review board</button></div></div>`,w.hidden=!1,w.querySelector("#bn-new").onclick=()=>{i.newGame(),r()},w.querySelector("#bn-view").onclick=r}),i.on("newgame",r);const N=document.getElementById("toast");let Y=0;function j(e){N.textContent=e,N.classList.add("show"),clearTimeout(Y),Y=setTimeout(()=>N.classList.remove("show"),1400)}let Q="";function _(){const e=a.gimbalDeg,s=`${e.x.toFixed(0)}|${e.y.toFixed(0)}|${e.z.toFixed(0)}|${a.spin}`;if(s!==Q){Q=s;for(const[d]of G){const n=E[d],o=Math.round(e[d]);n.sliding||(n.input.value=o),n.out.innerHTML=`${o}&deg;`}t("#btn-spin").classList.toggle("on",a.spin)}}return{sync:_,toast:j,toggleHud:H,toggleHelp:q,render:A}}export{te as createUI};
