"use strict";

// electron/preload.ts
var import_electron = require("electron");
function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  import_electron.ipcRenderer.on(channel, listener);
  return () => {
    import_electron.ipcRenderer.removeListener(channel, listener);
  };
}
var bridge = {
  getSettings: () => import_electron.ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => import_electron.ipcRenderer.invoke("settings:update", patch),
  getPet: () => import_electron.ipcRenderer.invoke("pet:get"),
  getQuotaState: () => import_electron.ipcRenderer.invoke("quota:get"),
  onQuotaState: (callback) => subscribe("quota:changed", callback),
  openUsage: () => import_electron.ipcRenderer.send("quota:open"),
  petAction: (action) => import_electron.ipcRenderer.invoke("pet:action", action),
  careInChat: (action) => import_electron.ipcRenderer.invoke("chat:care", action),
  settlePetAction: (id) => import_electron.ipcRenderer.send("pet:settle", id),
  cancelPetAction: (id) => import_electron.ipcRenderer.send("pet:cancel", id),
  endPetRest: () => import_electron.ipcRenderer.send("pet:end-rest"),
  petHit: (active) => import_electron.ipcRenderer.send("pet:hit", active),
  petPress: (active) => import_electron.ipcRenderer.send("pet:press", active),
  petKeyboard: (active) => import_electron.ipcRenderer.send("pet:keyboard", active),
  petDrag: (phase) => import_electron.ipcRenderer.send("pet:drag", phase),
  openChat: (search) => import_electron.ipcRenderer.send("window:chat", search),
  openSettings: () => import_electron.ipcRenderer.send("window:settings"),
  quit: () => import_electron.ipcRenderer.send("window:quit"),
  closePanel: () => import_electron.ipcRenderer.send("window:close"),
  minimizePanel: () => import_electron.ipcRenderer.send("window:minimize"),
  onPointer: (callback) => subscribe("pet:pointer", callback),
  getChatVisible: () => import_electron.ipcRenderer.invoke("chat:visible"),
  onChatVisibility: (callback) => subscribe("chat:visibility", callback),
  onAnimation: (callback) => subscribe("pet:animation", callback),
  onPetState: (callback) => subscribe("pet:state", callback),
  onSettings: (callback) => subscribe("settings:changed", callback),
  onSearchMode: (callback) => subscribe("chat:search", callback),
  onChat: (callback) => subscribe("chat:event", callback),
  onHistory: (callback) => subscribe("chat:history", callback),
  onAuth: (callback) => subscribe("auth:status", callback),
  getAuth: () => import_electron.ipcRenderer.invoke("auth:get"),
  signIn: (options) => import_electron.ipcRenderer.invoke("auth:signIn", options),
  cancelSignIn: () => import_electron.ipcRenderer.send("auth:cancel"),
  signOut: () => import_electron.ipcRenderer.invoke("auth:signOut"),
  getModels: () => import_electron.ipcRenderer.invoke("ai:models"),
  resumeUsage: () => import_electron.ipcRenderer.invoke("ai:resume"),
  listChats: () => import_electron.ipcRenderer.invoke("chat:list"),
  newChat: () => import_electron.ipcRenderer.invoke("chat:new"),
  renameChat: (id, title) => import_electron.ipcRenderer.invoke("chat:rename", id, title),
  deleteChat: (id) => import_electron.ipcRenderer.invoke("chat:delete", id),
  sendChat: (input) => import_electron.ipcRenderer.invoke("chat:send", input),
  cancelChat: () => import_electron.ipcRenderer.send("chat:cancel"),
  clearChats: () => import_electron.ipcRenderer.invoke("data:clearChats"),
  resetPet: () => import_electron.ipcRenderer.invoke("data:resetPet"),
  clearData: () => import_electron.ipcRenderer.invoke("data:clear"),
  openLink: (url) => import_electron.ipcRenderer.send("window:link", url),
  copyText: (text) => import_electron.ipcRenderer.send("window:copy", text)
};
import_electron.contextBridge.exposeInMainWorld("meow", bridge);
