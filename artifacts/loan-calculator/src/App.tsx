import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import ClientDetail from "@/pages/client-detail";
import FileDetail from "@/pages/file-detail";
import LoanDetail from "@/pages/loan-detail";
import SettingsPage from "@/pages/settings";
import TrashPage from "@/pages/trash";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/trash" component={TrashPage} />
      <Route path="/client/:id" component={ClientDetail} />
      <Route path="/client/:id/file/:fileId" component={FileDetail} />
      <Route path="/client/:id/file/:fileId/loan/:loanId" component={LoanDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Toaster />
          <Router />
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
