import type { Locale } from './i18n.ts';
import type { ChatPetEffect } from './chatCare.ts';
import type { ModelPrice, UsageData } from './usage.ts';

export type WindowKind = 'pet' | 'chat' | 'settings';
export type Animation = 'idle' | 'blink' | 'happy' | 'petting' | 'eating' | 'thinking' |
  'speaking' | 'sleeping' | 'waking' | 'dragging' | 'error' | 'greet' | 'farewell' | 'stretch' | 'tail' |
  'yarn' | 'reading' | 'math' | 'experiment';
export const skinIds = ['original', 'ragdoll', 'british', 'calico'] as const;
export type SkinId = typeof skinIds[number];
export type Food = 'fish' | 'can' | 'treat';
export type PetAction = { type: 'pet' | 'play' | 'sleep' | 'wake' } | { type: 'feed'; food: Food };
export interface PetState {
  fullness: number;
  mood: number;
  affection: number;
  lastInteractionAt: number;
  restingSince?: number;
  careHintAt?: number;
}
export type PetGains = Partial<Record<'fullness' | 'mood' | 'affection', number>>;
export interface Settings {
  locale: Locale;
  petName: string;
  skin: SkinId;
  size: number;
  alwaysOnTop: boolean;
  positionLocked: boolean;
  avoidFullscreen: boolean;
  startOnLogin: boolean;
  opacity: number;
  animation: 'gentle' | 'full';
  quiet: boolean;
  tone: 'normal' | 'cute' | 'professional';
  length: 'short' | 'standard' | 'detailed';
  model: string;
}
export type QuotaState = 'view' | 'limited' | 'connect';
export const chatgptUsageUrl = 'https://chatgpt.com/settings/usage?tab=overview';
export interface Point { x: number; y: number }
export interface Account { id: string; email?: string; name?: string }
export interface AuthStatus {
  state: 'signed-out' | 'identity-only' | 'connected' | 'expired' | 'ineligible' | 'network' |
    'denied' | 'limited' | 'error';
  account?: Account;
  accounts?: Account[];
  message?: string;
}
export interface SignInOptions { reconsent?: boolean; addAccount?: boolean; accountId?: string }
export interface Model { id: string; name: string; search?: boolean }
export interface Source { url: string; title: string; date?: string }
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  sources?: Source[];
  search?: 'used' | 'unavailable' | 'unused';
  status?: 'streaming' | 'complete' | 'cancelled' | 'error';
  error?: string;
  diagnostic?: string;
  completedAt?: number;
  petEffect?: ChatPetEffect;
}
export interface Conversation { id: string; title: string; messages: Message[]; updatedAt: number }
export interface ChatEvent { conversationId: string; message: Message }
export interface ChatSendInput {
  id: string; text: string; search: boolean; model?: string; retry?: boolean; recover?: boolean;
}
export type ChatSendResult = { status: 'care-required'; pet: PetState } | { status: 'complete' };
export interface DesktopBridge {
  getUsage(): Promise<UsageData>;
  setUsagePrice(price: ModelPrice): Promise<void>;
  clearUsage(): Promise<void>;
  setUsageScanning(enabled: boolean): Promise<void>;
  syncUsage(): Promise<void>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  getPet(): Promise<PetState>;
  getQuotaState(): Promise<QuotaState>;
  onQuotaState(callback: (state: QuotaState) => void): () => void;
  openUsage(): void;
  petAction(action: PetAction): Promise<boolean>;
  careInChat(action: PetAction): Promise<boolean>;
  settlePetAction(id: string): void;
  cancelPetAction(id: string): void;
  endPetRest(): void;
  petHit(active: boolean): void;
  petPress(active: boolean): void;
  petKeyboard(active: boolean): void;
  petDrag(phase: 'start' | 'move' | 'end'): void;
  openChat(search?: boolean): void;
  openSettings(): void;
  quit(): void;
  closePanel(): void;
  minimizePanel(): void;
  onPointer(callback: (point: Point | null) => void): () => void;
  getChatVisible(): Promise<boolean>;
  onChatVisibility(callback: (visible: boolean) => void): () => void;
  onAnimation(callback: (animation: Animation, food?: Food, careId?: string) => void): () => void;
  onPetState(callback: (state: PetState, gains?: PetGains) => void): () => void;
  onSettings(callback: (settings: Settings) => void): () => void;
  onSearchMode(callback: (search: boolean) => void): () => void;
  onChat(callback: (event: ChatEvent) => void): () => void;
  onHistory(callback: () => void): () => void;
  onAuth(callback: (auth: AuthStatus) => void): () => void;
  getAuth(): Promise<AuthStatus>;
  signIn(options?: SignInOptions): Promise<AuthStatus>;
  cancelSignIn(): void;
  signOut(): Promise<AuthStatus>;
  getModels(): Promise<Model[]>;
  resumeUsage(): Promise<AuthStatus>;
  listChats(): Promise<Conversation[]>;
  newChat(): Promise<Conversation>;
  renameChat(id: string, title: string): Promise<void>;
  deleteChat(id: string): Promise<void>;
  sendChat(input: ChatSendInput): Promise<ChatSendResult>;
  cancelChat(): void;
  clearChats(): Promise<void>;
  resetPet(): Promise<void>;
  clearData(): Promise<void>;
  openLink(url: string): void;
  copyText(text: string): void;
}
declare global {
  interface Window { meow: DesktopBridge }
}

