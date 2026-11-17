// A single dated agreement inventory feeds displayed pay and cap charges.
export function mergeSharedContracts(snapshot, previous, years, idFor, normalize) {
  if (!snapshot?.complete || snapshot.players.length !== snapshot.coverage.priced_players || snapshot.coverage.missing_players.length) {
    throw new Error('Incomplete shared contract publication');
  }
  const pending = snapshot.contract_pending ?? [];
  const ids = new Set([...snapshot.players, ...pending].map(p => p.nba_id));
  const keys = new Set([...snapshot.players, ...pending].map(p => `${p.team}||${normalize(p.player_name)}`));
  const existing = new Map(previous.map(p => [`${p.team}||${normalize(p.player_name)}`, p]));
  const result = previous.filter(p => !ids.has(p.nba_id) && !keys.has(`${p.team}||${normalize(p.player_name)}`))
    .map(p => ({...p, cells:p.cells.map(c => c.kind === 'cap_hold' ? {...c, source:'cached', source_quality:'cached', note:'Retained cap-hold estimate from the prior cap source'} : {year:c.year,amount:null,kind:'empty',status:null})}))
    .filter(p => p.cells.some(c => c.kind === 'cap_hold' && c.amount > 0));
  for (const p of snapshot.players) {
    const review = snapshot.source_refresh?.retained_agreements?.find(r=>r.nba_id===p.nba_id);
    const prior = existing.get(`${p.team}||${normalize(p.player_name)}`) ?? previous.find(r => r.nba_id === p.nba_id) ?? {};
    const cells = years.map(year => {
      const c = p.cells.find(c => c.year === year);
      if (c?.amount != null) return {...c, source:'contract', source_url:c.source ?? p.source, guarantee_source:c.guaranteed_amount == null ? 'unavailable' : 'contract'};
      const old = prior.cells?.find(c => c.year === year && c.kind === 'cap_hold');
      return old ? {...old, source:'cached', source_quality:'cached', note:'Retained cap-hold estimate; signed salaries use the shared agreement ledger'} : {year,amount:null,kind:'empty',source:'unavailable',status:c?.status ?? null};
    });
    result.push({...prior, id:idFor(p,p.team),canonical_key:idFor(p,p.team),nba_id:p.nba_id,
      player_name:p.player_name,team:p.team,row_type:'player',position:p.position ?? prior.position,
      contract_type:p.contract_type,source:p.source,source_quality:'contract',contract_as_of:snapshot.as_of,
      contract_notes:`Signed agreement known from ${p.known_from}; ownership verified ${snapshot.as_of}${review ? '; source revision held for review; last validated schedule retained' : ''}`,
      is_two_way:p.two_way,cells});
  }
  for (const p of pending) {
    result.push({id:idFor(p,p.team),canonical_key:idFor(p,p.team),nba_id:p.nba_id,
      player_name:p.player_name,team:p.team,row_type:'player',contract_pending:true,
      source:p.source,source_quality:'unavailable',contract_as_of:snapshot.as_of,
      contract_notes:`Confirmed roster member from ${p.known_from}; contract terms TBD; excluded from signed totals`,
      is_two_way:p.two_way,cells:years.map(year=>({year,amount:null,kind:'empty',status:'Contract Pending',source:'unavailable',counts_against_cap:false}))});
  }
  if (new Set(result.map(r => r.id)).size !== result.length) throw new Error('Duplicate shared contract identity');
  return result;
}

export function capCells(rows, year) {
  return rows.map(r => r.cells.find(c => c.year === year)).filter(c => c && c.counts_against_cap !== false)
    .map(c => ({...c, amount:c.cap_amount ?? c.amount,
      guaranteed_amount:c.guaranteed_amount == null ? null : Math.min(c.cap_amount ?? c.amount ?? 0,c.guaranteed_amount)}));
}

