'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('liturgiaProducer',{
  useCopiedKey:()=>ipcRenderer.invoke('stream:facebook:use-clipboard-key')
});
