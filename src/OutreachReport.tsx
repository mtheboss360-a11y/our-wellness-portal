// YOUR REPORT. What the outreach actually produced, with the five measures kept apart.
//
// The headline of this screen is the separation, not the totals. Each card says what its
// number is, and the ones that are routinely misread say what they are not — a scan is not an
// appointment, an inquiry count is a floor because it only has the people who said something.
// A measure the portal has no rows for reads "Not recorded", never zero.
import { useEffect, useState } from 'react';
import { getField } from './lib/api';
import type { Campaign } from '../data/portal-data';
import type { FieldLog } from '../data/field-data';
import { activity, byMonth, bySource, measures, monthName, type Measure } from './lib/report-math';
import { dateLabel, number } from './lib/portal-math';

export default function OutreachReport({ campaigns, children }: { campaigns: Campaign[]; children?: React.ReactNode }) {
  const [log, setLog] = useState<FieldLog | null>(null);
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  useEffect(() => {
    let live = true;
    void getField().then(r => { if (live) { setLog(r.field); setState('ready'); } }).catch(() => { if (live) setState('ready'); });
    return () => { live = false; };
  }, []);

  const cards = measures(log, campaigns);
  const months = byMonth(log, campaigns);
  const sources = bySource(log, campaigns);
  const recent = activity(log);
  const nothing = cards.every(card => !card.recorded);

  if (state === 'loading') return <section className="rep" aria-busy="true">
    <div className="rep-head"><div className="dash-skel dash-skel-title"/></div>
    <div className="rep-cards">{[0, 1, 2, 3, 4].map(n => <div className="rep-card" key={n}><div className="dash-skel dash-skel-line"/><div className="dash-skel dash-skel-big"/></div>)}</div>
  </section>;

  return <section className="rep" aria-labelledby="rep-title">
    <div className="rep-head">
      <h2 id="rep-title">Outreach report</h2>
      <p>Everything recorded from your community outreach, each measure on its own.</p>
    </div>

    {nothing
      ? <div className="dash-empty-page">
          <h2>Nothing recorded yet.</h2>
          <p>Once your first visit or campaign is logged, this page fills in. Until then there is nothing to report, which is not the same as nothing happening.</p>
        </div>
      : <>
        <dl className="rep-cards">{cards.map(card => <MeasureCard key={card.key} card={card}/>)}</dl>

        <p className="rep-caveat" role="note">
          <strong>Scans are not appointments.</strong> A tap on a card shows interest. An appointment appears
          here only where your front desk recorded one. And anyone who came in without saying where they
          heard of you is not in the inquiry count, so a low number there can mean nobody asked.
        </p>

        {months.length > 1 && <ActivityChart rows={months}/>}

        <div className="rep-split">
          <SourceTable rows={sources}/>
          <RecentLog rows={recent}/>
        </div>
      </>}

    {children}
  </section>;
}

function MeasureCard({ card }: { card: Measure }) {
  return <div className={`rep-card ${card.recorded ? '' : 'is-unrecorded'}`}>
    <dt>{card.label}</dt>
    <dd>{card.recorded ? number(card.value) : <span className="rep-none">Not recorded</span>}</dd>
    <p className="rep-note">{card.recorded ? card.note : 'The portal has no rows of this kind for you yet.'}</p>
    {card.recorded && card.caution && <p className="rep-caution">{card.caution}</p>}
  </div>;
}

/**
 * Four measures over the months that have any. Bars rather than lines: these are counts of
 * separate things, not one thing moving, and a line between them would imply a trend across
 * kinds that does not exist.
 */
function ActivityChart({ rows }: { rows: ReturnType<typeof byMonth> }) {
  const series = [
    { key: 'visits' as const, label: 'Visits' },
    { key: 'materials' as const, label: 'Materials' },
    { key: 'scans' as const, label: 'Scans' },
    { key: 'inquiries' as const, label: 'Inquiries' },
  ].filter(s => rows.some(row => row[s.key] > 0));
  // Each measure is scaled against its own best month. A shared scale would be honest about
  // magnitude and useless to look at: five hundred flyers next to twelve visits leaves the
  // visits invisible. Heights compare a measure with itself, and the note below says so.
  const top = Object.fromEntries(series.map(s => [s.key, Math.max(1, ...rows.map(row => row[s.key]))])) as Record<string, number>;
  return <section className="rep-chart" aria-labelledby="chart-title">
    <div className="rep-chart-head">
      <h3 id="chart-title">Activity over time</h3>
      <ul className="rep-legend">{series.map(s => <li key={s.key}><i className={`lg-${s.key}`}/>{s.label}</li>)}</ul>
    </div>
    <div className="rep-plot" role="img" aria-label={series.map(s => `${s.label}: ${rows.map(r => `${monthName(r.month)} ${r[s.key]}`).join(', ')}`).join('. ')}>
      {rows.map(row => <div className="rep-month" key={row.month}>
        <div className="rep-bars">{series.map(s => <span key={s.key} className={`lg-${s.key}`} style={{ height: `${(row[s.key] / top[s.key]) * 100}%` }}>
          <b>{number(row[s.key])}</b>
        </span>)}</div>
        <span className="rep-month-label">{monthName(row.month)}</span>
      </div>)}
    </div>
    <p className="rep-panel-note">Each measure is scaled to its own best month, so a bar compares that measure with itself and not with the others. The figure above each bar is the count.</p>
  </section>;
}

function SourceTable({ rows }: { rows: ReturnType<typeof bySource> }) {
  return <section className="rep-panel" aria-labelledby="source-title">
    <h3 id="source-title">Where people said they heard of you</h3>
    <p className="rep-panel-note">Only the people who named a business. Nothing is apportioned to the ones who did not.</p>
    {!rows.length
      ? <p className="dash-empty">No one has named a source yet.</p>
      : <div className="table-overflow" tabIndex={0} role="region" aria-label="Sources. Scroll horizontally on small screens.">
          <table className="rep-table">
            <thead><tr><th scope="col">Business</th><th scope="col">Inquiries</th><th scope="col">Scans</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <th scope="row">{row.name}</th>
              <td className="num">{number(row.inquiries)}</td>
              <td className="num">{number(row.scans)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
  </section>;
}

function RecentLog({ rows }: { rows: ReturnType<typeof activity> }) {
  const word = { visit: 'Visit', materials: 'Materials', scan: 'Scan' };
  return <section className="rep-panel" aria-labelledby="recent-title">
    <h3 id="recent-title">Recent activity</h3>
    <p className="rep-panel-note">The log itself, newest first. Each row says which kind of thing it is.</p>
    {!rows.length
      ? <p className="dash-empty">Nothing logged yet.</p>
      : <ol className="rep-feed">{rows.map(row => <li key={row.id}>
          <span className={`rep-kind rep-kind-${row.kind}`}>{word[row.kind]}</span>
          <span className="rep-feed-main"><strong>{row.place}</strong><span>{row.detail}</span></span>
          <time dateTime={row.on}>{dateLabel(row.on)}</time>
        </li>)}</ol>}
  </section>;
}
