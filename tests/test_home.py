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

    def test_system_theme_follows_light_and_dark_with_reduced_motion(self):
        for path in ('', 'v3/'):
            for initial in ('light', 'dark'):
                with self.subTest(path=path, initial=initial):
                    page = self.new_page(color_scheme=initial, reduced_motion='reduce')
                    films = []

                    def record_film(request):
                        if re.search(r'\.mp4(?:[?#]|$)', request.url):
                            films.append(request.url)

                    page.on('request', record_film)
                    page.goto(self.url + path)
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
                            '([selector, width]) => document.querySelector(selector + " img")?.naturalWidth === width',
                            arg=[visible, 1638 if day else 1916])
                        self.assertTrue(page.locator('video').evaluate_all(
                            'videos => videos.every(video => video.paused && video.currentTime === 0)'))
                        expect(page.locator('#ruth-theme-toggle')).to_have_count(0)
                        expect(page.get_by_role('heading', name=HEADLINE, exact=True)).to_be_visible()
                        expect(page.locator('#signup-cta')).to_have_attribute('aria-expanded', 'false')
                    self.assertEqual(films, [])
                    page.close()

    def test_responsive_lockup_clears_the_moving_lips_in_both_editions(self):
        for scheme, photo in [('dark', '.art img'), ('light', '.ruth-day-art img')]:
            page = self.new_page(color_scheme=scheme, reduced_motion='reduce')
            page.goto(self.url)
            page.wait_for_function('([selector, width]) => document.querySelector(selector)?.naturalWidth === width',
                                   arg=[photo, 1916 if scheme == 'dark' else 1638])
            headline = page.get_by_role('heading', level=1, name=HEADLINE, exact=True)
            cta = page.locator('#signup-cta')
            for w, h in [(320, 568), (350, 349), (390, 844), (844, 390), (768, 1024),
                         (899, 550), (900, 540), (900, 550), (900, 675), (900, 676),
                         (961, 651), (1024, 480), (1280, 800), (1500, 500), (2560, 900)]:
                with self.subTest(scheme=scheme, viewport=(w, h)):
                    page.set_viewport_size({'width': w, 'height': h})
                    page.evaluate('document.fonts.ready')
                    side = w >= 900 and w * 3 >= h * 4 and (h >= 550 or w >= 1024)
                    lower_third = (w <= 960 and w <= h) or (h <= 560 and w >= h)
                    logo = page.locator('.ruth-home svg').bounding_box()
                    title = headline.bounding_box()
                    button = cta.bounding_box()
                    label = cta.locator('.join-label').bounding_box()
                    for box in (logo, title, button):
                        self.assertGreater(box['height'], 0)
                        self.assertGreaterEqual(min(box['x'], box['y']), -0.1)
                        self.assertLessEqual(box['x'] + box['width'], w + 0.1)
                        self.assertLessEqual(box['y'] + box['height'], h + 0.1)
                        self.assertAlmostEqual(box['x'] + box['width'] / 2, w * (.23 if side else .5), delta=1)
                    self.assertLessEqual(logo['y'] + logo['height'], title['y'])
                    self.assertLessEqual(title['y'] + title['height'], label['y'])
                    if lower_third and not side:
                        self.assertAlmostEqual(title['y'] + title['height'] / 2, h * .75, delta=.1)
                    self.assertGreaterEqual(button['width'], 160)
                    self.assertGreaterEqual(button['height'], 46)

                    # Full-film guarded lips begin at source x=919 and end at y=606.
                    # Both posters use the same take with slightly different native sizes.
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
            page.close()

    def test_original_film_transitions_to_unlabelled_living_ascii(self):
        page = self.new_page(viewport={'width': 800, 'height': 600}, color_scheme='dark')
        page.add_init_script('''window.filmFrames = { moving: false, held: false, annotations: [] };
            const context = CanvasRenderingContext2D.prototype;
            const originalText = context.fillText;
            context.fillText = function(label, ...args) {
                if (this.canvas.closest('.art') && String(label).trim().length > 1) {
                    window.filmFrames.annotations.push(label);
                }
                return originalText.call(this, label, ...args);
            };
            const originalRectangle = context.strokeRect;
            context.strokeRect = function(...args) {
                if (this.canvas.closest('.art')) window.filmFrames.annotations.push('rectangle');
                return originalRectangle.apply(this, args);
            };
            document.addEventListener('figureframe', ({detail}) => {
                if (detail.time > 3 && detail.time < 12 && detail.visible > 0 && !detail.held) {
                    window.filmFrames.moving = true;
                }
                if (detail.held) window.filmFrames.held = true;
            }, true);''')
        page.goto(self.url)
        page.wait_for_function("document.querySelector('.art video')?.ended && window.filmFrames.held", timeout=45_000)
        self.assertTrue(page.evaluate('window.filmFrames.moving'))
        self.assertEqual(page.evaluate('window.filmFrames.annotations'), [])
        shader = page.locator('#shader')
        expect(shader).to_have_attribute('data-material-idle', 'running')
        expect(shader.locator('canvas')).to_be_visible()
        self.assertEqual(page.locator('.art-classes, .object-frame').count(), 0)
        self.assertEqual(page.locator('.art').inner_text().strip(), '')
        expect(page.get_by_role('heading', level=1, name=HEADLINE, exact=True)).to_be_visible()

        def wait_for_edition(scheme, theme):
            page.emulate_media(color_scheme=scheme)
            page.wait_for_function("""theme => document.documentElement.dataset.ruthTheme === theme
                && !document.documentElement.hasAttribute('data-ruth-preparing')""", arg=theme)

        wait_for_edition('light', 'day')
        page.wait_for_function("""() => {
            const film = document.querySelector('.ruth-day-art video');
            return film && Number.isFinite(film.duration) && film.paused
                && !film.seeking && Math.abs(film.duration - film.currentTime) <= 1 / 24;
        }""")
        wait_for_edition('dark', 'night')
        expect(shader).to_have_attribute('data-material-idle', 'running')
        canvas = shader.locator('canvas')
        expect(canvas).to_be_visible()
        self.assertTrue(canvas.evaluate('canvas => canvas.width > 1 && canvas.height > 1'))
        self.assertTrue(page.locator('.art video').evaluate('film => film.ended'))

    def waitlist_page(self, path=''):
        page = self.new_page(viewport={'width': 390, 'height': 780}, color_scheme='dark', reduced_motion='reduce')
        page.goto(self.url + path)
        # Mock responses below are still available offline. An unexpected URL
        # can never transmit an address, including when testing a production build.
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
        for path in ('', 'v1/', 'v2/', 'v3/'):
            with self.subTest(path=path):
                page = self.waitlist_page(path)
                form = page.locator('#waitlist-form')
                is_live = form.evaluate("form => form.hasAttribute('action')")
                trigger = page.locator('#signup-cta')
                email = page.get_by_role('textbox', name='Email address')
                join = form.locator('button[type="submit"]')
                done = page.get_by_role('button', name='Done', exact=True)
                awaiting_response = []
                if is_live:
                    self.assertEqual(form.evaluate('form => form.method'), 'post')
                    endpoint = form.evaluate('form => form.action')
                    def hold_response(route, headers):
                        awaiting_response.append((route, headers))

                    requests = self.intercept_signup(page, endpoint, hold_response)
                else:
                    requests = []

                    def record_preview_request(request):
                        if (request.resource_type in ('fetch', 'xhr', 'ping') or request.method != 'GET'
                                or request.is_navigation_request()):
                            requests.append(request)

                    page.on('request', record_preview_request)

                trigger.focus()
                page.keyboard.press('Enter')
                expect(email).to_be_focused()
                expect(page.locator('#waitlist-agreement')).to_have_text('By joining, you agree to receive Ruth launch updates by email.')
                expect(page.locator('#waitlist-agreement')).to_be_visible()
                self.assertEqual(form.locator('input:visible').count(), 1)
                if not is_live:
                    self.assertFalse(email.get_attribute('name'))

                page.keyboard.press('Tab')
                expect(join).to_be_focused()
                page.keyboard.press('Enter')
                expect(email).to_be_focused()
                expect(email).to_have_attribute('aria-invalid', 'true')
                expect(page.locator('#waitlist-email-error')).to_be_visible()
                self.assertIn('waitlist-email-error', email.get_attribute('aria-describedby').split())
                email.fill('mistyped')
                page.keyboard.press('Control+Enter')
                expect(page.locator('#waitlist-email-error')).to_contain_text('email')
                self.assertEqual(requests, [])

                email.fill(address)
                if is_live:
                    with page.expect_request(lambda req: req.url == endpoint and req.method == 'POST'):
                        page.keyboard.press('Control+Enter')
                    expect(form).to_have_attribute('aria-busy', 'true')
                    expect(join).to_be_disabled()
                    expect(join).to_have_text('Joining…')
                    # requestSubmit exercises the same path even with the button disabled.
                    form.evaluate('form => { form.requestSubmit(); form.requestSubmit(); }')
                    page.evaluate('new Promise(resolve => requestAnimationFrame(resolve))')
                    self.assertEqual(len(requests), 1)
                    if path in ('', 'v3/'):
                        expect(page.locator('html')).to_have_attribute('data-ruth-theme', 'night')
                        page.emulate_media(color_scheme='light', reduced_motion='reduce')
                        expect(page.locator('html')).to_have_attribute('data-ruth-theme', 'day')
                        expect(email).to_have_value(address)
                        expect(email).to_be_focused()
                        expect(join).to_be_disabled()
                        page.keyboard.press('Escape')
                        expect(trigger).to_be_focused()
                        page.keyboard.press('Enter')
                        expect(email).to_have_value(address)
                        expect(join).to_be_disabled()
                        page.keyboard.press('Escape')
                        expect(trigger).to_be_focused()
                    self.assertEqual(requests[0].post_data_json, {'email': address, 'consent': True})
                    self.assertEqual(requests[0].headers['content-type'].split(';')[0], 'application/json')
                    route, headers = awaiting_response.pop()
                    route.fulfill(status=200, json={'ok': True}, headers=headers)
                    if path in ('', 'v3/'):
                        # Let the real client process the response while the form is closed.
                        expect(form).to_have_attribute('aria-busy', 'false')
                        expect(trigger).to_be_focused()
                        page.keyboard.press('Enter')
                    expect(page.locator('#waitlist-title')).to_have_text('You’re on the list')
                    expect(page.get_by_role('status')).to_have_text('We’ll email you when Ruth launches.')
                else:
                    page.keyboard.press('Control+Enter')
                    expect(page.get_by_role('status')).to_contain_text('No signup was submitted.')
                    self.assertFalse(requests)

                expect(done).to_be_focused()
                page.keyboard.press('Enter')
                expect(trigger).to_be_focused()
                page.keyboard.press('Enter')
                expect(email).to_have_value('')
                expect(email).to_be_focused()
                page.keyboard.press('Escape')
                expect(trigger).to_be_focused()
                expect(trigger).to_have_attribute('aria-expanded', 'false')
                page.close()

    def test_signup_failure_preserves_address_and_allows_retry(self):
        page = self.waitlist_page()
        form = page.locator('#waitlist-form')
        if not form.evaluate("form => form.hasAttribute('action')"):
            self.skipTest('This release serves the local waitlist preview')
        endpoint = form.evaluate('form => form.action')
        outcomes = iter(('network', 'rate', 'html', 'invalid', 'success'))

        def respond(route, headers):
            outcome = next(outcomes)
            if outcome == 'network':
                route.abort('connectionfailed')
            elif outcome == 'rate':
                route.fulfill(status=429, json={'ok': False, 'error': 'rate_limited'}, headers={**headers, 'Retry-After': '60'})
            elif outcome == 'html':
                route.fulfill(status=200, content_type='text/html', body='<title>Proxy error</title>', headers=headers)
            elif outcome == 'invalid':
                route.fulfill(status=400, json={'ok': False, 'error': 'invalid_email'}, headers=headers)
            else:
                route.fulfill(status=200, json={'ok': True}, headers=headers)

        requests = self.intercept_signup(page, endpoint, respond)
        page.locator('#signup-cta').click()
        email = page.get_by_role('textbox', name='Email address')
        join = form.locator('button[type="submit"]')
        address = 'ruth-retry@example.invalid'
        email.fill(address)
        for attempt, outcome in enumerate(('network', 'rate', 'html', 'invalid'), start=1):
            with self.subTest(outcome=outcome):
                with page.expect_request(lambda req: req.url == endpoint and req.method == 'POST'):
                    join.click()
                if outcome == 'invalid':
                    expect(page.locator('#waitlist-email-error')).to_be_visible()
                    expect(email).to_have_attribute('aria-invalid', 'true')
                    expect(email).to_be_focused()
                else:
                    error = page.locator('#waitlist-request-error')
                    expect(error).to_be_visible()
                    expect(error).to_have_attribute('role', 'alert')
                    self.assertNotEqual(email.get_attribute('aria-invalid'), 'true')
                    expect(error).not_to_have_text('')
                    if outcome == 'rate':
                        expect(error).to_have_text(re.compile(r'wait|later|many|minute|moment', re.IGNORECASE))
                expect(join).to_be_enabled()
                expect(email).to_have_value(address)
                expect(form).to_be_visible()
                self.assertEqual(len(requests), attempt)
        email.fill('ruth-corrected@example.invalid')
        join.click()
        expect(page.get_by_role('status')).to_have_text('We’ll email you when Ruth launches.')
        expect(page.get_by_role('button', name='Done')).to_be_focused()
        self.assertEqual(len(requests), 5)

    def test_system_poster_and_copy_render_while_theme_module_is_delayed(self):
        for scheme, visible, hidden in [('dark', '.art', '.ruth-day-art'), ('light', '.ruth-day-art', '.art')]:
            with self.subTest(scheme=scheme):
                page = self.new_page(color_scheme=scheme, reduced_motion='reduce')
                pending = []
                page.route('**/ruth-theme.js*', lambda route: pending.append(route))
                try:
                    with page.expect_request('**/ruth-theme.js*'):
                        page.goto(self.url + '?palettes&palette=marble', wait_until='commit')
                    expect(page.get_by_role('heading', level=1, name=HEADLINE, exact=True)).to_be_visible()
                    expect(page.locator(visible)).to_be_visible()
                    expect(page.locator(hidden)).to_be_hidden()
                    page.wait_for_function(
                        '([selector, width]) => document.querySelector(selector + " img")?.naturalWidth === width',
                        arg=[visible, 1916 if scheme == 'dark' else 1638])
                finally:
                    for route in pending:
                        route.continue_()
                expect(page.locator('html')).to_have_attribute('data-ruth-theme', 'night' if scheme == 'dark' else 'day')
                expect(page.locator('.palette, #ruth-theme-toggle')).to_have_count(0)
                page.close()

    def test_tab_icon_needs_no_extra_request(self):
        page = self.new_page()
        page.goto(self.url)
        self.assertTrue(page.evaluate("document.querySelector('link[rel~=icon]')?.href.startsWith('data:image/svg+xml')"))
