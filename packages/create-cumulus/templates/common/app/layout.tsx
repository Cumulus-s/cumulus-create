import type { Metadata } from 'next';
import { jakarta, jetbrainsMono } from './fonts';
import { ThemeInit } from './components/ThemeInit';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('__APP_BASE_URL__'),
  title: '__COMPANY_NAME__ — Cumulus app',
  description:
    'A Cumulus app with Auth, DB, Knowledge, SDK, API, and MCP wiring.',
  openGraph: {
    type: 'website',
    siteName: '__COMPANY_NAME__',
    title: '__COMPANY_NAME__ — Cumulus app',
    description:
      'A Cumulus app with Auth, DB, Knowledge, SDK, API, and MCP wiring.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: '__COMPANY_NAME__ — Cumulus app',
    description:
      'A Cumulus app with Auth, DB, Knowledge, SDK, API, and MCP wiring.',
  },
};

// Runs synchronously as the first child of <body> so `data-theme` is set
// before any descendants paint. Set on <html> so the custom-property
// overrides cascade to html itself — otherwise overscroll/rubber-band
// reveals the default light --color-paper behind dark mode.
const themeBootScript = `(function(){try{var k='cumulus:theme';var s=localStorage.getItem(k);var t=(s==='light'||s==='dark'||s==='marquee'||s==='system')?s:'system';var r=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.setAttribute('data-theme',r);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
