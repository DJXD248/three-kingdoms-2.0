import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repoRoot, 'scripts', 'preflight-build.mjs');

// 脚本以自身位置定位仓库根（cwd 无关），因此沙箱用例必须运行**沙箱内的副本**。
function run(sandbox) {
  return spawnSync(process.execPath, [join(sandbox, 'scripts', 'preflight-build.mjs')], {
    cwd: sandbox,
    encoding: 'utf8',
  });
}

function makeSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), 'preflight-'));
  mkdirSync(join(sandbox, 'scripts'), { recursive: true });
  cpSync(script, join(sandbox, 'scripts', 'preflight-build.mjs'));
  writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ name: 'sandbox' }));
  return sandbox;
}

describe('preflight-build guard (decision D-7, v2.3.3)', () => {
  let sandbox;
  let log;

  beforeEach(() => {
    sandbox = makeSandbox();
    log = [];
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
    for (const line of log) process.stdout.write(line);
  });

  const passthrough = (result) => {
    log.push(result.stdout ?? '', result.stderr ?? '');
    return result;
  };

  it('passes silently when vite is installed', () => {
    mkdirSync(join(sandbox, 'node_modules', 'vite'), { recursive: true });
    const result = passthrough(run(sandbox));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('rejects a missing node_modules with the install command', () => {
    const result = passthrough(run(sandbox));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('node_modules 不存在');
    expect(result.stderr).toContain('npm install --include=optional');
  });

  it('rejects an empty node_modules even with npm bookkeeping files', () => {
    mkdirSync(join(sandbox, 'node_modules'), { recursive: true });
    writeFileSync(join(sandbox, 'node_modules', '.package-lock.json'), '{}');
    const result = passthrough(run(sandbox));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('node_modules 为空');
  });

  it('flags an incomplete install when vite is absent', () => {
    mkdirSync(join(sandbox, 'node_modules', 'react'), { recursive: true });
    const result = passthrough(run(sandbox));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('未安装 vite');
  });

  it('recommends --ignore-scripts only when NPM_FLAGS asks for it', () => {
    const result = spawnSync(
      process.execPath,
      [join(sandbox, 'scripts', 'preflight-build.mjs')],
      {
        cwd: sandbox,
        encoding: 'utf8',
        env: { ...process.env, NPM_FLAGS: '--ignore-scripts' },
      },
    );
    log.push(result.stdout ?? '', result.stderr ?? '');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm install --include=optional --ignore-scripts');
  });
});
