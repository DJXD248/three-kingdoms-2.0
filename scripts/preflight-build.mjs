// v2.3.3（决议 D-7）：build 不再内嵌 npm install——依赖缺失时显式指路，绝不静默安装。
// CI 各 job 本就各自跑显式 install 步骤，不经此脚本。
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = relative => resolve(projectRoot, relative);
const flags = (process.env.NPM_FLAGS ?? '').trim();
const installCmd = `npm install --include=optional${flags ? ` ${flags}` : ''}`;

function refuse(reason) {
  console.error(
    `[preflight-build] ${reason}。请先在仓库根目录安装依赖：\n` +
    `  cd ${projectRoot} && ${installCmd}`);
  process.exit(1);
}

if (!existsSync(at('node_modules'))) refuse('node_modules 不存在');

let entries;
try {
  entries = readdirSync(at('node_modules'));
} catch (error) {
  refuse(`node_modules 无法读取（${error.message}）`);
}
if (!entries.some(name => !name.startsWith('.'))) refuse('node_modules 为空');

if (!existsSync(at('node_modules/vite'))) refuse('未安装 vite（依赖不完整，请重新安装）');
