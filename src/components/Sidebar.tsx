import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { routeHref, type Route } from "../routing";
import SidebarFooter from "./SidebarFooter";

type NavEntry = { route: Route; label: string; short: string };

const NAV: readonly NavEntry[] = [
  { route: "/", label: "Home", short: "HM" },
  { route: "/frlg", label: "FireRed / LeafGreen", short: "FR" },
  { route: "/rse", label: "Ruby / Sapphire / Emerald", short: "RSE" },
];

export default function Sidebar({ route, collapsed, onToggle, onNavigate }: {
  route: Route;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  return (
    <aside className={`site-sidebar ${collapsed ? "collapsed" : "expanded"}`} aria-label="Site sections">
      <div className="site-sidebar-head">
        <a className="site-brand" href={routeHref("/")} onClick={onNavigate}>RNG<span>Manip</span></a>
        <button
          type="button"
          className="site-sidebar-toggle"
          aria-expanded={!collapsed}
          aria-controls="site-sidebar-nav"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={onToggle}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>
      <nav id="site-sidebar-nav" className="site-nav">
        {NAV.map(({ route: target, label, short }) => (
          <a
            key={target}
            className={`site-nav-link ${route === target ? "current" : ""}`}
            href={routeHref(target)}
            aria-current={route === target ? "page" : undefined}
            title={label}
            onClick={onNavigate}
          >
            <span className="site-nav-short" aria-hidden="true">{short}</span>
            <span className="site-nav-label">{label}</span>
          </a>
        ))}
      </nav>
      <SidebarFooter />
    </aside>
  );
}
