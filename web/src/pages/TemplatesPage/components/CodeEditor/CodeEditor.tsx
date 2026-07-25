import { lazy, Suspense, useEffect, useState } from 'react';
import styles from './CodeEditor.module.css';
import { crossOriginWorker } from './crossOriginWorker';

const MonacoEditor = lazy(async () => {
  const [{ default: Editor, loader }, monaco] = await Promise.all([
    import('@monaco-editor/react'),
    import('monaco-editor'),
  ]);

  const editorWorkerUrl = (
    await import('monaco-editor/editor/editor.worker?worker&url')
  ).default;
  const cssWorkerUrl = (
    await import('monaco-editor/language/css/css.worker?worker&url')
  ).default;
  const htmlWorkerUrl = (
    await import('monaco-editor/language/html/html.worker?worker&url')
  ).default;

  (globalThis as unknown as { MonacoEnvironment: object }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'css' || label === 'scss' || label === 'less') {
        return crossOriginWorker(cssWorkerUrl);
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return crossOriginWorker(htmlWorkerUrl);
      }
      return crossOriginWorker(editorWorkerUrl);
    },
  };

  loader.config({ monaco });
  await loader.init();
  return { default: Editor };
});

interface CodeEditorProps {
  language: 'html' | 'css';
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

interface FallbackProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

function PlainTextarea({
  value,
  onChange,
  ariaLabel,
}: Readonly<FallbackProps>) {
  return (
    <textarea
      className={styles.fallback}
      aria-label={ariaLabel}
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

const MONACO_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineNumbers: 'on' as const,
  folding: false,
  automaticLayout: true,
  wordWrap: 'on' as const,
  tabSize: 2,
};

export function CodeEditor({
  language,
  value,
  onChange,
  ariaLabel,
}: Readonly<CodeEditorProps>) {
  const [supportsMonaco, setSupportsMonaco] = useState(false);

  useEffect(() => {
    setSupportsMonaco(
      globalThis.window !== undefined && 'Worker' in globalThis
    );
  }, []);

  if (!supportsMonaco) {
    return (
      <PlainTextarea value={value} onChange={onChange} ariaLabel={ariaLabel} />
    );
  }

  return (
    <div className={styles.editorShell} aria-label={ariaLabel}>
      <Suspense
        fallback={
          <PlainTextarea
            value={value}
            onChange={onChange}
            ariaLabel={ariaLabel}
          />
        }
      >
        <MonacoEditor
          height="100%"
          language={language}
          value={value}
          onChange={(next) => onChange(next ?? '')}
          options={MONACO_OPTIONS}
          theme="vs-dark"
        />
      </Suspense>
    </div>
  );
}

export default CodeEditor;
