#!/usr/bin/env python3
"""Pull tested public releases; no GitHub, SSH or TMDB credentials are needed.

Run every two minutes with alwaysdata Scheduled tasks. Only main builds published
by the repository workflow qualify. Staging and health checks precede activation;
an unsuccessful activation restores the old symlink and restarts the old version.
"""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.request import Request, urlopen

REPOSITORY = 'Shankslegenda/movieboxd'
DOWNLOADS = f'https://github.com/{REPOSITORY}/releases'
MANIFEST_URL = f'{DOWNLOADS}/latest/download/movieboxd-manifest.json'
PUBLIC_URL = 'https://aldiyar.alwaysdata.net'
MAX_ARCHIVE = 100 * 1024 * 1024
MAX_EXPANDED = 350 * 1024 * 1024


def get_json(url):
    with urlopen(Request(url, headers={'User-Agent': 'Movieboxd-deployer/1.0',
                                      'Cache-Control': 'no-cache'}), timeout=20) as response:
        data = response.read(16385)
    if len(data) > 16384:
        raise ValueError('JSON response exceeds limit')
    return json.loads(data)


def validate_manifest(value):
    if (value.get('schema') != 1 or value.get('repository') != REPOSITORY
            or not re.fullmatch(r'[a-f0-9]{40}', value.get('revision', ''))
            or not re.fullmatch(r'[a-f0-9]{64}', value.get('sha256', ''))
            or not re.fullmatch(r'alwaysdata-[a-f0-9]{40}-[0-9]+-[0-9]+', value.get('tag', ''))
            or not value['tag'].startswith('alwaysdata-' + value['revision'] + '-')
            or type(value.get('bytes')) is not int or not 0 < value['bytes'] <= MAX_ARCHIVE):
        raise ValueError('Invalid release manifest')
    return value


def download_archive(manifest, target):
    url = f"{DOWNLOADS}/download/{manifest['tag']}/movieboxd.tar.gz"
    checksum, count = hashlib.sha256(), 0
    with urlopen(Request(url, headers={'User-Agent': 'Movieboxd-deployer/1.0'}), timeout=45) as response, target.open('wb') as output:
        while chunk := response.read(65536):
            count += len(chunk)
            if count > manifest['bytes']:
                raise ValueError('Archive exceeds declared size')
            checksum.update(chunk)
            output.write(chunk)
    if count != manifest['bytes'] or checksum.hexdigest() != manifest['sha256']:
        raise ValueError('Archive integrity check failed')


def extract_archive(archive, destination):
    with tarfile.open(archive, 'r:gz') as packed:
        members = packed.getmembers()
        if len(members) > 40000 or sum(m.size for m in members) > MAX_EXPANDED:
            raise ValueError('Expanded archive exceeds limit')
        allowed = {'server', 'shared', 'dist', 'node_modules', 'deploy', 'package.json', 'package-lock.json'}
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or '..' in path.parts or not path.parts
                    or path.parts[0] not in allowed):
                raise ValueError('Unsafe archive path')
            if path.parts[0] == 'deploy' and str(path) not in ('deploy', 'deploy/check-release.mjs'):
                raise ValueError('Unexpected deployment script')
        # The standard data filter also rejects escaping symlinks and special files.
        packed.extractall(destination, members=members, filter='data')


def revision_at(path):
    try:
        return json.loads((path / 'dist/version.json').read_text())['revision']
    except (OSError, ValueError, KeyError):
        return None


def atomic_link(link, target):
    temporary = link.with_name(link.name + '.next')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, link)


def restart(root, expected_directory):
    pid = int((root / 'app.pid').read_text().strip())
    if pid <= 1:
        raise ValueError('Invalid application pid')
    try:
        cwd = Path(f'/proc/{pid}/cwd').resolve(strict=True)
    except FileNotFoundError:
        return  # alwaysdata will restart a process that already exited.
    if cwd != expected_directory.resolve():
        raise ValueError('Refusing to signal an unrelated process')
    os.kill(pid, signal.SIGTERM)


def wait_healthy(revision, timeout=75):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            suffix = f'?deployment_check={time.time_ns()}'
            health = get_json(PUBLIC_URL + '/api/health' + suffix)
            version_ok = revision is None or get_json(PUBLIC_URL + '/version.json' + suffix).get('revision') == revision
            if health.get('ok') is True and health.get('tmdbConfigured') is True and version_ok:
                return True
        except Exception:
            pass
        time.sleep(3)
    return False


def check_release(directory):
    env = dict(os.environ, NODEJS_VERSION='24', NODE_OPTIONS='--max-old-space-size=80',
               TMDB_API_KEY='', TMDB_READ_ACCESS_TOKEN='', NODE_ENV='production')
    subprocess.run(['node', 'deploy/check-release.mjs'], cwd=directory, env=env,
                   check=True, timeout=45)


def prune_generated_releases(root):
    keep = {(root / name).resolve() for name in ('current', 'previous') if (root / name).exists()}
    for directory in (root / 'releases').iterdir():
        if (directory.is_dir() and not directory.is_symlink()
                and re.fullmatch(r'[a-f0-9]{40}', directory.name) and directory.resolve() not in keep):
            shutil.rmtree(directory)


def deploy_once(root):
    manifest = validate_manifest(get_json(MANIFEST_URL))
    revision = manifest['revision']
    current = (root / 'current').resolve(strict=True)
    if revision_at(current) == revision:
        return 'unchanged'
    failed = root / 'failed-revision'
    if failed.exists() and failed.read_text().strip() == revision:
        return 'previously-failed'  # A new commit is required; avoid restart loops.
    (root / 'releases').mkdir(exist_ok=True)
    if shutil.disk_usage(root).free < MAX_EXPANDED + MAX_ARCHIVE:
        raise RuntimeError('Insufficient disk space to stage a release safely')
    with tempfile.TemporaryDirectory(prefix='stage-', dir=root) as temporary:
        stage = Path(temporary)
        archive = stage / 'release.tar.gz'
        download_archive(manifest, archive)
        extracted = stage / 'app'
        extracted.mkdir()
        extract_archive(archive, extracted)
        if revision_at(extracted) != revision:
            raise ValueError('Packaged revision does not match manifest')
        check_release(extracted)
        candidate = root / 'releases' / revision
        if candidate.exists():
            raise RuntimeError('A staged directory already exists; inspect it before retrying')
        extracted.rename(candidate)
    atomic_link(root / 'current', candidate)
    try:
        restart(root, current)
        if not wait_healthy(revision):
            raise RuntimeError('New revision did not become healthy')
    except Exception:
        atomic_link(root / 'current', current)
        with contextlib.suppress(Exception):
            restart(root, candidate)
        restored = wait_healthy(revision_at(current))
        failed.write_text(revision + '\n')
        raise RuntimeError(f'Deployment failed; rollback healthy={restored}') from None
    atomic_link(root / 'previous', current)
    failed.unlink(missing_ok=True)
    (root / 'deployment.json').write_text(json.dumps({
        'revision': revision, 'tag': manifest['tag'], 'deployedAt': time.time(),
        'previousRevision': revision_at(current), 'status': 'healthy',
    }, indent=2) + '\n')
    prune_generated_releases(root)
    print(f'DEPLOYED {revision}', flush=True)
    return 'deployed'


if __name__ == '__main__':
    deploy_root = Path(os.environ.get('MOVIEBOXD_DEPLOY_ROOT', str(Path.home() / 'movieboxd-deploy')))
    deploy_root.mkdir(exist_ok=True)
    with (deploy_root / 'deploy.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            sys.exit(0)
        try:
            deploy_once(deploy_root)
        except Exception as error:
            # No credential values, request bodies or environment variables in logs.
            print(f'DEPLOYMENT_ERROR {type(error).__name__}: {error}', file=sys.stderr)
            sys.exit(1)
