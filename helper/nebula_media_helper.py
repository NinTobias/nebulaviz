#!/usr/bin/env python3
"""Nebula media helper: publishes the current media session (title, artist, album) at http://127.0.0.1:8777/now

Windows only. It reads the System Media Transport Controls, which is where Spotify (desktop app) and Chrome / Edge
tabs with playing media publish their track information. Nebula Visualizer fetches /now while live input is on.

    pip install winsdk
    python nebula_media_helper.py             # all media sessions, the playing one wins
    python nebula_media_helper.py --list      # print every session with its app id, then exit
    python nebula_media_helper.py --app spotify

Local only: it binds to 127.0.0.1, answers only browser origins that run Nebula, and sends nothing anywhere else.
"""
import argparse, asyncio, json, sys, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

DEFAULT_PORT = 8777
ALLOWED_ORIGINS = {'https://nintobias.github.io', 'null'}   # the hosted demo, and file:// pages (origin "null")
LOCAL_ORIGIN_PREFIXES = ('http://localhost:', 'http://127.0.0.1:', 'https://localhost:', 'https://127.0.0.1:')
RANK = {'playing': 0, 'paused': 1, 'stopped': 2}


def is_allowed_origin(origin):
    if not origin: return True                       # no Origin header: not a cross-site browser request
    return origin in ALLOWED_ORIGINS or origin.startswith(LOCAL_ORIGIN_PREFIXES) or origin in ('http://localhost', 'http://127.0.0.1')


def choose_session(sessions, app_filter=''):
    """The session to report: playing before paused before stopped, sessions without a title are ignored,
    and app_filter (case-insensitive part of the app id, e.g. 'spotify') narrows the choice."""
    f = app_filter.lower()
    cand = [s for s in sessions if s.get('title') and (not f or f in s.get('app', '').lower())]
    if not cand: return None
    return min(cand, key=lambda s: RANK.get(s.get('status'), 3))   # min() keeps the first of equal ranks


def payload(session):
    if not session: return {'title': '', 'artist': '', 'album': '', 'status': 'none', 'source': ''}
    return {'title': session.get('title', ''), 'artist': session.get('artist', ''), 'album': session.get('album', ''),
            'status': session.get('status', ''), 'source': session.get('app', '')}


class WindowsProvider:
    """Reads the System Media Transport Controls through winsdk (pip install winsdk)."""
    async def sessions(self):
        from winsdk.windows.media.control import (GlobalSystemMediaTransportControlsSessionManager as Manager,
                                                  GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status)
        names = {Status.PLAYING: 'playing', Status.PAUSED: 'paused'}
        manager = await Manager.request_async()
        out = []
        for s in manager.get_sessions():
            props = await s.try_get_media_properties_async()
            out.append({'app': s.source_app_user_model_id or '', 'status': names.get(s.get_playback_info().playback_status, 'stopped'),
                        'title': props.title or '', 'artist': props.artist or '', 'album': props.album_title or ''})
        return out


class FakeProvider:
    """For testing on any system: sessions come from a JSON file (a list of session objects)."""
    def __init__(self, path=None):
        self.path = path
    async def sessions(self):
        if not self.path: return []
        with open(self.path, encoding='utf-8') as f: return json.load(f)


class Cache:
    """Reads the sessions at most every 0.5 s, so several browser requests share one read."""
    def __init__(self, provider, app_filter):
        self.provider, self.app_filter, self.at, self.value = provider, app_filter, 0.0, None
    def current(self):
        now = time.monotonic()
        if self.value is None or now - self.at > 0.5:
            try: sessions = asyncio.run(self.provider.sessions())
            except Exception as e:   # Windows API missing or no media session: report nothing rather than failing
                print('media read failed:', e, file=sys.stderr); sessions = []
            self.value, self.at = payload(choose_session(sessions, self.app_filter)), now
        return self.value


def make_handler(cache):
    class Handler(BaseHTTPRequestHandler):
        def _origin_ok(self):
            return is_allowed_origin(self.headers.get('Origin', ''))
        def _cors(self):
            origin = self.headers.get('Origin', '')
            if origin and self._origin_ok():
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
        def do_OPTIONS(self):   # browser preflight (Chrome also asks for private-network access)
            if not self._origin_ok(): self.send_response(403); self.end_headers(); return
            self.send_response(204); self._cors()
            self.send_header('Access-Control-Allow-Methods', 'GET')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.end_headers()
        def do_GET(self):
            if self.path.split('?')[0] != '/now': self.send_response(404); self.end_headers(); return
            if not self._origin_ok(): self.send_response(403); self.end_headers(); return
            body = json.dumps(cache.current()).encode('utf-8')
            self.send_response(200); self._cors()
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        def log_message(self, *args): pass   # keep the console quiet
    return Handler


def build_server(provider, app_filter='', port=DEFAULT_PORT):
    return ThreadingHTTPServer(('127.0.0.1', port), make_handler(Cache(provider, app_filter)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=DEFAULT_PORT)
    ap.add_argument('--app', default='', help='only sessions whose app id contains this text, e.g. spotify or chrome')
    ap.add_argument('--list', action='store_true', help='print every media session and exit')
    ap.add_argument('--provider', choices=['windows', 'fake'], default='windows')
    ap.add_argument('--fake-file', help='JSON list of sessions (with --provider fake)')
    a = ap.parse_args()
    provider = WindowsProvider() if a.provider == 'windows' else FakeProvider(a.fake_file)
    if a.list:
        for s in asyncio.run(provider.sessions()):
            print(f"{s.get('status', '?'):8} {s.get('app', '')!s:40} {s.get('title', '')} - {s.get('artist', '')}")
        return
    server = build_server(provider, a.app, a.port)
    print(f'Nebula media helper on http://127.0.0.1:{a.port}/now  (Ctrl+C to stop)')
    try: server.serve_forever()
    except KeyboardInterrupt: pass


if __name__ == '__main__':
    main()
