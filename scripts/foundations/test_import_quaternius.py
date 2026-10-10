#!/usr/bin/env python3
"""Fast offline tests for Quaternius ZIP intake safeguards."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

MODULE_PATH = Path(__file__).with_name("import_quaternius.py")
spec = importlib.util.spec_from_file_location("import_quaternius", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class FoundationImportTests(unittest.TestCase):
    def test_safe_member_paths(self):
        self.assertTrue(mod.safe_name("pack/folder/model.gltf"))
        for entry in ("../outside", "/absolute", "pack/../../outside", r"pack\\windows"):
            with self.subTest(entry=entry):
                self.assertFalse(mod.safe_name(entry))

    def test_selects_compatible_gltf_without_unrelated_files(self):
        names = [
            "P/Base Characters/Godot - UE/Superhero_Female_FullBody.gltf",
            "P/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf",
            "P/Hairstyles/Origin at 0/glTF (Godot)/Hair_Buzzed.gltf",
        ]
        self.assertEqual(len(mod.select_members("base", names)), 2)

    def test_glb_json_header_and_declared_length(self):
        document = {"nodes": [{"name": "root"}], "skins": [{"joints": [0]}],
                    "animations": [{"name": "Walk_Loop"}]}
        payload = json.dumps(document).encode("utf-8")
        payload += b" " * ((4 - len(payload) % 4) % 4)
        raw = b"glTF" + struct.pack("<II", 2, 20 + len(payload)) + struct.pack("<II", len(payload), 0x4E4F534A) + payload
        self.assertEqual(mod.read_glb_json(raw), document)
        self.assertEqual(mod.skeleton(document), ["root"])
        with self.assertRaises(ValueError):
            mod.read_glb_json(raw[:-1])

    def test_rejects_lfs_pointer_as_zip(self):
        with tempfile.TemporaryDirectory() as directory:
            pointer = Path(directory) / "asset.zip"
            pointer.write_text("version https://git-lfs.github.com/spec/v1\n")
            with self.assertRaisesRegex(ValueError, "LFS pointer"):
                mod.import_pack("base", pointer, Path(directory) / "out")

    def test_records_hashes_for_buffers_and_repaired_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "base.zip"
            folder = "Pack/Base Characters/Godot - UE/"
            document = {"nodes": [{"name": "root"}], "skins": [{"joints": [0]}],
                        "buffers": [{"uri": "mesh.bin"}],
                        "images": [{"uri": "T_Eye_Normal_png.png"}]}
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("License.txt", "CC0 1.0")
                for name in ("Superhero_Female", "Superhero_Male"):
                    z.writestr(folder + name + ".gltf", json.dumps(document))
                z.writestr(folder + "mesh.bin", b"mesh data")
                z.writestr(folder + "T_Eye_Normal.png", b"image data")
            _, records = mod.import_pack("base", archive, root / "out")
            for record in records:
                self.assertEqual(record["dependency_sha256"], {
                    "mesh.bin": mod.digest(b"mesh data"),
                    "T_Eye_Normal.png": mod.digest(b"image data"),
                })
                resolved = json.loads((root / "out" / record["path"]).read_text())
                self.assertEqual(resolved["images"][0]["uri"], "T_Eye_Normal.png")
                self.assertEqual(record["sha256"], mod.file_digest(root / "out" / record["path"]))

    def test_repair_table_matches_known_source_pack_filename_errors(self):
        self.assertEqual(mod.FIXED_URIS["T_Eye_Normal_png.png"], "T_Eye_Normal.png")
        self.assertEqual(mod.FIXED_URIS["T_Hair_1_Normal_png.png"], "T_Hair_1_Normal.png")


if __name__ == "__main__":
    unittest.main()
