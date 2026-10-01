# -*- mode: python ; coding: utf-8 -*-
# Build with `uv run pyinstaller --clean --noconfirm learn-nodes-backend.spec`.
# Passing `sidecar.py` instead regenerates this file and drops `datas` below.


a = Analysis(
    ['sidecar.py'],
    pathex=[],
    binaries=[],
    # Alembic reads its config and revision scripts from disk at startup
    # (`core/migrations.py` resolves them beside the package root, which in a
    # one-file bundle is the extraction directory). Without them every launch
    # fails to migrate and the sidecar answers 503 on `/ready`.
    datas=[('alembic.ini', '.'), ('migrations', 'migrations')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='learn-nodes-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
