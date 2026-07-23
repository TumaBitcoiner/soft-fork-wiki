import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { AskPage, BipDetailPage, ExplorePage, LabPage, MethodPage, SentimentPage, TimelinePage } from "./pages/BipPages";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/ask" element={<AskPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/bips/:bipNumber" element={<BipDetailPage />} />
        <Route path="/lab" element={<LabPage />} />
        <Route path="/sentiment" element={<SentimentPage />} />
        <Route path="/method" element={<MethodPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;