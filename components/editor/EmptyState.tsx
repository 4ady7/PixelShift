const EXAMPLES = [
  { label: "Remove something", prompt: "Remove " },
  { label: "Change an object", prompt: "Replace the " },
  { label: "Change clothing", prompt: "Change the clothing to " },
  { label: "Change the background", prompt: "Change the background to " },
  { label: "Change lighting", prompt: "Change the lighting so " },
];

type EmptyStateProps = {
  onUpload: () => void;
  onExample: (prompt: string) => void;
  error: string | null;
};

export function EmptyState({ onUpload, onExample, error }: EmptyStateProps) {
  return (
    <section className="empty">
      <p className="brand">PixelShift</p>
      <div className="empty-copy">
        <h1>Change anything in a photograph.</h1>
        <p>Upload a photo, select what you want to change, and describe the result.</p>
        <button className="primary" type="button" onClick={onUpload}>
          Upload photo
        </button>
        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="examples">
          {EXAMPLES.map((example) => (
            <li key={example.label}>
              <button type="button" onClick={() => onExample(example.prompt)}>
                {example.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
