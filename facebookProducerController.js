'use strict';
const { BrowserWindow, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { installProducerGuide } = require('./facebookProducerGuide');
const HOME = 'https://www.facebook.com/live/producer/v2/';
let popup = null;
let activeMode = 'connect';
let activeSourceId = null;
let isConnected = false;
let lastProducerUrl = HOME;
const savedPath = () => path.join(app.getPath('userData'),'facebook-producer-url.json');
function readUrls() {
  try {const value=JSON.parse(fs.readFileSync(savedPath(),'utf8'));return value?.bySource && typeof value.bySource==='object' ? value.bySource : {};}
  catch (_) {return {};}
}
const isProducerUrl = input => {
  try {const url=new URL(input);return url.protocol==='https:' && (url.hostname==='www.facebook.com'||url.hostname==='facebook.com') && /^\/live\/producer\/(?:v2\/)?(?:\d+\/)?/.test(url.pathname);}
  catch {return false;}
};
function recordUrl(url) {
  if (!isProducerUrl(url) || !/\/\d+\//.test(new URL(url).pathname)) return;
  lastProducerUrl=url;
  if (!activeSourceId) return;
  try {fs.writeFileSync(savedPath(),JSON.stringify({bySource:{...readUrls(),[activeSourceId]:url}}),{mode:0o600});}catch (_){}
}
function recoverUrl() {
  lastProducerUrl=HOME;
  const url=activeSourceId && readUrls()[activeSourceId];
  if(isProducerUrl(url))lastProducerUrl=url;
}
function getActiveSourceId(){return activeSourceId;}
function openFacebookProducer(mainWindow, options = {}) {
  activeMode = options.mode === 'publish' ? 'publish' : 'connect';
  activeSourceId = options.sourceId || activeSourceId;
  isConnected = false;
  if (popup && !popup.isDestroyed()) {popup.show();popup.focus();pushState();return popup;}
  recoverUrl();
  const win=new BrowserWindow({width:1100,height:850,minWidth:780,minHeight:580,
    parent:mainWindow&&!mainWindow.isDestroyed()?mainWindow:undefined,
    title:'Liturgia Stream · Facebook connection',backgroundColor:'#111b25',autoHideMenuBar:true,
    webPreferences:{partition:'persist:liturgia-facebook',contextIsolation:true,sandbox:true,nodeIntegration:false,preload:path.join(__dirname,'facebookProducerPreload.js')}
  });
  popup=win;
  const inject=async()=>{
    if(win.isDestroyed() || !isProducerUrl(win.webContents.getURL()))return;
    try {await win.webContents.executeJavaScript('('+installProducerGuide.toString()+')()',true);}catch (_){}
    pushState();
  };
  win.webContents.on('did-finish-load',inject);
  win.webContents.on('did-navigate-in-page',(_e,url)=>{recordUrl(url);void inject();});
  win.webContents.on('did-navigate',(_e,url)=>recordUrl(url));
  win.webContents.on('will-navigate',(event,url)=>{
    try { const u=new URL(url);if(u.protocol!=='https:' || !/(^|\.)facebook\.com$/.test(u.hostname)) {event.preventDefault();if(u.protocol==='https:') void shell.openExternal(url);} }catch (_){event.preventDefault();}
  });
  win.webContents.setWindowOpenHandler(({url})=>{
    if(isProducerUrl(url))void win.loadURL(url);
    else if(/^https:\/\//.test(url))void shell.openExternal(url);
    return {action:'deny'};
  });
  win.on('closed',()=>{if(popup===win)popup=null;activeSourceId=null;});
  void win.loadURL(lastProducerUrl).catch(()=>{if(!win.isDestroyed()&&lastProducerUrl!==HOME)void win.loadURL(HOME);});
  return win;
}
function pushState(){
  if(!popup||popup.isDestroyed())return;
  void popup.webContents.executeJavaScript('window.__liturgiaGuide?.setState('+JSON.stringify({mode:activeMode,connected:isConnected})+')').catch(()=>{});
}
function updateFacebookProducer(status){
  if(!popup||popup.isDestroyed()||!status?.sourceId||status.sourceId!==activeSourceId)return;
  if(status.state==='live'){
    isConnected=true;
    if(activeMode==='connect'){popup.close();return;}
    popup.show();popup.focus();
  }else if(status.state==='reconnecting'||status.state==='connecting'){isConnected=false;}
  pushState();
}
module.exports={openFacebookProducer,updateFacebookProducer,getActiveSourceId,isProducerUrl};
