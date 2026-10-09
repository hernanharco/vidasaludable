import React, { useState } from "react";
import { Routes, Route } from "react-router";
import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";
import { About } from "./components/About";
import { Services } from "./components/Services";
import { Booking } from "./components/Booking";
import { ChatWidget } from "./components/chat";
import { AssessmentWidget } from "./components/assessment";
import { Footer } from "./components/Footer";
import { AdminLayout } from "./admin/AdminLayout";
import { Dashboard } from "./admin/dashboard";
import { CatalogPage } from "./admin/CatalogPage";
import { CustomersPage } from "./admin/CustomersPage";
import { PurchasesPage } from "./admin/PurchasesPage";
import { ConversationsPage } from "./admin/ConversationsPage";
import { ConversationDetailPage } from "./admin/ConversationDetailPage";
import { GuidancePage } from "./admin/GuidancePage";
import { RecommendationsPage } from "./admin/RecommendationsPage";
import { ReferrersPage } from "./admin/ReferrersPage";
import { AssessmentAdminPage } from "./admin/AssessmentAdminPage";
import { VideosPage } from "./admin/VideosPage";
import { LoginScreen } from "./admin/LoginScreen";
import { AuthCallback } from "./admin/AuthCallback";

function Landing() {
  // T4 — single button UX: the chat owns the only floating entry point and
  // opens the prevention wizard through the `[ASSESSMENT]` card.
  const [assessmentOpen, setAssessmentOpen] = useState(false);
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
      {/* Z-stack: chat panel and assessment modal/backdrop are both z-50, but
          AssessmentWidget renders AFTER ChatWidget in this DOM order, so the
          modal paints above the open chat (equal z-index → later sibling wins).
          Closing the modal reveals the chat, still open (both stay mounted). */}
      <ChatWidget onOpenAssessment={() => setAssessmentOpen(true)} />
      <AssessmentWidget open={assessmentOpen} onClose={() => setAssessmentOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/admin/login" element={<LoginScreen />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="customers" element={<CustomersPage />} />
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
  );
}