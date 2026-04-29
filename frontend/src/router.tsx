import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet
} from "@tanstack/react-router";
import { LibraryPage } from "./routes/library";
import { UploadPage } from "./routes/upload";
import { ReaderPage } from "./routes/reader";
import { SettingsPage } from "./routes/settings";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col">
      <Outlet />
    </div>
  )
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LibraryPage
});

const uploadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "upload",
  component: UploadPage
});

const readerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "book/$bookId",
  component: ReaderPage
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "settings",
  component: SettingsPage
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  uploadRoute,
  readerRoute,
  settingsRoute
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
