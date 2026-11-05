import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../shared/contracts.ts';

function subscribe<Args extends unknown[]>(channel: string, callback: (...args: Args) => void) {
  const listener = (_event: Electron.IpcRendererEvent, ...args: Args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

const bridge: DesktopBridge = {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  setUsagePrice: price => ipcRenderer.invoke('usage:price', price),
  clearUsage: () => ipcRenderer.invoke('usage:clear'),
  setUsageScanning: enabled => ipcRenderer.invoke('usage:scanning', enabled),
  syncUsage: () => ipcRenderer.invoke('usage:sync'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: patch => ipcRenderer.invoke('settings:update', patch),
  getPet: () => ipcRenderer.invoke('pet:get'),
  getQuotaState: () => ipcRenderer.invoke('quota:get'),
  onQuotaState: callback => subscribe('quota:changed', callback),
  openUsage: () => ipcRenderer.send('quota:open'),
  petAction: action => ipcRenderer.invoke('pet:action', action),
  careInChat: action => ipcRenderer.invoke('chat:care', action),
  settlePetAction: id => ipcRenderer.send('pet:settle', id),
  cancelPetAction: id => ipcRenderer.send('pet:cancel', id),
  endPetRest: () => ipcRenderer.send('pet:end-rest'),
  petHit: active => ipcRenderer.send('pet:hit', active),
  petPress: active => ipcRenderer.send('pet:press', active),
  petKeyboard: active => ipcRenderer.send('pet:keyboard', active),
  petDrag: phase => ipcRenderer.send('pet:drag', phase),
  openChat: search => ipcRenderer.send('window:chat', search),
  openSettings: () => ipcRenderer.send('window:settings'),
  quit: () => ipcRenderer.send('window:quit'),
  closePanel: () => ipcRenderer.send('window:close'),
  minimizePanel: () => ipcRenderer.send('window:minimize'),
  onPointer: callback => subscribe('pet:pointer', callback),
  getChatVisible: () => ipcRenderer.invoke('chat:visible'),
  onChatVisibility: callback => subscribe('chat:visibility', callback),
  onAnimation: callback => subscribe('pet:animation', callback),
  onPetState: callback => subscribe('pet:state', callback),
  onSettings: callback => subscribe('settings:changed', callback),
  onSearchMode: callback => subscribe('chat:search', callback),
  onChat: callback => subscribe('chat:event', callback),
  onHistory: callback => subscribe('chat:history', callback),
  onAuth: callback => subscribe('auth:status', callback),
  getAuth: () => ipcRenderer.invoke('auth:get'),
  signIn: options => ipcRenderer.invoke('auth:signIn', options),
  cancelSignIn: () => ipcRenderer.send('auth:cancel'),
  signOut: () => ipcRenderer.invoke('auth:signOut'),
  getModels: () => ipcRenderer.invoke('ai:models'),
  resumeUsage: () => ipcRenderer.invoke('ai:resume'),
  listChats: () => ipcRenderer.invoke('chat:list'),
  newChat: () => ipcRenderer.invoke('chat:new'),
  renameChat: (id, title) => ipcRenderer.invoke('chat:rename', id, title),
  deleteChat: id => ipcRenderer.invoke('chat:delete', id),
  sendChat: input => ipcRenderer.invoke('chat:send', input),
  cancelChat: () => ipcRenderer.send('chat:cancel'),
  clearChats: () => ipcRenderer.invoke('data:clearChats'),
  resetPet: () => ipcRenderer.invoke('data:resetPet'),
  clearData: () => ipcRenderer.invoke('data:clear'),
  openLink: url => ipcRenderer.send('window:link', url),
  copyText: text => ipcRenderer.send('window:copy', text)
};
contextBridge.exposeInMainWorld('meow', bridge);

