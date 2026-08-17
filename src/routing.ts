import { useEffect, useState } from "react";

export const ROUTES = ["/", "/frlg", "/rse"] as const;
export type Route = (typeof ROUTES)[number];

function normalizeHash(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\?.*$/, "");
  const trimmed = path === "" || path === "/" ? "/" : path.replace(/\/+$/, "").toLowerCase();
  return (ROUTES as readonly string[]).includes(trimmed) ? (trimmed as Route) : "/";
}

export function currentRoute(): Route {
  if (typeof window === "undefined") return "/";
  return normalizeHash(window.location.hash);
}

export function routeHref(route: Route): string {
  return `#${route}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHashChange);
    onHashChange();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}
