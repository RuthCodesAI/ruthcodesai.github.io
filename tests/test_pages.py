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

    def visit(self, route, status, *, js=False):
        page = self.browser.new_page(java_script_enabled=js, reduced_motion='reduce')
        self.addCleanup(page.close)
        url = self.origin + route
        self.assertEqual(page.goto(url).status, status)
        self.assertEqual(page.url, url)
        return page

    def assert_navigation(self, page, *, home=False):
        navigation = page.get_by_role('navigation', name='Site', exact=True)
        links = navigation.get_by_role('link')
        self.assertEqual([(a.inner_text(), a.get_attribute('href')) for a in links.all()], ROUTES)
        brand = page.get_by_role('banner').get_by_role('link', name='Ruth', exact=True)
        if home:
            self.assertEqual(brand.count(), 0)
        else:
            self.assertEqual(brand.get_attribute('href'), '/')
            self.assertEqual(brand.locator('svg').count(), 1)
        for width in (320, 390, 768, 1440):
            with self.subTest(width=width):
                page.set_viewport_size({'width': width, 'height': 900})
                right = navigation.bounding_box()
                self.assertLessEqual(right['x'] + right['width'], width + 1)
                if home:
                    continue
                left = brand.bounding_box()
                self.assertGreaterEqual(left['x'], 0)
                self.assertLess(left['x'] + left['width'], right['x'])

    def test_nested_missing_page_uses_reading_edition_and_recovers(self):
        page = self.visit('/no/such/citation/', 404)
        self.assertIn('reading-edition', page.locator('body').get_attribute('class'))
        self.assertIn('Citation not found', page.get_by_role('heading', level=1).inner_text())
        self.assert_navigation(page)
        self.assertEqual(page.get_by_role('main').get_by_role('link', name='Return to Ruth’s homepage').get_attribute('href'), '/')

    def test_missing_volume_is_static_with_reduced_motion(self):
        page = self.visit('/no/such/volume/', 404)
        art = page.locator('main svg[aria-hidden="true"]')
        self.assertEqual(art.count(), 1)
        self.assertEqual(art.locator('text').all_text_contents().count('404'), 1)
        self.assertEqual(art.evaluate('(svg) => svg.getAnimations({subtree:true}).length'), 0)

    def test_missing_volume_opens_once(self):
        page = self.browser.new_page(reduced_motion='no-preference')
        self.addCleanup(page.close)
        self.assertEqual(page.goto(self.origin + '/no/such/volume/', wait_until='domcontentloaded').status, 404)
        frames = page.locator('main svg').evaluate('''svg => {
          const animations = svg.getAnimations({subtree: true});
          const left = svg.querySelector('.left'), right = svg.querySelector('.right');
          const gap = () => right.getBoundingClientRect().left - left.getBoundingClientRect().right;
          const snapshot = time => {
            for (const a of animations) { a.pause(); a.currentTime = time; }
            return [gap(), Number(getComputedStyle(svg.querySelector('.ghost')).opacity)];
          };
          return { frames: [0, 650, 1310, 2620].map(snapshot),
                   iterations: animations.map(a => a.effect.getTiming().iterations) };
        }''')
        start, moving, final, later = frames['frames']
        self.assertEqual(start, [0, 0])
        self.assertLess(start[0], moving[0])
        self.assertLess(moving[0], final[0])
        self.assertEqual(final, [46, 1])
        self.assertEqual(later, final)
        self.assertEqual(frames['iterations'], [1, 1, 1])

    def test_all_pages_share_wordmark_favicon_and_og_metadata(self):
        for route in ('/', '/about/', '/team/', '/privacy/'):
            with self.subTest(route=route):
                page = self.visit(route, 200)
                self.assertTrue(page.evaluate("document.querySelector('link[rel~=icon]')?.href.startsWith('data:image/svg+xml')"))
                self.assertTrue(page.evaluate("!!document.querySelector('meta[property=\"og:image\"]')?.content"))
                self.assertTrue(page.evaluate("!!document.querySelector('meta[name=\"description\"]')?.content"))

    def test_about_print_follows_reader_color_scheme_and_edition_toggle(self):
        page = self.visit('/about/', 200, js=True)
        for mode, token in [('light', 'about-justitia-day'), ('dark', 'about-justitia-night')]:
            with self.subTest(mode=mode):
                page.emulate_media(color_scheme=mode)
                page.wait_for_function('''token => {
                  const image = document.querySelector('main picture img');
                  return image.complete && image.naturalWidth > 0 && image.currentSrc.includes(token);
                }''', arg=token)

    def test_team_has_balanced_three_paragraph_bios_and_framed_portraits(self):
        page = self.visit('/team/', 200)
        for name, home in [('Jonas Hertner', 'https://jonashertner.com/'),
                           ('Joel Niklaus', 'https://niklaus.ai/')]:
            section = page.locator('section').filter(has=page.get_by_role('heading', name=name))
            self.assertEqual(section.locator('.bio > p').count(), 3)
            self.assertEqual(section.locator('h2 a').get_attribute('href'), home)
            img = section.locator('.founder-plate img')
            self.assertTrue(img.evaluate('i => i.complete && i.naturalWidth === 288'))
            box = img.bounding_box()
            self.assertAlmostEqual(box['width'] / box['height'], 0.8, delta=0.03)

    def test_colophon_waitlist_present_on_about_and_team(self):
        for route in ('/about/', '/team/'):
            with self.subTest(route=route):
                page = self.visit(route, 200, js=True)
                self.assertEqual(page.locator('[data-inline-waitlist] input[type="email"]').count(), 1)
                self.assertEqual(page.locator('.site-colophon a[href="/privacy/"]').count(), 1)
                self.assertEqual(page.locator('.site-colophon a[href="/imprint/"]').count(), 0)
