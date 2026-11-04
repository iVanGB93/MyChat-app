import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useSyncExternalStore } from 'react';
import {subscribeLanguage,languageSnapshot,languagePreference,type LanguagePreference} from '../localization/language';
import {initializeLanguage,setLanguagePreference,observeDeviceLanguage} from '../localization/deviceLanguage';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LightColors, DarkColors, type ThemeColors } from '../theme';
import StartupScreen from '../components/startup-screen';

type ThemeMode = 'light' | 'dark';
type ThemePreference = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = '@axonic_theme_preference';

interface ThemeContextValue {
  colors: ThemeColors;
  mode: ThemeMode;
  isDark: boolean;
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  languagePreference: LanguagePreference;
  setLanguagePreference: typeof setLanguagePreference;
  languageRevision: number;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: LightColors,
  mode: 'light',
  isDark: false,
  preference: 'system',
  setPreference: () => {},
  languagePreference:'system',setLanguagePreference,languageRevision:0,
});

/** Reliable system scheme — Appearance.getColorScheme() is synchronous and
 *  always correct, unlike useColorScheme() which can return null before the
 *  native bridge initialises on New Architecture / Android. */
function useSystemScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>(
    () => Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setScheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, []);
  return scheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const languageRevision=useSyncExternalStore(subscribeLanguage,languageSnapshot,languageSnapshot);
  useEffect(observeDeviceLanguage,[]);
  const systemScheme = useSystemScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [loaded, setLoaded] = useState(false);

  // Load saved preference on mount
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(THEME_STORAGE_KEY).catch(()=>null),initializeLanguage()])
      .then(([saved]) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setPreferenceState(saved);
        }
      })
      .catch(()=>{}).finally(() => setLoaded(true));
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(THEME_STORAGE_KEY, pref).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const resolvedMode: ThemeMode =
      preference === 'system' ? systemScheme : preference;
    return {
      colors: resolvedMode === 'dark' ? DarkColors : LightColors,
      mode: resolvedMode,
      isDark: resolvedMode === 'dark',
      preference,
      setPreference,
      languagePreference:languagePreference(),setLanguagePreference,languageRevision,
    };
  }, [systemScheme, preference, setPreference,languageRevision]);

  if (!loaded) return <StartupScreen />;

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Hook — returns { colors, mode, isDark, preference, setPreference } */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
