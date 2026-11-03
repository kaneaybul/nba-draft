import test from 'node:test';import assert from 'node:assert/strict';import {readPageData} from './read_svelte_data.mjs';
import { validateRatingSourceDates } from './live_rating_dates.mjs';
test('read source literals without running JavaScript',()=>{const x=readPageData('<script>kit.start(app,element,{data:[null,{type:"data",data:{off:-1.2,def:.5,name:"Test",values:[1,null,true],missing:void 0}}]});</script>');assert.deepEqual(x,[{off:-1.2,def:.5,name:'Test',values:[1,null,true],missing:null}]);});
test('reject executable data',()=>assert.throws(()=>readPageData('<script>kit.start(app,element,{data:[{type:"data",data:{x:process.exit()}}]});</script>'),/Nonliteral/));
test('detect source format change',()=>assert.throws(()=>readPageData('<html>Login required</html>'),/not found/));

test('accept tomorrow expected EPM on an off day and retain actual source dates', () => {
  assert.doesNotThrow(() => validateRatingSourceDates('2026-11-04', '2026-11-02', '2026-11-03'));
  assert.doesNotThrow(() => validateRatingSourceDates('2026-11-03', '2026-11-03', '2026-11-03'));
});

test('preserve three-day staleness limit for both sources', () => {
  assert.doesNotThrow(() => validateRatingSourceDates('2026-10-31', '2026-10-31', '2026-11-03'));
  assert.throws(() => validateRatingSourceDates('2026-10-30', '2026-11-02', '2026-11-03'), /Expected EPM stale or invalid/);
  assert.throws(() => validateRatingSourceDates('2026-11-04', '2026-10-30', '2026-11-03'), /DARKO stale or invalid/);
});

test('reject distant future forecasts and future observation cutoffs', () => {
  assert.throws(() => validateRatingSourceDates('2026-11-05', '2026-11-02', '2026-11-03'), /Expected EPM stale or invalid/);
  assert.throws(() => validateRatingSourceDates('2026-11-04', '2026-11-04', '2026-11-03'), /DARKO stale or invalid/);
});

test('validate calendar dates across month, year, leap-day and DST boundaries', () => {
  for (const [epm, darko, today] of [
    ['2026-11-01', '2026-10-30', '2026-10-31'],
    ['2027-01-01', '2026-12-30', '2026-12-31'],
    ['2028-02-29', '2028-02-27', '2028-02-28'],
    ['2026-03-09', '2026-03-06', '2026-03-08'],
  ]) assert.doesNotThrow(() => validateRatingSourceDates(epm, darko, today));
});

test('reject malformed, impossible and missing source dates', () => {
  for (const value of ['2026-02-30', '2026-11-3', '2026-11-03T00:00:00Z', 'bad', '', null, undefined]) {
    assert.throws(() => validateRatingSourceDates(value, '2026-11-02', '2026-11-03'), /Expected EPM stale or invalid/);
    assert.throws(() => validateRatingSourceDates('2026-11-04', value, '2026-11-03'), /DARKO stale or invalid/);
  }
});

