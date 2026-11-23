"""Public documents and navigation, served as plain files like GitHub Pages."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ROUTES = [('About', '/about/'), ('Team', '/team/')]


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

        brand = page.get_by_role('banner').get_by_role('link', name='Ruth', exact=True)
        self.assertEqual(brand.get_attribute('href'), '/')
        for width in (240, 320, 390, 768, 1440):
            with self.subTest(width=width):
                page.set_viewport_size({'width': width, 'height': 900})
                left = brand.bounding_box()
                right = page.get_by_role('navigation').bounding_box()
                self.assertGreaterEqual(left['x'], 0)
                self.assertLess(left['x'] + left['width'], width / 2)
                self.assertGreater(right['x'] + right['width'] / 2, width / 2)
                self.assertLess(left['x'] + left['width'], right['x'])
                self.assertLessEqual(right['x'] + right['width'], width)
                self.assertAlmostEqual(left['y'] + left['height'] / 2,
                                       right['y'] + right['height'] / 2, delta=1)

    def test_nested_missing_page_gives_recovery_without_javascript(self):
        page = self.visit('/no/such/citation/', 404)
        self.assertIn('Citation not found', page.get_by_role('heading', level=1).inner_text())
        self.assert_navigation(page)
        self.assertEqual(page.get_by_role('main').get_by_role('link', name='Return to Ruth’s homepage').get_attribute('href'), '/')
        for el in page.locator('[href], [src]').all():
            target = el.get_attribute('href') or el.get_attribute('src')
            self.assertTrue(target.startswith('/'), target)

    def test_home_has_site_navigation(self):
        page = self.visit('/', 200)
        self.assert_navigation(page)
        self.assertEqual(page.locator('header [aria-current="page"]').inner_text(), 'Ruth')

    def test_about_and_team_have_permanent_addresses(self):
        for title, route in ROUTES:
            with self.subTest(route=route):
                page = self.visit(route, 200)
                self.assertIn(title, page.get_by_role('heading', level=1).inner_text())
                self.assert_navigation(page)
                self.assertEqual(page.locator('nav [aria-current="page"]').inner_text(), title)

    def test_founder_biographies_are_full_paragraphs(self):
        page = self.visit('/team/', 200)
        profiles = page.locator('main .role + p').all_inner_texts()
        self.assertEqual(len(profiles), 2)
        for profile, baseline in zip(profiles, (25, 37)):
            with self.subTest(baseline=baseline):
                count = len(profile.split())
                self.assertGreaterEqual(count, baseline * 2.8)
                self.assertLessEqual(count, baseline * 3.2)

    def test_home_uses_root_relative_site_files(self):
        page = self.visit('/', 200)
        for attr in ('href', 'src', 'srcset', 'data-video-src', 'data-video-poster'):
            for el in page.locator(f'[{attr}]').all():
                value = el.get_attribute(attr)
                self.assertTrue(value.startswith(('/', '#', 'data:')), value)
