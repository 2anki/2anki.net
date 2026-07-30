import os
import tempfile
from unittest import TestCase, mock
from genanki import Note, Model

from helpers.write_apkg import (
    FastPackage,
    sanitize_filename,
    _write_new_apkg,
    rename_temp_file,
)

class TestWriteApkg(TestCase):
    def setUp(self):
        self.test_model = Model(
            1607392319,
            'Test Model',
            [{'name': 'Question'}, {'name': 'Answer'}],
            [{'name': 'Card 1', 'qfmt': '{{Question}}', 'afmt': '{{Answer}}'}]
        )
        
    def test_sanitize_filename(self):
        test_cases = [
            ("Hello World!", "Hello-World"),
            ("Test@#$%^&*", "Test"),
            ("Space - Dash", "Space---Dash"),
            ("emoji😀test", "emoji😀test"),
            ("", "")
        ]
        
        for input_name, expected in test_cases:
            self.assertEqual(sanitize_filename(input_name), expected)

    @mock.patch('helpers.write_apkg.FastPackage')
    @mock.patch('helpers.write_apkg.os.replace')
    def test_write_new_apkg_single_deck(self, mock_replace, mock_fast_package):
        note = Note(model=self.test_model, fields=['Q1', 'A1'])
        deck_payload = {
            "id": 1234567890,
            "name": "Test Deck",
            "desc": "Test Description",
            "notes": [note]
        }
        
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch('os.getcwd', return_value=tmpdir):
                _write_new_apkg([deck_payload], [])
                
                # Verify Package was created with correct deck
                mock_fast_package.assert_called_once()
                created_deck = mock_fast_package.call_args[0][0][0]
                self.assertEqual(created_deck.name, "Test Deck")
                self.assertEqual(str(created_deck.deck_id), "1234567890")
                
                # Verify file operations
                mock_fast_package.return_value.write_to_file.assert_called_once()
                mock_replace.assert_called_once()

    @mock.patch('helpers.write_apkg.FastPackage')
    @mock.patch('helpers.write_apkg.os.replace')
    def test_write_new_apkg_multiple_decks(self, mock_replace, mock_fast_package):
        note1 = Note(model=self.test_model, fields=['Q1', 'A1'])
        note2 = Note(model=self.test_model, fields=['Q2', 'A2'])
        
        deck_payloads = [
            {
                "id": 1234567890,
                "name": "Test Deck 1",
                "desc": "Test Description 1",
                "notes": [note1]
            },
            {
                "id": 9876543210,
                "name": "Test Deck 2",
                "desc": "Test Description 2",
                "notes": [note2]
            }
        ]
        
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch('os.getcwd', return_value=tmpdir):
                _write_new_apkg(deck_payloads, [])
                
                mock_fast_package.assert_called_once()
                created_decks = mock_fast_package.call_args[0][0]
                self.assertEqual(len(created_decks), 2)
                self.assertEqual(created_decks[0].name, "Test Deck 1")
                self.assertEqual(created_decks[1].name, "Test Deck 2")
                
                # Verify file operations
                mock_fast_package.return_value.write_to_file.assert_called_once()
                mock_replace.assert_called_once()

    @mock.patch('helpers.write_apkg.FastPackage')
    @mock.patch('helpers.write_apkg.os.replace')
    def test_write_new_apkg_with_media(self, mock_replace, mock_fast_package):
        note = Note(model=self.test_model, fields=['Q1', 'A1'])
        deck_payload = {
            "id": 1234567890,
            "name": "Test Deck",
            "desc": "Test Description",
            "notes": [note]
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            img_path = os.path.join(tmpdir, 'test.jpg')
            audio_path = os.path.join(tmpdir, 'audio.mp3')
            open(img_path, 'w').close()
            open(audio_path, 'w').close()
            media_files = [img_path, audio_path]

            with mock.patch('os.getcwd', return_value=tmpdir):
                _write_new_apkg([deck_payload], media_files)

                mock_fast_package.assert_called_once()
                package_instance = mock_fast_package.return_value
                self.assertEqual(package_instance.media_files, media_files)
                
                # Verify file operations
                mock_fast_package.return_value.write_to_file.assert_called_once()
                mock_replace.assert_called_once()

    @mock.patch('helpers.write_apkg.FastPackage')
    @mock.patch('helpers.write_apkg.os.replace')
    def test_write_new_apkg_skips_missing_media(self, mock_replace, mock_fast_package):
        note = Note(model=self.test_model, fields=['Q1', 'A1'])
        deck_payload = {
            "id": 1234567890,
            "name": "Test Deck",
            "desc": "Test Description",
            "notes": [note]
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            existing_path = os.path.join(tmpdir, 'exists.jpg')
            open(existing_path, 'w').close()
            media_files = [existing_path, 'image.png']

            with mock.patch('os.getcwd', return_value=tmpdir):
                _write_new_apkg([deck_payload], media_files)

                package_instance = mock_fast_package.return_value
                self.assertEqual(package_instance.media_files, [existing_path])

    @mock.patch('helpers.write_apkg.FastPackage')
    @mock.patch('helpers.write_apkg.os.replace')
    def test_write_new_apkg_dedupes_repeated_media(self, mock_replace, mock_fast_package):
        note = Note(model=self.test_model, fields=['Q1', 'A1'])
        deck_payload = {
            "id": 1234567890,
            "name": "Test Deck",
            "desc": "Test Description",
            "notes": [note]
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            page_one = os.path.join(tmpdir, 'page-1.png')
            page_two = os.path.join(tmpdir, 'page-2.png')
            open(page_one, 'w').close()
            open(page_two, 'w').close()
            media_files = [page_one, page_one, page_two, page_one]

            with mock.patch('os.getcwd', return_value=tmpdir):
                _write_new_apkg([deck_payload], media_files)

                package_instance = mock_fast_package.return_value
                self.assertEqual(package_instance.media_files, [page_one, page_two])

    @mock.patch('helpers.write_apkg.FastPackage')
    @mock.patch('helpers.write_apkg.os.replace')
    def test_write_new_apkg_empty_deck_list(self, mock_replace, mock_fast_package):
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch('os.getcwd', return_value=tmpdir):
                _write_new_apkg([], [])
                
                mock_fast_package.assert_called_once()
                mock_fast_package.return_value.write_to_file.assert_called_once()
                mock_replace.assert_called_once()
                
                # Verify the default name is used
                _, dst = mock_replace.call_args[0]
                self.assertIn("default-", dst)

    def test_sanitize_filename_security(self):
        """Test that sanitize_filename prevents path traversal attacks."""
        dangerous_cases = [
            ("../../../etc/passwd", "etcpasswd"),
            ("..\\..\\windows\\system32", "windowssystem32"),
            ("/etc/passwd", "etcpasswd"),
            ("C:\\Windows\\System32", "CWindowsSystem32"),
            ("./config/secrets", "configsecrets"),
            ("../test", "test"),
            ("test/../danger", "testdanger"),
        ]
        
        for dangerous_input, expected_safe in dangerous_cases:
            result = sanitize_filename(dangerous_input)
            self.assertEqual(result, expected_safe, 
                           f"Failed to sanitize '{dangerous_input}' properly")
            # Ensure no path separators remain
            self.assertNotIn('/', result)
            self.assertNotIn('\\', result)
            self.assertNotIn('..', result)

    def test_rename_temp_file_security(self):
        """Test that rename_temp_file prevents path traversal attacks."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a temporary file to rename
            temp_file = os.path.join(tmpdir, "temp.apkg")
            with open(temp_file, 'w') as f:
                f.write("test content")
            
            with mock.patch('os.getcwd', return_value=tmpdir):
                # Test dangerous inputs that should be blocked
                dangerous_cases = [
                    ("../../../danger", "1234"),
                    ("normal", "../../../etc/passwd"),
                    ("../up", "../back"),
                ]
                
                for dangerous_name, dangerous_id in dangerous_cases:
                    with self.assertRaises(ValueError) as cm:
                        rename_temp_file(temp_file, dangerous_name, dangerous_id)
                    self.assertIn("Path traversal attempt detected", str(cm.exception))
                
                # Test that safe inputs work correctly
                safe_result = rename_temp_file(temp_file, "safe_name", "1234")
                expected_path = os.path.join(tmpdir, "safe_name-1234.apkg")
                self.assertEqual(safe_result, expected_path)
                self.assertTrue(os.path.exists(safe_result))

    def test_rename_temp_file_basename_only(self):
        """Test that rename_temp_file works with safe filenames."""
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_file = os.path.join(tmpdir, "temp.apkg")
            with open(temp_file, 'w') as f:
                f.write("test content")
            
            with mock.patch('os.getcwd', return_value=tmpdir):
                # Test with safe inputs (no path separators)
                result = rename_temp_file(temp_file, "safe_name", "safe_id")
                expected_filename = "safe_name-safe_id.apkg"
                self.assertTrue(result.endswith(expected_filename))
                self.assertTrue(os.path.exists(result))

                # Verify the file is in the expected directory
                self.assertEqual(os.path.dirname(result), tmpdir)


class TestFastPackagePragmas(TestCase):
    def test_sets_memory_journal_and_off_synchronous_before_writing(self):
        """FastPackage.write_to_db must set the fast pragmas before any DDL."""
        package = FastPackage([])
        cursor = mock.MagicMock()
        id_gen = iter([1, 2, 3])

        with mock.patch(
            'genanki.package.Package.write_to_db',
            return_value=None,
        ) as super_write:
            package.write_to_db(cursor, 1.0, id_gen)

        execute_calls = [c.args[0] for c in cursor.execute.call_args_list]
        self.assertIn('PRAGMA journal_mode=MEMORY', execute_calls)
        self.assertIn('PRAGMA synchronous=OFF', execute_calls)
        super_write.assert_called_once_with(cursor, 1.0, id_gen)

    def test_pragmas_run_before_super_write_to_db(self):
        """Pragmas must run before super().write_to_db so the schema DDL benefits."""
        package = FastPackage([])
        cursor = mock.MagicMock()
        id_gen = iter([1, 2, 3])
        call_order = []

        cursor.execute.side_effect = lambda sql: call_order.append(('execute', sql))

        def fake_super(self_, c, t, g):  # pragma: no cover - exercised below
            call_order.append(('super_write', None))

        with mock.patch(
            'genanki.package.Package.write_to_db',
            side_effect=fake_super,
            autospec=True,
        ):
            package.write_to_db(cursor, 1.0, id_gen)

        labels = [label for label, _ in call_order]
        self.assertEqual(
            labels,
            ['execute', 'execute', 'super_write'],
            f"Expected pragmas first, then super write_to_db. Got: {call_order}",
        )
