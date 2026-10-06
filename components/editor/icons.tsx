type IconProps = { className?: string };

export function IconUndo({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8H4v4" />
      <path d="M4.5 11a8 8 0 1 0 2-5.5L4 8" />
    </svg>
  );
}

export function IconRedo({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 8h4v4" />
      <path d="M19.5 11a8 8 0 1 1-2-5.5L20 8" />
    </svg>
  );
}
