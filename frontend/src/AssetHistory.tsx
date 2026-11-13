import { useEffect, useMemo, useRef, useState } from 'react';
import './assetHistory.css';
import { aggregateAttribution, LeagueComparison, Waterfall, signedMoney, type AttributionLedger, type RankingMetric } from './AssetHistoryCharts';
import { AssetHistoryDateRange, normalizeHistoryRange, type HistoryDateRange } from './AssetHistoryDateRange';
type Asset={id:string;kind:'player'|'pick';name:string;value:number;source:string;note?:string;details?:{peak_production:number;contract_adjustment:number;draft_development?:{status:'priced';endpoint:string;value:number;original_expectation:number;gain:number}|{status:'unavailable';reason?:string}}};
type Snapshot={team:string;date:string;total:number;reporting_cap:number;closed:boolean;vintage:'reconstructed'|'published';assets:Asset[];moves:{date:string;label:string;major:boolean}[];bridge?:{key:string;label:string;value:number}[];assumptions?:string[];source_dates?:Record<string,string>};
type TeamFile={team:string;method:string;snapshots:Snapshot[]};
type Manifest={generated_at:string;method:string;teams:{team:string;status:string;count:number;latest:string|null;path:string|null;points?:{date:string;total:number;players:number;picks:number;reporting_cap:number;vintage:string}[]}[]};
type RefreshStatus={status:string;observation_date?:string;recorded_at:string};
const money=(v:number)=>`${v<0?'−':''}$${(Math.abs(v)/1e6).toLocaleString(undefined,{maximumFractionDigits:1})}M`;
async function read<T,>(url:string,signal:AbortSignal):Promise<T>{const r=await fetch(url,{cache:'no-cache',signal});if(!r.ok)throw Error(`Asset data unavailable (${r.status})`);return r.json();}
export function AssetHistoryWorkspace(){
 const [manifest,setManifest]=useState<Manifest|null>(null),[file,setFile]=useState<TeamFile|null>(null),[team,setTeam]=useState('UTA'),[error,setError]=useState(''),[query,setQuery]=useState(''),[kind,setKind]=useState('all');
 const [revision,setRevision]=useState(0);
 const [rankingMetric,setRankingMetric]=useState<RankingMetric>('change');
 const [dateRange,setDateRange]=useState<HistoryDateRange>({start:'',end:''});
 const latestObserved=useRef('');
 const [ledgers,setLedgers]=useState<Record<string,AttributionLedger>>({});
 const [leagueLoading,setLeagueLoading]=useState(false);
 const ledger=ledgers[team];
 const [attributionError,setAttributionError]=useState('');
 const [historyVersion,setHistoryVersion]=useState('v15');
 const [refreshStatus,setRefreshStatus]=useState<RefreshStatus|null>(null);
 useEffect(()=>{const f=()=>setRevision(x=>x+1);const timer=window.setInterval(f,60000);window.addEventListener('focus',f);return()=>{clearInterval(timer);window.removeEventListener('focus',f);};},[]);
 useEffect(()=>{const c=new AbortController();read<{history_version?:string}>('/data/asset_valuation.json',c.signal).then(async metadata=>{const version=metadata.history_version;if(version!=='v15')throw Error('The current asset valuation release is unavailable.');const m=await read<Manifest>(`/data/asset_history/${version}/manifest.json`,c.signal);setHistoryVersion(version);setManifest(m);setError('');}).catch(e=>{if(!c.signal.aborted)setError(String(e.message));});return()=>c.abort();},[revision]);
 useEffect(()=>{const c=new AbortController();read<RefreshStatus>(`/data/asset_history/${historyVersion}/refresh_status.json`,c.signal).then(setRefreshStatus).catch(()=>{});return()=>c.abort();},[revision,historyVersion]);
 useEffect(()=>{
  if(!manifest)return;
  const c=new AbortController();setLedgers({});setLeagueLoading(true);setAttributionError('');
  Promise.allSettled(manifest.teams.map(async t=>{
   const book=await read<AttributionLedger>(`/data/asset_history/${historyVersion}/attribution/${t.team}.json`,c.signal);
   if(book.team!==t.team)throw Error('Attribution team does not match');
   return [t.team,book] as const;
  })).then(results=>{
   if(c.signal.aborted)return;
   const available=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
   setLedgers(Object.fromEntries(available));setLeagueLoading(false);
   setAttributionError(results.some(r=>r.status==='rejected')?'Some waterfall categories are unavailable.':'');
  });
  return()=>c.abort();
 },[historyVersion,manifest,revision]);
 const path=manifest?.teams.find(t=>t.team===team)?.path;
 useEffect(()=>{setFile(null);setQuery('');setError('');},[team]);
 useEffect(()=>{if(!path)return;const c=new AbortController();read<TeamFile>(path,c.signal).then(x=>{const dates=x.snapshots.map(s=>s.date);const previousLatest=latestObserved.current;setFile(x);setDateRange(range=>normalizeHistoryRange(dates,range,previousLatest));latestObserved.current=dates[dates.length-1]??'';setError('');}).catch(e=>{if(!c.signal.aborted)setError(String(e.message));});return()=>c.abort();},[path,manifest?.generated_at]);
 const points=file?.team===team?file.snapshots:[];const dates=points.map(s=>s.date);const range=normalizeHistoryRange(dates,dateRange);const index=points.findIndex(s=>s.date===range.end);const current=points[index];
 const values=points.map(s=>s.total);const low=Math.min(...values),high=Math.max(...values);const pad=Math.max((high-low)*.12,1e6);const min=low-pad,max=high+pad;
 const first=points.length?Date.parse(points[0].date):0,last=points.length?Date.parse(points[points.length-1]!.date):1;
 const x=(s:Snapshot)=>70+((Date.parse(s.date)-first)/Math.max(1,last-first))*910;
 const y=(s:Snapshot)=>265-(s.total-min)/Math.max(1,max-min)*220;
 const chart=points.map((s,i)=>`${i?'L':'M'}${x(s)},${y(s)}`).join(' ');
 const assets=current?.assets.filter(a=>(kind==='all'||a.kind===kind)&&a.name.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.value-a.value)??[];
 const startIndex=points.findIndex(s=>s.date===range.start);
 const baseline=points[startIndex];
 const rangeChart=points.slice(startIndex,index+1).map((s,i)=>`${i?'L':'M'}${x(s)},${y(s)}`).join(' ');
 const moves=[...new Map(points.flatMap(s=>s.moves).filter(m=>range.start<m.date&&m.date<=range.end).map(m=>[`${m.date}:${m.label}`,m])).values()].sort((a,b)=>b.date.localeCompare(a.date));
 const analysis=useMemo(()=>ledger?.team===team&&baseline&&current?aggregateAttribution(ledger,baseline.date,current.date,baseline.total,current.total,file?.method):null,[ledger,team,baseline,current,file?.method]);
 const oldAssets=new Map(baseline?.assets.map(a=>[a.id,a.value])??[]);
 const players=current?.assets.filter(a=>a.kind==='player').reduce((s,a)=>s+a.value,0)??0;
 const latestDate=points[points.length-1]?.date;
 const stale=latestDate&&Date.now()-Date.parse(latestDate)>3*86400000;
 return <main className="asset-history workspace"><header className="ah-heading"><div><span className="ah-eyebrow">FOUR-SEASON ASSET INVENTORY</span><h1>Asset history</h1><p>Explore how a team’s players and draft rights change in value over time.</p></div><label>Team<select value={team} onChange={e=>setTeam(e.target.value)}>{manifest?.teams.map(t=><option key={t.team} value={t.team}>{t.team}{t.status==='pending_backfill'?' · awaiting history':''}</option>)}</select></label></header>
 <details className="ah-method"><summary>How asset value works</summary><p>Player values price possible career paths over a rolling four-season window, then average the results. Pick production uses the expected year-four valuation. Draftee development tracks whether a player is on pace for his original year-four target. The padded value blends that expectation with an updated year-four forecast and converges to the normal player valuation at year four. Trades use the same padded value; subsequent development belongs to the acquiring team. Picks include protections and swaps.</p><p>Aging is the expected change in production value as the window advances through the prior forecast for impact and playing time. Player Development measures how far the updated production value moves above or below that forecast. Contract effects are counted under Contract Management.</p><p>All values use the same salary cap. Historical estimates are reconstructed and the current month refreshes daily. Cash, cap space and trade exceptions are excluded.</p></details>
 {error&&<p role="alert" className="ah-message">{error} <button onClick={()=>setRevision(r=>r+1)}>Retry</button></p>}
 {(stale||refreshStatus?.status==='retained_last_good')&&<p role="status" className="ah-message">The latest update is awaiting validation. The last validated inventory{latestDate?` from ${latestDate}`:''} remains available.</p>}
 {!manifest&&!error&&<p role="status">Loading coverage…</p>}
 {manifest&&!path&&<section className="ah-message"><h2>{team} history is awaiting reconstruction</h2><p>Monthly SKILL, dated contract terms, pick rights and injury outlooks must pass coverage checks before this team’s totals can be compared. Missing inventory is not shown as zero.</p></section>}
 {path&&!current&&!error&&<p role="status">Loading {team} inventory…</p>}
 {current&&<><AssetHistoryDateRange dates={dates} range={range} onChange={setDateRange}/><div className="ah-stats"><div><span>Ending inventory · {current.date}</span><strong>{money(current.total)}</strong></div><div><span>Players</span><strong>{money(players)}</strong></div><div><span>Draft rights</span><strong>{money(current.total-players)}</strong></div><div><span>Change since {baseline.date}</span><strong>{signedMoney(current.total-baseline.total)}</strong></div></div>
 <section className="ah-chart"><div className="ah-chart-heading"><h2>Value over time</h2><span>Ending snapshot · {current.vintage==='reconstructed'?'Historical reconstruction':'Recorded at publication'} · {current.closed?'Preserved monthly observation':'Provisional estimate'} · ${(current.reporting_cap/1e6).toFixed(3)}M reporting cap</span></div>
 <p className="ah-chart-legend">The highlighted area is your selected range. Larger markers indicate major moves. Select a point to set the end date.</p>
 <svg viewBox="0 0 1000 310" role="img" aria-label={`${team} asset inventory over time. Selected range ${baseline.date} to ${current.date}. Use the date range controls to change dates.`}>
 {[0,.5,1].map(t=><g key={t}><line x1="70" x2="980" y1={265-t*220} y2={265-t*220} stroke="currentColor" opacity=".12"/><text x="4" y={270-t*220}>{money(min+t*(max-min))}</text></g>)}
 <rect x={x(baseline)} y="40" width={Math.max(0,x(current)-x(baseline))} height="230" fill="#6bd4c3" opacity=".08"/>
 {[baseline,current].map((s,i)=><line key={i} x1={x(s)} x2={x(s)} y1="40" y2="270" stroke="#6bd4c3" opacity=".55" strokeDasharray="4 4"/>)}
 <path d={chart} fill="none" stroke="#6bd4c3" strokeWidth="3" opacity=".25"/><path d={rangeChart} fill="none" stroke="#6bd4c3" strokeWidth="3"/>
 {points.map(s=><g key={s.date}><circle cx={x(s)} cy={y(s)} r={s.date===current.date||s.date===baseline.date?6:s.moves.some(m=>m.major)?4:2} fill={s.date===current.date||s.date===baseline.date?'#fff':'#6bd4c3'} opacity={baseline.date<=s.date&&s.date<=current.date?1:.3}><title>{s.date}: {money(s.total)}{s.moves.filter(m=>m.major).map(m=>' · '+m.label).join('')}</title></circle><circle cx={x(s)} cy={y(s)} r="12" fill="transparent" onClick={()=>setDateRange({start:baseline.date>s.date?s.date:baseline.date,end:s.date})} style={{cursor:'pointer'}}><title>{s.date}: {money(s.total)}{s.moves.filter(m=>m.major).map(m=>' · '+m.label).join('')}</title></circle></g>)}
 <text x="70" y="300">{points[0].date}</text><text x="980" y="300" textAnchor="end">{points[points.length-1]!.date}</text>
 </svg></section>
 <section className="ah-analysis-panel">
 <div className="ah-chart-heading"><div><h2>What changed</h2><p className="ah-caption">{baseline.date} → {current.date}</p></div></div>
 {analysis?<Waterfall opening={analysis.opening} closing={analysis.closing} changes={Object.entries(analysis.categories).map(([key,value])=>({key,label:key,value}))} analysis={analysis}/>:<p role="status">{attributionError?'Detailed attribution is unavailable. Please refresh after the next validated update.':'Loading reconciled attribution…'}</p>}

 </section>
 <LeagueComparison metric={rankingMetric} onMetricChange={setRankingMetric} teams={manifest?.teams??[]} ledgers={ledgers} valuationMethod={manifest?.method} loading={leagueLoading} start={baseline.date} end={current.date} cap={current.reporting_cap} selectedTeam={team} onSelect={setTeam}/>
 <details className="ah-method ah-moves"><summary>Moves in selected range ({moves.length})</summary>{moves.length?<ul>{moves.map((m,i)=><li key={i}><time>{m.date}</time> {m.label}</li>)}</ul>:<p>No annotated moves in this range.</p>}</details>
 <section><div className="ah-filters"><h2>Assets · {current.date}</h2><input aria-label="Search assets" placeholder="Find a player or pick" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Asset category" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">All assets</option><option value="player">Players</option><option value="pick">Draft rights</option></select></div><div className="ah-table ah-inventory"><table><thead><tr><th>Asset</th><th>Type</th><th>Asset value</th><th>Change since {baseline.date}</th><th>Details</th></tr></thead><tbody>{assets.map(a=><tr key={a.id}><td>{a.name}</td><td>{a.kind==='player'?'Player':'Pick'}</td><td>{money(a.value)}</td><td>{oldAssets.has(a.id)?signedMoney(a.value-oldAssets.get(a.id)!):'Added'}</td><td><details><summary>View</summary>{a.details&&<p>Production {money(a.details.peak_production)} · Contract effect {money(a.details.contract_adjustment)}</p>}{a.details?.draft_development?.status==='priced'&&<p>Draftee development: {signedMoney(a.details.draft_development.gain)} versus original expectation.</p>}{a.details?.draft_development?.status==='unavailable'&&<p>Draft appraisal unavailable: {a.details.draft_development.reason ?? 'Missing year-four inputs'}.</p>}{a.note&&<p>{a.note}</p>}<small>{a.source}</small></details></td></tr>)}</tbody></table></div><p className="ah-caption">Sorted by asset value. Changes compare assets held on both dates; removed assets appear in the waterfall.</p></section>
 <details className="ah-method"><summary>Sources and assumptions</summary>{current.source_dates&&<p>{Object.entries(current.source_dates).map(([name,date])=>`${name}: ${date}`).join(' · ')}</p>}{current.assumptions?.length?<ul>{current.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul>:null}<p>Method: {file?.method}. Draftee development tracks the shared padded player value through year four. Contract effects are separate.</p></details>
 <footer><a href={path??undefined} download>Download {team} history</a> · Data through {points[points.length-1]!.date} · Method {file?.method}</footer></>}
 </main>;
}

