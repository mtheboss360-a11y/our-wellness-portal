// The agenda's own screen: loads the field log, then hands it to Agenda.
//
// While it loads it shows the shape of what is coming rather than a spinner — the same
// skeleton treatment the dashboard uses, so a section change reads as the page filling in
// rather than as the portal stalling.
import { useEffect, useState } from 'react';
import { getField } from './lib/api';
import type { FieldLog } from '../data/field-data';
import Agenda from './Agenda';

export default function AgendaScreen({ today, onClose }: { today: string; onClose: () => void }) {
  const [log, setLog] = useState<FieldLog | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void getField()
      .then(r => { if (live) setLog(r.field); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'We couldn’t open your round.'); });
    return () => { live = false; };
  }, []);

  return <section className="network-page agenda-page" aria-labelledby="agenda-page-title">
    <div className="network-head">
      <h1 id="agenda-page-title" className="sr-only">Today’s round</h1>
      <button className="network-back" onClick={onClose}>Back to your dashboard</button>
    </div>

    {error && <div className="network-state" role="alert"><h2>We couldn’t open your round.</h2><p>{error}</p></div>}

    {!error && log === undefined && <div className="agenda" aria-busy="true">
      <div className="agenda-head"><div><div className="dash-skel dash-skel-line"/><div className="dash-skel dash-skel-title"/></div></div>
      <div className="agenda-totals">{[0, 1, 2, 3].map(n => <div key={n}><div className="dash-skel dash-skel-line"/></div>)}</div>
      <ol className="agenda-list">{[0, 1, 2, 3].map(n => <li className="agenda-stop" key={n}>
        <span className="agenda-n"/><div className="agenda-body"><div className="dash-skel dash-skel-line"/><div className="dash-skel dash-skel-big"/></div>
      </li>)}</ol>
      <p className="sr-only" role="status">Loading your round.</p>
    </div>}

    {!error && log === null && <div className="network-state">
      <h2>No rounds yet.</h2>
      <p>When a round is booked it appears here with the stops in order, when to arrive, and how long to allow.</p>
    </div>}

    {!error && log && <Agenda log={log} today={today}/>}
  </section>;
}
