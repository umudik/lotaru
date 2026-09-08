import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { IngestAlarmBanner, IngestAlarmProvider } from "@/components/IngestAlarmBanner";

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <IngestAlarmProvider>
      <div className="app-shell">
        <AppSidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        {mobileNavOpen ? (
          <div
            className="app-sidebar-backdrop"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3 md:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
          <IngestAlarmBanner />
          <main className="app-main flex min-h-0 flex-1 flex-col overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </IngestAlarmProvider>
  );
}
