import { useCallback } from 'react';
import type { Settings, ThemePreference } from '../shared/settings';
import { FocusGroup } from './components/FocusGroup';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { MasterCard } from './components/MasterCard';
import { RestorePanel } from './components/RestorePanel';
import { ThemePicker } from './components/ThemePicker';
import { Toast } from './components/Toast';
import { useExtensionMeta } from './hooks/useExtensionMeta';
import { useSettings, type ToggleKey } from './hooks/useSettings';
import { useEffectiveTheme } from './hooks/useTheme';

export function App({ initialSettings }: { initialSettings: Settings }) {
  const { settings, update, error, dismissError } = useSettings(initialSettings);
  const { version, shortcut } = useExtensionMeta();
  useEffectiveTheme(settings.theme);

  const setEnabled = useCallback((enabled: boolean) => update({ enabled }), [update]);
  const setFeature = useCallback((key: ToggleKey, value: boolean) => update({ [key]: value }), [update]);
  const setTheme = useCallback((theme: ThemePreference) => update({ theme }), [update]);

  return (
    <div className="app">
      <Header active={settings.enabled} />
      <main className="main">
        <MasterCard enabled={settings.enabled} onChange={setEnabled} />
        <FocusGroup settings={settings} onToggle={setFeature} />
        <ThemePicker value={settings.theme} onChange={setTheme} />
        <RestorePanel />
      </main>
      <Footer version={version} shortcut={shortcut} />
      <Toast message={error} onDismiss={dismissError} />
    </div>
  );
}
