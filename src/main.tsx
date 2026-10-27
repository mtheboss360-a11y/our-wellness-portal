import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from './lib/session';
import Portal from './Portal';
import './styles.css';
// The design system is the last word: tokens first, then the screens built on them.
import './design.css';
createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><Portal/></SessionProvider></StrictMode>);
