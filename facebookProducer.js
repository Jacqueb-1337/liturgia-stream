'use strict';
const {BrowserWindow,shell}=require('electron');
const PRODUCER_URL='https://www.facebook.com/live/producer/';
let producerWindow=null;
function isFacebookNavigation(target){
  try{const u=new URL(target);return u.protocol==='https:'&&(u.hostname==='facebook.com'||u.hostname.endsWith('.facebook.com'))}catch(_){return false}
}
const css="@keyframes liturgia-facebook-pulse{0%,100%{outline:4px solid #ffe55a;box-shadow:0 0 15px 7px #ffc940aa}50%{outline:6px solid #fff5a6;box-shadow:0 0 32px 18px #ffd21a99}}\n.liturgia-fb-target{animation:liturgia-facebook-pulse 1s ease-in-out infinite!important;outline-offset:3px!important;border-radius:8px!important;position:relative!important;z-index:2147483600!important}\n#liturgia-facebook-guide{position:fixed!important;top:12px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483646!important;padding:12px 20px!important;max-width:calc(100vw - 40px)!important;border-radius:12px!important;background:#142538!important;color:white!important;box-shadow:0 10px 35px #000b!important;border:2px solid #ffdc63!important;text-align:center!important;font:600 15px/1.5 system-ui,sans-serif!important;pointer-events:none!important}";
const helperScript='('+"function installProducerGuide() {\n if (window.__liturgiaProducerHelper) return;\n const buttons=()=>[...document.querySelectorAll('button,[role=\"button\"],a,[role=\"radio\"],label')];\n const label=e=>(e.innerText||e.textContent||e.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim();\n const visible=e=>e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden';\n const find=exp=>buttons().find(el=>visible(el)&&exp.test(label(el))&&label(el).length<110);\n let clickedSetup=false,clickedSoftware=false;\n const tick=()=>{\n   if(!location.hostname.endsWith('facebook.com'))return;\n   let banner=document.querySelector('#liturgia-facebook-guide');\n   if(!banner){banner=document.createElement('div');banner.id='liturgia-facebook-guide';document.body?.appendChild(banner);}\n   const setup=find(/^set up live video$/i), software=find(/^streaming software\\b/i), live=find(/^go live$/i);\n   for(const el of document.querySelectorAll('.liturgia-fb-target'))el.classList.remove('liturgia-fb-target');\n   (setup||software||live)?.classList.add('liturgia-fb-target');\n   if(banner) banner.textContent=setup?'Liturgia Stream: preparing Facebook Live. The highlighted Setup button is being selected.'\n    :software?'Liturgia Stream: selecting Streaming software.'\n    :live?'Check the preview, then click the flashing Go Live button to publish.'\n    :'Liturgia Stream: sign in to Facebook or complete any required prompts.';\n   if(setup&&!clickedSetup){clickedSetup=true;setup.click();}\n   else if(software&&!clickedSoftware){clickedSoftware=true;software.click();}\n };\n window.__liturgiaProducerHelper={tick};\n const observer=new MutationObserver(()=>requestAnimationFrame(tick));\n observer.observe(document.documentElement,{childList:true,subtree:true});\n const interval=setInterval(tick,1300);\n window.addEventListener('pagehide',()=>{observer.disconnect();clearInterval(interval)});\n tick();\n}"+')()';
function openFacebookProducer(mainWindow){
 if(producerWindow&&!producerWindow.isDestroyed()){producerWindow.show();producerWindow.focus();return producerWindow}
 const win=new BrowserWindow({
   width:1100,height:850,minWidth:780,minHeight:580,
   parent:mainWindow&&!mainWindow.isDestroyed()?mainWindow:undefined,
   modal:false,title:'Liturgia Stream · Facebook Live setup',autoHideMenuBar:true,
   backgroundColor:'#131920',
   webPreferences:{partition:'persist:liturgia-facebook',contextIsolation:true,sandbox:true,nodeIntegration:false}
 });
 producerWindow=win;
 const inject=async()=>{
   if(win.isDestroyed()||!isFacebookNavigation(win.webContents.getURL()))return;
   try{await win.webContents.insertCSS(css)}catch(_){}
   try{await win.webContents.executeJavaScript(helperScript,true)}catch(_){}
 };
 win.webContents.on('did-finish-load',inject);
 win.webContents.on('did-navigate-in-page',inject);
 win.webContents.on('will-navigate',(event,url)=>{
   if(!isFacebookNavigation(url)){event.preventDefault();if(/^https?:\/\//.test(url))void shell.openExternal(url)}
 });
 win.webContents.setWindowOpenHandler(({url})=>{
   if(isFacebookNavigation(url))void win.loadURL(url);
   else if(/^https?:\/\//.test(url))void shell.openExternal(url);
   return {action:'deny'}
 });
 win.on('closed',()=>{if(producerWindow===win)producerWindow=null});
 void win.loadURL(PRODUCER_URL);
 return win;
}
module.exports={openFacebookProducer,isFacebookNavigation,PRODUCER_URL};
