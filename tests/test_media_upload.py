from __future__ import annotations

import io
from pathlib import Path
import sys
import tempfile
import unittest

import av
import numpy as np
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from nodes._media_upload import stream_video_upload, upload_name


def movie(path):
    with av.open(str(path), 'w') as container:
        stream = container.add_stream('mpeg4', rate=12)
        stream.width = stream.height = 32
        stream.pix_fmt = 'yuv420p'
        frame = av.VideoFrame.from_ndarray(np.zeros((32, 32, 3), dtype=np.uint8), format='rgb24')
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


class UploadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        source = self.root / 'source.mp4'
        movie(source)
        self.body = source.read_bytes()
        source.unlink()

        async def handler(request):
            try:
                return web.json_response(await stream_video_upload(request, self.root, {'.mp4', '.mov'}))
            except Exception as exc:
                return web.json_response({'error': str(exc)}, status=400)
        app = web.Application(client_max_size=1024)
        app.router.add_post('/upload', handler)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)

    async def upload(self, body, filename='clip.mp4'):
        form = FormData()
        form.add_field('image', io.BytesIO(body), filename=filename, content_type='video/mp4')
        return await self.client.post('/upload', data=form)

    async def test_stream_exceeds_buffered_body_limit_and_retains_bytes(self):
        body = self.body + b'\0' * (2 * 1024 * 1024)
        response = await self.upload(body)
        self.assertEqual(response.status, 200, await response.text())
        result = await response.json()
        self.assertEqual((self.root / result['name']).read_bytes(), body)

    async def test_collision_and_symlink_never_overwrite(self):
        (self.root / 'kept.txt').write_text('keep')
        (self.root / 'clip.mp4').symlink_to(self.root / 'kept.txt')
        response = await self.upload(self.body)
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())['name'], 'clip_1.mp4')
        self.assertEqual((self.root / 'kept.txt').read_text(), 'keep')

    async def test_invalid_media_is_removed(self):
        response = await self.upload(b'not a video')
        self.assertEqual(response.status, 400)
        self.assertFalse((self.root / 'clip.mp4').exists())

    def test_only_plain_supported_filenames_are_accepted(self):
        for name in ['../clip.mp4', '/clip.mp4', 'C:\\clip.mp4', 'clip.py', 'x\0.mp4']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                upload_name(name, {'.mp4'})


if __name__ == '__main__':
    unittest.main()
