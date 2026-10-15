import React, { Suspense, lazy } from "react";
import { Routes, Route } from "react-router";
import { MotionConfig } from "motion/react";
import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";
import { About } from "./components/About";
import { Services } from "./components/Services";
import { Booking } from "./components/Booking";
import { ChatLauncher, ChatPage } from "./components/chat";
import { Footer } from "./components/Footer";
import { Toaster } from "./components/ui/sonner";

// T1/S2a — Performance bundle: every admin route is code-split with
// React.lazy, so the landing visitor no longer downloads the CRM. This is
// what keeps recharts (PurchasesChart.tsx / TrendCharts.tsx, reached only
// through the Dashboard) out of the landing chunk — see the `vite build`
// chunk list. The public routes (landing, /chat) stay eager: they are the
// first paint.
const AdminLayout = lazy(() =>
  import("./admin/AdminLayout").then((m) => ({ default: m.AdminLayout })),
);
const Dashboard = lazy(() =>
  import("./admin/dashboard").then((m) => ({ default: m.Dashboard })),
);
const CatalogPage = lazy(() =>
  import("./admin/CatalogPage").then((m) => ({ default: m.CatalogPage })),
);
const CustomersPage = lazy(() =>
  import("./admin/CustomersPage").then((m) => ({ default: m.CustomersPage })),
);
const CustomerDetailPage = lazy(() =>
  import("./admin/CustomerDetailPage").then((m) => ({ default: m.CustomerDetailPage })),
);
const PurchasesPage = lazy(() =>
  import("./admin/PurchasesPage").then((m) => ({ default: m.PurchasesPage })),
);
const ConversationsPage = lazy(() =>
  import("./admin/ConversationsPage").then((m) => ({ default: m.ConversationsPage })),
);
const ConversationDetailPage = lazy(() =>
  import("./admin/ConversationDetailPage").then((m) => ({ default: m.ConversationDetailPage })),
);
const GuidancePage = lazy(() =>
  import("./admin/GuidancePage").then((m) => ({ default: m.GuidancePage })),
);
const RecommendationsPage = lazy(() =>
  import("./admin/RecommendationsPage").then((m) => ({ default: m.RecommendationsPage })),
);
const ReferrersPage = lazy(() =>
  import("./admin/ReferrersPage").then((m) => ({ default: m.ReferrersPage })),
);
const AssessmentAdminPage = lazy(() =>
  import("./admin/AssessmentAdminPage").then((m) => ({ default: m.AssessmentAdminPage })),
);
const VideosPage = lazy(() =>
  import("./admin/VideosPage").then((m) => ({ default: m.VideosPage })),
);
const LoginScreen = lazy(() =>
  import("./admin/LoginScreen").then((m) => ({ default: m.LoginScreen })),
);
const AuthCallback = lazy(() =>
  import("./admin/AuthCallback").then((m) => ({ default: m.AuthCallback })),
);

// Existing loading pattern of the admin pages (`<p>Cargando…</p>`), reused as
// the Suspense fallback while an admin chunk streams in.
function ChunkFallback() {
  return <p className="text-stone-500">Cargando…</p>;
}

function Landing() {
  return (
    <div className="font-sans text-stone-900 bg-stone-50 min-h-screen selection:bg-emerald-600 selection:text-white scroll-smooth">
      <Navbar />
      <main>
        <Hero />
        <About />
        <Services />
        <Booking />
      </main>
      <Footer />
      {/* T3 — single entry point: the launcher navigates to the /chat route,
          where the 95-symptom check opens from the `[ASSESSMENT]` card. The
          landing no longer hosts the assessment widget directly. */}
      <ChatLauncher />
    </div>
  );
}

export default function App() {
  return (
    // T2/S5b — framer variants respect the OS reduced-motion setting.
    <MotionConfig reducedMotion="user">
      <Suspense fallback={<ChunkFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/admin/login" element={<LoginScreen />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="catalog" element={<CatalogPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:id" element={<CustomerDetailPage />} />
            <Route path="purchases" element={<PurchasesPage />} />
            <Route path="conversations" element={<ConversationsPage />} />
            <Route path="conversations/:id" element={<ConversationDetailPage />} />
            <Route path="guidance" element={<GuidancePage />} />
            <Route path="recommendations" element={<RecommendationsPage />} />
            <Route path="referrers" element={<ReferrersPage />} />
            <Route path="assessment" element={<AssessmentAdminPage />} />
            <Route path="videos" element={<VideosPage />} />
          </Route>
        </Routes>
      </Suspense>
      {/* T2/S7a — sonner host: every admin delete toast lands here. */}
      <Toaster />
    </MotionConfig>
  );
}
