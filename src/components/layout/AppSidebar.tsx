import { Bot, LayoutDashboard, LineChart, TrendingUp, Shield, History, Newspaper, Trophy, GraduationCap, BookOpen } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/use-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const mainNavItems = [
  { title: "AI Advisor", url: "/advisor", icon: Bot },
  { title: "Chat History", url: "/chat-history", icon: History },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Learning", url: "/learning", icon: GraduationCap },
  { title: "Academy", url: "/academy", icon: BookOpen },
  { title: "Paper Trading", url: "/paper-trading", icon: LineChart },
  { title: "Latest News", url: "/news", icon: Newspaper },
  { title: "Top Stocks", url: "/top-stocks", icon: Trophy },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { userProfile } = useAuth();
  const isCollapsed = state === "collapsed";
  const isAdmin = userProfile?.userType === 'Admin';

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className={`border-b border-sidebar-border ${isCollapsed ? 'px-0 py-4' : 'px-4 py-4'}`}>
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
          <div className={`flex items-center justify-center rounded-lg bg-sidebar-primary transition-all ${
            isCollapsed ? 'h-10 w-10 shadow-sm' : 'h-9 w-9'
          }`}>
            <TrendingUp className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">FinanceAI</span>
              <span className="text-xs text-sidebar-foreground/60">Advisor & Educator</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className={isCollapsed ? 'px-0 py-4' : 'px-2 py-4'}>
        <SidebarGroup className={isCollapsed ? 'px-0' : ''}>
          {!isCollapsed && (
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-2 mb-1">
              Navigation
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className={isCollapsed ? 'items-center gap-1' : ''}>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    tooltip={item.title}
                    size={isCollapsed ? "default" : "default"}
                  >
                    <NavLink
                      to={item.url}
                      end={item.url === "/advisor"}
                      className={`flex items-center rounded-lg text-sidebar-foreground transition-all ${
                        isCollapsed 
                          ? 'justify-center w-10 h-10 mx-auto' 
                          : 'gap-3'
                      } hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`}
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!isCollapsed && <span className="truncate">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {isAdmin && (
                <>
                  {isCollapsed && (
                    <div className="h-px w-8 mx-auto my-2 bg-sidebar-border" />
                  )}
                  <SidebarMenuItem>
                    <SidebarMenuButton 
                      asChild 
                      tooltip="Admin"
                      size={isCollapsed ? "default" : "default"}
                    >
                      <NavLink
                        to="/admin"
                        className={`flex items-center rounded-lg text-sidebar-foreground transition-all ${
                          isCollapsed 
                            ? 'justify-center w-10 h-10 mx-auto' 
                            : 'gap-3'
                        } hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`}
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <Shield className="h-5 w-5 shrink-0" />
                        {!isCollapsed && <span className="truncate">Admin</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
