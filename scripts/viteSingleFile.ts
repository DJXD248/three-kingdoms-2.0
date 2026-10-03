import type { Plugin } from 'vite';

// 自研单文件内联插件（v2.8.28 打包工具替换刀）。
//
// 逐字移植自 `vite-plugin-singlefile@2.3.0`（MIT License, Copyright (c) Richard
// Tallent）的 dist/esm/index.js：两个替换函数与推荐构建配置五项原样保留，只去掉
// 本项目从未使用的 `inlinePattern`／`removeViteModuleLoader`／`overrideConfig` 三个
// 开关——其中 `inlinePattern` 是它引入 `micromatch → braces` 那条链的唯一理由，而
// 空数组时那条分支本来就走不到（`if (inlinePattern.length && ...)` 先短路）。
//
// 摘掉它的理由（GHSA-vfj7-8cjw-p6xm，`braces` 深嵌套模式栈耗尽 DoS）：受影响范围
// `<= 3.0.3`＝braces 已发布的最高版，且公告 `first_patched_version = null`⇒升级这条
// 路不存在。硬证＝同一 package.json 版本下，换工具前后的 `dist/index.html` 逐字节相同。

const isJsFile = /\.[mc]?js$/;
const isCssFile = /\.css$/;
const isHtmlFile = /\.html?$/;

type ChunkLike = { fileName: string; code?: string };
type AssetLike = { fileName: string; source: string | Buffer };

/** 把 `<script … src="file.js"></script>` 换成同名内联脚本。 */
export function replaceScript(html: string, scriptFilename: string, scriptCode: string): string {
  // tsconfig 的 lib 是 ES2020，没有 `replaceAll` 的类型⇒用等价的 /\./g。
  const f = scriptFilename.replace(/\./g, '\\.');
  const reScript = new RegExp(`<script([^>]*?) src="(?:[^"]*?/)?${f}"([^>]*)></script>`);
  const preloadMarker = /"?__VITE_PRELOAD__"?/g;
  // `</script>`／`<!--` 若原样落进 HTML 会把成品自己截断⇒转义成 \x3C 形态。
  const newCode = scriptCode.replace(preloadMarker, 'void 0').replace(/<(\/script>|!--)/g, '\\x3C$1');
  return html.replace(reScript, (_, beforeSrc: string, afterSrc: string) =>
    `<script${beforeSrc}${afterSrc}>${newCode.trim()}</script>`);
}

/** 把 `<link … href="file.css">` 换成内联 `<style>`。 */
export function replaceCss(html: string, scriptFilename: string, scriptCode: string): string {
  const f = scriptFilename.replace(/\./g, '\\.');
  const reStyle = new RegExp(`<link([^>]*?) href="(?:[^"]*?/)?${f}"([^>]*)>`);
  const newCode = scriptCode.replace(`@charset "UTF-8";`, '');
  return html.replace(reStyle, (_, beforeSrc: string, afterSrc: string) =>
    `<style${beforeSrc}${afterSrc}>${newCode.trim()}</style>`);
}

/** 与上游 `useRecommendedBuildConfig` 等价的构建配置改写。 */
function applyRecommendedBuildConfig(config: Record<string, any>): void {
  if (!config.build) config.build = {};
  // 任何体积的静态资源都内联进 JS。
  config.build.assetsInlineLimit = () => true;
  config.build.chunkSizeWarningLimit = 100000000;
  // CSS 不打散成多文件，好让本插件有一份可以内联的整体。
  config.build.cssCodeSplit = false;
  // public 目录里的静态文件走相对路径。
  config.base = './';
  // 产物直接落在 outDir 根，内联资源才能用相对路径取到。
  config.build.assetsDir = '';
  if (!config.build.rollupOptions) config.build.rollupOptions = {};
  if (!config.build.rollupOptions.output) config.build.rollupOptions.output = {};
  const updateOutputOptions = (out: Record<string, any>) => {
    out.inlineDynamicImports = true;
  };
  const output = config.build.rollupOptions.output;
  if (Array.isArray(output)) {
    for (const out of output) updateOutputOptions(out);
  } else {
    updateOutputOptions(output);
  }
}

export function viteSingleFileLocal(): Plugin {
  return {
    name: 'local:singlefile',
    config(config) {
      applyRecommendedBuildConfig(config as Record<string, any>);
    },
    enforce: 'post',
    generateBundle(_unused, bundle) {
      const files = { html: [] as string[], css: [] as string[], js: [] as string[], other: [] as string[] };
      for (const key of Object.keys(bundle)) {
        if (isHtmlFile.test(key)) files.html.push(key);
        else if (isCssFile.test(key)) files.css.push(key);
        else if (isJsFile.test(key)) files.js.push(key);
        else files.other.push(key);
      }

      const bundlesToDelete: string[] = [];
      for (const name of files.html) {
        const htmlChunk = bundle[name] as AssetLike;
        let replacedHtml = String(htmlChunk.source);
        for (const filename of files.js) {
          const jsChunk = bundle[filename] as ChunkLike;
          if (jsChunk.code != null) {
            bundlesToDelete.push(filename);
            replacedHtml = replaceScript(replacedHtml, jsChunk.fileName, jsChunk.code);
          }
        }
        for (const filename of files.css) {
          const cssChunk = bundle[filename] as AssetLike;
          bundlesToDelete.push(filename);
          replacedHtml = replaceCss(replacedHtml, cssChunk.fileName, String(cssChunk.source));
        }
        htmlChunk.source = replacedHtml;
      }
      for (const name of bundlesToDelete) delete bundle[name];
      for (const name of files.other) this.warn(`NOTE: asset not inlined: ${name}`);
    },
  };
}
