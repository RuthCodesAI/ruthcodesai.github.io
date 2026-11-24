"""Run python -m unittest discover -s tests with Playwright, Chrome and ffprobe."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import re
import unittest

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HEADLINE = 'Building the infrastructure for next-generation legal work.'


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
        pw = sync_playwright().start()
        cls.addClassCleanup(pw.stop)
        cls.browser = pw.chromium.launch(channel='chrome', headless=True)
        cls.addClassCleanup(cls.browser.close)
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'

    def new_page(self, **options):
        page = self.browser.new_page(**options)
        self.addCleanup(page.close)
        return page

    def test_system_theme_and_edition_toggle_with_reduced_motion(self):
        for initial in ('light', 'dark'):
            with self.subTest(initial=initial):
                page = self.new_page(color_scheme=initial, reduced_motion='reduce')
                films = []

                def record_film(request):
                    if re.search(r'\.(?:mp4|webm)(?:[?#]|$)', request.url):
                        films.append(request.url)

                page.on('request', record_film)
                page.goto(self.url)
                opposite = 'dark' if initial == 'light' else 'light'
                for scheme in (initial, opposite):
                    if scheme != initial:
                        page.emulate_media(color_scheme=scheme, reduced_motion='reduce')
                    day = scheme == 'light'
                    theme = 'day' if day else 'night'
                    visible, hidden = ('.ruth-day-art', '.art') if day else ('.art', '.ruth-day-art')
                    expect(page.locator('html')).to_have_attribute('data-ruth-theme', theme)
                    expect(page.locator(visible)).to_be_visible()
                    expect(page.locator(hidden)).to_be_hidden()
                    page.wait_for_function(
                        'selector => { const i = document.querySelector(selector + " img"); return i && i.complete && i.naturalWidth >= 820; }',
                        arg=visible)
                    self.assertTrue(page.locator('video').evaluate_all(
                        'videos => videos.every(video => video.paused && video.currentTime === 0)'))
                    expect(page.locator('#edition-toggle')).to_have_count(0)
                    expect(page.locator('#motion-toggle')).to_have_count(0)
                    expect(page.get_by_role('heading', name=HEADLINE, exact=True)).to_be_visible()
                    expect(page.locator('#signup-cta')).to_have_attribute('aria-expanded', 'false')
                self.assertEqual(films, [])
                page.close()

    def test_responsive_lockup_clears_the_moving_lips_in_both_editions(self):
        for scheme, photo in [('dark', '.art img'), ('light', '.ruth-day-art img')]:
            page = self.new_page(color_scheme=scheme, reduced_motion='reduce')
            page.goto(self.url)
            page.wait_for_function(
                'selector => { const i = document.querySelector(selector); return i && i.complete && i.naturalWidth >= 820; }',
                arg=photo)
            headline = page.get_by_role('heading', level=1, name=HEADLINE, exact=True)
            cta = page.locator('#signup-cta')
            for w, h in [(240, 320), (320, 568), (350, 349), (390, 844), (568, 320), (844, 390),
                         (768, 1024), (960, 1280), (961, 1280), (1024, 1366),
                         (899, 550), (900, 540), (900, 550), (900, 675), (900, 676),
                         (961, 651), (1024, 480), (1280, 800), (1440, 900), (1500, 500), (2560, 900)]:
                with self.subTest(scheme=scheme, viewport=(w, h)):
                    page.set_viewport_size({'width': w, 'height': h})
                    page.evaluate('document.fonts.ready')
                    side = w >= 900 and w * 3 >= h * 4 and (h >= 550 or w >= 1024)
                    logo = page.locator('.ruth-home svg').bounding_box()
                    title = headline.bounding_box()
                    button = cta.bounding_box()
                    label = cta.locator('.join-label').bounding_box()
                    for box in (logo, title, button):
                        self.assertGreater(box['height'], 0)
                        self.assertGreaterEqual(min(box['x'], box['y']), -0.1)
                        self.assertLessEqual(box['x'] + box['width'], w + 0.1)
                        if (w, h) not in ((240, 320), (350, 349)):
                            self.assertLessEqual(box['y'] + box['height'], h + 0.1)
                        if side:
                            # Desktop left-rail alignment: logo, title, and CTA share the same left edge.
                            self.assertAlmostEqual(box['x'], logo['x'], delta=2)
                        else:
                            self.assertAlmostEqual(box['x'] + box['width'] / 2, w * .5, delta=1)
                    self.assertLessEqual(logo['y'] + logo['height'], title['y'])
                    self.assertLessEqual(title['y'] + title['height'], label['y'])
                    self.assertGreaterEqual(button['width'], 160)
                    self.assertGreaterEqual(button['height'], 46)

                    boundary = page.locator(photo).evaluate(r"""(photo, side) => {
                        const box = photo.getBoundingClientRect(), style = getComputedStyle(photo);
                        if (style.objectFit !== 'cover') throw Error('Expected cover image');
                        const scale = Math.max(box.width / photo.naturalWidth, box.height / photo.naturalHeight);
                        const parts = style.objectPosition.match(/calc\([^)]*\)|[^\s]+/g);
                        const position = parts[side ? 0 : 1];
                        if (!position.endsWith('%')) throw Error('Expected percentage crop on measured axis');
                        const length = side ? box.width : box.height;
                        const imageLength = scale * (side ? photo.naturalWidth : photo.naturalHeight);
                        return (side ? box.x : box.y) + (length - imageLength) * parseFloat(position) / 100
                            + imageLength * (side ? 919 / 1916 : 606 / 1080);
                    }""", side)
                    if side:
                        self.assertGreaterEqual(boundary - max(box['x'] + box['width'] for box in (logo, title, button)), 1)
                    else:
                        self.assertGreaterEqual(logo['y'] - boundary, 1)
                    if (w, h) in ((240, 320), (350, 349)):
                        cta.scroll_into_view_if_needed()
                        expect(cta).to_be_in_viewport(ratio=1)
                        page.evaluate('window.scrollTo(0, 0)')
            page.close()

    def test_original_film_transitions_to_unlabelled_living_ascii(self):
        page = self.new_page(viewport={'width': 900, 'height': 600}, color_scheme='dark')
        page.add_init_script('''window.filmFrames = { moving: false, held: false, annotations: [] };
            document.addEventListener('figureframe', ({detail}) => {
                if (detail.time > 3 && detail.time < 12 && detail.visible > 0 && !detail.held) {
                    window.filmFrames.moving = true;
                }
                if (detail.held) window.filmFrames.held = true;
            }, true);''')
        page.goto(self.url)
        page.wait_for_function("document.querySelector('.art video')?.ended && window.filmFrames.held", timeout=45_000)
        self.assertTrue(page.evaluate('window.filmFrames.moving'))
        shader = page.locator('#shader')
        expect(shader).to_have_attribute('data-material-idle', 'running')
        expect(shader.locator('canvas')).to_be_visible()
        # Waitlist automatically suspends idle canvas rendering, then resumes on close.
        page.locator('#signup-cta').click()
        expect(shader).to_have_attribute('data-material-idle', 'paused')
        page.keyboard.press('Escape')
        expect(shader).to_have_attribute('data-material-idle', 'running')

    def waitlist_page(self):
        page = self.new_page(viewport={'width': 390, 'height': 780}, color_scheme='dark', reduced_motion='reduce')
        page.goto(self.url)
        page.context.set_offline(True)
        return page

    def intercept_signup(self, page, endpoint, handler):
        requests = []
        headers = {
            'Access-Control-Allow-Origin': self.url.rstrip('/'),
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }

        def intercept(route):
            request = route.request
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=headers)
                return
            requests.append(request)
            handler(route, headers)

        page.route(lambda url: url == endpoint, intercept)
        return requests

    def test_email_signup_and_keyboard_actions(self):
        address = 'ruth-qa@example.invalid'
        page = self.waitlist_page()
        form = page.locator('#waitlist-form')
        trigger = page.locator('#signup-cta')
        email = page.get_by_role('textbox', name='Email address')
        join = form.locator('button[type="submit"]')
        done = page.get_by_role('button', name='Done', exact=True)
        awaiting_response = []
        endpoint = form.evaluate('form => form.action')

        requests = self.intercept_signup(page, endpoint, lambda r, h: awaiting_response.append((r, h)))
        trigger.focus()
        page.keyboard.press('Enter')
        expect(email).to_be_focused()
        expect(page.locator('#waitlist-agreement')).to_have_text('By joining, you agree to receive Ruth launch updates by email.')
        page.keyboard.press('Tab')
        expect(join).to_be_focused()
        page.keyboard.press('Enter')
        expect(email).to_be_focused()
        expect(email).to_have_attribute('aria-invalid', 'true')
        email.fill(address)
        with page.expect_request(lambda req: req.url == endpoint and req.method == 'POST'):
            page.keyboard.press('Control+Enter')
        expect(form).to_have_attribute('aria-busy', 'true')
        route, headers = awaiting_response.pop()
        route.fulfill(status=200, json={'ok': True}, headers=headers)
        expect(page.locator('#waitlist-title')).to_have_text('You’re on the list')
        expect(done).to_be_focused()
        page.keyboard.press('Enter')
        expect(trigger).to_be_focused()
        page.close()

    def test_short_waitlist_reveals_feedback_and_done(self):
        for w, h in ((844, 210), (320, 200)):
            with self.subTest(viewport=(w, h)):
                page = self.waitlist_page()
                page.set_viewport_size({'width': w, 'height': h})
                endpoint = page.locator('#waitlist-form').evaluate('form => form.action')
                self.intercept_signup(page, endpoint, lambda route, headers:
                                      route.fulfill(status=200, json={'ok': True}, headers=headers))
                trigger = page.locator('#signup-cta')
                trigger.click()
                join = page.get_by_role('button', name='Join', exact=True)
                join.click()
                expect(page.locator('#waitlist-email-error')).to_be_in_viewport(ratio=1)
                page.get_by_role('textbox', name='Email address').fill('reflow@example.invalid')
                join.click()
                done = page.get_by_role('button', name='Done')
                expect(done).to_be_focused()
                expect(done).to_be_in_viewport(ratio=1)
                page.close()

    def test_tab_icon_needs_no_extra_request(self):
        page = self.new_page()
        page.goto(self.url)
        self.assertTrue(page.evaluate("document.querySelector('link[rel~=icon]')?.href.startsWith('data:image/svg+xml')"))
