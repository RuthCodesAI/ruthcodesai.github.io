"""Public documents and navigation, served as plain files like GitHub Pages."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ROUTES = [('Home', '/'), ('About', '/about/'), ('Team', '/team/')]


class PagesHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        custom = ROOT / '404.html'
        if code != 404 or not custom.is_file():
            return super().send_error(code, message, explain)
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(custom.read_bytes())


class Pages(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(PagesHandler, directory=ROOT))
        Thread(target=server.serve_forever, daemon=True).start()
        cls.addClassCleanup(server.server_close)
        cls.addClassCleanup(server.shutdown)
        cls.origin = f'http://127.0.0.1:{server.server_port}'
        pw = sync_playwright().start()
        cls.addClassCleanup(pw.stop)
        cls.browser = pw.chromium.launch(channel='chrome')
        cls.addClassCleanup(cls.browser.close)

    def visit(self, route, status):
        page = self.browser.new_page(java_script_enabled=False, reduced_motion='reduce')
        self.addCleanup(page.close)
        url = self.origin + route
        self.assertEqual(page.goto(url).status, status)
        self.assertEqual(page.url, url)
        return page

    def assert_navigation(self, page):
        links = page.get_by_role('navigation').get_by_role('link')
        self.assertEqual([(a.inner_text(), a.get_attribute('href')) for a in links.all()], ROUTES)

    def test_nested_missing_page_gives_recovery_without_javascript(self):
        page = self.visit('/no/such/citation/', 404)
        self.assertIn('Citation not found', page.get_by_role('heading', level=1).inner_text())
        self.assert_navigation(page)
        for el in page.locator('[href], [src]').all():
            target = el.get_attribute('href') or el.get_attribute('src')
            self.assertTrue(target.startswith('/'), target)

    def test_home_has_site_navigation(self):
        page = self.visit('/', 200)
        self.assert_navigation(page)
        self.assertEqual(page.locator('nav [aria-current="page"]').inner_text(), 'Home')

    def test_about_and_team_have_permanent_addresses(self):
        for title, route in ROUTES[1:]:
            with self.subTest(route=route):
                page = self.visit(route, 200)
                self.assertIn(title, page.get_by_role('heading', level=1).inner_text())
                self.assert_navigation(page)
                self.assertEqual(page.locator('nav [aria-current="page"]').inner_text(), title)

    def test_home_uses_root_relative_site_files(self):
        page = self.visit('/', 200)
        for attr in ('href', 'src', 'srcset', 'data-video-src', 'data-video-poster'):
            for el in page.locator(f'[{attr}]').all():
                value = el.get_attribute(attr)
                self.assertTrue(value.startswith(('/', '#', 'data:')), value)
