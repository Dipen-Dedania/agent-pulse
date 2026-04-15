import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, callback: (event: any, ...args: any[]) => void) => {
    ipcRenderer.on(channel, (event, ...args) => callback(event, ...args));
  },
});
