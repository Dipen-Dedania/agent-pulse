import { contextBridge, ipcRenderer } from 'electron';

// Keep a map so we can remove the exact wrapper ipcRenderer registered
const listenerMap = new WeakMap<Function, (...args: any[]) => void>();

contextBridge.exposeInMainWorld('electron', {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, callback: (event: any, ...args: any[]) => void) => {
    const wrapper = (event: any, ...args: any[]) => callback(event, ...args);
    listenerMap.set(callback, wrapper);
    ipcRenderer.on(channel, wrapper);
  },
  off: (channel: string, callback: (event: any, ...args: any[]) => void) => {
    const wrapper = listenerMap.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper);
      listenerMap.delete(callback);
    }
  },
});
