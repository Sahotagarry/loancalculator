import { useEffect, useState } from "react";
import {
  useGetAzureSettings,
  useUpdateAzureSettings,
  useUnlockSettings,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { CheckCircle2, XCircle, KeyRound, FileScan, Sparkles, Database, Lock } from "lucide-react";

const TOKEN_KEY = "settingsAdminToken";

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
  const [adminToken, setAdminToken] = useState<string | null>(
    () => sessionStorage.getItem(TOKEN_KEY),
  );
  const [password, setPassword] = useState("");

  const authHeaders: Record<string, string> = adminToken
    ? { authorization: `Bearer ${adminToken}` }
    : {};

  const unlockMutation = useUnlockSettings({
    mutation: {
      onSuccess: (result) => {
        sessionStorage.setItem(TOKEN_KEY, result.token);
        setAdminToken(result.token);
        setPassword("");
      },
      onError: (err) => {
        toast({
          title: "Couldn't unlock settings",
          description: getErrorMessage(err),
          variant: "destructive",
        });
      },
    },
  });

  const {
    data: settings,
    isLoading,
    error: settingsError,
  } = useGetAzureSettings({
    query: {
      queryKey: ["/api/settings/azure"],
      enabled: Boolean(adminToken),
      retry: false,
    },
    request: { headers: authHeaders },
  });

  // An expired or invalid token sends the user back to the password prompt.
  useEffect(() => {
    if (settingsError && (settingsError as { status?: number }).status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      setAdminToken(null);
      queryClient.removeQueries({ queryKey: ["/api/settings/azure"] });
    }
  }, [settingsError]);

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
    request: { headers: authHeaders },
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/settings/azure"] });
        setDocIntelKey("");
        setOpenaiKey("");
        setStorageConnectionString("");
        toast({ title: "Settings saved", description: "Your Azure credentials have been updated." });
      },
      onError: (err) => {
        if ((err as { status?: number }).status === 401) {
          sessionStorage.removeItem(TOKEN_KEY);
          setAdminToken(null);
          queryClient.removeQueries({ queryKey: ["/api/settings/azure"] });
          toast({
            title: "Session expired",
            description: "Please enter the admin password again, then save.",
            variant: "destructive",
          });
          return;
        }
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

  if (!adminToken) {
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
        <div className="max-w-md mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" /> Admin access required
              </CardTitle>
              <CardDescription>
                The Azure credentials are protected. Enter the admin password to view or change
                them. You'll stay unlocked for this browser session.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (password) unlockMutation.mutate({ data: { password } });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="adminPassword">Admin password</Label>
                  <Input
                    id="adminPassword"
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full gap-2"
                  disabled={!password || unlockMutation.isPending}
                >
                  <KeyRound className="h-4 w-4" />
                  {unlockMutation.isPending ? "Checking…" : "Unlock Settings"}
                </Button>
              </form>
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
        meta={
          <span className="text-sm text-muted-foreground hidden md:inline">
            Azure credentials for PDF document import.
          </span>
        }
      />
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
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
