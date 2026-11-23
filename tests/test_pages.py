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

    def test_missing_volume_is_static_with_reduced_motion(self):
        page = self.visit('/no/such/volume/', 404)
        art = page.locator('main svg[aria-hidden="true"]')
        self.assertEqual(art.count(), 1)
        self.assertEqual(art.locator('text').all_text_contents().count('404'), 1)
        self.assertEqual(art.evaluate('(svg) => svg.getAnimations({subtree:true}).length'), 0)
        left, missing, right = [art.get_by_text(label, exact=True).bounding_box()
                                for label in ('403', '404', '405')]
        self.assertLess(left['x'] + left['width'], missing['x'])
        self.assertLess(missing['x'] + missing['width'], right['x'])

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

    def test_about_anniversary(self):
        page = self.visit('/about/', 200)
        self.assertIn('the sixth anniversary of her passing.', page.locator('main').inner_text())

    def test_founder_portraits_beside_name_and_role(self):
        page = self.visit('/team/', 200)
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({'width': width, 'height': 900})
            page.evaluate('document.fonts.ready')
            sizes = []
            for name in ('Jonas Hertner', 'Joel Niklaus'):
                section = page.locator('section').filter(has=page.get_by_role('heading', name=name))
                image = section.get_by_role('img', name=name)
                self.assertEqual(image.count(), 1, name)
                self.assertTrue(image.evaluate("i => i.complete && i.naturalWidth && new URL(i.src).origin === location.origin"))
                self.assertEqual(image.evaluate('i => getComputedStyle(i).borderRadius'), '50%')
                photo = image.bounding_box()
                sizes.append(photo['width'])
                self.assertEqual(photo['width'], photo['height'])
                for label in (section.locator('h2'), section.locator('.role')):
                    box = label.bounding_box()
                    self.assertLessEqual(box['x'] + box['width'], photo['x'])
                    self.assertLess(box['y'], photo['y'] + photo['height'])
                    self.assertGreater(box['y'] + box['height'], photo['y'])
                self.assertGreater(section.locator('p').last.bounding_box()['y'], photo['y'] + photo['height'])
            self.assertEqual(*sizes)

    def test_founder_bios_wrap_to_equal_lines(self):
        page = self.visit('/team/', 200)
        for width in (320, 375, 390, 430, 768, 1024, 1440):
            page.set_viewport_size({'width': width, 'height': 900})
            page.evaluate('document.fonts.ready')
            counts = page.locator('section > p').evaluate_all("""nodes => nodes.map(p => {
            const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
            const range = document.createRange(), rows = new Set();
            while (walker.nextNode()) {
                range.selectNodeContents(walker.currentNode);
                for (const r of range.getClientRects()) if (r.width) rows.add(Math.round((r.top - p.getBoundingClientRect().top) / parseFloat(getComputedStyle(p).lineHeight)));
            }
            return rows.size;
        })""")
            self.assertEqual(len(counts), 2)
            self.assertGreater(min(counts), 1)
            self.assertEqual(*counts, msg=f'{width}px: {counts}')

    def test_multilegalpile_award(self):
        page = self.visit('/team/', 200)
        bio = page.get_by_text('MultiLegalPile', exact=True).locator('..').inner_text()
        self.assertTrue(bio.endswith('He co-created MultiLegalPile; the paper won an ACL 2024 Outstanding Paper Award.'), bio)
        self.assertNotIn('They released the texts', bio)

    def test_home_uses_root_relative_site_files(self):
        page = self.visit('/', 200)
        for attr in ('href', 'src', 'srcset', 'data-video-src', 'data-video-poster'):
            for el in page.locator(f'[{attr}]').all():
                value = el.get_attribute(attr)
                self.assertTrue(value.startswith(('/', '#', 'data:')), value)
