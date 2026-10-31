"""Convert the recorded WebM to MP4 using an optional local FFmpeg executable."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def transcode(executable=None):
    executable = executable or shutil.which('ffmpeg')
    if not executable:
        try:
            import imageio_ffmpeg
            executable = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            raise SystemExit('Install FFmpeg or optional imageio-ffmpeg, or pass --ffmpeg PATH.')
    source = ROOT / 'docs' / '演示视频.webm'
    target = ROOT / 'docs' / '演示视频.mp4'
    result = subprocess.run([
        executable, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(target),
    ], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit('FFmpeg could not convert the recording: ' + result.stderr)
    probe = subprocess.run([executable, '-hide_banner', '-i', str(target)], capture_output=True, text=True)
    duration = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', probe.stderr)
    metadata_path = ROOT / 'docs' / 'video-metadata.json'
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    metadata.update({
        'mp4_bytes': target.stat().st_size,
        'mp4_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'mp4_codec': 'H.264 / yuv420p',
        'editing': 'Continuous browser recording; captions added during recording; no simulated responses or time cuts.',
    })
    if duration:
        hours, minutes, seconds = map(float, duration.groups())
        metadata['video_duration_seconds'] = round(hours * 3600 + minutes * 60 + seconds, 2)
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('MP4 created: ' + str(target))
    print('Duration seconds: ' + str(metadata.get('video_duration_seconds')))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg')
    arguments = parser.parse_args()
    transcode(arguments.ffmpeg)
