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
      <SidebarInset style={{ "--app-layout-header-height": "3.5rem" } as React.CSSProperties}>
        <header
          className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 sm:gap-4 sm:px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60"
          style={{ height: "var(--app-layout-header-height)" }}
        >
          <SidebarTrigger className="h-8 w-8 shrink-0" />
          {title && <h1 className="text-base sm:text-lg font-semibold truncate">{title}</h1>}
          <div className="ml-auto shrink-0">
            <UserAuth />
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
