(function(){
'use strict';
var KEY='wdc4_settings';
var settings={progress:true,autoPractice:true};
try{Object.assign(settings,JSON.parse(localStorage.getItem(KEY)||'{}'));}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(settings));}catch(e){}}
function activeScene(){
  try{
    if(window.game&&window.game.scene&&window.game.scene.getScenes){
      var s=window.game.scene.getScenes(true)||[];
      for(var i=0;i<s.length;i++) if(s[i]&&s[i].scene) return s[i];
    }
  }catch(e){}
  return null;
}
function addUI(){
  if(document.getElementById('wdc4-btn')) return;
  var style=document.createElement('style');
  style.textContent=`
  #wdc4-btn{position:fixed;right:10px;top:10px;z-index:99999;border:2px solid #c1fb3d;background:#111;color:#fff;border-radius:12px;padding:7px 10px;font:700 12px Arial;box-shadow:0 3px 12px #0008;touch-action:manipulation}
  #wdc4-panel{position:fixed;right:10px;top:52px;z-index:100000;width:245px;background:#111;color:#fff;border:2px solid #c1fb3d;border-radius:14px;padding:12px;font:13px Arial;box-shadow:0 8px 30px #000b;display:none}
  #wdc4-panel h3{margin:0 0 10px;font-size:16px} #wdc4-panel label{display:flex;gap:8px;align-items:center;padding:7px 0}
  #wdc4-panel button{width:100%;margin-top:7px;border:0;border-radius:9px;padding:9px;background:#c1fb3d;color:#111;font-weight:700}
  #wdc4-progress{position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:99998;width:min(360px,55vw);height:7px;background:#222;border:1px solid #555;border-radius:9px;overflow:hidden;display:none;pointer-events:none}
  #wdc4-fill{height:100%;width:0;background:#c1fb3d;transition:width .08s linear}
  #wdc4-pct{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99998;color:#fff;font:700 11px Arial;text-shadow:0 1px 3px #000;display:none;pointer-events:none}
  `;
  document.head.appendChild(style);
  var b=document.createElement('button'); b.id='wdc4-btn'; b.textContent='WD+'; b.onclick=function(){var p=document.getElementById('wdc4-panel');p.style.display=p.style.display==='block'?'none':'block';}; document.body.appendChild(b);
  var p=document.createElement('div'); p.id='wdc4-panel';
  p.innerHTML='<h3>Web Dashers Complete</h3><label><input id="wdc4-progress-cb" type="checkbox"> Fortschritt anzeigen</label><label><input id="wdc4-auto-cb" type="checkbox"> Auto-Checkpoints in Practice</label><button id="wdc4-cache">Cache reparieren / neu laden</button><button id="wdc4-close">Schließen</button>';
  document.body.appendChild(p);
  document.getElementById('wdc4-progress-cb').checked=!!settings.progress;
  document.getElementById('wdc4-auto-cb').checked=!!settings.autoPractice;
  document.getElementById('wdc4-progress-cb').onchange=function(){settings.progress=this.checked;save();};
  document.getElementById('wdc4-auto-cb').onchange=function(){settings.autoPractice=this.checked;save();};
  document.getElementById('wdc4-close').onclick=function(){p.style.display='none';};
  document.getElementById('wdc4-cache').onclick=function(){
    try{if(window.clearGameCache) window.clearGameCache(); else {localStorage.removeItem('webdash_assets_loaded');localStorage.removeItem('webdash_last_load_time');location.reload();}}catch(e){location.reload();}
  };
  var bar=document.createElement('div');bar.id='wdc4-progress';bar.innerHTML='<div id="wdc4-fill"></div>';document.body.appendChild(bar);
  var pct=document.createElement('div');pct.id='wdc4-pct';pct.textContent='0%';document.body.appendChild(pct);
}
function updateProgress(){
  var bar=document.getElementById('wdc4-progress'), pct=document.getElementById('wdc4-pct'), fill=document.getElementById('wdc4-fill');
  if(!bar||!settings.progress){if(bar)bar.style.display='none';if(pct)pct.style.display='none';return;}
  var s=activeScene();
  if(!s||!s._level||!Number.isFinite(s._playerWorldX)||!Number.isFinite(s._level.endXPos)||s._level.endXPos<=0){bar.style.display='none';pct.style.display='none';return;}
  var x=Math.max(0,Math.min(100,(s._playerWorldX/s._level.endXPos)*100));
  bar.style.display='block';pct.style.display='block';fill.style.width=x.toFixed(2)+'%';pct.textContent=Math.floor(x)+'%';
}
var lastAuto=0;
function autoCheckpoint(){
  if(!settings.autoPractice)return;
  var s=activeScene(); if(!s||!s.practiceMode||!s.practiceMode.practiceMode||!s._state||!s._player)return;
  var now=Date.now(); if(now-lastAuto<3500)return;
  if(s._state.isDead)return;
  try{if(s.practiceMode.saveCheckpoint(s._state,s._playerWorldX,s._cameraX,s))lastAuto=now;}catch(e){}
}
function boot(){addUI();setInterval(function(){updateProgress();autoCheckpoint();},120);}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
