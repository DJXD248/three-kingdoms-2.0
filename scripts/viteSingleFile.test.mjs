// v2.8.28 打包工具替换刀：`scripts/viteSingleFile.ts` 的守卫测试。
//
// 这枚插件是从 `vite-plugin-singlefile@2.3.0` 逐字移植来的，它决定的是**玩家拿到的
// 那个单文件 HTML 长什么样**。所以这里钉的不是"代码风格"，而是四条一旦破了成品就
// 会坏或会多文件的规则：内联命中（含带路径前缀的 src/href）、成品自截断的转义、
// CSS 的 @charset 剥离、以及"内联过的 js/css 必须从产物里删掉"。
// 总账级硬证另有其处＝同一版本下换工具前后 dist/index.html 逐字节相同（见 HANDOFF §9）。

import { describe, expect, it } from 'vitest';
import { replaceCss, replaceScript, viteSingleFileLocal } from './viteSingleFile.ts';

describe('单文件内联插件 · HTML 改写', () => {
  it('脚本标签内联：保留原属性、去掉 src，代码首尾空白被收掉', () => {
    const html = '<html><head><script type="module" crossorigin src="/assets/index-abc.js"></script></head><body></body></html>';
    const out = replaceScript(html, 'index-abc.js', '\nconsole.log(1)\n');
    expect(out).toBe('<html><head><script type="module" crossorigin>console.log(1)</script></head><body></body></html>');
    expect(out).not.toContain('src=');
  });

  it('样式标签内联：link 变 style，并剥掉 @charset 声明', () => {
    const html = '<link rel="stylesheet" crossorigin href="/assets/style-xyz.css">';
    const out = replaceCss(html, 'style-xyz.css', '@charset "UTF-8";\nbody{color:red}');
    expect(out).toBe('<style rel="stylesheet" crossorigin>body{color:red}</style>');
  });

  it('成品自截断防护：内联代码里的 </script> 与 <!-- 转义成 \\x3C 形态', () => {
    const html = '<script src="a.js"></script>';
    const out = replaceScript(html, 'a.js', 'const a = "</script>"; const b = "<!--x";');
    expect(out).not.toContain('</script>";');
    expect(out).toContain('\\x3C/script>');
    expect(out).toContain('\\x3C!--');
  });

  it('预加载标记替换成 void 0（单文件里没有可按需加载的兄弟 chunk）', () => {
    const out = replaceScript('<script src="a.js"></script>', 'a.js', 'import("./x.js").then(__VITE_PRELOAD__)');
    expect(out).toContain('void 0');
    expect(out).not.toContain('__VITE_PRELOAD__');
  });
});

describe('单文件内联插件 · 构建配置与产物清理', () => {
  it('推荐构建配置五项全设：资源无上限内联、CSS 不打散、相对 base、产物落根、动态导入内联', () => {
    const config = {};
    viteSingleFileLocal().config(config);
    expect(config.build.assetsInlineLimit()).toBe(true);
    expect(config.build.chunkSizeWarningLimit).toBe(100000000);
    expect(config.build.cssCodeSplit).toBe(false);
    expect(config.base).toBe('./');
    expect(config.build.assetsDir).toBe('');
    expect(config.build.rollupOptions.output.inlineDynamicImports).toBe(true);
  });

  it('多输出形态（output 为数组）也逐个设上 inlineDynamicImports', () => {
    const config = { build: { rollupOptions: { output: [{}, {}] } } };
    viteSingleFileLocal().config(config);
    expect(config.build.rollupOptions.output.map(o => o.inlineDynamicImports)).toEqual([true, true]);
  });

  it('js/css 内联后从产物里删掉，只剩一个 HTML；非 js/css 的产物保留并告警', () => {
    const plugin = viteSingleFileLocal();
    const bundle = {
      'index.html': { fileName: 'index.html', source: '<script src="index.js"></script><link href="style.css">' },
      'index.js': { fileName: 'index.js', code: 'void 0' },
      'style.css': { fileName: 'style.css', source: 'a{}' },
      'logo.svg': { fileName: 'logo.svg', source: '<svg/>' },
    };
    const warnings = [];
    plugin.generateBundle.call({ warn: message => warnings.push(message) }, {}, bundle);

    expect(Object.keys(bundle)).toEqual(['index.html', 'logo.svg']);
    expect(bundle['index.html'].source).toBe('<script>void 0</script><style>a{}</style>');
    expect(warnings).toEqual(['NOTE: asset not inlined: logo.svg']);
  });
});
