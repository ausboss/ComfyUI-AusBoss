from __future__ import annotations

import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

import av
import numpy as np
from aiohttp import FormData, StreamReader, web
from aiohttp.test_utils import make_mocked_request

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
        self.handler = handler

    async def upload(self, body, filename='clip.mp4'):
        form = FormData()
        form.add_field('image', io.BytesIO(body), filename=filename, content_type='video/mp4')
        payload = form()
        stream = StreamReader(Mock(_reading_paused=False), limit=1024)

        class Writer:
            async def write(self, chunk):
                stream.feed_data(chunk)

        await payload.write(Writer())
        stream.feed_eof()
        request = make_mocked_request('POST', '/upload', headers=payload.headers,
                                      payload=stream, client_max_size=1024)
        return await self.handler(request)

    async def test_stream_exceeds_buffered_body_limit_and_retains_bytes(self):
        body = self.body + b'\0' * (2 * 1024 * 1024)
        response = await self.upload(body)
        self.assertEqual(response.status, 200, response.text)
        result = json.loads(response.text)
        self.assertEqual((self.root / result['name']).read_bytes(), body)

    async def test_collision_and_symlink_never_overwrite(self):
        (self.root / 'kept.txt').write_text('keep')
        (self.root / 'clip.mp4').symlink_to(self.root / 'kept.txt')
        response = await self.upload(self.body)
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(response.text)['name'], 'clip_1.mp4')
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
