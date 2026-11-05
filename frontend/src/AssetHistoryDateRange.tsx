import { useId } from 'react';

export type HistoryDateRange = { start: string; end: string };
export const formatHistoryDate = (date: string) => new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date}T00:00:00Z`));

// Snap to an actual observation. A missing endpoint must not silently expand
// the comparison to the beginning of the history when teams or dates change.
export function normalizeHistoryRange(dates: string[], range: HistoryDateRange, previousLatest = ''): HistoryDateRange {
  if (!dates.length) return { start: '', end: '' };
  const floor = (date: string) => dates.filter(d => d <= date).pop() ?? dates[0];
  const followingLatest = previousLatest !== '' && range.end === previousLatest;
  const end = followingLatest || !range.end ? dates[dates.length - 1] : floor(range.end);
  const start = followingLatest && range.start === previousLatest ? end : range.start ? floor(range.start) : dates[0];
  return { start: start > end ? end : start, end };
}

export function latestHistoryRange(dates: string[], years: number | null): HistoryDateRange {
  if (!dates.length) return { start: '', end: '' };
  const end = dates[dates.length - 1];
  if (years === null) return { start: dates[0], end };
  const target = new Date(`${end}T00:00:00Z`);
  const month = target.getUTCMonth();
  target.setUTCFullYear(target.getUTCFullYear() - years);
  if (target.getUTCMonth() !== month) target.setUTCDate(0);
  return normalizeHistoryRange(dates, { start: target.toISOString().slice(0, 10), end });
}

export function AssetHistoryDateRange({ dates, range, onChange }: {
  dates: string[]; range: HistoryDateRange; onChange: (range: HistoryDateRange) => void;
}) {
  const id = useId();
  const last = dates.length - 1;
  const start = dates.indexOf(range.start), end = dates.indexOf(range.end);
  const disabled = dates.length < 2;
  const percent = (index: number) => last > 0 ? index / last * 100 : 0;
  const changeStart = (index: number) => onChange({ start: dates[Math.min(end, Math.max(0, index))], end: range.end });
  const changeEnd = (index: number) => onChange({ start: range.start, end: dates[Math.max(start, Math.min(last, index))] });
  return <section className="ah-date-range" aria-labelledby={`${id}-title`}>
    <div className="ah-date-range-heading">
      <div><h2 id={`${id}-title`}>Date range</h2><p id={`${id}-help`} className="ah-caption">All comparisons use this range. Inventory shows the end date.</p></div>
      <div className="ah-date-presets" aria-label="Quick date ranges">
        {([{ label: '1Y', years: 1 }, { label: '3Y', years: 3 }, { label: 'All', years: null }] as const).map(preset => {
          const next = latestHistoryRange(dates, preset.years);
          return <button key={preset.label} type="button" aria-pressed={range.start === next.start && range.end === next.end}
            title={preset.years === null ? 'All available history' : `Last ${preset.years === 1 ? 'year' : `${preset.years} years`} through the latest snapshot`}
            onClick={() => onChange(next)}>{preset.label}</button>;
        })}
      </div>
    </div>
    <div className="ah-date-fields">
      <label htmlFor={`${id}-from`}>From<select id={`${id}-from`} value={range.start} onChange={event => changeStart(dates.indexOf(event.target.value))}>
        {dates.slice(0, end + 1).map(date => <option key={date} value={date}>{formatHistoryDate(date)}</option>)}
      </select></label>
      <span className="ah-date-arrow" aria-hidden="true">→</span>
      <label htmlFor={`${id}-to`}>To<select id={`${id}-to`} value={range.end} onChange={event => changeEnd(dates.indexOf(event.target.value))}>
        {dates.slice(start).map(date => <option key={date} value={date}>{formatHistoryDate(date)}</option>)}
      </select></label>
    </div>
    <div className="ah-date-slider" onPointerDown={event => {
      if (disabled || (event.target as HTMLElement).tagName === 'INPUT') return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const index = Math.max(0, Math.min(last, Math.round((event.clientX - bounds.left) / bounds.width * last)));
      if (Math.abs(index - start) < Math.abs(index - end)) changeStart(index); else changeEnd(index);
    }}>
      <div className="ah-date-rail"/><div className="ah-date-selection" style={{ left: `${percent(start)}%`, width: `${percent(end) - percent(start)}%` }}/>
      <input className="ah-date-start" type="range" min="0" max={Math.max(0, last)} step="1" value={start} disabled={disabled}
        aria-label="Start date" aria-describedby={`${id}-help`} aria-valuemax={end} aria-valuetext={formatHistoryDate(range.start)}
        style={{ zIndex: start === end && start > 0 ? 3 : 2 }} onChange={event => changeStart(Number(event.target.value))}/>
      <input className="ah-date-end" type="range" min="0" max={Math.max(0, last)} step="1" value={end} disabled={disabled}
        aria-label="End date" aria-describedby={`${id}-help`} aria-valuemin={start} aria-valuetext={formatHistoryDate(range.end)}
        onChange={event => changeEnd(Number(event.target.value))}/>
    </div>
    <div className="ah-date-extent" aria-hidden="true"><span>{formatHistoryDate(dates[0])}</span><span>{formatHistoryDate(dates[last])}</span></div>
  </section>;
}
