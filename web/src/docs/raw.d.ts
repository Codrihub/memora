// Vite `?raw` imports: the file's text as a string, bundled at build time.
declare module '*.md?raw' {
  const text: string;
  export default text;
}
