import type { ReportFile } from '../report.js';

const CDN = 'https://cdn.jsdelivr.net/npm/material-icon-theme@5.40.0/icons/';
const languages = new Set([
  'javascript',
  'typescript',
  'python',
  'rust',
  'go',
  'java',
  'kotlin',
  'csharp',
  'ruby',
  'php',
  'swift',
  'elixir',
  'dart',
  'scala',
  'cpp',
  'lua'
]);
const folders: Record<string, string> = {
  src: 'src',
  source: 'src',
  test: 'test',
  tests: 'test',
  __tests__: 'test',
  e2e: 'test',
  components: 'components',
  packages: 'packages',
  lib: 'lib',
  libs: 'lib',
  config: 'config',
  docs: 'docs'
};

function IconImage({ name, className = '' }: { name: string; className?: string }) {
  return (
    <img
      class={`material-icon ${className}`}
      src={`${CDN}${name}.svg`}
      width="18"
      height="18"
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

export function FileIcon({ file }: { file: ReportFile }) {
  const extension = file.path.split('.').at(-1);
  const testFile = /(?:^|[./_-])(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path);
  const testIcon =
    extension === 'jsx' || extension === 'tsx'
      ? 'test-jsx'
      : /[cm]?ts/.test(extension ?? '')
        ? 'test-ts'
        : 'test-js';
  const name = testFile
    ? testIcon
    : extension === 'tsx'
      ? 'react_ts'
      : extension === 'jsx'
        ? 'react'
        : ['ts', 'mts', 'cts'].includes(extension ?? '')
          ? 'typescript'
          : languages.has(file.language)
            ? file.language
            : 'document';
  return (
    <span class="file-icon" aria-hidden="true">
      <IconImage name={name} />
    </span>
  );
}

export function FolderIcon({ name }: { name: string }) {
  const kind = folders[name];
  const icon = kind ? `folder-${kind}` : 'folder';
  return (
    <span class="folder-icon" aria-hidden="true">
      <IconImage name={icon} className="folder-closed" />
      <IconImage name={`${icon}-open`} className="folder-open" />
    </span>
  );
}
