/** Crédito discreto, sem faixa, borda, posicionamento fixo ou sobreposição ao conteúdo. */
export function AppFooter() {
  return (
    <footer className="shrink-0 bg-transparent px-3 py-1.5 text-center text-[11px] leading-4 text-ink-3/80">
      © {new Date().getFullYear()}{" "}
      <a
        href="https://github.com/MrLonely0-0"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-ink-2 underline decoration-transparent underline-offset-2 transition hover:decoration-current"
      >
        Vinícius Emanuel
      </a>
    </footer>
  );
}
