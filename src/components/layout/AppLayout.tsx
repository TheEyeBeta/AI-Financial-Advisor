import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { UserAuth } from "@/components/auth/UserAuth";

interface AppLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function AppLayout({ children, title }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* h-svh bounds the inset to the viewport so pages with internal flex
          scrolling (e.g. the Advisor chat column) resolve h-full against a
          definite height; min-w-0 stops unbreakable content (long words/URLs)
          from inflating the inset past the viewport width. The div below is
          the app's single scroll container. */}
      <SidebarInset
        className="h-svh min-w-0"
        style={{ "--app-layout-header-height": "3.5rem" } as React.CSSProperties}
      >
        <header
          className="flex shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-4 sm:px-4"
          style={{ height: "var(--app-layout-header-height)" }}
        >
          <SidebarTrigger className="h-8 w-8 shrink-0" />
          {title && <h1 className="text-base sm:text-lg font-semibold truncate">{title}</h1>}
          <div className="ml-auto shrink-0">
            <UserAuth />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
