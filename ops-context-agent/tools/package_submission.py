"""Create a reproducible submission archive from an explicit project allowlist."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'dist'
FILES = [
    'index.html', 'styles.css', 'minutes.js', 'app.js', 'server.py',
    'model-config.json', 'README.md', 'requirements.txt',
    '.env.example', '.gitignore', 'Dockerfile', '.dockerignore',
    'tests/test_minutes.py', 'examples/meeting-demo.txt',
    'tools/package_submission.py', 'tools/record_demo.py', 'tools/verify_submission.py', 'tools/transcode_demo.py',
]
DOCS = [
    '项目介绍.md', '代码与运行说明.md', '组件来源.md', '演示脚本.md',
    '提交清单.md', '验证记录.md', '演示材料.html', 'video-metadata.json',
    '演示视频.mp4', '演示视频.webm',
    'screenshots/01-import.png', 'screenshots/02-tasks.png',
    'screenshots/03-expert.png', 'screenshots/04-search.png',
]


def package():
    files = sorted(FILES + ['docs/' + name for name in DOCS])
    for relative in files:
        if not (ROOT / relative).is_file():
            raise SystemExit('Missing submission file: ' + relative)
    OUTPUT.mkdir(exist_ok=True)
    archive = OUTPUT / 'ContextOps-交付包.zip'
    manifest = {'project': 'ContextOps', 'files': []}
    with ZipFile(archive, 'w', ZIP_DEFLATED) as bundle:
        for relative in files:
            content = (ROOT / relative).read_bytes()
            manifest['files'].append({'path': relative, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
            bundle.writestr('ops-context-agent/' + relative, content)
        bundle.writestr('ops-context-agent/MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    (OUTPUT / 'SHA256SUMS.txt').write_text(checksum + '  ' + archive.name + '\n', encoding='utf-8')
    print('Archive: ' + str(archive))
    print('Files: ' + str(len(files) + 1))
    print('Bytes: ' + str(archive.stat().st_size))
    print('SHA256: ' + checksum)


if __name__ == '__main__':
    package()
