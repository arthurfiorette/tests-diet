import { readFileSync } from 'node:fs';

// Resolves from both src/templates and dist/templates; assets ship with the package.
const read = (name: string) =>
  readFileSync(new URL(`../../assets/${name}`, import.meta.url), 'utf8');

export const styles = read('styles.css');
export const clientScript = read('client.js');
export const themeScript = read('theme.js');
