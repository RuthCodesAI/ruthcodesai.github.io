"""Check the original full-length film and its first-paint poster with ffprobe."""
import json
from pathlib import Path
import subprocess
import unittest


ASSETS = Path(__file__).resolve().parents[1] / 'assets' / 'video'


class ArtworkTest(unittest.TestCase):
    def test_film_and_poster_share_the_original_frame(self):
        for name in ('gentle-lift.mp4', 'gentle-lift-poster.webp'):
            with self.subTest(name=name):
                probe = subprocess.check_output([
                    'ffprobe', '-v', 'error', '-select_streams', 'v:0',
                    '-show_entries', 'stream=width,height,duration,nb_frames',
                    '-of', 'json', str(ASSETS / name),
                ], text=True, timeout=30)
                stream, = json.loads(probe)['streams']
                self.assertEqual((stream['width'], stream['height']), (1916, 1080))
                if name.endswith('.mp4'):
                    self.assertEqual(int(stream['nb_frames']), 735)
                    self.assertAlmostEqual(float(stream['duration']), 12.25, places=2)
