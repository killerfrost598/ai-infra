"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart2,
  BookOpen,
  BookOpenText,
  Brain,
  FlaskConical,
  LayoutDashboard,
  Layers,
  MessageSquare,
  Monitor,
  Moon,
  ScanSearch,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  Zap,
} from "lucide-react"
import { useTheme } from "next-themes"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"

const NAV_ITEMS = [
  { href: "/",                       label: "Overview",    icon: LayoutDashboard },
  { href: "/servers",                label: "Servers",     icon: Server },
  { href: "/chat",                   label: "Chat",        icon: MessageSquare },
  { href: "/deployments",            label: "Deployments", icon: Layers },
  { href: "/playbooks",              label: "Playbooks",   icon: BookOpen },
  { href: "/clore",                  label: "Clore",       icon: Monitor },
  { href: "/find",                   label: "GPU Finder",  icon: ScanSearch },
  { href: "/models",                 label: "Models",      icon: Brain },
  { href: "/benchmarks",             label: "Benchmarks",  icon: BarChart2 },
  { href: "/lab",                    label: "Lab",         icon: FlaskConical },
  { href: "/compat/candidates",      label: "Compat",      icon: ShieldCheck },
  { href: "/docs",                   label: "Guides",      icon: BookOpenText },
  { href: "/settings",               label: "Settings",    icon: Settings },
]

function NavItems() {
  const pathname = usePathname()
  const { isMobile, setOpen } = useSidebar()

  function isActive(href: string) {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  return (
    <SidebarMenu>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href)
        return (
          <SidebarMenuItem key={href}>
            <SidebarMenuButton asChild isActive={active} tooltip={label}>
              <Link
                href={href}
                onClick={() => {
                  if (isMobile) setOpen(false)
                }}
              >
                <Icon />
                <span>{label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

export function AppSidebar() {
  const { state } = useSidebar()
  const isExpanded = state === "expanded"
  const { theme, setTheme } = useTheme()

  return (
    <Sidebar collapsible="icon">
      {/* Logo */}
      <SidebarHeader>
        <div className="flex h-10 items-center gap-3 px-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600">
            <Zap className="size-3.5 text-white" strokeWidth={2.5} />
          </div>
          {isExpanded && (
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold text-sidebar-foreground">Inferix</span>
              <span className="text-[10px] text-sidebar-foreground/50">Built on Clore.ai</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      {/* Nav */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarSeparator />
      <SidebarFooter>
        {isExpanded ? (
          <div className="flex items-center justify-between px-2">
            <p className="text-[10px] text-sidebar-foreground/40">
              v0.2.0 · Clore.ai + vLLM
            </p>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-md p-1 hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="rounded-md p-1 hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
          </div>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
