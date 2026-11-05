import { createRoot } from 'react-dom/client';
import PetWindow from './pet/PetWindow.tsx';
import { ChatWindow } from './ChatWindow.tsx';
import { SettingsWindow } from './SettingsWindow.tsx';
import './styles.css';

const kind = location.hash.slice(1);
document.documentElement.dataset.window = kind;
function setLanguage(settings: { locale: string }) {
  document.documentElement.lang = settings.locale;
}
window.meow.onSettings(setLanguage);
void window.meow.getSettings().then(setLanguage);
createRoot(document.getElementById('root')!).render(
  kind === 'pet' ? <PetWindow /> : kind === 'settings' ? <SettingsWindow /> : <ChatWindow />
);

