"""Run: python -m unittest discover -s tests (requires Playwright and Chrome)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Home(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=ROOT))
        Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.server.shutdown)
        cls.pw = sync_playwright().start()
        cls.addClassCleanup(cls.pw.stop)
        cls.browser = cls.pw.chromium.launch(channel='chrome', headless=True)
        cls.addClassCleanup(cls.browser.close)
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'

    def test_content_does_not_wait_for_palette_script(self):
        p = self.browser.new_page()
        self.addCleanup(p.close)
        pending = []
        p.route('**/palette.js', lambda route: pending.append(route))
        p.goto(self.url+'?palette=marble',wait_until='commit')
        try:
            p.get_by_role('heading',level=1).wait_for(state='visible',timeout=1500)
        finally:
            for route in pending:
                route.continue_()
        p.wait_for_load_state('load')
        self.assertEqual(p.locator('html').get_attribute('data-palette'), 'marble')

    def test_tab_icon_needs_no_extra_request(self):
        p = self.browser.new_page()
        self.addCleanup(p.close)
        p.goto(self.url)
        self.assertTrue(p.evaluate("document.querySelector('link[rel~=icon]')?.href.startsWith('data:image/svg+xml')"))

    def test_initial_font_budget(self):
        p = self.browser.new_page()
        self.addCleanup(p.close)
        p.goto(self.url)
        p.evaluate('document.fonts.ready')
        sizes = p.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.endsWith('.woff2')).map(e=>e.encodedBodySize)")
        self.assertTrue(sizes)
        self.assertLess(sum(sizes), 65_000)
