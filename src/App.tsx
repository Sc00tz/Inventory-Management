import {
  createRouter,
  createRoute,
  createRootRoute,
  RouterProvider,
  Outlet,
  Link,
} from '@tanstack/react-router'
import { AppShell, AppShellSidebar, AppShellMain, MobileSidebarTrigger, SidebarItem } from '@blinkdotnew/ui'
import { Archive, Package, ScanBarcode } from 'lucide-react'
import { HomePage } from './pages/HomePage'
import { LocationPage } from './pages/LocationPage'
import { ProductsPage } from './pages/ProductsPage'

// ── Root layout ───────────────────────────────────────────────────────────────

function RootLayout() {
  return (
    <AppShell>
      <AppShellSidebar className="shrink-0">
        <div className="flex flex-col h-full w-[15rem] bg-sidebar border-r border-sidebar-border overflow-hidden">
          {/* Logo */}
          <div className="shrink-0 border-b border-sidebar-border px-4 py-4">
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
                <ScanBarcode size={15} className="text-primary" />
              </div>
              <span className="font-semibold text-sm text-sidebar-foreground tracking-tight">ScanBin</span>
            </Link>
          </div>

          {/* Nav */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-0.5">
            <SidebarItem
              icon={<Archive size={16} />}
              label="Locations"
              href="/"
            />
            <SidebarItem
              icon={<Package size={16} />}
              label="Products"
              href="/products"
            />
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-sidebar-border px-3 py-3">
            <p className="text-xs text-muted-foreground/50 text-center">ScanBin Inventory</p>
          </div>
        </div>
      </AppShellSidebar>

      <AppShellMain className="flex flex-col min-h-0 overflow-y-auto">
        {/* Mobile header */}
        <div className="md:hidden flex items-center gap-3 px-4 h-13 border-b border-border shrink-0">
          <MobileSidebarTrigger />
          <div className="flex items-center gap-2">
            <ScanBarcode size={16} className="text-primary" />
            <span className="font-semibold text-sm text-foreground">ScanBin</span>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </div>
      </AppShellMain>
    </AppShell>
  )
}

// ── Routes ────────────────────────────────────────────────────────────────────

const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const locationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/locations/$id',
  component: LocationPage,
})

const productsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/products',
  component: ProductsPage,
})

const routeTree = rootRoute.addChildren([indexRoute, locationRoute, productsRoute])

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return <RouterProvider router={router} />
}
