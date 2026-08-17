const CREDITS = [
  { label: "EonTimer", href: "https://github.com/DasAmpharos/EonTimer" },
  { label: "Ten Lines", href: "https://github.com/Lincoln-LM/ten-lines" },
  { label: "PokéFinder", href: "https://github.com/Admiral-Fish/PokeFinder" },
] as const;

export default function SidebarFooter() {
  return (
    <footer className="site-sidebar-footer">
      <p>
        Built with {CREDITS.map((credit, index) => <span key={credit.href}><a href={credit.href} target="_blank" rel="noreferrer noopener">{credit.label}</a>{index < CREDITS.length - 1 ? ", " : "."}</span>)}
      </p>
      <p>
        <a href="https://x.com/cursedtoastsda" target="_blank" rel="noreferrer noopener">CursedToast</a> ·{" "}
        <a href="https://github.com/cursedtoast2/RNGManip" target="_blank" rel="noreferrer noopener">Source</a> ·{" "}
        <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer noopener">GPL-3.0</a>
      </p>
    </footer>
  );
}
