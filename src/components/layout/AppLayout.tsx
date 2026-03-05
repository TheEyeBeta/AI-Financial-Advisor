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
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 sm:gap-4 border-b bg-background/95 px-3 sm:px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="h-8 w-8 shrink-0" />
          {title && <h1 className="text-base sm:text-lg font-semibold truncate">{title}</h1>}
          <div className="ml-auto shrink-0">
            <UserAuth />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-6 sm:py-6">
          <div className="mx-auto w-full max-w-7xl">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
