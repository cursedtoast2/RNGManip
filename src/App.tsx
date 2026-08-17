import { Menu } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import FrlgTool from "./pages/FrlgTool";
import Landing from "./pages/Landing";
import Rse from "./pages/Rse";
import { routeHref, useRoute } from "./routing";
import { CUE_STYLES, type CueStyle } from "./engine/timer";

const SIDEBAR_STORAGE_KEY = "rngmanip-sidebar-collapsed-v1";
const CUE_STYLE_STORAGE_KEY = "rngmanip-cue-style-v1";
const FRLG_STORAGE_KEY = "rngmanip-hunt-v3";
const RSE_STORAGE_KEY = "rngmanip-rse-hunt-v1";
const PHONE_QUERY = "(max-width: 760px)";

function validCueStyle(value: unknown): value is CueStyle {
  return typeof value === "string" && (CUE_STYLES as readonly string[]).includes(value);
}

function loadCueStyle(route: string): CueStyle {
  try {
    const globalValue = window.localStorage.getItem(CUE_STYLE_STORAGE_KEY);
    if (validCueStyle(globalValue)) return globalValue;
    const legacyKeys = route === "/rse" ? [RSE_STORAGE_KEY, FRLG_STORAGE_KEY] : [FRLG_STORAGE_KEY, RSE_STORAGE_KEY];
    for (const key of legacyKeys) {
      const value = window.localStorage.getItem(key);
      if (!value) continue;
      const legacyValue = (JSON.parse(value) as { cueStyle?: unknown }).cueStyle;
      if (validCueStyle(legacyValue)) return legacyValue;
    }
  } catch {
  }
  return "standard";
}

function phoneMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(PHONE_QUERY);
}

function isPhoneWidth(): boolean {
  const query = phoneMediaQuery();
  return query !== null && query.matches;
}

function loadDesktopCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function App() {
  const route = useRoute();
  const [phone, setPhone] = useState(isPhoneWidth);
  const [desktopCollapsed, setDesktopCollapsed] = useState(loadDesktopCollapsed);
  const [phoneDrawerOpen, setPhoneDrawerOpen] = useState(false);
  const [cueStyle, setCueStyle] = useState<CueStyle>(() => loadCueStyle(route));
  const collapsed = phone ? !phoneDrawerOpen : desktopCollapsed;

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CUE_STYLE_STORAGE_KEY, cueStyle);
    } catch {
    }
  }, [cueStyle]);

  useEffect(() => {
    const query = phoneMediaQuery();
    if (query === null) return;
    const apply = (matches: boolean) => {
      setPhone(matches);
      if (matches) setPhoneDrawerOpen(false);
    };
    apply(query.matches);
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const setCollapsedPersisted = useCallback((next: boolean) => {
    if (phone) {
      setPhoneDrawerOpen(!next);
      return;
    }
    setDesktopCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
    }
  }, [phone]);

  const closeDrawer = useCallback(() => {
    setPhoneDrawerOpen(false);
    if (!phone) setDesktopCollapsed(true);
  }, [phone]);

  const openDrawer = useCallback(() => {
    setPhoneDrawerOpen(true);
    if (!phone) setDesktopCollapsed(false);
  }, [phone]);

  const handleNavigate = useCallback(() => {
    setPhoneDrawerOpen(false);
  }, []);

  useEffect(() => {
    if (!phone || !phoneDrawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPhoneDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phone, phoneDrawerOpen]);

  return (
    <div className={`site-shell ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}>
      <Sidebar route={route} collapsed={collapsed} onToggle={() => setCollapsedPersisted(!collapsed)} onNavigate={handleNavigate} />
      <button type="button" className="site-scrim" aria-label="Close navigation" tabIndex={collapsed ? -1 : 0} onClick={closeDrawer} />
      <div className="site-content">
        <header className="site-topbar">
          <button type="button" className="site-topbar-toggle" aria-label="Open navigation" aria-expanded={!collapsed} onClick={openDrawer}>
            <Menu aria-hidden="true" />
          </button>
          <a className="site-brand" href={routeHref("/")}>RNG<span>Manip</span></a>
        </header>
        <main className="site-main">
          {route === "/frlg" ? <FrlgTool cueStyle={cueStyle} onCueStyleChange={setCueStyle} /> : route === "/rse" ? <Rse cueStyle={cueStyle} onCueStyleChange={setCueStyle} /> : <Landing />}
        </main>
      </div>
    </div>
  );
}

export default App;
