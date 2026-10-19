'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('liturgiaProducer',{
  useStreamKey:(key)=>ipcRenderer.invoke('stream:facebook:use-key',key),
  cancelConnection:()=>ipcRenderer.invoke('stream:facebook:cancel')
});
