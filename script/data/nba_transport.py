"""Bounded NBA Stats requests with connection and first-byte diagnostics."""
import json, subprocess, tempfile, time, urllib.parse

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Referer': 'https://www.nba.com/', 'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'identity',
    'Origin': 'https://www.nba.com', 'Connection': 'keep-alive',
}

class NBARequestError(RuntimeError):
    pass

def fetch_json(url, timeout, audit):
    # curl is part of the existing Ubuntu runner. Only this public NBA URL is
    # requested; connection material for other providers never enters logs.
    with tempfile.TemporaryFile() as body:
        args = ['curl', '--silent', '--show-error', '--location', '--connect-timeout', '15',
                '--max-time', str(timeout), '--output', '/dev/fd/'+str(body.fileno()),
                '--write-out', '%{json}']
        for key, value in HEADERS.items(): args += ['--header', key+': '+value]
        result = subprocess.run(args+[url], capture_output=True, text=True,
                                pass_fds=(body.fileno(),), timeout=timeout+5)
        timing = json.loads(result.stdout or '{}')
        audit.update(timeout_seconds=timeout, curl_exit=result.returncode,
                     http_status=timing.get('http_code', 0),
                     dns_seconds=timing.get('time_namelookup', 0),
                     connect_seconds=timing.get('time_connect', 0),
                     tls_seconds=timing.get('time_appconnect', 0),
                     first_byte_seconds=timing.get('time_starttransfer', 0),
                     elapsed_seconds=timing.get('time_total', 0),
                     bytes=timing.get('size_download', 0))
        if result.returncode:
            audit['failure_phase'] = ('response_body' if audit['first_byte_seconds'] else
                'response_headers' if audit['tls_seconds'] else
                'tls' if audit['connect_seconds'] else 'dns_or_connect')
            audit['error'] = result.stderr.strip()[:300]
            raise NBARequestError(audit['failure_phase']+': '+audit['error'])
        if not 200 <= audit['http_status'] < 300:
            audit['failure_phase'] = 'http_status'
            raise NBARequestError('NBA HTTP '+str(audit['http_status']))
        body.seek(0)
        try: return json.load(body)
        except (ValueError, UnicodeError) as error:
            audit['failure_phase'] = 'json_decode'
            raise NBARequestError('NBA returned a non-JSON response') from error

def nba_table(endpoint, params, table, request_audit=None, timeouts=(60, 90)):
    url = 'https://stats.nba.com/stats/'+endpoint+'?'+urllib.parse.urlencode(params)
    attempts = request_audit if request_audit is not None else []
    for attempt, timeout in enumerate(timeouts):
        item = dict(endpoint=endpoint, season=params.get('Season'), attempt=attempt+1)
        attempts.append(item)
        try:
            data = fetch_json(url, timeout, item)
            sets = data.get('resultSets', data.get('resultSet', []))
            if isinstance(sets, dict): sets = [sets]
            found = next((x for x in sets if x.get('name') == table), None)
            if found is None: raise ValueError('Missing NBA table: '+table)
            item['rows'] = len(found['rowSet'])
            parameters = data.get('parameters', {})
            if isinstance(parameters, list): parameters = {k:v for p in parameters for k,v in p.items()}
            return [dict(zip(found['headers'],row)) for row in found['rowSet']], parameters
        except (NBARequestError, subprocess.TimeoutExpired, OSError, ValueError) as error:
            item['error_type'] = type(error).__name__
            item.setdefault('error', str(error)[:300])
            if attempt == len(timeouts)-1: raise
            time.sleep(1)
