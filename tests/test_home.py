"""Run: python -m unittest discover -s tests (requires Playwright and Chrome)."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def rendered_lines(heading):
    """Read actual glyph rows, including wraps inside hyphenated words."""
    return heading.evaluate('''h => {
        const rows = new Map(), range = document.createRange();
        const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            for (let i = 0; i < node.length; i++) {
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                const box = range.getBoundingClientRect();
                if (box.width) rows.set(box.top, (rows.get(box.top) || '') + node.data[i]);
            }
        }
        return [...rows.values()].map(s => s.trim());
    }''')


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


    def test_tagline_rendered_lines(self):
        page = self.browser.new_page(reduced_motion='reduce')
        self.addCleanup(page.close)
        page.goto(self.url)
        heading = page.get_by_role('heading', level=1)
        desktop = ['Building the infrastructure for', 'next-generation legal work.']
        for w, h in [(320, 640), (390, 844), (961, 700), (1024, 768), (1280, 800), (1440, 900)]:
            with self.subTest(viewport=(w, h)):
                page.set_viewport_size({'width': w, 'height': h})
                page.evaluate('document.fonts.ready')
                lines = rendered_lines(heading)
                if w >= 961:
                    self.assertEqual(lines, desktop)
                else:
                    # The compact layout must match the same text without a desktop break.
                    natural = heading.evaluate_handle('''h => {
                        const copy = h.cloneNode(false);
                        copy.append('Building the infrastructure for next-generation ');
                        copy.append(h.querySelector('.legal-phrase').cloneNode(true));
                        h.after(copy);
                        return copy;
                    }''')
                    try:
                        self.assertEqual(lines, rendered_lines(natural))
                    finally:
                        natural.evaluate('h => h.remove()')
                        natural.dispose()
                self.assertEqual(heading.text_content(), ' '.join(desktop))
                self.assertEqual(page.get_by_role('heading', name=' '.join(desktop), exact=True).count(), 1)

    def test_animated_hero_paints_without_tracking_boxes_or_labels(self):
        p = self.browser.new_page(viewport={'width':1440,'height':900})
        self.addCleanup(p.close)
        # Canvas annotations are not DOM text. Observe the painted hero from
        # the first frame through the film and the subsequent animated grid.
        p.add_init_script(r"""window.marks = {rectangles: 0, labels: []};
            const ctx = CanvasRenderingContext2D.prototype;
            const stroke = ctx.strokeRect, text = ctx.fillText;
            ctx.strokeRect = function(...args) {
                if (this.canvas.closest('.art')) marks.rectangles++;
                return stroke.apply(this, args);
            };
            ctx.fillText = function(value, ...args) {
                if (this.canvas.closest('.art') && /^(?:[ABC]-0[123]|X\s+\d+\s+Y\s+\d+|GO|REVIEW|APPROVED|CLEARED|CONFIRMED)$/.test(value)
                    && !marks.labels.includes(value)) marks.labels.push(value);
                return text.call(this, value, ...args);
            };""")
        p.goto(self.url)
        p.wait_for_function("document.querySelector('video')?.currentTime > 6")
        p.mouse.move(1160,190,steps=12)
        p.wait_for_function("document.querySelector('video')?.ended && document.querySelector('#shader.ready canvas')")
        self.assertEqual(p.evaluate('window.marks'), {'rectangles':0, 'labels':[]})

    def test_only_visible_objects_get_named_frames(self):
        all_classes = ['JUSTITIA','BLINDFOLD','SCALES']
        for width,height,touch in [(1440,900,False),(1366,1024,False),(1366,1024,True),
                                   (1024,1366,True),(390,844,True),(844,390,True)]:
            expected = all_classes[:2] if touch else all_classes
            with self.subTest(width=width,touch=touch):
                p = self.browser.new_page(viewport={'width':width,'height':height},has_touch=touch,is_mobile=touch,reduced_motion='reduce')
                self.addCleanup(p.close)
                p.goto(self.url)
                p.wait_for_selector('#shader.ready')
                labels = p.locator('.art-classes text:visible')
                self.assertEqual(labels.all_text_contents(), expected)
                frames = p.locator('.art-classes .object-frame:visible')
                self.assertEqual(frames.count(), len(expected))
                if width == 390:
                    # The head extends beyond the crop: its sides must not turn
                    # into a decorative frame along both viewport edges.
                    self.assertGreater(frames.first.bounding_box()['width'], width)
                for label in labels.all():
                    box = label.bounding_box()
                    self.assertGreaterEqual(box['x'], 0)
                    self.assertLessEqual(box['x'] + box['width'], width)
                    self.assertLess(box['y'] + box['height'], p.locator('#signup-cta').bounding_box()['y'])
                p.close()

    def test_touch_poster_has_no_balance_even_before_scripts(self):
        # At this tablet size the beam remains inside the crop. Test displayed
        # pixels, not just the annotation. No scripts can hide a first-paint leak.
        from io import BytesIO
        from PIL import Image
        p = self.browser.new_page(viewport={'width':1366,'height':1024},has_touch=True,
                                  is_mobile=True,java_script_enabled=False)
        self.addCleanup(p.close)
        p.goto(self.url,wait_until='load')
        # The sampled strip contains no text or controls.
        # This strip intersects the bright beam cap before and after the move.
        img = Image.open(BytesIO(p.screenshot())).convert('L')
        strip = img.crop((1160,515,1280,550)).tobytes()
        self.assertLessEqual(max(strip)-min(strip),2)

    def test_wordmark_leads_unchanged_tagline(self):
        # Published sizes before the requested ~10% increase.
        for w,h,old_size in [(390,844,28.47),(820,1180,38),(1440,900,57.6),(844,390,19.5)]:
            with self.subTest(viewport=(w,h)):
                p = self.browser.new_page(viewport={'width':w,'height':h})
                self.addCleanup(p.close)
                p.goto(self.url+'?preview')
                title = p.get_by_role('heading',level=1)
                self.assertEqual(title.inner_text(), 'Building the infrastructure for next-generation legal work.')
                size = title.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)')
                logo = p.locator('.ruth-home svg').bounding_box()
                self.assertGreater(logo['height'], 2*size)
                self.assertGreaterEqual(size, 1.08*old_size)
                self.assertLessEqual(size, 1.12*old_size)
                self.assertGreaterEqual(size,18)
                self.assertLess(logo['y']+logo['height'],title.bounding_box()['y'])
                p.close()

    def test_face_and_balance_share_the_frame(self):
        # Source landmarks: nose, chain attachment, and top of the only pan rim.
        # Observe the renderer sampling the film, independently of the overlay.
        for w,h,face_range in [(1440,900,(.43,.47))]:
            with self.subTest(viewport=(w,h)):
                p = self.browser.new_page(viewport={'width':w,'height':h})
                self.addCleanup(p.close)
                p.add_init_script('''const draw = CanvasRenderingContext2D.prototype.drawImage;
                    CanvasRenderingContext2D.prototype.drawImage = function(source,...args) {
                        if (source instanceof HTMLVideoElement && args.length === 4) {
                            window.filmRect = args.map((v,i) => v/(i%2 ? this.canvas.height : this.canvas.width));
                        }
                        return draw.call(this, source, ...args);
                    };''')
                p.goto(self.url)
                p.wait_for_function('window.filmRect')
                x,y,width,height = p.evaluate('''() => {
                    const r=document.querySelector('#shader').getBoundingClientRect(), [x,y,w,h]=filmRect;
                    return [r.x+x*r.width,r.y+y*r.height,w*r.width,h*r.height];
                }''')
                nose = (x + .50*width)/w
                with self.subTest(landmark='face'):
                    self.assertTrue(face_range[0] <= nose <= face_range[1], nose)
                with self.subTest(landmark='chain'):
                    self.assertLess(x + .765*width, w-4)
                with self.subTest(landmark='pan rim'):
                    self.assertLess(y + .965*height, .93*h)
                p.close()

    def test_waitlist_button(self):
        for w,h in [(320,568),(390,844),(844,390),(1440,900)]:
            with self.subTest(viewport=(w,h)):
                p = self.browser.new_page(viewport={'width':w,'height':h}, reduced_motion='reduce')
                self.addCleanup(p.close)
                p.goto(self.url)
                btn = p.get_by_role('button', name='Join the waitlist', exact=True)
                box = btn.bounding_box()
                self.assertGreaterEqual(box['height'],44)
                self.assertGreaterEqual(box['width'],44)
                self.assertGreaterEqual(box['y'],0)
                self.assertLessEqual(box['y']+box['height'],h)
                self.assertEqual(btn.evaluate('e=>getComputedStyle(e).backgroundColor'), 'rgb(0, 0, 0)')
                self.assertEqual(btn.evaluate('e=>getComputedStyle(e).color'), 'rgb(242, 240, 235)')
                self.assertEqual(btn.evaluate('e=>getComputedStyle(e).borderRadius'), '0px')
                heading = p.get_by_role('heading',level=1).bounding_box()
                center = box['x']+box['width']/2
                self.assertAlmostEqual(center, heading['x']+heading['width']/2,delta=1)
                self.assertAlmostEqual(center, w/2,delta=1)
                self.assertGreaterEqual(box['y'],heading['y']+heading['height'])
                for _ in range(3):
                    p.keyboard.press('Tab')
                self.assertTrue(btn.evaluate("e=>e.matches(':focus-visible') && getComputedStyle(e).outlineStyle !== 'none'"))
                p.keyboard.press('Enter')
                self.assertTrue(p.get_by_role('textbox',name='Email address').evaluate('e=>document.activeElement===e'))
                p.keyboard.press('Escape')
                self.assertTrue(btn.evaluate('e=>document.activeElement===e'))
                p.close()

    def test_waitlist_label_is_large_bold_newsreader_without_underline(self):
        for w,h,min_size in [(1440,900,32),(820,1180,30),(390,844,30),(320,568,26)]:
            with self.subTest(width=w):
                p = self.browser.new_page(viewport={'width':w,'height':h},reduced_motion='reduce')
                self.addCleanup(p.close)
                p.goto(self.url)
                p.evaluate('document.fonts.ready')
                btn = p.locator('#signup-cta')
                self.assertGreaterEqual(btn.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)'),min_size)
                self.assertEqual(btn.evaluate('e=>getComputedStyle(e).fontWeight'),'700')
                session = p.context.new_cdp_session(p)
                session.send('DOM.enable'); session.send('CSS.enable')
                doc = session.send('DOM.getDocument')['root']['nodeId']
                node = session.send('DOM.querySelector',{'nodeId':doc,'selector':'#signup-cta'})['nodeId']
                faces = session.send('CSS.getPlatformFontsForNode',{'nodeId':node})['fonts']
                self.assertEqual(len(faces),1)
                self.assertTrue(faces[0]['isCustomFont'])
                self.assertIn('Newsreader',faces[0]['postScriptName'])
                self.assertIn('Bold',faces[0]['postScriptName'])
                decoration = lambda: btn.evaluate('e=>getComputedStyle(e).textDecorationLine')
                self.assertEqual(decoration(),'none')
                btn.hover(); self.assertEqual(decoration(),'none')
                p.mouse.down(); self.assertEqual(decoration(),'none'); p.mouse.up()
                p.keyboard.press('Escape'); self.assertEqual(decoration(),'none')
                self.assertTrue(btn.evaluate("e=>e.matches(':focus-visible')"))
                p.close()

    def test_framed_waitlist_target(self):
        for w,h,touch in [(1440,900,False),(820,1180,True),(390,844,True),(320,568,True),(844,390,True)]:
            with self.subTest(viewport=(w,h)):
                p = self.browser.new_page(viewport={'width':w,'height':h},has_touch=touch,is_mobile=touch,reduced_motion='reduce')
                self.addCleanup(p.close)
                p.goto(self.url)
                p.evaluate('document.fonts.ready')
                btn = p.locator('#signup-cta')
                box = btn.bounding_box()
                self.assertGreaterEqual(box['width'],210)
                self.assertGreaterEqual(box['height'],64)
                # Points just inside the expanded surface activate the real button.
                self.assertTrue(btn.evaluate('''e=>{let r=e.getBoundingClientRect();return [r.left+2,r.right-2].every(x=>[r.top+2,r.bottom-2].every(y=>document.elementFromPoint(x,y)===e))}'''))
                frame = btn.evaluate('''e=>{let s=getComputedStyle(e,'::after');return [s.content,s.top,s.borderTopStyle,s.borderTopWidth]}''')
                self.assertEqual(frame,['""','-6px','solid','1px'])
                self.assertGreaterEqual(min(box['x'], w-box['x']-box['width'], h-box['y']-box['height'])-6,10)
                self.assertGreater(box['y']-6,p.locator('h1').evaluate('e=>e.getBoundingClientRect().bottom'))
                for _ in range(3):
                    p.keyboard.press('Tab')
                self.assertTrue(btn.evaluate("e=>e.matches(':focus-visible') && parseFloat(getComputedStyle(e).outlineOffset)<0"))
                p.keyboard.press('Enter')
                self.assertEqual(btn.evaluate("e=>getComputedStyle(e,'::after').content"),'none')
                p.keyboard.press('Escape')
                self.assertTrue(btn.evaluate("e=>e===document.activeElement && getComputedStyle(e,'::after').content!=='none'"))
                p.close()

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
