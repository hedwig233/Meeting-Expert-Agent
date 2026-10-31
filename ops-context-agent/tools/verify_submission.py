"""Verify archive integrity and start the extracted app without developer credentials."""
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def verify():
    archive = ROOT / 'dist' / 'ContextOps-交付包.zip'
    with tempfile.TemporaryDirectory(prefix='contextops-reproduce-') as folder:
        destination = Path(folder)
        with ZipFile(archive) as bundle:
            assert bundle.testzip() is None, 'Damaged archive'
            for name in bundle.namelist():
                target = (destination / name).resolve()
                assert destination.resolve() in target.parents, 'Unexpected archive path'
            bundle.extractall(destination)
        project = destination / 'ops-context-agent'
        manifest = json.loads((project / 'MANIFEST.json').read_text(encoding='utf-8'))
        for entry in manifest['files']:
            digest = hashlib.sha256((project / entry['path']).read_bytes()).hexdigest()
            assert digest == entry['sha256'], 'File checksum mismatch'
        result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v'], cwd=str(project), capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError('Extracted unit tests failed: ' + result.stderr)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        environment = os.environ.copy()
        environment.update({
            'OPENAI_API_KEY': 'submission-smoke-only-not-a-real-key',
            'OPENAI_BASE_URL': 'https://example.invalid/v1',
            'OPENAI_MODEL': 'submission-smoke-model',
            'HOST': '127.0.0.1', 'PORT': str(port),
            'CODEX_HOME': str(destination / 'no-personal-codex'),
        })
        process = subprocess.Popen([sys.executable, '-u', 'server.py'], cwd=str(project), env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        url = 'http://127.0.0.1:' + str(port)
        try:
            for attempt in range(50):
                try:
                    with opener.open(url, timeout=1) as response:
                        assert response.status == 200
                    break
                except urllib.error.URLError:
                    if process.poll() is not None:
                        raise RuntimeError('Extracted app exited before serving requests')
                    time.sleep(0.1)
            else:
                raise RuntimeError('Extracted app did not start')
            for filename in ['index.html', 'styles.css', 'minutes.js', 'app.js', 'docs/演示材料.html', 'examples/meeting-demo.txt']:
                from urllib.parse import quote
                with opener.open(url + '/' + quote(filename), timeout=3) as response:
                    assert response.status == 200 and response.read(), filename
            request = urllib.request.Request(url + '/api/minutes', data=b'{}', headers={'Content-Type': 'application/json'})
            try:
                opener.open(request, timeout=3)
                raise AssertionError('Invalid request was unexpectedly accepted')
            except urllib.error.HTTPError as error:
                assert error.code == 400
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        print('PASS: archive hashes, extracted unit tests, clean startup, static files, API validation')
        print('No real model request was made; developer credentials were not used.')


if __name__ == '__main__':
    verify()
