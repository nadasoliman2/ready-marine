'use client';

import { AppProvider } from '../context/AppContext';

export default function Providers({ children, initialLanguage, initialTheme }) {
  return <AppProvider initialLanguage={initialLanguage} initialTheme={initialTheme}>{children}</AppProvider>;
}
