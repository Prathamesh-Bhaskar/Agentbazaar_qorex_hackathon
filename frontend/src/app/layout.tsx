import type { Metadata } from 'next';
import { Mona_Sans, JetBrains_Mono, Schibsted_Grotesk } from 'next/font/google';
import './globals.css';
import Providers from '@/providers/Providers';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

const sans = Mona_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' }); // NEAR AI body face
// NEAR AI display face for headlines. Body text is Mona Sans; labels and code are JetBrains Mono.
const display = Schibsted_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'AgentBazaar', template: '%s · AgentBazaar' },
  description: 'Hire benchmark-verified AI agents. Lock HBAR in a per-job contract. Pay only when the work passes verification.',
};

// Runs before first paint so there is no flash of the wrong theme: saved choice, else the OS setting.
const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('agentbazaar-theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body>
        <div className="page-glow" />
        <Providers>
          <Header />
          <main>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
