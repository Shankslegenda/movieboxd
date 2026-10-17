import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import alwaysdata as deploy

SHA = 'a' * 40
OLD = 'b' * 40


def manifest():
    return {'schema': 1, 'repository': deploy.REPOSITORY, 'revision': SHA,
            'tag': f'alwaysdata-{SHA}-123-1', 'sha256': '0' * 64, 'bytes': 10}


def app(path, revision):
    (path / 'dist').mkdir(parents=True)
    (path / 'dist/version.json').write_text(json.dumps({'revision': revision}))


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.old = self.root / 'legacy'
        app(self.old, OLD)
        (self.root / 'current').symlink_to(self.old)

    def test_manifest_rejects_other_repository_paths_and_bad_size(self):
        self.assertEqual(deploy.validate_manifest(manifest())['revision'], SHA)
        for key, value in [('repository', 'other/project'), ('revision', '../bad'),
                           ('tag', '../release'), ('bytes', 0), ('bytes', True),
                           ('sha256', 'bad'), ('bytes', deploy.MAX_ARCHIVE + 1)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                deploy.validate_manifest(dict(manifest(), **{key: value}))

    def test_download_rejects_corruption(self):
        with patch.object(deploy, 'urlopen', return_value=io.BytesIO(b'corrupted!')):
            with self.assertRaisesRegex(ValueError, 'integrity'):
                deploy.download_archive(manifest(), self.root / 'archive')

    def test_valid_download_checks_size_and_digest(self):
        content = b'valid-data'
        value = dict(manifest(), sha256=hashlib.sha256(content).hexdigest(), bytes=len(content))
        with patch.object(deploy, 'urlopen', return_value=io.BytesIO(content)):
            deploy.download_archive(value, self.root / 'archive')
        self.assertEqual((self.root / 'archive').read_bytes(), content)

    def test_tar_rejects_traversal_and_secret_files(self):
        for name in ['../escape', '/tmp/escape', '.env', '.data/tmdb.sqlite', 'deploy/evil.py']:
            archive = self.root / 'bad.tar.gz'
            with tarfile.open(archive, 'w:gz') as packed:
                item = tarfile.TarInfo(name)
                item.size = 1
                packed.addfile(item, io.BytesIO(b'x'))
            with self.subTest(name=name), self.assertRaises(ValueError):
                deploy.extract_archive(archive, self.root / 'extracted')

    def test_tar_rejects_escaping_symlink(self):
        archive = self.root / 'bad.tar.gz'
        with tarfile.open(archive, 'w:gz') as packed:
            item = tarfile.TarInfo('server/escape')
            item.type = tarfile.SYMTYPE
            item.linkname = '/etc'
            packed.addfile(item)
        with self.assertRaises(tarfile.FilterError):
            deploy.extract_archive(archive, self.root / 'extracted')

    def mocks(self):
        self.enterContext(patch.object(deploy, 'get_json', return_value=manifest()))
        self.enterContext(patch.object(deploy, 'download_archive'))
        self.enterContext(patch.object(deploy, 'extract_archive', side_effect=lambda archive, directory: app(directory, SHA)))
        self.preflight = self.enterContext(patch.object(deploy, 'check_release'))
        self.restart = self.enterContext(patch.object(deploy, 'restart'))
        self.health = self.enterContext(patch.object(deploy, 'wait_healthy', return_value=True))

    def test_success_switches_atomically_and_keeps_previous(self):
        self.mocks()
        self.assertEqual(deploy.deploy_once(self.root), 'deployed')
        self.assertEqual(deploy.revision_at((self.root / 'current').resolve()), SHA)
        self.assertEqual((self.root / 'previous').resolve(), self.old)
        self.assertTrue(self.old.exists())
        self.restart.assert_called_once_with(self.root, self.old)
        self.assertEqual(json.loads((self.root / 'deployment.json').read_text())['status'], 'healthy')

    def test_preflight_failure_does_not_restart_live_site(self):
        self.mocks()
        self.preflight.side_effect = RuntimeError('invalid build')
        with self.assertRaises(RuntimeError):
            deploy.deploy_once(self.root)
        self.assertEqual((self.root / 'current').resolve(), self.old)
        self.restart.assert_not_called()

    def test_failed_startup_rolls_back_and_does_not_loop(self):
        self.mocks()
        self.health.side_effect = [False, True]
        with self.assertRaisesRegex(RuntimeError, 'rollback healthy=True'):
            deploy.deploy_once(self.root)
        self.assertEqual((self.root / 'current').resolve(), self.old)
        self.assertEqual(self.restart.call_count, 2)
        self.assertEqual(deploy.deploy_once(self.root), 'previously-failed')
        self.assertEqual(self.restart.call_count, 2)

    def test_same_revision_is_a_noop(self):
        self.mocks()
        (self.old / 'dist/version.json').write_text(json.dumps({'revision': SHA}))
        self.assertEqual(deploy.deploy_once(self.root), 'unchanged')
        self.preflight.assert_not_called()
        self.restart.assert_not_called()

    def test_cleanup_only_removes_generated_unreferenced_releases(self):
        releases = self.root / 'releases'
        releases.mkdir()
        app(releases / SHA, SHA)
        app(releases / OLD, OLD)
        (releases / 'notes').mkdir()
        deploy.atomic_link(self.root / 'current', releases / SHA)
        deploy.atomic_link(self.root / 'previous', self.old)
        deploy.prune_generated_releases(self.root)
        self.assertTrue((releases / SHA).exists())
        self.assertFalse((releases / OLD).exists())
        self.assertTrue((releases / 'notes').exists())
        self.assertTrue(self.old.exists())


if __name__ == '__main__':
    unittest.main()
