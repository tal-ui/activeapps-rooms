import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import { LangContext } from "./lib/i18n";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import RoomShell from "./components/RoomShell";
import RoomHome from "./pages/RoomHome";
import DocumentPage from "./pages/DocumentPage";
import QuestionsPage from "./pages/QuestionsPage";
import FilesPage from "./pages/FilesPage";
import ActivityPage from "./pages/ActivityPage";
import RoomSettingsPage from "./pages/admin/RoomSettingsPage";
import RoomsIndexPage from "./pages/admin/RoomsIndexPage";
import EngagementPanelPage from "./pages/admin/EngagementPanelPage";
import { FullScreenSpinner, NotFound } from "./components/ui";

function Protected() {
  const { session, ready } = useAuth();
  if (!ready) return <FullScreenSpinner />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** "/" — staff go to the rooms index; clients go straight to their room. */
function Landing() {
  const { isInternal, rooms, roomsLoading } = useAuth();
  if (roomsLoading) return <FullScreenSpinner />;
  if (isInternal) return <Navigate to="/admin/rooms" replace />;
  if (rooms.length === 1) return <Navigate to={`/r/${rooms[0].slug}`} replace />;
  return <RoomsIndexPage />;
}

function InternalOnly() {
  const { isInternal, roomsLoading } = useAuth();
  if (roomsLoading) return <FullScreenSpinner />;
  if (!isInternal) return <Navigate to="/" replace />;
  return <Outlet />;
}

function RoomRoutes() {
  const { slug } = useParams();
  if (!slug) return <NotFound />;
  return <RoomShell slug={slug} />;
}

export default function App() {
  return (
    <LangContext.Provider value="en">
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route element={<Protected />}>
                <Route path="/" element={<Landing />} />
                <Route element={<InternalOnly />}>
                  <Route path="/admin/rooms" element={<RoomsIndexPage />} />
                </Route>
                <Route path="/r/:slug" element={<RoomRoutes />}>
                  <Route index element={<RoomHome />} />
                  <Route path="doc/:docId" element={<DocumentPage />} />
                  <Route path="questions" element={<QuestionsPage />} />
                  <Route path="files" element={<FilesPage />} />
                  <Route path="activity" element={<ActivityPage />} />
                  <Route path="settings" element={<RoomSettingsPage />} />
                  <Route path="engagement" element={<EngagementPanelPage />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </LangContext.Provider>
  );
}
