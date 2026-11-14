import json, os, tempfile, threading, unittest, urllib.request, urllib.error
from nebula_media_helper import build_server, choose_session, is_allowed_origin, payload, FakeProvider

SESSIONS = [
    {'app': 'chrome.exe', 'status': 'paused', 'title': 'Paused tab', 'artist': 'A', 'album': ''},
    {'app': 'Spotify.exe', 'status': 'playing', 'title': 'Song', 'artist': 'Artist', 'album': 'Album'},
    {'app': 'Chrome', 'status': 'playing', 'title': 'Video - YouTube', 'artist': 'Channel', 'album': ''},
    {'app': 'msedge.exe', 'status': 'playing', 'title': '', 'artist': 'No title', 'album': ''},
]

class Selection(unittest.TestCase):
    def test_playing_beats_paused(self):
        self.assertEqual(choose_session(SESSIONS)['title'], 'Song')

    def test_sessions_without_a_title_are_ignored(self):
        self.assertIsNone(choose_session([{'app': 'x', 'status': 'playing', 'title': ''}]))

    def test_app_filter_is_case_insensitive_substring(self):
        self.assertEqual(choose_session(SESSIONS, 'spotify')['title'], 'Song')
        self.assertEqual(choose_session(SESSIONS, 'CHROME')['title'], 'Video - YouTube')
        self.assertIsNone(choose_session(SESSIONS, 'vlc'))

    def test_equal_status_keeps_the_first_session(self):
        self.assertEqual(choose_session(SESSIONS[2:3] + [dict(SESSIONS[2], title='Second')])['title'], 'Video - YouTube')

    def test_no_session_gives_an_empty_payload(self):
        self.assertEqual(payload(None), {'title': '', 'artist': '', 'album': '', 'status': 'none', 'source': ''})

class Origins(unittest.TestCase):
    def test_nebula_origins_are_allowed(self):
        for o in ['https://nintobias.github.io', 'null', 'http://localhost:8080', 'http://127.0.0.1:5500', '', None]:
            self.assertTrue(is_allowed_origin(o or ''), o)

    def test_other_sites_are_refused(self):
        for o in ['https://evil.example', 'http://localhost.evil.example', 'https://nintobias.github.io.evil.example']:
            self.assertFalse(is_allowed_origin(o), o)

class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        path = os.path.join(cls.dir, 'sessions.json')
        with open(path, 'w', encoding='utf-8') as f: json.dump(SESSIONS, f)
        cls.server = build_server(FakeProvider(path), '', port=0)
        cls.base = f'http://127.0.0.1:{cls.server.server_address[1]}'
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close()

    def get(self, path, origin=None, method='GET'):
        req = urllib.request.Request(self.base + path, method=method)
        if origin: req.add_header('Origin', origin)
        try:
            with urllib.request.urlopen(req) as r: return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), b''

    def test_returns_the_playing_session_as_json(self):
        status, headers, body = self.get('/now', origin='http://localhost:8080')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['title'], 'Song')
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'http://localhost:8080')
        self.assertEqual(headers['Cache-Control'], 'no-store')

    def test_nebula_on_github_pages_is_allowed(self):
        _, headers, _ = self.get('/now', origin='https://nintobias.github.io')
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://nintobias.github.io')

    def test_other_origins_get_no_data(self):
        status, headers, body = self.get('/now', origin='https://evil.example')
        self.assertEqual(status, 403); self.assertNotIn('Access-Control-Allow-Origin', headers); self.assertEqual(body, b'')

    def test_preflight_grants_private_network_access_to_nebula_only(self):
        status, headers, _ = self.get('/now', origin='https://nintobias.github.io', method='OPTIONS')
        self.assertEqual(status, 204)
        self.assertEqual(headers['Access-Control-Allow-Private-Network'], 'true')
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://nintobias.github.io')
        status, _, _ = self.get('/now', origin='https://evil.example', method='OPTIONS')
        self.assertEqual(status, 403)

    def test_other_paths_are_not_served(self):
        status, _, _ = self.get('/secrets', origin='http://localhost:8080')
        self.assertEqual(status, 404)

if __name__ == '__main__':
    unittest.main()
