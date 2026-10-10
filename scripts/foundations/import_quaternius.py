#!/usr/bin/env python3
"""Import vetted Quaternius Standard ZIP packs into a local, unaccepted asset catalog.

Outputs go to .tmp/ by default; no project production asset is silently accepted.
Requires Python >=3.10; uses only the standard library.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import struct
import sys
import zipfile

PACKS = {
    'base': ('universal-base-characters', 'Universal Base Characters[Standard].zip'),
    'animations-1': ('universal-animation-library-1', 'Universal Animation Library[Standard].zip'),
    'animations-2': ('universal-animation-library-2', 'Universal Animation Library 2[Standard].zip'),
    'outfits': ('modular-character-outfits', 'Modular Character Outfits - Fantasy[Standard].zip'),
}
FIXED_URIS = {
    'T_Eye_Normal_png.png': 'T_Eye_Normal.png',
    'T_Hair_1_Normal_png.png': 'T_Hair_1_Normal.png',
}
MAX_FILE_SIZE = 150 * 1024 * 1024
MAX_TOTAL_SIZE = 1300 * 1024 * 1024


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def read_glb_json(raw: bytes) -> dict:
    if len(raw) < 20 or raw[:4] != b'glTF' or struct.unpack_from('<I', raw, 4)[0] != 2:
        raise ValueError('expected a valid glTF 2.0 GLB')
    declared_length = struct.unpack_from('<I', raw, 8)[0]
    chunk_length, chunk_type = struct.unpack_from('<II', raw, 12)
    if declared_length != len(raw) or chunk_type != 0x4E4F534A or chunk_length > len(raw) - 20:
        raise ValueError('invalid GLB JSON chunk')
    return json.loads(raw[20:20 + chunk_length])


def skeleton(document: dict) -> list[str]:
    skins = document.get('skins', [])
    if not skins:
        raise ValueError('rigged foundation asset has no glTF skins')
    nodes = document.get('nodes', [])
    return [nodes[index].get('name', '') for index in skins[0]['joints']]


def safe_name(name: str) -> bool:
    p = PurePosixPath(name)
    return bool(name) and not p.is_absolute() and '..' not in p.parts and '\\' not in name


def select_members(pack: str, names: list[str]) -> list[str]:
    if pack == 'base':
        return sorted(n for n in names if '/Base Characters/Godot - UE/Superhero_' in n and n.endswith('.gltf'))
    if pack == 'outfits':
        return sorted(n for n in names if '/Exports/glTF (Godot-Unreal)/Outfits/' in n and n.endswith('.gltf'))
    prefix = 'UAL1_Standard' if pack == 'animations-1' else 'UAL2_Standard'
    return sorted(n for n in names if '/Unreal-Godot/' in n and PurePosixPath(n).name in (prefix + '.glb', prefix + '_RM.glb'))


def materialize(z: zipfile.ZipFile, name: str, out: Path, generated: set[str]) -> bytes:
    if not safe_name(name):
        raise ValueError(f'unsafe archive member: {name}')
    info = z.getinfo(name)
    if info.file_size > MAX_FILE_SIZE:
        raise ValueError(f'oversized archive member: {name}')
    data = z.read(name)
    if len(data) != info.file_size:
        raise ValueError(f'incomplete archive member: {name}')
    target = out / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or digest(target.read_bytes()) != digest(data):
        target.write_bytes(data)
    generated.add(name)
    return data


def import_pack(kind: str, archive: Path, out: Path) -> tuple[dict, list[dict]]:
    if not archive.is_file():
        raise FileNotFoundError(f'{archive} missing; fetch Git LFS assets first (git lfs pull)')
    with archive.open('rb') as f:
        if f.read(40).startswith(b'version https://git-lfs.github.com'):
            raise ValueError(f'{archive} is an LFS pointer; run git lfs pull')
    with zipfile.ZipFile(archive) as z:
        entries = [x for x in z.infolist() if not x.is_dir()]
        if any(not safe_name(x.filename) or x.file_size > MAX_FILE_SIZE for x in entries):
            raise ValueError(f'unsafe ZIP entries in {archive}')
        if sum(x.file_size for x in entries) > MAX_TOTAL_SIZE:
            raise ValueError(f'archive uncompressed size exceeds limit: {archive}')
        names = [x.filename for x in entries]
        licenses = [n for n in names if PurePosixPath(n).name.lower().startswith('license') and n.lower().endswith('.txt')]
        if not licenses or not any(b'CC0 1.0' in z.read(n) for n in licenses):
            raise ValueError(f'CC0 license evidence missing: {archive}')
        choices = select_members(kind, names)
        required_count = 2 if kind != 'outfits' else 4
        if len(choices) != required_count:
            raise ValueError(f'{kind}: expected {required_count} compatible glTF files, found {len(choices)}')
        generated: set[str] = set()
        records = []
        for name in choices:
            raw = materialize(z, name, out, generated)
            rel = PurePosixPath(name)
            repairs = []
            dependency_hashes = {}
            if name.endswith('.glb'):
                document = read_glb_json(raw)
            else:
                document = json.loads(raw)
                dependencies = document.get('buffers', []) + document.get('images', [])
                for dependency in dependencies:
                    uri = dependency.get('uri')
                    if not uri:
                        continue
                    uri_path = PurePosixPath(uri)
                    if not safe_name(uri) or uri_path.parts[0].startswith('data:'):
                        raise ValueError(f'unsupported external URI in {name}: {uri}')
                    full = str(rel.parent / uri_path)
                    if full not in names:
                        repaired = FIXED_URIS.get(uri, '')
                        alternate = str(rel.parent / repaired)
                        if not repaired or alternate not in names:
                            raise ValueError(f'missing referenced asset: {name} -> {uri}')
                        dependency['uri'] = repaired
                        repairs.append({'from': uri, 'to': repaired})
                        full = alternate
                    data = materialize(z, full, out, generated)
                    dependency_hashes[dependency['uri']] = digest(data)
                if repairs:
                    (out / name).write_text(json.dumps(document, separators=(',', ':')), encoding='utf-8')
            bones = skeleton(document)
            clips = [anim.get('name', '') for anim in document.get('animations', [])]
            if len(set(clips)) != len(clips):
                raise ValueError(f'duplicate animation names: {name}')
            record = {
                'id': 'quaternius.' + (kind + '.' + rel.stem).lower().replace('_', '-'),
                'kind': 'animation-library' if name.endswith('.glb') else ('character' if kind == 'base' else 'outfit'),
                'path': name,
                'sha256': file_digest(out / name),
                'dependency_sha256': dependency_hashes,
                'skeleton_bone_names': bones,
                'skeleton_sha256': digest('\x00'.join(bones).encode()),
                'animation_clips': clips,
                'root_motion': rel.stem.endswith('_RM'),
                'repairs': repairs,
                'acceptance': 'pending',
            }
            records.append(record)
        pack_meta = {'id': kind, 'archive': str(archive), 'archive_sha256': file_digest(archive),
                     'license': 'CC0-1.0', 'license_file': licenses[0], 'extracted_files': len(generated)}
        return pack_meta, records


def run(source_root: Path, output_root: Path) -> dict:
    packs = []
    assets = []
    for kind, (subdir, filename) in PACKS.items():
        meta, items = import_pack(kind, source_root / subdir / filename, output_root / 'raw')
        packs.append(meta)
        assets.extend(items)
    rig_hashes = {a['skeleton_sha256'] for a in assets}
    if len(rig_hashes) != 1:
        raise ValueError(f'skeleton mismatch: {len(rig_hashes)} different bone layouts; must retarget')
    inventory = {'schema': 'gauntlet.foundation.inventory', 'schema_version': '1.0',
                 'license': 'CC0-1.0', 'packs': packs, 'assets': assets,
                 'compatibility': {'bone_names_match': True, 'skeleton_sha256': next(iter(rig_hashes))},
                 'publication_state': 'unaccepted-source-derivatives'}
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / 'inventory.json').write_text(json.dumps(inventory, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    return inventory


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, default=Path('assets/sources/quaternius'))
    parser.add_argument('--output', type=Path, default=Path('.tmp/foundations/quaternius'))
    args = parser.parse_args()
    result = run(args.sources, args.output)
    print(json.dumps({'status': 'success', 'assets': len(result['assets']),
                      'unique_clips': len(set(c for a in result['assets'] for c in a['animation_clips'])),
                      'output': str(args.output / 'inventory.json'),
                      'acceptance': 'pending'}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f'foundation import blocked: {error}', file=sys.stderr)
        sys.exit(1)
