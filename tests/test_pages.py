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

    def assert_navigation(self, page, *, home=False):
        navigation = page.get_by_role('navigation', name='Site', exact=True)
        links = navigation.get_by_role('link')
        self.assertEqual([(a.inner_text(), a.get_attribute('href')) for a in links.all()], ROUTES)

        brand = page.get_by_role('banner').get_by_role('link', name='Ruth', exact=True)
        if home:
            self.assertEqual(brand.count(), 0)
        else:
            self.assertEqual(brand.get_attribute('href'), '/')
        for width in (240, 320, 390, 768, 1440):
            with self.subTest(width=width):
                page.set_viewport_size({'width': width, 'height': 900})
                right = navigation.bounding_box()
                self.assertGreater(right['x'] + right['width'] / 2, width / 2)
                self.assertLessEqual(right['x'] + right['width'], width)
                if home:
                    continue
                left = brand.bounding_box()
                self.assertGreaterEqual(left['x'], 0)
                self.assertLess(left['x'] + left['width'], width / 2)
                self.assertLess(left['x'] + left['width'], right['x'])
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
        self.assert_navigation(page, home=True)
        self.assertEqual(page.get_by_role('link', name='Ruth', exact=True).count(), 1)
        self.assertEqual(page.get_by_role('main').get_by_role('link', name='Ruth', exact=True).get_attribute('href'), '/')
        for title in ('Skip to waitlist', 'About', 'Team', 'Ruth'):
            page.keyboard.press('Tab')
            self.assertTrue(page.get_by_role('link', name=title, exact=True).evaluate(
                'a => a === document.activeElement && a.matches(":focus-visible")'), title)

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

    def test_about_print_follows_the_reader_color_scheme(self):
        page = self.visit('/about/', 200)
        image = page.locator('main picture img')
        self.assertEqual(image.get_attribute('alt'), '')
        for mode, pathname in [('light', '/v2/assets/portrait.webp'),
                               ('dark', '/assets/video/gentle-lift-poster.webp')]:
            with self.subTest(mode=mode):
                page.emulate_media(color_scheme=mode)
                page.wait_for_function('''path => {
                  const image = document.querySelector('main picture img');
                  return image.complete && image.naturalWidth > 0 &&
                         image.currentSrc === location.origin + path;
                }''', arg=pathname)

    def test_founder_navigation_follows_the_single_column_layout(self):
        page = self.visit('/team/', 200)
        index = page.get_by_role('navigation', name='Jump to a founder', include_hidden=True)
        sections = page.get_by_role('main').get_by_role('region')
        self.assertEqual(sections.count(), 2)
        for width in (320, 768, 1440):
            with self.subTest(width=width):
                page.set_viewport_size({'width': width, 'height': 800})
                first, second = [section.bounding_box() for section in sections.all()]
                single_column = second['y'] >= first['y'] + first['height'] - 1
                self.assertEqual(index.is_visible(), single_column)
                if width in (320, 1440):
                    self.assertEqual(single_column, width == 320)
        page.set_viewport_size({'width': 390, 'height': 780})
        for name, fragment in [('Jonas Hertner', '#jonas-hertner'), ('Joel Niklaus', '#joel-niklaus')]:
            jump = index.get_by_role('link', name=name, exact=True)
            self.assertEqual(jump.get_attribute('href'), fragment)
            jump.focus()
            page.keyboard.press('Enter')
            self.assertEqual(page.url, self.origin + '/team/' + fragment)
            destination = page.get_by_role('region', name=name, exact=True)
            self.assertTrue(destination.evaluate('section => section === document.activeElement'))

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

    def test_founder_homepages_on_names_and_portraits_only(self):
        page = self.visit('/team/', 200)
        page.keyboard.press('Tab')
        for name, home in [('Jonas Hertner', 'https://jonashertner.com/'),
                           ('Joel Niklaus', 'https://niklaus.ai/')]:
            section = page.locator('section').filter(has=page.get_by_role('heading', name=name))
            targets = [section.locator('h2').get_by_role('link', name=name, exact=True),
                       section.get_by_role('link', name=name, exact=True).filter(has=page.get_by_role('img', name=name))]
            for target in targets:
                self.assertEqual(target.count(), 1, name)
                self.assertEqual(target.get_attribute('href'), home)
                target.focus()
                self.assertTrue(target.evaluate("a => a.matches('a:focus-visible') && parseFloat(getComputedStyle(a).outlineWidth) > 0"))
            self.assertFalse(section.locator('.role').evaluate("p => !!(p.closest('a') || p.querySelector('a'))"))
            hosts = section.locator(':scope > p a').evaluate_all('links => links.map(a => a.hostname)')
            self.assertTrue({'niklaus.ai', 'jonashertner.com'}.isdisjoint(hosts))

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

    def test_jonas_bio_opens_with_his_practice(self):
        page = self.visit('/team/', 200)
        section = page.locator('section').filter(has=page.get_by_role('heading', name='Jonas Hertner'))
        opening = section.locator('p').last.inner_text().partition('.')[0]
        self.assertIn('disputes', opening)
        self.assertNotIn('at Ruth', opening)

    def test_joel_approved_bio_and_paper_links(self):
        page = self.visit('/team/', 200)
        section = page.locator('section').filter(has=page.get_by_role('heading', name='Joel Niklaus'))
        paragraph = section.locator('p').last
        self.assertEqual(paragraph.inner_text(), (
            'Joel is an expert in legal AI and his datasets and benchmarks such as LEXam, SwiLTra-Bench '
            'and LegalBench have shaped the evaluation of LLMs in the legal domain. Previously, he was '
            'a Research Scientist at Harvey, specializing in large language model systems for legal '
            'applications. Before that, he pretrained LLMs at (Google) X and Thomson Reuters Labs. Joel '
            'holds a PhD in NLP from the University of Bern and conducted research at Stanford '
            'University, leading projects for the Swiss Federal Supreme Court and AI startups such as '
            'Darrow and Libra. His work has been published at top conferences, honored with Outstanding '
            'Paper Awards at ACL and CoLM, and covered by Anthropic and the Swiss National Radio & '
            'Television.'
        ))
        links = paragraph.get_by_role('link').all()
        self.assertEqual([(a.inner_text(), a.get_attribute('href')) for a in links], [
            ('LEXam', 'https://arxiv.org/abs/2505.12864'),
            ('SwiLTra-Bench', 'https://arxiv.org/abs/2503.01372'),
            ('LegalBench', 'https://arxiv.org/abs/2308.11462'),
        ])

    def test_home_uses_root_relative_site_files(self):
        page = self.visit('/', 200)
        for attr in ('href', 'src', 'srcset', 'data-video-src', 'data-video-poster'):
            for el in page.locator(f'[{attr}]').all():
                value = el.get_attribute(attr)
                self.assertTrue(value.startswith(('/', '#', 'data:')), value)
