import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Login } from "@/pages/Login";
import { WhileYouWereGone } from "@/pages/WhileYouWereGone";
import { JobHistory } from "@/pages/JobHistory";
import { Filters } from "@/pages/Filters";
import { Targeting } from "@/pages/Targeting";
import { Account } from "@/pages/Account";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<WhileYouWereGone />} />
          <Route path="/history" element={<JobHistory />} />
          <Route path="/filters" element={<Filters />} />
          <Route path="/targeting" element={<Targeting />} />
          <Route path="/account" element={<Account />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
