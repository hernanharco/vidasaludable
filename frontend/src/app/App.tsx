import React from "react";
import { Routes, Route } from "react-router";
import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";
import { About } from "./components/About";
import { Services } from "./components/Services";
import { Booking } from "./components/Booking";
import { ChatWidget } from "./components/ChatWidget";
import { Footer } from "./components/Footer";
import { AdminLayout } from "./admin/AdminLayout";
import { Dashboard } from "./admin/Dashboard";
import { CatalogPage } from "./admin/CatalogPage";
import { CustomersPage } from "./admin/CustomersPage";
import { PurchasesPage } from "./admin/PurchasesPage";
import { ConversationsPage } from "./admin/ConversationsPage";
import { ConversationDetailPage } from "./admin/ConversationDetailPage";
import { GuidancePage } from "./admin/GuidancePage";
import { RecommendationsPage } from "./admin/RecommendationsPage";

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
      <ChatWidget />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="purchases" element={<PurchasesPage />} />
        <Route path="conversations" element={<ConversationsPage />} />
        <Route path="conversations/:id" element={<ConversationDetailPage />} />
        <Route path="guidance" element={<GuidancePage />} />
        <Route path="recommendations" element={<RecommendationsPage />} />
      </Route>
    </Routes>
  );
}