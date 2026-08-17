import { Menu } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import FrlgTool from "./pages/FrlgTool";
import Landing from "./pages/Landing";
import Rse from "./pages/Rse";
import { routeHref, useRoute } from "./routing";

const SIDEBAR_STORAGE_KEY = "rngmanip-sidebar-collapsed-v1";
const PHONE_QUERY = "(max-width: 760px)";

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
  const collapsed = phone ? !phoneDrawerOpen : desktopCollapsed;

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

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
          {route === "/frlg" ? <FrlgTool /> : route === "/rse" ? <Rse /> : <Landing />}
        </main>
      </div>
    </div>
  );
}

export default App;
