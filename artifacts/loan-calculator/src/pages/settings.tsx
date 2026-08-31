import { useEffect, useState } from "react";
import {
  useGetAzureSettings,
  useUpdateAzureSettings,
  useGetRateResetStatus,
  getGetAzureSettingsQueryKey,
  getGetRateResetStatusQueryKey,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useLocation } from "wouter";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { CheckCircle2, XCircle, KeyRound, FileScan, Sparkles, Database, Lock, Activity, AlertTriangle, ShieldAlert } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useAuth } from "@/hooks/use-auth";

function KeyStatus({ set }: { set: boolean }) {
  return set ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> Saved
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <XCircle className="h-3.5 w-3.5" /> Not set
    </span>
  );
}

export default function SettingsPage() {
  const { canManageSettings, isLoading: authLoading } = useAuth();
  const [location] = useLocation();

  const {
    data: settings,
    isLoading,
    error: settingsError,
  } = useGetAzureSettings({
    query: {
      queryKey: getGetAzureSettingsQueryKey(),
      enabled: canManageSettings,
      retry: false,
    },
  });

  const { data: resetStatus, isLoading: statusLoading } = useGetRateResetStatus({
    query: {
      queryKey: getGetRateResetStatusQueryKey(),
      enabled: canManageSettings,
      refetchInterval: 15000,
    }
  }) as { data: any; isLoading: boolean };

  const [docIntelEndpoint, setDocIntelEndpoint] = useState("");
  const [docIntelKey, setDocIntelKey] = useState("");
  const [openaiEndpoint, setOpenaiEndpoint] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiDeployment, setOpenaiDeployment] = useState("");
  const [storageConnectionString, setStorageConnectionString] = useState("");

  useEffect(() => {
    if (!settings) return;
    setDocIntelEndpoint(settings.docIntelEndpoint);
    setOpenaiEndpoint(settings.openaiEndpoint);
    setOpenaiDeployment(settings.openaiDeployment);
  }, [settings]);

  const update = useUpdateAzureSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAzureSettingsQueryKey() });
        setDocIntelKey("");
        setOpenaiKey("");
        setStorageConnectionString("");
        toast({ title: "Settings saved", description: "Your Azure credentials have been updated." });
      },
      onError: (err) => {
        toast({ title: "Couldn't save settings", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const save = () => {
    update.mutate({
      data: {
        docIntelEndpoint,
        openaiEndpoint,
        openaiDeployment,
        ...(docIntelKey ? { docIntelKey } : {}),
        ...(openaiKey ? { openaiKey } : {}),
        ...(storageConnectionString ? { storageConnectionString } : {}),
      },
    });
  };

  if (authLoading) return null;

  if (!canManageSettings) {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader
          backHref="/"
          title="Access Denied"
        />
        <div className="max-w-md mx-auto p-4 md:p-8 mt-10">
          <Card className="border-destructive/20 bg-destructive/5">
            <CardHeader className="pb-3 text-center">
              <ShieldAlert className="h-10 w-10 text-destructive mx-auto mb-2" />
              <CardTitle>Administrator Access Required</CardTitle>
              <CardDescription>
                You do not have permission to view or manage settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button asChild variant="outline">
                <Link href="/">Return to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        backHref="/"
        breadcrumb={
          <>
            <Link href="/" className="hover:text-foreground transition-colors font-semibold cursor-pointer">Clients</Link>
            <span className="text-border">/</span>
            <span className="text-foreground font-semibold">Settings</span>
          </>
        }
        title="Settings"
      />

      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex border-b">
          <Link href="/settings">
            <div className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer transition-colors ${location === "/settings" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              Azure Integration
            </div>
          </Link>
          <Link href="/settings/access">
            <div className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer transition-colors ${location === "/settings/access" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              Access & Users
            </div>
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-3 bg-muted/30 rounded-t-xl">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Prime Rate Sync Status
              </span>
            </CardTitle>
            <CardDescription>
              Automatic retrieval of benchmark rate observations and calculation of required prime-linked resets.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {statusLoading ? (
              <div className="text-sm text-muted-foreground">Checking status...</div>
            ) : !resetStatus?.runs || resetStatus.runs.length === 0 ? (
              <div className="text-sm text-muted-foreground">No sync runs recorded yet.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="space-y-1">
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider">Last Run</span>
                    <span className="font-medium whitespace-nowrap">
                      {format(parseISO(resetStatus.runs[0].startedAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider">Status</span>
                    <span className={`inline-flex items-center gap-1 font-medium capitalize ${resetStatus.runs[0].status === 'failed' ? 'text-red-600' : resetStatus.runs[0].status === 'partial' ? 'text-amber-600' : resetStatus.runs[0].status === 'succeeded' ? 'text-emerald-600' : 'text-blue-600'}`}>
                      {resetStatus.runs[0].status}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider">Applied</span>
                    <span className="font-medium">{resetStatus.runs[0].applied} / {resetStatus.runs[0].attempted}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider">Unresolved</span>
                    <span className={`font-medium ${resetStatus.unresolved?.length > 0 ? 'text-red-600 font-bold' : ''}`}>
                      {resetStatus.unresolved?.length || 0}
                    </span>
                  </div>
                </div>
                {(resetStatus.unresolved?.length || 0) > 0 && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <AlertTriangle className="inline h-4 w-4 mr-1.5 align-text-bottom" />
                    <strong>{resetStatus.unresolved.length} unresolved rate {resetStatus.unresolved.length === 1 ? 'finding' : 'findings'}</strong> across the system. Check affected loans to provide manual overrides.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          The PDF import feature uses three Azure services: Document Intelligence reads the PDF,
          Azure OpenAI identifies the loan or lease details, and Blob Storage keeps a copy of the
          original document. Keys are stored securely and never shown again after saving.
        </p>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileScan className="h-4 w-4 text-primary" /> Document Intelligence
            </CardTitle>
            <CardDescription>Reads the text out of uploaded PDFs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="diEndpoint">Endpoint</Label>
              <Input
                id="diEndpoint"
                placeholder="https://your-resource.cognitiveservices.azure.com"
                value={docIntelEndpoint}
                onChange={(e) => setDocIntelEndpoint(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="diKey">API Key</Label>
                <KeyStatus set={settings?.docIntelKeySet ?? false} />
              </div>
              <Input
                id="diKey"
                type="password"
                placeholder={settings?.docIntelKeySet ? "Leave blank to keep the saved key" : "Enter your key"}
                value={docIntelKey}
                onChange={(e) => setDocIntelKey(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Azure OpenAI
            </CardTitle>
            <CardDescription>Identifies whether the document is a loan or lease and extracts the terms.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="aoEndpoint">Endpoint</Label>
              <Input
                id="aoEndpoint"
                placeholder="https://your-resource.openai.azure.com"
                value={openaiEndpoint}
                onChange={(e) => setOpenaiEndpoint(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aoDeployment">Deployment Name</Label>
              <Input
                id="aoDeployment"
                placeholder="e.g. gpt-4o"
                value={openaiDeployment}
                onChange={(e) => setOpenaiDeployment(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="aoKey">API Key</Label>
                <KeyStatus set={settings?.openaiKeySet ?? false} />
              </div>
              <Input
                id="aoKey"
                type="password"
                placeholder={settings?.openaiKeySet ? "Leave blank to keep the saved key" : "Enter your key"}
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" /> Blob Storage
            </CardTitle>
            <CardDescription>
              Keeps a copy of each imported PDF so you can open it later from the loan or lease.
              Required for PDF import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="storageConn">Connection String</Label>
                <KeyStatus set={settings?.storageConnectionSet ?? false} />
              </div>
              <Input
                id="storageConn"
                type="password"
                placeholder={settings?.storageConnectionSet ? "Leave blank to keep the saved value" : "DefaultEndpointsProtocol=https;AccountName=…"}
                value={storageConnectionString}
                onChange={(e) => setStorageConnectionString(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button onClick={save} disabled={isLoading || update.isPending} className="gap-2">
            <KeyRound className="h-4 w-4" />
            {update.isPending ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}
