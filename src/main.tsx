import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from './lib/session';
import Portal from './Portal';
import './styles.css';
// The design system is the last word: tokens first, then the screens built on them.
import './design.css';
// The route runner's planner. Scoped under .rr, so it neither reads from nor writes to the
// screens above: a field rep's phone and the practice's portal share the brand and nothing else.
import './runner.css';
createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><Portal/></SessionProvider></StrictMode>);
